/**
 * TNT Tommy — the works' own machinery: levers, gates, and the Governor.
 *
 * Kept apart from `Entities` because these are the things that give a mine
 * *goals* rather than hazards. A patrol is something to get past; a gate is a
 * question about where the lever is, and the Governor is the thing standing
 * between you and the plunger.
 *
 * Same contract as every entity: `update(dt, …)`, a `box()` where the player can
 * touch it, and state the renderer reads but never writes.
 */
(function (TNT) {
    'use strict';

    const { C, Util } = TNT;
    const EV = TNT.EV;

    function box(x, y, w, h) {
        return { x: x, y: y, w: w, h: h };
    }

    function tileCentre(t) {
        return t * C.TILE + C.TILE / 2;
    }

    /* ------------------------------------------------------------------ *
     * Levers and gates
     * ------------------------------------------------------------------ */

    /**
     * A lever on a post. Walk into it and it throws, and every gate in the
     * room winds up.
     *
     * Touch, not a button: there is no "use" key in this game and inventing
     * one for a lever would be a control nobody remembers they have. A lever
     * stays thrown for the rest of the mine, the same way blasted rock stays
     * blasted — a way you opened is a way you keep.
     */
    function Lever(tx, ty) {
        this.kind = 'lever';
        this.tx = tx;
        this.ty = ty;
        this.x = tileCentre(tx);
        this.y = (ty + 1) * C.TILE;
        this.thrown = false;
        /** 0 → 1 as the handle swings over. */
        this.swing = 0;
    }

    Lever.prototype.update = function (dt) {
        if (this.thrown) this.swing = Math.min(1, this.swing + dt * 5);
    };

    Lever.prototype.box = function () {
        return box(this.x, this.y - 9, 12, 18);
    };

    /**
     * One tile of shutter gate. Solid while shut — it is a terrain tile, so
     * everything that asks about walls already treats it as one — and wound up
     * into its lintel when opened. `lift` animates 0 → 1 for the renderer.
     */
    function Gate(tx, ty) {
        this.kind = 'gate';
        this.tx = tx;
        this.ty = ty;
        this.open = false;
        this.lift = 0;
    }

    Gate.prototype.update = function (dt) {
        if (this.open) this.lift = Math.min(1, this.lift + dt * 1.4);
    };

    /* ------------------------------------------------------------------ *
     * The Governor
     * ------------------------------------------------------------------ */

    /**
     * A pressure valve on the Governor's steam main — its weak point.
     *
     * Shut, it is armoured: a stomp glances off with a clang. When the Governor
     * vents through it, it glows and hisses for a couple of seconds, and a stomp
     * then breaks it. A stick of dynamite breaks it in either state, which is
     * the slower, safer answer.
     */
    function Valve(tx, ty) {
        this.kind = 'valve';
        this.x = tileCentre(tx);
        this.y = (ty + 1) * C.TILE;
        this.state = 'shut';          // 'shut' | 'open' | 'broken'
        this.timer = 0;
        this.w = 14;
        this.h = 12;
    }

    Valve.prototype.box = function () {
        return box(this.x, this.y - this.h / 2, this.w, this.h);
    };

    /**
     * Seconds a valve stays open when vented, by mine. The last mine gives the
     * least time, which is most of how the fight gets harder.
     */
    const VALVE_OPEN = [2.8, 2.4, 2.0];
    const IDLE = [2.0, 1.6, 1.25];

    /** The order a Governor works through its repertoire, by mine. */
    const PATTERN = [
        ['volley', 'vent', 'volley', 'vent'],
        ['volley', 'rain', 'vent', 'rain', 'volley', 'vent'],
        ['rain', 'volley', 'vent', 'volley', 'rain', 'vent']
    ];

    /**
     * The Governor: the engine that runs the mine, built into the back wall of
     * its vault, and the reason the plunger will not fire.
     *
     * It is a boss fight built entirely out of verbs the player already has.
     * It fires volleys of rivets at Tommy — jump them. In the lower mines it
     * brings cinders down from the roof, with a glow on the ceiling to say
     * where — keep moving. And between attacks it vents through one of its
     * three valves: the one moment that valve can be stomped. Break all three
     * and it tears itself apart.
     *
     * Each broken valve makes it faster. It never regrows one: dying in the
     * vault keeps the valves you broke, because a fight you have to start over
     * after every mistake is a fight people stop coming back to.
     */
    function Governor(room, mine, valveSpawns, def) {
        this.kind = 'governor';
        this.room = room;
        this.tier = Math.min(2, mine.index);
        const at = (def && def.at) || [C.COLS - 10, 5];
        this.x = tileCentre(at[0]);
        this.y = tileCentre(at[1]);
        /** Where shots leave it: the furnace mouth, under the body. */
        this.mouthX = this.x;
        this.mouthY = this.y + C.TILE * 1.5;
        this.valves = valveSpawns.map(function (s) { return new Valve(s.tx, s.ty); });

        this.state = 'idle';
        this.timer = IDLE[this.tier];
        this.step = 0;
        /** Shots left in the current volley, and time to the next. */
        this._burst = 0;
        this._burstT = 0;
        /** Cinders waiting to fall: `{x, t}` — each with a tell on the roof first. */
        this.pending = [];
        /** Seconds since the last hit, for the renderer's flinch. */
        this.hurtT = 9;
        this.t = 0;
        this.bus = null;
    }

    Governor.prototype.broken = function () {
        let n = 0;
        for (const v of this.valves) if (v.state === 'broken') n++;
        return n;
    };

    Governor.prototype.defeated = function () {
        return this.state === 'dying' || this.state === 'dead';
    };

    /** How much faster it runs for each valve lost. */
    Governor.prototype._rate = function () {
        return 1 + this.broken() * 0.22;
    };

    /**
     * @param {number} dt
     * @param {TNT.Player} player
     * @param {TNT.Entities.RoomEntities} set  for firing shots and the bus
     */
    Governor.prototype.update = function (dt, player, set) {
        this.t += dt;
        this.hurtT += dt;
        this.bus = set.bus;
        if (this.state === 'dead') return;

        if (this.state === 'dying') {
            this.timer -= dt;
            // A string of blasts along the body as it goes.
            this._boomT = (this._boomT || 0) - dt;
            if (this._boomT <= 0 && this.timer > 0.3) {
                this._boomT = 0.28;
                set.bus.emit(EV.BOSS_BURST, {
                    x: this.x + (Math.random() - 0.5) * C.TILE * 6,
                    y: this.y + (Math.random() - 0.5) * C.TILE * 4
                });
            }
            if (this.timer <= 0) {
                this.state = 'dead';
                set.bus.emit(EV.BOSS_DEFEATED, { x: this.x, y: this.y });
            }
            return;
        }

        const rate = this._rate();
        const k = dt * rate;
        this._cinders(k, set);

        for (const v of this.valves) {
            if (v.state !== 'open') continue;
            v.timer -= k;
            if (v.timer <= 0) v.state = 'shut';
        }

        this.timer -= k;
        switch (this.state) {
            case 'idle':
                if (this.timer <= 0) this._next(player, set);
                break;

            case 'volley':
                this._burstT -= k;
                if (this._burstT <= 0 && this._burst > 0) {
                    this._burst--;
                    this._burstT = 0.32;
                    this._fireAt(player, set);
                }
                if (this._burst <= 0 && this._burstT <= 0) this._idle();
                break;

            case 'rain':
            case 'vent':
                if (this.timer <= 0) this._idle();
                break;

            default:
                break;
        }
    };

    Governor.prototype._idle = function () {
        this.state = 'idle';
        this.timer = IDLE[this.tier];
    };

    Governor.prototype._next = function (player, set) {
        const pattern = PATTERN[this.tier];
        const move = pattern[this.step % pattern.length];
        this.step++;

        if (move === 'volley') {
            this.state = 'volley';
            this._burst = 3 + this.tier;
            this._burstT = 0.6;          // the mouth glows first — the tell
            set.bus.emit(EV.BOSS_TELL, { x: this.mouthX, y: this.mouthY, move: 'volley' });
        } else if (move === 'rain') {
            this.state = 'rain';
            this.timer = 2.0;
            const n = 3 + this.tier;
            for (let i = 0; i < n; i++) {
                const x = Util.clamp(
                    (player ? player.x : this.x) + (i - (n - 1) / 2) * C.TILE * 3 + (Math.random() - 0.5) * 20,
                    C.TILE * 2, C.ROOM_W - C.TILE * 2);
                this.pending.push({ x: x, t: 0.75 + i * 0.22 });
                set.bus.emit(EV.BOSS_TELL, { x: x, y: C.TILE * 1.2, move: 'rain' });
            }
        } else {
            // Vent through one intact valve — the opening.
            const intact = this.valves.filter(function (v) { return v.state === 'shut'; });
            if (!intact.length) { this._idle(); return; }
            const v = intact[this.step % intact.length];
            v.state = 'open';
            v.timer = VALVE_OPEN[this.tier];
            this.state = 'vent';
            this.timer = VALVE_OPEN[this.tier];
            set.bus.emit(EV.VALVE_OPENED, { x: v.x, y: v.y });
        }
    };

    Governor.prototype._fireAt = function (player, set) {
        if (!player) return;
        const dx = player.x - this.mouthX;
        const dy = player.centreY() - this.mouthY;
        const d = Math.hypot(dx, dy) || 1;
        const speed = 150 + this.tier * 25;
        set.fire('rivet', this.mouthX, this.mouthY, dx / d * speed, dy / d * speed);
    };

    Governor.prototype._cinders = function (k, set) {
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const c = this.pending[i];
            c.t -= k;
            if (c.t > 0) continue;
            this.pending.splice(i, 1);
            set.fire('cinder', c.x, C.TILE * 1.4, 0, 30, 620);
        }
    };

    /**
     * Break a valve. Returns true if it broke — a shut valve refuses a stomp
     * (`byBlast` false) but not a stick of dynamite.
     */
    Governor.prototype.hit = function (valve, byBlast) {
        if (valve.state === 'broken' || this.defeated()) return false;
        if (valve.state !== 'open' && !byBlast) return false;
        valve.state = 'broken';
        this.hurtT = 0;
        const left = this.valves.length - this.broken();
        if (this.bus) this.bus.emit(EV.BOSS_HURT, { x: valve.x, y: valve.y, left: left });
        if (left <= 0) {
            this.state = 'dying';
            this.timer = 2.4;
            this.pending.length = 0;
            for (const v of this.valves) v.timer = 0;
        } else {
            // Stagger: it drops what it was doing.
            this._idle();
            this.timer = IDLE[this.tier] * 1.4;
        }
        return true;
    };

    /** Put it back to a fresh cycle after a death — the broken valves stay broken. */
    Governor.prototype.rewind = function () {
        if (this.defeated()) return;
        this.pending.length = 0;
        for (const v of this.valves) if (v.state === 'open') v.state = 'shut';
        this._idle();
        this.step = 0;
    };

    /** For harnesses: finish it at once. */
    Governor.prototype.defeat = function () {
        for (const v of this.valves) v.state = 'broken';
        this.state = 'dead';
    };

    TNT.Machines = {
        Lever: Lever,
        Gate: Gate,
        Valve: Valve,
        Governor: Governor
    };
})(window.TNT = window.TNT || {});
