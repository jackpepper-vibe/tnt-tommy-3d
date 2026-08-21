/**
 * TNT Tommy — screenshots.
 *
 *   node scripts/shot.mjs            every shot
 *   node scripts/shot.mjs vault      one of them
 *
 * Wraps the shared capture tool with the states worth looking at. Two rules
 * about driving this game from a harness, both learned the hard way:
 *
 *   - Call `TNT.game.pause()` first. It freezes the *simulation* and leaves the
 *     frame loop drawing. Stopping the loop outright makes every capture black:
 *     with no animation frame pending the browser composites the canvas from
 *     whatever it likes, no matter what was rendered into it.
 *   - Call `TNT.game.bare()` to drop the title overlay, which is otherwise a
 *     near-opaque sheet over the entire mine.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';

const TOOL = 'C:/Claude/Tools/shot/shot.mjs';

/** `pause` and `bare` are prepended to every one of these. */
const SHOTS = {
    title: {
        desc: 'the title card over a live room',
        wait: 2600,
        eval: []
    },
    mine: {
        desc: "Copperlode, Miner's Rest — ladders, a rope, the main shaft",
        wait: 2600,
        eval: ['bare', 'TNT.game.step(90)']
    },
    powder: {
        desc: 'Powder Store — the spike bed and the drop-through decks',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("powderStore")', 'TNT.game.step(120)']
    },
    cage: {
        desc: 'Cage Shaft — the winding cage in its headframe',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("cageShaft")', 'TNT.game.step(200)']
    },
    crystal: {
        desc: 'Crystal Gallery — the trampoline, the roof rope and the vines',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("crystalGallery")', 'TNT.game.step(120)']
    },
    deep: {
        desc: 'The Deep Cut — the flooded sump and the ceiling droppers',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("deepCut")', 'TNT.game.step(120)']
    },
    drift: {
        desc: 'The Long Drift — the lava channel and the tram over it',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("longDrift")', 'TNT.game.step(160)']
    },
    warps: {
        desc: 'Sump Level — paired warp pads either side of the water',
        wait: 2800,
        eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("sumpLevel")', 'TNT.game.step(120)']
    },
    flood: {
        desc: 'Fire Damp — the seam filling up while you stand in it',
        wait: 3000,
        eval: ['TNT.game.begin(1)', 'bare', 'TNT.game.room("fireDamp")', 'TNT.game.step(1400)']
    },
    furnace: {
        desc: 'The Furnace — Cinderdeep at its worst',
        wait: 2800,
        eval: ['TNT.game.begin(2)', 'bare', 'TNT.game.room("theFurnace")', 'TNT.game.step(140)']
    },
    escape: {
        desc: 'The run out — the seam coming down',
        wait: 2600,
        eval: [
            'bare',
            'TNT.game.run.tntFound = TNT.game.run.mine.tntTotal - 1',
            'TNT.game.run.escape = 28; TNT.game.run.bus.emit(TNT.EV.ESCAPE_STARTED, {seconds:28})',
            'TNT.game.step(90)'
        ]
    },
    vault: {
        desc: 'The Vault — the plunger, and the piston guarding it',
        wait: 2600,
        eval: ['bare', 'TNT.game.room("vault")', 'TNT.game.step(140)']
    },
    blast: {
        desc: 'A stick going off against the fissure in the Lamp Room',
        wait: 2800,
        eval: [
            'bare',
            'TNT.game.room("lampRoom")',
            'TNT.game.put(7, 22)',
            'TNT.game.run.tntHeld = 3; TNT.game.run.tntFound = 3',
            'TNT.game.run.ents().pickups.filter(function(p){return p.kind==="tnt"}).forEach(function(p){p.take()})',
            // Let him land first — planting requires both feet on the ground —
            // then run just past the fuse so the capture lands on the bang.
            'TNT.game.step(40)',
            'TNT.game.run._plant()',
            'TNT.game.step(136)'
        ]
    },
    danger: {
        desc: 'The fuse almost out — the picture pulls toward the fire',
        wait: 2600,
        eval: ['bare', 'TNT.game.step(60)', 'TNT.game.run.energy = 12; TNT.game.run.danger = true', 'TNT.game.step(30)']
    },
    cinderdeep: {
        desc: 'Cinderdeep — Slag Works, and a floor made of lava',
        wait: 2800,
        eval: ['TNT.game.begin(2)', 'bare', 'TNT.game.room("slagWorks")', 'TNT.game.step(120)']
    },
    crt: {
        desc: 'Scanlines on',
        wait: 2600,
        eval: ['bare', 'TNT.game.crt(true)', 'TNT.game.step(90)']
    }
};

const want = process.argv[2];
const names = want ? [want] : Object.keys(SHOTS);

if (want && !SHOTS[want]) {
    console.error(`no shot called "${want}". Known: ${Object.keys(SHOTS).join(', ')}`);
    process.exit(1);
}

for (const name of names) {
    const shot = SHOTS[name];
    const steps = ['TNT.game.pause()']
        .concat(shot.eval.map(s => (s === 'bare' ? 'TNT.game.bare()' : s)));

    const args = [
        TOOL, './index.html',
        '--viewport', '1280x760',
        '--wait', String(shot.wait),
        '--out', path.join('shots', name + '.png')
    ];
    for (const step of steps) args.push('--eval', step);

    const res = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });
    const out = (res.stdout || '') + (res.stderr || '');
    const ok = /^ok ->/m.test(out);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(11)} ${shot.desc}`);
    if (!ok) console.log(out.trim().split('\n').slice(0, 6).map(l => '       ' + l).join('\n'));
}
