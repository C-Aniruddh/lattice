/**
 * Text in two places: sheared onto a wall, and flat on the screen.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.** It computes a 2×3 affine
 * transform and hands it to a `Surface`; who owns a font is the backend's problem.
 *
 * ## Why wall text exists at all
 *
 * A sign is often the only place a player's own choice — a company name — appears in the world.
 * A blank tinted panel there is not a missing polish item; it is the game breaking a promise
 * about the one thing the player personally chose.
 *
 * ## The two corrections, both of which shipped wrong once, and how they are spelled here
 *
 * The obvious transform maps the wall's *parameter* square — 0…1 along the segment, 0…1 down
 * the face — onto the wall. That basis is **anisotropic**: its x axis is scaled by the
 * segment's screen length and its y axis by the band's, and those two numbers are nothing like
 * each other. Every glyph comes out stretched sideways and the sign reads as a stretched
 * bitmap. The fix as the trap states it is two lines:
 *
 * 1. squeeze the along-axis by `min(1, downLen / alongLen)`, restoring the letterform while
 *    keeping the shear;
 * 2. divide that same factor back out of the centring x, because it is in local space and the
 *    transform is about to scale it — miss this and the sign slides off its own board, which
 *    looks like a layout bug rather than a transform bug.
 *
 * **This module applies both at once, by normalising the basis instead of patching it.** Both
 * columns of the transform are unit vectors, so one local unit is one screen pixel along either
 * axis, and the anchor is given in screen lengths (`alongLen / 2`, `downLen / 2`) rather than in
 * parameter space. That is exactly corrections 1 and 2 composed with a uniform rescale, and the
 * font size then absorbs the rescale for free.
 *
 * It is sound because of a property of this projection specifically: **an axis-aligned vertical
 * face is sheared but not foreshortened.** One world pixel along the wall is one screen pixel,
 * and one world pixel up the wall is one screen pixel, so a unit basis is the wall's own metric
 * and not an approximation of it. Applying the squeeze *on top of* a normalized basis — the
 * mistake this note exists to prevent — squashes the text horizontally on every long wall.
 */

import { HALF_H, HALF_W } from '@latticekit/iso';
import type { Ink } from './color.js';
import { levelsToPx } from './solids.js';
import type { Pen, TextStyle } from './surface.js';

/**
 * The kit's default text run: a system stack, semibold, centered both ways.
 *
 * Semibold rather than regular because every string this kit draws is either a name on a
 * building at thumbnail size or a number over a rooftop, and regular weight disappears against
 * a busy background at both.
 */
export const DEFAULT_TEXT: TextStyle = Object.freeze({
  size: 12,
  weight: 600,
  family: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  align: 0,
  baseline: 0,
});

/**
 * Below this many CSS pixels of wall height, glyphs are mush and {@link wallText} draws nothing
 * at all.
 *
 * Drawing them anyway is what gives a zoomed-out campus a rash of gray smears, which reads as a
 * rendering artifact rather than as text that is too small.
 */
export const MIN_WALL_TEXT_PX = 12;

/** Fraction of the wall's height a glyph occupies. The rest is the margin that stops a sign
 *  from looking like a label printed to the edge of its own board. */
const WALL_TEXT_FILL = 0.55;

/**
 * The transform handed to `Surface.text`, reused every call.
 *
 * Scratch, exactly like `Pen.xy`: a backend reads it during the call and **must not retain
 * it**. Both backends in this package copy or apply it immediately, and a backend that stored
 * the reference would find every sign in the frame wearing the last one's shear.
 */
const XFORM = new Float64Array(6);

/**
 * The style handed to `Surface.text`, reused every call, because the size is derived from the
 * wall and therefore differs per sign.
 *
 * Scratch, on the same terms as {@link XFORM}. Allocating a `TextStyle` per sign per frame
 * would put the one allocation this package works to avoid back on the massing path.
 */
const SIZED: { size: number; weight: number; family: string; align: -1 | 0 | 1; baseline: -1 | 0 | 1 } =
  {
    size: DEFAULT_TEXT.size,
    weight: DEFAULT_TEXT.weight,
    family: DEFAULT_TEXT.family,
    align: DEFAULT_TEXT.align,
    baseline: DEFAULT_TEXT.baseline,
  };

/**
 * Text painted **onto a vertical face**, sheared into the isometric plane.
 *
 * The segment `(ax, ay) → (bx, by)` is in grid coordinates and runs along the wall; the band
 * hangs from `ztop` down by `heightLevels`, both in **storeys** like every other height in this
 * package. The text is centered in the band and shrunk to fit if it would overrun the segment.
 *
 * **Backends disagree about `measure`** — the recording surface has no fonts and estimates — so
 * a golden test may assert that the shrink branch ran and may not assert where a glyph landed.
 *
 * Draws nothing when the band is shorter than {@link MIN_WALL_TEXT_PX} on screen, when the
 * segment has zero length, or when `value` is empty.
 */
export function wallText(
  pen: Pen,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ztop: number,
  heightLevels: number,
  value: string,
  color: Ink,
  style: TextStyle = DEFAULT_TEXT,
): void {
  if (value === '') return;
  const cam = pen.camera;
  const topPx = levelsToPx(ztop);
  const botPx = levelsToPx(ztop - heightLevels);

  const x0 = cam.toScreenX((ax - ay) * HALF_W) + pen.snapX;
  const y0 = cam.toScreenY((ax + ay) * HALF_H - topPx) + pen.snapY;
  const x1 = cam.toScreenX((bx - by) * HALF_W) + pen.snapX;
  const y1 = cam.toScreenY((bx + by) * HALF_H - topPx) + pen.snapY;
  // The down axis shares the segment's start, so the basis is anchored at one corner and the
  // shear is exactly the wall's.
  const yDown = cam.toScreenY((ax + ay) * HALF_H - botPx) + pen.snapY;

  const alongX = x1 - x0;
  const alongY = y1 - y0;
  const downY = yDown - y0;
  const alongLen = Math.sqrt(alongX * alongX + alongY * alongY);
  const downLen = downY < 0 ? -downY : downY;
  if (!(alongLen > 0) || downLen < MIN_WALL_TEXT_PX) return;

  SIZED.size = downLen * WALL_TEXT_FILL;
  SIZED.weight = style.weight;
  SIZED.family = style.family;
  SIZED.align = 0;
  SIZED.baseline = 0;
  // The advance is already in screen pixels, because the basis below is normalized. A backend
  // that has no fonts estimates it, which is why a golden may assert that this branch ran and
  // may not assert where a glyph landed.
  const advance = pen.surface.measure(value, SIZED);
  if (advance > alongLen) SIZED.size *= alongLen / advance;

  // Both columns unit length: the corrections of the module header, applied at once. `c` is
  // exactly zero because the down axis of an upright wall is screen-vertical in this projection
  // whatever the wall's bearing — which is also why a sign never leans.
  XFORM[0] = alongX / alongLen;
  XFORM[1] = alongY / alongLen;
  XFORM[2] = 0;
  XFORM[3] = downY / downLen;
  XFORM[4] = x0;
  XFORM[5] = y0;

  // The anchor in screen lengths rather than in parameter space, which is the second correction.
  pen.surface.text(value, alongLen / 2, downLen / 2, SIZED, pen.palette.ink(color), XFORM);
}

/**
 * Unsheared text at a screen pixel — floating numbers, timers, debug readouts.
 *
 * **Never world-space.** Anything that has to stay attached to a thing in the valley belongs in
 * the Overlay pass with its position projected by the caller, because a label that scales and
 * shears with the world stops being readable at exactly the zoom the player uses to look at a
 * lot of things at once.
 */
export function screenText(
  pen: Pen,
  sx: number,
  sy: number,
  value: string,
  color: Ink,
  style: TextStyle = DEFAULT_TEXT,
): void {
  pen.surface.text(value, sx, sy, style, pen.palette.ink(color));
}
