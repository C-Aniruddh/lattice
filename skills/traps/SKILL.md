---
name: traps
description: The failures in a Lattice game that produce no error and a plausible-looking wrong result — a black screen, a tap that opens the wrong thing, art that floats above its own hill, a frame counter that lies, a game that gets slower at dusk, a save that silently stops being written. Use when something builds and runs but looks or behaves wrong, when a symptom points nowhere near its cause, or before believing that a passing check means anything.
---

# Traps

Every entry here was found as **working-looking code**. None of them throws. Most of them point
somewhere other than their cause, which is why they are worth carrying: an agent can read a
`.d.ts` and cannot read any of this.

Use it two ways. **Symptom first** if something is already wrong; **the list** if you are about to
write one of these.

---

## Symptom → cause

| what you see | look at |
|---|---|
| a black or one-color screen | camera never framed · `sort()` never called · darkness at 1 with no lights · light field not on the pen · a canvas with no size · a fractional grid index |
| the tap opens the thing *behind* the one under the finger | something reordered after `sort()`, or two collections and an offset |
| taps miss on hills, and by more the higher the hill | `ActionEvent.gx/gy` — the flat-ground answer |
| taps miss on tall things specifically | `spriteVolume` called without the ground |
| art floats above or sinks below its hill | `drawSprite`'s ground argument omitted |
| the game gets slower at dusk and stays slow | palette stop sets rebuilt inside the render callback |
| the game gets slower over minutes, with no event | an animated color feeding the ramp cache |
| a frame counter reads `0.0 ms` | the tab is hidden |
| a frame counter reads healthy while the game visibly hitches | `worstFrameMs` cannot see between pumps |
| the game keeps drawing but nothing responds | a hot reload left a zombie instance bound to the canvas |
| a tap on the world does nothing at all | the HUD is covering it — run `auditOverlay` |
| the HUD is frozen at old numbers after switching tabs | state is being updated in `render` |
| a wall, fence or run of flags draws nothing | it is edge-on: equal `gx` and `gy` deltas |
| terrain renders perfectly flat | the relief axis, or its sign |
| income is wrong after coming back to the tab | derived from `dt`, or the offline warp was restarted |
| a modal reopens after the player confirmed | a poll of derived state with no latch |
| the save quietly stops being written | a save from the future made the store read-only |
| progress vanished on reload | `localStorage.clear()` raced the autosave's flush |
| a currency comes back as `NaN` | `Infinity` went through JSON and returned as `null` |
| a world regenerates differently after panning away and back | a sequential `Rng` where a hash belonged |

---

## The list

### `Readonly<Vec2>` is not a barrier, and a callee will write to your frozen constant

TypeScript **ignores property `readonly` modifiers when checking assignability**, so two
interfaces differing only in `readonly` are mutually assignable — and a `Readonly<Vec2>` flows
happily into a parameter typed `Vec2`, where the callee writes to it.

```ts wrong
import { v2, v2Add } from '@lattice/core';

const ORIGIN: Readonly<{ x: number; y: number }> = Object.freeze(v2(0, 0));
// Compiles. Throws a TypeError on the one frame this path executes.
v2Add(ORIGIN as { x: number; y: number }, ORIGIN as { x: number; y: number }, v2(1, 1));
```

```ts
import { v2, v2Len } from '@lattice/core';
import type { ReadonlyVec2 } from '@lattice/core';

// `ReadonlyVec2` builds a real barrier — a phantom property whose types conflict in exactly one
// direction. It erases at runtime and costs nothing.
export function lengthOf(a: ReadonlyVec2): number {
  return v2Len(a);
}
export const p = lengthOf(v2(3, 4));
```

**Import `ReadonlyVec2` for read parameters. Never hand-write `Readonly<Vec2>`** and assume it is
the same thing. Note also that `Object.freeze(v2(0, 0))` *infers* `Readonly<Vec2>` — the explicit
annotation is the entire protection. This claim survived ten design documents, a compile of the
whole surface, and a review; it was falsified only when somebody tried to make the compiler
enforce it.

### A moving color is a cache key

`softEllipse` — under `glowDot`, contact shadows and every light pool — renders one ramp per
`(inner, outer)` color pair and reuses it. The pair is a **cache key**, which no signature says.

That cache shipped once keyed on the exact 8-bit pair and evicting **wholesale**, so one animated
color deleted every *other* call site's ramp as well: **3.74 misses a frame, a full cache drop
every 26 frames, about 3.7 MB/s of garbage** — with the miss table naming contact shadows, light
pools, sky and walkers, all constant-color sites that should have been permanent hits. In a
heavier scene it was 15.9 a frame.

The key is snapped to 32 levels per channel now and eviction takes one entry, so **you do not
have to quantize colors in your own art code.** What remains: animating *both* endpoints
independently multiplies pairs (32 → 32²), and **your palette counts as an animated color** — a
`Palette.lerp` on a continuous `t` every frame moves every slot in the scene at once, which one
exhibit found as 27% of its soft ellipses missing with no flickering light anywhere in it.

The tell was never a flicker. It was a game that got slower and stayed slower.

### `ActionEvent.gx/gy` is a flat-ground answer

There is no seam anywhere in the input options for a heightfield, so on sloped ground those
coordinates are wrong — silently, and by more the taller the terrain. **Measured at 281 px and
14 tiles** on one hillside; 212–237 px on another; over 1,400 px at one ridge. The error always
points up the slope. Re-pick from `sx`/`sy` with `screenToTileOnHeights`. Full treatment in the
`input` and `world` skills.

### `loop.stats.worstFrameMs` cannot see a pause between pumps

It measures the pump's own wall time, so a garbage collection or a style recalculation landing
between two pumps is in neither reading. One game measured **23.1 ms on one machine and 13.1 ms
on another for the same build**; another shipped a HUD reading `0.0 ms` against a real worst gap
of 9.2 ms. **Use `worstGapMs`**, and read it next to `cadenceMs` rather than next to a budget.

### A frame readout of `0.0 ms` means the tab is hidden

Not that the game is fast. `requestAnimationFrame` is 0 Hz in a backgrounded tab — measured
suspending for **6,108 ms** in one case — and the loop reports a confident zero. Every number
beside it is also wrong.

### Two clocks in one game

A modal polled "should this be open?" every 900 ms while quests settled every 1,000 ms. Between a
settle and the next one the derived condition was briefly true again, so the modal **reopened
after the player had confirmed** — and the obvious recovery, pressing confirm again, overwrote the
company name they had just typed. **One-shot UI is driven off a latch or an event, never off a
poll of derived state.** And one `createLoop` per game: `@lattice/ui` starts no timer of its own
precisely so a second one cannot exist.

### A light field that was never attached to the pen

Leave `light` out of the `beginFrame` literal and there is no night at all: the composite is a
no-op, every sprite's `emit` hook is skipped, and every `add()` accumulates into a buffer nobody
reads — **while the field reports `active: true` with a live count.** The natural diagnosis is
"the night is broken" and the natural place to look is the light field, where nothing is wrong.

### A `stepMs` typed by hand

`16` against a loop running at 16.667 is a long press that fires at **432 ms**, a fling **4% low**,
and a recorded log a replay refuses months later with a message nobody can trace back to the
literal. It no longer compiles — pass the loop — but the shape of the failure is worth knowing,
because every duration in this kit is a plain `number` whose name ends in its unit and **the name
is the entire defense.** `after(3000, …)` on a timeline measured in seconds is fifty minutes.

### Reordering after `sort()`

Paint order and pick order are the same permutation or the game is lying about what the player
tapped. The one that will actually happen is **partitioning**: drawing every contact shadow first
and every body second looks better, is a *stable* partition of the sorted order, and is a reorder.
Walk `indexAt` forward twice instead. Both packages stay green while a player taps a lamp and
opens the building behind it.

The related version is two collections and an offset — `index - things.length` — which is
arithmetic that is correct only while three unchecked facts hold at once. Keep **one array in the
sorter's own index space**.

### `spriteVolume` and `drawSprite` without the ground

Omit the ground and the silhouette is computed at sea level while the art is painted up the hill.
Measured across three seeds of one game: tap targets **212 to 237 CSS pixels below the art**, and
nothing looked broken because a hand-written bubble fallback that *did* know the elevation caught
most of the taps the silhouette missed. The marker still lit — through a test that had nothing to
do with what was on screen.

### `Infinity` through JSON

`Infinity` is a perfectly exact arithmetic result and is precisely the value that does not survive
being written down: it serializes to **`null`, under a valid checksum**, and comes back as `NaN` on
the next tick. Nothing downstream can detect it. `expectSerializable` and a `Number.isFinite`
check inside the head recognizer are what stop it.

### `hashString` walks UTF-16 code units

macOS hands you NFD; Windows and most browsers hand you NFC. The same visible name typed on two
machines produces two different save keys and two different worlds — and the bug reproduces on
nobody's machine. `.normalize('NFC')` **text a human typed**; never normalize **bytes you are
checksumming**, because a save truncated mid-combining-sequence must fail.

### An untagged edge is silently never gated

One game passed gate ratios to `buildFlow` where the edge carried no `gate`, so the dark paid
nothing — while the HUD said `+1.7×` and a toast promised offerings were worth more after dark.
Three surfaces agreeing on a lie, fixed by one word.

### Restarting the offline warp

The obvious way to re-enter after a mid-absence event is a fresh span measured from where you left
off. It is also the exploit: the warp is strictly concave, so restarting pays for *K* absences
instead of one and each restart is cheaper than the last. `8 × offlineCredit(t/8)` is 72,000 s
where `offlineCredit(t)` is 35,348 — the softcap has simply gone. Hand `Crossing.atSeconds` back
as the next call's `fromSeconds`.

### A capped gap with an uncapped anchor

`offlineCredit` clamps its input, so a device clock a year fast credits about eleven hours. But
`advance` still **stamps the ledger at the bogus instant**, and when the clock is corrected every
read sees time running backwards and credits zero — the economy freezes for a year, with no error
and a save that looks fine. `reanchor` is two lines and nobody writes it.

### A save from the future

Degrading to fresh is correct *in memory* and catastrophic *on disk*: the old build would autosave
four seconds later over a good save. So `future` is the one failure reason that also sets the
store read-only, every write skips, and storage comes out byte-identical. If you are wondering why
saving has silently stopped, this is why — and the player needs to be told, in a modal, because
everything they do from now on is unrecorded.

### `localStorage.clear()` does not reset a game

The live autosave flushes on `pagehide` and writes the state back over the clear. The order that
works is: close the store to writes, stop every autosave handle, *then* remove the key.
`store.reset()` does exactly that.

### `scheduleFrom(loop.real)`, never `loop.real.after`

The loop schedules in seconds; `persist` schedules in milliseconds. Passing the method directly
does not compile — and cast through, it asks for a write every 4,000 **seconds**, so the game
autosaves once every 67 minutes while the status reports `ok` the whole time.

### A wall along the near-far diagonal has zero screen width

World x is `(gx − gy) · HALF_W`, so a segment whose `gx` and `gy` change by the same amount
projects to a vertical line. Every number is finite, the projection is doing exactly what it
promises, and the art is simply not there. A run of prayer flags cost one game a full iteration
with nothing anywhere saying why. `isoWall` now throws and names both tiles; `isEdgeOn` is the
predicate. **An animated endpoint must not be able to sweep through the diagonal** — the frame it
crosses is the frame that throws, and "safe by accident" is not safe.

### Terrain that renders flat

`isoTerrain` measures relief **east-to-west**, because those are the two corners a 2:1 projection
puts on the same screen row. Two failures follow. **Invert the sign** and terrain still looks like
terrain — lit from the right, under buildings lit from the left, reading as flat for a reason no
screenshot names. And **a landform whose gradient runs along the other diagonal has a relief term
of exactly zero**: a six-thousand-foot cliff shading like a texture. Supply the `north − south`
term through `tint`; it is one subtraction.

### A continuous height field renders as triangles

Whatever the model does. The fix is a **render-side vertex snap** — snap each drawn vertex about
86% of the way onto its band, leaving a seventh of the real relief so every frame still differs
from the last — and it happens in the render and **never in the model**, or every checkpoint,
gradient and fingerprint moves with it. Snap **up**: snapping down crosses the band boundary by
construction and stripes each bench with the color of the one below it.

### `tileSourceOf` answers `has()` true everywhere

Correct for an unbounded world, and `screenToTileOnHeights` uses `has()` as its **only** off-map
test — so the naive composition of the two never misses. One game reported sculpting grid
`(-4000, 900)` from a tap on the sky. Two correct decisions composing into a wrong answer, which
is a class this kit keeps producing.

### A camera you gave no bounds is not unbounded

The default is about **±10,000 world pixels — roughly ±312 tiles** — and its own comment calls
that "effectively unbounded". A game that pans forever crosses it in **fourteen screens of
travel**. And `tileBounds`' height argument extends `minY` *upward*, which is right for framing
and wrong for a fence: pass your tallest building to frame the shot, and something much smaller as
the clamp, or the player parks the viewport in the sky above the far corner and still satisfies
`keepVisible`.

### `PathFinder`'s heuristic ignores weights

Any `TileCost` above 1 makes the estimate inadmissible-by-underestimate and slides A\* toward
Dijkstra — **about 17×**: 0.13 ms mean unweighted against 2.18 ms weighted with an 8.9 ms worst,
on identical geometry. Weights are the package's own documented way to say "shorter but harder",
so the feature and the performance of the feature disagree. Bake the cost grid.

### `massing` and `animate` get different `Rng` streams

A sprite whose massing chose a height and a lean cannot recover either by drawing in the same
order in `animate`. So a moving crown sits beside the static one it is supposed to *be*, and the
tree renders with its head beside its neck. Worst on the tallest, leaniest instances, which is why
it survives a review at a glance. Address by index: `toUnit(hashStep(v.seed, i))`.

### `noise2` returns exactly zero more often than you would guess

397k of 14M samples — but **only when both inputs are lattice points**. Any code whose correctness
depends on "noise is never exactly zero" is a live bug on integer coordinates.

### There is no sprite bitmap cache, and there is no hover gesture

Both are deliberate absences, not gaps you are failing to find. The cache was written, measured
and deleted — 400 buildings of 42 draw calls each is 2.14 ms, and a perfect cache buys back at
most 2.1 ms of an 8 ms budget in exchange for four new ways to render something stale. "Cache it"
is not a move available to you. And `GestureMap` has six members, none of which is a pointer
position with no button down — a tile highlight that follows the cursor needs a raw `pointermove`
listener of your own.

### Rebuilding the audio engine to change a setting

`dispose()` closes the `AudioContext` and a document gets about **six of them, ever**. A
voice-ceiling slider that rebuilt the engine on every drag would permanently silence the page in
about a second. `setMaxVoices` and `setMaxPan` are live setters for exactly this reason.

### A chord spelled as one sound

`minGapMs` is keyed on the sound **id**, so six strings sharing an id are six plays of the same
sound in the same instant and five are thrown away. Right for a "collect all" button, wrong for a
chord. And in a tab that has never had a real gesture, `available` reports `true` while the audio
clock stays at 0 — so the second play of any id is refused for ever, and the symptom is "the first
sound works and nothing after it does".

### A HUD updated in `render`

It freezes in a background tab while the canvas keeps showing its last painted frame, so the game
*looks* alive with prices, timers and affordability marks that stopped twenty minutes ago. State
goes on `update`. And the fix is not a `setInterval` of your own — `update` already is the
interval; a second clock is the two-clocks bug above.

### A hot reload leaves a zombie

Vite re-evaluates the module, `createInput` correctly throws on the second binding to the same
canvas — and the *first* instance is still bound and still rendering. **The symptom is not the
error**: it is a game that keeps drawing while every tap does nothing and the readout is frozen,
with the real message buried in a console nobody is looking at by then. One line:
`if (import.meta.hot) import.meta.hot.dispose(() => input.dispose());`

### Fractional grid indices

A droplet spawned one cell past the end of a typed array; a terrain walk whose first diagonal came
from a real-valued position and stayed fractional all the way to `gy * N + gx`. Both read
*between* two cells, which is `undefined`, which is `NaN` the moment it is multiplied — and the
renderer then correctly refuses the tint and the frame goes black. `0/0`, `Infinity - Infinity`
and `Math.sqrt(-1)` are all exactly specified, so **this is never a floating-point-tier problem**.
The guard belongs at the computation that mints the index, and in both cases it was one `clamp` or
one `Math.ceil` at a loop bound.

---

## The meta-trap: green is not evidence

The kit's tenth rule. A suite that passes over a black screen is a failure this project has
already shipped once. **Every change that affects what the player sees ends with somebody
actually looking at the running game** — open it, screenshot it, judge it.

Two corollaries that keep catching people:

- **High coverage is not evidence a feature works in a real game.** One package in this kit
  reached 100% statement coverage with no consumer anywhere in the plan.
- **A run-tested example and a hand-written one are indistinguishable to a reader, and are read
  with equal trust.** Nobody copies the snippet that happens to be under test; they copy the one
  nearest the symbol they were looking at.

---

## Where the rest lives

| the area | skill |
|---|---|
| the boot, the loop, the two silent wiring mistakes | `starting` |
| color, sprites, terrain shading, palettes | `art` |
| terrain, paths, picking on slopes, endless worlds | `world` |
| production, prices, offline | `economy` |
| taps, drags, picking backwards | `input` |
| synthesis, buses, the bed | `sound` |
| migrations, statuses, reset | `saving` |
| overlays, latches, the pointer contract | `hud` |
| replays and what may be hashed | `determinism` |
| what is actually slow, and what not to optimize | `performance` |

Every package also ships its README: `node_modules/@lattice/<name>/README.md`.
