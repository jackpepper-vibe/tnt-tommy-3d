/**
 * TNT Tommy — event bus.
 *
 * The one channel the simulation uses to tell the presentation layer that
 * something happened. Systems that draw, shake, flash or play a sound subscribe;
 * the simulation only ever emits. That keeps the dependency arrow pointing one
 * way — gameplay code never reaches into `src/r3d/`, and a renderer change can
 * never break a rule.
 *
 * Handlers are copied before dispatch so a listener may unsubscribe itself, or
 * emit in response, without corrupting the walk.
 */
(function (TNT) {
    'use strict';

    function EventBus() {
        this._handlers = new Map();
    }

    /** @returns {Function} an unsubscribe thunk. */
    EventBus.prototype.on = function (type, fn) {
        let list = this._handlers.get(type);
        if (!list) {
            list = [];
            this._handlers.set(type, list);
        }
        list.push(fn);
        const self = this;
        return function () { self.off(type, fn); };
    };

    EventBus.prototype.off = function (type, fn) {
        const list = this._handlers.get(type);
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
    };

    EventBus.prototype.emit = function (type, payload) {
        const list = this._handlers.get(type);
        if (!list || list.length === 0) return;
        const copy = list.slice();
        for (let i = 0; i < copy.length; i++) {
            copy[i](payload);
        }
    };

    EventBus.prototype.clear = function () {
        this._handlers.clear();
    };

    /**
     * Every event the game emits, named once so a typo is a missing symbol
     * rather than a listener that silently never fires.
     */
    EventBus.EVENTS = {
        PICKUP: 'pickup',                 // {kind, x, y, value}
        ROOM_CLEARED: 'room-cleared',     // {room, medals}
        ALL_MEDALS: 'all-medals',         // {mine}
        ESCAPE_STARTED: 'escape-started', // {seconds}
        ESCAPE_TICK: 'escape-tick',       // {left}
        ROOM_CHANGED: 'room-changed',     // {room, dir}
        MINE_STARTED: 'mine-started',     // {mine, index}
        PLAYER_HURT: 'player-hurt',       // {x, y, cause, amount}
        PLAYER_DIED: 'player-died',       // {x, y, cause}
        PLAYER_LANDED: 'player-landed',   // {x, y, speed, hard}
        PLAYER_JUMPED: 'player-jumped',   // {x, y}
        BOUNCE: 'bounce',                 // {x, y}
        TELEPORT: 'teleport',             // {fromX, fromY, toX, toY}
        PLAYER_MOUNT: 'player-mount',     // {x, y, kind}
        PLAYER_RESPAWN: 'player-respawn', // {x, y}
        BLAST_PLANTED: 'blast-planted',   // {x, y}
        BLAST: 'blast',                   // {x, y, broke, killed}
        ENEMY_STOMPED: 'enemy-stomped',   // {x, y, kind}
        CRUMBLE: 'crumble',               // {x, y}
        VENT_FIRED: 'vent-fired',         // {x, y}
        CRUSH_SLAM: 'crush-slam',         // {x, y}
        BOULDER_SMASH: 'boulder-smash',   // {x, y}
        DETONATOR_DENIED: 'det-denied',   // {x, y, needed}
        DETONATOR_FIRED: 'det-fired',     // {x, y}
        ALL_TNT: 'all-tnt',               // {x, y}
        DOG_BARK: 'dog-bark',             // {x, y}
        PLAYER_SKID: 'player-skid',       // {x, y, dir}
        PLAYER_STEP: 'player-step',       // {x, y}
        WALL_JUMP: 'wall-jump',           // {x, y, side}
        ENEMY_AIM: 'enemy-aim',           // {x, y, kind}
        ENEMY_FIRED: 'enemy-fired',       // {x, y, kind}
        SHOT_HIT: 'shot-hit',             // {x, y}
        ARMOUR_CLANG: 'armour-clang',     // {x, y}
        SECRET_FOUND: 'secret-found',     // {x, y}
        LEVER_THROWN: 'lever-thrown',     // {x, y}
        BOSS_TELL: 'boss-tell',           // {x, y, move}
        BOSS_BURST: 'boss-burst',         // {x, y}
        BOSS_HURT: 'boss-hurt',           // {x, y, left}
        BOSS_DEFEATED: 'boss-defeated',   // {x, y}
        VALVE_OPENED: 'valve-opened',     // {x, y}
        UPGRADE_BOUGHT: 'upgrade-bought', // {id, level}
        SHAKE: 'shake',                   // {amount, seconds}
        FLOAT_TEXT: 'float-text',         // {text, x, y, colour, seconds}
        STATE_CHANGED: 'state-changed'    // {from, to}
    };

    TNT.EventBus = EventBus;
    TNT.EV = EventBus.EVENTS;
})(window.TNT = window.TNT || {});
