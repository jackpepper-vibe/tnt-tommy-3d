/**
 * TNT Tommy — small pure helpers.
 *
 * Nothing here touches game state or the renderer. The seeded RNG matters more
 * than it looks: decor scatter, ember drift and tile variant selection all run
 * off it, so a given mine looks identical on every load and a screenshot
 * comparison across a change is meaningful.
 */
(function (TNT) {
    'use strict';

    const Util = {};

    Util.clamp = function (v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    };

    Util.lerp = function (a, b, t) {
        return a + (b - a) * t;
    };

    /** Frame-rate independent approach to a target. `rate` is the fraction closed per second. */
    Util.damp = function (a, b, rate, dt) {
        return b + (a - b) * Math.exp(-rate * dt);
    };

    Util.sign = function (v) {
        return v > 0 ? 1 : (v < 0 ? -1 : 0);
    };

    /** Move `v` toward `target` by at most `step`. */
    Util.approach = function (v, target, step) {
        if (v < target) return Math.min(v + step, target);
        if (v > target) return Math.max(v - step, target);
        return target;
    };

    /** Smoothstep-eased 0..1, for camera flips and overlay fades. */
    Util.easeInOut = function (t) {
        t = Util.clamp(t, 0, 1);
        return t * t * (3 - 2 * t);
    };

    Util.easeOutBack = function (t) {
        const c = 1.70158;
        const p = t - 1;
        return 1 + (c + 1) * p * p * p + c * p * p;
    };

    /** Axis-aligned overlap test on two `{x, y, w, h}` boxes given as centres. */
    Util.overlaps = function (ax, ay, aw, ah, bx, by, bw, bh) {
        return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
    };

    /**
     * Mulberry32. Small, fast, and — the point — deterministic from a seed, so the
     * same mine scatters the same crystals every run.
     */
    Util.rng = function (seed) {
        let a = seed >>> 0;
        const next = function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        next.range = function (lo, hi) { return lo + next() * (hi - lo); };
        next.int = function (lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); };
        next.pick = function (arr) { return arr[Math.floor(next() * arr.length)]; };
        next.chance = function (p) { return next() < p; };
        return next;
    };

    /** Stable per-tile hash, for picking rock variants without storing them. */
    Util.tileHash = function (x, y) {
        let h = (x * 73856093) ^ (y * 19349663);
        h = (h ^ (h >>> 13)) >>> 0;
        return h;
    };

    Util.formatScore = function (n) {
        return String(Math.max(0, Math.floor(n))).padStart(6, '0');
    };

    Util.formatTime = function (s) {
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        return m + ':' + String(r).padStart(2, '0');
    };

    TNT.Util = Util;
})(window.TNT = window.TNT || {});
