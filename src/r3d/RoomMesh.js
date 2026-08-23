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
        /** Multiplied down onto the backdrop — contact shadows, not light. */
        const shade = new R3D.Builder();
        /** Tinted and transparent: water, which darkens what shows through it. */
        const liquid = new R3D.Builder();
        const lights = [];
        const rng = Util.rng(0x7A11 + room.index * 2654435761);

        backdrop(group, pal, rng);
        rockRuns(room, rock, glow, pal);
        tankShell(room, plain);
        trim(room, wood, plain, glow, shade, liquid, pal, lights);
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

        heatHaze(room, group, pal);

        if (!shade.isEmpty()) {
            // Contact shadows: multiplied down onto whatever is behind them,
            // so they darken the backdrop rather than adding a grey rectangle
            // to it. Drawn before the glow pass and after the solids.
            const mesh = new THREE.Mesh(shade.geometry(), new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.5,
                blending: THREE.MultiplyBlending,
                depthWrite: false
            }));
            mesh.name = 'contact';
            mesh.renderOrder = 1;
            group.add(mesh);
        }

        if (!liquid.isEmpty()) {
            // Ordinary alpha, not additive: water has to take light *out* of
            // what shows through it. Drawn after the solids so the rock behind
            // is already there to be tinted, and before the glow so a surface
            // highlight still reads on top of it.
            const mesh = new THREE.Mesh(liquid.geometry(), new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.62,
                depthWrite: false
            }));
            mesh.name = 'water';
            mesh.renderOrder = 2;
            group.add(mesh);
        }

        if (!glow.isEmpty()) {
            const mesh = new THREE.Mesh(glow.geometry(), R3D.glowMaterial(0.85));
            mesh.name = 'terrain-glow';
            mesh.renderOrder = 3;
            group.add(mesh);
        }

        return { group: group, lights: lights };
    };

    /* ------------------------------------------------------------------ *
     * The tank
     * ------------------------------------------------------------------ */

    /**
     * The vessel the water is standing in.
     *
     * Water on its own is a tinted rectangle with nothing holding it, so
     * however good the tint is it reads as a pane laid over the room rather
     * than as a body of water in something. What sells a holding tank is the
     * *container*: a riveted liner up the sides, a plate across the bottom, and
     * a lip at the top where the wall stops and the air begins.
     *
     * Emitted from the water's own boundary rather than authored per room, so
     * any sump anywhere gets its shell for free and the two can never disagree
     * about where the edge is. It sits behind the water plate and in front of
     * the rock, which — now that the water is transparent — means you see the
     * far wall of the tank *through* the water. That is most of the depth.
     */
    function tankShell(room, p) {
        const TANK_Z = ROCK_Z + ROCK_D / 2 - 0.06;      // just proud of the rock face
        const TANK_D = 0.55;
        const iron = R3D.col('#544a3c');
        const ironLit = R3D.col('#7f6e58');
        const rivet = R3D.col('#a8947a');
        const rust = R3D.col('#7a4520');

        const isWater = function (tx, ty) { return room.get(tx, ty) === T.WATER; };

        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                if (!isWater(tx, ty)) continue;
                const x = R3D.tileX(tx);
                const y = R3D.tileY(ty);
                const top = !isWater(tx, ty - 1);

                // Liner up each side that has something solid behind it.
                for (const dir of [-1, 1]) {
                    if (!Tiles.isSolid(room.get(tx + dir, ty))) continue;
                    p.box(x + dir * 0.42, y, TANK_Z, 0.2, 1, TANK_D, iron, F.ALL, ironLit);

                    // Strakes every third row, riveted — the horizontal banding
                    // is what reads as plate at a distance.
                    if (ty % 3 === 0) {
                        p.box(x + dir * 0.4, y + 0.36, TANK_Z + 0.03, 0.26, 0.15, TANK_D,
                              ironLit, F.ALL, rivet);
                        for (let k = 0; k < 2; k++) {
                            p.sphere(x + dir * 0.33, y + 0.36, -0.16 + k * 0.32, 0.045,
                                     rivet, 6, 5);
                        }
                    }
                    // A rust weep below the waterline.
                    if (!top && ty % 4 === 2) {
                        p.box(x + dir * 0.34, y, TANK_Z + 0.06, 0.06, 0.7, 0.05, rust, F.FRONT);
                    }

                    /*
                     * FREEBOARD, AND THE RIM ON TOP OF IT.
                     *
                     * The single thing that turns a filled rectangle into a
                     * vessel. The wall used to stop level with the surface, so
                     * there was nothing holding the water — it met the air at a
                     * bare edge. The shell now carries a row above the
                     * waterline and caps it with a lip that overhangs inward,
                     * which is the silhouette of every tank ever built.
                     */
                    if (top) {
                        p.box(x + dir * 0.42, y + 1.0, TANK_Z, 0.2, 1, TANK_D, iron,
                              F.ALL, ironLit);
                        p.box(x + dir * 0.36, y + 1.46, TANK_Z + 0.06, 0.42, 0.2,
                              TANK_D + 0.2, ironLit, F.ALL, rivet);
                        for (let k = 0; k < 2; k++) {
                            p.sphere(x + dir * 0.3, y + 1.14, -0.18 + k * 0.36, 0.045,
                                     rivet, 6, 5);
                        }
                    }
                }

                /*
                 * Cross-ties every fifth row, spanning the body behind the
                 * water. A tank this wide would burst without them, and seeing
                 * them *through* the water is most of what gives it depth.
                 */
                if (ty % 5 === 1 && isWater(tx - 1, ty) && isWater(tx + 1, ty)) {
                    p.box(x, y + 0.2, TANK_Z - 0.05, 1, 0.1, 0.16, iron, F.ALL, ironLit);
                }

                // The plate across the bottom.
                if (Tiles.isFloor(room.get(tx, ty + 1))) {
                    p.box(x, y - 0.42, TANK_Z, 1, 0.17, TANK_D, iron, F.SLAB, ironLit);
                    if (tx % 3 === 0) {
                        p.sphere(x, y - 0.34, 0.0, 0.045, rivet, 6, 5);
                    }
                }
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Heat
     * ------------------------------------------------------------------ */

    /**
     * The air over a lava channel, as one soft plate per horizontal run.
     *
     * Emitted per *run* and not per tile on purpose. Per tile it was an additive
     * quad wider than the tile it belonged to, so neighbours overlapped and the
     * overlaps added — a channel came out banded like a barcode. One plate over
     * the whole run, carrying a falloff that reaches zero at every edge, has no
     * seams in it at all.
     */
    function heatHaze(room, group, pal) {
        const tint = R3D.mixCol(pal.lava, '#ffb45a', 0.35);

        for (let ty = 0; ty < C.ROWS; ty++) {
            let tx = 0;
            while (tx < C.COLS) {
                if (room.get(tx, ty) !== T.LAVA) { tx++; continue; }

                // A run of lava, and only its *exposed* top edge gives off heat.
                const start = tx;
                let run = 0;
                while (tx + run < C.COLS && room.get(tx + run, ty) === T.LAVA) run++;
                tx = start + run;
                if (room.get(start, ty - 1) === T.LAVA) continue;

                const width = run + 2.6;
                const height = 3.2;
                const geo = new THREE.PlaneGeometry(width, height);
                // Molten rock throws far more light than it did. The channel is
                // meant to be the brightest thing in the room, and glow off the
                // surface does more for that than any amount of surface detail.
                const mesh = new THREE.Mesh(geo, R3D.hazeMaterial(tint, 0.85));
                mesh.position.set(
                    start + run / 2,
                    R3D.tileY(ty) + 0.5 + height / 2,
                    TRIM_Z + 0.4
                );
                mesh.name = 'heat';
                mesh.renderOrder = 4;
                group.add(mesh);
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Rock
     * ------------------------------------------------------------------ */

    /** @param {R3D.Builder} g  the additive pass, for the glow in a fissure */
    function rockRuns(room, b, g, pal) {
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
                    /*
                     * Moss along the lit rock edge, and tufts out of it — the
                     * same green cap the platforms get. Rock is the largest
                     * single area of colour in a room, so this is where the
                     * brown is most worth breaking.
                     */
                    const grass = R3D.col(pal.grass || '#5fbf46');
                    const grassDk = R3D.col(pal.grassDark || '#3d8a2c');
                    b.box(tx + run / 2, capY + 0.15, ROCK_Z + ROCK_D / 2 + 0.14,
                          run, 0.12, ROCK_D * 0.34, grassDk, F.SLAB, grass);
                    for (let i = 0; i < run; i++) {
                        const h = Util.tileHash(tx + i, ty);
                        if (h % 3 === 0) {
                            b.box(tx + i + 0.5, capY + 0.06, ROCK_Z + ROCK_D / 2 + 0.28,
                                  0.7, 0.16, 0.06, grassDk, F.FRONT);
                        }
                        if (h % 4 === 1) {
                            b.cone(tx + i + 0.5 + ((h % 5) - 2) * 0.12, capY + 0.3,
                                   ROCK_Z + ROCK_D / 2 + 0.16, 0.055, 0.22, grass, true, 5);
                        }
                    }
                    void mossCol;
                }

                /*
                 * Fissured rock: the one tile in the mine you are supposed to
                 * blow open, so it cannot look like the wall it is set into.
                 *
                 * Seam lines alone were not enough — thin dark marks on dark
                 * rock read as texture. It now gets loose blocks half out of
                 * the face, wide gaps between them, and a warm rim where the
                 * light gets behind, so the whole tile reads as *unsound*
                 * rather than as decorated stone.
                 */
                if (t === T.CRACKED) {
                    const face = ROCK_Z + ROCK_D / 2;
                    for (let i = 0; i < run; i++) {
                        const cx = tx + i + 0.5;
                        const cy = R3D.tileY(ty);
                        const h = Util.tileHash(tx + i, ty);
                        // Loose blocks, sitting proud and slightly rotated by offset.
                        for (let k = 0; k < 4; k++) {
                            const ox = ((h >> (k * 3)) % 5 - 2) * 0.13;
                            const oy = ((h >> (k * 3 + 2)) % 5 - 2) * 0.13;
                            b.box(cx + ox, cy + oy, face - 0.06 + (k % 2) * 0.1,
                                  0.34, 0.3, 0.22,
                                  R3D.mixCol(pal.rock[1], '#000000', 0.15), F.SLAB,
                                  R3D.col(pal.rockTop));
                        }
                        // The gaps between them, and light leaking through.
                        b.box(cx, cy, face + 0.06, 0.07, 0.94, 0.05, R3D.col('#0b0b0d'), F.FRONT);
                        b.box(cx, cy + 0.1, face + 0.06, 0.94, 0.06, 0.05, R3D.col('#0b0b0d'), F.FRONT);
                        g.box(cx, cy, face + 0.08, 0.1, 0.9, 0.03,
                              R3D.col('#8a4a20'), F.FRONT);
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
     * @param {R3D.Builder} s  the multiply pass — contact shadows
     */
    function trim(room, b, p, g, s, liquid, pal, lights) {
        const timber = R3D.col(pal.timber);
        const timberTop = R3D.col(pal.timberTop);
        const ladderCol = R3D.col(pal.ladder);
        const ropeCol = R3D.col(pal.rope);
        const beltCol = R3D.col('#2e2e33');
        const beltTread = R3D.col('#4a4a52');
        const lavaCol = R3D.col(pal.lava);
        const waterCol = R3D.col(pal.water);
        const crumbleCol = R3D.mixCol(pal.timber, '#2a2018', 0.45);
        const grassCol = R3D.col(pal.grassDark || '#3d8a2c');
        const grassLit = R3D.col(pal.grass || '#5fbf46');

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
                        const leftEnd = room.get(tx - 1, ty) !== T.PLATFORM;
                        const rightEnd = room.get(tx + 1, ty) !== T.PLATFORM;
                        // Varied thickness along a run, so a deck is not a
                        // ruler. Keyed to the tile so it never shimmers.
                        const vary = (Util.tileHash(tx, ty) % 5) * 0.012;

                        // Deck: proud of the body in Z and a touch wider.
                        b.box(x, y + 0.40, TRIM_Z + 0.12, 1, 0.18 + vary, TRIM_D + 0.22,
                              timberTop, F.SLAB, timberTop);
                        // Body: narrower, darker, hanging under the deck.
                        b.box(x, y + 0.20, TRIM_Z, 1, 0.24 + vary, TRIM_D, timber, F.SLAB);
                        // The shadow line where one meets the other.
                        b.box(x, y + 0.29, TRIM_Z + TRIM_D / 2 + 0.12, 1, 0.05, 0.04,
                              R3D.mixCol(pal.timber, '#000000', 0.6), F.FRONT);

                        /*
                         * Rounded ends.
                         *
                         * A run of platform tiles has square corners at each
                         * end, and a row of hard right angles is most of what
                         * makes scaffolding look like scaffolding. A capped
                         * cylinder on the end turns the silhouette from a bar
                         * into a beam. Only at the ends — inside a run there is
                         * nothing to round off.
                         */
                        for (const end of [leftEnd ? -1 : 0, rightEnd ? 1 : 0]) {
                            if (!end) continue;
                            b.cyl(x + end * 0.5, y + 0.40, TRIM_Z + 0.12, 0.09 + vary / 2,
                                  TRIM_D + 0.22, 'z', timberTop, 8, timberTop);
                            b.cyl(x + end * 0.46, y + 0.20, TRIM_Z, 0.12 + vary / 2,
                                  TRIM_D, 'z', timber, 8);
                        }

                        if (Util.tileHash(tx, ty) % 3 === 0) {
                            // A bracket under the boards every few tiles.
                            b.box(x, y - 0.02, TRIM_Z, 0.18, 0.30, 0.26, timber, F.SLAB);
                        }

                        /*
                         * The green cap.
                         *
                         * Every platform gets a layer of moss along its top
                         * edge, overhanging slightly, with tufts standing up
                         * out of it. It is the single cheapest way to break a
                         * wall of brown: one bright, cool colour laid along
                         * exactly the line the player's eye is already
                         * following, which is the top of every walkable
                         * surface — so it doubles as readability, not only
                         * decoration.
                         */
                        b.box(x, y + 0.505 + vary, TRIM_Z + 0.14, 1.04, 0.1, TRIM_D + 0.26,
                              grassCol, F.SLAB, grassLit);
                        // A ragged lower fringe hanging over the front edge.
                        const fringe = Util.tileHash(tx + 7, ty) % 4;
                        for (let i = 0; i < 3; i++) {
                            if ((fringe >> i) & 1) continue;
                            b.box(x - 0.3 + i * 0.3, y + 0.42 + vary,
                                  TRIM_Z + TRIM_D / 2 + 0.24, 0.24, 0.12, 0.06,
                                  grassCol, F.FRONT);
                        }
                        // Tufts standing up out of the moss.
                        const tufts = Util.tileHash(tx, ty + 3) % 3;
                        for (let i = 0; i <= tufts; i++) {
                            const ox = -0.32 + ((Util.tileHash(tx + i, ty) % 7) / 7) * 0.64;
                            const h = 0.14 + (Util.tileHash(tx, ty + i) % 4) * 0.05;
                            b.cone(x + ox, y + 0.58 + vary + h / 2, TRIM_Z + 0.2,
                                   0.05, h, grassLit, true, 5);
                        }
                        /*
                         * Contact shading: a dark band hanging just under the
                         * board, on the backdrop side.
                         *
                         * Every platform in the reference art has one, and it
                         * is what stops a ledge looking pasted onto the
                         * background. Cheap — one unlit quad — and it does more
                         * for grounding than any amount of lighting.
                         */
                        s.box(x, y + 0.02, TRIM_Z - 0.6, 1.2, 0.5, 0.02,
                              R3D.col('#6a5c50'), F.FRONT);
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
                        /*
                         * A spike bed has to read as a machine, not as a cave.
                         *
                         * These were pale grey cones on a dark rail, which is
                         * also a fair description of the decorative stalactites
                         * hanging off every ceiling in the game — so the only
                         * way to tell a spike from scenery was to walk into it.
                         *
                         * Three things separate them now, and all three are
                         * doing work. The amber banding on the mount is the
                         * hazard signature and appears nowhere in the rock. The
                         * spacing is *even* and the points are *identical*,
                         * where a stalactite cluster is irregular by
                         * construction. And the tips carry a glint on the
                         * additive pass, so the row catches the eye across a
                         * dark room instead of blending into the ceiling.
                         */
                        const H = R3D.HAZARD;
                        const iron = R3D.col(H.metal);
                        const ironLit = R3D.col(H.metalLit);
                        const warn = R3D.col(H.warn);
                        const rust = R3D.mixCol(H.rust, H.metal, 0.45);

                        // Which way the points face: hanging from the rock above
                        // if there is any, otherwise standing up out of the
                        // floor. It used to always hang, so a spike bed on the
                        // ground was drawn as a rail floating in mid-air.
                        const hangs = Tiles.isSolid(room.get(tx, ty - 1));
                        const railY = y + (hangs ? 0.44 : -0.44);
                        const sign = hangs ? -1 : 1;
                        const len = 0.5;

                        // The mount, and an unbroken amber stripe along the front
                        // of it. Broken into per-tile dashes it read as trim;
                        // continuous along the whole bed it reads as tape.
                        p.box(x, railY, TRIM_Z, 1, 0.16, TRIM_D * 0.7, iron, F.SLAB, ironLit);
                        p.box(x, railY, TRIM_Z + TRIM_D * 0.36, 1, 0.1, 0.04, warn, F.FRONT);

                        /*
                         * Three points to the tile, not four. Four at this size
                         * closed up into a dark comb — the triangles stopped
                         * being triangles, which is the one thing about a spike
                         * that has to survive being small.
                         */
                        for (let i = 0; i < 3; i++) {
                            const sx = x - 0.3 + i * 0.3;
                            const cy = railY + sign * (0.06 + len / 2);
                            // `flip` puts the apex at the *top*, so a bed
                            // standing up out of the floor wants it set and a
                            // row hanging off a ceiling wants it clear.
                            p.cone(sx, cy, TRIM_Z, 0.13, len, iron, !hangs, 6, ironLit);
                            // Rust where the point meets its mount.
                            p.cyl(sx, railY + sign * 0.09, TRIM_Z, 0.1, 0.07, 'y', rust, 6);
                            // A sliver of light down the leading edge — a
                            // highlight on the *edge*, where a blob at the tip
                            // only made them look blunt.
                            g.box(sx - 0.04, cy, TRIM_Z + TRIM_D * 0.4,
                                  0.03, len * 0.5, 0.03, R3D.col(H.edge), F.FRONT);
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
                        // A grated pipe mouth set into the floor, wearing the
                        // same amber collar as the spike rails — a vent fires on
                        // a timer, so it has to be legible while it is dormant.
                        p.cyl(x, y + 0.28, TRIM_Z, 0.35, 0.07, 'y',
                              R3D.col(R3D.HAZARD.warn), 10);
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
                         * BRIGHT MELT, DARK ISLANDS.
                         *
                         * The two previous attempts both got the values the
                         * wrong way round: a dark crust covering the tile with
                         * thin bright veins scratched into it. Photograph a lava
                         * channel and the opposite is true — the melt is the
                         * brightest thing in frame by a long way, near white
                         * where it is thinnest, and the *crust* is the dark
                         * part: broken plates floating on top with a white-hot
                         * rim where they are being pulled apart.
                         *
                         * So the melt goes on the additive pass, where lighting
                         * cannot dim it, and the crust goes on the lit pass on
                         * top of it. Hash the plate positions off the tile so a
                         * long channel does not repeat.
                         */
                        const lh = Util.tileHash(tx, ty);
                        /** Hashed digit `n` wide, taken from bit `s` up. */
                        const bit = function (s, n) { return (lh >>> s) % n; };

                        const melt = pal.lava;
                        /*
                         * Near black, and lower than looks right in isolation.
                         * The crust sits directly in front of a point light with
                         * the room's largest energy, so anything mid-toned here
                         * washes straight out to orange and the plates stop
                         * reading as cooled rock at all.
                         */
                        const crust = R3D.col('#180804');
                        const crustLit = R3D.col('#22100a');
                        /*
                         * The two ends of the gradient: deep red, white heat.
                         *
                         * The cool end is nowhere near black. Taken down to
                         * near black the lower two thirds of the channel went
                         * brown and the whole thing read as mud with a hot line
                         * on top — molten rock is *lit from within*, so even its
                         * coolest visible part is a strong red.
                         */
                        const deep = R3D.mixCol(melt, '#5a1200', 0.55);
                        const hot = R3D.mixCol(melt, '#fff2cc', 0.78);
                        const covered = room.get(tx, ty - 1) === T.LAVA;

                        /*
                         * THE SILHOUETTE IS THE WHOLE JOB.
                         *
                         * The last pass got the colour right and still looked
                         * wrong, because every tile filled to exactly the same
                         * height: a long channel was a poured orange rectangle
                         * with a dead-straight line of crust dashes along the
                         * top, like hazard tape. Molten rock has no straight
                         * edge anywhere on it.
                         *
                         * So the fill height is hashed per *half tile*. The
                         * neighbours hash differently, so a run comes out as a
                         * stepped, uneven skyline with no rhythm to it — which
                         * is what makes it read as liquid rather than as a
                         * painted block.
                         */
                        /*
                         * Small steps, deliberately.
                         *
                         * Deep ones (up to a fifth of a tile) laid dark bars
                         * along the channel at every step down — flattening the
                         * surface removed them completely, which is how the
                         * cause was pinned down. Kept shallow the surface still
                         * is not a drawn-on straight line, and whatever the
                         * steps were revealing is now too small to see.
                         */
                        const lip = [
                            covered ? 0.5 : 0.5 - bit(0, 3) * 0.022,
                            covered ? 0.5 : 0.5 - bit(5, 3) * 0.022
                        ];

                        /*
                         * Channel wall, seen behind and below the melt — and
                         * warm, not near black. The melt in front of it is
                         * additive, so wherever the wall shows through a dip in
                         * the surface it contributes its own colour; a near
                         * black wall left dark bars lying along the channel
                         * exactly where the fill height stepped down.
                         */
                        p.box(x, y - 0.15, TRIM_Z - 0.1, 1, 0.7, TRIM_D,
                              R3D.mixCol(melt, '#2a0a02', 0.78), F.SLAB);

                        /*
                         * A GRADIENT, NOT A STACK OF PARTS.
                         *
                         * The last pass built the channel out of components — a
                         * body band, a hot band, a white lip, and a raised plate
                         * of crust on most tiles. Every one of those has a hard
                         * horizontal edge, and the plates were the worst of it:
                         * the melt is on the additive pass, so anything drawn
                         * over it can only *brighten*, which means crust has to
                         * be an opaque block standing in front. A row of small
                         * opaque blocks with sharp corners along a strip of
                         * orange reads as brickwork, and that is what it looked
                         * like.
                         *
                         * So the crust is gone and the melt carries the whole
                         * thing: five bands per half tile ramping from near
                         * black at the bottom to near white at the surface,
                         * squared so the heat piles up at the top. Bands that
                         * close together read as one glowing mass rather than
                         * as stripes, and with the fill height still hashed per
                         * half tile the skyline stays broken.
                         */
                        const BANDS = 5;
                        for (let k = 0; k < 2; k++) {
                            const hx = x - 0.25 + k * 0.5;
                            const top = y + lip[k];
                            const depth = top - (y - 0.5);
                            const h = depth / BANDS;
                            for (let i = 0; i < BANDS; i++) {
                                const f = (i + 0.5) / BANDS;          // 0 deep, 1 at the surface
                                const col = R3D.mixCol(deep, hot, Math.pow(f, 1.35));
                                g.box(hx, y - 0.5 + h * (i + 0.5), TRIM_Z + 0.3 + i * 0.004,
                                      0.5, h * 1.04, 0.03, col, F.FRONT);
                            }

                            /*
                             * Fill the freeboard above a low-filled half tile
                             * with a dim warm glow.
                             *
                             * Where one half tile fills lower than its
                             * neighbour, the gap left above it looked straight
                             * through to whatever sat behind the channel, which
                             * is unlit and reads black — so the hashed surface
                             * that was supposed to break up the skyline instead
                             * laid dark bars along it at every step down. The
                             * melt pass is additive, so a dim band here cannot
                             * darken anything; it can only stop the hole being
                             * a hole.
                             */
                            const gap = 0.5 - lip[k];
                            if (!covered && gap > 0.01) {
                                g.box(hx, top + gap / 2, TRIM_Z + 0.28, 0.5, gap, 0.03,
                                      R3D.mixCol(melt, '#000000', 0.74), F.FRONT);
                            }
                        }
                        /*
                         * There is deliberately no crust here.
                         *
                         * Three passes tried it and all three failed the same
                         * way. The melt is additive, so anything laid over it
                         * can only brighten — crust has to be an *opaque* shape
                         * standing in front of the glow. At the size a tile
                         * occupies on screen, opaque dark shapes on a bright
                         * strip do not read as cooled skin; they read as holes
                         * punched in it, or as brickwork. The uneven fill height
                         * and the glow above the surface carry it instead.
                         */
                        void crust; void crustLit;

                        /*
                         * One light every few tiles, staggered off the hash and
                         * sunk below the surface. Evenly spaced lights sitting
                         * on the surface pooled on the channel wall behind, and
                         * a row of identical glowing ovals at a fixed pitch
                         * reads as a line of lamps under the melt.
                         */
                        if (!covered && (tx + bit(24, 3)) % 4 === 0) {
                            lights.push({
                                x: x, y: y - 0.1, colour: pal.lava,
                                energy: 1.5, range: 13, flicker: 0.4
                            });
                        }
                        break;
                    }

                    case T.WATER: {
                        /*
                         * WATER DARKENS WHAT IS BEHIND IT.
                         *
                         * The body used to go on the additive pass, which is the
                         * one thing water must never do: adding light to the
                         * rock behind it made a sump look like a lit glass
                         * brick standing in front of the wall rather than a
                         * hole in the floor full of water. It is a tinted,
                         * transparent pass now, so the rock reads *through* it,
                         * darker and bluer, the way depth actually works.
                         *
                         * The bands are gone too. Every tile carried one bright
                         * horizontal stripe at one of three hashed heights, and
                         * neighbouring tiles that hashed alike joined theirs up
                         * into long unbroken lines — a sump came out looking
                         * like a rack of fluorescent tubes. Depth is carried by
                         * the tint alone now, and the only bright thing is the
                         * surface, which `Actors3D` moves.
                         */
                        /*
                         * Darkened by how far down the column this tile sits,
                         * not by a surface/not-surface flag. The flag put one
                         * hard step across the whole body at exactly the same
                         * height in every column, which is a band — the thing
                         * the bands were removed for. Counting upward to the
                         * surface and ramping over four steps reads as depth.
                         */
                        let below = 0;
                        while (below < 4 && room.get(tx, ty - below - 1) === T.WATER) below++;
                        const tint = R3D.mixCol(pal.water, '#000000', 0.24 + below * 0.07);
                        liquid.box(x, y, TRIM_Z + 0.34, 1, 1, 0.02, tint, F.FRONT);

                        // Where it meets the bed, a little bounced light.
                        if (Tiles.isFloor(room.get(tx, ty + 1))) {
                            g.box(x, y - 0.44, TRIM_Z + 0.35, 1, 0.1, 0.02,
                                  R3D.mixCol(pal.water, '#ffffff', 0.16), F.FRONT);
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

            /*
             * Two things made this read as blocks. The guard bars were drawn
             * as four-segment cylinders — and a four-segment cylinder *is* a
             * square prism, so the lamp had two little posts stuck to it. And
             * the halo behind it was a flat quad, i.e. a square of light on the
             * wall. Both are gone: the cage is a ring of fine uprights with
             * enough segments to be round, and the glow is a cylinder.
             */
            b.cyl(x, y + 0.74, z, 0.028, 0.56, 'y', metal, 6);           // chain
            b.cyl(x, y + 0.44, z, 0.05, 0.1, 'y', metal, 6);             // eye
            b.cone(x, y + 0.34, z, 0.15, 0.16, brass, true, 12);         // domed cap
            b.cyl(x, y + 0.08, z, 0.145, 0.42, 'y', R3D.col('#e8c68a'), 12);  // glass
            b.cyl(x, y - 0.15, z, 0.16, 0.08, 'y', brass, 12);           // base
            b.cyl(x, y - 0.21, z, 0.11, 0.05, 'y', metal, 10);           // foot

            // A cage of six fine uprights around the glass.
            for (let k = 0; k < 6; k++) {
                const a = (k / 6) * Math.PI * 2;
                b.cyl(x + Math.cos(a) * 0.145, y + 0.08, z + Math.sin(a) * 0.145,
                      0.014, 0.42, 'y', metal, 5);
            }

            /*
             * The glow lives *inside the glass*, as a tall flame — not as a
             * disc in front of the lamp.
             *
             * A flat bright circle facing the camera is a coin, whatever is
             * behind it, and that is exactly what these turned into. The lamp
             * has a point light doing the real work on the surrounding rock;
             * all this needs to do is make the glass look lit from within.
             */
            g.cyl(x, y + 0.08, z, 0.075, 0.34, 'y', R3D.col('#fff3c8'), 8);
            g.cyl(x, y + 0.08, z, 0.135, 0.30, 'y',
                  R3D.mixCol(pal.lamp, '#000000', 0.45), 12);

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
            /*
             * Cones, tip down, in a cluster — a stalactite is a spike of rock,
             * and drawn as a box it is a stalagmite-shaped brick.
             *
             * Held back deliberately: darker than the wall they hang off and
             * set further into it. These share a silhouette with a spike bed,
             * and of the two it is the spike that has to win the eye, so the
             * scenery gives way. Irregular lengths and offsets do the rest —
             * a spike row is identical points at an even pitch, this never is.
             */
            const len = rng.range(0.5, 1.4);
            const x = R3D.tileX(tx) + rng.range(-0.2, 0.2);
            const y = R3D.tileY(ty) - 0.5 - len / 2;
            const z = R3D.BACK_Z + 1.0;
            const stone = R3D.mixCol(pal.rock[2], '#000000', 0.3);
            rock.cone(x, y, z, rng.range(0.14, 0.22), len, stone, false, 7);
            if (rng.chance(0.6)) {
                rock.cone(x + rng.range(-0.34, 0.34), y + 0.16, z - 0.2,
                          rng.range(0.08, 0.14), len * 0.6,
                          R3D.mixCol(pal.rock[0], '#000000', 0.3), false, 6);
            }
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
            // Actual links, alternating their axis the way a chain hangs, and
            // a hook at the top. A chain drawn as one long thin box is a wire.
            const len = rng.range(1.2, 3.4);
            const x = R3D.tileX(tx);
            const top = R3D.tileY(ty) - 0.5;
            const z = R3D.BACK_Z + 0.75;
            const iron = R3D.col('#454550');
            const ironLit = R3D.col('#6a6a78');
            const links = Math.max(3, Math.round(len / 0.19));
            for (let k = 0; k < links; k++) {
                const ly = top - 0.1 - k * (len / links);
                const flat = k % 2 === 0;
                b.cyl(x, ly, z, 0.075, 0.045, flat ? 'z' : 'x',
                      k % 2 ? iron : ironLit, 7);
            }
            b.cyl(x, top - len - 0.06, z, 0.045, 0.24, 'y', iron, 6);
            b.sphere(x, top - len - 0.2, z, 0.1, ironLit, 8, 6);
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

        /*
         * Timbered arches on the back wall — two posts, a lintel, and braces
         * across the corners.
         *
         * This is the one piece of dressing that says "somebody built this".
         * Rock and moss make a cave; a row of arches receding into it makes a
         * *working*, and it gives the middle distance a repeating rhythm for
         * the eye to measure depth against.
         */
        const beam = R3D.mixCol(pal.timber, '#000000', 0.3);
        const beamLit = R3D.mixCol(pal.timberTop, '#000000', 0.25);
        for (let x = 4; x < C.COLS - 4; x += rng.int(7, 12)) {
            const h = rng.range(5.5, 10);
            const w = rng.range(2.6, 4.2);
            const base = rng.range(0.5, C.ROWS - h - 1);
            const top = base + h;
            const z = R3D.BACK_Z + 0.5;
            for (const s of [-1, 1]) {
                b.box(x + s * w / 2, base + h / 2, z, 0.26, h, 0.26, beam, F.SLAB, beamLit);
                // Corner brace.
                b.box(x + s * (w / 2 - 0.42), top - 0.5, z, 0.9, 0.18, 0.2, beam, F.SLAB);
            }
            b.box(x, top, z, w + 0.5, 0.3, 0.3, beam, F.SLAB, beamLit);
            b.box(x, top + 0.22, z, w + 0.9, 0.14, 0.24, beamLit, F.SLAB, beamLit);
        }

        /*
         * Vines hanging off the front edge of platforms and ledges.
         *
         * Drawn as a run of short segments with a slight drift so they curl
         * rather than hang plumb, and they finish in a leaf. Together with the
         * moss caps this is what stops the middle of a room being empty air
         * between one brown board and the next.
         */
        const vineCol = R3D.col(pal.grassDark || '#3d8a2c');
        const leafCol = R3D.col(pal.grass || '#5fbf46');
        for (let attempt = 0, made = 0; attempt < 200 && made < 12; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = rng.int(2, C.ROWS - 6);
            if (!Tiles.isFloor(room.get(tx, ty))) continue;
            if (room.get(tx, ty + 1) !== T.EMPTY || room.get(tx, ty + 2) !== T.EMPTY) continue;

            const x = R3D.tileX(tx) + rng.range(-0.3, 0.3);
            const top = R3D.tileY(ty) - 0.5;
            const z = TRIM_Z + TRIM_D / 2 + 0.2;
            const len = rng.range(0.9, 2.6);
            const segs = Math.max(3, Math.round(len / 0.28));
            let drift = 0;
            for (let k = 0; k < segs; k++) {
                drift += rng.range(-0.05, 0.05);
                const sy = top - 0.14 - k * (len / segs);
                b.cyl(x + drift, sy, z, 0.045, len / segs + 0.04, 'y', vineCol, 5);
                if (k % 2 === 1) {
                    b.box(x + drift + (k % 4 === 1 ? 0.12 : -0.12), sy, z,
                          0.18, 0.08, 0.05, leafCol, F.SLAB);
                }
            }
            b.cone(x + drift, top - len - 0.1, z, 0.07, 0.18, leafCol, false, 5);
            made++;
        }
    }

    TNT.RoomMesh = RoomMesh;
})(window.TNT = window.TNT || {}, window.THREE);
