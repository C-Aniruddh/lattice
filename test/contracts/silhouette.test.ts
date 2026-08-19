/**
 * Contract: the outline `draw` paints around a box and the polygon `iso` hit-tests it against
 * are the same hexagon, on screen, at the same place.
 *
 * `iso.boxSilhouette` is the definition — north-top, east-top, east-base, south-base, west-base,
 * west-top — and `draw`'s stroke is the conformer. `packages/draw/test/solids.test.ts` § *the
 * silhouette contract with iso* already holds up the point order by comparing the twelve numbers
 * on an unsnapped pen, which is the right place for it: `draw` depends on `iso`, so `draw`'s
 * suite is where a conformer can be checked against its definition.
 *
 * ## What is left over, and why it has to be here
 *
 * Two things that neither package's suite can see, and that a player feels directly.
 *
 * **The consequence rather than the buffer.** Twelve equal numbers is *evidence* for the claim;
 * the claim is that a tap inside the painted outline opens that building. Those are the same
 * statement only while both sides read the six points as one simple hexagon, and the whole
 * hazard in a point *order* is that a permuted trace is still six correct points — it just
 * encloses a bowtie. So the assertion below is over screen points, not over coordinates.
 *
 * **The snap.** `draw` rounds and `iso` does not: `beginFrame` projects the world origin, takes
 * its position in device pixels, and adds the correction that lands it on a whole one to every
 * coordinate the pen produces. `iso` hit-tests the unsnapped camera and always will — it has no
 * idea a device exists. So under the kit's own default the painted outline is `boxSilhouette`
 * **translated**, and the contract is only honest while that translation is smaller than the
 * pixel the player is aiming at. `draw`'s suite checks the shift is *uniform*, in one case, on
 * one camera; nothing anywhere checks how *big* it is, and nothing anywhere compares the snapped
 * result to `iso` at all.
 *
 * ## The edit this catches
 *
 * **Snapping in world units instead of device ones.** "At zoom 2 a world pixel covers two device
 * pixels, so the grid to round to is `ratio / zoom`" is a plausible sentence, it is a one-line
 * change at `beginFrame`'s call to `snapOffset`, and it is still perfectly *uniform*. So
 * `draw`'s own snap tests stay green — `surface.test.ts` exercises `snapOffset` itself, which did
 * not change, and `solids.test.ts` compares a snapped box to an unsnapped one at zoom 1, where
 * the two spellings are identical — and `iso`'s suite never hears about it at all. This edit was
 * made and the whole workspace stayed green except the assertions below.
 *
 * What it does is scale the offset with the zoom, so a zoomed-in campus paints every building up
 * to a whole pixel from where the pick polygon says it stands. That reads as taps landing on the
 * wrong side of a shared wall between two adjacent buildings — rare, positional, worse the
 * further in the player zooms, and reported as "the tap target is off" long after the commit.
 *
 * See `docs/SEAMS.md` § *Contracts that no single package can test*.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '@latticekit/core';
import { boxSilhouette, createCamera, pointInPolygon } from '@latticekit/iso';
import type { Camera, Volume } from '@latticekit/iso';
import {
  BASE_SLOTS,
  beginFrame,
  createPalette,
  createRecordingSurface,
  isoBox,
  levelsToPx,
} from '@latticekit/draw';
import type { Op, RecordingSurface } from '@latticekit/draw';

/** Viewport, in CSS pixels. */
const WIDTH = 360;
/** See {@link WIDTH}. */
const HEIGHT = 280;

/** One box, and the camera it is seen through. */
interface Case {
  readonly camera: Camera;
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  /** Storeys — `draw`'s unit. `LEVEL_H` is `draw`'s, so the pick side converts. */
  readonly h: number;
  readonly z: number;
  readonly pixelRatio: number;
}

/** A spread of cameras and boxes: zoomed in and out, panned off the round numbers, tall and
 *  squat. One camera at one zoom would agree by accident. */
function cases(seed: string, ratios: readonly number[]): Case[] {
  const rng = createRng(seed);
  const out: Case[] = [];
  for (let i = 0; i < 24; i += 1) {
    const camera = createCamera(WIDTH, HEIGHT, {
      zoom: rng.float(0.6, 2.5),
      bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
    });
    // Fractional centers on purpose: a camera parked on a whole pixel makes the snap zero, which
    // is the one case that cannot tell a correct offset from no offset at all.
    camera.centerOn(rng.float(-40, 40), rng.float(-40, 40));
    out.push({
      camera,
      gx: rng.float(-1.5, 1.5),
      gy: rng.float(-1.5, 1.5),
      w: rng.float(1, 3),
      d: rng.float(1, 3),
      h: rng.float(1, 4),
      z: rng.float(0, 1.5),
      pixelRatio: ratios[i % ratios.length] as number,
    });
  }
  return out;
}

/** Paint one box and hand back the six points the surface was actually given. */
function painted(c: Case, snap: boolean): Float64Array {
  const surface: RecordingSurface = createRecordingSurface(WIDTH, HEIGHT, c.pixelRatio);
  const pen = beginFrame({
    surface,
    camera: c.camera,
    palette: createPalette(BASE_SLOTS),
    t: 0,
    snap,
  });
  surface.reset();
  isoBox(pen, c.gx, c.gy, c.w, c.d, { color: 'brand', h: c.h, z: c.z });
  const stroke = surface.ops.find((op: Op) => op.op === 'stroke');
  if (stroke === undefined) throw new Error('isoBox drew no silhouette stroke');
  expect(stroke.text).toBe('closed');
  expect(stroke.xy).toHaveLength(12);
  return Float64Array.from(stroke.xy);
}

/** The polygon a game's pick test runs against, for the same box. */
function picked(c: Case): Float64Array {
  const volume: Volume = {
    ox: 0,
    oy: 0,
    w: c.w,
    d: c.d,
    zPx: levelsToPx(c.z),
    hPx: levelsToPx(c.h),
  };
  return boxSilhouette(c.camera, c.gx, c.gy, volume, new Float64Array(12));
}

/** Every screen point on a raster two CSS pixels apart. The contract is about pixels, so the
 *  test is too. */
function* raster(): Generator<readonly [number, number]> {
  for (let sy = 0; sy < HEIGHT; sy += 2) {
    for (let sx = 0; sx < WIDTH; sx += 2) yield [sx, sy];
  }
}

/**
 * Whether a point and its four neighbors `pad` pixels away all answer `want`.
 *
 * Every assertion here is about the interior or the exterior, never about the boundary: `iso`
 * applies no epsilon on an edge on purpose — a pixel either side of an outline is the same tap —
 * and the recording backend rounds to a thousandth of a pixel on the way in. A test that asked
 * about the edge would be asking a question the kit has deliberately declined to answer, and it
 * would fail on float noise a few times in a hundred thousand.
 */
function clear(poly: Float64Array, sx: number, sy: number, want: boolean, pad: number): boolean {
  return (
    pointInPolygon(sx, sy, poly, 6) === want &&
    pointInPolygon(sx - pad, sy, poly, 6) === want &&
    pointInPolygon(sx + pad, sy, poly, 6) === want &&
    pointInPolygon(sx, sy - pad, poly, 6) === want &&
    pointInPolygon(sx, sy + pad, poly, 6) === want
  );
}

describe('a tap inside the painted outline opens that building', () => {
  it('covers the same region of the screen as the polygon iso hit-tests', () => {
    // The snap deliberately off, so this suite is about the *shape* alone and a disagreement is
    // a point order rather than a rounding. A permuted trace is still six correct points; what
    // stops being a hexagon is the region they enclose, and only a point-in-polygon test can see
    // that — twelve equal numbers is evidence for the claim, and this is the claim.
    let interior = 0;
    let exterior = 0;
    const wrong: string[] = [];
    for (const c of cases('silhouette-shape', [1])) {
      const paint = painted(c, false);
      const pick = picked(c);
      for (const [sx, sy] of raster()) {
        if (clear(paint, sx, sy, true, 1)) {
          interior += 1;
          if (!pointInPolygon(sx, sy, pick, 6)) wrong.push(`painted but not picked at ${String(sx)},${String(sy)}`);
        } else if (clear(paint, sx, sy, false, 1)) {
          exterior += 1;
          if (pointInPolygon(sx, sy, pick, 6)) wrong.push(`picked but not painted at ${String(sx)},${String(sy)}`);
        }
      }
    }
    // Reported as a list rather than one assertion per pixel: the count and the first few
    // coordinates say whether the two shapes are a translation apart or a different polygon.
    expect(wrong.slice(0, 8)).toEqual([]);
    // A box that landed off screen would agree with anything. This is the guard against a suite
    // that proves nothing because it never drew a building.
    expect(interior).toBeGreaterThan(5_000);
    expect(exterior).toBeGreaterThan(5_000);
  });
});

describe('the snap moves the building less far than the finger can tell', () => {
  // `draw` rounds because it is the package touching a device; `iso` declines to, because it is
  // computing in continuous world space and does not know what a device is. That disagreement is
  // by design and it is *bounded* — half a device pixel — and nothing in either package states
  // the bound, because neither package can see both halves of it.
  it.each([1, 2, 3])(
    'lands the outline within half a device pixel of the pick polygon at pixelRatio %i',
    (ratio) => {
      let moved = 0;
      for (const c of cases(`silhouette-snap-${String(ratio)}`, [ratio])) {
        const paint = painted(c, true);
        const pick = picked(c);
        const dx = (paint[0] as number) - (pick[0] as number);
        const dy = (paint[1] as number) - (pick[1] as number);
        if (dx !== 0 || dy !== 0) moved += 1;

        // Uniform first, because a bound on one corner says nothing if the others moved
        // differently — a per-corner round would deform the hexagon rather than translate it.
        for (let k = 0; k < 12; k += 2) {
          expect(paint[k]).toBeCloseTo((pick[k] as number) + dx, 2);
          expect(paint[k + 1]).toBeCloseTo((pick[k + 1] as number) + dy, 2);
        }
        // And then the size of it, in the unit the rounding happens in.
        expect(Math.abs(dx) * ratio).toBeLessThanOrEqual(0.5 + 1e-6);
        expect(Math.abs(dy) * ratio).toBeLessThanOrEqual(0.5 + 1e-6);
      }
      // The snap has to have actually done something, or the bound above is a bound on zero.
      expect(moved).toBeGreaterThan(0);
    },
  );

  it('never paints a pixel two deep inside the outline that the pick calls empty ground', () => {
    // The bound above, restated as the thing a player does. Erosion by two pixels, so the
    // assertion is about the interior and not about which side of an edge a pixel is on — no
    // epsilon on a boundary is `iso`'s documented position and this suite does not reopen it.
    for (const c of cases('silhouette-interior', [1, 2, 3])) {
      const paint = painted(c, true);
      const pick = picked(c);
      let interior = 0;
      const missed: string[] = [];
      for (const [sx, sy] of raster()) {
        if (!clear(paint, sx, sy, true, 2)) continue;
        interior += 1;
        if (!pointInPolygon(sx, sy, pick, 6)) missed.push(`${String(sx)},${String(sy)}`);
      }
      expect(missed.slice(0, 8)).toEqual([]);
      expect(interior).toBeGreaterThan(0);
    }
  });
});
