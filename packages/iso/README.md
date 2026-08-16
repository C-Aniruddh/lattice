# `@lattice/iso`

**The three coordinate spaces of a 2:1 tile game — grid, world and screen — and every
operation that is only correct because it knows which one it is in.**

Projection, elevation, camera, depth order, footprints, picking, and paths that can be
*sampled* rather than stepped. No DOM, no canvas, no clock, no randomness. If a bug can be
described as "the wrong tile", "drawn through a wall", "the tap opened the building behind",
"the walkers hitch on the diagonals" or "I lost my island off the edge of the screen", it is
this package's fault and nobody else's.

```
npm i @lattice/iso    # brings @lattice/core, and nothing else
```

---

## A valley, a frame, and fifty walkers

This program runs as written — it is `test/readme.test.ts`, so the numbers below cannot drift
away from the code above them.

```ts
import { v2 } from '@lattice/core';
import {
  DepthSorter, FlowField, Path, PathFinder, TileGrid,
  anchorToScreen, createCamera, footprintAnchor, heightAt,
  pathSample, pathSimplify, pickSorted, screenToTile, tileBounds,
} from '@lattice/iso';
import type { Anchor, GridPoint, Rect, Tile } from '@lattice/iso';

// ── the valley ──────────────────────────────────────────────────────────────
const ground = new TileGrid(48, 48, { fill: 1 });          // 1 = ordinary ground
const heights = new TileGrid(49, 49);                      // one value per grid *vertex*
heights.fillFrom((gx, gy) => (gx > 20 && gx < 28 && gy > 8 ? 3 : 0));    // a ridge
const valley = { heights, stepPx: 8 };                     // world pixels per height unit
for (let gy = 10; gy < 40; gy++) ground.set(24, gy, 0);    // a rockfall across the ridge

// ── the camera ──────────────────────────────────────────────────────────────
const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const camera = createCamera(960, 540, { bounds: tileBounds(0, 0, 48, 48, 0, worldRect) });
camera.centerOnTile(8, 8);

// ── one frame ───────────────────────────────────────────────────────────────
const buildings = [
  { gx: 4, gy: 4, w: 3, d: 2, heightPx: 64 },
  { gx: 10, gy: 6, w: 2, d: 2, heightPx: 40 },
  { gx: 6, gy: 12, w: 1, d: 1, heightPx: 96 },
] as const;
const order = new DepthSorter(512);                 // allocated once, reused for ever
order.clear();
for (const b of buildings) order.add(b.gx, b.gy, b.w, b.d, b.heightPx);
order.sort(camera);                                 // culls, then orders back-to-front
for (let i = 0; i < order.count; i++) paint(buildings[order.indexAt(i)]);

// …and on tap, the exact reverse of that same walk.
const hit = pickSorted(order, (i) => silhouetteHit(buildings[i], pointerX, pointerY));

const tile: Tile = { gx: 0, gy: 0 };
screenToTile(camera, 480, 270, tile);               // floors, never rounds

// ── a road, and fifty walkers with no state between them ────────────────────
const cost = (gx: number, gy: number): number => ground.get(gx, gy);
const finder = new PathFinder(4096);
const road = new Path(128);
finder.find(cost, 2, 2, 44, 44, road);
pathSimplify(road, cost);                           // collapse the staircase

const here: GridPoint = { gx: 0, gy: 0 };
for (let i = 0; i < 50; i++) {
  pathSample(road, (t * speed + (i / 50) * road.arcLength) % road.arcLength, here);
  order.addPoint(here.gx, here.gy, heightAt(valley, here.gx, here.gy));
}

// ── the rockfall beat, in three lines ───────────────────────────────────────
const field = new FlowField(0, 0, 48, 48);
field.addGoal(44, 44);
field.build(cost, undefined, ground.version);
ground.set(24, 24, 1);                                            // one write, version bumps
if (field.builtAtVersion !== ground.version) field.build(cost, undefined, ground.version);

// ── an anchor, for a label that has to survive a pan ────────────────────────
const label: Anchor = { gx: 0, gy: 0, zPx: 0 };
footprintAnchor(buildings[0], buildings[0].heightPx, label);
const screen = anchorToScreen(camera, label, v2());
```

```
paint order: 0, 1, 2
tapped building 1
tile under the middle of the screen: 8, 8
road: 59 nodes, 1976.9 world px
simplified: 3 nodes, 1701.0 world px
50 walkers, mean ground height 3.04 px
blocked:  cost from (2,2) is 684
cleared:  cost from (2,2) is 600
label at 496, 118 CSS px
```

Three things in that output are the whole design:

- **`1976.9` becoming `1701.0`.** A raw 8-way A\* result is a staircase, and a walker sampled
  along one weaves from side to side. `pathSimplify` collapses 59 nodes to 3 and takes 14% off
  the arc length — which a `reach`-based economy was otherwise overpaying.
- **`684` becoming `600` with no bookkeeping.** Nobody holds a route. The walkers hold an arc
  length along one, and the road is what changed.
- **`world px`, not tiles.** One grid unit along `+gx` is 35.8 world pixels and one along the
  `(1,1)` diagonal is 22.6, so a walker advanced at a constant rate in *grid* units speeds up
  by 58% every time the road turns. It looks exactly like a frame-rate problem and is not one.

---

## The allocation contract

**No function here returns a point, a rectangle, or any other object the caller did not hand
in.** There are three shapes and nothing else:

| shape | example | for |
|---|---|---|
| **scalar** | `camera.toScreenX(wx)` | the innermost loop; returns a number, so it cannot allocate and the engine inlines it |
| **out-parameter** | `gridToScreen(cam, gx, gy, zPx, out)` | anywhere a point is genuinely wanted as a point |
| **buffer** | `boxSilhouette(cam, gx, gy, vol, out)` | geometry with more than one point |

`createCamera` and `tileSourceOf` are the only exported functions that build something, and
both run at setup. Everything else writes into what it was given, which is checkable by
reading the emitted `.d.ts`: no return type is a bare interface the caller did not pass in.

Note that `toScreenX` takes `wx` alone and `toScreenY` takes `wy` alone. Screen x depends on
world x alone, so the eight corners of a box need four x projections rather than eight — which
is exactly what `boxSilhouette` does.

There is no allocator for `Rect`, `GridPoint`, `Tile`, `TileRange` or `Anchor`: they are plain
field-only shapes, so write the literal once at setup and reuse it. `Vec2` comes from
`@lattice/core`, and `v2()` is its allocator.

---

## What it gives you

| module | what |
|---|---|
| `projection` | `TILE_W`/`TILE_H`, grid ↔ world both ways and both axes, `worldToTile`, `depthOf`, `tileDiamond`, `footprintBounds`, and the kit's `Rect` |
| `camera` | pan, pointer-anchored zoom, a clamp that does not invert, `visibleTileBounds`, `visibleWorldBounds`, `normalizedX` for stereo pan |
| `depth` | `DepthSorter` — fed footprints, hands back a permutation — and `pickSorted`, which walks the same instance backwards |
| `tilemap` | `TileGrid` (the island), `ChunkGrid` (the infinite world), `tileSourceOf` (procedural), all behind one two-method interface |
| `height` | one value per grid **vertex**, sampled bilinearly; `slopeAt` for movement cost |
| `footprint` | occupancy, overlap, flatness, base height, and the anchor a label hangs from |
| `hittest` | `screenToTile`, `screenToTileOnHeights` (terrain-aware), `boxSilhouette`, `pointInPolygon`, `pointInTile` |
| `path` | `Path` as a curve, `pathSample`/`pathProject`/`pathDirAt`/`pathSimplify`, `PathFinder` (A\*) and `FlowField` (Dijkstra) |
| `anchor` | a durable grid position for an overlay, plus its screen point, its visibility and its stereo pan |

---

## Determinism

**No function in this package calls a trigonometric, exponential or logarithmic function.**
ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators exactly; it
explicitly does *not* require correctly-rounded `sin`, `cos`, `atan2`, `pow`, `exp` or `log`.
A tile address, a depth order and a route all reach save files, so all of it stays in Tier A —
and it costs nothing, because the geometry here is linear:

| where it is tempting | what is used instead |
|---|---|
| a walker's facing angle | `pathDirAt` returns one of eight direction codes, from sign and magnitude comparisons |
| the A\* heuristic | the integer octile metric `14·min(dx,dy) + 10·|dx−dy|` — exact, admissible, no `sqrt` |
| arc length | `Math.sqrt` of an exactly-computed sum of squares, which is Tier A |
| an isometric "rotation" | there is none; the projection is a fixed 2×2 integer matrix |
| per-tile variation | not this package's job — `core.hash2` through `fillFrom` or `tileSourceOf` |

Path costs are **integers**, and that is not a style choice. A\* orders its frontier by summed
cost; float summation is associative only by luck, so two engines can pop equal-`f` nodes in a
different order and return different — both optimal, both different — routes. Integer 10/14
costs make the order total, and both orderings in this package (the path heap and
`DepthSorter`'s ready set) break ties by **insertion sequence** and expose no comparator, which
is what makes a replay land on the same pixel.

`iso` contains no randomness and holds no `Rng`. Everything that varies comes in through a
`TileSource` the caller filled.

---

## The depth sort is not a comparison sort

The isometric occlusion rule is

> `a` is strictly behind `b` ⟺ `a` ends before `b` begins on **either** axis.

That relation is not a total order and not even transitive, so handing it to `Array.sort` gives
an implementation-defined result that differs between engines and flickers between frames. A
scalar depth cannot express it either: a pedestrian well down the map but far to the left of a
building has the larger key and gets drawn straight through its wall at second-storey height.

So `sort()` is a topological sort with a depth-ordered ready set, falling back to `depthOf` and
then to insertion index. It is also not the obvious `O(n²)`: item `b` is ready exactly when
`b.gx0 < min{a.gx1}` and `b.gy0 < min{a.gy1}` over the items not yet emitted, both minima only
rise, and four sorted index arrays with four cursors find every newly-ready item in linear
total time.

Cycles are real — two footprints far apart on opposite sides of the screen each end before the
other begins, on opposite axes — and are broken by the same documented tie-break rather than
by hanging.

Elevation deliberately does **not** enter the sort. `add` takes `heightPx` for culling only. In
a 2:1 projection what occludes what is decided entirely on the ground plane; height moves a
sprite up the screen, it does not move it towards the viewer.

---

## Performance

Node 24 on an M-series laptop, `npm run bench -- packages/iso`. The frame budget is 8 ms.

| | mean |
|---|---|
| **a busy frame** — clear, 400 `add`s, `sort`, 400 `indexAt` | **0.041 ms** |
| sort 100 footprints, no camera | 0.008 ms |
| sort 1,000 footprints, no camera | 0.114 ms |
| sort 10,000 footprints, no camera | 3.80 ms |
| sort 10,000 footprints, culled to a 1920×1080 viewport | 0.478 ms |
| 3,200 `toScreenX`/`toScreenY` pairs — 400 sprites, eight corners each | 0.022 ms |
| 3,200 `gridToScreen` into an out-parameter | 0.063 ms |
| 400 `boxSilhouette` — six points each | 0.032 ms |
| 50 `pathSample` on an 8-node road — the crowd, one frame | 0.006 ms |
| 50 `pathSample` on a 512-node road | 0.010 ms |
| `PathFinder.find` across a 48×48 valley with 300 obstacles | 0.091 ms |
| the same, then `pathSimplify` with a line-of-sight pull | 0.109 ms |
| `FlowField.build` — one sweep over a 48×48 valley | 0.115 ms |

Two of those numbers are the argument for a design decision rather than a boast. The **crowd**
at 0.006 ms a frame is why `pathSample` replaces per-walker state instead of supplementing it.
The **rebuild** at 0.115 ms is why there is no incremental replanner: D\* Lite would buy back
1.4% of one frame in exchange for the subtlest code in the package, a second invalidation
protocol, and a class of bug that reproduces once an hour and never in a test.

The 10,000 case is `n log n` with a cache-miss tail, not `n²`. It is included because the shape
of those three numbers is the thing to watch: if 10,000 ever costs forty times 1,000 rather
than a dozen, somebody has reintroduced the pairwise scan.

---

## What is deliberately not here

**A runtime tile size.** Any other *uniform* size is exactly a camera zoom — a game that wants
32×16 runs this lattice at `zoom = 0.5` — so parameterising it would buy a label and cost a
projection object threaded through every signature in `draw`, `input` and `ui`. A different
*aspect* ratio is a different projection and therefore a different package.

**A third grid axis** — but elevation itself *is* here, as a layer. One height per grid vertex
keeps the projection linear and the sort two-dimensional. Bridges, overpasses and floors above
floors are the other side of that line, and a game that wants floors draws one `DepthSorter`
per floor, in order, which this API already supports.

**Anything that draws**, including `LEVEL_H`. A storey is an art proportion, tuned beside
face-shading constants; `iso`'s entire height vocabulary is world pixels, so there is no
signature here a storey could enter through. It belongs to `@lattice/draw`.

**Camera feel.** No inertia, drag, pinch, edge-scroll, keyboard pan, smooth follow or shake.
Those need a clock and a pointer, and both live in `@lattice/input`, which drives this camera
through `panByScreen`, `zoomAt` and `centerOn`. A camera that eases itself cannot be stepped
deterministically in a replay.

**Steering and anything that owns a walker.** `pathSample` will tell you where arc length `s`
is. It will not choose `s`, accelerate, or stop fifty walkers piling into one doorway.

**Entities, components, a scene graph, serialisation, fog of war, line of sight, an incremental
replanner, and a priority queue as an export.** `iso` builds a heap for A\* and Dijkstra and
does not publish it: `core` refused to own one on the grounds that there was exactly one
confirmed consumer, and one consumer owns its own container.

---

## The contract with `@lattice/draw`

Two things above this package cannot be tested from inside it, and both are the kind where each
side is individually correct and jointly broken:

- **`pickSorted` walks the same `DepthSorter` instance that painted, backwards.** `draw` must
  not reorder after `sort()`. Break it and the tap opens the building *behind* the one under
  the finger — silent, intermittent, and unreproducible from a screenshot.
- **`boxSilhouette` defines the six-point order** — north-top, east-top, east-base, south-base,
  west-base, west-top — and `draw`'s stroke must trace the same six points in the same order.
  Break it and hit-testing and pixels diverge with no test in either package noticing, because
  each is correct against its own idea of the shape.

---

## Licence

MIT.
