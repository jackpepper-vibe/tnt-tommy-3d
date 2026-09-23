/**
 * TNT Tommy — the dog.
 *
 * Tommy's Shih Tzu, from the portrait on the title card. It follows him through
 * the mine, and it has a nose: when a secret is close by it stops, points and
 * barks, which is the game's one way of telling you there is more to a room than
 * you can see (see `Run._checkSecrets`).
 *
 * FOLLOWING BY TRAIL, NOT BY STEERING
 * -----------------------------------
 * The dog walks the path Tommy walked, a fixed delay behind him, rather than
 * steering toward where he is now. Steering is the obvious approach and it is
 * wrong on a climbing frame: the straight line from the dog to Tommy runs
 * through decks, rock and spike beds, so a steered follower either clips
 * through all of them or needs pathfinding. The trail is already a legal path —
 * Tommy just walked it — so the dog needs no collision at all.
 *
 * It closes up and sits when he stops, rather than walking into him, and it
 * keeps a little distance so the two never draw on top of each other.
 *
 * The dog is not a hazard target and cannot be hurt. It is company, and a
 * pointer; a companion the player has to protect would be an escort mission.
 */
(function (TNT) {
    'use strict';

    const { C, Util } = TNT;

    /** How far behind Tommy's path the dog walks, in seconds of trail. */
    const LAG = 0.32;
    /** Samples kept — at 120 Hz this is a second and a half of path. */
    const TRAIL = 180;
    /** Close enough to stop and sit, in px. */
    const HEEL = 20;

    function Companion(bus) {
        this.bus = bus;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.facing = 1;
        /** 'follow' | 'sit' | 'point' — the renderer poses from this. */
        this.state = 'sit';
        this.airborne = false;
        this.t = 0;
        /** Seconds of bark left; the renderer opens the mouth while it runs. */
        this.bark = 0;
        /** Where the dog is pointing, when it is. */
        this.pointX = 0;
        this.pointY = 0;
        this._trail = [];
        this._sitFor = 0;
    }

    /** Drop the dog at Tommy's heel — on a new room, a respawn, a warp. */
    Companion.prototype.placeAt = function (x, y, facing) {
        this.x = x - (facing || 1) * HEEL;
        this.y = y;
        this.vx = this.vy = 0;
        this.facing = facing || 1;
        this.state = 'sit';
        this.airborne = false;
        this._trail.length = 0;
    };

    /**
     * @param {number} dt
     * @param {TNT.Player} player
     */
    Companion.prototype.update = function (dt, player) {
        this.t += dt;
        if (this.bark > 0) this.bark -= dt;

        const trail = this._trail;
        trail.push({ x: player.x, y: player.y, ground: player.onGround });
        if (trail.length > TRAIL) trail.shift();

        // Pointing holds the dog still until the secret is dealt with or
        // Tommy walks away from it.
        if (this.state === 'point') {
            this.facing = this.pointX >= this.x ? 1 : -1;
            this.vx = this.vy = 0;
            return;
        }

        const lagSteps = Math.round(LAG / C.FIXED_DT);
        const target = trail[Math.max(0, trail.length - 1 - lagSteps)];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const gap = Math.hypot(player.x - this.x, player.y - this.y);

        if (gap < HEEL && player.onGround && Math.abs(player.vx) < 20) {
            // Caught up with a Tommy who has stopped: settle, then sit.
            this._sitFor += dt;
            this.vx = Util.damp(this.vx, 0, 10, dt);
            if (this._sitFor > 0.25) this.state = 'sit';
        } else {
            this._sitFor = 0;
            this.state = 'follow';
            // Chase the trail point hard enough to keep up with a sprint.
            this.vx = dx / Math.max(dt * 6, 1e-3);
            this.vy = dy / Math.max(dt * 6, 1e-3);
            this.x += this.vx * dt;
            this.y += this.vy * dt;
        }

        if (Math.abs(this.vx) > 8) this.facing = this.vx > 0 ? 1 : -1;
        else if (this.state === 'sit') this.facing = player.x >= this.x ? 1 : -1;
        this.airborne = !target.ground;
    };

    /** Stop and point at something, barking. */
    Companion.prototype.pointAt = function (x, y) {
        if (this.state !== 'point') this.bus.emit(TNT.EV.DOG_BARK, { x: this.x, y: this.y });
        this.state = 'point';
        this.pointX = x;
        this.pointY = y;
        this.bark = 0.6;
    };

    /** Let go of whatever it was pointing at. */
    Companion.prototype.release = function () {
        if (this.state === 'point') this.state = 'follow';
    };

    /** A quick bark on its own, for the moments that deserve one. */
    Companion.prototype.yap = function () {
        this.bark = 0.4;
        this.bus.emit(TNT.EV.DOG_BARK, { x: this.x, y: this.y });
    };

    TNT.Companion = Companion;
})(window.TNT = window.TNT || {});
