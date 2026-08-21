/**
 * Print a room back as ASCII.
 *
 * Rooms are authored as feature calls, which cannot miscount but also cannot be
 * seen. This closes that gap: it renders any room — after the frame is cut and
 * the mine's remix applied — as the character grid it became.
 *
 *   node scripts/dump-rooms.mjs                 every room of mine 1
 *   node scripts/dump-rooms.mjs 2               every room of mine 2
 *   node scripts/dump-rooms.mjs 1 cageShaft     one room
 */
import { loadSim } from './lib/load.mjs';

const TNT = loadSim();
const { C, World } = TNT;

const mineArg = Number(process.argv[2] || 1);
const roomArg = process.argv[3] || null;

const mine = new World.Mine(Math.max(0, Math.min(C.MINE_COUNT - 1, mineArg - 1)));

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

const ACTOR = {
    spawn: '@', tnt: 'D', ore: 'C', food: 'M', heart: 'H', oxygen: 'O',
    walker: 'B', bat: 'F', crawler: 'S', orb: 'o',
    crusher: 'K', boulder: 'P', liftH: 'h', liftV: 'v'
};

function render(room) {
    const rows = [];
    for (let ty = 0; ty < C.ROWS; ty++) {
        let line = '';
        for (let tx = 0; tx < C.COLS; tx++) line += CHAR[room.get(tx, ty)] || '?';
        rows.push(line.split(''));
    }
    for (const s of room.spawns) rows[s.ty][s.tx] = ACTOR[s.kind] || '?';

    const exits = Object.keys(room.exits).join(' ') || 'none';
    console.log('');
    console.log(`── ${room.name}  [${room.cell.join(',')}]  exits: ${exits}`);
    console.log('   ' + ruler(0) + '\n   ' + ruler(1));
    rows.forEach((r, i) => console.log(String(i).padStart(2, ' ') + ' ' + r.join('')));
}

function ruler(which) {
    let s = '';
    for (let i = 0; i < C.COLS; i++) {
        s += which === 0 ? String(Math.floor(i / 10)) : String(i % 10);
    }
    return s;
}

console.log(`${mine.name} — ${mine.rooms.length} rooms, ${mine.tntTotal} sticks of TNT`);
for (const room of mine.rooms) {
    if (roomArg && room.id !== roomArg) continue;
    render(room);
}
