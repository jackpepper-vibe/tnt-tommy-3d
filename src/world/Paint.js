/**
 * TNT Tommy — the room-authoring kit.
 *
 * Rooms are described as a list of named features rather than as 42-character
 * string literals. Both were tried. Strings let you see the room, but every edit
 * is a character-counting exercise and a single dropped dot silently shifts half
 * a level sideways; with 27 rooms that stops being a risk and becomes a
 * certainty. Feature calls cannot miscount, and `node scripts/dump-rooms.mjs`
 * prints any room back as ASCII when you do want to look at it.
 *
 * THE ROOM FRAME
 * --------------
 * Every room is `C.COLS` x `C.ROWS` with a solid border. `World` — not the room
 * builder — cuts the doorways, so a room cannot disagree with its neighbour
 * about where the opening is:
 *
 *   - side doorways occupy `DOOR_ROWS` in column 0 / column `C.COLS - 1`
 *   - vertical shafts occupy `SHAFT_COLS` in row 0 / row `C.ROWS - 1`
 *
 * A room builder's job is to lay a ladder up to the shaft and leave floor beside
 * the doorways; the frame itself is not its business.
 *
 * THE LEVEL GRID
 * --------------
 * Standing surfaces sit on `LEVELS`, **three rows apart**, which is exactly what
 * a jump clears (`C.JUMP_APEX`). Six levels fit over the floor, and every one is
 * reachable from the one below without a ladder.
 *
 * That number is the whole difference between this game and an earlier version
 * of it that had no jump and a five-row grid. Five rows halves the levels a room
 * can hold and demands a ladder at every single one — which measurably produced
 * rooms averaging three platform rows and sixty-five tiles of ladder, against
 * Dynamite Dan's five-point-seven and thirteen. `scripts/room-stats.mjs` prints
 * both, so that drift stays visible rather than a matter of opinion.
 *
 * Ladders are for the *fourth* row and beyond: long shafts, room links, and
 * deliberate climbs. A ladder spanning three rows is a ladder doing a jump's
 * job, and probably should not be there.
 */
(function (TNT) {
    'use strict';

    const { C } = TNT;

    /** Bedrock. The walkable surface of a room is the top of this row. */
    const FLOOR_ROW = C.ROWS - 1;              // 23

    /**
     * Platform rows, in ascending height. Three rows apart — see the header.
     *
     * Standing on the floor puts Tommy's feet at row `FLOOR_ROW`; standing on
     * the platform at row 20 puts them three rows higher, and so on up. Six
     * levels over a floor, which is what makes a room a climbing frame rather
     * than a corridor with shelves.
     */
    const LEVELS = [20, 17, 14, 11, 8, 5];

    /** Where `World` cuts side doorways. Three tiles of headroom over the floor. */
    const DOOR_ROWS = [FLOOR_ROW - 3, FLOOR_ROW - 2, FLOOR_ROW - 1];   // 20, 21, 22

    /** Where `World` cuts vertical shafts. Centred, so mirrored rooms still line up. */
    const SHAFT_COLS = [(C.COLS >> 1) - 1, C.COLS >> 1];               // 20, 21

    /* ------------------------------------------------------------------ *
     * Grid
     * ------------------------------------------------------------------ */

    /**
     * A mutable character grid with the border already laid in.
     * Out-of-bounds writes are dropped rather than throwing: a feature that runs
     * off the edge of a room should be clipped by the wall, exactly as it would
     * be if the wall were real.
     */
    function Grid() {
        /**
         * Cells that are water *underneath* whatever was painted there.
         *
         * A grid cell holds one character, so a coin or a stick laid in a sump
         * — or a ladder run down into one — used to replace the water in its
         * cell outright. Each left a dry pocket in the tank: a dark square you
         * could see and could not swim in. Anything written over water is
         * remembered here, and `World.Room` keeps the cell wet.
         */
        this.wet = new Set();
        this.cells = [];
        for (let y = 0; y < C.ROWS; y++) {
            this.cells.push(new Array(C.COLS).fill('.'));
        }
        this.fill(0, 0, C.COLS, 1, '#');                    // ceiling
        this.fill(0, FLOOR_ROW, C.COLS, 1, '#');            // bedrock
        this.fill(0, 0, 1, C.ROWS, '#');                    // left wall
        this.fill(C.COLS - 1, 0, 1, C.ROWS, '#');           // right wall
    }

    Grid.prototype.inside = function (x, y) {
        return x >= 0 && y >= 0 && x < C.COLS && y < C.ROWS;
    };

    Grid.prototype.set = function (x, y, ch) {
        if (!this.inside(x, y)) return this;
        const key = y * C.COLS + x;
        if (ch === 'W' || this.cells[y][x] === 'W') this.wet.add(key);
        // Rock or the plunger over water really does displace it.
        if (ch === '#' || ch === 'X') this.wet.delete(key);
        this.cells[y][x] = ch;
        return this;
    };

    Grid.prototype.get = function (x, y) {
        return this.inside(x, y) ? this.cells[y][x] : '#';
    };

    Grid.prototype.fill = function (x, y, w, h, ch) {
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
        }
        return this;
    };

    Grid.prototype.toStrings = function () {
        return this.cells.map(function (row) { return row.join(''); });
    };

    /* ------------------------------------------------------------------ *
     * Features
     * ------------------------------------------------------------------ */

    /** Solid rock. */
    Grid.prototype.rock = function (x, y, w, h) {
        return this.fill(x, y, w || 1, h || 1, '#');
    };

    /** Timber staging: stand on it, press Down to drop through. */
    Grid.prototype.plat = function (x, y, w) {
        return this.fill(x, y, w, 1, '=');
    };

    /**
     * A ladder serving the platform at `platRow`, reachable from someone
     * standing at `standRow` below it.
     *
     * Both ends are off-by-one traps, so neither is left to the caller. The top
     * tile sits one row *above* the platform, or climbing off leaves Tommy
     * inside the boards; the bottom tile sits *on* the standing row, not above
     * it, or the ladder hangs just out of reach of the floor it serves. Getting
     * either wrong produces a ladder that looks right in a screenshot and cannot
     * be used.
     *
     * @param {number} x         column
     * @param {number} platRow   row of the platform at the top
     * @param {number} standRow  row a player occupies standing on the surface below
     */
    Grid.prototype.ladder = function (x, platRow, standRow) {
        return this.fill(x, platRow - 1, 1, standRow - platRow + 2, '|');
    };

    /** A hanging rope. Same job as a ladder, slower to climb, and it sways. */
    Grid.prototype.vine = function (x, platRow, standRow) {
        return this.fill(x, platRow - 1, 1, standRow - platRow + 2, 'J');
    };

    /**
     * A rope line strung between two points, crossed hand-over-hand.
     *
     * This is the room's horizontal answer to a gap too wide to walk. It has to
     * be *boardable*: a rope you cannot reach is scenery, so every rope is laid
     * across at least one ladder and boarded by stepping sideways off it.
     *
     * Which is why a rope is strung through open air only, and never paints
     * over what is already there. Painted flat it cuts a one-tile gap in the
     * very ladder it depends on — the ladder still looks continuous in a
     * screenshot, and a climber falls out of it at exactly that row.
     */
    Grid.prototype.rope = function (x0, x1, y) {
        for (let x = x0; x <= x1; x++) {
            if (this.get(x, y) === '.') this.set(x, y, '-');
        }
        return this;
    };

    Grid.prototype.spikes = function (x, y, w) {
        return this.fill(x, y, w || 1, 1, '^');
    };

    /** Planks that hold for `C.CRUMBLE_SHAKE` under weight and then give way. */
    Grid.prototype.crumble = function (x, y, w) {
        return this.fill(x, y, w, 1, '~');
    };

    /** Fissured rock — solid until a stick of dynamite opens it. */
    Grid.prototype.cracked = function (x, y, w, h) {
        return this.fill(x, y, w || 1, h || 1, 'X');
    };

    /** @param {number} dir  +1 pushes right, -1 pushes left. */
    Grid.prototype.belt = function (x, y, w, dir) {
        return this.fill(x, y, w, 1, dir >= 0 ? '>' : '<');
    };

    Grid.prototype.vent = function (x, y) {
        return this.set(x, y, 'V');
    };

    Grid.prototype.lava = function (x, y, w, h) {
        return this.fill(x, y, w, h || 1, 'L');
    };

    Grid.prototype.water = function (x, y, w, h) {
        return this.fill(x, y, w, h || 1, 'W');
    };

    /**
     * A trampoline. Reaches roughly seven rows — more than double a jump — so
     * it is the tool for a ledge that would otherwise need a ladder, in a place
     * where a ladder would be tedious.
     *
     * Mind what is above one. The launch is not cuttable, so a ceiling of
     * spikes over a trampoline is a trap the player cannot decline once they
     * have stepped on it.
     */
    Grid.prototype.tramp = function (x, y, w) {
        return this.fill(x, y, w || 1, 1, 'T');
    };

    /**
     * A warp pad, entered with Down. Pads pair up **within a room, in reading
     * order** — first with second, third with fourth. An odd number of pads in
     * a room is a fault and `Entities` will say so rather than guess.
     */
    Grid.prototype.warp = function (x, y) {
        return this.set(x, y, 'Q');
    };

    Grid.prototype.detonator = function (x, y) {
        return this.set(x, y, 'G');
    };

    /**
     * A shutter gate, `h` tiles tall. Solid until the room's lever is thrown —
     * so a gate is a question the room asks ("where is the lever?"), and the
     * validator walks both sides of it.
     */
    Grid.prototype.gate = function (x, y, h) {
        return this.fill(x, y, 1, h || 3, 'I');
    };

    /**
     * A floor fan, on the row a player stands in — like a vent. The air above
     * it lifts, up to `C.FAN_ROWS` or the first rock. Put a deck to step off
     * onto near the top of the column, or the ride goes nowhere.
     */
    Grid.prototype.fan = function (x, y) {
        return this.set(x, y, 'A');
    };

    /** A run of live rail: a deck that is electrified on a cycle. */
    Grid.prototype.rail = function (x, y, w) {
        return this.fill(x, y, w, 1, 'Z');
    };

    /* ------------------------------------------------------------------ *
     * Actors
     * ------------------------------------------------------------------ */

    /**
     * Place an actor character, and refuse to bury anything.
     *
     * Actors go in open air — on top of a platform, not inside it. Writing one
     * over terrain, or over another actor, has never once been what was meant:
     * it is a ladder that grew a row longer than the author remembered, or two
     * features whose spans overlap. Both are silent. A stick of dynamite that
     * quietly became a ladder rung is a mine that cannot be finished, so this
     * throws at build time and names the tile.
     *
     * Water is the one exception, and it is a real one rather than a let-out:
     * a flooded sump with the stick lying on the bottom of it is the whole
     * point of the Deep Cut. Water is a medium you move through, not a thing
     * that occupies the tile.
     */
    Grid.prototype.put = function (ch, x, y) {
        const there = this.get(x, y);
        if (there !== '.' && there !== 'W') {
            throw new Error('actor "' + ch + '" at (' + x + ',' + y +
                ') would overwrite "' + there + '"');
        }
        return this.set(x, y, ch);
    };

    Grid.prototype.spawn = function (x, y) { return this.put('@', x, y); };
    Grid.prototype.tnt = function (x, y) { return this.put('D', x, y); };
    Grid.prototype.food = function (x, y) { return this.put('M', x, y); };
    Grid.prototype.heart = function (x, y) { return this.put('H', x, y); };
    Grid.prototype.oxygen = function (x, y) { return this.put('O', x, y); };

    /**
     * A run of ore nuggets along a surface.
     *
     * Steps *around* the shaft columns rather than throwing on them, and the
     * distinction from a single placement is deliberate. "Nuggets along this
     * deck" is a statement about the deck, and the shaft is a hole in it — the
     * author does not care which side of the hole each nugget lands. A `tnt` or
     * a `guardian` in a shaft column is the opposite: a specific placement, in
     * a place it cannot be, and that still throws.
     */
    Grid.prototype.ore = function (x, y, n, step) {
        const gap = step || 2;
        for (let i = 0; i < (n || 1); i++) {
            const cx = x + i * gap;
            if (SHAFT_COLS.indexOf(cx) >= 0) continue;
            this.put('C', cx, y);
        }
        return this;
    };

    /** A brass cog: hidden, and pointed out by the dog. Three to a mine. */
    Grid.prototype.cog = function (x, y) { return this.put('Y', x, y); };
    /** The lever that opens this room's gates. Walk into it. */
    Grid.prototype.lever = function (x, y) { return this.put('l', x, y); };
    /** One of the Governor's valves, standing on a deck. The vault has three. */
    Grid.prototype.valve = function (x, y) { return this.put('U', x, y); };
    /** A swinging hook, pivoted in the open air under a roof. */
    Grid.prototype.hook = function (x, y) { return this.put('k', x, y); };

    Grid.prototype.walker = function (x, y) { return this.put('B', x, y); };
    Grid.prototype.crawler = function (x, y) { return this.put('c', x, y); };
    Grid.prototype.dog = function (x, y) { return this.put('d', x, y); };
    Grid.prototype.bat = function (x, y) { return this.put('F', x, y); };
    Grid.prototype.spider = function (x, y) { return this.put('S', x, y); };
    Grid.prototype.guardian = function (x, y) { return this.put('g', x, y); };
    Grid.prototype.orb = function (x, y) { return this.put('o', x, y); };
    Grid.prototype.crusher = function (x, y) { return this.put('K', x, y); };
    Grid.prototype.boulder = function (x, y) { return this.put('P', x, y); };

    /**
     * A lift, authored as the *pair* of tiles at the ends of its run.
     *
     * Deriving the run by scanning outward from a single marker was tried and is
     * wrong: an open floor scans to the room walls, and bounding it with blocks
     * puts a one-tile step in the player's path — which in a game with no jump
     * is a wall. Two markers say exactly what was meant and cannot be defeated
     * by the room around them.
     *
     * A marker sits on the row a *rider* occupies, like a pickup does, so the
     * platform's surface is the bottom of that row. `liftRunH(6, 22, 22)` is a
     * tram that runs along the floor; `liftRunV(4, 22, 7)` is a cage that lifts
     * from the floor to the roof staging.
     */
    Grid.prototype.liftRunH = function (x0, x1, y) {
        this.put('h', x0, y);
        this.put('h', x1, y);
        return this;
    };

    Grid.prototype.liftRunV = function (x, y0, y1) {
        this.put('v', x, y0);
        this.put('v', x, y1);
        return this;
    };

    /* ------------------------------------------------------------------ *
     * Compound helpers
     * ------------------------------------------------------------------ */

    /**
     * A whole level in one call: several platform runs sharing a row.
     *
     * `g.deck(20, [3, 9], [15, 6], [26, 11])` lays three runs across row 20.
     * This is the workhorse of a dense room — six of these and the room already
     * has more structure than the entire no-jump build managed — and it exists
     * because writing `plat` six times per level made authors economise on
     * levels, which is exactly the wrong thing to economise on.
     *
     * @param {number} row  one of `LEVELS`
     * @param {...Array<number>} runs  `[x, width]` pairs
     */
    Grid.prototype.deck = function (row) {
        for (let i = 1; i < arguments.length; i++) {
            const run = arguments[i];
            if (!run) continue;
            this.plat(run[0], row, run[1]);
        }
        return this;
    };

    /**
     * A staircase of one-tile ledges climbing away from `x`.
     * @param {number} dir  +1 climbs to the right, -1 to the left
     */
    Grid.prototype.steps = function (x, row, count, dir, width) {
        const d = dir >= 0 ? 1 : -1;
        const w = width || 3;
        for (let i = 0; i < count; i++) {
            this.plat(x + d * i * (w + 1), row - i * 3, w);
        }
        return this;
    };

    /**
     * A platform with a ladder running down from it to the surface below.
     *
     * Rarer than it used to be, and it should be: with a three-row grid the
     * level below is a jump away, so a ladder here is a deliberate statement
     * that this climb is longer than a jump. Pass the surface row it reaches.
     */
    Grid.prototype.shelf = function (x, w, row, below, ladderAt) {
        this.plat(x, row, w);
        const lx = (ladderAt === undefined) ? x + 1 : ladderAt;
        this.ladder(lx, row, below - 1);
        return this;
    };

    /** Characters that represent an actor rather than terrain. */
    const ACTOR_CHARS = '@DCMHOBcdFSgoKPhvYlUk';

    /**
     * The ladder that carries a vertical room link. Runs the full height of the
     * room in the shaft columns; `World` opens the frame at the ends.
     *
     * Painted last in most rooms, so it overwrites whatever it crosses — which
     * is right for terrain and badly wrong for an actor. A crusher authored in
     * a shaft column simply vanished, and the room looked fine. Terrain it
     * covers is the author's business; an actor it covers is a mistake.
     */
    Grid.prototype.shaft = function (fromRow, toRow) {
        const y0 = (fromRow === undefined) ? 1 : fromRow;
        const y1 = (toRow === undefined) ? FLOOR_ROW - 1 : toRow;
        for (const cx of SHAFT_COLS) {
            for (let y = y0; y <= y1; y++) {
                const there = this.get(cx, y);
                if (ACTOR_CHARS.indexOf(there) >= 0) {
                    throw new Error('the shaft at column ' + cx + ' would bury actor "' +
                        there + '" at (' + cx + ',' + y + ')');
                }
                this.set(cx, y, '|');
            }
        }
        return this;
    };

    const Paint = {
        Grid: Grid,
        FLOOR_ROW: FLOOR_ROW,
        LEVELS: LEVELS,
        DOOR_ROWS: DOOR_ROWS,
        SHAFT_COLS: SHAFT_COLS,
        /** Build a grid from a builder function and hand back the string rows. */
        render: function (build) {
            const g = new Grid();
            build(g);
            const rows = g.toStrings();
            rows.wet = Array.from(g.wet);
            return rows;
        }
    };

    TNT.Paint = Paint;
})(window.TNT = window.TNT || {});
