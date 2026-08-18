/**
 * Elevation — as a layer over the tile map, not a third grid axis.
 *
 * One number per grid **vertex**, read through a sampler, multiplied into a screen-space `y`
 * shift. That buys the valley, the river bank, the ridge, the slope-aware movement cost and
 * the flatness test, and it costs nothing anywhere else in the package: the projection stays
 * linear, the depth sort stays two-dimensional, and a game with flat ground never allocates a
 * byte for it.
 *
 * | in | out |
 * |---|---|
 * | one height per grid vertex, sampled bilinearly | a stack of tiles per column |
 * | a screen-space `y` shift of `-zPx · zoom` | `z` entering the depth key or the occlusion test |
 * | slope, flatness, terrain-aware picking | bridges, overpasses, tunnels, floors above floors |
 *
 * Everything in the left column keeps the projection linear and the sort two-dimensional;
 * everything in the right replaces the depth sort with a different algorithm over a different
 * data structure. A game that wants floors draws one `DepthSorter` per floor in order, which
 * is what every shipped 2:1 game with floors actually does and which this API already
 * supports at no extra cost.
 */

import { lerp } from '@latticekit/core';
import { HALF_H, HALF_W } from './projection.js';
import type { Tile } from './projection.js';
import type { TileSource } from './tilemap.js';

/**
 * A tile layer read as terrain height, plus the world pixels one height unit is worth.
 *
 * Two fields rather than a class, so a game can point one at a `TileGrid` it saves, or at
 * `tileSourceOf(seeded noise)` — unbounded, no edge — and store nothing at all.
 */
export interface HeightField {
  /** The layer. Values are height *units*, whatever the game decided those are — the
   *  conversion to pixels lives in {@link HeightField.stepPx} so an 8-bit grid can hold a
   *  useful range. */
  readonly heights: TileSource;
  /**
   * World pixels per height unit. An art constant the game chooses.
   *
   * `TILE_H / 4` is a good first guess, because four steps of rise per tile is where a 2:1
   * slope stops reading as a slope and starts reading as a wall.
   */
  readonly stepPx: number;
}

/**
 * Height **units** → world pixels. The direction everything in this module already goes:
 * {@link heightAt} and {@link slopeAt} both end in this multiply.
 *
 * It exists as a function so that the reverse can exist as a function — see {@link pxToUnits},
 * which is the one that was missing.
 */
export function unitsToPx(field: HeightField, units: number): number {
  return units * field.stepPx;
}

/**
 * World pixels → height **units**: the inverse of {@link unitsToPx}, and the conversion that
 * was being written by hand at every boundary.
 *
 * Everything this package produces is world pixels — `heightAt`, `slopeAt`, `footprintBase`,
 * `Volume.zPx`. Everything a *game* authors is units: the numbers in the `TileSource` behind
 * {@link HeightField.heights}, the step counts a cost function reasons about, the storey a
 * sprite is drawn at. So `/ field.stepPx` appears wherever the two meet, un-named and
 * un-audited, and a division written by hand is a division nobody can grep for the day
 * `stepPx` changes.
 *
 * The canonical use is the slope half of a movement cost, which this module's own
 * {@link slopeAt} documentation used to spell out as a raw division:
 *
 * ```ts
 * const cost = 1 + (pxToUnits(field, slopeAt(field, gx, gy)) | 0);
 * ```
 *
 * **Units here are the game's, not `draw`'s storeys.** One height unit is `stepPx` world
 * pixels and is whatever the game decided a step of terrain is; one storey is `LEVEL_H` world
 * pixels and is an art proportion that lives in `@latticekit/draw` with its own pair,
 * `levelsToPx`/`pxToLevels`. World pixels are the currency both convert through, and mixing
 * the two conversions gives a building that stands `stepPx / LEVEL_H` of the way up its own
 * hill — close enough to look like a shading bug.
 *
 * @throws nothing. A `stepPx` of zero yields `Infinity` rather than an error: this is
 *   arithmetic on a per-entity path, and a field with no vertical scale is a construction-time
 *   mistake that {@link heightAt} has already flattened to a plane by the time anyone gets
 *   here.
 */
export function pxToUnits(field: HeightField, px: number): number {
  return px / field.stepPx;
}

/**
 * Height in world pixels at a **fractional** grid position, bilinear between the four vertex
 * values the position lies between.
 *
 * **Heights live on grid vertices, not tile centers.** `heights.get(gx, gy)` is the elevation
 * of the *north corner* of tile `(gx, gy)`, so adjacent tiles share their corner values
 * exactly and their drawn quads cannot leave a seam. A center-sampled heightfield needs an
 * averaging pass to close those seams, it is invisible until the terrain is actually drawn,
 * and every game that starts center-sampled rewrites this later.
 *
 * Bilinear rather than nearest because walkers are sampled at fractional positions: a
 * nearest-neighbor height makes a pilgrim climb a hill in visible steps.
 *
 * **Floors before sampling, and that matters most at the origin.** `Math.floor(-0.5)` is
 * `-1`; a truncating `| 0` — and `core.hash2`, which truncates by design — would put `-0.5`
 * and `0.5` in the same cell and leave a one-tile seam running through the world origin.
 */
export function heightAt(field: HeightField, gx: number, gy: number): number {
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const heights = field.heights;
  const h00 = heights.get(ix, iy);
  const h10 = heights.get(ix + 1, iy);
  const h01 = heights.get(ix, iy + 1);
  const h11 = heights.get(ix + 1, iy + 1);
  // `core.lerp` is written as `(1 - t) * a + t * b`, which lands exactly on `a` at t = 0 and
  // exactly on `b` at t = 1. That exactness is what makes this function agree with
  // `heights.get(gx, gy) * stepPx` bit for bit at whole coordinates, which in turn is what
  // lets a placement test and a draw call agree about whether a corner is level.
  return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy) * field.stepPx;
}

/**
 * How finely the terrain march refines its answer once it has a bracket: `2⁻¹²` of the bracket,
 * which is a fifth of a thousandth of a tile at any sane `stepPx`.
 *
 * A fixed iteration count rather than a tolerance, because the same point must resolve to the
 * same tile on a slow phone and a fast desktop, and a loop that stops when it is "close enough"
 * stops after a different number of steps when the arithmetic is the same but the clock is not —
 * that is a replay divergence with no stack trace.
 */
const MARCH_REFINEMENTS = 12;

/** Height of the terrain surface at the world point that a raised point `t` above the ground
 *  would project onto, minus `t`. Zero exactly where the screen ray meets the ground. */
function surfaceGap(field: HeightField, wx: number, wy: number, t: number): number {
  const y = wy + t;
  return heightAt(field, (wx / HALF_W + y / HALF_H) / 2, (y / HALF_H - wx / HALF_W) / 2) - t;
}

/**
 * The tile whose **terrain surface** is drawn at a world point, or `false` if the ray that
 * arrives there never meets the ground.
 *
 * The camera-free half of picking, and the reason it exists as its own function rather than
 * inside `screenToTileOnHeights`: **the camera is not part of this question.** Once a caller has
 * a world point, the march is pure heightfield geometry, and the one caller that most needs it —
 * `@latticekit/input` — deliberately does *not* hold a live camera at the moment it resolves.
 * Every event it delivers resolves through the camera as it stood when the tick opened, so a
 * handler that recenters the view cannot move where a later event in the same bucket landed.
 * Passing it the live camera would reintroduce exactly that bug; passing it a fabricated one
 * would be a lie about which transform froze.
 *
 * ## Why a march at all
 *
 * The projection stops being invertible once terrain has height: raising a point by `HALF_H`
 * world pixels and moving it one unit of `gx + gy` further from the viewer land on *the same*
 * screen pixel, so world → (grid, z) is one equation short of solvable and `worldToTile` will
 * confidently return the flat-ground answer — the tile the ray crosses at sea level, which on a
 * hill is many tiles from the one under the player's finger.
 *
 * So a world point corresponds to a whole family of candidate ground positions, one per
 * elevation `t`, and larger `t` means a candidate nearer the viewer. The surface the player can
 * *see* is the nearest one, so the march starts at `maxHeightPx` and works down in steps of one
 * grid unit of travel, takes the first elevation at which the terrain reaches the ray, then
 * refines the bracket by bisection — the terrain is bilinear and therefore continuous, which is
 * what makes bisection sound here.
 *
 * **`screenToTileOnHeights` is this function with a camera in front of it**, and is where a
 * caller who has a live camera and a screen pixel should go. The two must agree exactly, tile
 * for tile, on every input; until `hittest.ts` is reduced to `camera → world → here`, that
 * agreement is pinned by a test rather than by construction — `packages/input/test/terrain.test.ts`
 * § *the two marches are one march*.
 *
 * @param maxHeightPx The tallest terrain on the map, in world pixels, which bounds where the
 *   march starts. Pass it: too small and the march begins below a peak and misses it, too large
 *   and every pick scans ground that is not there. Negative or non-finite throws.
 * @returns `true` with `out` filled, or `false` — leaving `out` untouched — when the ray leaves
 *   the field before it meets ground, or lands where `heights.has` says there is no map. `false`
 *   rather than a plausible tile, because a tap on the sky that selects the shore is worse than
 *   a tap that does nothing. **A source whose `has` answers `true` everywhere can only report
 *   the first of those**, which is correct for an unbounded procedural world and is why no
 *   caller should treat `true` as proof that a tile exists in *its* own map.
 */
export function worldToTileOnHeights(
  field: HeightField,
  wx: number,
  wy: number,
  maxHeightPx: number,
  out: Tile,
): boolean {
  if (!(Number.isFinite(maxHeightPx) && maxHeightPx >= 0)) {
    throw new RangeError(
      `worldToTileOnHeights: expected maxHeightPx to be a finite number >= 0, got ${String(maxHeightPx)}`,
    );
  }

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
      // The final step is written as an exact zero rather than `max - steps*max/steps`, which is
      // not reliably exact in floating point and would leave the ground plane a hair above where
      // it is.
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
    // Bisect the bracket. `gapLo >= 0 > gapHi` and the surface is continuous, so the crossing is
    // between them and stays between them at every step.
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
 * The steepest rise between any two **edge-adjacent** corners of tile `(gx, gy)`, in world
 * pixels.
 *
 * The four corners of a tile are its own vertex, the two beside it and the far one; the four
 * *edges* between them are what a walker actually climbs, so the diagonals across the quad
 * are deliberately not measured — a tile whose two diagonal corners differ but whose edges do
 * not is a saddle, and a saddle is not steep.
 *
 * The terrain half of a movement cost function: `cost = 1 + (pxToUnits(field, slopeAt(field,
 * gx, gy)) | 0)` is a complete, deterministic "rough ground is slower" rule in one line, and it
 * is what makes a ridge route *shorter but harder* rather than merely shorter. Through
 * {@link pxToUnits} and not a hand-written `/ field.stepPx`, so that the one conversion between
 * this package's pixels and the game's units is greppable.
 *
 * Floors its arguments, because a tile address with a fraction in it is a bug and answering
 * for two different tiles depending on the fraction would hide it.
 */
export function slopeAt(field: HeightField, gx: number, gy: number): number {
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const heights = field.heights;
  const h00 = heights.get(ix, iy);
  const h10 = heights.get(ix + 1, iy);
  const h01 = heights.get(ix, iy + 1);
  const h11 = heights.get(ix + 1, iy + 1);
  const north = h10 - h00;
  const west = h01 - h00;
  const east = h11 - h10;
  const south = h11 - h01;
  const a = north < 0 ? -north : north;
  const b = west < 0 ? -west : west;
  const c = east < 0 ? -east : east;
  const d = south < 0 ? -south : south;
  let worst = a;
  if (b > worst) worst = b;
  if (c > worst) worst = c;
  if (d > worst) worst = d;
  return worst * field.stepPx;
}
