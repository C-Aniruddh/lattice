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
const order = new DepthSorter(512);                          // allocated once, reused for ever
for (const b of buildings) order.add(b.gx, b.gy, b.w, b.d, b.heightPx);
order.sort(camera);                                          // culls, then orders back-to-front
for (let i = 0; i < order.count; i++) paint(buildings[order.indexAt(i)]);
```

And the sixth line, on tap — the one that has to be the exact reverse of the fifth:

```ts
const hit = pickSorted(order, (i) => silhouetteHit(buildings[i], pointerX, pointerY));
```

Everything below exists to make those six lines true. Three consequences fall straight out of
them and drive the whole design:

| the example says | so the API must |
|---|---|
| `order` is created once, outside the frame | nothing per-frame allocates: no `{x,y}` returns, no closures per item, no arrays per sort |
| `order.add` takes a **footprint**, and gives back an **index** | `iso` never sees your entities, only rectangles. `buildings[...]` is the caller's array and stays the caller's |
| `pickSorted` consumes the same `order` that painted | the "picking is reverse paint order" rule is structural, not a comment someone must remember |

### The other example, which is the demo's whole crowd

`docs/rfc/demo.md` ranks this the kit's most-needed gap, and it is right to. Fifty walkers,
no per-walker state, nothing allocated, fully deterministic, replayable from `t`:

```ts
for (let i = 0; i < n; i++) {
  pathSample(road, (t * speed + (i / n) * road.arcLength) % road.arcLength, here);
  order.addPoint(here.gx, here.gy, heightAt(valley, here.gx, here.gy));
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

### The allocation contract, which is not negotiable

> **Routed from `@lattice/draw` (A3), as a blocking requirement: no function in this package
> returns a point.** Confirmed — it never did, and this block exists so that no builder has to
> read three sections to be sure. `draw` has packed colors into `uint32` and put polygon
> corners into a scratch `Float64Array`; a projection returning `{ x, y }` would put the source
> game's largest per-frame allocation straight back, and `draw` could not satisfy constitution
> rule 7 at all.

Three shapes, and every hot-path function in this document is one of them:

| shape | signature | for |
|---|---|---|
| **scalar** | `toScreenX(wx): number` | the innermost loop. Returns a number, so it cannot allocate and the engine inlines it. **This is the form that writes into a `Float64Array`:** `pen[i] = cam.toScreenX(wx); pen[i+1] = cam.toScreenY(wy);` — no intermediate object at any point |
| **out-parameter** | `gridToScreen(cam, gx, gy, zPx, out): Vec2` | everywhere a point is genuinely wanted as a point. Writes into a caller-owned `Vec2` and returns it so calls chain |
| **buffer** | `boxSilhouette(cam, gx, gy, vol, out: Float64Array)` | geometry with more than one point. Writes `n` pairs into the caller's array at once |

Note that `Camera.toScreenX` takes only `wx` and `toScreenY` only `wy`: screen x depends on
world x alone. A caller projecting eight box corners that share four x values can project four
numbers instead of eight.

**The convergence `draw` points at is real and deliberate.** Projection into an out-parameter
and `pathSample` into an out-parameter are the same discipline, and they came out the same
shape on purpose: both write a two-component value into a caller-owned `Vec2` and return it.
If a reviewer finds a function here that returns a fresh point, it is a defect, not a variant.

### 3.0 Shared types

`Vec2` and `ReadonlyVec2` come from `@lattice/core`, which delivered them in exactly the shape
this package and `ui` asked for: `Vec2` assignable to `ReadonlyVec2` and not the reverse, so
there is one type callers declare and one that appears only in signatures, and no
`MutableVec2` anywhere in the kit. `iso` imports them and re-exports neither — one definition,
one owner. They are reproduced here only so this document type-checks on its own:

```ts
// from @lattice/core — not redeclared by iso.
export interface Vec2 { x: number; y: number; }
export interface ReadonlyVec2 { readonly x: number; readonly y: number; }

// For its own structural types — Rect, GridPoint, Anchor — iso writes `Readonly<T>` rather
// than declaring a second named interface. For plain field-only shapes the two are identical
// to the compiler, and the mapped form costs no exports. Core's named `ReadonlyVec2` is used
// wherever core's type is, because there the definition is core's to make.

/**
 * A position in **grid** space, fractional or integer. Mutable, for the same reason as
 * {@link Vec2}. *(Named by `@lattice/input`, which needs it on every event it emits.)*
 *
 * The fields are `gx`/`gy`, not `x`/`y`, and that is the whole point: invariant I‑zero of this
 * package is that the three spaces are never conflated, and a grid position that arrives in a
 * `Vec2` can be handed to a world-space function with nothing to stop it. Every function here
 * that produces a grid position — {@link worldToGrid}, {@link pathSample}, {@link screenToTile}
 * — writes into one of these, so the type system does the checking that comments cannot.
 */
export interface GridPoint {
  gx: number;
  gy: number;
}

/**
 * A {@link GridPoint} whose components are whole numbers: a tile address.
 *
 * The same shape, deliberately — a separate nominal type would force a conversion at every
 * boundary and buy nothing the name does not already say. Use `Tile` in a signature to tell
 * the caller the value is floored, and `GridPoint` where fractions are meaningful.
 */
export type Tile = GridPoint;

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

/*
 * There is deliberately no `LEVEL_H` here. It is `@lattice/draw`'s, and §4.3 has the
 * argument — including the two rulings that went the other way first.
 */

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

/** world → grid, both axes, fractional. Writes a {@link GridPoint}, not a {@link Vec2}. */
export declare function worldToGrid(wx: number, wy: number, out: GridPoint): GridPoint;

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
 * why {@link DepthSorter} sorts on footprints and falls back to this. See trap T2.
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
 * The {@link Anchor} a footprint's label, ring, bubble or confirm control should hang from:
 * the center of the footprint, raised by `heightPx`.
 *
 * The **center**, not the origin corner — on a 3×3 those are most of a building apart, and
 * anchoring UI to the corner is what makes a confirm button appear to belong to the building
 * next door.
 *
 * Note that it produces an anchor, not a screen point: the attachment point is a property of
 * the *building*, so it is computed once when the building is placed, not sixty times a
 * second against a camera that has not moved.
 */
export declare function footprintAnchor(f: Footprint, heightPx: number, out: Anchor): Anchor;
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
  /**
   * World-space point at the center of the viewport, and the scale. **Read-only, and not
   * merely by convention.**
   *
   * *(Routed from `@lattice/input`, and they are right.)* Every one of these is a getter over
   * private state on the object `createCamera` returns; there is no setter and no public
   * field to assign. That is why this package exports a `Camera` **interface** and a factory
   * rather than a class — a class with public fields documents the rule, and an interface
   * over private state removes the mistake.
   *
   * The argument is about testability, not tidiness. `zoomAt` exists to keep the world point
   * under the pointer pinned (I4); if any code path can write `camera.zoom = 2` it skips the
   * anchoring, and **no test can catch what it cannot observe** — the invariant holds in the
   * suite and breaks in the game. Making the assignment unavailable turns a documented rule
   * into an unrepresentable state.
   */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  /**
   * Viewport size in **CSS pixels** — never device pixels, never a canvas.
   *
   * Requested by `@lattice/input` and `@lattice/draw` both. A pointer event arrives in CSS
   * pixels, so a camera that worked in device pixels would make every input path multiply by
   * a ratio this package must not name; `devicePixelRatio` is `draw`'s business at the point
   * it sets a transform, and nowhere else.
   */
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

  /**
   * Where a world x sits **across** the viewport: `-1` at the left edge, `0` at the center,
   * `+1` at the right, and it keeps going beyond them rather than clamping.
   *
   * The third member of the projection family, and it exists because `@lattice/audio` needs
   * it and may not depend on this package: a sound's stereo pan is `normalizedX` of the
   * thing that made it. Unclamped on purpose — how far a pan is allowed to go is a mixing
   * policy (`audio` caps at ±0.6, because full-width panning on headphones is unpleasant and
   * on a phone speaker is inaudible), and a policy does not belong in a projection.
   *
   * There is no `normalizedY`. Stereo has one axis, and a vertical pan is not a thing.
   */
  normalizedX(wx: number): number;

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

  /** Put a world point at the center of the viewport immediately, then clamp. */
  centerOn(wx: number, wy: number): void;

  /** Put a tile at the center. The form callers actually want after loading a save. */
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
   * The conservative **grid** rectangle covering the viewport — the terrain loop's bounds.
   * *(Named by `@lattice/draw`, which asked for it; it is the culling entry point.)*
   *
   * Computed by projecting the four **screen** corners into grid space and taking the
   * min/max — because the visible region is a diamond in grid space, not a rectangle. A
   * loop derived from a grid-space rectangle silently misses the two side corners of the
   * screen (trap T9). The returned range over-covers by roughly 2×; that is the correct
   * trade against per-tile diamond intersection tests.
   *
   * @param marginTiles Extra tiles on every side. Pass the height of the tallest thing on
   *   your map in world pixels, divided by {@link TILE_H}, or roofs will pop in along the top
   *   edge. In world pixels because that is the only height unit this package has — a storey
   *   is not a thing `iso` can count (§4.3).
   */
  visibleTileBounds(out: TileRange, marginTiles?: number): TileRange;

  /**
   * The **world** rectangle covering the viewport, for culling anything that is not on the
   * tile lattice — a backdrop gradient, a light pool, a cached scenery chunk.
   *
   * The `Rect`-shaped counterpart to {@link Camera.isVisible}: that one asks about a known
   * box, this one hands over the box to test against.
   */
  visibleWorldBounds(out: Rect, marginPx?: number): Rect;
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

### 3.4 `depth` — an order over footprints, and nothing else

> **Boundary, settled. `draw` is right and I have dropped my `Scene`.**
>
> An earlier draft of this RFC exported a `Scene` that held ids, culled, sorted and picked.
> `draw` claims pass ordering and the sorted draw bucket, and grants that depth *values* are
> mine. Two packages owning a draw list is exactly the overlap that survives review and costs
> a rewrite later, so one of us drops it, and it is me — for a reason better than deference:
>
> **A draw list is a list of things to draw, and `iso` must not know what a drawable is.** The
> moment `Scene` holds ids, it is modeling the caller's entities; the moment it has passes,
> it is a renderer. What is genuinely mine is narrower and sharper — *given a set of ground
> footprints, what order do they occlude in* — and that is a permutation of integers, with no
> notion of an item at all.
>
> So: **`draw` owns the items, the passes and the bucket; `iso` owns the comparator, the
> order, and the backwards walk that makes picking correct.** `DepthSorter` is fed footprints
> and hands back a permutation. It never learns what was drawn.
>
> The one thing this must not break is the invariant `Scene` existed to enforce — that picking
> is the exact reverse of painting (trap T3). It does not, and this is the load-bearing part
> of the split: `draw` paints `for i in 0..count: paint(items[order.indexAt(i)])`, and
> `pickSorted` walks *that same `DepthSorter` instance* backwards. The two cannot disagree
> unless `draw` re-orders after sorting, which is now a written contract (I9) rather than a
> thing each package hopes the other remembered.

```ts
/**
 * An order over a frame's ground footprints: fed rectangles, hands back a permutation.
 *
 * Holds five numbers per item in flat typed arrays — no ids, no closures, no entities. The
 * source game pushed `{ depth, x0, x1, y0, y1, draw: () => … }` per item per frame; that is
 * one object plus one closure per sprite per frame, and it was the largest avoidable
 * allocation in the whole renderer.
 *
 * Fill it, sort it, walk it forwards to paint, walk it backwards to pick. What sits at each
 * position is the caller's business — `@lattice/draw` keeps the items, this keeps the order.
 */
export declare class DepthSorter {
  /** @param capacity Items to pre-allocate for. Grows by doubling; sized right it never grows. */
  constructor(capacity?: number);

  /** Items surviving the cull. Before {@link DepthSorter.sort} this is everything added. */
  readonly count: number;

  /** Drop every item, keeping the buffers. Call once at the top of the frame. */
  clear(): void;

  /**
   * Add a footprint.
   *
   * @param heightPx Height above the `z = 0` plane, for culling only — ground elevation plus
   *   the object's own height. Under-declare it and the roof pops; over-declare it and you
   *   draw a few items you did not need to.
   * @returns the insertion index. **Keep it**: it is how the caller maps a sorted position
   *   back to its own item, and it is the sort's final tie-break.
   *
   * Elevation deliberately does **not** enter the sort. A lamp on the ridge and a lamp in the
   * valley sort by their ground footprints, because in a 2:1 projection what occludes what is
   * decided on the ground plane; adding `z` to the depth key draws the ridge lamp in front of
   * a gate that is plainly standing between it and the camera (trap T15).
   */
  add(gx: number, gy: number, w: number, d: number, heightPx: number): number;

  /**
   * Add a point-like thing — a walker, a floating number's origin, a dropped resource.
   *
   * Given a small square footprint (`radius` tiles, default `0.15`) rather than zero extent,
   * so it can be strictly *beside* a wall instead of forever ambiguous with it. A true point
   * is incomparable with every footprint that shares either of its spans, which is how
   * pedestrians end up drawn through a wall at second-storey height.
   */
  addPoint(gx: number, gy: number, heightPx: number, radius?: number): number;

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
   * Culling lives here rather than in `draw` because it is a camera-geometry question, not a
   * rendering one — it is {@link Camera.isVisible} applied to a footprint's bounds, and every
   * consumer would otherwise write the same six lines and one of them would forget the height.
   *
   * @param camera Omit to sort without culling — useful for tests and for offscreen passes.
   */
  sort(camera?: Camera): void;

  /**
   * The **insertion index** at sorted position `i`, `0 ≤ i < count`, back to front.
   *
   * This is the whole output. `for (let i = 0; i < s.count; i++) paint(myItems[s.indexAt(i)])`
   * is the painter's algorithm, correctly.
   */
  indexAt(i: number): number;
}

/**
 * What the player tapped: the insertion index of the **last-painted** item whose `test`
 * returns true, or `-1`.
 *
 * Walks a sorted {@link DepthSorter} backwards, so it is the exact reverse of the paint order,
 * including the tie-break. A tap on a rack that opened the headquarters beside it — both at
 * the same depth, the pick testing the one that had been painted *under* — was a real,
 * shipped, player-found bug (trap T3), and it cannot recur as long as the sorter passed here
 * is the one that produced the paint order.
 *
 * `test` receives the insertion index; hoist it out of the frame, because a closure allocated
 * per tap is a closure allocated per tap.
 */
export declare function pickSorted(
  sorted: DepthSorter,
  test: (index: number) => boolean,
): number;
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
 * cost layer without dragging terrain colors through the cache, and why `@lattice/persist`
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

### 3.6 `height` — elevation

> **This module is new.** `.lattice/kit.json` lists `iso`'s modules as projection, camera,
> depth, tilemap, footprint, hittest, path — no `z` anywhere. The demo RFC's line is right:
> *a valley with no z is a rug with a road painted on it*, and the fix is a module, not a
> parameter bolted onto an existing one. **Proposed change to `kit.json`: add `height` to
> `packages.iso.modules`.**

The shape of the answer matters as much as the answer. Elevation here is **a layer over the
tile map, not a third grid axis** — one number per grid vertex, read through a sampler,
multiplied into a screen-space `y` shift. That buys the valley, the river bank, the ridge and
the flatness test, and it costs nothing anywhere else in the package: the projection stays
linear, the depth sort stays two-dimensional, and a game with flat ground never allocates a
byte for it.

```ts
/**
 * A tile layer read as terrain height, plus the world pixels one height unit is worth.
 *
 * Two fields rather than a class, so a game can point one at a {@link TileGrid} it saves, at
 * a {@link ChunkGrid} it streams, or at `tileSourceOf(seeded noise)` and store nothing at all.
 */
export interface HeightField {
  readonly heights: TileSource;
  /**
   * World pixels per height unit. An art constant the game chooses — `TILE_H / 4` is a good
   * first guess, because four steps of rise per tile is where a 2:1 slope stops reading as a
   * slope and starts reading as a wall.
   */
  readonly stepPx: number;
}

/**
 * Height in world pixels at a **fractional** grid position, bilinear between the four corners
 * the position lies within.
 *
 * **Heights live on grid vertices, not tile centers.** `heights.get(gx, gy)` is the elevation
 * of the *north corner* of tile `(gx, gy)`, so adjacent tiles share their corner values
 * exactly and their drawn quads cannot leave a seam. Center-sampled heightfields need an
 * averaging pass to close those seams, and every game that starts center-sampled rewrites
 * this later. Getting the convention wrong costs a day and is invisible until the terrain is
 * drawn.
 *
 * Bilinear rather than nearest because walkers are sampled at fractional positions: a
 * nearest-neighbor height makes a pilgrim climb a hill in visible steps.
 */
export declare function heightAt(field: HeightField, gx: number, gy: number): number;

/**
 * The steepest rise between any two adjacent corners of tile `(gx, gy)`, in world pixels.
 *
 * The terrain half of a movement cost function: `cost = 1 + (slopeAt(...) / stepPx) | 0`
 * is a complete, deterministic "rough ground is slower" rule in one line, and it is what
 * makes the demo's ridge route *shorter but harder* rather than merely shorter.
 */
export declare function slopeAt(field: HeightField, gx: number, gy: number): number;
```

### 3.7 `hittest` — screen → what

> **Who owns tap → grid cell.** `iso` does, and this is the sentence that settles it, because
> the demo RFC is right that it is the seam two packages can each plausibly disown. The split:
> **`input` owns the event, `iso` owns the geometry, and the composition is `input`'s and is
> one line.** `input` turns a `PointerEvent` into CSS-pixel coordinates relative to the
> viewport, decides whether it was a tap or a drag, and then calls `screenToTile(camera, sx, sy,
> out)` — a function that takes two numbers, touches no DOM, and is testable in Node. The
> inverse split is unbuildable: a `screenToTile` in `input` would drag the projection, the camera
> and the heightfield up a layer, and `iso` cannot own the event because it may not name a DOM
> global. If a builder finds themselves writing a `pointerToTile(ev, ...)` here, they have the
> seam the wrong way round. **Settled — `input` has taken it, and this is the confirmation.**
>
> **On `hitTest(state, camera, sx, sy)`, which `input` asks to exist here: the capability does,
> the signature cannot, and the difference matters.** `iso` cannot take a `state` parameter,
> because it would have to name the type of a thing it is forbidden to know about — the whole
> reason `DepthSorter` holds rectangles and not entities (§3.4). What `input` is entitled to
> rely on is that it never has to know either, and that holds. The three functions are:
>
> | the question | call | returns |
> |---|---|---|
> | which cell is under the pointer? | `screenToTile(camera, sx, sy, out)` | a tile, always |
> | …on terrain with height? | `screenToTileOnHeights(camera, sx, sy, field, maxHeightPx, out)` | a tile, or `false` off-map |
> | which *object* is under the pointer? | `pickSorted(order, test)` | the caller's insertion index, or `-1` |
>
> The third is the one that replaces `hitTest`, and the state lives in the closure the caller
> already has: `pickSorted(order, (i) => hitsSilhouette(state.buildings[i], sx, sy))`. `input`
> supplies `sx, sy`; the game supplies `state`; `iso` supplies the order and the walk. Nobody
> holds a registry, nobody sets a `pickable` flag, and `input`'s §4 refusal stands intact.
>
> *(`input` cutting `gamepad` simplifies this side too: picking now has exactly one caller
> shape — a screen position — so there is no focus ring, no reticle, and no "next selectable
> object in direction d" traversal to design. Recorded in §4.11 so it is a decision, not an
> omission.)*

```ts
/**
 * The tile under a screen point, on flat ground. **The exact inverse of {@link gridToScreen}
 * at `zPx = 0`**, and the last member of the conversion family: `gridToWorld`, `worldToGrid`,
 * `worldToTile`, `gridToScreen`, `screenToTile`.
 *
 * *(Named by `@lattice/input`, which was right that `pickTile` — the earlier name — was the
 * odd one out in a package whose every other conversion is spelled `aToB`.)*
 *
 * **Floors, never rounds** (trap T1). `@lattice/input` resolves this on every pointer event
 * against the camera as the tick opened, so it is on that package's hottest path: two
 * multiplies, two adds and two floors, no allocation, no branch.
 */
export declare function screenToTile(camera: Camera, sx: number, sy: number, out: Tile): Tile;

/**
 * The tile under a screen point **on a heightfield**, or `false` if the ray leaves the map.
 *
 * Needed because the projection is not invertible once terrain has height (trap T11): the
 * pixel under the cursor is on the ground at one place *and* on the side of the ridge behind
 * it at another, and `screenToTile` will confidently return the first. Marches tiles from the far
 * end of the screen ray towards the viewer and returns the first whose surface contains the
 * point — far to near, because the near one is what the player can see and therefore what
 * they meant.
 *
 * @param maxHeightPx The tallest terrain on the map, which bounds how far back the march has
 *   to start. Pass it, or the march either misses a peak or scans the whole map per tap.
 */
export declare function screenToTileOnHeights(
  camera: Camera,
  sx: number,
  sy: number,
  field: HeightField,
  maxHeightPx: number,
  out: Tile,
): boolean;

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

### 3.8 `path` — a curve, not a list of nodes

The central claim, restated because it decides every signature below: **a path is a curve to
be sampled.** `find` produces one, `pathSample` reads a position out of it at an arc length,
and the caller keeps no state at all. Everything the demo needs — a crowd, an ignition wave, a
`reach` number — is that one function called with a different argument.

```ts
/**
 * Movement cost of entering a tile: `0` for impassable, otherwise a positive integer weight
 * where `1` is ordinary ground, `2` is twice as slow, and so on.
 *
 * **Weighted, not binary.** Binary walkability cannot say "shorter but rougher", and that
 * sentence is the demo's entire mid-game decision. The step cost is `weight × STEP_ORTHO` or
 * `weight × STEP_DIAG`, so a scree tile at weight 3 is exactly three times the road beside
 * it. Keep weights small — under about 100 — so a route's total stays comfortably inside a
 * 32-bit integer.
 *
 * Integers, not floats, and this is not a style choice. A* orders its frontier by summed
 * cost; float summation is associative only by luck, so two engines can pop equal-`f` nodes
 * in a different order and produce different — both optimal, both different — paths. A
 * replay that diverges by one tile diverges by everything. Integers make the order total
 * and the path byte-identical everywhere.
 *
 * A cost function is the right place to combine layers: terrain type from one `TileGrid`,
 * slope from a {@link HeightField}, occupancy from another. It is called once per expanded
 * node, so keep it arithmetic — no allocation, no `Math.pow`.
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
   * Allow a diagonal step when one of the two shared orthogonal neighbors is blocked.
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

/**
 * A route: a polyline through grid space that also knows how long it is.
 *
 * Nodes are grid coordinates — integers when they came from {@link PathFinder}, fractional
 * when the game authored them ({@link Path.push}) — and alongside them the path keeps the
 * cumulative **world-pixel** arc length to each node. That second array is what makes
 * {@link pathSample} possible, and it is why `Path` is a class rather than an array of tiles.
 *
 * There is no `length`, deliberately: `nodeCount` and `arcLength` are different numbers in
 * different units, and a game that computes `reach` from the node count instead of the arc
 * length gets an economy that pays more for a zigzag than for a road.
 */
export declare class Path {
  constructor(capacity?: number);

  /** Number of nodes, including both endpoints. `0` for an empty path. */
  readonly nodeCount: number;

  /**
   * Total length in **world pixels** — the demo's `reach`, and the domain of every `s`
   * parameter in this module.
   *
   * World pixels rather than tiles, because the grid→world map is not conformal: one grid
   * unit along `+gx` is 35.8 world pixels, and one grid unit along the `(1,1)` diagonal is
   * 22.6. A walker advanced at a constant rate in *grid* units visibly speeds up by 58% when
   * the road turns, which is the "the walkers hitch on the diagonals" bug in §1.
   */
  readonly arcLength: number;

  /** Bumped on every mutation. Cache anything derived from the path against this. */
  readonly version: number;

  /** Grid coordinates of node `i`. @throws RangeError when `i` is out of range. */
  gxAt(i: number): number;
  gyAt(i: number): number;

  /** Arc length in world pixels from the start to node `i`. `sAt(nodeCount - 1) === arcLength`. */
  sAt(i: number): number;

  /**
   * Append a node, extending {@link Path.arcLength} by the world distance from the previous
   * one. Fractional coordinates are allowed and are how a game hands in an authored road
   * spline — the demo's valley road is generated, not searched, and still needs to be sampled.
   */
  push(gx: number, gy: number): void;

  clear(): void;
}

/**
 * The grid position at arc length `sPx` along the path, written into `out`.
 *
 * **The most important function in this package**, and the one the demo ranks as the kit's
 * most-needed gap. Fifty walkers are fifty calls, no per-walker state, nothing allocated,
 * identical on every replay.
 *
 * Takes a **world-pixel** arc length and writes a **{@link GridPoint}**, which is not a
 * mismatch but the point: parameterising by world length is what makes the motion look
 * uniform, and producing a grid position is what lets the result go straight into
 * {@link DepthSorter.addPoint}, {@link heightAt} and {@link gridToScreen} without a
 * conversion — and, because {@link Anchor} *is* a `GridPoint`, straight into an anchor.
 *
 * Clamps `sPx` to `[0, arcLength]` rather than wrapping. A caller who wants a loop writes the
 * modulo themselves and can therefore also write a ping-pong, a pause at the end, or a queue
 * that bunches up at the gate — none of which a built-in wrap would allow.
 *
 * `O(log nodeCount)` — a binary search over the cumulative lengths, then one lerp.
 */
export declare function pathSample(path: Path, sPx: number, out: GridPoint): GridPoint;

/**
 * Which of the eight compass directions the path is heading in at arc length `sPx`, as a
 * direction code for {@link DIR_DX}/{@link DIR_DY}. `0` on an empty path.
 *
 * A direction *code* rather than an angle, and this is a determinism decision as much as an
 * ergonomic one: the obvious implementation is `Math.atan2`, and ECMA-262 does not require
 * correctly-rounded trigonometry, so a facing angle that reaches a save file or a hash is not
 * replayable across engines. Comparing the signs and magnitudes of `dx` and `dy` is exact
 * arithmetic and is also what a sprite with eight facings actually wants.
 */
export declare function pathDirAt(path: Path, sPx: number): number;

/**
 * The arc length of the point on the path nearest to grid position `(gx, gy)`.
 *
 * The inverse of {@link pathSample}, and the function that turns a *place* into a *number*:
 * `reach` is `pathProject(road, furthestLitLamp.gx, furthestLitLamp.gy)`, and the demo's
 * ending ignites each lamp staggered by its own projection. Without it a game has to store an
 * arc length beside every object on the road and keep the two in sync through every re-route.
 */
export declare function pathProject(path: Path, gx: number, gy: number): number;

/**
 * Collapse the staircase: remove collinear runs, then pull the path straight wherever the
 * shortcut is passable. Mutates in place and shortens {@link Path.arcLength}.
 *
 * A raw 8-way A* result is a stair of unit steps, and a walker sampled along it wobbles from
 * side to side like someone finding their keys in the dark (trap T16). Every game that
 * samples a path needs this, so it ships here rather than being rediscovered per game.
 *
 * @param cost Omit to remove only exactly-collinear nodes, which is free and always safe.
 *   Pass one to also string-pull through open ground, which is what makes a route look like a
 *   road; the pull only ever shortens the path, so it cannot make a legal route illegal.
 */
export declare function pathSimplify(path: Path, cost?: TileCost): void;

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
  /** The {@link MutableTileSource.version} the last {@link FlowField.build} read. Compare to know whether to rebuild. */
  readonly builtAtVersion: number;
}
```

**Reachability comes free.** A base-builder must answer "have I just walled my walkers in?", and
that is `field.dirAt(x, y) === 0` after the wall is placed, or `costAt < 0`. No flood-fill export,
no connected-component API — the flow field the game already keeps is the connectivity oracle.

**Recompute on a tile change is the whole of the rockfall beat**, and it is three lines:

```ts
map.set(rock.gx, rock.gy, GROUND);                       // one write, version bumps
if (field.builtAtVersion !== map.version) field.build(cost);   // one sweep
finder.find(cost, gate.gx, gate.gy, shrine.gx, shrine.gy, road); pathSimplify(road, cost);
```

Every pilgrim re-routes on the next frame without being told, because none of them holds a
route — they hold an arc length along `road`, and `road` is what changed. That is the second
dividend of §3.8's central claim, and it is why there is no incremental replanner here (§4.9).

### 3.9 `anchor` — attaching a durable thing to the world

> **Routed from `@lattice/ui`:** nothing in the kit anchors a *persistent* overlay — a name
> tag, a construction ring, a health bar — to a world entity across pan and zoom. `ui` covers
> the one-shot float via an injected `project` hook; the durable case had no owner.
>
> **It is mine, and it is not a new concept.** `ui` was right that this and arc-length
> sampling must not come out as two unrelated APIs. They do not, because both produce the same
> currency: **a grid position.** `pathSample` writes one for a moving thing; `footprintAnchor`
> writes one for a static thing; `anchorToScreen` projects either. There is no `Anchor` class,
> no registry, no subscription, and nothing that has to be torn down.

```ts
/**
 * A durable attachment point in the world: where a thing *is*, in grid space, plus how high
 * above the ground plane it hangs.
 *
 * Three numbers, mutable, owned by whoever owns the entity. Deliberately **not** a screen
 * point and deliberately not camera-aware: an anchor computed against a camera is stale the
 * next time anyone pans, and caching screen positions is the same mistake as caching hit
 * boxes during the draw pass (trap T5), one frame later.
 *
 * **It extends {@link GridPoint}**, which is what makes the unification with path sampling
 * literal rather than rhetorical: `pathSample(road, s, anchor)` writes a walker's position
 * directly into its anchor, no conversion and no intermediate. The caller then sets `zPx`
 * from {@link heightAt}. A static anchor is written once at placement time and never again.
 */
export interface Anchor extends GridPoint {
  zPx: number;
}

/**
 * Project an anchor to a screen point, now, for this camera. Allocation-free; call it once
 * per anchored thing per frame and never store the result.
 *
 * This is the function `@lattice/ui` should be handed as its `project` hook and the one
 * `@lattice/draw` should call for a world-space label. Both get the same pixel, which is the
 * point — a HUD tag and a canvas ring on the same building must not disagree by a subpixel.
 */
export declare function anchorToScreen(camera: Camera, a: Readonly<Anchor>, out: Vec2): Vec2;

/**
 * Is this anchor within `marginPx` of the viewport?
 *
 * A DOM tag for an off-screen building must be hidden rather than positioned at −4000px:
 * every browser still lays out and composites the second one, and a hundred of them is a
 * measurable frame cost for something nobody can see.
 */
export declare function anchorVisible(camera: Camera, a: Readonly<Anchor>, marginPx?: number): boolean;

/**
 * Stereo pan for a sound made at this anchor: `-1` hard left, `0` center, `+1` hard right,
 * unclamped beyond the viewport edges.
 *
 * Sugar over {@link Camera.normalizedX}, and the third of the three things a world position
 * has to become — a screen point for drawing, a screen point for a DOM overlay, and a pan for
 * a sound. `@lattice/audio` cannot compute this because the mapping needs a camera and audio
 * may not depend on `iso`; the demo should not compute it because then every game rewrites
 * it. It lives here, next to the other two, and it is one line.
 */
export declare function anchorPan(camera: Camera, a: Readonly<Anchor>): number;
```

**What is still not mine.** Drawing the tag, the ring or the bar — `draw` on canvas, `ui` in
the DOM — and the *lifetime* of the anchored thing. `iso` does not know that a building was
demolished, so an overlay outliving its entity is the consumer's bug to prevent: the overlay
must hold a reference to the entity's own `Anchor`, never a copy of it, and must be disposed
by whatever disposes the entity (trap T19).

### 3.10 Determinism: what this package may not compute

`@lattice/core`'s RFC establishes a two-tier rule, and it constrains this package more than it
constrains most. ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise
operators exactly; it explicitly does **not** require correctly-rounded `sin`, `cos`, `atan2`,
`pow`, `exp` or `log`. Anything whose result is hashed, persisted or replayed must stay in
tier A.

**No function in `@lattice/iso` uses a trigonometric, exponential or logarithmic function.**
That is a testable claim (I17) and it costs nothing, because the geometry here is linear:

| where it is tempting | what is used instead |
|---|---|
| a walker's facing angle | {@link pathDirAt} returns one of eight direction codes, from sign and magnitude comparisons |
| the A* heuristic | the integer octile metric `STEP_DIAG·min(dx,dy) + STEP_ORTHO·abs(dx−dy)` — exact, admissible, and no `sqrt` at all |
| arc length | `Math.sqrt` of an exactly-computed sum of squares, which is tier A |
| an isometric "rotation" | there is none; the projection is a fixed 2×2 integer matrix |
| per-tile variation | not this package's job. Call `core.hash2(seed, gx, gy)` through `fillFrom` or `tileSourceOf` — stateless, seeded, and independent of the order tiles are visited, which is what stops a valley reshuffling itself when one tile is touched |

`iso` contains no randomness of any kind and holds no `Rng`. Everything that varies comes in
through a `TileSource` the caller filled.

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

### 4.2 A third grid axis — but elevation itself is *in*, see §3.6

`iso` has a heightfield and it does not have a `gz`. The line between the two is worth stating
precisely, because "we need elevation" and "we need a third axis" sound like the same request
and are not:

| in | out |
|---|---|
| one height per grid **vertex**, sampled bilinearly | a stack of tiles per column |
| a screen-space `y` shift of `-zPx · zoom` | z entering the depth key or the occlusion test |
| slope, flatness, and terrain-aware picking | bridges, overpasses, tunnels, floors above floors |

The reason for the line is that everything in the left column keeps the projection linear and
the sort two-dimensional, and everything in the right column replaces the depth sort with a
different algorithm over a different data structure. A game that wants floors draws one
`DepthSorter` per floor, in order, which is what every shipped 2:1 game with floors actually does
and which this API already supports at no extra cost.

### 4.3 Anything that draws

No canvas, no color, no sprite, no `CanvasRenderingContext2D`, no `devicePixelRatio`.
`tileDiamond` and `boxSilhouette` return **geometry**. The package must run unchanged in Node,
because the depth sort and the pathfinder are the two things most worth testing and neither
should need a DOM to test.

**Including `LEVEL_H`, the storey height, which went back and forth twice and is `draw`'s.**
Worth recording the whole exchange, because the final distinction is the useful part and the
losing argument was mine:

1. I pushed it to `draw` as an art proportion.
2. `draw` asked for it back rather than re-deriving it. I reversed, on consistency: I own
   `TILE_W` and `TILE_H`, so owning two thirds of a proportion and disowning the third looked
   like an inconsistency with a justification attached.
3. `draw` disputed the reversal and won it. **`iso`'s entire height vocabulary is world
   pixels** — `gridToScreen` takes `zPx`, `Volume` carries `zPx`/`hPx`, `heightAt` returns
   pixels, and `footprintBounds`, the case my consistency argument actually rested on, already
   takes a `heightPx` that has *been* converted. There is no signature in this package a storey
   could enter through. Exporting it would therefore remove no conversion and instead publish a
   number the package never reads, which is its own way for a constant to drift.

The distinction that survives is real rather than convenient: **`TILE_W` and `TILE_H` are
projection facts** — the 2:1 that makes the inverse exact, the diamond two half-planes and the
depth key a sum — **and `LEVEL_H` is an art proportion**, tuned beside face-shading constants
that live in `draw` and mean nothing here. My instinct that the split looked arbitrary was
sound; the resolution is that the line falls between *projection* and *proportion*, not between
two thirds and one third.

### 4.4 Camera feel

No inertia, no drag handling, no pinch, no edge-scroll, no keyboard pan, no smooth follow, no
screen shake. `Camera` is a transform plus a clamp, and every method is a pure function of its
arguments and current state. Feel needs a clock and a pointer, and both live upstream:
`@lattice/input`'s `cameracontrol` owns it and drives this camera through `panByScreen` and
`zoomAt`. A camera that eases itself cannot be stepped deterministically in a replay.

### 4.5 Steering, avoidance, and anything that owns a walker

`pathSample` will tell you where arc length `s` is. It will not choose `s` for you, will not
accelerate, will not stop fifty walkers piling into one doorway, and will not decide that this
walker should wait because that one is in the way. Those need a clock and per-agent state,
and this package has neither — every function here is a pure function of its arguments.

Note how much this rules *out* rather than in: a game whose crowd is `s = (t · v + offset) mod
arcLength` needs no steering at all, which is the demo's bet and is why its crowd is twelve
lines. A game that needs walkers with genuine state is a game that needs a simulation layer —
see §7.

### 4.6 Entities, components, or any scene graph

`DepthSorter` stores rectangles. It has no `update`, no parent/child, no transform hierarchy,
and it is rebuilt from scratch each frame — which at a few hundred drawables costs less than
maintaining a retained graph and removes the entire class of "the renderer and the state
disagree" bug. Nothing in this package can name an entity, which is what makes the boundary
with `draw` (§4.10) enforceable rather than merely agreed.

### 4.7 Serialization

No `toJSON`, no save format, no versioning. `TileGrid.data` is public so `@lattice/persist` can
take the buffer whole; owning the format is persist's job, and a map that serializes itself will
grow a second, incompatible migration chain.

### 4.8 Fog of war, line of sight, and grid ray-marching

Not in v1. Each is a genuine feature with genuine design questions (does a wall block sight from
its center or its edge?), and none has a caller yet. Listed here so that adding one is a decision
rather than a drift.

### 4.9 Incremental replanning (D* Lite, LPA*)

The demo asks for "path recompute cheap enough to run on a tap", and the answer is
**recompute it entirely**, plus the `version` counter of §3.5 so it happens exactly once. Some
arithmetic, because this is a decision that sounds wrong until it is measured: a 48×48 valley
is 2,304 tiles, so a worst-case A* that expands every tile is a few tens of microseconds and a
full `FlowField.build` is one linear sweep in the low hundreds. The frame budget is 8 ms. An
incremental replanner buys back a fraction of a percent of one frame, in exchange for a few
hundred lines of the subtlest code in the package, a second invalidation protocol, and a class
of bug — a stale key in the priority queue — that reproduces once an hour and never in a test.
If a game appears whose maps are large enough for this to matter, it will also be a game that
wants chunked flow fields, and that is a different design conversation with real numbers in it.

### 4.10 A draw list

Settled with `draw` and set out in full at §3.4. `DepthSorter` hands back a permutation of
integers; it has no items, no passes, no layers, no z-order groups, and no notion that anything
is drawn at all. If a builder finds themselves adding an `idAt`, a `pass` argument or a draw
callback, they are rebuilding `draw`'s bucket inside `iso`, and the two will diverge.

### 4.11 Directional selection, focus rings and reticles

`@lattice/input` has cut its `gamepad` module, on the argument that a pad cannot answer *where*
without a reticle the kit never designed. The consequence lands here: picking has exactly one
caller shape — a screen position — so there is no `nextSelectableFrom(index, direction)`, no
focus order over a `DepthSorter`, and no notion of a selected item at all. Worth recording
rather than leaving implicit, because "find the nearest object north-east of this one" is a
plausible-sounding request that would drag selection state into a package that has none.

### 4.12 A priority queue, as an export

`iso` builds a binary heap for A\* and Dijkstra, and **does not export it.** `core` refused to
own it (its §4.9) and I accept the refusal: applying its own charter question — *point at the
RFCs, not at a guess about who might want one later* — `loop` explicitly refuses priority
queues in its §4.7 and `sim` is closed-form by construction, so there is exactly one confirmed
consumer, and one consumer means the consumer owns it. That is the same answer `Rect` and
entity ids got, and it would be incoherent to want a different one here just because my request
came with a better argument attached. Their shape distinction is the sharper half anyway:
`Scope` and `EpochMillis` are *vocabulary* that makes other packages' guarantees enforceable, a
heap is a generic *container*, and admitting one container admits `Deque` and `RingBuffer` on
identical reasoning.

Owning it does not mean publishing it. It is one internal module behind `PathFinder` and
`FlowField`, and exporting it would promise a general-purpose container from a package about
isometric space.

**It is built to the Lattice ordering rule, which `core` did take**, and which is worth
restating here because two things in this package are bound by it:

> Anything ordering by a numeric key breaks ties by **insertion sequence** and exposes **no
> comparator parameter**. A comparator that may return `0` reintroduces the ambiguity the rule
> exists to remove, and a caller cannot supply a total order over an insertion sequence it
> cannot see.

That governs the path heap (I13) *and* `DepthSorter`'s ready set (I8) — which is why neither
takes a comparator, and why `DepthSorter.add` returns the insertion index rather than keeping
it private. My determinism argument won on the substance and lost on the placement; it survives
as a kit-wide contract instead of a shared implementation, which is the better outcome, because
a contract binds the code `draw` writes too.

**The named trigger for revisiting:** the day a second package needs a priority queue it
**moves** to `core` rather than being written twice. The move is cheap precisely because the
contract above is already fixed, so what moves is code and not a decision.

---

## 5. Invariants a reviewer can test

| # | Invariant | An obvious failing case |
|---|---|---|
| I1 | `worldToGrid(gridToWorld(g))` returns `g` exactly for integer grid points, and within `1e-9` for fractional ones. | Round-trip a fractional point and get a drift of `0.5` — someone used `round` in the inverse. |
| I2 | For every tile and every one of the 8 sample points at fractions `0.25`/`0.5`/`0.75` inside its diamond, `worldToTile` returns that tile. | Sample the north quarter of `(3,3)` and get `(2,3)` — the floor became a round (trap T1). |
| I3 | `toWorld(toScreen(w))` round-trips within `1e-9` at any pan and any zoom in `[minZoom, maxZoom]`. | Fails only at non-unit zoom — the viewport half-offset was applied before the scale in one direction and after it in the other. |
| I4 | With `bounds` far larger than the viewport, after `zoomAt(f, sx, sy)` the world point that was under `(sx, sy)` is still under it, within `1e-9`, for `f` in `{0.5, 1.1, 2}`. | The point drifts towards the screen center: origin-anchored zoom (trap T6). |
| I5 | With `bounds` **smaller** than the viewport in either axis, the camera center equals the bounds center in that axis, and `clamp(); clamp()` changes nothing. | The center oscillates between two values across repeated pans, because `min > max` was fed to a clamp (trap T7). |
| I6 | `sorter.sort()` output is a permutation of the surviving inputs: every insertion index in `0..count` appears exactly once, and `count` equals the number of items whose bounds passed `isVisible`. | An item vanishes, or is painted twice — the topological pass emitted from a stale ready set. |
| I7 | If footprint `a` ends before `b` begins on either axis, then `a` precedes `b` in the sorted output — for every pair in the sorter, checked exhaustively on a random-but-seeded layout. | A tree is painted after the wall it stands behind. |
| I8 | `sort()` is deterministic and terminating: the same adds in the same order give the same output, on any engine, and a deliberately constructed cyclic layout terminates in bounded time rather than hanging. | The suite passes on Node and fails on Safari: a non-transitive comparator was handed to `Array.sort`. |
| I9 | For two items at equal depth whose silhouettes overlap, `pickSorted` returns the one that `indexAt(count-1 … 0)` reaches first — i.e. the one painted last. **Stated as a cross-package contract with `draw`:** the sorter passed to `pickSorted` is the one that produced the paint order, and `draw` does not reorder after `sort()`. | The tap opens the building behind (trap T3), or `draw` reshuffles a pass and picking silently drifts out of step. |
| I10 | `TileGrid.get` outside the grid returns `outOfBounds` and never throws; `TileGrid.set` outside the grid throws a `RangeError` naming the coordinate and the bounds. | A pathfinder scanning a border tile throws mid-frame. |
| I11 | `PathFinder.find` on a uniform-cost open grid returns a path whose summed cost equals the octile distance `STEP_DIAG·min(dx,dy) + STEP_ORTHO·abs(dx−dy)`. | The path is optimal-looking but longer: the heuristic overestimates, or diagonals cost 10. |
| I12 | Every consecutive pair in a returned `Path` differs by at most 1 on each axis, and with `cutCorners: false` no diagonal step has both shared orthogonal neighbors impassable. | An agent walks through the corner where two walls meet. |
| I13 | The same `find` call with the same cost function returns a byte-identical `Path` across runs and engines. | Two replays of one seed diverge after the first junction — float costs, or a heap with an unspecified tie-break. |
| I14 | Following `FlowField.step` from any tile with `costAt ≥ 0` reaches a goal in at most `costAt / STEP_ORTHO` steps and never revisits a tile. | Two adjacent tiles point at each other and an agent vibrates in place for ever. |
| I15 | A warm frame — `clear`, 400 `add`s, `sort`, 400 `indexAt`s, 3,200 `toScreenX`/`Y` calls, 50 `pathSample`s, one `pickSorted`, one `find` — allocates zero bytes, asserted in `*.bench.ts` against a heap-delta measurement. | The number climbs the day someone returns `{x, y}` from a conversion, which is the failure `@lattice/draw` cannot survive. |
| I16 | No file in `src/` references `window`, `document`, `Canvas`, `Math.random`, `Date.now` or `performance.now`. Enforced by `npm run lint`. | The camera grew a `resizeToCanvas` helper. |
| I17 | No file in `src/` references `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp` or `log`. `sqrt` and `hypot`-free arithmetic are permitted. Enforced by `npm run lint` alongside I16. | A facing angle reaches a save file and two engines disagree in the last bit (§3.10). |
| I26 | No public function returns a freshly constructed object. Every one returns a primitive, `void`, `boolean`, or an out-parameter it was given. Checkable by reading the `.d.ts`: no return type is a bare interface the caller did not pass in. | `draw` cannot meet constitution rule 7, and its own allocation invariant becomes unachievable. |
| I27 | `camera.zoom = 2` does not compile, and does not change the camera at runtime through any cast that keeps the public shape. Only `zoomAt` moves the zoom. | The pointer-anchored-zoom invariant (I4) holds in the suite and breaks in the game, because a code path assigned the field directly. |
| I18 | `pathSample(p, 0)` is node 0, `pathSample(p, p.arcLength)` is the last node, and `pathSample` is monotone: for `s₁ < s₂` the sampled points advance along the path, never back. | A walker stutters backwards at a node boundary — the binary search returned the wrong segment on an exact hit. |
| I19 | For a path built by `push`, `pathProject(p, p.gxAt(i), p.gyAt(i))` equals `p.sAt(i)` within `1e-6`, and `pathSample(p, pathProject(p, g))` returns `g` for any `g` on the path. | `reach` jumps when a lamp sits exactly on a node. |
| I20 | Sampling a path at 1,000 evenly spaced arc lengths gives 999 consecutive world-space gaps that are equal within `1e-9`. | The walkers hitch on the diagonals: the parameterisation is in grid units, not world pixels (a 58% speed difference — see `Path.arcLength`). |
| I21 | `pathSimplify` never increases `arcLength`, never changes the first or last node, and with a `cost` never produces a segment crossing an impassable tile. | The string-pull cut the corner of a building and the crowd walks through a wall. |
| I22 | `heightAt` at integer grid coordinates equals `heights.get(gx, gy) × stepPx` exactly, and is continuous across tile boundaries. | Terrain seams: heights were sampled at tile centers rather than at vertices. |
| I23 | `footprintFlatness` is `0` for every footprint on level ground and is invariant under adding a constant to the whole heightfield. | A press can be placed on a cliff, or cannot be placed anywhere above sea level. |
| I24 | One `set` on a `TileGrid` increments `version` by at least one; a `set` writing the value already there does not have to, but must never decrement. | A cached flow field is never rebuilt after the rockfall, and the crowd walks the old road for ever. |
| I25 | `screenToTileOnHeights` on a ridge returns the tile whose *surface* the cursor is over, not the flat-ground tile behind it, for every pixel of a rendered slope. | Tapping a lamp on the ridge selects the ground two tiles beyond it (trap T11). |

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
axis*, and it is a partial order — which is why `DepthSorter.sort` is a topological sort with depth as
a tie-break and not a comparator. Handing a non-transitive comparator to `Array.sort` gives an
implementation-defined result that differs between engines and can flicker between frames.

**T3 — Picking must be the exact reverse of painting, tie-break included.** The renderer draws
ascending with a stable sort, so on equal depth the item added *earlier* is painted first and
ends up underneath. A picker that walks descending by depth but forgets to also walk descending
by insertion index resolves a tap on a rack to the headquarters beside it — both at depth 14,
found in player pass 4. This is why `pickSorted` consumes the `DepthSorter` itself: it walks the same
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
tapped. Input must never be a side effect of painting: `pickSorted`, `screenToTile` and `anchorToScreen`
all recompute from state and camera, every time. *(This is the kit.json invariant "hit-testing is
computed from state and camera, never cached during a draw pass".)*

**T6 — Origin-anchored zoom.** Pinching or wheeling must zoom towards *what the player is
looking at*. The correct implementation is three lines — world point before, apply zoom, world
point after, add the difference — and its absence is the single most common reason a tile-game
camera feels broken.

**T7 — The clamp inverts on maps smaller than the viewport.** The camera center is confined to
the bounds grown by whatever half-viewport remains after `keepVisible`. When the map is smaller
than the viewport in an axis that range inverts, `min > max`, and a naive `clamp(v, min, max)`
returns whichever endpoint it tests last — so the camera jitters between two positions on every
pan. Detect the inversion and pin to the bounds center instead.

**T8 — Cull with the height included.** A tall building whose *base* is below the viewport still
shows its roof. `footprintBounds` extends `minY` upward by the height for exactly this reason,
and `isVisible` is generous by a tile on top of that. Cull on the footprint alone and skylines
pop in and out along the bottom edge of the screen.

**T9 — The visible region is a diamond in grid space, not a rectangle.** Deriving the terrain
loop from a grid-space rectangle misses the two side corners of the screen and leaves triangular
holes of unpainted ground when the camera is off-axis. Project the four *screen* corners into
grid space and take the min/max — `Camera.visibleTileBounds` does this and over-covers by about 2×,
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
z) is one equation short of solvable. That is why picking walks the sorted order testing silhouettes
rather than inverting the camera, and it is the same confusion that makes a ground-plane
primitive used for a window paint a horizontal sliver hovering in mid-air. *(PLAYBOOK trap 4 is
the drawing half of this; the geometry half lives here.)*

**T12 — Diagonal corner cutting, and float path costs.** A diagonal step between two blocked
orthogonal neighbors walks the agent through the join of two walls. And `Math.SQRT2` summation
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
through walls, no matter how correct each list is on its own. One `DepthSorter` takes everything —
buildings, scenery, walkers, ghosts — and that is the deeper reason it holds rectangles rather
than typed items: a sorter that knew what a building was would invite a second one for trees.
*(PLAYBOOK trap 6.)*

**T15 — Elevation must not enter the depth key.** The first instinct on adding a heightfield is
to sort by `gx + gy + z`, and it draws a lamp on the ridge in front of the gate that is plainly
standing between it and the camera. In a 2:1 projection what occludes what is decided entirely
on the ground plane: height moves a sprite up the screen, it does not move it towards the
viewer. `DepthSorter.add` takes `heightPx` for culling only, and the sort never reads it.

**T16 — A raw A* path is a staircase, and a sampled staircase wobbles.** Octile A* returns unit
steps, so a road across open ground comes back as alternating east and south-east moves. Walk a
sprite along it and it weaves from side to side like someone finding their keys in the dark —
the artifact reads as "the pathfinder is broken" when the path is in fact optimal. `pathSimplify`
before sampling, always; it is one call and it is the difference between a crowd and a bug
report. The same staircase also makes `arcLength` about 8% longer than the road looks, which
quietly overpays a `reach`-based economy.

**T17 — Arc length in grid units instead of world pixels.** The grid→world map is linear but not
conformal: one grid unit along `+gx` is 35.8 world pixels and one along the `(1,1)` diagonal is
22.6. Parameterising a walker in grid units makes it accelerate by 58% every time the road
turns, which looks exactly like a frame-rate problem and is not one. Measure and sample in world
pixels; `Path` does, and this is the only reason it keeps a second array.

**T18 — Heights belong on grid vertices, not tile centers.** Center-sampled terrain leaves a
seam at every tile boundary, because two adjacent tiles disagree about the height of the edge
they share. It is invisible until the terrain is drawn, at which point it is a rewrite of every
function that reads a height. `heights.get(gx, gy)` is the north **corner** of tile `(gx, gy)`.

**T19 — An overlay must hold its entity's anchor, not a copy of it.** A name tag that copied
`{gx, gy, zPx}` at creation stays where the building used to be when the building is moved, and
stays on screen when it is demolished. `iso` cannot help: it does not know entity lifetimes. The
rule is that the entity owns exactly one `Anchor`, everything attached to it holds a reference,
and whatever destroys the entity destroys the overlay in the same statement.

---

## 7. Seams, taken and declined

### 7.1 What I have taken ownership of

Routings from five packages landed while this RFC was being written. Every one is answered in
the surface above; this is the index, so that no builder has to re-derive a decision.

| routed from | the question | answer | where |
|---|---|---|---|
| **draw (A3)** | projection must not return `{ x, y }` | **already true, now unmissable.** Three shapes only — scalar, out-parameter, buffer — set out before the first signature, with a testable invariant (I26). `toScreenX(wx)`/`toScreenY(wy)` *is* the write-into-a-`Float64Array` form | §3 preamble, I26 |
| **draw (A3)** | `visibleTileBounds` for culling | **taken and renamed** to the name `draw` asked for, plus `visibleWorldBounds` for the things that are not on the lattice — backdrops, light pools, cached chunks | §3.3 |
| **draw (A3)** | export `LEVEL_H` rather than re-derive it | **declined, after taking it and being overruled.** `draw` keeps it: `iso`'s height vocabulary is world pixels throughout, so no storey can enter through any signature here, and the export would publish a number the package never reads. `TILE_W`/`TILE_H` are projection facts; `LEVEL_H` is an art proportion | §4.3 |
| **draw (A3)** | who owns the sorted draw list | **`draw` does; I dropped `Scene`.** `iso` keeps the comparator, the order and the backwards walk — `DepthSorter` hands back a permutation of integers and never learns what a drawable is | §3.4, §4.10 |
| **input (A5)** | `screenToTile` that floors | **taken, and it fixed my naming**: `pickTile` was the odd one out among `gridToWorld` / `worldToGrid` / `worldToTile` / `gridToScreen`. Floors, never rounds | §3.7, T1 |
| **input (A5)** | camera in CSS pixels, out-param `toWorld`/`toScreen` | **confirmed**, and now stated as the reason the camera takes a viewport rather than a canvas. `devicePixelRatio` is `draw`'s, at the point it sets a transform | §3.3 |
| **input (A5)** | `zoom` must not be publicly assignable | **taken — the only real change of the five.** `Camera` is an interface over private state, so the field is unavailable rather than discouraged. Their testability argument is the right one and it is now I27 | §3.3, I27 |
| **input (A5)** | exported mutable `Vec2` and `GridPoint` | **`GridPoint` taken**, and it improved the package: `worldToGrid` and `pathSample` now write `{ gx, gy }` instead of `{ x, y }`, so a grid position can no longer be handed to a world-space function. `Tile` is an alias for the integer case. `Vec2` still wants settling in `core` | §3.0 |
| **input (A5)** | `hitTest(state, camera, sx, sy)` must exist here | **capability yes, signature no.** `iso` cannot name a `state` type. `pickSorted(order, test)` is the function; the state lives in the caller's closure, and `input`'s refusal to know about the world stands intact | §3.7 |
| demo (A10) | sample a position at arc length along a path | **taken**, and it is the module's organising idea, not a helper: `pathSample` / `pathProject` / `pathDirAt` / `Path.arcLength`, plus `pathSimplify` because a sampled staircase wobbles | §3.8, T16, T17 |
| demo (A10) | elevation | **taken**, as a new `height` module: a value per grid **vertex**, bilinear sampling, slope, flatness, and terrain-aware picking. Not a third grid axis | §3.6, §4.2, T15, T18 |
| demo (A10) | weighted terrain cost, cheap recompute on a tile change | **taken**: `TileCost` is a weight, not a boolean, and recompute is full recompute gated on `MutableTileSource.version`. No incremental replanner, with the arithmetic for why | §3.8, §4.9 |
| demo (A10) + input (A5) | who owns tap → grid cell | **iso owns the projection maths; `input` owns the gesture and the composition.** Confirmed without hedge: `input` turns an event into CSS pixels and a tap/drag verdict, then calls `screenToTile`. The reverse split is unbuildable | §3.7 |
| core (A1) | `Rect` / `Bounds` ownership, declined by core | **taken**, in min/max form, space-agnostic, with the ten functions `draw`, `input` and `ui` need so none of them wraps it | §3.0 |
| core (A1) | tier-A determinism | **accepted, and it costs nothing**: no trig, no `pow`, no `log` anywhere in the package, testably (I17). The A* heuristic is integer octile; only `sqrt` is used, for arc length | §3.10 |
| ui (A9) | an anchor for persistent world-attached things | **taken**, and `ui` was right that it must unify with path sampling: both produce a **grid position**, so `Anchor` is three mutable numbers and `pathSample` fills two of them. No class, no registry, no teardown | §3.9, T19 |
| audio (A6) | world position → stereo pan | **taken**: `Camera.normalizedX` and `anchorPan`. It is the third member of the world→screen family, and audio may not depend on `iso` to write it | §3.3, §3.9 |

**Proposed change to `.lattice/kit.json`.** `packages.iso.modules` should gain **`height`**;
`Rect`, `Anchor` and `normalizedX` fold into the existing `projection` and `camera` modules
without a new file. The `exports` list will be long — around seventy symbols — and that is the
honest cost of being the kit's spatial layer; if the reviewer wants it shorter, the candidates
to cut are the `rect*` helpers (`draw` and `ui` would then each write four of them) and the
scalar `gridToWorldX`/`Y` forms (at a measurable per-frame cost).

Two of `iso`'s three listed invariants in `kit.json` should also be restated, because the
routings sharpened them:

- *"Hit-testing is computed from state and camera, never cached during a draw pass"* — still
  right, and now joined by **"picking walks the same sorted order that painted, backwards"**,
  which is the half that `draw` and `iso` have to agree on (I9).
- Add: **"No public function returns a freshly constructed object"** (I26). It is the
  constitution's rule 7 restated as something a reviewer can check by reading the `.d.ts`, and
  `draw` has made the case that it is load-bearing rather than stylistic.

### 7.2 What still has no owner

Things a game developer would otherwise hand-roll on top of Lattice. None is mine to build.

**`@lattice/core` (A1) — nothing outstanding. All of it closed, one way or the other.**

- **`Vec2` — granted, in the shape asked for.** `Vec2` assignable to `ReadonlyVec2` and not the
  reverse, one type to declare and one that appears only in signatures, no `MutableVec2` in the
  kit. `iso` imports both and declares neither (§3.0).
- **The priority queue — refused, and correctly.** The heap is mine, unexported, built to the
  Lattice ordering rule that core took in its place (§4.12). The rule is the part that could not
  be duplicated, and it now binds `DepthSorter` as well as the path heap.
- **`hash2` — granted**, and exactly right for per-tile variation. `iso` reaches it through
  `TileSource.fillFrom` / `tileSourceOf` and holds no `Rng` of its own.
- **`EpochMillis` / `MonotonicMillis` branded — granted, and it lands on me indirectly.**
  Nothing in `iso` takes a time, which is now a structural fact rather than a stated intention:
  there is no parameter in this package a timestamp of either brand could be passed to. The
  branding protects the packages either side of me, and I benefit because `pathSample` is
  parameterised by arc length rather than by `t`, so a walker's position cannot silently
  inherit a clock that runs at quarter speed in a hidden tab.
- **`Scope` / `Disposer` — granted as an interface with a factory**, which suits me: `iso`
  creates no listeners, timers or contexts and therefore returns no disposers at all. If a
  builder finds themselves needing one here, they have put something impure in the wrong
  package.
- `clamp` and `lerp` are assumed to exist in `core/math`; if not, say so and they become
  internals.

**`@lattice/draw` (A3) — the silhouette contract.** `boxSilhouette` returns the six-point outline
in the order north-top, east-top, east-base, south-base, west-base, west-top. `draw`'s solid kit
must stroke a box in that same order, or hit-testing and pixels diverge with no test in either
package noticing. This needs to be one shared assertion, and it is the only genuine coupling
between the two packages. `draw` also owns the storey height (`LEVEL_H ≈ 26`, deliberately not
32 — a one-tile-tall storey reads as a cube and cubes read as programmer art; settled in its
favor at §4.3) and the whole-device-pixel rounding of the camera translate (T13).

**`@lattice/input` (A5) — the camera controller.** Drag, inertia, pinch, edge-scroll and keyboard
pan belong there and must drive this camera only through `panByScreen`, `zoomAt` and
`centerOn` — never by assigning `zoom`, which would skip the clamp and the pointer anchor.
Input's tap/drag discrimination is what decides whether `pickSorted` is called at all.

**`@lattice/draw` (A3) — the light layer is the demo's premise and it is not mine.** The demo
ranks "an emissive glow and a night mask" second only to path sampling, and `iso` contributes
only the geometry: a lamp's pool of light is a world circle, and where it lands on screen is
`anchorToScreen` plus `zoom`. That the pool must be an *ellipse* — a circle on the ground plane
projects 2:1 like everything else — is the kind of thing that will be got wrong once.

**Nobody owns walker steering, and after this RFC that is a smaller gap than it was.** A crowd
that is `s = (t · v + offset) mod arcLength` needs no steering at all, which is the demo's bet.
What is still unowned is the *stateful* walker: one that accelerates, queues at a door, or waits
for another. That needs a clock, so it is `sim`-shaped; my suggestion remains a small `sim/steer`
taking a `Path` or a `FlowField` and a `dt`. It should not be built until a game asks, because
the closed-form crowd may well answer every question the kit gets.

**Nobody owns flow-field invalidation *scheduling*.** The *detection* is now solved —
`MutableTileSource.version` versus `FlowField.builtAtVersion` — but the rebuild is a Dijkstra
sweep and should not run inside the frame that placed the wall. `@lattice/loop`'s scheduler
should own "do this expensive thing on the next idle tick, coalescing duplicates", and if it
does, the whole rockfall beat is the three lines at the end of §3.8.

**`@lattice/persist` (A7) — map serialization.** `TileGrid.data` and `ChunkGrid.forEachChunk`
exist so persist can take the buffers whole. Persist should own the version and the migration;
a base-64 or delta encoding of a chunk grid is worth having as a first-class adapter.
