/**
 * The gestures-to-camera policy.
 *
 * The glide test is the one with a derivation in it: a flick's coast distance is `v / lambda`
 * where `lambda = ln2 / halfLife`, so a 1200 px/s release at a 150 ms half-life coasts
 * `1200 × 0.15 / ln2 ≈ 260` px. Discrete integration overshoots the integral because each frame
 * moves at the speed it *started* with, which is why the assertion is a band and not a point —
 * and the band is narrow enough that doubling the half-life would fail it.
 */

import { describe, expect, it } from 'vitest';
import { createCamera } from '@latticekit/iso';
import {
  GLIDE_STOP_PX_PER_S,
  PAN_KEYS,
  createCameraControl,
  zoomKeyDirection,
} from '../src/cameracontrol.js';
import { DEFAULT_PROFILE } from '../src/profile.js';

function control(held: ReadonlySet<string> = new Set(), enabled = true) {
  const camera = createCamera(800, 600);
  return {
    camera,
    control: createCameraControl({
      camera,
      keyPanPxPerS: DEFAULT_PROFILE.keyPanPxPerS,
      flingMinPxPerS: DEFAULT_PROFILE.flingMinPxPerS,
      flingHalfLifeMs: DEFAULT_PROFILE.flingHalfLifeMs,
      keyHeld: (code): boolean => held.has(code),
      enabled,
    }),
  };
}

describe('the key tables', () => {
  it('maps the four arrows to screen directions', () => {
    expect([...PAN_KEYS.keys()]).toEqual(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
    expect(PAN_KEYS.get('ArrowLeft')).toEqual([-1, 0]);
  });

  it('zooms on both the main row and the numpad, and on nothing else', () => {
    expect(zoomKeyDirection('Equal')).toBe(1);
    expect(zoomKeyDirection('NumpadAdd')).toBe(1);
    expect(zoomKeyDirection('Minus')).toBe(-1);
    expect(zoomKeyDirection('NumpadSubtract')).toBe(-1);
    expect(zoomKeyDirection('KeyE')).toBe(0);
  });
});

describe('validation', () => {
  it('names a threshold that is not a number', () => {
    expect(() =>
      createCameraControl({
        camera: createCamera(800, 600),
        keyPanPxPerS: Number.NaN,
        flingMinPxPerS: 120,
        flingHalfLifeMs: 150,
        keyHeld: (): boolean => false,
        enabled: true,
      }),
    ).toThrow(/cameraControl\.keyPanPxPerS/);
  });
});

describe('panBy and zoomBy', () => {
  it('pans in world units divided by zoom, so a drag tracks the finger at any scale', () => {
    const { camera, control: c } = control();
    c.panBy(100, 50);
    expect(camera.x).toBe(-100);
    expect(camera.y).toBe(-50);
    c.zoomBy(2, 400, 300);
    c.panBy(100, 0);
    // Half the world distance at twice the zoom: multiplying instead is the bug where a
    // zoomed-in map slides at a crawl.
    expect(camera.x).toBe(-150);
  });

  it('refuses a factor that would turn the camera into NaN', () => {
    const { control: c } = control();
    expect(() => c.zoomBy(0, 400, 300)).toThrow(RangeError);
    expect(() => c.zoomBy(Number.NaN, 400, 300)).toThrow(RangeError);
  });
});

describe('the glide', () => {
  it('does not start below the fling floor', () => {
    const { camera, control: c } = control();
    c.fling(DEFAULT_PROFILE.flingMinPxPerS - 1, 0);
    expect(c.gliding).toBe(false);
    c.integrate(16);
    // Without a floor every drag drifts after the finger lifts and the camera can never be
    // placed exactly.
    expect(camera.x).toBe(0);
  });

  it('coasts about 260 px from a 1200 px/s flick, and reaches rest', () => {
    const { camera, control: c } = control();
    c.fling(1200, 0);
    expect(c.gliding).toBe(true);
    let frames = 0;
    while (c.gliding && frames < 1000) {
      c.integrate(1000 / 60);
      frames += 1;
    }
    // 1200 × 0.15 / ln2 = 259.7 px in closed form; discrete frames each move at the speed they
    // started with, which overshoots by a few per cent.
    expect(-camera.x).toBeGreaterThan(255);
    expect(-camera.x).toBeLessThan(285);
    // Finite time, not an asymptote: `gliding` becomes false at a moment a test can name.
    expect(c.gliding).toBe(false);
    expect(frames).toBeLessThan(200);
  });

  it('stops dead on request, because a camera coasting under a dialog is lost', () => {
    const { camera, control: c } = control();
    c.fling(1200, 0);
    c.stop();
    expect(c.gliding).toBe(false);
    c.integrate(100);
    expect(camera.x).toBe(0);
  });

  it('kills the glide when the controller is switched off', () => {
    const { control: c } = control();
    c.fling(1200, 0);
    c.enabled = false;
    expect(c.gliding).toBe(false);
    c.enabled = true;
    expect(c.gliding).toBe(false);
  });

  it('ignores a frame with no time in it, and never integrates backwards', () => {
    const { camera, control: c } = control();
    c.fling(1200, 0);
    c.integrate(0);
    c.integrate(-16);
    expect(camera.x).toBe(0);
    expect(c.gliding).toBe(true);
  });

  it('has a stop threshold below one tenth of a pixel per frame', () => {
    // 8 px/s is 0.13 px in a 60 Hz frame: under the smallest motion a display can show.
    expect(GLIDE_STOP_PX_PER_S / 60).toBeLessThan(0.15);
  });
});

describe('held keys', () => {
  it('integrates a speed rather than jumping per keypress', () => {
    const { camera, control: c } = control(new Set(['ArrowRight']));
    c.integrate(1000);
    expect(camera.x).toBe(-DEFAULT_PROFILE.keyPanPxPerS);
    c.integrate(500);
    expect(camera.x).toBe(-DEFAULT_PROFILE.keyPanPxPerS * 1.5);
  });

  it('normalizes the diagonal', () => {
    const { camera, control: c } = control(new Set(['ArrowRight', 'ArrowDown']));
    c.integrate(1000);
    const expected = DEFAULT_PROFILE.keyPanPxPerS / Math.sqrt(2);
    // Holding two keys must not pan 41% faster than holding one, or the map appears to speed up
    // when the player changes direction.
    expect(camera.x).toBe(-expected);
    expect(camera.y).toBe(-expected);
  });

  it('does nothing at all while disabled', () => {
    const { camera, control: c } = control(new Set(['ArrowRight']), false);
    c.integrate(1000);
    expect(camera.x).toBe(0);
    expect(c.enabled).toBe(false);
  });
});
