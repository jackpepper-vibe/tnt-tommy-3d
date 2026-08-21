# TNT Tommy

A mine platformer with no jump button.

Twelve sticks of dynamite are scattered through nine rooms of a working mine.
Collect the lot, get to the vault, and drop the plunger before your fuse burns
out. Then do it twice more, deeper down, with less time.

Built in vanilla JavaScript and three.js. No build step, no dependencies at
runtime, no network — open `index.html` and it runs.

## The idea

Tommy cannot jump. Every metre of height is a ladder, a hanging rope or the
winding cage, which changes what a platformer *is*:

- **A ledge with nothing leading to it is scenery**, not a challenge. Routes are
  found rather than executed.
- **Falling is how you travel downward**, so it is a deliberate move — you can
  steer a drop most of the way across a room. One storey is always free. A shaft
  is not, though a ladder in it will slow you all the way down.
- **Dynamite is the only thing that changes a room.** Fissured rock opens to a
  blast, and the stick comes out of the twelve you are collecting and goes back
  where you found it once it has gone off. Spending one costs you the walk, not
  the run.

The fuse is the energy bar and the clock at once. It drains on its own, damage
takes a bite out of it, and food is the only way to put any back — so taking a
hit and taking too long are the same mistake, and there is no safe way to stall.

## Playing

| | |
|---|---|
| Walk | <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> |
| Ladders and ropes | <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> |
| Drop through boards | <kbd>↓</kbd> |
| Plant a stick | <kbd>Space</kbd>, <kbd>Z</kbd> or <kbd>J</kbd> |
| Scanlines | <kbd>K</kbd> |
| Sound | <kbd>M</kbd> |

On a phone the on-screen pad appears automatically.

## The three mines

**Copperlode** teaches the vocabulary. **Blackdamp** mirrors the whole layout,
rots the boards and swaps ladders for slower hanging ropes. **Cinderdeep** turns
the map upside down — you start at the top and the plunger is at the bottom, so
you descend against the fuse instead of climbing with it — and every spike bed
is lava.

Nine rooms are authored by hand; the other eighteen are derived from them, and
all twenty-seven are checked for reachability under the no-jump rules before the
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
