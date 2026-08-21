/** Scratch probe for debugging movement. Not part of the suite. */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Run, Input } = TNT;

const run = new Run();
const input = new Input();
run.startRun();

console.log('spawn room', run.roomIndex, run.room().id, 'at', run.player.x, run.player.y);

input.held.right = true;
for (let i = 0; i < 12; i++) {
    for (let s = 0; s < 60; s++) { run.update(C.FIXED_DT, input); input.endStep(); }
    const p = run.player;
    console.log(
        `t=${(i * 0.5).toFixed(1)}s room=${run.roomIndex} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} ` +
        `vx=${p.vx.toFixed(0)} mode=${p.mode} ground=${p.onGround} state=${run.state} energy=${run.energy.toFixed(0)}`);
}
