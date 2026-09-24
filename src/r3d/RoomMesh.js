/**
 * TNT Tommy — room geometry.
 *
 * Turns a 42x24 tile grid into the handful of merged meshes a room is drawn
 * with, plus its dressing and the list of light sources it wants. The space
 * *behind* the playfield — the built wall and the machine hall through its
 * windows — is `Works`; this module is everything on the play plane.
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
 *      z = -34 … -8   the hall and the dark, seen through the wall   (Works)
 *      z = -3.4       the built wall, its columns and pipework      (Works)
 *      z = -1.0       back of the rock
 *      z =  0.1       face of the rock
 *      z =  0.2       face of the decks, ladders, chains
 *      z =  0.45      actors — Tommy, patrols, pickups
 *
 * Actors sit *in front of* the terrain rather than inside it, so nothing ever
 * clips into a wall it is standing beside.
 *
 * THE LOOK
 * --------
 * The works, not a cave. Decks are riveted steel catwalks hung from the
 * structure above them, ladders are steel, hanging ropes are chain, lines are
 * cable, and the rock is capped with dressed stone rather than turf. There is
 * no green anywhere in the mine: the moss, grass and vines of the earlier build
 * were what made it read as outdoors, and they are gone for that reason.
 */
(function (TNT, THREE) {
    'use strict';

    const { C, Util, R3D, Tiles, Works } = TNT;
    const T = C.Tile;
    const F = R3D.FACE;

    const ROCK_Z = -0.45, ROCK_D = 1.1;
    const TRIM_Z = -0.15, TRIM_D = 0.7;
    const RoomMesh = {};

    /* ------------------------------------------------------------------ *
     * Build
     * ------------------------------------------------------------------ */

    /**
     * One pass per surface texture — hewn rock, riveted plate, tread plate,
     * sawn timber, and the untextured fittings. Colour still comes from the
     * vertex data, so the palettes are unaffected; the split exists only
     * because a merged mesh carries one map.
     *
     * @param {TNT.World.Room} room
     * @param {object} pal  a palette from `R3D.PALETTES`
     * @returns {{group: THREE.Group, lights: Array, emitters: Array, update: function(number)}}
     */
    RoomMesh.build = function (room, pal) {
        const group = new THREE.Group();
        const rock = new R3D.Builder();
        const plate = new R3D.Builder();
        const tread = new R3D.Builder();
        const wood = new R3D.Builder();
        const plain = new R3D.Builder();
        const glow = new R3D.Builder();
        /** Multiplied down onto what is behind — contact shadows, not light. */
        const shade = new R3D.Builder();
        /** Tinted and transparent: water, which darkens what shows through it. */
        const liquid = new R3D.Builder();
        const lights = [];
        const rng = Util.rng(0x7A11 + room.index * 2654435761);

        const works = Works.build(room, pal, Util.rng(0xB0A7 + room.index * 40503));
        group.add(works.group);
        for (const l of works.lights) lights.push(l);

        const kit = { rock: rock, plate: plate, tread: tread, wood: wood, plain: plain,
                      glow: glow, shade: shade, liquid: liquid };

        surround(room, kit, pal);
        rockRuns(room, kit, pal);
        tankShell(room, plain);
        trim(room, kit, pal, lights);
        decor(room, kit, pal, lights, rng);

        const add = function (builder, name, texture, order) {
            if (builder.isEmpty()) return;
            const mesh = new THREE.Mesh(builder.geometry(), R3D.solidMaterial(texture));
            mesh.name = name;
            if (order) mesh.renderOrder = order;
            group.add(mesh);
        };

        add(rock, 'rock', 'rock0');
        add(plate, 'plate', 'plate');
        add(tread, 'tread', 'tread');
        add(wood, 'timber', 'timber');
        add(plain, 'fittings', null);

        heatHaze(room, group, pal);

        if (!shade.isEmpty()) {
            // Contact shadows: multiplied down onto whatever is behind them,
            // so they darken the wall rather than adding a grey rectangle to
            // it. Drawn after the solids and before the glow.
            const mesh = new THREE.Mesh(shade.geometry(), R3D.shadeMaterial());
            mesh.name = 'contact';
            mesh.renderOrder = 1;
            group.add(mesh);
        }

        if (!liquid.isEmpty()) {
            // Ordinary alpha, not additive: water has to take light *out* of
            // what shows through it.
            const mesh = new THREE.Mesh(liquid.geometry(), R3D.liquidMaterial());
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

        return { group: group, lights: lights, emitters: works.emitters, update: works.update };
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

    /**
     * Rock runs, capped.
     *
     * A lit top gets one of two caps. The bedrock floor gets **tread plate** —
     * it is the floor of a works, walked by barrows, and a steel floor is what
     * tells you so before anything else in the room does. Every other ledge
     * gets **dressed coping**: a slab of cut stone overhanging the face, with a
     * shadow line under it. Both replace the moss the earlier build laid along
     * every rock edge, which was the loudest single signal that this was a
     * cave with the sky above it.
     */
    function rockRuns(room, kit, pal) {
        const b = kit.rock;
        const rockCols = pal.rock.map(R3D.col);
        const topCol = R3D.col(pal.rockTop);
        const crackedCol = R3D.mixCol(pal.rock[0], '#000000', 0.35);
        const shadow = R3D.mixCol(pal.rock[2], '#000000', 0.6);
        const iron = R3D.col(pal.iron);
        const ironLit = R3D.col(pal.ironLit);
        const edge = R3D.col(pal.brassLit);
        const face = ROCK_Z + ROCK_D / 2;

        for (let ty = 0; ty < C.ROWS; ty++) {
            let tx = 0;
            while (tx < C.COLS) {
                const t = room.get(tx, ty);
                if (t !== T.ROCK && t !== T.CRACKED) { tx++; continue; }

                let run = 1;
                while (tx + run < C.COLS && room.get(tx + run, ty) === t) run++;

                const lit = !isRock(room, tx, ty - 1);
                const solidBelow = isRock(room, tx, ty + 1);

                let mask = F.FRONT;
                if (lit) mask |= F.TOP;
                if (!solidBelow) mask |= F.BOTTOM;
                if (!isRock(room, tx - 1, ty)) mask |= F.LEFT;
                if (!isRock(room, tx + run, ty)) mask |= F.RIGHT;

                const variant = rockCols[Util.tileHash(tx, ty) % rockCols.length];
                b.box(tx + run / 2, R3D.tileY(ty), ROCK_Z, run, 1, ROCK_D,
                      t === T.CRACKED ? crackedCol : variant, mask, lit ? topCol : undefined);

                if (lit && t === T.ROCK) {
                    const capY = R3D.tileY(ty) + 0.4;
                    const cx = tx + run / 2;
                    if (ty === C.ROWS - 1) {
                        // The works floor: tread plate, a lit nosing, and the
                        // joint every few tiles where one plate meets the next.
                        kit.tread.box(cx, capY, face - ROCK_D * 0.35, run, 0.2, ROCK_D * 0.72,
                                      iron, F.SLAB, ironLit);
                        kit.plain.box(cx, capY + 0.07, face + 0.02, run, 0.06, 0.06, edge, F.FRONT | F.TOP);
                        for (let i = 3; i < run; i += 4) {
                            kit.plain.box(tx + i, capY + 0.101, face - ROCK_D * 0.35, 0.05, 0.005,
                                          ROCK_D * 0.7, R3D.col(pal.ironDark), F.TOP);
                        }
                    } else {
                        b.box(cx, capY, face + 0.08, run + 0.1, 0.22, ROCK_D * 0.3, topCol, F.SLAB, topCol);
                        b.box(cx, capY - 0.14, face + 0.02, run, 0.07, 0.04, shadow, F.FRONT);
                    }
                }

                /*
                 * Fissured rock: the one tile in the mine you are supposed to
                 * blow open, so it cannot look like the wall it is set into.
                 * Loose blocks half out of the face, wide dark gaps between
                 * them, and a warm rim where the light gets behind — the whole
                 * tile reads as *unsound* rather than as decorated stone.
                 */
                if (t === T.CRACKED) {
                    for (let i = 0; i < run; i++) {
                        const cx = tx + i + 0.5;
                        const cy = R3D.tileY(ty);
                        const h = Util.tileHash(tx + i, ty);
                        for (let k = 0; k < 4; k++) {
                            const ox = ((h >> (k * 3)) % 5 - 2) * 0.13;
                            const oy = ((h >> (k * 3 + 2)) % 5 - 2) * 0.13;
                            b.box(cx + ox, cy + oy, face - 0.06 + (k % 2) * 0.1, 0.34, 0.3, 0.22,
                                  R3D.mixCol(pal.rock[1], '#000000', 0.15), F.SLAB, topCol);
                        }
                        b.box(cx, cy, face + 0.06, 0.07, 0.94, 0.05, R3D.col('#0b0b0d'), F.FRONT);
                        b.box(cx, cy + 0.1, face + 0.06, 0.94, 0.06, 0.05, R3D.col('#0b0b0d'), F.FRONT);
                        kit.glow.box(cx, cy, face + 0.08, 0.1, 0.9, 0.03, R3D.col('#8a4a20'), F.FRONT);
                    }
                }

                tx += run;
            }
        }
    }

    /**
     * The rock the room is cut out of, beyond its frame.
     *
     * The camera leans, and the lens is wide, so the edges of the screen look
     * past the frame of the room — and there used to be nothing there, just
     * the machine hall and the glow under it showing round the sides of a slab
     * floating in space. A room is a hole in the ground; this is the ground.
     *
     * Doorways and shafts are left open as short dark passages, so a way out
     * of the room still reads as one from the outside.
     */
    function surround(room, kit, pal) {
        const b = kit.rock;
        const dark = R3D.mixCol(pal.rock[2], '#000000', 0.35);
        const D = 5.2;
        const cz = ROCK_Z + ROCK_D / 2 - D / 2;
        const W = 16, H = 12;
        const mask = F.FRONT | F.LEFT | F.RIGHT | F.TOP | F.BOTTOM;
        const box = function (x0, x1, y0, y1) {
            if (x1 - x0 <= 0 || y1 - y0 <= 0) return;
            b.box((x0 + x1) / 2, (y0 + y1) / 2, cz, x1 - x0, y1 - y0, D, dark, mask);
        };
        const doorLo = C.ROWS - 1 - 3, doorHi = C.ROWS - 1;      // world y of the door band
        const shaftL = TNT.Paint.SHAFT_COLS[0], shaftR = TNT.Paint.SHAFT_COLS[1] + 1;

        for (const side of [-1, 1]) {
            const x0 = side < 0 ? -W : C.COLS;
            const x1 = side < 0 ? 0 : C.COLS + W;
            const door = room.get(side < 0 ? 0 : C.COLS - 1, TNT.Paint.DOOR_ROWS[1]) !== T.ROCK;
            if (door) {
                box(x0, x1, -H, C.ROWS - doorHi);
                box(x0, x1, C.ROWS - doorLo, C.ROWS + H);
                // The passage beyond the doorway: a dark back and a roof.
                b.box((x0 + x1) / 2, (2 * C.ROWS - doorHi - doorLo) / 2, ROCK_Z - 1.6, W, 3, 0.2,
                      R3D.mixCol(pal.rock[2], '#000000', 0.7), F.FRONT);
            } else {
                box(x0, x1, -H, C.ROWS + H);
            }
        }
        for (const top of [false, true]) {
            const y0 = top ? C.ROWS : -H;
            const y1 = top ? C.ROWS + H : 0;
            const shaft = room.get(shaftL, top ? 0 : C.ROWS - 1) !== T.ROCK;
            if (shaft) {
                box(0, shaftL, y0, y1);
                box(shaftR, C.COLS, y0, y1);
                b.box((shaftL + shaftR) / 2, (y0 + y1) / 2, ROCK_Z - 1.6, shaftR - shaftL, H, 0.2,
                      R3D.mixCol(pal.rock[2], '#000000', 0.7), F.FRONT);
            } else {
                box(0, C.COLS, y0, y1);
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
     * A catwalk, per tile.
     *
     * Four parts, and each is doing a job:
     *
     *   - **tread plate on top** — the texture the eye runs along when it
     *     follows a deck, and one that says "made to be walked on";
     *   - **a lit nosing** along the front edge, the brightest line on the
     *     deck, because the top edge of a walkable surface is the thing a
     *     platformer player reads first;
     *   - **a riveted stringer** under it, the deck's visible thickness;
     *   - **a handrail at the back**, behind Tommy, so it never hides him but
     *     does make the deck a *walkway* rather than a shelf.
     *
     * The previous timber decks were a capped board with moss on top: a shelf
     * in a cave. This is a floor in a building, and the difference is most of
     * what the room now says.
     */
    function catwalk(room, kit, pal, tx, ty) {
        const x = R3D.tileX(tx);
        const y = R3D.tileY(ty);
        const iron = R3D.col(pal.iron);
        const ironLit = R3D.col(pal.ironLit);
        const ironDk = R3D.col(pal.ironDark);
        const nosing = R3D.col(pal.brassLit);
        const rivet = R3D.col(pal.brass);
        const front = TRIM_Z + TRIM_D / 2 + 0.14;
        const leftEnd = room.get(tx - 1, ty) !== T.PLATFORM;
        const rightEnd = room.get(tx + 1, ty) !== T.PLATFORM;

        // Tread plate, slightly deeper than the body so it overhangs.
        kit.tread.box(x, y + 0.42, TRIM_Z + 0.07, 1, 0.12, TRIM_D + 0.28, iron, F.SLAB, ironLit);
        // Nosing.
        kit.plain.box(x, y + 0.475, front + 0.005, 1, 0.05, 0.05, nosing, F.FRONT | F.TOP);
        // Stringer: a channel section, face plate and a darker return under it.
        kit.plate.box(x, y + 0.2, front - 0.04, 1, 0.32, 0.08, iron, F.SLAB, ironLit);
        kit.plain.box(x, y + 0.05, TRIM_Z, 1, 0.06, TRIM_D + 0.1, ironDk, F.SLAB);
        for (const rx of [-0.25, 0.25]) {
            kit.plain.sphere(x + rx, y + 0.2, front + 0.005, 0.038, rivet, 6, 4);
        }

        // Handrail: a post every other tile, a top rail and a knee rail.
        const railZ = TRIM_Z - TRIM_D / 2 - 0.02;
        if (tx % 3 === 0 || leftEnd || rightEnd) {
            kit.plain.box(x, y + 0.8, railZ, 0.06, 0.7, 0.06, ironDk, F.SLAB);
        }
        kit.plain.cyl(x, y + 1.14, railZ, 0.035, 1.02, 'x', iron, 6, ironLit);

        // End plates, so a run finishes as a made thing rather than a cut.
        for (const end of [leftEnd ? -1 : 0, rightEnd ? 1 : 0]) {
            if (!end) continue;
            kit.plate.box(x + end * 0.5, y + 0.3, TRIM_Z + 0.07, 0.08, 0.36, TRIM_D + 0.28,
                          ironDk, F.SLAB, ironLit);
        }

        /*
         * Hangers: a rod from each end of a run, and every six tiles along a
         * long one, up to the first thing above that could carry it.
         *
         * Without them a deck floats; with them the whole room becomes one
         * structure hanging off the roof, and the decks read as *built into*
         * the space rather than placed in it. The scan stops at the first
         * floor it meets, so a rod never passes through another deck.
         */
        if (leftEnd || rightEnd) {
            let top = ty - 1;
            while (top > 0 && !Tiles.isFloor(room.get(tx, top)) && ty - top < 12) top--;
            if (Tiles.isFloor(room.get(tx, top)) && ty - top >= 2) {
                const y0 = R3D.tileY(top) - 0.5;
                const y1 = y + 0.5;
                const rx = x + (leftEnd ? 0.2 : rightEnd ? -0.2 : 0);
                kit.plain.cyl(rx, (y0 + y1) / 2, TRIM_Z - 0.3, 0.035, y0 - y1, 'y', ironDk, 6);
                kit.plain.box(rx, y1 + 0.04, TRIM_Z - 0.3, 0.16, 0.08, 0.16, ironLit, F.SLAB);
                kit.plain.box(rx, y0 - 0.04, TRIM_Z - 0.3, 0.16, 0.08, 0.16, ironLit, F.SLAB);
            }
        }

        /*
         * Contact shading: a dark band hanging just under the deck, on the
         * wall side. Cheap — one unlit quad — and it does more for grounding
         * than any amount of lighting.
         */
        kit.shade.box(x, y - 0.1, TRIM_Z - 0.7, 1.2, 0.6, 0.02, R3D.col('#6a5c50'), F.FRONT);
    }

    /**
     * @param {object} kit  the room's builders — see `RoomMesh.build`
     */
    function trim(room, kit, pal, lights) {
        const b = kit.wood;
        const p = kit.plain;
        const g = kit.glow;
        const liquid = kit.liquid;
        const timber = R3D.col(pal.timber);
        const rail = R3D.col(pal.ladder);
        const railLit = R3D.col(pal.ironLit);
        const rung = R3D.mixCol(pal.ironLit, pal.brassLit, 0.4);
        const cable = R3D.col(pal.rope);
        const chainA = R3D.col(pal.ironLit);
        const chainB = R3D.col(pal.iron);
        const beltCol = R3D.col('#2e2e33');
        const beltTread = R3D.col('#4a4a52');

        for (let ty = 0; ty < C.ROWS; ty++) {
            for (let tx = 0; tx < C.COLS; tx++) {
                const t = room.get(tx, ty);
                if (t === T.EMPTY || t === T.ROCK || t === T.CRACKED) continue;

                const x = R3D.tileX(tx);
                const y = R3D.tileY(ty);

                switch (t) {
                    // Rotten grating is *not* baked into the terrain. It has to
                    // shake before it gives way, and a merged buffer cannot
                    // animate one tile — `Actors3D` draws it from the live
                    // crumble state instead.
                    case T.CRUMBLE:
                        break;

                    case T.PLATFORM:
                        catwalk(room, kit, pal, tx, ty);
                        break;

                    case T.RAIL: {
                        /*
                         * A live rail: a catwalk carrying two copper conductors
                         * on white insulators. The copper and the pots are the
                         * tell before it ever sparks — nothing else on a deck
                         * is that colour.
                         */
                        catwalk(room, kit, pal, tx, ty);
                        const copper = R3D.col('#d07a3a'), copperLit = R3D.col('#ffb070');
                        for (const dz of [-0.18, 0.18]) {
                            p.box(x, y + 0.56, TRIM_Z + 0.07 + dz, 1, 0.05, 0.05, copper, F.ALL, copperLit);
                        }
                        for (const dz of [-0.18, 0.18]) {
                            p.cyl(x, y + 0.51, TRIM_Z + 0.07 + dz, 0.05, 0.08, 'y', R3D.col('#e8e4d8'), 8);
                        }
                        break;
                    }

                    case T.FAN: {
                        // The housing, flush with the floor; the blades turn in `Actors3D`.
                        const iron = R3D.col(pal.iron), ironLit = R3D.col(pal.ironLit);
                        p.cyl(x, y - 0.42, TRIM_Z, 0.48, 0.16, 'y', iron, 18, ironLit);
                        p.cyl(x, y - 0.36, TRIM_Z, 0.42, 0.04, 'y', R3D.col(pal.ironDark), 18);
                        for (let i = -2; i <= 2; i++) {
                            p.box(x + i * 0.16, y - 0.33, TRIM_Z, 0.03, 0.03, 0.8, ironLit, F.SLAB);
                        }
                        g.cyl(x, y - 0.37, TRIM_Z, 0.36, 0.01, 'y', R3D.mixCol(pal.glass, '#000000', 0.7), 16);
                        break;
                    }

                    case T.LADDER: {
                        /*
                         * A steel ladder: flat-bar stiles, round rungs proud of
                         * them, and a stand-off bracket back to the structure
                         * every other row. The stiles are the lit edge the eye
                         * follows up a shaft.
                         */
                        for (const sx of [-0.3, 0.3]) {
                            p.box(x + sx, y, TRIM_Z, 0.07, 1, 0.16, rail, F.SLAB, railLit);
                            p.box(x + sx + (sx < 0 ? -0.02 : 0.02), y, TRIM_Z + 0.09, 0.03, 1, 0.02,
                                  railLit, F.FRONT);
                        }
                        for (let r = 0; r < 3; r++) {
                            p.cyl(x, y - 0.33 + r * 0.33, TRIM_Z + 0.03, 0.04, 0.6, 'x', rung, 6);
                        }
                        if (ty % 2 === 0) {
                            p.box(x - 0.3, y + 0.2, TRIM_Z - 0.4, 0.05, 0.05, 0.7, R3D.col(pal.ironDark), F.SLAB);
                            p.box(x + 0.3, y + 0.2, TRIM_Z - 0.4, 0.05, 0.05, 0.7, R3D.col(pal.ironDark), F.SLAB);
                        }
                        break;
                    }

                    case T.VINE: {
                        /*
                         * A hanging chain — the works' climbing rope. Heavier
                         * links than the dressing chains, alternating their
                         * plane the way a chain hangs, with a hook at the foot.
                         * It is climbed slower than a ladder, and looking like
                         * something you haul yourself up hand over hand is how
                         * it says so.
                         */
                        for (let k = 0; k < 4; k++) {
                            const ly = y + 0.375 - k * 0.25;
                            const flat = (ty * 4 + k) % 2 === 0;
                            p.cyl(x, ly, TRIM_Z, 0.11, 0.05, flat ? 'z' : 'x', flat ? chainA : chainB, 8);
                        }
                        if (room.get(tx, ty + 1) !== T.VINE) {
                            p.cyl(x, y - 0.55, TRIM_Z, 0.04, 0.3, 'y', chainB, 6);
                            p.cone(x + 0.08, y - 0.78, TRIM_Z, 0.1, 0.2, chainA, false, 6);
                        }
                        break;
                    }

                    case T.ROPE: {
                        // A steel cable, with a pulley block where it ends.
                        p.cyl(x, y + 0.22, TRIM_Z, 0.045, 1, 'x', cable, 6);
                        for (const d of [-1, 1]) {
                            if (room.get(tx + d, ty) === T.ROPE) continue;
                            p.cyl(x + d * 0.42, y + 0.22, TRIM_Z, 0.16, 0.14, 'z', R3D.col(pal.brass), 10,
                                  R3D.col(pal.brassLit));
                            p.box(x + d * 0.42, y + 0.5, TRIM_Z, 0.06, 0.5, 0.06, R3D.col(pal.ironDark), F.SLAB);
                        }
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
     * Dressing
     * ------------------------------------------------------------------ */

    /**
     * The things a works leaves lying about: drums and crates on the floor,
     * cable slung across the roof, chains hanging off it, a few stalactites
     * where the rock is still raw, and crystal seams in it.
     *
     * All of it sits *behind* the play plane and none of it collides. Drums
     * and crates in particular are kept well back and darker than anything you
     * can stand on — a box at the player's depth is a box the player will try
     * to jump on.
     *
     * Placed off the room's seeded RNG, so a room looks the same on every load.
     */
    function decor(room, kit, pal, lights, rng) {
        const b = kit.wood;
        const p = kit.plain;
        const g = kit.glow;
        const iron = R3D.col(pal.iron);
        const ironLit = R3D.col(pal.ironLit);
        const ironDk = R3D.col(pal.ironDark);
        const BACK = -1.9;

        // Drums and crates along the floor, back against the wall.
        for (let attempt = 0, made = 0; attempt < 80 && made < 5; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = C.ROWS - 2;
            if (room.get(tx, ty) !== T.EMPTY || !isRock(room, tx, ty + 1)) continue;
            const x = R3D.tileX(tx) + rng.range(-0.3, 0.3);
            const y = R3D.tileY(ty) - 0.5;
            if (rng.chance(0.55)) {
                // An oil drum: body, two rolling hoops, a lid.
                const drum = rng.chance(0.5) ? R3D.col(pal.paint) : iron;
                p.cyl(x, y + 0.42, BACK, 0.32, 0.84, 'y', drum, 12, ironLit);
                for (const hy of [0.22, 0.62]) p.cyl(x, y + hy, BACK, 0.335, 0.05, 'y', ironLit, 12);
                if (rng.chance(0.5)) {
                    p.cyl(x + 0.62, y + 0.32, BACK - 0.1, 0.3, 0.64, 'y', iron, 12, ironLit);
                }
            } else {
                const s = rng.range(0.6, 0.85);
                b.box(x, y + s / 2, BACK, s, s, s, R3D.col(pal.timber), F.SLAB, R3D.col(pal.timberTop));
                b.box(x, y + s / 2, BACK + s / 2 + 0.01, s * 0.9, 0.08, 0.02, R3D.col(pal.timberTop), F.FRONT);
                if (rng.chance(0.5)) {
                    const s2 = s * 0.7;
                    b.box(x + rng.range(-0.1, 0.1), y + s + s2 / 2, BACK, s2, s2, s2,
                          R3D.col(pal.timber), F.SLAB, R3D.col(pal.timberTop));
                }
            }
            made++;
        }

        /*
         * Cable slung under the roof: a catenary of short segments between two
         * points. The one curve in a room built out of straight steel, and it
         * is what stops the top of the frame being a ruler line.
         */
        for (let i = 0; i < 2; i++) {
            const x0 = rng.range(2, C.COLS * 0.45);
            const x1 = x0 + rng.range(8, 18);
            const yTop = C.ROWS - 1.3 - rng.range(0, 0.6);
            const sag = rng.range(0.8, 1.8);
            const z = -2.1 - i * 0.2;
            const segs = 18;
            for (let k = 0; k < segs; k++) {
                const a = k / segs, bb = (k + 1) / segs;
                const xa = x0 + (x1 - x0) * a, xb = x0 + (x1 - x0) * bb;
                const ya = yTop - sag * 4 * a * (1 - a), yb = yTop - sag * 4 * bb * (1 - bb);
                const len = Math.hypot(xb - xa, yb - ya);
                p.rbox((xa + xb) / 2, (ya + yb) / 2, z, len + 0.02, 0.06, 0.06,
                       Math.atan2(yb - ya, xb - xa), ironDk);
            }
        }

        // Chains hanging from the roof, well behind the play plane.
        for (let attempt = 0, made = 0; attempt < 120 && made < 4; attempt++) {
            const tx = rng.int(2, C.COLS - 3);
            const ty = rng.int(0, C.ROWS - 12);
            if (!isRock(room, tx, ty) || room.get(tx, ty + 1) !== T.EMPTY) continue;
            const len = rng.range(1.4, 3.8);
            const x = R3D.tileX(tx);
            const top = R3D.tileY(ty) - 0.5;
            const z = -1.6;
            const links = Math.max(3, Math.round(len / 0.19));
            for (let k = 0; k < links; k++) {
                const ly = top - 0.1 - k * (len / links);
                b.cyl(x, ly, z, 0.075, 0.045, k % 2 === 0 ? 'z' : 'x', k % 2 ? iron : ironLit, 7);
            }
            p.cone(x + 0.06, top - len - 0.2, z, 0.1, 0.24, ironLit, false, 6);
            made++;
        }

        // Stalactites, sparingly, and only off raw rock.
        for (let attempt = 0, made = 0; attempt < 120 && made < 6; attempt++) {
            const tx = rng.int(1, C.COLS - 2);
            const ty = rng.int(0, C.ROWS - 10);
            if (!isRock(room, tx, ty) || room.get(tx, ty + 1) !== T.EMPTY) continue;
            /*
             * Darker than the wall they hang off and set back into it. These
             * share a silhouette with a spike bed, and of the two it is the
             * spike that has to win the eye, so the scenery gives way.
             */
            const len = rng.range(0.4, 1.1);
            const x = R3D.tileX(tx) + rng.range(-0.2, 0.2);
            const y = R3D.tileY(ty) - 0.5 - len / 2;
            kit.rock.cone(x, y, -1.2, rng.range(0.12, 0.2), len,
                          R3D.mixCol(pal.rock[2], '#000000', 0.35), false, 7);
            made++;
        }

        /*
         * Crystal seams in the rock — carried over from the Godot build, and
         * kept as *scenery*: they grow out of rock faces, never float in open
         * air, and are pitched darker than any pickup so they never ask the
         * player to collect them.
         */
        const crystalCols = pal.crystal.map(R3D.col);
        const FACES_OUT = [[0, -1, 0, -0.5], [0, 1, 0, 0.5], [-1, 0, -0.5, 0], [1, 0, 0.5, 0]];
        for (let attempt = 0, made = 0; attempt < 260 && made < 5; attempt++) {
            const tx = rng.int(1, C.COLS - 2);
            const ty = rng.int(1, C.ROWS - 2);
            if (!isRock(room, tx, ty)) continue;
            const open = FACES_OUT.filter(function (f) {
                return room.get(tx + f[0], ty + f[1]) === T.EMPTY;
            });
            if (!open.length) continue;
            const face = rng.pick(open);
            const colour = rng.pick(crystalCols).clone().multiplyScalar(0.5);
            const s = rng.range(0.12, 0.18);
            const x = R3D.tileX(tx) + face[2] * 0.8 + rng.range(-0.2, 0.2);
            const y = R3D.tileY(ty) - face[3] * 0.8 + rng.range(-0.2, 0.2);
            const z = ROCK_Z + ROCK_D / 2 - 0.1;
            for (let k = 0; k < 3; k++) {
                g.gem(x + rng.range(-0.22, 0.22), y + rng.range(-0.18, 0.18), z + rng.range(0, 0.25),
                      s * rng.range(0.6, 1), s * rng.range(1.6, 2.6), colour, 6);
            }
            made++;
        }

        void ironDk; void lights;
    }

    RoomMesh.TRIM_Z = TRIM_Z;
    TNT.RoomMesh = RoomMesh;
})(window.TNT = window.TNT || {}, window.THREE);
