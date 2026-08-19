/**
 * The ground, and the tile that depends on it — kit gap K44.
 *
 * Every assertion here fails if the seam is removed, because every one of them compares the
 * answer this package gives against the answer the *geometry* gives, and on sloped ground those
 * are different tiles. The flat answer is not a straw man: it is the exact inverse of the
 * projection on the plane `z = 0`, it is a real tile next to the right one, and it moves with
 * the pointer. Nothing but a test that knows where the hill is can tell them apart.
 *
 * Three shapes of truth, deliberately derived three different ways, because a test that computes
 * the expected value the way the implementation does proves only that the code is self-consistent:
 *
 * | terrain | how the expected tile is derived |
 * |---|---|
 * | a plateau at a constant height | arithmetic — a constant rise is exactly a shift of `HALF_H` per unit of `gx + gy` |
 * | a linear ramp | closed form — solve `height(u + v) = t` for the elevation the ray meets |
 * | a lumpy hill | a brute-force scan down the ray, which shares no line with the march |
 */

import { describe, expect, it } from 'vitest';
import {
  HALF_H,
  HALF_W,
  TileGrid,
  heightAt,
  screenToTile,
  screenToTileOnHeights,
  worldToTileOnHeights,
} from '@latticekit/iso';
import type { Camera, GridPoint, HeightField, Tile } from '@latticekit/iso';
import { createHeadlessInput } from '../src/system.js';
import { TilePicker } from '../src/terrain.js';
import type { Diagnostic } from '../src/sample.js';
import type { ActionEvent, TapGesture } from '../src/events.js';
import { STEP_60, camera, down, harness, move, up } from './harness.js';

/** A bounded field so that `has` is a real answer. Centered on the origin, because the camera
 *  is: screen (400, 300) is world (0, 0) is grid (0, 0). */
function fieldOf(stepPx: number, units: (gx: number, gy: number) => number): HeightField {
  const heights = new TileGrid(64, 64, { originGx: -32, originGy: -32, bits: 16 });
  heights.fillFrom(units);
  return { heights, stepPx };
}

/** Flat ground at one height. The rise is the same everywhere, so the answer is the flat answer
 *  shifted by exactly `risePx / HALF_H` units of `gx + gy` — two tiles per 32 px, split evenly. */
const PLATEAU_UNITS = 8;
const PLATEAU_STEP = 8;

/** The tile a *flat* pick gives, which is what this package answered before the seam existed. */
function flatPick(view: Camera, sx: number, sy: number): Tile {
  const out: Tile = { gx: 0, gy: 0 };
  screenToTile(view, sx, sy, out);
  return out;
}

/**
 * The elevation at which the ray through `(wx, wy)` meets the surface, found by walking down in
 * hundredths of a pixel.
 *
 * Deliberately stupid, and deliberately not the march: no bracket, no bisection, no step sized
 * to the lattice. If the two agree on a lumpy hill then the march is finding the surface and not
 * merely finding *a* fixed point of its own arithmetic.
 */
function scanTruth(field: HeightField, wx: number, wy: number, ceilingPx: number, out: Tile): void {
  for (let t = ceilingPx; t >= -0.005; t -= 0.01) {
    const y = wy + t;
    const gx = (wx / HALF_W + y / HALF_H) / 2;
    const gy = (y / HALF_H - wx / HALF_W) / 2;
    if (heightAt(field, gx, gy) >= t) {
      out.gx = Math.floor(gx);
      out.gy = Math.floor(gy);
      return;
    }
  }
  throw new Error('scanTruth: the ray never met the ground, which this fixture cannot produce');
}

describe('the tile on sloped ground is not the tile on the plane', () => {
  it('lands two tiles nearer the viewer for every 32 px of rise, and the flat answer does not', () => {
    // A plateau is the one case where the truth is arithmetic rather than a search: the surface
    // is at 64 px everywhere, so the ray meets it exactly 64 px above the plane, and 64 px is
    // four units of `gx + gy` — two of gx and two of gy.
    const field = fieldOf(PLATEAU_STEP, () => PLATEAU_UNITS);
    const h = harness({ terrain: { field, maxHeightPx: 96 } });
    const seen: TapGesture[] = [];
    h.input.on('tap', (g) => seen.push({ ...g, claim: g.claim }));

    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));

    const flat = flatPick(h.view, 400, 300);
    expect([flat.gx, flat.gy]).toEqual([0, 0]);
    expect([seen[0]?.gx, seen[0]?.gy]).toEqual([2, 2]);
    expect(seen[0]?.onGround).toBe(true);
  });

  it('matches the closed-form crossing on a ramp, at every point of a sweep', () => {
    // height = 2 units per unit of (gx + gy), one unit is 4 px: the surface rises 8 px per unit
    // of `gx + gy`, which is half as fast as the ray descends. So the ray meets it, and where.
    const risePerUnitPx = 2 * 4;
    const k = risePerUnitPx / HALF_H;
    const field = fieldOf(4, (gx, gy) => 2 * (gx + gy + 32));
    // The fixture's zero is at the grid's corner, so the closed form carries that offset too.
    const basePx = 2 * 32 * 4;
    const view = camera();
    const out: Tile = { gx: 0, gy: 0 };

    for (let sx = 240; sx <= 560; sx += 37) {
      for (let sy = 180; sy <= 420; sy += 29) {
        const wx = view.toWorldX(sx);
        const wy = view.toWorldY(sy);
        // surface(t) = base + k · (wy + t) and the ray is at t, so t = (base + k·wy) / (1 − k).
        const t = (basePx + k * wy) / (1 - k);
        const y = wy + t;
        const expected = [
          Math.floor((wx / HALF_W + y / HALF_H) / 2),
          Math.floor((y / HALF_H - wx / HALF_W) / 2),
        ];
        expect(worldToTileOnHeights(field, wx, wy, 640, out)).toBe(true);
        expect([out.gx, out.gy]).toEqual(expected);
      }
    }
  });

  it('agrees with a brute-force scan down the ray on a lumpy hill, and never with the plane', () => {
    // Ridges and hollows, and **no face steeper than the ray**: the surface rises at most 2
    // units — 12 px — per grid unit while the ray descends 16, so the crossing is unique. That
    // bound is a property of the projection rather than of this fixture. Terrain that climbs
    // faster than `HALF_H` per grid unit is an overhang in a 2:1 view: it hides ground behind
    // itself, more than one surface point lands on the pixel, and *no* picker can say which of
    // them the player meant.
    const wave = (x: number, period: number): number => {
      const half = period / 2;
      const at = x % period;
      return at < half ? at : period - at;
    };
    const field = fieldOf(6, (gx, gy) => 4 + wave(gx + 32, 20) + wave(gy + 32, 14));
    const view = camera();
    const mine: Tile = { gx: 0, gy: 0 };
    const truth: Tile = { gx: 0, gy: 0 };
    let apart = 0;
    let samples = 0;

    for (let sx = 260; sx <= 540; sx += 43) {
      for (let sy = 200; sy <= 400; sy += 31) {
        const wx = view.toWorldX(sx);
        const wy = view.toWorldY(sy);
        expect(worldToTileOnHeights(field, wx, wy, 240, mine)).toBe(true);
        scanTruth(field, wx, wy, 240, truth);
        expect([mine.gx, mine.gy]).toEqual([truth.gx, truth.gy]);
        const flat = flatPick(view, sx, sy);
        apart += Math.abs(flat.gx - mine.gx) + Math.abs(flat.gy - mine.gy);
        samples += 1;
      }
    }
    // The finding, as a number: on this hill the plane's answer is several tiles from the tile
    // the player is looking at, every single time.
    expect(samples).toBeGreaterThan(20);
    expect(apart / samples).toBeGreaterThan(4);
  });

  it('the two marches are one march — `iso`\'s camera-space wrapper and the world-space call agree', () => {
    // `hittest.screenToTileOnHeights` is now `camera → world → worldToTileOnHeights`, so there
    // is one march rather than two copies of a bisection that could drift. This stays because a
    // composition can be unpicked, and because it is the only check that crosses the seam: it
    // asks the question through `input`'s frozen transform, which a refactor inside `iso` has no
    // way to see. The drift it guards against would show as a tap disagreeing with a hover.
    const field = fieldOf(5, (gx, gy) => ((gx + 32) * 3 + (gy + 32) * 2) % 23);
    const view = camera();
    const a: Tile = { gx: 0, gy: 0 };
    const b: Tile = { gx: 0, gy: 0 };
    for (const zoom of [1, 2.25, 0.6]) {
      view.zoomAt(zoom / view.zoom, 400, 300);
      for (let sx = 0; sx <= 800; sx += 53) {
        for (let sy = 0; sy <= 600; sy += 47) {
          const hitA = screenToTileOnHeights(view, sx, sy, field, 150, a);
          const hitB = worldToTileOnHeights(field, view.toWorldX(sx), view.toWorldY(sy), 150, b);
          expect(hitB).toBe(hitA);
          if (hitA) expect([b.gx, b.gy]).toEqual([a.gx, a.gy]);
        }
      }
    }
  });
});

describe('every path that answers "which tile" answers on the same ground', () => {
  const field = fieldOf(PLATEAU_STEP, () => PLATEAU_UNITS);

  it('carries the terrain answer on an action, not only on a gesture', () => {
    const h = harness({
      terrain: { field, maxHeightPx: 96 },
      actions: { collect: ['tap'] },
    });
    const seen: ActionEvent<'collect'>[] = [];
    h.input.onAction('collect', (a) => seen.push({ ...a, claim: a.claim }));
    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    // The exhibit's whole workaround exists because this used to be (0, 0).
    expect([seen[0]?.gx, seen[0]?.gy]).toEqual([2, 2]);
  });

  it('carries it on a drag, so a placement ghost and the stroke that steers it agree', () => {
    const h = harness({ terrain: { field, maxHeightPx: 96 }, control: false });
    const tiles: number[][] = [];
    // Both, because the move that crosses the slop is the `dragstart` and the one after it is
    // the `drag`; a ghost that is placed by one and steered by the other must not step between
    // two surfaces on the way.
    h.input.on('dragstart', (g) => tiles.push([g.gx, g.gy]));
    h.input.on('drag', (g) => tiles.push([g.gx, g.gy]));
    h.step(down(1, 400, 300), move(1, 464, 300), move(1, 464, 332));
    expect(tiles).toEqual([
      [3, 1],
      [4, 2],
    ]);
  });

  it('answers hoverTile through the terrain too, and refuses when there is no ground', () => {
    const h = harness({ terrain: { field, maxHeightPx: 96 } });
    const at: GridPoint = { gx: 0, gy: 0 };
    h.input.submit(down(1, 400, 300, 'mouse'));
    expect(h.input.hoverTile(at)).toBe(true);
    expect([at.gx, at.gy]).toEqual([2, 2]);
    // Far enough off the map that the ray resolves past the grid's edge: a hover ring has
    // nowhere to stand, and drawing it on the shore instead is the bug this returns false for.
    h.input.submit(move(1, -9000, 300));
    const before = { ...at };
    expect(h.input.hoverTile(at)).toBe(false);
    expect(at).toEqual(before);
  });

  it('reports NaN and onGround false for a tap with no ground under it', () => {
    const h = harness({ terrain: { field, maxHeightPx: 96 } });
    const seen: TapGesture[] = [];
    h.input.on('tap', (g) => seen.push({ ...g, claim: g.claim }));
    h.step(down(1, -9000, 300, 'touch'));
    h.step(up(1, -9000, 300));
    expect(seen[0]?.onGround).toBe(false);
    // Not the sea-level tile. A number that is wrong and plausible is the whole finding; NaN is
    // wrong and unmistakable, and `grid[NaN]` is `undefined` rather than someone's shoreline.
    expect(Number.isNaN(seen[0]?.gx)).toBe(true);
    expect(Number.isNaN(seen[0]?.gy)).toBe(true);
  });

  it('resolves against the ground as it stands now, not as it stood when the system was built', () => {
    // `examples/clay` is the case: the visitor raises the ground under their own cursor, so a
    // pick taken once per gesture walks off the far side of the hill while the hand holds still.
    const live = fieldOf(PLATEAU_STEP, () => 0);
    const grid = live.heights as TileGrid;
    const h = harness({ terrain: { field: live, maxHeightPx: 96 } });
    const tiles: number[][] = [];
    h.input.on('tap', (g) => tiles.push([g.gx, g.gy]));

    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    for (let gx = -32; gx < 32; gx++) for (let gy = -32; gy < 32; gy++) grid.set(gx, gy, 8);
    h.step(down(2, 400, 300, 'touch'));
    h.step(up(2, 400, 300));

    expect(tiles).toEqual([
      [0, 0],
      [2, 2],
    ]);
  });
});

describe('the flat answer is a declaration, never a default', () => {
  /** A system that was never told what the ground looks like, with its diagnostics captured. */
  function undeclared(): { input: ReturnType<typeof createHeadlessInput>; seen: Diagnostic[] } {
    const seen: Diagnostic[] = [];
    const input = createHeadlessInput({
      camera: camera(),
      step: STEP_60,
      onDiagnostic: (d): void => {
        seen.push(d);
      },
    });
    return { input, seen };
  }

  it('says so, once, the first time a coordinate is read', () => {
    const { input, seen } = undeclared();
    const tiles: number[] = [];
    input.on('tap', (g) => tiles.push(g.gx));
    for (let i = 0; i < 4; i++) {
      input.submit({ kind: 'down', id: i, sx: 400, sy: 300, pointerType: 'touch' });
      input.tick(i * 2);
      input.submit({ kind: 'up', id: i, sx: 400, sy: 300 });
      input.tick(i * 2 + 1);
    }
    expect(tiles).toEqual([0, 0, 0, 0]);
    expect(seen.map((d) => d.code)).toEqual(['flat-ground-pick']);
    expect(seen[0]?.message).toMatch(/terrain: 'flat'/);
  });

  it('says nothing to a game that never asks where a gesture landed', () => {
    // A game bound only to pan and zoom has no mistake to make here, and a diagnostic it cannot
    // act on is one it learns to skip past — which is how the next one gets skipped too.
    const { input, seen } = undeclared();
    let drags = 0;
    input.on('dragstart', (g) => {
      drags += g.claimed ? 0 : 1;
    });
    input.submit({ kind: 'down', id: 1, sx: 400, sy: 300, pointerType: 'touch' });
    input.tick(0);
    input.submit({ kind: 'move', id: 1, sx: 500, sy: 300 });
    input.tick(1);
    expect(drags).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });

  it('says nothing to a game that declared flat ground, and answers it identically', () => {
    const seen: Diagnostic[] = [];
    const h = harness({
      terrain: 'flat',
      onDiagnostic: (d): void => {
        seen.push(d);
      },
    });
    const tiles: number[][] = [];
    h.input.on('tap', (g) => tiles.push([g.gx, g.gy, g.onGround ? 1 : 0]));
    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    expect(tiles).toEqual([[0, 0, 1]]);
    expect(seen).toEqual([]);
  });

  it('says nothing to a game that declared terrain', () => {
    const seen: Diagnostic[] = [];
    const h = harness({
      terrain: { field: fieldOf(PLATEAU_STEP, () => PLATEAU_UNITS), maxHeightPx: 96 },
      onDiagnostic: (d): void => {
        seen.push(d);
      },
    });
    h.input.on('tap', (g) => expect(g.gx).toBe(2));
    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    expect(seen).toEqual([]);
  });
});

describe('an option a caller supplied is a value they can read back', () => {
  const terrain = { field: fieldOf(PLATEAU_STEP, () => PLATEAU_UNITS), maxHeightPx: 96 };

  it('reads back the declaration, as the object that was passed', () => {
    const h = harness({ terrain });
    expect(h.input.terrain).toBe(terrain);
    expect(harness().input.terrain).toBe('flat');
    expect(createHeadlessInput({ camera: camera(), step: STEP_60 }).terrain).toBeUndefined();
  });

  it('moves a march ceiling under a slider without rebuilding anything', () => {
    const h = harness({ terrain });
    const tiles: number[][] = [];
    h.input.on('tap', (g) => tiles.push([g.gx, g.gy]));
    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    // A ceiling of zero is exactly the flat answer — which is what `examples/terraces` shows by
    // dragging its slider to the bottom, and it must go on being the *chosen* answer.
    h.input.setTerrain({ field: terrain.field, maxHeightPx: 0 });
    h.step(down(2, 400, 300, 'touch'));
    h.step(up(2, 400, 300));
    h.input.setTerrain('flat');
    expect(h.input.terrain).toBe('flat');
    expect(tiles).toEqual([
      [2, 2],
      [0, 0],
    ]);
  });

  it('refuses a declaration made from inside a handler, and one made after dispose', () => {
    const h = harness({ terrain });
    let caught = '';
    h.input.on('tap', () => {
      try {
        h.input.setTerrain('flat');
      } catch (error) {
        caught = error instanceof Error ? error.message : '';
      }
    });
    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    expect(caught).toMatch(/called from inside a handler/);
    // And the refusal changed nothing: the declaration in force is still the one it had.
    expect(h.input.terrain).toBe(terrain);
    h.input.dispose();
    expect(() => h.input.setTerrain('flat')).toThrow(/disposed/);
  });

  it('names the field the caller got wrong, and changes nothing when it does', () => {
    const view = camera();
    expect(() =>
      createHeadlessInput({ camera: view, step: STEP_60, terrain: { field: terrain.field, maxHeightPx: -1 } }),
    ).toThrow(/createHeadlessInput\.terrain\.maxHeightPx: expected a finite number >= 0/);
    expect(() =>
      createHeadlessInput({
        camera: view,
        step: STEP_60,
        terrain: { heights: null } as unknown as { field: HeightField; maxHeightPx: number },
      }),
    ).toThrow(/createHeadlessInput\.terrain\.field: expected an @latticekit\/iso HeightField/);
    expect(() =>
      createHeadlessInput({
        camera: view,
        step: STEP_60,
        terrain: 'level' as unknown as 'flat',
      }),
    ).toThrow(/expected \{ field, maxHeightPx \} or the string 'flat'/);

    const h = harness({ terrain });
    expect(() => h.input.setTerrain({ field: terrain.field, maxHeightPx: Number.NaN })).toThrow(
      /input\.setTerrain\.maxHeightPx/,
    );
    expect(h.input.terrain).toBe(terrain);
  });
});

describe('the picker itself', () => {
  it('is the only thing in the package that turns a world point into a tile', () => {
    // Held apart from the events so that a hover and the tap that follows it cannot resolve on
    // two different surfaces — the same object answers both.
    const field = fieldOf(PLATEAU_STEP, () => PLATEAU_UNITS);
    const picker = new TilePicker(() => undefined);
    const out: Tile = { gx: 0, gy: 0 };
    picker.set('flat');
    expect(picker.resolve(0, 0, out)).toBe(true);
    expect([out.gx, out.gy]).toEqual([0, 0]);
    picker.set({ field, maxHeightPx: 96 });
    expect(picker.resolve(0, 0, out)).toBe(true);
    expect([out.gx, out.gy]).toEqual([2, 2]);
    expect(picker.resolve(-9000 * HALF_W, 0, out)).toBe(false);
  });
});
