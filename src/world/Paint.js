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
 * Standing surfaces sit on `LEVELS`, five rows apart. That spacing is the same
 * number `C.FALL_SAFE` is derived from, which is what makes every ledge in the
 * game safe to step off and every shaft dangerous to fall down. Author a ledge
 * off the grid and you have made a drop the player has to measure by eye — in a
 * game with no jump button, that is a bad ledge.
 */
(function (TNT) {
    'use strict';

    const { C } = TNT;

    /** Bedrock. The walkable surface of a room is the top of this row. */
    const FLOOR_ROW = C.ROWS - 1;              // 23

    /** Standing surfaces, floor first. Five rows apart — see the header. */
    const LEVELS = [FLOOR_ROW, 18, 13, 8, 3];

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
        if (this.inside(x, y)) this.cells[y][x] = ch;
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

    Grid.prototype.detonator = function (x, y) {
        return this.set(x, y, 'G');
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

    /** A run of ore nuggets along a surface. */
    Grid.prototype.ore = function (x, y, n, step) {
        const gap = step || 2;
        for (let i = 0; i < (n || 1); i++) this.put('C', x + i * gap, y);
        return this;
    };

    Grid.prototype.walker = function (x, y) { return this.put('B', x, y); };
    Grid.prototype.bat = function (x, y) { return this.put('F', x, y); };
    Grid.prototype.crawler = function (x, y) { return this.put('S', x, y); };
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
     * A shelf: a platform with a ladder down to the surface below it.
     * The overwhelmingly common structure, so it is one call.
     *
     * @param {number} x      left edge of the platform
     * @param {number} w      platform width
     * @param {number} row    the platform's row (should be one of `LEVELS`)
     * @param {number} below  the surface row the ladder reaches down to
     * @param {number} [ladderAt]  column for the ladder; defaults to the left end
     */
    Grid.prototype.shelf = function (x, w, row, below, ladderAt) {
        this.plat(x, row, w);
        const lx = (ladderAt === undefined) ? x + 1 : ladderAt;
        this.ladder(lx, row, below - 1);
        return this;
    };

    /**
     * The ladder that carries a vertical room link. Runs the full height of the
     * room in the shaft columns; `World` opens the frame at the ends.
     */
    Grid.prototype.shaft = function (fromRow, toRow) {
        const y0 = (fromRow === undefined) ? 1 : fromRow;
        const y1 = (toRow === undefined) ? FLOOR_ROW - 1 : toRow;
        for (const cx of SHAFT_COLS) this.fill(cx, y0, 1, y1 - y0 + 1, '|');
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
            return g.toStrings();
        }
    };

    TNT.Paint = Paint;
})(window.TNT = window.TNT || {});
