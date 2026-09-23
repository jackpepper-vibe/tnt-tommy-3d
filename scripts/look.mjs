/**
 * TNT Tommy — real-GPU captures.
 *
 *   node scripts/look.mjs                 every pose
 *   node scripts/look.mjs cage furnace    some of them
 *   node scripts/look.mjs --out shots/before
 *
 * `scripts/shot.mjs` drives the shared capture tool, which launches Chromium
 * with no flags and so renders on SwiftShader: slow, low-precision, and not
 * what a player sees. This launches with ANGLE on D3D11 so frames come off the
 * machine's real GPU, and it keeps one browser open across every pose.
 *
 * Judge art from these. The software captures are for "does it draw at all".
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';

const require = createRequire('C:/Claude/Tools/shot/');
const { chromium } = require('playwright');

/** Each pose runs after `pause()`; `bare` drops the title overlay. */
const POSES = {
    title:      { wait: 2400, eval: [] },
    mine:       { eval: ['bare', 'TNT.game.step(90)'] },
    powder:     { eval: ['bare', 'TNT.game.room("powderStore")', 'TNT.game.step(120)'] },
    cage:       { eval: ['bare', 'TNT.game.room("cageShaft")', 'TNT.game.step(200)'] },
    crystal:    { eval: ['bare', 'TNT.game.room("crystalGallery")', 'TNT.game.step(120)'] },
    deep:       { eval: ['bare', 'TNT.game.room("deepCut")', 'TNT.game.step(120)'] },
    drift:      { eval: ['bare', 'TNT.game.room("longDrift")', 'TNT.game.step(160)'] },
    warps:      { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("sumpLevel")', 'TNT.game.step(120)'] },
    flood:      { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("fireDamp")', 'TNT.game.step(1400)'] },
    furnace:    { eval: ['TNT.game.begin(2)', 'bare', 'TNT.game.room("theFurnace")', 'TNT.game.step(140)'] },
    cinderdeep: { eval: ['TNT.game.begin(2)', 'bare', 'TNT.game.room("slagWorks")', 'TNT.game.step(120)'] },
    vault:      { eval: ['bare', 'TNT.game.room("vault")', 'TNT.game.step(140)'] },
    blast: {
        eval: [
            'bare', 'TNT.game.room("lampRoom")', 'TNT.game.put(7, 22)',
            'TNT.game.run.tntHeld = 3; TNT.game.run.tntFound = 3',
            'TNT.game.step(40)', 'TNT.game.run._plant()', 'TNT.game.step(136)'
        ]
    }
};

const argv = process.argv.slice(2);
let outDir = path.join(ROOT, 'shots', 'gpu');
const names = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outDir = path.resolve(ROOT, argv[++i]);
    else names.push(argv[i]);
}
for (const n of names) {
    if (!POSES[n]) {
        console.error(`no pose "${n}". Known: ${Object.keys(POSES).join(', ')}`);
        process.exit(1);
    }
}
const want = names.length ? names : Object.keys(POSES);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
let failed = 0;

for (const name of want) {
    const pose = POSES[name];
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(url);
    await page.waitForFunction(() => window.TNT && window.TNT.game, null, { timeout: 15000 });
    await page.waitForTimeout(600);

    const steps = ['TNT.game.pause()'].concat(pose.eval.map(s => (s === 'bare' ? 'TNT.game.bare()' : s)));
    for (const s of steps) await page.evaluate(s);
    await page.waitForTimeout(pose.wait || 900);

    const file = path.join(outDir, name + '.png');
    await page.screenshot({ path: file });
    await page.close();

    if (errors.length) failed++;
    console.log(`${errors.length ? 'ERR ' : 'ok  '} ${name.padEnd(11)} ${path.relative(ROOT, file)}`);
    for (const e of errors.slice(0, 4)) console.log('       ' + e);
}

await browser.close();
process.exit(failed ? 1 : 0);
