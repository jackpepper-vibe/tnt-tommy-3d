/**
 * TNT Tommy — tuning, tile vocabulary and world dimensions.
 *
 * UNITS
 * -----
 * Gameplay is authored in *pixels*, one tile being TILE px, exactly as the two
 * builds this replaces were. The renderer converts: one tile is one world unit,
 * so `R3D.PX` is 1/TILE. Keeping the simulation in pixels means every tuning
 * value carried over from the earlier games is still meaningful, and nothing in
 * `src/r3d/` has to be consulted to reason about movement.
 *
 * NO JUMPING
 * ----------
 * This is the design constraint the whole game hangs off. Tommy cannot leave the
 * ground under his own power — every metre of height is a ladder, a hanging rope,
 * a lift or a fall. That makes three things matter far more than they would in a
 * jumping platformer:
 *
 *   - **Air steering.** A drop is a deliberate traversal move, so you must be able
 *     to aim one. `AIR_ACC` is generous where a jumping game would keep it tight.
 *   - **Fall thresholds.** Falling is a tool, not a failure, so short drops are
 *     free. Long ones have to bite or ladders would be decoration.
 *   - **Connectivity.** A room with an unreachable ledge is a broken room, not a
 *     hard one. `scripts/validate-world.mjs` proves every pickup reachable under
 *     exactly these constants.
 */
(function (TNT) {
    'use strict';

    const C = {};

    /* ------------------------------------------------------------------ *
     * World geometry
     * ------------------------------------------------------------------ */

    /** Pixels per tile. The art is authored at this scale. */
    C.TILE = 16;

    /** A room is one screen. 42x24 tiles is 672x384 px — a shade under 16:9. */
    C.COLS = 42;
    C.ROWS = 24;
    C.ROOM_W = C.COLS * C.TILE;   // 672
    C.ROOM_H = C.ROWS * C.TILE;   // 384

    /** Rooms per mine, laid out as a flick-screen grid. */
    C.MINE_COLS = 3;
    C.MINE_ROWS = 3;
    C.MINE_COUNT = 3;

    /* ------------------------------------------------------------------ *
     * Tiles
     * ------------------------------------------------------------------ */

    /**
     * The static tile vocabulary. Anything with per-instance state (a lift's
     * path, a crusher's phase, a pickup's respawn timer) is an entity instead —
     * see `Tiles.ENTITY_CHARS`.
     */
    C.Tile = {
        EMPTY: 0,
        ROCK: 1,        // solid on all sides
        PLATFORM: 2,    // one-way: land on it, press Down to drop through
        LADDER: 3,      // rigid, climbed at full speed
        ROPE: 4,        // horizontal line, crossed hand-over-hand
        VINE: 5,        // hanging rope, climbed slower than a ladder, sways
        SPIKE: 6,
        CRUMBLE: 7,     // stands briefly under weight, then collapses
        CRACKED: 8,     // solid until a blast opens it
        BELT_R: 9,      // conveyor, pushes right
        BELT_L: 10,     // conveyor, pushes left
        VENT: 11,       // steam vent in the floor, jets upward on a cycle
        LAVA: 12,       // instant death
        WATER: 13,      // drowns you without the oxygen tank
        DETONATOR: 14   // the plunger; the mine exit once every stick is in
    };

    /** Tiles that stop horizontal movement outright. */
    C.SOLID_TILES = new Set([C.Tile.ROCK, C.Tile.CRACKED]);

    /** Tiles you can stand on from above but pass through from below. */
    C.ONEWAY_TILES = new Set([C.Tile.PLATFORM, C.Tile.CRUMBLE, C.Tile.BELT_R, C.Tile.BELT_L]);

    /** Tiles that can be climbed vertically. */
    C.CLIMB_TILES = new Set([C.Tile.LADDER, C.Tile.VINE]);

    /* ------------------------------------------------------------------ *
     * Movement
     * ------------------------------------------------------------------ */

    C.FIXED_DT = 1 / 120;      // physics step; the loop accumulates to this
    C.MAX_STEPS = 8;           // catch-up cap, so a stalled tab cannot spiral

    /**
     * Tommy's collision box, in pixels. Narrower than a tile so he fits a
     * single-tile gap without catching on the corners, and shorter than two so
     * a two-tile opening is comfortably a doorway. His position is his *feet*:
     * `x` is the centre of the box, `y` its bottom edge. Every surface test in
     * the game reads better that way round, because what a platformer actually
     * asks about is what is under the feet.
     */
    C.PLAYER_W = 11;
    C.PLAYER_H = 20;

    C.GRAVITY = 1250;          // px/s²
    C.MAX_FALL = 640;          // terminal velocity

    C.MOVE_MAX = 150;          // ground run speed
    C.MOVE_ACC = 1350;
    C.MOVE_FRICTION = 1900;    // deceleration with no input on the ground

    /**
     * Air control. Wide open compared with a jumping platformer: every drop here
     * is aimed, and a fall you cannot steer is a fall you cannot plan.
     */
    C.AIR_ACC = 700;
    C.AIR_MAX = 132;
    C.AIR_DRAG = 180;

    C.CLIMB_V = 108;           // ladder, up and down
    C.VINE_V = 88;             // hanging rope — deliberately slower than a ladder

    /**
     * Falling *through* a ladder column is a controlled slide, not a drop.
     *
     * A ladder has to punch a hole through the deck it serves, or it would not
     * be continuous to climb — so every ladder in the game is also a gap in a
     * walkway, and the shaft that links two rooms is a gap in the *floor*.
     * Without this, walking into one is a full room-height fall into the room
     * below, which is fatal, and the map is full of them.
     *
     * Capping the speed turns all of that from a trap into a fireman's pole:
     * the quick way down a shaft you could equally have climbed. It gives no
     * height, so the no-jump rule is untouched.
     */
    C.SLIDE_V = 200;
    C.ROPE_V = 100;            // hand-over-hand along a horizontal line
    C.ROPE_SAG = 3.0;          // px of sag at midspan under Tommy's weight
    C.MOUNT_SNAP = 90;         // px/s Tommy is pulled to a ladder's centre line

    /**
     * Fall consequences, as impact speeds — `v = sqrt(2·g·h)`.
     *
     * These are not arbitrary: they are pinned to the level grid. Rooms are
     * authored on levels five tiles apart (`LEVEL_ROWS` in `Rooms.js`), so
     * stepping off any ledge onto the next one down is always free, and the
     * player never has to measure a drop by eye. Six to nine tiles hurts; ten
     * or more — which in practice means a shaft you were meant to climb —
     * kills. Change GRAVITY or the level spacing and these must move with them.
     *
     *   5 tiles →  447 px/s   safe
     *   6 tiles →  490 px/s   hurts
     *   9 tiles →  600 px/s   hurts
     *  10 tiles →  632 px/s   fatal
     */
    C.FALL_SAFE = 450;         // below this, landing costs nothing
    C.FALL_FATAL = 620;        // at or above this, the landing kills outright
    C.FALL_DMG = 26;           // energy cost of a landing between the two

    C.BELT_V = 88;             // conveyor push while standing on one

    /**
     * A steam jet shoves you sideways and scalds. It does *not* lift.
     * A vent that threw Tommy three tiles up would be a jump button with extra
     * steps, and the whole game is built on there not being one.
     */
    C.VENT_SHOVE = 210;

    /** Swimming, which only works once the tank is found. */
    C.SWIM_V = 84;             // deliberate up/down paddle speed
    C.SWIM_GRAV = 0.20;        // fraction of gravity that still applies
    C.SWIM_DRAG = 2.6;         // per second; water is thick
    C.SWIM_MOVE = 0.7;         // horizontal speed multiplier

    /* ------------------------------------------------------------------ *
     * Game feel
     * ------------------------------------------------------------------ */

    C.LEDGE_GRACE = 0.08;      // s of forgiveness stepping off an edge onto a ladder
    C.HURT_INVULN = 1.1;       // s of invulnerability after taking a hit
    C.RESPAWN_INVULN = 1.8;
    C.DEATH_FREEZE = 0.9;      // s of death animation before the respawn
    C.CHECKPOINT_DWELL = 0.35; // s stood safely on the ground before it counts

    /* ------------------------------------------------------------------ *
     * Run state
     * ------------------------------------------------------------------ */

    C.LIVES_START = 3;
    C.LIVES_MAX = 5;

    /**
     * The fuse. It is the energy bar and the clock at once — the mechanic the
     * Godot build hangs its tension on. It drains on its own, damage takes a
     * bite out of it, and food is the only way to put any back.
     */
    C.ENERGY_MAX = 100;
    C.FUSE_SECONDS = 150;      // a full fuse burns out in this long, undisturbed
    C.FOOD_ENERGY = 34;
    C.FOOD_RESPAWN = 75;       // s before an eaten meal returns
    C.DANGER_BELOW = 25;       // energy at which the danger track takes over
    C.DANGER_CLEAR = 35;       // and the energy it has to recover to before it lets go

    C.DMG_ENEMY = 30;
    C.DMG_SPIKE = 34;
    C.DMG_VENT = 24;
    C.DMG_CRUSH = 45;
    C.DMG_BOULDER = 32;
    C.DROWN_RATE = 26;         // energy per second underwater without the tank

    /* ------------------------------------------------------------------ *
     * Objective and scoring
     * ------------------------------------------------------------------ */

    C.TNT_PER_MINE = 12;

    C.SCORE_TNT = 100;
    C.SCORE_ORE = 25;
    C.SCORE_FOOD = 10;
    C.SCORE_HEART = 500;
    C.SCORE_ENEMY = 50;        // per enemy caught in a blast
    C.SCORE_ROOM_CLEAR = 200;  // every ore in a room collected
    C.SCORE_LIFE_BONUS = 500;  // per life still held when a mine blows
    C.SCORE_TIME_BASE = 15000; // decays by SCORE_TIME_DECAY per second elapsed
    C.SCORE_TIME_DECAY = 25;

    /* ------------------------------------------------------------------ *
     * Dynamite
     * ------------------------------------------------------------------ */

    /**
     * A collected stick can be spent to blow a cracked wall — it respawns where
     * it was found, so spending one costs time rather than progress. This is the
     * only verb that changes the shape of a room, and with no jump it is often
     * the only way past.
     */
    C.BLAST_RADIUS = 40;       // px; opens CRACKED tiles within this range
    C.BLAST_KILL_R = 56;       // px; destroys enemies within this range
    C.BLAST_FUSE = 1.1;        // s between planting and the bang
    C.BLAST_COOLDOWN = 0.5;

    /* ------------------------------------------------------------------ *
     * Hazard cycles
     * ------------------------------------------------------------------ */

    C.VENT_CYCLE = 3.4;        // s, total
    C.VENT_WARN = 2.5;         // s into the cycle: hiss and wisp
    C.VENT_BLAST = 2.9;        // s into the cycle: the jet fires
    C.VENT_TILES = 3;          // jet height, in tiles

    C.CRUSH_CYCLE = 2.9;
    C.CRUSH_WARN = 1.9;
    C.CRUSH_SLAM = 2.2;
    C.CRUSH_TILES = 4;         // slam travel, in tiles

    C.BOULDER_CYCLE = 2.7;
    C.BOULDER_GRAV = 900;

    C.CRUMBLE_SHAKE = 0.5;     // s of warning under load
    C.CRUMBLE_FALL = 0.45;     // s of collapse animation
    C.CRUMBLE_BACK = 3.0;      // s before it reforms

    C.LIFT_V = 52;             // moving platform speed
    C.LIFT_PAUSE = 0.7;        // s held at each end of the run
    C.LIFT_W = 4;              // platform width, in tiles
    C.LIFT_H = 6;              // platform thickness, in px

    /* ------------------------------------------------------------------ *
     * Per-mine escalation
     * ------------------------------------------------------------------ */

    /**
     * The three mines share their room shapes but not their pressure. Each mine
     * scales the fuse, the enemies and the palette; `World.build` applies the
     * hazard substitutions that go with them.
     */
    C.MINES = [
        {
            id: 'copperlode',
            name: 'COPPERLODE',
            subtitle: 'Level One',
            fuseMul: 1.0,
            enemyMul: 1.0,
            palette: 'copper'
        },
        {
            id: 'blackdamp',
            name: 'BLACKDAMP',
            subtitle: 'Level Two',
            fuseMul: 0.86,
            enemyMul: 1.18,
            palette: 'slate'
        },
        {
            id: 'cinderdeep',
            name: 'CINDERDEEP',
            subtitle: 'Level Three',
            fuseMul: 0.74,
            enemyMul: 1.36,
            palette: 'ember'
        }
    ];

    C.STORAGE_KEY = 'tnt-tommy.v1';

    TNT.C = C;
})(window.TNT = window.TNT || {});
