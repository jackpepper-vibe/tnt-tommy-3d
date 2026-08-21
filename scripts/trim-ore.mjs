/**
 * One-off authoring pass: thin the ore out and drop the manual shafts.
 *
 * Two measured problems, both from `scripts/room-stats.mjs`:
 *
 *   - **32 pickups a room against Dynamite Dan's 7.** Scattering nuggets along
 *     every deck made the medal a chore and the screen a mess, and made an
 *     individual nugget worth nothing to see.
 *   - **Manual `g.shaft()` calls.** `World.cutFrames` now lays short stubs at
 *     the seam instead, so the room builders should not be laying ladders for
 *     room links at all.
 *
 * The ore rule is a design rule rather than a random cull: **ore lives on the
 * floor and on alternating decks**, and no run is longer than three. That gives
 * a room vertical rhythm — some levels are worth stopping on, some are only
 * worth passing through — instead of a uniform sprinkle.
 *
 * Run once. Kept in the repo because the numbers it was aiming at are in
 * `room-stats.mjs`, and a future pass should be able to see what this one did.
 *
 *   node scripts/trim-ore.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';

const DRY = process.argv.includes('--dry');
const FILES = ['src/world/Mine1.js', 'src/world/Mine2.js', 'src/world/Mine3.js'];

/** Decks that keep their ore. The floor (22) and every other level up. */
const ORE_ROWS = new Set([22, 19, 13, 7]);
const MAX_RUN = 2;

let removed = 0, capped = 0, shafts = 0;

for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    const out = [];

    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        // Drop the manual shaft calls; the frame lays the stubs now.
        if (/^\s*g\.shaft\(\);\s*$/.test(line)) {
            shafts++;
            continue;
        }

        const ore = line.match(/^(\s*)g\.ore\((\d+),\s*(\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?\);\s*$/);
        if (!ore) {
            out.push(line);
            continue;
        }

        const [, indent, x, y, n, step] = ore;
        const row = Number(y);
        const count = Number(n || 1);

        if (!ORE_ROWS.has(row)) {
            removed++;
            continue;
        }
        if (count > MAX_RUN) {
            capped++;
            out.push(`${indent}g.ore(${x}, ${y}, ${MAX_RUN}${step ? ', ' + step : ''});`);
            continue;
        }
        out.push(line);
    }

    if (!DRY) fs.writeFileSync(file, out.join('\n'), 'utf8');
}

console.log(`${DRY ? 'would remove' : 'removed'} ${removed} ore runs off the quiet decks`);
console.log(`${DRY ? 'would cap' : 'capped'} ${capped} runs to ${MAX_RUN}`);
console.log(`${DRY ? 'would drop' : 'dropped'} ${shafts} manual g.shaft() calls`);
