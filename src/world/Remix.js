/**
 * TNT Tommy — the mine remixer.
 *
 * Mines two and three are derived from Copperlode's nine rooms rather than
 * authored fresh, and it is worth being straight about why. Every room in this
 * game has to satisfy the no-jump connectivity rules in `Rooms.js`; twenty-seven
 * independently authored rooms is twenty-seven chances to strand the player, and
 * the ones that break do so subtly. Deriving instead means the traversal
 * skeleton — ladders, ropes, level grid — is proven once and inherited, and the
 * escalation is applied only to things that cannot disconnect a room.
 *
 * WHAT CHANGES
 * ------------
 *   - **Orientation.** Blackdamp mirrors every room *and* the mine's own 3x3
 *     layout, so the route runs the other way round and the Vault is on the
 *     opposite side. Cinderdeep flips the layout vertically instead: the
 *     workings start at the top and the plunger is at the bottom, which reverses
 *     the pressure of the fuse entirely — you are descending against it.
 *   - **Hazards.** Interior platform boards rot into crumbling planks, ladders
 *     are replaced by slower hanging ropes, and in Cinderdeep the authored spike
 *     beds become lava.
 *   - **Enemies.** Extra patrols on the standing rows.
 *
 * WHY NO SCATTERED TERRAIN HAZARDS
 * --------------------------------
 * The obvious escalation — sprinkle spikes along the open floor — was written,
 * shipped to the validator, and thrown away, because it makes the third mine
 * impossible rather than hard. Every hazard here has to be **bypassable
 * without a jump**, and a lone hazard tile in a corridor is not:
 *
 *   - a scattered *spike* cannot be stepped over, so it is not a threat the
 *     player can play around, just a toll on walking down a corridor
 *   - a scattered *lava* tile is a wall, full stop, and Cinderdeep converts
 *     spikes to lava — which is how a dozen of them ended up sealing all nine
 *     rooms of a mine that still looked perfectly normal in a screenshot
 *
 * So terrain hazards are only ever *authored*, in beds that `Rooms.js` gives a
 * route around, and the remix escalates with things that cost time or attention
 * instead of blocking: rotten boards, slower climbs, more patrols, less fuse.
 * `scripts/validate-world.mjs` is what keeps that honest.
 *
 * WHAT NEVER CHANGES
 * ------------------
 * Every substitution is refused inside a **guard zone** — the doorway approaches,
 * the shaft columns, the tiles at the ends of a platform run, and anything
 * carrying a pickup. Those are the tiles a route depends on. A hazard that lands
 * on one does not make the mine harder, it makes it impossible, and
 * `scripts/validate-world.mjs` would reject the build rather than ship it.
 */
(function (TNT) {
    'use strict';

    const { C, Util, Tiles, Paint } = TNT;

    const Remix = {};

    /** Per-mine escalation dials. Index 0 is Copperlode and is left alone. */
    const RECIPE = [
        null,
        {
            seed: 0x51A7E,
            mirrorX: true,
            rotPlanks: 0.34,   // chance an interior platform board rots
            vineSwap: 0.30,    // chance a whole ladder becomes a hanging rope
            extraEnemies: 5,
            lavaForSpikes: false
        },
        {
            seed: 0xC1DEE7,
            flipY: true,
            rotPlanks: 0.46,
            vineSwap: 0.45,
            extraEnemies: 8,
            lavaForSpikes: true
        }
    ];

    /* ------------------------------------------------------------------ *
     * Guards
     * ------------------------------------------------------------------ */

    /**
     * Tiles no substitution may touch.
     *
     * The doorway approach is three columns either side at standing height — a
     * spike bed in a doorway is a wall. The shaft columns carry the vertical
     * links. The rest is handled per-rule.
     */
    function isGuarded(tx, ty) {
        if (Paint.SHAFT_COLS.indexOf(tx) >= 0) return true;
        if (ty >= Paint.DOOR_ROWS[0] && (tx <= 4 || tx >= C.COLS - 5)) return true;
        return false;
    }

    /** The end tiles of a horizontal run are what ladders land on; leave them. */
    function isRunEnd(rows, tx, ty, ch) {
        const at = function (x) { return (x >= 0 && x < C.COLS) ? rows[ty][x] : '#'; };
        return at(tx - 1) !== ch || at(tx + 1) !== ch;
    }

    /** A ladder or rope passing through this tile means something boards here. */
    function hasClimbNear(rows, tx, ty) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const y = ty + dy, x = tx + dx;
                if (y < 0 || y >= C.ROWS || x < 0 || x >= C.COLS) continue;
                const ch = rows[y][x];
                if (ch === '|' || ch === 'J' || ch === '-') return true;
            }
        }
        return false;
    }

    /* ------------------------------------------------------------------ *
     * Rules
     * ------------------------------------------------------------------ */

    /**
     * Rot interior platform boards into crumbling planks.
     *
     * Only the middle of a run, and never where a ladder meets it: a crumbling
     * board at a ladder head means the player steps off the ladder onto nothing,
     * which is not a hazard so much as a trap with no tell.
     */
    function rotPlanks(rows, rng, p) {
        for (let ty = 1; ty < C.ROWS - 1; ty++) {
            for (let tx = 1; tx < C.COLS - 1; tx++) {
                if (rows[ty][tx] !== '=') continue;
                if (isGuarded(tx, ty)) continue;
                if (isRunEnd(rows, tx, ty, '=')) continue;
                if (hasClimbNear(rows, tx, ty)) continue;
                if (rows[ty - 1] && rows[ty - 1][tx] !== '.') continue;   // nothing standing on it
                if (rng() < p) rows[ty] = replaceAt(rows[ty], tx, '~');
            }
        }
    }

    /**
     * Swap whole ladders for hanging ropes.
     *
     * Whole ones, never single tiles: half a ladder with a rope on top is a
     * rendering mess and reads as a bug. A ladder is identified by its top tile
     * and followed down.
     */
    function vineSwap(rows, rng, p) {
        for (let ty = 1; ty < C.ROWS - 1; ty++) {
            for (let tx = 1; tx < C.COLS - 1; tx++) {
                if (rows[ty][tx] !== '|') continue;
                if (rows[ty - 1][tx] === '|') continue;          // not the top
                if (Paint.SHAFT_COLS.indexOf(tx) >= 0) continue; // links stay rigid
                if (rng() >= p) continue;
                for (let y = ty; y < C.ROWS && rows[y][tx] === '|'; y++) {
                    rows[y] = replaceAt(rows[y], tx, 'J');
                }
            }
        }
    }

    /**
     * Spike beds become lava in the deepest mine: death rather than damage.
     *
     * Safe only because every spike bed in `Rooms.js` is authored with a route
     * over or around it. Apply this to a hazard that was scattered rather than
     * placed and you have sealed a corridor — see the module header.
     */
    function lavaForSpikes(rows) {
        for (let ty = 1; ty < C.ROWS - 1; ty++) {
            for (let tx = 1; tx < C.COLS - 1; tx++) {
                if (rows[ty][tx] === '^' && !isGuarded(tx, ty)) {
                    rows[ty] = replaceAt(rows[ty], tx, 'L');
                }
            }
        }
    }

    /** Extra patrols, on tiles that already have something to stand on. */
    function addEnemies(rows, rng, count) {
        const kinds = ['B', 'F', 'S', 'o'];
        let placed = 0, tries = 0;
        while (placed < count && tries++ < 400) {
            const tx = rng.int(3, C.COLS - 4);
            const ty = rng.int(2, C.ROWS - 2);
            if (rows[ty][tx] !== '.') continue;
            if (isGuarded(tx, ty)) continue;
            const below = rows[ty + 1][tx];
            const kind = rng.pick(kinds);
            const needsFloor = (kind === 'B' || kind === 'S');
            if (needsFloor && below !== '#' && below !== '=') continue;
            rows[ty] = replaceAt(rows[ty], tx, kind);
            placed++;
        }
    }

    function replaceAt(row, i, ch) {
        return row.slice(0, i) + ch + row.slice(i + 1);
    }

    /* ------------------------------------------------------------------ *
     * Assembly
     * ------------------------------------------------------------------ */

    /**
     * Produce one mine's room list.
     *
     * @param {number} index  0 = Copperlode (verbatim), 1 = Blackdamp, 2 = Cinderdeep
     * @returns {Array} room definitions with `grid` already rendered
     */
    Remix.buildMine = function (index) {
        const base = TNT.Rooms.MINE1;
        const recipe = RECIPE[index];

        return base.map(function (room, i) {
            let grid = Paint.render(room.build);
            let cell = room.cell.slice();
            let exits = Object.assign({}, room.exits);

            if (recipe) {
                const rng = Util.rng(recipe.seed + i * 7919);

                if (recipe.mirrorX) {
                    grid = Tiles.mirror(grid);
                    cell[0] = C.MINE_COLS - 1 - cell[0];
                    exits = { left: exits.right, right: exits.left, up: exits.up, down: exits.down };
                }
                if (recipe.flipY) {
                    // The mine's layout flips, not the rooms: gravity is not
                    // negotiable, so a room turned upside down is nonsense.
                    cell[1] = C.MINE_ROWS - 1 - cell[1];
                    exits = { left: exits.left, right: exits.right, up: exits.down, down: exits.up };
                }

                rotPlanks(grid, rng, recipe.rotPlanks);
                vineSwap(grid, rng, recipe.vineSwap);
                if (recipe.lavaForSpikes) lavaForSpikes(grid);
                addEnemies(grid, rng, recipe.extraEnemies);
            }

            return {
                id: room.id,
                name: room.name,
                cell: cell,
                exits: pruneExits(exits),
                grid: grid
            };
        });
    };

    /** Drop falsy keys so `exits` reads as a set rather than a record of maybes. */
    function pruneExits(exits) {
        const out = {};
        for (const k in exits) if (exits[k]) out[k] = true;
        return out;
    }

    Remix.RECIPE = RECIPE;
    TNT.Remix = Remix;
})(window.TNT = window.TNT || {});
