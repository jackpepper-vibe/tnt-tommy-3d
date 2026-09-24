/**
 * TNT Tommy — the tile vocabulary and the grid reader.
 *
 * Rooms are authored as arrays of 42-character strings, which is the only format
 * a human can actually edit and see the shape of at the same time. This module
 * is the single place that knows what a character means.
 *
 * Two kinds of character live in the same grid:
 *
 *   - **Terrain** becomes a tile id in the room's `Uint8Array`. Static, queried
 *     by the millions, never allocated.
 *   - **Actors** — pickups, enemies, lifts, crushers — leave `EMPTY` behind and
 *     produce a spawn record instead. Anything with per-instance state belongs
 *     here rather than in the tile array, because a tile cannot remember whether
 *     it has already been eaten.
 *
 * Authoring rules the validator enforces (`scripts/validate-world.mjs`):
 *   - every room is exactly `C.ROWS` rows of `C.COLS` characters
 *   - the outer border is solid except where a doorway is deliberately cut
 *   - side doorways sit in rows 15-17, vertical shafts in columns 20-21, so
 *     rooms line up with their neighbours no matter how they are arranged
 */
(function (TNT) {
    'use strict';

    const { C } = TNT;
    const T = C.Tile;

    const Tiles = {};

    /** Terrain characters. Anything not listed here is either an actor or a fault. */
    const TERRAIN = {
        '.': T.EMPTY,
        ' ': T.EMPTY,
        '#': T.ROCK,
        '=': T.PLATFORM,
        '|': T.LADDER,
        '-': T.ROPE,
        'J': T.VINE,
        '^': T.SPIKE,
        '~': T.CRUMBLE,
        'X': T.CRACKED,
        '>': T.BELT_R,
        '<': T.BELT_L,
        'V': T.VENT,
        'L': T.LAVA,
        'W': T.WATER,
        'G': T.DETONATOR,
        'T': T.TRAMPOLINE,
        'Q': T.TELEPORT,
        'I': T.GATE
    };

    /**
     * Actor characters → spawn kind. The grid cell underneath becomes `EMPTY`,
     * except for the two that need something to stand on, noted below.
     */
    /**
     * Actor characters → spawn kind.
     *
     * Six patrol behaviours rather than four, because a mine full of things
     * that all move the same way is a mine with one hazard in it repeated. Each
     * of these asks a different question of the player: the walker is about
     * timing, the dog about distance, the spider about looking up, the guardian
     * about geometry it ignores, the orb about a column you have to cross, the
     * bat about a gap you have to cross under it.
     */
    const ACTORS = {
        '@': 'spawn',       // Tommy's start; exactly one per mine
        'D': 'tnt',
        'C': 'ore',
        'M': 'food',
        'H': 'heart',
        'O': 'oxygen',
        'B': 'walker',      // brisk floor patrol, turns at edges and walls
        'c': 'crawler',     // slow, and reverses on its own schedule
        'd': 'dog',         // floor patrol that charges when it sees you level
        'F': 'bat',         // sine-weaves along a horizontal span
        'S': 'spider',      // drops from the ceiling on a thread, then retracts
        'g': 'guardian',    // hovers, drifts toward you, walls mean nothing
        'o': 'orb',         // fire orb, bobs along a vertical span
        'K': 'crusher',     // ceiling piston; slams C.CRUSH_TILES down
        'P': 'boulder',     // ceiling dropper
        'h': 'liftH',       // horizontal lift; a pair marks the ends of its run
        'v': 'liftV',       // vertical lift; likewise
        'Y': 'cog',         // a brass cog, hidden until the dog finds it
        'l': 'lever',       // throws every gate in the room open
        'U': 'valve'        // one of the Governor's three weak points
    };

    Tiles.TERRAIN_CHARS = TERRAIN;
    Tiles.ACTOR_CHARS = ACTORS;

    /* ------------------------------------------------------------------ *
     * Predicates
     * ------------------------------------------------------------------ */

    Tiles.isSolid = function (t) {
        return t === T.ROCK || t === T.CRACKED || t === T.GATE;
    };

    /** Stand on it from above, pass through it from below. */
    Tiles.isOneWay = function (t) {
        return t === T.PLATFORM || t === T.CRUMBLE || t === T.BELT_R ||
               t === T.BELT_L || t === T.TRAMPOLINE;
    };

    /** Anything Tommy's feet can rest on. */
    Tiles.isFloor = function (t) {
        return Tiles.isSolid(t) || Tiles.isOneWay(t);
    };

    Tiles.isClimbable = function (t) {
        return t === T.LADDER || t === T.VINE;
    };

    Tiles.isRope = function (t) {
        return t === T.ROPE;
    };

    Tiles.isDeadly = function (t) {
        return t === T.LAVA;
    };

    Tiles.isHarmful = function (t) {
        return t === T.SPIKE || t === T.LAVA;
    };

    Tiles.beltDir = function (t) {
        return t === T.BELT_R ? 1 : (t === T.BELT_L ? -1 : 0);
    };

    Tiles.isTrampoline = function (t) {
        return t === T.TRAMPOLINE;
    };

    Tiles.isTeleport = function (t) {
        return t === T.TELEPORT;
    };

    /** Tiles that never block movement, so the reachability walk can pass them. */
    Tiles.isOpen = function (t) {
        return !Tiles.isSolid(t);
    };

    /* ------------------------------------------------------------------ *
     * Parsing
     * ------------------------------------------------------------------ */

    /**
     * Read one authored grid.
     *
     * @param {string[]} grid  `C.ROWS` strings of `C.COLS` characters
     * @param {string} roomId  for fault messages
     * @returns {{tiles: Uint8Array, spawns: Array<{kind: string, tx: number, ty: number}>}}
     */
    Tiles.parse = function (grid, roomId) {
        const where = roomId || 'room';
        if (!Array.isArray(grid) || grid.length !== C.ROWS) {
            throw new Error(where + ': expected ' + C.ROWS + ' rows, got ' +
                (Array.isArray(grid) ? grid.length : typeof grid));
        }

        const tiles = new Uint8Array(C.COLS * C.ROWS);
        const spawns = [];

        for (let ty = 0; ty < C.ROWS; ty++) {
            const row = grid[ty];
            if (typeof row !== 'string' || row.length !== C.COLS) {
                throw new Error(where + ' row ' + ty + ': expected ' + C.COLS +
                    ' characters, got ' + (typeof row === 'string' ? row.length : typeof row));
            }
            for (let tx = 0; tx < C.COLS; tx++) {
                const ch = row[tx];
                const terrain = TERRAIN[ch];
                if (terrain !== undefined) {
                    tiles[ty * C.COLS + tx] = terrain;
                    continue;
                }
                const actor = ACTORS[ch];
                if (actor === undefined) {
                    throw new Error(where + ' (' + tx + ',' + ty + '): unknown character "' + ch + '"');
                }
                tiles[ty * C.COLS + tx] = T.EMPTY;
                spawns.push({ kind: actor, tx: tx, ty: ty });
            }
        }

        return { tiles: tiles, spawns: spawns };
    };

    /**
     * Mirror a grid left-to-right.
     *
     * Used by the mine remixer. Conveyors and the two doorway columns have to be
     * handled rather than merely reversed: a belt that pushed right must push
     * left in the mirror, and the vertical shaft has to stay on the columns the
     * neighbouring rooms expect or the mine comes apart at the seams.
     */
    Tiles.mirror = function (grid) {
        const swap = { '>': '<', '<': '>' };
        return grid.map(function (row) {
            let out = '';
            for (let i = row.length - 1; i >= 0; i--) {
                const ch = row[i];
                out += (swap[ch] || ch);
            }
            return out;
        });
    };

    /**
     * Replace characters wholesale — the remixer's other tool.
     * @param {string[]} grid
     * @param {Object<string,string>} map
     */
    Tiles.substitute = function (grid, map) {
        return grid.map(function (row) {
            let out = '';
            for (let i = 0; i < row.length; i++) {
                const ch = row[i];
                out += (map[ch] !== undefined ? map[ch] : ch);
            }
            return out;
        });
    };

    TNT.Tiles = Tiles;
})(window.TNT = window.TNT || {});
