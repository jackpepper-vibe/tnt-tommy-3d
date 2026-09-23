/**
 * TNT Tommy — presentation kit.
 *
 * The shared foundation every mesh in the game is built from: the mapping from
 * the simulation's pixel space into world space, the colour pipeline, the mine
 * palettes, and a geometry builder that merges boxes into one buffer.
 *
 * WORLD SPACE
 * -----------
 *   game x (px)   → world  X          one tile is one world unit
 *   game y (px)   → world  Y          *inverted* — see below
 *   depth         → world  Z          toward the camera
 *
 * The simulation is 2D screen space, where y grows downward. World Y grows
 * upward. So every conversion flips: `wy(py) = (ROOM_H - py) / TILE`. Getting
 * this wrong does not produce an obviously upside-down game — it produces one
 * where Tommy is drawn correctly and every hazard is mirrored vertically about
 * the room's middle, which is much harder to spot. Use `wx`/`wy` and never do
 * the arithmetic inline.
 *
 * COLOUR
 * ------
 * The renderer writes sRGB, so Three treats material and vertex colours as
 * already linear. Every hex in this project is picked by eye as sRGB and must
 * go through `col()`. Skipping it lifts the whole palette to pale putty, which
 * is the single most common way to make a dark mine look like a grey car park.
 * Light colours are the exception: they are multipliers, and are set raw.
 *
 * DRAW CALLS
 * ----------
 * A room is two draw calls, not two thousand. Every solid tile, plank, rung and
 * beam goes into one merged, vertex-coloured buffer; everything that glows goes
 * into a second additive one. Adding a per-object material would quietly undo
 * that, and a 42x24 grid is enough tiles for it to matter.
 */
(function (TNT, THREE) {
    'use strict';

    const { C } = TNT;

    const R3D = {};

    /**
     * Depth of the playfield slab, in world units.
     *
     * Deepened once the lens widened. A thin slab under a near-orthographic
     * camera showed nothing; a deep one under a wide lens is what gives the
     * rock visible sides and the room a floor you can see the thickness of.
     */
    R3D.DEPTH = 2.6;
    /** Where the back wall sits. Everything gameplay-relevant is in front of it. */
    R3D.BACK_Z = -2.6;

    /* ------------------------------------------------------------------ *
     * Space
     * ------------------------------------------------------------------ */

    /** Game pixels → world units, horizontally. */
    R3D.wx = function (px) {
        return px / C.TILE;
    };

    /** Game pixels → world units, vertically. Flips: screen y is down, world Y is up. */
    R3D.wy = function (py) {
        return (C.ROOM_H - py) / C.TILE;
    };

    /** Tile column/row → the centre of that tile in world space. */
    R3D.tileX = function (tx) { return tx + 0.5; };
    R3D.tileY = function (ty) { return C.ROWS - ty - 0.5; };

    R3D.ROOM_UNITS_W = C.COLS;
    R3D.ROOM_UNITS_H = C.ROWS;

    /* ------------------------------------------------------------------ *
     * Colour
     * ------------------------------------------------------------------ */

    /** Authored sRGB → the linear values the renderer wants. See the header. */
    R3D.col = function (hex) {
        return new THREE.Color(hex).convertSRGBToLinear();
    };

    const _scratch = new THREE.Color();
    R3D.tmpCol = function (hex) {
        return _scratch.set(hex).convertSRGBToLinear();
    };

    /** Blend two authored colours and convert once. */
    R3D.mixCol = function (a, b, t) {
        const ca = new THREE.Color(a);
        return ca.lerp(new THREE.Color(b), t).convertSRGBToLinear();
    };

    /* ------------------------------------------------------------------ *
     * Palettes
     * ------------------------------------------------------------------ */

    /**
     * One palette per mine, and all three are **the works**: iron, brass and
     * masonry sunk into dark rock and lit by lamps.
     *
     * The earlier palettes were a cave with daylight at the top — a sky ramp,
     * light shafts, green moss on every ledge and vines off every deck — and
     * that single choice is why the mine never read as underground. Nothing in
     * here is green any more and nothing is lit from above. The ambient terms
     * are low and cool, every warm value in a room comes from a lamp, a furnace
     * or the melt, and the space behind the playfield is a machine hall seen
     * through openings in a built wall rather than a sky.
     *
     * Three material families, and every prop belongs to one of them:
     *
     *   - **stone** — rock and masonry, the coolest and flattest values
     *   - **iron** — girders, decks, plate; dark, with a lit edge
     *   - **brass** — fittings, rails, rivets; the warm highlight on the metal
     *
     * Keeping the families apart in hue as well as value is what lets a deck be
     * told from the wall behind it at a glance in a dark room.
     */
    R3D.PALETTES = {
        /** Copperlode: a brass-and-oxide works, amber lamps, a furnace far off. */
        copper: {
            rock:        ['#3b3531', '#433c37', '#35302c'],
            rockTop:     '#6e6254',
            masonry:     '#5c4a3c',
            masonryDark: '#3a2d24',
            iron:        '#46423e',
            ironLit:     '#7a726a',
            ironDark:    '#24211e',
            paint:       '#8a3a22',     // red oxide on the girders
            paintLit:    '#b4583a',
            brass:       '#b8893e',
            brassLit:    '#f0c874',
            pipe:        '#9a5a32',     // copper pipework
            pipeLit:     '#d4905a',
            timber:      '#6e4a2c',     // crates and sleepers only
            timberTop:   '#94663c',
            ladder:      '#5e5750',
            rope:        '#8e8680',
            /** The machine hall behind the wall, near to far. */
            deep:        '#0e0907',
            deepMid:     '#21160f',
            deepGlow:    '#8c4516',
            haze:        '#3a271a',
            fog:         '#0b0705',
            ambient:     '#524a68',
            hemi:        '#5e5068',
            lamp:        '#ffb366',
            glass:       '#ffd9a0',
            signal:      '#ff5a2e',     // indicator lamps on the machinery
            crystal:     ['#5fd8ff', '#c48bff'],
            spike:       '#9aa0ad',
            water:       '#2f7cbd',
            lava:        '#ff5a2a'
        },
        /** Blackdamp: a wet gasworks — teal paint, nickel, cold blue lamps. */
        slate: {
            rock:        ['#2d3237', '#353b41', '#282c31'],
            rockTop:     '#5c6770',
            masonry:     '#434c50',
            masonryDark: '#283034',
            iron:        '#3b4147',
            ironLit:     '#6f7a84',
            ironDark:    '#1e2226',
            paint:       '#2c5c57',
            paintLit:    '#4a8a80',
            brass:       '#8c9ca2',
            brassLit:    '#d0dce0',
            pipe:        '#4b6a70',
            pipeLit:     '#7ca2aa',
            timber:      '#5a4a38',
            timberTop:   '#7a6650',
            ladder:      '#58626a',
            rope:        '#8a949a',
            deep:        '#05080b',
            deepMid:     '#0e1820',
            deepGlow:    '#1e5868',
            haze:        '#182830',
            fog:         '#04070a',
            ambient:     '#40567a',
            hemi:        '#4a6288',
            lamp:        '#a8dcff',
            glass:       '#d8f0ff',
            signal:      '#5cffc8',
            crystal:     ['#6ff0dc', '#8fb8ff'],
            spike:       '#a6b0bd',
            water:       '#2a6494',
            lava:        '#ff5c3c'
        },
        /** Cinderdeep: the foundry — black iron, hot brass, the melt below. */
        ember: {
            rock:        ['#382420', '#412a25', '#311f1b'],
            rockTop:     '#7a4c3a',
            masonry:     '#4c2e25',
            masonryDark: '#2c1814',
            iron:        '#3a302c',
            ironLit:     '#6c574c',
            ironDark:    '#1c1412',
            paint:       '#5c2818',
            paintLit:    '#8e4a2c',
            brass:       '#b87a3e',
            brassLit:    '#f0ac62',
            pipe:        '#6c3a28',
            pipeLit:     '#a8623c',
            timber:      '#5a3a26',
            timberTop:   '#7a5234',
            ladder:      '#5a4a42',
            rope:        '#8a766a',
            deep:        '#100403',
            deepMid:     '#2a0c06',
            deepGlow:    '#c44c14',
            haze:        '#4a1a0e',
            fog:         '#0a0302',
            ambient:     '#6a3a40',
            hemi:        '#7a4446',
            lamp:        '#ffa055',
            glass:       '#ffd08a',
            signal:      '#ffcc3a',
            crystal:     ['#ffbe6e', '#ff7a62'],
            spike:       '#b09a8e',
            water:       '#3f6a88',
            lava:        '#ff7326'
        }
    };

    R3D.palette = function (key) {
        return R3D.PALETTES[key] || R3D.PALETTES.copper;
    };

    /* ------------------------------------------------------------------ *
     * Geometry builder
     * ------------------------------------------------------------------ */

    const FACES = [
        // [normal, four corner offsets] — unit cube centred on the origin.
        [[0, 0, 1],  [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
        [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
        [[1, 0, 0],  [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
        [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
        [[0, 1, 0],  [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
        [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]]
    ];

    /**
     * Accumulates boxes into one indexed, vertex-coloured buffer.
     *
     * Written out by hand rather than leaning on `BufferGeometryUtils`, which
     * lives in Three's examples and is not in the vendored core build. It also
     * means faces can be skipped: `add` takes a mask, and a merged run of rock
     * only needs the faces you can actually see, which is most of the reason a
     * room stays cheap.
     */
    function Builder() {
        this.pos = [];
        this.norm = [];
        this.color = [];
        this.uv = [];
        this.index = [];
        this.count = 0;
    }

    R3D.FACE = { FRONT: 1, BACK: 2, RIGHT: 4, LEFT: 8, TOP: 16, BOTTOM: 32 };
    R3D.FACE.ALL = 63;
    /** What a wall block actually needs: no back, it is never seen. */
    R3D.FACE.SLAB = R3D.FACE.FRONT | R3D.FACE.RIGHT | R3D.FACE.LEFT |
                    R3D.FACE.TOP | R3D.FACE.BOTTOM;

    /**
     * @param {number} cx,cy,cz  centre
     * @param {number} w,h,d     size
     * @param {THREE.Color} colour  already linear — pass `R3D.col(...)`
     * @param {number} [mask]    which faces to emit; defaults to all
     * @param {THREE.Color} [topColour]  lit edge, for the +Y face only
     */
    /**
     * UVs are in **world units, not 0..1**.
     *
     * A fourteen-tile run of rock gets `u` from 0 to 14, so a tiling texture
     * repeats once per tile however long the run is. Normalised UVs would
     * stretch one copy of the texture across the whole run and every merged
     * wall would be visibly smeared — which is most of what made an earlier
     * pass read as flat coloured slabs.
     */
    Builder.prototype.box = function (cx, cy, cz, w, h, d, colour, mask, topColour) {
        const m = (mask === undefined) ? R3D.FACE.ALL : mask;
        for (let f = 0; f < FACES.length; f++) {
            if (!(m & (1 << f))) continue;
            const [n, corners] = FACES[f];
            const c = (f === 4 && topColour) ? topColour : colour;
            const base = this.count;
            // Which two of the box's dimensions this face spans.
            const su = (f === 2 || f === 3) ? d : w;
            const sv = (f === 4 || f === 5) ? d : h;
            for (let i = 0; i < corners.length; i++) {
                const p = corners[i];
                this.pos.push(cx + p[0] * w, cy + p[1] * h, cz + p[2] * d);
                this.norm.push(n[0], n[1], n[2]);
                this.color.push(c.r, c.g, c.b);
                this.uv.push((i === 1 || i === 2) ? su : 0, (i >= 2) ? sv : 0);
                this.count++;
            }
            this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        return this;
    };

    /**
     * A box turned about Z by `ang` radians — gear teeth, spokes, knee braces,
     * trusses. Everything the axis-aligned `box` cannot say, which in a works
     * full of machinery is most of what makes it look engineered rather than
     * stacked.
     *
     * Emits the front, back and four edge faces; the rotation is applied to the
     * normals too, so a tooth on the far side of a gear is lit as one.
     */
    Builder.prototype.rbox = function (cx, cy, cz, w, h, d, ang, colour, edgeColour) {
        const c = Math.cos(ang), s = Math.sin(ang);
        const hw = w / 2, hh = h / 2, hd = d / 2;
        const rot = function (x, y) { return [cx + x * c - y * s, cy + x * s + y * c]; };
        const edge = edgeColour || colour;
        const quad = (pts, n, col) => {
            const base = this.count;
            for (let i = 0; i < 4; i++) {
                this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
                this.norm.push(n[0], n[1], n[2]);
                this.color.push(col.r, col.g, col.b);
                this.uv.push((i === 1 || i === 2) ? 1 : 0, i >= 2 ? 1 : 0);
                this.count++;
            }
            this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };
        const p = [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)];
        const f = cz + hd, k = cz - hd;
        quad([[p[0][0], p[0][1], f], [p[1][0], p[1][1], f], [p[2][0], p[2][1], f], [p[3][0], p[3][1], f]],
             [0, 0, 1], colour);
        quad([[p[1][0], p[1][1], k], [p[0][0], p[0][1], k], [p[3][0], p[3][1], k], [p[2][0], p[2][1], k]],
             [0, 0, -1], colour);
        // Edges: bottom, right, top, left — each with its rotated outward normal.
        const edges = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];
        for (const [a, b, nx, ny] of edges) {
            const n = [nx * c - ny * s, nx * s + ny * c, 0];
            quad([[p[a][0], p[a][1], k], [p[b][0], p[b][1], k], [p[b][0], p[b][1], f], [p[a][0], p[a][1], f]],
                 n, ny > 0 ? edge : colour);
        }
        return this;
    };

    /**
     * Recolour every vertex from a function of its position.
     *
     * The machine hall is unlit — it is too far back for the lamp pool to reach
     * — so its depth and its furnace uplight are *graded in* here instead: one
     * pass after building, pushing each vertex toward the air colour by its
     * distance and toward the glow by its height. That is what makes forty
     * boxes read as a hall receding into smoke rather than as cut-outs.
     *
     * @param {function(THREE.Color, number, number, number)} fn  mutates the colour
     */
    Builder.prototype.grade = function (fn) {
        const c = new THREE.Color();
        for (let i = 0; i < this.count; i++) {
            c.setRGB(this.color[i * 3], this.color[i * 3 + 1], this.color[i * 3 + 2]);
            fn(c, this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
            this.color[i * 3] = c.r;
            this.color[i * 3 + 1] = c.g;
            this.color[i * 3 + 2] = c.b;
        }
        return this;
    };

    /** A flat quad facing +Z. Cheaper than a box for ropes, rungs and signage. */
    Builder.prototype.plate = function (cx, cy, cz, w, h, colour) {
        const base = this.count;
        const hw = w / 2, hh = h / 2;
        const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (let i = 0; i < pts.length; i++) {
            this.pos.push(cx + pts[i][0], cy + pts[i][1], cz);
            this.norm.push(0, 0, 1);
            this.color.push(colour.r, colour.g, colour.b);
            this.uv.push(uvs[i][0], uvs[i][1]);
            this.count++;
        }
        this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        return this;
    };

    Builder.prototype.isEmpty = function () {
        return this.count === 0;
    };

    Builder.prototype.geometry = function () {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setIndex(this.index);
        g.computeBoundingSphere();
        return g;
    };

    R3D.Builder = Builder;

    /* ------------------------------------------------------------------ *
     * Surface detail
     * ------------------------------------------------------------------ */

    /**
     * Every surface texture in the game, drawn rather than loaded.
     *
     * There are no image files, and that constraint is worth keeping: the page
     * works from `file://` with no network. It also means each texture is
     * authored *white* — it carries only the detail, and the vertex colour
     * supplies the material — so one set serves all three palettes.
     *
     * Each is one tile at 32px and sampled unfiltered. At the distance the
     * camera sits a tile is about thirty pixels on screen, so this is close to
     * one texel per pixel; `NearestFilter` keeps a rivet a rivet rather than a
     * smudge.
     */
    function canvas32() {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 32;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 32, 32);
        return { cv: cv, ctx: ctx, S: 32 };
    }

    /**
     * The soft volume every tile gets: bright at the top, falling to a dark
     * contact band at the bottom. Flat Lambert on a flat face is a flat fill,
     * and no amount of detail makes that read as mass — a gradient across the
     * face is the cheapest thing that does.
     */
    function volume(ctx, S, top, bottom) {
        const grad = ctx.createLinearGradient(0, 0, 0, S);
        grad.addColorStop(0.00, 'rgba(255,255,255,' + top + ')');
        grad.addColorStop(0.30, 'rgba(255,255,255,0.04)');
        grad.addColorStop(0.65, 'rgba(0,0,0,0.05)');
        grad.addColorStop(1.00, 'rgba(0,0,0,' + bottom + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, S);
    }

    /** Hewn rock: chisel strokes, pits, and a lit lip along the top. */
    function rockCanvas(seedShift) {
        const { cv, ctx, S } = canvas32();
        const rnd = TNT.Util.rng(0x9E3779B9 + seedShift * 7919);

        // Broad blotches first, so the face is not one flat value.
        for (let i = 0; i < 7; i++) {
            ctx.fillStyle = 'rgba(0,0,0,' + rnd.range(0.05, 0.14).toFixed(3) + ')';
            ctx.fillRect(rnd.int(-4, S), rnd.int(-4, S), rnd.int(6, 14), rnd.int(4, 10));
        }
        for (let i = 0; i < 30; i++) {
            const x = rnd.int(0, S), y = rnd.int(0, S);
            const len = rnd.int(3, 9);
            ctx.strokeStyle = 'rgba(0,0,0,' + rnd.range(0.14, 0.4).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len, y + rnd.int(-2, 2));
            ctx.stroke();
        }
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = 'rgba(0,0,0,0.34)';
            ctx.fillRect(rnd.int(0, S - 2), rnd.int(0, S - 2), rnd.int(1, 3), rnd.int(1, 3));
        }
        for (let i = 0; i < 9; i++) {
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(rnd.int(0, S - 3), rnd.int(0, S - 1), rnd.int(2, 5), 1);
        }
        volume(ctx, S, 0.22, 0.34);
        return cv;
    }

    /**
     * Riveted plate: a seam down one side and along the bottom, a rivet in
     * each corner, brushed grain, and a rust weep under the rivets.
     *
     * The seam is what makes a run of it read as *plate* — a girder or a deck
     * face tiling this is visibly built out of sheets bolted together, which is
     * the whole difference between a machine and a coloured bar.
     */
    function plateCanvas() {
        const { cv, ctx, S } = canvas32();
        const rnd = TNT.Util.rng(0x51A7E);

        // Brushed grain, horizontal.
        for (let i = 0; i < 26; i++) {
            const y = rnd.int(0, S);
            ctx.fillStyle = 'rgba(0,0,0,' + rnd.range(0.03, 0.09).toFixed(3) + ')';
            ctx.fillRect(rnd.int(-8, S), y, rnd.int(8, 24), 1);
        }
        // Mottling where the paint has worn.
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = 'rgba(0,0,0,' + rnd.range(0.05, 0.1).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(rnd.int(0, S), rnd.int(0, S), rnd.range(2, 5), 0, Math.PI * 2);
            ctx.fill();
        }
        // Seams: the edge of this sheet and the lip of the next.
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, 1, S);
        ctx.fillRect(0, S - 1, S, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(1, 0, 1, S - 1);
        ctx.fillRect(1, 0, S - 1, 1);
        // Rivets, with a highlight on the upper left and a shadow under.
        for (const [x, y] of [[5, 5], [S - 6, 5], [5, S - 7], [S - 6, S - 7]]) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(x - 1, y, 4, 3);
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.fillRect(x - 1, y - 1, 3, 2);
            // A streak of rust below each one.
            ctx.fillStyle = 'rgba(110,50,20,0.22)';
            ctx.fillRect(x, y + 3, 1, rnd.int(2, 6));
        }
        volume(ctx, S, 0.18, 0.3);
        return cv;
    }

    /**
     * Diamond tread plate, for walking surfaces.
     *
     * Only ever on a *top* face, so it is the texture the player's eye runs
     * along when it follows a deck — and a raised, regular pattern there reads
     * instantly as "made to be walked on", which the rock beside it is not.
     */
    function treadCanvas() {
        const { cv, ctx, S } = canvas32();
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, 0, S, S);
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                const x = col * 8 + (row % 2 ? 4 : 0);
                const y = row * 8 + 2;
                // Each lug is a short diagonal bar, lit on one side.
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fillRect(x + 1, y, 4, 1);
                ctx.fillRect(x + 2, y + 1, 3, 1);
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                ctx.fillRect(x + 2, y + 2, 4, 1);
            }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, 1, S);
        return cv;
    }

    /**
     * Dressed masonry, for the built wall behind the playfield.
     *
     * Two courses to the tile, staggered, with deep mortar joints. The wall is
     * the largest surface in the room and it sits behind everything, so it
     * wants low contrast *inside* each block and strong contrast at the joints
     * — the joints are what describe it at a distance.
     */
    function masonryCanvas() {
        const { cv, ctx, S } = canvas32();
        const rnd = TNT.Util.rng(0x3A50);
        const H = S / 2;

        for (let course = 0; course < 2; course++) {
            const y = course * H;
            const shift = course ? S / 2 : 0;
            for (let k = -1; k < 2; k++) {
                const x = shift + k * S;
                // Each block takes its own value, so the wall is not one tone.
                ctx.fillStyle = 'rgba(0,0,0,' + rnd.range(0.0, 0.16).toFixed(3) + ')';
                ctx.fillRect(x + 1, y + 1, S - 2, H - 2);
                ctx.fillStyle = 'rgba(255,255,255,0.14)';
                ctx.fillRect(x + 1, y + 1, S - 2, 1);
                for (let c = 0; c < 4; c++) {
                    ctx.fillStyle = 'rgba(0,0,0,0.2)';
                    ctx.fillRect(x + rnd.int(3, S - 4), y + rnd.int(3, H - 3), rnd.int(1, 3), 1);
                }
            }
            // The bed joint under this course, and the head joints either side.
            ctx.fillStyle = 'rgba(0,0,0,0.62)';
            ctx.fillRect(0, y + H - 1, S, 1);
            ctx.fillRect(shift % S, y, 1, H);
        }
        volume(ctx, S, 0.1, 0.2);
        return cv;
    }

    /** One tile of sawn timber, for the few crates and sleepers left. */
    function timberCanvas() {
        const { cv, ctx, S } = canvas32();
        const rnd = TNT.Util.rng(0x5BF03635);
        for (let i = 0; i < 20; i++) {
            const y = rnd.int(0, S);
            ctx.strokeStyle = 'rgba(0,0,0,' + rnd.range(0.06, 0.2).toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(S / 3, y + rnd.int(-2, 2), (2 * S) / 3, y + rnd.int(-2, 2), S, y);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(0, 0, 1, S);
        volume(ctx, S, 0.2, 0.34);
        return cv;
    }

    /** Blend two hex strings in sRGB and return a css colour. */
    function mixHex(a, b, t) {
        const ca = new THREE.Color(a), cb = new THREE.Color(b);
        ca.lerp(cb, t);
        return '#' + ca.getHexString();
    }
    R3D.mixHex = mixHex;

    /* ------------------------------------------------------------------ *
     * Round primitives
     * ------------------------------------------------------------------ */

    /**
     * A capped cylinder along an axis.
     *
     * The builder could only make boxes, and it showed: a coin was a gold box,
     * a lantern was a yellow box, a barrel was a brown box. No amount of
     * texture or lighting rescues a prop whose *silhouette* is wrong — round
     * things have to actually be round, and at eight or ten segments they cost
     * almost nothing.
     *
     * @param {string} axis  'x', 'y' or 'z' — the length runs along this
     */
    Builder.prototype.cyl = function (cx, cy, cz, radius, length, axis, colour, seg, capColour) {
        const n = seg || 10;
        const half = length / 2;
        const cap = capColour || colour;
        const ring = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
        }

        // Map the two cross-section axes and the length axis into world space.
        const at = (u, v, w) => {
            if (axis === 'x') return [cx + w, cy + u, cz + v];
            if (axis === 'z') return [cx + u, cy + v, cz + w];
            return [cx + u, cy + w, cz + v];
        };
        const nrm = (u, v, w) => {
            if (axis === 'x') return [w, u, v];
            if (axis === 'z') return [u, v, w];
            return [u, w, v];
        };

        // Side wall.
        for (let i = 0; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            const base = this.count;
            const quad = [[a, -half], [b, -half], [b, half], [a, half]];
            for (let k = 0; k < 4; k++) {
                const [p, w] = quad[k];
                const pos = at(p[0], p[1], w);
                const nn = nrm(p[0] / radius, p[1] / radius, 0);
                this.pos.push(pos[0], pos[1], pos[2]);
                this.norm.push(nn[0], nn[1], nn[2]);
                this.color.push(colour.r, colour.g, colour.b);
                this.uv.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0);
                this.count++;
            }
            this.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

        // Both caps, as fans.
        for (const side of [-1, 1]) {
            const centre = this.count;
            const cPos = at(0, 0, half * side);
            const cN = nrm(0, 0, side);
            this.pos.push(cPos[0], cPos[1], cPos[2]);
            this.norm.push(cN[0], cN[1], cN[2]);
            this.color.push(cap.r, cap.g, cap.b);
            this.uv.push(0.5, 0.5);
            this.count++;
            for (let i = 0; i < n; i++) {
                const p = ring[i];
                const pos = at(p[0], p[1], half * side);
                this.pos.push(pos[0], pos[1], pos[2]);
                this.norm.push(cN[0], cN[1], cN[2]);
                this.color.push(cap.r, cap.g, cap.b);
                this.uv.push(0.5 + p[0] / (radius * 2), 0.5 + p[1] / (radius * 2));
                this.count++;
            }
            for (let i = 0; i < n; i++) {
                const a = centre + 1 + i;
                const b = centre + 1 + ((i + 1) % n);
                if (side > 0) this.index.push(centre, a, b);
                else this.index.push(centre, b, a);
            }
        }
        return this;
    };

    /**
     * A sphere. Anything the player reads as "a round thing" — boulders, orbs,
     * eyes, berries — has to actually be one; a cube with a warm colour reads
     * as a crate no matter what it is called.
     */
    Builder.prototype.sphere = function (cx, cy, cz, radius, colour, seg, rings) {
        const n = seg || 10;
        const m = rings || 7;
        const start = this.count;

        for (let j = 0; j <= m; j++) {
            const phi = (j / m) * Math.PI;
            const sy = Math.cos(phi), sr = Math.sin(phi);
            for (let i = 0; i <= n; i++) {
                const th = (i / n) * Math.PI * 2;
                const nx = Math.cos(th) * sr, ny = sy, nz = Math.sin(th) * sr;
                this.pos.push(cx + nx * radius, cy + ny * radius, cz + nz * radius);
                this.norm.push(nx, ny, nz);
                this.color.push(colour.r, colour.g, colour.b);
                this.uv.push(i / n, 1 - j / m);
                this.count++;
            }
        }
        for (let j = 0; j < m; j++) {
            for (let i = 0; i < n; i++) {
                const a = start + j * (n + 1) + i;
                const b = a + n + 1;
                this.index.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        return this;
    };

    /**
     * An ellipsoid, optionally cut off below `phiMax` (a fraction of the way
     * from the top pole to the bottom one — 0.5 is a dome).
     *
     * Characters are built out of these. A figure assembled from boxes and
     * spheres reads as a figure assembled from boxes and spheres; squashed and
     * stretched round forms — a puffy jacket, a cheek, a toe cap, a helmet —
     * are what make one read as soft.
     */
    Builder.prototype.ellipsoid = function (cx, cy, cz, rx, ry, rz, colour, seg, rings, phiMax, capColour) {
        const n = seg || 12;
        const m = rings || 8;
        const cut = phiMax === undefined ? 1 : phiMax;
        const start = this.count;
        for (let j = 0; j <= m; j++) {
            const phi = (j / m) * Math.PI * cut;
            const sy = Math.cos(phi), sr = Math.sin(phi);
            for (let i = 0; i <= n; i++) {
                const th = (i / n) * Math.PI * 2;
                const ux = Math.cos(th) * sr, uy = sy, uz = Math.sin(th) * sr;
                this.pos.push(cx + ux * rx, cy + uy * ry, cz + uz * rz);
                // The normal of an ellipsoid is the unit direction scaled by
                // the inverse radii — not the unit direction itself.
                let nx = ux / rx, ny = uy / ry, nz = uz / rz;
                const l = Math.hypot(nx, ny, nz) || 1;
                this.norm.push(nx / l, ny / l, nz / l);
                this.color.push(colour.r, colour.g, colour.b);
                this.uv.push(i / n, 1 - j / m);
                this.count++;
            }
        }
        for (let j = 0; j < m; j++) {
            for (let i = 0; i < n; i++) {
                const a = start + j * (n + 1) + i;
                const b = a + n + 1;
                this.index.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        // Close a cut dome with a flat disc, so it has an underside.
        if (cut < 1 && capColour) {
            const phi = Math.PI * cut;
            const y = cy + Math.cos(phi) * ry, sr = Math.sin(phi);
            const centre = this.count;
            this.pos.push(cx, y, cz);
            this.norm.push(0, -1, 0);
            this.color.push(capColour.r, capColour.g, capColour.b);
            this.uv.push(0.5, 0.5);
            this.count++;
            for (let i = 0; i <= n; i++) {
                const th = (i / n) * Math.PI * 2;
                this.pos.push(cx + Math.cos(th) * sr * rx, y, cz + Math.sin(th) * sr * rz);
                this.norm.push(0, -1, 0);
                this.color.push(capColour.r, capColour.g, capColour.b);
                this.uv.push(0, 0);
                this.count++;
            }
            for (let i = 0; i < n; i++) this.index.push(centre, centre + 1 + i, centre + 2 + i);
        }
        return this;
    };

    /**
     * A cone along Y — `tipUp` false points it downward, which is what
     * stalactites, spikes and drips all want.
     */
    Builder.prototype.cone = function (cx, cy, cz, radius, height, colour, tipUp, seg) {
        const n = seg || 8;
        const dir = tipUp === false ? -1 : 1;
        const baseY = cy - dir * height / 2;
        const tipY = cy + dir * height / 2;
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
            const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius];
            const p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
            const base = this.count;
            const tri = [
                [cx + p0[0], baseY, cz + p0[1]],
                [cx + p1[0], baseY, cz + p1[1]],
                [cx, tipY, cz]
            ];
            const ux = tri[1][0] - tri[0][0], uy = tri[1][1] - tri[0][1], uz = tri[1][2] - tri[0][2];
            const vx = tri[2][0] - tri[0][0], vy = tri[2][1] - tri[0][1], vz = tri[2][2] - tri[0][2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz) || 1;
            for (let k = 0; k < 3; k++) {
                this.pos.push(tri[k][0], tri[k][1], tri[k][2]);
                this.norm.push(nx / len, ny / len, nz / len);
                this.color.push(colour.r, colour.g, colour.b);
                this.uv.push(k === 1 ? 1 : 0, k === 2 ? 1 : 0);
                this.count++;
            }
            if (dir > 0) this.index.push(base, base + 1, base + 2);
            else this.index.push(base, base + 2, base + 1);
        }
        return this;
    };

    /** A faceted gem: two pyramids base to base, along Y. */
    Builder.prototype.gem = function (cx, cy, cz, radius, height, colour, seg) {
        const n = seg || 6;
        const ring = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            ring.push([Math.cos(a) * radius, Math.sin(a) * radius]);
        }
        for (const tipY of [height / 2, -height / 2]) {
            for (let i = 0; i < n; i++) {
                const a = ring[i], b = ring[(i + 1) % n];
                const base = this.count;
                const tri = [[a[0], 0, a[1]], [b[0], 0, b[1]], [0, tipY, 0]];
                // Facet normal, so the gem catches light per face.
                const ux = tri[1][0] - tri[0][0], uy = tri[1][1] - tri[0][1], uz = tri[1][2] - tri[0][2];
                const vx = tri[2][0] - tri[0][0], vy = tri[2][1] - tri[0][1], vz = tri[2][2] - tri[0][2];
                let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                const len = Math.hypot(nx, ny, nz) || 1;
                nx /= len; ny /= len; nz /= len;
                if (tipY < 0) { nx = -nx; ny = -ny; nz = -nz; }
                for (let k = 0; k < 3; k++) {
                    this.pos.push(cx + tri[k][0], cy + tri[k][1], cz + tri[k][2]);
                    this.norm.push(nx, ny, nz);
                    this.color.push(colour.r, colour.g, colour.b);
                    this.uv.push(k === 1 ? 1 : 0, k === 2 ? 1 : 0);
                    this.count++;
                }
                if (tipY > 0) this.index.push(base, base + 1, base + 2);
                else this.index.push(base, base + 2, base + 1);
            }
        }
        return this;
    };

    const _textures = new Map();

    /**
     * A tiling texture by name, made once and shared.
     * `RepeatWrapping` plus world-unit UVs is what makes one tile repeat per
     * tile across a merged run — see `Builder.box`.
     */
    R3D.texture = function (name) {
        let tex = _textures.get(name);
        if (tex) return tex;

        let cv;
        if (name === 'timber') cv = timberCanvas();
        else if (name === 'plate') cv = plateCanvas();
        else if (name === 'tread') cv = treadCanvas();
        else if (name === 'masonry') cv = masonryCanvas();
        else cv = rockCanvas(name === 'rock2' ? 2 : (name === 'rock1' ? 1 : 0));

        tex = new THREE.CanvasTexture(cv);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        // Unfiltered on purpose: this is pixel art, and bilinear turns chisel
        // marks into mud at the distance the camera actually sits.
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        _textures.set(name, tex);
        return tex;
    };

    /**
     * The lit material every solid thing in the mine shares.
     *
     * **Phong, for per-pixel lighting — not Lambert.** Lambert in this build of
     * Three lights per *vertex*, and the mine is made of long merged runs: a
     * wall is one quad forty tiles wide. Lit per vertex, a lamp in the middle of
     * it can only brighten the corners, so no light ever made a *pool* — the
     * lamps painted faint gradients, and the helmet spot, aimed at a wall,
     * showed nothing at all. Per-pixel lighting is what lets a lamp light the
     * patch of wall it is hanging in front of, and a dark works lives or dies on
     * its pools of light.
     *
     * Specular is kept low and broad: worn iron and damp stone, not chrome.
     *
     * The map multiplies the vertex colour, so one texture serves every palette
     * and every material — the texture only supplies the *detail*.
     */
    R3D.solidMaterial = function (textureName) {
        return new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.FrontSide,
            map: textureName ? R3D.texture(textureName) : null,
            specular: new THREE.Color(0x1a1612),
            shininess: 14
        });
    };

    /**
     * The material every *actor* shares: Phong, plus a rim light.
     *
     * The works is dark on purpose, and a character lit only from the front by
     * his own helmet lamp sinks straight into it — his charcoal sleeves and
     * dark jeans were the same value as the masonry behind them. A fresnel rim
     * (brightest where a surface turns away from the eye) draws a thin cool
     * outline round every rounded form, which is the oldest trick there is for
     * pulling a figure off its background, and it costs one varying.
     *
     * Only actors get it. On the scenery it would outline every girder and
     * make the whole room glow at the edges.
     */
    R3D.actorMaterial = function (rimHex, rimStrength) {
        const mat = new THREE.MeshPhongMaterial({
            vertexColors: true,
            specular: new THREE.Color(0x2a2622),
            shininess: 28
        });
        const rim = new THREE.Color(rimHex || '#b8d0ff');
        const strength = rimStrength === undefined ? 0.3 : rimStrength;
        mat.onBeforeCompile = function (shader) {
            shader.uniforms.uRim = { value: rim.clone().multiplyScalar(strength) };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying float vRim;')
                .replace('#include <project_vertex>', [
                    '#include <project_vertex>',
                    'vRim = pow(1.0 - clamp(dot(normalize(transformedNormal), normalize(-mvPosition.xyz)), 0.0, 1.0), 3.0);'
                ].join('\n'));
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vRim;\nuniform vec3 uRim;')
                .replace(
                    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;',
                    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance + uRim * vRim * (0.25 + diffuseColor.rgb);'
                );
        };
        mat.customProgramCacheKey = function () { return 'actor-rim'; };
        return mat;
    };

    /** Everything that emits: crystals, glows, the fuse, the blast. */
    R3D.glowMaterial = function (opacity) {
        return new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: opacity === undefined ? 1 : opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    };

    /**
     * A soft round falloff, drawn rather than loaded — the page has to work
     * offline and over `file://`, so there are no image requests anywhere.
     *
     * Shared by every halo and every particle. Without it an additive quad is a
     * *square* of light: the lamps and pickups came out looking like they were
     * standing in front of glowing boxes, which is exactly what they were.
     */
    let _dot = null;
    R3D.dotTexture = function () {
        if (_dot) return _dot;
        const size = 128;
        const cv = document.createElement('canvas');
        cv.width = cv.height = size;
        const ctx = cv.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0.00, 'rgba(255,255,255,1)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
        g.addColorStop(1.00, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        _dot = new THREE.CanvasTexture(cv);
        _dot.needsUpdate = true;
        return _dot;
    };

    /**
     * THE HAZARD SIGNATURE.
     *
     * One palette, worn by everything in the mine that can take energy off you
     * and by nothing that cannot.
     *
     * It exists because spikes were `pal.spike` — a pale grey — and were drawn
     * as downward cones on a rail, while decorative stalactites are rock-grey
     * downward cones hanging off a ceiling. Same silhouette, near enough the
     * same colour, so there was nothing for a player to read: you learned which
     * was which by walking into one and losing a life. A hazard has to announce
     * itself before it is touched, and it cannot do that by looking like the
     * scenery.
     *
     * Amber banding on a dark iron mount is the part that does the work. It is
     * deliberately a *manufactured* look — nothing in the rock is that colour or
     * that regular — so the read is "someone put this here to hurt me" rather
     * than "the cave has bumps".
     */
    R3D.HAZARD = {
        metal:    '#3b3229',
        metalLit: '#5c4e40',
        warn:     '#e8a41c',   // the banding, and nothing decorative uses it
        warnDim:  '#8a5c10',
        edge:     '#fff2cf',   // the cutting edge catching the light
        rust:     '#7d3a18'
    };

    /**
     * The heat coming off a lava channel: bright along the bottom edge, gone by
     * the top, and faded out at both ends.
     *
     * This exists because the haze used to be an additive *box* emitted per lava
     * tile, one and a half tiles wide on a one tile pitch. Every overlap added
     * to itself, so a channel came out as a curtain of hard vertical stripes —
     * the brightest thing in the room and the worst-looking. Heat has no edges,
     * so neither does this.
     */
    let _haze = null;
    R3D.hazeTexture = function () {
        if (_haze) return _haze;
        const w = 128, h = 128;
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');

        // Vertical falloff: the surface is at the bottom of the canvas.
        const up = ctx.createLinearGradient(0, h, 0, 0);
        up.addColorStop(0.00, 'rgba(255,255,255,0.85)');
        up.addColorStop(0.18, 'rgba(255,255,255,0.42)');
        up.addColorStop(0.50, 'rgba(255,255,255,0.14)');
        up.addColorStop(1.00, 'rgba(255,255,255,0)');
        ctx.fillStyle = up;
        ctx.fillRect(0, 0, w, h);

        // Then taper both ends off, so a run does not stop against thin air.
        const ends = ctx.createLinearGradient(0, 0, w, 0);
        ends.addColorStop(0.00, 'rgba(0,0,0,0)');
        ends.addColorStop(0.16, 'rgba(0,0,0,1)');
        ends.addColorStop(0.84, 'rgba(0,0,0,1)');
        ends.addColorStop(1.00, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'destination-in';
        ctx.fillStyle = ends;
        ctx.fillRect(0, 0, w, h);

        _haze = new THREE.CanvasTexture(cv);
        _haze.needsUpdate = true;
        return _haze;
    };

    /** An additive plate carrying the heat falloff, tinted by `colour`. */
    R3D.hazeMaterial = function (colour, opacity) {
        const m = new THREE.MeshBasicMaterial({
            color: colour,
            map: R3D.hazeTexture(),
            transparent: true,
            opacity: opacity === undefined ? 1 : opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        m.userData.shared = true;
        return m;
    };

    /** An additive sprite material carrying the soft dot, tinted by `colour`. */
    R3D.haloMaterial = function (colour, opacity) {
        const m = new THREE.MeshBasicMaterial({
            color: colour,
            map: R3D.dotTexture(),
            transparent: true,
            opacity: opacity === undefined ? 1 : opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        m.userData.shared = true;
        return m;
    };

    R3D.flatMaterial = function () {
        return new THREE.MeshBasicMaterial({ vertexColors: true });
    };

    /* ------------------------------------------------------------------ *
     * Disposal
     * ------------------------------------------------------------------ */

    /**
     * Release a subtree.
     *
     * A room is rebuilt on every flip-screen transition, twenty-seven times a
     * mine and again on every run. Leaking a geometry per room exhausts the GPU
     * inside a couple of playthroughs, and the symptom is a browser tab that
     * gets slower and then dies — a long way from the cause.
     */
    R3D.dispose = function (obj) {
        if (!obj) return;
        obj.traverse(function (node) {
            if (node.geometry && !node.geometry.userData.shared) node.geometry.dispose();
            if (node.material) {
                const mats = Array.isArray(node.material) ? node.material : [node.material];
                for (const m of mats) {
                    if (!m.userData.shared) m.dispose();
                }
            }
        });
        if (obj.parent) obj.parent.remove(obj);
    };

    TNT.R3D = R3D;
})(window.TNT = window.TNT || {}, window.THREE);
