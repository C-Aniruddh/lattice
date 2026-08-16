# RFC — `@lattice/iso`

**Status:** proposed · **Task:** A2 · **Layer:** 1 · **Depends on:** `@lattice/core` · **Environment:** isomorphic

> Every code block in this document is written as ambient declarations (`export declare …`).
> Pasted whole into a `.ts` file under the repo's `tsconfig.base.json` it compiles clean —
> that is the point of writing a surface rather than a sketch.

---

## 1. The one sentence

**`@lattice/iso` owns the three coordinate spaces of a 2:1 tile game — grid, world and screen —
and every operation that is only correct because it knows which space it is in: projection,
elevation, camera, depth order, footprints, picking, and paths that can be *sampled* as well
as followed.**

If a bug can be described as "the wrong tile", "drawn through a wall", "the tap opened the
building behind", "the walkers hitch on the diagonals" or "I lost my island off the edge of
the screen", it is this package's fault and nobody else's.

---

## 2. The five-line example

The thing a game does every single frame: turn state into a back-to-front draw list.

```ts
const camera = createCamera(960, 540, { bounds: tileBounds(0, 0, 48, 48) });
const scene = new Scene(512);                                  // allocated once, reused for ever
for (const b of state.buildings) scene.add(b.uid, b.gx, b.gy, b.w, b.d, b.heightPx);
scene.sort(camera);                                            // culls, then orders back-to-front
for (let i = 0; i < scene.count; i++) paint(scene.idAt(i));    // painter's algorithm, correct
```

And the sixth line, on tap — the one that has to be the exact reverse of the fifth:

```ts
const hitUid = scene.pick(camera, pointerX, pointerY, (id, sx, sy) => silhouetteHit(id, sx, sy));
```

Everything below exists to make those six lines true. Three consequences fall straight out of
them and drive the whole design:

| the example says | so the API must |
|---|---|
| `scene` is created once, outside the frame | nothing per-frame allocates: no `{x,y}` returns, no closures per item, no arrays per sort |
| `scene.add` takes an **id**, not an object | `iso` never owns your entities. It owns integers and geometry |
| `pick` is a method on the **sorted scene** | the "picking is reverse paint order" rule is structural, not a comment someone must remember |

### The other example, which is the demo's whole crowd

`docs/rfc/demo.md` ranks this the kit's most-needed gap, and it is right to. Fifty walkers,
no per-walker state, nothing allocated, fully deterministic, replayable from `t`:

```ts
for (let i = 0; i < n; i++) {
  pathSample(road, ((t * speed + (i / n) * road.arcLength) % road.arcLength), here);
  scene.addPoint(FIRST_PILGRIM + i, here.x, here.y, heightAt(valley, here.x, here.y));
}
```

That is the design claim behind the whole `path` module: **a path is a curve to be sampled,
not a list of nodes to be stepped through.** A node-stepping API forces every consumer to
carry a cursor, a remainder and a lerp — per walker, per frame — and the moment a walker has
state it has to be saved, replayed and reconciled when the route changes. Sampling by arc
length has none of that: the same expression drives the pilgrims, the staggered ignition wave
up the road in the demo's ending, and the `reach` number the entire economy is built on.

---

## 3. The public surface

### 3.0 Shared types

```ts
/**
 * A mutable point, used as an output parameter.
 *
 * Deliberately not `readonly`: every hot-path conversion in this package writes into a
 * caller-owned point instead of returning a fresh one. Four hundred sprites × sixty frames
 * is 24,000 objects a second, which is a garbage collector pause with a pleasant signature.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/** An integer tile address. Mutable for the same reason as {@link Vec2}. */
export interface Tile {
  gx: number;
  gy: number;
}

/**
 * **The kit's rectangle.** `iso` owns it, because `iso` is the lowest common ancestor of
 * everyone who needs one — `draw` culls with it, `input` tests hit regions with it, `ui`
 * lays panels out with it, and all three already depend on this package. It is deliberately
 * *not* in `core`: a layer-0 package that accretes convenience types makes every consumer pay
 * for the spatial half of the kit, and that is how a kit dies.
 *
 * **Min/max, not x/y/w/h.** Overlap and containment are the operations rectangles exist for,
 * and in this form each is four comparisons with no arithmetic; in `x/y/w/h` form every one
 * of them recomputes `x + w` at every call site, which is both slower and a place to put the
 * sign wrong. {@link rectFromSize} and {@link rectWidth} close the gap for the callers who
 * think in sizes.
 *
 * **A `Rect` carries no coordinate space.** The same type is a world rectangle, a screen
 * rectangle and a CSS-pixel rectangle; the *parameter name* says which — `worldRect`,
 * `screenRect` — and mixing them is exactly the bug class §1 claims. A typed wrapper per
 * space was considered and rejected: it doubles the surface and the conversions still have to
 * be written by hand.
 *
 * Mutable, because it is an output parameter as often as it is an input.
 */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Set all four edges at once. Returns `out` so calls chain. */
export declare function rectSet(out: Rect, minX: number, minY: number, maxX: number, maxY: number): Rect;

/** From a position and a size — the form `ui` and `input` think in. */
export declare function rectFromSize(out: Rect, x: number, y: number, w: number, h: number): Rect;

export declare function rectWidth(r: Readonly<Rect>): number;
export declare function rectHeight(r: Readonly<Rect>): number;
export declare function rectCenterX(r: Readonly<Rect>): number;
export declare function rectCenterY(r: Readonly<Rect>): number;

/** Is the point inside? Half-open on the max edges, so tiled rectangles never double-count. */
export declare function rectContains(r: Readonly<Rect>, x: number, y: number): boolean;

/** Do two rectangles share any area? Touching edges do not count. */
export declare function rectIntersects(a: Readonly<Rect>, b: Readonly<Rect>): boolean;

/** Grow (or, with a negative margin, shrink) in place. The culling margin and the tap slop. */
export declare function rectExpand(out: Rect, margin: number): Rect;

/** `out` becomes the smallest rectangle containing both. `out` may alias `a`. */
export declare function rectUnion(out: Rect, a: Readonly<Rect>, b: Readonly<Rect>): Rect;

/**
 * Reset to the inverted-infinity rectangle, so that a loop of {@link rectUnion} accumulates
 * a bounding box correctly from zero items. Without this the first item has to be special-
 * cased at every call site, and one of those call sites will forget.
 */
export declare function rectMakeEmpty(out: Rect): Rect;

/** True when the rectangle encloses no area, including the {@link rectMakeEmpty} state. */
export declare function rectIsEmpty(r: Readonly<Rect>): boolean;

/** A half-open rectangle of tiles: `gx0 ≤ gx < gx1`, `gy0 ≤ gy < gy1`. */
export interface TileRange {
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
}

/**
 * An axis-aligned footprint on the ground: `w × d` tiles with its north corner at `(gx, gy)`.
 *
 * `w` runs along `+gx` (down-right on screen) and `d` along `+gy` (down-left). Getting those
 * two the wrong way round rotates every building in the game by ninety degrees and is the
 * single most common mistake in a first placement system.
 */
export interface Footprint {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
}
```

### 3.1 `projection` — grid ↔ world

```ts
/**
 * Tile width in world pixels. **A compile-time constant, not a runtime parameter** — see
 * §4.1 for the argument. Even, so {@link HALF_W} is exact and the lattice lands on whole
 * pixels at every power-of-two zoom.
 */
export declare const TILE_W: 64;

/** Tile depth in world pixels. Exactly half of {@link TILE_W} — the 2:1 that defines iso. */
export declare const TILE_H: 32;

export declare const HALF_W: 32;
export declare const HALF_H: 16;

/**
 * grid → world, x only.
 *
 * The scalar forms are what the renderer calls; they return a number, so they cannot
 * allocate and the engine inlines them. `+gx` runs down-right and `+gy` down-left, so
 * `gx + gy` increases towards the viewer — which is exactly {@link depthOf}.
 */
export declare function gridToWorldX(gx: number, gy: number): number;

/** grid → world, y only. See {@link gridToWorldX}. */
export declare function gridToWorldY(gx: number, gy: number): number;

/** grid → world, both axes, written into `out`. Returns `out` so calls chain. */
export declare function gridToWorld(gx: number, gy: number, out: Vec2): Vec2;

/** world → grid, x only. Fractional; the exact inverse of {@link gridToWorldX}. */
export declare function worldToGridX(wx: number, wy: number): number;

/** world → grid, y only. */
export declare function worldToGridY(wx: number, wy: number): number;

/** world → grid, both axes, fractional. */
export declare function worldToGrid(wx: number, wy: number, out: Vec2): Vec2;

/**
 * The tile *containing* a world point.
 *
 * Floors both components. Never round: `Math.round` snaps to the nearest lattice **vertex**
 * and returns the wrong tile for three quarters of the area of every diamond. This is the
 * bug that makes a placement ghost jump a tile as the pointer crosses the middle of a tile.
 */
export declare function worldToTile(wx: number, wy: number, out: Tile): Tile;

/**
 * Painter's-algorithm scalar key: larger draws later, i.e. nearer the viewer.
 *
 * Taken at the footprint's **far** corner, so a 2×2 building sorts as if it stood on the
 * tile nearest the camera; without the extent terms a large building draws behind the small
 * one beside it. This key is a tie-break only — a scalar cannot express "beside", which is
 * why {@link Scene} sorts on footprints and falls back to this. See trap T2.
 */
export declare function depthOf(gx: number, gy: number, w?: number, d?: number): number;

/**
 * The four world-space corners of a tile diamond, clockwise from the north vertex, written
 * into `out` as `[x0,y0, x1,y1, x2,y2, x3,y3]`.
 *
 * World space, not screen: the camera applies afterwards, so a caller can cache ground
 * geometry across camera moves.
 */
export declare function tileDiamond(gx: number, gy: number, out: Float64Array): Float64Array;

/**
 * The world-space box of a `w × d` footprint standing `heightPx` world pixels tall.
 *
 * The top edge extends **upward by the height**, which is the only reason a tall building
 * whose base is below the viewport still draws its roof. A culler that forgets this pops
 * skylines in and out along the bottom edge of the screen (trap T8).
 *
 * @param heightPx Measured from the `z = 0` plane, **not** from the ground under it. On a
 *   heightfield pass `heightAt(field, gx, gy) + ownHeight`; there is deliberately no separate
 *   base parameter, because a box that starts at ground level and one that starts on a ridge
 *   need the same single number and two numbers invite passing one of them twice.
 */
export declare function footprintBounds(
  gx: number,
  gy: number,
  w: number,
  d: number,
  heightPx: number,
  out: Rect,
): Rect;

/** The world box of a whole rectangle of tiles. Convenience for {@link CameraOptions.bounds}. */
export declare function tileBounds(
  gx: number,
  gy: number,
  w: number,
  d: number,
  heightPx?: number,
): Rect;
```

### 3.2 `footprint` — grid rectangles

```ts
/** Does this footprint cover tile `(gx, gy)`? Half-open: the far edge is not covered. */
export declare function footprintContains(f: Footprint, gx: number, gy: number): boolean;

/** Do two footprints share any tile? The whole of a placement-legality check. */
export declare function footprintOverlaps(a: Footprint, b: Footprint): boolean;

/**
 * Call `fn` once per tile of a footprint, in row-major grid order.
 *
 * Takes a callback rather than returning tiles because the alternative — an array of
 * `{gx, gy}` — allocates `w × d` objects every time a player drags a placement ghost.
 */
export declare function forEachFootprintTile(
  f: Footprint,
  fn: (gx: number, gy: number) => void,
): void;

/**
 * How far from flat the ground under a footprint is, in world pixels: the largest corner
 * height minus the smallest, over the `(w+1) × (d+1)` corners the footprint stands on.
 *
 * Placement legality on a heightfield is `footprintFlatness(field, f) <= tolerance`, and it
 * is a *separate* question from occupancy — the demo's oil press needs flat riverside ground
 * and free ground, and conflating the two gives an error message that names the wrong reason.
 * Returns `0` for a footprint on level ground, so `<= 0` is the strict test.
 */
export declare function footprintFlatness(field: HeightField, f: Footprint): number;

/**
 * The height a footprint's base should be drawn at: the **maximum** corner height under it.
 *
 * The maximum rather than the mean, because a building resting on the mean of a slope has
 * one corner buried in the hill, and a floating corner reads as a bug where a buried one
 * reads as foundations.
 */
export declare function footprintBase(field: HeightField, f: Footprint): number;

/**
 * The screen point a footprint's label, bubble or confirm control should sit on: the centre
 * of the footprint raised by `heightPx`.
 *
 * The **centre**, not the origin corner — on a 3×3 those are most of a building apart, and
 * anchoring UI to the corner is what makes a confirm button appear to belong to the
 * building next door.
 */
export declare function footprintAnchor(
  camera: Camera,
  f: Footprint,
  heightPx: number,
  out: Vec2,
): Vec2;
```

### 3.3 `camera` — world ↔ screen

```ts
export interface CameraOptions {
  /** How far out you may pull. Below this the art stops being readable. Default `0.5`. */
  readonly minZoom?: number;
  /** How far in you may push. Default `4`. Vector art costs nothing to magnify. */
  readonly maxZoom?: number;
  /** Starting zoom. Default `1`. */
  readonly zoom?: number;
  /**
   * The world rectangle the player is allowed to look at. Default: ±1e4, i.e. effectively
   * unbounded — which is the right default for an infinite world and the wrong one for an
   * island, so a finite game should always pass this.
   */
  readonly bounds?: Readonly<Rect>;
  /**
   * The fraction of the viewport that must still contain `bounds` after any gesture.
   * Default `0.35`. Zero lets a player strand themselves on empty ground with nothing to
   * tap and no idea which way is back; one pins the map rigidly and feels stuck.
   */
  readonly keepVisible?: number;
}

/**
 * The camera: a pan, a zoom, and a clamp. **No DOM.** It is given a viewport size, never a
 * canvas, which is what lets the whole of `iso` run in Node and be tested without a shim.
 */
export interface Camera {
  /** World-space point at the centre of the viewport. Read freely; write via the methods. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /** Viewport size in CSS pixels. Device pixel ratio is `@lattice/draw`'s problem, not this one. */
  readonly viewW: number;
  readonly viewH: number;
  readonly bounds: Readonly<Rect>;

  /** Re-clamps. Call on every viewport change, including an orientation flip. */
  resize(viewW: number, viewH: number): void;

  /** Replace the reachable rectangle — e.g. when the island grows — and re-clamp at once. */
  setBounds(bounds: Readonly<Rect>): void;

  /** world → screen. Scalar forms for the per-sprite path. */
  toScreenX(wx: number): number;
  toScreenY(wy: number): number;
  toScreen(wx: number, wy: number, out: Vec2): Vec2;

  /** screen → world. The exact inverse of {@link Camera.toScreen}. */
  toWorldX(sx: number): number;
  toWorldY(sy: number): number;
  toWorld(sx: number, sy: number, out: Vec2): Vec2;

  /**
   * Pan by a screen-space delta — a drag.
   *
   * Divided by zoom internally so the world tracks the finger exactly. Multiplying instead
   * of dividing is the bug where a zoomed-in map slides at a crawl.
   */
  panByScreen(dxScreen: number, dyScreen: number): void;

  /**
   * Zoom, keeping the world point under `(sx, sy)` pinned to that screen pixel.
   *
   * @param factor Multiplicative step; `> 1` zooms in. A wheel notch is ~1.1, a pinch is
   *   the ratio of the current finger distance to the previous one.
   *
   * Origin-anchored zoom — the naive `zoom *= factor` — is the single most common reason a
   * tile-game camera feels broken: the thing you were looking at slides away as you zoom
   * towards it.
   */
  zoomAt(factor: number, sx: number, sy: number): void;

  /** Put a world point at the centre of the viewport immediately, then clamp. */
  centerOn(wx: number, wy: number): void;

  /** Put a tile at the centre. The form callers actually want after loading a save. */
  centerOnTile(gx: number, gy: number): void;

  /**
   * Re-apply the clamp. Every mutator calls it; this is exposed for the caller who changed
   * `bounds` through some other route and for tests asserting idempotence.
   */
  clamp(): void;

  /**
   * Is this world box worth drawing? A cheap AABB reject, generous by one tile so that
   * geometry which pokes outside its declared box does not flicker at the edge.
   */
  isVisible(minX: number, minY: number, maxX: number, maxY: number): boolean;

  /**
   * The conservative grid rectangle covering the viewport, for the terrain loop.
   *
   * Computed by projecting the four **screen** corners into grid space and taking the
   * min/max — because the visible region is a diamond in grid space, not a rectangle. A
   * loop derived from a grid-space rectangle silently misses the two side corners of the
   * screen (trap T9). The returned range over-covers by roughly 2×; that is the correct
   * trade against per-tile diamond intersection tests.
   *
   * @param marginTiles Extra tiles on every side. Pass the tallest thing on your map
   *   divided by `TILE_H`, or roofs will pop in along the top edge.
   */
  visibleTiles(out: TileRange, marginTiles?: number): TileRange;
}

/**
 * @throws RangeError if `viewW`/`viewH` are not finite and positive, or if
 *   `minZoom > maxZoom`. Errors name the caller's mistake:
 *   `createCamera: expected viewW to be a finite number > 0, got 0`.
 */
export declare function createCamera(
  viewW: number,
  viewH: number,
  options?: CameraOptions,
): Camera;

/**
 * grid → screen, including height. The composite the renderer calls most.
 *
 * `zPx` is world pixels of elevation and shifts screen **y** by `-zPx * zoom` and nothing
 * else — elevation is not a third projection axis. Two different `(grid, z)` pairs can land
 * on the same screen pixel, which is precisely why picking cannot be done by inverting this
 * function (trap T11).
 */
export declare function gridToScreen(
  camera: Camera,
  gx: number,
  gy: number,
  zPx: number,
  out: Vec2,
): Vec2;
```

### 3.4 `depth` — the Scene

```ts
/**
 * A frame's worth of sortable, pickable things.
 *
 * Holds ids and geometry in flat typed arrays — never your entities, never a draw closure.
 * The source game pushed `{ depth, x0, x1, y0, y1, draw: () => …}` per item per frame; that
 * is one object plus one closure per sprite per frame, and it is the largest avoidable
 * allocation in an isometric renderer.
 *
 * Build it, sort it, walk it forwards to paint, and let it walk itself backwards to pick.
 */
export declare class Scene {
  /** @param capacity Items to pre-allocate for. Grows by doubling; sized right it never grows. */
  constructor(capacity?: number);

  /** Drawable item count. Before {@link Scene.sort} this is everything added; after, only what survived culling. */
  readonly count: number;

  /** Drop every item, keeping the buffers. Call once at the top of the frame. */
  clear(): void;

  /**
   * Add a footprint-shaped item.
   *
   * @param id Whatever integer identifies this thing to you — an entity uid, an index. It
   *   comes back out of {@link Scene.idAt} and {@link Scene.pick} unchanged.
   * @param heightPx Height above the `z = 0` plane, for culling only — ground elevation plus
   *   the object's own height. Under-declare it and the roof pops; over-declare it and you
   *   draw a few items you did not need to.
   * @returns the item's insertion index, which is the sort's final tie-break.
   *
   * Elevation deliberately does **not** enter the sort. A lamp on the ridge and a lamp in the
   * valley sort by their ground footprints, because in a 2:1 projection what occludes what is
   * decided on the ground plane; adding `z` to the depth key draws the ridge lamp in front of
   * a gate that is plainly standing between it and the camera (trap T15).
   */
  add(id: number, gx: number, gy: number, w: number, d: number, heightPx: number): number;

  /**
   * Add a point-like item — a walker, a floating number's origin, a dropped resource.
   *
   * Given a small square footprint (`radius` tiles, default `0.15`) rather than zero extent,
   * so it can be strictly *beside* a wall instead of forever ambiguous with it. A true point
   * is incomparable with every footprint that shares either of its spans, which is how
   * pedestrians end up drawn through a wall at second-storey height.
   */
  addPoint(id: number, gx: number, gy: number, heightPx: number, radius?: number): number;

  /**
   * Cull against the camera, then order back-to-front. Allocation-free after warm-up.
   *
   * The order is the isometric occlusion rule, not a scalar comparison:
   *
   * > `a` is strictly behind `b` ⟺ `a` ends before `b` begins on **either** axis.
   *
   * That relation is a partial order — `a` behind `b`, `b` behind `c`, and `a` and `c`
   * incomparable is a legal, common layout — so it is resolved by a topological sort with a
   * depth-ordered ready set, never by handing a non-transitive comparator to `Array.sort`
   * (which is implementation-defined and can flicker between frames and between engines).
   * Genuinely incomparable pairs fall back to {@link depthOf}, then to insertion index.
   *
   * @param camera Omit to sort without culling — useful for tests and for offscreen passes.
   */
  sort(camera?: Camera): void;

  /** The id at sorted position `i`, `0 ≤ i < count`, back to front. Paint in this order. */
  idAt(i: number): number;

  /** The insertion index at sorted position `i`, if you kept parallel arrays of your own. */
  indexAt(i: number): number;

  /**
   * What the player tapped: the **last-painted** item whose `test` returns true, or `-1`.
   *
   * Walks the sorted array backwards, so it is the exact reverse of the paint order,
   * including the tie-break. That equivalence is the whole reason `pick` lives on `Scene`
   * and not in a free function: a tap on a rack that opened the headquarters beside it —
   * both at the same depth, the pick testing the one that had been painted *under* — was a
   * real, shipped, player-found bug (trap T3), and it is unreproducible with this shape.
   *
   * `test` is called with the item's id and the screen point. Hoist it out of the frame;
   * it is called at most `count` times and should not be allocated per tap.
   */
  pick(
    camera: Camera,
    sx: number,
    sy: number,
    test: (id: number, sx: number, sy: number) => boolean,
  ): number;
}
```

### 3.5 `tilemap` — storage

```ts
/**
 * Anything that can answer "what is on this tile" with a number.
 *
 * Pathfinding, culling and placement take this interface and nothing more, so a purely
 * procedural infinite world implements it with a function and pays for no storage at all.
 */
export interface TileSource {
  /** Value at `(gx, gy)`. Out of bounds returns the source's out-of-bounds value, never throws. */
  get(gx: number, gy: number): number;
  /** Is this tile inside the map's defined region? Always true for infinite sources. */
  has(gx: number, gy: number): boolean;
}

export interface MutableTileSource extends TileSource {
  /** @throws RangeError out of bounds. Reads are forgiving; writes are not — a write outside the map is always a bug. */
  set(gx: number, gy: number, value: number): void;
  fill(value: number): void;
  /** Fill from a function — a seeded heightfield, a river mask. Saves every game the same loop. */
  fillFrom(get: (gx: number, gy: number) => number): void;
  /**
   * Bumped on every mutation that changes a value.
   *
   * This is the whole of the "cheap recompute" answer (see §4.9). A caller holding a path, a
   * flow field or a cached arc length compares the version it pathed against; when the
   * rockfall is cleared, one `set` bumps it, everything downstream recomputes exactly once,
   * and nothing needs to be told what changed. Comparing map *contents* to detect a change
   * costs more than replanning.
   */
  readonly version: number;
}

export interface TileGridOptions {
  /** Grid origin in tiles. Default `0, 0`. Lets an island sit at negative coordinates. */
  readonly originGx?: number;
  readonly originGy?: number;
  /** Storage width per tile. Default `8`. Pick the smallest that holds your value set. */
  readonly bits?: 8 | 16 | 32;
  /** Initial value everywhere. Default `0`. */
  readonly fill?: number;
  /** What {@link TileSource.get} returns outside the grid. Default `0`. */
  readonly outOfBounds?: number;
}

/**
 * A fixed rectangle of tiles in one flat typed array. The island.
 *
 * One array per *layer*, not one struct per tile: a game needing terrain, buildings and
 * movement cost makes three `TileGrid`s. Structure-of-arrays is why a pathfinder can scan a
 * cost layer without dragging terrain colours through the cache, and why `@lattice/persist`
 * can save the whole map as one buffer.
 */
export declare class TileGrid implements MutableTileSource {
  constructor(w: number, h: number, options?: TileGridOptions);
  readonly w: number;
  readonly h: number;
  readonly originGx: number;
  readonly originGy: number;
  /** The backing store, exposed on purpose so saves and workers can take it whole. */
  readonly data: Uint8Array | Uint16Array | Uint32Array;
  readonly version: number;
  get(gx: number, gy: number): number;
  has(gx: number, gy: number): boolean;
  set(gx: number, gy: number, value: number): void;
  fill(value: number): void;
  fillFrom(get: (gx: number, gy: number) => number): void;
  /** Iterate a sub-rectangle, clipped to the grid. The terrain draw loop. */
  forEach(range: Readonly<TileRange>, fn: (gx: number, gy: number, value: number) => void): void;
}

export interface ChunkGridOptions {
  /** Chunk edge in tiles. Default `32` — 1 KiB per 8-bit chunk, one cache-friendly page. */
  readonly chunk?: number;
  readonly bits?: 8 | 16 | 32;
  /** Value of every tile in a chunk that has never been written. Default `0`. */
  readonly defaultValue?: number;
}

/**
 * An unbounded tile map as a sparse map of fixed chunks. The infinite world.
 *
 * Same interface as {@link TileGrid}, so pathfinding and placement cannot tell them apart.
 * Chunks are allocated on first **write**; reading a never-touched region is free and
 * returns `defaultValue`, which is what stops a camera pan from committing a terabyte.
 */
export declare class ChunkGrid implements MutableTileSource {
  constructor(options?: ChunkGridOptions);
  readonly chunk: number;
  /** Number of allocated chunks. The number to watch in a memory bug. */
  readonly chunkCount: number;
  readonly version: number;
  get(gx: number, gy: number): number;
  has(gx: number, gy: number): boolean;
  set(gx: number, gy: number, value: number): void;
  /** @throws RangeError — an infinite map cannot be filled. Use {@link ChunkGridOptions.defaultValue}. */
  fill(value: number): void;
  /** @throws RangeError for the same reason as {@link ChunkGrid.fill}. Wrap the function in {@link tileSourceOf} instead. */
  fillFrom(get: (gx: number, gy: number) => number): void;
  /** Visit every allocated chunk, for saving or for a debug overlay. */
  forEachChunk(
    fn: (chunkGx: number, chunkGy: number, data: Uint8Array | Uint16Array | Uint32Array) => void,
  ): void;
}

/**
 * A read-only tile source backed by a function — procedural terrain from `@lattice/core`'s
 * noise, or a view that combines two grids.
 *
 * The third storage strategy, and it costs one export rather than a class: callers who want
 * generate-on-demand *with* caching wrap this in a {@link ChunkGrid} themselves.
 */
export declare function tileSourceOf(get: (gx: number, gy: number) => number): TileSource;
```

### 3.6 `hittest` — screen → what

```ts
/** The tile under a screen point. Floors, like {@link worldToTile}. */
export declare function pickTile(camera: Camera, sx: number, sy: number, out: Tile): Tile;

/**
 * A rectangular volume in a building's local space: offsets and extents in **tiles**,
 * elevation and height in **world pixels**.
 *
 * The units differ because height has no tile — a storey is an art proportion and belongs to
 * `@lattice/draw`, not here. Mixing them up produces buildings a hundred tiles tall, which is
 * at least an obvious failure.
 */
export interface Volume {
  readonly ox: number;
  readonly oy: number;
  readonly w: number;
  readonly d: number;
  readonly zPx: number;
  readonly hPx: number;
}

/**
 * The screen-space silhouette of one box: six points as `[x0,y0, … x5,y5]` written into `out`.
 *
 * Six, not eight: in a 2:1 projection a box's outline is north-top, east-top, east-base,
 * south-base, west-base, west-top — the seventh and eighth corners always project inside
 * them. The order matches the order `@lattice/draw` strokes a solid in, and that agreement is
 * a **cross-package contract**: if draw ever paints a different outline from the one this
 * returns, hit-testing and pixels diverge and no test in either package notices.
 *
 * @param out Length ≥ 12. @throws RangeError otherwise.
 */
export declare function boxSilhouette(
  camera: Camera,
  gx: number,
  gy: number,
  volume: Volume,
  out: Float64Array,
): Float64Array;

/** Even-odd ray cast against `count` points packed as x,y pairs. Boundary-exact is not interesting: a pixel either side of an outline is the same tap. */
export declare function pointInPolygon(
  sx: number,
  sy: number,
  poly: Float64Array,
  count: number,
): boolean;

/**
 * Is a screen point inside the tile diamond of `(gx, gy)`? Two half-plane tests, no polygon.
 *
 * For ground-level targets — a selected tile, a road segment — where the footprint *is* the
 * thing, and as the flat fallback behind silhouette picking (trap T4).
 */
export declare function pointInTile(camera: Camera, sx: number, sy: number, gx: number, gy: number): boolean;
```

### 3.7 `path` — getting there

```ts
/**
 * Movement cost of entering a tile: a positive integer, or `0` for impassable.
 *
 * Integers, not floats, and this is not a style choice. A* orders its frontier by summed
 * cost; float summation is associative only by luck, so two engines can pop equal-`f` nodes
 * in a different order and produce different — both optimal, both different — paths. A
 * replay that diverges by one tile diverges by everything. Integers make the order total
 * and the path byte-identical everywhere.
 */
export type TileCost = (gx: number, gy: number) => number;

/** Cost of an orthogonal step, in the units {@link TileCost} multiplies. */
export declare const STEP_ORTHO: 10;
/** Cost of a diagonal step: 14 ≈ 10√2. The integer octile metric. */
export declare const STEP_DIAG: 14;

/** Unit offsets for direction codes `1..8`; index `0` is `(0, 0)` and means "no route". */
export declare const DIR_DX: readonly number[];
export declare const DIR_DY: readonly number[];

export interface PathOptions {
  /** Allow 8-way movement. Default `true`. */
  readonly diagonals?: boolean;
  /**
   * Allow a diagonal step when one of the two shared orthogonal neighbours is blocked.
   * Default `false`, and leave it false: `true` walks agents through the corner where two
   * walls meet, which looks like clipping through the building (trap T12).
   */
  readonly cutCorners?: boolean;
  /**
   * Hard ceiling on expanded nodes. Default `20000`. Not a performance knob — a
   * **determinism and liveness** one: on an unbounded {@link ChunkGrid} an unreachable goal
   * otherwise searches until the tab dies, and the ceiling must be a constant rather than a
   * time limit so the same query gives the same answer on a slow phone.
   */
  readonly maxNodes?: number;
  /** Confine the search to a tile rectangle. Cheaper than making the cost function say so. */
  readonly bounds?: Readonly<TileRange>;
}

/** A route, stored as flat integers. `length` is tile count including both endpoints. */
export declare class Path {
  constructor(capacity?: number);
  readonly length: number;
  xAt(i: number): number;
  yAt(i: number): number;
  clear(): void;
}

/**
 * A* over a tile source. Owns its open/closed buffers so a repeated query allocates nothing.
 *
 * One instance per *caller*, not one per agent, and not a module singleton — module-level
 * mutable state is banned by the constitution and would make two interleaved searches
 * corrupt each other.
 */
export declare class PathFinder {
  constructor(capacityTiles?: number);
  /**
   * @returns `true` if `out` now holds a route from start to goal. `false` means unreachable
   *   **or** the node ceiling was hit — deliberately not distinguished, because a caller
   *   that behaves differently in the two cases has written a bug that only appears on
   *   large maps.
   */
  find(
    cost: TileCost,
    fromGx: number,
    fromGy: number,
    toGx: number,
    toGy: number,
    out: Path,
    options?: PathOptions,
  ): boolean;
}

/**
 * A direction per tile, pointing downhill towards the nearest goal. The answer to "fifty
 * walkers, one depot".
 *
 * A* is `O(agents × path)`; a flow field is one Dijkstra sweep over the region, shared by
 * every agent, rebuilt only when the map changes. At fifty agents it is roughly fifty times
 * cheaper, it handles *many* goals for free (a walker heads for the nearest of six
 * warehouses at no extra cost, which A* cannot do without six searches), and agents that
 * spawn mid-frame get a route with no search at all.
 *
 * Bounded to a rectangle by construction: an infinite flow field is not a thing.
 */
export declare class FlowField {
  constructor(gx0: number, gy0: number, w: number, h: number);
  readonly range: Readonly<TileRange>;
  /** Forget the previous goals. Cheap; the buffers stay. */
  clearGoals(): void;
  /** Add a destination. Tiles outside {@link FlowField.range} are ignored, not an error — a warehouse can legitimately sit off the edge of the field. */
  addGoal(gx: number, gy: number): void;
  /** Integrate. Deterministic: a uniform-cost bucket queue, ties broken by tile index. */
  build(cost: TileCost, options?: PathOptions): void;
  /** Direction code `1..8` to step next, or `0` for "no route from here". */
  dirAt(gx: number, gy: number): number;
  /** Accumulated cost to the nearest goal in {@link STEP_ORTHO} units, or `-1` if unreachable. */
  costAt(gx: number, gy: number): number;
  /** Sugar over {@link FlowField.dirAt}. `false` when there is no route, leaving `out` untouched. */
  step(gx: number, gy: number, out: Tile): boolean;
}
```

**Reachability comes free.** A base-builder must answer "have I just walled my walkers in?", and
that is `field.dirAt(x, y) === 0` after the wall is placed, or `costAt < 0`. No flood-fill export,
no connected-component API — the flow field the game already keeps is the connectivity oracle.

---

## 4. What is deliberately absent

### 4.1 A runtime tile size

`TILE_W`/`TILE_H` are constants, and `createCamera` takes no tile size. The argument, since a
future agent will want to add it back:

- **Any uniform tile size is exactly a camera zoom.** A game that wants 32×16 tiles runs the
  same lattice at `zoom = 0.5`; because 64 and 32 are even, every grid vertex still lands on
  an integer screen pixel at 0.25, 0.5, 2 and 4. Nothing is lost but the label.
- **Parameterising infects every downstream signature.** `gridToWorldX(gx, gy)` becomes
  `proj.gridToWorldX(gx, gy)`, and then every function in `draw`, `input` and `ui` that
  touches a coordinate needs a projection handed to it. That is a wide, permanent tax on four
  packages to serve a need one camera field already serves.
- **The hot path.** Two constant multiplies become two property loads and two multiplies,
  through an object the engine may not keep monomorphic, on the innermost line of the frame.
- **Constants make `depthOf` size-free.** `gx + gy` is the depth key at any tile size, and the
  moment size is dynamic somebody will "helpfully" scale it.

The escape hatch for the one legitimate case — a different **aspect** ratio, e.g. 2:1.5 — is
that it is a different projection, and hence a different package. 2:1 is what makes the
inverse exact, the diamond test two half-planes, and the depth key a sum.

### 4.2 Height as a third grid axis

No `gz`. No multi-storey maps, bridges, or tiles stacked in a column. Elevation exists only as
a world-pixel `zPx` that shifts screen y. True 3D occlusion in a 2:1 projection is a different
algorithm with a different data structure, and every shipped game that added floors did it by
drawing one `Scene` per floor in order. Do that; the API already supports it.

### 4.3 Anything that draws

No canvas, no colour, no sprite, no `CanvasRenderingContext2D`, no `devicePixelRatio`.
`tileDiamond` and `boxSilhouette` return **geometry**. The package must run unchanged in Node,
because the depth sort and the pathfinder are the two things most worth testing and neither
should need a DOM to test. `LEVEL_H = 26` — the storey height that makes buildings read as
cartoon-isometric rather than as cubes — is an art proportion and belongs to `@lattice/draw`.

### 4.4 Camera feel

No inertia, no drag handling, no pinch, no edge-scroll, no keyboard pan, no smooth follow, no
screen shake. `Camera` is a transform plus a clamp, and every method is a pure function of its
arguments and current state. Feel needs a clock and a pointer, and both live upstream:
`@lattice/input`'s `cameracontrol` owns it and drives this camera through `panByScreen` and
`zoomAt`. A camera that eases itself cannot be stepped deterministically in a replay.

### 4.5 Continuous movement, steering and agent avoidance

`path` returns tiles. It does not interpolate along them, does not smooth corners, does not
stop fifty walkers piling into one doorway. Local avoidance is a simulation behaviour over
time, not a grid query, and putting it here would drag a clock into an otherwise timeless
package. This is a real gap — see §7.

### 4.6 Entities, components, or any scene graph

`Scene` stores integers. It has no `update`, no parent/child, no transform hierarchy, and it is
rebuilt from scratch each frame — which at a few hundred drawables costs less than maintaining
a retained graph and removes the entire class of "the renderer and the state disagree" bug.

### 4.7 Serialisation

No `toJSON`, no save format, no versioning. `TileGrid.data` is public so `@lattice/persist` can
take the buffer whole; owning the format is persist's job, and a map that serialises itself will
grow a second, incompatible migration chain.

### 4.8 Fog of war, line of sight, and grid ray-marching

Not in v1. Each is a genuine feature with genuine design questions (does a wall block sight from
its centre or its edge?), and none has a caller yet. Listed here so that adding one is a decision
rather than a drift.

---

## 5. Invariants a reviewer can test

| # | Invariant | An obvious failing case |
|---|---|---|
| I1 | `worldToGrid(gridToWorld(g))` returns `g` exactly for integer grid points, and within `1e-9` for fractional ones. | Round-trip a fractional point and get a drift of `0.5` — someone used `round` in the inverse. |
| I2 | For every tile and every one of the 8 sample points at fractions `0.25`/`0.5`/`0.75` inside its diamond, `worldToTile` returns that tile. | Sample the north quarter of `(3,3)` and get `(2,3)` — the floor became a round (trap T1). |
| I3 | `toWorld(toScreen(w))` round-trips within `1e-9` at any pan and any zoom in `[minZoom, maxZoom]`. | Fails only at non-unit zoom — the viewport half-offset was applied before the scale in one direction and after it in the other. |
| I4 | With `bounds` far larger than the viewport, after `zoomAt(f, sx, sy)` the world point that was under `(sx, sy)` is still under it, within `1e-9`, for `f` in `{0.5, 1.1, 2}`. | The point drifts towards the screen centre: origin-anchored zoom (trap T6). |
| I5 | With `bounds` **smaller** than the viewport in either axis, the camera centre equals the bounds centre in that axis, and `clamp(); clamp()` changes nothing. | The centre oscillates between two values across repeated pans, because `min > max` was fed to a clamp (trap T7). |
| I6 | `scene.sort()` output is a permutation of the surviving inputs: every id appears exactly once, and `count` equals the number of items whose box passed `isVisible`. | An item vanishes, or is painted twice — the topological pass emitted from a stale ready set. |
| I7 | If footprint `a` ends before `b` begins on either axis, then `a` precedes `b` in the sorted output — for every pair in the scene, checked exhaustively on a random-but-seeded layout. | A tree is painted after the wall it stands behind. |
| I8 | `sort()` is deterministic and terminating: the same adds in the same order give the same output, on any engine, and a deliberately constructed cyclic layout terminates in bounded time rather than hanging. | The suite passes on Node and fails on Safari: a non-transitive comparator was handed to `Array.sort`. |
| I9 | For two items at equal depth whose silhouettes overlap, `pick` returns the one that `idAt(count-1 … 0)` reaches first — i.e. the one painted last. | The tap opens the building behind (trap T3). |
| I10 | `TileGrid.get` outside the grid returns `outOfBounds` and never throws; `TileGrid.set` outside the grid throws a `RangeError` naming the coordinate and the bounds. | A pathfinder scanning a border tile throws mid-frame. |
| I11 | `PathFinder.find` on a uniform-cost open grid returns a path whose summed cost equals the octile distance `STEP_DIAG·min(dx,dy) + STEP_ORTHO·|dx−dy|`. | The path is optimal-looking but longer: the heuristic overestimates, or diagonals cost 10. |
| I12 | Every consecutive pair in a returned `Path` differs by at most 1 on each axis, and with `cutCorners: false` no diagonal step has both shared orthogonal neighbours impassable. | An agent walks through the corner where two walls meet. |
| I13 | The same `find` call with the same cost function returns a byte-identical `Path` across runs and engines. | Two replays of one seed diverge after the first junction — float costs, or a heap with an unspecified tie-break. |
| I14 | Following `FlowField.step` from any tile with `costAt ≥ 0` reaches a goal in at most `costAt / STEP_ORTHO` steps and never revisits a tile. | Two adjacent tiles point at each other and an agent vibrates in place for ever. |
| I15 | A warm frame — `clear`, 400 `add`s, `sort`, 400 `idAt`s, one `pick`, one `find` — allocates zero bytes, asserted in `*.bench.ts` against a heap-delta measurement. | The number climbs the day someone returns `{x, y}` from a conversion. |
| I16 | No file in `src/` references `window`, `document`, `Canvas`, `Math.random`, `Date.now` or `performance.now`. Enforced by `npm run lint`. | The camera grew a `resizeToCanvas` helper. |

---

## 6. The traps

Fourteen years of other people's isometric bugs, most of them found by players of the game this
kit was extracted from. A naive implementation gets every one of these wrong.

**T1 — Floor a tile lookup, never round.** `Math.round` snaps to the nearest lattice *vertex*
and picks the wrong tile over three quarters of the area of every diamond. *(PLAYBOOK trap 5.)*

**T2 — A scalar depth cannot express "beside".** Buildings sorted on the sum of their far
corner while pedestrians sorted on `x + y`; the two numbers are not comparable, so a pedestrian
standing well down the map but far to the left of the headquarters got a larger key than the
building and was drawn straight through its wall at second-storey height. Player pass 3
reproduced it twice. The relation that is actually true is *a ends before b begins on either
axis*, and it is a partial order — which is why `Scene.sort` is a topological sort with depth as
a tie-break and not a comparator. Handing a non-transitive comparator to `Array.sort` gives an
implementation-defined result that differs between engines and can flicker between frames.

**T3 — Picking must be the exact reverse of painting, tie-break included.** The renderer draws
ascending with a stable sort, so on equal depth the item added *earlier* is painted first and
ends up underneath. A picker that walks descending by depth but forgets to also walk descending
by insertion index resolves a tap on a rack to the headquarters beside it — both at depth 14,
found in player pass 4. This is why `pick` is a method on the sorted `Scene`: it walks the same
array backwards and cannot disagree.

**T4 — Hit-test the silhouette, not the ground tile.** A building is drawn standing *up* from
its footprint, so the pixels showing its body sit over the tile *behind* it. Resolving a tap to
the tile under the cursor meant tapping the middle of a rack did nothing, and tapping high on
one opened whatever stood further back — a hard stop in player pass 2. Test the shape the
player can see, front to back, and keep the footprint-tile pass as a *fallback* for things so
flat that their silhouette is barely taller than the ground (a solar array is half a unit high,
and someone aiming at one is really aiming at the ground it covers).

**T5 — Never cache hit boxes during the draw pass.** An earlier version recorded tap targets
while painting, so any frame the renderer did not run — a backgrounded tab, a throttled
`requestAnimationFrame`, a paused loop — left the game visibly showing bubbles that could not be
tapped. Input must never be a side effect of painting: `pick`, `pickTile` and `footprintAnchor`
all recompute from state and camera, every time. *(This is the kit.json invariant "hit-testing is
computed from state and camera, never cached during a draw pass".)*

**T6 — Origin-anchored zoom.** Pinching or wheeling must zoom towards *what the player is
looking at*. The correct implementation is three lines — world point before, apply zoom, world
point after, add the difference — and its absence is the single most common reason a tile-game
camera feels broken.

**T7 — The clamp inverts on maps smaller than the viewport.** The camera centre is confined to
the bounds grown by whatever half-viewport remains after `keepVisible`. When the map is smaller
than the viewport in an axis that range inverts, `min > max`, and a naive `clamp(v, min, max)`
returns whichever endpoint it tests last — so the camera jitters between two positions on every
pan. Detect the inversion and pin to the bounds centre instead.

**T8 — Cull with the height included.** A tall building whose *base* is below the viewport still
shows its roof. `footprintBounds` extends `minY` upward by the height for exactly this reason,
and `isVisible` is generous by a tile on top of that. Cull on the footprint alone and skylines
pop in and out along the bottom edge of the screen.

**T9 — The visible region is a diamond in grid space, not a rectangle.** Deriving the terrain
loop from a grid-space rectangle misses the two side corners of the screen and leaves triangular
holes of unpainted ground when the camera is off-axis. Project the four *screen* corners into
grid space and take the min/max — `Camera.visibleTiles` does this and over-covers by about 2×,
which is far cheaper than being clever.

**T10 — `!` is a place where the compiler was told to stop helping.** In the source game
`runs[0]!.push(…)` on an array that was empty for two of four biomes threw inside `init`, the
constructor never returned, and those players got a black screen with no HUD. Under
`noUncheckedIndexedAccess` every typed-array and every `after[i]` index in the sorter will tempt
someone into a `!`. Bounds-check and throw a named error instead; the type was the bug report.
*(PLAYBOOK trap 14.)*

**T11 — Elevation is not a third projection axis, and the projection is not invertible.** `zPx`
shifts screen y by `-zPx * zoom` and does nothing else, which means "a point raised 32 pixels"
and "a point one tile further north on the ground" are *the same screen pixel*. Screen → (grid,
z) is one equation short of solvable. That is why picking walks the scene testing silhouettes
rather than inverting the camera, and it is the same confusion that makes a ground-plane
primitive used for a window paint a horizontal sliver hovering in mid-air. *(PLAYBOOK trap 4 is
the drawing half of this; the geometry half lives here.)*

**T12 — Diagonal corner cutting, and float path costs.** A diagonal step between two blocked
orthogonal neighbours walks the agent through the join of two walls. And `Math.SQRT2` summation
is associative only by luck: two engines can pop equal-`f` nodes in different orders and return
different-but-equally-optimal paths, which is a replay divergence. Integer 10/14 costs, and a
binary heap whose tie-break is the insertion counter, not "whatever the heap does".

**T13 — Round the camera translation once, not each sprite.** Sub-pixel camera positions make
vector art shimmer. The fix is to round the *camera translate* to whole device pixels once per
frame; rounding each sprite's screen position independently makes sprites jitter relative to
each other, which is worse than the shimmer. The rounding happens in `@lattice/draw`, where the
device pixel ratio lives — this package deliberately hands out unrounded floats so that the
choice is available.

**T14 — Sort scenery and buildings in one list.** Two separately sorted lists make trees pop
through walls, no matter how correct each list is on its own. `Scene` takes everything —
buildings, scenery, walkers, ghosts — and that is why it takes an opaque `id` rather than a
typed entity. *(PLAYBOOK trap 6.)*

---

## 7. Notes for the orchestrator: gaps outside this package

These are things a game developer would otherwise hand-roll on top of Lattice. None of them is
mine to build.

**`@lattice/core` (A1) — three shapes I depend on and cannot declare myself.**
1. **`Vec2` must have mutable fields.** `interface Vec2 { x: number; y: number }`. An
   out-parameter API cannot be handed a `Readonly<Vec2>`, and if core exports the readonly form
   the whole kit ends up with two point types. Core should export the mutable interface and a
   `freeze`-free convention, not `readonly` fields.
2. **A deterministic binary heap / priority queue with an explicit insertion tie-break.** A* needs
   one, `sim` will want one for its scheduler, and it is core-shaped, not iso-shaped. If core
   does not export it, `iso` will have to, and then two packages own a heap.
3. **`clamp`, `lerp`, and an integer `hash2(x, y)`** for chunk keys. I have assumed all three
   exist in `core/math`; if they do not, say so and I will fold them into the RFC as internals.

**`@lattice/draw` (A3) — the silhouette contract.** `boxSilhouette` returns the six-point outline
in the order north-top, east-top, east-base, south-base, west-base, west-top. `draw`'s solid kit
must stroke a box in that same order, or hit-testing and pixels diverge with no test in either
package noticing. This needs to be one shared assertion, and it is the only genuine coupling
between the two packages. `draw` also owns the storey height (`LEVEL_H ≈ 26`, deliberately not
32 — a one-tile-tall storey reads as a cube and cubes read as programmer art) and the
whole-device-pixel rounding of the camera translate (T13).

**`@lattice/input` (A5) — the camera controller.** Drag, inertia, pinch, edge-scroll and keyboard
pan belong there and must drive this camera only through `panByScreen`, `zoomAt` and
`centerOn` — never by assigning `zoom`, which would skip the clamp and the pointer anchor.
Input's tap/drag discrimination is what decides whether `Scene.pick` is called at all.

**Nobody owns walker steering.** `iso` returns tiles; something must interpolate along a path,
smooth the corners, and stop fifty agents from piling into one doorway. This is the largest gap
in the kit as scoped: a base-builder demo will hand-roll it. It needs a clock, so it is `loop`-
or `sim`-shaped; my suggestion is a small `sim/steer` module taking a `Path` or a `FlowField` and
a dt, because it is behaviour over time rather than geometry.

**Nobody owns flow-field invalidation.** Rebuilding a `FlowField` after a wall is placed is a
Dijkstra sweep and must not happen inside the frame that placed the wall. `@lattice/loop`'s
scheduler should own "do this expensive thing on the next idle tick, coalescing duplicates".

**`@lattice/persist` (A7) — map serialisation.** `TileGrid.data` and `ChunkGrid.forEachChunk`
exist so persist can take the buffers whole. Persist should own the version and the migration;
a base-64 or delta encoding of a chunk grid is worth having as a first-class adapter.
