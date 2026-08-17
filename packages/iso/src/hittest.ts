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
import { heightAt } from './height.js';

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
 * How finely the terrain march refines its answer once it has a bracket: `2⁻¹²` of the
 * bracket, which is a fifth of a thousandth of a tile at any sane `stepPx`.
 *
 * A fixed iteration count rather than a tolerance, because the same tap must resolve to the
 * same tile on a slow phone and a fast desktop, and a loop that stops when it is "close
 * enough" stops after a different number of steps when the arithmetic is the same but the
 * clock is not — that is a replay divergence with no stack trace.
 */
const MARCH_REFINEMENTS = 12;

/** Height of the terrain surface at the world point that a raised point `t` above the ground
 *  would project onto, minus `t`. Zero exactly where the screen ray meets the ground. */
function surfaceGap(field: HeightField, wx: number, wy: number, t: number): number {
  const y = wy + t;
  return heightAt(field, (wx / HALF_W + y / HALF_H) / 2, (y / HALF_H - wx / HALF_W) / 2) - t;
}

/**
 * The tile under a screen point **on a heightfield**, or `false` if the ray leaves the map.
 *
 * Needed because the projection stops being invertible once terrain has height: raising a
 * point by 32 world pixels and moving it one tile further north land on *the same screen
 * pixel*, so screen → (grid, z) is one equation short of solvable and {@link screenToTile}
 * will confidently return the flat-ground answer.
 *
 * So this marches instead. A screen pixel corresponds to a whole family of candidate ground
 * positions, one for each elevation `t`: larger `t` means a candidate nearer the viewer. The
 * surface the player can *see* is the nearest one, so the march starts at `maxHeightPx` and
 * works down, taking the first elevation at which the terrain actually reaches the ray, then
 * refines the bracket by bisection — the terrain is bilinear and therefore continuous, which
 * is what makes bisection sound here.
 *
 * @param maxHeightPx The tallest terrain on the map, in world pixels, which bounds where the
 *   march starts. Pass it: too small and the march begins below a peak and misses it, too
 *   large and every tap scans ground that is not there. Negative or non-finite throws.
 * @returns `true` with `out` filled, or `false` — leaving `out` untouched — when the pixel
 *   resolves to a tile the field does not define. `false` rather than a plausible tile,
 *   because a tap on the sky that selects the shore is worse than a tap that does nothing.
 */
export function screenToTileOnHeights(
  camera: Camera,
  sx: number,
  sy: number,
  field: HeightField,
  maxHeightPx: number,
  out: Tile,
): boolean {
  if (!(Number.isFinite(maxHeightPx) && maxHeightPx >= 0)) {
    throw new RangeError(
      `screenToTileOnHeights: expected maxHeightPx to be a finite number >= 0, got ${String(maxHeightPx)}`,
    );
  }
  const wx = camera.toWorldX(sx);
  const wy = camera.toWorldY(sy);

  // One step per grid unit of travel along the ray: HALF_H world pixels of elevation move the
  // candidate ground point exactly one unit of `gx + gy` towards the viewer, so no tile of the
  // march can be skipped.
  let hi = maxHeightPx;
  let gapHi = surfaceGap(field, wx, wy, hi);
  let lo = hi;
  let gapLo = gapHi;
  if (gapHi < 0) {
    const steps = Math.ceil(maxHeightPx / HALF_H);
    let found = false;
    for (let i = 1; i <= steps; i++) {
      // The final step is written as an exact zero rather than `max - steps*max/steps`,
      // which is not reliably exact in floating point and would leave the ground plane a
      // hair above where it is.
      lo = i === steps ? 0 : maxHeightPx - (i * maxHeightPx) / steps;
      gapLo = surfaceGap(field, wx, wy, lo);
      if (gapLo >= 0) {
        found = true;
        break;
      }
      hi = lo;
      gapHi = gapLo;
    }
    if (!found) return false;
    // Bisect the bracket. `gapLo >= 0 > gapHi` and the surface is continuous, so the crossing
    // is between them and stays between them at every step.
    for (let i = 0; i < MARCH_REFINEMENTS; i++) {
      const mid = lo + (hi - lo) / 2;
      if (surfaceGap(field, wx, wy, mid) >= 0) lo = mid;
      else hi = mid;
    }
  }

  const y = wy + lo;
  const gx = Math.floor((wx / HALF_W + y / HALF_H) / 2);
  const gy = Math.floor((y / HALF_H - wx / HALF_W) / 2);
  if (!field.heights.has(gx, gy)) return false;
  out.gx = gx;
  out.gy = gy;
  return true;
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
