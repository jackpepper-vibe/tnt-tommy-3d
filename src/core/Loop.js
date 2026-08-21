/**
 * TNT Tommy — the frame loop.
 *
 * Update and draw are separate on purpose. Physics runs at a fixed
 * `C.FIXED_DT` regardless of refresh rate, so a 144 Hz monitor and a 60 Hz one
 * agree about whether a drop clears a spike bed; drawing happens once per frame
 * with an interpolation alpha so motion still reads smoothly between steps.
 *
 * Two guards worth knowing about:
 *
 *   - **The catch-up cap.** A backgrounded tab hands back a `dt` of many
 *     seconds. Stepping all of it would run the simulation forward blind, so
 *     `C.MAX_STEPS` is the ceiling and the surplus is discarded — the world
 *     stutters rather than teleporting Tommy into a crusher.
 *   - **Input latching.** `Input.endStep()` is called after the step batch, not
 *     per frame, so a press that arrives between two frames is still seen
 *     exactly once. See `Input`.
 */
(function (TNT) {
    'use strict';

    const { C } = TNT;

    /**
     * @param {{update: Function, draw: Function}} host
     * @param {TNT.Input} input
     */
    function Loop(host, input) {
        this.host = host;
        this.input = input;
        this.running = false;
        /**
         * Freeze the simulation without stopping the frame loop.
         *
         * A harness needs a deterministic state, which means the simulation
         * must stop advancing. It is tempting to stop the whole loop for that,
         * and it does not work: with no animation frame pending, the browser
         * composites the canvas from whatever it likes and a capture comes back
         * black no matter what was rendered into it. Keeping `draw` running and
         * freezing only `update` gives both — a state that holds still and a
         * canvas that keeps painting it.
         */
        this.frozen = false;
        this.accumulator = 0;
        this.lastTime = 0;
        /** Wall-clock seconds the loop has actually stepped. */
        this.elapsed = 0;
        /** Steps taken last frame; the smoke test reads this. */
        this.lastSteps = 0;
        this._raf = 0;
        this._tick = this._tick.bind(this);
    }

    Loop.prototype.start = function () {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.accumulator = 0;
        this._raf = requestAnimationFrame(this._tick);
    };

    Loop.prototype.stop = function () {
        this.running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
    };

    Loop.prototype._tick = function (now) {
        if (!this.running) return;
        this._raf = requestAnimationFrame(this._tick);

        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        if (!(dt > 0)) dt = 0;
        if (dt > 0.25) dt = 0.25;   // a tab that was hidden hands back seconds

        if (this.frozen) {
            this.accumulator = 0;
            this.lastSteps = 0;
            this.host.draw(0, dt);
            return;
        }

        this.accumulator += dt;

        let steps = 0;
        while (this.accumulator >= C.FIXED_DT && steps < C.MAX_STEPS) {
            this.host.update(C.FIXED_DT);
            this.accumulator -= C.FIXED_DT;
            this.elapsed += C.FIXED_DT;
            steps++;
        }
        if (steps === C.MAX_STEPS) this.accumulator = 0;   // drop the surplus
        this.lastSteps = steps;

        if (steps > 0 && this.input) this.input.endStep();

        this.host.draw(this.accumulator / C.FIXED_DT, dt);
    };

    /**
     * Drive the simulation by hand, without a frame. The screenshot harness and
     * the smoke test use this to reach a state deterministically — `stop()` the
     * loop first or the page's own ticker races it.
     */
    Loop.prototype.stepManual = function (count, dt) {
        const step = dt || C.FIXED_DT;
        for (let i = 0; i < count; i++) {
            this.host.update(step);
            this.elapsed += step;
            if (this.input) this.input.endStep();
        }
    };

    TNT.Loop = Loop;
})(window.TNT = window.TNT || {});
