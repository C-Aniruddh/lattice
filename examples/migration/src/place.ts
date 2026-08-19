/**
 * One grid vertex, at one elevation, in screen pixels — the three lines every art module here
 * would otherwise write for itself.
 *
 * @art
 *
 * Delete this file and nothing computes a different number; two other art modules simply stop
 * compiling. It holds no state and decides nothing, and it exists because of a seam worth naming.
 *
 * ## The seam
 *
 * `iso.gridToScreen(camera, gx, gy, zPx, out)` is the public projection and it is correct. It is
 * also **not the projection `@latticekit/draw` uses**: every primitive in the solid kit adds
 * `pen.snapX` / `pen.snapY` to each corner it produces, the sub-pixel correction that lands the
 * world origin on a whole device pixel and stops one-pixel strokes shimmering across a pan.
 * `draw` has an internal `put` that does both, and it is not in the package's barrel.
 *
 * So a game drawing any geometry of its own beside the kit's — a stencilled numeral on a terrace,
 * a bar on the side of a crate, a plaque at the foot of a riser — either adds the snap by hand or
 * draws in a coordinate space a fraction of a pixel away from everything around it, and the
 * symptom is a decal that crawls against its own ground while the camera moves. Adding it by hand
 * is what this file is, and that it has to exist at all is filed as a kit finding.
 */
import type { Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import type { Pen } from '@latticekit/draw';

/** Scratch, so a projection per corner per crate allocates nothing. Never retained: read both
 *  components out before the next call, exactly as `Pen.xy` asks. */
export const at: Vec2 = { x: 0, y: 0 };

/** Project into {@link at}, in the same space `draw`'s own primitives use. Returns it so calls
 *  read as expressions. */
export function place(pen: Pen, gx: number, gy: number, zPx: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, zPx, at);
  at.x += pen.snapX;
  at.y += pen.snapY;
  return at;
}
