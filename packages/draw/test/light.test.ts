/**
 * Night — the pool, the edge, and the darkness it is cut from.
 *
 * Three assertions here carry the demo's whole premise. **Full day costs nothing**, or a game
 * without a night pays for a subsystem it does not use inside a 12 KB budget. **A pool is 2:1**,
 * or it reads as a sphere hovering over the road, which is the one illusion the package exists
 * to protect. And **the composite is one cut and one add for the frame**, not one pair per lamp:
 * punching darkness per lamp makes overlapping pools `(1−a₁)(1−a₂)` instead of `max(a₁,a₂)`, so
 * a hot lens appears between every adjacent pair and it looks like a driver bug.
 */

import { HALF_W } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { rgba, withAlpha } from '../src/color.js';
import { createLightField } from '../src/light.js';
import type { RecordingSurface, RecordingTarget } from '../src/record.js';
import { createRecordingSurface } from '../src/record.js';
import { opsOf, scene } from './harness.js';

/**
 * A surface that hands back every target it is asked for, so a test can look inside the light
 * accumulator and the mask.
 *
 * The pools never reach the surface — that is the design, and it is what the assertions below
 * are checking — so without this there would be nothing to assert against but the composite.
 */
function spyOn(surface: RecordingSurface): {
  surface: RecordingSurface;
  targets: RecordingTarget[];
} {
  const targets: RecordingTarget[] = [];
  return {
    targets,
    surface: {
      ...surface,
      createTarget: (w: number, h: number, mode?: 'image' | 'light'): RecordingTarget => {
        const target = surface.createTarget(w, h, mode) as RecordingTarget;
        targets.push(target);
        return target;
      },
    },
  };
}

describe('createLightField', () => {
  it('refuses options that produce a blank mask or a white screen, by name', () => {
    const surface = createRecordingSurface(100, 80);
    expect(() => createLightField(surface, { scale: 0 })).toThrow(/scale/);
    expect(() => createLightField(surface, { scale: 2 })).toThrow(/scale/);
    expect(() => createLightField(surface, { falloff: 0.5 })).toThrow(/falloff/);
    expect(() => createLightField(surface, { bloom: 2 })).toThrow(/bloom/);
    expect(() => createLightField(surface, { bloom: -1 })).toThrow(/bloom/);
  });

  it('allocates no buffer until a frame is actually dark', () => {
    // A game with no night pays for none of this, which is what lets the module exist at all.
    let targets = 0;
    const surface = createRecordingSurface(100, 80);
    const counted = {
      ...surface,
      createTarget: (w: number, h: number, m?: 'image' | 'light') => {
        targets += 1;
        return surface.createTarget(w, h, m);
      },
    };
    const field = createLightField(counted);
    expect(targets).toBe(0);
    const { pen } = scene();
    field.begin({ ...pen, surface: counted }, 0, 'night');
    expect(targets).toBe(0);
    field.begin({ ...pen, surface: counted }, 0.5, 'night');
    expect(targets).toBe(2);
  });
});

describe('full day costs nothing', () => {
  it('is inactive at darkness 0, adds nothing, and composites nothing', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    expect(field.active).toBe(false);
    field.begin(pen, 0, 'night');
    expect(field.active).toBe(false);
    field.add(1, 1, 0, 3, 1, 'warn');
    field.addScreen(10, 10, 20, 1, 1, 'warn');
    field.composite();
    expect(field.count).toBe(0);
    expect(surface.ops).toHaveLength(0);
  });

  it('composites nothing before begin has ever been called', () => {
    const { surface } = scene();
    const field = createLightField(surface);
    field.composite();
    expect(surface.ops).toHaveLength(0);
  });

  it('treats a NaN darkness as day rather than as a transparent mask', () => {
    const { pen, surface } = scene();
    const field = createLightField(surface);
    field.begin(pen, Number.NaN, 'night');
    expect(field.active).toBe(false);
    field.begin(pen, -3, 'night');
    expect(field.active).toBe(false);
  });

  it('clamps an over-driven darkness to full night rather than an opaque overshoot', () => {
    const { pen, surface, palette } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface);
    field.begin({ ...pen, surface: spy.surface }, 9, 'night');
    field.composite();
    const quad = opsOf(spy.targets[1] ?? surface, 'poly')[0];
    expect(quad?.colors[0]).toBe(withAlpha(palette.get('night'), 1));
  });
});

describe('a pool', () => {
  it('is 2:1 on the ground, at every zoom — never a circle', () => {
    for (const zoom of [0.5, 1, 3]) {
      const { surface, pen } = scene({ zoom });
      const field = createLightField(surface, { scale: 1, falloff: 1 });
      field.begin(pen, 0.8, 'night');
      field.add(2, 2, 0, 4, 1, 'warn');
      // The pool lands in the accumulator, not on the surface: the surface sees only the
      // composite, and that is the whole design.
      expect(opsOf(surface, 'softEllipse')).toHaveLength(0);
      expect(field.count).toBe(1);
    }
  });

  it('records rx and ry = rx / 2 into the light target', () => {
    const { surface, pen } = scene({ zoom: 2 });
    const spy = spyOn(surface);
    const field = createLightField(spy.surface, { scale: 1, falloff: 1 });
    field.begin({ ...pen, surface: spy.surface }, 0.8, 'night');
    field.add(2, 2, 0, 4, 1, 'warn');
    const light = spy.targets[0];
    expect(light?.mode).toBe('light');
    const pool = opsOf(light ?? surface, 'softEllipse')[0];
    expect(pool?.xy[2]).toBeCloseTo(4 * HALF_W * 2, 3);
    expect(pool?.xy[3]).toBeCloseTo((pool?.xy[2] ?? 0) / 2, 6);
    expect(pool?.colors[1]).toBe(withAlpha(pool?.colors[0] ?? 0, 0));
  });

  it('scales its coordinates into a half-resolution buffer', () => {
    const { surface, pen } = scene({ zoom: 1 });
    const spy = spyOn(surface);
    const field = createLightField(spy.surface, { falloff: 1 });
    field.begin({ ...pen, surface: spy.surface }, 1, 'night');
    field.add(0, 0, 0, 2, 1, 'warn');
    const light = spy.targets[0];
    expect(light?.width).toBe(200);
    expect(light?.height).toBe(150);
    expect(opsOf(light ?? surface, 'softEllipse')[0]?.xy[2]).toBeCloseTo(2 * HALF_W * 0.5, 3);
  });

  it('adds a hard core as the falloff exponent rises, and none at all at 1', () => {
    const make = (falloff: number): number => {
      const { surface, pen } = scene();
      const spy = spyOn(surface);
      const field = createLightField(spy.surface, { falloff });
      field.begin({ ...pen, surface: spy.surface }, 1, 'night');
      field.add(0, 0, 0, 2, 1, 'warn');
      return opsOf(spy.targets[0] ?? surface, 'ellipse').length;
    };
    expect(make(1)).toBe(0);
    expect(make(2)).toBe(1);
  });

  it('ignores a pool with no light in it', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(pen, 1, 'night');
    field.add(0, 0, 0, 2, 0, 'warn');
    field.add(0, 0, 0, 0, 1, 'warn');
    field.add(0, 0, 0, -3, 1, 'warn');
    expect(field.count).toBe(0);
  });

  it('takes a screen-space pool with an explicit aspect, which has no default', () => {
    const { surface, pen } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface, { scale: 1, falloff: 1 });
    field.begin({ ...pen, surface: spy.surface }, 1, 'night');
    field.addScreen(100, 60, 40, 1, 1, 'warn');
    field.addScreen(100, 60, 40, 0.5, 1, 'warn');
    const pools = opsOf(spy.targets[0] ?? surface, 'softEllipse');
    expect(pools[0]?.xy).toEqual([100, 60, 40, 40]);
    expect(pools[1]?.xy).toEqual([100, 60, 40, 20]);
  });
});

describe('the composite', () => {
  it('is one cut and one add for the frame, however many pools there are', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface, { bloom: 0.35 });
    field.begin(pen, 0.7, 'night');
    field.add(0, 0, 0, 4, 1, 'warn');
    field.add(1, 1, 0, 4, 1, 'warn');
    field.add(2, 0, 0, 4, 1, 'warn');
    expect(field.count).toBe(3);
    field.composite();
    const blits = opsOf(surface, 'blit');
    expect(blits).toHaveLength(2);
    expect(blits[0]?.text).toMatch(/^over /);
    expect(blits[1]?.text).toMatch(/^add /);
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.35, 1]);
  });

  it('cuts the pools out of a darkness quad on its own target, not on the surface', () => {
    const { surface, pen, palette } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface);
    field.begin({ ...pen, surface: spy.surface }, 0.5, 'night');
    field.add(0, 0, 0, 4, 1, 'warn');
    field.composite();
    const mask = spy.targets[1];
    expect(mask?.mode).toBe('image');
    const quad = opsOf(mask ?? surface, 'poly')[0];
    expect(quad?.value).toBe(4);
    expect(quad?.colors[0]).toBe(withAlpha(palette.get('night'), 0.5));
    const cut = opsOf(mask ?? surface, 'blit');
    expect(cut).toHaveLength(1);
    expect(cut[0]?.text).toMatch(/^cut /);
  });

  it('skips the bloom entirely at bloom 0', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface, { bloom: 0 });
    field.begin(pen, 1, 'night');
    field.composite();
    expect(opsOf(surface, 'blit')).toHaveLength(1);
    expect(opsOf(surface, 'alpha')).toHaveLength(0);
  });

  it('takes a packed colour for the tint as readily as a slot', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(pen, 1, rgba(9, 9, 9));
    field.composite();
    expect(opsOf(surface, 'blit')).toHaveLength(2);
  });
});

describe('lifetime', () => {
  it('retains nothing between frames — a lamp that stops drawing stops lighting', () => {
    // There is no registration and therefore nothing to forget to unregister. A builder who
    // adds a `removeLight` has reintroduced the bug the design removed.
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(pen, 1, 'night');
    field.add(0, 0, 0, 4, 1, 'warn');
    expect(field.count).toBe(1);
    field.begin(pen, 1, 'night');
    expect(field.count).toBe(0);
  });

  it('rebuilds its buffers when the surface changes size, and only then', () => {
    const seen: number[] = [];
    const { surface, pen } = scene();
    const spy = {
      ...surface,
      createTarget: (w: number, h: number, m?: 'image' | 'light') => {
        seen.push(w);
        return surface.createTarget(w, h, m);
      },
    };
    const field = createLightField(spy);
    field.begin({ ...pen, surface: spy }, 1, 'night');
    expect(seen).toEqual([200, 200]);
    field.resize(400, 300);
    expect(seen).toEqual([200, 200]);
    field.resize(800, 600);
    expect(seen).toEqual([200, 200, 400, 400]);
  });

  it('resizes to nothing before it has buffers', () => {
    const { surface } = scene();
    const field = createLightField(surface);
    field.resize(800, 600);
    expect(field.active).toBe(false);
  });

  it('never sizes a buffer below one pixel', () => {
    const seen: number[] = [];
    const surface = createRecordingSurface(1, 1);
    const { pen } = scene();
    const spy = {
      ...surface,
      createTarget: (w: number, h: number, m?: 'image' | 'light') => {
        seen.push(w, h);
        return surface.createTarget(w, h, m);
      },
    };
    const field = createLightField(spy, { scale: 0.1 });
    field.begin({ ...pen, surface: spy }, 1, 'night');
    expect(seen).toEqual([1, 1, 1, 1]);
  });

  it('disposes both buffers and goes inactive', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(pen, 1, 'night');
    field.dispose();
    expect(field.active).toBe(false);
    surface.reset();
    field.composite();
    expect(surface.ops).toHaveLength(0);
  });
});
