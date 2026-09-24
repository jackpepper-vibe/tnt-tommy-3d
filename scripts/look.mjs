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
    /* Close-ups of Tommy, cropped round him at twice the resolution. */
    hero:       { focus: true, eval: ['bare', 'TNT.game.put(9, 22)', 'TNT.game.step(30)'] },
    heroRun:    { focus: true, eval: ['bare', 'TNT.game.put(6, 22)', 'TNT.game.hold(["right"])', 'TNT.game.step(40)'] },
    heroJump:   { focus: true, eval: ['bare', 'TNT.game.put(6, 22)', 'TNT.game.hold(["jump"])', 'TNT.game.step(14)'] },
    /* Close-up of the pickups on the start room's floor: a meal and two nuggets. */
    pickups:    { focus: true, focusAt: [12, 22], eval: ['bare', 'TNT.game.put(5, 22)', 'TNT.game.step(20)'] },
    heroDog:    { focus: true, eval: ['bare', 'TNT.game.put(4, 22)', 'TNT.game.hold(["right"])', 'TNT.game.step(70)', 'TNT.game.hold([])', 'TNT.game.step(90)'] },
    heroClimb:  { focus: true, eval: ['bare', 'TNT.game.put(5, 12)', 'TNT.game.hold(["up"])', 'TNT.game.step(30)'] },
    /* A minecart bot winding up on Tommy, a rivet already in the air. */
    fight: {
        eval: [
            'bare',
            `(function () {
                const run = TNT.game.run;
                for (let i = 0; i < run.mine.rooms.length; i++) {
                    const bot = run.entities[i].enemies.find(e => e.kind === 'walker');
                    if (!bot) continue;
                    TNT.game.room(run.mine.rooms[i].id);
                    const x = bot.x + bot.dir * 90;
                    run.player.reset(x, bot.y, true);
                    run.player.active = true;
                    run.player.facing = -bot.dir;
                    run.player.invuln = 0;
                    run.energy = 1e6;
                    run.dog.placeAt(x, bot.y, -bot.dir);
                    return;
                }
            })()`,
            'TNT.game.step(128)'
        ]
    },
    /* The Governor mid-volley, a valve venting. */
    boss: {
        eval: [
            'bare', 'TNT.game.room("vault")',
            `(function () {
                const run = TNT.game.run;
                run.energy = 1e6;
                const b = run.ents().boss;
                b.valves[1].state = 'open'; b.valves[1].timer = 9;
                b.valves[0].state = 'broken';
                b.state = 'volley'; b._burst = 3; b._burstT = 0.2;
            })()`,
            'TNT.game.step(40)'
        ]
    },
    /* The workshop between mines, with cogs to spend. */
    workshop: {
        wait: 1200,
        eval: [
            'bare',
            `(function () {
                const run = TNT.game.run;
                const idx = run.entities.findIndex(e => e.detonator);
                run.roomIndex = idx;
                run.entities[idx].boss.defeat();
                run.tntFound = run.mine.tntTotal;
                const d = run.entities[idx].detonator;
                run.player.reset(d.x, d.y, true);
                run.player.active = true;
                run.cogs = 4;
            })()`,
            'TNT.game.step(260)'
        ]
    },
    fans:       { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("fanHouse")', 'TNT.game.put(38, 22)', 'TNT.game.step(70)'] },
    rails:      { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("engineRoom")', 'TNT.game.step(170)'] },
    hooks:      { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("slantShaft")', 'TNT.game.step(100)'] },
    dark:       { eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("blackGallery")', 'TNT.game.step(60)'] },
    flywheel:   { eval: ['bare', 'TNT.game.room("pumpHouse")', 'TNT.game.step(60)'] },
    winding:    { eval: ['TNT.game.begin(2)', 'bare', 'TNT.game.room("theOverlook")', 'TNT.game.step(60)'] },
    bossNoWorks: {
        eval: [
            'bare', 'TNT.game.room("vault")',
            'TNT.game.step(40)',
            'TNT.game.scene.roomView.group.children[0].visible = false'
        ]
    },
    /* The Powder Store's shuttered door and the lever that opens it. */
    gate: { eval: ['bare', 'TNT.game.room("powderStore")', 'TNT.game.put(30, 22)', 'TNT.game.step(60)'] },
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
    const page = await browser.newPage({
        viewport: { width: 1280, height: 760 },
        deviceScaleFactor: pose.focus ? 2 : 1
    });
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
    let clip;
    if (pose.focusAt) await page.evaluate(a => { window.__focusAt = a; }, pose.focusAt);
    if (pose.focus) {
        // Project Tommy to the screen and crop round him.
        const at = await page.evaluate(() => {
            const scene = TNT.game.scene;
            const v = new THREE.Vector3();
            if (window.__focusAt) v.set(window.__focusAt[0] + 0.5, 24 - window.__focusAt[1] - 0.2, 0.45);
            else { scene.actors.tommy.getWorldPosition(v); v.y += 0.6; }
            v.project(scene.camera);
            return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
        });
        const w = 220, h = 170;
        clip = {
            x: Math.max(0, Math.min(1280 - w, at.x - w / 2)),
            y: Math.max(0, Math.min(760 - h, at.y - h / 2)),
            width: w, height: h
        };
    }
    await page.screenshot({ path: file, clip: clip });
    await page.close();

    if (errors.length) failed++;
    console.log(`${errors.length ? 'ERR ' : 'ok  '} ${name.padEnd(11)} ${path.relative(ROOT, file)}`);
    for (const e of errors.slice(0, 4)) console.log('       ' + e);
}

await browser.close();
process.exit(failed ? 1 : 0);
