/**
 * TNT Tommy — everything that moves.
 *
 * Tommy, the patrols, the pickups, the machinery and the particles. The room
 * itself is rebuilt on every flip; this is not. Actors are **pooled**: a fixed
 * set of meshes is made once and reassigned as rooms change, because building
 * a mesh per entity per room means allocating and disposing a few dozen
 * geometries several times a minute, and the resulting garbage shows up as a
 * hitch at exactly the moment the camera is moving.
 *
 * Every rig is built from the same box kit the terrain uses and merged into one
 * geometry per part. Tommy is a handful of parts rather than one because his
 * limbs have to swing; everything else is a single buffer.
 *
 * This module reads simulation state and never writes it.
 */
(function (TNT, THREE) {
    'use strict';

    const { C, Util, R3D } = TNT;
    const F = R3D.FACE;

    const ACTOR_Z = 0.45;
    /**
     * Tommy is drawn larger than his collision box, deliberately.
     *
     * A room is forty-two tiles across a screen, so a character drawn at his
     * true size is about thirty pixels tall — enough to see *where* he is, not
     * enough to see *who* he is. The head and helmet are what grow past the
     * box; the feet stay exactly on it, so standing and landing still read as
     * true. Decks are three rows apart, which leaves room overhead for it.
     */
    const TOMMY_SCALE = 1.4;

    /**
     * How far below the rig's origin his boots actually are.
     *
     * The rig is authored around the hips — the legs hang from y 0.14 and the
     * trainer's sole sits 0.45 below that — so its lowest point is 0.31
     * *under* the origin. `player.y` is the sole of his foot, so placing the origin there
     * buried him nearly a third of a tile into whatever he was standing on,
     * which is why he looked like he was wading through the platform rather
     * than standing on it.
     *
     * Corrected at placement rather than by shifting a dozen numbers through
     * the rig, which would have to be kept in step every time a limb moves.
     * Scaled, because the group's scale applies to its children and not to its
     * own position.
     */
    const TOMMY_FOOT = 0.31;
    const Actors3D = {};

    /** One merged mesh from a builder callback, with a shared material. */
    function part(build, material) {
        const b = new R3D.Builder();
        build(b);
        const mesh = new THREE.Mesh(b.geometry(), material);
        return mesh;
    }

    /* ------------------------------------------------------------------ *
     * Tommy
     * ------------------------------------------------------------------ */

    /**
     * Tommy, as he is in the portrait on the title card: a red-haired boy in a
     * puffer jacket banded yellow, grey and charcoal, jeans, blue trainers —
     * and a miner's helmet with a lamp on it, because he is down a mine.
     *
     * The first two passes at him were a stack of boxes and read as exactly
     * that: a blue-coated man with a moustache, twenty pixels tall, with no
     * face to speak of. The things that make a small character legible are the
     * same in every good platformer, and all of them are here:
     *
     *   - **A big head.** A third of his height is head and helmet. At this size
     *     realistic proportions are a smudge; a big head is a person.
     *   - **A face you can see.** He is turned three-quarters to the camera, not
     *     in flat profile, so both eyes show — big, with whites, irises and a
     *     catch-light. Eyes are what the viewer looks at first on any figure.
     *   - **Round forms.** Every part is an ellipsoid or a cylinder: a puffer
     *     jacket in padded bands, round-toed trainers, a domed helmet. Soft
     *     shapes read as a character; boxes read as a crate.
     *   - **Jointed limbs.** Knees and elbows, so a run is a run — thigh, shin,
     *     foot rolling through — rather than two posts swinging.
     *
     * AUTHORED FACING +X
     * ------------------
     *   X  the way he faces      Y  up      Z  toward the camera (his left)
     *
     * The rig's origin is the hips. `TOMMY_FOOT` is how far below that the
     * soles sit.
     */
    function buildTommy(mat, glowMat) {
        const g = new THREE.Group();
        const col = R3D.col;
        const P = TOMMY_COLOURS;

        /* ---- body ---- */
        const body = new THREE.Group();
        body.add(part(function (b) {
            // The jacket in three padded bands: charcoal at the hem, a grey
            // stripe, yellow across the chest and shoulders.
            b.ellipsoid(0, 0.24, 0, 0.19, 0.12, 0.2, col(P.dark), 14, 8);
            b.ellipsoid(0, 0.36, 0, 0.2, 0.08, 0.21, col(P.grey), 14, 6);
            b.ellipsoid(0.0, 0.47, 0, 0.19, 0.1, 0.2, col(P.yellow), 14, 8);
            // The quilting seams between the bands.
            b.cyl(0, 0.31, 0, 0.195, 0.02, 'y', col(P.darkLit), 14);
            b.cyl(0, 0.415, 0, 0.2, 0.02, 'y', col(P.greyLit), 14);
            // Collar and hood, charcoal, sitting up round the neck.
            b.cyl(-0.02, 0.56, 0, 0.13, 0.08, 'y', col(P.dark), 12, col(P.darkLit));
            b.ellipsoid(-0.12, 0.54, 0, 0.1, 0.07, 0.15, col(P.dark), 10, 6);
            // Zip down the front.
            b.box(0.19, 0.37, 0, 0.02, 0.3, 0.03, col(P.greyLit));
            // Jeans at the waist, and a belt.
            b.ellipsoid(0, 0.12, 0, 0.16, 0.08, 0.17, col(P.jeans), 12, 6);
            b.cyl(0, 0.16, 0, 0.17, 0.03, 'y', col('#3a2a1c'), 12);
        }, mat));

        /*
         * The satchel on his back, and the sticks he is carrying poking out of
         * it. `sticks` are toggled by the sync pass from `run.tntHeld`, so what
         * you are holding is on the character and not only in the HUD.
         */
        const satchel = part(function (b) {
            b.box(-0.2, 0.3, -0.08, 0.1, 0.2, 0.22, col('#6b4524'), F.ALL, col('#8a5c30'));
            b.box(-0.2, 0.39, -0.08, 0.12, 0.05, 0.24, col('#4a2e16'), F.ALL);
            b.box(-0.02, 0.38, 0.19, 0.34, 0.03, 0.03, col('#4a2e16'));
        }, mat);
        body.add(satchel);
        const sticks = [];
        for (let i = 0; i < 3; i++) {
            const stick = part(function (b) {
                b.cyl(0, 0, 0, 0.032, 0.2, 'y', col('#d0392a'), 8, col('#f06050'));
                b.cyl(0, 0.12, 0, 0.008, 0.06, 'y', col('#7a6038'), 4);
            }, mat);
            stick.position.set(-0.21 + (i - 1) * 0.01, 0.46, -0.16 + i * 0.07);
            stick.rotation.z = 0.25 + i * 0.08;
            stick.visible = false;
            body.add(stick);
            sticks.push(stick);
        }
        g.add(body);

        /* ---- head ---- */
        const head = new THREE.Group();
        head.position.y = HEAD_Y;
        head.add(part(function (b) {
            const skin = col(P.skin), shade = col(P.skinShade);
            // Head: a touch wider than tall, the jaw slightly forward.
            b.ellipsoid(0.01, 0.2, 0, 0.23, 0.22, 0.22, skin, 16, 10);
            b.ellipsoid(0.08, 0.1, 0, 0.14, 0.1, 0.16, skin, 12, 6);
            // Nose, and cheeks with a bit of colour.
            b.ellipsoid(0.235, 0.17, 0.02, 0.04, 0.035, 0.035, shade, 8, 5);
            b.ellipsoid(0.17, 0.12, 0.13, 0.05, 0.03, 0.03, col(P.cheek), 8, 5);
            b.ellipsoid(0.19, 0.12, -0.11, 0.04, 0.03, 0.03, col(P.cheek), 8, 5);
            // Ears.
            b.ellipsoid(-0.01, 0.17, 0.22, 0.05, 0.065, 0.03, shade, 8, 5);
            b.ellipsoid(-0.01, 0.17, -0.22, 0.05, 0.065, 0.03, shade, 8, 5);
            // Smile: a short curve of dark segments across the front of the jaw.
            for (let k = -2; k <= 2; k++) {
                const a = k * 0.28;
                b.rbox(0.215 - Math.abs(k) * 0.008, 0.075 + k * k * 0.006, 0.02 + k * 0.035,
                       0.03, 0.018, 0.03, 0, col('#7a2a20'));
            }
            // Hair: the fringe sweeping out from under the brim, sideburns,
            // and tufts sticking out at the back.
            const hair = col(P.hair), hairLit = col(P.hairLit), hairDk = col(P.hairDark);
            b.ellipsoid(-0.05, 0.27, 0, 0.21, 0.13, 0.225, hairDk, 14, 8);
            for (let k = 0; k < 5; k++) {
                const z = -0.14 + k * 0.07;
                b.ellipsoid(0.17, 0.32 - Math.abs(z) * 0.3, z, 0.06, 0.045, 0.045,
                            k % 2 ? hair : hairLit, 8, 5);
            }
            for (const s of [1, -1]) b.ellipsoid(0.06, 0.2, s * 0.2, 0.05, 0.08, 0.03, hair, 8, 5);
            for (let k = 0; k < 4; k++) {
                b.cone(-0.22, 0.2 + k * 0.05, -0.12 + k * 0.08, 0.05, 0.12,
                       k % 2 ? hair : hairLit, false, 5);
            }
        }, mat));

        // Eyes are their own parts so they can blink.
        const eyes = [];
        for (const ez of [0.085, -0.085]) {
            const eye = new THREE.Group();
            eye.position.set(0.195, 0.2, ez);
            eye.add(part(function (b) {
                b.ellipsoid(0, 0, 0, 0.035, 0.05, 0.04, col('#ffffff'), 10, 6);
                b.ellipsoid(0.02, -0.005, 0, 0.02, 0.034, 0.028, col(P.iris), 8, 5);
                b.ellipsoid(0.03, -0.005, 0, 0.012, 0.02, 0.016, col('#101018'), 8, 5);
                b.ellipsoid(0.035, 0.012, 0.01, 0.006, 0.008, 0.006, col('#ffffff'), 6, 4);
                // Brow above, in the hair's darker red.
                b.rbox(0.01, 0.07, 0, 0.03, 0.016, 0.075, ez > 0 ? -0.15 : 0.15, col(P.hairDark));
            }, mat));
            head.add(eye);
            eyes.push(eye);
        }

        /*
         * The helmet: a dome, a brim that juts forward over the eyes, a ridge
         * down the crown, and the lamp on the front. Sitting well down on his
         * head so the fringe shows under it — that red line between yellow
         * helmet and pink face is most of what says "Tommy" at a distance.
         */
        head.add(part(function (b) {
            const hel = col(P.helmet), lit = col(P.helmetLit), dk = col(P.helmetDark);
            b.ellipsoid(-0.01, 0.3, 0, 0.26, 0.23, 0.25, hel, 18, 10, 0.5, dk);
            b.ellipsoid(0.01, 0.3, 0, 0.3, 0.035, 0.29, dk, 18, 4);                   // band
            b.ellipsoid(0.12, 0.3, 0, 0.2, 0.025, 0.2, hel, 16, 4);                    // front brim
            b.box(-0.01, 0.46, 0, 0.36, 0.05, 0.05, lit, F.ALL);                      // crown ridge
            // Lamp: a housing on the front of the dome, and a cable to the back.
            b.cyl(0.22, 0.4, 0, 0.055, 0.1, 'x', col('#3a3a40'), 10, col('#5a5a62'));
            b.cyl(0.26, 0.4, 0, 0.065, 0.03, 'x', col('#c8c8d0'), 12);
            b.cyl(0.0, 0.34, -0.25, 0.012, 0.3, 'x', col('#222226'), 5);
        }, mat));
        head.add(part(function (b) {
            b.cyl(0.28, 0.4, 0, 0.05, 0.02, 'x', col('#fff6d0'), 12);
        }, glowMat));
        g.add(head);

        /* ---- legs: thigh, shin, trainer ---- */
        const leg = function (near) {
            const k = near ? 0 : 0.28;
            const jeans = R3D.mixCol(P.jeans, '#000000', k);
            const jeansLit = R3D.mixCol(P.jeansLit, '#000000', k);
            const thigh = new THREE.Group();
            thigh.position.set(0.0, HIP_Y, near ? 0.085 : -0.085);
            thigh.add(part(function (b) {
                b.cyl(0, -THIGH / 2, 0, 0.075, THIGH + 0.04, 'y', jeans, 10, jeansLit);
            }, mat));
            const shin = new THREE.Group();
            shin.position.y = -THIGH;
            shin.add(part(function (b) {
                b.cyl(0, -SHIN / 2, 0, 0.068, SHIN + 0.02, 'y', jeans, 10, jeansLit);
                b.cyl(0, -SHIN + 0.02, 0, 0.074, 0.04, 'y', jeansLit, 10);        // turn-up
                // The trainer: a round toe, a white sole, a stripe.
                const shoe = R3D.mixCol(P.shoe, '#000000', k);
                b.ellipsoid(0.05, -SHIN - 0.03, 0, 0.12, 0.06, 0.075, shoe, 12, 6);
                b.box(0.05, -SHIN - 0.075, 0, 0.24, 0.035, 0.15, R3D.mixCol(P.sole, '#000000', k), F.ALL);
                b.box(0.07, -SHIN - 0.02, 0.07, 0.1, 0.02, 0.01, R3D.mixCol('#ffffff', '#000000', k));
            }, mat));
            thigh.add(shin);
            thigh.userData.shin = shin;
            return thigh;
        };
        const legNear = leg(true), legFar = leg(false);
        g.add(legNear, legFar);

        /* ---- arms: upper, forearm, hand ---- */
        const arm = function (near) {
            const k = near ? 0 : 0.3;
            const sleeve = R3D.mixCol(P.dark, '#000000', k);
            const cuff = R3D.mixCol(P.yellow, '#000000', k);
            const upper = new THREE.Group();
            upper.position.set(0.0, SHOULDER_Y, near ? 0.215 : -0.215);
            upper.add(part(function (b) {
                b.ellipsoid(0, -0.02, 0, 0.08, 0.08, 0.08, R3D.mixCol(P.yellow, '#000000', k), 10, 6);
                b.cyl(0, -UPPER / 2, 0, 0.06, UPPER, 'y', sleeve, 10);
            }, mat));
            const fore = new THREE.Group();
            fore.position.y = -UPPER;
            fore.add(part(function (b) {
                b.cyl(0, -FORE / 2, 0, 0.055, FORE, 'y', sleeve, 10);
                b.cyl(0, -FORE + 0.01, 0, 0.06, 0.035, 'y', cuff, 10);
                b.ellipsoid(0.01, -FORE - 0.045, 0, 0.05, 0.055, 0.045,
                            R3D.mixCol(P.skin, '#000000', k), 10, 6);
            }, mat));
            upper.add(fore);
            upper.userData.fore = fore;
            return upper;
        };
        const armNear = arm(true), armFar = arm(false);
        g.add(armNear, armFar);

        g.userData = {
            head: head, body: body, eyes: eyes, sticks: sticks,
            legL: legNear, legR: legFar,
            armL: armNear, armR: armFar,
            blink: 2.4, stride: 0, face: 1, lean: 0, dead: 0
        };
        g.scale.setScalar(TOMMY_SCALE);
        return g;
    }

    const TOMMY_COLOURS = {
        skin: '#f2c29c', skinShade: '#dfa07e', cheek: '#f2988a',
        hair: '#d4581c', hairLit: '#f47c32', hairDark: '#9a3a12',
        iris: '#3a7ad0',
        yellow: '#ecab1e', grey: '#8c949e', greyLit: '#c0c8d0',
        dark: '#2f3237', darkLit: '#4c5058',
        jeans: '#3b62a8', jeansLit: '#5d88d0',
        shoe: '#2d62c6', sole: '#eceef2',
        helmet: '#f8c81e', helmetLit: '#ffe57a', helmetDark: '#c48a10'
    };

    /* Rig dimensions, in rig units before `TOMMY_SCALE`. */
    const HIP_Y = 0.14;
    const THIGH = 0.19;
    const SHIN = 0.17;
    const SHOULDER_Y = 0.5;
    const UPPER = 0.15;
    const FORE = 0.14;
    const HEAD_Y = 0.58;

    /**
     * How far round toward the camera he is turned, in radians.
     *
     * Flat profile shows one eye and a nose; a three-quarter view shows a
     * face. It costs nothing in readability of direction — the brim, the nose
     * and the stride all still point the way he is going.
     */
    const THREE_QUARTER = 0.5;

    /**
     * Pose Tommy from his state.
     *
     * Every stance has to read differently at a glance, because what he is
     * *holding* — ladder, chain, cable, nothing — is what decides what the
     * buttons do next.
     *
     * Limbs swing about Z, which in profile is forward (+) and back (−). Knees
     * only ever bend back and elbows only forward, and both are driven off the
     * same stride phase as the swing so the whole limb moves as one.
     */
    function poseTommy(g, player, t, dt, held) {
        const u = g.userData;
        const pose = player.pose();
        const step = dt || 1 / 60;
        const speedK = Util.clamp(Math.abs(player.vx) / C.MOVE_MAX, 0, 1);

        // Squash on landing, stretch on take-off — read from the simulation,
        // so it is always in step with the impact.
        const sq = player.squash;
        const k = TOMMY_SCALE;
        g.scale.set(k * (1 + sq * 0.22), k * (1 - sq * 0.24), k * (1 + sq * 0.12));

        // The stride is driven by distance covered, not by time, so the feet
        // stay planted at any speed.
        if (pose === 'run') u.stride += Math.abs(player.vx) * step * 0.105;
        else if (pose === 'climb') u.stride += Math.abs(player.vy) * step * 0.11;
        else if (pose === 'rope') u.stride += Math.abs(player.vx) * step * 0.09;
        else if (pose === 'swim') u.stride += step * 5;

        // Reset the X axis, which only the climb uses.
        for (const limb of [u.armL, u.armR, u.legL, u.legR, u.body, u.head]) limb.rotation.x = 0;
        u.body.position.y = 0;
        u.body.scale.set(1, 1, 1);
        u.head.position.y = HEAD_Y;

        const phase = u.stride;
        const s = Math.sin(phase);
        const set = function (limb, swing, bend) {
            limb.rotation.z = swing;
            (limb.userData.shin || limb.userData.fore).rotation.z = bend;
        };

        if (pose === 'run') {
            const amp = Util.clamp(speedK, 0.35, 1);
            // Knees bend hardest on the forward swing, the way a stride does.
            const bendN = -(0.15 + Math.max(0, Math.cos(phase)) * 1.2) * amp;
            const bendF = -(0.15 + Math.max(0, -Math.cos(phase)) * 1.2) * amp;
            set(u.legL, s * 0.85 * amp, bendN);
            set(u.legR, -s * 0.85 * amp, bendF);
            set(u.armL, -s * 0.9 * amp, 1.1);
            set(u.armR, s * 0.9 * amp, 1.1);
            u.body.position.y = Math.abs(Math.cos(phase)) * 0.045 * amp;
            u.head.position.y = HEAD_Y + u.body.position.y;
            u.head.rotation.z = -0.05;
        } else if (pose === 'climb') {
            /*
             * Seen from behind: the turn scalar below puts him back to camera,
             * and in that view the rig's Z points across the screen — so the
             * arm and leg swings move to X, where they can be seen.
             * Hand over hand, and the opposite knee comes up with each reach.
             */
            const reachN = Math.PI - 0.35 + s * 0.28;
            const reachF = Math.PI - 0.35 - s * 0.28;
            u.armL.rotation.x = reachN;
            u.armR.rotation.x = -reachF;
            u.armL.rotation.z = u.armR.rotation.z = 0;
            u.armL.userData.fore.rotation.z = 0.4 - s * 0.3;
            u.armR.userData.fore.rotation.z = 0.4 + s * 0.3;
            set(u.legL, 0.5 + Math.max(0, s) * 0.8, -0.8 - Math.max(0, s) * 0.6);
            set(u.legR, 0.5 + Math.max(0, -s) * 0.8, -0.8 - Math.max(0, -s) * 0.6);
            u.body.rotation.x = s * 0.06;
            u.head.rotation.z = 0.15;
        } else if (pose === 'rope') {
            // Hanging by both hands, legs swinging under.
            set(u.armL, Math.PI - 0.15 + s * 0.2, 0.2);
            set(u.armR, Math.PI - 0.15 - s * 0.2, 0.2);
            set(u.legL, s * 0.45, -0.3);
            set(u.legR, -s * 0.45, -0.3);
            u.head.rotation.z = 0.25;
        } else if (pose === 'wall') {
            // Pressed to the wall he is sliding down: palms flat on it, one
            // knee braced against it, looking back over his shoulder for the
            // kick.
            set(u.armL, 2.2, 0.9);
            set(u.armR, 1.4, 1.1);
            set(u.legL, 0.9, -1.3);
            set(u.legR, 0.1, -0.3);
            u.body.rotation.x = 0;
            u.head.rotation.z = 0.2;
        } else if (pose === 'rise') {
            // Tucked: knees up, arms thrown up and forward.
            set(u.legL, 1.0, -1.5);
            set(u.legR, 0.3, -0.7);
            set(u.armL, 2.5, 0.4);
            set(u.armR, -0.6, 0.8);
            u.head.rotation.z = 0.12;
        } else if (pose === 'fall') {
            // Arms up and paddling, legs reaching for the ground.
            const flail = Math.sin(t * 16) * 0.3;
            set(u.legL, 0.35, -0.35);
            set(u.legR, -0.2, -0.2);
            set(u.armL, 2.3 + flail, 0.5);
            set(u.armR, 2.0 - flail, 0.5);
            u.head.rotation.z = -0.1;
        } else if (pose === 'swim') {
            set(u.armL, 1.4 + s * 1.1, 0.6 - s * 0.4);
            set(u.armR, 1.4 + s * 1.1, 0.6 - s * 0.4);
            set(u.legL, -0.3 - s * 0.5, -0.6 - Math.max(0, s) * 0.8);
            set(u.legR, -0.3 + s * 0.5, -0.6 - Math.max(0, -s) * 0.8);
            u.head.rotation.z = 0.35;
        } else if (pose === 'dead') {
            set(u.legL, 0.2, -0.3);
            set(u.legR, -0.1, -0.2);
            set(u.armL, 2.6, 0.2);
            set(u.armR, 2.2, 0.3);
        } else {
            // Idle: breathing, a slight weight shift, and a blink now and then.
            const breathe = Math.sin(t * 2.2);
            u.body.scale.set(1, 1 + breathe * 0.02, 1 + breathe * 0.015);
            u.head.position.y = HEAD_Y + breathe * 0.008;
            set(u.legL, 0.06, -0.04);
            set(u.legR, -0.06, -0.04);
            set(u.armL, 0.12 + breathe * 0.03, 0.35);
            set(u.armR, -0.08 - breathe * 0.03, 0.3);
            u.head.rotation.z = Math.sin(t * 0.7) * 0.05;
        }

        // Blink: every few seconds, for a tenth of one.
        u.blink -= step;
        if (u.blink < -0.1) u.blink = 2 + Math.random() * 3;
        const lid = u.blink < 0 ? 0.12 : 1;
        for (const eye of u.eyes) eye.scale.y = lid;

        // What he is carrying shows in the satchel.
        for (let i = 0; i < u.sticks.length; i++) u.sticks[i].visible = held > i;

        /*
         * Turning, damped as a scalar from -1 to 1 so a quick reversal can
         * never resolve the long way round through his back. Zero is a quarter
         * turn — back to the camera — which is exactly the climbing view, so
         * the ladder turn takes the same path at the same rate.
         */
        const facing = pose === 'climb' ? 0 : (player.facing >= 0 ? 1 : -1);
        u.face = Util.damp(u.face, facing, 26, step);
        g.rotation.y = (1 - u.face) * 0.5 * Math.PI - u.face * THREE_QUARTER;

        // A run leans into its direction.
        const lean = pose === 'run' ? speedK * 0.2 : 0;
        u.lean = Util.damp(u.lean, lean, 12, step);
        u.body.rotation.z = -u.lean;
        u.head.rotation.z -= u.lean * 0.5;

        // Down: he topples, over a third of a second.
        u.dead = pose === 'dead' ? Math.min(1, u.dead + step * 3) : 0;
        g.rotation.z = u.dead * (Math.PI / 2) * (player.facing >= 0 ? 1 : -1);

        // Invulnerability blink, at twelve a second.
        g.visible = !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0);
    }

    /* ------------------------------------------------------------------ *
     * The dog
     * ------------------------------------------------------------------ */

    /**
     * Tommy's Shih Tzu: a white-and-grey mop of a dog with grey ears, a black
     * button nose and eyes, a topknot with a red bow, and a plumed tail curled
     * over its back.
     *
     * Almost all of it is fur, and fur at this size is *outline*: a long, low
     * body with a skirt that hides the legs, and a head as wide as the body.
     * The legs are there for the trot, but it is the bob and the wagging tail
     * that make it read as a small dog hurrying along.
     *
     * Authored facing +X with the paws on y = 0.
     */
    function buildDog(mat) {
        const g = new THREE.Group();
        const white = R3D.col('#f0eee8'), cream = R3D.col('#ddd6c8');
        const grey = R3D.col('#7c7c84'), greyDk = R3D.col('#56565e');
        const black = R3D.col('#141416');

        const body = new THREE.Group();
        body.add(part(function (b) {
            b.ellipsoid(0, 0.2, 0, 0.23, 0.12, 0.14, white, 14, 8);
            b.ellipsoid(-0.03, 0.26, 0, 0.17, 0.08, 0.12, grey, 12, 7);         // saddle
            b.ellipsoid(0, 0.13, 0, 0.25, 0.09, 0.16, cream, 14, 7);            // skirt
            b.ellipsoid(0.16, 0.2, 0, 0.1, 0.12, 0.13, white, 10, 7);           // chest
        }, mat));
        g.add(body);

        const head = new THREE.Group();
        head.position.set(0.22, 0.33, 0);
        head.add(part(function (b) {
            b.ellipsoid(0, 0.02, 0, 0.13, 0.12, 0.13, white, 14, 8);
            b.ellipsoid(-0.03, 0.06, 0, 0.1, 0.08, 0.12, grey, 10, 6);          // crown
            b.ellipsoid(0.1, -0.02, 0, 0.07, 0.06, 0.08, white, 10, 6);          // muzzle
            b.ellipsoid(0.165, 0.0, 0, 0.025, 0.02, 0.025, black, 8, 5);         // nose
            b.ellipsoid(0.09, 0.04, 0.06, 0.028, 0.03, 0.02, black, 8, 5);       // eyes
            b.ellipsoid(0.09, 0.04, -0.06, 0.028, 0.03, 0.02, black, 8, 5);
            b.ellipsoid(0.105, 0.05, 0.068, 0.007, 0.008, 0.005, R3D.col('#ffffff'), 5, 4);
            // Long grey ears hanging either side.
            for (const s of [1, -1]) b.ellipsoid(-0.02, -0.04, s * 0.13, 0.05, 0.11, 0.035, greyDk, 10, 6);
            // Topknot and bow.
            b.ellipsoid(-0.02, 0.15, 0, 0.04, 0.05, 0.04, white, 8, 5);
            b.ellipsoid(-0.02, 0.2, 0.03, 0.035, 0.025, 0.03, R3D.col('#e0343a'), 8, 5);
            b.ellipsoid(-0.02, 0.2, -0.03, 0.035, 0.025, 0.03, R3D.col('#e0343a'), 8, 5);
        }, mat));
        // The jaw, which opens to bark.
        const jaw = part(function (b) {
            b.ellipsoid(0.06, -0.02, 0, 0.06, 0.02, 0.05, R3D.col('#e8a0a0'), 8, 5);
        }, mat);
        jaw.position.set(0.04, -0.05, 0);
        head.add(jaw);
        g.add(head);

        // The plume of a tail, curled forward over the back.
        const tail = new THREE.Group();
        tail.position.set(-0.2, 0.26, 0);
        tail.add(part(function (b) {
            for (let k = 0; k < 5; k++) {
                const a = 0.3 + k * 0.42;
                b.ellipsoid(-Math.cos(a) * 0.1 + 0.02, Math.sin(a) * 0.1 + 0.03, 0,
                            0.06, 0.05, 0.06, k % 2 ? white : cream, 8, 5);
            }
        }, mat));
        g.add(tail);

        const legs = [];
        for (const [x, z] of [[0.13, 0.07], [0.13, -0.07], [-0.13, 0.07], [-0.13, -0.07]]) {
            const leg = new THREE.Group();
            leg.position.set(x, 0.12, z);
            leg.add(part(function (b) {
                b.cyl(0, -0.06, 0, 0.035, 0.12, 'y', z > 0 ? white : cream, 6);
                b.ellipsoid(0.01, -0.115, 0, 0.04, 0.02, 0.035, z > 0 ? white : cream, 6, 4);
            }, mat));
            g.add(leg);
            legs.push(leg);
        }

        g.userData = { body: body, head: head, jaw: jaw, tail: tail, legs: legs, face: 1, gait: 0, sit: 0 };
        g.scale.setScalar(1.25);
        return g;
    }

    function poseDog(g, dog, t, dt) {
        const u = g.userData;
        const step = dt || 1 / 60;
        const moving = dog.state === 'follow' && Math.abs(dog.vx) + Math.abs(dog.vy) > 15;
        u.gait += (moving ? Math.min(Math.hypot(dog.vx, dog.vy), 260) * 0.12 : 0) * step;

        // Sitting eases in and out, rather than snapping.
        u.sit = Util.damp(u.sit, dog.state === 'sit' ? 1 : 0, 8, step);

        const s = Math.sin(u.gait);
        const bob = moving ? Math.abs(Math.cos(u.gait)) * 0.035 : 0;
        u.body.position.y = bob - u.sit * 0.04;
        u.body.rotation.z = u.sit * 0.45;
        u.head.position.y = 0.33 + bob + u.sit * 0.06;
        u.head.position.x = 0.22 - u.sit * 0.04;
        u.tail.position.y = 0.26 + bob - u.sit * 0.12;

        if (dog.airborne && moving) {
            // A scrabbling hop: front legs reaching, back legs kicked out.
            u.legs[0].rotation.z = u.legs[1].rotation.z = 0.9;
            u.legs[2].rotation.z = u.legs[3].rotation.z = -0.9;
        } else {
            u.legs[0].rotation.z = s * 0.7;
            u.legs[3].rotation.z = s * 0.7;
            u.legs[1].rotation.z = -s * 0.7;
            u.legs[2].rotation.z = -s * 0.7 - u.sit * 1.2;
            if (u.sit > 0.1) u.legs[3].rotation.z = -u.sit * 1.2;
        }

        // The tail never stops, and goes faster when there is something to find.
        const wagRate = dog.state === 'point' ? 26 : (moving ? 14 : 9);
        u.tail.rotation.x = Math.sin(t * wagRate) * 0.45;
        u.head.rotation.z = dog.state === 'point' ? 0.25 : Math.sin(t * 1.3) * 0.08;

        // Bark: the jaw drops.
        u.jaw.rotation.z = dog.bark > 0 ? -0.5 * Math.abs(Math.sin(dog.bark * 30)) : 0;

        u.face = Util.damp(u.face, dog.facing >= 0 ? 1 : -1, 20, step);
        g.rotation.y = (1 - u.face) * 0.5 * Math.PI - u.face * 0.45;
    }

    /* ------------------------------------------------------------------ *
     * Rigs
     * ------------------------------------------------------------------ */

    /**
     * Every rig in here was a box, and against a room that has just been
     * rebuilt out of round stock they were the last flat thing on screen.
     *
     * The rule each one follows: a **distinct silhouette at twenty pixels**.
     * Not detail — silhouette. A player has to tell a walker from a dog from a
     * spider by outline alone, in the half second before one of them reaches
     * them, in a dark room. So each gets one exaggerated feature and a
     * high-value accent, and none of them is symmetrical.
     */
    const RIGS = {
        /** A minecart bot: a riveted tub on wheels, a stack, and one lamp eye. */
        walker: function (b) {
            const iron = R3D.col('#4a3a30');
            const lit = R3D.col('#7a604c');
            b.cyl(0, 0.04, 0, 0.3, 0.62, 'z', iron, 14, lit);
            b.cyl(0, 0.04, 0, 0.31, 0.06, 'z', lit, 14);
            for (const s of [-1, 1]) b.cyl(0, 0.04, s * 0.26, 0.31, 0.04, 'z', lit, 14);
            b.cyl(-0.24, -0.28, 0, 0.13, 0.5, 'z', R3D.col('#1e1e24'), 12, R3D.col('#5a5a66'));
            b.cyl(0.24, -0.28, 0, 0.13, 0.5, 'z', R3D.col('#1e1e24'), 12, R3D.col('#5a5a66'));
            b.cyl(-0.08, 0.4, 0, 0.07, 0.3, 'y', R3D.col('#2a2a30'), 8);
            b.cyl(-0.08, 0.56, 0, 0.1, 0.05, 'y', R3D.col('#5a5a66'), 8);
            // The eye: a hooded lamp on the front, amber — it has a front.
            b.cyl(0.26, 0.1, 0.12, 0.09, 0.08, 'x', R3D.col('#2a2a30'), 10);
            b.ellipsoid(0.31, 0.1, 0.12, 0.03, 0.07, 0.07, R3D.col('#ffb030'), 10, 6);
        },

        /** A rust beetle: a riveted, segmented shell, low and wide, with a lamp eye. */
        crawler: function (b) {
            const shell = R3D.col('#5a3a22');
            const shellLit = R3D.col('#8a5a30');
            const joint = R3D.col('#2a2420');
            for (let i = 0; i < 3; i++) {
                const x = -0.2 + i * 0.17;
                b.ellipsoid(x, 0.02, 0, 0.13, 0.15 - Math.abs(i - 1) * 0.02, 0.2,
                            i % 2 ? shell : shellLit, 12, 7, 0.55, joint);
                b.sphere(x, 0.14, 0.12, 0.025, R3D.col('#c8a060'), 5, 4);
            }
            b.ellipsoid(0.28, -0.01, 0, 0.1, 0.09, 0.13, R3D.col('#3a2e28'), 10, 6);
            b.ellipsoid(0.36, 0.02, 0.06, 0.03, 0.035, 0.035, R3D.col('#ff5a2a'), 6, 5);
            b.ellipsoid(0.36, 0.02, -0.06, 0.03, 0.035, 0.035, R3D.col('#ff5a2a'), 6, 5);
            // Mandibles.
            b.rbox(0.4, -0.06, 0.05, 0.12, 0.025, 0.025, -0.4, R3D.col('#8a8a96'));
            b.rbox(0.4, -0.06, -0.05, 0.12, 0.025, 0.025, -0.4, R3D.col('#8a8a96'));
            // Legs: piston struts angled out.
            for (let i = 0; i < 3; i++) {
                const x = -0.2 + i * 0.2;
                for (const s of [1, -1]) {
                    b.rbox(x, -0.12, s * 0.2, 0.05, 0.2, 0.04, s * 0.2, joint);
                }
            }
        },

        /**
         * A clockwork hound: long, low and pointed, iron plates over a brass
         * frame, a red eye and a winding key in its back. It says "this one
         * comes at you" — and it is nothing like Tommy's dog, which matters now
         * that he has one.
         */
        dog: function (b) {
            const iron = R3D.col('#3c3834');
            const lit = R3D.col('#6a625a');
            const brass = R3D.col('#b8893e');
            b.ellipsoid(0, 0.02, 0, 0.32, 0.15, 0.15, iron, 12, 7);
            for (let i = 0; i < 3; i++) b.cyl(-0.16 + i * 0.16, 0.03, 0, 0.155, 0.03, 'x', lit, 12);
            b.ellipsoid(0.36, 0.1, 0, 0.14, 0.11, 0.11, lit, 10, 7);
            b.ellipsoid(0.5, 0.05, 0, 0.1, 0.05, 0.07, iron, 8, 5);                 // snout
            b.ellipsoid(0.44, 0.14, 0.08, 0.03, 0.03, 0.02, R3D.col('#ff3a2a'), 6, 5);
            b.ellipsoid(0.44, 0.14, -0.08, 0.03, 0.03, 0.02, R3D.col('#ff3a2a'), 6, 5);
            b.cone(0.3, 0.25, 0.07, 0.05, 0.14, iron, true, 5);                   // ears
            b.cone(0.3, 0.25, -0.07, 0.05, 0.14, iron, true, 5);
            // Winding key.
            b.cyl(-0.08, 0.2, 0, 0.025, 0.1, 'y', brass, 6);
            b.box(-0.08, 0.28, 0, 0.16, 0.08, 0.03, brass);
            b.cyl(-0.34, 0.12, 0, 0.03, 0.22, 'x', lit, 6);                        // tail
            for (const x of [-0.2, 0.2]) {
                for (const s of [1, -1]) {
                    b.cyl(x, -0.18, s * 0.1, 0.04, 0.24, 'y', iron, 6);
                    b.sphere(x, -0.07, s * 0.1, 0.05, brass, 6, 4);
                }
            }
        },

        /** A spider-bot: an iron bulb, a cluster of red eyes, eight black legs. */
        spider: function (b) {
            b.sphere(0, -0.02, 0, 0.19, R3D.col('#2e2a30'), 12, 8);
            b.cyl(0, -0.02, 0, 0.195, 0.04, 'y', R3D.col('#8a7a60'), 12);
            b.sphere(0.14, 0.02, 0, 0.1, R3D.col('#3e3842'), 10, 6);
            b.sphere(0.2, 0.05, 0.05, 0.035, R3D.col('#ff3a2a'), 6, 5);
            b.sphere(0.2, 0.05, -0.05, 0.035, R3D.col('#ff3a2a'), 6, 5);
            b.sphere(0.22, 0.1, 0, 0.025, R3D.col('#ff8a5a'), 6, 5);
            for (let i = 0; i < 4; i++) {
                const x = -0.15 + i * 0.1;
                for (const s of [1, -1]) {
                    b.rbox(x, 0.1, s * 0.2, 0.03, 0.22, 0.03, s * 0.6, R3D.col('#141018'));
                    b.rbox(x, -0.06, s * 0.3, 0.03, 0.26, 0.03, -s * 0.3, R3D.col('#141018'));
                }
            }
        },

        /**
         * A sentinel: a brass drone with a rotor on top and one searchlight
         * eye. Walls mean nothing to it, and it looks like the kind of machine
         * that would not care.
         */
        guardian: function (b) {
            const brass = R3D.col('#8a6a34');
            const lit = R3D.col('#d8b060');
            b.sphere(0, 0, 0, 0.22, brass, 14, 9);
            b.cyl(0, 0, 0, 0.23, 0.05, 'y', lit, 14);
            b.cyl(0, 0.24, 0, 0.04, 0.12, 'y', R3D.col('#3a3a40'), 6);
            b.box(0, 0.31, 0, 0.7, 0.03, 0.08, R3D.col('#2a2a30'));                // rotor
            b.box(0, 0.31, 0, 0.08, 0.03, 0.7, R3D.col('#2a2a30'));
            b.cyl(0.0, 0, 0.18, 0.11, 0.08, 'z', R3D.col('#1a1a20'), 12);           // eye hood
            b.cyl(0.0, 0, 0.22, 0.08, 0.02, 'z', R3D.col('#bfe4ff'), 12);           // lens
            for (const s of [-1, 1]) b.cyl(s * 0.24, -0.08, 0, 0.03, 0.18, 'y', R3D.col('#3a3a40'), 6);
        },

        /** One unit of silk — a steel cable here — scaled to length by the sync pass. */
        thread: function (b) {
            b.cyl(0, -0.5, 0, 0.016, 1, 'y', R3D.col('#8a8aa0'), 4);
        },

        /** A cave bat: furred body, big ears, and wide membrane wings. */
        bat: function (b) {
            const fur = R3D.col('#3e3046');
            const wing = R3D.col('#2a1f30');
            b.ellipsoid(0, 0, 0, 0.13, 0.15, 0.12, fur, 10, 7);
            b.cone(-0.07, 0.17, 0, 0.05, 0.14, fur, true, 5);
            b.cone(0.07, 0.17, 0, 0.05, 0.14, fur, true, 5);
            b.sphere(-0.05, 0.04, 0.1, 0.03, R3D.col('#ffcc55'), 6, 5);
            b.sphere(0.05, 0.04, 0.1, 0.03, R3D.col('#ffcc55'), 6, 5);
            for (const s of [-1, 1]) {
                b.rbox(s * 0.25, 0.06, 0, 0.28, 0.06, 0.03, s * 0.25, wing);
                b.rbox(s * 0.44, 0.0, 0, 0.2, 0.05, 0.03, -s * 0.35, wing);
                // The membrane: fingers fanned from the wrist.
                for (let k = 0; k < 3; k++) {
                    b.rbox(s * (0.3 + k * 0.06), -0.06, 0, 0.03, 0.2 - k * 0.03, 0.02, s * (0.3 + k * 0.25), wing);
                }
            }
        },

        /** A ball of fire. Round, and layered so it has a hot core. */
        orb: function (b) {
            b.sphere(0, 0, 0, 0.22, R3D.col('#ff7a3c'), 12, 8);
            b.sphere(0, 0.02, 0.05, 0.14, R3D.col('#ffc46a'), 10, 7);
            b.sphere(0, 0.03, 0.09, 0.07, R3D.col('#fff3c8'), 8, 6);
        },

        /** A piston head on a ram, with teeth. */
        crusher: function (b) {
            const steel = R3D.col('#5a5a66');
            const steelLit = R3D.col('#82828f');
            b.cyl(0, 0.44, 0, 0.13, 0.5, 'y', R3D.col('#3a3a44'), 8);
            b.box(0, 0.02, 0, 1.7, 0.62, 0.78, steel, F.ALL, steelLit);
            b.box(0, 0.30, 0, 1.86, 0.14, 0.86, R3D.col('#43434e'), F.ALL, steelLit);
            for (let i = 0; i < 5; i++) {
                b.cone(-0.68 + i * 0.34, -0.40, 0, 0.13, 0.28, R3D.col('#9aa0ac'), false, 6);
            }
            for (const s of [-1, 1]) {
                for (let i = 0; i < 3; i++) {
                    b.sphere(s * 0.74, 0.14 - i * 0.16, 0.4, 0.045, steelLit, 6, 5);
                }
            }
        },

        /** A rock. Actually round, with lumps knocked off it. */
        boulder: function (b) {
            b.sphere(0, 0, 0, 0.34, R3D.col('#584a3c'), 10, 7);
            b.sphere(0.16, 0.14, 0.12, 0.16, R3D.col('#6b5a48'), 8, 6);
            b.sphere(-0.18, -0.10, 0.10, 0.13, R3D.col('#443a2f'), 8, 6);
            b.sphere(0.04, -0.20, -0.14, 0.12, R3D.col('#493d31'), 8, 6);
        },

        /**
         * The tram: a flat-bed truck on flanged wheels.
         *
         * Split from the cage, which it used to share a rig with — so the thing
         * ferrying you over a lava channel was drawn as a roofed cage on a
         * rope, hanging from nothing, sliding along the floor. A horizontal
         * lift and a vertical one are different machines and have to look it:
         * this one has wheels and a low side, and nothing above waist height so
         * it never hides what you are jumping onto.
         */
        tram: function (b) {
            const w = C.LIFT_W;

            /*
             * Dark iron, and it has to stay dark. The first pass used a mid
             * grey-brown with a pale highlight on every large face, which over a
             * lava channel — the brightest background in the game — read as a
             * white bathtub. The highlight is now a thin edge only, and what
             * lifts the underside is a warm bounce from the melt below rather
             * than a lighter base colour.
             */
            const iron = R3D.col('#2a2420');
            const ironLit = R3D.col('#453b33');
            const edge = R3D.col('#6d5c4c');
            const heat = R3D.col('#a8431a');
            const wheel = R3D.col('#1c1917');

            // Deck. Boarded rather than one plate, so the top face — the
            // largest thing on it, and the one facing the camera — is not a
            // single flat panel catching the light.
            b.box(0, 0, 0, w, 0.2, 0.9, iron, F.ALL, ironLit);
            const boards = 5;
            const bw = (w - 0.36) / boards;
            for (let i = 0; i < boards; i++) {
                b.box(-w / 2 + 0.18 + bw * (i + 0.5), 0.11, 0, bw - 0.05, 0.03, 0.74,
                      ironLit, F.SLAB);
            }
            // The underside takes a bounce off whatever it is crossing.
            b.box(0, -0.11, 0.08, w - 0.14, 0.05, 0.62, heat, F.SLAB);

            // Lips front and back, low enough to see over.
            b.box(0, 0.12, 0.42, w, 0.12, 0.07, ironLit, F.ALL, edge);
            b.box(0, 0.12, -0.42, w, 0.12, 0.07, iron, F.ALL, ironLit);
            // Side plates with rivets, capped by a thin worn edge.
            for (const sx of [-1, 1]) {
                b.box(sx * (w / 2 - 0.06), 0.1, 0, 0.12, 0.18, 0.86, iron, F.ALL, ironLit);
                b.box(sx * (w / 2 - 0.06), 0.2, 0, 0.13, 0.025, 0.86, edge, F.SLAB);
                for (let i = 0; i < 3; i++) {
                    b.sphere(sx * (w / 2 - 0.02), 0.11, -0.28 + i * 0.28, 0.032, edge, 6, 5);
                }
            }
            // Wheels, flanged, on stub axles.
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const wx = sx * (w / 2 - 0.5);
                    const wz = sz * 0.36;
                    b.cyl(wx, -0.17, wz, 0.18, 0.1, 'z', wheel, 12, R3D.col('#342e29'));
                    b.cyl(wx, -0.17, wz, 0.21, 0.03, 'z', ironLit, 12);
                    b.cyl(wx, -0.17, 0, 0.05, 0.72, 'z', R3D.col('#241f1c'), 6);
                }
            }
            // Coupling hooks at each end.
            for (const sx of [-1, 1]) {
                b.cyl(sx * (w / 2 + 0.08), -0.02, 0, 0.05, 0.2, 'x', ironLit, 6);
            }
        },

        /** The winding cage: a floor, four corner posts and a hanging rope. */
        lift: function (b) {
            const w = C.LIFT_W;
            const frame = R3D.col('#5d4c3c');
            const frameLit = R3D.col('#8a7256');
            b.box(0, 0, 0, w, 0.22, 0.9, R3D.col('#4a4038'), F.ALL, frameLit);
            b.box(0, 0.14, 0, w - 0.2, 0.08, 0.82, frameLit, F.ALL, frameLit);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    b.cyl(sx * (w / 2 - 0.14), 0.42, sz * 0.34, 0.055, 0.72, 'y', frame, 6);
                }
            }
            b.box(0, 0.78, 0, w - 0.24, 0.10, 0.8, frame, F.ALL, frameLit);
            b.cyl(0, 1.1, 0, 0.04, 0.55, 'y', R3D.col('#3a3a42'), 6);
        },
        /** A planted stick, fuse burning. */
        bomb: function (b) {
            for (const dx of [-0.11, 0.11]) {
                b.cyl(dx, 0, 0, 0.105, 0.5, 'y', R3D.col('#cf3b2a'), 10, R3D.col('#f0604a'));
            }
            b.cyl(0, 0.02, 0, 0.2, 0.12, 'y', R3D.col('#f2e3bd'), 12);
            b.cyl(0, 0.3, 0, 0.025, 0.16, 'y', R3D.col('#7a6038'), 6);
        }
    };

    /**
     * Pickups, rebuilt out of round primitives.
     *
     * Every one of these used to be a box, and it read as exactly that: a gold
     * box, a red box, a blue box. Silhouette is the whole of a pickup's job —
     * it has to be identifiable at a glance from across a room, at maybe twenty
     * pixels — and no amount of colour rescues the wrong shape.
     */
    const PICKUP_RIGS = {
        /** A bundle of sticks under a strap, with a fuse out of the top. */
        tnt: function (b) {
            const red = R3D.col('#cf3b2a');
            const redLight = R3D.col('#f0604a');
            for (const dx of [-0.13, 0, 0.13]) {
                b.cyl(dx, 0, 0, 0.115, 0.62, 'y', red, 10, redLight);
            }
            b.cyl(0, 0.06, 0, 0.24, 0.14, 'y', R3D.col('#f2e3bd'), 12);
            b.cyl(0, -0.1, 0, 0.245, 0.09, 'y', R3D.col('#6b4a28'), 12);
            // Fuse, curling up out of the middle stick.
            b.cyl(0, 0.36, 0, 0.028, 0.16, 'y', R3D.col('#7a6038'), 6);
            b.cyl(0.06, 0.45, 0, 0.028, 0.12, 'x', R3D.col('#7a6038'), 6);
        },
        /**
         * A struck coin, standing on its edge.
         *
         * Bigger than it was by half. These are the thing you cross a room for
         * and there are only a handful per deck, so a small dull disc reads as
         * litter — a collectible has to look worth the detour. Thick edge,
         * bright rim, and a stamped face that catches the light as it turns.
         */
        ore: function (b) {
            const gold = R3D.col('#f0bb26');
            const rim = R3D.col('#fff0a0');
            const cut = R3D.col('#9c6b0e');
            b.cyl(0, 0, 0, 0.28, 0.085, 'z', gold, 16, rim);
            for (const s of [1, -1]) {
                b.cyl(0, 0, s * 0.044, 0.215, 0.014, 'z', cut, 16);
                b.cyl(0, 0, s * 0.05, 0.115, 0.014, 'z', rim, 12);
            }
        },
        /** A tin billy-can with a lid. */
        food: function (b) {
            b.cyl(0, -0.02, 0, 0.19, 0.3, 'y', R3D.col('#b0784a'), 12, R3D.col('#caa06a'));
            b.cyl(0, 0.16, 0, 0.2, 0.05, 'y', R3D.col('#8fae5a'), 12);
            b.cyl(0, 0.22, 0, 0.05, 0.08, 'y', R3D.col('#6b4a28'), 8);
        },
        /** A helmet, since that is what a spare life is here. */
        heart: function (b) {
            b.cyl(0, 0.02, 0, 0.22, 0.2, 'y', R3D.col('#ffc233'), 12, R3D.col('#ffe08a'));
            b.cyl(0, -0.08, 0, 0.3, 0.05, 'y', R3D.col('#e8a521'), 14);
            b.box(0, 0.06, 0.2, 0.1, 0.08, 0.06, R3D.col('#fff6d0'));
        },
        /** A pressure bottle with a valve. */
        oxygen: function (b) {
            b.cyl(0, -0.02, 0, 0.155, 0.5, 'y', R3D.col('#3aa6c0'), 12, R3D.col('#63cfe4'));
            b.cyl(0, 0.26, 0, 0.06, 0.12, 'y', R3D.col('#b0b8c0'), 8);
            b.cyl(0, 0.32, 0, 0.11, 0.04, 'y', R3D.col('#d8dee4'), 10);
            b.cyl(0, 0.06, 0, 0.165, 0.05, 'y', R3D.col('#25798f'), 12);
        }
    };

    /* ------------------------------------------------------------------ *
     * Pools
     * ------------------------------------------------------------------ */

    function Pool(scene, rig, material, size) {
        this.items = [];
        this.rig = rig;
        this.scene = scene;
        this.material = material;
        // One geometry, shared by every instance. Flagged so `R3D.dispose`
        // leaves it alone when a room is torn down.
        const b = new R3D.Builder();
        rig(b);
        this.geometry = b.geometry();
        this.geometry.userData.shared = true;
        this.grow(size);
        this.cursor = 0;
    }

    Pool.prototype.grow = function (n) {
        for (let i = 0; i < n; i++) {
            const mesh = new THREE.Mesh(this.geometry, this.material);
            mesh.visible = false;
            this.scene.add(mesh);
            this.items.push(mesh);
        }
    };

    Pool.prototype.begin = function () {
        this.cursor = 0;
    };

    Pool.prototype.next = function () {
        if (this.cursor >= this.items.length) this.grow(8);
        const mesh = this.items[this.cursor++];
        mesh.visible = true;
        return mesh;
    };

    Pool.prototype.end = function () {
        for (let i = this.cursor; i < this.items.length; i++) this.items[i].visible = false;
    };

    /* ------------------------------------------------------------------ *
     * The set
     * ------------------------------------------------------------------ */

    Actors3D.create = function (scene) {
        const solid = R3D.actorMaterial();
        const glow = R3D.glowMaterial(0.9);
        solid.userData.shared = true;
        glow.userData.shared = true;

        const set = {
            group: new THREE.Group(),
            solid: solid,
            glow: glow,
            pools: {},
            tommy: null,
            t: 0
        };
        scene.add(set.group);

        set.tommy = buildTommy(solid, glow);
        set.group.add(set.tommy);
        set.dog = buildDog(solid);
        set.group.add(set.dog);

        for (const kind in RIGS) {
            const mat = (kind === 'orb') ? glow : solid;
            set.pools[kind] = new Pool(set.group, RIGS[kind], mat, 6);
        }
        /**
         * A rotten plank, drawn live rather than baked.
         *
         * Deliberately not the same shape as a sound board: grey, split into
         * three loose pieces with gaps between them, and no bright deck cap.
         * The player has to be able to tell at a glance which boards will hold,
         * and the whole point of the warning shake is lost if you cannot see it
         * coming *before* you step on.
         */
        set.pools.plank = new Pool(set.group, function (b) {
            const rot = R3D.col('#6a5f52');
            const rotLit = R3D.col('#8b7d6b');
            const dark = R3D.col('#2a231c');
            for (let i = 0; i < 3; i++) {
                const x = -0.33 + i * 0.33;
                b.box(x, 0.34, 0, 0.28, 0.16, 0.8, rot, F.ALL, rotLit);
                b.box(x, 0.34, 0.42, 0.28, 0.05, 0.04, dark, F.FRONT);
            }
            // Split ends, so the gaps read as damage rather than as a grille.
            b.box(-0.17, 0.34, 0.43, 0.03, 0.18, 0.04, dark, F.FRONT);
            b.box(0.17, 0.34, 0.43, 0.03, 0.18, 0.04, dark, F.FRONT);
        }, solid, 12);

        /** One tile of water surface, bobbed per tile by the sync pass. */
        set.pools.wave = new Pool(set.group, function (b) {
            b.plate(0, 0, 0, 1, 0.34, R3D.col('#ffffff'));
        }, R3D.haloMaterial('#7fc4ff', 0.5), 24);

        /** One tile of molten surface, and a bubble rising out of it. */
        set.pools.molten = new Pool(set.group, function (b) {
            b.plate(0, 0, 0, 1, 0.4, R3D.col('#ffffff'));
        }, R3D.haloMaterial('#ff9a3c', 0.8), 40);
        set.pools.bubble = new Pool(set.group, function (b) {
            b.sphere(0, 0, 0, 0.5, R3D.col('#ffd27a'), 8, 6);
        }, R3D.glowMaterial(0.85), 20);

        set.pools.warp = new Pool(set.group, function (b) {
            b.plate(0, 0, 0, 1, 1, R3D.col('#ffffff'));
        }, R3D.haloMaterial('#b78bff', 0.55), 6);
        for (const kind in PICKUP_RIGS) {
            set.pools['pickup_' + kind] = new Pool(set.group, PICKUP_RIGS[kind], solid, 8);
        }
        // Halos carry the soft dot rather than a flat quad. `tint` swaps in a
        // cached material per colour, all of which share the same texture.
        set.pools.glowSprite = new Pool(set.group, function (b) {
            b.plate(0, 0, 0, 1, 1, R3D.col('#ffffff'));
        }, R3D.haloMaterial('#ffffff', 0.5), 24);
        set.pools.jet = new Pool(set.group, function (b) {
            b.box(0, 0.5, 0, 0.7, 1, 0.5, R3D.col('#cfefff'));
        }, glow, 4);

        // A rising flood, as one unit-square slab scaled to the room. Two
        // pieces: the body, which is dark and opaque enough to read as depth,
        // and a bright surface line at the top, which is the bit the player is
        // actually watching.
        set.pools.floodBody = new Pool(set.group, function (b) {
            b.plate(0, 0.5, 0, 1, 1, R3D.col('#6a1c10'));
        }, R3D.flatMaterial(), 2);
        set.pools.floodLine = new Pool(set.group, function (b) {
            b.plate(0, 0, 0, 1, 1, R3D.col('#ffffff'));
        }, R3D.haloMaterial('#ff7a3c', 0.85), 2);

        return set;
    };

    /**
     * Place every actor for this frame.
     *
     * `alpha` is the interpolation between fixed steps. Positions come straight
     * from the simulation; nothing here decides where anything is.
     */
    Actors3D.sync = function (set, run, dt) {
        set.t += dt;
        const t = set.t;
        const ents = run.ents();
        const player = run.player;

        for (const k in set.pools) set.pools[k].begin();

        // Tommy.
        // `player.y` is the sole of his foot; the rig hangs 0.30 below its own
        // origin. See `TOMMY_FOOT`.
        set.tommy.position.set(
            R3D.wx(player.x),
            R3D.wy(player.y) + TOMMY_FOOT * TOMMY_SCALE,
            ACTOR_Z
        );
        poseTommy(set.tommy, player, t, dt, run.tntHeld);
        if (run.state === 'title') set.tommy.visible = false;

        // The dog, a touch behind Tommy in depth so he always wins an overlap.
        set.dog.position.set(R3D.wx(run.dog.x), R3D.wy(run.dog.y), ACTOR_Z - 0.15);
        poseDog(set.dog, run.dog, t, dt);
        set.dog.visible = run.state !== 'title';

        // Pickups.
        for (const p of ents.pickups) {
            if (p.taken) continue;
            const mesh = set.pools['pickup_' + p.kind].next();
            mesh.position.set(R3D.wx(p.x), R3D.wy(p.y) + 0.34, ACTOR_Z);
            // Coins spin edge-on so they flash as they turn; everything else
            // just rocks a little.
            mesh.rotation.y = p.kind === 'ore' ? t * 2.4 + p.phase : Math.sin(t + p.phase) * 0.25;

            if (p.spec.glow) {
                /*
                 * Two halos: a tight bright core and a wider soft one.
                 *
                 * A single halo has to choose between reading as *emissive*
                 * (tight and hot) and reading as *light in the room* (wide and
                 * soft), and at this scale one alone does neither. Stacking
                 * them is what makes a coin look lit from inside rather than
                 * painted yellow — and with the ambient now carrying real
                 * colour, collectables need the extra push to stay the
                 * brightest thing on screen.
                 */
                const hot = p.kind === 'tnt' ? '#ffb060'
                    : (p.kind === 'oxygen' ? '#8fe4f4'
                    : (p.kind === 'heart' ? '#ffd0e0' : '#fff0a0'));
                const warm = p.kind === 'tnt' ? '#ff7a2c'
                    : (p.kind === 'oxygen' ? '#3ab4d8'
                    : (p.kind === 'heart' ? '#ff6a94' : '#ffc41e'));

                const pulse = 0.9 + Math.sin(t * 3 + p.phase) * 0.1;
                const core = set.pools.glowSprite.next();
                core.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.1);
                core.scale.set(pulse * 0.72, pulse * 0.72, 1);
                tint(core, hot, 0.95);

                const bloom = set.pools.glowSprite.next();
                bloom.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.16);
                bloom.scale.set(pulse * 2.0, pulse * 2.0, 1);
                tint(bloom, warm, 0.34);
            }
        }

        // Patrols.
        for (const e of ents.enemies) {
            if (e.dead) continue;
            const mesh = set.pools[e.kind].next();
            const b = e.box();
            mesh.position.set(R3D.wx(b.x), R3D.wy(b.y), ACTOR_Z);
            mesh.rotation.y = e.dir >= 0 ? 0 : Math.PI;
            if (e.kind === 'bat') {
                mesh.rotation.z = Math.sin(t * 12) * 0.35;
            } else if (e.kind === 'spider') {
                // The silk, drawn from the ceiling anchor down to the body. It
                // is what makes a spider read as *dropping* rather than as a
                // thing that appeared: without it the drop looks like a bug.
                if (e.thread > 1) {
                    const silk = set.pools.thread.next();
                    const top = R3D.wy(e.homeY);
                    const len = e.thread / C.TILE;
                    silk.position.set(R3D.wx(e.x), top, ACTOR_Z - 0.05);
                    silk.scale.set(1, len, 1);
                }
                mesh.rotation.y = 0;
                mesh.scale.setScalar(e.state === 'hang' ? 1.1 : 1);
            } else if (e.kind === 'guardian') {
                mesh.rotation.y = Math.sin(t * 0.9) * 0.5;
                const halo = set.pools.glowSprite.next();
                halo.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.1);
                halo.scale.set(2.4, 2.4, 1);
                tint(halo, '#7fb0ff', 0.3);
            } else if (e.kind === 'dog') {
                // Braced before a charge: dips, and holds.
                mesh.position.y -= e.state === 'rouse' ? 0.06 : 0;
                if (e.state === 'charge') mesh.position.y += Math.abs(Math.sin(t * 18)) * 0.08;
            } else if (e.kind === 'orb') {
                const s = 1 + Math.sin(t * 7) * 0.12;
                mesh.scale.set(s, s, s);
                const halo = set.pools.glowSprite.next();
                halo.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.1);
                halo.scale.set(2.2, 2.2, 1);
                tint(halo, '#ff7a3c', 0.4);
            } else {
                mesh.position.y += Math.abs(Math.sin(t * 9)) * 0.05;
            }
        }

        // Machinery.
        for (const c of ents.crushers) {
            const mesh = set.pools.crusher.next();
            const shake = c.state === 'warn' ? Math.sin(t * 60) * 0.06 * c.shake : 0;
            mesh.position.set(R3D.wx(c.x) + shake, R3D.wy(c.y) - 0.45, ACTOR_Z - 0.1);
        }
        for (const bo of ents.boulders) {
            if (!bo.falling) continue;
            const mesh = set.pools.boulder.next();
            mesh.position.set(R3D.wx(bo.x), R3D.wy(bo.y), ACTOR_Z);
            mesh.rotation.z = -bo.y * 0.06;
        }
        for (const v of ents.vents) {
            if (v.height < 1) continue;
            const mesh = set.pools.jet.next();
            const h = v.height / C.TILE;
            mesh.position.set(R3D.wx(v.x), R3D.wy(v.baseY), ACTOR_Z - 0.1);
            mesh.scale.set(1 + Math.sin(t * 30) * 0.1, h, 1);
            tint(mesh, v.state === 'blast' ? '#dff2ff' : '#7fa8c0', 0.75);
        }
        for (const l of ents.lifts) {
            // A tram and a cage are different machines — see the `tram` rig.
            const mesh = set.pools[l.axis === 'h' ? 'tram' : 'lift'].next();
            mesh.position.set(R3D.wx(l.x) + C.LIFT_W / 2, R3D.wy(l.y) - 0.17, ACTOR_Z - 0.15);
            if (l.axis === 'h') {
                // Wheels turn with the distance travelled.
                mesh.rotation.z = 0;
                mesh.position.y += Math.sin(t * 9 + l.x * 0.2) * 0.012;   // track judder
            }
        }

        /*
         * The water surface, one plate per column, each on its own phase.
         *
         * Baked into the terrain it was a flat blue rectangle — the one thing
         * in a room that cannot survive being still. Offsetting each tile by
         * its own column gives a travelling wave for the cost of a sine.
         */
        /*
         * The phase step per column is small and the plates overlap their
         * neighbours, so the surface stays one continuous line that undulates.
         * A larger step made each tile crest independently and the surface
         * broke into a row of separate bright dashes — which, sitting along
         * the top of a sump, looked like exactly the banding the body of the
         * water had just been rid of.
         */
        for (const cell of ents.waterTops) {
            const wave = set.pools.wave.next();
            const bob = Math.sin(t * 2.1 + cell.tx * 0.28) * 0.045;
            wave.position.set(cell.tx + 0.5, C.ROWS - cell.ty - 0.06 + bob, ACTOR_Z - 0.25);
            wave.scale.set(1.08, 1 + Math.sin(t * 3.3 + cell.tx * 0.28) * 0.14, 1);
        }

        /*
         * The molten surface: a bright band that swells and slides, with
         * bubbles welling up through it.
         *
         * Baked geometry gave lava a straight edge, and a straight edge is the
         * one thing molten rock never has. Two sines out of phase per tile is
         * enough to keep the line moving, and a bubble every few tiles is what
         * makes it read as liquid rather than as a glowing stripe.
         */
        for (let i = 0; i < ents.lavaTops.length; i++) {
            const cell = ents.lavaTops[i];
            const bx = cell.tx + 0.5;
            const by = C.ROWS - cell.ty - 0.56;
            const phase = cell.tx * 0.8;

            const skin = set.pools.molten.next();
            skin.position.set(bx, by + Math.sin(t * 1.7 + phase) * 0.05, ACTOR_Z - 0.22);
            skin.scale.set(1, 0.8 + Math.sin(t * 2.9 + phase) * 0.34, 1);

            // A bubble on every third tile, on its own slow cycle.
            if (cell.tx % 3 === 0) {
                const k = (t * 0.5 + cell.tx * 0.37) % 1;
                const bub = set.pools.bubble.next();
                const s = Math.sin(k * Math.PI) * 0.22;
                bub.position.set(bx + Math.sin(phase) * 0.2, by + k * 0.5, ACTOR_Z - 0.2);
                bub.scale.setScalar(Math.max(0.01, s));
            }
        }

        /*
         * Rotten planks, and their tell.
         *
         * The simulation has always had a warning phase — `C.CRUMBLE_SHAKE`,
         * half a second between standing on a plank and it giving way — and it
         * was never drawn. The board just disappeared, which is why falling
         * through one had "no indication by looking at the platform". Here it
         * shudders harder the closer it gets, then drops and fades.
         */
        for (const cell of ents.crumbleTiles) {
            const state = ents.crumbleAt(cell.tx, cell.ty);
            const mesh = set.pools.plank.next();
            const bx = cell.tx + 0.5;
            const by = C.ROWS - cell.ty - 0.5;
            mesh.rotation.set(0, 0, 0);
            mesh.scale.set(1, 1, 1);

            if (!state) {
                mesh.position.set(bx, by, ACTOR_Z - 0.3);
            } else if (state.state === 'shake') {
                // Amplitude ramps with the timer, so the last moments are loud.
                const a = 0.04 + state.shake * 0.10;
                mesh.position.set(bx + Math.sin(t * 46) * a, by + Math.sin(t * 61) * a * 0.6,
                                  ACTOR_Z - 0.3);
                mesh.rotation.z = Math.sin(t * 53) * state.shake * 0.09;
            } else if (state.state === 'falling') {
                const k = 1 - Math.max(0, state.timer) / C.CRUMBLE_FALL;
                mesh.position.set(bx, by - k * k * 3.2, ACTOR_Z - 0.3);
                mesh.rotation.z = k * 1.5;
                mesh.scale.setScalar(1 - k * 0.4);
            } else {
                mesh.visible = false;   // gone, waiting to reform
            }
        }

        // Warp pads pulse, and pulse *together* — a pair that breathes in step
        // is how the player works out which two are joined without being told.
        for (const w of ents.warps) {
            const halo = set.pools.warp.next();
            const s = 1.4 + Math.sin(t * 2.6) * 0.25;
            halo.position.set(R3D.wx(w.x), R3D.wy(w.y) + 0.3, ACTOR_Z - 0.1);
            halo.scale.set(s, s * 0.7, 1);
        }
        if (ents.flood && ents.flood.level > 0.5) {
            const surface = R3D.wy(ents.flood.surfaceY());
            const body = set.pools.floodBody.next();
            body.position.set(C.COLS / 2, 0, ACTOR_Z - 0.2);
            body.scale.set(C.COLS, Math.max(0.01, surface), 1);

            const line = set.pools.floodLine.next();
            line.position.set(C.COLS / 2, surface, ACTOR_Z - 0.15);
            line.scale.set(C.COLS, 0.9 + Math.sin(t * 3.4) * 0.15, 1);
        }

        for (const bomb of run.bombs) {
            if (bomb.room !== run.roomIndex) continue;
            const mesh = set.pools.bomb.next();
            mesh.position.set(R3D.wx(bomb.x), R3D.wy(bomb.y) + 0.25, ACTOR_Z);
            const flash = 1 + Math.sin(t * 40) * 0.12;
            mesh.scale.set(flash, flash, flash);
            const halo = set.pools.glowSprite.next();
            halo.position.set(mesh.position.x, mesh.position.y + 0.4, ACTOR_Z - 0.1);
            const s = 0.5 + (1 - bomb.fuse / C.BLAST_FUSE) * 1.2;
            halo.scale.set(s, s, 1);
            tint(halo, '#ffd06a', 0.9);
        }

        for (const k in set.pools) set.pools[k].end();
    };

    /**
     * Recolour one pooled instance.
     *
     * The geometry is shared, so its vertex colours cannot be touched — that
     * would repaint every other user of the same buffer. `material.color`
     * multiplies instead, which is why every glow rig is authored white.
     */
    const _tintCache = new Map();
    function tint(mesh, hex, opacity) {
        const key = hex + '|' + (opacity === undefined ? 1 : opacity).toFixed(2);
        let mat = _tintCache.get(key);
        if (!mat) {
            mat = R3D.haloMaterial(R3D.col(hex), opacity === undefined ? 1 : opacity);
            _tintCache.set(key, mat);
        }
        // Keyed by opacity too: these are shared, so writing `opacity` on one
        // changes it for every other user of the same colour that frame.
        mesh.material = mat;
    }

    Actors3D.tint = tint;
    TNT.Actors3D = Actors3D;
})(window.TNT = window.TNT || {}, window.THREE);
