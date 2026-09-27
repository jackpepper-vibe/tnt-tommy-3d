/**
 * TNT Tommy — the global leaderboard, as the game sees it.
 *
 * The server's board at `/api/scores` is the only authority. Everything kept
 * locally exists so the board degrades rather than disappears:
 *
 *  - the last board the server gave is cached and shown until a fresh one
 *    arrives, so the title never opens on an empty table while a request is out;
 *  - a finished run goes onto the board on screen at once, and is replaced by
 *    the server's answer when it lands;
 *  - a run that could not be sent is queued and sent the next time the board
 *    is fetched, so a dropped connection at the end of a good run does not
 *    lose it;
 *  - a run finished with no name entered is held, so the end screen can ask
 *    for one and post it then.
 *
 * Part of the shell. It hears about the end of a run through the simulation's
 * bus and never writes to the run. Its own changes go out on its own bus, as
 * `Leaderboard.EVENTS`; nothing reads this class on a timer.
 */
(function (TNT) {
    'use strict';

    const { EventBus, ScoreRules: Rules } = TNT;
    const EV = TNT.EV;

    const CACHE_KEY = 'tnt-tommy.board.v1';
    const NAME_KEY = 'tnt-tommy.name';
    /** Runs kept for retry while the server cannot be reached. */
    const PENDING_MAX = 10;
    /** A request slower than this is treated as a failure, not waited on. */
    const REQUEST_TIMEOUT_MS = 8000;
    /** How stale the board may get before returning to a menu fetches it again. */
    const REFRESH_AFTER_MS = 20000;

    const EVENTS = Object.freeze({
        /** The board on hand changed: `{status, rows}`. */
        UPDATED: 'leaderboard-updated',
        /**
         * A run was dealt with: `{outcome, rank, improved}`. `outcome` is
         * `placed` (the server has it), `queued` (it will be sent later),
         * `rejected` (the server refused it), or `unnamed` (held for a name).
         */
        SUBMITTED: 'leaderboard-submitted'
    });

    /**
     * @param {TNT.Run} run    the run whose endings are posted
     * @param {object} [opts]  `endpoint`, `storage`, `fetch` — seams for tests
     */
    function Leaderboard(run, opts) {
        const o = opts || {};
        this.bus = new EventBus();
        this.endpoint = o.endpoint || 'api/scores';
        this.storage = o.storage !== undefined ? o.storage : safeStorage();
        this._fetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(window) : null);

        /** `loading` until the server first answers, then `live` or `offline`. */
        this.status = 'loading';
        /** The last result of a posted run, for the end screen. */
        this.lastResult = null;
        /** A finished run waiting for a name. */
        this.unposted = null;

        this._fetchedAt = 0;
        this._inFlight = null;

        const cache = this._readCache();
        this.board = cache.board;
        this.pending = cache.pending;
        this.name = this._readName();

        const self = this;
        run.bus.on(EV.STATE_CHANGED, function (e) {
            if (e.to === 'gameover' || e.to === 'victory') self._runEnded(run, e.to === 'victory');
            // A new run: whatever the last one left unposted was passed up.
            if (e.from === 'title' || e.from === 'gameover' || e.from === 'victory') {
                self.unposted = null;
                self.lastResult = null;
            }
        });
    }

    Leaderboard.EVENTS = EVENTS;

    /* ------------------------------------------------------------------ *
     * The miner's name
     * ------------------------------------------------------------------ */

    /** Set the name runs are posted under. Returns it as the board will show it. */
    Leaderboard.prototype.setName = function (raw) {
        this.name = Rules.cleanName(raw);
        if (this.storage) {
            try { this.storage.setItem(NAME_KEY, this.name); } catch (err) { /* not remembered, still used */ }
        }
        return this.name;
    };

    Leaderboard.prototype._readName = function () {
        if (!this.storage) return '';
        try { return Rules.cleanName(this.storage.getItem(NAME_KEY)); } catch (err) { return ''; }
    };

    /* ------------------------------------------------------------------ *
     * The board
     * ------------------------------------------------------------------ */

    /**
     * Fetch the board, sending any queued runs first.
     *
     * Calls made while one is already out share it. Unless `force` is set, a
     * board fetched within the last few seconds is kept rather than asked for
     * again, so flicking between screens does not hammer the server.
     */
    Leaderboard.prototype.refresh = function (force) {
        if (this._inFlight) return this._inFlight;
        if (!force && this.status === 'live' && now() - this._fetchedAt < REFRESH_AFTER_MS) {
            return Promise.resolve();
        }
        const self = this;
        this._inFlight = this._sync().finally(function () { self._inFlight = null; });
        return this._inFlight;
    };

    /**
     * Post a finished run.
     *
     * It is on the board on screen before this returns; the promise settles once
     * the server has answered or the run has been queued for later.
     */
    Leaderboard.prototype.submit = async function (run) {
        const checked = Rules.validateSubmission(run);
        if (checked.error !== undefined) {
            this._result({ outcome: 'rejected', rank: null, improved: false });
            return;
        }
        const entry = checked.entry;

        this.board = Rules.placeOnBoard(this.board, entry);
        this._announce();

        // Let an in-progress fetch finish first so its answer cannot land after
        // this one and put the board back to how it was before the run.
        await this._inFlight;
        const outcome = await this._post(entry);
        if (outcome.kind === 'unreachable') {
            this._enqueue(entry);
            this._setOffline();
            this._result({ outcome: 'queued', rank: this._localRank(entry.name), improved: false });
            return;
        }
        if (outcome.kind === 'rejected') {
            this._result({ outcome: 'rejected', rank: null, improved: false });
            // Off the server, so off the screen: fetch the board as it really is.
            await this.refresh(true);
            return;
        }
        this._accept(outcome.body);
        this._result({
            outcome: 'placed',
            rank: typeof outcome.body.rank === 'number' ? outcome.body.rank : null,
            improved: outcome.body.improved === true
        });
    };

    /** Post the run that was held for a name, under `name`. */
    Leaderboard.prototype.postUnposted = function (name) {
        if (!this.unposted) return Promise.resolve();
        if (!this.setName(name)) return Promise.resolve();
        const run = Object.assign({}, this.unposted, { name: this.name });
        this.unposted = null;
        return this.submit(run);
    };

    /** Forget the cached board and queue. */
    Leaderboard.prototype.clear = function () {
        this.board = [];
        this.pending = [];
        this._fetchedAt = 0;
        this.status = 'loading';
        this._writeCache();
        this._announce();
    };

    /* ------------------------------------------------------------- internals */

    Leaderboard.prototype._runEnded = function (run, won) {
        this.lastResult = null;
        const score = Math.floor(run.score);
        if (!(score > 0)) return;
        const entry = {
            name: this.name,
            score: score,
            mine: run.mineIndex + 1,
            seconds: Math.max(1, Math.floor(run.elapsed)),
            won: won
        };
        if (!this.name) {
            this.unposted = entry;
            this._result({ outcome: 'unnamed', rank: null, improved: false });
            return;
        }
        this.submit(entry);
    };

    Leaderboard.prototype._sync = async function () {
        // Oldest first, so the queue drains in the order the runs were played.
        while (this.pending.length > 0) {
            const outcome = await this._post(this.pending[0]);
            if (outcome.kind === 'unreachable') {
                this._setOffline();
                return;
            }
            this.pending.shift();
            this._writeCache();
            if (outcome.kind === 'ok') this._accept(outcome.body);
        }

        const outcome = await this._request({ method: 'GET' });
        if (outcome.kind === 'ok') this._accept(outcome.body);
        else this._setOffline();
    };

    Leaderboard.prototype._post = function (entry) {
        return this._request({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });
    };

    /**
     * One request, reduced to what the caller can act on: `ok` with a parsed
     * body, `rejected` when retrying the same request will not help, or
     * `unreachable` — offline, timed out, server trouble — worth trying later.
     */
    Leaderboard.prototype._request = async function (init) {
        if (!this._fetch) return { kind: 'unreachable' };
        const abort = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = abort ? setTimeout(function () { abort.abort(); }, REQUEST_TIMEOUT_MS) : 0;
        try {
            const res = await this._fetch(this.endpoint, Object.assign({
                cache: 'no-store',
                signal: abort ? abort.signal : undefined
            }, init));
            // A 4xx other than rate limiting is a refusal of this request. 429
            // and 5xx (including 503, store not configured) are the server's
            // problem and may clear up, so those runs are kept for another try.
            if (res.status >= 400 && res.status < 500 && res.status !== 429) return { kind: 'rejected' };
            if (!res.ok) return { kind: 'unreachable' };
            // A static host with no functions answers with the page's HTML.
            const type = res.headers && res.headers.get ? res.headers.get('content-type') : '';
            if (!type || type.indexOf('application/json') < 0) return { kind: 'unreachable' };
            const body = await res.json();
            if (!body || body.ok !== true) return { kind: 'unreachable' };
            return {
                kind: 'ok',
                body: {
                    board: Rules.parseBoard(body.board),
                    rank: typeof body.rank === 'number' ? body.rank : undefined,
                    improved: body.improved === true
                }
            };
        } catch (err) {
            return { kind: 'unreachable' };
        } finally {
            if (abort) clearTimeout(timer);
        }
    };

    /** Take the server's board as the truth. */
    Leaderboard.prototype._accept = function (body) {
        this.board = body.board;
        // Queued runs are not on the server's board yet, but they are the
        // player's, and a board without them would look as if they were lost.
        for (const run of this.pending) this.board = Rules.placeOnBoard(this.board, run);
        this.status = this.pending.length > 0 ? 'offline' : 'live';
        this._fetchedAt = now();
        this._writeCache();
        this._announce();
    };

    Leaderboard.prototype._setOffline = function () {
        this.status = 'offline';
        this._writeCache();
        this._announce();
    };

    Leaderboard.prototype._enqueue = function (entry) {
        this.pending.push(entry);
        if (this.pending.length > PENDING_MAX) this.pending.splice(0, this.pending.length - PENDING_MAX);
        this._writeCache();
    };

    /** 1-based place of `name` on the board on hand, or null if it is not on it. */
    Leaderboard.prototype._localRank = function (name) {
        const i = this.board.findIndex(function (r) { return r.name === name; });
        return i < 0 ? null : i + 1;
    };

    Leaderboard.prototype._result = function (result) {
        this.lastResult = result;
        this.bus.emit(EVENTS.SUBMITTED, result);
    };

    Leaderboard.prototype._announce = function () {
        this.bus.emit(EVENTS.UPDATED, { status: this.status, rows: this.board.length });
    };

    Leaderboard.prototype._readCache = function () {
        const empty = { board: [], pending: [] };
        if (!this.storage) return empty;
        try {
            const raw = this.storage.getItem(CACHE_KEY);
            if (!raw) return empty;
            const parsed = JSON.parse(raw);
            // A board from another season is not this season's board, and a run
            // queued in it belongs to a contest that has closed.
            if (!parsed || parsed.season !== Rules.SEASON) return empty;
            const pending = Array.isArray(parsed.pending)
                ? parsed.pending
                    .map(function (p) { return Rules.validateSubmission(p).entry; })
                    .filter(Boolean)
                    .slice(-PENDING_MAX)
                : [];
            return { board: Rules.parseBoard(parsed.board), pending: pending };
        } catch (err) {
            return empty;
        }
    };

    Leaderboard.prototype._writeCache = function () {
        if (!this.storage) return;
        const cache = { season: Rules.SEASON, board: this.board, pending: this.pending };
        try {
            this.storage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (err) {
            // Quota or private mode: the board still works, it just is not remembered.
        }
    };

    function now() {
        return typeof performance !== 'undefined' ? performance.now() : Date.now();
    }

    /**
     * `localStorage` is unavailable on `file://` in some browsers and throws
     * rather than returning null — the screenshot harness runs from there.
     */
    function safeStorage() {
        try {
            const s = window.localStorage;
            s.getItem(CACHE_KEY);
            return s;
        } catch (err) {
            return null;
        }
    }

    TNT.Leaderboard = Leaderboard;
})(window.TNT = window.TNT || {});
