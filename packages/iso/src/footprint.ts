/**
 * Footprints: the grid rectangle a thing stands on, and the four questions a placement system
 * asks about one.
 *
 * A footprint is `w × d` tiles with its north corner at `(gx, gy)`. Occupancy, flatness, base
 * height and attachment point are four *separate* questions on purpose — the oil press needs
 * flat riverside ground *and* free ground, and a system that conflates the two gives an error
 * message naming the wrong reason, which is worse than no message.
 */

import type { HeightField } from './height.js';
import type { Anchor } from './anchor.js';

/**
 * An axis-aligned footprint on the ground: `w × d` tiles with its north corner at `(gx, gy)`.
 *
 * **`w` runs along `+gx` (down-right on screen) and `d` along `+gy` (down-left).** Getting
 * those two the wrong way round rotates every building in the game by ninety degrees, and it
 * is the single most common mistake in a first placement system — the symptom is that square
 * buildings look fine and every rectangular one is wrong.
 *
 * Read-only, because unlike the out-parameter types in this package a footprint is a property
 * of a placed thing rather than scratch space, and a footprint that changes under a sorter is
 * a draw order that changes under a renderer.
 */
export interface Footprint {
  /** Grid x of the north corner. */
  readonly gx: number;
  /** Grid y of the north corner. */
  readonly gy: number;
  /** Extent along `+gx`, in tiles. */
  readonly w: number;
  /** Extent along `+gy`, in tiles. */
  readonly d: number;
}

/** Does this footprint cover tile `(gx, gy)`? **Half-open**: the far edge is not covered, so
 *  two footprints laid edge to edge cover every tile exactly once. */
export function footprintContains(f: Footprint, gx: number, gy: number): boolean {
  return gx >= f.gx && gx < f.gx + f.w && gy >= f.gy && gy < f.gy + f.d;
}

/** Do two footprints share any tile? The whole of a placement-legality check, and half-open
 *  on the same edges as {@link footprintContains}, so buildings may touch but not overlap. */
export function footprintOverlaps(a: Footprint, b: Footprint): boolean {
  return a.gx < b.gx + b.w && b.gx < a.gx + a.w && a.gy < b.gy + b.d && b.gy < a.gy + a.d;
}

/**
 * Call `fn` once per tile of a footprint, in row-major grid order (`gy` outer, `gx` inner).
 *
 * A callback rather than an array of `{ gx, gy }`, because the alternative allocates `w × d`
 * objects every time a player drags a placement ghost across the map — sixty times a second,
 * for as long as they are deciding.
 *
 * Whole tiles only: a footprint at a fractional position visits the tiles from `ceil` of its
 * corner, which is what "the tiles this occupies" has to mean when the answer must be
 * countable.
 */
export function forEachFootprintTile(f: Footprint, fn: (gx: number, gy: number) => void): void {
  const x0 = Math.ceil(f.gx);
  const y0 = Math.ceil(f.gy);
  const x1 = f.gx + f.w;
  const y1 = f.gy + f.d;
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) fn(gx, gy);
  }
}

/**
 * How far from flat the ground under a footprint is, in world pixels: the largest vertex
 * height minus the smallest, over the `(w + 1) × (d + 1)` vertices it stands on.
 *
 * `(w + 1) × (d + 1)` and not `w × d`, because heights live on vertices: a 1×1 building rests
 * on four corners, not one. Sampling the tile origins instead misses the far edge of the
 * footprint entirely, which is exactly where a building on the lip of a cliff is wrong.
 *
 * Placement legality is `footprintFlatness(field, f) <= tolerance`, and it is a **separate**
 * question from occupancy. Returns `0` on level ground, so `<= 0` is the strict test, and it
 * is invariant under adding a constant to the whole field — a difference, not an absolute —
 * so raising sea level does not make the whole map unbuildable.
 */
export function footprintFlatness(field: HeightField, f: Footprint): number {
  const heights = field.heights;
  let lo = Infinity;
  let hi = -Infinity;
  for (let dy = 0; dy <= f.d; dy++) {
    for (let dx = 0; dx <= f.w; dx++) {
      const h = heights.get(f.gx + dx, f.gy + dy);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  if (hi < lo) return 0;
  return (hi - lo) * field.stepPx;
}

/**
 * The height a footprint's base should be drawn at, in world pixels: the **maximum** vertex
 * height under it.
 *
 * The maximum rather than the mean, because a building resting on the mean of a slope has one
 * corner buried in the hill and one floating — and a floating corner reads as a bug where a
 * buried one reads as foundations.
 *
 * Returns `0` for a degenerate footprint with no vertices, which is the flat-ground answer and
 * the only one that does not propagate an `-Infinity` into a draw call.
 */
export function footprintBase(field: HeightField, f: Footprint): number {
  const heights = field.heights;
  let hi = -Infinity;
  for (let dy = 0; dy <= f.d; dy++) {
    for (let dx = 0; dx <= f.w; dx++) {
      const h = heights.get(f.gx + dx, f.gy + dy);
      if (h > hi) hi = h;
    }
  }
  if (hi === -Infinity) return 0;
  return hi * field.stepPx;
}

/**
 * The {@link Anchor} a footprint's label, ring, bubble or confirm control should hang from:
 * the **centre** of the footprint, raised by `heightPx`.
 *
 * The centre and not the origin corner — on a 3×3 those are most of a building apart, and
 * anchoring UI to the corner is what makes a confirm button appear to belong to the building
 * next door.
 *
 * It produces an anchor rather than a screen point on purpose: the attachment point is a
 * property of the *building*, so it is computed once when the building is placed, not sixty
 * times a second against a camera that has not moved.
 */
export function footprintAnchor(f: Footprint, heightPx: number, out: Anchor): Anchor {
  out.gx = f.gx + f.w / 2;
  out.gy = f.gy + f.d / 2;
  out.zPx = heightPx;
  return out;
}
