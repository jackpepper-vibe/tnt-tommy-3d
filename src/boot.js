/**
 * TNT Tommy — boot.
 *
 * Wires the simulation to the shell and starts the loop. The last script in
 * `index.html`, and the only one that knows about all the others.
 *
 * `window.TNT.game` is the test hook. The screenshot harness and the smoke test
 * drive the game through it, and both need to be able to *stop* the frame loop
 * before asserting or capturing — the page's own ticker will otherwise race
 * whatever state they were trying to reach, and a shot lands a few frames after
 * the one that was asked for.
 */
(function (TNT) {
    'use strict';

    const { C, Run, Input, Loop, Scene3D, Hud, Screens, Audio } = TNT;

    function boot() {
        const canvas = document.getElementById('world');
        const shell = document.getElementById('shell');

        /**
         * A lost WebGL context is indistinguishable from a bug anywhere else in
         * the renderer: draw calls still get counted, geometry is still in the
         * right place, and the screen is black. Say so out loud instead, and
         * record when it happened — the *when* is most of the diagnosis.
         */
        window.__tntGl = { lost: false, at: 0, restored: false };
        canvas.addEventListener('webglcontextlost', function (e) {
            e.preventDefault();          // makes restoration possible at all
            window.__tntGl.lost = true;
            window.__tntGl.at = performance.now();
            console.error('WebGL context lost at ' + Math.round(performance.now()) + 'ms');
        });
        canvas.addEventListener('webglcontextrestored', function () {
            window.__tntGl.restored = true;
            console.warn('WebGL context restored');
        });

        const run = new Run();
        const input = new Input();
        const scene = new Scene3D(canvas, run);
        const hud = new Hud(run, shell);
        const screens = new Screens(run, shell);
        const audio = new Audio(run);

        input.attach(window);

        const host = {
            update: function (dt) {
                run.update(dt, input);
                screens.workshopInput(input);

                // Shell keys are read here rather than inside `Run`, which has
                // no business knowing the page has a scanline toggle on it.
                if (input.justPressed('crt')) scene.toggleCrt();
                if (input.justPressed('mute')) audio.toggleMute();
                if (input.justPressed('confirm') && run.confirm()) audio.unlock();
            },
            draw: function (alpha, dt) {
                scene.draw(alpha, dt);
                hud.update(dt);
                audio.update();
            }
        };

        const loop = new Loop(host, input);

        // The opening room has to be built before the first frame, or the title
        // screen composites over an empty scene.
        scene.setRoom(run.mine.rooms[run.mine.spawnRoom], null);

        window.addEventListener('resize', function () { scene.resize(); });
        window.addEventListener('orientationchange', function () { scene.resize(); });

        // Audio cannot start before a gesture, and any gesture will do.
        const unlock = function () { audio.unlock(); };
        window.addEventListener('pointerdown', unlock, { once: false });
        window.addEventListener('keydown', unlock, { once: false });

        bindTouch(shell, input);

        loop.start();

        /**
         * The test hook. Deliberately small: everything a harness needs to reach
         * an arbitrary state, and nothing that would let it fake one.
         */
        TNT.game = {
            run: run,
            scene: scene,
            input: input,
            loop: loop,
            hud: hud,
            screens: screens,
            audio: audio,

            /**
             * Freeze the simulation. Always call this first from a harness.
             *
             * The frame loop keeps running and keeps drawing — see `Loop.frozen`
             * for why stopping it outright makes every screenshot black.
             */
            pause: function () { loop.frozen = true; },
            resume: function () { loop.frozen = false; },

            /** Advance the simulation by hand. Requires `pause()`. */
            step: function (n, dt) { loop.stepManual(n || 1, dt); },

            /** Begin a run, optionally at a given mine. */
            begin: function (mineIndex) {
                run.startRun();
                if (mineIndex) run.startMine(mineIndex);
                scene.setRoom(run.room(), null);
            },

            /** Jump straight to a room by id, for capturing one. */
            room: function (id) {
                const i = run.mine.rooms.findIndex(function (r) { return r.id === id; });
                if (i < 0) throw new Error('no room "' + id + '"');
                run.roomIndex = i;
                const spawn = findFooting(run.room());
                run.player.reset(spawn.x, spawn.y, true);
                run.player.active = true;
                run.dog.placeAt(spawn.x, spawn.y, 1);
                // Announced like any room change, so the HUD's banner and the
                // Governor bar follow the room a harness jumps to.
                run.bus.emit(TNT.EV.ROOM_CHANGED, { room: run.room(), dir: null });
                return run.room().name;
            },

            /** Put Tommy somewhere, in tile coordinates. */
            put: function (tx, ty) {
                run.player.reset(tx * C.TILE + C.TILE / 2, (ty + 1) * C.TILE, true);
                run.player.active = true;
                run.dog.placeAt(run.player.x, run.player.y, 1);
            },

            /** Hold or release inputs, for driving movement from a harness. */
            hold: function (actions) {
                input.reset();
                for (const a of actions || []) input.held[a] = true;
            },

            /** Render one frame without advancing anything. */
            draw: function () { scene.draw(0, 1 / 60); },

            /**
             * Strip the shell so a capture shows the game.
             *
             * Starts a run if one is not already under way. Hiding the title
             * card alone leaves the run in `title`, where Tommy is deliberately
             * not drawn — so every screenshot came back as an empty mine, which
             * looks like a rendering bug and is not one.
             */
            bare: function () {
                if (run.state === 'title') {
                    run.startRun();
                    scene.setRoom(run.room(), null);
                }
                screens.show(null);
                run.player.active = true;
            },

            crt: function (on) { scene.crt = !!on; }
        };
    }

    /** Somewhere in a room a body can stand — used by the `room()` hook. */
    function findFooting(room) {
        for (let ty = C.ROWS - 2; ty > 1; ty--) {
            for (let tx = 2; tx < C.COLS - 2; tx++) {
                if (room.get(tx, ty) !== C.Tile.EMPTY) continue;
                if (!TNT.Tiles.isFloor(room.get(tx, ty + 1))) continue;
                return { x: tx * C.TILE + C.TILE / 2, y: (ty + 1) * C.TILE };
            }
        }
        return { x: C.ROOM_W / 2, y: C.ROOM_H - C.TILE };
    }

    /**
     * On-screen controls.
     *
     * `touch-action: none` in the stylesheet stops the browser treating a held
     * direction as a scroll gesture, which otherwise cancels the press about a
     * fifth of a second in — the pad appears to work and then Tommy stops.
     */
    function bindTouch(shell, input) {
        const pad = shell.querySelector('#pad');
        if (!pad) return;

        const press = function (ev, down) {
            const btn = ev.target.closest('[data-key]');
            if (!btn) return;
            ev.preventDefault();
            input.setVirtual(btn.dataset.key, down);
            btn.classList.toggle('is-down', down);
        };

        pad.addEventListener('pointerdown', function (e) { press(e, true); });
        pad.addEventListener('pointerup', function (e) { press(e, false); });
        pad.addEventListener('pointercancel', function (e) { press(e, false); });
        pad.addEventListener('pointerleave', function (e) { press(e, false); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window.TNT = window.TNT || {});
