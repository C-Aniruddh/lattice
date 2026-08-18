/**
 * `hittest` — the six-point contract, the march that terrain forces, and the floor.
 *
 * The silhouette order test here is the `iso` half of a cross-package contract: `draw`'s solid
 * kit must stroke a box in the same six points in the same order, or hit-testing and pixels
 * diverge with no test in either package noticing, because each is correct against its own
 * idea of the shape. It is sited here because this function is the definition.
 */

import { describe, expect, it } from 'vitest';
import { v2 } from '@latticekit/core';
import {
  boxSilhouette,
  pointInPolygon,
  pointInTile,
  screenToTile,
  screenToTileOnHeights,
} from '../src/hittest.js';
import type { Volume } from '../src/hittest.js';
import { createCamera, gridToScreen } from '../src/camera.js';
import { HALF_H, HALF_W, gridToWorldX, gridToWorldY, rectSet } from '../src/projection.js';
import type { Rect, Tile } from '../src/projection.js';
import { TileGrid, tileSourceOf } from '../src/tilemap.js';
import { worldToTileOnHeights } from '../src/height.js';
import type { HeightField } from '../src/height.js';

const rect = (): Rect => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
const huge = (): Rect => rectSet(rect(), -1e6, -1e6, 1e6, 1e6);
const tile = (): Tile => ({ gx: 0, gy: 0 });

describe('screenToTile', () => {
  it('is the exact inverse of gridToScreen at zPx = 0', () => {
    const cam = createCamera(800, 600, { bounds: huge(), zoom: 2 });
    cam.centerOnTile(10, 4);
    const out = tile();
    for (let gx = 5; gx < 16; gx++) {
      for (let gy = 0; gy < 10; gy++) {
        // The center of the tile, projected, must resolve back to that tile.
        const s = gridToScreen(cam, gx + 0.5, gy + 0.5, 0, v2());
        screenToTile(cam, s.x, s.y, out);
        expect([out.gx, out.gy]).toEqual([gx, gy]);
      }
    }
  });

  it('T1: floors, so a ghost jumps at the tile edge and not at its middle', () => {
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.centerOn(0, 0);
    const out = tile();
    // A point three-quarters of the way across tile (0, 0): `Math.round` snaps to the nearest
    // vertex and answers (1, 1), which is wrong for three quarters of every diamond.
    const s = gridToScreen(cam, 0.75, 0.75, 0, v2());
    screenToTile(cam, s.x, s.y, out);
    expect(out).toEqual({ gx: 0, gy: 0 });
  });

  it('has no seam at the world origin', () => {
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.centerOn(0, 0);
    const out = tile();
    screenToTile(cam, gridToScreen(cam, -0.25, -0.25, 0, v2()).x, gridToScreen(cam, -0.25, -0.25, 0, v2()).y, out);
    expect(out).toEqual({ gx: -1, gy: -1 });
  });

  it('returns the out-parameter it was given', () => {
    const cam = createCamera(100, 100, { bounds: huge() });
    const out = tile();
    expect(screenToTile(cam, 50, 50, out)).toBe(out);
  });
});

describe('pointInTile', () => {
  it('is true only inside the diamond, and the diamond is the unit cell', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    const inside = gridToScreen(cam, 2.5, 3.5, 0, v2());
    expect(pointInTile(cam, inside.x, inside.y, 2, 3)).toBe(true);
    expect(pointInTile(cam, inside.x, inside.y, 3, 3)).toBe(false);
    // The four points just outside the four edges of the diamond, in grid space.
    for (const [dx, dy] of [
      [-0.01, 0.5],
      [1.01, 0.5],
      [0.5, -0.01],
      [0.5, 1.01],
    ] as const) {
      const s = gridToScreen(cam, 2 + dx, 3 + dy, 0, v2());
      expect(pointInTile(cam, s.x, s.y, 2, 3)).toBe(false);
    }
  });

  it('agrees with screenToTile everywhere', () => {
    const cam = createCamera(300, 200, { bounds: huge(), zoom: 1.5 });
    cam.centerOnTile(2, 2);
    const out = tile();
    for (let sx = 0; sx <= 300; sx += 17) {
      for (let sy = 0; sy <= 200; sy += 13) {
        screenToTile(cam, sx, sy, out);
        expect(pointInTile(cam, sx, sy, out.gx, out.gy)).toBe(true);
        expect(pointInTile(cam, sx, sy, out.gx + 1, out.gy)).toBe(false);
      }
    }
  });
});

describe('boxSilhouette', () => {
  const unit: Volume = { ox: 0, oy: 0, w: 1, d: 1, zPx: 0, hPx: 32 };

  it('writes six points in the contracted order: north-top, east-top, east-base, south-base, west-base, west-top', () => {
    // **The cross-package contract with `draw`.** Each point is derived here from
    // `gridToScreen` rather than from the implementation, so this test states the shape
    // independently of the code that produces it.
    const cam = createCamera(400, 400, { bounds: huge(), zoom: 2 });
    cam.centerOn(0, 0);
    const out = boxSilhouette(cam, 3, 4, unit, new Float64Array(12));
    const expected = [
      gridToScreen(cam, 3, 4, 32, v2()),
      gridToScreen(cam, 4, 4, 32, v2()),
      gridToScreen(cam, 4, 4, 0, v2()),
      gridToScreen(cam, 4, 5, 0, v2()),
      gridToScreen(cam, 3, 5, 0, v2()),
      gridToScreen(cam, 3, 5, 32, v2()),
    ];
    for (let i = 0; i < 6; i++) {
      expect(out[i * 2]).toBe((expected[i] as { x: number }).x);
      expect(out[i * 2 + 1]).toBe((expected[i] as { y: number }).y);
    }
  });

  it('traces a simple hexagon: x runs left-right-right-middle-left-left down the screen', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    const out = boxSilhouette(cam, 0, 0, unit, new Float64Array(12));
    const [xN, yN, xE, yET, , yEB, xS, , xW, yWB, , yWT] = Array.from(out) as number[];
    // North is above east-top; east is right of north; west is left of north; south is between
    // them. The two corners the outline omits always project strictly inside this shape.
    expect(xE).toBeGreaterThan(xN as number);
    expect(xW).toBeLessThan(xN as number);
    expect(xS).toBe(xN);
    expect(yN).toBeLessThan(yET as number);
    expect(yEB).toBeGreaterThan(yET as number);
    expect(yWB).toBeGreaterThan(yWT as number);
  });

  it('honours the offsets, the base elevation and the height', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    const raised: Volume = { ox: 1, oy: 2, w: 2, d: 3, zPx: 16, hPx: 48 };
    const out = boxSilhouette(cam, 0, 0, raised, new Float64Array(12));
    expect(out[0]).toBe(cam.toScreenX(gridToWorldX(1, 2)));
    expect(out[1]).toBe(cam.toScreenY(gridToWorldY(1, 2) - 64));
    expect(out[7]).toBe(cam.toScreenY(gridToWorldY(3, 5) - 16));
  });

  it('makes a zero-height volume a flat diamond, with top and base coincident', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    const flat: Volume = { ox: 0, oy: 0, w: 1, d: 1, zPx: 0, hPx: 0 };
    const out = boxSilhouette(cam, 0, 0, flat, new Float64Array(12));
    expect(out[3]).toBe(out[5]);
    expect(out[9]).toBe(out[11]);
  });

  it('names its own mistake when the buffer is short', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    expect(() => boxSilhouette(cam, 0, 0, unit, new Float64Array(11))).toThrow(
      /length >= 12, got 11/,
    );
  });

  it('is a shape a tap can be tested against', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    const tall: Volume = { ox: 0, oy: 0, w: 1, d: 1, zPx: 0, hPx: 96 };
    const poly = boxSilhouette(cam, 0, 0, tall, new Float64Array(12));
    // T4: the pixels showing a building's body sit over the tile *behind* it, so the middle of
    // the body is not inside the ground diamond and a footprint-only hit test misses the tap
    // that a player would swear they aimed perfectly.
    const body = gridToScreen(cam, 0.5, 0.5, 48, v2());
    expect(pointInPolygon(body.x, body.y, poly, 6)).toBe(true);
    expect(pointInTile(cam, body.x, body.y, 0, 0)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('is an even-odd cast over count points', () => {
    const square = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]);
    expect(pointInPolygon(5, 5, square, 4)).toBe(true);
    expect(pointInPolygon(-1, 5, square, 4)).toBe(false);
    expect(pointInPolygon(11, 5, square, 4)).toBe(false);
    expect(pointInPolygon(5, -1, square, 4)).toBe(false);
    expect(pointInPolygon(5, 11, square, 4)).toBe(false);
  });

  it('handles a concave shape, where a convex test would be wrong', () => {
    // An L. The notch is outside, and a bounding-box or convex test says otherwise.
    const ell = new Float64Array([0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10]);
    expect(pointInPolygon(2, 2, ell, 6)).toBe(true);
    expect(pointInPolygon(8, 8, ell, 6)).toBe(false);
    expect(pointInPolygon(8, 2, ell, 6)).toBe(true);
  });

  it('is false for a degenerate polygon rather than throwing', () => {
    const two = new Float64Array([0, 0, 1, 1]);
    expect(pointInPolygon(0, 0, two, 2)).toBe(false);
    expect(pointInPolygon(0, 0, two, 0)).toBe(false);
  });

  it('throws when the buffer is too short for the count it was promised', () => {
    expect(() => pointInPolygon(0, 0, new Float64Array(5), 3)).toThrow(
      /hold 6 values for 3 points, got 5/,
    );
  });
});

describe('screenToTileOnHeights', () => {
  /** A ridge: everything at height 0 except a plateau of `high` over a rectangle of tiles. */
  function ridge(high: number): HeightField {
    const grid = new TileGrid(40, 40, { originGx: -20, originGy: -20 });
    grid.fillFrom((gx, gy) => (gx >= 8 && gx <= 12 && gy >= 8 && gy <= 12 ? high : 0));
    return { heights: grid, stepPx: 8 };
  }

  it('agrees with screenToTile on genuinely flat ground', () => {
    const cam = createCamera(600, 400, { bounds: huge() });
    cam.centerOnTile(0, 0);
    const field: HeightField = { heights: new TileGrid(40, 40, { originGx: -20, originGy: -20 }), stepPx: 8 };
    const flat = tile();
    const marched = tile();
    for (let sx = 100; sx < 500; sx += 37) {
      for (let sy = 100; sy < 300; sy += 29) {
        screenToTile(cam, sx, sy, flat);
        expect(screenToTileOnHeights(cam, sx, sy, field, 0, marched)).toBe(true);
        expect(marched).toEqual(flat);
      }
    }
  });

  it('I25: on a ridge, returns the tile whose surface the cursor is over', () => {
    // The whole point. The pixel showing the top of the plateau is also the pixel showing flat
    // ground two tiles further back, and `screenToTile` confidently returns the second.
    const field = ridge(4);
    const maxHeightPx = 4 * 8;
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.centerOnTile(10, 10);
    const out = tile();
    // Project the center of the plateau tile (10, 10) at its own surface height.
    const s = gridToScreen(cam, 10.5, 10.5, maxHeightPx, v2());
    expect(screenToTileOnHeights(cam, s.x, s.y, field, maxHeightPx, out)).toBe(true);
    expect(out).toEqual({ gx: 10, gy: 10 });
    const flat = screenToTile(cam, s.x, s.y, tile());
    // …and the flat answer is a different, further tile, which is the bug being avoided.
    expect(flat).not.toEqual({ gx: 10, gy: 10 });
  });

  it('I25: gets every pixel of a rendered slope right, not just the middle', () => {
    const field = ridge(4);
    const maxHeightPx = 32;
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.centerOnTile(10, 10);
    const out = tile();
    // Sample the surface of every plateau tile at four interior points and check the march
    // lands back on the tile whose surface was projected.
    for (let gx = 8; gx <= 11; gx++) {
      for (let gy = 8; gy <= 11; gy++) {
        for (const [fx, fy] of [
          [0.3, 0.3],
          [0.7, 0.3],
          [0.3, 0.7],
          [0.7, 0.7],
        ] as const) {
          const s = gridToScreen(cam, gx + fx, gy + fy, maxHeightPx, v2());
          expect(screenToTileOnHeights(cam, s.x, s.y, field, maxHeightPx, out)).toBe(true);
          expect([out.gx, out.gy, gx, gy]).toEqual([gx, gy, gx, gy]);
        }
      }
    }
  });

  it('reports the ray leaving the map rather than inventing a plausible tile', () => {
    const field: HeightField = {
      heights: new TileGrid(4, 4),
      stepPx: 8,
    };
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOnTile(100, 100);
    const out = tile();
    expect(screenToTileOnHeights(cam, 200, 200, field, 0, out)).toBe(false);
    // A tap on the sky that selects the shore is worse than a tap that does nothing, so `out`
    // is left exactly as the caller had it.
    expect(out).toEqual({ gx: 0, gy: 0 });
  });

  it('returns false when the terrain never reaches the ray', () => {
    // A field entirely below the ground plane: there is no elevation at which the surface
    // meets the screen ray, so there is nothing under the cursor.
    const field: HeightField = { heights: tileSourceOf(() => -5), stepPx: 8 };
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(screenToTileOnHeights(cam, 200, 200, field, 64, tile())).toBe(false);
  });

  it('accepts an under-declared maximum rather than looping, and says so by answering high', () => {
    const field: HeightField = { heights: tileSourceOf(() => 10), stepPx: 8 };
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    // maxHeightPx of 0 against terrain 80 pixels up: the surface is already above the start of
    // the march, so the answer is the candidate at the declared maximum. Under-declaring costs
    // accuracy, not liveness.
    expect(screenToTileOnHeights(cam, 200, 200, field, 0, tile())).toBe(true);
  });

  it('refuses a maximum that is not a finite number at or above zero', () => {
    const field: HeightField = { heights: tileSourceOf(() => 0), stepPx: 8 };
    const cam = createCamera(400, 400, { bounds: huge() });
    expect(() => screenToTileOnHeights(cam, 0, 0, field, -1, tile())).toThrow(
      /maxHeightPx to be a finite number >= 0, got -1/,
    );
    expect(() => screenToTileOnHeights(cam, 0, 0, field, Number.NaN, tile())).toThrow(RangeError);
  });

  it('is deterministic: the same pixel resolves to the same tile every time', () => {
    // A fixed refinement count rather than a tolerance, so a slow phone and a fast desktop
    // take the same number of steps and reach the same answer.
    const field = ridge(3);
    const cam = createCamera(500, 500, { bounds: huge() });
    cam.centerOnTile(10, 10);
    const a = tile();
    const b = tile();
    for (let i = 0; i < 20; i++) {
      screenToTileOnHeights(cam, 231 + i, 187, field, 24, i === 0 ? a : b);
    }
    screenToTileOnHeights(cam, 231, 187, field, 24, b);
    expect(b).toEqual(a);
  });

  it('is the camera and nothing else — every answer is `worldToTileOnHeights` on the same point', () => {
    // The reduction, stated as a property rather than trusted to a reader diffing two functions.
    // This used to be two copies of one bisection — one here, one in `height.ts` — and the pin
    // lived downstream in `packages/input/test/terrain.test.ts` because that is the package the
    // drift would have hurt. Now the composition is the implementation, and the invariant belongs
    // to the package that owns both halves. A hover ring drawn from this call and a tap resolved
    // through the other must land on one tile; a `false` from either must be a `false` from both.
    const wave = (x: number, period: number): number => {
      const half = period / 2;
      const at = ((x % period) + period) % period;
      return at < half ? at : period - at;
    };
    const grid = new TileGrid(48, 48, { originGx: -24, originGy: -24 });
    grid.fillFrom((gx, gy) => wave(gx + 24, 18) + wave(gy + 24, 12) - 2);
    const field: HeightField = { heights: grid, stepPx: 6 };
    const cam = createCamera(800, 600, { bounds: huge(), minZoom: 0.25, maxZoom: 4 });
    cam.centerOnTile(4, 6);
    const a = tile();
    const b = tile();
    let offMap = 0;
    let onMap = 0;
    for (const zoom of [0.4, 1, 2.75]) {
      cam.zoomAt(zoom / cam.zoom, 400, 300);
      for (let sx = -40; sx <= 840; sx += 37) {
        for (let sy = -40; sy <= 640; sy += 29) {
          for (const maxHeightPx of [0, 48, 150]) {
            const hit = screenToTileOnHeights(cam, sx, sy, field, maxHeightPx, a);
            const same = worldToTileOnHeights(
              field,
              cam.toWorldX(sx),
              cam.toWorldY(sy),
              maxHeightPx,
              b,
            );
            expect(same).toBe(hit);
            if (hit) {
              // `toBe` per component, not `toEqual` on the pair: equivalent is not the claim,
              // identical is, and a shifted picking coordinate is the bug this guards.
              expect(a.gx).toBe(b.gx);
              expect(a.gy).toBe(b.gy);
              onMap += 1;
            } else offMap += 1;
          }
        }
      }
    }
    // Both branches were actually taken, or the sweep proves only that two functions agree about
    // nothing. A sweep that never leaves the map cannot see a disagreement about leaving it.
    expect(onMap).toBeGreaterThan(100);
    expect(offMap).toBeGreaterThan(10);
  });

  it('refuses the bad maximum before it asks the camera anything', () => {
    // The guard is restated here rather than inherited from `worldToTileOnHeights`, so the
    // message names the call the caller wrote. A `worldToTileOnHeights:` prefix on a
    // `screenToTileOnHeights` mistake sends them looking for a function they never called.
    const field: HeightField = { heights: tileSourceOf(() => 0), stepPx: 8 };
    const cam = createCamera(400, 400, { bounds: huge() });
    expect(() => screenToTileOnHeights(cam, 0, 0, field, -1, tile())).toThrow(
      /^screenToTileOnHeights: /,
    );
  });

  it('uses HALF_H-sized steps, so a one-tile-wide spike cannot be stepped over', () => {
    // The march advances the candidate ground point by one unit of `gx + gy` per step; a
    // coarser step would skip tiles and a taller map would miss its own peaks.
    expect(HALF_H).toBe(16);
    expect(HALF_W).toBe(32);
    const grid = new TileGrid(20, 20);
    grid.fillFrom((gx, gy) => (gx === 10 && gy === 10 ? 2 : 0));
    const field: HeightField = { heights: grid, stepPx: 16 };
    const cam = createCamera(600, 600, { bounds: huge() });
    cam.centerOnTile(10, 10);
    const out = tile();
    const s = gridToScreen(cam, 10.5, 10.5, 32, v2());
    expect(screenToTileOnHeights(cam, s.x, s.y, field, 32, out)).toBe(true);
    expect(out).toEqual({ gx: 10, gy: 10 });
  });
});
