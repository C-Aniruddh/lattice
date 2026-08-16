/**
 * The frame: what `beginFrame` builds, and the snap that is `draw`'s half of a seam with `iso`.
 *
 * `iso` computes the camera in continuous world space and declines to round. This package
 * rounds, because this is the package touching a device — and the assertion that proves it is
 * the one below that projects the world origin and demands a whole device pixel at both ratios.
 * Without it a 1 px stroke straddles two device pixels at some pan offsets and not others,
 * cached images resample, terrain seams open and close, and everyone blames the browser.
 */

import { createRng } from '@lattice/core';
import { createCamera } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { rgba } from '../src/color.js';
import { BASE_SLOTS, createPalette } from '../src/palette.js';
import { createRecordingSurface } from '../src/record.js';
import { beginFrame, endFrame, subPen } from '../src/surface.js';
import { scene } from './harness.js';

/** A camera over an effectively unbounded world, so a random pan is never clamped. */
function freeCamera(viewW = 400, viewH = 300, zoom = 1): ReturnType<typeof createCamera> {
  return createCamera(viewW, viewH, {
    zoom,
    bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
  });
}

describe('beginFrame', () => {
  it('clears with the resolved ink and hands back the frame context', () => {
    const surface = createRecordingSurface(400, 300);
    const palette = createPalette(BASE_SLOTS);
    const pen = beginFrame({ surface, camera: freeCamera(), palette, t: 3, clear: 'sky' });
    expect(surface.ops[0]).toEqual({
      op: 'clear',
      xy: [],
      colors: [palette.get('sky')],
      value: 0,
      text: '',
    });
    expect(pen.t).toBe(3);
    expect(pen.palette).toBe(palette);
    expect(pen.surface).toBe(surface);
    expect(pen.light).toBeUndefined();
  });

  it('clears transparent when no colour is named — the render-target case', () => {
    const surface = createRecordingSurface(40, 30);
    beginFrame({ surface, camera: freeCamera(), palette: createPalette(BASE_SLOTS), t: 0 });
    expect(surface.ops[0]?.colors).toEqual([0]);
  });

  it('takes a packed colour as readily as a slot name', () => {
    const surface = createRecordingSurface(40, 30);
    beginFrame({
      surface,
      camera: freeCamera(),
      palette: createPalette(BASE_SLOTS),
      t: 0,
      clear: rgba(1, 2, 3),
    });
    expect(surface.ops[0]?.colors).toEqual([rgba(1, 2, 3)]);
  });

  it('refuses a NaN clock rather than painting an empty screen', () => {
    // A NaN `t` throws nowhere downstream; it turns every animated position into NaN and gets
    // reported as "the game went black", with nothing in the console.
    const surface = createRecordingSurface(40, 30);
    const opts = { surface, camera: freeCamera(), palette: createPalette(BASE_SLOTS) };
    expect(() => beginFrame({ ...opts, t: Number.NaN })).toThrow(RangeError);
    expect(() => beginFrame({ ...opts, t: Number.POSITIVE_INFINITY })).toThrow(/t to be a finite/);
  });

  it('gives the pen a scratch buffer big enough for the largest polygon the kit submits', () => {
    const { pen } = scene();
    expect(pen.xy.length).toBeGreaterThanOrEqual(36);
    expect(pen.xy).toBeInstanceOf(Float64Array);
  });
});

describe('the device-pixel snap', () => {
  it('lands the world origin on a whole device pixel, at both ratios, for 50 pans', () => {
    const rng = createRng('snap');
    for (const ratio of [1, 2]) {
      for (let i = 0; i < 25; i++) {
        const surface = createRecordingSurface(400, 300, ratio);
        const camera = freeCamera();
        camera.centerOn(rng.float(-500, 500), rng.float(-500, 500));
        const pen = beginFrame({
          surface,
          camera,
          palette: createPalette(BASE_SLOTS),
          t: 0,
        });
        const device = (camera.toScreenX(0) + pen.snapX) * ratio;
        const deviceY = (camera.toScreenY(0) + pen.snapY) * ratio;
        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
        expect(Math.abs(deviceY - Math.round(deviceY))).toBeLessThan(1e-9);
      }
    }
  });

  it('generally does not, with the snap off', () => {
    const rng = createRng('no-snap');
    let fractional = 0;
    for (let i = 0; i < 50; i++) {
      const camera = freeCamera();
      camera.centerOn(rng.float(-500, 500), rng.float(-500, 500));
      const pen = beginFrame({
        surface: createRecordingSurface(400, 300, 2),
        camera,
        palette: createPalette(BASE_SLOTS),
        t: 0,
        snap: false,
      });
      expect(pen.snapX).toBe(0);
      expect(pen.snapY).toBe(0);
      const device = camera.toScreenX(0) * 2;
      if (Math.abs(device - Math.round(device)) > 1e-9) fractional += 1;
    }
    expect(fractional).toBeGreaterThan(40);
  });

  it('never moves a coordinate by more than half a device pixel', () => {
    // Rounds rather than floors: a floor biases the whole scene up and left by up to a pixel,
    // which shows as a half-pixel jump the first time somebody changes the ratio.
    const rng = createRng('snap-magnitude');
    for (let i = 0; i < 50; i++) {
      const camera = freeCamera();
      camera.centerOn(rng.float(-500, 500), rng.float(-500, 500));
      const pen = beginFrame({
        surface: createRecordingSurface(400, 300, 2),
        camera,
        palette: createPalette(BASE_SLOTS),
        t: 0,
      });
      expect(Math.abs(pen.snapX)).toBeLessThanOrEqual(0.25 + 1e-12);
      expect(Math.abs(pen.snapY)).toBeLessThanOrEqual(0.25 + 1e-12);
    }
  });
});

describe('endFrame', () => {
  it('closes the surface', () => {
    let ended = 0;
    const surface = createRecordingSurface(40, 30);
    const wrapped = { ...surface, end: (): void => void (ended += 1) };
    endFrame({
      surface: wrapped,
      camera: freeCamera(),
      palette: createPalette(BASE_SLOTS),
      t: 0,
      xy: new Float64Array(8),
      light: undefined,
      snapX: 0,
      snapY: 0,
    });
    expect(ended).toBe(1);
  });
});

describe('subPen', () => {
  it('shares the palette and the clock and takes the new surface and camera', () => {
    const { pen } = scene({ t: 7 });
    const other = createRecordingSurface(64, 64, 2);
    const otherCamera = freeCamera(64, 64, 2);
    const sub = subPen(pen, other, otherCamera);
    expect(sub.palette).toBe(pen.palette);
    expect(sub.t).toBe(7);
    expect(sub.surface).toBe(other);
    expect(sub.camera).toBe(otherCamera);
  });

  it('gets its own scratch buffer, so it may be used inside a draw call', () => {
    const { pen } = scene();
    const sub = subPen(pen, createRecordingSurface(64, 64), freeCamera(64, 64));
    expect(sub.xy).not.toBe(pen.xy);
  });

  it('carries no light field', () => {
    // A sprite drawn into a thumbnail must not post a pool into the frame's night mask: the
    // pool would appear in the valley, at the sprite's world position, because a card was open.
    const { pen } = scene();
    const sub = subPen(pen, createRecordingSurface(64, 64), freeCamera(64, 64));
    expect(sub.light).toBeUndefined();
  });

  it('snaps to its own surface’s ratio rather than inheriting the parent’s', () => {
    const { pen } = scene({ pixelRatio: 1 });
    const camera = freeCamera(64, 64);
    camera.centerOn(10.37, 4.11);
    const sub = subPen(pen, createRecordingSurface(64, 64, 3), camera);
    const device = (camera.toScreenX(0) + sub.snapX) * 3;
    expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
  });
});
