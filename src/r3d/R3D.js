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
     * One palette per mine. These carry the look the Godot build had — a dark
     * worked-out mine lit by a lamp, not a lit room — so the ambient terms are
     * deliberately low and almost all the light in a scene comes from point
     * sources that move.
     */
    R3D.PALETTES = {
        /**
         * Hue separation is the job here, not brightness.
         *
         * An earlier pass had rock and timber both mid-brown, and the room read
         * as one material however much texture and lighting went on it — you
         * could not tell a wall from a walkway at a glance. Stone is pulled
         * cool and grey, timber stays warm orange, and anything metal goes
         * bluer still. Three families, and every prop belongs to one of them.
         */
        copper: {
            rock:      ['#4c4a4a', '#565252', '#403f41'],
            rockTop:   '#7d7469',
            moss:      '#5c7040',
            timber:    '#9a6330',
            timberTop: '#c48541',
            ladder:    '#b8874a',
            rope:      '#c9a05a',
            /**
             * The cavern behind the playfield.
             *
             * These were near-black, and the result was a room that read as
             * platforms floating in a void — the single biggest reason the mine
             * looked empty. The backdrop is not scenery here: it is the only
             * thing telling you that you are underground rather than in space.
             */
            back:      '#33261a',
            backFar:   '#241a13',
            /** The warm floor of the backdrop ramp — see `backdropCanvas`. */
            backGlow:  '#5a3a20',
            fog:       '#1c150e',
            ambient:   '#4a4260',
            hemi:      '#5b5170',
            lamp:      '#ffb867',
            crystal:   ['#5fd8ff', '#c48bff'],
            spike:     '#9aa0ad',
            water:     '#2f7cbd',
            lava:      '#ff5a2a'
        },
        slate: {
            rock:      ['#3c4652', '#46515e', '#343d47'],
            rockTop:   '#6f7d8b',
            moss:      '#4e6b5a',
            timber:    '#8a6437',
            timberTop: '#ab7f4b',
            ladder:    '#8794a1',
            rope:      '#a8a389',
            back:      '#232c38',
            backFar:   '#161c25',
            backGlow:  '#3c4c63',
            fog:       '#141a21',
            ambient:   '#415271',
            hemi:      '#4e5f80',
            lamp:      '#9fd0ff',
            crystal:   ['#6ff0dc', '#8fb8ff'],
            spike:     '#a6b0bd',
            water:     '#2a6494',
            lava:      '#ff5c3c'
        },
        ember: {
            rock:      ['#573429', '#633d2e', '#4a2c22'],
            rockTop:   '#9c5c3b',
            moss:      '#7a4d28',
            timber:    '#7c4a2e',
            timberTop: '#9c6038',
            ladder:    '#b57748',
            rope:      '#c98f54',
            /**
             * Cinderdeep is the lava-cave reference: a deep red ramp going
             * almost black at the roof and molten at the floor, with the
             * silhouettes reading against it rather than disappearing into it.
             */
            back:      '#4a1c14',
            backFar:   '#240d0a',
            backGlow:  '#8a3418',
            fog:       '#23100b',
            ambient:   '#6b3a3c',
            hemi:      '#7d4442',
            lamp:      '#ffa055',
            crystal:   ['#ffbe6e', '#ff7a62'],
            spike:     '#b09a8e',
            water:     '#3f6a88',
            lava:      '#ff7326'
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
     * Materials
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * Surface detail
     * ------------------------------------------------------------------ */

    /**
     * One tile of hewn rock, drawn rather than loaded.
     *
     * Everything in this game is generated at load — there are no image files —
     * which is a constraint worth keeping: the page works from `file://` with
     * no network. It also means the texture can be authored against the palette
     * instead of tinted to fit it.
     *
     * The look is the Godot build's: chisel marks, a few darker pits, a lit lip
     * along the top edge. Drawn at 32px and left unfiltered, so it reads as
     * worked stone rather than as a blurry gradient — `NearestFilter` is doing
     * as much work here as the drawing is.
     */
    function rockCanvas(seedShift) {
        const S = 32;
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        const rnd = TNT.Util.rng(0x9E3779B9 + seedShift * 7919);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, S, S);

        // Chisel strokes: short darker dashes on a slight diagonal.
        for (let i = 0; i < 26; i++) {
            const x = rnd.int(0, S), y = rnd.int(0, S);
            const len = rnd.int(3, 9);
            const dark = rnd.range(0.62, 0.86);
            ctx.strokeStyle = 'rgba(0,0,0,' + (1 - dark).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + len, y + rnd.int(-2, 2));
            ctx.stroke();
        }
        // Pits.
        for (let i = 0; i < 7; i++) {
            ctx.fillStyle = 'rgba(0,0,0,0.30)';
            ctx.fillRect(rnd.int(0, S - 2), rnd.int(0, S - 2), rnd.int(1, 3), rnd.int(1, 3));
        }
        // Highlights, so the surface has a direction.
        for (let i = 0; i < 9; i++) {
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            ctx.fillRect(rnd.int(0, S - 3), rnd.int(0, S - 1), rnd.int(2, 5), 1);
        }
        // The lit lip along the top of a block.
        const grad = ctx.createLinearGradient(0, 0, 0, 6);
        grad.addColorStop(0, 'rgba(255,255,255,0.34)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, 6);

        return cv;
    }

    /** One tile of sawn timber: plank seams, grain, and end nails. */
    function timberCanvas() {
        const S = 32;
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const ctx = cv.getContext('2d');
        const rnd = TNT.Util.rng(0x5BF03635);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, S, S);

        // Grain along the length of the board.
        for (let i = 0; i < 20; i++) {
            const y = rnd.int(0, S);
            ctx.strokeStyle = 'rgba(0,0,0,' + rnd.range(0.06, 0.20).toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(S / 3, y + rnd.int(-2, 2), (2 * S) / 3, y + rnd.int(-2, 2), S, y);
            ctx.stroke();
        }
        // The seam between one board and the next.
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fillRect(0, 0, 1, S);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(1, 0, 1, S);
        // Nail heads.
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(4, 5, 2, 2);
        ctx.fillRect(4, S - 7, 2, 2);

        return cv;
    }

    /**
     * The cavern behind the playfield, baked as one image.
     *
     * This replaces a field of flat silhouette boxes, and the difference is the
     * single biggest lift in the whole render. What a 2D platformer background
     * actually does is **grade**: a smooth vertical ramp, then three or four
     * ridge lines in receding values with haze between them, so the eye reads
     * enormous depth behind a shallow playfield. Boxes cannot do that — every
     * one is a hard edge at the same value, which is why the rooms looked like
     * platforms floating in front of a black wall.
     *
     * Drawn wide and shallow and stretched over the room; nobody is going to
     * study the sampling on something eight units behind the action.
     */
    /**
     * One backdrop layer.
     *
     * Layer 0 is the opaque ramp with the most distant ridges on it; layers 1
     * and 2 are transparent sheets of nearer rock. They are separate canvases so
     * they can be hung at **different depths** — which is the whole point. One
     * flat plane, however well drawn, has no parallax: it slides with the camera
     * as a unit and the eye reads it as wallpaper. Three sheets at increasing Z
     * diverge under the perspective camera, so they shift against each other
     * when the screen shakes and when a room flips, and the space behind the
     * playfield becomes somewhere rather than something.
     */
    function backdropCanvas(pal, layer) {
        const W = 512, H = 288;
        const cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        const ctx = cv.getContext('2d');
        const rnd = TNT.Util.rng(0xB4CD40 + layer * 7919 + pal.back.length);

        /** One ridge line of jagged rock, filled to the bottom of the canvas. */
        const ridge = (baseY, amp, step, fill) => {
            ctx.beginPath();
            ctx.moveTo(0, H);
            ctx.lineTo(0, baseY);
            for (let x = 0; x <= W; x += step) {
                ctx.lineTo(x, baseY - rnd.range(0, amp));
                ctx.lineTo(x + step * 0.5, baseY - rnd.range(0, amp * 0.6));
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
        };

        if (layer === 0) {
            // The ramp. Darker at the roof, warmer toward the floor, because
            // the light in a mine comes from what is burning down there.
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0, pal.backFar);
            sky.addColorStop(0.55, pal.back);
            sky.addColorStop(1, pal.backGlow || pal.back);
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);

            ridge(H * 0.40, H * 0.20, 52, mixHex(pal.backFar, pal.rock[0], 0.26));
            ridge(H * 0.54, H * 0.17, 38, mixHex(pal.backFar, pal.rock[0], 0.42));

            // Distant lamps, deep in the workings.
            for (let i = 0; i < 16; i++) {
                const x = rnd.range(0, W);
                const y = rnd.range(H * 0.45, H * 0.92);
                const r = rnd.range(4, 12);
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, 'rgba(255,190,110,0.55)');
                g.addColorStop(1, 'rgba(255,190,110,0)');
                ctx.fillStyle = g;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }
            return cv;
        }

        // Nearer sheets: rock only, over transparency, and a haze wash so each
        // one sits in front of the last rather than merging with it.
        ctx.clearRect(0, 0, W, H);
        if (layer === 1) {
            ridge(H * 0.66, H * 0.16, 30, mixHex(pal.back, pal.rock[2], 0.62));
            ctx.globalCompositeOperation = 'source-atop';
            const haze = ctx.createLinearGradient(0, H * 0.5, 0, H);
            haze.addColorStop(0, 'rgba(255,255,255,0.10)');
            haze.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = haze;
            ctx.fillRect(0, 0, W, H);
        } else {
            ridge(H * 0.82, H * 0.12, 22, mixHex(pal.back, pal.rock[2], 0.88));
            // Pit props silhouetted against the workings behind them.
            ctx.fillStyle = mixHex(pal.back, '#000000', 0.45);
            for (let i = 0; i < 7; i++) {
                const x = rnd.range(10, W - 10);
                const h = rnd.range(H * 0.16, H * 0.34);
                ctx.fillRect(x, H - h, 5, h);
                ctx.fillRect(x - 16, H - h, 37, 5);
            }
        }
        return cv;
    }

    /** Blend two hex strings in sRGB and return a css colour. */
    function mixHex(a, b, t) {
        const ca = new THREE.Color(a), cb = new THREE.Color(b);
        ca.lerp(cb, t);
        return '#' + ca.getHexString();
    }

    /** Depths the three backdrop sheets hang at, nearest last. */
    R3D.BACKDROP_Z = [-19, -11, -5.5];

    /** One baked backdrop layer per palette, made on demand. */
    const _backdrops = new Map();
    R3D.backdropTexture = function (pal, layer) {
        const key = pal.back + ':' + layer;
        let tex = _backdrops.get(key);
        if (tex) return tex;
        tex = new THREE.CanvasTexture(backdropCanvas(pal, layer));
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        // A canvas holds sRGB values. Left unflagged, Three samples it as
        // linear and every colour comes out lifted — the backdrop rendered as
        // pale grey wallpaper rather than a dark cavern, which then blew out
        // every additive glow drawn over it.
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        _backdrops.set(key, tex);
        return tex;
    };

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
     * Lambert rather than Standard on purpose: this is a scene lit almost
     * entirely by a handful of moving point lights, and Lambert costs a
     * fraction of what a PBR pass does for a look that, at this art direction,
     * is indistinguishable.
     *
     * The map multiplies the vertex colour, so one texture serves every palette
     * and every material — rock, timber and metal differ by colour, and the
     * texture only supplies the *detail*. That is what keeps a room at two draw
     * calls while still having a surface.
     */
    R3D.solidMaterial = function (textureName) {
        return new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.FrontSide,
            map: textureName ? R3D.texture(textureName) : null
        });
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
