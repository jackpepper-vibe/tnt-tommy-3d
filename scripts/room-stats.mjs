/**
 * Room density, measured rather than eyeballed.
 *
 * Exists because "the rooms feel empty" is a real complaint that is impossible
 * to argue about from screenshots. This puts numbers on it, and — more usefully
 * — puts the same numbers on `../dynamite-dan`, whose 27 hand-authored rooms
 * are the density this game is supposed to match.
 *
 *   node scripts/room-stats.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadSim, ROOT } from './lib/load.mjs';

const TNT = loadSim();
const { C, World } = TNT;

const CHAR = [];
CHAR[C.Tile.EMPTY] = '.';
CHAR[C.Tile.ROCK] = '#';
CHAR[C.Tile.PLATFORM] = '=';
CHAR[C.Tile.LADDER] = '|';
CHAR[C.Tile.ROPE] = '-';
CHAR[C.Tile.VINE] = 'J';
CHAR[C.Tile.SPIKE] = '^';
CHAR[C.Tile.CRUMBLE] = '~';
CHAR[C.Tile.CRACKED] = 'X';
CHAR[C.Tile.BELT_R] = '>';
CHAR[C.Tile.BELT_L] = '<';
CHAR[C.Tile.VENT] = 'V';
CHAR[C.Tile.LAVA] = 'L';
CHAR[C.Tile.WATER] = 'W';
CHAR[C.Tile.DETONATOR] = 'G';

const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1] || 0;
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

/** Platform rows, the gaps between them, and how much is worth picking up. */
function measure(rooms, pickupChars) {
    const plats = [], gaps = [], picks = [], climbs = [];
    for (const rows of rooms) {
        const platRows = [];
        for (let y = 0; y < rows.length; y++) {
            if (rows[y].includes('=') || rows[y].includes('~')) platRows.push(y);
        }
        plats.push(platRows.length);
        for (let i = 1; i < platRows.length; i++) gaps.push(platRows[i] - platRows[i - 1]);

        let p = 0, cl = 0;
        for (const row of rows) {
            for (const ch of row) {
                if (pickupChars.includes(ch)) p++;
                if (ch === '|' || ch === 'J') cl++;
            }
        }
        picks.push(p);
        climbs.push(cl);
    }
    return {
        rooms: rooms.length,
        width: rooms[0][0].length,
        height: rooms[0].length,
        platRows: avg(plats),
        gap: median(gaps),
        pickups: avg(picks),
        climbTiles: avg(climbs)
    };
}

function report(name, m, note) {
    console.log(`\n${name}${note ? '  — ' + note : ''}`);
    console.log(`  rooms                ${m.rooms}`);
    console.log(`  room size            ${m.width} x ${m.height}`);
    console.log(`  platform rows/room   ${m.platRows.toFixed(1)}`);
    console.log(`  gap between them     ${m.gap} rows`);
    console.log(`  pickups/room         ${m.pickups.toFixed(1)}`);
    console.log(`  ladder tiles/room    ${m.climbTiles.toFixed(1)}`);
}

/* ---- this game ---- */

const mineRooms = [];
for (let i = 0; i < C.MINE_COUNT; i++) {
    for (const room of new World.Mine(i).rooms) {
        const rows = [];
        for (let ty = 0; ty < C.ROWS; ty++) {
            let s = '';
            for (let tx = 0; tx < C.COLS; tx++) s += CHAR[room.get(tx, ty)] || '?';
            rows.push(s);
        }
        for (const sp of room.spawns) {
            const key = { ore: 'C', tnt: 'D', food: 'M', heart: 'H', oxygen: 'O' }[sp.kind];
            if (key) rows[sp.ty] = rows[sp.ty].slice(0, sp.tx) + key + rows[sp.ty].slice(sp.tx + 1);
        }
        mineRooms.push(rows);
    }
}
report('tnt-tommy', measure(mineRooms, 'CDMH'), 'all 27 hand-authored');

/* ---- the game this is supposed to have the detail of ---- */

const ddPath = path.resolve(ROOT, '..', 'dynamite-dan', 'src', 'utils', 'worldData.ts');
if (fs.existsSync(ddPath)) {
    const src = fs.readFileSync(ddPath, 'utf8');
    const dd = [];
    for (const block of src.match(/grid:\s*\[[\s\S]*?\]/g) || []) {
        const rows = (block.match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1));
        if (rows.length === 24) dd.push(rows);
    }
    if (dd.length) report('dynamite-dan', measure(dd, 'CDMH'), 'all 27 hand-authored');
} else {
    console.log('\n(dynamite-dan not found alongside; skipping the comparison)');
}

console.log('');
