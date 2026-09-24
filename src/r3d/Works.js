/**
 * TNT Tommy — the works: everything behind the playfield.
 *
 * The rooms used to stand in front of a painted cave with daylight coming down
 * through a hole in the roof. It read as outdoors, and it was one flat picture,
 * so however much was drawn on it there was nothing *between* the decks and the
 * back of the world. This replaces it with three real layers, built per room:
 *
 *      z ≈ -2.6 … -3.4   THE WALL      masonry and plate, lit by the lamp pool,
 *                                      with girder columns, pipework, gauges and
 *                                      lamps bolted to it
 *      z ≈ -8  … -22     THE HALL      a machine hall seen *through* openings
 *                                      in the wall: gears turning, boilers,
 *                                      stacks, trusses, a furnace glow below
 *      z ≈ -34           THE DARK      a graded far wall, lit from beneath
 *
 * The openings are the point. A wall with nothing behind it is a box; a wall
 * with windows onto a much bigger space behind it is somewhere, and the room
 * in front becomes one small part of a large working. Under the camera's slight
 * drift the three layers move against one another, which is the depth the flat
 * backdrop never had.
 *
 * The hall is unlit. It is well outside the reach of the lamp pool, and grading
 * its colours in at build time (`Builder.grade`) is both cheaper and more
 * controllable than lighting it: each vertex is pushed toward the air colour by
 * its depth and toward the furnace glow by its height.
 *
 * Everything is placed off the room's seeded RNG, so a room looks the same on
 * every load and a capture before a change compares with one after it.
 */
(function (TNT, THREE) {
    'use strict';

    const { C, R3D, Tiles } = TNT;
    const T = C.Tile;
    const F = R3D.FACE;

    /** Front face of the built wall. */
    const WALL_Z = -3.4;
    /** Columns and girders stand just proud of it. */
    const FRAME_Z = -2.95;
    /** Pipework runs in front of the columns. */
    const PIPE_Z = -2.45;
    /** The far wall, and how much bigger than the room it has to be to fill the view. */
    const DARK_Z = -34;

    const Works = {};

    /**
     * @returns {{group: THREE.Group, lights: Array, emitters: Array, update: function(number)}}
     *   `emitters` are points the scene puffs steam or drips water from;
     *   `update(t)` turns the machinery.
     */
    Works.build = function (room, pal, rng) {
        const group = new THREE.Group();
        const lights = [];
        const emitters = [];
        const spinners = [];

        const wall = new R3D.Builder();       // masonry, lit
        const plate = new R3D.Builder();      // riveted plate, lit
        const metal = new R3D.Builder();      // untextured fittings, lit
        const glow = new R3D.Builder();       // additive
        const hall = new R3D.Builder();       // unlit, graded

        const openings = chooseOpenings(room, rng);
        const columns = chooseColumns(openings, rng);

        buildWall(room, wall, plate, openings, pal);
        buildFrames(metal, plate, openings, columns, pal);
        buildPipes(room, metal, glow, openings, emitters, pal, rng);
        // A blackout room has its fittings but none of them lit.
        if (!room.dark) buildLamps(room, metal, glow, columns, lights, pal, rng);
        buildHall(hall, group, spinners, pal, rng);
        setPiece(room.works, hall, glow, group, spinners, pal, rng);
        gradeHall(hall, pal);

        const add = function (b, name, material, order) {
            if (b.isEmpty()) return null;
            const mesh = new THREE.Mesh(b.geometry(), material);
            mesh.name = name;
            if (order !== undefined) mesh.renderOrder = order;
            group.add(mesh);
            return mesh;
        };

        group.add(darkWall(pal));
        for (const l of lights) if (l.beam) group.add(beamMesh(l.beam, pal));
        add(hall, 'hall', hallMaterial(), -4);
        add(wall, 'wall', R3D.solidMaterial('masonry'));
        add(plate, 'wall-plate', R3D.solidMaterial('plate'));
        add(metal, 'wall-metal', R3D.solidMaterial(null));
        add(glow, 'wall-glow', R3D.glowMaterial(0.9), 3);

        return {
            group: group,
            lights: lights,
            emitters: emitters,
            update: function (t) {
                for (const s of spinners) {
                    if (s.spin) s.mesh.rotation.z = s.phase + t * s.spin;
                    if (s.stroke) s.mesh.position.y = s.baseY + Math.sin(t * s.rate + s.phase) * s.stroke;
                    if (s.travel) {
                        const k = 0.5 + 0.5 * Math.sin(t * s.travel.rate + s.phase);
                        s.mesh.position.x = s.travel.from + (s.travel.to - s.travel.from) * k;
                    }
                }
            }
        };
    };

    /* ------------------------------------------------------------------ *
     * Openings
     * ------------------------------------------------------------------ */

    /**
     * Two or three windows onto the hall, placed where the room in front of
     * them is mostly open air.
     *
     * An opening behind a mass of rock is invisible and wasted; one behind a
     * busy deck is glimpsed through the gaps, which is fine — that is exactly
     * how you see into a space in a real building. So the test is only that the
     * rectangle is not mostly solid.
     */
    function chooseOpenings(room, rng) {
        const found = [];
        for (let attempt = 0; attempt < 90 && found.length < 3; attempt++) {
            const w = rng.int(6, 11);
            const h = rng.int(5, 9);
            const x = rng.int(2, C.COLS - 2 - w);
            const y = rng.int(2, C.ROWS - 4 - h);

            let solid = 0;
            for (let ty = y; ty < y + h; ty++) {
                for (let tx = x; tx < x + w; tx++) {
                    if (Tiles.isSolid(room.get(tx, ty))) solid++;
                }
            }
            if (solid > w * h * 0.12) continue;

            const clash = found.some(function (o) {
                return x < o.x + o.w + 3 && o.x < x + w + 3 && y < o.y + o.h + 2 && o.y < y + h + 2;
            });
            if (clash) continue;
            found.push({ x: x, y: y, w: w, h: h });
        }
        return found;
    }

    function inOpening(openings, tx, ty) {
        for (const o of openings) {
            if (tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h) return o;
        }
        return null;
    }

    /**
     * Girder columns, every seven to ten tiles, never across an opening.
     * Columns either side of a window are what turns a hole in the wall into a
     * bay of a building.
     */
    function chooseColumns(openings, rng) {
        const cols = [];
        for (let x = rng.int(3, 6); x < C.COLS - 3; x += rng.int(7, 10)) {
            const blocked = openings.some(function (o) { return x >= o.x - 1 && x <= o.x + o.w; });
            if (!blocked) cols.push(x);
        }
        return cols;
    }

    /* ------------------------------------------------------------------ *
     * The wall
     * ------------------------------------------------------------------ */

    /**
     * Masonry above, plate below, emitted as horizontal runs between openings.
     *
     * The plate band along the bottom is a wainscot — the lower courses of any
     * working wall get armoured, because that is where the barrows hit it — and
     * it earns its place visually by breaking the wall into two materials, so
     * the largest surface in the room is not one repeating texture.
     */
    function buildWall(room, wall, plate, openings, pal) {
        const masonry = R3D.col(pal.masonry);
        const masonryDk = R3D.col(pal.masonryDark);
        const iron = R3D.col(pal.iron);
        const WAINSCOT = C.ROWS - 5;         // rows at or below this are plate
        const DEPTH = 1.0;
        const cz = WALL_Z - DEPTH / 2;

        for (let ty = 1; ty < C.ROWS - 1; ty++) {
            let tx = 1;
            while (tx < C.COLS - 1) {
                if (inOpening(openings, tx, ty)) { tx++; continue; }
                let run = 1;
                while (tx + run < C.COLS - 1 && !inOpening(openings, tx + run, ty)) run++;

                // Reveal faces only where the run borders an opening.
                let mask = F.FRONT;
                if (inOpening(openings, tx - 1, ty)) mask |= F.LEFT;
                if (inOpening(openings, tx + run, ty)) mask |= F.RIGHT;
                if (spanOpen(openings, tx, run, ty - 1)) mask |= F.TOP;
                if (spanOpen(openings, tx, run, ty + 1)) mask |= F.BOTTOM;

                const b = ty >= WAINSCOT ? plate : wall;
                /*
                 * Held well down. The wall is the largest surface in the room
                 * and it is *behind* the play, so it has to be the quietest
                 * thing on screen — the lamps pool on it, and that is all the
                 * light it should have.
                 */
                const shade = ty >= WAINSCOT ? R3D.mixCol(pal.iron, '#000000', 0.35)
                    : R3D.mixCol(R3D.mixHex(pal.masonry, pal.masonryDark, ((ty * 7) % 5) / 10),
                                 '#000000', 0.4);
                b.box(tx + run / 2, R3D.tileY(ty), cz, run, 1, DEPTH, shade, mask);
                tx += run;
            }
        }

        /*
         * String courses: a projecting band every few rows. They do for the
         * wall what the deck lip does for a platform — a lit top edge and a
         * shadow under it — and they give the eye horizontals to measure the
         * room's height against.
         */
        for (const ty of [6, 12]) {
            let tx = 1;
            while (tx < C.COLS - 1) {
                if (inOpening(openings, tx, ty)) { tx++; continue; }
                let run = 1;
                while (tx + run < C.COLS - 1 && !inOpening(openings, tx + run, ty)) run++;
                wall.box(tx + run / 2, R3D.tileY(ty) + 0.42, WALL_Z + 0.1, run, 0.26, 0.2,
                         masonryDk, F.SLAB, masonry);
                tx += run;
            }
        }
        // The cap of the wainscot.
        plate.box(C.COLS / 2, R3D.tileY(WAINSCOT) + 0.5, WALL_Z + 0.08, C.COLS - 2, 0.14, 0.16,
                  R3D.col(pal.ironLit), F.SLAB, R3D.col(pal.brassLit));
    }

    function spanOpen(openings, tx, run, ty) {
        for (let i = 0; i < run; i++) if (inOpening(openings, tx + i, ty)) return true;
        return false;
    }

    /* ------------------------------------------------------------------ *
     * Columns, girders, window frames
     * ------------------------------------------------------------------ */

    /**
     * An I-section column: a front flange you see face-on, a web behind it,
     * and a back flange you only catch at the edges.
     *
     * The paint is the palette's `paint` — red oxide in Copperlode, teal in
     * Blackdamp — and it is the one saturated colour on the wall. That is
     * deliberate: the columns are the rhythm of the room, and giving them a
     * colour the rock and the masonry do not have makes the rhythm legible.
     */
    function column(b, x, y0, y1, pal) {
        const paint = R3D.col(pal.paint);
        const paintLit = R3D.col(pal.paintLit);
        const dark = R3D.mixCol(pal.paint, '#000000', 0.45);
        const rivet = R3D.col(pal.brassLit);
        const h = y1 - y0;
        const cy = (y0 + y1) / 2;

        b.box(x, cy, FRAME_Z + 0.16, 0.62, h, 0.1, paint, F.SLAB, paintLit);   // front flange
        b.box(x, cy, FRAME_Z - 0.1, 0.12, h, 0.42, dark, F.SLAB);             // web
        b.box(x, cy, FRAME_Z - 0.34, 0.62, h, 0.1, dark, F.SLAB);             // back flange
        // Splice plates and their rivets, every few tiles.
        for (let y = y0 + 2; y < y1 - 1; y += 4) {
            b.box(x, y, FRAME_Z + 0.23, 0.7, 0.5, 0.05, paintLit, F.SLAB, paintLit);
            for (const sx of [-0.22, 0.22]) {
                for (const sy of [-0.15, 0.15]) {
                    b.sphere(x + sx, y + sy, FRAME_Z + 0.27, 0.045, rivet, 6, 4);
                }
            }
        }
        // Base plate and footing.
        b.box(x, y0 + 0.1, FRAME_Z, 1.0, 0.2, 0.7, R3D.col(pal.ironDark), F.SLAB, R3D.col(pal.iron));
    }

    function buildFrames(metal, plate, openings, columns, pal) {
        const top = C.ROWS - 1;              // underside of the ceiling row
        const floor = 1;                     // top of the bedrock row
        const iron = R3D.col(pal.iron);
        const ironLit = R3D.col(pal.ironLit);
        const ironDk = R3D.col(pal.ironDark);
        const rivet = R3D.col(pal.brassLit);

        for (const x of columns) column(metal, x + 0.5, floor, top, pal);

        /*
         * The header girder under the ceiling, and knee braces down to each
         * column. It is what ties the columns into a frame; without it they
         * are posts, and posts do not say "building".
         */
        const hy = top - 0.35;
        metal.box(C.COLS / 2, hy, FRAME_Z + 0.1, C.COLS - 2, 0.55, 0.16, R3D.col(pal.paint), F.SLAB,
                  R3D.col(pal.paintLit));
        metal.box(C.COLS / 2, hy - 0.3, FRAME_Z + 0.1, C.COLS - 2, 0.08, 0.3, R3D.col(pal.paintLit), F.SLAB);
        for (let x = 2; x < C.COLS - 1; x += 1.5) {
            metal.sphere(x, hy + 0.12, FRAME_Z + 0.2, 0.04, rivet, 6, 4);
        }
        for (const x of columns) {
            for (const s of [-1, 1]) {
                metal.rbox(x + 0.5 + s * 0.75, hy - 0.75, FRAME_Z + 0.08, 1.7, 0.16, 0.12,
                           -s * Math.PI / 4, R3D.col(pal.paint), R3D.col(pal.paintLit));
            }
        }

        /*
         * Window frames: a riveted girder round the opening, and a grid of
         * glazing bars across it.
         *
         * The bars do a lot. An empty rectangle cut in a wall reads as a hole;
         * the same rectangle with mullions and a transom reads as a *window*,
         * and a window implies a room beyond it — which is the entire job the
         * opening has.
         */
        for (const o of openings) {
            const x0 = o.x, x1 = o.x + o.w;
            const yTop = C.ROWS - o.y, yBot = C.ROWS - (o.y + o.h);
            const cx = (x0 + x1) / 2, cy = (yTop + yBot) / 2;
            const z = WALL_Z + 0.02;

            // Lintel, sill, jambs.
            plate.box(cx, yTop + 0.22, z, o.w + 0.8, 0.44, 0.34, iron, F.SLAB, ironLit);
            plate.box(cx, yBot - 0.16, z, o.w + 0.8, 0.32, 0.4, iron, F.SLAB, ironLit);
            for (const x of [x0 - 0.2, x1 + 0.2]) {
                plate.box(x, cy, z, 0.4, o.h + 0.6, 0.34, iron, F.SLAB, ironLit);
            }
            for (let x = x0; x <= x1; x += 1) {
                metal.sphere(x, yTop + 0.22, z + 0.19, 0.045, rivet, 6, 4);
            }

            // Glazing bars. Some panes are out — the ones left are dark glass.
            const bz = WALL_Z - 0.3;
            for (let x = x0 + 2; x < x1 - 0.5; x += 2) {
                metal.box(x, cy, bz, 0.09, o.h, 0.09, ironDk, F.SLAB);
            }
            metal.box(cx, yBot + o.h * 0.62, bz, o.w, 0.1, 0.09, ironDk, F.SLAB);
        }
    }

    /* ------------------------------------------------------------------ *
     * Pipework
     * ------------------------------------------------------------------ */

    /**
     * Two or three pipe runs across the wall, each with flanges, brackets, a
     * drop to the floor or the roof at one end, a valve wheel and a gauge.
     *
     * A few of the flanges weep steam. They are returned as emitters rather
     * than drawn, because steam has to move and the scene's particle pool is
     * where moving things live.
     */
    function buildPipes(room, metal, glow, openings, emitters, pal, rng) {
        const runs = rng.int(2, 3);
        const used = [];
        for (let i = 0; i < runs; i++) {
            let row = 0;
            for (let tries = 0; tries < 10; tries++) {
                row = rng.int(3, C.ROWS - 4);
                if (!used.some(function (r) { return Math.abs(r - row) < 4; })) break;
            }
            used.push(row);

            const y = R3D.tileY(row);
            const r = rng.range(0.14, 0.24);
            const x0 = rng.int(1, 10);
            const x1 = rng.int(C.COLS - 11, C.COLS - 1);
            const copper = i % 2 === 0;
            const col = R3D.col(copper ? pal.pipe : pal.iron);
            const lit = R3D.col(copper ? pal.pipeLit : pal.ironLit);
            const z = PIPE_Z - i * 0.18;

            metal.cyl((x0 + x1) / 2, y, z, r, x1 - x0, 'x', col, 10, lit);
            for (let x = x0 + 2; x < x1 - 1; x += rng.int(3, 5)) {
                metal.cyl(x, y, z, r * 1.45, 0.16, 'x', lit, 10, lit);          // flange
                metal.box(x + 0.35, y - r - 0.12, z - 0.2, 0.12, 0.3, 0.45,
                          R3D.col(pal.ironDark), F.SLAB);                        // bracket
                if (rng.chance(0.22)) emitters.push({ x: x, y: y + r, z: z + 0.2, kind: 'steam' });
            }

            // The drop at one end, down to the floor or up to the roof.
            const end = rng.chance(0.5) ? x0 : x1;
            const down = rng.chance(0.5);
            const yEnd = down ? 1 : C.ROWS - 1;
            const len = Math.abs(yEnd - y);
            metal.cyl(end, (y + yEnd) / 2, z, r, len, 'y', col, 10, lit);
            metal.sphere(end, y, z, r * 1.25, lit, 10, 7);                        // elbow

            // A handwheel on the run: a rim of short bars and four spokes.
            const vx = x0 + (x1 - x0) * rng.range(0.25, 0.75);
            const wr = 0.34;
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * Math.PI * 2;
                metal.rbox(vx + Math.cos(a) * wr, y + r + 0.5 + Math.sin(a) * wr, z + 0.2,
                           0.2, 0.07, 0.07, a + Math.PI / 2, R3D.col(pal.signal));
            }
            for (let k = 0; k < 4; k++) {
                metal.rbox(vx, y + r + 0.5, z + 0.2, wr * 2, 0.05, 0.05, k * Math.PI / 4,
                           R3D.col(pal.ironDark));
            }
            metal.cyl(vx, y + r + 0.24, z, 0.07, 0.34, 'y', col, 6);
            metal.cyl(vx, y, z, r * 1.3, 0.34, 'x', lit, 10);                   // valve body

            // A pressure gauge, its face faintly lit.
            const gx = x0 + (x1 - x0) * rng.range(0.1, 0.9);
            if (!inOpening(openings, Math.floor(gx), row + 1)) {
                metal.cyl(gx, y - r - 0.42, z + 0.05, 0.08, 0.3, 'y', col, 6);
                metal.cyl(gx, y - r - 0.8, z + 0.1, 0.27, 0.14, 'z', R3D.col(pal.brass), 14,
                          R3D.col(pal.ironDark));
                glow.cyl(gx, y - r - 0.8, z + 0.18, 0.2, 0.02, 'z',
                         R3D.mixCol(pal.glass, '#000000', 0.55), 14);
                glow.rbox(gx + 0.06, y - r - 0.76, z + 0.2, 0.18, 0.025, 0.02, 0.7,
                          R3D.col(pal.signal));
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Lamps
     * ------------------------------------------------------------------ */

    /**
     * Bulkhead lamps on the columns, and pendant lamps hung off the roof.
     *
     * The bulkheads light the wall — which is what shows the masonry and the
     * pipework at all — and the pendants throw a visible cone down through the
     * air. A lamp in a dark hall that lights nothing but its own glass is a
     * sticker; one with a beam under it is a light.
     */
    function buildLamps(room, metal, glow, columns, lights, pal, rng) {
        const ironDk = R3D.col(pal.ironDark);
        const brass = R3D.col(pal.brass);
        const glass = R3D.col(pal.glass);

        for (const x of columns) {
            const row = rng.int(6, 15);
            const cx = x + 0.5, cy = R3D.tileY(row);
            const z = FRAME_Z + 0.3;
            metal.box(cx, cy, z, 0.5, 0.62, 0.12, ironDk, F.SLAB);                    // back plate
            metal.cyl(cx, cy, z + 0.14, 0.2, 0.22, 'z', brass, 12, brass);            // housing
            glow.cyl(cx, cy, z + 0.27, 0.16, 0.05, 'z', glass, 12);                    // lens
            for (const dy of [-0.08, 0.08]) {
                metal.box(cx, cy + dy, z + 0.3, 0.36, 0.035, 0.035, ironDk, F.SLAB);   // guard
            }
            lights.push({ x: cx, y: cy, z: FRAME_Z + 0.9, colour: pal.lamp, energy: 1.1, range: 10, flicker: 0.06 });
        }

        let hung = 0;
        for (let attempt = 0; attempt < 120 && hung < 3; attempt++) {
            const tx = rng.int(3, C.COLS - 4);
            const ty = rng.int(0, 8);
            if (!Tiles.isSolid(room.get(tx, ty))) continue;
            let clear = 0;
            while (clear < 7 && room.get(tx, ty + 1 + clear) === T.EMPTY) clear++;
            if (clear < 4) continue;

            // Never in front of the Governor's face — a lamp hung there
            // blew it out to a yellow disc.
            if (room.boss && Math.abs(tx - room.boss.at[0]) < 7 && ty < room.boss.at[1] + 5) continue;

            const drop = Math.min(clear - 2.2, rng.range(1.2, 3));
            const x = R3D.tileX(tx);
            const top = R3D.tileY(ty) - 0.5;
            const y = top - drop;
            const z = -0.7;

            metal.cyl(x, top - drop / 2, z, 0.03, drop, 'y', ironDk, 5);              // cable
            metal.cone(x, y, z, 0.5, 0.34, R3D.col(pal.iron), true, 14);              // shade
            metal.cyl(x, y + 0.2, z, 0.1, 0.14, 'y', brass, 8);                        // cap
            glow.sphere(x, y - 0.12, z, 0.13, glass, 10, 6);                           // bulb
            lights.push({ x: x, y: y - 0.3, z: z + 0.4, colour: pal.lamp, energy: 1.35, range: 15, flicker: 0.12,
                          beam: { x: x, y: y - 0.2, z: z, len: Math.min(6, clear - drop) } });
            hung++;
        }
    }

    /**
     * The cone of light under a pendant lamp.
     *
     * An open cone, additive, bright at the lamp and gone by the floor — the
     * falloff is in the vertex colours, so there is no texture to sample and
     * no hard rim where the cone ends. It sits just behind the play plane, so
     * Tommy walks *through* the light rather than in front of a picture of it.
     */
    let _beamGeo = null;
    function beamMesh(beam, pal) {
        if (!_beamGeo) {
            _beamGeo = new THREE.ConeGeometry(1, 1, 24, 6, true);
            _beamGeo.translate(0, -0.5, 0);
            const pos = _beamGeo.attributes.position;
            const cols = new Float32Array(pos.count * 3);
            for (let i = 0; i < pos.count; i++) {
                // y runs 0 at the apex to -1 at the rim.
                const k = Math.pow(1 + pos.getY(i), 1.6);
                cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = k;
            }
            _beamGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
            _beamGeo.userData.shared = true;
        }
        const mat = R3D.cached('beam:' + pal.lamp, function () {
            return new THREE.MeshBasicMaterial({
                color: R3D.mixCol(pal.lamp, '#000000', 0.82),
                vertexColors: true,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
        });
        const mesh = new THREE.Mesh(_beamGeo, mat);
        const len = Math.max(2, beam.len);
        mesh.scale.set(len * 0.42, len, len * 0.2);
        mesh.position.set(beam.x, beam.y, beam.z - 0.3);
        mesh.renderOrder = 4;
        mesh.name = 'beam';
        return mesh;
    }

    /* ------------------------------------------------------------------ *
     * The hall
     * ------------------------------------------------------------------ */

    /**
     * The machine hall behind the wall.
     *
     * Static pieces go into one unlit buffer. Gears and the piston are their
     * own meshes so they can move — the one thing that makes a background read
     * as a *working* rather than as scenery is that some of it is running.
     */
    function buildHall(b, group, spinners, pal, rng) {
        const iron = R3D.col(pal.iron);
        const ironLit = R3D.col(pal.ironLit);
        const ironDk = R3D.col(pal.ironDark);
        const paint = R3D.col(pal.paint);
        const brass = R3D.col(pal.brass);

        // The hall floor, and a gantry running along it.
        b.box(C.COLS / 2, -1.5, -15, C.COLS * 3, 3, 16, ironDk, F.TOP | F.FRONT);

        // Boilers: long riveted drums near the floor, each with a stack.
        const boilers = rng.int(1, 2);
        for (let i = 0; i < boilers; i++) {
            const x = rng.range(4, C.COLS - 4);
            const z = rng.range(-12, -17);
            const r = rng.range(1.6, 2.4);
            const len = rng.range(9, 15);
            b.cyl(x, r + 0.4, z, r, len, 'x', iron, 16, ironLit);
            for (let k = -len / 2 + 1; k < len / 2; k += 1.6) {
                b.cyl(x + k, r + 0.4, z, r * 1.04, 0.2, 'x', ironLit, 16);
            }
            // Firebox glow at the end — the only hot thing in the hall besides the floor.
            b.box(x + len / 2 + 0.05, r * 0.5, z, 0.1, r * 0.6, r * 0.9, R3D.col(pal.deepGlow), F.RIGHT);
            const sh = rng.range(12, 20);
            b.cyl(x - len / 3, r + 0.4 + sh / 2, z, r * 0.3, sh, 'y', ironDk, 12, ironLit);
            b.cyl(x - len / 3, r + 0.4 + sh, z, r * 0.4, 0.4, 'y', ironLit, 12);
        }

        // Stacks and uprights, far and near.
        for (let i = 0; i < 6; i++) {
            const x = rng.range(-6, C.COLS + 6);
            const z = rng.range(-10, -22);
            const r = rng.range(0.35, 0.9);
            b.cyl(x, 12, z, r, 30, 'y', rng.chance(0.5) ? iron : ironDk, 10, ironLit);
            if (rng.chance(0.5)) b.cyl(x, rng.range(6, 18), z, r * 1.3, 0.3, 'y', ironLit, 10);
        }

        /*
         * Trusses spanning the hall: two chords and a zig-zag of diagonals.
         * The one piece of the hall with a strong *horizontal*, and the
         * diagonals are the texture that says "steelwork" at a glance.
         */
        const trusses = rng.int(2, 3);
        for (let i = 0; i < trusses; i++) {
            const y = rng.range(9, 21);
            const z = rng.range(-9, -14);
            const depth = 1.1;
            const x0 = -8, x1 = C.COLS + 8;
            b.box((x0 + x1) / 2, y, z, x1 - x0, 0.16, 0.2, paint);
            b.box((x0 + x1) / 2, y - depth, z, x1 - x0, 0.16, 0.2, paint);
            for (let x = x0; x < x1; x += depth) {
                const up = Math.round((x - x0) / depth) % 2 === 0;
                b.rbox(x + depth / 2, y - depth / 2, z, depth * 1.414, 0.09, 0.1,
                       up ? Math.PI / 4 : -Math.PI / 4, paint);
            }
            // Lamps along the truss: tiny warm points, the life in the hall.
            for (let x = x0 + rng.range(0, 4); x < x1; x += rng.range(4, 8)) {
                b.box(x, y - depth - 0.25, z + 0.12, 0.18, 0.18, 0.05, R3D.col(pal.glass), F.FRONT);
            }
        }

        // Gears. Their own meshes, turning, and meshing in pairs where they can.
        const gears = rng.int(2, 3);
        let prev = null;
        for (let i = 0; i < gears; i++) {
            const r = rng.range(2.2, 4.6);
            const teeth = Math.max(14, Math.round(r * 7));
            const z = rng.range(-10, -15);
            let x = rng.range(3, C.COLS - 3), y = rng.range(6, 18), spin = rng.range(0.1, 0.22) * (rng.chance(0.5) ? 1 : -1);
            if (prev && rng.chance(0.6)) {
                // Mesh with the last one: tangent, counter-rotating, speed by ratio.
                const a = rng.range(-0.8, 0.8);
                x = prev.x + Math.cos(a) * (prev.r + r) * 0.94;
                y = prev.y + Math.sin(a) * (prev.r + r) * 0.94;
                spin = -prev.spin * prev.r / r;
            }
            const gb = new R3D.Builder();
            gear(gb, r, teeth, rng.chance(0.5) ? iron : ironDk, ironLit, brass);
            gradeHall(gb, pal, x, y, z);
            const mesh = new THREE.Mesh(gb.geometry(), hallMaterial());
            mesh.position.set(x, y, z);
            mesh.renderOrder = -4;
            group.add(mesh);
            spinners.push({ mesh: mesh, spin: spin, phase: rng.range(0, 6) });
            prev = { x: x, y: y, r: r, spin: spin };
        }

        // A beam engine's piston, stroking in its cylinder.
        const px = rng.range(6, C.COLS - 6);
        const pz = rng.range(-9.5, -12);
        b.cyl(px, 3.6, pz, 1.1, 6.4, 'y', iron, 14, ironLit);
        for (const dy of [0.8, 3.6, 6.4]) b.cyl(px, dy, pz, 1.2, 0.25, 'y', ironLit, 14);
        const rod = new R3D.Builder();
        rod.cyl(0, 3.5, 0, 0.3, 7, 'y', ironLit, 10);
        rod.box(0, 7.1, 0, 3.4, 0.5, 0.6, paint, F.ALL, R3D.col(pal.paintLit));
        gradeHall(rod, pal, px, 8, pz);
        const rodMesh = new THREE.Mesh(rod.geometry(), hallMaterial());
        rodMesh.position.set(px, 6.4, pz);
        rodMesh.renderOrder = -4;
        group.add(rodMesh);
        spinners.push({ mesh: rodMesh, stroke: 1.6, rate: 1.3, phase: rng.range(0, 6), baseY: 6.4 });
    }

    /** A spur gear at the origin, facing the camera: rim, teeth, spokes, hub. */
    function gear(b, r, teeth, col, lit, hub) {
        const depth = 0.5;
        for (let k = 0; k < teeth; k++) {
            const a = (k / teeth) * Math.PI * 2;
            // Rim segment.
            const rr = r * 0.84;
            b.rbox(Math.cos(a) * rr, Math.sin(a) * rr, 0, (2 * Math.PI * rr) / teeth + 0.06, r * 0.16,
                   depth, a + Math.PI / 2, col, lit);
            // Tooth.
            const tr = r * 0.97;
            b.rbox(Math.cos(a) * tr, Math.sin(a) * tr, 0, (Math.PI * r) / teeth, r * 0.14,
                   depth * 0.9, a + Math.PI / 2, col, lit);
        }
        const spokes = r > 3.4 ? 6 : 5;
        for (let k = 0; k < spokes; k++) {
            const a = (k / spokes) * Math.PI * 2;
            b.rbox(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, -0.05, r * 0.8, r * 0.1,
                   depth * 0.6, a, col, lit);
        }
        b.cyl(0, 0, 0, r * 0.2, depth * 1.2, 'z', lit, 14, hub);
        b.cyl(0, 0, 0.1, r * 0.08, depth * 1.4, 'z', hub, 10);
    }

    /**
     * Push every vertex toward the air by its depth and toward the furnace
     * glow by its height. `ox/oy/oz` offset a builder that was authored at its
     * own origin (the gears) so it grades as if it stood where it will be put.
     */
    function gradeHall(b, pal, ox, oy, oz) {
        const haze = R3D.col(pal.haze);
        const glowC = R3D.col(pal.deepGlow);
        const dx = ox || 0, dy = oy || 0, dz = oz || 0;
        b.grade(function (c, x, y, z) {
            const depth = THREE.MathUtils.clamp((-(z + dz) - 7) / 17, 0, 1);
            c.lerp(haze, 0.3 + depth * 0.55);
            const low = THREE.MathUtils.clamp(1 - (y + dy) / 11, 0, 1);
            c.lerp(glowC, low * low * 0.55);
            void dx;
        });
    }

    let _hallMat = null;
    function hallMaterial() {
        if (_hallMat) return _hallMat;
        _hallMat = new THREE.MeshBasicMaterial({ vertexColors: true });
        _hallMat.userData.shared = true;
        return _hallMat;
    }

    /* ------------------------------------------------------------------ *
     * Set pieces
     * ------------------------------------------------------------------ */

    /**
     * The one big machine each room's windows look out on.
     *
     * Without these every hall is the same hall — boilers, stacks, a gear or
     * two — and the rooms blur into one another however different their decks
     * are. A room named for its engine should *show* its engine. So each room
     * names a set piece (`works` in its definition) and the hall is built round
     * it: a flywheel, ventilation fans, furnace mouths, gas holders, a winding
     * headframe, or a store with a travelling crane. It is the room's landmark:
     * the thing you remember it by.
     *
     * Static parts go into the graded hall buffer; moving ones become spinners.
     */
    function setPiece(kind, b, glow, group, spinners, pal, rng) {
        const iron = R3D.col(pal.iron), ironLit = R3D.col(pal.ironLit), ironDk = R3D.col(pal.ironDark);
        const paint = R3D.col(pal.paint), paintLit = R3D.col(pal.paintLit);
        const brass = R3D.col(pal.brass);

        const spinner = function (build, x, y, z, spin) {
            const sb = new R3D.Builder();
            build(sb);
            gradeHall(sb, pal, x, y, z);
            const mesh = new THREE.Mesh(sb.geometry(), hallMaterial());
            mesh.position.set(x, y, z);
            mesh.renderOrder = -4;
            group.add(mesh);
            const s = { mesh: mesh, spin: spin, phase: rng.range(0, 6) };
            spinners.push(s);
            return s;
        };

        const wheel = function (sb, r, spokes, col, lit) {
            const n = Math.max(24, Math.round(r * 8));
            for (let k = 0; k < n; k++) {
                const a = (k / n) * Math.PI * 2;
                sb.rbox(Math.cos(a) * r, Math.sin(a) * r, 0, (2 * Math.PI * r) / n + 0.05, r * 0.12, 0.6,
                        a + Math.PI / 2, col, lit);
            }
            for (let k = 0; k < spokes; k++) {
                sb.rbox(0, 0, 0, r * 2, r * 0.07, 0.4, (k / spokes) * Math.PI, col, lit);
            }
            sb.cyl(0, 0, 0, r * 0.14, 0.8, 'z', lit, 16, brass);
        };

        switch (kind) {
            case 'flywheel': {
                // A great flywheel, half sunk in a pit, turning fast.
                const x = rng.range(12, C.COLS - 12), y = 6.5, z = -10;
                spinner(function (sb) { wheel(sb, 7, 6, iron, ironLit); }, x, y, z, rng.chance(0.5) ? 0.7 : -0.7);
                b.box(x, 0.5, z, 16, 1.2, 4, ironDk, F.TOP | F.FRONT);
                for (const s of [-1, 1]) {
                    b.box(x + s * 1.2, 3.2, z - 0.8, 0.8, 6.4, 0.8, paint, F.ALL, paintLit);   // bearings
                }
                b.cyl(x, 6.5, z - 0.8, 0.7, 3, 'z', brass, 14);
                break;
            }
            case 'fans': {
                // Ventilation fans in round ducts, one large and one small.
                const sizes = [4.2, 2.6];
                for (let i = 0; i < sizes.length; i++) {
                    const r = sizes[i];
                    const x = i ? rng.range(26, C.COLS - 6) : rng.range(6, 16);
                    const y = rng.range(9, 16), z = -9.5 - i;
                    const ring = 40;
                    for (let k = 0; k < ring; k++) {
                        const a = (k / ring) * Math.PI * 2;
                        b.rbox(x + Math.cos(a) * (r + 0.3), y + Math.sin(a) * (r + 0.3), z, 0.8, 0.5, 1.2,
                               a + Math.PI / 2, iron, ironLit);
                    }
                    spinner(function (sb) {
                        for (let k = 0; k < 5; k++) {
                            sb.rbox(0, 0, 0, r * 1.9, r * 0.34, 0.1, (k / 5) * Math.PI, ironLit, ironLit);
                        }
                        sb.cyl(0, 0, 0.1, r * 0.2, 0.4, 'z', brass, 14);
                    }, x, y, z + 0.2, (i ? 3.2 : 2.2) * (rng.chance(0.5) ? 1 : -1));
                }
                break;
            }
            case 'furnace': {
                // Furnace mouths in a brick bank, each glowing, with a stack.
                const z = -11;
                const x0 = rng.range(3, 10);
                b.box(C.COLS / 2, 3, z - 1, C.COLS + 20, 6, 2, paint, F.TOP | F.FRONT, paintLit);
                for (let i = 0; i < 4; i++) {
                    const x = x0 + i * rng.range(8, 11);
                    b.box(x, 2.2, z + 0.05, 2.4, 2.4, 0.2, ironDk, F.FRONT);
                    glow.box(x, 2.0, z + 0.2, 2.0, 1.8, 0.02, R3D.mixCol(pal.lava, '#000000', 0.25), F.FRONT);
                    glow.box(x, 1.4, z + 0.22, 2.0, 0.6, 0.02, R3D.mixCol(pal.lava, '#fff0c0', 0.4), F.FRONT);
                    b.cyl(x, 12, z - 1.2, 0.8, 18, 'y', ironDk, 12, ironLit);
                }
                break;
            }
            case 'tanks': {
                // Gas holders: great drums inside a lattice of guide columns.
                const n = rng.int(1, 2);
                for (let i = 0; i < n; i++) {
                    const x = i ? rng.range(28, C.COLS - 4) : rng.range(6, 18);
                    const z = -13 - i * 2, r = rng.range(4, 5.5), h = rng.range(9, 13);
                    b.cyl(x, h / 2, z, r, h, 'y', iron, 24, ironLit);
                    for (let y = 1.5; y < h; y += 2.2) b.cyl(x, y, z, r * 1.02, 0.25, 'y', ironLit, 24);
                    for (let k = 0; k < 6; k++) {
                        const a = (k / 6) * Math.PI * 2;
                        b.box(x + Math.cos(a) * (r + 0.8), (h + 3) / 2, z + Math.sin(a) * (r + 0.8), 0.35, h + 3, 0.35,
                              paint, F.ALL, paintLit);
                    }
                    b.cyl(x, h + 2.8, z, r + 0.9, 0.3, 'y', paint, 24, paintLit);
                }
                break;
            }
            case 'winding': {
                // A headframe: two raked legs, a crosshead, and sheave wheels turning.
                const x = rng.range(10, C.COLS - 10), z = -10;
                for (const s of [-1, 1]) {
                    b.rbox(x + s * 3.2, 9, z, 0.6, 19, 0.6, s * 0.18, paint, paintLit);
                    b.rbox(x + s * 1.2, 9, z - 1.5, 0.5, 18, 0.5, -s * 0.08, paint, paintLit);
                }
                for (let y = 4; y < 18; y += 3.5) b.box(x, y, z, 7 - y * 0.2, 0.3, 0.3, paint, F.ALL, paintLit);
                b.box(x, 18.6, z, 7, 0.8, 1.6, ironDk, F.ALL, ironLit);
                for (const s of [-1, 1]) {
                    spinner(function (sb) { wheel(sb, 2.2, 4, iron, ironLit); }, x + s * 1.8, 20.2, z + 0.4,
                            s * 1.1);
                    // Ropes down from each sheave.
                    b.box(x + s * 1.8 + s * 2.2, 10, z + 0.4, 0.06, 20, 0.06, ironDk, F.FRONT);
                }
                break;
            }
            case 'stores': {
                // Stacked crates and drums, and a gantry crane that travels.
                const z = -9;
                const timber = R3D.col(pal.timber), timberTop = R3D.col(pal.timberTop);
                for (let i = 0; i < 9; i++) {
                    const x = rng.range(2, C.COLS - 2);
                    const stack = rng.int(1, 4);
                    for (let k = 0; k < stack; k++) {
                        const s = rng.range(1.4, 2);
                        b.box(x + rng.range(-0.3, 0.3), s / 2 + k * s, z - rng.range(0, 3), s, s, s, timber, F.ALL,
                              timberTop);
                    }
                }
                b.box(C.COLS / 2, 16, z - 2, C.COLS + 20, 0.8, 0.8, paint, F.ALL, paintLit);    // gantry rail
                const crane = spinner(function (sb) {
                    sb.box(0, 0, 0, 3, 1, 1.4, iron, F.ALL, ironLit);
                    sb.box(0, -3.5, 0, 0.06, 6, 0.06, ironDk, F.FRONT);
                    sb.box(0, -6.8, 0, 1.4, 1.4, 1.4, timber, F.ALL, timberTop);
                }, C.COLS / 2, 15.2, z - 1.6, 0);
                crane.travel = { from: 6, to: C.COLS - 6, rate: 0.12 };
                break;
            }
            default:
                break;
        }
    }

    /* ------------------------------------------------------------------ *
     * The dark
     * ------------------------------------------------------------------ */

    /**
     * The far wall of the hall: a graded plate, near black at the top and
     * lit from beneath by furnaces, with the silhouettes of distant stacks and
     * gantries against the glow and a few lit windows in them.
     *
     * There is no sky. The earlier backdrop's opening to daylight was the
     * single biggest reason the mine read as outdoors.
     */
    function darkWall(pal) {
        const spread = (Math.abs(DARK_Z) + 19) / 19;
        const w = (C.COLS + 10) * spread, h = (C.ROWS + 8) * spread;
        const geo = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(geo, R3D.cached('dark:' + pal.deep + pal.deepGlow, function () {
            return new THREE.MeshBasicMaterial({ map: darkTexture(pal), depthWrite: false });
        }));
        mesh.position.set(C.COLS / 2, C.ROWS / 2 - 2, DARK_Z);
        mesh.renderOrder = -6;
        mesh.name = 'dark';
        return mesh;
    }

    const _dark = new Map();
    function darkTexture(pal) {
        const key = pal.deep + pal.deepGlow;
        if (_dark.has(key)) return _dark.get(key);

        const W = 512, H = 256;
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d');
        const rnd = TNT.Util.rng(0xDA4C + pal.deep.charCodeAt(2));
        const mix = R3D.mixHex;

        const ramp = ctx.createLinearGradient(0, 0, 0, H);
        ramp.addColorStop(0.0, pal.deep);
        ramp.addColorStop(0.55, pal.deepMid);
        ramp.addColorStop(0.86, mix(pal.deepMid, pal.deepGlow, 0.6));
        ramp.addColorStop(1.0, pal.deepGlow);
        ctx.fillStyle = ramp;
        ctx.fillRect(0, 0, W, H);

        // Furnace mouths along the bottom, as soft blooms.
        for (let i = 0; i < 7; i++) {
            const x = rnd.range(0, W), y = H * rnd.range(0.86, 1.0), r = rnd.range(30, 70);
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, mix(pal.deepGlow, '#ffe0a0', 0.4));
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;

        // Distant stacks and gantry towers, silhouetted against the glow.
        const sil = mix(pal.deep, pal.deepMid, 0.5);
        for (let i = 0; i < 18; i++) {
            const x = rnd.range(0, W);
            const w = rnd.range(6, 22);
            const top = H * rnd.range(0.2, 0.7);
            ctx.fillStyle = sil;
            ctx.fillRect(x, top, w, H - top);
            if (rnd.chance(0.5)) ctx.fillRect(x - 4, top, w + 8, 4);
            // Lit windows up the side.
            for (let y = top + 8; y < H - 10; y += rnd.range(10, 24)) {
                if (!rnd.chance(0.35)) continue;
                ctx.fillStyle = 'rgba(255,190,110,' + rnd.range(0.25, 0.6).toFixed(2) + ')';
                ctx.fillRect(x + rnd.range(1, w - 3), y, 2, 2);
            }
        }
        // Smoke, drifting across the upper half.
        for (let i = 0; i < 10; i++) {
            const x = rnd.range(0, W), y = H * rnd.range(0.05, 0.5), r = rnd.range(30, 90);
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, 'rgba(0,0,0,0.3)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }

        const tex = new THREE.CanvasTexture(cv);
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        _dark.set(key, tex);
        return tex;
    }

    Works.WALL_Z = WALL_Z;
    Works.FRAME_Z = FRAME_Z;
    TNT.Works = Works;
})(window.TNT = window.TNT || {}, window.THREE);
