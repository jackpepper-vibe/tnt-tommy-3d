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

        const body = part(function (b) {
            b.box(0, 0.36, 0, 0.54, 0.46, 0.36, coat, F.ALL, coatLight);
            // Shoulders, so the torso is not a plain cuboid.
            b.box(0, 0.54, 0, 0.62, 0.14, 0.38, coatLight, F.ALL, coatLight);
            // Belt and buckle — the hard break at the waist.
            b.box(0, 0.16, 0, 0.58, 0.11, 0.38, strap, F.ALL);
            b.box(0, 0.16, 0.20, 0.13, 0.13, 0.04, R3D.col('#ffe6a0'), F.FRONT);
            b.box(0, 0.30, 0.19, 0.26, 0.14, 0.04, coatDark, F.FRONT);
        }, mat);
        g.add(body);

        const head = new THREE.Group();
        head.position.y = 0.70;
        head.add(part(function (b) {
            b.box(0, 0.02, 0, 0.40, 0.36, 0.34, skin);
            // Helmet: a dome with a brim that overhangs the face.
            b.box(0, 0.26, 0, 0.48, 0.20, 0.42, helmet, F.ALL, helmetLight);
            b.box(0, 0.36, 0, 0.34, 0.10, 0.30, helmetLight, F.ALL, helmetLight);
            b.box(0, 0.17, 0.24, 0.50, 0.08, 0.16, helmet, F.ALL, helmetLight);
            // Lamp housing on the brow.
            b.box(0, 0.24, 0.23, 0.17, 0.13, 0.10, R3D.col('#4a4a52'), F.ALL);
            // Eyes and a moustache — enough face to have a direction.
            b.box(-0.09, 0.04, 0.18, 0.06, 0.07, 0.02, R3D.col('#221a14'), F.FRONT);
            b.box(0.09, 0.04, 0.18, 0.06, 0.07, 0.02, R3D.col('#221a14'), F.FRONT);
            b.box(0, -0.08, 0.18, 0.22, 0.06, 0.02, R3D.col('#6b4a28'), F.FRONT);
        }, mat));
        head.add(part(function (b) {
            b.box(0, 0.24, 0.30, 0.13, 0.10, 0.05, R3D.col('#fff6d0'), F.ALL);
        }, glowMat));
        g.add(head);

        const legL = new THREE.Group();
        legL.position.set(-0.14, 0.14, 0);
        legL.add(part(function (b) {
            b.box(0, -0.18, 0, 0.20, 0.34, 0.22, trouser);
            b.box(0, -0.38, 0.04, 0.23, 0.12, 0.30, boot, F.ALL, R3D.col('#2e2823'));
        }, mat));
        const legR = legL.clone();
        legR.position.x = 0.14;
        g.add(legL, legR);

        const armL = new THREE.Group();
        armL.position.set(-0.32, 0.54, 0);
        armL.add(part(function (b) {
            b.box(0, -0.16, 0, 0.15, 0.32, 0.17, coat, F.ALL, coatLight);
            b.box(0, -0.36, 0, 0.17, 0.12, 0.19, skin);
        }, mat));
        const armR = armL.clone();
        armR.position.x = 0.32;
        g.add(armL, armR);

        g.userData = { head: head, legL: legL, legR: legR, armL: armL, armR: armR, body: body };
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
    function poseTommy(g, player, t) {
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

        let swing = 0;
        if (pose === 'run') swing = Math.sin(t * 13) * Util.clamp(speed / C.MOVE_MAX, 0, 1) * 0.9;
        else if (pose === 'climb') swing = Math.sin(t * 8) * 0.55;
        else if (pose === 'rope') swing = Math.sin(t * 6) * 0.4;

        if (pose === 'climb') {
            // Facing the ladder, hands above the head.
            g.rotation.y = 0;
            u.armL.rotation.x = -2.5 + swing;
            u.armR.rotation.x = -2.5 - swing;
            u.legL.rotation.x = 0.3 - swing * 0.6;
            u.legR.rotation.x = 0.3 + swing * 0.6;
            u.head.rotation.x = -0.15;
        } else if (pose === 'rope') {
            // Hanging by both hands, legs loose.
            u.armL.rotation.x = -2.9;
            u.armR.rotation.x = -2.9;
            u.legL.rotation.x = swing * 0.5;
            u.legR.rotation.x = -swing * 0.5;
            u.head.rotation.x = -0.25;
        } else if (pose === 'fall' || pose === 'rise') {
            u.armL.rotation.x = -1.6;
            u.armR.rotation.x = -1.4;
            u.legL.rotation.x = 0.5;
            u.legR.rotation.x = -0.2;
            u.head.rotation.x = 0.1;
        } else if (pose === 'swim') {
            u.armL.rotation.x = -1.2 + Math.sin(t * 5) * 0.6;
            u.armR.rotation.x = -1.2 - Math.sin(t * 5) * 0.6;
            u.legL.rotation.x = Math.sin(t * 5) * 0.5;
            u.legR.rotation.x = -Math.sin(t * 5) * 0.5;
            u.head.rotation.x = -0.2;
        } else {
            u.armL.rotation.x = swing;
            u.armR.rotation.x = -swing;
            u.legL.rotation.x = -swing;
            u.legR.rotation.x = swing;
            u.head.rotation.x = 0;
        }

        // Turning: the whole rig yaws, except on a ladder where he faces in.
        if (pose !== 'climb') {
            const want = player.facing >= 0 ? 0 : Math.PI;
            g.rotation.y = Util.damp(g.rotation.y, want, 22, 1 / 60);
        }

        // Invulnerability blink, at twelve a second — fast enough to read as a
        // state and slow enough not to be a strobe.
        g.visible = !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0);
    }

    /* ------------------------------------------------------------------ *
     * Rigs
     * ------------------------------------------------------------------ */

    const RIGS = {
        walker: function (b) {
            b.box(0, 0, 0, 0.72, 0.6, 0.5, R3D.col('#6a4a3a'), F.ALL, R3D.col('#8a6248'));
            b.box(-0.3, -0.34, 0, 0.16, 0.16, 0.4, R3D.col('#2a2a30'));
            b.box(0.3, -0.34, 0, 0.16, 0.16, 0.4, R3D.col('#2a2a30'));
            b.box(0, 0.36, 0, 0.5, 0.14, 0.4, R3D.col('#3a3a44'));
        },
        crawler: function (b) {
            b.box(0, 0, 0, 0.6, 0.4, 0.44, R3D.col('#3a2d44'), F.ALL, R3D.col('#54406a'));
            for (let i = 0; i < 3; i++) {
                const x = -0.34 + i * 0.34;
                b.box(x, -0.24, 0.18, 0.08, 0.3, 0.08, R3D.col('#2a2030'));
                b.box(x, -0.24, -0.18, 0.08, 0.3, 0.08, R3D.col('#2a2030'));
            }
        },
        dog: function (b) {
            // Long and low, and pointed — the silhouette has to say "this one
            // moves toward you" before it does.
            b.box(0, 0, 0, 0.8, 0.4, 0.42, R3D.col('#5a3b2a'), F.ALL, R3D.col('#7a5238'));
            b.box(0.42, 0.1, 0, 0.34, 0.3, 0.34, R3D.col('#6a4632'));
            b.box(0.62, 0.04, 0, 0.16, 0.16, 0.2, R3D.col('#2a1c14'));
            b.box(0.34, 0.3, 0.1, 0.1, 0.18, 0.06, R3D.col('#3d2a1e'));
            b.box(0.34, 0.3, -0.1, 0.1, 0.18, 0.06, R3D.col('#3d2a1e'));
            b.box(-0.44, 0.14, 0, 0.24, 0.1, 0.1, R3D.col('#4a3122'));
            for (const x of [-0.26, 0.22]) {
                b.box(x, -0.28, 0.16, 0.11, 0.24, 0.11, R3D.col('#3d2a1e'));
                b.box(x, -0.28, -0.16, 0.11, 0.24, 0.11, R3D.col('#3d2a1e'));
            }
        },
        spider: function (b) {
            b.box(0, 0, 0, 0.4, 0.34, 0.4, R3D.col('#241c2e'), F.ALL, R3D.col('#3a2c4a'));
            b.box(0.06, 0.06, 0.2, 0.08, 0.08, 0.04, R3D.col('#ff5c4d'), F.FRONT);
            b.box(-0.06, 0.06, 0.2, 0.08, 0.08, 0.04, R3D.col('#ff5c4d'), F.FRONT);
            for (let i = 0; i < 4; i++) {
                const a = -0.34 + i * 0.22;
                b.box(a, 0.1, 0.26, 0.05, 0.34, 0.05, R3D.col('#1a1422'));
                b.box(a, 0.1, -0.26, 0.05, 0.34, 0.05, R3D.col('#1a1422'));
            }
        },
        guardian: function (b) {
            // A floating lantern-thing. No legs on purpose: it goes through
            // walls, and anything with legs reads as something that should not.
            b.box(0, 0, 0, 0.44, 0.44, 0.44, R3D.col('#2c3a52'), F.ALL, R3D.col('#44587a'));
            b.box(0, 0.3, 0, 0.2, 0.16, 0.2, R3D.col('#5a7098'));
            b.box(0, 0, 0.24, 0.22, 0.22, 0.04, R3D.col('#9fd0ff'), F.FRONT);
        },
        thread: function (b) {
            // One unit of spider silk, scaled to length by the sync pass.
            b.box(0, -0.5, 0, 0.045, 1, 0.045, R3D.col('#8f8fa8'));
        },
        bat: function (b) {
            b.box(0, 0, 0, 0.34, 0.34, 0.32, R3D.col('#42324a'));
            b.box(-0.46, 0.06, 0, 0.6, 0.16, 0.22, R3D.col('#2e2436'));
            b.box(0.46, 0.06, 0, 0.6, 0.16, 0.22, R3D.col('#2e2436'));
        },
        orb: function (b) {
            b.box(0, 0, 0, 0.44, 0.44, 0.44, R3D.col('#ff7a3c'));
        },
        crusher: function (b) {
            b.box(0, 0, 0, 1.8, 0.9, 0.8, R3D.col('#4a4a54'), F.ALL, R3D.col('#6a6a78'));
            b.box(0, -0.48, 0, 1.9, 0.16, 0.9, R3D.col('#2a2a32'));
            for (let i = 0; i < 4; i++) {
                b.box(-0.66 + i * 0.44, -0.56, 0, 0.16, 0.16, 0.6, R3D.col('#8a8a96'));
            }
        },
        boulder: function (b) {
            b.box(0, 0, 0, 0.7, 0.7, 0.7, R3D.col('#4a3f34'), F.ALL, R3D.col('#5f5040'));
            b.box(0.2, 0.2, 0.2, 0.3, 0.3, 0.3, R3D.col('#3d332a'));
        },
        lift: function (b) {
            const w = C.LIFT_W;
            b.box(0, 0, 0, w, 0.34, 0.9, R3D.col('#4a4038'), F.ALL, R3D.col('#7a6650'));
            b.box(-w / 2 + 0.12, 0.34, 0, 0.16, 0.4, 0.8, R3D.col('#2f2a24'));
            b.box(w / 2 - 0.12, 0.34, 0, 0.16, 0.4, 0.8, R3D.col('#2f2a24'));
        },
        bomb: function (b) {
            b.box(0, 0, 0, 0.44, 0.5, 0.4, R3D.col('#b03a2e'), F.ALL, R3D.col('#d4503c'));
            b.box(0, 0.32, 0, 0.08, 0.2, 0.08, R3D.col('#6a5030'));
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
        /** A struck coin, standing on its edge. */
        ore: function (b) {
            const gold = R3D.col('#e8b62c');
            const rim = R3D.col('#fce98a');
            b.cyl(0, 0, 0, 0.19, 0.06, 'z', gold, 14, rim);
            // Raised rim and a face mark, so it catches the light as it spins.
            b.cyl(0, 0, 0.031, 0.135, 0.012, 'z', R3D.col('#a87615'), 14);
            b.cyl(0, 0, -0.031, 0.135, 0.012, 'z', R3D.col('#a87615'), 14);
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
        set.tommy.position.set(R3D.wx(player.x), R3D.wy(player.y), ACTOR_Z);
        poseTommy(set.tommy, player, t);
        if (run.state === 'title') set.tommy.visible = false;

        // Pickups.
        for (const p of ents.pickups) {
            if (p.taken) continue;
            const mesh = set.pools['pickup_' + p.kind].next();
            mesh.position.set(R3D.wx(p.x), R3D.wy(p.y) + 0.34, ACTOR_Z);
            mesh.rotation.y = p.kind === 'ore' ? t * 1.6 + p.phase : Math.sin(t + p.phase) * 0.25;

            if (p.spec.glow) {
                // Tight and bright. A wide faint halo does not read as glow at
                // this scale — it reads as a dirty lens, and there are a dozen
                // of them on screen at once.
                const halo = set.pools.glowSprite.next();
                halo.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.12);
                const pulse = 0.95 + Math.sin(t * 3 + p.phase) * 0.12;
                halo.scale.set(pulse, pulse, 1);
                tint(halo, p.kind === 'tnt' ? '#ff8a3c' : (p.kind === 'oxygen' ? '#5cc8de' : '#ffd84a'), 0.75);
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
            const mesh = set.pools.lift.next();
            mesh.position.set(R3D.wx(l.x) + C.LIFT_W / 2, R3D.wy(l.y) - 0.17, ACTOR_Z - 0.15);
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
