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
 * THE JUMP, AND WHAT LADDERS ARE FOR
 * ----------------------------------
 * Tommy jumps three rows. That single number is the spine of the whole game and
 * every room is authored against it:
 *
 *   - **Three rows or fewer: jump it.** Standing surfaces sit on a three-row
 *     grid (`Paint.LEVELS`), so hopping from any level to the next is always on.
 *   - **Four rows or more: climb it.** A ladder, a hanging rope, a lift or a
 *     trampoline. There is no arrangement of platforms that gets you there.
 *
 * That is what keeps ladders load-bearing rather than decorative, and it is a
 * deliberately tight margin: `JUMP_APEX` clears a three-row gap with room to
 * spare and misses a four-row one clearly, so the player never has to measure a
 * ledge by eye. Change `JUMP_V` or `GRAVITY` and that margin moves — which
 * silently breaks the traversal of all twenty-seven rooms at once. The apex is
 * asserted in `scripts/smoke.mjs` for exactly that reason.
 *
 * Falling is forgiving on purpose. Both games this replaces let you drop the
 * height of a room for nothing, and it is what makes a dense climbing frame fun
 * to come back down: only the very longest falls cost anything, and none of them
 * kill outright.
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
        DETONATOR: 14,  // the plunger; the mine exit once every stick is in
        TRAMPOLINE: 15, // launches you higher than a jump reaches
        TELEPORT: 16,   // paired warp pads; press Down on one
        GATE: 17,       // a shutter: solid until the room's lever is thrown
        FAN: 18,        // a floor fan; the air above it lifts you
        RAIL: 19        // a live rail: a deck that carries current on a cycle
    };

    /** Tiles that stop horizontal movement outright. */
    C.SOLID_TILES = new Set([C.Tile.ROCK, C.Tile.CRACKED, C.Tile.GATE]);

    /** Tiles you can stand on from above but pass through from below. */
    C.ONEWAY_TILES = new Set([
        C.Tile.PLATFORM, C.Tile.CRUMBLE, C.Tile.BELT_R, C.Tile.BELT_L, C.Tile.TRAMPOLINE, C.Tile.RAIL
    ]);

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

    C.GRAVITY = 1500;          // px/s²
    C.MAX_FALL = 680;          // terminal velocity

    C.MOVE_MAX = 162;          // ground run speed — the Godot build's number
    C.MOVE_ACC = 1600;
    C.MOVE_FRICTION = 2100;    // deceleration with no input on the ground

    /* ---- the jump ---- */

    /**
     * Tuned from the *apex*, not picked by feel, because the apex is what the
     * level design depends on. `v = sqrt(2·g·h)`:
     *
     *   3 rows (48px) → needs 379 px/s   ✔ cleared with 8px to spare
     *   4 rows (64px) → needs 438 px/s   ✘ misses by 24px, unmistakably
     *
     * The gap between "obviously yes" and "obviously no" is the whole point. A
     * jump that *nearly* makes four rows would have players grinding at ledges
     * they were never meant to reach.
     */
    C.JUMP_V = 410;
    C.JUMP_APEX = (C.JUMP_V * C.JUMP_V) / (2 * C.GRAVITY);   // ≈ 56px, 3.5 tiles

    /** A grace window after walking off a ledge. Both originals had this. */
    C.COYOTE_TIME = 0.10;
    /** A jump pressed just before landing still fires. */
    C.JUMP_BUFFER = 0.12;
    /** Releasing early cuts the arc short — this is the variable-height jump. */
    C.CUT_GRAV_MUL = 2.7;
    /** Extra gravity on the way down, so the arc is snappy rather than floaty. */
    C.FALL_GRAV_MUL = 1.18;
    /** Sideways speed retained when jumping off a ladder or rope. */
    C.DISMOUNT_V = 148;

    /**
     * Air control. Tighter than the ground, but not much — Dynamite Dan and the
     * Godot build were both generous here, and a mine full of three-row hops
     * over spike beds is unpleasant if you cannot adjust mid-flight.
     */
    C.AIR_ACC = 900;
    C.AIR_MAX = 150;
    C.AIR_DRAG = 220;

    /* ---- feel ---- */

    /**
     * Turning round on the ground is faster than speeding up.
     *
     * Reversing at full speed used to take the same tenth of a second as
     * starting from rest, and on a narrow deck over a spike bed that tenth is
     * the difference between turning round and walking off the end. A skid is
     * shown, so the snap reads as a deliberate stop rather than a glitch.
     */
    C.TURN_ACC_MUL = 2.4;

    /**
     * Apex hang: gravity eases off near the top of a held jump.
     *
     * It is the few frames of float every good platformer has at the peak — the
     * moment the player adjusts their landing. Worth under a pixel of height, so
     * the three-row rule is untouched; `scripts/smoke.mjs` measures the apex in
     * the simulation, not just on paper, to keep it that way.
     */
    C.APEX_HANG_V = 70;
    C.APEX_HANG_MUL = 0.55;

    /**
     * Walls: slide down them, and kick off them.
     *
     * A wall-jump **must alternate walls**. Off one wall and then the other is
     * how you climb a chimney, and that is a skill worth having; off the same
     * wall twice is how you climb *any* wall, which would make every "four rows
     * needs a ladder" in the game negotiable. So the side you last kicked off
     * is locked until you touch the ground, a ladder or a rope.
     *
     * The kick's height is a jump's height at most — `WALL_JUMP_V` clears three
     * rows exactly — so even a chimney climb is three rows at a time.
     */
    C.WALL_SLIDE_V = 96;
    C.WALL_JUMP_V = 382;
    C.WALL_KICK = 178;
    C.WALL_JUMP_LOCK = 0.16;   // s of lost air control toward the wall after a kick
    C.WALL_COYOTE = 0.08;

    /**
     * Fans. The column of air above a floor fan lifts at `FAN_ACC` — more than
     * gravity, so it carries you — up to `FAN_V`, and runs at most `FAN_ROWS`
     * rows high. See `Machines.Fan`.
     */
    C.FAN_ACC = 2700;
    C.FAN_V = 190;
    C.FAN_ROWS = 10;

    C.CLIMB_V = 108;           // ladder, up and down
    C.VINE_V = 88;             // hanging rope — deliberately slower than a ladder

    /**
     * How far below the feet a step off a ladder will reach for a deck, in rows.
     *
     * Matching the feet row alone gave a window one tile tall — a sixth of a
     * second at `CLIMB_V`, and only while holding the direction — which from the
     * ladder is indistinguishable from the step-off not existing. Two rows of
     * reach makes it about three tiles. Going wider starts to teleport you down
     * past decks you meant to stop at.
     */
    C.STEP_OFF_REACH = 2;

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
     * the quick way down a shaft you could equally have climbed.
     */
    C.SLIDE_V = 200;
    C.ROPE_V = 100;            // hand-over-hand along a horizontal line
    C.ROPE_SAG = 3.0;          // px of sag at midspan under Tommy's weight
    C.MOUNT_SNAP = 90;         // px/s Tommy is pulled to a ladder's centre line

    /**
     * Fall consequences, as impact speed — `v = sqrt(2·g·h)`.
     *
     * Deliberately generous. A drop of thirteen tiles — more than half the
     * height of a room — costs nothing, and nothing kills outright. Both games
     * this replaces were the same, and it is what makes a dense climbing frame
     * enjoyable to come down: you climb deliberately and descend freely.
     *
     * An earlier build had these tight, and it was a mistake worth recording.
     * Punishing a five-tile drop forces every ledge onto a wide grid so the
     * player is never in doubt, which halves the number of levels a room can
     * hold and turns the game into ladders and empty air.
     *
     * Pitched at **two decks free, three decks costly**. Since decks are three
     * rows apart, that means hopping down a level or two is free — which is
     * what keeps a climbing frame quick to descend — and throwing yourself down
     * the height of a room is a real decision.
     *
     * An earlier pass had this so loose that only terminal velocity cost
     * anything, and dropping the full height of a room became strictly better
     * than climbing down. A traversal option with no downside is not an option.
     * Nothing kills outright, though; neither original did that either.
     *
     *   6 rows → 537 px/s   free
     *   7 rows → 580 px/s   costs
     *   9+ rows → 680 px/s  terminal, and the worst it gets
     */
    C.FALL_SAFE = 560;         // below this, landing costs nothing
    C.FALL_DMG = 18;           // energy cost of a heavier landing than that

    C.BELT_V = 88;             // conveyor push while standing on one
    C.VENT_SHOVE = 210;        // a steam jet scalds and shoves; it does not lift

    /**
     * Trampolines. Six rows of launch, which is exactly the point of them —
     * they are the one thing that reaches a ledge a jump cannot, without being
     * a ladder. Rooms use them where a climb would be tedious rather than
     * interesting, and where overshooting into a ceiling of spikes is a risk.
     */
    C.TRAMP_V = 580;
    C.TRAMP_APEX = (C.TRAMP_V * C.TRAMP_V) / (2 * C.GRAVITY);   // ≈ 112px, 7 tiles

    /** Warp pads, entered with Down. Paired by their letter within a room. */
    C.TELEPORT_DELAY = 0.35;   // s of wind-up, so it reads as a choice
    C.TELEPORT_LOCK = 0.6;     // s before the destination pad will fire again

    /** Swimming, which only works once the tank is found. */
    C.SWIM_V = 84;             // deliberate up/down paddle speed
    C.SWIM_GRAV = 0.20;        // fraction of gravity that still applies
    C.SWIM_DRAG = 2.6;         // per second; water is thick
    C.SWIM_MOVE = 0.7;         // horizontal speed multiplier

    /* ------------------------------------------------------------------ *
     * Game feel
     * ------------------------------------------------------------------ */

    /**
     * Hit-stop: the whole simulation holds for a few frames on an impact.
     *
     * The single cheapest way to make a hit *land*. A stomp that kills with no
     * pause reads as the enemy disappearing; the same stomp with seventy
     * milliseconds of freeze reads as a blow. The renderer keeps drawing
     * through it, so the shake and the particles carry the moment.
     */
    C.HITSTOP_STOMP = 0.07;
    C.HITSTOP_HURT = 0.12;
    C.HITSTOP_BLAST = 0.06;

    /** Nuggets drift to Tommy from this close, so sweeping a deck feels generous. */
    C.MAGNET_R = 30;
    C.MAGNET_V = 240;

    /**
     * Invulnerability after a hit. Long enough to get clear of whatever did
     * it, so one mistake is one hit and not a chain of them into a death.
     */
    C.HURT_INVULN = 1.7;
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

    /**
     * A full fuse burns out in this long, undisturbed.
     *
     * Was 150, which was more generous than either game this is modelled on —
     * Dynamite Dan drains its energy bar in about 110 seconds and the Godot
     * build in 80. Nine rooms in 110 seconds means you cannot sightsee, cannot
     * strip every room on the first pass, and have to decide what to leave.
     * That pressure is the point; without it the mine is a museum.
     */
    C.FUSE_SECONDS = 110;
    C.FOOD_ENERGY = 30;

    /**
     * Meals do not come back.
     *
     * They used to, after 75 seconds, and it quietly removed the whole
     * mechanic: a player short of fuse could stand in a room and wait for
     * lunch. Food is now a fixed budget for the mine, which turns every meal
     * into a decision about *when* rather than a tap you repeat.
     */
    C.FOOD_RESPAWN = 0;
    C.DANGER_BELOW = 30;       // energy at which the danger track takes over
    C.DANGER_CLEAR = 42;       // and the energy it has to recover to before it lets go

    /**
     * What a hit costs, out of a full fuse of 100.
     *
     * Brought down across the board after play-testing found the game "a
     * little too easy to die" in. At the old values three touches ended a life
     * — and with more enemies that shoot, swoop and roll, three touches came
     * quickly. Now it is four or five, and the fuse is still the thing that
     * runs out if you play slowly, which is the pressure the game is meant to
     * have. Crushers stay the dearest: a piston is always telegraphed.
     */
    C.DMG_ENEMY = 22;
    C.DMG_RIVET = 16;          // a minecart bot's shot
    C.DMG_RAIL = 16;           // standing on a live rail
    C.DMG_HOOK = 20;           // struck by a swinging hook
    C.DMG_SPIKE = 24;
    C.DMG_VENT = 18;
    C.DMG_CRUSH = 34;
    C.DMG_BOULDER = 22;
    C.DROWN_RATE = 30;         // energy per second underwater without the tank

    /* ------------------------------------------------------------------ *
     * Stomping
     *
     * Landing on something is the one answer the mine did not have. Every
     * enemy could be blasted or avoided and nothing else, which left the
     * guardian — slow, wall-ignoring, permanently on your heels — as pressure
     * with no counter-play at all: the only reply to it was to keep walking.
     *
     * A stomp needs real downward speed so that brushing an enemy while
     * walking, or clipping one at the top of a hop, is still a hit. Roughly a
     * third of a full jump's terminal speed.
     * ------------------------------------------------------------------ */
    C.STOMP_MIN_V = 120;       // px/s of fall needed for a landing to count
    C.STOMP_BAND = 0.35;       // how far below the enemy's centre the feet may be
    C.STOMP_BOUNCE = 300;      // px/s up off the kill — below a full jump's 410
    /**
     * Holding jump through a stomp bounces higher — the standard reward for
     * timing it — but never a full jump. From an enemy's head a full jump
     * would clear four rows, and the three-row rule is not something an enemy
     * standing in the right place should be able to break.
     */
    C.STOMP_BOUNCE_HELD = 372;
    /** Each stomp in a chain, without touching the ground, scores this many more times. */
    C.STOMP_CHAIN_MAX = 8;
    C.SCORE_STOMP = 150;

    /**
     * The guardian comes back.
     *
     * Stomping it has to be worth doing and must not remove the room's pressure
     * for good, or a single hop turns the hardest rooms in the mine into empty
     * ones. It reforms at the spot it was first posted, which also keeps it
     * from reappearing on top of the player.
     */
    C.GUARDIAN_REFORM = 9;     // s

    /* ------------------------------------------------------------------ *
     * Rising lava, and the run out
     * ------------------------------------------------------------------ */

    /**
     * Flood rooms. The molten level climbs while you are in the room and only
     * while you are in it — a flood that rose in your absence would mean coming
     * back to a room you can no longer enter, with no way to know in advance.
     * It drains back down once you leave.
     */
    C.FLOOD_RISE = 11;         // px/s the surface climbs
    C.FLOOD_DRAIN = 26;        // px/s it falls back once the room is empty
    C.FLOOD_CEILING = 3;       // tiles from the top that it stops at

    /**
     * The run out. Taking the last stick starts the seam coming down: the fuse
     * is replaced by a hard countdown to reach the vault. Dynamite Dan's best
     * idea, and the one that turns a collection game into a route-planning one —
     * you spend the whole mine deciding where to leave the twelfth stick.
     */
    C.ESCAPE_SECONDS = 62;
    C.ESCAPE_WARN = 15;        // s remaining at which the HUD starts shouting

    /* ------------------------------------------------------------------ *
     * Objective and scoring
     * ------------------------------------------------------------------ */

    C.TNT_PER_MINE = 12;

    C.SCORE_TNT = 100;
    C.SCORE_ORE = 25;
    C.SCORE_FOOD = 10;
    C.SCORE_HEART = 500;
    C.SCORE_ENEMY = 50;        // per enemy caught in a blast
    C.SCORE_MEDAL = 250;       // every nugget in a room taken — earns its medal
    C.SCORE_ALL_MEDALS = 2000; // and every room in the mine medalled
    C.SCORE_LIFE_BONUS = 500;  // per life still held when a mine blows
    C.SCORE_TIME_BASE = 15000; // decays by SCORE_TIME_DECAY per second elapsed
    C.SCORE_TIME_DECAY = 25;
    C.SCORE_COG = 500;         // a brass cog, found by the dog

    /**
     * Coins are money.
     *
     * They used to be worth twenty-five points and nothing else, which a
     * player rightly asked the point of. Now every coin goes in the purse and
     * is spent at the workshop between mines, and every hundred picked up is a
     * spare helmet on the spot — the oldest reward in platforming, and the one
     * that makes stripping a deck worth the detour. A mine holds about 110.
     */
    C.COINS_PER_LIFE = 100;
    C.SCORE_VALVE = 1000;      // one of the Governor's valves
    C.SCORE_GOVERNOR = 5000;   // and the Governor itself

    /** Cogs hidden in each mine. `scripts/smoke.mjs` holds every mine to it. */
    C.COGS_PER_MINE = 3;
    /**
     * How close Tommy has to be before the dog smells a cog, in px.
     *
     * Near enough that the find belongs to the player who went looking — the
     * dog confirms a hunch, it does not do the exploring — and far enough that
     * a cog behind a wall or up a shaft is still pointed at from the room it
     * is in.
     */
    C.SNIFF_R = C.TILE * 6;

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
            fuseMul: 1.0,          // 110s
            enemyMul: 1.15,
            palette: 'copper'
        },
        {
            id: 'blackdamp',
            name: 'BLACKDAMP',
            subtitle: 'Level Two',
            fuseMul: 0.84,         // 92s
            enemyMul: 1.38,
            palette: 'slate'
        },
        {
            id: 'cinderdeep',
            name: 'CINDERDEEP',
            subtitle: 'Level Three',
            fuseMul: 0.70,         // 77s, the Godot build's number
            enemyMul: 1.62,
            palette: 'ember'
        }
    ];

    C.STORAGE_KEY = 'tnt-tommy.v1';

    TNT.C = C;
})(window.TNT = window.TNT || {});
