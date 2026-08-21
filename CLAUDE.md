# TNT Tommy — Project Notes

Inherits the global guidelines in `../CLAUDE.md` (commercial-grade code, always
commit and push after changes, bypass-permissions bash).

Replaces two earlier games that were the same idea twice: `../dynamite-dan`
(TypeScript, PixiJS, Rapier2D, Vite) and `../tnt-tommy-godot` (GDScript). This
build takes the Godot version's presentation — dark worked-out mine, lamp-lit,
crystals, both chiptune tracks — and Dynamite Dan's mechanical depth: the fuse,
conveyors, crushers, droppers, crumbling planks, lava, the flooded sump, the
oxygen tank, blastable rock, and a three-mine campaign.

Neither original is a reference for *movement*, because this one has no jump.

## The one rule everything else follows

**Tommy cannot jump.** Height is only ever gained by a ladder, a hanging rope,
or a lift. Nothing gives him upward velocity he did not climb for — not a
trampoline, not a steam vent, not a conveyor, not knockback. Every one of the
twenty-seven rooms is authored on that assumption, so a change that quietly
reintroduces a hop does not make the game easier, it invalidates the level
design of the entire project at once.

Three things carry the weight the jump used to:

- **Falling is a move.** Walking off a ledge is how you get down, so a drop has
  to be aimable — air control is nearly as strong as ground control.
- **The level grid is load-bearing.** Standing surfaces sit five rows apart, and
  `C.FALL_SAFE` is derived from exactly that height. Author a ledge off the grid
  and you have made a drop the player must judge by eye.
- **Ladder columns are slides, not holes.** A ladder must punch through the deck
  it serves to stay continuous, so every ladder is also a gap — and the shaft
  linking two rooms is a gap in the *floor*. `C.SLIDE_V` caps your speed inside
  one, which is what stops all of them being lethal traps.

## Shape of the code

Classic scripts under one `TNT` namespace, loaded in dependency order by
`index.html`. No build tooling, and it runs from `file://`. Three.js is
**vendored** at `vendor/three.min.js` (r128) rather than pulled from a CDN: the
screenshot harness loads the page over `file://` with no network at all.

The load order in `index.html` is in two halves, and the line between them
matters:

- **Above `<!-- ===== 3D PRESENTATION LAYER ===== -->`** is the simulation:
  constants, the tile world, entities, the player, the run. It has no idea a
  renderer exists.
- **Below it** is everything that draws. It only ever *reads* simulation state,
  and hears about events through the bus. If you find yourself wanting to write
  to `run` from `src/r3d/`, the design has gone wrong.

`scripts/lib/load.mjs` evaluates the simulation half against a `window` shim, so
the whole game is testable in Node with no browser. Anything under `src/r3d/` is
verified by screenshot instead.

## Rooms

Nine rooms are authored by hand in `src/world/Rooms.js`, as **feature calls**
rather than character grids — `g.shelf(3, 10, 18, 23, 4)`, not forty-two
characters you have to count. Both were tried; strings let you see the room but
every edit is a counting exercise and one dropped dot shifts half a level
sideways. `node scripts/dump-rooms.mjs 1 cageShaft` prints any room back as
ASCII when you do want to look at it.

The other eighteen are derived by `src/world/Remix.js`: Blackdamp mirrors the
mine's layout, Cinderdeep flips it vertically, and both escalate hazards. Only
hazards that **cannot disconnect a room** are applied — rotten boards, slower
climbs, more patrols, less fuse. Scattered terrain hazards are banned outright,
and that is not squeamishness: a lone spike in a corridor cannot be stepped over
when there is no jump, and Cinderdeep converts spikes to lava, so a dozen of
them sealed all nine rooms of a mine that still looked perfectly normal.

## Things that will bite you

**Coordinates flip.** The simulation is screen space, where y grows *down*.
World Y grows up. Always go through `R3D.wx`/`R3D.wy`; doing the arithmetic
inline does not produce an obviously upside-down game, it produces one where
Tommy is right and every hazard is mirrored about the room's middle.

**Colour space.** The renderer writes sRGB, so Three treats material and vertex
colours as already linear. Every hex here is picked by eye as sRGB and **must**
go through `R3D.col()`. Skipping it lifts the whole palette to pale putty, which
this art direction cannot survive. Light colours are the exception — they are
multipliers, and are set raw.

**Point-light decay is 1, not 2.** A world unit is a tile, so a room is
forty-two units across, and inverse-square falloff leaves a lamp at a twentieth
of its strength four tiles out. Every room came out black with a halo round
Tommy's boots.

**The light count is fixed forever.** Changing the *number* of lights makes
Three recompile every material in the scene. `MAX_LIGHTS` slots exist for the
life of the page and the nearest sources are assigned into them each frame;
unused slots are dimmed to zero, never removed.

**There is no scene fog, deliberately.** At a fixed camera distance the whole
playfield is one depth, so fog is a flat tint the palette already applies — and
turning it on adds a shader variant that fails under software GL, where Three
then crashes reading the null info log of the program that failed.

**`preserveDrawingBuffer` is load-bearing.** Without it the drawing buffer is
discarded once composited and every headless capture is black. This cost an
afternoon: draw calls were being issued, geometry was exactly where it should
be, and the renderer was innocent throughout.

**A harness must freeze, not stop.** `TNT.game.pause()` freezes the *simulation*
and leaves the frame loop drawing. Stopping the loop gives a deterministic state
and a black screenshot, because with no animation frame pending the browser
composites the canvas from whatever it likes.

**Actors are pooled and share geometry.** `R3D.dispose` skips anything flagged
`geometry.userData.shared` or `material.userData.shared`. A room is rebuilt on
every flip — twenty-seven times a mine — so leaking one geometry per room
exhausts the GPU within a couple of playthroughs, and the symptom is a tab that
gets slower and then dies, a long way from the cause.

## Verification

Three passes, and none of them is optional before pushing.

```
node scripts/smoke.mjs           16 checks on the rules, headless, no browser
node scripts/validate-world.mjs  reachability across all 27 rooms
node scripts/shot.mjs            11 screenshots
node scripts/dump-rooms.mjs 2    print a mine as ASCII
```

`validate-world.mjs` is the one that earns its keep. It walks every mine the way
the player has to, under the real constants, and proves every stick, tank and
plunger reachable. It is deliberately **conservative** — every move it allows is
one the physics definitely permits, and it leaves out several the physics does
allow, notably steering a fall sideways. So "reachable" is a guarantee and
"unreachable" is a prompt to go and look. Modelling air steering generously
makes the pass silently useless, because it clears rooms that are genuinely
broken. It has already caught Cinderdeep being entirely unplayable and every
shaft mouth in the game being a lethal trap.

`window.TNT.game` is the test hook — `pause()`, `resume()`, `step(n)`,
`begin(mine)`, `room(id)`, `put(tx, ty)`, `hold([...])`, `bare()`, `crt(on)`.
Drive arbitrary states with the shared shot tool:

```
node C:/Claude/Tools/shot/shot.mjs ./index.html --viewport 1280x760 --wait 2600 \
  --eval "TNT.game.pause()" --eval "TNT.game.bare()" \
  --eval "TNT.game.room('cageShaft'); TNT.game.step(200)" \
  --out shots/cage.png
```

`?nopost` renders the scene straight to the canvas. Worth knowing about: the
composite pass is the one part of the pipeline that fails invisibly, and a
broken shader there looks exactly like a broken camera, a broken palette or an
empty scene.

## Assets

`assets/audio/` is the Godot build's `assets/sfx/` unchanged — both chiptune
tracks and every effect. They were the best thing about that version and there
was no reason to regenerate them. Everything else is geometry built in code;
there are no image files, and the one texture in the game is a radial gradient
drawn onto a canvas at runtime so the page works offline.

`node_modules/`, `shots/` and `package-lock.json` are gitignored. `vendor/` is
not: the vendored Three.js is part of the app.
