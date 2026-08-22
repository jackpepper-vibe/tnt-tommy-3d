/**
 * TNT Tommy — sound.
 *
 * The sound effects and both chiptune tracks are carried over verbatim from the
 * Godot build. They were the best thing about it and there was no reason to
 * regenerate them; `assets/audio/` is that project's `assets/sfx/` unchanged.
 *
 * TWO TRACKS, ONE FUSE
 * --------------------
 * The main theme plays while the fuse is healthy and a faster variant takes over
 * below `C.DANGER_BELOW`. `Run` decides which, with hysteresis, so eating a meal
 * near the threshold cannot make the music flap. Here they are simply
 * crossfaded — both loop continuously, and only their gains move, so the switch
 * lands on the beat instead of restarting the bar.
 *
 * FAILING QUIETLY IS A FEATURE
 * ----------------------------
 * Everything here is wrapped. Two real cases need it, and neither is exotic:
 * `fetch` of a local file is blocked over `file://`, which is exactly how the
 * screenshot harness loads the page; and browsers refuse to start an
 * `AudioContext` before a gesture. A game that throws in either case is a game
 * that cannot be screenshotted and cannot be opened from disk. Silence is an
 * acceptable outcome; a black page is not.
 */
(function (TNT) {
    'use strict';

    const { C, Util } = TNT;
    const EV = TNT.EV;

    const SFX = ['tnt', 'food', 'life', 'hurt', 'die', 'boom', 'win', 'denied', 'start', 'bounce', 'jump'];
    const MUSIC = ['music_theme', 'music_danger'];

    function Audio(run) {
        this.run = run;
        this.ctx = null;
        this.buffers = new Map();
        this.ready = false;
        this.muted = false;
        this.master = null;
        this.musicGain = null;
        this.sources = {};
        this.current = '';
        this._lastPlayed = new Map();
        this._listen();
    }

    /**
     * Start the context. Must be called from a gesture handler — browsers will
     * not let audio begin otherwise, and the failure is silent.
     */
    Audio.prototype.unlock = function () {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.ctx = new Ctx();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.85;
            this.master.connect(this.ctx.destination);
            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = 0.5;
            this.musicGain.connect(this.master);
            this._loadAll();
        } catch (err) {
            this.ctx = null;
        }
    };

    Audio.prototype._loadAll = function () {
        const self = this;
        const names = SFX.concat(MUSIC);
        let pending = names.length;

        for (const name of names) {
            fetch('assets/audio/' + name + '.wav')
                .then(function (r) {
                    if (!r.ok) throw new Error(r.status);
                    return r.arrayBuffer();
                })
                .then(function (buf) {
                    return self.ctx.decodeAudioData(buf);
                })
                .then(function (decoded) {
                    self.buffers.set(name, decoded);
                })
                .catch(function () {
                    /* over file://, or a missing asset. Play nothing. */
                })
                .then(function () {
                    if (--pending === 0) {
                        self.ready = true;
                        self._syncMusic();
                    }
                });
        }
    };

    Audio.prototype.play = function (name, gain) {
        if (!this.ctx || this.muted) return;
        const buf = this.buffers.get(name);
        if (!buf) return;

        // Several events can land on the same step — three ore in one sweep, a
        // blast that kills four things. Retriggering the same clip inside a few
        // milliseconds is not louder, it is a click.
        const now = this.ctx.currentTime;
        if ((this._lastPlayed.get(name) || -1) > now - 0.04) return;
        this._lastPlayed.set(name, now);

        const src = this.ctx.createBufferSource();
        const g = this.ctx.createGain();
        g.gain.value = gain === undefined ? 0.7 : gain;
        src.buffer = buf;
        src.connect(g);
        g.connect(this.master);
        src.start();
    };

    Audio.prototype.music = function (track) {
        if (this.current === track) return;
        this.current = track;
        this._syncMusic();
    };

    Audio.prototype._syncMusic = function () {
        if (!this.ctx || !this.ready) return;

        for (const name of MUSIC) {
            if (this.sources[name]) continue;
            const buf = this.buffers.get(name);
            if (!buf) continue;
            const src = this.ctx.createBufferSource();
            const g = this.ctx.createGain();
            src.buffer = buf;
            src.loop = true;
            g.gain.value = 0;
            src.connect(g);
            g.connect(this.musicGain);
            src.start();
            this.sources[name] = { src: src, gain: g };
        }

        const want = this.current ? 'music_' + this.current : '';
        for (const name of MUSIC) {
            const entry = this.sources[name];
            if (!entry) continue;
            const target = (name === want && !this.muted) ? 1 : 0;
            const now = this.ctx.currentTime;
            entry.gain.gain.cancelScheduledValues(now);
            entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
            entry.gain.gain.linearRampToValueAtTime(target, now + 0.6);
        }
    };

    Audio.prototype.toggleMute = function () {
        this.muted = !this.muted;
        if (this.master) this.master.gain.value = this.muted ? 0 : 0.85;
        this._syncMusic();
        return this.muted;
    };

    /** Follow the run rather than being told about it from six call sites. */
    Audio.prototype.update = function () {
        const run = this.run;
        if (run.state === 'playing' || run.state === 'transition') {
            this.music(run.danger ? 'danger' : 'theme');
        } else if (run.state === 'title') {
            this.music('theme');
        } else if (run.state === 'boom' || run.state === 'victory' || run.state === 'gameover') {
            this.music('');
        }
    };

    Audio.prototype._listen = function () {
        const bus = this.run.bus;
        const self = this;

        bus.on(EV.PICKUP, function (e) {
            if (e.kind === 'tnt') self.play('tnt');
            else if (e.kind === 'food') self.play('food', 0.55);
            else if (e.kind === 'heart' || e.kind === 'oxygen') self.play('life');
            else self.play('food', 0.35);
        });
        bus.on(EV.ALL_TNT, function () { self.play('life'); });
        bus.on(EV.PLAYER_HURT, function () { self.play('hurt'); });
        bus.on(EV.PLAYER_DIED, function () { self.play('die'); });
        bus.on(EV.BLAST, function () { self.play('boom', 0.8); });
        bus.on(EV.BLAST_PLANTED, function () { self.play('bounce', 0.5); });
        bus.on(EV.DETONATOR_DENIED, function () { self.play('denied'); });
        bus.on(EV.DETONATOR_FIRED, function () { self.play('boom'); });
        bus.on(EV.MINE_STARTED, function () { self.play('start'); });
        bus.on(EV.PLAYER_MOUNT, function () { self.play('jump', 0.22); });
        bus.on(EV.CRUMBLE, function () { self.play('bounce', 0.35); });
        // A stomp is a small explosion, not a bounce — it has to sound like a
        // kill or it reads as having simply hopped off the thing.
        bus.on(EV.ENEMY_STOMPED, function () { self.play('boom', 0.4); });
        bus.on(EV.STATE_CHANGED, function (e) {
            if (e.to === 'victory') self.play('win');
        });
        void Util;
        void C;
    };

    TNT.Audio = Audio;
})(window.TNT = window.TNT || {});
