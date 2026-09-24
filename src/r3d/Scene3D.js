/**
 * TNT Tommy — the scene: renderer, camera, lighting, particles and post.
 *
 * Reads the run and draws it. Nothing in here writes to the simulation.
 *
 * THE FLIP
 * --------
 * Rooms do not scroll. Leaving one slides it off and the next one on, in the
 * direction you left — the flick-screen transition both originals had. Two room
 * meshes exist for the third of a second that takes, held in a container whose
 * position is animated; actors ride in the container too, so Tommy arrives with
 * the room rather than being teleported ahead of it.
 *
 * LIGHTING IS A POOL
 * ------------------
 * The mine is dark and lit by point sources: Tommy's helmet lamp, wall lamps,
 * glowing sticks, lava, the blast. There are far more of those in a mine than a
 * WebGL1 shader can afford, and — worse — changing the *number* of lights makes
 * Three recompile every material in the scene, which stalls for a beat at
 * exactly the wrong moment. So the count is fixed at `MAX_LIGHTS` forever, and
 * each frame the nearest sources are assigned into the existing slots. Unused
 * slots are dimmed to zero rather than removed.
 *
 * COLOUR THROUGH THE POST PASS
 * ----------------------------
 * The scene renders into a target that is explicitly tagged sRGB, so Three
 * encodes on the way in. The composite shader then samples and writes those
 * values through untouched. Custom shaders get no colour management at all, so
 * doing anything else here means converting twice and washing the mine out to
 * grey — which is the failure this whole art direction cannot survive.
 */
(function (TNT, THREE) {
    'use strict';

    const { C, Util, R3D, RoomMesh, Actors3D } = TNT;
    const EV = TNT.EV;

    /** Fixed for the life of the page. See the header. */
    const MAX_LIGHTS = 12;
    const MAX_PARTICLES = 700;
    /** How far, in tiles, the camera leans toward Tommy. See `draw`. */
    const DRIFT_X = 0.9;
    const DRIFT_Y = 0.5;

    function Scene3D(canvas, run) {
        this.canvas = canvas;
        this.run = run;
        this.t = 0;

        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            powerPreference: 'high-performance',
            // Without this the drawing buffer is discarded as soon as the
            // browser has composited it, and any capture taken while the frame
            // loop is stopped comes back blank — which is precisely how the
            // screenshot harness works. Every shot of this game was a black
            // rectangle until this line existed, and the renderer was innocent
            // the whole time: draw calls were being issued and the geometry was
            // exactly where it should be. Verification is worth the small cost.
            preserveDrawingBuffer: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.setClearColor(0x000000, 1);

        // Three's shader-error check reads `getProgramInfoLog().trim()` without
        // guarding it. Software GL — which is exactly what the headless
        // screenshot harness runs on — returns *null* rather than an empty
        // string when a program links cleanly, so the check itself throws on a
        // program that was perfectly fine. The symptom is a hard crash the
        // first time any new material variant appears, which made the game
        // impossible to capture. Nothing is lost by turning it off: it is a
        // development diagnostic, and shader authoring here is one file.
        this.renderer.debug.checkShaderErrors = false;

        this.scene = new THREE.Scene();
        this.worldGroup = new THREE.Group();
        this.scene.add(this.worldGroup);

        /**
         * A wide lens, deliberately.
         *
         * At 46 degrees the camera sat thirty units back and the projection was
         * very nearly orthographic — every block presented only its front face
         * and the depth that *was* modelled never appeared on screen. Widening
         * the lens brings the camera close enough for real divergence: blocks
         * away from centre show their sides, the parallax sheets separate, and
         * the playfield reads as a slab with thickness rather than a mural.
         */
        this.camera = new THREE.PerspectiveCamera(68, 1.75, 0.1, 400);
        this.scene.add(this.camera);

        /**
         * `?nopost` renders the scene straight to the canvas.
         *
         * Kept because the composite pass is the one part of the pipeline that
         * can fail invisibly — a broken shader there produces a black screen
         * that looks exactly like a broken camera, a broken palette or an empty
         * scene. Being able to take the pass out without editing anything turns
         * an afternoon of bisecting into one screenshot.
         */
        this.usePost = !/[?&]nopost\b/.test(window.location.search);

        this.palette = R3D.palette('copper');
        this._initLights();
        this._initParticles();
        this._initPost();

        this.actors = Actors3D.create(this.worldGroup);
        this.roomView = null;
        this.oldView = null;
        this.slide = null;
        this.offset = new THREE.Vector2(0, 0);

        /** 0..1; decays linearly, and the shake scales with its square. */
        this.trauma = 0;
        this.drift = new THREE.Vector2(0, 0);
        this.flash = 0;
        this.crt = false;

        this._listen();
        this.resize();
    }

    /* ------------------------------------------------------------------ *
     * Lights
     * ------------------------------------------------------------------ */

    /**
     * Ambient, sky bounce, and the point-light pool.
     *
     * **Decay is 1, not 2.** Physically correct inverse-square falloff is wrong
     * at this scale and it is worth being explicit about why: a world unit here
     * is a *tile*, so a room is forty-two units across, and a lamp with
     * quadratic decay is down to a twentieth of its strength four tiles out.
     * Every room came out pitch black with a faint halo round Tommy's boots.
     * Linear decay over a generous radius is what makes a lamp read as lighting
     * a working rather than as a torch in a void.
     */
    Scene3D.prototype._initLights = function () {
        const pal = this.palette;
        /*
         * Low, and lower than they were. The mine used to be lit like a room
         * with the lights on — ambient at 0.78 over a sky-blue backdrop — and
         * that flatness was half of why it never felt underground. The fill is
         * now just enough to keep a silhouette off black; everything warm in a
         * room is a lamp, a furnace or Tommy's helmet.
         */
        this.ambient = new THREE.AmbientLight(new THREE.Color(pal.ambient), 0.56);
        this.hemi = new THREE.HemisphereLight(new THREE.Color(pal.hemi), new THREE.Color('#120c08'), 0.36);

        /**
         * A key light, raked down from the front-left.
         *
         * Point lights alone light a scene but do not give it *form*: with
         * nothing directional in it, every face of every block took the same
         * value and the mine read as flat coloured shapes however much texture
         * was on them. This is what makes the top of a platform brighter than
         * its face, and a beam brighter than the wall behind it.
         */
        this.key = new THREE.DirectionalLight(new THREE.Color('#ffd7a8'), 0.42);
        this.key.position.set(-0.45, 1, 0.8);

        this.scene.add(this.ambient, this.hemi, this.key);

        /**
         * The helmet lamp, as a real spot.
         *
         * The point light in slot zero lights the space round Tommy; this
         * throws a pool *ahead* of him, onto the wall and the next deck, in
         * the direction he is facing. In a works this dark it is the most
         * characterful light in the game — the one that moves with him and
         * shows you where you are about to go.
         *
         * Created once, here, like every other light: the count never changes.
         */
        this.headlamp = new THREE.SpotLight(0xfff0d0, 0, 18, 0.42, 0.75, 1);
        this.headlamp.target = new THREE.Object3D();
        this.scene.add(this.headlamp, this.headlamp.target);

        this.lightPool = [];
        for (let i = 0; i < MAX_LIGHTS; i++) {
            const l = new THREE.PointLight(0xffffff, 0, 16, 1);
            this.scene.add(l);
            this.lightPool.push(l);
        }
        /** Rebuilt per frame; never allocated in the loop. */
        this._candidates = [];
    };

    /**
     * Swap the mine's palette.
     *
     * There is deliberately no scene fog. It was tried and removed for two
     * reasons, in that order of importance. First it does nothing: the camera
     * sits at a fixed distance and the whole playfield is a slab about three
     * units deep, so every fragment lands at essentially the same depth and
     * fog resolves to a flat tint the palette already applies — depth cueing
     * here comes from `backFar` on the backdrop, which is a colour, not a
     * distance. Second, turning it on adds a shader variant that fails to link
     * under software GL, and Three then crashes reading the (null) info log of
     * the program that failed — which is what a headless screenshot run is.
     */
    Scene3D.prototype._applyPalette = function (key) {
        this.palette = R3D.palette(key);
        this.ambient.color = new THREE.Color(this.palette.ambient);
        this.hemi.color = new THREE.Color(this.palette.hemi);
        this.key.color = new THREE.Color(this.palette.lamp);
        this.renderer.setClearColor(new THREE.Color(this.palette.fog), 1);
    };

    Scene3D.prototype._syncLights = function () {
        const run = this.run;
        const player = run.player;
        const cands = this._candidates;
        cands.length = 0;

        // Tommy's helmet lamp, always slot zero. It is the light the player
        // navigates by, so it never loses its place to scenery.
        const px = R3D.wx(player.x) + this.offset.x;
        const py = R3D.wy(player.centreY()) + this.offset.y;
        const flicker = 0.94 + Math.sin(this.t * 9) * 0.04 + Math.sin(this.t * 23) * 0.02;

        const slots = this.lightPool;
        slots[0].position.set(px, py, 2.4);
        slots[0].color.set(this.palette.lamp);
        slots[0].intensity = (run.state === 'title' ? 0.35 : 2.1) * flicker;
        slots[0].distance = 22;

        const lamp = this.headlamp;
        const face = player.facing >= 0 ? 1 : -1;
        const climbing = player.mode === 'climb';
        lamp.position.set(px + face * 0.35, py + 0.9, 1.2);
        lamp.target.position.set(px + (climbing ? 0 : face * 7), py + (climbing ? 3 : -0.3), -3.4);
        lamp.intensity = (run.state === 'playing' || run.state === 'transition') && player.alive
            ? (this.dark ? 3.2 : 2.2) * flicker : 0;
        lamp.distance = this.dark ? 24 : 18;

        if (this.roomView) {
            for (const src of this.roomView.lights) {
                const dx = src.x + this.offset.x - px;
                const dy = src.y + this.offset.y - py;
                cands.push({ src: src, d2: dx * dx + dy * dy });
            }
        }
        cands.sort(function (a, b) { return a.d2 - b.d2; });

        let slot = 1;
        for (let i = 0; i < cands.length && slot < MAX_LIGHTS - 1; i++, slot++) {
            const s = cands[i].src;
            const l = slots[slot];
            // Each source at its own depth: a lamp bolted to the wall has to
            // be *at* the wall to pool on it. Everything used to sit in front
            // of the play plane, which lit the decks flat and the wall barely.
            l.position.set(s.x + this.offset.x, s.y + this.offset.y, s.z === undefined ? 1.0 : s.z);
            l.color.set(s.colour);
            const f = s.flicker ? 1 + Math.sin(this.t * (7 + slot * 3)) * s.flicker : 1;
            l.intensity = s.energy * f;
            l.distance = s.range;
        }

        // The last slot is kept free for the blast, which has to be able to
        // outshine anything else in the room the instant it happens.
        const blast = slots[MAX_LIGHTS - 1];
        if (this.flash > 0.01) {
            blast.position.set(this.flashX, this.flashY, 2.2);
            blast.color.set('#ffcf8a');
            blast.intensity = this.flash * 5;
            blast.distance = 26;
        } else {
            blast.intensity = 0;
        }

        for (let i = slot; i < MAX_LIGHTS - 1; i++) slots[i].intensity = 0;
    };

    /* ------------------------------------------------------------------ *
     * Particles
     * ------------------------------------------------------------------ */

    Scene3D.prototype._initParticles = function () {
        const positions = new Float32Array(MAX_PARTICLES * 3);
        const colors = new Float32Array(MAX_PARTICLES * 3);
        const sizes = new Float32Array(MAX_PARTICLES);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const mat = new THREE.PointsMaterial({
            size: 0.28,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            map: R3D.dotTexture(),
            sizeAttenuation: true
        });

        this.points = new THREE.Points(geo, mat);
        this.points.frustumCulled = false;
        this.worldGroup.add(this.points);

        /** Dead particles are recycled from a free list; nothing is allocated. */
        this.particles = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
            this.particles.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, drag: 0, grav: 0 });
        }
        this._pcursor = 0;
    };

    Scene3D.prototype.addTrauma = function (amount) {
        this.trauma = Math.min(1, this.trauma + amount);
    };

    Scene3D.prototype.burst = function (x, y, opts) {
        const o = opts || {};
        const n = o.count || 14;
        const colour = R3D.col(o.colour || '#ffb84d');
        const wx = R3D.wx(x) + this.offset.x;
        const wy = R3D.wy(y) + this.offset.y;

        for (let i = 0; i < n; i++) {
            const p = this.particles[this._pcursor];
            this._pcursor = (this._pcursor + 1) % MAX_PARTICLES;
            const a = Math.random() * Math.PI * 2;
            const s = (o.speed || 4) * (0.35 + Math.random() * 0.65);
            p.x = wx + (Math.random() - 0.5) * 0.3;
            p.y = wy + (Math.random() - 0.5) * 0.3;
            p.z = (o.z === undefined ? 0.5 : o.z) + (Math.random() - 0.5) * 0.4;
            p.vx = Math.cos(a) * s;
            // A bias sideways, for dust thrown off one side of a foot.
            if (o.spreadX) p.vx = Math.abs(p.vx) * o.spreadX;
            p.vy = o.spreadX ? Math.abs(Math.sin(a) * s) * 0.6 + (o.lift || 0) : Math.sin(a) * s + (o.lift || 0);
            p.vz = (Math.random() - 0.5) * 0.6;
            p.max = p.life = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
            p.r = colour.r; p.g = colour.g; p.b = colour.b;
            p.grav = o.grav === undefined ? -9 : o.grav;
            p.drag = o.drag === undefined ? 1.4 : o.drag;
        }
    };

    /**
     * Steam from the pipework, and dust hanging in the lamplight.
     *
     * Both are ambient rather than eventful, and both matter more than their
     * cost suggests: a room in which nothing moves unless the player does
     * reads as a diorama. A weeping flange and motes drifting through a lamp
     * beam are what make the air in a works feel like air.
     */
    Scene3D.prototype._ambientParticles = function (dt) {
        if (!this.roomView || this.slide) return;
        const view = this.roomView;
        view.steamT = (view.steamT || 0) + dt;
        if (view.steamT > 0.09) {
            view.steamT = 0;
            for (const e of view.emitters) {
                if (Math.random() > 0.35) continue;
                const px = (e.x) * C.TILE;
                const py = C.ROOM_H - e.y * C.TILE;
                this.burst(px, py, { count: 1, colour: '#8c96a0', speed: 0.6, life: 1.6,
                                     lift: 1.2, grav: 0.4, drag: 0.8, z: e.z });
            }
        }
        this._dustT = (this._dustT || 0) + dt;
        if (this._dustT > 0.12) {
            this._dustT = 0;
            const x = Math.random() * C.ROOM_W;
            const y = Math.random() * C.ROOM_H;
            this.burst(x, y, { count: 1, colour: '#6e5a44', speed: 0.15, life: 5, grav: -0.05,
                               drag: 0.2, z: -0.6 - Math.random() * 1.6, size: 0.6 });
        }
    };

    Scene3D.prototype._updateParticles = function (dt) {
        const pos = this.points.geometry.attributes.position.array;
        const col = this.points.geometry.attributes.color.array;
        let n = 0;

        for (const p of this.particles) {
            if (p.life <= 0) continue;
            p.life -= dt;
            if (p.life <= 0) continue;
            p.vy += p.grav * dt;
            const d = Math.exp(-p.drag * dt);
            p.vx *= d; p.vy *= d; p.vz *= d;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            const k = p.life / p.max;
            pos[n * 3] = p.x;
            pos[n * 3 + 1] = p.y;
            pos[n * 3 + 2] = p.z;
            col[n * 3] = p.r * k;
            col[n * 3 + 1] = p.g * k;
            col[n * 3 + 2] = p.b * k;
            n++;
        }

        this.points.geometry.setDrawRange(0, n);
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;
    };

    /* ------------------------------------------------------------------ *
     * Post
     * ------------------------------------------------------------------ */

    Scene3D.prototype._initPost = function () {
        this.target = new THREE.WebGLRenderTarget(2, 2, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat
        });
        // Tagged so Three encodes on the way in and the composite can pass the
        // values straight through. See the module header.
        this.target.texture.encoding = THREE.sRGBEncoding;

        this.postScene = new THREE.Scene();
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.postUniforms = {
            tDiffuse: { value: this.target.texture },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uTime: { value: 0 },
            uVignette: { value: 1.15 },
            uBloom: { value: 0.85 },
            uScanlines: { value: 0 },
            uFlash: { value: 0 },
            uDanger: { value: 0 }
        };

        const quad = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.ShaderMaterial({
                uniforms: this.postUniforms,
                vertexShader: [
                    'varying vec2 vUv;',
                    'void main() {',
                    '  vUv = uv;',
                    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
                    '}'
                ].join('\n'),
                fragmentShader: [
                    'uniform sampler2D tDiffuse;',
                    'uniform vec2 uResolution;',
                    'uniform float uTime, uVignette, uBloom, uScanlines, uFlash, uDanger;',
                    'varying vec2 vUv;',
                    '',
                    '// Bright-pass blur, done in the composite rather than as its own',
                    '// ping-pong pair of targets. Twelve taps on a ring is plenty for a',
                    '// lamp-lit mine and costs one pass instead of five.',
                    'vec3 bloom(vec2 uv) {',
                    '  vec3 sum = vec3(0.0);',
                    '  vec2 px = 2.6 / uResolution;',
                    '  for (int i = 0; i < 12; i++) {',
                    '    float a = float(i) * 0.5235988;',
                    '    vec2 o = vec2(cos(a), sin(a));',
                    '    sum += max(texture2D(tDiffuse, uv + o * px * 2.0).rgb - 0.55, 0.0);',
                    '    sum += max(texture2D(tDiffuse, uv + o * px * 4.5).rgb - 0.55, 0.0);',
                    '  }',
                    '  return sum / 24.0;',
                    '}',
                    '',
                    'void main() {',
                    '  vec2 uv = vUv;',
                    '  vec2 c = uv - 0.5;',
                    '',
                    '  // No lens colour separation. It was here, and at this scale it',
                    '  // put a red and green fringe on every small bright edge — the',
                    '  // character above all — which read as a broken display.',
                    '  vec3 col = texture2D(tDiffuse, uv).rgb;',
                    '',
                    '  col += bloom(uv) * uBloom;',
                    '',
                    '  // The fuse running low pulls the whole picture toward the fire.',
                    '  col = mix(col, col * vec3(1.25, 0.72, 0.62), uDanger * (0.55 + 0.45 * sin(uTime * 6.0)));',
                    '  col += vec3(1.0, 0.86, 0.66) * uFlash;',
                    '',
                    '  float v = 1.0 - dot(c, c) * uVignette;',
                    '  col *= clamp(v, 0.0, 1.0);',
                    '',
                    '  if (uScanlines > 0.5) {',
                    '    float line = sin(uv.y * uResolution.y * 1.6) * 0.5 + 0.5;',
                    '    col *= 1.0 - (1.0 - line) * 0.14;',
                    '  }',
                    '',
                    '  gl_FragColor = vec4(col, 1.0);',
                    '}'
                ].join('\n'),
                depthTest: false,
                depthWrite: false
            })
        );
        quad.frustumCulled = false;
        this.postScene.add(quad);
    };

    /* ------------------------------------------------------------------ *
     * Rooms
     * ------------------------------------------------------------------ */

    /**
     * Swap in a room, sliding the old one out if we walked there.
     *
     * `dir` is null when the room changes without travel — starting a mine, or
     * respawning — and then the swap is instant. Sliding on a respawn would
     * animate a room the player never left.
     */
    Scene3D.prototype.setRoom = function (room, dir) {
        const built = RoomMesh.build(room, this.palette);
        /*
         * A blackout room drops the fill to almost nothing, so the helmet is
         * the light — the one room type where the headlamp stops being
         * atmosphere and becomes the thing you navigate by.
         */
        this.dark = !!room.dark;
        this.ambient.intensity = this.dark ? 0.16 : 0.56;
        this.hemi.intensity = this.dark ? 0.1 : 0.36;
        this.key.intensity = this.dark ? 0.08 : 0.42;

        if (this.oldView) {
            R3D.dispose(this.oldView.group);
            this.oldView = null;
        }

        const off = new THREE.Vector2(0, 0);
        if (dir === 'right') off.x = C.COLS;
        else if (dir === 'left') off.x = -C.COLS;
        else if (dir === 'up') off.y = C.ROWS;
        else if (dir === 'down') off.y = -C.ROWS;

        if (dir && this.roomView) {
            this.oldView = this.roomView;
            built.group.position.set(off.x, off.y, 0);
            this.offset.set(off.x, off.y);
            this.slide = { t: 0, len: 0.34, from: new THREE.Vector2(0, 0), to: off };
        } else {
            if (this.roomView) R3D.dispose(this.roomView.group);
            built.group.position.set(0, 0, 0);
            this.offset.set(0, 0);
            this.slide = null;
            this.worldGroup.position.set(0, 0, 0);
        }

        this.roomView = built;
        this.worldGroup.add(built.group);
        this.actors.group.position.set(this.offset.x, this.offset.y, 0);
        this.points.position.set(0, 0, 0);
    };

    Scene3D.prototype._updateSlide = function (dt) {
        if (!this.slide) return;
        const s = this.slide;
        s.t = Math.min(s.len, s.t + dt);
        const k = Util.easeInOut(s.t / s.len);
        this.worldGroup.position.set(-s.to.x * k, -s.to.y * k, 0);
        if (s.t >= s.len) {
            this.slide = null;
            if (this.oldView) { R3D.dispose(this.oldView.group); this.oldView = null; }
            this.roomView.group.position.set(0, 0, 0);
            this.worldGroup.position.set(0, 0, 0);
            this.offset.set(0, 0);
            this.actors.group.position.set(0, 0, 0);
        }
    };

    /* ------------------------------------------------------------------ *
     * Events
     * ------------------------------------------------------------------ */

    Scene3D.prototype._listen = function () {
        const bus = this.run.bus;
        const self = this;

        bus.on(EV.MINE_STARTED, function (e) {
            self._applyPalette(e.mine.palette);
            self.roomView = self.roomView;   // palette applies on the next build
        });

        bus.on(EV.ROOM_CHANGED, function (e) {
            self.setRoom(e.room, e.dir);
        });

        bus.on(EV.SHAKE, function (e) {
            self.addTrauma(e.amount * 0.75);
        });

        bus.on(EV.PICKUP, function (e) {
            const colour = e.kind === 'tnt' ? '#ffb84d'
                : e.kind === 'heart' ? '#ff7aa0'
                : e.kind === 'oxygen' ? '#5cc8de'
                : e.kind === 'food' ? '#8fd45a' : '#ffe07a';
            self.burst(e.x, e.y, { count: 14, colour: colour, speed: 3.4, life: 0.5, lift: 1.5 });
        });

        /*
         * Dust. Every contact Tommy makes with the works kicks some up — a
         * landing, a take-off, a skid, a footfall, a wall kick — and it is dim
         * and brown and falls back, so it reads as grit rather than as sparks.
         * Movement with no trace of contact is movement on ice.
         */
        const DUST = '#5a4a3a';
        const dust = function (x, y, n, speed, dir) {
            self.burst(x, y, {
                count: n, colour: DUST, speed: speed, life: 0.45, lift: 0.8,
                grav: -4, drag: 3.2, spreadX: dir || 0
            });
        };

        bus.on(EV.PLAYER_LANDED, function (e) {
            dust(e.x - 5, e.y, e.hard ? 12 : 5, e.hard ? 4 : 2.2, -1);
            dust(e.x + 5, e.y, e.hard ? 12 : 5, e.hard ? 4 : 2.2, 1);
            if (e.hard) self.addTrauma(0.45);
        });

        bus.on(EV.PLAYER_JUMPED, function (e) { dust(e.x, e.y, 5, 1.8); });
        bus.on(EV.PLAYER_SKID, function (e) { dust(e.x - e.dir * 4, e.y, 7, 2.6, -e.dir); });
        bus.on(EV.PLAYER_STEP, function (e) { dust(e.x, e.y, 1, 0.9); });
        bus.on(EV.WALL_JUMP, function (e) {
            dust(e.x, e.y - 10, 8, 3, -e.side);
            self.addTrauma(0.18);
        });

        bus.on(EV.ENEMY_STOMPED, function (e) {
            self.burst(e.x, e.y, { count: 12 + e.chain * 3, colour: '#ffe7a0', speed: 4.5, life: 0.4, grav: -5 });
            self.burst(e.x, e.y, { count: 8, colour: '#9a8a78', speed: 2.5, life: 0.5, grav: -6 });
        });

        bus.on(EV.DOG_BARK, function (e) {
            self.burst(e.x + 6, e.y - 14, { count: 3, colour: '#fff2d0', speed: 1.4, life: 0.3, lift: 2, grav: 0 });
        });

        bus.on(EV.ENEMY_FIRED, function (e) {
            self.burst(e.x, e.y, { count: 8, colour: '#ffc060', speed: 3, life: 0.2, grav: -2 });
        });
        bus.on(EV.SHOT_HIT, function (e) {
            self.burst(e.x, e.y, { count: 10, colour: '#ffb050', speed: 4, life: 0.3, grav: -9 });
        });
        bus.on(EV.ARMOUR_CLANG, function (e) {
            self.burst(e.x, e.y - 6, { count: 12, colour: '#fff4d0', speed: 5, life: 0.22, grav: -10 });
            self.addTrauma(0.15);
        });

        bus.on(EV.PLAYER_HURT, function (e) {
            self.burst(e.x, e.y - 10, { count: 18, colour: '#ff6a5c', speed: 5, life: 0.5 });
        });

        bus.on(EV.PLAYER_DIED, function (e) {
            self.burst(e.x, e.y - 10, { count: 40, colour: '#ff7a5c', speed: 7, life: 0.9 });
        });

        bus.on(EV.BLAST, function (e) {
            self.burst(e.x, e.y, { count: 70, colour: '#ffd06a', speed: 11, life: 0.85, grav: -7 });
            self.burst(e.x, e.y, { count: 30, colour: '#ff5c3a', speed: 6, life: 1.1, grav: -3 });
            self.flash = 1;
            self.flashX = R3D.wx(e.x) + self.offset.x;
            self.flashY = R3D.wy(e.y) + self.offset.y;
        });

        bus.on(EV.CRUMBLE, function (e) {
            self.burst(e.x, e.y, { count: 12, colour: '#8a6a44', speed: 2.5, life: 0.6 });
        });

        bus.on(EV.BOULDER_SMASH, function (e) {
            self.burst(e.x, e.y, { count: 16, colour: '#7a6a58', speed: 4, life: 0.5 });
            self.addTrauma(0.3);
        });

        bus.on(EV.CRUSH_SLAM, function (e) {
            self.burst(e.x, e.y + 60, { count: 10, colour: '#ffcf8a', speed: 5, life: 0.25, grav: -8 });
            self.addTrauma(0.22);
        });

        bus.on(EV.VENT_FIRED, function (e) {
            self.burst(e.x, e.y - 8, { count: 10, colour: '#bfe4ff', speed: 2, life: 0.5, grav: 3, drag: 2.2 });
        });

        bus.on(EV.DETONATOR_FIRED, function (e) {
            self.flash = 1.4;
            self.flashX = R3D.wx(e.x) + self.offset.x;
            self.flashY = R3D.wy(e.y) + self.offset.y;
            for (let i = 0; i < 5; i++) {
                self.burst(e.x + (Math.random() - 0.5) * 90, e.y - Math.random() * 60,
                           { count: 40, colour: '#ffcf6a', speed: 12, life: 1.2, grav: -6 });
            }
        });
    };

    /* ------------------------------------------------------------------ *
     * Frame
     * ------------------------------------------------------------------ */

    Scene3D.prototype.resize = function () {
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h, false);

        const ratio = this.renderer.getPixelRatio();
        this.target.setSize(Math.floor(w * ratio), Math.floor(h * ratio));
        this.postUniforms.uResolution.value.set(w * ratio, h * ratio);

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this._frameRoom();
    };

    /**
     * Pull the camera back far enough that the whole room is on screen.
     *
     * Whichever of width or height is the binding constraint wins, so the room
     * is always fully visible — a flick-screen game where part of the screen is
     * off screen is not one. A little headroom is added so the frame is not
     * flush against the rock.
     */
    Scene3D.prototype._frameRoom = function () {
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        // Headroom covers the drift, so leaning never crops the room.
        const needH = (C.ROWS / 2 + 0.25 + DRIFT_Y) / Math.tan(vFov / 2);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
        const needW = (C.COLS / 2 + 0.25 + DRIFT_X) / Math.tan(hFov / 2);
        this.camDist = Math.max(needH, needW);
    };

    Scene3D.prototype.draw = function (alpha, dt) {
        const run = this.run;
        this.t += dt;

        this._updateSlide(dt);
        this._ambientParticles(dt);
        // Grit off the wall while Tommy slides down it.
        const pl = run.player;
        if (pl.wallSlide !== 0 && run.state === 'playing') {
            this._slideDust = (this._slideDust || 0) + dt;
            if (this._slideDust > 0.05) {
                this._slideDust = 0;
                this.burst(pl.x + pl.wallSlide * 6, pl.y - 14, {
                    count: 1, colour: '#6a5a48', speed: 0.8, life: 0.35, grav: -3, drag: 2 });
            }
        }
        this._updateParticles(dt);
        if (this.roomView && this.roomView.update) this.roomView.update(this.t);
        if (this.oldView && this.oldView.update) this.oldView.update(this.t);

        this.trauma = Math.max(0, this.trauma - dt * 1.6);
        this.flash = Util.damp(this.flash, 0, 4.5, dt);

        /*
         * The camera drifts a little toward Tommy.
         *
         * Not a follow cam — the room stays whole on screen, which is what a
         * flick-screen game is — but a slow lean of a tile or so. The point is
         * parallax: the wall, the hall and the far dark sit at very different
         * depths, and only a camera that moves makes them slide against one
         * another. Held still, the deepest scene in the world is a painting.
         */
        const player = run.player;
        const wantX = run.state === 'title' ? Math.sin(this.t * 0.2) * 0.6
            : (Util.clamp(player.x / C.ROOM_W, 0, 1) - 0.5) * 2 * DRIFT_X;
        const wantY = run.state === 'title' ? 0
            : (0.5 - Util.clamp(player.centreY() / C.ROOM_H, 0, 1)) * 2 * DRIFT_Y;
        this.drift.x = Util.damp(this.drift.x, wantX, 2.2, dt);
        this.drift.y = Util.damp(this.drift.y, wantY, 2.2, dt);

        /*
         * Shake is *trauma*, squared, driven by smooth noise.
         *
         * It used to be a fresh random offset every frame, which at sixty
         * frames a second is not a shake but a buzz — the picture blurs rather
         * than jolts. Summed sines at unrelated rates move the camera through a
         * continuous path instead, and squaring the trauma means small knocks
         * barely register while a blast really throws the frame about.
         */
        const k = this.trauma * this.trauma;
        const st = this.t * 38;
        const jitterX = k * 0.9 * (Math.sin(st * 1.0) * 0.6 + Math.sin(st * 2.3 + 1.7) * 0.4);
        const jitterY = k * 0.9 * (Math.sin(st * 1.3 + 0.5) * 0.6 + Math.sin(st * 2.9 + 3.1) * 0.4);
        const roll = k * 0.02 * Math.sin(st * 1.7 + 2.2);
        const cx = C.COLS / 2 + this.drift.x, cy = C.ROWS / 2 + this.drift.y;
        this.camera.position.set(cx + jitterX, cy + jitterY, this.camDist);
        this.camera.lookAt(cx + jitterX * 0.6, cy + jitterY * 0.6, 0);
        this.camera.rotation.z += roll;

        Actors3D.sync(this.actors, run, dt);
        this._syncLights();

        if (!this.usePost) {
            this.renderer.setRenderTarget(null);
            this.renderer.render(this.scene, this.camera);
            return;
        }

        this.postUniforms.uTime.value = this.t;
        this.postUniforms.uFlash.value = Math.min(this.flash * 0.35, 0.5);
        this.postUniforms.uDanger.value = (run.state === 'playing' && run.danger) ? 0.55 : 0;
        this.postUniforms.uScanlines.value = this.crt ? 1 : 0;

        this.renderer.setRenderTarget(this.target);
        this.renderer.clear();
        this.renderer.render(this.scene, this.camera);

        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.postCamera);
    };

    Scene3D.prototype.toggleCrt = function () {
        this.crt = !this.crt;
        return this.crt;
    };

    TNT.Scene3D = Scene3D;
})(window.TNT = window.TNT || {}, window.THREE);
