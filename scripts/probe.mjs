/** Scratch probe. Drives real input to reproduce a reported problem. */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Run, Input, Tiles, Paint } = TNT;

const run = new Run();
const input = new Input();
run.startRun();

const room = run.room();
console.log('room:', room.name, 'exits:', Object.keys(room.exits).join(','));
console.log('shaft cols:', Paint.SHAFT_COLS.join(','));

// What the up-shaft actually looks like.
for (const tx of Paint.SHAFT_COLS) {
    let col = '';
    for (let ty = 0; ty < 12; ty++) col += Tiles.isClimbable(room.get(tx, ty)) ? '|' : '.';
    console.log(`  col ${tx} rows 0-11:`, col);
}
// And what is under it.
let deck = '';
for (let ty = 0; ty < 12; ty++) deck += Tiles.isFloor(room.get(20, ty)) ? '=' : '.';
console.log('  col 20 floors :', deck);

function step(n, held) {
    for (const a in input.held) input.held[a] = false;
    for (const a of held || []) input.held[a] = true;
    for (let i = 0; i < n; i++) { run.update(C.FIXED_DT, input); input.endStep(); }
}
function tap(action) { input.held[action] = true; input.pressed[action] = true; }

const p = run.player;

// Put him on the deck directly under the shaft and try to climb.
p.reset(20 * C.TILE + C.TILE / 2, 8 * C.TILE, true);
step(12, []);
console.log('\nstanding under the shaft at', p.x.toFixed(0), p.y.toFixed(0),
            'onGround', p.onGround, 'tile under feet',
            room.get(Math.floor(p.x / C.TILE), Math.floor((p.y + 2) / C.TILE)));

console.log('press UP and hold:');
for (let i = 0; i < 6; i++) {
    if (i === 0) tap('up');
    step(20, ['up']);
    console.log(`  +${((i + 1) * 20 / 120).toFixed(2)}s  y=${p.y.toFixed(1)} mode=${p.mode} room=${run.roomIndex} vy=${p.vy.toFixed(0)}`);
}

console.log('\nsame again but tapping JUMP first, then holding UP:');
p.reset(20 * C.TILE + C.TILE / 2, 8 * C.TILE, true);
run.roomIndex = 0;
step(12, []);
tap('jump');
for (let i = 0; i < 6; i++) {
    step(20, ['jump', 'up']);
    console.log(`  +${((i + 1) * 20 / 120).toFixed(2)}s  y=${p.y.toFixed(1)} mode=${p.mode} room=${run.roomIndex} vy=${p.vy.toFixed(0)}`);
}
