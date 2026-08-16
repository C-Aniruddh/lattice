/**
 * `camera` — the clamp, the anchored zoom, and the two ways a viewport lies to you.
 *
 * Three of these tests exist because the failure they catch is invisible in a screenshot: the
 * clamp that oscillates on a small map, the zoom that drifts towards the origin, and the
 * visible-tile range derived from a grid rectangle instead of the screen corners. Each was a
 * shipped bug in the game this kit came from.
 */

import { describe, expect, it } from 'vitest';
import { v2 } from '@lattice/core';
import { createCamera, gridToScreen } from '../src/camera.js';
import {
  HALF_H,
  HALF_W,
  gridToWorldX,
  gridToWorldY,
  rectMakeEmpty,
  rectSet,
  tileBounds,
} from '../src/projection.js';
import type { Rect, TileRange } from '../src/projection.js';

const rect = (): Rect => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
const range = (): TileRange => ({ gx0: 0, gy0: 0, gx1: 0, gy1: 0 });
/** Bounds far larger than any viewport used here, so the clamp never participates. */
const huge = (): Rect => rectSet(rect(), -1e6, -1e6, 1e6, 1e6);

describe('createCamera', () => {
  it('names the caller mistake in every rejection', () => {
    expect(() => createCamera(0, 540)).toThrow(
      /createCamera: expected viewW to be a finite number > 0, got 0/,
    );
    expect(() => createCamera(960, Number.NaN)).toThrow(/viewH.*got NaN/);
    expect(() => createCamera(960, 540, { minZoom: 0 })).toThrow(/minZoom.*got 0/);
    expect(() => createCamera(960, 540, { maxZoom: Infinity })).toThrow(/maxZoom.*got Infinity/);
    expect(() => createCamera(960, 540, { minZoom: 4, maxZoom: 2 })).toThrow(
      /minZoom <= maxZoom, got minZoom 4 and maxZoom 2/,
    );
    expect(() => createCamera(960, 540, { keepVisible: 1.5 })).toThrow(/keepVisible in \[0, 1\]/);
    expect(() => createCamera(960, 540, { keepVisible: Number.NaN })).toThrow(/keepVisible/);
  });

  it('clamps a starting zoom into the limits rather than refusing to open the game', () => {
    // A saved zoom that outlived a change to the limits is a migration problem, not a reason
    // to throw on load.
    expect(createCamera(100, 100, { zoom: 99 }).zoom).toBe(4);
    expect(createCamera(100, 100, { zoom: 0.01 }).zoom).toBe(0.5);
    // A NaN is not a stale saved value, it is garbage, and it must not become a camera.
    expect(() => createCamera(100, 100, { zoom: Number.NaN })).toThrow(/zoom.*got NaN/);
  });

  it('defaults to an effectively unbounded world', () => {
    const cam = createCamera(960, 540);
    expect(cam.bounds).toEqual({ minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 });
    expect(cam.zoom).toBe(1);
    expect(cam.viewW).toBe(960);
    expect(cam.viewH).toBe(540);
  });

  it('copies the bounds rectangle, so the caller may reuse its own', () => {
    const supplied = rectSet(rect(), -100, -100, 100, 100);
    const cam = createCamera(50, 50, { bounds: supplied });
    supplied.maxX = 1e9;
    expect(cam.bounds.maxX).toBe(100);
  });
});

describe('world <-> screen', () => {
  it('puts the camera center at the middle of the viewport', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.centerOn(100, 200);
    expect(cam.toScreenX(100)).toBe(480);
    expect(cam.toScreenY(200)).toBe(270);
  });

  it('I3: round-trips screen -> world -> screen exactly at every legal zoom', () => {
    // Exact, not within 1e-9: the transform is a multiply and an add, and dividing by the
    // same zoom recovers the value bit for bit for the powers of two used here. A tolerance
    // would hide the classic bug — the half-viewport applied before the scale in one
    // direction and after it in the other, which only shows up away from zoom 1.
    for (const zoom of [0.5, 1, 2, 4]) {
      const cam = createCamera(960, 540, { bounds: huge(), zoom });
      cam.centerOn(1234, -567);
      for (const sx of [0, 123, 960]) {
        for (const sy of [0, 45, 540]) {
          expect(cam.toScreenX(cam.toWorldX(sx))).toBe(sx);
          expect(cam.toScreenY(cam.toWorldY(sy))).toBe(sy);
        }
      }
    }
  });

  it('fills out-parameters and returns them', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    const s = v2();
    expect(cam.toScreen(10, 20, s)).toBe(s);
    expect(s).toEqual({ x: cam.toScreenX(10), y: cam.toScreenY(20) });
    const w = v2();
    expect(cam.toWorld(30, 40, w)).toBe(w);
    expect(w).toEqual({ x: cam.toWorldX(30), y: cam.toWorldY(40) });
  });

  it('normalizedX is -1, 0, +1 at the edges and keeps going past them', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(cam.normalizedX(cam.toWorldX(0))).toBe(-1);
    expect(cam.normalizedX(0)).toBe(0);
    expect(cam.normalizedX(cam.toWorldX(960))).toBe(1);
    // Unclamped: how far a pan may travel is a mixing policy, and a policy is not a
    // projection's business.
    expect(cam.normalizedX(cam.toWorldX(1920))).toBe(3);
  });

  it('gridToScreen shifts y by -zPx * zoom and leaves x alone', () => {
    const cam = createCamera(960, 540, { bounds: huge(), zoom: 2 });
    cam.centerOn(0, 0);
    const flat = gridToScreen(cam, 3, 4, 0, v2());
    const raised = gridToScreen(cam, 3, 4, 10, v2());
    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 20);
  });

  it('T11: two different (grid, z) pairs land on the same pixel, which is why picking marches', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.centerOn(0, 0);
    const ground = gridToScreen(cam, 5, 5, 0, v2());
    // One tile further along both axes is 2 * HALF_H lower on screen; raising it by that much
    // puts it back. Screen -> (grid, z) is therefore one equation short of solvable.
    const raised = gridToScreen(cam, 6, 6, 2 * HALF_H, v2());
    expect(raised).toEqual(ground);
  });
});

describe('panByScreen', () => {
  it('tracks the finger exactly at any zoom', () => {
    for (const zoom of [0.5, 1, 4]) {
      const cam = createCamera(800, 600, { bounds: huge(), zoom });
      cam.centerOn(0, 0);
      const before = cam.toWorldX(100);
      cam.panByScreen(40, 0);
      // The world point that was at screen 100 is now at screen 140: dividing by zoom is what
      // makes that true, and multiplying instead is the bug where a zoomed-in map crawls.
      // Exact, because every zoom here is a power of two.
      expect(cam.toScreenX(before)).toBe(140);
    }
  });
});

describe('zoomAt', () => {
  it('I4: keeps the world point under the pointer pinned', () => {
    for (const factor of [0.5, 1.1, 2]) {
      const cam = createCamera(960, 540, { bounds: huge() });
      cam.centerOn(500, -300);
      const sx = 137;
      const sy = 421;
      const wx = cam.toWorldX(sx);
      const wy = cam.toWorldY(sy);
      cam.zoomAt(factor, sx, sy);
      // 1e-9 is the RFC's figure and is generous: the arithmetic here is four operations on
      // values below 1e4, so the true error is nearer 1e-12.
      expect(Math.abs(cam.toScreenX(wx) - sx)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(cam.toScreenY(wy) - sy)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('respects the zoom limits and stays anchored when it hits one', () => {
    const cam = createCamera(960, 540, { bounds: huge(), minZoom: 1, maxZoom: 2 });
    cam.zoomAt(100, 0, 0);
    expect(cam.zoom).toBe(2);
    cam.zoomAt(0.001, 0, 0);
    expect(cam.zoom).toBe(1);
  });

  it('refuses a factor that would turn the camera into NaN', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    expect(() => cam.zoomAt(0, 10, 10)).toThrow(/factor to be a finite number > 0, got 0/);
    expect(() => cam.zoomAt(Number.NaN, 10, 10)).toThrow(RangeError);
    expect(() => cam.zoomAt(-2, 10, 10)).toThrow(RangeError);
  });

  it('I27: zoom is not publicly assignable, and a cast that keeps the shape does not move it', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    expect(() => {
      // @ts-expect-error — `zoom` is a getter over private state; only `zoomAt` moves it, so
      // the assignment does not compile. The runtime half of the guarantee is below.
      cam.zoom = 3;
    }).toThrow(TypeError);
    // …and a cast that keeps the public shape does not get round it either: a getter with no
    // setter throws in strict mode, which every module is. The state is unreachable rather
    // than merely undocumented.
    expect(() => {
      (cam as { zoom: number }).zoom = 3;
    }).toThrow(TypeError);
    expect(cam.zoom).toBe(1);
    expect(() => {
      // @ts-expect-error — the same for the pan, which would skip the clamp.
      cam.x = 5000;
    }).toThrow(TypeError);
    expect(cam.x).toBe(0);
  });
});

describe('the clamp', () => {
  it('keeps the required fraction of the viewport on the map', () => {
    // keepVisible 0.5 means half the viewport must show bounds, so the center may reach the
    // bounds edge exactly and no further.
    const cam = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 0.5,
    });
    cam.centerOn(1e9, 0);
    expect(cam.x).toBe(1000);
    cam.centerOn(-1e9, 0);
    expect(cam.x).toBe(-1000);
  });

  it('lets a player strand themselves at keepVisible 0, and pins them at 1', () => {
    const loose = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 0,
    });
    loose.centerOn(1e9, 0);
    // The map is entirely off the left of the screen: the whole viewport is empty ground.
    expect(loose.x).toBe(1000 + 200);

    const tight = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 1,
    });
    tight.centerOn(1e9, 0);
    expect(tight.x).toBe(1000 - 200);
  });

  it('T7: pins to the bounds center when the map is smaller than what must be covered', () => {
    // keepVisible 1 requires the viewport inside the bounds, which a 100-wide map cannot do
    // for a 400-wide viewport. The naive `clamp(v, min, max)` with min > max returns whichever
    // endpoint it tests last, so the camera jitters between two positions on every pan.
    const cam = createCamera(400, 400, {
      bounds: rectSet(rect(), 0, 0, 100, 60),
      keepVisible: 1,
    });
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(30);
    cam.panByScreen(37, -19);
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(30);
    cam.panByScreen(-37, 19);
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(30);
  });

  it('I5: clamp is idempotent', () => {
    const cam = createCamera(400, 300, {
      bounds: rectSet(rect(), -50, -50, 50, 50),
      keepVisible: 0.8,
    });
    cam.centerOn(1e4, -1e4);
    const x = cam.x;
    const y = cam.y;
    cam.clamp();
    cam.clamp();
    expect(cam.x).toBe(x);
    expect(cam.y).toBe(y);
  });

  it('re-clamps on resize and on setBounds', () => {
    const cam = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 0.5,
    });
    cam.centerOn(1000, 0);
    expect(cam.x).toBe(1000);
    // The new map is 20 wide and the half-viewport is 200, so half a viewport of map is not
    // available at all: the center pins to the bounds center rather than to an inverted range.
    cam.setBounds(rectSet(rect(), -10, -10, 10, 10));
    expect(cam.x).toBe(0);
    cam.setBounds(rectSet(rect(), -1000, -1000, 1000, 1000));
    cam.centerOn(1e9, 0);
    expect(cam.x).toBe(1000);
    cam.resize(4000, 4000);
    // The viewport is now far bigger than the map: pinned to the center again.
    expect(cam.x).toBe(0);
    expect(cam.viewW).toBe(4000);
    expect(() => cam.resize(0, 100)).toThrow(/camera.resize: expected viewW/);
    expect(() => cam.resize(100, -1)).toThrow(/camera.resize: expected viewH/);
  });
});

describe('the policy, read back and moved', () => {
  it('reports every option it was constructed with, and every default', () => {
    // The failure this catches is not a wrong number, it is a caller keeping a second copy:
    // before these getters existed the gallery panel shadowed all three and rebuilt the camera
    // — and the input system bound to it — on every drag of a zoom slider.
    const given = createCamera(960, 540, { minZoom: 0.25, maxZoom: 8, keepVisible: 0.6 });
    expect(given.minZoom).toBe(0.25);
    expect(given.maxZoom).toBe(8);
    expect(given.keepVisible).toBe(0.6);

    const defaulted = createCamera(960, 540);
    expect(defaulted.minZoom).toBe(0.5);
    expect(defaulted.maxZoom).toBe(4);
    expect(defaulted.keepVisible).toBe(0.35);
  });

  it('round-trips what the setters put in, so there is nothing left worth shadowing', () => {
    const cam = createCamera(960, 540, { minZoom: 0.25, maxZoom: 8, keepVisible: 0.6 });
    cam.setZoomLimits(1, 3);
    cam.setKeepVisible(0.1);
    expect([cam.minZoom, cam.maxZoom, cam.keepVisible]).toEqual([1, 3, 0.1]);
  });

  it('I27: the policy is readable but not assignable, exactly like the position', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    expect(() => {
      // @ts-expect-error — a getter over private state. `setZoomLimits` is the only route in,
      // because it is the only one that re-clamps the zoom and the center in the same
      // statement; a bare assignment would leave the camera outside its own declared limits.
      cam.minZoom = 2;
    }).toThrow(TypeError);
    expect(() => {
      (cam as { maxZoom: number }).maxZoom = 2;
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error — and the same for the clamp fraction.
      cam.keepVisible = 1;
    }).toThrow(TypeError);
    expect([cam.minZoom, cam.maxZoom, cam.keepVisible]).toEqual([0.5, 4, 0.35]);
  });

  it('setZoomLimits names the caller mistake and changes nothing when it refuses', () => {
    const cam = createCamera(960, 540, { bounds: huge(), zoom: 2 });
    expect(() => cam.setZoomLimits(0, 4)).toThrow(
      /camera\.setZoomLimits: expected minZoom to be a finite number > 0, got 0/,
    );
    expect(() => cam.setZoomLimits(Number.NaN, 4)).toThrow(/minZoom.*got NaN/);
    expect(() => cam.setZoomLimits(1, Infinity)).toThrow(
      /camera\.setZoomLimits: expected maxZoom to be a finite number > 0, got Infinity/,
    );
    expect(() => cam.setZoomLimits(1, -1)).toThrow(/maxZoom.*got -1/);
    expect(() => cam.setZoomLimits(4, 2)).toThrow(
      /camera\.setZoomLimits: expected minZoom <= maxZoom, got minZoom 4 and maxZoom 2/,
    );
    // A rejected policy change is not a partial one: the pair is validated before either half
    // is stored, so `setZoomLimits(1, -1)` does not leave `minZoom` at 1.
    expect([cam.minZoom, cam.maxZoom, cam.zoom]).toEqual([0.5, 4, 2]);
  });

  it('leaves the view untouched when the new range still contains the current zoom', () => {
    const cam = createCamera(960, 540, { bounds: huge(), zoom: 2 });
    cam.centerOn(300, -400);
    cam.setZoomLimits(0.25, 8);
    expect(cam.zoom).toBe(2);
    expect(cam.x).toBe(300);
    expect(cam.y).toBe(-400);
    expect([cam.minZoom, cam.maxZoom]).toEqual([0.25, 8]);
  });

  it('clamps a zoom left outside the new limits, anchoring the viewport center', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.centerOn(300, -400);
    expect(cam.zoom).toBe(1);

    // Raising minZoom past the current zoom pushes the view *in*. The world point in the
    // middle of the screen is the anchor and does not move — the same contract `zoomAt` has
    // with the pointer and `fitBounds` has with the rectangle's center.
    cam.setZoomLimits(2, 4);
    expect(cam.zoom).toBe(2);
    expect(cam.toWorldX(480)).toBe(300);
    expect(cam.toWorldY(270)).toBe(-400);
    // …and everything else did move: screen 0 saw world 300 - 960/2 = -180 at zoom 1 and sees
    // 300 - 960/4 = 60 at zoom 2. Exact, because both zooms are powers of two.
    expect(cam.toWorldX(0)).toBe(60);

    // Lowering maxZoom below it pulls the view back out, same anchor.
    cam.setZoomLimits(0.5, 0.5);
    expect(cam.zoom).toBe(0.5);
    expect(cam.toWorldX(480)).toBe(300);
    expect(cam.toWorldY(270)).toBe(-400);
  });

  it('re-clamps the center too, which is how a slider drag moves the view', () => {
    const cam = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 1,
      zoom: 2,
    });
    cam.centerOn(1e9, 0);
    // keepVisible 1 requires the viewport inside the bounds, so the center lives in
    // [minX + half, maxX - half]; half is 400 / (2 * 2) = 100 world px, giving [-900, 900].
    expect(cam.x).toBe(900);

    cam.setZoomLimits(0.5, 0.5);
    expect(cam.zoom).toBe(0.5);
    // The half-viewport is now 400 / (2 * 0.5) = 400 world px, so the same clamp reads
    // [-600, 600] and the camera travelled 300 world px with nobody panning. Documented
    // rather than discovered: a live minZoom slider rescales the world under the finger, and
    // a panel that does not want that should commit on release.
    expect(cam.x).toBe(600);
  });

  it('setZoomLimits(z, z) does move the zoom with no pointer, and freezes it doing so', () => {
    // The escape the doc admits to. It is not a back door worth using: the camera can no
    // longer zoom at all afterwards, which is the loudest symptom available.
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.setZoomLimits(2, 2);
    expect(cam.zoom).toBe(2);
    cam.zoomAt(4, 0, 0);
    expect(cam.zoom).toBe(2);
    cam.zoomAt(0.1, 0, 0);
    expect(cam.zoom).toBe(2);
  });

  it('I4: the pointer anchor still holds at a zoom the old limits forbade', () => {
    const cam = createCamera(960, 540, { bounds: huge(), minZoom: 0.5, maxZoom: 4 });
    cam.setZoomLimits(0.1, 16);
    cam.centerOn(500, -300);
    const sx = 137;
    const sy = 421;
    const wx = cam.toWorldX(sx);
    const wy = cam.toWorldY(sy);
    cam.zoomAt(8, sx, sy);
    // 8 is past the maxZoom this camera was built with, so a widened limit is genuinely in
    // force rather than merely stored.
    expect(cam.zoom).toBe(8);
    // Exact rather than within a tolerance: the anchor arithmetic is a divide by 8 and a
    // multiply by 8 on values below 1e4, and 8 is a power of two, so every intermediate is
    // representable and the round trip is bit-for-bit.
    expect(cam.toScreenX(wx)).toBe(sx);
    expect(cam.toScreenY(wy)).toBe(sy);
  });

  it('setKeepVisible re-clamps in the same statement, and rejects a NaN slider', () => {
    const cam = createCamera(400, 400, {
      bounds: rectSet(rect(), -1000, -1000, 1000, 1000),
      keepVisible: 0,
    });
    cam.centerOn(1e9, 0);
    // At 0 the map may leave the screen entirely: the center reaches maxX + half, and half is
    // 400 / 2 = 200 world px at the default zoom of 1.
    expect(cam.x).toBe(1200);

    cam.setKeepVisible(1);
    expect(cam.keepVisible).toBe(1);
    // [minX + 2·half - half, maxX + half - 2·half] = [-800, 800], applied now rather than at
    // the next pan — a camera showing a view its own policy forbids is the failure `setBounds`
    // already refuses.
    expect(cam.x).toBe(800);

    expect(() => cam.setKeepVisible(-0.001)).toThrow(
      /camera\.setKeepVisible: expected keepVisible in \[0, 1\], got -0\.001/,
    );
    expect(() => cam.setKeepVisible(1.5)).toThrow(RangeError);
    // NaN is what an unparsed slider value arrives as, and it would otherwise poison both axes
    // of the clamp and put the camera nowhere.
    expect(() => cam.setKeepVisible(Number.NaN)).toThrow(
      /camera\.setKeepVisible: expected keepVisible in \[0, 1\], got NaN/,
    );
    expect(cam.keepVisible).toBe(1);
    expect(cam.x).toBe(800);
  });
});

describe('culling', () => {
  it('is generous by one tile on each axis rather than exact', () => {
    const cam = createCamera(400, 300, { bounds: huge() });
    cam.centerOn(0, 0);
    // A box one pixel outside the true viewport still counts, because geometry pokes outside
    // its declared box by a stroke width and an exact reject makes that flicker.
    expect(cam.isVisible(201, 0, 202, 1)).toBe(true);
    // …but two tiles out does not.
    expect(cam.isVisible(400, 0, 401, 1)).toBe(false);
    expect(cam.isVisible(0, -400, 1, -399)).toBe(false);
    expect(cam.isVisible(-1, -1, 1, 1)).toBe(true);
  });

  it('visibleWorldBounds is the viewport in world units, plus a margin', () => {
    const cam = createCamera(400, 300, { bounds: huge(), zoom: 2 });
    cam.centerOn(10, 20);
    const out = cam.visibleWorldBounds(rect());
    expect(out).toEqual({ minX: 10 - 100, minY: 20 - 75, maxX: 10 + 100, maxY: 20 + 75 });
    expect(cam.visibleWorldBounds(rect(), 25)).toEqual({
      minX: -115,
      minY: -80,
      maxX: 135,
      maxY: 120,
    });
  });

  it('T9: visibleTileBounds covers the screen corners, which a grid rectangle would not', () => {
    const cam = createCamera(640, 480, { bounds: huge() });
    cam.centerOn(0, 0);
    const out = cam.visibleTileBounds(range());
    // Every screen corner, and every point along the edges between them, must be inside the
    // range. The diamond's two side corners are the ones a naive derivation misses.
    for (let sx = 0; sx <= 640; sx += 16) {
      for (const sy of [0, 480]) {
        const wx = cam.toWorldX(sx);
        const wy = cam.toWorldY(sy);
        const gx = Math.floor((wx / HALF_W + wy / HALF_H) / 2);
        const gy = Math.floor((wy / HALF_H - wx / HALF_W) / 2);
        expect(gx).toBeGreaterThanOrEqual(out.gx0);
        expect(gx).toBeLessThan(out.gx1);
        expect(gy).toBeGreaterThanOrEqual(out.gy0);
        expect(gy).toBeLessThan(out.gy1);
      }
    }
  });

  it('visibleTileBounds grows by the margin and is half-open', () => {
    const cam = createCamera(640, 480, { bounds: huge() });
    cam.centerOn(0, 0);
    const plain = cam.visibleTileBounds(range());
    const wide = cam.visibleTileBounds(range(), 3);
    expect(wide.gx0).toBe(plain.gx0 - 3);
    expect(wide.gy0).toBe(plain.gy0 - 3);
    expect(wide.gx1).toBe(plain.gx1 + 3);
    expect(wide.gy1).toBe(plain.gy1 + 3);
    expect(plain.gx1).toBeGreaterThan(plain.gx0);
  });
});

describe('fitBounds', () => {
  it('puts the rectangle exactly against the viewport edges', () => {
    // 800 / 400 = 2 across, 600 / 200 = 3 down; the tighter of the two wins, so zoom is 2 and
    // the vertical span leaves 600 - 200 * 2 = 200 CSS px of slack.
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.fitBounds(rectSet(rect(), 0, 0, 400, 200));
    expect(cam.zoom).toBe(2);
    expect(cam.x).toBe(200);
    expect(cam.y).toBe(100);
    expect(cam.toScreenX(0)).toBe(0);
    expect(cam.toScreenX(400)).toBe(800);
    expect(cam.toScreenY(0)).toBe(100);
    expect(cam.toScreenY(200)).toBe(500);
  });

  it('is exactly the zoomAt(want / zoom, center) every example writes by hand', () => {
    // The expression this method replaces. Both cameras start at a different zoom, because the
    // whole point of the division in the hand-written form is that it undoes wherever you were.
    const a = createCamera(960, 540, { bounds: huge(), zoom: 3 });
    const b = createCamera(960, 540, { bounds: huge(), zoom: 3 });
    const box = rectSet(rect(), -300, -100, 500, 700);
    const want = Math.min(960 / (500 - -300), 540 / (700 - -100));
    a.zoomAt(want / a.zoom, 960 / 2, 540 / 2);
    a.centerOn(100, 300);
    b.fitBounds(box);
    expect(b.zoom).toBe(a.zoom);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
  });

  it('takes its margin in CSS pixels, so the gutter is the same at every fitted zoom', () => {
    // 50 px on each side leaves 700 of 800 across and 500 of 600 down: 700 / 400 = 1.75 beats
    // 500 / 200 = 2.5, and 1.75 is exact in binary so the edges land on whole pixels.
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.fitBounds(rectSet(rect(), 0, 0, 400, 200), 50);
    expect(cam.zoom).toBe(1.75);
    expect(cam.toScreenX(0)).toBe(50);
    expect(cam.toScreenX(400)).toBe(750);
  });

  it('frames a tall world taller, because the height is in the rectangle', () => {
    // tileBounds(0, 0, 8, 8, h) is 512 world px across and 256 + h down — `minY` extends up by
    // the height, which is the only route content height has into a framing decision.
    const flat = createCamera(512, 256, { bounds: huge() });
    const tall = createCamera(512, 256, { bounds: huge() });
    flat.fitBounds(tileBounds(0, 0, 8, 8, 0, rect()));
    tall.fitBounds(tileBounds(0, 0, 8, 8, 256, rect()));
    // 512 / 512 = 1 across and 256 / 256 = 1 down for the flat map; the tall one pays
    // 256 / 512 = 0.5 down.
    expect(flat.zoom).toBe(1);
    expect(tall.zoom).toBe(0.5);
    // And the summit is on screen, which is the failure this is about: at the flat framing the
    // top of the 256 px mass sits 256 CSS px above the viewport.
    expect(flat.toScreenY(-256)).toBe(-256);
    expect(tall.toScreenY(-256)).toBe(0);
  });

  it('clamps into the zoom limits at both ends', () => {
    const cam = createCamera(800, 600, { bounds: huge(), minZoom: 0.5, maxZoom: 4 });
    // 800 / 8000 = 0.1, below minZoom: the island does not fit and the camera says so by
    // sitting at its limit rather than by mirroring the world.
    cam.fitBounds(rectSet(rect(), 0, 0, 8000, 6000));
    expect(cam.zoom).toBe(0.5);
    // 800 / 8 = 100, above maxZoom.
    cam.fitBounds(rectSet(rect(), 0, 0, 8, 6));
    expect(cam.zoom).toBe(4);
  });

  it('treats a degenerate axis as no constraint, and a point as maxZoom', () => {
    const cam = createCamera(800, 600, { bounds: huge() });
    // A wall along the near-far diagonal has zero world width — see isEdgeOn. Only the
    // vertical span constrains: 600 / 300 = 2.
    cam.fitBounds(rectSet(rect(), 40, 0, 40, 300));
    expect(cam.zoom).toBe(2);
    expect(cam.x).toBe(40);
    // Both axes degenerate: nothing constrains, so the fit is as close as it is allowed.
    cam.fitBounds(rectSet(rect(), 7, 9, 7, 9));
    expect(cam.zoom).toBe(4);
    expect(cam.x).toBe(7);
    expect(cam.y).toBe(9);
  });

  it('survives a margin wider than the viewport instead of inverting', () => {
    // 800 - 2 * 500 is negative. One CSS pixel of usable viewport instead: 1 / 400 = 0.0025,
    // which clamps to minZoom. A negative zoom would mirror the world silently.
    const cam = createCamera(800, 600, { bounds: huge() });
    cam.fitBounds(rectSet(rect(), 0, 0, 400, 200), 500);
    expect(cam.zoom).toBe(0.5);
  });

  it('lets the bounds clamp win, so the center is not always the rectangle center', () => {
    // A 640-px-wide island, a 640-px viewport at zoom 1, and keepVisible 1: the camera may not
    // look past the island's edge, so framing a box off to its east settles on the island.
    const cam = createCamera(640, 320, {
      bounds: rectSet(rect(), -320, -160, 320, 160),
      keepVisible: 1,
      minZoom: 1,
      maxZoom: 1,
    });
    cam.fitBounds(rectSet(rect(), 4000, 0, 4640, 320));
    expect(cam.zoom).toBe(1);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it('is idempotent, like every other mutator here', () => {
    const cam = createCamera(800, 600, { bounds: huge() });
    const box = rectSet(rect(), -17, 3, 933, 411);
    cam.fitBounds(box, 12);
    const first = { x: cam.x, y: cam.y, zoom: cam.zoom };
    cam.fitBounds(box, 12);
    expect({ x: cam.x, y: cam.y, zoom: cam.zoom }).toEqual(first);
  });

  it('names the caller mistake in every rejection', () => {
    const cam = createCamera(800, 600, { bounds: huge() });
    // The rectMakeEmpty state: an accumulator loop that unioned nothing into it. Naming it in
    // the message is the difference between one minute and twenty.
    expect(() => cam.fitBounds(rectMakeEmpty(rect()))).toThrow(/rectMakeEmpty state/);
    expect(() => cam.fitBounds(rectSet(rect(), 0, 0, Number.NaN, 10))).toThrow(
      /camera.fitBounds: expected finite rectangle edges, got minX 0, minY 0, maxX NaN, maxY 10/,
    );
    expect(() => cam.fitBounds(rectSet(rect(), 0, 0, -10, 10))).toThrow(
      /expected maxX >= minX and maxY >= minY, got spans -10 and 10/,
    );
    expect(() => cam.fitBounds(rectSet(rect(), 0, 0, 10, -10))).toThrow(/spans 10 and -10/);
    expect(() => cam.fitBounds(rectSet(rect(), 0, 0, 10, 10), -1)).toThrow(
      /expected marginPx to be a finite number >= 0, got -1/,
    );
    expect(() => cam.fitBounds(rectSet(rect(), 0, 0, 10, 10), Infinity)).toThrow(
      /marginPx.*got Infinity/,
    );
    // And none of them moved the camera.
    expect(cam.zoom).toBe(1);
  });
});

describe('centring', () => {
  it('centerOnTile is centerOn through the projection', () => {
    const cam = createCamera(960, 540, { bounds: huge() });
    cam.centerOnTile(7, -3);
    expect(cam.x).toBe(gridToWorldX(7, -3));
    expect(cam.y).toBe(gridToWorldY(7, -3));
  });

  it('accepts the bounds a whole island produces', () => {
    const cam = createCamera(960, 540, { bounds: tileBounds(0, 0, 48, 48, 0, rect()) });
    cam.centerOnTile(24, 24);
    expect(cam.bounds.maxY).toBe(gridToWorldY(48, 48));
    expect(cam.x).toBe(gridToWorldX(24, 24));
  });
});
