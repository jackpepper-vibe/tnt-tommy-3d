/**
 * TNT Tommy — simulation smoke test.
 *
 * Runs the whole game with no browser and no renderer: builds all three mines,
 * drives the player with synthetic input, and asserts on what the rules did.
 *
 * This exists because the things most likely to break here do not show up in a
 * screenshot. A ladder you cannot dismount, a rope that drops you, a respawn
 * that resurrects a collected stick, a room transition that puts you inside a
 * wall — all of them render perfectly.
 *
 *   node scripts/smoke.mjs
 */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Run, Input, Tiles } = TNT;

let passed = 0;
const failures = [];

function check(name, fn) {
    try {
        const detail = fn();
        passed++;
        console.log('  ok   ' + name + (detail ? '  — ' + detail : ''));
    } catch (err) {
        failures.push(name + ': ' + err.message);
        console.log('  FAIL ' + name + ' — ' + err.message);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

/** A run with a scriptable input, stepped by hand. */
function harness() {
    const run = new Run();
    const input = new Input();
    run.startRun();
    return {
        run: run,
        input: input,
        hold: function (actions) {
            for (const a in input.held) input.held[a] = false;
            for (const a of actions || []) input.held[a] = true;
        },
        tap: function (action) {
            input.held[action] = true;
            input.pressed[action] = true;
        },
        step: function (n) {
            for (let i = 0; i < (n || 1); i++) {
                run.update(C.FIXED_DT, input);
                input.endStep();
            }
        },
        seconds: function (s, actions) {
            this.hold(actions);
            this.step(Math.round(s / C.FIXED_DT));
        }
    };
}

console.log('\nTNT Tommy — simulation smoke test\n');

/* ------------------------------------------------------------------ *
 * World
 * ------------------------------------------------------------------ */

console.log('world');

check('all three mines build', () => {
    const run = new Run();
    assert(run.mines.length === 3, 'expected 3 mines, got ' + run.mines.length);
    return run.mines.map(m => m.name).join(', ');
});

check('every mine holds exactly the sticks it asks for', () => {
    const run = new Run();
    for (const mine of run.mines) {
        assert(mine.tntTotal === C.TNT_PER_MINE,
            mine.id + ' has ' + mine.tntTotal + ' sticks, wanted ' + C.TNT_PER_MINE);
    }
    return C.TNT_PER_MINE + ' each';
});

check('every mine has a detonator, reachable room graph', () => {
    const run = new Run();
    for (const mine of run.mines) {
        const ents = TNT.Entities.forMine(mine);
        const dets = ents.filter(e => e.detonator).length;
        assert(dets === 1, mine.id + ' has ' + dets + ' detonators');

        // Flood the room graph from spawn; every room must be on it.
        const seen = new Set([mine.spawnRoom]);
        const queue = [mine.spawnRoom];
        while (queue.length) {
            const r = mine.rooms[queue.shift()];
            for (const dir in r.neighbours) {
                const n = r.neighbours[dir];
                if (n >= 0 && !seen.has(n)) { seen.add(n); queue.push(n); }
            }
        }
        assert(seen.size === mine.rooms.length,
            mine.id + ': only ' + seen.size + ' of ' + mine.rooms.length + ' rooms are connected');
    }
    return 'nine rooms connected in each';
});

check('doorways are open on both sides', () => {
    const run = new Run();
    let cut = 0;
    for (const mine of run.mines) {
        for (const room of mine.rooms) {
            if (room.exits.left) {
                assert(!Tiles.isSolid(room.get(0, C.ROWS - 2)),
                    mine.id + '/' + room.id + ': left doorway is walled');
                cut++;
            }
            if (room.exits.up) {
                assert(Tiles.isClimbable(room.get(C.COLS / 2 - 1, 0)),
                    mine.id + '/' + room.id + ': up shaft has no ladder in its mouth');
                cut++;
            }
        }
    }
    return cut + ' openings checked';
});

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

console.log('\nmovement');

check('Tommy walks, and stops when told to', () => {
    const h = harness();
    const x0 = h.run.player.x;
    h.seconds(0.7, ['right']);
    const moved = h.run.player.x - x0;
    assert(moved > 30, 'only moved ' + moved.toFixed(1) + 'px in 0.7s');
    h.seconds(0.5, []);
    assert(Math.abs(h.run.player.vx) < 1, 'still drifting at ' + h.run.player.vx.toFixed(1));
    return moved.toFixed(0) + 'px right, then stopped';
});

/**
 * The single most important assertion in the suite.
 *
 * Every one of the twenty-seven rooms is authored on a three-row deck grid, so
 * the jump has to clear three rows and miss four. Nudge `JUMP_V` or `GRAVITY`
 * and the traversal of the entire game changes silently — rooms stay perfectly
 * plausible in a screenshot while becoming either trivial or impossible.
 */
check('a jump clears three rows and misses four', () => {
    const h = harness();
    const p = h.run.player;
    const g = C.GRAVITY;

    const apex = C.JUMP_APEX;
    const three = 3 * C.TILE;
    const four = 4 * C.TILE;
    assert(apex > three, 'a jump only reaches ' + apex.toFixed(0) + 'px, short of three rows (' + three + ')');
    assert(apex < four, 'a jump reaches ' + apex.toFixed(0) + 'px, which clears four rows (' + four + ')');

    // And prove it in the simulation, not just on paper.
    p.placeAt(C.ROOM_W / 2, C.ROOM_H - C.TILE);
    h.seconds(0.1, []);
    const startY = p.y;
    let peak = startY;
    h.hold(['jump']);
    h.tap('jump');
    for (let i = 0; i < 90; i++) {
        h.step(1);
        peak = Math.min(peak, p.y);
    }
    const risen = startY - peak;
    assert(risen > three, 'held jump rose only ' + risen.toFixed(1) + 'px');
    assert(risen < four + 4, 'held jump rose ' + risen.toFixed(1) + 'px, past four rows');
    void g;
    return 'apex ' + apex.toFixed(0) + 'px, measured ' + risen.toFixed(0) + 'px (3 rows = ' + three + ', 4 = ' + four + ')';
});

check('a tapped jump is shorter than a held one', () => {
    const h = harness();
    const p = h.run.player;

    const rise = (holdSteps) => {
        p.placeAt(C.ROOM_W / 2, C.ROOM_H - C.TILE);
        p.vy = 0;
        h.seconds(0.1, []);
        const start = p.y;
        let peak = start;
        h.hold(['jump']);
        h.tap('jump');
        for (let i = 0; i < 90; i++) {
            if (i === holdSteps) h.hold([]);
            h.step(1);
            peak = Math.min(peak, p.y);
        }
        return start - peak;
    };

    const tapped = rise(6);
    const held = rise(90);
    assert(tapped < held - 6,
        'a tap rose ' + tapped.toFixed(1) + 'px and a hold ' + held.toFixed(1) + 'px — no variable height');
    return 'tap ' + tapped.toFixed(0) + 'px vs hold ' + held.toFixed(0) + 'px';
});

check('coyote time lets you jump just after a ledge', () => {
    const h = harness();
    const p = h.run.player;
    // Step off into open air, then jump a frame later.
    p.placeAt(C.ROOM_W / 2, C.ROOM_H - C.TILE);
    h.seconds(0.1, []);
    p.onGround = false;
    p.coyote = C.COYOTE_TIME;
    const startY = p.y;
    h.hold(['jump']);
    h.tap('jump');
    h.step(4);
    assert(p.vy < 0, 'coyote jump did not fire (vy ' + p.vy.toFixed(0) + ')');
    void startY;
    return 'fired ' + (C.COYOTE_TIME * 1000).toFixed(0) + 'ms after leaving the ground';
});

/**
 * Find a ladder that stands on the floor, and Tommy's position at its foot.
 * Locating it from the room data rather than walking to a remembered column
 * means the check tests the mechanic, not the author's memory of the level.
 */
function ladderFoot(room) {
    for (let tx = 2; tx < C.COLS - 2; tx++) {
        for (let ty = C.ROWS - 2; ty > 2; ty--) {
            if (!Tiles.isClimbable(room.get(tx, ty))) continue;
            if (Tiles.isClimbable(room.get(tx, ty + 1))) continue;   // not the foot
            let top = ty;
            while (top > 1 && Tiles.isClimbable(room.get(tx, top - 1))) top--;
            if (ty - top < 3) break;                                  // too short to test
            return { tx: tx, top: top, x: tx * C.TILE + C.TILE / 2, y: (ty + 1) * C.TILE };
        }
    }
    return null;
}

check('a ladder can be climbed and dismounted', () => {
    const h = harness();
    const p = h.run.player;
    const foot = ladderFoot(h.run.room());
    assert(foot, 'the opening room has no floor-standing ladder to test with');

    p.placeAt(foot.x, foot.y);
    h.seconds(0.1, []);
    const yBefore = p.y;

    h.seconds(2.5, ['up']);
    assert(p.mode === 'climb' || p.y < yBefore - C.TILE * 2,
        'never got onto the ladder at column ' + foot.tx);
    assert(p.y < yBefore - C.TILE * 2, 'climbed only ' + (yBefore - p.y).toFixed(1) + 'px');
    const yTop = p.y;

    // Off the top, either way — a ladder you can only climb is half a ladder.
    h.seconds(0.8, ['right']);
    if (p.mode === 'climb') h.seconds(0.8, ['left']);
    assert(p.mode !== 'climb', 'could not step off at the top');
    assert(p.y < yBefore - C.TILE, 'ended up back at the bottom (y ' + p.y.toFixed(0) + ')');
    return 'climbed ' + (yBefore - yTop).toFixed(0) + 'px at column ' + foot.tx + ' and stepped off';
});

check('a ladder can be remounted from above', () => {
    const h = harness();
    const p = h.run.player;
    const foot = ladderFoot(h.run.room());
    assert(foot, 'no ladder');

    // Stand on the cap and press Down. Without this, every ladder in the mine
    // is a one-way street.
    p.placeAt(foot.x, foot.top * C.TILE);
    h.seconds(0.2, []);
    const yTop = p.y;
    h.seconds(1.5, ['down']);
    assert(p.y > yTop + C.TILE, 'pressing Down on the ladder head went nowhere');
    return 'descended ' + (p.y - yTop).toFixed(0) + 'px from the cap';
});

/**
 * A ladder passing a deck part-way up, and Left or Right stepping onto it.
 *
 * The two checks above cover the foot and the cap, which is why this went
 * unnoticed: Left and Right were read only inside the jump branch, so while
 * climbing they did nothing at all and the only ways off a ladder were its two
 * ends. There are 79 landings like this in the mine, so "you have to go all the
 * way to the top" was most of the climbing in the game.
 */
function midLadderLanding(mine) {
    for (let ri = 0; ri < mine.rooms.length; ri++) {
        const r = mine.rooms[ri];
        for (let tx = 2; tx < C.COLS - 2; tx++) {
            for (let ty = 4; ty < C.ROWS - 3; ty++) {
                // Three rungs of headroom, so a climb test has somewhere to go.
                if (!Tiles.isClimbable(r.get(tx, ty))) continue;
                if (!Tiles.isClimbable(r.get(tx, ty + 1))) continue;
                if (!Tiles.isClimbable(r.get(tx, ty - 1)) ||
                    !Tiles.isClimbable(r.get(tx, ty - 2)) ||
                    !Tiles.isClimbable(r.get(tx, ty - 3))) continue;
                for (const dir of [1, -1]) {
                    const d = tx + dir;
                    if (Tiles.isFloor(r.get(d, ty + 1)) && !Tiles.isSolid(r.get(d, ty))) {
                        return { tx: tx, ty: ty, dir: dir, room: ri, id: r.id };
                    }
                }
            }
        }
    }
    return null;
}

check('a ladder can be stepped off at a deck part-way up', () => {
    const h = harness();
    const p = h.run.player;
    const spot = midLadderLanding(h.run.mine);
    assert(spot, 'no ladder in mine 1 runs past a deck');

    h.run.roomIndex = spot.room;
    p.placeAt(spot.tx * C.TILE + C.TILE / 2, (spot.ty + 1) * C.TILE);
    p.mode = 'climb';
    p.climbCol = spot.tx;

    // Long enough for the step-off to fire, short enough not to walk off the
    // far end of a two-tile deck and fail for the wrong reason.
    h.seconds(0.1, [spot.dir > 0 ? 'right' : 'left']);
    assert(p.mode !== 'climb', 'still on the ladder after a tenth of a second of ' +
        (spot.dir > 0 ? 'Right' : 'Left'));
    assert(Math.floor(p.x / C.TILE) !== spot.tx, 'let go but never left the column');
    assert(p.onGround, 'stepped off into thin air rather than onto the deck');
    return spot.id + ' col ' + spot.tx + ', stepped ' + (spot.dir > 0 ? 'right' : 'left');
});

/**
 * A stick underwater needs an air tank in the same mine.
 *
 * This exists because it broke silently. `ladder()` lays a rung one row above
 * its own platform and, unlike `put()`, overwrites whatever is there without
 * complaining — so an oxygen pickup placed on that tile simply vanished, and
 * the room kept its submerged stick with no way to breathe. Every other check
 * passed: the grid was well formed, and the reachability walk does not model
 * the tank, so it called the mine completable.
 */
check('every submerged stick has an air tank in its mine', () => {
    const notes = [];
    for (let m = 0; m < 3; m++) {
        const mine = new TNT.World.Mine(m);
        let submerged = 0;
        let tanks = 0;
        for (const room of mine.rooms) {
            for (const s of room.spawns) {
                if (s.kind === 'oxygen') tanks++;
                if (s.kind !== 'tnt') continue;
                // Under water if there is water directly above the stick.
                if (room.get(s.tx, s.ty - 1) === C.Tile.WATER) submerged++;
            }
        }
        if (submerged > 0) {
            assert(tanks > 0, 'mine ' + (m + 1) + ' has ' + submerged +
                ' submerged stick(s) and no oxygen pickup anywhere in it');
            notes.push('mine ' + (m + 1) + ': ' + submerged + ' submerged, ' + tanks + ' tank(s)');
        }
    }
    assert(notes.length, 'no mine has a submerged stick to check');
    return notes.join('; ');
});

/**
 * Stomping. Both halves matter equally: landing on an enemy has to kill it,
 * and walking into one has to still cost you — a stomp test that only proves
 * the kill would pass just as happily if every touch killed.
 */
check('landing on an enemy kills it and bounces you', () => {
    const h = harness();
    const p = h.run.player;

    // Whichever room the run starts in, find a room with an enemy in it.
    let ents = h.run.ents();
    for (let i = 0; i < h.run.mine.rooms.length && !ents.enemies.length; i++) {
        h.run.roomIndex = i;
        h.seconds(0.05, []);
        ents = h.run.ents();
    }
    assert(ents && ents.enemies.length, 'no room in mine 1 has an enemy to land on');

    const e = ents.enemies[0];
    const b = e.box();
    const score0 = h.run.score;

    // Feet a quarter of its height above its centre — overlapping it, and
    // clearly coming down on the top of it.
    p.placeAt(b.x, b.y - b.h / 4);
    p.mode = 'walk';
    p.onGround = false;
    p.invuln = 0;
    p.vy = C.STOMP_MIN_V * 2;
    h.step(1);

    assert(e.dead, 'landed on a ' + e.kind + ' at full fall speed and it survived');
    assert(p.vy < 0, 'killed it but did not bounce (vy ' + p.vy.toFixed(0) + ')');
    assert(h.run.score > score0, 'a stomp scored nothing');
    return 'stomped a ' + e.kind + ' for ' + (h.run.score - score0);
});

check('walking into an enemy still costs energy', () => {
    const h = harness();
    const p = h.run.player;

    let ents = h.run.ents();
    for (let i = 0; i < h.run.mine.rooms.length && !ents.enemies.length; i++) {
        h.run.roomIndex = i;
        h.seconds(0.05, []);
        ents = h.run.ents();
    }
    assert(ents && ents.enemies.length, 'no enemy to walk into');

    const e = ents.enemies[0];
    const b = e.box();
    const energy0 = h.run.energy;

    // Level with it, moving sideways — not falling.
    p.placeAt(b.x, b.y + b.h / 2);
    p.mode = 'walk';
    p.onGround = true;
    p.invuln = 0;
    p.vy = 0;
    h.step(1);

    assert(!e.dead, 'a level walk into a ' + e.kind + ' killed it');
    assert(h.run.energy < energy0, 'walking into a ' + e.kind + ' cost nothing');
    return 'took ' + (energy0 - h.run.energy).toFixed(0) + ' from a ' + e.kind;
});

/**
 * The reach below the feet must not become a climb interrupter: holding Up
 * alone has to carry you past a deck, not drop you onto it.
 */
check('climbing past a deck does not let go of the ladder', () => {
    const h = harness();
    const p = h.run.player;
    const spot = midLadderLanding(h.run.mine);
    assert(spot, 'no ladder in mine 1 runs past a deck');

    h.run.roomIndex = spot.room;
    p.placeAt(spot.tx * C.TILE + C.TILE / 2, (spot.ty + 1) * C.TILE);
    p.mode = 'climb';
    p.climbCol = spot.tx;
    const y0 = p.y;

    h.seconds(0.3, ['up']);
    assert(p.mode === 'climb', 'let go of the ladder while climbing past a deck');
    assert(p.y < y0 - 4, 'held Up on a ladder and did not climb');
    return 'climbed ' + (y0 - p.y).toFixed(0) + 'px past the deck at row ' + (spot.ty + 1);
});

/**
 * Falling has to stay cheap. Punishing modest drops is what forced the wide
 * level grid that made the mine feel like ladders and empty air — so this
 * asserts the *generosity*, not the danger.
 */
/**
 * Falling is pitched at two decks free, three decks costly. Both halves matter:
 * free short drops keep a climbing frame quick to come down, and a costly long
 * one stops "throw yourself off the top" being strictly better than climbing.
 */
check('two decks fall free, three cost, none kill', () => {
    const g = C.GRAVITY;
    const impact = (rows) => Math.min(C.MAX_FALL, Math.sqrt(2 * g * rows * C.TILE));

    assert(impact(6) < C.FALL_SAFE,
        'a two-deck drop hurts (' + impact(6).toFixed(0) + ' >= ' + C.FALL_SAFE + ')');
    assert(impact(9) >= C.FALL_SAFE,
        'a three-deck drop is free (' + impact(9).toFixed(0) + ' < ' + C.FALL_SAFE + ')');
    assert(C.FALL_FATAL === undefined,
        'a fall can kill outright; neither original did that');
    return '6 rows ' + impact(6).toFixed(0) + 'px/s free · 9 rows ' +
        impact(9).toFixed(0) + 'px/s costs ' + C.FALL_DMG;
});

check('a trampoline goes higher than a jump can', () => {
    assert(C.TRAMP_APEX > C.JUMP_APEX * 1.6,
        'a bounce reaches ' + C.TRAMP_APEX.toFixed(0) + 'px against a jump\'s ' + C.JUMP_APEX.toFixed(0));
    assert(C.TRAMP_APEX > 6 * C.TILE,
        'a bounce clears only ' + (C.TRAMP_APEX / C.TILE).toFixed(1) + ' rows; it is meant to beat a ladder');
    return (C.TRAMP_APEX / C.TILE).toFixed(1) + ' rows vs a jump\'s ' + (C.JUMP_APEX / C.TILE).toFixed(1);
});

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

console.log('\nrules');

check('the fuse burns down and food puts it back', () => {
    const h = harness();
    const e0 = h.run.energy;
    h.seconds(4, []);
    assert(h.run.energy < e0, 'fuse did not burn');
    const burned = e0 - h.run.energy;
    const expect = 4 * C.ENERGY_MAX / (C.FUSE_SECONDS * h.run.mine.fuseMul);
    assert(Math.abs(burned - expect) < 0.5,
        'burned ' + burned.toFixed(2) + ', expected ' + expect.toFixed(2));
    return burned.toFixed(2) + '% in four seconds';
});

check('a spent stick comes back where it was found', () => {
    const h = harness();
    const run = h.run;
    const set = run.ents();
    const stick = set.pickups.find(p => p.kind === 'tnt');
    assert(stick, 'no stick in the opening room to test with');

    stick.take();
    run.tntHeld = 1;
    run.tntFound = 1;
    run.player.onGround = true;
    run._plant();
    assert(run.tntHeld === 0, 'planting did not spend the stick');
    assert(run.bombs.length === 1, 'no bomb was planted');

    h.seconds(C.BLAST_FUSE + 0.2, []);
    assert(run.bombs.length === 0, 'the bomb never went off');
    assert(!stick.taken, 'the spent stick did not come back');
    assert(run.tntFound === 0, 'tntFound is ' + run.tntFound + ', should be back to 0');
    return 'planted, detonated, returned';
});

check('a blast opens fissured rock and nothing else', () => {
    const run = new Run();
    run.startRun();
    // The Lamp Room is the one with a fissure in it.
    const idx = run.mine.rooms.findIndex(r => r.id === 'lampRoom');
    assert(idx >= 0, 'no lamp room');
    const room = run.mine.rooms[idx];

    let cracked = 0, rock = 0;
    for (let ty = 0; ty < C.ROWS; ty++) {
        for (let tx = 0; tx < C.COLS; tx++) {
            if (room.get(tx, ty) === C.Tile.CRACKED) cracked++;
            if (room.get(tx, ty) === C.Tile.ROCK) rock++;
        }
    }
    assert(cracked > 0, 'the lamp room has no fissure to blow');

    const target = [];
    for (let ty = 0; ty < C.ROWS; ty++) {
        for (let tx = 0; tx < C.COLS; tx++) {
            if (room.get(tx, ty) === C.Tile.CRACKED) target.push([tx, ty]);
        }
    }
    const [tx, ty] = target[0];
    run._spentStack.push({ taken: true, timer: 0 });
    run._detonate({ x: tx * C.TILE + 8, y: ty * C.TILE + 8, room: idx });

    let rockAfter = 0, crackedAfter = 0;
    for (let y = 0; y < C.ROWS; y++) {
        for (let x = 0; x < C.COLS; x++) {
            if (room.get(x, y) === C.Tile.ROCK) rockAfter++;
            if (room.get(x, y) === C.Tile.CRACKED) crackedAfter++;
        }
    }
    assert(rockAfter === rock, 'the blast took out ' + (rock - rockAfter) + ' tiles of solid rock');
    assert(crackedAfter < cracked, 'the blast opened nothing');
    return (cracked - crackedAfter) + ' of ' + cracked + ' fissure tiles opened, solid rock untouched';
});

check('respawning rewinds the machinery but not the score', () => {
    const h = harness();
    const run = h.run;
    const set = run.ents();
    const ore = set.pickups.find(p => p.kind === 'ore');
    assert(ore, 'no ore in the opening room');

    ore.take();
    run.score = 500;
    const lives = run.lives;

    run.energy = 0.0001;
    h.seconds(0.05, []);
    assert(run.state === 'dying', 'the fuse running out did not kill him (state ' + run.state + ')');
    h.seconds(C.DEATH_FREEZE + 0.1, []);

    assert(run.lives === lives - 1, 'lives went from ' + lives + ' to ' + run.lives);
    assert(run.state === 'playing', 'did not come back (state ' + run.state + ')');
    assert(ore.taken, 'the respawn resurrected already-collected ore');
    assert(run.energy > 90, 'the fuse was not refilled (' + run.energy.toFixed(1) + ')');
    return 'life spent, ore stayed collected, fuse refilled';
});

/**
 * Climbing a shaft out of a room, which is the only way to change floor.
 *
 * This is here because it was broken twice and reported twice. `Room.get`
 * answers ROCK for rows outside the room, so the instant a climber's feet
 * crossed row zero the ladder let go, he fell, re-grabbed and climbed again —
 * an invisible loop one pixel below the seam. Both earlier attempts went
 * looking at the level design, because from the outside it looks exactly like
 * a ladder that does not reach.
 */
check('an up-shaft carries you into the room above', () => {
    const h = harness();
    const run = h.run;
    const p = run.player;
    const col = TNT.Paint.SHAFT_COLS[0];

    // Find the foot of the shaft ladder and stand on it.
    const room = run.room();
    assert(room.exits.up, 'the opening room has no up exit to test');
    let foot = -1;
    for (let ty = 0; ty < C.ROWS; ty++) {
        if (Tiles.isClimbable(room.get(col, ty))) foot = ty;
    }
    assert(foot > 0, 'no shaft ladder in column ' + col);

    const start = run.roomIndex;
    p.reset(col * C.TILE + C.TILE / 2, (foot + 1) * C.TILE, true);
    h.seconds(0.1, []);
    h.tap('up');
    for (let i = 0; i < 12 && run.roomIndex === start; i++) h.seconds(0.25, ['up']);

    assert(run.roomIndex !== start,
        'climbed the shaft for three seconds and never left ' + room.id);
    assert(p.y > 0 && p.y < C.ROOM_H,
        'arrived outside the room above at y=' + p.y.toFixed(1));
    return room.id + ' → ' + run.room().id;
});

check('walking out of a doorway changes room', () => {
    const h = harness();
    const run = h.run;
    const start = run.roomIndex;
    // The opening room's right doorway is a straight walk along the floor.
    for (let i = 0; i < 40 && run.roomIndex === start; i++) {
        h.seconds(0.5, ['right']);
    }
    assert(run.roomIndex !== start, 'never left the opening room walking right');
    const p = run.player;
    assert(p.x > 0 && p.x < C.ROOM_W, 'arrived outside the room at x=' + p.x.toFixed(1));
    assert(p.y > 0 && p.y < C.ROOM_H, 'arrived outside the room at y=' + p.y.toFixed(1));
    return 'room ' + start + ' → ' + run.roomIndex + ' at (' + p.x.toFixed(0) + ',' + p.y.toFixed(0) + ')';
});

check('the plunger refuses to fire early and fires when fed', () => {
    const h = harness();
    const run = h.run;
    const vaultIdx = run.entities.findIndex(e => e.detonator);
    run.roomIndex = vaultIdx;
    const det = run.entities[vaultIdx].detonator;
    assert(det, 'the vault has no plunger');

    let denied = 0;
    run.bus.on(TNT.EV.DETONATOR_DENIED, () => denied++);
    run.player.reset(det.x, det.y, true);
    run.tntFound = 3;
    h.step(2);
    assert(denied === 1, 'expected one refusal, got ' + denied);
    assert(run.state === 'playing', 'it fired on three sticks');

    run.tntFound = run.mine.tntTotal;
    h.step(2);
    assert(run.state === 'boom', 'it would not fire on a full dozen (state ' + run.state + ')');
    return 'refused at 3, fired at ' + run.mine.tntTotal;
});

check('a full run rolls into the next mine and then to victory', () => {
    const h = harness();
    const run = h.run;
    for (let m = 0; m < 3; m++) {
        const before = run.mineIndex;
        const vaultIdx = run.entities.findIndex(e => e.detonator);
        run.roomIndex = vaultIdx;
        const det = run.entities[vaultIdx].detonator;
        run.player.reset(det.x, det.y, true);
        run.player.active = true;
        run.tntFound = run.mine.tntTotal;
        h.step(2);
        assert(run.state === 'boom', 'mine ' + before + ' would not blow');
        h.seconds(1.6, []);
    }
    assert(run.state === 'victory', 'ended in state "' + run.state + '" instead of victory');
    return 'three mines blown, score ' + run.score;
});

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

console.log('');
if (failures.length) {
    console.log(failures.length + ' failed, ' + passed + ' passed\n');
    process.exit(1);
}
console.log('all ' + passed + ' checks passed\n');
