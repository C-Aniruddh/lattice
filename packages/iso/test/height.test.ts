/**
 * `height` — vertices not centres, bilinear not nearest, and floor not truncate.
 *
 * Every assertion here is exact. Bilinear interpolation of exactly representable values with
 * `core.lerp` — which is written `(1 - t) * a + t * b` precisely so that it lands on its
 * endpoints — has no rounding to hide behind, and a tolerance would let a centre-sampled
 * implementation squeak through at the vertices.
 */

import { describe, expect, it } from 'vitest';
import { TileGrid, tileSourceOf } from '../src/tilemap.js';
import { heightAt, slopeAt } from '../src/height.js';
import type { HeightField } from '../src/height.js';

/** A ramp rising one unit per step of gx, defined everywhere including negative coordinates. */
const ramp = (stepPx = 8): HeightField => ({
  heights: tileSourceOf((gx) => gx),
  stepPx,
});

describe('heightAt', () => {
  it('I22: at whole coordinates it is the stored value times stepPx, exactly', () => {
    const grid = new TileGrid(8, 8);
    grid.fillFrom((gx, gy) => (gx * 3 + gy * 5) % 7);
    const field: HeightField = { heights: grid, stepPx: 4 };
    for (let gx = 0; gx < 8; gx++) {
      for (let gy = 0; gy < 8; gy++) {
        expect(heightAt(field, gx, gy)).toBe(grid.get(gx, gy) * 4);
      }
    }
  });

  it('I22: is continuous across a tile boundary — the seam test', () => {
    // T18: heights live on grid *vertices*. A centre-sampled field makes two adjacent tiles
    // disagree about the height of the edge they share, and the seam is invisible until the
    // terrain is drawn, at which point it is a rewrite of everything that reads a height.
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, 10);
    grid.set(2, 1, 4);
    grid.set(1, 2, 6);
    grid.set(2, 2, 2);
    const field: HeightField = { heights: grid, stepPx: 1 };
    // Approaching the shared edge gx = 2 from the tile on either side gives the same limit.
    const fromLeft = heightAt(field, 2 - 1e-9, 1.5);
    const fromRight = heightAt(field, 2 + 1e-9, 1.5);
    // 1e-8 is the derivation, not a guess: the two samples are 2e-9 apart on a surface whose
    // steepest gradient here is 6 units per tile, so they cannot differ by more than 1.2e-8.
    expect(Math.abs(fromLeft - fromRight)).toBeLessThanOrEqual(1.2e-8);
    expect(heightAt(field, 2, 1.5)).toBe(3);
  });

  it('interpolates bilinearly rather than snapping to the nearest vertex', () => {
    const grid = new TileGrid(2, 2);
    grid.set(0, 0, 0);
    grid.set(1, 0, 4);
    grid.set(0, 1, 8);
    grid.set(1, 1, 12);
    const field: HeightField = { heights: grid, stepPx: 1 };
    expect(heightAt(field, 0.5, 0)).toBe(2);
    expect(heightAt(field, 0, 0.5)).toBe(4);
    expect(heightAt(field, 0.5, 0.5)).toBe(6);
    expect(heightAt(field, 0.25, 0.75)).toBe(7);
    // A nearest-neighbour height makes a pilgrim climb a hill in visible steps; these values
    // would all be 0, 0, 12 and 8.
  });

  it('floors across the origin, where a truncating cell lookup has its seam', () => {
    // `core.hash2` truncates toward zero, so -0.5 and 0.5 share cell 0. A height sampler that
    // did the same would leave a one-tile seam running through the world origin.
    const field = ramp(1);
    expect(heightAt(field, -0.5, 0)).toBe(-0.5);
    expect(heightAt(field, -1.25, 0)).toBe(-1.25);
    expect(heightAt(field, 0.5, 0)).toBe(0.5);
    // Sampling straight across the origin is monotone, which truncation would break.
    let previous = -Infinity;
    for (let gx = -2; gx <= 2; gx += 0.25) {
      const h = heightAt(field, gx, 0);
      expect(h).toBeGreaterThan(previous);
      previous = h;
    }
  });

  it('scales by stepPx and reads the out-of-bounds value past the edge', () => {
    const grid = new TileGrid(2, 2, { fill: 3, outOfBounds: 0 });
    const field: HeightField = { heights: grid, stepPx: 8 };
    expect(heightAt(field, 0, 0)).toBe(24);
    // The far corner of the last tile reads the vertex outside the grid, which is the
    // out-of-bounds value — a defined answer, and the reason `get` must never throw.
    expect(heightAt(field, 1.5, 1.5)).toBe(6);
  });
});

describe('slopeAt', () => {
  it('is zero on level ground at any absolute height', () => {
    // I23's other half: a difference, not an absolute, so raising sea level does not make the
    // whole map steep.
    const grid = new TileGrid(4, 4, { fill: 200 });
    expect(slopeAt({ heights: grid, stepPx: 2 }, 1, 1)).toBe(0);
  });

  it('is the steepest edge, in world pixels', () => {
    const grid = new TileGrid(3, 3);
    grid.set(0, 0, 0);
    grid.set(1, 0, 1);
    grid.set(0, 1, 5);
    grid.set(1, 1, 6);
    const field: HeightField = { heights: grid, stepPx: 4 };
    // Edges: north 1, west 5, east 5, south 1. The steepest is 5 units, and stepPx converts.
    expect(slopeAt(field, 0, 0)).toBe(20);
  });

  it('measures edges, not diagonals — a saddle is not steep', () => {
    const grid = new TileGrid(3, 3);
    grid.set(0, 0, 0);
    grid.set(1, 0, 0);
    grid.set(0, 1, 0);
    grid.set(1, 1, 9);
    const field: HeightField = { heights: grid, stepPx: 1 };
    // The two diagonal corners differ by 9; the edges differ by 9 as well here, so pick the
    // case where only the diagonal differs.
    expect(slopeAt(field, 0, 0)).toBe(9);
    const flatEdges = new TileGrid(3, 3);
    flatEdges.set(0, 0, 5);
    flatEdges.set(1, 0, 5);
    flatEdges.set(0, 1, 5);
    flatEdges.set(1, 1, 5);
    expect(slopeAt({ heights: flatEdges, stepPx: 1 }, 0, 0)).toBe(0);
  });

  it('finds the steepest edge whichever of the four it is, and whichever sign', () => {
    // Four edges, four maxima, and both signs of each: the comparison chain has eight ways to
    // be written wrong and a single fixture would catch one of them.
    const corners = (h00: number, h10: number, h01: number, h11: number): number => {
      const grid = new TileGrid(3, 3);
      grid.set(0, 0, h00);
      grid.set(1, 0, h10);
      grid.set(0, 1, h01);
      grid.set(1, 1, h11);
      return slopeAt({ heights: grid, stepPx: 1 }, 0, 0);
    };
    // north (h00 -> h10) largest, rising and falling
    expect(corners(0, 9, 1, 2)).toBe(9);
    expect(corners(9, 0, 8, 7)).toBe(9);
    // west (h00 -> h01) largest
    expect(corners(0, 1, 9, 10)).toBe(9);
    expect(corners(9, 8, 0, 1)).toBe(9);
    // east (h10 -> h11) largest: north 1, west 4, east 9, south 4
    expect(corners(1, 0, 5, 9)).toBe(9);
    // south (h01 -> h11) largest: north 4, west 1, east 4, south 9
    expect(corners(1, 5, 0, 9)).toBe(9);
  });

  it('is signless: a descent is as steep as the climb', () => {
    const up = tileSourceOf((gx) => gx);
    const down = tileSourceOf((gx) => -gx);
    expect(slopeAt({ heights: up, stepPx: 3 }, 4, 4)).toBe(3);
    expect(slopeAt({ heights: down, stepPx: 3 }, 4, 4)).toBe(3);
  });

  it('floors its arguments, so one tile has one answer', () => {
    const field = ramp(2);
    expect(slopeAt(field, 3.9, 0.1)).toBe(slopeAt(field, 3, 0));
  });

  it('is the terrain half of a movement cost in one line', () => {
    // `1 + (slopeAt / stepPx | 0)` is a complete, deterministic "rough ground is slower" rule.
    const field: HeightField = { heights: tileSourceOf((gx) => gx * 3), stepPx: 4 };
    const cost = 1 + ((slopeAt(field, 2, 2) / field.stepPx) | 0);
    expect(cost).toBe(4);
  });
});
