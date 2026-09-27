/**
 * The global leaderboard for TNT Tommy.
 *
 *   GET  /api/scores   this season's top ten miners, best run each
 *   POST /api/scores   submit a finished run: { name, score, mine, seconds, won }
 *
 * Backed by the account's shared Neon Postgres store, in tables of its own
 * (prefixed `tnt_tommy_`, since other games live in the same database). One row
 * per miner per season, keyed on the cleaned name and overwritten only by a
 * better run, so the board shows ten people rather than one good evening ten
 * times.
 *
 * If the store is not configured the endpoint says so plainly with a 503 and
 * the game shows its cached board. The leaderboard never blocks play.
 */
import { neon } from '@neondatabase/serverless';
// The contract the game also loads. A classic script: importing it for its
// side effect leaves `TNT.ScoreRules` on `globalThis`.
import '../shared/leaderboard.js';

const { SEASON, BOARD_SIZE, validateSubmission } = globalThis.TNT.ScoreRules;

/** Submissions one address may make in a minute. A run takes longer than that. */
const RATE_PER_MINUTE = 10;

function connectionString() {
    return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

/**
 * Connect and make sure the tables exist, once per cold start.
 *
 * Creating them here rather than in a migration keeps the deploy one step, and
 * a failure clears the cached promise so the next request retries instead of
 * inheriting a rejected connection for the life of the instance.
 */
let ready = null;
function database(url) {
    ready ??= (async () => {
        const sql = neon(url);
        await sql`
            CREATE TABLE IF NOT EXISTS tnt_tommy_scores (
                season     integer     NOT NULL,
                name       text        NOT NULL,
                score      integer     NOT NULL,
                mine       smallint    NOT NULL,
                seconds    integer     NOT NULL,
                won        boolean     NOT NULL DEFAULT false,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (season, name)
            )`;
        await sql`
            CREATE INDEX IF NOT EXISTS tnt_tommy_scores_rank
            ON tnt_tommy_scores (season, score DESC)`;
        await sql`
            CREATE TABLE IF NOT EXISTS tnt_tommy_rate (
                ip    text        PRIMARY KEY,
                n     integer     NOT NULL,
                since timestamptz NOT NULL DEFAULT now()
            )`;
        return sql;
    })().catch((err) => {
        ready = null;
        throw err;
    });
    return ready;
}

async function board(sql) {
    const rows = await sql`
        SELECT name, score, mine, seconds, won
        FROM tnt_tommy_scores
        WHERE season = ${SEASON}
        ORDER BY score DESC, seconds ASC, updated_at ASC
        LIMIT ${BOARD_SIZE}`;
    return rows.map((r) => ({
        name: String(r.name),
        score: Number(r.score),
        mine: Number(r.mine),
        seconds: Number(r.seconds),
        won: r.won === true
    }));
}

/** A fixed one-minute window per address. Crude, and enough for a game. */
async function throttled(sql, req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim() || 'unknown';
    const rows = await sql`
        INSERT INTO tnt_tommy_rate (ip, n) VALUES (${ip}, 1)
        ON CONFLICT (ip) DO UPDATE SET
            n     = CASE WHEN tnt_tommy_rate.since < now() - interval '1 minute' THEN 1
                         ELSE tnt_tommy_rate.n + 1 END,
            since = CASE WHEN tnt_tommy_rate.since < now() - interval '1 minute' THEN now()
                         ELSE tnt_tommy_rate.since END
        RETURNING n`;
    return Number(rows[0]?.n ?? 0) > RATE_PER_MINUTE;
}

/**
 * The request body, or null if it is not JSON. Vercel parses `req.body` lazily
 * and its getter throws on a malformed JSON body, which must be a 400, not a 500.
 */
function readBody(req) {
    try {
        const body = req.body;
        return typeof body === 'string' ? JSON.parse(body) : body;
    } catch {
        return null;
    }
}

function reply(res, code, body) {
    res.status(code).json({ season: SEASON, ...body });
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const url = connectionString();
    if (!url) {
        reply(res, 503, { ok: false, board: [], error: 'leaderboard store is not configured' });
        return;
    }

    try {
        const sql = await database(url);

        if (req.method === 'GET') {
            reply(res, 200, { ok: true, board: await board(sql) });
            return;
        }

        if (req.method === 'POST') {
            const result = validateSubmission(readBody(req));
            if (result.error !== undefined) {
                reply(res, 400, { ok: false, board: [], error: result.error });
                return;
            }
            if (await throttled(sql, req)) {
                reply(res, 429, { ok: false, board: [], error: 'too many submissions' });
                return;
            }

            const { name, score, mine, seconds, won } = result.entry;
            // One row per miner, replaced only by a better run.
            const improved = await sql`
                INSERT INTO tnt_tommy_scores (season, name, score, mine, seconds, won)
                VALUES (${SEASON}, ${name}, ${score}, ${mine}, ${seconds}, ${won})
                ON CONFLICT (season, name) DO UPDATE SET
                    score = EXCLUDED.score, mine = EXCLUDED.mine, seconds = EXCLUDED.seconds,
                    won = EXCLUDED.won, updated_at = now()
                WHERE tnt_tommy_scores.score < EXCLUDED.score
                RETURNING name`;
            const ahead = await sql`
                SELECT count(*)::int AS n FROM tnt_tommy_scores
                WHERE season = ${SEASON}
                  AND score > (SELECT score FROM tnt_tommy_scores
                               WHERE season = ${SEASON} AND name = ${name})`;

            reply(res, 200, {
                ok: true,
                improved: improved.length > 0,
                rank: Number(ahead[0]?.n ?? 0) + 1,
                board: await board(sql)
            });
            return;
        }

        res.setHeader('Allow', 'GET, POST');
        reply(res, 405, { ok: false, board: [], error: 'method not allowed' });
    } catch (err) {
        console.error('[scores]', err);
        reply(res, 500, { ok: false, board: [], error: 'leaderboard unavailable' });
    }
}
