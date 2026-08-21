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
        ROOM_CLEARED: 'room-cleared',     // {room}
        ROOM_CHANGED: 'room-changed',     // {room, dir}
        MINE_STARTED: 'mine-started',     // {mine, index}
        PLAYER_HURT: 'player-hurt',       // {x, y, cause, amount}
        PLAYER_DIED: 'player-died',       // {x, y, cause}
        PLAYER_LANDED: 'player-landed',   // {x, y, speed, hard}
        PLAYER_MOUNT: 'player-mount',     // {x, y, kind}
        PLAYER_RESPAWN: 'player-respawn', // {x, y}
        BLAST_PLANTED: 'blast-planted',   // {x, y}
        BLAST: 'blast',                   // {x, y, broke, killed}
        CRUMBLE: 'crumble',               // {x, y}
        VENT_FIRED: 'vent-fired',         // {x, y}
        CRUSH_SLAM: 'crush-slam',         // {x, y}
        BOULDER_SMASH: 'boulder-smash',   // {x, y}
        DETONATOR_DENIED: 'det-denied',   // {x, y, needed}
        DETONATOR_FIRED: 'det-fired',     // {x, y}
        ALL_TNT: 'all-tnt',               // {x, y}
        SHAKE: 'shake',                   // {amount, seconds}
        FLOAT_TEXT: 'float-text',         // {text, x, y, colour, seconds}
        STATE_CHANGED: 'state-changed'    // {from, to}
    };

    TNT.EventBus = EventBus;
    TNT.EV = EventBus.EVENTS;
})(window.TNT = window.TNT || {});
