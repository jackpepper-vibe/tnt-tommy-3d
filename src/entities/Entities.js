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
        food:   { w: 11, h: 11, score: C.SCORE_FOOD,  glow: false, respawn: C.FOOD_RESPAWN },
        heart:  { w: 12, h: 11, score: C.SCORE_HEART, glow: true,  respawn: 0 },
        oxygen: { w: 10, h: 14, score: 0,             glow: true,  respawn: 0 }
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
        this.y = this.homeY + Math.sin(this.t * 2.4 + this.phase) * 1.8;
    };

    Pickup.prototype.take = function () {
        this.taken = true;
        this.timer = this.spec.respawn;
    };

    Pickup.prototype.box = function () {
        return box(this.x, this.y - this.spec.h / 2, this.spec.w, this.spec.h);
    };

    /* ------------------------------------------------------------------ *
     * Enemies
     * ------------------------------------------------------------------ */

    const ENEMY_SPEC = {
        walker:  { w: 13, h: 13, speed: 46, damage: C.DMG_ENEMY },
        crawler: { w: 13, h: 10, speed: 27, damage: C.DMG_ENEMY },
        bat:     { w: 14, h: 10, speed: 62, damage: C.DMG_ENEMY },
        orb:     { w: 11, h: 11, speed: 58, damage: C.DMG_ENEMY }
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
    }

    Ground.prototype.update = function (dt) {
        if (this.dead) return;
        this.t += dt;
        if (this.kind === 'crawler') {
            this._turnIn -= dt;
            if (this._turnIn <= 0) {
                this._turnIn = 1.8 + (this.x % 7) * 0.3;
                this.dir = -this.dir;
            }
        }
        this.x += this.dir * this.speed * dt;
        if (this.x <= this.minX) { this.x = this.minX; this.dir = 1; }
        if (this.x >= this.maxX) { this.x = this.maxX; this.dir = -1; }
    };

    Ground.prototype.box = function () {
        return box(this.x, this.y - this.spec.h / 2, this.spec.w, this.spec.h);
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
    }

    Bat.prototype.update = function (dt) {
        if (this.dead) return;
        this.t += dt;
        this.x += this.dir * this.speed * dt;
        if (this.x <= this.minX) { this.x = this.minX; this.dir = 1; }
        if (this.x >= this.maxX) { this.x = this.maxX; this.dir = -1; }
        this.y = this.baseY + Math.sin(this.t * 3.1) * this.amp;
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
        if (this.dead) return;
        this.t += dt;
        this.y += this.dir * this.speed * dt;
        if (this.y <= this.minY) { this.y = this.minY; this.dir = 1; }
        if (this.y >= this.maxY) { this.y = this.maxY; this.dir = -1; }
    };

    Orb.prototype.box = function () {
        return box(this.x, this.y, this.spec.w, this.spec.h);
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
    function openSpanX(room, tx, ty) {
        let x0 = tx, x1 = tx;
        while (x0 > 0 && !Tiles.isSolid(room.get(x0 - 1, ty))) x0--;
        while (x1 < C.COLS - 1 && !Tiles.isSolid(room.get(x1 + 1, ty))) x1++;
        return { x0: x0, x1: x1 };
    }

    function openSpanY(room, tx, ty) {
        let y0 = ty, y1 = ty;
        while (y0 > 0 && !Tiles.isFloor(room.get(tx, y0 - 1))) y0--;
        while (y1 < C.ROWS - 1 && !Tiles.isFloor(room.get(tx, y1 + 1))) y1++;
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
        this.detonator = null;
        /** Set once every nugget in the room has been taken; the bonus is once. */
        this.oreCleared = false;

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
                case 'bat':
                    this.enemies.push(new Bat(s.tx, s.ty, room, mul));
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
                default:
                    throw new Error(room.id + ': no entity for spawn kind "' + s.kind + '"');
            }
        }

        // Vents are terrain rather than actors — they are a hole in the floor —
        // so they are found by scanning rather than by spawn record.
        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                const t = room.get(tx, ty);
                if (t === T.VENT) this.vents.push(new Vent(tx, ty));
                else if (t === T.DETONATOR) this.detonator = { x: tileCentre(tx), y: ty * C.TILE + C.TILE };
            }
        }

        pairLifts(this, liftMarks, room);
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

    RoomEntities.prototype.update = function (dt, bus) {
        for (const p of this.pickups) p.update(dt);
        for (const e of this.enemies) e.update(dt);
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

        for (const e of this.enemies) {
            e.dead = false;
            e.t = 0;
            e.dir = 1;
            if (e.kind === 'orb') e.y = e.minY;
            else e.x = e.minX;
        }
        for (const c of this.crushers) { c.phase = 0; c.state = 'idle'; c.y = c.topY; }
        for (const b of this.boulders) { b.falling = false; b.phase = 0; b.y = b.homeY; b.vy = 0; }
        for (const v of this.vents) { v.phase = 0; v.state = 'idle'; v.height = 0; }
        for (const l of this.lifts) { l.t = 0; l.dir = 1; l.pause = 0; l.x = l.aX; l.y = l.aY; l.prevX = l.x; l.prevY = l.y; }
    };

    /** Enemies within a blast. Returns how many were destroyed. */
    RoomEntities.prototype.killNear = function (x, y, radius) {
        let n = 0;
        for (const e of this.enemies) {
            if (e.dead) continue;
            const b = e.box();
            if (Math.hypot(b.x - x, b.y - y) <= radius) {
                e.dead = true;
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
