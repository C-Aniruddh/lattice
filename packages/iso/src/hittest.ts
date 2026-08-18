/**
 * screen → what.
 *
 * **Who owns tap → grid cell.** `iso` owns the geometry, `@latticekit/input` owns the event and
 * the composition, and the composition is one line: `input` turns a `PointerEvent` into
 * CSS-pixel coordinates relative to the viewport, decides whether it was a tap or a drag, and
 * then calls {@link screenToTile}. The inverse split is unbuildable — a `screenToTile` living
 * in `input` would drag the projection, the camera and the heightfield up a layer, and `iso`
 * cannot own the event because it may not name a DOM global. If a builder finds themselves
 * writing a `pointerToTile(ev, …)` here, they have the seam the wrong way round.
 *
 * Three questions, three answers, and the third is the one that replaces the `hitTest(state,
 * camera, sx, sy)` that `input` asked for:
 *
 * | the question | call | returns |
 * |---|---|---|
 * | which cell is under the pointer? | `screenToTile(camera, sx, sy, out)` | a tile, always |
 * | …on terrain with height? | `screenToTileOnHeights(camera, sx, sy, field, maxHeightPx, out)` | a tile, or `false` off-map |
 * | which *object* is under the pointer? | `pickSorted(order, test)` | the caller's insertion index, or `-1` |
 *
 * `iso` cannot take a `state` parameter — it would have to name the type of a thing it is
 * forbidden to know about, which is the whole reason `DepthSorter` holds rectangles. The
 * state lives in the closure the caller already has, and nobody holds a registry or sets a
 * `pickable` flag.
 *
 * **What this file holds is the camera, not the geometry.** Every function here starts by asking
 * the camera where a screen pixel is in the world and then does something a camera has no part
 * in: a floor, a polygon crossing count, or — for the terrain answer — `worldToTileOnHeights`,
 * which lives in `height.ts` because it wants a world point rather than a viewport. That split is
 * what lets `@latticekit/input` reach the same march against the transform it froze when the tick
 * opened, and it is why nothing in this file marches a heightfield itself.
 *
 * **Never cache hit boxes during the draw pass.** An earlier version of the source game
 * recorded tap targets while painting, so any frame the renderer did not run — a backgrounded
 * tab, a throttled `requestAnimationFrame`, a paused loop — left the game visibly showing
 * bubbles that could not be tapped. Everything in this file recomputes from state and camera,
 * every time.
 */

import type { Camera } from './camera.js';
import type { Tile } from './projection.js';
import { HALF_H, HALF_W } from './projection.js';
import type { HeightField } from './height.js';
import { worldToTileOnHeights } from './height.js';

/**
 * The tile under a screen point, on flat ground. **The exact inverse of `gridToScreen` at
 * `zPx = 0`**, and the last member of the conversion family: `gridToWorld`, `worldToGrid`,
 * `worldToTile`, `gridToScreen`, `screenToTile`.
 *
 * **Floors, never rounds.** `Math.round` snaps to the nearest lattice *vertex* and returns
 * the wrong tile over three quarters of the area of every diamond; the symptom is a placement
 * ghost that jumps a tile as the pointer crosses the middle of a tile rather than its edge.
 *
 * `@latticekit/input` resolves this on every pointer event against the camera as the tick
 * opened, so it is on that package's hottest path: two multiplies, two adds and two floors,
 * no allocation and no branch.
 */
export function screenToTile(camera: Camera, sx: number, sy: number, out: Tile): Tile {
  const wx = camera.toWorldX(sx);
  const wy = camera.toWorldY(sy);
  out.gx = Math.floor((wx / HALF_W + wy / HALF_H) / 2);
  out.gy = Math.floor((wy / HALF_H - wx / HALF_W) / 2);
  return out;
}

/**
 * The tile under a screen point **on a heightfield**, or `false` if the ray leaves the map.
 *
 * Needed because the projection stops being invertible once terrain has height: raising a
 * point by 32 world pixels and moving it one tile further north land on *the same screen
 * pixel*, so screen → (grid, z) is one equation short of solvable and {@link screenToTile}
 * will confidently return the flat-ground answer.
 *
 * **This is `worldToTileOnHeights` with a camera in front of it, and the camera is the entire
 * difference.** The march lives in `height.ts` rather than here because it does not want a
 * camera: once a caller holds a world point the answer is pure heightfield geometry, and the
 * caller that needs it most — `@latticekit/input` — resolves every event against the transform it
 * froze as the tick opened, so it has no live camera to hand in. Held as two copies of one
 * bisection the two would drift, and the symptom would be a tap that disagrees with the hover
 * ring drawn under it, with each package's suite green against its own copy. Composed, they
 * cannot. Why the march starts high and walks down, and why it bisects rather than stops at a
 * tolerance, is documented once, on `worldToTileOnHeights`.
 *
 * @param maxHeightPx The tallest terrain on the map, in world pixels, which bounds where the
 *   march starts. Pass it: too small and the march begins below a peak and misses it, too
 *   large and every tap scans ground that is not there. Negative or non-finite throws.
 * @returns `true` with `out` filled, or `false` — leaving `out` untouched — when the ray leaves
 *   the field before it meets ground, or resolves to a tile `heights.has` does not define.
 *   `false` rather than a plausible tile, because a tap on the sky that selects the shore is
 *   worse than a tap that does nothing. **A source whose `has` answers `true` everywhere can
 *   only report the first of those**, which is why an unbounded procedural field needs a real
 *   bound written into it before a tap on the horizon is trusted.
 */
export function screenToTileOnHeights(
  camera: Camera,
  sx: number,
  sy: number,
  field: HeightField,
  maxHeightPx: number,
  out: Tile,
): boolean {
  // Restated rather than inherited from `worldToTileOnHeights`: the message has to name the call
  // the caller actually wrote, or it sends them looking for a function they have never heard of.
  if (!(Number.isFinite(maxHeightPx) && maxHeightPx >= 0)) {
    throw new RangeError(
      `screenToTileOnHeights: expected maxHeightPx to be a finite number >= 0, got ${String(maxHeightPx)}`,
    );
  }
  return worldToTileOnHeights(field, camera.toWorldX(sx), camera.toWorldY(sy), maxHeightPx, out);
}

/**
 * A rectangular volume in a building's local space: offsets and extents in **tiles**,
 * elevation and height in **world pixels**.
 *
 * The units differ because height has no tile. A storey is an art proportion and belongs to
 * `@latticekit/draw`; `iso`'s entire height vocabulary is world pixels. Mixing the two produces
 * buildings a hundred tiles tall, which is at least an obvious failure.
 */
export interface Volume {
  /** Offset of the volume's north corner from the anchor tile, along `+gx`, in tiles. */
  readonly ox: number;
  /** Offset along `+gy`, in tiles. */
  readonly oy: number;
  /** Extent along `+gx`, in tiles. */
  readonly w: number;
  /** Extent along `+gy`, in tiles. */
  readonly d: number;
  /** Elevation of the volume's base above the `z = 0` plane, in world pixels. */
  readonly zPx: number;
  /** Height of the volume itself, in world pixels. */
  readonly hPx: number;
}

/**
 * The screen-space silhouette of one box: six points as `[x0,y0, … x5,y5]` written into `out`.
 *
 * **Six, not eight.** In a 2:1 projection a box's outline is north-top, east-top, east-base,
 * south-base, west-base, west-top; the two remaining corners always project strictly inside
 * that hexagon. Walking eight corners and taking a convex hull would produce the same shape
 * and cost a hull.
 *
 * **The order is a cross-package contract.** `@latticekit/draw`'s solid kit must stroke a box in
 * this same order, or hit-testing and pixels diverge with no test in either package noticing —
 * each is correct against its own idea of the shape. This function is the definition and
 * `draw` is the conformer, which is why the shared assertion lives in this package's suite.
 *
 * Only four `toScreenX` calls happen, because the box's eight corners have four distinct world
 * x values; that is the entire reason `Camera.toScreenX` takes `wx` alone.
 *
 * @param out Length ≥ 12. @throws RangeError otherwise — a short buffer would leave half the
 *   outline as whatever the caller last put there, and a hit test against it would be wrong
 *   only for some taps.
 */
export function boxSilhouette(
  camera: Camera,
  gx: number,
  gy: number,
  volume: Volume,
  out: Float64Array,
): Float64Array {
  if (out.length < 12) {
    throw new RangeError(`boxSilhouette: expected an out buffer of length >= 12, got ${out.length}`);
  }
  const nx = gx + volume.ox;
  const ny = gy + volume.oy;
  const fx = nx + volume.w;
  const fy = ny + volume.d;
  const base = volume.zPx;
  const top = volume.zPx + volume.hPx;

  // Four distinct world x values for the four ground corners; north and south share one only
  // when the footprint is square, so all four are computed.
  const xNorth = camera.toScreenX((nx - ny) * HALF_W);
  const xEast = camera.toScreenX((fx - ny) * HALF_W);
  const xSouth = camera.toScreenX((fx - fy) * HALF_W);
  const xWest = camera.toScreenX((nx - fy) * HALF_W);

  const yNorth = (nx + ny) * HALF_H;
  const yEast = (fx + ny) * HALF_H;
  const ySouth = (fx + fy) * HALF_H;
  const yWest = (nx + fy) * HALF_H;

  out[0] = xNorth;
  out[1] = camera.toScreenY(yNorth - top);
  out[2] = xEast;
  out[3] = camera.toScreenY(yEast - top);
  out[4] = xEast;
  out[5] = camera.toScreenY(yEast - base);
  out[6] = xSouth;
  out[7] = camera.toScreenY(ySouth - base);
  out[8] = xWest;
  out[9] = camera.toScreenY(yWest - base);
  out[10] = xWest;
  out[11] = camera.toScreenY(yWest - top);
  return out;
}

/**
 * Even-odd ray cast against `count` points packed as x,y pairs.
 *
 * Boundary-exact is deliberately not interesting: a pixel either side of an outline is the
 * same tap, so no epsilon is applied and no effort is spent deciding which side of an edge a
 * point exactly on it belongs to. What *is* guaranteed is that the answer depends only on the
 * numbers passed in, so two runs of a replay agree.
 *
 * @param count Points, not numbers — `poly` must hold at least `2 × count` values.
 * @throws RangeError if it does not. Fewer than three points is not an error and is `false`:
 *   a degenerate polygon contains nothing, and throwing would make a caller special-case a
 *   volume that happens to be empty this frame.
 */
export function pointInPolygon(
  sx: number,
  sy: number,
  poly: Float64Array,
  count: number,
): boolean {
  if (poly.length < count * 2) {
    throw new RangeError(
      `pointInPolygon: expected poly to hold ${String(count * 2)} values for ${String(count)} points, got ${String(poly.length)}`,
    );
  }
  if (count < 3) return false;
  let inside = false;
  // The indices below are bounded by the length check above, which is why they are read with
  // a cast rather than a `??` fallback no test could ever reach.
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = poly[i * 2] as number;
    const yi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number;
    const yj = poly[j * 2 + 1] as number;
    if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Is a screen point inside the tile diamond of `(gx, gy)`? Two comparisons, no polygon.
 *
 * The diamond in world space is the unit square in grid space, so the test is: convert to
 * grid, floor, compare. That identity is a property of the 2:1 projection and is the reason
 * this is cheaper than a four-edge test rather than merely tidier.
 *
 * For ground-level targets — a selected tile, a road segment — where the footprint *is* the
 * thing, and as the flat fallback behind silhouette picking: a building is drawn standing
 * *up* from its footprint, so the pixels showing its body sit over the tile behind it, and
 * resolving a tap to the tile under the cursor means tapping the middle of a rack does
 * nothing. Test the silhouette first, and keep this for things so flat that their silhouette
 * is barely taller than the ground.
 */
export function pointInTile(
  camera: Camera,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): boolean {
  const wx = camera.toWorldX(sx);
  const wy = camera.toWorldY(sy);
  return (
    Math.floor((wx / HALF_W + wy / HALF_H) / 2) === gx &&
    Math.floor((wy / HALF_H - wx / HALF_W) / 2) === gy
  );
}
