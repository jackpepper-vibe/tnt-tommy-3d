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
    RoomMesh.build = function (room, pal) {
        const group = new THREE.Group();
        const solid = new R3D.Builder();
        const glow = new R3D.Builder();
        const lights = [];
        const rng = Util.rng(0x7A11 + room.index * 2654435761);

        backdrop(group, pal, rng);
        rockRuns(room, solid, pal);
        trim(room, solid, glow, pal, lights);
        decor(room, solid, glow, pal, lights, rng);

        if (!solid.isEmpty()) {
            const mesh = new THREE.Mesh(solid.geometry(), R3D.solidMaterial());
            mesh.name = 'terrain';
            group.add(mesh);
        }
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

                // A lit lip along the top edge, and moss on some of it. Cheap,
                // and it is most of what stops a wall reading as a flat block.
                if (lit) {
                    b.box(tx + run / 2, R3D.tileY(ty) + 0.46, ROCK_Z + ROCK_D / 2 - 0.02,
                          run, 0.09, 0.06, topCol, F.FRONT | F.TOP);
                    for (let i = 0; i < run; i++) {
                        if (Util.tileHash(tx + i, ty) % 5 !== 0) continue;
                        b.box(tx + i + 0.5, R3D.tileY(ty) + 0.42, ROCK_Z + ROCK_D / 2 + 0.01,
                              0.8, 0.16, 0.04, mossCol, F.FRONT);
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

    function trim(room, b, g, pal, lights) {
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
                    case T.PLATFORM:
                    case T.CRUMBLE: {
                        // Boards sit at the *top* of their tile: that is the
                        // surface the physics lands you on, and drawing them
                        // centred puts the visual half a tile below your feet.
                        const c = t === T.CRUMBLE ? crumbleCol : timber;
                        b.box(x, y + 0.34, TRIM_Z, 1, 0.30, TRIM_D, c, F.SLAB, timberTop);
                        if (t === T.CRUMBLE) {
                            b.box(x, y + 0.34, TRIM_Z + TRIM_D / 2 + 0.01, 0.9, 0.06, 0.04,
                                  R3D.col('#20160f'), F.FRONT);
                        } else if (Util.tileHash(tx, ty) % 3 === 0) {
                            b.box(x, y + 0.14, TRIM_Z, 0.16, 0.36, 0.24, timber, F.SLAB);
                        }
                        break;
                    }

                    case T.LADDER: {
                        b.box(x - 0.30, y, TRIM_Z, 0.11, 1, 0.2, ladderCol, F.SLAB);
                        b.box(x + 0.30, y, TRIM_Z, 0.11, 1, 0.2, ladderCol, F.SLAB);
                        for (let r = 0; r < 3; r++) {
                            b.box(x, y - 0.33 + r * 0.33, TRIM_Z, 0.56, 0.08, 0.16,
                                  ladderCol, F.SLAB, timberTop);
                        }
                        break;
                    }

                    case T.VINE: {
                        // Hangs a little off-centre and knots, so a rope reads as
                        // a rope and not as a ladder that lost its rungs.
                        const wob = ((Util.tileHash(tx, ty) % 7) - 3) * 0.02;
                        b.box(x + wob, y, TRIM_Z, 0.13, 1, 0.13, ropeCol, F.SLAB);
                        b.box(x + wob, y - 0.3, TRIM_Z, 0.2, 0.13, 0.2, ropeCol, F.SLAB);
                        break;
                    }

                    case T.ROPE: {
                        b.box(x, y + 0.22, TRIM_Z, 1, 0.1, 0.1, ropeCol, F.SLAB);
                        break;
                    }

                    case T.SPIKE: {
                        for (let i = 0; i < 3; i++) {
                            const sx = x - 0.3 + i * 0.3;
                            b.box(sx, y - 0.24, TRIM_Z, 0.16, 0.5, 0.16, spikeCol, F.SLAB);
                            b.box(sx, y + 0.06, TRIM_Z, 0.06, 0.2, 0.06,
                                  R3D.col('#cfd4dc'), F.SLAB);
                        }
                        break;
                    }

                    case T.BELT_R:
                    case T.BELT_L: {
                        b.box(x, y + 0.32, TRIM_Z, 1, 0.26, TRIM_D, beltCol, F.SLAB, beltTread);
                        b.box(x, y + 0.45, TRIM_Z + TRIM_D / 2 + 0.01, 0.5, 0.06, 0.04,
                              beltTread, F.FRONT);
                        break;
                    }

                    case T.VENT: {
                        b.box(x, y - 0.4, TRIM_Z, 0.8, 0.2, TRIM_D, R3D.col('#4a4a52'), F.SLAB);
                        g.box(x, y - 0.34, TRIM_Z + 0.3, 0.5, 0.06, 0.04,
                              R3D.col('#6fd3ff'), F.FRONT);
                        break;
                    }

                    case T.LAVA: {
                        b.box(x, y + 0.15, TRIM_Z, 1, 0.7, TRIM_D, R3D.col('#5a1c10'), F.SLAB);
                        g.box(x, y + 0.42, TRIM_Z + 0.3, 1, 0.24, 0.04, lavaCol, F.FRONT);
                        if (tx % 4 === 0) {
                            lights.push({ x: x, y: y + 0.4, colour: pal.lava, energy: 1.1, range: 11, flicker: 0.3 });
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

                    case T.DETONATOR: {
                        b.box(x, y - 0.2, TRIM_Z, 0.7, 0.6, 0.5, R3D.col('#5a3a22'), F.SLAB);
                        b.box(x, y + 0.16, TRIM_Z, 0.12, 0.4, 0.12, R3D.col('#8c8c94'), F.SLAB);
                        b.box(x, y + 0.38, TRIM_Z, 0.5, 0.12, 0.2, R3D.col('#c0392b'), F.SLAB);
                        g.box(x, y + 0.38, TRIM_Z + 0.2, 0.55, 0.16, 0.04, R3D.col('#ff6b4a'), F.FRONT);
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
    function backdrop(group, pal, rng) {
        const b = new R3D.Builder();
        const far = R3D.col(pal.backFar);
        const near = R3D.mixCol(pal.backFar, pal.back, 0.55);

        b.box(C.COLS / 2, C.ROWS / 2, R3D.BACK_Z - 0.6, C.COLS + 8, C.ROWS + 8, 0.1,
              R3D.col(pal.back), F.FRONT);

        for (let layer = 0; layer < 2; layer++) {
            const colour = layer === 0 ? far : near;
            const z = R3D.BACK_Z - 0.4 + layer * 0.22;
            const step = layer === 0 ? 3 : 2.2;
            for (let x = -2; x < C.COLS + 2; x += step) {
                const h = rng.range(3, 9) - layer * 1.2;
                const w = step * rng.range(0.9, 1.5);
                b.box(x, h / 2, z, w, h, 0.08, colour, F.FRONT);
                const top = rng.range(2, 6);
                b.box(x + rng.range(-1, 1), C.ROWS - top / 2, z, w * 0.8, top, 0.08, colour, F.FRONT);
            }
        }

        const mesh = new THREE.Mesh(b.geometry(), R3D.flatMaterial());
        mesh.name = 'backdrop';
        group.add(mesh);
    }

    /**
     * Lamps, beams, stalactites, crystals and mushrooms.
     *
     * Everything here is placed off the seeded RNG, so a room looks the same on
     * every load and a screenshot taken before a change can be compared with one
     * taken after it.
     */
    function decor(room, b, g, pal, lights, rng) {
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
            const x = R3D.tileX(tx), y = R3D.tileY(ty) - 0.9;
            b.box(x, y + 0.5, TRIM_Z + 0.2, 0.06, 0.5, 0.06, R3D.col('#3a3a40'), F.SLAB);
            b.box(x, y, TRIM_Z + 0.2, 0.34, 0.34, 0.34, lampCol, F.SLAB);
            g.box(x, y, TRIM_Z + 0.42, 0.6, 0.6, 0.02, R3D.col(pal.lamp), F.FRONT);
            lights.push({ x: x, y: y, colour: pal.lamp, energy: 1.15, range: 16, flicker: 0.18 });
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
            b.box(x, y, R3D.BACK_Z + 0.9, 0.26, len, 0.26, R3D.col(pal.rock[2]), F.SLAB);
            made++;
        }

        // Crystals in the back wall — the Godot build's signature, and the only
        // thing in a room that is lit by nothing and still visible.
        for (let i = 0; i < 9; i++) {
            const tx = rng.int(1, C.COLS - 2);
            const ty = rng.int(1, C.ROWS - 2);
            if (room.get(tx, ty) !== T.EMPTY) continue;
            const colour = rng.pick(crystalCols);
            const x = R3D.tileX(tx), y = R3D.tileY(ty);
            const s = rng.range(0.18, 0.34);
            g.box(x, y, R3D.BACK_Z + 0.85, s, s * 2.1, s, colour, F.ALL);
            g.box(x, y, R3D.BACK_Z + 0.9, s * 3.2, s * 4.4, 0.02,
                  colour.clone().multiplyScalar(0.22), F.FRONT);
        }
    }

    TNT.RoomMesh = RoomMesh;
})(window.TNT = window.TNT || {}, window.THREE);
