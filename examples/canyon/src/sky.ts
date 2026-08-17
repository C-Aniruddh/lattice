/**
 * The air over the plateau, and the birds in it.
 *
 * @art
 *
 * Delete this file and the exhibit runs on the flat `sky` slot. Everything here is background and
 * two dozen specks; nothing holds state that outlives a frame — every bird's position is a
 * closed-form expression in `pen.t` and a hash, which is `Crowd`'s trick borrowed for decoration.
 *
 * ## A dimetric projection has no horizon, so the terrain grows one
 *
 * The ground plane is infinite in screen space, so there is no line where it meets the sky and no
 * honest place to paint one. What this exhibit has instead is the haze: `strata.ts` dissolves the
 * far wall toward the `air` slot as `gx + gy` runs away from the camera, and at the line
 * `strata.ts` calls {@link hazeFar} there is nothing left of the rock at all. *That* line is the
 * horizon, it is a line of constant `gx + gy`, and such a line is horizontal on screen at every
 * zoom and every pan — so the sky can be hung off it and will not slide when the camera moves.
 *
 * Which settles the one decision in the file: the ramp's low end is `air` rather than `sky`,
 * because the seam between the backdrop and the furthest rock has to be invisible, and it can
 * only be invisible if both sides name the same color.
 *
 * The pen draws in **screen** pixels. The Backdrop pass is handed the visible *world* rectangle,
 * which is the right shape for a gradient over the world and the wrong one for a gradient over
 * the viewport, so it is unused here and the projection is asked for the one line that matters.
 */
import { clamp, hash2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import { mix, shade, withAlpha, type Pen } from '@latticekit/draw';
import { STEP_PX } from './erosion.js';
import { hazeFar, rimScreenY, riverScreenY } from './strata.js';

/** Two dozen is enough to read as "there are birds" and few enough that none of them ever has to
 *  be looked at closely. */
const BIRDS = 26;
const CIRRUS = 11;
/**
 * The horizon is the plateau's *surface* at `hazeFar`, not the ground plane under it.
 *
 * Terrain is drawn lifted by `height · STEP_PX`, so a horizon taken at `z = 0` ends the ramp nine
 * hundred pixels below the rock it is supposed to meet and the seam is a visible band of the
 * wrong blue. This constant existed and was **not passed** for a while, which is exactly the bug
 * it was written to prevent — filed here because the lesson is that a named constant nobody
 * reads is worse than a magic number, since the reader assumes it is in force.
 *
 * Fifty-two rather than forty-seven: `strata.ts` § `bench` draws the tableland on the caprock plane
 * and the uplift raises it ten units over a run, so this is the middle of where it sits. Being a few
 * pixels out costs nothing — both sides of the seam are `air`.
 */
const PLATEAU_PX = 52 * STEP_PX;
const pt: Vec2 = { x: 0, y: 0 };

/** Screen y of the line the rock has completely faded on. See the header. */
function horizonY(pen: Pen): number {
  const g = hazeFar() * 0.5;
  gridToScreen(pen.camera, g, g, PLATEAU_PX, pt);
  return clamp(pt.y + pen.snapY, 1, pen.surface.height);
}

export function drawSky(pen: Pen): void {
  const w = pen.surface.width;
  const h = pen.surface.height;
  const hy = horizonY(pen);
  const xy = pen.xy;
  xy[0] = 0; xy[1] = 0;
  xy[2] = w; xy[3] = 0;
  xy[4] = w; xy[5] = h;
  xy[6] = 0; xy[7] = h;
  // The ramp ends at the horizon and holds its low end below it, so a camera pulled down does
  // not reveal a gradient continuing under ground that has already gone to haze.
  pen.surface.polyRamp(xy, 4, 0, 0, 0, hy, shade(pen.palette.get('sky'), 0.88), pen.palette.get('air'));
  cirrus(pen, w, hy);
}

/** High cloud: long thin ellipses in the top third, drifting. Something has to move before the
 *  visitor does anything, and on a plateau nothing else up there does. */
function cirrus(pen: Pen, w: number, hy: number): void {
  const pale = withAlpha(mix(pen.palette.get('sky'), 0xffffffff, 0.7), 0.34);
  const span = w + 700;
  for (let k = 0; k < CIRRUS; k++) {
    const h = hash2(0x1c1, k, 3);
    const drift = pen.t * (5 + (h >>> 28)) * 0.7;
    const x = ((toUnit(h) * span + drift) % span) - 350;
    pen.surface.ellipse(x, (0.05 + toUnit(hash2(h, 1, 0)) * 0.62) * hy,
      150 + (h >>> 22 & 63) * 5, 6 + (h >>> 17 & 7), pale);
  }
}

/**
 * Birds, in the Effects pass, above everything — and **below the rim**.
 *
 * Each rides its own ellipse at its own rate and its own phase, all three out of one hash, so
 * twenty-six of them never fall into step. Screen space rather than world space is deliberate:
 * they read as *near the camera*, which is the third distance band and the cheapest one to buy.
 *
 * The band they fly in is the change worth naming. `docs/GALLERY.md` § *A mile deep has to feel a
 * mile deep* asks for birds below the rim line specifically, and it is right about why: a bird
 * *above* a landform says nothing at all, because the sky is where birds are. A bird with rock
 * above it says the rock is taller than the thing flying inside it, which is the entire trick, and
 * it costs two projections a frame. Both ends move — uplift raises the rim, incision widens it —
 * so `strata.ts` is asked for the two rows every frame rather than a fraction of the viewport
 * being guessed at once against a screenshot.
 *
 * The distribution is `f²`, so the flock crowds just under the rim and thins toward the water,
 * with a few strays above the line. A row of evenly spaced birds is a decoration; a flock with a
 * ceiling is a measurement.
 */
export function drawBirds(pen: Pen, epoch: number, cut: number): void {
  const w = pen.surface.width;
  const top = rimScreenY(pen, epoch, cut);
  // Floored, because at epoch zero there is no gorge for the flock to be inside of and a span of
  // nothing would stack all twenty-six on one row.
  const span = Math.max(riverScreenY(pen, epoch, cut) - top, 200);
  const ink = withAlpha(pen.palette.get('ink'), 0.5);
  for (let k = 0; k < BIRDS; k++) {
    const seed = hash2(0xb1d, k, 0);
    const a = pen.t * (0.1 + toUnit(seed) * 0.16) + toUnit(hash2(seed, 1, 0)) * 6.283;
    const f = toUnit(hash2(seed, 3, 0));
    /* @tier-b pixels only — a bird is not a height field. */
    const x = (0.04 + toUnit(hash2(seed, 2, 0)) * 0.92) * w + Math.cos(a) * (40 + (seed >>> 26) * 3);
    const y = top + (f * f * 1.12 - 0.1) * span + Math.sin(a) * (14 + (seed >>> 28) * 2);
    const beat = Math.sin(pen.t * (5 + toUnit(seed) * 3) + toUnit(hash2(seed, 4, 0)) * 6) * 2.4;
    const s = 3 + (seed >>> 29);
    pen.xy[0] = x - s; pen.xy[1] = y - beat;
    pen.xy[2] = x; pen.xy[3] = y + 1;
    pen.xy[4] = x + s; pen.xy[5] = y - beat;
    pen.surface.stroke(pen.xy, 3, false, ink, 1.4);
  }
}
