---
name: world
description: Terrain, elevation, roads, paths and walkers in an isometric world. Use when adding hills, a heightfield, a river, a coastline, a road or a route, when moving characters or crowds along a path, when things walk in the wrong place or hitch on diagonals, when the map should be endless, or when a tap picks the wrong tile on sloped ground.
---

# The world

Three coordinate spaces — **grid**, **world**, **screen** — and every operation here is only
correct because it knows which one it is in. Game code never converts between them by hand;
every conversion is a named function that takes an output parameter.

Two facts that decide most of what follows:

- **Tile lookup floors, never rounds.** Rounding snaps to the nearest lattice vertex and picks
  the wrong tile for three quarters of every diamond.
- **Elevation lives on grid vertices, not tile centers.** Adjacent tiles therefore share their
  corner values exactly and cannot leave a seam — and once `z` exists the projection is no
  longer invertible, so picking has to be terrain-aware. That is the biggest trap in this skill
  and it has its own section.

---

## Ground, and height on it

```ts
import { TileGrid, footprintBase, heightAt, slopeAt, tileSourceOf } from '@latticekit/iso';
import type { Footprint, HeightField } from '@latticekit/iso';
import { fbm2 } from '@latticekit/core';

const W = 96;
const H = 96;

// One value per grid VERTEX, so the grid is one wider than the tile map in each axis.
const heights = new TileGrid(W + 1, H + 1);
heights.fillFrom((gx, gy) => Math.max(0, fbm2(1234, gx * 0.04, gy * 0.04, 4) * 8));

/** `stepPx` is world pixels per height unit — the one conversion between the game's units
 *  and the projection's. 8 means a ridge of 5 units stands 40 world pixels proud. */
const land: HeightField = { heights, stepPx: 8 };

/** The tallest ground on the map, in world pixels. Camera framing and the terrain cull both
 *  need it, and both are silently wrong without it. Compute it once, at generation. */
export const MAX_HEIGHT_PX = 8 * 8;

export function groundUnder(f: Footprint): number {
  // The MAXIMUM vertex height under the footprint, not the mean: a building resting on the mean
  // of a slope has one corner buried in the hill and one floating.
  return footprintBase(land, f);
}

export function walkCost(gx: number, gy: number): number {
  return 1 + slopeAt(land, gx, gy) * 2;      // steeper ground costs more to cross
}

export function surfaceAt(gx: number, gy: number): number {
  return heightAt(land, gx, gy);             // bilinear, in world pixels
}

/** An unbounded world: a function is defined everywhere, so it has no edge and costs no
 *  memory. Everything is a pure function of (seed, gx, gy) — see the warning below. */
export const endless: HeightField = {
  heights: tileSourceOf((gx, gy) => Math.max(0, fbm2(1234, gx * 0.04, gy * 0.04, 4) * 8)),
  stepPx: 8,
};
```

**`tileSourceOf` answers `has()` with `true` everywhere.** That is correct for an unbounded
world, and it composes into a wrong answer with `screenToTileOnHeights` — and so with `input`'s
`onGround`, which is that same test — because `has()` is the *only* off-map check either has.
Naively combined, a tap on the empty sky returns a grid coordinate —
one exhibit reported sculpting grid `(-4000, 900)` from one. If your world is bounded, hand-write
the source with a real bound:

```ts
import { tileSourceOf } from '@latticekit/iso';
import type { TileSource } from '@latticekit/iso';

export function boundedSource(get: (gx: number, gy: number) => number, w: number, h: number): TileSource {
  const inner = tileSourceOf(get);
  return {
    get: (gx, gy) => inner.get(gx, gy),
    has: (gx, gy) => gx >= 0 && gy >= 0 && gx < w && gy < h,
  };
}
```

**`HeightField.heights` is a `TileSource`, and a `TileSource` cannot be iterated.** The interface
is `get` and `has`; `forEach` is on the `TileGrid` class. So if you need to walk the field — to
paint it, to find its extremes, to derive a map — keep your own `TileGrid` reference beside the
`HeightField` rather than trying to get it back out.

---

## Picking on sloped ground — the field has to be declared, or every tap is wrong

Raise a point by half a tile height and it lands on **exactly the same screen pixel** as the
point one unit of `gx + gy` further away at sea level. So a screen pixel does not name a tile; it
names a *family* of tiles, and choosing between them needs the heightfield.

**A game that has a `HeightField` has to hand it to `@latticekit/input`.** Nothing else in the kit
can: input has no map and no way to acquire one, so told nothing it answers on the plane `z = 0`,
which is a real tile several terraces **up the slope** from the finger — measured at **281 px and
14–16 tiles** on one hillside and **212–237 CSS pixels** on another, always uphill, because the
sea-level answer has the smaller `gx + gy`.

```ts
import { createInput } from '@latticekit/input';
import type { Camera, HeightField } from '@latticekit/iso';
import type { Loop } from '@latticekit/loop';

export function wire(
  canvas: HTMLCanvasElement,
  camera: Camera,
  loop: Loop,
  land: HeightField,
  maxHeightPx: number,   // MAX_HEIGHT_PX from the block above: the tallest ground, in world px
): void {
  createInput({
    element: canvas,
    camera,
    step: loop,
    // Every gesture, every ActionEvent and `hoverTile` now resolve on the terrain. Over the sky
    // they report `onGround: false` and NaN, which is what a handler has to check.
    terrain: { field: land, maxHeightPx },
    actions: { place: ['tap'] },
  });
}
```

`input` carries the three states of that option, the `onGround` rule and the live `setTerrain`;
this skill does not restate them. What is terrain's is the number and the maths: **`maxHeightPx`
is the march's ceiling**, too small and it silently truncates, and at 0 it is precisely the naive
answer. For a pick that does not come through `input` at all, `iso.screenToTileOnHeights` is the
same march exposed directly, with the same ceiling and the same boolean.

**If the ground itself moves** — a sculpting game, a terraforming brush — nothing needs
re-declaring: `input` holds the field rather than copying it, so ground raised this frame is
ground the next event resolves on, and `setTerrain` is only for a new field or a ridge that has
outgrown the old ceiling. Resolve once per **update** against the field as it stands *this* step.
A brush driven by a coordinate picked on the flat plane walks away from the finger exactly as
fast as the ridge grows: you make a hill and the brush slides off the far side of it while you
hold still, which reads as a broken brush rather than as a wrong coordinate.

The march costs about `maxHeightPx / 16` steps plus twelve bisections — measured at roughly
400 bilinear samples and **under 0.05 ms** on a 1,400-px-tall field. Its **fixed iteration count
rather than a tolerance** is deliberate: a march that stopped when it was "close enough" would
resolve the same tap differently on a slow phone and a fast desktop, which is a replay
divergence with no stack trace.

---

## Roads, and walkers with no state between them

**A path is a curve to be sampled by arc length, not a list of nodes to be stepped.** One grid
unit along `+gx` is 35.8 world pixels and one along the `(1,1)` diagonal is 22.6, so a walker
advanced at a constant rate in *grid* units speeds up by 58% every time the road turns. It looks
exactly like a frame-rate problem and is not one.

```ts
import { Path, PathFinder, pathSample, pathSimplify } from '@latticekit/iso';
import type { GridPoint, TileCost } from '@latticekit/iso';

const cost: TileCost = (gx, gy) => walkCost(gx, gy);
declare function walkCost(gx: number, gy: number): number;

const finder = new PathFinder(4096);
const road = new Path(128);

export function layRoad(): boolean {
  const found = finder.find(cost, 2, 2, 90, 90, road);
  // Check the boolean WHERE YOU SEARCHED. A failed search leaves an empty Path, and
  // `pathSample` throws on one — in the render loop, about arc length, a long way from here.
  if (!found) return false;
  pathSimplify(road, cost);   // 8-way A* returns a staircase; this collapses it
  return true;
}

const here: GridPoint = { gx: 0, gy: 0 };

/** Two hundred walkers, no per-walker state. `s` is an arc length; the road is what changes. */
export function walkerAt(i: number, count: number, t: number, speed: number): GridPoint {
  const s = (t * speed + (i / count) * road.arcLength) % road.arcLength;
  return pathSample(road, s, here);
}
```

**`pathSimplify` takes your cost function, not a passability test.** Hand it a
"is this passable?" predicate instead and it throws away every contour a weighted search was run
to find, and hands back exactly the straight line the weights existed to avoid. With the real
cost it straightens the route but never moves it onto worse ground than it was already on — one
measured case went from 59 nodes and 1976.9 world px to 3 nodes and 1706.1, a 14% saving a
reach-based economy was otherwise overpaying.

**If a search fails somewhere else**, read `road.searchFailure` where the path arrives: a seed
that puts a river across the gate otherwise produces a white screen at boot, from `pathSample`,
in the render loop, about arc length.

**`pathSample` and `pathDirAt` each run their own binary search.** A walker that needs both a
position and a facing pays two searches over one arc-length table for one value of `s` — at 900
walkers that is 1,800 searches a frame where 900 would do. Known gap; there is no combined call.
Do not build a per-walker cache to work around it, which costs more than it saves.

---

## Weighted paths cost about 17× — know it before you reach for them

`PathFinder`'s heuristic is the integer octile metric and **carries no weight term**, so the
moment a `TileCost` returns anything above 1 the estimate stops being tight and A\* slides
toward Dijkstra. Measured on identical geometry:

| cost function | mean search | worst |
|---|---:|---:|
| constant `1` everywhere | **0.13 ms** | 0.5 ms |
| read from a baked `Uint8Array` | 0.51 ms | 2.0 ms |
| computed live from the height field | **2.18 ms** | 8.9 ms |

Nothing warns you, and the symptom is a frame-time cliff that appears the day you add a second
weight. Two responses, in order:

1. **Bake the cost grid into a `Uint8Array`** and read from it. That is the 4× row above, and it
   is what makes live re-planning affordable at all. Repaint it in exactly two places: the box a
   change struck, on the frame it struck it, and a rolling eighth of the map every frame — the
   whole map refreshes in eight frames and the changed box never waits.
2. **Recompute only the routes a change actually crossed.** A `Path` has a node per tile, so
   "did this stroke land on this route" is a squared-distance test per node — sixteen routes of
   about thirty nodes is 480 comparisons, roughly a thousandth of one search. Then replan two a
   frame. A walker keeps its position across a replan and loses only its progress, because `s`
   is an arc length along whichever curve it holds and the new curve begins under its feet.

Recomputing every route every frame is the answer that looks safest and spends the frame on
nothing. Round-robin on a timer is bounded and blind: a change drawn straight across a route
waits its turn while the walker climbs a cliff that did not exist a moment ago.

---

## A flow field, when many things share one destination

```ts
import { FlowField, TileGrid } from '@latticekit/iso';
import type { TileCost } from '@latticekit/iso';

const ground = new TileGrid(96, 96, { fill: 1 });
const cost: TileCost = (gx, gy) => ground.get(gx, gy);

const field = new FlowField(0, 0, 96, 96);
field.addGoal(90, 90);
field.build(cost, undefined, ground.version);

export function onMapChanged(): void {
  ground.set(24, 24, 1);                       // one write, and `version` bumps
  if (field.builtAtVersion !== ground.version) field.build(cost, undefined, ground.version);
}

/** Reachability comes free: `dirAt` is 0 where nothing can step, so "have I just walled my
 *  walkers in?" needs no flood fill. */
export function stranded(gx: number, gy: number): boolean {
  return field.dirAt(gx, gy) === 0 && field.costAt(gx, gy) < 0;
}
```

One sweep over a 96×96 field is about 0.115 ms, which is why there is no incremental replanner:
the subtlest code in the package, a second invalidation protocol, and a class of bug that
reproduces once an hour and never in a test, to buy back 1.4% of one frame.

**Impassability strands walkers, and it does it quietly.** One exhibit made water above 0.55
units impassable and opened with twelve of its sixteen walkers stuck. Reserve blocking for what
a person genuinely could not cross, and let depth *cost* below that — every route then seeks the
shallowest crossing, and the walkers converge on fords, which looks designed.

---

## Sizing a bounded map — do this before you pick a number

**A world that fits inside the frame is a diorama**, and it is what a from-scratch build produces
by default. The standard every exhibit in this kit was rebuilt against: the world's bounding rect
is at least **1.6× the viewport on its long axis**, no more than a third of the opening frame is
empty background, and the world meets the frame edge rather than showing a corner with sky behind
it. `starting` carries all five rows. The part that is terrain's is the arithmetic.

A square grid projects to a **diamond**, and a viewport inscribed in it needs

```
w ≤ 2H − 4h
```

where `w`/`h` are the viewport and `H` is the diamond's half-height. One exhibit at **96 tiles**
measured **3,044 px against a 2,939 px frame** — satisfiable at exactly one camera position,
which is not a world, it is a photograph, and which produces a hard corner with background
behind it and no way to pan out of it. The same exhibit shipped at **160 tiles**, where the same
inequality leaves 1,950 px of vertical camera travel and 3,400 of horizontal.

Do the arithmetic before you choose the map size. It is cheaper than three rebuilds.

**Density is a loop bound, and it is counted in hundreds.** Thirty trees on a 160-tile map is a
model of a forest. The cheap way to get thousands is the rule the determinism section below
already states for a different reason: **scatter is a function of `(seed, gx, gy)`**, evaluated
over the *visible* tile range each frame rather than materialized into a list. A `hash2` threshold
at 0.86 puts a tree on 14% of the tiles — about 3,600 of them on a 160×160 map — and the ones
off-screen cost exactly nothing, because they were never asked about.

---

## The axis the projection flattens

**An isometric projection compresses exactly the axis a landform is impressive along.** A unit of
height is `HALF_H` = 16 world pixels against `HALF_W` = 32 for a unit of ground, and two of every
tile's four corners land on the same screen row — so verticality, the thing that makes a mountain
a mountain, is the one property the camera cannot show. A world whose subject is vertical has to
buy that axis back with **composition**, and none of the ways to do it are the height field:

- **put something known-small at the base and in front** — a walker, a hut, a lamp — so the eye
  has a ruler;
- **run the landform off the top of the frame**, so the summit is somewhere the player has to go
  and look for rather than a shape they can measure at a glance;
- **stack three distance bands up it**, so the far one is dimmer and the near one is not;
- **narrow the base.** A cone that fills the map reads as ground. The same cone with a valley
  beside it reads as a mountain.

Raising the height field is the move that feels like it must work and does not: doubling `stepPx`
doubles the compressed axis and leaves every other one where it was, so the landform gets taller
and the picture does not change its mind about what it is looking at. `art` has the general form
of this — a cue decorates a structure and cannot replace one.

---

## Determinism: position, not sequence

For anything the player can pan away from and come back to, **generate from `(seed, gx, gy)`,
never from a stream.** A single sequential `Rng` drawn from as you pan is deterministic in the
sense that a replay from tick zero reproduces it, and completely useless here, because the field
it produces depends on the path the player walked to reach it. **Pan away from a landmark and
back and you get a different landmark.**

```ts
import { fbm2, hash2, toUnit } from '@latticekit/core';

const SEED = 0x5eed;

export function tileAt(gx: number, gy: number): { height: number; tree: boolean } {
  return {
    height: fbm2(SEED, gx * 0.04, gy * 0.04, 4) * 8,
    tree: toUnit(hash2(SEED ^ 0x7ee, gx, gy)) > 0.86,
  };
}
```

`hash2`, `hash3`, `noise2` and `fbm2` have no cursor, no setup call and no permutation table —
they are functions of their coordinates, so draw order cannot matter because there is no draw.

Two edges worth knowing: **`hash2` truncates toward zero rather than flooring**, so cells `-0.5`
and `0.5` share cell `0` and anything sampling across the origin must floor first. And
**`noise2` returns exactly 0 far more often than you would guess when both inputs are lattice
points** — 397k of 14M samples — so code whose correctness depends on "noise is never exactly
zero" is a live bug on integer coordinates.

---

## Three more that cost real time

**Fractional grid indices produce a black screen, and it is never a determinism problem.** A
walk whose first diagonal came from a real-valued rim position and stayed fractional all the way
to `gy * N + gx` reads *between* two cells, which is `undefined`, which is `NaN` the moment it is
multiplied — and `draw` then correctly refuses the tint and the frame goes black. The guard
belongs at the computation that mints the index, and in every case seen so far it was one
`clamp` or one `Math.ceil` at a loop bound.

**A continuous height field on a diamond grid renders as triangles**, whatever the model does.
The fix is a render-side vertex snap — snap each *drawn* vertex most of the way onto its band,
about 86%, leaving a seventh of the real relief in so every frame still differs from the last —
and it happens in the render and **never in the model**, or every checkpoint, gradient and
fingerprint moves with it. Snap *up*, not down: snapping down crosses the band boundary by
construction and stripes each bench with the color of the one below it.

**`tileBounds`' height argument extends `minY` upward, which is right for framing and wrong for
a fence.** Pass your tallest building to frame the opening shot; pass something much smaller to
`CameraOptions.bounds`, or the player can park the viewport in the sky above the far corner and
still satisfy `keepVisible`. One exhibit ships six storeys of air as its fence against
thirty-four storeys of buildings.

---

## What this skill does not cover

| you want | read |
|---|---|
| the boot, the loop, the camera's first frame | `starting` |
| how terrain and buildings are *shaded* | `art` |
| taps, drags, hover, placing a thing | `input` |
| what a road *earns* | `economy` |
| a stutter, a cull, a frame budget | `performance` |
| something that renders and looks wrong | `traps` |

Long form, on disk: `node_modules/@latticekit/iso/README.md`.
