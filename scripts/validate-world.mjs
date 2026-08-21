/**
 * TNT Tommy — reachability validator.
 *
 * Walks all three mines the way the player has to and proves that every stick
 * of dynamite, every one-off pickup and every plunger can actually be got to.
 *
 * WHY THIS EXISTS
 * ---------------
 * Take the jump out of a platformer and connectivity stops being obvious. In a
 * game with a jump, a ledge one tile too high is a slightly awkward hop; here
 * it is a wall, and the room still looks completely fine in a screenshot. Two
 * thirds of the rooms in this game are machine-remixed as well, so nobody has
 * ever looked at them. A run that cannot be finished is the worst bug this
 * project can ship and the most expensive one to find by playing.
 *
 * THE MODEL
 * ---------
 * A breadth-first search over `(room, tx, ty, stance)`, using the same
 * constants the real player does. It is deliberately **conservative**: every
 * move it allows is one the physics definitely permits, and several the physics
 * does permit are left out — notably steering a fall sideways, which real
 * players do constantly. So the bias is one-directional and useful:
 *
 *   - "reachable" is a guarantee
 *   - "unreachable" is a prompt to go and look, not a proof
 *
 * The alternative bias — modelling air steering generously — makes the pass
 * silently useless, because it would clear rooms that are genuinely broken.
 */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Tiles, World, Paint } = TNT;
const T = C.Tile;

/** Stances the search tracks. Ground includes standing on a one-way plank. */
const GROUND = 0, CLIMB = 1, ROPE = 2;

/** How far a fall may go before it kills, in tiles. Derived, not guessed. */
const FATAL_TILES = Math.ceil((C.FALL_FATAL * C.FALL_FATAL) / (2 * C.GRAVITY * C.TILE));

let problems = 0;
let warnings = 0;

/* ------------------------------------------------------------------ *
 * Tile helpers
 * ------------------------------------------------------------------ */

/**
 * Can a body occupy this cell?
 *
 * `withBlast` decides whether fissured rock counts as open. The pass is run
 * both ways: sealed, to find what a player can reach on foot, and opened, to
 * find what a stick of dynamite unlocks. Anything only in the second set is
 * *meant* to be behind a fissure — that is what the mechanic is for — so
 * reporting it as stranded would be wrong, and reporting nothing at all would
 * hide a fissure nobody can get to in order to blow.
 */
let withBlast = false;

function open(room, tx, ty) {
    if (tx < 0 || tx >= C.COLS || ty < 0 || ty >= C.ROWS) return false;
    const t = room.get(tx, ty);
    if (t === T.LAVA) return false;
    if (t === T.CRACKED) return withBlast;
    return !Tiles.isSolid(t);
}

/** Is there something to stand on directly under this cell? */
function footing(room, tx, ty) {
    return Tiles.isFloor(room.get(tx, ty + 1));
}

function climbable(room, tx, ty) {
    return open(room, tx, ty) && Tiles.isClimbable(room.get(tx, ty));
}

function isRope(room, tx, ty) {
    return room.get(tx, ty) === T.ROPE;
}

/* ------------------------------------------------------------------ *
 * Lifts
 * ------------------------------------------------------------------ */

/**
 * Where a lift can put you.
 *
 * A lift is not in the tile array, so the search would walk straight past every
 * crossing that depends on one — which in Copperlode is the whole left half of
 * the Long Drift. Each lift contributes a set of *boarding cells*: every cell
 * along its run that a body can occupy with the platform under it. Riding is
 * modelled as free movement between any two of them, which is exactly what
 * waiting for the platform gets you.
 */
function liftCells(room) {
    const runs = [];
    const marks = { h: new Map(), v: new Map() };

    for (const s of room.spawns) {
        if (s.kind === 'liftH') {
            if (!marks.h.has(s.ty)) marks.h.set(s.ty, []);
            marks.h.get(s.ty).push(s.tx);
        } else if (s.kind === 'liftV') {
            if (!marks.v.has(s.tx)) marks.v.set(s.tx, []);
            marks.v.get(s.tx).push(s.ty);
        }
    }

    for (const [ty, xs] of marks.h) {
        xs.sort((a, b) => a - b);
        const cells = [];
        for (let tx = xs[0]; tx <= xs[xs.length - 1] + C.LIFT_W - 1; tx++) {
            if (open(room, tx, ty)) cells.push([tx, ty]);
        }
        if (cells.length) runs.push(cells);
    }

    for (const [tx, ys] of marks.v) {
        ys.sort((a, b) => a - b);
        const cells = [];
        for (let ty = ys[0]; ty <= ys[ys.length - 1]; ty++) {
            for (let x = tx; x < tx + C.LIFT_W; x++) {
                if (open(room, x, ty)) cells.push([x, ty]);
            }
        }
        if (cells.length) runs.push(cells);
    }

    return runs;
}

/* ------------------------------------------------------------------ *
 * The search
 * ------------------------------------------------------------------ */

function key(room, tx, ty, stance) {
    return ((room * C.ROWS + ty) * C.COLS + tx) * 3 + stance;
}

function explore(mine) {
    const seen = new Set();
    const queue = [];
    const liftRuns = mine.rooms.map(liftCells);

    const push = (room, tx, ty, stance) => {
        if (tx < 0 || tx >= C.COLS || ty < 0 || ty >= C.ROWS) return;
        const k = key(room, tx, ty, stance);
        if (seen.has(k)) return;
        seen.add(k);
        queue.push([room, tx, ty, stance]);
    };

    /**
     * Fall from a cell until something stops it. Returns the landing row, or -1
     * if the fall kills, leaves the room, or ends on something that hurts.
     *
     * A ladder column bleeds the speed off — `C.SLIDE_V` — so the accumulated
     * distance resets while passing through one. That is the difference between
     * a shaft being a route and being a hole, and the game agrees: see
     * `Player._walk`.
     */
    const drop = (roomIdx, tx, ty) => {
        const room = mine.rooms[roomIdx];
        let y = ty;
        let travelled = 0;
        while (y + 1 < C.ROWS) {
            if (!open(room, tx, y + 1)) break;
            if (Tiles.isFloor(room.get(tx, y + 1))) break;
            y++;
            travelled = climbable(room, tx, y) ? 0 : travelled + 1;
            if (travelled > FATAL_TILES) return -1;
        }
        if (y + 1 >= C.ROWS) return -1;               // out through the floor
        if (!footing(room, tx, y)) return -1;
        const landed = room.get(tx, y);
        if (landed === T.LAVA || landed === T.SPIKE) return -1;
        return y;
    };

    const start = mine.rooms[mine.spawnRoom];
    push(mine.spawnRoom, Math.floor(mine.spawnX / C.TILE),
         Math.floor((mine.spawnY - 1) / C.TILE), GROUND);
    void start;

    while (queue.length) {
        const [roomIdx, tx, ty, stance] = queue.shift();
        const room = mine.rooms[roomIdx];

        /* ---- leaving the room ---- */
        if (stance === GROUND && Paint.DOOR_ROWS.indexOf(ty) >= 0) {
            if (tx <= 1 && room.neighbours.left >= 0) push(room.neighbours.left, C.COLS - 2, ty, GROUND);
            if (tx >= C.COLS - 2 && room.neighbours.right >= 0) push(room.neighbours.right, 1, ty, GROUND);
        }
        if (stance === CLIMB && Paint.SHAFT_COLS.indexOf(tx) >= 0) {
            if (ty <= 1 && room.neighbours.up >= 0) push(room.neighbours.up, tx, C.ROWS - 2, CLIMB);
            if (ty >= C.ROWS - 2 && room.neighbours.down >= 0) push(room.neighbours.down, tx, 1, CLIMB);
        }

        /* ---- mounting ---- */
        if (climbable(room, tx, ty)) push(roomIdx, tx, ty, CLIMB);
        if (isRope(room, tx, ty) && stance !== GROUND) push(roomIdx, tx, ty, ROPE);

        if (stance === GROUND) {
            // A ladder in the *next* column over is close enough to grab —
            // `Player._climbColumnNear` searches one either side. Rooms rely on
            // this: the shaft ladder is often reachable only from the lip of
            // the floor beside it.
            for (const dx of [-1, 1]) {
                if (climbable(room, tx + dx, ty)) push(roomIdx, tx + dx, ty, CLIMB);
            }
        }

        if (stance === GROUND) {
            // Down onto a ladder head directly below.
            if (room.isClimbTop(tx, ty + 1)) push(roomIdx, tx, ty + 1, CLIMB);

            // Down through a one-way plank.
            if (Tiles.isOneWay(room.get(tx, ty + 1))) {
                const land = drop(roomIdx, ty + 1 < C.ROWS ? tx : tx, ty + 1);
                if (land >= 0) push(roomIdx, tx, land, GROUND);
            }

            // Sideways onto a rope crossing this row.
            for (const dx of [-1, 1]) {
                if (isRope(room, tx + dx, ty)) push(roomIdx, tx + dx, ty, ROPE);
            }

            // Walking, and walking off the end of things.
            for (const dx of [-1, 1]) {
                const nx = tx + dx;
                if (!open(room, nx, ty)) continue;
                if (footing(room, nx, ty)) {
                    push(roomIdx, nx, ty, GROUND);
                } else {
                    const land = drop(roomIdx, nx, ty);
                    if (land >= 0) push(roomIdx, nx, land, GROUND);
                }
            }
        }

        if (stance === CLIMB) {
            if (climbable(room, tx, ty - 1)) push(roomIdx, tx, ty - 1, CLIMB);
            if (climbable(room, tx, ty + 1)) push(roomIdx, tx, ty + 1, CLIMB);

            // Off the top: the ladder head is one row above the deck it serves,
            // so leaving it drops one tile onto the boards.
            if (!climbable(room, tx, ty - 1) && footing(room, tx, ty)) {
                push(roomIdx, tx, ty, GROUND);
            }
            // Off the bottom, onto whatever the ladder stands on.
            if (footing(room, tx, ty)) push(roomIdx, tx, ty, GROUND);

            // Sideways, onto a rope or onto a floor beside the ladder.
            for (const dx of [-1, 1]) {
                const nx = tx + dx;
                if (isRope(room, nx, ty)) push(roomIdx, nx, ty, ROPE);
                if (open(room, nx, ty) && footing(room, nx, ty)) push(roomIdx, nx, ty, GROUND);
            }
        }

        if (stance === ROPE) {
            for (const dx of [-1, 1]) {
                const nx = tx + dx;
                if (isRope(room, nx, ty) || climbable(room, nx, ty)) {
                    push(roomIdx, nx, ty, isRope(room, nx, ty) ? ROPE : CLIMB);
                }
            }
            // Letting go. Tommy hangs a body below the line, so the fall starts
            // from the row beneath it.
            const land = drop(roomIdx, tx, ty + 1);
            if (land >= 0) push(roomIdx, tx, land, GROUND);
        }

        /* ---- riding ---- */
        for (const run of liftRuns[roomIdx]) {
            let onIt = false;
            for (const [cx, cy] of run) {
                if (cx === tx && cy === ty) { onIt = true; break; }
            }
            if (!onIt) continue;
            for (const [cx, cy] of run) push(roomIdx, cx, cy, GROUND);
        }
    }

    return seen;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

/** A cell counts as reached if any stance got there, or an adjacent one did. */
function reached(seen, roomIdx, tx, ty) {
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let s = 0; s < 3; s++) {
                if (seen.has(key(roomIdx, tx + dx, ty + dy, s))) return true;
            }
        }
    }
    return false;
}

/** Things a run cannot be completed without. */
const REQUIRED = new Set(['tnt', 'oxygen']);
/** Things it is merely a shame to lose. */
const OPTIONAL = new Set(['ore', 'food', 'heart']);

function validate(mine) {
    console.log('\n' + mine.name);

    withBlast = false;
    const onFoot = explore(mine);
    withBlast = true;
    const seen = explore(mine);
    withBlast = false;

    let required = 0, optional = 0, lostRequired = 0, lostOptional = 0;
    const stranded = [];
    const behindFissure = [];

    for (const room of mine.rooms) {
        const misses = [];

        for (const s of room.spawns) {
            if (REQUIRED.has(s.kind)) {
                required++;
                if (!reached(seen, room.index, s.tx, s.ty)) {
                    lostRequired++;
                    misses.push(`${s.kind} at (${s.tx},${s.ty})`);
                }
            } else if (OPTIONAL.has(s.kind)) {
                optional++;
                if (!reached(seen, room.index, s.tx, s.ty)) {
                    lostOptional++;
                    stranded.push(`${room.name}: ${s.kind} (${s.tx},${s.ty})`);
                } else if (!reached(onFoot, room.index, s.tx, s.ty)) {
                    behindFissure.push(`${room.name}: ${s.kind} (${s.tx},${s.ty})`);
                }
            }
        }

        // The plunger, wherever it is.
        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                if (room.get(tx, ty) !== T.DETONATOR) continue;
                if (!reached(seen, room.index, tx, ty)) {
                    lostRequired++;
                    misses.push(`the plunger at (${tx},${ty})`);
                }
            }
        }

        if (misses.length) {
            problems++;
            console.log(`  UNREACHABLE  ${room.name}: ${misses.join(', ')}`);
        }
    }

    if (behindFissure.length) {
        console.log(`  blast-gated  ${behindFissure.length} pickup(s) sealed behind fissured rock, as intended:`);
        for (const s of behindFissure) console.log(`                 ${s}`);
    }
    if (lostOptional) {
        warnings++;
        console.log(`  note         ${lostOptional} of ${optional} optional pickups out of reach ` +
                    `(costs score, not the run):`);
        for (const s of stranded) console.log(`                 ${s}`);
    }
    if (!problems) {
        console.log(`  ok           ${required - lostRequired}/${required} required pickups ` +
                    `and every plunger reachable`);
    }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

console.log('\nTNT Tommy — reachability');
console.log(`no jump · fatal fall at ${FATAL_TILES} tiles · falls modelled straight down\n`);

for (let i = 0; i < C.MINE_COUNT; i++) {
    validate(new World.Mine(i));
}

console.log('');
if (problems) {
    console.log(`${problems} room(s) have unreachable required content\n`);
    process.exit(1);
}
console.log(`every mine is completable${warnings ? ' (with notes above)' : ''}\n`);
