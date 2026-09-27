/**
 * TNT Tommy — the leaderboard on screen.
 *
 * Draws the world board wherever the page asks for one (`[data-board]`: the
 * title card and both end cards), keeps the miner's name field, and tells the
 * player what became of the run they just finished.
 *
 * Driven entirely by events — the leaderboard's own bus for the board, and the
 * run's `STATE_CHANGED` for when to fetch — so it never polls and never
 * decides anything. Posting is the leaderboard's job; this only shows it.
 */
(function (TNT) {
    'use strict';

    const { Util, Leaderboard } = TNT;
    const EV = TNT.EV;
    const LB = Leaderboard.EVENTS;

    const STATUS_TEXT = {
        loading: 'Fetching…',
        live: '',
        offline: 'Offline — showing the last board seen'
    };

    /** What an empty board says, by where it came from. */
    const EMPTY_TEXT = {
        loading: 'Fetching the board…',
        live: 'No scores yet. The first name down is yours.',
        offline: 'The world board can’t be reached right now.'
    };

    /**
     * @param {TNT.Run} run
     * @param {TNT.Leaderboard} board
     * @param {HTMLElement} root   the shell
     */
    function ScoreboardView(run, board, root) {
        this.run = run;
        this.board = board;
        this.root = root;
        this.nameField = root.querySelector('#miner-name');
        this._listen();
        this._fillName();
        this.render();
        this.renderResult();
    }

    ScoreboardView.prototype._listen = function () {
        const self = this;
        const board = this.board;

        board.bus.on(LB.UPDATED, function () { self.render(); });
        board.bus.on(LB.SUBMITTED, function () { self.renderResult(); });

        this.run.bus.on(EV.STATE_CHANGED, function (e) {
            if (e.to === 'title' || e.to === 'gameover' || e.to === 'victory') {
                self.renderResult();
                board.refresh(false);
            }
        });

        if (this.nameField) {
            // Saved as it is typed, so a click on the start button — which never
            // submits the form — still starts the run under the new name.
            this.nameField.addEventListener('input', function () {
                board.setName(self.nameField.value);
                self.render();
            });
            this.nameField.addEventListener('blur', function () { self._fillName(); });
        }

        // Enter in the title's name field starts the run, as Enter does
        // everywhere else on that screen; Enter on an end card posts the run.
        this.root.addEventListener('submit', function (ev) {
            const form = ev.target;
            ev.preventDefault();
            if (form.id === 'miner-form') {
                board.setName(self.nameField.value);
                self.nameField.blur();
                self.run.confirm();
                return;
            }
            if (form.hasAttribute('data-post-form')) {
                const field = form.querySelector('input');
                if (!field || !TNT.ScoreRules.cleanName(field.value)) return;
                field.blur();
                board.postUnposted(field.value);
                self._fillName();
            }
        });
    };

    /** Show the stored name, cleaned, in every name field. */
    ScoreboardView.prototype._fillName = function () {
        const name = this.board.name;
        if (this.nameField && document.activeElement !== this.nameField) this.nameField.value = name;
        const fields = this.root.querySelectorAll('[data-post-form] input');
        for (let i = 0; i < fields.length; i++) {
            if (document.activeElement !== fields[i]) fields[i].value = name;
        }
    };

    /** Draw the board into every `[data-board]` on the page. */
    ScoreboardView.prototype.render = function () {
        const rows = this.board.board;
        const me = this.board.name;
        const status = STATUS_TEXT[this.board.status] || '';
        const mines = this.run.mines;

        const hosts = this.root.querySelectorAll('[data-board]');
        for (let h = 0; h < hosts.length; h++) {
            const host = hosts[h];
            const body = host.querySelector('tbody');
            const caption = host.querySelector('[data-board-status]');
            if (caption) {
                caption.textContent = status;
                caption.hidden = !status;
            }
            if (!body) continue;

            const frag = document.createDocumentFragment();
            if (rows.length === 0) {
                const tr = document.createElement('tr');
                tr.className = 'board__empty';
                const td = cell(tr, EMPTY_TEXT[this.board.status] || EMPTY_TEXT.live);
                td.colSpan = 4;
                frag.appendChild(tr);
            }
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const tr = document.createElement('tr');
                if (me && r.name === me) tr.classList.add('is-me');
                if (r.won) tr.classList.add('is-won');
                cell(tr, String(i + 1), 'board__rank');
                cell(tr, r.name, 'board__name');
                const reached = r.won ? 'ALL THREE' : (mines[r.mine - 1] ? mines[r.mine - 1].name : '—');
                const where = cell(tr, reached, 'board__mine');
                where.title = 'Reached in ' + Util.formatTime(r.seconds);
                cell(tr, Util.formatScore(r.score), 'board__score');
                frag.appendChild(tr);
            }
            body.replaceChildren(frag);
        }
    };

    /** What became of the run just finished, on both end cards. */
    ScoreboardView.prototype.renderResult = function () {
        const result = this.board.lastResult;
        const text = describe(result, this.board.unposted);
        const lines = this.root.querySelectorAll('[data-post]');
        for (let i = 0; i < lines.length; i++) {
            lines[i].textContent = text;
            lines[i].hidden = !text;
        }
        const wantsName = !!(result && result.outcome === 'unnamed' && this.board.unposted);
        const forms = this.root.querySelectorAll('[data-post-form]');
        for (let i = 0; i < forms.length; i++) forms[i].hidden = !wantsName;
        this._fillName();
    };

    function describe(result, unposted) {
        if (!result) return '';
        switch (result.outcome) {
            case 'unnamed':
                return unposted ? 'Put a name to it and it goes on the world board.' : '';
            case 'placed':
                if (!result.improved) return 'Posted — your best still stands at #' + result.rank + ' in the world.';
                return result.rank === 1
                    ? 'Posted — the best in the world.'
                    : 'Posted — #' + result.rank + ' in the world.';
            case 'queued':
                return 'No connection — this run is saved and will be posted next time.';
            case 'rejected':
                return 'The board would not take this run.';
            default:
                return '';
        }
    }

    function cell(tr, text, cls) {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = text;
        tr.appendChild(td);
        return td;
    }

    TNT.ScoreboardView = ScoreboardView;
})(window.TNT = window.TNT || {});
