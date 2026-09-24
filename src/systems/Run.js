/**
 * TNT Tommy — the run: game state, rules and the loop body.
 *
 * This is the only module that writes to everything else. The player moves
 * itself, entities move themselves, and `Run` decides what any of it means:
 * what you picked up, what hit you, when the room changes, when the fuse runs
 * out. Presentation hears about all of it through the bus and never by being
 * called directly.
 *
 * THE FUSE
 * --------
 * One bar is the energy meter and the clock at once. It drains on its own,
 * damage takes a bite, food is the only way to put any back, and at zero you
 * die. Carried over from the Godot build because it does something a separate
 * timer cannot: it makes taking a hit and taking too long the *same* mistake,
 * so there is never a safe way to stall.
 *
 * STATES
 * ------
 *   title → playing ⇄ transition
 *              ↓ dying → playing | gameover
 *              ↓ boom → workshop → playing (next mine)
 *                     ↘ victory (after the last)
 *
 * GOALS
 * -----
 * A mine asks three things of you, in rising order of commitment: find the
 * twelve sticks, break the Governor that guards the plunger, and get back to
 * the plunger alive once the last stick starts the seam coming down. Beside
 * that runs the optional thread — brass cogs, hidden and sniffed out by the
 * dog — which pays for kit at the workshop between mines.
 */
(function (TNT) {
    'use strict';

    const { C, Util, Tiles, World, Entities, Player, Companion, EventBus, Upgrades } = TNT;
    const T = C.Tile;
    const EV = TNT.EV;

    const STATES = ['title', 'playing', 'transition', 'dying', 'boom', 'cleared', 'workshop',
                    'gameover', 'victory'];

    function Run() {
        this.bus = new EventBus();
        this.mines = World.buildAll();
        this.player = new Player(this.bus);
        /** Tommy's dog. Follows him, and points at secrets. */
        this.dog = new Companion(this.bus);

        this.state = 'title';
        this.mineIndex = 0;
        this.mine = this.mines[0];

        // The title screen composites over a live room, so a run has to exist
        // from the moment the page loads — entities built, a room selected and
        // Tommy parked at the spawn. Leaving these empty until `startMine` was
        // the first version, and the renderer has nothing to draw behind the
        // title card.
        this.entities = Entities.forMine(this.mine);
        this.roomIndex = this.mine.spawnRoom;

        this.lives = C.LIVES_START;
        this.energy = C.ENERGY_MAX;
        this.score = 0;
        this.tntHeld = 0;
        this.tntFound = 0;
        this.elapsed = 0;
        this.danger = false;
        this.allTntAnnounced = false;
        this.medals = 0;
        /** Seconds left on the run out, or 0 when it is not running. */
        this.escape = 0;

        /** Sticks spent on blasts, newest last, so one can be handed back. */
        this._spentStack = [];
        this.bombs = [];

        this.checkpoint = { room: this.roomIndex, x: this.mine.spawnX, y: this.mine.spawnY };
        this.player.placeAt(this.mine.spawnX, this.mine.spawnY);
        this.dog.placeAt(this.mine.spawnX, this.mine.spawnY, 1);
        /** Brass cogs held, across the run; spent at the workshop. */
        this.cogs = 0;
        /** Cogs found in this mine, out of `C.COGS_PER_MINE`. */
        this.cogsFound = 0;
        /** Levels of each workshop item bought. See `Upgrades`. */
        this.upgrades = Upgrades.fresh();
        this.mods = Upgrades.mods(this.upgrades);

        this._checkpointDwell = 0;
        this._timer = 0;
        this._transition = null;
        /** Seconds the simulation is held for an impact. See `C.HITSTOP_STOMP`. */
        this.hitstop = 0;
        /** Stomps since Tommy last touched the ground. */
        this.stompChain = 0;
        this.best = loadBest();

        /*
         * A heavy landing costs fuse. `C.FALL_DMG` was documented as doing
         * this from the start and nothing ever applied it, so dropping the
         * height of a room was free — the one traversal option with no
         * downside. It never kills: the cost stops at one point of fuse.
         */
        const self = this;
        this.bus.on(EV.PLAYER_LANDED, function (e) {
            if (self.state !== 'playing' || e.speed < self.mods.fallSafe) return;
            self.energy = Math.max(1, self.energy - C.FALL_DMG);
            self.bus.emit(EV.PLAYER_HURT, { x: e.x, y: e.y, cause: 'fall', amount: C.FALL_DMG });
        });
    }

    /* ------------------------------------------------------------------ *
     * Flow
     * ------------------------------------------------------------------ */

    Run.prototype._setState = function (next) {
        if (this.state === next) return;
        if (STATES.indexOf(next) < 0) throw new Error('unknown state "' + next + '"');
        const from = this.state;
        this.state = next;
        this.bus.emit(EV.STATE_CHANGED, { from: from, to: next });
    };

    Run.prototype.startRun = function () {
        this.lives = C.LIVES_START;
        this.score = 0;
        this.elapsed = 0;
        this.cogs = 0;
        this.upgrades = Upgrades.fresh();
        this.mods = Upgrades.mods(this.upgrades);
        this.startMine(0);
    };

    Run.prototype.startMine = function (index) {
        this.mineIndex = index;
        this.mine = this.mines[index];
        this.mine.reset();
        this.entities = Entities.forMine(this.mine);

        this.energy = C.ENERGY_MAX;
        this.tntHeld = 0;
        this.tntFound = 0;
        this.danger = false;
        this.allTntAnnounced = false;
        this.medals = 0;
        this.escape = 0;
        this.cogsFound = 0;
        this._spentStack.length = 0;
        this.bombs.length = 0;

        this.roomIndex = this.mine.spawnRoom;
        this.checkpoint = { room: this.mine.spawnRoom, x: this.mine.spawnX, y: this.mine.spawnY };
        this.player.reset(this.mine.spawnX, this.mine.spawnY, false);
        if (this.mods.startTank) this.player.hasOxygen = true;
        this.dog.placeAt(this.mine.spawnX, this.mine.spawnY, 1);

        this._setState('playing');
        this.ents().seen = true;
        this.bus.emit(EV.MINE_STARTED, { mine: this.mine, index: index });
        this.bus.emit(EV.ROOM_CHANGED, { room: this.room(), dir: null });
    };

    Run.prototype.room = function () {
        return this.mine.rooms[this.roomIndex];
    };

    Run.prototype.ents = function () {
        return this.entities[this.roomIndex];
    };

    /** Total sticks still to find in this mine. */
    Run.prototype.tntRemaining = function () {
        return Math.max(0, this.mine.tntTotal - this.tntFound);
    };

    /* ------------------------------------------------------------------ *
     * Update
     * ------------------------------------------------------------------ */

    Run.prototype.update = function (dt, input) {
        // Hit-stop freezes everything — the fuse, the patrols, Tommy — and
        // leaves the renderer drawing, so an impact reads as a blow.
        if (this.hitstop > 0) {
            this.hitstop -= dt;
            return;
        }
        this._timer += dt;

        switch (this.state) {
            case 'playing':
                this._updatePlaying(dt, input);
                break;
            case 'transition':
                this._transition.t += dt;
                if (this._transition.t >= this._transition.len) {
                    this._transition = null;
                    this.player.active = true;
                    this._setState('playing');
                }
                // Rooms keep running during a flip so a patrol is where you
                // last saw it when the camera arrives, not reset by the pause.
                this._updateWorld(dt);
                break;
            case 'dying':
                this._timer += 0;
                this._updateWorld(dt);
                if (this._timer >= C.DEATH_FREEZE) this._respawn();
                break;
            case 'boom':
                this._updateWorld(dt);
                if (this._timer >= 1.5) this._afterBoom();
                break;
            default:
                break;
        }
    };

    Run.prototype._updatePlaying = function (dt, input) {
        this.elapsed += dt;
        this._jumpHeld = input.isDown('jump') || input.isDown('up');

        this._burnFuse(dt);
        if (this.state !== 'playing') return;

        this._updateWorld(dt);

        const room = this.room();
        const ents = this.ents();

        this.player.update(dt, room, input, ents);
        this.player.carry();
        this.dog.update(dt, this.player);
        if (this.player.onGround || this.player.mode !== 'walk') this.stompChain = 0;

        if (this._checkWarp(input)) return;
        if (input.justPressed('plant')) this._plant();
        this._updateBombs(dt);

        this._collectPickups();
        this._checkSecrets();
        this._checkLevers();
        this._checkHazards(dt);
        if (this.state !== 'playing') return;

        this._checkDetonator(input);
        this._checkRoomChange();
    };

    /**
     * Entities tick even while the camera is mid-flip or Tommy is dying.
     *
     * Only the occupied room gets the player. The dog, the spider and the
     * guardian all react to him, and handing them a player they cannot see
     * would have every patrol in the mine converging on a room they are not in.
     */
    Run.prototype._updateWorld = function (dt) {
        const ents = this.ents();
        if (ents) ents.update(dt, this.bus, this.player, true);
    };

    /**
     * The run out.
     *
     * Lifting the last stick starts the seam coming down, and from that moment
     * a hard countdown replaces the fuse as the thing that will kill you. This
     * is Dynamite Dan's best idea: it turns a collection game into a
     * route-planning one, because the whole mine is spent deciding *where to
     * leave the twelfth stick* so that the walk back is one you can make.
     *
     * The fuse keeps burning underneath, so eating on the way out still matters
     * — but food cannot buy you time on the countdown.
     */
    Run.prototype._burnEscape = function (dt) {
        if (this.escape <= 0) return;
        const before = Math.ceil(this.escape);
        this.escape -= dt;
        const now = Math.ceil(this.escape);
        if (now !== before) this.bus.emit(EV.ESCAPE_TICK, { left: Math.max(0, now) });
        if (this.escape <= 0) {
            this.escape = 0;
            this._die('collapse');
        }
    };

    Run.prototype._burnFuse = function (dt) {
        this._burnEscape(dt);
        if (this.state !== 'playing') return;

        const rate = C.ENERGY_MAX / (C.FUSE_SECONDS * this.mine.fuseMul * this.mods.fuseMul);
        this.energy -= rate * dt;

        if (this.player.inWater && !this.player.hasOxygen) {
            this.energy -= C.DROWN_RATE * dt;
        }

        // Hysteresis, or the track flaps between the two either side of the
        // threshold every time you eat.
        if (!this.danger && this.energy < C.DANGER_BELOW) this.danger = true;
        else if (this.danger && this.energy > C.DANGER_CLEAR) this.danger = false;

        if (this.energy <= 0) {
            this.energy = 0;
            this._die('fuse');
        }
    };

    /* ------------------------------------------------------------------ *
     * Pickups
     * ------------------------------------------------------------------ */

    Run.prototype._collectPickups = function () {
        const ents = this.ents();
        const player = this.player;
        const pb = player.box();

        for (const p of ents.pickups) {
            if (p.taken) continue;
            // Nuggets close by drift in, so a deck is swept rather than
            // picked over pixel by pixel.
            if (p.kind === 'ore') p.attract(player.x, player.centreY(), C.FIXED_DT);
            const b = p.box();
            if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;

            p.take();
            this.score += p.spec.score;

            switch (p.kind) {
                case 'tnt':
                    this.tntHeld++;
                    this.tntFound++;
                    if (this.tntFound >= this.mine.tntTotal && !this.allTntAnnounced) {
                        this.allTntAnnounced = true;
                        this.escape = C.ESCAPE_SECONDS;
                        this.bus.emit(EV.ALL_TNT, { x: p.x, y: p.y });
                        this.bus.emit(EV.ESCAPE_STARTED, { seconds: this.escape });
                    }
                    break;
                case 'food':
                    this.energy = Math.min(C.ENERGY_MAX, this.energy + C.FOOD_ENERGY * this.mods.foodMul);
                    break;
                case 'cog':
                    this.cogs++;
                    this.cogsFound++;
                    this.dog.release();
                    this.dog.yap();
                    break;
                case 'heart':
                    this.lives = Math.min(C.LIVES_MAX, this.lives + 1);
                    break;
                case 'oxygen':
                    this.player.hasOxygen = true;
                    break;
                default:
                    break;
            }

            this.bus.emit(EV.PICKUP, { kind: p.kind, x: p.x, y: p.y, value: p.spec.score });
            this._checkRoomCleared();
        }
    };

    /**
     * A medal for stripping a room of every nugget.
     *
     * Carried over from Dynamite Dan, and it does more work than the points
     * suggest: without it a flick-screen mine is a series of corridors you pass
     * through once, and with it every room is somewhere you might choose to go
     * back to. The minimap shows which ones are done, and clearing all nine is
     * worth more than the nine medals put together.
     */
    Run.prototype._checkRoomCleared = function () {
        const ents = this.ents();
        if (ents.medal || ents.room.oreCount === 0) return;
        for (const p of ents.pickups) {
            if (p.kind === 'ore' && !p.taken) return;
        }
        ents.medal = true;
        this.medals++;
        this.score += C.SCORE_MEDAL;
        this.bus.emit(EV.ROOM_CLEARED, { room: this.room(), medals: this.medals });

        if (this.medals === this.mine.rooms.filter(function (r) { return r.oreCount > 0; }).length) {
            this.score += C.SCORE_ALL_MEDALS;
            this.bus.emit(EV.ALL_MEDALS, { mine: this.mine });
        }
    };

    /* ------------------------------------------------------------------ *
     * Secrets and levers
     * ------------------------------------------------------------------ */

    /**
     * The dog's nose.
     *
     * Get within `C.SNIFF_R` of a hidden cog and the dog stops dead, points
     * at it and barks, and the cog shows itself. It still has to be *reached*
     * — cogs are hidden in the awkward corners of a room, up shafts and behind
     * fissures — so the dog turns "is there anything here?" into "how do I get
     * to it?", which is the better question.
     *
     * It lets go once the cog is taken or Tommy wanders well away from it.
     */
    Run.prototype._checkSecrets = function () {
        const p = this.player;
        const dog = this.dog;
        for (const pk of this.ents().pickups) {
            if (pk.kind !== 'cog' || pk.taken) continue;
            const d = Math.hypot(pk.x - p.x, pk.y - p.centreY());
            if (!pk.revealed && d < C.SNIFF_R) {
                pk.revealed = true;
                dog.pointAt(pk.x, pk.y);
                this.bus.emit(EV.SECRET_FOUND, { x: pk.x, y: pk.y });
            } else if (dog.state === 'point' && dog.pointX === pk.x && d > C.SNIFF_R * 1.6) {
                dog.release();
            }
        }
    };

    /** Walk into a lever and it throws. See `Machines.Lever`. */
    Run.prototype._checkLevers = function () {
        const ents = this.ents();
        if (!ents.levers.length) return;
        const pb = this.player.box();
        for (const lever of ents.levers) {
            if (lever.thrown) continue;
            const b = lever.box();
            if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;
            if (ents.throwLever(lever)) {
                this.bus.emit(EV.LEVER_THROWN, { x: lever.x, y: lever.y });
                this.bus.emit(EV.SHAKE, { amount: 0.25, seconds: 0.3 });
            }
        }
    };

    /* ------------------------------------------------------------------ *
     * Warp pads
     * ------------------------------------------------------------------ */

    /**
     * Press Down on a pad to cross the room.
     *
     * Both pads are locked for a moment afterwards. Without it the arrival pad
     * fires on the same held Down that triggered the departure and the player
     * ping-pongs between the two until they let go — which reads as the game
     * having crashed.
     */
    Run.prototype._checkWarp = function (input) {
        const p = this.player;
        if (!input.justPressed('down') || !p.onGround) return false;

        for (const pad of this.ents().warps) {
            if (pad.lock > 0 || !pad.partner) continue;
            if (Math.abs(pad.x - p.x) > C.TILE * 0.7) continue;
            if (Math.abs(pad.y - p.y) > C.TILE) continue;

            const fromX = p.x, fromY = p.y;
            pad.lock = C.TELEPORT_LOCK;
            pad.partner.lock = C.TELEPORT_LOCK;
            p.placeAt(pad.partner.x, pad.partner.y);
            p.invuln = Math.max(p.invuln, 0.4);
            this.dog.placeAt(p.x, p.y, p.facing);
            this.bus.emit(EV.TELEPORT, {
                fromX: fromX, fromY: fromY, toX: p.x, toY: p.y
            });
            return true;
        }
        return false;
    };

    /* ------------------------------------------------------------------ *
     * Hazards
     * ------------------------------------------------------------------ */

    Run.prototype._checkHazards = function (dt) {
        const p = this.player;
        const room = this.room();
        const ents = this.ents();
        const pb = p.box();

        // Lava is not survivable and never has been, invulnerability included:
        // a hazard that can be tanked is not a hazard, it is a toll.
        if (this._touchesTile(room, T.LAVA)) {
            this._die('lava');
            return;
        }

        // A flooding seam's surface is a pixel height, not a tile, so it has to
        // be tested separately from the bed it rose out of.
        if (ents.flood && ents.flood.level > 1 && p.y > ents.flood.surfaceY()) {
            this._die('lava');
            return;
        }

        // Valves first, and whatever the invulnerability: a valve never hurts,
        // so a stomp on one straight after taking a hit still has to count.
        if (ents.boss && !ents.boss.defeated()) {
            for (const v of ents.boss.valves) {
                if (v.state === 'broken') continue;
                const b = v.box();
                if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;
                if (!(p.vy > C.STOMP_MIN_V && p.y <= b.y + b.h * C.STOMP_BAND)) continue;
                p.vy = -(this._jumpHeld ? C.STOMP_BOUNCE_HELD : C.STOMP_BOUNCE);
                p.rising = true;
                p.onGround = false;
                p.fallSpeed = 0;
                if (ents.boss.hit(v, false)) {
                    this._valveBroken(ents.boss);
                } else {
                    this.bus.emit(EV.ARMOUR_CLANG, { x: b.x, y: b.y });
                }
            }
        }

        if (p.invuln > 0) return;

        if (this._touchesTile(room, T.SPIKE)) {
            this._hurt(C.DMG_SPIKE * this.mods.spikeMul, 'spike', -p.facing);
            return;
        }

        for (const e of ents.enemies) {
            if (e.dead) continue;
            const b = e.box();
            if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;

            /*
             * Coming down on its head kills it instead of costing you.
             *
             * Both halves of the test matter. The fall speed stops a walk into
             * an enemy counting as a stomp, and the feet-above-centre test stops
             * one being killed by a body you happen to be dropping *past* —
             * without it, brushing a bat on the way down reads as a kill and
             * the mechanic becomes an accident rather than a move.
             */
            if (p.vy > C.STOMP_MIN_V && p.y <= b.y + b.h * C.STOMP_BAND) {
                // A curled beetle's shell turns a stomp into a bounce: no kill,
                // no damage, and a clang to say why.
                if (typeof e.armoured === 'function' && e.armoured()) {
                    p.vy = -C.STOMP_BOUNCE;
                    p.rising = true;
                    p.onGround = false;
                    p.fallSpeed = 0;
                    this.bus.emit(EV.ARMOUR_CLANG, { x: b.x, y: b.y });
                    continue;
                }
                e.dead = true;
                e.deadT = 0;
                if (typeof e.onStomped === 'function') e.onStomped();
                /*
                 * Chains: every stomp before Tommy touches down again is worth
                 * one more multiple of the last. It turns a room of patrols
                 * from a set of things to avoid into a thing to *use* — hop
                 * from head to head and the score climbs.
                 */
                this.stompChain = Math.min(C.STOMP_CHAIN_MAX, this.stompChain + 1);
                const points = C.SCORE_STOMP * this.stompChain;
                this.score += points;
                p.vy = -(this._jumpHeld ? C.STOMP_BOUNCE_HELD : C.STOMP_BOUNCE);
                p.rising = true;
                p.onGround = false;
                p.fallSpeed = 0;
                this.hitstop = C.HITSTOP_STOMP;
                this.bus.emit(EV.ENEMY_STOMPED, { x: b.x, y: b.y, kind: e.kind, chain: this.stompChain, points: points });
                this.bus.emit(EV.SHAKE, { amount: 0.35 + this.stompChain * 0.05, seconds: 0.14 });
                continue;
            }

            this._hurt(e.spec.damage, e.kind, p.x < b.x ? -1 : 1);
            return;
        }

        for (let i = ents.shots.length - 1; i >= 0; i--) {
            const s = ents.shots[i];
            const b = s.box();
            if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;
            ents.shots.splice(i, 1);
            this.bus.emit(EV.SHOT_HIT, { x: s.x, y: s.y });
            this._hurt(s.kind === 'cinder' ? C.DMG_BOULDER : C.DMG_RIVET, s.kind, s.vx >= 0 ? 1 : -1);
            return;
        }

        for (const c of ents.crushers) {
            if (c.state !== 'slam') continue;
            const b = c.box();
            if (Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) {
                this._hurt(C.DMG_CRUSH, 'crusher', p.x < b.x ? -1 : 1);
                return;
            }
        }

        for (const bo of ents.boulders) {
            if (!bo.falling) continue;
            const b = bo.box();
            if (Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) {
                this._hurt(C.DMG_BOULDER, 'boulder', p.x < b.x ? -1 : 1);
                return;
            }
        }

        // Live rails bite whoever is standing on one when it goes live.
        if (p.onGround && ents.rails.length) {
            const tx = Math.floor(p.x / C.TILE), ty = Math.floor((p.y + 2) / C.TILE);
            const rail = ents.railAt(tx, ty);
            if (rail && rail.state === 'live') {
                this._hurt(C.DMG_RAIL, 'rail', p.facing >= 0 ? -1 : 1);
                p.vy = -260;
                return;
            }
        }

        for (const h of ents.hooks) {
            const b = h.box();
            if (!Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) continue;
            this._hurt(C.DMG_HOOK, 'hook', h.dir());
            p.vx = h.dir() * 220;
            return;
        }

        for (const v of ents.vents) {
            if (v.state !== 'blast') continue;
            const b = v.box();
            if (b.h > 2 && Util.overlaps(pb.x, pb.y, pb.w, pb.h, b.x, b.y, b.w, b.h)) {
                this._hurt(C.DMG_VENT, 'vent', p.x < v.x ? -1 : 1);
                p.vx += (p.x < v.x ? -1 : 1) * C.VENT_SHOVE;
                return;
            }
        }
    };

    /** Any tile of `kind` overlapping the body. */
    Run.prototype._touchesTile = function (room, kind) {
        const p = this.player;
        const x0 = Math.floor((p.x - C.PLAYER_W / 2 + 2) / C.TILE);
        const x1 = Math.floor((p.x + C.PLAYER_W / 2 - 2) / C.TILE);
        const y0 = Math.floor((p.y - C.PLAYER_H + 3) / C.TILE);
        const y1 = Math.floor((p.y - 1) / C.TILE);
        for (let ty = y0; ty <= y1; ty++) {
            for (let tx = x0; tx <= x1; tx++) {
                if (room.get(tx, ty) === kind) return true;
            }
        }
        return false;
    };

    Run.prototype._hurt = function (amount, cause, knockDir) {
        const p = this.player;
        this.energy -= amount;
        p.knock(knockDir);
        this.hitstop = C.HITSTOP_HURT;
        this.stompChain = 0;
        this.bus.emit(EV.PLAYER_HURT, { x: p.x, y: p.y, cause: cause, amount: amount });
        this.bus.emit(EV.SHAKE, { amount: 0.55, seconds: 0.22 });
        if (this.energy <= 0) {
            this.energy = 0;
            this._die(cause);
        }
    };

    /* ------------------------------------------------------------------ *
     * Dynamite
     * ------------------------------------------------------------------ */

    /**
     * Plant a stick.
     *
     * The stick comes out of the twelve you are collecting, and goes back to
     * where you found it once it has gone off. So a blast costs a walk, not
     * progress — which is the only way this works as a mechanic: a resource you
     * can permanently strand yourself by spending would turn every fissure into
     * a save-scumming decision.
     */
    Run.prototype._plant = function () {
        const p = this.player;
        if (this.tntHeld <= 0 || p.blastCooldown > 0 || !p.onGround) return;

        const ents = this.ents();
        let source = null;
        for (let i = ents.pickups.length - 1; i >= 0; i--) {
            const pk = ents.pickups[i];
            if (pk.kind === 'tnt' && pk.taken) { source = pk; break; }
        }
        // The stick may have been found in another room; that is fine, it goes
        // back to whichever room it came from when the bomb goes off.
        if (!source) source = this._findTakenTntAnywhere();
        if (!source) return;

        this.tntHeld--;
        this._spentStack.push(source);
        p.blastCooldown = C.BLAST_COOLDOWN;

        this.bombs.push({ x: p.x, y: p.y - 4, fuse: C.BLAST_FUSE, room: this.roomIndex });
        this.bus.emit(EV.BLAST_PLANTED, { x: p.x, y: p.y });
    };

    Run.prototype._findTakenTntAnywhere = function () {
        for (const set of this.entities) {
            for (const pk of set.pickups) {
                if (pk.kind === 'tnt' && pk.taken && this._spentStack.indexOf(pk) < 0) return pk;
            }
        }
        return null;
    };

    Run.prototype._updateBombs = function (dt) {
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.fuse -= dt;
            if (b.fuse > 0) continue;
            this.bombs.splice(i, 1);
            this._detonate(b);
        }
    };

    Run.prototype._detonate = function (bomb) {
        const room = this.mine.rooms[bomb.room];
        const ents = this.entities[bomb.room];

        let broke = 0;
        const radius = C.BLAST_RADIUS * this.mods.blastMul;
        const killR = C.BLAST_KILL_R * this.mods.blastMul;
        const r = Math.ceil(radius / C.TILE);
        const cx = Math.floor(bomb.x / C.TILE);
        const cy = Math.floor(bomb.y / C.TILE);
        for (let ty = cy - r; ty <= cy + r; ty++) {
            for (let tx = cx - r; tx <= cx + r; tx++) {
                if (room.get(tx, ty) !== T.CRACKED) continue;
                const dx = (tx + 0.5) * C.TILE - bomb.x;
                const dy = (ty + 0.5) * C.TILE - bomb.y;
                if (Math.hypot(dx, dy) > radius) continue;
                room.set(tx, ty, T.EMPTY);
                broke++;
            }
        }

        const killed = ents.killNear(bomb.x, bomb.y, killR);
        this.score += killed * C.SCORE_ENEMY;

        // A stick beside one of the Governor's valves breaks it, open or shut.
        if (ents.boss) {
            for (const v of ents.boss.valves) {
                if (Math.hypot(v.x - bomb.x, v.y - 6 - bomb.y) > killR) continue;
                if (ents.boss.hit(v, true)) this._valveBroken(ents.boss);
            }
        }

        // The spent stick goes home.
        const source = this._spentStack.shift();
        if (source) {
            source.taken = false;
            source.timer = 0;
            this.tntFound--;
        }

        // Standing in your own blast is a hit like any other.
        if (bomb.room === this.roomIndex && this.player.invuln <= 0) {
            const p = this.player;
            if (Math.hypot(p.x - bomb.x, p.centreY() - bomb.y) < killR) {
                this._hurt(C.DMG_ENEMY, 'blast', p.x < bomb.x ? -1 : 1);
            }
        }

        if (bomb.room === this.roomIndex) this.hitstop = Math.max(this.hitstop, C.HITSTOP_BLAST);
        this.bus.emit(EV.BLAST, { x: bomb.x, y: bomb.y, broke: broke, killed: killed });
        this.bus.emit(EV.SHAKE, { amount: 1, seconds: 0.4 });
    };

    /* ------------------------------------------------------------------ *
     * The plunger
     * ------------------------------------------------------------------ */

    Run.prototype._checkDetonator = function (input) {
        const ents = this.ents();
        const det = ents.detonator;
        if (!det) return;

        const p = this.player;
        if (Math.hypot(p.x - det.x, p.y - det.y) > 20) {
            this._detHinted = false;
            return;
        }

        const governor = ents.boss && !ents.boss.defeated();
        if (this.tntFound < this.mine.tntTotal || governor) {
            if (!this._detHinted) {
                this._detHinted = true;
                this.bus.emit(EV.DETONATOR_DENIED, {
                    x: det.x, y: det.y, needed: this.mine.tntTotal - this.tntFound,
                    governor: !!governor
                });
            }
            return;
        }

        this._setState('boom');
        this._timer = 0;
        this.escape = 0;
        p.active = false;
        this.score += this.lives * C.SCORE_LIFE_BONUS;
        this.score += Math.max(0, C.SCORE_TIME_BASE - Math.floor(this.elapsed) * C.SCORE_TIME_DECAY);
        this.bus.emit(EV.DETONATOR_FIRED, { x: det.x, y: det.y });
        this.bus.emit(EV.SHAKE, { amount: 1.4, seconds: 1.4 });
    };

    Run.prototype._afterBoom = function () {
        if (this.mineIndex + 1 < this.mines.length) {
            // Between mines: the workshop, where cogs become kit.
            this.player.active = false;
            this._setState('workshop');
        } else {
            this._finish('victory');
        }
    };

    /** A Governor lost a valve: pay out, and freeze the frame on it. */
    Run.prototype._valveBroken = function (boss) {
        this.score += C.SCORE_VALVE;
        this.hitstop = Math.max(this.hitstop, C.HITSTOP_STOMP * 2);
        this.bus.emit(EV.SHAKE, { amount: 0.8, seconds: 0.4 });
        if (boss.defeated()) {
            this.score += C.SCORE_GOVERNOR;
            this.bus.emit(EV.SHAKE, { amount: 1.2, seconds: 1.2 });
        }
    };

    /* ------------------------------------------------------------------ *
     * The workshop
     * ------------------------------------------------------------------ */

    /** Can this item be bought right now? */
    Run.prototype.canBuy = function (id) {
        const item = Upgrades.item(id);
        if (!item || this.state !== 'workshop') return false;
        if (this.upgrades[id] >= item.max) return false;
        if (id === 'helmet' && this.lives >= C.LIVES_MAX) return false;
        return this.cogs >= item.cost;
    };

    /** Spend cogs on an item. Returns whether it was bought. */
    Run.prototype.buy = function (id) {
        if (!this.canBuy(id)) return false;
        const item = Upgrades.item(id);
        this.cogs -= item.cost;
        this.upgrades[id]++;
        this.mods = Upgrades.mods(this.upgrades);
        if (id === 'helmet') this.lives = Math.min(C.LIVES_MAX, this.lives + 1);
        this.bus.emit(EV.UPGRADE_BOUGHT, { id: id, level: this.upgrades[id] });
        return true;
    };

    /** Out of the workshop and down the next mine. */
    Run.prototype.leaveWorkshop = function () {
        if (this.state !== 'workshop') return false;
        this.startMine(this.mineIndex + 1);
        return true;
    };

    /* ------------------------------------------------------------------ *
     * Rooms
     * ------------------------------------------------------------------ */

    /**
     * Leave the room by whichever edge Tommy crossed.
     *
     * The exit is picked from the *position*, not from which key is held: a
     * player carried out of a doorway by a conveyor or a lift has still left the
     * room, and asking about input here would strand them in the frame.
     */
    Run.prototype._checkRoomChange = function () {
        const p = this.player;
        let dir = null;
        if (p.x < 0) dir = 'left';
        else if (p.x > C.ROOM_W) dir = 'right';
        else if (p.y < 0) dir = 'up';
        else if (p.y > C.ROOM_H) dir = 'down';
        if (!dir) return;

        const next = this.room().neighbours[dir];
        if (next < 0) {
            // A sealed edge. Put him back rather than let him leave the mine.
            p.x = Util.clamp(p.x, C.PLAYER_W, C.ROOM_W - C.PLAYER_W);
            p.y = Util.clamp(p.y, C.PLAYER_H, C.ROOM_H - 1);
            return;
        }

        const pos = World.transitionPos(dir, p.x, p.y);
        this.roomIndex = next;
        p.x = pos.x;
        p.y = pos.y;
        p.ridingLift = null;
        p.fallSpeed = 0;
        this.dog.placeAt(p.x, p.y, p.facing);

        p.active = false;
        this._transition = { t: 0, len: 0.34, dir: dir };
        this._setState('transition');
        this.ents().seen = true;
        this._markEntry();
        this.bus.emit(EV.ROOM_CHANGED, { room: this.room(), dir: dir });
    };

    /* ------------------------------------------------------------------ *
     * Dying
     * ------------------------------------------------------------------ */

    /**
     * You go back to the door you came in by.
     *
     * The first version banked a rolling checkpoint wherever you were last
     * stood safely, and it was a mistake: it meant dying two tiles from the top
     * of a room put you back two tiles from the top of the room. Neither game
     * this is modelled on did that, and it is most of why an early build had no
     * tension in it — every mistake cost a life and nothing else, so there was
     * never a moment where you had something to lose.
     *
     * Sending you to the room entrance keeps the *progress* — sticks stay
     * collected, medals stay earned — and takes back the *position*, which is
     * the thing you were actually spending fuse to buy.
     */
    Run.prototype._updateCheckpoint = function () {
        /* nothing to bank: the checkpoint is set on entering a room */
    };

    /** Remember the doorway, for when it goes wrong. */
    Run.prototype._markEntry = function () {
        this.checkpoint = { room: this.roomIndex, x: this.player.x, y: this.player.y };
    };

    Run.prototype._die = function (cause) {
        if (this.state !== 'playing') return;
        const p = this.player;
        p.alive = false;
        p.active = false;
        this._timer = 0;
        this._setState('dying');
        this.bus.emit(EV.PLAYER_DIED, { x: p.x, y: p.y, cause: cause });
        this.bus.emit(EV.SHAKE, { amount: 0.8, seconds: 0.35 });
    };

    Run.prototype._respawn = function () {
        this.lives--;
        if (this.lives <= 0) {
            this.lives = 0;
            this._finish('gameover');
            return;
        }

        // Rewind the room's machinery so a respawn is not immediately into the
        // downstroke of the piston that just killed you. Pickups are pointedly
        // left alone — rebuilding the whole room would resurrect the sticks you
        // already banked, which turns dying into a way to farm a room.
        this.entities[this.checkpoint.room].rewind();

        this.roomIndex = this.checkpoint.room;
        this.energy = C.ENERGY_MAX;

        // Dying on the run out does not stop the clock — the seam is coming
        // down either way — but it does buy back enough of it to be worth
        // getting up for. Without the floor, one bad landing at forty seconds
        // means respawning into a countdown that cannot be beaten, and the life
        // is spent watching it run out.
        if (this.escape > 0) this.escape = Math.max(this.escape, C.ESCAPE_SECONDS * 0.35);

        this.player.reset(this.checkpoint.x, this.checkpoint.y, true);
        this.player.invuln = C.RESPAWN_INVULN;
        this.dog.placeAt(this.player.x, this.player.y, 1);
        this.bombs.length = 0;
        this.danger = false;

        this._setState('playing');
        this.bus.emit(EV.PLAYER_RESPAWN, { x: this.player.x, y: this.player.y });
        this.bus.emit(EV.ROOM_CHANGED, { room: this.room(), dir: null });
    };

    Run.prototype._finish = function (state) {
        this.player.active = false;
        this._setState(state);
        if (this.score > this.best) {
            this.best = this.score;
            saveBest(this.best);
        }
    };

    /* ------------------------------------------------------------------ *
     * Shell input
     * ------------------------------------------------------------------ */

    /** Enter / click, from a title or end screen. */
    Run.prototype.confirm = function () {
        if (this.state === 'title' || this.state === 'gameover' || this.state === 'victory') {
            this.startRun();
            return true;
        }
        return false;
    };

    Run.prototype.toTitle = function () {
        this.player.active = false;
        this._setState('title');
    };

    /* ------------------------------------------------------------------ *
     * Persistence
     * ------------------------------------------------------------------ */

    /**
     * `localStorage` is unavailable on `file://` in some browsers and throws
     * rather than returning null. The screenshot harness runs from `file://`, so
     * a best score that cannot be read must not be a crash.
     */
    function loadBest() {
        try {
            const raw = window.localStorage.getItem(C.STORAGE_KEY);
            if (!raw) return 0;
            const data = JSON.parse(raw);
            return Number(data.best) || 0;
        } catch (err) {
            return 0;
        }
    }

    function saveBest(best) {
        try {
            window.localStorage.setItem(C.STORAGE_KEY, JSON.stringify({ best: best }));
        } catch (err) {
            /* nothing to be done, and nothing worth interrupting the run for */
        }
    }

    Run.STATES = STATES;
    TNT.Run = Run;
})(window.TNT = window.TNT || {});
