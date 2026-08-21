# TNT Tommy

A flick-screen mine platformer. Twelve sticks of dynamite are scattered through
nine rooms of a working seam. Collect the lot, get to the vault, and drop the
plunger before the fuse burns out — then do it twice more, deeper down, with
less time. Twenty-seven hand-built rooms across three mines.

Built in vanilla JavaScript and three.js. No build step, no runtime
dependencies, no network — open `index.html` and it runs.

## The idea

**A jump clears three rows. Four needs a ladder.** Every room is a climbing
frame built on that number: six decks three rows apart, so the level above is
always a hop, and anything taller is a ladder, a hanging rope, the winding cage
or a trampoline.

- **Falling is cheap.** Eight rows costs nothing and no drop is fatal, so
  coming down is fast and climbing is the part you plan.
- **Dynamite is the only thing that changes a room.** Fissured rock opens to a
  blast, and the stick comes out of the twelve you are collecting and goes back
  where you found it once it has gone off. Spending one costs you the walk, not
  the run.
- **The last stick starts the clock.** Lift it and the seam begins coming down:
  a hard countdown to reach the plunger. So the whole mine is spent deciding
  *where to leave the twelfth stick*.

The fuse is the energy bar and the clock at once. It drains on its own, damage
takes a bite out of it, and food is the only way to put any back — so taking a
hit and taking too long are the same mistake, and there is no safe way to stall.

Strip every nugget from a room and it earns a medal; the minimap tracks which
rooms still owe you one.

## Playing

| | |
|---|---|
| Walk | <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> |
| Jump | <kbd>Space</kbd>, <kbd>Z</kbd> — or <kbd>↑</kbd> when there is no ladder |
| Ladders, ropes and warp pads | <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> |
| Drop through boards | <kbd>↓</kbd> |
| Plant a stick | <kbd>X</kbd> or <kbd>Shift</kbd> |
| Scanlines | <kbd>K</kbd> |
| Sound | <kbd>M</kbd> |

Hold jump for the full three rows, tap it for a short hop. On a phone the
on-screen pad appears automatically.

## The three mines

**Copperlode** teaches the vocabulary — the deck grid, the drop-through, the
rope and the trampoline — and nothing in it is lethal on contact except one
fenced lava channel.

**Blackdamp** is a different mine, not the first one mirrored: its own rooms,
its own link graph, and two new things. Warp pads cut across the map in a way
ladders cannot, and Fire Damp's lava *rises while you stand in it* and drains
when you leave, so the room is on a clock the fuse knows nothing about.

**Cinderdeep** replaces the spike beds with lava, floods two seams instead of
one, puts guardians that walk through rock in most rooms, and runs the tightest
fuse of the three. The Furnace is the hardest room in the game.

All twenty-seven rooms are individually designed, and every one is machine-checked
for reachability — every stick, tank and plunger provably gettable — before the
game will build.

## Running it

```
git clone https://github.com/jackpepper-vibe/tnt-tommy
cd tnt-tommy
```

Open `index.html`. That is the whole setup — it works from the filesystem.

To use the tooling:

```
npm install                      # playwright, for screenshots only
npm test                         # rules + reachability
node scripts/shot.mjs            # screenshots
node scripts/dump-rooms.mjs 1    # print a mine as ASCII
```

## How it is put together

```
src/core/      constants, event bus, input, the fixed-timestep loop
src/world/     tile vocabulary, the room-authoring kit, the nine rooms,
               the remixer that derives the other two mines, world assembly
src/entities/  pickups, patrols, machinery, lifts, and the player
src/systems/   the run — rules, scoring, state — plus audio, HUD and screens
src/r3d/       everything that draws. Reads the simulation, never writes to it
```

Physics runs at a fixed 120 Hz and drawing happens once per frame, so a 144 Hz
monitor and a 60 Hz one agree about whether a drop clears a spike bed. A room is
two draw calls: solid rock is merged into runs with interior faces dropped, and
everything that glows shares one additive buffer.

The sound is carried over unchanged from an earlier Godot version of this game —
both chiptune tracks and every effect. Everything else is geometry built in
code. There are no image files in the project; the one texture is a radial
gradient drawn onto a canvas at load.

## Credits

A rebuild of two earlier versions of the same idea, keeping the presentation of
one and the mechanical depth of the other, and throwing away the jump button
that both of them had.
