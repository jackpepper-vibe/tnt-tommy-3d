# TNT Tommy — Project Notes

Inherits the global guidelines in `../CLAUDE.md` (commercial-grade code, always
commit and push after changes, bypass-permissions bash).

Replaces two earlier games that were the same idea twice: Dynamite Dan
(TypeScript, PixiJS) and the Godot build (both still on GitHub; the local
folders were deleted on 23 Sep 2026). It keeps the Godot version's chiptune
tracks and Dynamite Dan's mechanical depth — the fuse, conveyors, crushers,
droppers, crumbling floors, lava, the flooded sump, the oxygen tank, blastable
rock, a three-mine campaign — and has since been rebuilt top to bottom.

## The look: an underground works

Not a cave. The brief after the first playable build was that the green moss
and the daylit backdrop made it read as outdoors, and that it lacked depth, so
every room is now a built interior sunk in rock: a masonry wall with
iron-framed windows onto a machine hall (`src/r3d/Works.js`), girder columns,
pipework, gauges, bulkhead and pendant lamps. Decks are riveted steel catwalks
hung from the structure above; ladders are steel, hanging ropes are chain,
lines are cable. **There is no green anywhere, deliberately.** Each mine has
its own palette in `R3D.PALETTES` (brass and oxide, a teal gasworks, a
foundry), and each room names a background set piece in its definition
(`works: 'flywheel' | 'fans' | 'furnace' | 'tanks' | 'winding' | 'stores'`) so
rooms are told apart by their landmark.

Tommy is the boy from the title-card portrait (red hair, puffer jacket banded
yellow/grey/charcoal, jeans, blue trainers) in a miner's helmet, drawn larger
than his collision box so he reads at room scale. His Shih Tzu follows him on
his own trail (`src/entities/Companion.js`) and points at hidden cogs.

## Goals

A mine asks three things: find the twelve sticks, break the **Governor** that
guards the plunger (a boiler-engine in the vault roof; stomp its three valves
while they vent, or blast them — `src/entities/Machines.js`), and get back to
the plunger once the last stick starts the seam coming down. Alongside: three
**brass cogs** per mine, hidden until the dog smells them, spent at the
**workshop** between mines on kit (`src/systems/Upgrades.js`). **No upgrade may
touch the jump** — they change how forgiving a mine is, never its reach.

## The one rule everything else follows

**A jump clears three rows. Four needs a ladder.**

Every one of the twenty-seven rooms is authored on a three-row deck grid, which
is exactly `C.JUMP_APEX`: fifty-six pixels, clearing a three-row gap with eight
to spare and missing a four-row one by twenty-four. Six decks fit in a room and
each is a hop from the one below. Ladders, hanging ropes, lifts and trampolines
are for everything taller than that, which is what keeps them load-bearing
rather than decorative.

Change `JUMP_V` or `GRAVITY` and the traversal of the whole game moves at once,
silently — rooms stay perfectly plausible in a screenshot while becoming trivial
or impossible. `scripts/smoke.mjs` asserts the apex for that reason, and
`scripts/validate-world.mjs` re-walks all 27 rooms under it.

Supporting rules:

- **Falling is cheap and never fatal.** Six rows is free; past that a landing
  costs `C.FALL_DMG` of fuse (it was documented from the start and never
  applied until the rebuild), and it floors at one point — nothing kills.
- **A wall-jump must alternate walls.** Off one wall and then the other climbs
  a chimney; off the same wall twice would climb any wall and make every
  four-row ladder optional. The side last kicked off is locked until Tommy
  lands, climbs or ropes. `smoke.mjs` checks it.
- **Nothing an enemy does may break the rule either.** A held jump through a
  stomp bounces to `C.STOMP_BOUNCE_HELD`, deliberately short of a full jump:
  from an enemy's head a full jump would clear four rows.
- **The forgiveness mechanics are not polish.** Coyote time, jump buffering and
  variable height are all present, and a three-row grid over spike beds is
  miserable without them.
- **Ladder columns are slides, not holes.** A ladder punches through the deck it
  serves to stay climbable, so every ladder is also a gap — and a shaft link is a
  gap in the *floor*. `C.SLIDE_V` caps your speed inside one.

### What this replaced, and why it is written down

The first build of this game had **no jump at all**, at the brief's request, and
it failed for a reason worth keeping on the record because it is not obvious
from playing it — it is only obvious from measuring it:

| | no-jump build | dynamite-dan | now |
|---|---|---|---|
| platform rows per room | 3.0 | 5.7 | 5.9 |
| gap between them | 5 rows | 3 rows | 3 rows |
| ladder tiles per room | 65.4 | 13.6 | 21.3 |
| hand-authored rooms | 9 of 27 | 27 of 27 | 27 of 27 |

Without a jump every change of level has to be a ladder, and forgiving fall
damage has to be tight so the player is never in doubt about a drop — which
forces a five-row grid, which halves the levels a room can hold. The result was
five times the ladder and half the structure: a ladder farm, not a mine. Run
`node scripts/room-stats.mjs` before and after any change to the level grid; it
prints these numbers against `../dynamite-dan` on demand.

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

All twenty-seven rooms are authored by hand, nine to a file in
`src/world/Mine1.js`, `Mine2.js` and `Mine3.js`. Each mine has its own room
names, its own link graph and its own character: Copperlode teaches, Blackdamp
adds warp pads and a flooding seam, Cinderdeep replaces spikes with lava and
runs the tightest fuse.

Rooms are **feature calls** rather than character grids — `g.deck(20, [2, 8],
[13, 7], [25, 6])`, not forty-two characters you have to count. Both were tried;
strings let you see the room but every edit is a counting exercise and one
dropped dot shifts half a level sideways. `node scripts/dump-rooms.mjs 1
cageShaft` prints any room back as ASCII when you do want to look at it.

An earlier build derived eighteen of the rooms by mirroring the other nine. It
was rejected on sight, correctly: it is the opposite of the detail this game is
supposed to have, and the back two thirds felt like the first third reflected.
Do not reintroduce it.

`Paint` refuses to bury an actor under terrain — a `put` onto anything but open
air or water throws, and so does a `shaft()` that would cover one. Both fired
repeatedly during authoring, and every one was a nugget or a stick that would
have silently vanished from the game.

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

**Lighting is per-pixel Phong, not Lambert.** Lambert in r128 lights per
*vertex*, and a merged wall run is one quad forty tiles wide — lamps could only
brighten its corners and never made a pool, and the helmet spot showed nothing.
Every light also carries its own `z`: a lamp bolted to the wall has to be at
the wall to pool on it.

**Materials are cached for the life of the page** (`R3D.cached`). Disposing
the last user of a shader program deletes the program, so a room rebuilt with
fresh materials recompiled four programs on every flip and respawn — a 25 to
160 ms stall exactly when the player is watching. Never `new` a material per
room; get it from `R3D`. `node scripts/perf.mjs` catches a regression.

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
node scripts/smoke.mjs           39 checks on the rules, headless, no browser
node scripts/validate-world.mjs  reachability: sticks, valves, cogs, gates
node scripts/check-rooms.mjs     build every room, report all faults at once
node scripts/look.mjs [pose…]    captures on the REAL GPU — judge art from these
node scripts/perf.mjs            frame rate and worst frame, real GPU
node scripts/room-stats.mjs      density (needs ../dynamite-dan cloned alongside)
node scripts/shot.mjs            software-GL captures, for "does it draw at all"
node scripts/dump-rooms.mjs 2    print a mine as ASCII
```

`validate-world.mjs` is the one that earns its keep. It walks every mine the way
the player has to, under the real constants, and proves every stick, tank and
plunger reachable. It is deliberately **conservative** — the jump is credited
with only two columns of sideways reach where the real arc carries over five —
so "reachable" is a guarantee and "unreachable" is a prompt to go and look.
Modelling the arc generously makes the pass silently useless, because it clears
rooms that are genuinely broken.

It has already caught: a whole mine being unplayable, every shaft mouth in the
game being a lethal trap, and — after the jump went back in — every room beyond
the first band looking unreachable because the search could not mount a shaft
stub from the deck below it.

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
