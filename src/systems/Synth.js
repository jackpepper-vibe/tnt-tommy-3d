/**
 * TNT Tommy — procedural sound effects.
 *
 * The chiptune samples in `assets/audio/` carry the game's voice, and they were
 * the best thing about the Godot build, so they stay. But everything added
 * since — the dog, the Governor, the machinery, the wall kick — needs a sound
 * too, and a new sample for each would be new files the page has to fetch
 * over a network it may not have. These are synthesised on the spot from
 * oscillators and one shared buffer of noise instead: small, instant, and in
 * the same square-and-noise family as the samples, so they sit with them.
 *
 * Every voice is built, played and left for the garbage collector. Nothing is
 * pooled, because nothing here lives longer than a second.
 */
(function (TNT) {
    'use strict';

    function Synth(ctx, out) {
        this.ctx = ctx;
        this.out = out;
        // One second of white noise, reused by every noisy voice.
        const len = ctx.sampleRate;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }

    /** A gain envelope: attack to `peak`, exponential fall to silence. */
    Synth.prototype._env = function (peak, attack, decay, at) {
        const g = this.ctx.createGain();
        const t = at || this.ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        g.connect(this.out);
        return g;
    };

    Synth.prototype._tone = function (type, f0, f1, peak, attack, decay, at) {
        const t = at || this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + attack + decay);
        o.connect(this._env(peak, attack, decay, t));
        o.start(t);
        o.stop(t + attack + decay + 0.05);
    };

    Synth.prototype._noise = function (filter, freq, q, peak, attack, decay, at) {
        const t = at || this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noise;
        const f = this.ctx.createBiquadFilter();
        f.type = filter;
        f.frequency.setValueAtTime(freq, t);
        f.Q.value = q;
        src.connect(f);
        f.connect(this._env(peak, attack, decay, t));
        src.start(t, Math.random() * 0.5);
        src.stop(t + attack + decay + 0.05);
        return f;
    };

    /** Two short yaps, a Shih Tzu's worth of indignation. */
    Synth.prototype.bark = function () {
        const t = this.ctx.currentTime;
        for (let i = 0; i < 2; i++) {
            const at = t + i * 0.13;
            this._tone('square', 720, 420, 0.12, 0.005, 0.07, at);
            this._noise('bandpass', 1400, 2, 0.08, 0.004, 0.05, at);
        }
    };

    /** A bright rising three-note chime — a find. */
    Synth.prototype.chime = function (base) {
        const t = this.ctx.currentTime;
        const f = base || 880;
        [1, 1.5, 2].forEach(function (k, i) {
            this._tone('triangle', f * k, f * k, 0.16, 0.005, 0.22, t + i * 0.07);
        }, this);
    };

    /** Metal struck: detuned partials and a click. The shell, the shut valve. */
    Synth.prototype.clang = function () {
        const t = this.ctx.currentTime;
        [523, 787, 1180, 1590].forEach(function (f, i) {
            this._tone('square', f, f * 0.98, 0.05 / (i + 1), 0.002, 0.35, t);
        }, this);
        this._noise('highpass', 3000, 0.7, 0.1, 0.001, 0.04, t);
    };

    /** Steam escaping. */
    Synth.prototype.hiss = function (seconds) {
        this._noise('highpass', 2600, 0.5, 0.09, 0.05, seconds || 0.6);
    };

    /** A rivet gun: a crack and a falling note. */
    Synth.prototype.shot = function () {
        this._noise('bandpass', 1800, 1.5, 0.14, 0.002, 0.08);
        this._tone('square', 420, 90, 0.08, 0.002, 0.12);
    };

    /** A heavy lever going over, and the ratchet after it. */
    Synth.prototype.clunk = function () {
        const t = this.ctx.currentTime;
        this._tone('sine', 140, 60, 0.3, 0.004, 0.18, t);
        this._noise('lowpass', 600, 1, 0.2, 0.002, 0.08, t);
        for (let i = 0; i < 5; i++) this._noise('bandpass', 2400, 4, 0.05, 0.001, 0.02, t + 0.2 + i * 0.07);
    };

    /** A shutter winding up: a long low grind. */
    Synth.prototype.rumble = function () {
        this._noise('lowpass', 220, 2, 0.22, 0.1, 1.1);
        this._tone('sawtooth', 55, 70, 0.05, 0.1, 1.0);
    };

    /** The Governor clearing its throat: a low growl with a wobble. */
    Synth.prototype.roar = function () {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(70, t);
        const lfo = this.ctx.createOscillator();
        const depth = this.ctx.createGain();
        lfo.frequency.value = 9;
        depth.gain.value = 12;
        lfo.connect(depth);
        depth.connect(o.frequency);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        o.connect(f);
        f.connect(this._env(0.18, 0.05, 0.55, t));
        o.start(t); lfo.start(t);
        o.stop(t + 0.7); lfo.stop(t + 0.7);
    };

    /** A boot off a wall, or a hard landing. */
    Synth.prototype.thump = function (weight) {
        const w = weight || 1;
        this._tone('sine', 160 * w, 50, 0.22, 0.003, 0.12);
        this._noise('lowpass', 900, 1, 0.12, 0.002, 0.06);
    };

    /** Soles skidding on tread plate. */
    Synth.prototype.skid = function () {
        const f = this._noise('bandpass', 2200, 3, 0.06, 0.01, 0.16);
        f.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.17);
    };

    /** Into or out of the water. */
    Synth.prototype.splash = function () {
        const f = this._noise('lowpass', 2400, 0.8, 0.16, 0.005, 0.3);
        f.frequency.exponentialRampToValueAtTime(500, this.ctx.currentTime + 0.3);
        this._tone('sine', 300, 700, 0.05, 0.01, 0.12);
    };

    /** A footfall on steel — very quiet, or it becomes a metronome. */
    Synth.prototype.step = function () {
        this._noise('bandpass', 1600 + Math.random() * 600, 6, 0.025, 0.002, 0.03);
    };

    TNT.Synth = Synth;
})(window.TNT = window.TNT || {});
