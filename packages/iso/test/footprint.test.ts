/**
 * `footprint` — occupancy, flatness, base and anchor, which are four questions and not one.
 *
 * The reason they are separate is an error message: a press that needs flat riverside ground
 * and free ground, refused by a system that conflated the two, tells the player the wrong
 * reason and they go and clear a tile that was never the problem.
 */

import { describe, expect, it } from 'vitest';
import { TileGrid, tileSourceOf } from '../src/tilemap.js';
import {
  footprintAnchor,
  footprintBase,
  footprintContains,
  footprintFlatness,
  footprintOverlaps,
  forEachFootprintTile,
} from '../src/footprint.js';
import type { Footprint } from '../src/footprint.js';
import type { HeightField } from '../src/height.js';
import type { Anchor } from '../src/anchor.js';

const fp = (gx: number, gy: number, w: number, d: number): Footprint => ({ gx, gy, w, d });
const anchor = (): Anchor => ({ gx: 0, gy: 0, zPx: 0 });

describe('footprintContains', () => {
  it('is half-open, so footprints laid edge to edge cover each tile once', () => {
    const f = fp(2, 3, 2, 3);
    expect(footprintContains(f, 2, 3)).toBe(true);
    expect(footprintContains(f, 3, 5)).toBe(true);
    expect(footprintContains(f, 4, 3)).toBe(false);
    expect(footprintContains(f, 2, 6)).toBe(false);
    expect(footprintContains(f, 1, 3)).toBe(false);
    expect(footprintContains(f, 2, 2)).toBe(false);
  });

  it('keeps w along +gx and d along +gy, which is the ninety-degree mistake', () => {
    const wide = fp(0, 0, 3, 1);
    expect(footprintContains(wide, 2, 0)).toBe(true);
    expect(footprintContains(wide, 0, 2)).toBe(false);
  });
});

describe('footprintOverlaps', () => {
  it('lets buildings touch but not overlap', () => {
    const a = fp(0, 0, 2, 2);
    expect(footprintOverlaps(a, fp(2, 0, 2, 2))).toBe(false);
    expect(footprintOverlaps(a, fp(0, 2, 2, 2))).toBe(false);
    expect(footprintOverlaps(a, fp(1, 1, 2, 2))).toBe(true);
    expect(footprintOverlaps(a, fp(-1, -1, 2, 2))).toBe(true);
    expect(footprintOverlaps(a, fp(5, 5, 1, 1))).toBe(false);
    expect(footprintOverlaps(a, a)).toBe(true);
  });

  it('is symmetric', () => {
    const a = fp(0, 0, 3, 1);
    const b = fp(2, 0, 1, 4);
    expect(footprintOverlaps(a, b)).toBe(footprintOverlaps(b, a));
  });
});

describe('forEachFootprintTile', () => {
  it('visits every tile once, row-major', () => {
    const seen: string[] = [];
    forEachFootprintTile(fp(1, 2, 3, 2), (gx, gy) => seen.push(`${String(gx)},${String(gy)}`));
    expect(seen).toEqual(['1,2', '2,2', '3,2', '1,3', '2,3', '3,3']);
  });

  it('visits nothing for a zero-size footprint', () => {
    let calls = 0;
    forEachFootprintTile(fp(0, 0, 0, 5), () => (calls += 1));
    expect(calls).toBe(0);
  });

  it('agrees with footprintContains on every tile it visits', () => {
    const f = fp(-2, -3, 4, 5);
    let count = 0;
    forEachFootprintTile(f, (gx, gy) => {
      expect(footprintContains(f, gx, gy)).toBe(true);
      count += 1;
    });
    expect(count).toBe(20);
  });
});

describe('footprintFlatness', () => {
  it('I23: is zero on level ground and invariant under raising the whole field', () => {
    const low: HeightField = { heights: new TileGrid(8, 8, { fill: 0 }), stepPx: 4 };
    const high: HeightField = { heights: new TileGrid(8, 8, { fill: 40 }), stepPx: 4 };
    expect(footprintFlatness(low, fp(1, 1, 3, 3))).toBe(0);
    expect(footprintFlatness(high, fp(1, 1, 3, 3))).toBe(0);
    // A press that cannot be placed anywhere above sea level is the failure this rules out.
  });

  it('samples the (w+1) x (d+1) vertices, so the far edge counts', () => {
    // Sampling `w x d` tile origins misses the far edge of the footprint entirely, which is
    // exactly where a building on the lip of a cliff is wrong.
    const grid = new TileGrid(4, 4);
    grid.set(2, 0, 10);
    grid.set(2, 1, 10);
    const field: HeightField = { heights: grid, stepPx: 1 };
    expect(footprintFlatness(field, fp(0, 0, 2, 1))).toBe(10);
    expect(footprintFlatness(field, fp(0, 0, 1, 1))).toBe(0);
  });

  it('is a difference in world pixels', () => {
    const grid = new TileGrid(4, 4);
    grid.fillFrom((gx) => gx);
    const field: HeightField = { heights: grid, stepPx: 6 };
    // Vertices 0..2 across a 2-wide footprint: two units of rise, six pixels each.
    expect(footprintFlatness(field, fp(0, 0, 2, 1))).toBe(12);
  });

  it('is zero for a footprint with no vertices at all', () => {
    const field: HeightField = { heights: tileSourceOf(() => 5), stepPx: 1 };
    expect(footprintFlatness(field, fp(0, 0, -1, -1))).toBe(0);
  });
});

describe('footprintBase', () => {
  it('is the maximum vertex height, not the mean', () => {
    // A building resting on the mean of a slope has one corner buried and one floating, and a
    // floating corner reads as a bug where a buried one reads as foundations.
    const grid = new TileGrid(4, 4);
    grid.fillFrom((gx) => gx * 2);
    const field: HeightField = { heights: grid, stepPx: 3 };
    expect(footprintBase(field, fp(0, 0, 2, 2))).toBe(4 * 3);
  });

  it('is zero for a footprint with no vertices, rather than -Infinity', () => {
    const field: HeightField = { heights: tileSourceOf(() => 5), stepPx: 1 };
    // An -Infinity would propagate into a draw call and put the building somewhere no
    // debugger would look for it.
    expect(footprintBase(field, fp(0, 0, -1, 0))).toBe(0);
  });

  it('composes with an own height, which is the single number footprintBounds wants', () => {
    const field: HeightField = { heights: tileSourceOf(() => 3), stepPx: 8 };
    const total = footprintBase(field, fp(0, 0, 1, 1)) + 50;
    expect(total).toBe(74);
  });
});

describe('footprintAnchor', () => {
  it('hangs from the centre, not the origin corner', () => {
    // On a 3x3 those are most of a building apart, and anchoring to the corner is what makes
    // a confirm button appear to belong to the building next door.
    const out = anchor();
    expect(footprintAnchor(fp(4, 6, 3, 3), 40, out)).toBe(out);
    expect(out).toEqual({ gx: 5.5, gy: 7.5, zPx: 40 });
  });

  it('centres a 1x1 at the middle of its own tile', () => {
    const out = footprintAnchor(fp(0, 0, 1, 1), 0, anchor());
    expect(out).toEqual({ gx: 0.5, gy: 0.5, zPx: 0 });
  });

  it('writes into the caller-owned anchor, which is what an overlay must hold', () => {
    // T19: an overlay holds the entity's anchor, never a copy — a tag that copied the numbers
    // stays where the building used to be.
    const owned = anchor();
    footprintAnchor(fp(0, 0, 2, 2), 10, owned);
    footprintAnchor(fp(8, 8, 2, 2), 20, owned);
    expect(owned).toEqual({ gx: 9, gy: 9, zPx: 20 });
  });
});
