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
    function buildTommy(mat, glowMat) {
        const g = new THREE.Group();
        const skin = R3D.col('#d9a273');
        const coat = R3D.col('#2f6f8f');
        const coatDark = R3D.col('#24576f');
        const trouser = R3D.col('#3a3a48');
        const boot = R3D.col('#241d18');
        const helmet = R3D.col('#e0a52c');

        const body = part(function (b) {
            b.box(0, 0.32, 0, 0.5, 0.52, 0.34, coat, F.ALL, coatDark);
            b.box(0, 0.16, 0.18, 0.3, 0.2, 0.05, coatDark, F.FRONT);
        }, mat);
        g.add(body);

        const head = new THREE.Group();
        head.position.y = 0.66;
        head.add(part(function (b) {
            b.box(0, 0, 0, 0.34, 0.3, 0.3, skin);
            b.box(0, 0.19, 0, 0.42, 0.16, 0.38, helmet);
            b.box(0, 0.13, 0.2, 0.44, 0.07, 0.14, helmet);
            b.box(-0.08, 0.02, 0.16, 0.05, 0.05, 0.02, R3D.col('#1a1a1a'), F.FRONT);
            b.box(0.08, 0.02, 0.16, 0.05, 0.05, 0.02, R3D.col('#1a1a1a'), F.FRONT);
        }, mat));
        // The lamp on the helmet. It is the light source the whole game is lit
        // by, so it also gets a visible lens rather than being invisible magic.
        head.add(part(function (b) {
            b.box(0, 0.17, 0.22, 0.14, 0.12, 0.06, R3D.col('#fff0c0'), F.ALL);
        }, glowMat));
        g.add(head);

        const legL = new THREE.Group();
        legL.position.set(-0.12, 0.08, 0);
        legL.add(part(function (b) {
            b.box(0, -0.16, 0, 0.18, 0.32, 0.2, trouser);
            b.box(0, -0.34, 0.03, 0.2, 0.1, 0.26, boot);
        }, mat));
        const legR = legL.clone();
        legR.position.x = 0.12;
        g.add(legL, legR);

        const armL = new THREE.Group();
        armL.position.set(-0.28, 0.52, 0);
        armL.add(part(function (b) {
            b.box(0, -0.16, 0, 0.14, 0.34, 0.16, coat);
            b.box(0, -0.36, 0, 0.15, 0.1, 0.17, skin);
        }, mat));
        const armR = armL.clone();
        armR.position.x = 0.28;
        g.add(armL, armR);

        g.userData = { head: head, legL: legL, legR: legR, armL: armL, armR: armR, body: body };
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
        const sq = player.squash;
        g.scale.set(1 + sq * 0.3, 1 - sq * 0.28, 1 + sq * 0.15);

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

    const PICKUP_RIGS = {
        tnt: function (b) {
            b.box(0, 0, 0, 0.46, 0.62, 0.4, R3D.col('#c0392b'), F.ALL, R3D.col('#e0503c'));
            b.box(0, 0, 0.21, 0.5, 0.16, 0.02, R3D.col('#f0e0c0'), F.FRONT);
            b.box(0.1, 0.4, 0, 0.06, 0.22, 0.06, R3D.col('#7a6038'));
        },
        ore: function (b) {
            b.box(0, 0, 0, 0.38, 0.34, 0.34, R3D.col('#d8b23a'), F.ALL, R3D.col('#f5da72'));
        },
        food: function (b) {
            b.box(0, 0, 0, 0.5, 0.3, 0.36, R3D.col('#b5763c'), F.ALL, R3D.col('#d99a56'));
            b.box(0, 0.16, 0, 0.4, 0.12, 0.3, R3D.col('#7fb04a'));
        },
        heart: function (b) {
            b.box(0, 0, 0, 0.44, 0.3, 0.3, R3D.col('#e04b6a'));
            b.box(-0.12, 0.18, 0, 0.22, 0.22, 0.3, R3D.col('#e04b6a'));
            b.box(0.12, 0.18, 0, 0.22, 0.22, 0.3, R3D.col('#e04b6a'));
        },
        oxygen: function (b) {
            b.box(0, 0, 0, 0.34, 0.62, 0.34, R3D.col('#3aa6c0'), F.ALL, R3D.col('#5cc8de'));
            b.box(0, 0.38, 0, 0.14, 0.16, 0.14, R3D.col('#b0b8c0'));
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
                const halo = set.pools.glowSprite.next();
                halo.position.set(mesh.position.x, mesh.position.y, ACTOR_Z - 0.12);
                const pulse = 1.5 + Math.sin(t * 3 + p.phase) * 0.2;
                halo.scale.set(pulse, pulse, 1);
                tint(halo, p.kind === 'tnt' ? '#ff8a3c' : (p.kind === 'oxygen' ? '#5cc8de' : '#ffd84a'), 0.35);
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
