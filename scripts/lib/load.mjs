/**
 * Load the game's simulation modules into Node.
 *
 * The game ships as classic scripts that attach to `window.TNT` — that is what
 * lets it run from `file://` with no build step, and it is not going to change
 * for the sake of tooling. So the tooling adapts: this evaluates the same files
 * against a `window` shim and hands back the namespace.
 *
 * Only the simulation half is loadable this way. Anything under `src/r3d/`
 * expects a real `THREE` and a canvas, and is verified by screenshot instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

/** Simulation modules, in dependency order — the same order `index.html` uses. */
export const SIM_FILES = [
    'src/core/Constants.js',
    'src/core/Util.js',
    'src/core/EventBus.js',
    'src/core/Input.js',
    'src/core/Loop.js',
    'src/world/Tiles.js',
    'src/world/Paint.js',
    'src/world/Rooms.js',
    'src/world/Remix.js',
    'src/world/World.js',
    'src/entities/Entities.js',
    'src/entities/Player.js',
    'src/systems/Run.js'
];

/**
 * @param {string[]} [files]  defaults to every simulation module
 * @returns {object} the populated `TNT` namespace
 */
export function loadSim(files = SIM_FILES) {
    const sandbox = {
        console,
        performance: { now: () => Date.now() },
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
        Math,
        Date,
        Map,
        Set,
        Object,
        Array,
        Uint8Array,
        Float32Array,
        JSON
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);

    for (const rel of files) {
        const full = path.join(ROOT, rel);
        if (!fs.existsSync(full)) continue;
        const code = fs.readFileSync(full, 'utf8');
        try {
            vm.runInContext(code, sandbox, { filename: rel });
        } catch (err) {
            throw new Error(`${rel}: ${err.message}`);
        }
    }

    if (!sandbox.TNT) throw new Error('no TNT namespace was produced');
    return sandbox.TNT;
}

/** Syntax-check a file without running it. */
export function syntaxCheck(rel) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    new vm.Script(code, { filename: rel });
}
