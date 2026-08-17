/**
 * The heightfield tile, and this package's half of a two-package contract.
 *
 * `iso` owns where a corner *is* — `heightAt` on a `HeightField`, `gridToScreen` for the
 * projection — and `draw` owns the quad drawn between four of them. Neither package can see the
 * seam from the inside: `iso` never draws and `draw` never samples a height for anything but
 * this. So the geometry here is asserted against `iso`'s own two functions rather than against
 * the arithmetic in `terrain.ts`, which is what makes these tests survive a rewrite of it and
 * fail the day the two packages stop agreeing.
 *
 * The other half — that adjacent tiles share their corner values exactly, so a heightfield cannot
 * open a seam — is asserted here too, because it is the property the vertex-sampling rule exists
 * to buy and it is invisible until terrain is actually drawn.
 */

import type { Vec2 } from '@latticekit/core';
import { heightAt, gridToScreen, tileSourceOf } from '@latticekit/iso';
import type { HeightField } from '@latticekit/iso';
import { describe, expect, it } from 'vitest';
import { FACE_LEFT, FACE_RIGHT, rgba, shade } from '../src/color.js';
import { isoTerrain } from '../src/terrain.js';
import { firstOp, opsOf, scene } from './harness.js';

/** The same rounding the recording backend applies, so an expectation and an op compare exactly
 *  rather than nearly. */
function r3(value: number): number {
  const scaled = Math.round(value * 1000) / 1000;
  return scaled === 0 ? 0 : scaled;
}

/** Perceived brightness, for the assertions about which way the light falls. Any monotone
 *  channel sum would do; this one is the usual sRGB weighting so a reader recognises it. */
function lum(color: number): number {
  return (
    0.2126 * ((color >>> 24) & 255) +
    0.7152 * ((color >>> 16) & 255) +
    0.0722 * ((color >>> 8) & 255)
  );
}

/** A field whose height in **units** at a vertex is whatever `get` says. `stepPx` 8 is
 *  `TILE_H / 4`, the value `iso` names as a good first guess and the exhibit uses. */
function fieldOf(get: (gx: number, gy: number) => number, stepPx = 8): HeightField {
  return { heights: tileSourceOf(get), stepPx };
}

/** Flat ground at height zero, the control every relief assertion is measured against. */
const FLAT = fieldOf(() => 0);

const at: Vec2 = { x: 0, y: 0 };

describe('isoTerrain — the geometry, against iso', () => {
  it('puts its four corners exactly where gridToScreen puts them at heightAt', () => {
    // A field with a different height at every vertex, so no two corners can coincide by luck
    // and a transposed pair would show.
    const field = fieldOf((gx, gy) => gx * 3 + gy * 7);
    const { surface, pen, camera } = scene({ snap: false });
    isoTerrain(pen, field, 4, 6, 'ground');

    const corners: readonly (readonly [number, number])[] = [
      [4, 6],
      [5, 6],
      [5, 7],
      [4, 7],
    ];
    const xy = firstOp(surface, 'poly').xy;
    expect(xy).toHaveLength(8);
    corners.forEach(([gx, gy], i) => {
      gridToScreen(camera, gx, gy, heightAt(field, gx, gy), at);
      expect(xy[i * 2]).toBe(r3(at.x));
      expect(xy[i * 2 + 1]).toBe(r3(at.y));
    });
  });

  it('is north, east, south, west — iso’s order, not any other winding', () => {
    // Stated as a shape as well as as a buffer comparison, so a reader can see what the test
    // above is actually pinning down. On flat ground east is the rightmost point, west the
    // leftmost, north the topmost and south the bottom.
    const { surface, pen } = scene({ snap: false });
    isoTerrain(pen, FLAT, 0, 0, 'ground');
    const [xN, yN, xE, yE, xS, yS, xW, yW] = firstOp(surface, 'poly').xy as number[];
    expect(xE as number).toBeGreaterThan(xN as number);
    expect(xW as number).toBeLessThan(xN as number);
    expect(xN).toBe(xS);
    expect(yE).toBe(yW);
    expect(yN as number).toBeLessThan(yE as number);
    expect(yS as number).toBeGreaterThan(yE as number);
  });

  it('shares corners exactly with the tile beside it, so a heightfield cannot open a seam', () => {
    // The property vertex-sampled heights exist to buy, and the one a center-sampled field
    // cannot have. Two neighbours in each direction, on ground that is sloping at the join.
    const field = fieldOf((gx, gy) => (gx * 5 + gy * 11) % 9);
    const { surface, pen } = scene({ snap: false });
    isoTerrain(pen, field, 2, 3, 'ground');
    isoTerrain(pen, field, 3, 3, 'ground');
    isoTerrain(pen, field, 2, 4, 'ground');
    const [first, east, south] = opsOf(surface, 'poly');

    // The east neighbour's north and west corners are this tile's east and south.
    expect([east?.xy[0], east?.xy[1]]).toEqual([first?.xy[2], first?.xy[3]]);
    expect([east?.xy[6], east?.xy[7]]).toEqual([first?.xy[4], first?.xy[5]]);
    // The south neighbour's north and east corners are this tile's west and south.
    expect([south?.xy[0], south?.xy[1]]).toEqual([first?.xy[6], first?.xy[7]]);
    expect([south?.xy[2], south?.xy[3]]).toEqual([first?.xy[4], first?.xy[5]]);
  });

  it('floors a fractional tile address instead of answering for two different tiles', () => {
    const field = fieldOf((gx, gy) => gx + gy * 2);
    const { surface, pen } = scene({ snap: false });
    isoTerrain(pen, field, 3.99, 2.01, 'ground');
    const fractional = firstOp(surface, 'poly');
    surface.reset();
    isoTerrain(pen, field, 3, 2, 'ground');
    expect(fractional.xy).toEqual(firstOp(surface, 'poly').xy);
    expect(fractional.colors).toEqual(firstOp(surface, 'poly').colors);
  });

  it('floors toward negative infinity, so the world origin has no seam through it', () => {
    // `Math.floor(-0.5)` is -1; a truncating `| 0` would put -0.5 and 0.5 in the same tile and
    // leave a one-tile seam running through the origin. `iso` makes the same promise and this
    // is the drawing half of it.
    const field = fieldOf((gx, gy) => gx + gy);
    const { surface, pen } = scene({ snap: false });
    isoTerrain(pen, field, -0.5, -0.5, 'ground');
    const negative = firstOp(surface, 'poly');
    surface.reset();
    isoTerrain(pen, field, -1, -1, 'ground');
    expect(negative.xy).toEqual(firstOp(surface, 'poly').xy);
  });

  it('leaves the four projected corners in pen.xy for a second pass over the same tile', () => {
    // The documented contract that makes a water glint or a hairline seam cost no projection.
    const field = fieldOf((gx) => gx);
    const { surface, pen } = scene({ snap: false });
    isoTerrain(pen, field, 1, 1, 'ground');
    const xy = firstOp(surface, 'poly').xy;
    for (let i = 0; i < 8; i++) expect(r3(pen.xy[i] ?? Number.NaN)).toBe(xy[i]);
  });

  it('adds the pen’s device-pixel snap like every other primitive', () => {
    // A terrain quad that ignored the snap would open and close a hairline against the solids
    // standing on it as the camera pans — the exact artifact `Pen.snapX` exists to remove.
    const field = fieldOf(() => 2);
    const { surface, pen, camera } = scene();
    const snapped = { ...pen, snapX: 0.25, snapY: -0.5 };
    isoTerrain(snapped, field, 3, 1, 'ground');
    const xy = firstOp(surface, 'poly').xy;
    gridToScreen(camera, 3, 1, heightAt(field, 3, 1), at);
    expect(xy[0]).toBe(r3(at.x + 0.25));
    expect(xy[1]).toBe(r3(at.y - 0.5));
  });
});

describe('isoTerrain — the relief term', () => {
  /** The color `isoTerrain` paints one tile of `field`, and the color it reports painting. */
  function colorOf(field: HeightField, gx = 0, gy = 0, tint?: number): number {
    const { surface, pen } = scene();
    const returned = isoTerrain(pen, field, gx, gy, 'ground', undefined, tint);
    const painted = firstOp(surface, 'poly').colors[0] ?? 0;
    expect(returned).toBe(painted);
    return painted;
  }

  it('leaves flat ground at exactly the color it was given, shaded by the tint alone', () => {
    const { pen } = scene();
    expect(colorOf(FLAT)).toBe(shade(pen.palette.get('ground'), 1));
    expect(colorOf(FLAT, 0, 0, 0.8)).toBe(shade(pen.palette.get('ground'), 0.8));
  });

  it('lights a slope from the same direction the solid kit lights a box', () => {
    // The sun sits front-left: FACE_LEFT — the +gy face, screen-left — is brighter than
    // FACE_RIGHT, the +gx one. A ground plane is lit in proportion to how much its normal points
    // (-gx, +gy), which is exactly when its height rises toward the east corner. Invert the sign
    // in `terrain.ts` and this is the assertion that fails; nothing else in either package can
    // see it, and on screen it reads as terrain lit from the right of buildings lit from the
    // left, which nobody reports as a bug because nobody can name it.
    expect(FACE_LEFT).toBeGreaterThan(FACE_RIGHT);
    const risingEast = fieldOf((gx, gy) => gx - gy);
    const risingWest = fieldOf((gx, gy) => gy - gx);
    const flat = lum(colorOf(FLAT));
    expect(lum(colorOf(risingEast))).toBeGreaterThan(flat);
    expect(lum(colorOf(risingWest))).toBeLessThan(flat);
  });

  it('measures the slope across the screen, not into it', () => {
    // North and south are the axis the projection cannot show: they differ in screen y and not
    // in screen x, so a tile that rises from north to south with east and west level has no
    // cross-slope at all and must come out flat.
    const alongScreenY = fieldOf((gx, gy) => gx + gy);
    expect(colorOf(alongScreenY)).toBe(colorOf(FLAT));
  });

  it('saturates past a cross-slope of one and a half height units', () => {
    // Beyond the span the extra steepness has nowhere to go: a cliff would come out black and
    // the ridge above it would disappear into it. 1.5 units across a tile is where a 2:1 slope
    // stops reading as a slope and starts reading as a wall.
    //
    // `(gx - gy) * k` puts the east corner at `+k` units and the west at `-k`, so the
    // cross-slope is `2k` units and saturation is exactly `k = 0.75`.
    const atSpan = colorOf(fieldOf((gx, gy) => (gx - gy) * 0.75));
    expect(colorOf(fieldOf((gx, gy) => (gx - gy) * 4))).toBe(atSpan);
    expect(colorOf(fieldOf((gx, gy) => (gx - gy) * 400))).toBe(atSpan);
    // And it is a clamp, not a step: two thirds of the span is two thirds of the way there and
    // not yet saturated.
    expect(lum(colorOf(fieldOf((gx, gy) => (gx - gy) * 0.5)))).toBeLessThan(lum(atSpan));
  });

  it('measures the span in height units, so a coarser stepPx paints the same picture', () => {
    // The whole point of `HeightField.stepPx` is that a game chooses what a unit is worth. Two
    // fields with the same unit slope and different pixel scales are the same terrain drawn at
    // two sizes, and they must not be two different colors. Held below saturation, where the
    // ratio is doing the work rather than the clamp.
    const slope = (gx: number, gy: number): number => (gx - gy) * 0.5;
    expect(colorOf(fieldOf(slope, 8))).toBe(colorOf(fieldOf(slope, 31)));
    expect(colorOf(fieldOf(slope, 8))).not.toBe(colorOf(FLAT));
  });

  it('reports no relief on a field flattened to zero pixels per unit, rather than NaN', () => {
    // `stepPx` at zero is a game that has deliberately flattened its world; the arithmetic's
    // answer would be `0 / 0`, and a NaN color paints an invisible tile that reports nothing.
    expect(colorOf(fieldOf((gx, gy) => gx - gy, 0))).toBe(colorOf(FLAT));
    expect(colorOf(fieldOf((gx, gy) => gx - gy, -8))).toBe(colorOf(FLAT));
  });

  it('folds the game’s tint and the kit’s relief into one shade, additively', () => {
    // Two `shade` calls in series is not the same color as one: `shade` pulls toward a cool or a
    // warm tint by distance from neutral, so shading twice tints twice and the ground goes
    // muddy. The tint and the relief therefore reach `shade` as a single factor.
    // A fully saturated up-slope, so the relief contribution is the module's whole stated
    // budget — a third of a shade — and can be written down rather than recomputed.
    const slope = fieldOf((gx, gy) => gx - gy);
    const RELIEF_AT_FULL = 0.32;
    const { pen } = scene();
    const ground = pen.palette.get('ground');
    const relief = colorOf(slope);
    const tinted = colorOf(slope, 0, 0, 0.7);
    expect(relief).toBe(shade(ground, 1 + RELIEF_AT_FULL));
    expect(tinted).toBe(shade(ground, 0.7 + RELIEF_AT_FULL));
    // Not the same as shading twice, which is the failure this composition exists to avoid.
    expect(tinted).not.toBe(shade(relief, 0.7));
  });

  it('resolves an Ink like every other primitive, and reports the color it painted', () => {
    const { surface, pen, palette } = scene();
    expect(isoTerrain(pen, FLAT, 0, 0, 'brand')).toBe(shade(palette.get('brand'), 1));
    surface.reset();
    const literal = rgba(10, 20, 30, 255);
    expect(isoTerrain(pen, FLAT, 0, 0, literal)).toBe(shade(literal, 1));
  });
});

describe('isoTerrain — the seam stroke and the arguments', () => {
  it('draws one fill and nothing else unless a stroke is asked for', () => {
    const { surface, pen } = scene();
    isoTerrain(pen, FLAT, 0, 0, 'ground');
    expect(surface.ops.map((op) => op.op)).toEqual(['poly']);
  });

  it('closes the seam stroke around all four edges, one pixel wide', () => {
    const { surface, pen, palette } = scene();
    isoTerrain(pen, FLAT, 0, 0, 'ground', 'ink');
    expect(surface.ops.map((op) => op.op)).toEqual(['poly', 'stroke']);
    const op = firstOp(surface, 'stroke');
    expect(op.value).toBe(1);
    expect(op.text).toBe('closed');
    expect(op.xy).toHaveLength(8);
    expect(op.colors[0]).toBe(palette.get('ink'));
    // The stroke runs the same four points as the fill: a seam offset from its own tile is a
    // hairline that drifts as the camera moves.
    expect(op.xy).toEqual(firstOp(surface, 'poly').xy);
  });

  it('refuses a tint that would paint a tile nobody can see', () => {
    // A NaN factor makes an invisible tile and reports nothing, and a hole in terrain is read as
    // a missing chunk of map rather than as a bad number.
    const { pen } = scene();
    expect(() => isoTerrain(pen, FLAT, 0, 0, 'ground', undefined, Number.NaN)).toThrow(RangeError);
    expect(() => isoTerrain(pen, FLAT, 0, 0, 'ground', undefined, Number.NaN)).toThrow(
      /isoTerrain: expected a finite tint, got NaN/,
    );
    expect(() => isoTerrain(pen, FLAT, 0, 0, 'ground', undefined, Infinity)).toThrow(RangeError);
  });

  it('draws a tile at every zoom, scaled by it and by nothing else', () => {
    const field = fieldOf(() => 3);
    const one = scene({ zoom: 1, snap: false });
    isoTerrain(one.pen, field, 0, 0, 'ground');
    const two = scene({ zoom: 2, snap: false });
    isoTerrain(two.pen, field, 0, 0, 'ground');
    const a = firstOp(one.surface, 'poly');
    const b = firstOp(two.surface, 'poly');
    // Same color — relief is a property of the ground, not of how close the camera is — and
    // twice the extent about the viewport center.
    expect(b.colors[0]).toBe(a.colors[0]);
    const widthOf = (xy: readonly number[]): number => (xy[2] ?? 0) - (xy[6] ?? 0);
    expect(widthOf(b.xy)).toBe(widthOf(a.xy) * 2);
  });
});
