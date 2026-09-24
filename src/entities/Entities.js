/**
 * TNT Tommy — everything in a room that is not terrain.
 *
 * Pickups, patrols, machinery and lifts. One file because they share a small
 * interface and splitting four-line behaviours across four files buys nothing:
 * every entity has `update(dt, room)`, a `box()` for overlap tests, and a
 * `kind` the renderer reads.
 *
 * PATROL SPANS ARE DERIVED, NOT AUTHORED
 * --------------------------------------
 * A room places a walker with one character. Its beat is worked out from the
 * floor it is standing on: scan left and right until the ground runs out or a
 * wall gets in the way. Authoring the span by hand was the alternative, and it
 * rots — move a platform and every patrol on it is silently wrong, walking
 * through walls or turning round in mid-air. Deriving it means the level *is*
 * the specification.
 *
 * ENTITIES DO NOT READ INPUT AND DO NOT DRAW
 * ------------------------------------------
 * Nothing here imports the player or touches `src/r3d/`. The player is passed
 * in where an entity needs it, the renderer reads entity state and never writes
 * it. That is the same one-way arrow the room graph has, for the same reason.
 */
(function (TNT) {
    'use strict';

    const { C, Util, Tiles } = TNT;
    const T = C.Tile;

    /* ------------------------------------------------------------------ *
     * Shared
     * ------------------------------------------------------------------ */

    function box(x, y, w, h) {
        return { x: x, y: y, w: w, h: h };
    }

    /** Centre of a tile, in pixels. */
    function tileCentre(t) {
        return t * C.TILE + C.TILE / 2;
    }

    /* ------------------------------------------------------------------ *
     * Pickups
     * ------------------------------------------------------------------ */

    const PICKUP_SPEC = {
        tnt:    { w: 10, h: 14, score: C.SCORE_TNT,   glow: true,  respawn: 0 },
        ore:    { w: 9,  h: 9,  score: C.SCORE_ORE,   glow: true,  respawn: 0 },
        food:   { w: 11, h: 11, score: C.SCORE_FOOD,  glow: true,  respawn: C.FOOD_RESPAWN },
        heart:  { w: 12, h: 11, score: C.SCORE_HEART, glow: true,  respawn: 0 },
        oxygen: { w: 10, h: 14, score: 0,             glow: true,  respawn: 0 },
        cog:    { w: 14, h: 14, score: C.SCORE_COG,   glow: true,  respawn: 0 }
    };

    function Pickup(kind, tx, ty) {
        const spec = PICKUP_SPEC[kind];
        this.kind = kind;
        this.spec = spec;
        this.homeX = tileCentre(tx);
        this.homeY = ty * C.TILE + C.TILE;    // resting on the surface below
        this.x = this.homeX;
        this.y = this.homeY;
        this.taken = false;
        this.timer = 0;
        /** Bob phase, fixed per pickup so the room breathes rather than pulses. */
        this.phase = (tx * 7 + ty * 13) % 100 / 100 * Math.PI * 2;
        this.t = 0;
        /** Offset from home while being drawn in by the magnet. */
        this.pullX = 0;
        this.pullY = 0;
        /**
         * Cogs start hidden: not drawn, until the dog smells one out. They can
         * still be walked into and collected blind — a secret found by
         * accident is still found.
         */
        this.revealed = kind !== 'cog';
    }

    Pickup.prototype.update = function (dt) {
        this.t += dt;
        if (this.taken) {
            // Only food comes back, and only after long enough that eating it
            // is a decision about the route rather than a tap you repeat.
            if (this.spec.respawn > 0) {
                this.timer -= dt;
                if (this.timer <= 0) this.taken = false;
            }
            return;
        }
        this.x = this.homeX + this.pullX;
        this.y = this.homeY + this.pullY + Math.sin(this.t * 2.4 + this.phase) * 1.8;
    };

    /** Drift toward a point, if it is within `C.MAGNET_R`. */
    Pickup.prototype.attract = function (px, py, dt) {
        const dx = px - this.x, dy = py - this.y;
        const d = Math.hypot(dx, dy);
        if (d > C.MAGNET_R || d < 0.5) return;
        const step = Math.min(d, C.MAGNET_V * dt * (1.4 - d / C.MAGNET_R));
        this.pullX += dx / d * step;
        this.pullY += dy / d * step;
        this.x = this.homeX + this.pullX;
        this.y = this.homeY + this.pullY;
    };

    Pickup.prototype.take = function () {
        this.taken = true;
        this.timer = this.spec.respawn;
        this.pullX = this.pullY = 0;
    };

    Pickup.prototype.box = function () {
        return box(this.x, this.y - this.spec.h / 2, this.spec.w, this.spec.h);
    };

    /* ------------------------------------------------------------------ *
     * Enemies
     * ------------------------------------------------------------------ */

    /**
     * Speeds are up about a fifth on the first pass, which had patrols slower
     * than either original's. A room 42 tiles wide with a walker crossing it at
     * 46 px/s gives the player nine seconds of clear air between passes — long
     * enough that the patrol stops being a thing you plan around.
     */
    const ENEMY_SPEC = {
        walker:   { w: 13, h: 13, speed: 56, damage: C.DMG_ENEMY },
        crawler:  { w: 13, h: 10, speed: 34, damage: C.DMG_ENEMY },
        dog:      { w: 15, h: 11, speed: 46, damage: C.DMG_ENEMY },
        bat:      { w: 14, h: 10, speed: 74, damage: C.DMG_ENEMY },
        spider:   { w: 11, h: 11, speed: 110, damage: C.DMG_ENEMY },
        guardian: { w: 13, h: 13, speed: 30, damage: C.DMG_ENEMY },
        orb:      { w: 11, h: 11, speed: 70, damage: C.DMG_ENEMY }
    };

    /**
     * Ground patrol. `walker` is brisk and predictable; `crawler` is slow and
     * reverses on its own schedule as well as at the ends, so a route that only
     * works if it keeps walking is not a route.
     */
    function Ground(kind, tx, ty, room, speedMul) {
        const spec = ENEMY_SPEC[kind];
        this.kind = kind;
        this.spec = spec;
        this.y = ty * C.TILE + C.TILE;
        this.speed = spec.speed * speedMul;
        this.dir = 1;
        this.t = 0;
        this.dead = false;
        this._turnIn = 0;

        const span = groundSpan(room, tx, ty);
        this.minX = span.x0 * C.TILE + spec.w / 2;
        this.maxX = (span.x1 + 1) * C.TILE - spec.w / 2;
        this.x = Util.clamp(tileCentre(tx), this.minX, this.maxX);
        if (this.maxX <= this.minX) this.speed = 0;   // nowhere to go; stand still

        this.room = room;
        this.state = 'patrol';
        this.timer = 0;
        this.cooldown = 0;
        /** Seconds since it died, for the renderer's death animation. */
        this.deadT = 0;
        /** Accumulated roll, for drawing a curled beetle turning over. */
        this.spin = 0;
    }

    Ground.prototype.update = function (dt, player, set) {
        if (this.dead) { this.deadT += dt; return; }
        this.t += dt;
        if (this.kind === 'walker') { this._walker(dt, player, set); return; }
        if (this.kind === 'crawler') { this._crawler(dt, player); return; }
        this._patrol(dt, this.speed);
    };

    /** Walk the beat at `speed`, turning at either end. */
    Ground.prototype._patrol = function (dt, speed) {
        this.x += this.dir * speed * dt;
        if (this.x <= this.minX) { this.x = this.minX; this.dir = 1; return true; }
        if (this.x >= this.maxX) { this.x = this.maxX; this.dir = -1; return true; }
        return false;
    };

    /**
     * Is Tommy on this patrol's level, in front of it, and in plain sight?
     *
     * "Plain sight" is walked tile by tile along the row at chest height, so a
     * bot behind a pillar does not shoot through it. A shot you could not have
     * seen coming is not a hazard, it is a tax.
     */
    Ground.prototype._sees = function (player, range, room, anyDir) {
        if (!player || !player.active || !player.alive) return false;
        if (Math.abs(player.y - this.y) > C.TILE * 0.8) return false;
        const dx = player.x - this.x;
        if (Math.abs(dx) > range) return false;
        if (!anyDir && Util.sign(dx) !== this.dir) return false;
        const row = Math.floor((this.y - C.TILE * 0.6) / C.TILE);
        const a = Math.floor(Math.min(this.x, player.x) / C.TILE);
        const b = Math.floor(Math.max(this.x, player.x) / C.TILE);
        for (let tx = a; tx <= b; tx++) if (Tiles.isSolid(room.get(tx, row))) return false;
        return true;
    };

    /**
     * The minecart bot: patrols, and shoots.
     *
     * When Tommy is on its level and in front of it, it stops, its lamp eye
     * charges for half a second — the tell — and it fires a hot rivet along
     * the deck. The rivet flies level and dies on the first wall, so the
     * answer is always the same and always available: jump it. What changes
     * room to room is where you are standing when you have to.
     */
    const BOT_SIGHT = C.TILE * 8;
    const BOT_AIM = 0.55;
    const BOT_RECOIL = 0.35;
    const BOT_COOLDOWN = 1.6;
    const RIVET_V = 175;

    Ground.prototype._walker = function (dt, player, set) {
        if (this.cooldown > 0) this.cooldown -= dt;
        const room = set ? set.room : null;
        switch (this.state) {
            case 'aim':
                this.timer -= dt;
                if (this.timer <= 0) {
                    this.state = 'recoil';
                    this.timer = BOT_RECOIL;
                    this.cooldown = BOT_COOLDOWN;
                    if (set) set.fire('rivet', this.x + this.dir * 9, this.y - 7, this.dir * RIVET_V, 0);
                }
                return;
            case 'recoil':
                this.timer -= dt;
                if (this.timer <= 0) this.state = 'patrol';
                return;
            default:
                if (room && this.cooldown <= 0 && this._sees(player, BOT_SIGHT, room)) {
                    this.state = 'aim';
                    this.timer = BOT_AIM;
                    if (set) set.bus.emit(TNT.EV.ENEMY_AIM, { x: this.x, y: this.y - 7, kind: this.kind });
                    return;
                }
                this._patrol(dt, this.speed);
        }
    };

    /**
     * The rust beetle: crawls, curls, rolls, and gets dizzy.
     *
     * Close to Tommy and on his level, it tucks into an armoured ball and
     * rolls at him fast. While it is a ball a stomp glances off it — the shell
     * is the point — and when the roll ends it sits dazed for a second, open.
     * The fight is the timing: get out of the way of the roll, then land on it.
     */
    const BEETLE_WAKE = C.TILE * 5;
    const BEETLE_CURL = 0.3;
    const BEETLE_ROLL = 1.5;
    const BEETLE_DIZZY = 1.2;

    Ground.prototype._crawler = function (dt, player) {
        const room = this.room;
        switch (this.state) {
            case 'curl':
                this.timer -= dt;
                if (this.timer <= 0) { this.state = 'roll'; this.timer = BEETLE_ROLL; }
                return;
            case 'roll':
                this.timer -= dt;
                this._patrol(dt, this.speed * 4.2);
                this.spin += this.dir * this.speed * 4.2 * dt;
                if (this.timer <= 0) { this.state = 'dizzy'; this.timer = BEETLE_DIZZY; }
                return;
            case 'dizzy':
                this.timer -= dt;
                if (this.timer <= 0) { this.state = 'patrol'; this.cooldown = 1.2; }
                return;
            default:
                if (this.cooldown > 0) this.cooldown -= dt;
                // Only a Tommy standing on its level wakes it. One coming down
                // on it from above is the one thing it cannot see coming — or
                // the shell would make it impossible ever to stomp.
                if (room && this.cooldown <= 0 && player && player.onGround &&
                    this._sees(player, BEETLE_WAKE, room, true)) {
                    this.dir = Util.sign(player.x - this.x) || this.dir;
                    this.state = 'curl';
                    this.timer = BEETLE_CURL;
                    return;
                }
                this._turnIn -= dt;
                if (this._turnIn <= 0) {
                    this._turnIn = 1.8 + (this.x % 7) * 0.3;
                    this.dir = -this.dir;
                }
                this._patrol(dt, this.speed);
        }
    };

    /** Whether a stomp kills it or glances off. */
    Ground.prototype.armoured = function () {
        return this.kind === 'crawler' && (this.state === 'curl' || this.state === 'roll');
    };

    Ground.prototype.box = function () {
        return box(this.x, this.y - this.spec.h / 2, this.spec.w, this.spec.h);
    };

    /**
     * A guard dog. Patrols like a walker until Tommy is on its level and in
     * front of it, then charges.
     *
     * The tell is deliberate and long — it stops and braces for `ROUSE` before
     * it moves. A charger with no wind-up is unfair on a three-row grid, where
     * the counter is usually "get above it", and getting above something takes
     * a jump you have to start before it commits.
     */
    const DOG_ROUSE = 0.45;
    const DOG_SIGHT = 130;
    const DOG_CHARGE = 2.6;
    const DOG_WINDED = 1.1;

    function Dog(tx, ty, room, speedMul) {
        Ground.call(this, 'dog', tx, ty, room, speedMul);
        this.kind = 'dog';
        this.state = 'patrol';
        this.timer = 0;
    }
    Dog.prototype = Object.create(Ground.prototype);
    Dog.prototype.constructor = Dog;

    Dog.prototype.update = function (dt, player) {
        if (this.dead) { this.deadT += dt; return; }
        this.t += dt;

        /*
         * Winded: a clockwork hound runs itself down on a charge and has to
         * stop while its spring rewinds. That second is the stomp window —
         * the counter to a charge is to be above it when it ends.
         */
        if (this.state === 'winded') {
            this.timer -= dt;
            if (this.timer <= 0) this.state = 'patrol';
            return;
        }

        const sees = player && player.active &&
            Math.abs(player.y - this.y) < C.TILE * 1.5 &&
            Math.abs(player.x - this.x) < DOG_SIGHT &&
            Util.sign(player.x - this.x) === this.dir;

        if (this.state === 'patrol') {
            if (sees) { this.state = 'rouse'; this.timer = DOG_ROUSE; }
        } else if (this.state === 'rouse') {
            this.timer -= dt;
            if (this.timer <= 0) { this.state = 'charge'; this.timer = DOG_CHARGE; }
            return;                              // braced, not moving
        } else {
            this.timer -= dt;
            if (this.timer <= 0) { this.state = 'winded'; this.timer = DOG_WINDED; return; }
        }

        const charging = this.state === 'charge';
        const speed = charging ? this.speed * 3.1 : this.speed;
        this.x += this.dir * speed * dt;
        const end = charging ? 'winded' : 'patrol';
        if (this.x <= this.minX) { this.x = this.minX; this.dir = 1; this.state = end; this.timer = DOG_WINDED; }
        if (this.x >= this.maxX) { this.x = this.maxX; this.dir = -1; this.state = end; this.timer = DOG_WINDED; }
    };

    /**
     * A cave spider. Sits in the ceiling until Tommy is under it, drops on a
     * thread, then reels back up.
     *
     * The one hazard in the game that comes from above, which is why it is
     * worth having: on a climbing frame the player's attention is on the ledge
     * they are aiming at, and this is the only thing that punishes never
     * looking up. `thread` is read by the renderer to draw the silk.
     */
    const SPIDER_WAIT = 1.1;
    const SPIDER_HANG = 0.7;
    const SPIDER_TRIGGER = C.TILE * 1.6;

    function Spider(tx, ty, room, speedMul) {
        const spec = ENEMY_SPEC.spider;
        this.kind = 'spider';
        this.spec = spec;
        this.speed = spec.speed * speedMul;
        this.dead = false;
        this.dir = 1;
        this.t = 0;
        this.x = tileCentre(tx);
        this.homeY = ty * C.TILE + C.TILE / 2;
        this.y = this.homeY;
        this.state = 'wait';
        this.timer = SPIDER_WAIT;

        // How far it can drop before it hits something.
        let y = ty;
        while (y + 1 < C.ROWS && !Tiles.isFloor(room.get(tx, y + 1)) &&
               !Tiles.isSolid(room.get(tx, y + 1))) y++;
        this.lowY = y * C.TILE + C.TILE / 2;
        this.thread = 0;
    }

    Spider.prototype.update = function (dt, player) {
        if (this.dead) { this.deadT = (this.deadT || 0) + dt; return; }
        this.t += dt;

        switch (this.state) {
            case 'wait': {
                const under = player && player.active &&
                    Math.abs(player.x - this.x) < SPIDER_TRIGGER &&
                    player.y > this.y;
                this.timer -= dt;
                if (under && this.timer <= 0) { this.state = 'drop'; }
                break;
            }
            case 'drop':
                this.y = Math.min(this.lowY, this.y + this.speed * dt);
                if (this.y >= this.lowY) { this.state = 'hang'; this.timer = SPIDER_HANG; }
                break;
            case 'hang':
                this.timer -= dt;
                if (this.timer <= 0) this.state = 'climb';
                break;
            default:
                this.y = Math.max(this.homeY, this.y - this.speed * 0.6 * dt);
                if (this.y <= this.homeY) { this.state = 'wait'; this.timer = SPIDER_WAIT; }
                break;
        }
        this.thread = this.y - this.homeY;
    };

    Spider.prototype.box = function () {
        return box(this.x, this.y, this.spec.w, this.spec.h);
    };

    /**
     * A guardian. Drifts toward Tommy through anything — rock included.
     *
     * Slow enough to outrun and impossible to hide from, which makes it a
     * pressure source rather than an obstacle: it is the reason not to stand
     * still working out a route. Ignoring walls is the point, not a shortcut;
     * a pathfinding version would simply get stuck in the geometry and stop
     * mattering.
     */
    function Guardian(tx, ty, room, speedMul) {
        const spec = ENEMY_SPEC.guardian;
        this.room = room;
        this.kind = 'guardian';
        this.spec = spec;
        this.speed = spec.speed * speedMul;
        this.dead = false;
        this.dir = 1;
        this.t = 0;
        this.homeX = tileCentre(tx);
        this.homeY = tileCentre(ty);
        this.x = this.homeX;
        this.y = this.homeY;
        this.reformIn = 0;
        /** 'idle' at its post, 'chase', or 'rest' between bursts. */
        this.state = 'idle';
        this.timer = 0;
        void room;
    }

    /**
     * Stomped: scattered, not destroyed.
     *
     * The guardian is the room's pressure — the reason not to stand still
     * working out a route — so a stomp that removed it for good would turn the
     * hardest rooms in the mine into empty ones. It reforms where it was first
     * posted, which is both a reason to keep moving and a guarantee it never
     * comes back on top of the player.
     */
    Guardian.prototype.onStomped = function () {
        this.reformIn = C.GUARDIAN_REFORM;
    };

    Guardian.prototype.update = function (dt, player) {
        if (this.dead) {
            this.deadT = (this.deadT || 0) + dt;
            if (this.reformIn <= 0) return;
            this.reformIn -= dt;
            if (this.reformIn <= 0) {
                this.dead = false;
                this.x = this.homeX;
                this.y = this.homeY;
            }
            return;
        }
        this.t += dt;
        if (!player || !player.active) return;

        let tx = player.x;
        let ty = player.centreY();
        const far = Math.hypot(tx - this.x, ty - this.y);

        /*
         * It hunts in bursts, and only what it can nearly see.
         *
         * It used to home in on Tommy from anywhere in the room, through
         * anything, without a break — play-testing found it the enemy most
         * likely to end a life, because there was never a moment to get away
         * from it. Now it wakes only when he is within `SENTINEL_WAKE`, gives up
         * and drifts home once he is past `SENTINEL_LOSE`, and after each burst
         * of chasing it stops to recharge, its lamp dimmed — the window to put
         * distance between you, or to land on it.
         */
        if (this.state === 'rest') {
            this.timer -= dt;
            if (this.timer <= 0) { this.state = 'chase'; this.timer = SENTINEL_CHASE; }
            return;
        }
        if (this.state === 'idle') {
            if (far < SENTINEL_WAKE) { this.state = 'chase'; this.timer = SENTINEL_CHASE; }
            tx = this.homeX;
            ty = this.homeY;
        } else {
            this.timer -= dt;
            if (far > SENTINEL_LOSE) { this.state = 'idle'; }
            else if (this.timer <= 0) { this.state = 'rest'; this.timer = SENTINEL_REST; return; }
        }

        const dx = tx - this.x;
        const dy = ty - this.y;
        const d = Math.hypot(dx, dy) || 1;
        if (this.state === 'idle' && d < 2) return;

        /*
         * It goes through rock, but not through water.
         *
         * Passing through anything is the guardian's whole identity, so this is
         * a deliberate exception rather than an oversight: the tank is the one
         * place the player is obliged to go and cannot move at speed, and
         * something that ignores walls following you into it has no answer at
         * all. Each axis is tested on its own so it slides along the surface
         * rather than sticking on it.
         */
        const stepX = (dx / d) * this.speed * dt;
        const stepY = (dy / d) * this.speed * dt;
        const dry = (function (self) {
            return function (px, py) {
                if (!self.room) return true;
                return !self.room.wetAt(px, py);
            };
        })(this);

        if (dry(this.x + stepX, this.y)) this.x += stepX;
        if (dry(this.x, this.y + stepY)) this.y += stepY;
        this.dir = dx >= 0 ? 1 : -1;
        // A slight bob, so it reads as hovering rather than sliding.
        const bob = Math.sin(this.t * 2.2) * 6 * dt;
        if (dry(this.x, this.y + bob)) this.y += bob;
    };

    const SENTINEL_WAKE = C.TILE * 9;
    const SENTINEL_LOSE = C.TILE * 14;
    const SENTINEL_CHASE = 3.2;
    const SENTINEL_REST = 1.8;

    Guardian.prototype.box = function () {
        return box(this.x, this.y, this.spec.w, this.spec.h);
    };

    /** Horizontal flier, weaving. */
    function Bat(tx, ty, room, speedMul) {
        const spec = ENEMY_SPEC.bat;
        this.kind = 'bat';
        this.spec = spec;
        this.speed = spec.speed * speedMul;
        this.dir = 1;
        this.dead = false;
        this.t = (tx * 13 + ty * 29) % 100 / 100 * Math.PI * 2;
        this.baseY = tileCentre(ty);
        this.amp = 11;

        const span = openSpanX(room, tx, ty);
        this.minX = span.x0 * C.TILE + spec.w / 2;
        this.maxX = (span.x1 + 1) * C.TILE - spec.w / 2;
        this.x = Util.clamp(tileCentre(tx), this.minX, this.maxX);
        this.y = this.baseY;
        if (this.maxX <= this.minX) this.speed = 0;
        this.room = room;
        this.state = 'weave';
        this.timer = 0;
        this.cooldown = 1;
        this.deadT = 0;
    }

    /**
     * A bat weaves its span, and swoops.
     *
     * When Tommy passes under it — below, close, and with nothing between
     * them — it drops at him in an arc and climbs back to its beat. The swoop
     * aims at where he *was*, so keeping moving is the dodge, and a player
     * standing still under a bat learns why not to.
     */
    const BAT_SWOOP = 0.95;
    const BAT_REST = 3.4;

    Bat.prototype.update = function (dt, player) {
        if (this.dead) { this.deadT = (this.deadT || 0) + dt; return; }
        this.t += dt;
        if (this.cooldown > 0) this.cooldown -= dt;

        if (this.state === 'swoop') {
            this.timer += dt;
            const k = Math.min(1, this.timer / BAT_SWOOP);
            // Down and across, then back up: a sine for the dip, linear across.
            this.x = Util.lerp(this.sx, this.tx, k);
            this.y = this.sy + Math.sin(k * Math.PI) * (this.ty - this.sy);
            if (k >= 1) {
                this.state = 'weave';
                this.cooldown = BAT_REST;
                this.x = Util.clamp(this.x, this.minX, this.maxX);
            }
            return;
        }

        this.x += this.dir * this.speed * dt;
        if (this.x <= this.minX) { this.x = this.minX; this.dir = 1; }
        if (this.x >= this.maxX) { this.x = this.maxX; this.dir = -1; }
        this.y = this.baseY + Math.sin(this.t * 3.1) * this.amp;

        if (this.cooldown <= 0 && this._canSwoop(player)) {
            this.state = 'swoop';
            this.timer = 0;
            this.sx = this.x;
            this.sy = this.y;
            this.ty = player.centreY();
            // Carry on past him, so the arc is a pass and not a dive-bomb.
            this.tx = Util.clamp(this.x + (player.x - this.x) * 1.6, this.minX, this.maxX);
            this.dir = Util.sign(this.tx - this.x) || this.dir;
        }
    };

    Bat.prototype._canSwoop = function (player) {
        if (!player || !player.active || !player.alive) return false;
        const dy = player.centreY() - this.y;
        if (dy < C.TILE * 1.5 || dy > C.TILE * 6) return false;
        if (Math.abs(player.x - this.x) > C.TILE * 3) return false;
        // Clear air all the way down, sampled every half tile.
        const steps = Math.ceil(dy / (C.TILE / 2));
        for (let i = 1; i < steps; i++) {
            const k = i / steps;
            const t = this.room.at(Util.lerp(this.x, player.x, k), Util.lerp(this.y, player.centreY(), k));
            if (Tiles.isFloor(t) || this.room.wetAt(Util.lerp(this.x, player.x, k),
                                                    Util.lerp(this.y, player.centreY(), k))) return false;
        }
        return true;
    };

    Bat.prototype.box = function () {
        return box(this.x, this.y, this.spec.w, this.spec.h);
    };

    /** Fire orb, riding up and down a shaft. */
    function Orb(tx, ty, room, speedMul) {
        const spec = ENEMY_SPEC.orb;
        this.kind = 'orb';
        this.spec = spec;
        this.speed = spec.speed * speedMul;
        this.dir = 1;
        this.dead = false;
        this.t = 0;
        this.x = tileCentre(tx);

        const span = openSpanY(room, tx, ty);
        this.minY = span.y0 * C.TILE + spec.h / 2;
        this.maxY = (span.y1 + 1) * C.TILE - spec.h / 2;
        this.y = Util.clamp(tileCentre(ty), this.minY, this.maxY);
        if (this.maxY <= this.minY) this.speed = 0;
    }

    Orb.prototype.update = function (dt) {
        if (this.dead) { this.deadT = (this.deadT || 0) + dt; return; }
        this.t += dt;
        this.y += this.dir * this.speed * dt;
        if (this.y <= this.minY) { this.y = this.minY; this.dir = 1; }
        if (this.y >= this.maxY) { this.y = this.maxY; this.dir = -1; }
    };

    Orb.prototype.box = function () {
        return box(this.x, this.y, this.spec.w, this.spec.h);
    };

    /* ------------------------------------------------------------------ *
     * Shots
     * ------------------------------------------------------------------ */

    /**
     * A hot rivet, fired level along a deck.
     *
     * It flies straight and dies on the first solid tile, and a blast clears
     * any in its radius. It does not pass through decks either — a shot that
     * came up through the floor you are standing on would be unreadable.
     */
    function Shot(kind, x, y, vx, vy, grav) {
        this.kind = kind;
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.grav = grav || 0;
        this.life = 4;
        this.dead = false;
        this.w = 7;
        this.h = 5;
    }

    Shot.prototype.update = function (dt, room) {
        this.life -= dt;
        this.vy += this.grav * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const t = room.at(this.x, this.y);
        // A shot travelling level passes decks; one coming *down* stops on the
        // first it meets, so a deck overhead is always cover.
        const stopped = Tiles.isSolid(t) || (this.vy > 20 && Tiles.isOneWay(t));
        if (this.life <= 0 || stopped || this.x < 0 || this.x > C.ROOM_W || this.y > C.ROOM_H) {
            this.dead = true;
            return true;
        }
        return false;
    };

    Shot.prototype.box = function () {
        return box(this.x, this.y, this.w, this.h);
    };

    /* ------------------------------------------------------------------ *
     * Machinery
     * ------------------------------------------------------------------ */

    /**
     * A piston that slams down its travel and winds back up.
     *
     * The cycle has a deliberate warning phase — the head shudders before it
     * drops. Machinery that kills without a tell is not a hazard, it is a coin
     * toss, and in a game where you cannot jump clear the tell is the only
     * counterplay there is.
     */
    function Crusher(tx, ty) {
        this.kind = 'crusher';
        this.x = tileCentre(tx) + C.TILE / 2;
        this.topY = ty * C.TILE;
        this.travel = C.CRUSH_TILES * C.TILE;
        this.w = C.TILE * 2 - 2;
        this.h = C.TILE;
        this.phase = (tx * 31 + ty * 17) % 100 / 100 * C.CRUSH_CYCLE;
        this.y = this.topY;
        this.state = 'idle';
        this.shake = 0;
    }

    Crusher.prototype.update = function (dt) {
        this.phase = (this.phase + dt) % C.CRUSH_CYCLE;
        const p = this.phase;
        if (p < C.CRUSH_WARN) {
            this.state = 'idle';
            this.shake = 0;
            this.y = this.topY;
        } else if (p < C.CRUSH_SLAM) {
            this.state = 'warn';
            this.shake = (p - C.CRUSH_WARN) / (C.CRUSH_SLAM - C.CRUSH_WARN);
            this.y = this.topY;
        } else {
            const k = (p - C.CRUSH_SLAM) / (C.CRUSH_CYCLE - C.CRUSH_SLAM);
            this.state = 'slam';
            this.shake = 0;
            // Down hard, back up slowly: the drop is the threat, the return is
            // the window you walk through.
            this.y = this.topY + this.travel * (k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82);
        }
    };

    Crusher.prototype.box = function () {
        return box(this.x, this.y + this.h / 2, this.w, this.h);
    };

    /** Ceiling dropper. Releases a rock, which falls until it hits something. */
    function Boulder(tx, ty) {
        this.kind = 'boulder';
        this.x = tileCentre(tx);
        this.homeY = ty * C.TILE + C.TILE / 2;
        this.y = this.homeY;
        this.vy = 0;
        this.falling = false;
        this.phase = (tx * 19 + ty * 41) % 100 / 100 * C.BOULDER_CYCLE;
        this.r = 6;
        this.smashed = 0;
    }

    Boulder.prototype.update = function (dt, room) {
        this.smashed = Math.max(0, this.smashed - dt);
        if (!this.falling) {
            this.phase += dt;
            if (this.phase >= C.BOULDER_CYCLE) {
                this.phase = 0;
                this.falling = true;
                this.vy = 0;
            }
            return false;
        }
        this.vy = Math.min(this.vy + C.BOULDER_GRAV * dt, C.MAX_FALL);
        this.y += this.vy * dt;

        const below = room.at(this.x, this.y + this.r);
        if (Tiles.isFloor(below) || this.y + this.r >= C.ROOM_H) {
            this.falling = false;
            this.y = this.homeY;
            this.vy = 0;
            this.smashed = 0.3;
            return true;      // tell the caller to make a noise and a puff
        }
        return false;
    };

    Boulder.prototype.box = function () {
        return box(this.x, this.y, this.r * 2, this.r * 2);
    };

    /**
     * A moving platform: the tram along the lava channel, the cage in the
     * headframe. Authored as a pair of end markers — see `Paint.liftRunH`.
     *
     * `prevX`/`prevY` are kept because a rider has to be carried by the *delta*,
     * not re-derived from the platform's position. Without it, a player standing
     * on a lift that reverses is left behind for a frame and slides off the end.
     */
    function Lift(axis, x0, y0, x1, y1) {
        this.kind = 'lift';
        this.axis = axis;                  // 'h' or 'v'
        this.w = C.LIFT_W * C.TILE;
        this.h = C.LIFT_H;

        if (axis === 'h') {
            this.aX = x0 * C.TILE;
            this.bX = (x1 + 1) * C.TILE - this.w;
            this.aY = this.bY = (y0 + 1) * C.TILE;
        } else {
            this.aX = this.bX = x0 * C.TILE - (this.w - C.TILE) / 2;
            this.aY = (y0 + 1) * C.TILE;
            this.bY = (y1 + 1) * C.TILE;
        }
        this.x = this.aX;
        this.y = this.aY;
        this.prevX = this.x;
        this.prevY = this.y;
        this.t = 0;
        this.dir = 1;
        this.pause = 0;
    }

    Lift.prototype.update = function (dt) {
        this.prevX = this.x;
        this.prevY = this.y;

        if (this.pause > 0) {
            this.pause -= dt;
            return;
        }

        const dx = this.bX - this.aX;
        const dy = this.bY - this.aY;
        const len = Math.hypot(dx, dy) || 1;
        this.t += this.dir * (C.LIFT_V / len) * dt;

        if (this.t >= 1) { this.t = 1; this.dir = -1; this.pause = C.LIFT_PAUSE; }
        if (this.t <= 0) { this.t = 0; this.dir = 1; this.pause = C.LIFT_PAUSE; }

        this.x = this.aX + dx * this.t;
        this.y = this.aY + dy * this.t;
    };

    /** The rideable surface: the top face, as a thin box. */
    Lift.prototype.box = function () {
        return box(this.x + this.w / 2, this.y + this.h / 2, this.w, this.h);
    };

    Lift.prototype.top = function () {
        return this.y;
    };

    /* ------------------------------------------------------------------ *
     * Steam vents
     * ------------------------------------------------------------------ */

    /**
     * A vent in the floor that scalds on a cycle.
     *
     * It does not lift you. That was the obvious thing to do with it and it is
     * exactly wrong for this game: a jet that throws Tommy three tiles up is a
     * jump button with extra steps, and the whole design rests on there not
     * being one. So the jet hurts and shoves sideways, and height stays
     * something you climb to.
     */
    function Vent(tx, ty) {
        this.kind = 'vent';
        this.x = tileCentre(tx);
        this.baseY = ty * C.TILE + C.TILE;
        this.phase = (tx * 23 + ty * 11) % 100 / 100 * C.VENT_CYCLE;
        this.state = 'idle';
        this.height = 0;
    }

    Vent.prototype.update = function (dt) {
        this.phase = (this.phase + dt) % C.VENT_CYCLE;
        const p = this.phase;
        if (p < C.VENT_WARN) {
            this.state = 'idle';
            this.height = 0;
        } else if (p < C.VENT_BLAST) {
            this.state = 'warn';
            this.height = C.TILE * 0.35 * ((p - C.VENT_WARN) / (C.VENT_BLAST - C.VENT_WARN));
        } else {
            this.state = 'blast';
            const k = (p - C.VENT_BLAST) / (C.VENT_CYCLE - C.VENT_BLAST);
            this.height = C.VENT_TILES * C.TILE * Math.sin(k * Math.PI);
        }
        return this.state === 'blast';
    };

    Vent.prototype.box = function () {
        return box(this.x, this.baseY - this.height / 2, C.TILE - 4, this.height);
    };

    /* ------------------------------------------------------------------ *
     * Rising lava
     * ------------------------------------------------------------------ */

    /**
     * A flood room: the molten level climbs while you are in it.
     *
     * It rises **only while the room is occupied**, and drains once you leave.
     * A flood that kept rising in your absence would mean coming back to a room
     * you can no longer enter, with nothing having told you that was happening —
     * which in a game where you revisit rooms to fetch the last stick is a run
     * lost to something the player could not have known.
     *
     * The surface is a pixel height above the floor, not a tile, so it can
     * creep. `Run` reads `surfaceY` to decide what is submerged.
     */
    function Flood(baseRow, ceilRow) {
        this.kind = 'flood';
        this.baseY = (baseRow + 1) * C.TILE;
        this.topY = ceilRow * C.TILE;
        this.level = 0;                      // px above the base
        this.active = false;
    }

    Flood.prototype.update = function (dt, occupied) {
        this.active = occupied;
        const max = this.baseY - this.topY;
        if (occupied) this.level = Math.min(max, this.level + C.FLOOD_RISE * dt);
        else this.level = Math.max(0, this.level - C.FLOOD_DRAIN * dt);
    };

    /** Screen-space y of the molten surface. */
    Flood.prototype.surfaceY = function () {
        return this.baseY - this.level;
    };

    Flood.prototype.reset = function () {
        this.level = 0;
        this.active = false;
    };

    /* ------------------------------------------------------------------ *
     * Warp pads
     * ------------------------------------------------------------------ */

    /**
     * Paired warp pads. Stand on one, press Down.
     *
     * Pairing is by reading order within the room — first pad with second,
     * third with fourth — which is unambiguous, needs no letters in the grid,
     * and makes an odd pad a build error rather than a pad that silently does
     * nothing.
     */
    function Warp(tx, ty) {
        this.kind = 'warp';
        this.tx = tx;
        this.ty = ty;
        this.x = tileCentre(tx);
        this.y = ty * C.TILE + C.TILE;
        this.partner = null;
        this.lock = 0;
        this.t = 0;
    }

    Warp.prototype.update = function (dt) {
        this.t += dt;
        if (this.lock > 0) this.lock -= dt;
    };

    /* ------------------------------------------------------------------ *
     * Span derivation
     * ------------------------------------------------------------------ */

    /** The stretch of continuous floor a ground patrol can walk. */
    function groundSpan(room, tx, ty) {
        const standable = function (x) {
            return !Tiles.isSolid(room.get(x, ty)) && Tiles.isFloor(room.get(x, ty + 1));
        };
        let x0 = tx, x1 = tx;
        while (x0 > 0 && standable(x0 - 1)) x0--;
        while (x1 < C.COLS - 1 && standable(x1 + 1)) x1++;
        return { x0: x0, x1: x1 };
    }

    /** The stretch of open air a flier can cross. */
    /**
     * Water bounds a patrol as surely as rock does.
     *
     * Neither span used to stop at it, because water is not solid and is not a
     * floor — so a bat's run carried straight on through a tank and it went on
     * weaving at full flying speed while the player, swimming, moved at a
     * fraction of it. A hazard you cannot outpace in a place you are obliged to
     * go is not a fight, and the tank is on the critical path.
     */
    function wet(room, tx, ty) {
        return room.isWet(tx, ty);
    }

    function openSpanX(room, tx, ty) {
        let x0 = tx, x1 = tx;
        while (x0 > 0 && !Tiles.isSolid(room.get(x0 - 1, ty)) && !wet(room, x0 - 1, ty)) x0--;
        while (x1 < C.COLS - 1 && !Tiles.isSolid(room.get(x1 + 1, ty)) &&
               !wet(room, x1 + 1, ty)) x1++;
        return { x0: x0, x1: x1 };
    }

    function openSpanY(room, tx, ty) {
        let y0 = ty, y1 = ty;
        while (y0 > 0 && !Tiles.isFloor(room.get(tx, y0 - 1)) && !wet(room, tx, y0 - 1)) y0--;
        while (y1 < C.ROWS - 1 && !Tiles.isFloor(room.get(tx, y1 + 1)) &&
               !wet(room, tx, y1 + 1)) y1++;
        return { y0: y0, y1: y1 };
    }

    /* ------------------------------------------------------------------ *
     * Assembly
     * ------------------------------------------------------------------ */

    /**
     * Everything alive in one room, for one run.
     *
     * Rebuilt when a mine starts, never mutated between lives — dying rewinds
     * the room to this, so a stick you already collected stays collected but a
     * patrol you walked past is back where it started.
     */
    function RoomEntities(room, mine) {
        this.room = room;
        this.pickups = [];
        this.enemies = [];
        this.crushers = [];
        this.boulders = [];
        this.vents = [];
        this.lifts = [];
        /** Tile index → {state, timer}. Only occupied planks are in here. */
        this.crumbles = new Map();
        /**
         * Every rotten plank in the room, as `{tx, ty}`.
         *
         * The renderer draws these itself rather than letting them be baked
         * into the terrain mesh, because they have to shake before they give
         * way and a merged buffer cannot animate one tile. Collected once here:
         * their positions never change, only their state does.
         */
        this.crumbleTiles = [];
        /** Top row of every column of water, for the animated surface. */
        this.waterTops = [];
        /** ...and of lava, which needs it more. */
        this.lavaTops = [];
        this.detonator = null;
        this.warps = [];
        this.flood = null;
        /** Shots in flight. Transient: cleared on every rewind. */
        this.shots = [];
        this.bus = null;
        this.levers = [];
        this.gates = [];
        this.fans = [];
        this.rails = [];
        this.hooks = [];
        /** The Governor, in the vault only. */
        this.boss = null;
        const valveMarks = [];
        /** Set once every nugget in the room has been taken; the medal is once. */
        this.medal = false;
        /** Whether the player has ever been here. Drawn on the minimap. */
        this.seen = false;

        const mul = mine.enemyMul;
        const liftMarks = { h: [], v: [] };

        for (const s of room.spawns) {
            switch (s.kind) {
                case 'spawn':
                    break;
                case 'tnt': case 'ore': case 'food': case 'heart': case 'oxygen':
                    this.pickups.push(new Pickup(s.kind, s.tx, s.ty));
                    break;
                case 'walker': case 'crawler':
                    this.enemies.push(new Ground(s.kind, s.tx, s.ty, room, mul));
                    break;
                case 'dog':
                    this.enemies.push(new Dog(s.tx, s.ty, room, mul));
                    break;
                case 'bat':
                    this.enemies.push(new Bat(s.tx, s.ty, room, mul));
                    break;
                case 'spider':
                    this.enemies.push(new Spider(s.tx, s.ty, room, mul));
                    break;
                case 'guardian':
                    this.enemies.push(new Guardian(s.tx, s.ty, room, mul));
                    break;
                case 'orb':
                    this.enemies.push(new Orb(s.tx, s.ty, room, mul));
                    break;
                case 'crusher':
                    this.crushers.push(new Crusher(s.tx, s.ty));
                    break;
                case 'boulder':
                    this.boulders.push(new Boulder(s.tx, s.ty));
                    break;
                case 'liftH':
                    liftMarks.h.push(s);
                    break;
                case 'liftV':
                    liftMarks.v.push(s);
                    break;
                case 'cog':
                    this.pickups.push(new Pickup('cog', s.tx, s.ty));
                    break;
                case 'lever':
                    this.levers.push(new TNT.Machines.Lever(s.tx, s.ty));
                    break;
                case 'valve':
                    valveMarks.push(s);
                    break;
                case 'hook':
                    this.hooks.push(new TNT.Machines.Hook(s.tx, s.ty, room));
                    break;
                default:
                    throw new Error(room.id + ': no entity for spawn kind "' + s.kind + '"');
            }
        }

        // Vents, warp pads and the plunger are terrain rather than actors, so
        // they are found by scanning rather than by spawn record.
        let lavaLow = -1, lavaHigh = C.ROWS;
        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                const t = room.get(tx, ty);
                if (t === T.FAN) {
                    this.fans.push(new TNT.Machines.Fan(tx, ty, room));
                } else if (t === T.RAIL && room.get(tx - 1, ty) !== T.RAIL) {
                    let end = tx;
                    while (room.get(end + 1, ty) === T.RAIL) end++;
                    this.rails.push(new TNT.Machines.Rail(tx, end, ty));
                } else if (t === T.GATE) {
                    this.gates.push(new TNT.Machines.Gate(tx, ty));
                } else if (t === T.VENT) {
                    this.vents.push(new Vent(tx, ty));
                } else if (t === T.TELEPORT) {
                    this.warps.push(new Warp(tx, ty));
                } else if (t === T.DETONATOR) {
                    this.detonator = { x: tileCentre(tx), y: ty * C.TILE + C.TILE };
                } else if (t === T.CRUMBLE) {
                    this.crumbleTiles.push({ tx: tx, ty: ty });
                } else if (room.isWet(tx, ty) && !room.isWet(tx, ty - 1)) {
                    this.waterTops.push({ tx: tx, ty: ty });
                } else if (t === T.LAVA) {
                    lavaLow = Math.max(lavaLow, ty);
                    lavaHigh = Math.min(lavaHigh, ty);
                    // Exposed lava gets a moving surface drawn over it.
                    if (room.get(tx, ty - 1) !== T.LAVA) {
                        this.lavaTops.push({ tx: tx, ty: ty });
                    }
                }
            }
        }

        pairWarps(this, room);
        pairLifts(this, liftMarks, room);

        if (valveMarks.length) {
            if (!room.boss) throw new Error(room.id + ': valves with no Governor (set `boss` on the room)');
            this.boss = new TNT.Machines.Governor(room, mine, valveMarks, room.boss);
        } else if (room.boss) {
            throw new Error(room.id + ': a Governor with no valves to break');
        }
        if (this.gates.length && !this.levers.length) {
            throw new Error(room.id + ': gates and no lever — nothing could ever open them');
        }

        // A room marked as flooding gets a rising surface over its lava bed.
        if (room.flooding && lavaLow >= 0) {
            this.flood = new Flood(lavaLow, Math.max(1, lavaHigh - C.FLOOD_CEILING));
        }
    }

    /** Pads pair in reading order; an odd one out is a typo, not a feature. */
    function pairWarps(set, room) {
        if (set.warps.length === 0) return;
        if (set.warps.length % 2 !== 0) {
            throw new Error(room.id + ': ' + set.warps.length +
                ' warp pads; they pair in reading order, so there must be an even number');
        }
        for (let i = 0; i < set.warps.length; i += 2) {
            set.warps[i].partner = set.warps[i + 1];
            set.warps[i + 1].partner = set.warps[i];
        }
    }

    /**
     * Match lift markers into runs.
     *
     * Horizontal markers pair by row, vertical by column, which is exactly how
     * they were authored. An odd one out is a typo, and a typo here is a lift
     * with no travel or a room that silently loses its only crossing — so it
     * throws rather than guessing.
     */
    function pairLifts(set, marks, room) {
        const byRow = new Map();
        for (const m of marks.h) {
            if (!byRow.has(m.ty)) byRow.set(m.ty, []);
            byRow.get(m.ty).push(m);
        }
        for (const [ty, list] of byRow) {
            if (list.length !== 2) {
                throw new Error(room.id + ': row ' + ty + ' has ' + list.length +
                    ' horizontal lift markers; runs are authored as exactly two');
            }
            list.sort(function (a, b) { return a.tx - b.tx; });
            set.lifts.push(new Lift('h', list[0].tx, ty, list[1].tx, ty));
        }

        const byCol = new Map();
        for (const m of marks.v) {
            if (!byCol.has(m.tx)) byCol.set(m.tx, []);
            byCol.get(m.tx).push(m);
        }
        for (const [tx, list] of byCol) {
            if (list.length !== 2) {
                throw new Error(room.id + ': column ' + tx + ' has ' + list.length +
                    ' vertical lift markers; runs are authored as exactly two');
            }
            list.sort(function (a, b) { return a.ty - b.ty; });
            set.lifts.push(new Lift('v', tx, list[1].ty, tx, list[0].ty));
        }
    }

    /**
     * @param {number} dt
     * @param {TNT.EventBus} bus
     * @param {TNT.Player} [player]  passed only for the room Tommy is actually
     *   in. The dog, the spider and the guardian all react to him; every other
     *   entity ignores the argument, and rooms he is not in are ticked without
     *   it so nothing off-screen chases a player who is not there.
     * @param {boolean} [occupied]
     */
    RoomEntities.prototype.update = function (dt, bus, player, occupied) {
        this.bus = bus;
        for (const p of this.pickups) p.update(dt);
        for (const e of this.enemies) e.update(dt, player, this);
        for (const l of this.levers) l.update(dt);
        for (const g of this.gates) g.update(dt);
        for (const f of this.fans) f.update(dt);
        for (const h of this.hooks) h.update(dt);
        for (const r of this.rails) {
            if (r.update(dt)) bus.emit(TNT.EV.RAIL_LIVE, { x: (r.tx0 + r.tx1 + 1) / 2 * C.TILE, y: r.ty * C.TILE });
        }
        if (this.boss && player) this.boss.update(dt, player, this);
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i];
            if (s.update(dt, this.room)) {
                bus.emit(TNT.EV.SHOT_HIT, { x: s.x, y: s.y });
                this.shots.splice(i, 1);
            }
        }
        for (const w of this.warps) w.update(dt);
        if (this.flood) this.flood.update(dt, !!occupied);
        for (const c of this.crushers) {
            const wasSlam = c.state === 'slam';
            c.update(dt);
            if (!wasSlam && c.state === 'slam') bus.emit(TNT.EV.CRUSH_SLAM, { x: c.x, y: c.y });
        }
        for (const b of this.boulders) {
            if (b.update(dt, this.room)) bus.emit(TNT.EV.BOULDER_SMASH, { x: b.x, y: b.y });
        }
        for (const v of this.vents) {
            const wasBlast = v.state === 'blast';
            const blasting = v.update(dt);
            if (!wasBlast && blasting) bus.emit(TNT.EV.VENT_FIRED, { x: v.x, y: v.baseY });
        }
        for (const l of this.lifts) l.update(dt);
        this._updateCrumbles(dt, bus);
    };

    /**
     * Crumbling planks.
     *
     * State lives in a map keyed by tile index rather than in the tile array,
     * because the tile array is the *authored* room and a plank that is
     * mid-collapse is a temporary fact about this life. The tile itself is
     * switched to EMPTY while it is gone and switched back when it reforms.
     */
    RoomEntities.prototype.touchCrumble = function (tx, ty) {
        const key = ty * C.COLS + tx;
        if (this.crumbles.has(key)) return;
        this.crumbles.set(key, { tx: tx, ty: ty, state: 'shake', timer: C.CRUMBLE_SHAKE, shake: 0 });
    };

    RoomEntities.prototype.crumbleAt = function (tx, ty) {
        return this.crumbles.get(ty * C.COLS + tx) || null;
    };

    RoomEntities.prototype._updateCrumbles = function (dt, bus) {
        for (const [key, c] of this.crumbles) {
            c.timer -= dt;
            if (c.state === 'shake') {
                c.shake = 1 - Math.max(0, c.timer) / C.CRUMBLE_SHAKE;
                if (c.timer <= 0) {
                    c.state = 'falling';
                    c.timer = C.CRUMBLE_FALL;
                    this.room.set(c.tx, c.ty, T.EMPTY);
                    bus.emit(TNT.EV.CRUMBLE, { x: tileCentre(c.tx), y: c.ty * C.TILE });
                }
            } else if (c.state === 'falling') {
                if (c.timer <= 0) {
                    c.state = 'gone';
                    c.timer = C.CRUMBLE_BACK;
                }
            } else if (c.timer <= 0) {
                this.room.set(c.tx, c.ty, T.CRUMBLE);
                this.crumbles.delete(key);
            }
        }
    };

    /**
     * Put the room's machinery back where it started, and leave the pickups be.
     *
     * This is what a respawn calls. The distinction is the whole point: patrols,
     * pistons, droppers and half-collapsed planks are facts about the life that
     * just ended and should not be inherited, but a stick already carried out of
     * this room is banked. Rebuilding the room wholesale gets the first half
     * right and the second half badly wrong — it resurrects the pickups, and
     * dying becomes a way to farm a room for score.
     */
    RoomEntities.prototype.rewind = function () {
        for (const [, c] of this.crumbles) {
            this.room.set(c.tx, c.ty, T.CRUMBLE);
        }
        this.crumbles.clear();

        this.shots.length = 0;
        if (this.boss) this.boss.rewind();
        for (const h of this.hooks) h.t = 0;
        for (const p of this.pickups) { p.pullX = p.pullY = 0; }
        for (const e of this.enemies) {
            e.dead = false;
            e.deadT = 0;
            e.t = 0;
            e.dir = 1;
            if (e.state !== undefined && e.kind !== 'spider' && e.kind !== 'dog') {
                e.state = e.kind === 'bat' ? 'weave' : 'patrol';
                e.timer = 0;
                e.cooldown = e.kind === 'bat' ? 1 : 0;
            }
            if (e.kind === 'orb') e.y = e.minY;
            else if (e.kind === 'spider') { e.y = e.homeY; e.state = 'wait'; e.timer = SPIDER_WAIT; e.thread = 0; }
            else if (e.kind === 'guardian') { e.x = e.homeX; e.y = e.homeY; e.reformIn = 0; e.state = 'idle'; e.timer = 0; }
            else if (e.kind === 'dog') { e.x = e.minX; e.state = 'patrol'; e.timer = 0; }
            else e.x = e.minX;
        }
        for (const w of this.warps) w.lock = 0;
        if (this.flood) this.flood.reset();
        for (const c of this.crushers) { c.phase = 0; c.state = 'idle'; c.y = c.topY; }
        for (const b of this.boulders) { b.falling = false; b.phase = 0; b.y = b.homeY; b.vy = 0; }
        for (const v of this.vents) { v.phase = 0; v.state = 'idle'; v.height = 0; }
        for (const l of this.lifts) { l.t = 0; l.dir = 1; l.pause = 0; l.x = l.aX; l.y = l.aY; l.prevX = l.x; l.prevY = l.y; }
    };

    /** The fans' lift at a point, 0..1. */
    RoomEntities.prototype.updraft = function (px, py) {
        let lift = 0;
        for (const f of this.fans) lift = Math.max(lift, f.lift(px, py));
        return lift;
    };

    /** The rail run covering a tile, if any. */
    RoomEntities.prototype.railAt = function (tx, ty) {
        for (const r of this.rails) if (r.covers(tx, ty)) return r;
        return null;
    };

    /** Put a shot in the air. Called by the patrols that shoot. */
    RoomEntities.prototype.fire = function (kind, x, y, vx, vy, grav) {
        this.shots.push(new Shot(kind, x, y, vx, vy, grav));
        if (this.bus) this.bus.emit(TNT.EV.ENEMY_FIRED, { x: x, y: y, kind: kind });
    };

    /**
     * Throw a lever: every gate in the room winds up, and the tiles open.
     * Returns false if it was already thrown.
     */
    RoomEntities.prototype.throwLever = function (lever) {
        if (lever.thrown) return false;
        lever.thrown = true;
        for (const g of this.gates) {
            g.open = true;
            this.room.set(g.tx, g.ty, T.EMPTY);
        }
        return true;
    };

    /** Enemies within a blast. Returns how many were destroyed. */
    RoomEntities.prototype.killNear = function (x, y, radius) {
        this.shots = this.shots.filter(function (s) { return Math.hypot(s.x - x, s.y - y) > radius; });
        let n = 0;
        for (const e of this.enemies) {
            if (e.dead) continue;
            const b = e.box();
            if (Math.hypot(b.x - x, b.y - y) <= radius) {
                e.dead = true;
                e.deadT = 0;
                n++;
            }
        }
        return n;
    };

    const Entities = {
        RoomEntities: RoomEntities,
        Pickup: Pickup,
        Lift: Lift,
        Crusher: Crusher,
        Boulder: Boulder,
        Vent: Vent,
        Flood: Flood,
        Warp: Warp,
        Spider: Spider,
        Guardian: Guardian,
        Dog: Dog,
        Shot: Shot,
        PICKUP_SPEC: PICKUP_SPEC,
        ENEMY_SPEC: ENEMY_SPEC,

        /** Build the entity sets for every room of a mine. */
        forMine: function (mine) {
            return mine.rooms.map(function (room) {
                return new RoomEntities(room, mine);
            });
        }
    };

    TNT.Entities = Entities;
})(window.TNT = window.TNT || {});
