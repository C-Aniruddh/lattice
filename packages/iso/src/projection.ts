/**
 * The lattice itself: grid ↔ world, the rectangle every other package borrows, and the
 * scalar depth key.
 *
 * Three coordinate spaces exist in this kit and conflating them is the bug class this whole
 * package was written to remove:
 *
 * | space | unit | who produces it |
 * |---|---|---|
 * | **grid** | tiles, fractional or whole, fields `gx`/`gy` | game state, {@link worldToGrid}, `pathSample` |
 * | **world** | pixels at zoom 1, fields `x`/`y` | {@link gridToWorldX} and friends |
 * | **screen** | CSS pixels in the viewport | `Camera.toScreenX`/`toScreenY` only |
 *
 * A grid position is a {@link GridPoint} (`gx`/`gy`) and a world or screen position is core's
 * `Vec2` (`x`/`y`), so the type system refuses the mix-up that comments cannot catch.
 *
 * **Everything here is Tier A.** `+ - * /` and comparisons; no `sin`, no `pow`, no `log`, and
 * — because `HALF_W` and `HALF_H` are powers of two — every division in the inverse is exact.
 * That is why {@link worldToGridX} round-trips a grid coordinate bit for bit rather than
 * within an epsilon, and why a replay lands on the same pixel on every engine.
 */

import type { Vec2 } from '@lattice/core';

// ─── the three shared value types ────────────────────────────────────────────────

/**
 * A position in **grid** space, fractional or whole.
 *
 * The fields are `gx`/`gy` and not `x`/`y`, and that is the entire point: a grid position
 * that arrives in a `Vec2` can be handed to a world-space function with nothing to stop it,
 * and the resulting sprite is off by a factor of thirty-two with no error anywhere. Every
 * function here that produces a grid position writes into one of these.
 *
 * Mutable, for the same reason `Vec2` is: it is an output parameter far more often than it is
 * an input, and a readonly variant would force a second type into every signature that fills
 * one.
 */
export interface GridPoint {
  gx: number;
  gy: number;
}

/**
 * A {@link GridPoint} whose components are whole numbers: a tile address.
 *
 * The same shape deliberately, so nothing has to convert at a boundary. `Tile` in a signature
 * promises the value has been floored — never rounded, see {@link worldToTile} — and
 * `GridPoint` says fractions are meaningful there.
 */
export type Tile = GridPoint;

/**
 * **The kit's rectangle**, in min/max form and carrying no coordinate space of its own.
 *
 * `iso` owns it because `iso` is the lowest common ancestor of everyone who needs one: `draw`
 * culls with it, `input` tests hit regions with it, `ui` lays panels out with it, and all
 * three already depend on this package. `core` declined it, correctly — a layer-0 package
 * that accretes convenience types makes every consumer pay for the spatial half of the kit.
 *
 * **Min/max rather than x/y/w/h.** Overlap and containment are what rectangles are for, and
 * in this form each is four comparisons with no arithmetic. In `x/y/w/h` form every one of
 * them recomputes `x + w` at the call site, which is both slower and a place to put the sign
 * wrong. {@link rectFromSize} and {@link rectWidth} close the gap for callers who think in
 * sizes.
 *
 * **The parameter name says which space it is in** — `worldRect`, `screenRect`. A typed
 * wrapper per space was considered and rejected: it doubles the surface and the conversions
 * still have to be written by hand.
 *
 * Mutable, because it is an output parameter as often as it is an input. There is no
 * allocator for it: write the literal `{ minX: 0, minY: 0, maxX: 0, maxY: 0 }` once, at
 * setup, and reuse it — no function in this package returns a rectangle it was not given.
 */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A half-open rectangle of tiles: `gx0 ≤ gx < gx1`, `gy0 ≤ gy < gy1`.
 *
 * Half-open so that adjacent ranges tile the plane without either double-covering a column or
 * leaving a gap. A closed range is off by one in whichever direction its author was not
 * thinking about, once, permanently.
 */
export interface TileRange {
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
}

// ─── the constants ───────────────────────────────────────────────────────────────

/**
 * Tile width in world pixels. **A compile-time constant, not a runtime parameter.**
 *
 * Any other *uniform* tile size is exactly a camera zoom — a game that wants 32×16 runs this
 * lattice at `zoom = 0.5` — so parameterising it would buy a label and cost a projection
 * object threaded through every signature in `draw`, `input` and `ui`, plus two property
 * loads on the innermost line of the frame. A different *aspect* ratio is a different
 * projection and therefore a different package: 2:1 is what makes the inverse exact, the
 * diamond test two half-planes, and the depth key a sum.
 *
 * Even, so {@link HALF_W} is exact and every grid vertex lands on a whole pixel at every
 * power-of-two zoom.
 */
export const TILE_W = 64;

/** Tile depth in world pixels. Exactly half {@link TILE_W} — the 2:1 that defines iso, and
 *  the reason `gx + gy` is a usable depth key at all. */
export const TILE_H = 32;

/** `TILE_W / 2`, spelled out because it appears in every projection and the division would
 *  otherwise be written at each site. Exact: 64 and 32 are powers of two. */
export const HALF_W = 32;

/** `TILE_H / 2`. See {@link HALF_W}. */
export const HALF_H = 16;

/*
 * There is deliberately no `LEVEL_H` here. A storey height is an art proportion, tuned beside
 * face-shading constants that mean nothing in this package, and it belongs to `@lattice/draw`.
 * `iso`'s entire height vocabulary is world pixels — `gridToScreen` takes `zPx`, `Volume`
 * carries `zPx`/`hPx`, `heightAt` returns pixels — so there is no signature here a storey
 * could enter through, and exporting one would publish a number this package never reads.
 */

// ─── grid → world ────────────────────────────────────────────────────────────────

/**
 * grid → world, x only.
 *
 * `+gx` runs down-**right** on screen and `+gy` down-**left**, so `gx + gy` increases towards
 * the viewer — which is exactly {@link depthOf} — and `gx - gy` runs across the screen. Swap
 * the two and every building in the game is rotated ninety degrees.
 *
 * Scalar rather than a point because this is the innermost line of the frame: it returns a
 * number, so it cannot allocate and the engine inlines it. Screen x depends on world x alone,
 * so a caller projecting the eight corners of a box projects four numbers, not eight.
 */
export function gridToWorldX(gx: number, gy: number): number {
  return (gx - gy) * HALF_W;
}

/** grid → world, y only. See {@link gridToWorldX} for why the two axes are separate
 *  functions and why the sign convention is what it is. */
export function gridToWorldY(gx: number, gy: number): number {
  return (gx + gy) * HALF_H;
}

/** grid → world, both axes, written into `out`. Returns `out` so calls chain. Writes a
 *  `Vec2` and not a {@link GridPoint}, because what comes out is world pixels. */
export function gridToWorld(gx: number, gy: number, out: Vec2): Vec2 {
  out.x = (gx - gy) * HALF_W;
  out.y = (gx + gy) * HALF_H;
  return out;
}

// ─── world → grid ────────────────────────────────────────────────────────────────

/**
 * world → grid, x only. Fractional, and the exact inverse of {@link gridToWorldX}.
 *
 * Exact rather than approximately exact: `HALF_W` and `HALF_H` are powers of two, so both
 * divisions are error-free and an integer grid coordinate comes back bit-identical. That is
 * what lets {@link worldToTile} floor with confidence instead of nudging by an epsilon first.
 */
export function worldToGridX(wx: number, wy: number): number {
  return (wx / HALF_W + wy / HALF_H) / 2;
}

/** world → grid, y only. See {@link worldToGridX}. */
export function worldToGridY(wx: number, wy: number): number {
  return (wy / HALF_H - wx / HALF_W) / 2;
}

/** world → grid, both axes, fractional. Writes a {@link GridPoint} — not a `Vec2`, because
 *  what comes out is tiles and handing tiles to a world-space function is trap number one. */
export function worldToGrid(wx: number, wy: number, out: GridPoint): GridPoint {
  const gx = (wx / HALF_W + wy / HALF_H) / 2;
  const gy = (wy / HALF_H - wx / HALF_W) / 2;
  out.gx = gx;
  out.gy = gy;
  return out;
}

/**
 * The tile *containing* a world point.
 *
 * **Floors both components. Never rounds.** `Math.round` snaps to the nearest lattice
 * *vertex*, and a vertex is the shared corner of four diamonds, so rounding returns the wrong
 * tile over three quarters of the area of every one of them. The visible symptom is a
 * placement ghost that jumps a tile as the pointer crosses the middle of a tile rather than
 * its edge, and it is the single most common isometric bug there is.
 *
 * `Math.floor` and not a truncating `| 0`: truncation rounds toward zero, so `-0.5` and `0.5`
 * would both land on tile `0` and the map would have a one-tile seam through the world
 * origin. The same trap sits behind `core.hash2`, which truncates by design.
 */
export function worldToTile(wx: number, wy: number, out: Tile): Tile {
  const gx = (wx / HALF_W + wy / HALF_H) / 2;
  const gy = (wy / HALF_H - wx / HALF_W) / 2;
  out.gx = Math.floor(gx);
  out.gy = Math.floor(gy);
  return out;
}

/**
 * Painter's-algorithm scalar key: larger draws later, i.e. nearer the viewer.
 *
 * Taken at the footprint's **far** corner — `(gx + w) + (gy + d)` — so a 2×2 building sorts
 * as if it stood on the tile nearest the camera. Without the extent terms a large building
 * draws behind the small one beside it. With the extents defaulting to zero the key
 * degenerates to `gx + gy`, which is the right key for a point.
 *
 * **This is a tie-break, not the order.** A scalar cannot express "beside": a pedestrian well
 * down the map but far to the left of a building has a larger key and gets drawn straight
 * through its wall at second-storey height. That was a real, player-found bug. The relation
 * that is actually true is *a ends before b begins on either axis*, which is not a total
 * order, which is why {@link DepthSorter} is a topological sort that falls back to this rather
 * than a comparator handed to `Array.sort`.
 */
export function depthOf(gx: number, gy: number, w = 0, d = 0): number {
  return gx + w + (gy + d);
}

/**
 * Does a grid-space segment project to a **vertical line with no screen width** — is it edge-on
 * to the camera?
 *
 * World x is `(gx − gy) · HALF_W` and nothing else, so a segment whose `gx` and `gy` change by
 * the *same* amount has a world-x delta of exactly zero. On screen it is a line. This is not a
 * degenerate case in the numerical sense — every number involved is finite and the projection is
 * doing precisely what it promises — which is why it is silent, and why it has to be a named
 * predicate rather than a paragraph somebody reads afterwards.
 *
 * | segment | `dgx`, `dgy` | on screen |
 * |---|---|---|
 * | along `+gx` | `1, 0` | down-right, full width |
 * | along the `(1, 1)` diagonal | `1, 1` | **straight down, zero width** |
 * | along the `(1, −1)` diagonal | `1, −1` | straight across, zero height — thin, but visible |
 *
 * The trap it names: a wall, fence, hedge or run of flags drawn between two grid points that
 * differ equally in `gx` and `gy` has no width to draw. Nothing throws, nothing warns, and the
 * art is simply not there. Test the two endpoints before drawing — or, better, in the assertion
 * a drawing kit runs in development — and either refuse the call or say which two tiles were
 * asked for.
 *
 * A zero-length segment answers `true`: a point also has no width, and it is the same bug
 * arriving from a different direction. A segment with a `NaN` coordinate answers `false`; this
 * asks about the projection, not about whether the coordinates are worth projecting.
 */
export function isEdgeOn(gx0: number, gy0: number, gx1: number, gy1: number): boolean {
  return gx1 - gx0 === gy1 - gy0;
}

// ─── geometry ────────────────────────────────────────────────────────────────────

/**
 * The four world-space corners of a tile diamond, clockwise from the north vertex, written
 * into `out` as `[x0,y0, x1,y1, x2,y2, x3,y3]`.
 *
 * North, east, south, west — north is the `(gx, gy)` grid vertex, and the diamond is the unit
 * cell whose other three corners are `(gx+1, gy)`, `(gx+1, gy+1)` and `(gx, gy+1)`.
 *
 * **World space, not screen**, so a caller can cache ground geometry once and re-apply the
 * camera every frame; a screen-space version would have to be rebuilt on every pan.
 *
 * @param out Length ≥ 8. @throws RangeError otherwise, naming the length it got — a short
 *   buffer would otherwise write `undefined` into three of the four corners and the tile
 *   would silently collapse to a line.
 */
export function tileDiamond(gx: number, gy: number, out: Float64Array): Float64Array {
  if (out.length < 8) {
    throw new RangeError(`tileDiamond: expected an out buffer of length >= 8, got ${out.length}`);
  }
  const cx = (gx - gy) * HALF_W;
  const cy = (gx + gy) * HALF_H;
  out[0] = cx;
  out[1] = cy;
  out[2] = cx + HALF_W;
  out[3] = cy + HALF_H;
  out[4] = cx;
  out[5] = cy + TILE_H;
  out[6] = cx - HALF_W;
  out[7] = cy + HALF_H;
  return out;
}

/**
 * The world-space box of a `w × d` footprint standing `heightPx` world pixels tall.
 *
 * The top edge extends **upward by the height**, which is the only reason a tall building
 * whose base is below the viewport still draws its roof. A culler that forgets it pops
 * skylines in and out along the bottom edge of the screen.
 *
 * @param heightPx Measured from the `z = 0` plane, **not** from the ground under the
 *   footprint. On a heightfield pass `footprintBase(field, f) + ownHeight`. There is
 *   deliberately no separate base parameter: a box standing on flat ground and one standing
 *   on a ridge need the same single number, and two numbers invite passing one of them twice.
 */
export function footprintBounds(
  gx: number,
  gy: number,
  w: number,
  d: number,
  heightPx: number,
  out: Rect,
): Rect {
  // The extreme world x values are at the west corner (gx, gy+d) and the east corner
  // (gx+w, gy); the extreme y values are at the north corner (gx, gy) and the south corner
  // (gx+w, gy+d). Writing them as four expressions rather than four projections and a
  // min/max is not micro-optimization — a min/max over projected corners is where a sign
  // error hides, because it still produces a plausible rectangle.
  out.minX = (gx - gy - d) * HALF_W;
  out.maxX = (gx + w - gy) * HALF_W;
  out.minY = (gx + gy) * HALF_H - heightPx;
  out.maxY = (gx + w + gy + d) * HALF_H;
  return out;
}

/**
 * The world box of a whole rectangle of tiles — the value `CameraOptions.bounds` wants.
 *
 * Identical arithmetic to {@link footprintBounds}; it exists under its own name because a
 * caller reading `tileBounds(0, 0, 48, 48, 0, worldRect)` at a camera construction site is
 * not thinking about footprints, and a shared name would make the island's extent look like
 * a building.
 *
 * **It takes an `out`**, where the RFC's sketch returned a fresh `Rect`. Nothing this package
 * exports returns an object the caller did not hand in — that rule is checkable by reading
 * the emitted `.d.ts`, and one setup-time exception is how it stops being checkable.
 *
 * @param heightPx Required rather than defaulted, so that the one number a culler forgets is
 *   the one number the signature makes you type. Pass `0` for ground-level bounds.
 */
export function tileBounds(
  gx: number,
  gy: number,
  w: number,
  d: number,
  heightPx: number,
  out: Rect,
): Rect {
  return footprintBounds(gx, gy, w, d, heightPx, out);
}

// ─── Rect ────────────────────────────────────────────────────────────────────────

/** Set all four edges at once. Returns `out` so calls chain. */
export function rectSet(out: Rect, minX: number, minY: number, maxX: number, maxY: number): Rect {
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;
  return out;
}

/** From a position and a size — the form `ui` and `input` think in, and the only place in
 *  this package where `x + w` is computed, which is the point of storing min/max. */
export function rectFromSize(out: Rect, x: number, y: number, w: number, h: number): Rect {
  out.minX = x;
  out.minY = y;
  out.maxX = x + w;
  out.maxY = y + h;
  return out;
}

/** Width. Negative for an inverted rectangle rather than clamped to zero, because a negative
 *  width is a bug worth seeing and {@link rectIsEmpty} is the test that names it. */
export function rectWidth(r: Readonly<Rect>): number {
  return r.maxX - r.minX;
}

/** Height. See {@link rectWidth}. */
export function rectHeight(r: Readonly<Rect>): number {
  return r.maxY - r.minY;
}

/** Center x. Written as `min/2 + max/2` rather than `(min + max) / 2` — or `min + (max -
 *  min) / 2`, which overflows the same way — so that the default ±1e4 bounds scaled up to a
 *  really large world still finds its own middle instead of `Infinity`. Halving is exact in
 *  binary, so this loses nothing for ordinary values. */
export function rectCenterX(r: Readonly<Rect>): number {
  return r.minX * 0.5 + r.maxX * 0.5;
}

/** Center y. See {@link rectCenterX}. */
export function rectCenterY(r: Readonly<Rect>): number {
  return r.minY * 0.5 + r.maxY * 0.5;
}

/** Is the point inside? **Half-open on the max edges**, so a plane tiled with rectangles
 *  assigns every point to exactly one of them instead of double-counting the seams. */
export function rectContains(r: Readonly<Rect>, x: number, y: number): boolean {
  return x >= r.minX && x < r.maxX && y >= r.minY && y < r.maxY;
}

/** Do two rectangles share any area? Touching edges do not count, which is the same
 *  half-open convention as {@link rectContains} and keeps "adjacent" and "overlapping"
 *  distinguishable — a placement check needs them to be. */
export function rectIntersects(a: Readonly<Rect>, b: Readonly<Rect>): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** Grow (or, with a negative margin, shrink) in place. The culling margin and the tap slop.
 *  A shrink past the middle inverts the rectangle rather than clamping — see
 *  {@link rectIsEmpty}, which is how you find out. */
export function rectExpand(out: Rect, margin: number): Rect {
  out.minX -= margin;
  out.minY -= margin;
  out.maxX += margin;
  out.maxY += margin;
  return out;
}

/** `out` becomes the smallest rectangle containing both. `out` may alias `a` or `b`: every
 *  component is read before any is written, which is the same aliasing rule `core`'s vectors
 *  keep and for the same reason — the callers who reuse buffers are the careful ones. */
export function rectUnion(out: Rect, a: Readonly<Rect>, b: Readonly<Rect>): Rect {
  const minX = a.minX < b.minX ? a.minX : b.minX;
  const minY = a.minY < b.minY ? a.minY : b.minY;
  const maxX = a.maxX > b.maxX ? a.maxX : b.maxX;
  const maxY = a.maxY > b.maxY ? a.maxY : b.maxY;
  out.minX = minX;
  out.minY = minY;
  out.maxX = maxX;
  out.maxY = maxY;
  return out;
}

/**
 * Reset to the inverted-infinity rectangle, so a loop of {@link rectUnion} accumulates a
 * bounding box correctly from zero items.
 *
 * Without it the first item has to be special-cased at every call site, and one of those call
 * sites will forget and start the box at the origin — which produces a bounding box that
 * always contains `(0, 0)` and a cull that draws the whole map whenever the camera is near
 * the middle of it.
 */
export function rectMakeEmpty(out: Rect): Rect {
  out.minX = Infinity;
  out.minY = Infinity;
  out.maxX = -Infinity;
  out.maxY = -Infinity;
  return out;
}

/** True when the rectangle encloses no area, including the {@link rectMakeEmpty} state and
 *  any rectangle whose edges have crossed. A zero-width rectangle is empty: it contains no
 *  point under the half-open rule, so any other answer would contradict
 *  {@link rectContains}. */
export function rectIsEmpty(r: Readonly<Rect>): boolean {
  return !(r.maxX > r.minX && r.maxY > r.minY);
}
