/**
 * TNT Tommy — the leaderboard contract.
 *
 * One file, loaded by both sides so they cannot drift: the name the game shows
 * while a submission is in flight is the name the server will store, and a run
 * the game would post is a run the server will accept.
 *
 * It is a classic script that hangs itself on `globalThis.TNT`, like every
 * other module in the game, because the game has no build step and runs from
 * `file://`. The serverless function reaches it the same way, with a bare
 * side-effect `import` — in Node the IIFE runs once and leaves the namespace on
 * `globalThis`. Pure: no DOM, no Node APIs.
 */
(function (root) {
    'use strict';

    const TNT = root.TNT = root.TNT || {};

    /** Longest miner name the board has room for. */
    const NAME_MAX = 12;

    /** Rows the board holds. */
    const BOARD_SIZE = 10;

    /**
     * The global season. Raising it starts everyone on an empty board; old rows
     * stay in the table under their season and are simply no longer read.
     * Raise it whenever a scoring change makes old runs incomparable.
     */
    const SEASON = 1;

    /** Mines in the campaign. A run reaches between one and all of them. */
    const MINES = 3;

    /*
     * The plausibility bound. Kept generous on purpose: it exists to keep
     * obvious nonsense off a public board, and a real run that trips it would
     * be a far worse bug than a cheat that slips under it.
     *
     * A mine stripped of everything — every stick, nugget, medal, cog and heart,
     * the Governor and its valves, a full helmet bonus and the whole time bonus —
     * comes to a little over forty thousand. Sixty covers it with room to spare.
     * Stomp chains are the one open-ended source, because guardians re-form and
     * a death rewinds a room's patrols, so time spent in a mine is credited too,
     * at several times any rate a player could farm.
     */
    const PER_MINE = 60000;
    const PER_SECOND = 400;
    const SLACK = 5000;
    /** Six hours. A run is not left open longer than that and then posted. */
    const MAX_SECONDS = 6 * 60 * 60;

    /**
     * A name as the board stores it: no control characters, runs of whitespace
     * collapsed, trimmed, cut to fit, and in capitals — the way an arcade board
     * and the name field both show it.
     */
    function cleanName(raw) {
        // Whitespace first: a tab is a control character too, and stripping it
        // before collapsing would run two words together.
        return String(raw == null ? '' : raw)
            .replace(/\s+/g, ' ')
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, NAME_MAX)
            .toUpperCase();
    }

    /** Highest score a run that reached `mine` in `seconds` could plausibly hold. */
    function scoreCeiling(mine, seconds) {
        return SLACK + PER_MINE * mine + PER_SECOND * seconds;
    }

    function whole(value) {
        const n = Math.floor(Number(value));
        return Number.isFinite(n) ? n : NaN;
    }

    /**
     * Validate a submission from an untrusted client.
     *
     * The client is a web page, so a determined person can post whatever they
     * like. These bounds keep casual tampering off the board; they are not
     * security, and nothing depends on them being so.
     *
     * @returns {{entry: {name: string, score: number, mine: number, seconds: number, won: boolean}} | {error: string}}
     */
    function validateSubmission(body) {
        const raw = (typeof body === 'object' && body !== null) ? body : {};

        const name = cleanName(raw.name);
        if (!name) return { error: 'a name is required' };

        const score = whole(raw.score);
        if (!(score > 0)) return { error: 'score must be a positive number' };

        const mine = whole(raw.mine);
        if (!(mine >= 1 && mine <= MINES)) return { error: 'mine must be between 1 and ' + MINES };

        const seconds = whole(raw.seconds);
        if (!(seconds >= 1 && seconds <= MAX_SECONDS)) return { error: 'run time is not plausible' };

        const won = raw.won === true;
        if (won && mine !== MINES) return { error: 'a won run reaches the last mine' };

        if (score > scoreCeiling(mine, seconds)) return { error: 'score does not match the run' };

        return { entry: { name: name, score: score, mine: mine, seconds: seconds, won: won } };
    }

    /**
     * Parse a board from an untrusted source — the network, or a cached copy.
     * Bad rows are dropped rather than failing the board.
     */
    function parseBoard(data) {
        if (!Array.isArray(data)) return [];
        const rows = [];
        for (const row of data) {
            if (typeof row !== 'object' || row === null) continue;
            const name = cleanName(row.name);
            const score = whole(row.score);
            if (!name || !(score > 0)) continue;
            const mine = whole(row.mine);
            const seconds = whole(row.seconds);
            rows.push({
                name: name,
                score: score,
                mine: mine >= 1 && mine <= MINES ? mine : 1,
                seconds: seconds > 0 ? seconds : 0,
                won: row.won === true
            });
        }
        return sortBoard(rows).slice(0, BOARD_SIZE);
    }

    /** Best first; a tie goes to whoever did it faster. */
    function sortBoard(rows) {
        return rows.sort(function (a, b) { return (b.score - a.score) || (a.seconds - b.seconds); });
    }

    /**
     * Put a run on a board the way the server would: one row per name, kept
     * only if it beats that name's existing row.
     */
    function placeOnBoard(board, run) {
        const name = cleanName(run.name);
        const existing = board.find(function (r) { return r.name === name; });
        if (existing && existing.score >= run.score) return board.slice();
        const others = board.filter(function (r) { return r.name !== name; });
        others.push({ name: name, score: run.score, mine: run.mine, seconds: run.seconds, won: run.won === true });
        return sortBoard(others).slice(0, BOARD_SIZE);
    }

    TNT.ScoreRules = Object.freeze({
        NAME_MAX: NAME_MAX,
        BOARD_SIZE: BOARD_SIZE,
        SEASON: SEASON,
        MINES: MINES,
        MAX_SECONDS: MAX_SECONDS,
        cleanName: cleanName,
        scoreCeiling: scoreCeiling,
        validateSubmission: validateSubmission,
        parseBoard: parseBoard,
        placeOnBoard: placeOnBoard
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
