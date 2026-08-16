/**
 * `projection` — the lattice, the rectangle, and the two traps that live at the origin.
 *
 * Almost everything here is asserted with `toBe`, not a tolerance. `HALF_W` and `HALF_H` are
 * powers of two, so the forward map is two exact multiplies and the inverse is two exact
 * divisions; a round trip that needs an epsilon would mean somebody had introduced an
 * operation that does not belong. The two places a tolerance appears say why in a comment.
 */

import { describe, expect, it } from 'vitest';
import { v2 } from '@lattice/core';
import type { Vec2 } from '@lattice/core';
import {
  HALF_H,
  HALF_W,
  TILE_H,
  TILE_W,
  depthOf,
  footprintBounds,
  gridToWorld,
  gridToWorldX,
  gridToWorldY,
  isEdgeOn,
  rectCenterX,
  rectCenterY,
  rectContains,
  rectExpand,
  rectFromSize,
  rectHeight,
  rectIntersects,
  rectIsEmpty,
  rectMakeEmpty,
  rectSet,
  rectUnion,
  rectWidth,
  tileBounds,
  tileDiamond,
  worldToGrid,
  worldToGridX,
  worldToGridY,
  worldToTile,
} from '../src/projection.js';
import type { GridPoint, Rect } from '../src/projection.js';

/** A fresh rectangle. Tests may allocate; the package may not. */
const rect = (): Rect => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
const gp = (): GridPoint => ({ gx: 0, gy: 0 });

describe('the constants', () => {
  it('is 2:1, and the halves are exact', () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
    expect(TILE_W).toBe(TILE_H * 2);
    expect(HALF_W).toBe(TILE_W / 2);
    expect(HALF_H).toBe(TILE_H / 2);
  });

  it('has no LEVEL_H — a storey is an art proportion and belongs to draw', async () => {
    const iso: Record<string, unknown> = await import('../src/index.js');
    expect(Object.keys(iso)).not.toContain('LEVEL_H');
  });
});

describe('isEdgeOn', () => {
  it('is true exactly when the two ends share a world x', () => {
    // World x is (gx - gy) * HALF_W and nothing else, so equal deltas cancel. This is the
    // whole of the invisible-wall bug: a fence along the near-far diagonal has no width to
    // draw, nothing throws, and the art is simply not there.
    expect(isEdgeOn(2, 2, 5, 5)).toBe(true);
    expect(gridToWorldX(5, 5)).toBe(gridToWorldX(2, 2));
    expect(isEdgeOn(2, 2, 5, 6)).toBe(false);
    expect(isEdgeOn(0, 0, 3, 0)).toBe(false);
    expect(isEdgeOn(0, 0, 0, 3)).toBe(false);
    // Negative and fractional deltas are the same rule: -2 and -2 cancel just as well.
    expect(isEdgeOn(9, 9, 7, 7)).toBe(true);
    expect(isEdgeOn(0, 0, 0.5, 0.5)).toBe(true);
  });

  it('agrees with the projection over a neighborhood, which is the only definition it has', () => {
    for (let dgx = -3; dgx <= 3; dgx++) {
      for (let dgy = -3; dgy <= 3; dgy++) {
        const width = gridToWorldX(4 + dgx, 6 + dgy) - gridToWorldX(4, 6);
        expect(isEdgeOn(4, 6, 4 + dgx, 6 + dgy)).toBe(width === 0);
      }
    }
  });

  it('calls a zero-length segment edge-on and a NaN one not', () => {
    // A point has no width either, and it is the same bug arriving from a different direction.
    expect(isEdgeOn(3, 3, 3, 3)).toBe(true);
    // NaN is not a projection question. Answering `true` would let a broken coordinate be
    // reported as an art problem, which is the wrong department.
    expect(isEdgeOn(0, 0, Number.NaN, 0)).toBe(false);
    expect(isEdgeOn(0, 0, 0, Number.NaN)).toBe(false);
  });

  it('does not say anything about the other diagonal, which is thin but visible', () => {
    // (1, -1) has zero world *height*, not zero width. A wall along it draws as a horizontal
    // line of full width and reads perfectly well, so it is not this predicate's business.
    expect(isEdgeOn(0, 0, 3, -3)).toBe(false);
    expect(gridToWorldY(3, -3)).toBe(gridToWorldY(0, 0));
  });
});

describe('grid <-> world', () => {
  it('runs +gx down-right and +gy down-left', () => {
    // One step along +gx moves right by HALF_W and down by HALF_H; one along +gy moves left by
    // HALF_W and down by HALF_H. Getting these two the wrong way round rotates the whole game.
    expect(gridToWorldX(1, 0)).toBe(HALF_W);
    expect(gridToWorldY(1, 0)).toBe(HALF_H);
    expect(gridToWorldX(0, 1)).toBe(-HALF_W);
    expect(gridToWorldY(0, 1)).toBe(HALF_H);
    expect(gridToWorldX(0, 0)).toBe(0);
    expect(gridToWorldY(0, 0)).toBe(0);
  });

  it('makes gx + gy the depth axis: equal sums share a world y', () => {
    expect(gridToWorldY(3, 5)).toBe(gridToWorldY(5, 3));
    expect(gridToWorldY(4, 4)).toBe(gridToWorldY(0, 8));
    expect(gridToWorldY(1, 0)).toBeLessThan(gridToWorldY(1, 1));
  });

  it('writes both axes into an out-parameter and returns it', () => {
    const out = v2(99, 99);
    const same: Vec2 = gridToWorld(2, 3, out);
    expect(same).toBe(out);
    expect(out.x).toBe(gridToWorldX(2, 3));
    expect(out.y).toBe(gridToWorldY(2, 3));
  });

  it('I1: round-trips every integer grid point exactly, not approximately', () => {
    for (let gx = -40; gx <= 40; gx++) {
      for (let gy = -40; gy <= 40; gy++) {
        const wx = gridToWorldX(gx, gy);
        const wy = gridToWorldY(gx, gy);
        expect(worldToGridX(wx, wy)).toBe(gx);
        expect(worldToGridY(wx, wy)).toBe(gy);
      }
    }
  });

  it('I1: round-trips fractional grid points exactly too', () => {
    // The RFC allows 1e-9 here; exactness is achievable because HALF_W and HALF_H are powers
    // of two, so a tolerance would be hiding an operation that should not be in the inverse.
    const out = gp();
    for (const gx of [-3.25, -0.5, 0, 0.125, 7.75, 1234.5]) {
      for (const gy of [-9.5, -0.125, 0, 0.75, 3.375]) {
        worldToGrid(gridToWorldX(gx, gy), gridToWorldY(gx, gy), out);
        expect(out.gx).toBe(gx);
        expect(out.gy).toBe(gy);
      }
    }
  });

  it('worldToGrid may alias nothing but still writes both fields from the old values', () => {
    const out = gp();
    const same = worldToGrid(32, 32, out);
    expect(same).toBe(out);
    expect(out.gx).toBe(1.5);
    expect(out.gy).toBe(0.5);
  });
});

describe('worldToTile', () => {
  it('I2: every one of the eight interior sample points lands on its own tile', () => {
    // The eight points at fractions 0.25/0.5/0.75 inside the unit cell, which is the diamond.
    // A `Math.round` in the inverse gets the four nearest the edges wrong; a `| 0` gets the
    // ones with a negative coordinate wrong. This is the test both of those fail.
    const fractions = [
      [0.25, 0.25],
      [0.5, 0.25],
      [0.75, 0.25],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.25, 0.75],
      [0.5, 0.75],
      [0.75, 0.75],
    ] as const;
    const out = gp();
    for (let gx = -6; gx <= 6; gx++) {
      for (let gy = -6; gy <= 6; gy++) {
        for (const [fx, fy] of fractions) {
          const wx = gridToWorldX(gx + fx, gy + fy);
          const wy = gridToWorldY(gx + fx, gy + fy);
          worldToTile(wx, wy, out);
          expect([out.gx, out.gy, gx, gy, fx, fy]).toEqual([gx, gy, gx, gy, fx, fy]);
        }
      }
    }
  });

  it('floors rather than truncating, so there is no seam through the origin', () => {
    // `| 0` would put the tile west of the origin at 0 as well, and the map would have a
    // one-tile seam running through (0, 0) that only appears on a map with negative
    // coordinates. `core.hash2` truncates by design, which is what makes this worth asserting.
    const out = gp();
    worldToTile(gridToWorldX(-0.5, -0.5), gridToWorldY(-0.5, -0.5), out);
    expect(out).toEqual({ gx: -1, gy: -1 });
    worldToTile(gridToWorldX(0.5, 0.5), gridToWorldY(0.5, 0.5), out);
    expect(out).toEqual({ gx: 0, gy: 0 });
  });

  it('puts a tile boundary exactly on the lower tile', () => {
    const out = gp();
    worldToTile(gridToWorldX(3, 4), gridToWorldY(3, 4), out);
    expect(out).toEqual({ gx: 3, gy: 4 });
  });
});

describe('depthOf', () => {
  it('is gx + gy for a point — the key the module header promises', () => {
    expect(depthOf(3, 4)).toBe(7);
    expect(depthOf(-2, 0.5)).toBe(-1.5);
  });

  it('is taken at the far corner, so a big building sorts as if it stood at its near tile', () => {
    expect(depthOf(0, 0, 2, 2)).toBe(4);
    // The 2x2 at the origin sorts after a 1x1 at (1, 1), which it stands in front of.
    expect(depthOf(0, 0, 2, 2)).toBeGreaterThan(depthOf(1, 1, 0.3, 0.3));
    // …and without the extents it would not, which is the bug the extents exist to fix.
    expect(depthOf(0, 0)).toBeLessThan(depthOf(1, 1));
  });
});

describe('tileDiamond', () => {
  it('writes north, east, south, west clockwise from the north vertex', () => {
    const out = new Float64Array(8);
    tileDiamond(2, 3, out);
    const cx = gridToWorldX(2, 3);
    const cy = gridToWorldY(2, 3);
    expect(Array.from(out)).toEqual([
      cx, cy,
      cx + HALF_W, cy + HALF_H,
      cx, cy + TILE_H,
      cx - HALF_W, cy + HALF_H,
    ]);
  });

  it('names its own mistake when the buffer is short', () => {
    expect(() => tileDiamond(0, 0, new Float64Array(7))).toThrow(RangeError);
    expect(() => tileDiamond(0, 0, new Float64Array(7))).toThrow(/length >= 8, got 7/);
  });

  it('returns the buffer it was given', () => {
    const out = new Float64Array(8);
    expect(tileDiamond(0, 0, out)).toBe(out);
  });
});

describe('footprintBounds and tileBounds', () => {
  it('encloses all four ground corners of the footprint', () => {
    const out = footprintBounds(2, 5, 3, 4, 0, rect());
    const corners: readonly (readonly [number, number])[] = [
      [2, 5],
      [5, 5],
      [5, 9],
      [2, 9],
    ];
    for (const [gx, gy] of corners) {
      const wx = gridToWorldX(gx, gy);
      const wy = gridToWorldY(gx, gy);
      expect(wx).toBeGreaterThanOrEqual(out.minX);
      expect(wx).toBeLessThanOrEqual(out.maxX);
      expect(wy).toBeGreaterThanOrEqual(out.minY);
      expect(wy).toBeLessThanOrEqual(out.maxY);
    }
  });

  it('T8: extends the top edge upward by the height and nothing else', () => {
    const flat = footprintBounds(0, 0, 1, 1, 0, rect());
    const tall = footprintBounds(0, 0, 1, 1, 200, rect());
    expect(tall.minY).toBe(flat.minY - 200);
    expect(tall.maxY).toBe(flat.maxY);
    expect(tall.minX).toBe(flat.minX);
    expect(tall.maxX).toBe(flat.maxX);
  });

  it('tileBounds is footprintBounds under the name a camera site reads better with', () => {
    const a = tileBounds(0, 0, 48, 48, 0, rect());
    const b = footprintBounds(0, 0, 48, 48, 0, rect());
    expect(a).toEqual(b);
  });

  it('handles a zero-size footprint as a point', () => {
    const out = footprintBounds(4, 4, 0, 0, 0, rect());
    expect(rectWidth(out)).toBe(0);
    expect(rectHeight(out)).toBe(0);
    expect(rectIsEmpty(out)).toBe(true);
  });
});

describe('Rect', () => {
  it('sets, sizes and measures', () => {
    const r = rectSet(rect(), 1, 2, 5, 8);
    expect(r).toEqual({ minX: 1, minY: 2, maxX: 5, maxY: 8 });
    expect(rectWidth(r)).toBe(4);
    expect(rectHeight(r)).toBe(6);
    expect(rectCenterX(r)).toBe(3);
    expect(rectCenterY(r)).toBe(5);
    expect(rectFromSize(rect(), 1, 2, 4, 6)).toEqual(r);
  });

  it('centers without overflowing on a huge rectangle', () => {
    // `(min + max) / 2` and `min + (max - min) / 2` both overflow to Infinity here;
    // `min/2 + max/2` does not, and halving is exact in binary so nothing is lost.
    const r = rectSet(rect(), -1e308, -1e308, 1e308, 1e308);
    expect(rectCenterX(r)).toBe(0);
    expect(rectCenterY(r)).toBe(0);
  });

  it('contains half-open, so tiled rectangles never double-count a seam', () => {
    const r = rectSet(rect(), 0, 0, 10, 10);
    expect(rectContains(r, 0, 0)).toBe(true);
    expect(rectContains(r, 9.999, 9.999)).toBe(true);
    expect(rectContains(r, 10, 5)).toBe(false);
    expect(rectContains(r, 5, 10)).toBe(false);
    expect(rectContains(r, -0.001, 5)).toBe(false);
    expect(rectContains(r, 5, -0.001)).toBe(false);
  });

  it('intersects strictly, so touching edges are adjacent rather than overlapping', () => {
    const a = rectSet(rect(), 0, 0, 10, 10);
    expect(rectIntersects(a, rectSet(rect(), 10, 0, 20, 10))).toBe(false);
    expect(rectIntersects(a, rectSet(rect(), 0, 10, 10, 20))).toBe(false);
    expect(rectIntersects(a, rectSet(rect(), 9.999, 0, 20, 10))).toBe(true);
    expect(rectIntersects(a, rectSet(rect(), -20, -20, -10, -10))).toBe(false);
    expect(rectIntersects(a, rectSet(rect(), 2, 2, 3, 3))).toBe(true);
  });

  it('expands and shrinks in place, and a shrink past the middle inverts rather than clamps', () => {
    const r = rectExpand(rectSet(rect(), 0, 0, 10, 10), 2);
    expect(r).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    const inverted = rectExpand(rectSet(rect(), 0, 0, 4, 4), -3);
    expect(rectIsEmpty(inverted)).toBe(true);
  });

  it('unions, and tolerates out aliasing either input', () => {
    const a = rectSet(rect(), 0, 0, 4, 4);
    const b = rectSet(rect(), 6, -2, 8, 1);
    expect(rectUnion(rect(), a, b)).toEqual({ minX: 0, minY: -2, maxX: 8, maxY: 4 });
    const aliased = rectSet(rect(), 0, 0, 4, 4);
    rectUnion(aliased, aliased, b);
    expect(aliased).toEqual({ minX: 0, minY: -2, maxX: 8, maxY: 4 });
    // The mirror case, so each of the four comparisons is exercised both ways: here `a` wins
    // on the maxima and `b` on the minima, which is the opposite of the pair above.
    const wide = rectSet(rect(), -5, -5, 20, 20);
    const narrow = rectSet(rect(), -9, -1, 3, 30);
    expect(rectUnion(rect(), wide, narrow)).toEqual({
      minX: -9,
      minY: -5,
      maxX: 20,
      maxY: 30,
    });
  });

  it('accumulates a bounding box from zero items through rectMakeEmpty', () => {
    const box = rectMakeEmpty(rect());
    expect(rectIsEmpty(box)).toBe(true);
    // Without the inverted-infinity start, the first item has to be special-cased and the box
    // ends up always containing the origin.
    for (const [x, y] of [[5, 5], [7, 2]] as const) {
      rectUnion(box, box, rectSet(rect(), x, y, x + 1, y + 1));
    }
    expect(box).toEqual({ minX: 5, minY: 2, maxX: 8, maxY: 6 });
    expect(rectIsEmpty(box)).toBe(false);
  });

  it('calls a zero-area rectangle empty, in agreement with rectContains', () => {
    const zero = rectSet(rect(), 3, 3, 3, 8);
    expect(rectIsEmpty(zero)).toBe(true);
    expect(rectContains(zero, 3, 5)).toBe(false);
  });
});
