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
    /** Tommy is drawn a shade larger than his collision box. See `buildTommy`. */
    const TOMMY_SCALE = 1.12;

    /**
     * How far below the rig's origin his boots actually are.
     *
     * The rig is authored around the hips — the leg groups hang at y 0.14 and
     * the boot sits 0.44 below that — so its lowest point is 0.30 *under* the
     * origin. `player.y` is the sole of his foot, so placing the origin there
     * buried him nearly a third of a tile into whatever he was standing on,
     * which is why he looked like he was wading through the platform rather
     * than standing on it.
     *
     * Corrected at placement rather than by shifting a dozen numbers through
     * the rig, which would have to be kept in step every time a limb moves.
     * Scaled, because the group's scale applies to its children and not to its
     * own position.
     */
    const TOMMY_FOOT = 0.30;
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
     * The miner.
     *
     * Built as a small hierarchy so the walk cycle can swing the limbs, and
     * scaled in world units where one tile is one unit — he is `C.PLAYER_H`
     * pixels tall, which is a shade over a tile and a quarter.
     */
    /**
     * The miner.
     *
     * Rebuilt with a much stronger silhouette, because the first attempt was a
     * stack of same-sized boxes that vanished against a room full of boxes. The
     * things doing the work here are the ones a 2D platformer character always
     * relies on:
     *
     *   - **A big head and a small body.** Roughly a third of his height is
     *     helmet. That is what makes a 20-pixel character legible at all, and
     *     realistic proportions at this size read as a smudge.
     *   - **A hard colour break at the waist.** Bright coat over dark trousers,
     *     so the silhouette splits into two blocks the eye can track while he
     *     moves rather than one column.
     *   - **A rim of high-value trim** — the helmet, the lamp housing, the belt
     *     buckle — all near-white, so there is something on him brighter than
     *     anything in the room behind him.
     */
    function buildTommy(mat, glowMat) {
        const g = new THREE.Group();
        const skin = R3D.col('#e8b487');
        const coat = R3D.col('#3d8ec4');
        const coatDark = R3D.col('#2a6b99');
        const coatLight = R3D.col('#67b4e4');
        const trouser = R3D.col('#33384a');
        const boot = R3D.col('#1d1a17');
        const helmet = R3D.col('#ffc233');
        const helmetLight = R3D.col('#ffe08a');
        const strap = R3D.col('#8a6a3a');
        const hair = R3D.col('#c4441c');
        const hairLit = R3D.col('#e86a2c');

        /*
         * AUTHORED IN PROFILE, FACING +X.
         *
         * He used to face the camera, which meant you watched his front walking
         * right and his back walking left — and a character who turns his back
         * on you is a character you cannot read. Platformers are drawn in
         * profile for the same reason they always have been: the direction of
         * travel is the single most important thing on screen, and a silhouette
         * facing along it says so without any animation at all.
         *
         *   X  the way he faces — chest at +X, back at -X. This is the axis the
         *      camera sees, so the *profile* is the silhouette.
         *   Y  up.
         *   Z  shoulder width, into the screen. Barely seen; it only separates
         *      the near limb from the far one.
         *
         * `rotation.y` still flips between 0 and PI, so the turn code is
         * unchanged — it now flips him between facing right and facing left
         * rather than toward and away.
         */
        const body = part(function (b) {
            b.box(0.02, 0.36, 0, 0.38, 0.46, 0.44, coat, F.ALL, coatLight);
            // Chest, slightly proud at the front, and a back that isn't flat.
            b.box(0.14, 0.40, 0, 0.16, 0.30, 0.40, coatLight, F.ALL, coatLight);
            b.box(-0.16, 0.34, 0, 0.10, 0.36, 0.38, coatDark, F.ALL);
            // Shoulders.
            b.box(0.02, 0.56, 0, 0.42, 0.13, 0.48, coatLight, F.ALL, coatLight);
            // Belt, with the buckle on the near hip.
            b.box(0.02, 0.16, 0, 0.42, 0.11, 0.46, strap, F.ALL);
            b.box(0.20, 0.16, 0, 0.09, 0.12, 0.14, R3D.col('#ffe6a0'));
        }, mat);
        g.add(body);

        const head = new THREE.Group();
        head.position.y = 0.70;
        head.add(part(function (b) {
            b.box(0.01, 0.02, 0, 0.34, 0.36, 0.34, skin);
            // Nose at the front — the profile's whole read — and a red
            // moustache to match the hair below the helmet.
            b.box(0.19, 0.00, 0, 0.10, 0.10, 0.11, skin);
            b.box(0.17, -0.09, 0, 0.13, 0.06, 0.16, hair);
            // Red hair: sideburns, a fringe under the brim, and a tuft at the
            // nape. It has to sit *below* the helmet or none of it is seen.
            b.box(-0.16, 0.04, 0, 0.09, 0.24, 0.33, hair);
            b.box(-0.06, 0.12, 0, 0.30, 0.13, 0.36, hair);
            b.box(0.13, 0.10, 0, 0.15, 0.10, 0.30, hairLit);
            for (const sz of [1, -1]) {
                b.box(0.02, 0.03, sz * 0.16, 0.22, 0.16, 0.05, hair);
            }
            b.cone(-0.22, 0.02, 0, 0.08, 0.18, hairLit, false, 5);
            // Helmet: dome, with the brim jutting forward over the face.
            b.box(0.01, 0.26, 0, 0.40, 0.20, 0.42, helmet, F.ALL, helmetLight);
            b.box(0.01, 0.36, 0, 0.28, 0.10, 0.32, helmetLight, F.ALL, helmetLight);
            b.box(0.22, 0.19, 0, 0.20, 0.08, 0.40, helmet, F.ALL, helmetLight);
            // Lamp on the front of the brim, pointing the way he walks.
            b.box(0.26, 0.25, 0, 0.11, 0.13, 0.15, R3D.col('#4a4a52'), F.ALL);
            // One eye, on the side we can see.
            b.box(0.12, 0.05, 0.16, 0.06, 0.08, 0.03, R3D.col('#221a14'));
            // Ear, on the near side.
            b.box(-0.03, 0.01, 0.17, 0.08, 0.10, 0.03, skin);
        }, mat));
        head.add(part(function (b) {
            b.box(0.33, 0.25, 0, 0.05, 0.11, 0.13, R3D.col('#fff6d0'), F.ALL);
        }, glowMat));
        g.add(head);

        /*
         * Limbs are separated in **Z**, not X — near leg and far leg — and they
         * swing about **Z**, which in profile is the forward/back stride. The
         * far pair is darkened so the two do not merge into one shape when they
         * cross.
         */
        const legNear = new THREE.Group();
        legNear.position.set(0.01, 0.14, 0.12);
        legNear.add(part(function (b) {
            b.box(0, -0.18, 0, 0.19, 0.34, 0.19, trouser);
            b.box(0.05, -0.38, 0, 0.30, 0.12, 0.20, boot, F.ALL, R3D.col('#2e2823'));
        }, mat));
        const legFar = new THREE.Group();
        legFar.position.set(0.01, 0.14, -0.12);
        legFar.add(part(function (b) {
            b.box(0, -0.18, 0, 0.19, 0.34, 0.19, R3D.mixCol('#33384a', '#000000', 0.3));
            b.box(0.05, -0.38, 0, 0.30, 0.12, 0.20, R3D.mixCol('#1d1a17', '#000000', 0.3));
        }, mat));
        g.add(legNear, legFar);

        const armNear = new THREE.Group();
        armNear.position.set(0.02, 0.54, 0.22);
        armNear.add(part(function (b) {
            b.box(0, -0.16, 0, 0.15, 0.32, 0.16, coat, F.ALL, coatLight);
            b.box(0, -0.36, 0, 0.16, 0.12, 0.17, skin);
        }, mat));
        const armFar = new THREE.Group();
        armFar.position.set(0.02, 0.54, -0.22);
        armFar.add(part(function (b) {
            b.box(0, -0.16, 0, 0.15, 0.32, 0.16, R3D.mixCol('#3d8ec4', '#000000', 0.34));
            b.box(0, -0.36, 0, 0.16, 0.12, 0.17, R3D.mixCol('#e8b487', '#000000', 0.34));
        }, mat));
        g.add(armNear, armFar);

        g.userData = {
            head: head, body: body,
            legL: legNear, legR: legFar,
            armL: armNear, armR: armFar
        };
        // Slightly larger than life. He has to win against a room of boxes.
        g.scale.setScalar(TOMMY_SCALE);
        return g;
    }

    /**
     * Pose Tommy from his state.
     *
     * The stances read very differently and have to: with no jump, "climbing"
     * and "on a rope" are two of the four things you spend the game doing, and
     * if they look like standing the player cannot tell what they are holding.
     */
    function poseTommy(g, player, t, dt) {
        const u = g.userData;
        const pose = player.pose();
        const speed = Math.abs(player.vx);

        // Squash on landing, stretch while falling. Read from the simulation
        // rather than invented here, so it is always in step with the impact.
        // Multiplied over the rig's base scale, not assigned — assigning it
        // silently reset the size the rig was built at.
        const sq = player.squash;
        const k = TOMMY_SCALE;
        g.scale.set(k * (1 + sq * 0.3), k * (1 - sq * 0.28), k * (1 + sq * 0.15));

        /*
         * The stride is driven by *distance covered*, not by wall time.
         *
         * Running the cycle off `t` means the legs move at a fixed rate however
         * fast he is going, so he moonwalks when slow and skates when fast.
         * Advancing the phase by `vx · dt` locks the feet to the ground, which
         * is most of what makes a walk read as walking.
         */
        const step = dt || 1 / 60;
        if (u.stride === undefined) u.stride = 0;
        if (pose === 'run') u.stride += Math.abs(player.vx) * step * 0.085;
        else if (pose === 'climb') u.stride += Math.abs(player.vy) * step * 0.10;
        else if (pose === 'rope') u.stride += Math.abs(player.vx) * step * 0.08;

        let swing = 0;
        if (pose === 'run') swing = Math.sin(u.stride) * Util.clamp(speed / C.MOVE_MAX, 0.35, 1) * 1.05;
        else if (pose === 'climb') swing = Math.sin(u.stride) * 0.6;
        else if (pose === 'rope') swing = Math.sin(u.stride) * 0.45;

        // A stride bobs the body: twice a cycle, once per footfall.
        const bob = pose === 'run' ? Math.abs(Math.sin(u.stride)) * 0.045 : 0;
        u.body.position.y = bob;
        u.head.position.y = 0.70 + bob;

        /*
         * All swings are about **Z**. The rig is authored in profile facing +X,
         * so Z is the axis that carries a stride forward and back; rotating
         * about X — which is what this did when he faced the camera — now just
         * splays the limbs sideways into the screen.
         *
         * Positive Z swings a limb *backward*, so the near and far pairs take
         * opposite signs and cross at the middle of the cycle.
         */
        if (pose === 'climb') {
            // Reaching up the rungs, one hand over the other.
            u.armL.rotation.z = 2.4 + swing * 0.5;
            u.armR.rotation.z = 2.4 - swing * 0.5;
            u.legL.rotation.z = -0.25 + swing * 0.5;
            u.legR.rotation.z = -0.25 - swing * 0.5;
            u.head.rotation.z = -0.12;
        } else if (pose === 'rope') {
            // Hanging by both hands, legs loose beneath.
            u.armL.rotation.z = 2.85;
            u.armR.rotation.z = 2.85;
            u.legL.rotation.z = swing * 0.45;
            u.legR.rotation.z = -swing * 0.45;
            u.head.rotation.z = -0.1;
        } else if (pose === 'fall' || pose === 'rise') {
            // Arms up and trailing, legs tucked — reads at a glance as airborne.
            u.armL.rotation.z = 1.9;
            u.armR.rotation.z = 1.5;
            u.legL.rotation.z = -0.55;
            u.legR.rotation.z = 0.3;
            u.head.rotation.z = pose === 'rise' ? -0.12 : 0.12;
        } else if (pose === 'swim') {
            u.armL.rotation.z = 1.2 + Math.sin(t * 5) * 0.7;
            u.armR.rotation.z = 1.2 - Math.sin(t * 5) * 0.7;
            u.legL.rotation.z = Math.sin(t * 5) * 0.5;
            u.legR.rotation.z = -Math.sin(t * 5) * 0.5;
            u.head.rotation.z = -0.15;
        } else {
            u.armL.rotation.z = swing;
            u.armR.rotation.z = -swing;
            u.legL.rotation.z = -swing;
            u.legR.rotation.z = swing;
            u.head.rotation.z = 0;
        }

        /*
         * Turning.
         *
         * Damped as a **scalar** from -1 to 1 and only then converted to an
         * angle, rather than damping the angle itself. Damping the angle meant
         * every turn interpolated between 0 and PI, so a flip while the
         * previous one was still settling could resolve the long way round and
         * spin him through his own back — which is what "he turns backwards
         * sometimes" was. A scalar cannot wrap, so it cannot pick a direction.
         *
         * Fast, too: an eighth of a second, not a lazy swing. In a game about
         * changing direction on a narrow plank the turn has to keep up with the
         * input, and the real `dt` is used so it does not vary with framerate.
         */
        /*
         * He stays in profile at all times, including on a ladder. The rig is
         * authored facing +X, so this flips him between facing right and facing
         * left rather than toward and away from the camera.
         */
        const u2 = g.userData;
        if (u2.face === undefined) u2.face = 1;
        u2.face = Util.damp(u2.face, player.facing >= 0 ? 1 : -1, 30, dt || 1 / 60);
        g.rotation.y = (1 - u2.face) * 0.5 * Math.PI;

        // A run leans into its direction; a stop straightens up. In profile
        // that is a tilt about Z, and it is always forward because the whole
        // rig has already been turned to face the way he is going.
        const speedK = Util.clamp(Math.abs(player.vx) / C.MOVE_MAX, 0, 1);
        const lean = pose === 'run' ? speedK * 0.16 : 0;
        u2.lean = Util.damp(u2.lean || 0, lean, 12, dt || 1 / 60);
        u.body.rotation.z = -u2.lean;
        u.head.rotation.z += -u2.lean * 0.4;

        // Invulnerability blink, at twelve a second — fast enough to read as a
        // state and slow enough not to be a strobe.
        g.visible = !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0);
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
        /** A minecart bot: barrel body on wheels, with a stack. */
        walker: function (b) {
            const iron = R3D.col('#6d4b38');
            const trim = R3D.col('#9a7050');
            b.cyl(0, 0.02, 0, 0.30, 0.62, 'z', iron, 12, trim);
            b.cyl(0, 0.02, 0.16, 0.20, 0.06, 'z', R3D.col('#3a2a20'), 12);
            b.cyl(-0.26, -0.30, 0, 0.14, 0.44, 'z', R3D.col('#26262c'), 10, R3D.col('#44444e'));
            b.cyl(0.26, -0.30, 0, 0.14, 0.44, 'z', R3D.col('#26262c'), 10, R3D.col('#44444e'));
            b.cyl(0.1, 0.36, 0, 0.08, 0.26, 'y', R3D.col('#3a3a44'), 8);
            // A single lamp eye, off centre, so it has a front.
            b.sphere(0.16, 0.06, 0.2, 0.07, R3D.col('#ffd98a'), 8, 6);
        },
        /** A hunched grub: segmented shell, low and wide. */
        crawler: function (b) {
            const shell = R3D.col('#4a3556');
            const shellLit = R3D.col('#6b4d7d');
            for (let i = 0; i < 4; i++) {
                const x = -0.24 + i * 0.16;
                const r = 0.20 - Math.abs(i - 1.5) * 0.028;
                b.sphere(x, 0, 0, r, i % 2 ? shell : shellLit, 9, 6);
            }
            b.sphere(0.30, 0.02, 0, 0.16, shellLit, 9, 6);
            b.sphere(0.36, 0.06, 0.10, 0.045, R3D.col('#ffe066'), 6, 5);
            b.sphere(0.36, 0.06, -0.10, 0.045, R3D.col('#ffe066'), 6, 5);
            for (let i = 0; i < 3; i++) {
                const x = -0.2 + i * 0.2;
                b.cyl(x, -0.17, 0.14, 0.03, 0.2, 'y', R3D.col('#2a2030'), 5);
                b.cyl(x, -0.17, -0.14, 0.03, 0.2, 'y', R3D.col('#2a2030'), 5);
            }
        },

        /** Long, low and pointed — it says "this one comes at you". */
        dog: function (b) {
            const hide = R3D.col('#6b4530');
            const hideLit = R3D.col('#8d5f3f');
            b.cyl(0, 0, 0, 0.21, 0.66, 'x', hide, 10, hideLit);
            b.sphere(0.40, 0.08, 0, 0.19, hideLit, 10, 7);
            b.cyl(0.56, 0.02, 0, 0.09, 0.20, 'x', R3D.col('#33231a'), 8);
            b.sphere(0.66, 0.02, 0, 0.06, R3D.col('#1a1210'), 6, 5);
            b.sphere(0.44, 0.12, 0.10, 0.04, R3D.col('#ff8a5c'), 6, 5);
            b.sphere(0.44, 0.12, -0.10, 0.04, R3D.col('#ff8a5c'), 6, 5);
            b.cone(0.30, 0.26, 0.09, 0.07, 0.16, R3D.col('#40291d'), true, 6);
            b.cone(0.30, 0.26, -0.09, 0.07, 0.16, R3D.col('#40291d'), true, 6);
            b.cyl(-0.36, 0.20, 0, 0.045, 0.30, 'y', hide, 6);
            for (const x of [-0.2, 0.18]) {
                b.cyl(x, -0.24, 0.13, 0.05, 0.24, 'y', R3D.col('#40291d'), 6);
                b.cyl(x, -0.24, -0.13, 0.05, 0.24, 'y', R3D.col('#40291d'), 6);
            }
        },

        /** A bulb of a body with eight thin legs arching over it. */
        spider: function (b) {
            b.sphere(0, -0.02, 0, 0.19, R3D.col('#2a2038'), 10, 7);
            b.sphere(0.14, 0.04, 0, 0.11, R3D.col('#3c2d50'), 8, 6);
            b.sphere(0.19, 0.06, 0.06, 0.037, R3D.col('#ff5c4d'), 6, 5);
            b.sphere(0.19, 0.06, -0.06, 0.037, R3D.col('#ff5c4d'), 6, 5);
            b.sphere(0.21, 0.11, 0, 0.028, R3D.col('#ff8a72'), 6, 5);
            for (let i = 0; i < 4; i++) {
                const x = -0.16 + i * 0.11;
                for (const s of [1, -1]) {
                    b.cyl(x, 0.12, s * 0.14, 0.022, 0.26, 'z', R3D.col('#160f1e'), 5);
                    b.cyl(x, -0.02, s * 0.26, 0.022, 0.28, 'y', R3D.col('#160f1e'), 5);
                }
            }
        },

        /** A hovering lantern-thing. No legs: it goes through walls. */
        guardian: function (b) {
            b.sphere(0, 0, 0, 0.23, R3D.col('#33445f'), 12, 8);
            b.cyl(0, 0.22, 0, 0.09, 0.14, 'y', R3D.col('#5a7098'), 8);
            b.cyl(0, 0.30, 0, 0.05, 0.10, 'y', R3D.col('#8fb0d8'), 6);
            b.sphere(0, 0, 0.17, 0.10, R3D.col('#bfe4ff'), 9, 6);
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                b.cyl(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0, 0.028, 0.09, 'z',
                      R3D.col('#6d86ad'), 5);
            }
        },

        /** One unit of spider silk, scaled to length by the sync pass. */
        thread: function (b) {
            b.cyl(0, -0.5, 0, 0.018, 1, 'y', R3D.col('#9a9ab4'), 4);
        },

        /** Body, ears, and wings that are wide and thin. */
        bat: function (b) {
            const fur = R3D.col('#4a3856');
            b.sphere(0, 0, 0, 0.17, fur, 9, 6);
            b.cone(-0.09, 0.18, 0, 0.06, 0.16, R3D.col('#33253d'), true, 5);
            b.cone(0.09, 0.18, 0, 0.06, 0.16, R3D.col('#33253d'), true, 5);
            b.sphere(-0.06, 0.02, 0.13, 0.035, R3D.col('#ffd166'), 6, 5);
            b.sphere(0.06, 0.02, 0.13, 0.035, R3D.col('#ffd166'), 6, 5);
            for (const s of [-1, 1]) {
                b.box(s * 0.34, 0.06, 0, 0.42, 0.10, 0.20, R3D.col('#33253d'));
                b.box(s * 0.56, 0.00, 0, 0.22, 0.16, 0.16, R3D.col('#291d31'));
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
        const solid = R3D.solidMaterial();
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
        poseTommy(set.tommy, player, t, dt);
        if (run.state === 'title') set.tommy.visible = false;

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
                mesh.rotation.y = t * 0.7;
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
