/**
 * The terrain tile: one diamond, **four corner heights**, and the shading that makes them read.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.**
 *
 * `iso` ships a heightfield; the rest of this package draws flat things at one `z`. This module
 * is the whole of what sits between those two facts. {@link isoTile} and `isoPatch` take a single
 * elevation, so a game with relief in it either draws terraces — a staircase, visibly wrong at
 * every zoom — or assembles the quad itself out of `gridToScreen` and `surface.poly`. The kit had
 * a **Terrain pass** and no primitive that fitted one, and the first heightfield exhibit built
 * against it wrote this function into a game file, where the next ten would each have written it
 * again slightly differently.
 *
 * ## Heights live on vertices, and that is why this takes a `HeightField`
 *
 * `heights.get(gx, gy)` is the elevation of the **north corner** of tile `(gx, gy)` — `iso`'s
 * rule, not a convention this module invented. Adjacent tiles therefore share their corner values
 * *exactly*, and two quads drawn from them cannot leave a seam. A game that sampled a height per
 * tile *center* and averaged its neighbours would leave hairline gaps that open and close as the
 * camera moves, and no amount of care in this file could close them: the fix is upstream, in
 * which lattice the numbers live on.
 *
 * ## The relief term, and the direction the sun comes from
 *
 * A tile painted at one flat color is a rug with a map printed on it. What turns it into ground
 * is that its color knows which way it tilts — and in a 2:1 projection there is exactly one tilt
 * worth measuring.
 *
 * The four corners project to four screen points, and **east and west land on the same screen
 * row**: screen `y` runs with `gx + gy`, which is `gx + gy + 1` at both of them. They are also the
 * two extremes in screen `x`. So the east→west difference is the tile's slope along the *screen
 * horizontal*, and every other combination of corners is some mixture of that and a slope the
 * projection cannot show.
 *
 * That axis is also the sun's. This kit lights from the front-left: `FACE_LEFT` — the `+gy` face,
 * screen-left — is brighter than `FACE_RIGHT`, the `+gx` face, and `ROOF_NEAR` is brighter than
 * `ROOF_FAR` for the same reason. A ground plane is lit in proportion to how much its normal
 * points `-gx, +gy`, which happens exactly when its height *rises* toward the east corner. Hence
 * `east − west`, and hence a slope descending toward screen-left is the bright one.
 *
 * **The sign is the part that is easy to get wrong and impossible to see.** Inverted, terrain
 * still looks like terrain — it looks like terrain lit from the right — while every building
 * standing on it is lit from the left, and the picture reads as flat for a reason no screenshot
 * names. The exhibit this module was extracted from had it inverted.
 */

import type { HeightField } from '@latticekit/iso';
import type { Ink, Rgba } from './color.js';
import { shade } from './color.js';
import { put } from './solids.js';
import type { Pen } from './surface.js';

/**
 * How much of a saturated cross-slope reaches the tile's color.
 *
 * At 0.32 a cliff face is about a third brighter or darker than the flat ground beside it, which
 * is enough to read the shape of a valley from a static screenshot. Above about 0.5 the ground
 * separates into bands and stops looking like one surface; below about 0.15 a hillside and a
 * meadow are the same color and the relief only exists in the silhouette.
 */
const RELIEF_TINT = 0.32;

/**
 * The cross-slope, in **height units per tile**, at which the relief term saturates.
 *
 * Height units rather than pixels, so a game that picks a coarser `stepPx` gets the same picture
 * rather than a darker one: the whole point of `HeightField.stepPx` is that a game chooses what a
 * unit is worth. One and a half units across a tile is roughly where a 2:1 slope stops reading as
 * a slope and starts reading as a wall, so beyond it the extra steepness has nowhere to go —
 * clamped rather than continued, or a cliff comes out black and the ridge above it disappears.
 */
const RELIEF_SPAN = 1.5;

/** Seam width in CSS pixels, matching the solid kit's silhouette stroke: one, and it stays one
 *  across a pan because `Pen.snapX` puts the geometry on whole device pixels. */
const SEAM_W = 1;

/**
 * One terrain tile, drawn on its own four corner heights.
 *
 * The quad is `(gx, gy)`, `(gx+1, gy)`, `(gx+1, gy+1)`, `(gx, gy+1)` — north, east, south, west,
 * `iso`'s order — each lifted by the height field's own value at that **vertex**. The fill is
 * `fill` shaded by `tint` plus the relief term this module's header derives.
 *
 * Returns **the color it actually painted**, because a caller almost always needs it: a second
 * pass over the same tile — a water glint, a wetness wash, the hairline seam below — has to be a
 * relative of the tile's own hue or the ground stops being one surface. Returning it is also what
 * stops a game from recomputing the relief itself and drifting away from what was drawn.
 *
 * **The four projected corners are left in `pen.xy[0…7]`**, so that second pass costs no
 * projection at all: `pen.surface.poly(pen.xy, 4, glint)` covers exactly this tile. Like every
 * other use of that buffer, the values survive only until the next primitive writes to it.
 *
 * @param tint A multiplier on `fill` before relief is added. This is where a game folds in its
 *   own texture — a coarse patchwork of fields, a per-tile grain, a wetness — so that the kit's
 *   relief and the game's noise compose inside **one** `shade` call. Two `shade` calls in series
 *   is not the same color: `shade` pulls toward a cool or a warm tint by distance from neutral,
 *   so shading twice tints twice and the ground goes muddy. Default 1 — relief alone.
 * @param stroke A seam around the whole tile. Omitted, there is none; a game that wants the
 *   two-edge hairline that reads as a fold in turf strokes `pen.xy` itself with three points.
 * @throws RangeError if `tint` is not finite. A `NaN` here paints a tile that is silently absent,
 *   and a hole in terrain is read as a missing chunk rather than as a bad number.
 */
export function isoTerrain(
  pen: Pen,
  field: HeightField,
  gx: number,
  gy: number,
  fill: Ink,
  stroke?: Ink,
  tint = 1,
): Rgba {
  if (!Number.isFinite(tint)) {
    throw new RangeError(`isoTerrain: expected a finite tint, got ${String(tint)}`);
  }
  // Floored, because a tile address with a fraction in it is a bug and answering for two
  // different tiles depending on the fraction is how it stays one.
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const heights = field.heights;
  const step = field.stepPx;
  // `heights.get(ix, iy) * stepPx` rather than four `heightAt` calls: `iso` documents that the
  // two agree bit for bit at whole coordinates — it is what lets a placement test and a draw
  // call agree about whether a corner is level — and this is the innermost loop of the Terrain
  // pass, where the bilinear form would do sixteen lookups to answer with four numbers.
  const north = heights.get(ix, iy) * step;
  const east = heights.get(ix + 1, iy) * step;
  const south = heights.get(ix + 1, iy + 1) * step;
  const west = heights.get(ix, iy + 1) * step;

  let at = put(pen, 0, ix, iy, north);
  at = put(pen, at, ix + 1, iy, east);
  at = put(pen, at, ix + 1, iy + 1, south);
  put(pen, at, ix, iy + 1, west);

  // East minus west is the slope along the screen horizontal, which is the sun's own axis. See
  // the module header for why it is these two corners and not any of the other four pairs. The
  // guard is for `stepPx` at or below zero — a field a game has flattened deliberately, where
  // the honest answer is no relief and the arithmetic's answer would be `0 / 0`.
  const span = step * RELIEF_SPAN;
  const cross = span > 0 ? (east - west) / span : 0;
  const relief = cross > 1 ? 1 : cross < -1 ? -1 : cross;
  const painted = shade(pen.palette.ink(fill), tint + relief * RELIEF_TINT);
  pen.surface.poly(pen.xy, 4, painted);
  if (stroke !== undefined) {
    pen.surface.stroke(pen.xy, 4, true, pen.palette.ink(stroke), SEAM_W);
  }
  return painted;
}
