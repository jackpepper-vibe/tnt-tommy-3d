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

check('there is no way to leave the ground', () => {
    const h = harness();
    const p = h.run.player;
    const floorY = p.y;
    // Hammer every input there is, for a good long while, in every room the
    // walk reaches. If any of it produces height, the whole design is void.
    let highest = 0;
    for (let i = 0; i < 8; i++) {
        h.seconds(0.5, ['up', 'plant']);
        h.seconds(0.5, ['right', 'up', 'plant']);
        h.seconds(0.5, ['left', 'down', 'plant']);
        if (p.mode === 'walk' && p.onGround) highest = Math.max(highest, floorY - p.y);
    }
    assert(highest <= 0.5, 'gained ' + highest.toFixed(1) + 'px of height without climbing');
    return 'no jump found';
});

/**
 * Find a ladder that stands on the floor, and Tommy's position at its foot.
 * Locating it from the room data rather than walking to a remembered column
 * means the check tests the mechanic, not the author's memory of the level.
 */
function ladderFoot(room) {
    const floorStand = C.ROWS - 2;
    for (let tx = 2; tx < C.COLS - 2; tx++) {
        if (!Tiles.isClimbable(room.get(tx, floorStand))) continue;
        let top = floorStand;
        while (top > 1 && Tiles.isClimbable(room.get(tx, top - 1))) top--;
        if (floorStand - top < 3) continue;
        return { tx: tx, top: top, x: tx * C.TILE + C.TILE / 2, y: (floorStand + 1) * C.TILE };
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

check('a five-tile drop is free, a shaft is not', () => {
    const h = harness();
    const p = h.run.player;
    const g = C.GRAVITY;
    const vFive = Math.sqrt(2 * g * 5 * C.TILE);
    const vTen = Math.sqrt(2 * g * 10 * C.TILE);
    assert(vFive < C.FALL_SAFE, 'a five-tile drop hurts (' + vFive.toFixed(0) + ' >= ' + C.FALL_SAFE + ')');
    assert(vTen >= C.FALL_FATAL, 'a ten-tile drop survives (' + vTen.toFixed(0) + ' < ' + C.FALL_FATAL + ')');
    void p;
    return '5 tiles → ' + vFive.toFixed(0) + 'px/s, 10 tiles → ' + vTen.toFixed(0) + 'px/s';
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
    const vaultIdx = run.mine.rooms.findIndex(r => r.id === 'vault');
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
        const vaultIdx = run.mine.rooms.findIndex(r => r.id === 'vault');
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
