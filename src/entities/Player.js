/**
 * TNT Tommy — the player, and the movement model the whole game is built on.
 *
 * THE RULE
 * --------
 * There is no jump. Height is only ever gained by climbing a ladder, climbing a
 * hanging rope, or riding a lift. Nothing — not a trampoline, not a steam vent,
 * not a conveyor, not a slope — gives Tommy upward velocity he did not climb
 * for. Everything below follows from that one constraint, and any change that
 * quietly reintroduces a hop breaks the level design of all twenty-seven rooms
 * at once, because every room is authored on the assumption that a ledge without
 * a ladder is unreachable.
 *
 * WHAT THE CONSTRAINT COSTS, AND HOW IT IS PAID
 * ---------------------------------------------
 * Take away the jump and a platformer loses its main verb, so three others have
 * to carry more weight than they normally would:
 *
 *   - **Falling is a move, not a mistake.** Walking off a ledge is how you get
 *     down, so it has to be *aimed*. Air control is close to ground control
 *     (`C.AIR_ACC`, `C.AIR_MAX`) where a jumping game would keep it tight, and
 *     the level grid guarantees a one-storey drop never hurts.
 *   - **Ladders need generous mouths.** With no hop to correct a near miss, a
 *     ladder you slide past is a ladder you cannot use. Mounting snaps Tommy to
 *     the centre line (`C.MOUNT_SNAP`) rather than requiring him to be on it,
 *     and stepping off an edge leaves a short grace window (`C.LEDGE_GRACE`).
 *   - **Ropes are boarded sideways.** You reach a rope by climbing to its row
 *     and stepping onto it, never by jumping to it. That is the only way onto
 *     one, which is why `Rooms.js` insists every rope crosses a ladder.
 *
 * SHAPE
 * -----
 * `mode` is a small state machine: `walk` (which covers falling), `climb`,
 * `rope`, `swim`. Each has its own integrator, and the transitions between them
 * are the interesting part of the file. Position is the feet: `x` centred, `y`
 * at the sole. Collision is axis-separated and resolves a single tile per step,
 * which is sound because the step is 1/120 s and nothing moves a whole tile in
 * that time (`C.MAX_FALL` is 640 px/s, or 5.3 px per step).
 */
(function (TNT) {
    'use strict';

    const { C, Util, Tiles } = TNT;
    const T = C.Tile;

    const HALF_W = C.PLAYER_W / 2;
    const EPS = 0.01;

    function Player(bus) {
        this.bus = bus;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.mode = 'walk';
        this.facing = 1;
        this.onGround = false;
        this.alive = true;
        this.active = false;

        this.hasOxygen = false;
        this.invuln = 0;
        this.coyote = 0;
        this.animT = 0;
        /** Set while Down is held so a one-way platform lets you through. */
        this.dropping = 0;
        /** Peak downward speed since leaving the ground, for fall damage. */
        this.fallSpeed = 0;
        /** The lift being ridden, so its motion can carry us. */
        this.ridingLift = null;
        /** Squash/stretch, purely for the renderer to read. */
        this.squash = 0;
        this.climbCol = 0;
        this.ropeRow = 0;
        this.inWater = false;
        this.blastCooldown = 0;
    }

    /* ------------------------------------------------------------------ *
     * Lifecycle
     * ------------------------------------------------------------------ */

    Player.prototype.placeAt = function (x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.mode = 'walk';
        this.onGround = false;
        this.fallSpeed = 0;
        this.dropping = 0;
        this.ridingLift = null;
    };

    Player.prototype.reset = function (x, y, keepKit) {
        this.placeAt(x, y);
        this.alive = true;
        this.active = true;
        this.facing = 1;
        this.invuln = 0;
        this.squash = 0;
        this.blastCooldown = 0;
        if (!keepKit) this.hasOxygen = false;
    };

    Player.prototype.box = function () {
        return { x: this.x, y: this.y - C.PLAYER_H / 2, w: C.PLAYER_W, h: C.PLAYER_H };
    };

    /** Body centre — what pickups, hazards and the lantern are measured from. */
    Player.prototype.centreY = function () {
        return this.y - C.PLAYER_H / 2;
    };

    /* ------------------------------------------------------------------ *
     * Update
     * ------------------------------------------------------------------ */

    /**
     * @param {number} dt
     * @param {TNT.World.Room} room
     * @param {TNT.Input} input
     * @param {TNT.Entities.RoomEntities} ents
     */
    Player.prototype.update = function (dt, room, input, ents) {
        if (!this.active) return;

        this.animT += dt;
        if (this.invuln > 0) this.invuln -= dt;
        if (this.blastCooldown > 0) this.blastCooldown -= dt;
        if (this.dropping > 0) this.dropping -= dt;

        this.inWater = room.at(this.x, this.centreY()) === T.WATER;

        const ax = input.axisX();
        if (ax !== 0) this.facing = ax;

        switch (this.mode) {
            case 'climb': this._climb(dt, room, input); break;
            case 'rope':  this._rope(dt, room, input); break;
            case 'swim':  this._swim(dt, room, input, ents); break;
            default:      this._walk(dt, room, input, ents); break;
        }

        this.squash = Util.damp(this.squash, 0, 9, dt);
    };

    /* ------------------------------------------------------------------ *
     * Walking and falling
     * ------------------------------------------------------------------ */

    Player.prototype._walk = function (dt, room, input, ents) {
        if (this.inWater && this.hasOxygen) {
            this.mode = 'swim';
            return;
        }

        const ax = input.axisX();
        const grounded = this.onGround;

        if (grounded) {
            const target = ax * C.MOVE_MAX;
            this.vx = ax !== 0
                ? Util.approach(this.vx, target, C.MOVE_ACC * dt)
                : Util.approach(this.vx, 0, C.MOVE_FRICTION * dt);
        } else {
            // Air control is wide open on purpose — a drop is how you travel
            // downward here, and a drop you cannot steer is a drop you cannot
            // plan. See the header.
            if (ax !== 0) {
                this.vx = Util.approach(this.vx, ax * C.AIR_MAX, C.AIR_ACC * dt);
            } else {
                this.vx = Util.approach(this.vx, 0, C.AIR_DRAG * dt);
            }
        }

        // Conveyor under the feet.
        if (grounded) {
            const belt = Tiles.beltDir(room.at(this.x, this.y + 2));
            if (belt !== 0) this.x += belt * C.BELT_V * dt;
        }

        this.vy = Math.min(this.vy + C.GRAVITY * dt, C.MAX_FALL);

        // Sliding down a ladder shaft rather than falling down it. See
        // `C.SLIDE_V` — this is what stops every ladder hole in the game from
        // being a lethal trap.
        this.sliding = false;
        if (this.vy > 0 && Tiles.isClimbable(room.at(this.x, this.centreY()))) {
            this.vy = Math.min(this.vy, C.SLIDE_V);
            this.fallSpeed = 0;
            this.sliding = true;
        }

        if (!grounded) this.fallSpeed = Math.max(this.fallSpeed, this.vy);

        this.coyote = grounded ? C.LEDGE_GRACE : Math.max(0, this.coyote - dt);

        // A one-way platform is let go of, not fallen through by accident.
        if (input.justPressed('down') && grounded && this._oneWayBelow(room)) {
            this.dropping = 0.18;
            this.onGround = false;
            this.ridingLift = null;
            this.y += 1;
        }

        this._moveX(this.vx * dt, room);
        this._moveY(this.vy * dt, room, ents);

        if (this._tryMount(room, input)) return;
        if (this._tryBoardRope(room, input)) return;

        if (this.inWater && !this.hasOxygen) {
            // Heavy going, and the fuse burns. `Run` applies the drowning cost;
            // all that happens here is that water is thick.
            this.vx *= 0.86;
            this.vy = Math.min(this.vy, 90);
        }
    };

    /* ------------------------------------------------------------------ *
     * Climbing
     * ------------------------------------------------------------------ */

    /**
     * Mount a ladder or hanging rope.
     *
     * Two ways in, and both matter. Pressing Up while overlapping one is the
     * obvious case. Pressing Down while stood on the *cap* of one is the case
     * that gets forgotten, and without it every ladder in the game is a one-way
     * street: you can climb out at the top and never get back in.
     */
    Player.prototype._tryMount = function (room, input) {
        const cy = this.centreY();
        const up = input.isDown('up');
        const down = input.isDown('down');
        if (!up && !down) return false;

        if (up) {
            const col = this._climbColumnNear(room, cy);
            if (col >= 0) {
                this._startClimb(col);
                return true;
            }
        }

        if (down && this.onGround) {
            const ty = Math.floor((this.y + 2) / C.TILE);
            for (const tx of this._columnsUnder()) {
                if (room.isClimbTop(tx, ty)) {
                    this._startClimb(tx);
                    this.y += 4;
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * The column of a climbable overlapping the body.
     *
     * Checks the centre column first so a ladder Tommy is standing on wins over
     * one he is merely brushing — otherwise walking along a row of ladders
     * grabs whichever happens to be scanned first, and the mount jitters
     * sideways as you walk.
     */
    Player.prototype._climbColumnNear = function (room, cy) {
        const mid = Math.floor(this.x / C.TILE);
        const order = [mid, mid - 1, mid + 1];
        for (const tx of order) {
            const centre = tx * C.TILE + C.TILE / 2;
            if (Math.abs(centre - this.x) > C.TILE * 0.75) continue;
            for (const ty of [Math.floor(cy / C.TILE), Math.floor((this.y - 2) / C.TILE)]) {
                if (Tiles.isClimbable(room.get(tx, ty))) return tx;
            }
        }
        return -1;
    };

    Player.prototype._startClimb = function (tx) {
        this.mode = 'climb';
        this.climbCol = tx;
        this.vx = 0;
        this.vy = 0;
        this.fallSpeed = 0;
        this.onGround = false;
        this.ridingLift = null;
        this.bus.emit(TNT.EV.PLAYER_MOUNT, { x: this.x, y: this.y, kind: 'climb' });
    };

    Player.prototype._climb = function (dt, room, input) {
        const centre = this.climbCol * C.TILE + C.TILE / 2;
        // Pull to the centre line rather than snap: a hard snap reads as the
        // character being yanked, and at this speed it is invisible anyway.
        this.x = Util.approach(this.x, centre, C.MOUNT_SNAP * dt);

        const tile = room.get(this.climbCol, Math.floor(this.centreY() / C.TILE));
        const speed = tile === T.VINE ? C.VINE_V : C.CLIMB_V;
        const ay = input.axisY();

        this.vy = ay * speed;
        this.y += this.vy * dt;
        if (ay !== 0) this.animT += dt * 2;

        // Climbing does not run the tile collision that walking does, so the
        // foot of a ladder has to be checked here or holding Down at the bottom
        // walks Tommy straight into the bedrock. Landing on it is the right
        // answer rather than merely stopping: a ladder that reaches the ground
        // should put you *on* the ground.
        if (ay > 0) {
            const footRow = Math.floor(this.y / C.TILE);
            if (Tiles.isSolid(room.get(this.climbCol, footRow)) && footRow < C.ROWS) {
                this.y = footRow * C.TILE;
                this.mode = 'walk';
                this.vy = 0;
                this.fallSpeed = 0;
                this.onGround = true;
                return;
            }
        }

        // Climbing out through a shaft mouth: hold on. `Run._checkRoomChange`
        // fires this same step and the ladder continues in the next room, but
        // asking the room about a row it does not have answers ROCK, which
        // would let go of the ladder exactly at the seam and drop him back.
        if (this.y <= 0 || this.y >= C.ROOM_H) return;

        // Off the bottom: stand up if there is ground, otherwise let go.
        const feetTile = room.get(this.climbCol, Math.floor((this.y - 1) / C.TILE));
        const stillOn = Tiles.isClimbable(feetTile) ||
            Tiles.isClimbable(room.get(this.climbCol, Math.floor(this.centreY() / C.TILE)));

        if (!stillOn) {
            // Climbed off the top of the shaft: stand on the cap.
            this.mode = 'walk';
            this.vy = 0;
            this.fallSpeed = 0;
            return;
        }

        // Step off sideways, onto a rope if one crosses here, otherwise onto
        // any floor beside the ladder. This is the only way onto a rope.
        const ax = input.axisX();
        if (ax !== 0) {
            if (this._tryBoardRope(room, input)) return;
            const sideX = this.x + ax * C.TILE;
            const footTile = room.get(Math.floor(sideX / C.TILE), Math.floor((this.y + 2) / C.TILE));
            const bodyTile = room.get(Math.floor(sideX / C.TILE), Math.floor(this.centreY() / C.TILE));
            if (Tiles.isFloor(footTile) && !Tiles.isSolid(bodyTile)) {
                this.mode = 'walk';
                this.x = sideX;
                this.vx = ax * C.MOVE_MAX * 0.5;
                this.vy = 0;
                return;
            }
        }

        this._clampToRoomInterior(room);
    };

    /* ------------------------------------------------------------------ *
     * Ropes
     * ------------------------------------------------------------------ */

    /** Board a rope line crossing the body's row. */
    Player.prototype._tryBoardRope = function (room, input) {
        const ax = input.axisX();
        if (ax === 0) return false;

        const ty = Math.floor((this.y - C.PLAYER_H * 0.75) / C.TILE);
        const tx = Math.floor((this.x + ax * C.TILE * 0.6) / C.TILE);
        if (room.get(tx, ty) !== T.ROPE) return false;

        this.mode = 'rope';
        this.ropeRow = ty;
        this.vy = 0;
        this.fallSpeed = 0;
        this.onGround = false;
        this.ridingLift = null;
        // Hang from it: the hands are on the line, so the feet are a body below.
        this.y = ty * C.TILE + C.TILE * 0.5 + C.PLAYER_H;
        this.bus.emit(TNT.EV.PLAYER_MOUNT, { x: this.x, y: this.y, kind: 'rope' });
        return true;
    };

    Player.prototype._rope = function (dt, room, input) {
        const ax = input.axisX();
        this.vx = ax * C.ROPE_V;
        this.x += this.vx * dt;
        if (ax !== 0) this.animT += dt * 1.6;

        // Let go deliberately, or when the line runs out.
        const here = room.get(Math.floor(this.x / C.TILE), this.ropeRow);
        const climbHere = Tiles.isClimbable(here);
        if (input.justPressed('down') || (here !== T.ROPE && !climbHere)) {
            this.mode = 'walk';
            this.vy = 0;
            this.fallSpeed = 0;
            return;
        }

        // A ladder crossing the line is a way off it, up or down.
        if (climbHere && (input.isDown('up') || input.isDown('down'))) {
            this._startClimb(Math.floor(this.x / C.TILE));
            return;
        }

        this.y = this.ropeRow * C.TILE + C.TILE * 0.5 + C.PLAYER_H + this._ropeSag(room);
        this._clampToRoomInterior(room);
    };

    /** The line dips under Tommy's weight, deepest at midspan. */
    Player.prototype._ropeSag = function (room) {
        let x0 = Math.floor(this.x / C.TILE), x1 = x0;
        while (x0 > 0 && room.get(x0 - 1, this.ropeRow) === T.ROPE) x0--;
        while (x1 < C.COLS - 1 && room.get(x1 + 1, this.ropeRow) === T.ROPE) x1++;
        const span = (x1 - x0 + 1) * C.TILE;
        if (span <= C.TILE) return 0;
        const k = (this.x - x0 * C.TILE) / span;
        return Math.sin(Util.clamp(k, 0, 1) * Math.PI) * C.ROPE_SAG;
    };

    /* ------------------------------------------------------------------ *
     * Swimming
     * ------------------------------------------------------------------ */

    Player.prototype._swim = function (dt, room, input, ents) {
        if (!this.inWater || !this.hasOxygen) {
            this.mode = 'walk';
            return;
        }
        const ax = input.axisX();
        const ay = input.axisY();

        this.vx = Util.approach(this.vx, ax * C.MOVE_MAX * C.SWIM_MOVE, C.MOVE_ACC * dt);
        this.vy += C.GRAVITY * C.SWIM_GRAV * dt;
        if (ay !== 0) this.vy = Util.approach(this.vy, ay * C.SWIM_V, C.MOVE_ACC * dt);
        this.vy = Util.damp(this.vy, 0, C.SWIM_DRAG, dt);

        this._moveX(this.vx * dt, room);
        this._moveY(this.vy * dt, room, ents);
        this.fallSpeed = 0;

        this._tryMount(room, input);
    };

    /* ------------------------------------------------------------------ *
     * Collision
     * ------------------------------------------------------------------ */

    /**
     * Is this tile a wall *to the player*?
     *
     * Outside the room is deliberately not. `Room.get` answers ROCK beyond its
     * edges, which is right for everything else in the game — patrol spans,
     * blast radii, the reachability walk all want a room to be a closed box.
     * The player is the one thing that has to be able to leave one, and the only
     * way he can reach a tile beyond the edge at all is through a doorway that
     * `World.cutFrames` opened. Consulting the room here instead means every
     * doorway in the mine is still a wall, and no transition ever fires.
     */
    function blocked(room, tx, ty) {
        if (tx < 0 || tx >= C.COLS || ty < 0 || ty >= C.ROWS) return false;
        return Tiles.isSolid(room.get(tx, ty));
    }

    Player.prototype._moveX = function (dx, room) {
        if (dx === 0) return;
        this.x += dx;

        const top = this.y - C.PLAYER_H + 2;
        const bottom = this.y - 2;
        const ty0 = Math.floor(top / C.TILE);
        const ty1 = Math.floor(bottom / C.TILE);

        if (dx > 0) {
            const tx = Math.floor((this.x + HALF_W) / C.TILE);
            for (let ty = ty0; ty <= ty1; ty++) {
                if (blocked(room, tx, ty)) {
                    this.x = tx * C.TILE - HALF_W - EPS;
                    this.vx = 0;
                    return;
                }
            }
        } else {
            const tx = Math.floor((this.x - HALF_W) / C.TILE);
            for (let ty = ty0; ty <= ty1; ty++) {
                if (blocked(room, tx, ty)) {
                    this.x = (tx + 1) * C.TILE + HALF_W + EPS;
                    this.vx = 0;
                    return;
                }
            }
        }
    };

    Player.prototype._moveY = function (dy, room, ents) {
        const prevY = this.y;
        this.y += dy;
        const wasGround = this.onGround;
        this.onGround = false;
        this.ridingLift = null;

        const left = this.x - HALF_W + 1;
        const right = this.x + HALF_W - 1;
        const tx0 = Math.floor(left / C.TILE);
        const tx1 = Math.floor(right / C.TILE);

        if (dy >= 0) {
            const ty = Math.floor(this.y / C.TILE);
            const surface = ty * C.TILE;
            const outside = ty < 0 || ty >= C.ROWS;
            for (let tx = tx0; tx <= tx1 && !outside; tx++) {
                const t = room.get(tx, ty);
                let landed = false;

                if (blocked(room, tx, ty)) {
                    landed = true;
                } else if (Tiles.isOneWay(t) && this.dropping <= 0 &&
                           prevY <= surface + EPS && this.y >= surface) {
                    landed = true;
                }

                if (landed) {
                    this.y = surface;
                    this._land(room, ents, tx, ty);
                    return;
                }
            }
            this._landOnLift(prevY, ents);
        } else {
            const ty = Math.floor((this.y - C.PLAYER_H) / C.TILE);
            for (let tx = tx0; tx <= tx1; tx++) {
                if (blocked(room, tx, ty)) {
                    this.y = (ty + 1) * C.TILE + C.PLAYER_H + EPS;
                    this.vy = 0;
                    return;
                }
            }
        }

        if (wasGround && !this.onGround) this.fallSpeed = Math.max(this.fallSpeed, 0);
    };

    /**
     * Lifts are checked after tiles and only when falling onto them.
     *
     * A lift is not in the tile array — it moves — so it gets its own pass. The
     * rider is carried by the platform's *delta* rather than re-seated at its
     * position each step, because a lift that reverses would otherwise leave the
     * rider behind for one frame and slide him off the end.
     */
    Player.prototype._landOnLift = function (prevY, ents) {
        if (!ents || this.vy < 0) return;
        for (const lift of ents.lifts) {
            const top = lift.top();
            const prevTop = lift.axis === 'v' ? lift.prevY : top;
            if (this.x + HALF_W < lift.x || this.x - HALF_W > lift.x + lift.w) continue;
            if (prevY > prevTop + 2 || this.y < top) continue;
            this.y = top;
            this.ridingLift = lift;
            this._settle();
            return;
        }
    };

    /** Carry a rider with its lift. Called by `Run` after the lifts have moved. */
    Player.prototype.carry = function () {
        const lift = this.ridingLift;
        if (!lift) return;
        this.x += lift.x - lift.prevX;
        this.y += lift.y - lift.prevY;
    };

    Player.prototype._land = function (room, ents, tx, ty) {
        const t = room.get(tx, ty);
        if (t === T.CRUMBLE && ents) ents.touchCrumble(tx, ty);
        this._settle();
    };

    Player.prototype._settle = function () {
        const impact = this.fallSpeed;
        this.onGround = true;
        this.vy = 0;
        this.dropping = 0;
        if (impact > 60) {
            this.squash = Util.clamp(impact / C.MAX_FALL, 0, 1);
            this.bus.emit(TNT.EV.PLAYER_LANDED, {
                x: this.x, y: this.y, speed: impact, hard: impact >= C.FALL_SAFE
            });
        }
        this.fallSpeed = 0;
    };

    /** Keep climbing and roping inside the room; `Run` owns the edges. */
    Player.prototype._clampToRoomInterior = function (room) {
        this.x = Util.clamp(this.x, HALF_W + 1, C.ROOM_W - HALF_W - 1);
    };

    Player.prototype._oneWayBelow = function (room) {
        const ty = Math.floor((this.y + 2) / C.TILE);
        for (const tx of this._columnsUnder()) {
            if (Tiles.isOneWay(room.get(tx, ty))) return true;
        }
        return this.ridingLift !== null;
    };

    Player.prototype._columnsUnder = function () {
        const a = Math.floor((this.x - HALF_W + 1) / C.TILE);
        const b = Math.floor((this.x + HALF_W - 1) / C.TILE);
        return a === b ? [a] : [a, b];
    };

    /* ------------------------------------------------------------------ *
     * Being hit
     * ------------------------------------------------------------------ */

    /**
     * Knock Tommy back from a hazard.
     *
     * Upward knockback is capped hard. A hit that lobs him a couple of tiles
     * into the air is the one place the no-jump rule could leak, and worse, it
     * would occasionally be *useful* — being hit on purpose to reach a ledge is
     * exactly the kind of thing players find and designers never intended.
     */
    Player.prototype.knock = function (dirX) {
        this.mode = 'walk';
        this.vx = dirX * 150;
        this.vy = -90;
        this.onGround = false;
        this.ridingLift = null;
        this.fallSpeed = 0;
        this.invuln = C.HURT_INVULN;
    };

    /** Which animation the renderer should be showing. */
    Player.prototype.pose = function () {
        if (!this.alive) return 'dead';
        if (this.mode === 'climb') return 'climb';
        if (this.mode === 'rope') return 'rope';
        if (this.mode === 'swim') return 'swim';
        if (!this.onGround) return this.vy < 0 ? 'rise' : 'fall';
        if (Math.abs(this.vx) > 22) return 'run';
        return 'idle';
    };

    TNT.Player = Player;
})(window.TNT = window.TNT || {});
