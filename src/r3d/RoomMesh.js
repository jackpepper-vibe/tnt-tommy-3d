/**
 * TNT Tommy — room geometry.
 *
 * Turns a 42x24 tile grid into the two merged meshes a room is drawn with, plus
 * its decor and the list of light sources it wants.
 *
 * RUNS, NOT TILES
 * ---------------
 * Solid rock is emitted as horizontal *runs* rather than per tile: a wall
 * fourteen tiles long is one box. Interior faces are dropped as well — a block
 * with rock above it has no top face, and nothing has a back face because
 * nothing can see it. Between them these take a full room from roughly six
 * thousand triangles to a few hundred, which is the difference between the flip
 * between rooms being free and being visible.
 *
 * THE DEPTH BUDGET
 * ----------------
 * Everything lives in a thin slab so the perspective camera reads it as a
 * side-on platformer with volume, not as a diorama:
 *
 *      z = -1.5   back wall and parallax silhouettes
 *      z = -1.0   back of the rock
 *      z =  0.1   face of the rock
 *      z =  0.2   face of the timber, ladders, ropes
 *      z =  0.45  actors — Tommy, patrols, pickups
 *
 * Actors sit *in front of* the terrain rather than inside it, so nothing ever
 * clips into a wall it is standing beside.
 */
(function (TNT, THREE) {
    'use strict';

    const { C, Util, R3D, Tiles } = TNT;
    const T = C.Tile;
    const F = R3D.FACE;

    const ROCK_Z = -0.45, ROCK_D = 1.1;
    const TRIM_Z = -0.15, TRIM_D = 0.7;
    const RoomMesh = {};

    /* ------------------------------------------------------------------ *
     * Build
     * ------------------------------------------------------------------ */

    /**
     * @param {TNT.World.Room} room
     * @param {object} pal  a palette from `R3D.PALETTES`
     * @returns {{group: THREE.Group, lights: Array, glow: THREE.Mesh|null}}
     */
    /**
     * Three solid passes rather than one, split by *texture* — hewn rock, sawn
     * timber, and the untextured odds and ends. Colour still comes from the
     * vertex data, so the palettes are unaffected; the split exists only
     * because a plank and a wall do not have the same surface, and one merged
     * mesh can carry one map.
     *
     * Four draw calls a room instead of two. Worth it: an earlier pass had no
     * maps at all and read as flat coloured slabs.
     */
    RoomMesh.build = function (room, pal) {
        const group = new THREE.Group();
        const rock = new R3D.Builder();
        const wood = new R3D.Builder();
        const plain = new R3D.Builder();
        const glow = new R3D.Builder();
        const lights = [];
        const rng = Util.rng(0x7A11 + room.index * 2654435761);

        backdrop(group, pal, rng);
        rockRuns(room, rock, pal);
        trim(room, wood, plain, glow, pal, lights);
        decor(room, wood, rock, glow, pal, lights, rng);

        const add = function (builder, name, texture, order) {
            if (builder.isEmpty()) return;
            const mesh = new THREE.Mesh(builder.geometry(), R3D.solidMaterial(texture));
            mesh.name = name;
            if (order) mesh.renderOrder = order;
            group.add(mesh);
        };

        add(rock, 'rock', 'rock0');
        add(wood, 'timber', 'timber');
        add(plain, 'fittings', null);

        if (!glow.isEmpty()) {
            const mesh = new THREE.Mesh(glow.geometry(), R3D.glowMaterial(0.85));
            mesh.name = 'terrain-glow';
            mesh.renderOrder = 2;
            group.add(mesh);
        }

        return { group: group, lights: lights };
    };

    /* ------------------------------------------------------------------ *
     * Rock
     * ------------------------------------------------------------------ */

    function rockRuns(room, b, pal) {
        const rockCols = pal.rock.map(R3D.col);
        const topCol = R3D.col(pal.rockTop);
        const mossCol = R3D.col(pal.moss);
        const crackedCol = R3D.mixCol(pal.rock[0], '#000000', 0.35);

        for (let ty = 0; ty < C.ROWS; ty++) {
            let tx = 0;
            while (tx < C.COLS) {
                const t = room.get(tx, ty);
                if (t !== T.ROCK && t !== T.CRACKED) { tx++; continue; }

                let run = 1;
                while (tx + run < C.COLS && room.get(tx + run, ty) === t) run++;

                const lit = room.get(tx, ty - 1) !== T.ROCK && room.get(tx, ty - 1) !== T.CRACKED;
                const below = room.get(tx, ty + 1);
                const solidBelow = below === T.ROCK || below === T.CRACKED;

                let mask = F.FRONT;
                if (lit) mask |= F.TOP;
                if (!solidBelow) mask |= F.BOTTOM;
                if (!isRock(room, tx - 1, ty)) mask |= F.LEFT;
                if (!isRock(room, tx + run, ty)) mask |= F.RIGHT;

                const variant = rockCols[Util.tileHash(tx, ty) % rockCols.length];
                const face = t === T.CRACKED ? crackedCol : variant;

                b.box(tx + run / 2, R3D.tileY(ty), ROCK_Z, run, 1, ROCK_D,
                      face, mask, lit ? topCol : undefined);

                /*
                 * The capped top — the same silhouette the platforms use, and
                 * the reason a ledge of rock reads as a surface you can stand
                 * on rather than as the top edge of a coloured rectangle. The
                 * cap overhangs the face in Z, so the key light catches it and
                 * it throws its own shadow line.
                 */
                if (lit) {
                    const capY = R3D.tileY(ty) + 0.38;
                    b.box(tx + run / 2, capY, ROCK_Z + ROCK_D / 2 + 0.10,
                          run, 0.24, ROCK_D * 0.3, topCol, F.SLAB, topCol);
                    // Shadow under the overhang.
                    b.box(tx + run / 2, capY - 0.14, ROCK_Z + ROCK_D / 2 + 0.02,
                          run, 0.07, 0.04, R3D.mixCol(pal.rock[2], '#000000', 0.55), F.FRONT);
                    for (let i = 0; i < run; i++) {
                        if (Util.tileHash(tx + i, ty) % 4 !== 0) continue;
                        b.box(tx + i + 0.5, capY + 0.14, ROCK_Z + ROCK_D / 2 + 0.16,
                              0.86, 0.14, 0.06, mossCol, F.SLAB, mossCol);
                    }
                }

                // Fissured rock gets a visible seam, or the one tile in the mine
                // you are supposed to blow open looks exactly like the wall.
                if (t === T.CRACKED) {
                    for (let i = 0; i < run; i++) {
                        b.box(tx + i + 0.5, R3D.tileY(ty), ROCK_Z + ROCK_D / 2 + 0.02,
                              0.14, 0.86, 0.05, R3D.col('#101010'), F.FRONT);
                        b.box(tx + i + 0.72, R3D.tileY(ty) - 0.2, ROCK_Z + ROCK_D / 2 + 0.02,
                              0.1, 0.42, 0.05, R3D.col('#101010'), F.FRONT);
                    }
                }

                tx += run;
            }
        }
    }

    function isRock(room, tx, ty) {
        const t = room.get(tx, ty);
        return t === T.ROCK || t === T.CRACKED;
    }

    /* ------------------------------------------------------------------ *
     * Everything else in the grid
     * ------------------------------------------------------------------ */

    /**
     * @param {R3D.Builder} b  timber — boards, ladders, ropes, props
     * @param {R3D.Builder} p  untextured fittings — spikes, belts, machinery
     * @param {R3D.Builder} g  the additive glow pass
     */
    function trim(room, b, p, g, pal, lights) {
        const timber = R3D.col(pal.timber);
        const timberTop = R3D.col(pal.timberTop);
        const ladderCol = R3D.col(pal.ladder);
        const ropeCol = R3D.col(pal.rope);
        const spikeCol = R3D.col(pal.spike);
        const beltCol = R3D.col('#2e2e33');
        const beltTread = R3D.col('#4a4a52');
        const lavaCol = R3D.col(pal.lava);
        const waterCol = R3D.col(pal.water);
        const crumbleCol = R3D.mixCol(pal.timber, '#2a2018', 0.45);

        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                const t = room.get(tx, ty);
                if (t === T.EMPTY || t === T.ROCK || t === T.CRACKED) continue;

                const x = R3D.tileX(tx);
                const y = R3D.tileY(ty);

                switch (t) {
                    // Rotten planks are *not* baked into the terrain. They have
                    // to shake before they give way, and a merged buffer cannot
                    // animate one tile — `Actors3D` draws them from the live
                    // crumble state instead. Without this the plank simply
                    // vanished under you with no tell at all.
                    case T.CRUMBLE:
                        break;

                    case T.PLATFORM: {
                        /*
                         * A capped profile, not a slab.
                         *
                         * The platform art in every good 2D platformer is the
                         * same three parts: a bright deck, an overhanging lip
                         * that casts the deck forward, and a darker body
                         * hanging under it. That silhouette is what makes a
                         * ledge read instantly as *standable* from across the
                         * room. A single box — which is what this was — reads
                         * as a coloured bar and nothing else.
                         *
                         * Boards sit at the top of their tile because that is
                         * the surface the physics lands you on.
                         */
                        // Deck: proud of the body in Z and a touch wider.
                        b.box(x, y + 0.40, TRIM_Z + 0.12, 1, 0.18, TRIM_D + 0.22,
                              timberTop, F.SLAB, timberTop);
                        // Body: narrower, darker, hanging under the deck.
                        b.box(x, y + 0.20, TRIM_Z, 1, 0.24, TRIM_D, timber, F.SLAB);
                        // The shadow line where one meets the other.
                        b.box(x, y + 0.29, TRIM_Z + TRIM_D / 2 + 0.12, 1, 0.05, 0.04,
                              R3D.mixCol(pal.timber, '#000000', 0.6), F.FRONT);
                        if (Util.tileHash(tx, ty) % 3 === 0) {
                            // A bracket under the boards every few tiles.
                            b.box(x, y - 0.02, TRIM_Z, 0.18, 0.30, 0.26, timber, F.SLAB);
                        }
                        break;
                    }

                    case T.LADDER: {
                        // Round stiles with round rungs, and the rungs proud of
                        // the rails so the ladder has a front.
                        b.cyl(x - 0.30, y, TRIM_Z, 0.055, 1, 'y', ladderCol, 6);
                        b.cyl(x + 0.30, y, TRIM_Z, 0.055, 1, 'y', ladderCol, 6);
                        for (let r = 0; r < 3; r++) {
                            b.cyl(x, y - 0.33 + r * 0.33, TRIM_Z + 0.04, 0.045, 0.62, 'x',
                                  timberTop, 6);
                        }
                        break;
                    }

                    case T.VINE: {
                        // Hangs a little off-centre and knots, so a rope reads as
                        // a rope and not as a ladder that lost its rungs.
                        const wob = ((Util.tileHash(tx, ty) % 7) - 3) * 0.02;
                        b.cyl(x + wob, y, TRIM_Z, 0.06, 1, 'y', ropeCol, 6);
                        b.sphere(x + wob, y - 0.3, TRIM_Z, 0.1, ropeCol, 7, 5);
                        break;
                    }

                    case T.ROPE: {
                        b.cyl(x, y + 0.22, TRIM_Z, 0.05, 1, 'x', ropeCol, 6);
                        break;
                    }

                    case T.SPIKE: {
                        // Actual spikes: cones, alternating heights, on a rail.
                        p.box(x, y + 0.44, TRIM_Z, 1, 0.14, TRIM_D * 0.7,
                              R3D.mixCol(pal.spike, '#000000', 0.55), F.SLAB);
                        for (let i = 0; i < 3; i++) {
                            const sx = x - 0.28 + i * 0.28;
                            const h = i === 1 ? 0.62 : 0.5;
                            p.cone(sx, y + 0.36 - h / 2, TRIM_Z, 0.1, h, spikeCol, true, 6);
                        }
                        break;
                    }

                    case T.BELT_R:
                    case T.BELT_L: {
                        // Rollers under a band, with cleats across it.
                        p.box(x, y + 0.34, TRIM_Z, 1, 0.16, TRIM_D, beltCol, F.SLAB, beltTread);
                        p.cyl(x - 0.3, y + 0.20, TRIM_Z, 0.13, TRIM_D * 0.8, 'z',
                              R3D.col('#54545e'), 8, R3D.col('#787885'));
                        p.cyl(x + 0.3, y + 0.20, TRIM_Z, 0.13, TRIM_D * 0.8, 'z',
                              R3D.col('#54545e'), 8, R3D.col('#787885'));
                        p.box(x, y + 0.43, TRIM_Z + TRIM_D / 2 + 0.01, 0.28, 0.08, 0.05,
                              beltTread, F.SLAB);
                        break;
                    }

                    case T.VENT: {
                        // A grated pipe mouth set into the floor.
                        p.cyl(x, y + 0.36, TRIM_Z, 0.32, 0.22, 'y', R3D.col('#4a4a52'), 10,
                              R3D.col('#6b6b78'));
                        p.cyl(x, y + 0.46, TRIM_Z, 0.24, 0.05, 'y', R3D.col('#2a2a32'), 10);
                        for (let i = 0; i < 3; i++) {
                            p.box(x - 0.16 + i * 0.16, y + 0.48, TRIM_Z, 0.05, 0.04, 0.42,
                                  R3D.col('#8a8a96'), F.SLAB);
                        }
                        g.cyl(x, y + 0.47, TRIM_Z, 0.2, 0.03, 'y', R3D.col('#6fd3ff'), 10);
                        break;
                    }

                    case T.LAVA: {
                        /*
                         * Three layers, brightest last: a dark crust, the molten
                         * body, and a near-white line at the surface. Lava is
                         * the loudest thing in these rooms and it has to be — a
                         * single flat band read as an orange stripe, and a
                         * player has to know instantly that this one is not a
                         * hazard they can take a hit from.
                         */
                        p.box(x, y + 0.15, TRIM_Z, 1, 0.7, TRIM_D, R3D.col('#3d1108'), F.SLAB);
                        g.box(x, y + 0.16, TRIM_Z + 0.30, 1, 0.66, 0.03,
                              R3D.mixCol(pal.lava, '#000000', 0.45), F.FRONT);
                        g.box(x, y + 0.40, TRIM_Z + 0.32, 1, 0.26, 0.03, lavaCol, F.FRONT);
                        g.box(x, y + 0.47, TRIM_Z + 0.34, 1, 0.10, 0.03,
                              R3D.col('#fff0b0'), F.FRONT);
                        // The heat haze above it.
                        g.box(x, y + 0.85, TRIM_Z + 0.28, 1.4, 0.9, 0.02,
                              R3D.mixCol(pal.lava, '#000000', 0.78), F.FRONT);
                        if (tx % 3 === 0) {
                            lights.push({ x: x, y: y + 0.5, colour: pal.lava, energy: 1.5, range: 13, flicker: 0.35 });
                        }
                        break;
                    }

                    case T.WATER: {
                        const surface = room.get(tx, ty - 1) !== T.WATER;
                        g.box(x, y, TRIM_Z + 0.34, 1, 1, 0.02, R3D.mixCol(pal.water, '#000000', 0.55), F.FRONT);
                        if (surface) {
                            g.box(x, y + 0.44, TRIM_Z + 0.36, 1, 0.12, 0.02, waterCol, F.FRONT);
                        }
                        break;
                    }

                    case T.TRAMPOLINE: {
                        // Sprung canvas on a frame. Sits at the top of its tile
                        // like a platform, because that is the surface the
                        // physics bounces you off.
                        // Sprung canvas between two coiled springs.
                        p.box(x, y + 0.30, TRIM_Z, 1, 0.12, TRIM_D, R3D.col('#2f6f8f'), F.SLAB,
                              R3D.col('#57b0d4'));
                        for (const sx of [-0.38, 0.38]) {
                            for (let k = 0; k < 3; k++) {
                                p.cyl(x + sx, y + 0.04 + k * 0.09, TRIM_Z, 0.09, 0.05, 'y',
                                      R3D.col('#9aa4b0'), 8);
                            }
                        }
                        b.cyl(x, y - 0.16, TRIM_Z, 0.1, 0.9, 'x', timber, 6);
                        g.box(x, y + 0.37, TRIM_Z + TRIM_D / 2 + 0.02, 0.94, 0.06, 0.04,
                              R3D.col('#8fe0ff'), F.FRONT);
                        break;
                    }

                    case T.TELEPORT: {
                        // A ring set into the floor. Deliberately loud — a pad
                        // you do not notice is a route you never take.
                        // A ring set into the floor with a column of light in it.
                        p.cyl(x, y + 0.42, TRIM_Z, 0.42, 0.12, 'y', R3D.col('#3a2f52'), 12,
                              R3D.col('#5c4a7d'));
                        p.cyl(x, y + 0.46, TRIM_Z, 0.3, 0.06, 'y', R3D.col('#241c33'), 12);
                        g.cyl(x, y + 0.48, TRIM_Z, 0.34, 0.03, 'y', R3D.col('#c79bff'), 12);
                        g.cyl(x, y + 0.1, TRIM_Z, 0.24, 0.75, 'y',
                              R3D.col('#6f4fd0'), 10);
                        lights.push({ x: x, y: y + 0.3, colour: '#b78bff', energy: 0.8, range: 9, flicker: 0.25 });
                        break;
                    }

                    case T.DETONATOR: {
                        // A proper plunger: crate, brass shaft, T-handle.
                        b.box(x, y - 0.22, TRIM_Z, 0.74, 0.56, 0.56, R3D.col('#5a3a22'),
                              F.ALL, R3D.col('#7d5330'));
                        b.box(x, y + 0.06, TRIM_Z, 0.8, 0.08, 0.62, R3D.col('#3d2617'), F.SLAB);
                        p.cyl(x, y + 0.26, TRIM_Z, 0.06, 0.44, 'y', R3D.col('#c9a15e'), 8);
                        p.cyl(x, y + 0.46, TRIM_Z, 0.05, 0.56, 'x', R3D.col('#c0392b'), 8,
                              R3D.col('#e05a45'));
                        for (const sx of [-0.26, 0.26]) {
                            p.sphere(x + sx, y + 0.46, TRIM_Z, 0.07, R3D.col('#e05a45'), 7, 5);
                        }
                        g.cyl(x, y + 0.46, TRIM_Z, 0.09, 0.62, 'x', R3D.col('#ff6b4a'), 8);
                        lights.push({ x: x, y: y, colour: '#ff8a5c', energy: 1.3, range: 14, flicker: 0.12 });
                        break;
                    }

                    default:
                        break;
                }
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Backdrop and decor
     * ------------------------------------------------------------------ */

    /**
     * Two silhouette layers over a gradient.
     *
     * The camera does not move inside a room, so this is not parallax in the
     * scrolling sense — it is depth. The layers are offset per room from the
     * seeded RNG, so every room has its own skyline behind it and the flip
     * between two of them reads as travel rather than as a redraw.
     */
    /**
     * Three sheets at increasing depth, each sized so it still covers the frame
     * from where the camera sits. The far one has to be much bigger than the
     * room: under a perspective camera a plane nineteen units back subtends a
     * far smaller angle, and sizing them all alike leaves the corners empty.
     */
    function backdrop(group, pal, rng) {
        for (let layer = 0; layer < 3; layer++) {
            const z = R3D.BACKDROP_Z[layer];
            // Scale with distance from the play plane so each sheet fills the view.
            const spread = 1 + (Math.abs(z) - 5) * 0.055;
            const b = new R3D.Builder();
            b.plate(C.COLS / 2, C.ROWS / 2, z,
                    (C.COLS + 6) * spread, (C.ROWS + 4) * spread, R3D.col('#ffffff'));

            const mesh = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({
                map: R3D.backdropTexture(pal, layer),
                vertexColors: true,
                transparent: layer > 0,
                depthWrite: false
            }));
            mesh.name = 'backdrop' + layer;
            mesh.renderOrder = -3 + layer;
            group.add(mesh);
        }
        void rng;
    }

    /**
     * Lamps, beams, stalactites, crystals and mushrooms.
     *
     * Everything here is placed off the seeded RNG, so a room looks the same on
     * every load and a screenshot taken before a change can be compared with one
     * taken after it.
     */
    function decor(room, b, rock, g, pal, lights, rng) {
        const timber = R3D.col(pal.timber);
        const lampCol = R3D.col('#c9a15e');
        const crystalCols = pal.crystal.map(R3D.col);

        // Lamps, hung off anything with a ceiling in it.
        //
        // The scan starts at row 0. It used to start at row 1, which sounds
        // harmless and is not: in most of these rooms the only solid tiles are
        // the frame, so skipping the ceiling row meant no room ever found a
        // mounting point and every room was lit by Tommy's helmet alone.
        // Platform undersides count too — a working mine hangs lamps off the
        // staging, and it doubles the number of places one can go.
        let hung = 0;
        for (let attempt = 0; attempt < 140 && hung < 6; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = rng.int(0, C.ROWS - 6);
            const mount = room.get(tx, ty);
            if (!isRock(room, tx, ty) && mount !== T.PLATFORM) continue;
            if (room.get(tx, ty + 1) !== T.EMPTY || room.get(tx, ty + 2) !== T.EMPTY) continue;
            /*
             * A miner's lantern, not a glowing cube: a hook, a chain, a metal
             * cap, a glass body and a bright wick inside it. The lamps are the
             * most-repeated prop in the game — six a room, twenty-seven rooms —
             * so a box here was a box everywhere you looked.
             */
            const x = R3D.tileX(tx), y = R3D.tileY(ty) - 1.0;
            const z = TRIM_Z + 0.3;
            const metal = R3D.col('#4a4038');
            const brass = R3D.col('#c9a15e');

            b.cyl(x, y + 0.72, z, 0.035, 0.62, 'y', metal, 6);          // chain
            b.cyl(x, y + 0.36, z, 0.13, 0.10, 'y', brass, 10);           // cap
            b.cyl(x, y + 0.10, z, 0.155, 0.44, 'y', R3D.col('#e0b878'), 10);  // glass
            b.cyl(x, y - 0.16, z, 0.14, 0.09, 'y', brass, 10);           // base
            // Guard bars, so it reads as a lamp rather than a jar.
            for (const dx of [-0.13, 0.13]) {
                b.cyl(x + dx, y + 0.10, z, 0.022, 0.46, 'y', metal, 4);
            }
            // The wick, and the halo it throws on the rock behind.
            g.cyl(x, y + 0.08, z + 0.04, 0.07, 0.22, 'y', R3D.col('#fff3c8'), 8);
            g.box(x, y + 0.08, z + 0.1, 0.9, 0.9, 0.02, R3D.col(pal.lamp), F.FRONT);

            lights.push({ x: x, y: y + 0.1, colour: pal.lamp, energy: 1.25, range: 17, flicker: 0.2 });
            hung++;
        }

        // Pit props under long ceilings.
        let props = 0;
        for (let attempt = 0; attempt < 90 && props < 4; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            let ty = rng.int(2, C.ROWS - 4);
            if (room.get(tx, ty) !== T.EMPTY) continue;
            let top = ty;
            while (top > 0 && room.get(tx, top - 1) === T.EMPTY) top--;
            let bottom = ty;
            while (bottom < C.ROWS - 1 && room.get(tx, bottom + 1) === T.EMPTY) bottom++;
            const span = bottom - top + 1;
            if (span < 3 || span > 6) continue;
            const midY = (R3D.tileY(top) + R3D.tileY(bottom)) / 2;
            b.box(R3D.tileX(tx), midY, R3D.BACK_Z + 0.7, 0.3, span, 0.3, timber, F.SLAB);
            b.box(R3D.tileX(tx), midY + span / 2 - 0.15, R3D.BACK_Z + 0.7, 1.6, 0.3, 0.3, timber, F.SLAB);
            props++;
        }

        // Stalactites off solid ceilings.
        for (let attempt = 0, made = 0; attempt < 120 && made < 10; attempt++) {
            const tx = rng.int(1, C.COLS - 2);
            const ty = rng.int(0, C.ROWS - 10);
            if (!isRock(room, tx, ty) || room.get(tx, ty + 1) !== T.EMPTY) continue;
            const len = rng.range(0.4, 1.1);
            const x = R3D.tileX(tx) + rng.range(-0.2, 0.2);
            const y = R3D.tileY(ty) - 0.5 - len / 2;
            rock.box(x, y, R3D.BACK_Z + 0.9, 0.26, len, 0.26, R3D.col(pal.rock[2]), F.SLAB);
            made++;
        }

        /*
         * Crystal seams in the rock — the Godot build's signature.
         *
         * These are **scenery**, and they have to look like it. The first
         * version scattered them through open air at the same brightness as a
         * pickup, which asks the player a question the game then refuses to
         * answer: anything that glows in the middle of a room, at eye level,
         * reads as collectible. "What are the crystals for?" is the correct
         * response to that, and the answer was "nothing".
         *
         * So they now grow *out of the rock*: found by scanning for a solid
         * tile with air beside it, angled along the face, and pitched darker
         * than any pickup in the game. A seam in the wall is obviously part of
         * the wall.
         */
        const FACES_OUT = [[0, -1, 0, -0.5], [0, 1, 0, 0.5], [-1, 0, -0.5, 0], [1, 0, 0.5, 0]];
        for (let attempt = 0, made = 0; attempt < 260 && made < 11; attempt++) {
            const tx = rng.int(1, C.COLS - 2);
            const ty = rng.int(1, C.ROWS - 2);
            if (!isRock(room, tx, ty)) continue;

            // Which side of this block is exposed?
            const open = FACES_OUT.filter(function (f) {
                return room.get(tx + f[0], ty + f[1]) === T.EMPTY;
            });
            if (!open.length) continue;
            const face = rng.pick(open);

            const colour = rng.pick(crystalCols).clone().multiplyScalar(0.62);
            const s = rng.range(0.12, 0.2);
            const x = R3D.tileX(tx) + face[2] * 0.8 + rng.range(-0.2, 0.2);
            const y = R3D.tileY(ty) - face[3] * 0.8 + rng.range(-0.2, 0.2);
            const z = ROCK_Z + ROCK_D / 2 - 0.1;

            // A little cluster, leaning out of the face.
            for (let k = 0; k < 3; k++) {
                const ox = rng.range(-0.22, 0.22);
                const oy = rng.range(-0.18, 0.18);
                g.gem(x + ox, y + oy, z + rng.range(0, 0.25),
                      s * rng.range(0.6, 1), s * rng.range(1.6, 2.6), colour, 6);
            }
            g.box(x, y, z + 0.3, s * 3.2, s * 3.2, 0.02,
                  colour.clone().multiplyScalar(0.22), F.FRONT);
            made++;
        }

        /*
         * Everything below fills the open air, and it is there because the
         * rooms read as empty without it: platforms in a void, with nothing
         * between them and the back wall. The Godot build put chains, mushrooms
         * and hanging cable in the same gaps for the same reason. All of it is
         * behind the play plane and none of it collides.
         */

        // Hanging chains from solid ceilings.
        for (let attempt = 0, made = 0; attempt < 120 && made < 7; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = rng.int(0, C.ROWS - 12);
            if (!isRock(room, tx, ty) || room.get(tx, ty + 1) !== T.EMPTY) continue;
            const len = rng.range(1.2, 3.4);
            const x = R3D.tileX(tx);
            const top = R3D.tileY(ty) - 0.5;
            b.box(x, top - len / 2, R3D.BACK_Z + 0.75, 0.1, len, 0.1,
                  R3D.col('#3a3a42'), F.SLAB);
            b.box(x, top - len, R3D.BACK_Z + 0.75, 0.26, 0.22, 0.26,
                  R3D.col('#4a4a54'), F.SLAB);
            made++;
        }

        /*
         * Glowing mushrooms on ledges — the only cool light down at floor
         * level, which stops the lower half of a room going to mud.
         *
         * Built round, and *behind* the play plane. The first version was a
         * pale box on a stalk with a flat glowing rectangle behind it, which
         * from the front reads as a switch or a hammer mounted in a green
         * panel — an interactive-looking thing that does nothing. Scenery has
         * to be shaped like scenery; if it has a straight edge and a backlit
         * panel, players will try to use it.
         */
        for (let attempt = 0, made = 0; attempt < 150 && made < 9; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = rng.int(3, C.ROWS - 2);
            if (room.get(tx, ty) !== T.EMPTY) continue;
            if (!Tiles.isFloor(room.get(tx, ty + 1))) continue;

            const x = R3D.tileX(tx) + rng.range(-0.3, 0.3);
            const y = R3D.tileY(ty) - 0.44;
            const z = R3D.BACK_Z + 1.0;
            const cap = R3D.col('#4fbf9c');

            // Two or three of different heights, as they actually grow.
            for (let k = 0; k < rng.int(2, 3); k++) {
                const ox = rng.range(-0.26, 0.26);
                const h = rng.range(0.14, 0.26);
                const r = rng.range(0.07, 0.12);
                b.cyl(x + ox, y + h / 2, z, r * 0.42, h, 'y', R3D.col('#cfd9c6'), 6);
                b.cyl(x + ox, y + h, z, r, r * 0.8, 'y', cap, 8, cap);
                g.cyl(x + ox, y + h + 0.02, z + 0.02, r * 0.8, r * 0.5, 'y',
                      cap.clone().multiplyScalar(1.4), 8);
            }
            made++;
        }

        // Cut timbering on the back wall: the ribs of the working, receding.
        for (let x = 3; x < C.COLS - 3; x += rng.int(6, 10)) {
            const h = rng.range(5, 11);
            const y = rng.range(h / 2 + 1, C.ROWS - h / 2 - 1);
            b.box(x, y, R3D.BACK_Z + 0.5, 0.22, h, 0.22, R3D.col(pal.timber), F.SLAB);
            b.box(x, y + h / 2, R3D.BACK_Z + 0.5, 2.2, 0.24, 0.24,
                  R3D.col(pal.timber), F.SLAB);
        }
    }

    TNT.RoomMesh = RoomMesh;
})(window.TNT = window.TNT || {}, window.THREE);
