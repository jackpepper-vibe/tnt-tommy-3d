/**
 * Build every authored room in isolation and report *all* the faults at once.
 *
 * `Paint` throws on the first bad tile, which is right for the game and slow
 * for authoring — twenty-seven rooms means twenty-seven round trips. This
 * catches per room and prints the lot.
 *
 *   node scripts/check-rooms.mjs
 */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, Paint, Tiles } = TNT;

let faults = 0;
let built = 0;

for (let m = 0; m < C.MINE_COUNT; m++) {
    const defs = (TNT.Rooms && TNT.Rooms.MINES && TNT.Rooms.MINES[m]) || null;
    if (!defs) {
        console.log(`mine ${m + 1}: no rooms authored`);
        continue;
    }
    console.log(`\nmine ${m + 1} — ${defs.length} rooms`);
    for (const def of defs) {
        try {
            const grid = Paint.render(def.build);
            Tiles.parse(grid, def.id);
            built++;
        } catch (err) {
            faults++;
            console.log(`  FAULT  ${def.id.padEnd(16)} ${err.message}`);
        }
    }
}

console.log('');
console.log(faults ? `${faults} faults, ${built} rooms clean` : `all ${built} rooms clean`);
process.exit(faults ? 1 : 0);
