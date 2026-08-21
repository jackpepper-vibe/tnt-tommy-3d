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

    /** Depth of the playfield slab, in world units. */
    R3D.DEPTH = 1.15;
    /** Where the back wall sits. Everything gameplay-relevant is in front of it. */
    R3D.BACK_Z = -1.5;

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
        copper: {
            rock:      ['#3b3026', '#443729', '#342a20'],
            rockTop:   '#6d5740',
            moss:      '#4a5a34',
            timber:    '#6b4a2c',
            timberTop: '#8a6238',
            ladder:    '#8a6a3e',
            rope:      '#a08048',
            back:      '#1a1510',
            backFar:   '#241c14',
            fog:       '#140f0a',
            ambient:   '#3a3348',
            hemi:      '#4a4258',
            lamp:      '#ffb867',
            crystal:   ['#6fd3ff', '#b78bff'],
            spike:     '#8e9099',
            water:     '#2b6fa8',
            lava:      '#e04b3a'
        },
        slate: {
            rock:      ['#2c3138', '#343a42', '#262b31'],
            rockTop:   '#59636f',
            moss:      '#3e5548',
            timber:    '#57493a',
            timberTop: '#6f5c46',
            ladder:    '#6f7c88',
            rope:      '#8d8a72',
            back:      '#12161b',
            backFar:   '#1b2027',
            fog:       '#0d1014',
            ambient:   '#33405a',
            hemi:      '#3e4c68',
            lamp:      '#9fd0ff',
            crystal:   ['#7fe8d8', '#8fb0ff'],
            spike:     '#9aa3ad',
            water:     '#26597f',
            lava:      '#d8503c'
        },
        ember: {
            rock:      ['#3a241d', '#452b21', '#2f1d17'],
            rockTop:   '#7d4a30',
            moss:      '#5c3a1e',
            timber:    '#5e3823',
            timberTop: '#7d4c2c',
            ladder:    '#96603a',
            rope:      '#b07a44',
            back:      '#1c0d0a',
            backFar:   '#2a130d',
            fog:       '#160806',
            ambient:   '#4a2a2c',
            hemi:      '#5a3030',
            lamp:      '#ff9a4d',
            crystal:   ['#ffb066', '#ff6f5e'],
            spike:     '#a08a80',
            water:     '#3a5f7a',
            lava:      '#ff6a34'
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
    Builder.prototype.box = function (cx, cy, cz, w, h, d, colour, mask, topColour) {
        const m = (mask === undefined) ? R3D.FACE.ALL : mask;
        for (let f = 0; f < FACES.length; f++) {
            if (!(m & (1 << f))) continue;
            const [n, corners] = FACES[f];
            const c = (f === 4 && topColour) ? topColour : colour;
            const base = this.count;
            for (const p of corners) {
                this.pos.push(cx + p[0] * w, cy + p[1] * h, cz + p[2] * d);
                this.norm.push(n[0], n[1], n[2]);
                this.color.push(c.r, c.g, c.b);
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
        for (const p of pts) {
            this.pos.push(cx + p[0], cy + p[1], cz);
            this.norm.push(0, 0, 1);
            this.color.push(colour.r, colour.g, colour.b);
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
        g.setIndex(this.index);
        g.computeBoundingSphere();
        return g;
    };

    R3D.Builder = Builder;

    /* ------------------------------------------------------------------ *
     * Materials
     * ------------------------------------------------------------------ */

    /**
     * The lit material every solid thing in the mine shares.
     *
     * Lambert rather than Standard on purpose: this is a scene lit almost
     * entirely by a handful of moving point lights, and Lambert costs a
     * fraction of what a PBR pass does for a look that, at this art direction,
     * is indistinguishable.
     */
    R3D.solidMaterial = function () {
        return new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.FrontSide
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
