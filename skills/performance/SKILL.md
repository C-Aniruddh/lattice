---
name: performance
description: Diagnosing and fixing a game that stutters, drops frames, gets slower over time, or hitches when something changes. Use for frame drops, jank, lag, "it's slow", "it stutters", a bad frame-time number, garbage-collection pauses, or deciding how many things a scene can afford.
---

# Performance

The budget is **8 ms a frame** for everything. Almost nothing in this kit costs a measurable
fraction of that; when a Lattice game is slow it is almost always one of about six specific
things, and this skill is those six in the order they are worth checking.

**Measure before you change anything.** Half the optimizations people reach for here are
unavailable — there is no sprite cache to add, it was measured and deleted — and the other half
are in the wrong place.

---

## First: is the number you are reading true?

Two instruments, and the one that reads better is blind.

```ts
import type { Loop } from '@lattice/loop';

export function verdict(loop: Loop): string {
  const gap = loop.stats.worstGapMs;      // wall time between two PAINTED frames
  const cadence = loop.stats.cadenceMs;   // the display's own period, as observed
  // The verdict is the RATIO. Under about 1.5 cadences dropped no frames.
  return `${gap.toFixed(1)} ms worst against a ${cadence.toFixed(1)} ms display`;
}
```

**`loop.stats.worstFrameMs` is the pump's own wall time** — the loop reads the clock on the way
into a pump and on the way out. **A garbage collection, a style recalculation, or anything else
that lands *between* two pumps is in neither reading.** That is not hypothetical:

- one game measured **23.1 ms worst on one machine and 13.1 ms on another for the same build**,
  because whether the pause lands inside a pump is machine-dependent and the readout is not;
- another shipped a HUD reading **`0.0 ms` against a real worst gap of 9.2 ms**;
- a third latched `worstFrameMs` at the close of each window and displayed **`0.0 ms` for the
  first ten seconds**, because it was showing its own initializer and nothing renders in zero
  milliseconds.

**`worstGapMs` is the wall time from one painted frame to the next**, so everything in between is
inside it by construction, and it is measured from the loop's own single clock reading rather
than from `performance.now()`.

**Read it next to `cadenceMs`, never next to a budget.** A gap contains a whole display period
that is not work: 16.7 ms is a perfect frame on a 60 Hz panel and 8.3 ms is a perfect one at
120 Hz. `budgetMs` is a *work* budget and belongs to `overBudget`, which counts pumps.

**A readout of exactly `0.0 ms` means the tab is hidden, not that the scene is fast.** In a
headless or backgrounded tab `requestAnimationFrame` never fires and the loop reports a confident
zero. A hidden tab has been measured suspending rAF for **6,108 ms**. Bring the window to the
front before believing any number on it. If you must measure headlessly, shim rAF onto a
`MessageChannel`, which visibility does not throttle — every frame then costs its own work with
no display idle in it, which is pessimistic and the only honest reading available.

**Report the worst frame of a window, never a mean.** 16 ms mean with every eighth frame at 40 ms
is a visible stutter and a healthy-looking number, and that is exactly the shape a minting hitch
has. And know that **`resetStats()` is all-or-nothing** — it zeroes `fps` and `frameMs` for every
other reader, so a naive rolling window makes a second readout show `0.0ms · 0fps` one second in
five. Seal the previous window and report the larger of the two:

```ts
import type { Loop } from '@lattice/loop';

let sealedMs = 0;
let windowAt = 0;

/** The worst gap of the last five to ten seconds — never of the last zero to ten. */
export function rollingWorst(loop: Loop): number {
  const t = loop.realTime;
  if (t - windowAt >= 5) {
    windowAt = t;
    sealedMs = loop.stats.worstGapMs;
    loop.resetStats();
  }
  return Math.max(sealedMs, loop.stats.worstGapMs);
}
```

Also: **the first window includes the page load.** One game read ~16.3 ms on arrival and settled
to ~12.0 ms from the second window on. Discard the opening frames or label the number; the loop's
own `warmupFrames` (default 10) already does this for the gap statistics.

---

## The six things that are actually slow

### 1. A moving color, allocating inside `draw`

The most expensive bug this kit has had, and it sat two layers below the author. `softEllipse`
renders one ramp per color pair and reuses it, so **the color pair is a cache key** — and the
first version of that cache was keyed on the exact 8-bit pair and evicted **wholesale**, so one
animated color took every other call site's entries down with it. Measured at **3.74 misses a
frame** — about 225 canvas elements a second and **3.7 MB/s of garbage** — and at 15.9 a frame in
a heavier scene, where the cache was being cleared every six frames.

The key is snapped and eviction is one entry now, so a single moving color is cheap. Two things
still cost: **animating both endpoints independently** multiplies pairs, and **a `Palette.lerp`
on a continuous `t` every frame** moves every color in the scene at once. One exhibit found the
second as 27% of its soft ellipses missing with no flickering light anywhere in it.

The tell is not a flicker. It is a game that gets slower and stays slower. See `art`.

### 2. Not culling before the sort

**Culling before `DepthSorter.add` is the strongest lever a large world has.** One game handed
every prop to the sorter every frame — **3,832 of them, five index sorts, to throw away 92%** —
and closed a **93.9 ms** worst frame down to 0.4 ms mean, with no lights in the scene at all.

There is no `wouldKeep` on the sorter, which is a known gap. The cheap version is a screen-space
rejection on the tile's own projected position before you touch the heightfield or build a
variant.

### 3. A terrain walk that grows quadratically

`renderFrame` margins the visible tile box by `maxHeightPx` **on both axes** so a summit whose
base is off-screen still paints. That is necessary and it is applied to a *box*, while elevation
displaces a tile only along `gx + gy` — so the widened region grows quadratically in a direction
elevation never uses.

Measured on terrain 1,470 px tall: **26,569 tiles visited for a frame that paints 1,201.** Two
thirds of a 93.9 ms worst frame was this.

The fix is to walk `u = gx + gy` and `v = gx − gy` directly rather than row-major: same coverage,
**3,081 visits**, and ascending `u` is *strictly* far-to-near, which row-major order is only
accidentally. A screen rectangle is exactly a pair of intervals in those two sums, because screen
x depends on `gx − gy` alone and screen y on `gx + gy` alone — which makes the cull exact rather
than conservative. Two independent games derived this within a day of each other.

### 4. Weighted pathfinding

`PathFinder`'s heuristic carries no weight term, so any `TileCost` above 1 slides A\* toward
Dijkstra: **0.13 ms mean unweighted against 2.18 ms weighted, with an 8.9 ms worst** on identical
geometry — about 17×. Bake the cost grid into a `Uint8Array` and it comes back to 0.51 ms. Full
treatment in the `world` skill.

### 5. Light pools priced by area

A pool's radius is given in **tiles**, so its screen area grows with the **square of the zoom** —
a player pinching in multiplies the field's fill cost without adding a light. This is the number
that reconciles two measurements that look contradictory: **704 pools costing about 0.2 ms in one
game, and 30 pools costing 9.5 ms at maximum zoom in another.** Same subsystem, fifty times
apart.

If your scene is fill-bound at high zoom, divide the field's `scale` by the zoom — one game went
from 18.1 ms to 8.6 ms at 2.6× that way — and know it fights any `scale` control you expose.

Also: **the light field is not occluded.** A street-level pool composites over the roof of the
tower in front of it, so a dense night scene grows pale ellipses fourteen storeys up. One game
went from about 130 pools to 35, halved every radius, and measured `scale: 1` as buying nothing
but **5 ms**.

### 6. Rebuilding a list on the frame the player acted

One game rebuilt its whole drawable list whenever the player tapped. At 64 tiles that was 120
objects and nobody noticed; at 96 it was **six hundred**, each with a variant, a footprint literal
and a height sample — and the rebuild fired on the one input the game had, so **the worst frame of
the last ten seconds landed on the frame the player just tapped**: a 19.6 ms spike against a
steady 4–7 ms.

Split the list. What never changes after boot is one array; what a tap moves is another.

---

## Rules that keep a frame cheap

**The hot path allocates nothing.** Anything called per-frame or per-entity takes an output
parameter or returns a primitive. `{ x, y }` returned sixty times a second times four hundred
sprites is a garbage-collector pause with a nice API.

```ts
import { v2, v2AddScaled } from '@lattice/core';
import { gridToScreen } from '@lattice/iso';
import type { Camera } from '@lattice/iso';

const pos = v2(0, 0);            // allocated once, at setup
const at = v2(0, 0);

export function step(camera: Camera, gx: number, gy: number, zPx: number): void {
  v2AddScaled(pos, pos, v2(1, 0), 3);   // writes INTO `pos`
  gridToScreen(camera, gx, gy, zPx, at);
}
```

The argument for out-parameters is entirely in the tail: allocation wins the *mean* by about 25%
and loses the moment a collection lands in a frame the player is watching.

**Hoist every per-item visitor.** An inline arrow inside a per-sprite loop is a closure a frame.
The same applies to the predicate you hand `pickSorted` — a closure per tap is a closure per tap.

**Per-draw op count is what scales, not the placement maths.** A walker in one game costs about
fifteen surface operations, and that number is the finding: at two hundred it is nothing, at two
thousand it is the entire frame. The closed form that *placed* them costs 0.006 ms for fifty.

**Detail falloff by distance band is permitted and worth it.** Three crop rows per tile near, one
in the middle distance, none in the mist; trees drop their second canopy lobe; walls drop their
shadowed foot. Density is bought with culling and cheaper sprites, never with frame time.

---

## What not to optimize

| tempting | why not |
|---|---|
| **caching sprite bitmaps** | there is no sprite cache in `draw`. It was written, measured and **deleted**: the direct path draws 400 buildings of 42 draw calls each in **2.14 ms**, and a *perfect* cache with 100% hits would still cost 0.04 ms for keys, lookups and blits — so the most it could ever buy back is about 2.1 ms of an 8 ms budget, in exchange for zoom buckets, palette revisions, blit snapping and a don't-fill-while-moving rule. "Cache it" is not a move available to you |
| **an incremental path replanner** | a full flow-field rebuild over a 48×48 valley is 0.115 ms. D\* Lite buys back 1.4% of one frame for the subtlest code in the package and a bug that reproduces once an hour and never in a test |
| **the depth sort** | a busy frame — clear, 400 adds, sort, 400 reads — is **0.041 ms**. If 10,000 items ever costs forty times 1,000 rather than a dozen, somebody has reintroduced a pairwise scan; short of that, it is not your problem |
| **the HUD** | a busy overlay costs about 4.5 µs of an 8 ms frame |
| **input** | a realistic input frame is 0.009% of the budget |
| **raising `maxCatchUpMs`** | the 250 ms ceiling is what stops a restored tab spending four seconds inside one frame while the browser paints nothing. Raising it turns a hang into a longer hang |

---

## The disguised failure: a game that is far too slow looks fine

The catch-up clamp turns a hang into a game running in slow motion. The tells are
`stats.stepsLastPump` sustained above 1, and a growing gap between `loop.realTime` and
`loop.time`. Watch for both; neither shows up as a dropped frame.

---

## Fill-bound or op-bound is a property of your scene, not of the kit

Two games measured the pixel-ratio sweep and disagreed, correctly:

| | `dpr` 0.5 | `dpr` 1 | `dpr` 2 |
|---|---:|---:|---:|
| a full-frame terrain pass | 7.95 ms | — | **16.21 ms** |
| ten thousand small draw calls | 4.77 ms | 5.01 ms | 4.91 ms |

A 42-op sprite occupies a few hundred pixels; a terrain quad occupies a whole tile and the
terrain covers the viewport. So a full-frame terrain is **fill-bound**, where a scene of ten
thousand small calls is **op-bound** — and the device pixel ratio is squarely in the cost of the
first and irrelevant to the second. Count your own draw calls before assuming which you are.

**And never pass `devicePixelRatio` to `surface.resize`.** The surface already clamped the
device's ratio at construction, and re-reading the raw one walks straight past that: a 3× phone
quietly renders 2.25× the pixels it budgeted for. Read `surface.pixelRatio` back off the surface.

---

## What this skill does not cover

| you want | read |
|---|---|
| why a color allocates, and how to snap it | `art` |
| culling, the `u`/`v` walk, path costs | `world` |
| the fixed step, the clamp, and hidden tabs | `starting` |
| whether the same run reproduces at all | `determinism` |
| a symptom that is wrong rather than slow | `traps` |
