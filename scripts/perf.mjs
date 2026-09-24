/**
 * TNT Tommy — frame-rate probe on the real GPU.
 *
 *   node scripts/perf.mjs
 *
 * Plays a few seconds in a handful of the heaviest rooms with vsync off and
 * reports the average and the worst frame. The look of this game is built on
 * per-pixel lighting with a dozen lights, and that has a cost that only shows
 * on a real GPU — so this runs with the same ANGLE flags as `look.mjs`.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';

const require = createRequire('C:/Claude/Tools/shot/');
const { chromium } = require('playwright');

const ROOMS = [
    [0, 'minersRest'], [0, 'vault'], [1, 'fanHouse'], [1, 'engineRoom'], [2, 'theFurnace'], [2, 'lastVault'], [2, 'theFurnace']
];

const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--disable-gpu-vsync', '--disable-frame-rate-limit']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
await page.waitForFunction(() => window.TNT && TNT.game);

const gpu = await page.evaluate(() => {
    const gl = document.getElementById('world').getContext('webgl2') || document.getElementById('world').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer: ' + gpu + '\n');

for (const [mine, id] of ROOMS) {
    const r = await page.evaluate(async ([m, room]) => {
        const g = TNT.game;
        g.begin(m);
        g.bare();
        g.room(room);
        g.run.energy = 1e6;
        g.hold(['right']);
        const times = [];
        let last = performance.now();
        await new Promise(function (done) {
            const end = last + 3000;
            const tick = function () {
                const now = performance.now();
                times.push(now - last);
                last = now;
                if (now < end) requestAnimationFrame(tick); else done();
            };
            requestAnimationFrame(tick);
        });
        g.hold([]);
        times.shift();
        times.sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        return { avg: avg, p95: times[Math.floor(times.length * 0.95)], worst: times[times.length - 1] };
    }, [mine, id]);
    console.log(`${id.padEnd(12)} ${(1000 / r.avg).toFixed(0).padStart(4)} fps   ` +
                `p95 ${r.p95.toFixed(1)}ms   worst ${r.worst.toFixed(1)}ms`);
}
await browser.close();
