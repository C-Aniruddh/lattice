/**
 * The subtractive half of the lighting: what grounds a building, and what dims a whole frame.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.**
 *
 * Both operations here are *per object* and *immediate*. That is the line between this module
 * and `light.ts`, whose field is per frame, accumulated into its own buffer and composited
 * once. Folding the two together would put two opposite lifecycles in one file, and the
 * accumulate-then-composite shape is the only one in which two pools of light meet without a
 * seam — so the merge would quietly cost the demo its premise.
 */

import { HALF_H, HALF_W } from '@lattice/iso';
import type { Ink } from './color.js';
import { SHADE_TINT, withAlpha } from './color.js';
import { levelsToPx } from './solids.js';
import type { Pen } from './surface.js';

/** How far a contact shadow spreads past the footprint it sits under. Just over 1, so the
 *  shadow reads as contact rather than as a mat the building was placed on. */
const SHADOW_SPREAD = 1.05;

/** Peak opacity at the center of a contact shadow at full strength. Above about 0.45 the
 *  ground stops reading as ground; below about 0.2 the building floats again. */
const SHADOW_ALPHA = 0.34;

/**
 * A soft contact shadow under a footprint.
 *
 * One `softEllipse`, not a blurred copy of the silhouette: a real drop shadow costs a filter
 * pass per building and buys nothing at this scale. **Grounding is the whole point** — without
 * it, buildings look pasted onto the grass, and no amount of detail on the buildings fixes it.
 *
 * The ellipse is 2:1 like everything else lying flat in this world. `strength` at or below 0
 * draws nothing, so a building that is being carried by a crane simply passes 0.
 *
 * @param z The ground the shadow lands on, in **storeys** — like every other height in this
 *   package, and unlike `iso`, whose elevations are all world pixels. Without it every shadow is
 *   painted at sea level, so on a heightfield the building climbs the hill and its shadow stays
 *   in the valley: the one part of a sprite whose whole job is to say *the object is here* is
 *   then the one part pointing somewhere else. A ground elevation read out of `iso` is pixels —
 *   convert it with `pxToLevels`, or let {@link drawSprite} do it, which is where a sprite's
 *   ground crosses over exactly once.
 */
export function contactShadow(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  strength = 1,
  z = 0,
): void {
  if (!(strength > 0)) return;
  const cam = pen.camera;
  const cgx = gx + w / 2;
  const cgy = gy + d / 2;
  const cx = cam.toScreenX((cgx - cgy) * HALF_W) + pen.snapX;
  const cy = cam.toScreenY((cgx + cgy) * HALF_H - levelsToPx(z)) + pen.snapY;
  const rx = ((w + d) / 2) * HALF_W * cam.zoom * SHADOW_SPREAD;
  const alpha = strength > 1 ? 1 : strength;
  pen.surface.softEllipse(
    cx,
    cy,
    rx,
    rx / 2,
    withAlpha(SHADE_TINT, SHADOW_ALPHA * alpha),
    withAlpha(SHADE_TINT, 0),
  );
}

/**
 * A full-viewport wash — dusk tint, brownout, pause dim. One quad.
 *
 * Screen space, so it takes no camera and is unaffected by the snap: it covers the surface
 * exactly regardless of where the world is. Call it from the Overlay or Effects pass; calling
 * it from Solids paints it under the buildings drawn after it, which looks like the wash simply
 * failed to apply.
 *
 * Not a substitute for a `LightField`. A wash has no edge, and "you can see exactly where the
 * light stops" is a statement about edges.
 */
export function wash(pen: Pen, color: Ink): void {
  const xy = pen.xy;
  const w = pen.surface.width;
  const h = pen.surface.height;
  xy[0] = 0;
  xy[1] = 0;
  xy[2] = w;
  xy[3] = 0;
  xy[4] = w;
  xy[5] = h;
  xy[6] = 0;
  xy[7] = h;
  pen.surface.poly(xy, 4, pen.palette.ink(color));
}
