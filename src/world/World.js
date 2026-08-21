/**
 * TNT Tommy — world assembly.
 *
 * Turns the authored rooms into the structure the game plays on: parsed tile
 * arrays, a wired-up room graph, and the doorways cut into the frames.
 *
 * ROOM-LOCAL COORDINATES
 * ----------------------
 * There is no world-space position in this game. Tommy has a room index and a
 * position *inside* that room, in pixels, and crossing an edge swaps the index
 * and wraps the coordinate. That is what a flick-screen game is, and it buys
 * three things worth having: collision only ever consults one 42x24 array, the
 * renderer only ever builds one room's geometry, and entities can never
 * interact across a screen boundary — which is exactly the behaviour the
 * originals had and players expect.
 *
 * PRISTINE VERSUS LIVE
 * --------------------
 * A room keeps two tile arrays. `base` is what was authored; `live` is what the
 * run has done to it — walls blown open, planks collapsed. Starting a mine
 * copies one over the other. Without the split, dying after blowing a wall
 * would leave the wall open, and the second life would be playing a different
 * mine from the first.
 */
(function (TNT) {
    'use strict';

    const { C, Tiles, Paint } = TNT;
    const T = C.Tile;

    /* ------------------------------------------------------------------ *
     * Room
     * ------------------------------------------------------------------ */

    function Room(def, index) {
        this.index = index;
        this.id = def.id;
        this.name = def.name;
        this.cell = def.cell;
        this.exits = def.exits;
        /** Flood rooms: the lava bed rises while you are standing in it. */
        this.flooding = !!def.flooding;
        /** Shown once, on arrival, under the room name. */
        this.blurb = def.blurb || '';

        const parsed = Tiles.parse(Paint.render(def.build), def.id);
        this.base = parsed.tiles;
        this.live = new Uint8Array(parsed.tiles);
        this.spawns = parsed.spawns;

        /** Room indices, or -1. Filled in by `link()`. */
        this.neighbours = { left: -1, right: -1, up: -1, down: -1 };

        /** Ore in this room, for the room-clear bonus. Counted at build time. */
        this.oreCount = parsed.spawns.filter(function (s) { return s.kind === 'ore'; }).length;
    }

    /** Restore the room to as-authored. Called when a mine starts. */
    Room.prototype.reset = function () {
        this.live.set(this.base);
    };

    Room.prototype.get = function (tx, ty) {
        if (tx < 0 || ty < 0 || tx >= C.COLS || ty >= C.ROWS) return T.ROCK;
        return this.live[ty * C.COLS + tx];
    };

    Room.prototype.set = function (tx, ty, t) {
        if (tx < 0 || ty < 0 || tx >= C.COLS || ty >= C.ROWS) return;
        this.live[ty * C.COLS + tx] = t;
    };

    /** Tile under a pixel position. */
    Room.prototype.at = function (px, py) {
        return this.get(Math.floor(px / C.TILE), Math.floor(py / C.TILE));
    };

    /**
     * True where a ladder's topmost tile is.
     *
     * The cap is what lets Tommy stand on a ladder head instead of sliding down
     * it, and what lets him mount one from above by pressing Down. Derived
     * rather than stored so blowing a wall above a ladder cannot leave a stale
     * cap behind.
     */
    Room.prototype.isClimbTop = function (tx, ty) {
        return Tiles.isClimbable(this.get(tx, ty)) && !Tiles.isClimbable(this.get(tx, ty - 1));
    };

    /* ------------------------------------------------------------------ *
     * Mine
     * ------------------------------------------------------------------ */

    function Mine(index) {
        const meta = C.MINES[index];
        this.index = index;
        this.id = meta.id;
        this.name = meta.name;
        this.subtitle = meta.subtitle;
        this.palette = meta.palette;
        this.fuseMul = meta.fuseMul;
        this.enemyMul = meta.enemyMul;

        const defs = TNT.Rooms.MINES[index];
        if (!defs) throw new Error('no room set authored for mine ' + index);
        this.rooms = defs.map(function (def, i) {
            return new Room(def, i);
        });

        this.byCell = new Map();
        for (const room of this.rooms) {
            this.byCell.set(cellKey(room.cell[0], room.cell[1]), room);
        }

        cutFrames(this);
        link(this);

        const found = locateSpawn(this);
        this.spawnRoom = found.room;
        this.spawnX = found.x;
        this.spawnY = found.y;

        this.tntTotal = this.rooms.reduce(function (n, r) {
            return n + r.spawns.filter(function (s) { return s.kind === 'tnt'; }).length;
        }, 0);
    }

    Mine.prototype.reset = function () {
        for (const room of this.rooms) room.reset();
    };

    Mine.prototype.roomAt = function (cx, cy) {
        return this.byCell.get(cellKey(cx, cy)) || null;
    };

    function cellKey(cx, cy) {
        return cy * C.MINE_COLS + cx;
    }

    /* ------------------------------------------------------------------ *
     * Frames and links
     * ------------------------------------------------------------------ */

    /** How far a shaft ladder reaches into the room from the seam it crosses. */
    const STUB = 6;

    /**
     * Cut the doorways and lay the shaft stubs.
     *
     * Done here rather than in the room builders on purpose: two neighbours can
     * never disagree about where an opening is, and adding a link to a room is
     * a one-word change to its `exits` rather than an edit to two grids.
     *
     * **The stubs are short.** A vertical link used to be a ladder running the
     * full height of the room, and that single decision was most of what made
     * the mine feel like a ladder farm: forty-six tiles of ladder per room
     * against Dynamite Dan's thirteen, measured. It is also redundant — with
     * decks three rows apart the player can jump the whole height anyway, so a
     * full-height ladder is a lift running beside a staircase. Six rows at each
     * end is enough to carry the seam and no more; `scripts/room-stats.mjs`
     * watches the number.
     */
    function cutFrames(mine) {
        for (const room of mine.rooms) {
            if (room.exits.left) {
                for (const ty of Paint.DOOR_ROWS) room.set(0, ty, T.EMPTY);
            }
            if (room.exits.right) {
                for (const ty of Paint.DOOR_ROWS) room.set(C.COLS - 1, ty, T.EMPTY);
            }

            // A shaft mouth becomes ladder, not empty: the climb has to continue
            // across the seam or Tommy drops out of it the moment he arrives.
            if (room.exits.up) {
                for (const tx of Paint.SHAFT_COLS) {
                    for (let ty = 0; ty <= STUB; ty++) room.set(tx, ty, T.LADDER);
                }
            }
            if (room.exits.down) {
                for (const tx of Paint.SHAFT_COLS) {
                    for (let ty = C.ROWS - 1 - STUB; ty <= C.ROWS - 1; ty++) {
                        room.set(tx, ty, T.LADDER);
                    }
                }
            }
            room.base.set(room.live);
        }
    }

    const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };
    const STEP = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

    /**
     * Wire neighbours, and refuse to build a mine whose links do not agree.
     *
     * A one-sided exit is the failure that costs the most to find by playing:
     * the doorway is cut, the player walks through it, and the transition has
     * nowhere to go. Cheaper to throw at load.
     */
    function link(mine) {
        for (const room of mine.rooms) {
            for (const dir in room.exits) {
                const step = STEP[dir];
                const other = mine.roomAt(room.cell[0] + step[0], room.cell[1] + step[1]);
                if (!other) {
                    throw new Error(mine.id + '/' + room.id + ': exit "' + dir + '" leads off the mine');
                }
                if (!other.exits[OPPOSITE[dir]]) {
                    throw new Error(mine.id + '/' + room.id + ': exit "' + dir + '" is not matched by "' +
                        OPPOSITE[dir] + '" in ' + other.id);
                }
                room.neighbours[dir] = other.index;
            }
        }
    }

    /** Exactly one `@` per mine, please. */
    function locateSpawn(mine) {
        let found = null;
        for (const room of mine.rooms) {
            for (const s of room.spawns) {
                if (s.kind !== 'spawn') continue;
                if (found) {
                    throw new Error(mine.id + ': more than one spawn point');
                }
                found = {
                    room: room.index,
                    x: s.tx * C.TILE + C.TILE / 2,
                    y: s.ty * C.TILE + C.TILE
                };
            }
        }
        if (!found) throw new Error(mine.id + ': no spawn point');
        return found;
    }

    /* ------------------------------------------------------------------ *
     * Module
     * ------------------------------------------------------------------ */

    const World = {
        Room: Room,
        Mine: Mine,

        /** Build all three mines. Throws on any authoring fault. */
        buildAll: function () {
            const mines = [];
            for (let i = 0; i < C.MINE_COUNT; i++) mines.push(new Mine(i));
            return mines;
        },

        /**
         * Where a room transition puts you.
         *
         * Crossing a side doorway keeps your height and enters at the opposite
         * wall; crossing a shaft mouth keeps your column and enters at the
         * opposite ceiling or floor. The inset is a whole tile rather than a
         * pixel so you are never left overlapping the frame you just came
         * through, which would bounce you straight back.
         *
         * @returns {{x: number, y: number}} the entry position in the new room
         */
        transitionPos: function (dir, x, y) {
            switch (dir) {
                case 'left':  return { x: C.ROOM_W - C.TILE * 0.75, y: y };
                case 'right': return { x: C.TILE * 0.75, y: y };
                case 'up':    return { x: x, y: C.ROOM_H - C.TILE * 0.5 };
                case 'down':  return { x: x, y: C.TILE * 0.5 };
                default:      return { x: x, y: y };
            }
        }
    };

    TNT.World = World;
})(window.TNT = window.TNT || {});
