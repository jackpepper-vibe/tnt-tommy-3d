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
 * does permit are left out. So the bias is one-directional and useful:
 *
 *   - "reachable" is a guarantee
 *   - "unreachable" is a prompt to go and look, not a proof
 *
 * The alternative bias — modelling the jump arc generously — makes the pass
 * silently useless, because it would clear rooms that are genuinely broken.
 *
 * WHAT IS MODELLED CONSERVATIVELY
 * -------------------------------
 * The jump reaches `JUMP_ROWS` up, derived from `C.JUMP_APEX`, and only
 * `JUMP_REACH` columns sideways. The real arc carries much further — a full
 * hop is over five tiles of ground — but a landing spot the search is not sure
 * about is one it should not claim. Falls are unlimited, because nothing in
 * this game dies of one; only where they *land* matters.
 */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Tiles, World, Paint } = TNT;
const T = C.Tile;

/** Stances the search tracks. Ground includes standing on a one-way plank. */
const GROUND = 0, CLIMB = 1, ROPE = 2;

/** Rows a jump clears, derived from the apex rather than assumed. */
const JUMP_ROWS = Math.floor(C.JUMP_APEX / C.TILE);
/** Rows a trampoline clears. */
const TRAMP_ROWS = Math.floor(C.TRAMP_APEX / C.TILE);
/**
 * Columns a jump is *credited* with covering. The real arc reaches over five,
 * but claiming that would have the pass approving ledges it cannot be sure of.
 */
const JUMP_REACH = 2;

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

/**
 * Rooms whose lever has been reached, so their gates count as open.
 *
 * Gates make reachability a fixed point rather than a single search: explore
 * with every gate shut, open the gates of every room whose lever was reached,
 * and explore again — until a pass opens nothing new. A gate whose lever is
 * only reachable from behind the gate stays shut for ever, which is exactly
 * the bug this is here to catch.
 */
let openGates = new Set();

function open(room, tx, ty) {
    if (tx < 0 || tx >= C.COLS || ty < 0 || ty >= C.ROWS) return false;
    const t = room.get(tx, ty);
    if (t === T.LAVA) return false;
    if (t === T.CRACKED) return withBlast;
    if (t === T.GATE) return openGates.has(room.index);
    return !Tiles.isSolid(t);
}

/** Explore to a fixed point over the levers. */
function exploreWithGates(mine) {
    openGates = new Set();
    for (;;) {
        const seen = explore(mine);
        let grew = false;
        for (const room of mine.rooms) {
            if (openGates.has(room.index)) continue;
            for (const s of room.spawns) {
                if (s.kind === 'lever' && reached(seen, room.index, s.tx, s.ty)) {
                    openGates.add(room.index);
                    grew = true;
                }
            }
        }
        if (!grew) return seen;
    }
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

/**
 * The pad paired with this one, if any.
 *
 * Pairing is by reading order, exactly as `Entities.pairWarps` does it. Two
 * implementations of the same rule is a smell, but the alternative is the
 * validator importing the entity layer, and this pass is supposed to be able to
 * check a room without instantiating one.
 */
function warpPartners(room, tx, ty) {
    const pads = [];
    for (let y = 0; y < C.ROWS; y++) {
        for (let x = 0; x < C.COLS; x++) {
            if (room.get(x, y) === T.TELEPORT) pads.push([x, y]);
        }
    }
    if (pads.length % 2 !== 0) return [];
    for (let i = 0; i < pads.length; i += 2) {
        if (pads[i][0] === tx && pads[i][1] === ty) return [pads[i + 1]];
        if (pads[i + 1][0] === tx && pads[i + 1][1] === ty) return [pads[i]];
    }
    return [];
}

/** Rows of lift above a fan standing at (tx, ty), as `Machines.Fan` measures it. */
function fanRows(room, tx, ty) {
    let top = ty;
    while (top > 1 && ty - top < C.FAN_ROWS && !Tiles.isSolid(room.get(tx, top - 1))) top--;
    // The rider hovers a row or two under the top, so credit a little less.
    return Math.max(JUMP_ROWS, ty - top - 2);
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
        while (y + 1 < C.ROWS) {
            if (!open(room, tx, y + 1)) break;
            if (Tiles.isFloor(room.get(tx, y + 1))) break;
            y++;
        }
        if (y + 1 >= C.ROWS) return -1;               // out through the floor
        if (!footing(room, tx, y)) return -1;
        const landed = room.get(tx, y);
        if (landed === T.LAVA || landed === T.SPIKE) return -1;
        return y;
    };

    /**
     * Everywhere a hop from `(tx, ty)` can put you.
     *
     * Straight up first, then sideways at each height, and the column has to be
     * clear the whole way — a ledge under a ceiling is not reachable however
     * close it is. Landing on a hazard does not count as arriving.
     */
    const hops = (roomIdx, tx, ty, height) => {
        const room = mine.rooms[roomIdx];
        const out = [];

        for (let h = 1; h <= height; h++) {
            if (!open(room, tx, ty - h)) break;            // head hits something
            for (let dx = -JUMP_REACH; dx <= JUMP_REACH; dx++) {
                const nx = tx + dx;
                const ny = ty - h;
                if (!open(room, nx, ny)) continue;
                // The horizontal leg has to be clear too.
                let clear = true;
                for (let s = 1; s <= Math.abs(dx); s++) {
                    if (!open(room, tx + Math.sign(dx) * s, ny)) { clear = false; break; }
                }
                if (!clear) continue;

                const here = room.get(nx, ny);
                if (here === T.SPIKE) continue;
                if (footing(room, nx, ny)) out.push([nx, ny]);
                else {
                    const land = drop(roomIdx, nx, ny);
                    if (land >= 0) out.push([nx, land]);
                }
            }
        }
        return out;
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
            /*
             * Mounting a ladder from the ground.
             *
             * Three cells count, and the one above matters most: `World` lays
             * the shaft links as short stubs near the seam, so the bottom rung
             * of an up-shaft usually sits one row *above* the deck you are
             * standing on. `Player._climbColumnNear` finds it because it tests
             * the whole body, not just the feet. Checking only the current row
             * here made every room beyond the first band look unreachable.
             */
            for (const dx of [-1, 0, 1]) {
                for (const dy of [0, -1]) {
                    if (climbable(room, tx + dx, ty + dy)) push(roomIdx, tx + dx, ty + dy, CLIMB);
                }
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

            // Jumping — the main verb, and the reason the decks are three rows
            // apart. A trampoline underfoot launches more than twice as far.
            // A fan's column carries you up it; model it as a launch of the
            // column's height, like a trampoline — see `Machines.Fan`.
            const height = room.get(tx, ty + 1) === T.TRAMPOLINE ? TRAMP_ROWS
                : room.get(tx, ty) === T.FAN ? fanRows(room, tx, ty) : JUMP_ROWS;
            for (const [nx, ny] of hops(roomIdx, tx, ty, height)) {
                push(roomIdx, nx, ny, GROUND);
            }

            // Warp pads pair within the room; standing on one and pressing Down
            // is a move like any other.
            if (room.get(tx, ty) === T.TELEPORT) {
                for (const [px, py] of warpPartners(room, tx, ty)) {
                    push(roomIdx, px, py, GROUND);
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

/** Things a run cannot be completed without — the Governor's valves included. */
const REQUIRED = new Set(['tnt', 'oxygen', 'valve']);
/**
 * Secrets. Optional to collect, but a cog nobody can reach is a promise the
 * dog makes and the game breaks, so an unreachable one fails the pass.
 */
const SECRET = new Set(['cog']);
/** Things it is merely a shame to lose. */
const OPTIONAL = new Set(['ore', 'food', 'heart']);

function validate(mine) {
    console.log('\n' + mine.name);

    withBlast = false;
    const onFoot = exploreWithGates(mine);
    withBlast = true;
    const seen = exploreWithGates(mine);
    withBlast = false;

    let required = 0, optional = 0, lostRequired = 0, lostOptional = 0;
    const stranded = [];
    const behindFissure = [];

    for (const room of mine.rooms) {
        const misses = [];

        for (const s of room.spawns) {
            if (SECRET.has(s.kind)) {
                if (!reached(seen, room.index, s.tx, s.ty)) {
                    lostRequired++;
                    misses.push(`secret ${s.kind} at (${s.tx},${s.ty})`);
                }
            } else if (REQUIRED.has(s.kind)) {
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
console.log(`jump ${JUMP_ROWS} rows · trampoline ${TRAMP_ROWS} · ` +
            `credited with ${JUMP_REACH} columns of reach · falls never fatal\n`);

for (let i = 0; i < C.MINE_COUNT; i++) {
    validate(new World.Mine(i));
}

console.log('');
if (problems) {
    console.log(`${problems} room(s) have unreachable required content\n`);
    process.exit(1);
}
console.log(`every mine is completable${warnings ? ' (with notes above)' : ''}\n`);
