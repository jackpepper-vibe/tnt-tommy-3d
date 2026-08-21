/**
 * TNT Tommy — input.
 *
 * Collapses keyboard, pointer and touch into one small intent record. Nothing
 * downstream asks which device produced a press.
 *
 * The simulation runs on a fixed step and may take several steps per frame, so
 * "just pressed" has to survive until the *simulation* has seen it, not until
 * the next animation frame. Presses are latched here and cleared by
 * `endStep()` — a plant that lands between two frames is never dropped, and one
 * key press can never trigger two blasts.
 */
(function (TNT) {
    'use strict';

    /**
     * Jump gets the big key, because it is pressed a hundred times a room and
     * planting a stick is pressed a handful of times a mine. `up` is also read
     * as a jump when Tommy is not on a ladder — see `Player._walk`. That is how
     * the Godot build worked and it is worth keeping: players reach for Up to
     * jump, and refusing them only makes the ladder rule feel like a trap.
     */
    const BINDINGS = {
        left: ['ArrowLeft', 'KeyA'],
        right: ['ArrowRight', 'KeyD'],
        up: ['ArrowUp', 'KeyW'],
        down: ['ArrowDown', 'KeyS'],
        jump: ['Space', 'KeyZ'],
        plant: ['KeyX', 'ShiftLeft', 'ShiftRight'],
        confirm: ['Enter', 'Space', 'NumpadEnter'],
        pause: ['Escape', 'KeyP'],
        crt: ['KeyK'],
        mute: ['KeyM']
    };

    function Input() {
        /** Held this instant. */
        this.held = Object.create(null);
        /** Pressed since the last `endStep()`. */
        this.pressed = Object.create(null);
        /** Released since the last `endStep()`. */
        this.released = Object.create(null);

        this._codeToActions = new Map();
        for (const action in BINDINGS) {
            for (const code of BINDINGS[action]) {
                let list = this._codeToActions.get(code);
                if (!list) { list = []; this._codeToActions.set(code, list); }
                list.push(action);
            }
        }

        /** Virtual buttons, set by the on-screen pad. Held separately so a
         *  touch and a key on the same action cannot cancel each other out. */
        this._touch = Object.create(null);

        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onBlur = this._onBlur.bind(this);
    }

    Input.prototype.attach = function (target) {
        const t = target || window;
        t.addEventListener('keydown', this._onKeyDown, { passive: false });
        t.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
    };

    Input.prototype.detach = function (target) {
        const t = target || window;
        t.removeEventListener('keydown', this._onKeyDown);
        t.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
    };

    Input.prototype._onKeyDown = function (e) {
        const actions = this._codeToActions.get(e.code);
        if (!actions) return;
        // Arrows and space scroll the page otherwise, which drags the canvas
        // out from under the camera on a short window.
        e.preventDefault();
        if (e.repeat) return;
        for (const a of actions) {
            this.held[a] = true;
            this.pressed[a] = true;
        }
    };

    Input.prototype._onKeyUp = function (e) {
        const actions = this._codeToActions.get(e.code);
        if (!actions) return;
        for (const a of actions) {
            if (!this._touch[a]) this.held[a] = false;
            this.released[a] = true;
        }
    };

    /** A window that loses focus mid-run must not leave Tommy walking into a wall. */
    Input.prototype._onBlur = function () {
        for (const a in this.held) this.held[a] = false;
        for (const a in this._touch) this._touch[a] = false;
    };

    /** Virtual press from the on-screen pad. */
    Input.prototype.setVirtual = function (action, down) {
        if (down && !this._touch[action]) this.pressed[action] = true;
        if (!down && this._touch[action]) this.released[action] = true;
        this._touch[action] = down;
        this.held[action] = down || this.held[action];
        if (!down) this.held[action] = false;
    };

    /** Horizontal intent, -1..1. */
    Input.prototype.axisX = function () {
        return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    };

    /** Vertical intent, -1..1, positive downward to match screen space. */
    Input.prototype.axisY = function () {
        return (this.held.down ? 1 : 0) - (this.held.up ? 1 : 0);
    };

    Input.prototype.isDown = function (action) {
        return !!this.held[action];
    };

    Input.prototype.justPressed = function (action) {
        return !!this.pressed[action];
    };

    Input.prototype.justReleased = function (action) {
        return !!this.released[action];
    };

    /**
     * Clear the edge latches. Called once the simulation has stepped, not once
     * per frame — see the header.
     */
    Input.prototype.endStep = function () {
        for (const a in this.pressed) this.pressed[a] = false;
        for (const a in this.released) this.released[a] = false;
    };

    /** Force everything up, for state transitions that must not inherit a held key. */
    Input.prototype.reset = function () {
        this._onBlur();
        this.endStep();
    };

    Input.BINDINGS = BINDINGS;
    TNT.Input = Input;
})(window.TNT = window.TNT || {});
