/** Scratch probe: climb the up-shaft out of the opening room. */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Run, Input, Paint } = TNT;

const run = new Run();
const input = new Input();
run.startRun();

const p = run.player;
const col = Paint.SHAFT_COLS[0];

function step(n, held) {
    for (const a in input.held) input.held[a] = false;
    for (const a of held || []) input.held[a] = true;
    for (let i = 0; i < n; i++) { run.update(C.FIXED_DT, input); input.endStep(); }
}
function tap(a) { input.held[a] = true; input.pressed[a] = true; }

// Stand on the deck the ladder lands on, directly under it.
p.reset(col * C.TILE + C.TILE / 2, 8 * C.TILE, true);
step(10, []);
console.log(`start: room ${run.roomIndex} (${run.room().id})  y=${p.y.toFixed(1)} onGround=${p.onGround}`);

tap('up');
for (let i = 0; i < 10; i++) {
    step(30, ['up']);
    console.log(`  +${((i + 1) * 0.25).toFixed(2)}s  room=${run.roomIndex} y=${p.y.toFixed(1)} ` +
                `mode=${p.mode} state=${run.state}`);
    if (run.roomIndex !== 0) break;
}

console.log(run.roomIndex !== 0
    ? `\nARRIVED in ${run.room().id}`
    : `\nSTUCK — never left ${run.room().id}`);
