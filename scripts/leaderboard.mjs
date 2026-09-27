/**
 * Leaderboard checks, headless.
 *
 *   node scripts/leaderboard.mjs
 *
 * Two halves. The shared contract is imported exactly as `api/scores.js`
 * imports it — a side-effect ESM import of a classic script — so a change
 * that breaks the server's view of it fails here first. The game's client is
 * then run against a fake server that can answer, refuse, or be unreachable,
 * to prove a run is never lost between the end screen and the board.
 *
 * The live endpoint is not touched; check that with a GET after a deploy.
 */
import '../shared/leaderboard.js';
import { loadSim } from './lib/load.mjs';

const Rules = globalThis.TNT.ScoreRules;

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
    if (ok) { passes++; return; }
    failures++;
    console.error('FAIL  ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''));
}

/* ---------------------------------------------------------------------- *
 * The contract, as the server sees it
 * ---------------------------------------------------------------------- */

const good = { name: '  tommy  the\tminer ', score: 42000, mine: 2, seconds: 900, won: false };
const v = Rules.validateSubmission(good);
check('a plausible run is accepted', v.entry !== undefined, v);
check('names are cleaned and capitalised', v.entry && v.entry.name === 'TOMMY THE MI', v.entry);
check('control characters are stripped', Rules.cleanName('A\u0000B\u001fC') === 'ABC');

check('no name is refused', Rules.validateSubmission({ ...good, name: '   ' }).error !== undefined);
check('zero score is refused', Rules.validateSubmission({ ...good, score: 0 }).error !== undefined);
check('NaN score is refused', Rules.validateSubmission({ ...good, score: 'lots' }).error !== undefined);
check('mine 0 is refused', Rules.validateSubmission({ ...good, mine: 0 }).error !== undefined);
check('mine 4 is refused', Rules.validateSubmission({ ...good, mine: 4 }).error !== undefined);
check('zero seconds is refused', Rules.validateSubmission({ ...good, seconds: 0 }).error !== undefined);
check('a week-long run is refused', Rules.validateSubmission({ ...good, seconds: 7 * 86400 }).error !== undefined);
check('a win short of the last mine is refused',
    Rules.validateSubmission({ ...good, won: true, mine: 2 }).error !== undefined);
check('a win in the last mine is accepted',
    Rules.validateSubmission({ ...good, won: true, mine: 3 }).entry !== undefined);
check('a score past the ceiling is refused',
    Rules.validateSubmission({ ...good, score: Rules.scoreCeiling(2, 900) + 1 }).error !== undefined);
check('a score at the ceiling is accepted',
    Rules.validateSubmission({ ...good, score: Rules.scoreCeiling(2, 900) }).entry !== undefined);
check('garbage body is refused, not thrown', Rules.validateSubmission(null).error !== undefined);

/*
 * The ceiling must clear a genuinely excellent run, or the board refuses the
 * best players. Build the best score a mine can pay from the game's own
 * constants and ore counts and assert it fits with margin, fast.
 */
const T = loadSim();
const C = T.C;
let perfect = 0;
const mines = T.World.buildAll();
for (const m of mines) {
    const oreRooms = m.rooms.filter((r) => r.oreCount > 0).length;
    const ore = m.rooms.reduce((n, r) => n + r.oreCount, 0);
    perfect += m.tntTotal * C.SCORE_TNT + ore * C.SCORE_ORE + oreRooms * C.SCORE_MEDAL + C.SCORE_ALL_MEDALS +
        C.COGS_PER_MINE * C.SCORE_COG + 3 * C.SCORE_VALVE + C.SCORE_GOVERNOR +
        C.LIVES_MAX * C.SCORE_LIFE_BONUS + C.SCORE_TIME_BASE +
        // A room of patrols chained end to end, once per room, is far past real play.
        m.rooms.length * C.SCORE_STOMP * (C.STOMP_CHAIN_MAX * (C.STOMP_CHAIN_MAX + 1)) / 2;
}
const fastest = 10 * 60;
check('a perfect three-mine run in ten minutes is under the ceiling',
    perfect <= Rules.scoreCeiling(mines.length, fastest), { perfect, ceiling: Rules.scoreCeiling(mines.length, fastest) });
check('contract and game agree on the mine count', mines.length === Rules.MINES, mines.length);

const board = Rules.parseBoard([
    { name: 'b', score: 500, mine: 1, seconds: 60 },
    { name: 'a', score: 900, mine: 3, seconds: 999, won: true },
    { name: 'tie-slow', score: 500, mine: 1, seconds: 90 },
    { name: '', score: 100 },
    null,
    { name: 'neg', score: -3 }
]);
check('bad rows are dropped', board.length === 3, board);
check('board is best first', board[0].name === 'A');
check('ties go to the faster run', board[1].name === 'B' && board[2].name === 'TIE-SLOW', board);

const placed = Rules.placeOnBoard(board, { name: 'b', score: 400, mine: 1, seconds: 10 });
check('a worse run leaves a row alone', placed.find((r) => r.name === 'B').score === 500);
const better = Rules.placeOnBoard(board, { name: 'b', score: 1000, mine: 2, seconds: 10 });
check('a better run replaces its row', better[0].name === 'B' && better.filter((r) => r.name === 'B').length === 1);
const full = Array.from({ length: 10 }, (_, i) => ({ name: 'P' + i, score: 1000 + i, mine: 1, seconds: 60 }));
check('the board holds ten', Rules.placeOnBoard(full, { name: 'NEW', score: 5000, mine: 1, seconds: 1 }).length === 10);

/* ---------------------------------------------------------------------- *
 * The client, against a fake server
 * ---------------------------------------------------------------------- */

const sim = loadSim([
    'src/core/Constants.js', 'src/core/Util.js', 'src/core/EventBus.js',
    'shared/leaderboard.js', 'src/systems/Leaderboard.js'
]);

function memoryStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        dump: () => m
    };
}

/** A server that keeps a real board, with a switch for each way it can fail. */
function fakeServer() {
    const rows = new Map();
    const srv = {
        mode: 'ok',
        posts: 0,
        fetch: async (url, init) => {
            if (srv.mode === 'down') throw new Error('network down');
            if (srv.mode === '503') return respond(503, { ok: false, board: [] });
            if (srv.mode === 'html') return { ok: true, status: 200, headers: headers('text/html'), json: async () => ({}) };
            if (init.method === 'POST') {
                srv.posts++;
                const r = Rules.validateSubmission(JSON.parse(init.body));
                if (r.error) return respond(400, { ok: false, board: [], error: r.error });
                const prev = rows.get(r.entry.name);
                const improved = !prev || prev.score < r.entry.score;
                if (improved) rows.set(r.entry.name, r.entry);
                const list = Rules.parseBoard([...rows.values()]);
                return respond(200, { ok: true, improved, rank: list.findIndex((x) => x.name === r.entry.name) + 1, board: list });
            }
            return respond(200, { ok: true, board: Rules.parseBoard([...rows.values()]) });
        },
        rows
    };
    return srv;
}
function headers(type) { return { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }; }
function respond(status, body) {
    return { ok: status >= 200 && status < 300, status, headers: headers('application/json'), json: async () => body };
}

/** A stand-in for the run: just its bus and the fields a finished run is read from. */
function fakeRun() {
    return { bus: new sim.EventBus(), score: 0, mineIndex: 0, elapsed: 0 };
}
function finish(run, state, score, mineIndex, elapsed) {
    run.score = score;
    run.mineIndex = mineIndex;
    run.elapsed = elapsed;
    run.bus.emit(sim.EV.STATE_CHANGED, { from: 'dying', to: state });
}
const settle = () => new Promise((r) => setTimeout(r, 0));

{
    const srv = fakeServer();
    const store = memoryStorage();
    const run = fakeRun();
    const lb = new sim.Leaderboard(run, { fetch: srv.fetch, storage: store });
    const results = [];
    lb.bus.on(sim.Leaderboard.EVENTS.SUBMITTED, (r) => results.push(r));

    await lb.refresh(true);
    check('first fetch goes live', lb.status === 'live', lb.status);

    finish(run, 'gameover', 1200, 0, 120);
    await settle();
    check('an unnamed run is held, not posted', srv.posts === 0 && lb.unposted && results.at(-1).outcome === 'unnamed');

    await lb.postUnposted('dan');
    check('the held run posts once named', srv.posts === 1 && srv.rows.get('DAN').score === 1200);
    check('the post reports its rank', results.at(-1).outcome === 'placed' && results.at(-1).rank === 1, results.at(-1));
    check('the name is remembered', lb.name === 'DAN' && store.getItem('tnt-tommy.name') === 'DAN');

    finish(run, 'victory', 90000, 2, 1800);
    for (let i = 0; i < 5 && results.length < 3; i++) await settle();
    check('a named run posts on its own', srv.rows.get('DAN').score === 90000 && srv.rows.get('DAN').won === true);

    finish(run, 'gameover', 50, 0, 30);
    for (let i = 0; i < 5 && results.length < 4; i++) await settle();
    check('a worse run keeps the best', srv.rows.get('DAN').score === 90000 && results.at(-1).improved === false, results.at(-1));

    const again = new sim.Leaderboard(fakeRun(), { fetch: null, storage: store });
    check('the board survives a reload from cache', again.board.length === 1 && again.board[0].score === 90000);
    check('the name survives a reload', again.name === 'DAN');
}

{
    const srv = fakeServer();
    const store = memoryStorage();
    const run = fakeRun();
    const lb = new sim.Leaderboard(run, { fetch: srv.fetch, storage: store });
    lb.setName('kev');
    const results = [];
    lb.bus.on(sim.Leaderboard.EVENTS.SUBMITTED, (r) => results.push(r));

    for (const mode of ['down', '503', 'html']) {
        srv.mode = mode;
        results.length = 0;
        finish(run, 'gameover', 3000 + srv.posts, 0, 100);
        for (let i = 0; i < 5 && results.length < 1; i++) await settle();
        check('run is queued when the server is ' + mode, results.at(-1) && results.at(-1).outcome === 'queued', results);
    }
    check('the queued run is on the board on screen', lb.board[0] && lb.board[0].name === 'KEV');
    check('status says offline', lb.status === 'offline');

    // A reload while offline must not lose the queue.
    const reloaded = new sim.Leaderboard(fakeRun(), { fetch: srv.fetch, storage: store });
    check('the queue survives a reload', reloaded.pending.length === 3, reloaded.pending.length);

    srv.mode = 'ok';
    await reloaded.refresh(true);
    check('the queue drains once the server is back', reloaded.pending.length === 0 && srv.rows.get('KEV').score >= 3000);
    check('and the board goes live', reloaded.status === 'live');
}

{
    const srv = fakeServer();
    const run = fakeRun();
    const lb = new sim.Leaderboard(run, { fetch: srv.fetch, storage: memoryStorage() });
    lb.setName('cheat');
    const results = [];
    lb.bus.on(sim.Leaderboard.EVENTS.SUBMITTED, (r) => results.push(r));
    finish(run, 'gameover', 9e9, 0, 10);
    for (let i = 0; i < 5 && results.length < 1; i++) await settle();
    check('an impossible run is refused and never sent', results.at(-1).outcome === 'rejected' && srv.posts === 0);
    check('and never shown', lb.board.length === 0);

    finish(run, 'gameover', 0, 0, 10);
    await settle();
    check('a zero run is not posted at all', results.length === 1 && srv.posts === 0);
}

{
    // Starting the next run passes up a run held for a name.
    const run = fakeRun();
    const lb = new sim.Leaderboard(run, { fetch: null, storage: memoryStorage() });
    finish(run, 'gameover', 500, 0, 50);
    run.bus.emit(sim.EV.STATE_CHANGED, { from: 'gameover', to: 'playing' });
    check('a new run clears the held one', lb.unposted === null && lb.lastResult === null);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
