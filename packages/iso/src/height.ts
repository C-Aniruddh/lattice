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

import { lerp } from '@lattice/core';
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
 * pixels and is an art proportion that lives in `@lattice/draw` with its own pair,
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
