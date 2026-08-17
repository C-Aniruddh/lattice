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

import { HALF_W } from '@latticekit/iso';
import { describe, expect, it } from 'vitest';
import { rgba, withAlpha } from '../src/color.js';
import { createLightField } from '../src/light.js';
import type { LightField } from '../src/light.js';
import type { RecordingSurface, RecordingTarget } from '../src/record.js';
import { createRecordingSurface } from '../src/record.js';
import type { Pen, Surface } from '../src/surface.js';
import { opsOf, scene } from './harness.js';

/**
 * A pen this field is entitled to be begun with.
 *
 * `begin` refuses a pen whose `light` is not the field itself, because leaving `light` out of the
 * `beginFrame` literal used to disable the whole night in silence — and every call below would
 * otherwise be written the way the bug is.
 */
function penFor(field: LightField, pen: Pen, surface?: Surface): Pen {
  return surface === undefined ? { ...pen, light: field } : { ...pen, surface, light: field };
}

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
    field.begin(penFor(field, pen, counted), 0, 'night');
    expect(targets).toBe(0);
    field.begin(penFor(field, pen, counted), 0.5, 'night');
    expect(targets).toBe(2);
  });
});

describe('full day costs nothing', () => {
  it('is inactive at darkness 0, adds nothing, and composites nothing', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    expect(field.active).toBe(false);
    field.begin(penFor(field, pen), 0, 'night');
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
    field.begin(penFor(field, pen), Number.NaN, 'night');
    expect(field.active).toBe(false);
    field.begin(penFor(field, pen), -3, 'night');
    expect(field.active).toBe(false);
  });

  it('clamps an over-driven darkness to full night rather than an opaque overshoot', () => {
    const { pen, surface, palette } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface);
    field.begin(penFor(field, pen, spy.surface), 9, 'night');
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
      field.begin(penFor(field, pen), 0.8, 'night');
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
    field.begin(penFor(field, pen, spy.surface), 0.8, 'night');
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
    field.begin(penFor(field, pen, spy.surface), 1, 'night');
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
      field.begin(penFor(field, pen, spy.surface), 1, 'night');
      field.add(0, 0, 0, 2, 1, 'warn');
      return opsOf(spy.targets[0] ?? surface, 'ellipse').length;
    };
    expect(make(1)).toBe(0);
    expect(make(2)).toBe(1);
  });

  it('ignores a pool with no light in it', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(penFor(field, pen), 1, 'night');
    field.add(0, 0, 0, 2, 0, 'warn');
    field.add(0, 0, 0, 0, 1, 'warn');
    field.add(0, 0, 0, -3, 1, 'warn');
    expect(field.count).toBe(0);
  });

  it('takes a screen-space pool with an explicit aspect, which has no default', () => {
    const { surface, pen } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface, { scale: 1, falloff: 1 });
    field.begin(penFor(field, pen, spy.surface), 1, 'night');
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
    field.begin(penFor(field, pen), 0.7, 'night');
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
    field.begin(penFor(field, pen, spy.surface), 0.5, 'night');
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
    field.begin(penFor(field, pen), 1, 'night');
    field.composite();
    expect(opsOf(surface, 'blit')).toHaveLength(1);
    expect(opsOf(surface, 'alpha')).toHaveLength(0);
  });

  it('takes a packed color for the tint as readily as a slot', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(penFor(field, pen), 1, rgba(9, 9, 9));
    field.composite();
    expect(opsOf(surface, 'blit')).toHaveLength(2);
  });
});

describe('the pen has to be the frame’s pen', () => {
  it('refuses a pen that was not opened with this field, rather than lighting nothing', () => {
    // Dropping `light` from the `beginFrame` literal used to disable the entire night in
    // silence: `renderFrame`'s `pen.light?.composite()` is a no-op, `drawSprite` skips every
    // `emit` hook, and every pool accumulates into a buffer nobody reads. Worse, the field still
    // reported `active: true` with a live `count`, so the one thing an author would check to
    // diagnose it said everything was fine.
    const { surface, pen } = scene();
    const field = createLightField(surface);
    expect(() => field.begin(pen, 1, 'night')).toThrow(RangeError);
    expect(() => field.begin(pen, 1, 'night')).toThrow(/beginFrame\(\{ …, light \}\)/);
    // Including at darkness 0, where nothing would have happened anyway: a game that is in
    // daylight on the frame it wires the field up must not be told it is fine.
    expect(() => field.begin(pen, 0, 'night')).toThrow(RangeError);
    expect(field.active).toBe(false);
  });

  it('refuses a pen carrying a different field, which is the same bug wearing a disguise', () => {
    const { surface, pen } = scene();
    const mine = createLightField(surface);
    const theirs = createLightField(surface);
    expect(() => mine.begin({ ...pen, light: theirs }, 1, 'night')).toThrow(RangeError);
    mine.begin({ ...pen, light: mine }, 1, 'night');
    expect(mine.active).toBe(true);
  });
});

describe('configure — every option is live', () => {
  it('moves the bloom on a running field', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface, { bloom: 0.35 });
    field.configure({ bloom: 0.6 });
    field.begin(penFor(field, pen), 1, 'night');
    field.composite();
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.6, 1]);
    // …including down to zero, which skips the second blit entirely.
    surface.reset();
    field.configure({ bloom: 0 });
    field.begin(penFor(field, pen), 1, 'night');
    field.composite();
    expect(opsOf(surface, 'blit')).toHaveLength(1);
  });

  it('moves the buffer resolution, taking effect on the next frame that has a night in it', () => {
    // Pinning `scale` to 1 for a screenshot is the case this exists for. The buffers are not
    // rebuilt inside `configure`: this field allocates only for a frame that is actually dark,
    // and that stays true of a field whose resolution just changed.
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
    field.begin(penFor(field, pen, spy), 1, 'night');
    expect(seen).toEqual([200, 200]);
    field.configure({ scale: 1 });
    expect(seen).toEqual([200, 200]);
    field.begin(penFor(field, pen, spy), 1, 'night');
    expect(seen).toEqual([200, 200, 400, 400]);
  });

  it('moves the falloff every pool defaults to', () => {
    const { surface, pen } = scene();
    const spy = spyOn(surface);
    const field = createLightField(spy.surface, { falloff: 1 });
    field.begin(penFor(field, pen, spy.surface), 1, 'night');
    field.add(0, 0, 0, 2, 1, 'warn');
    expect(opsOf(spy.targets[0] ?? surface, 'ellipse')).toHaveLength(0);
    field.configure({ falloff: 2 });
    field.begin(penFor(field, pen, spy.surface), 1, 'night');
    field.add(0, 0, 0, 2, 1, 'warn');
    // The hard core the plateau adds, which a pool at falloff 1 does not have.
    expect(opsOf(spy.targets[0] ?? surface, 'ellipse')).toHaveLength(1);
  });

  it('keeps what it is not given, and refuses a bad value in the words construction uses', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface, { bloom: 0.5, scale: 0.25 });
    field.configure({});
    expect(() => field.configure({ scale: 0 })).toThrow(/lightField.configure: expected scale in \(0, 1\]/);
    expect(() => field.configure({ falloff: 0.5 })).toThrow(/falloff/);
    expect(() => field.configure({ bloom: 2 })).toThrow(/bloom/);
    // Nothing was written: a rejected configure leaves the field exactly as it was rather than
    // half-moved, so the bloom below is still the one it was built with.
    field.begin(penFor(field, pen), 1, 'night');
    field.composite();
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.5, 1]);
  });
});

describe('readback — non-negotiable 11', () => {
  it('reads every option back under its own name, defaults included', () => {
    // The defaults are the documented ones and they are asserted as literals rather than against
    // the constants, so that moving a default is a decision somebody makes here rather than a
    // test that agrees with whatever the source now says.
    const surface = createRecordingSurface(100, 80);
    const plain = createLightField(surface);
    expect([plain.scale, plain.falloff, plain.bloom]).toEqual([0.5, 2, 0.35]);
    const tuned = createLightField(surface, { scale: 0.25, falloff: 4, bloom: 0 });
    expect([tuned.scale, tuned.falloff, tuned.bloom]).toEqual([0.25, 4, 0]);
  });

  it('reads back what `configure` set, so a panel needs no second copy of it', () => {
    // The failure this closes: a control panel rendering the current bloom beside its slider had
    // to remember what it last set, and a remembered copy is correct on the day it is written and
    // drifts afterward with no error. Every field, because the half-fix is what made this a rule.
    const surface = createRecordingSurface(100, 80);
    const field = createLightField(surface);
    field.configure({ bloom: 0.6 });
    expect(field.bloom).toBe(0.6);
    field.configure({ scale: 1 });
    expect(field.scale).toBe(1);
    field.configure({ falloff: 3 });
    expect(field.falloff).toBe(3);
    // Omitted fields keep their current value, and the readers say so rather than reverting to
    // the defaults the constructor used.
    field.configure({});
    expect([field.scale, field.falloff, field.bloom]).toEqual([1, 3, 0.6]);
  });

  it('reports the value that is in force after a rejected configure, not the one refused', () => {
    // Invariant 3 of `docs/rfc/live-options.md`, now observable from outside: before these
    // getters existed, "a rejected configure changes nothing" could only be checked by rendering
    // a frame and reading the composite back out of an op log.
    const surface = createRecordingSurface(100, 80);
    const field = createLightField(surface, { scale: 0.25, falloff: 3, bloom: 0.5 });
    expect(() => field.configure({ scale: 0.75, bloom: 2 })).toThrow(/bloom/);
    expect([field.scale, field.falloff, field.bloom]).toEqual([0.25, 3, 0.5]);
  });

  it('reports the scale that was set, which is not yet the scale the buffers are at', () => {
    // The hole named in `docs/rfc/live-options.md` §6b, asserted rather than left to be
    // discovered: `configure` takes effect on the next `begin`, so between the two calls the
    // getter reports 1 while the buffers are still 0.5 × the surface. A caller sizing anything
    // off this value in that window is sizing it off a resolution that does not exist yet.
    const seen: number[] = [];
    const { surface, pen } = scene();
    const spy = {
      ...surface,
      createTarget: (w: number, h: number, m?: 'image' | 'light'): RecordingTarget =>
        (seen.push(w), surface.createTarget(w, h, m) as RecordingTarget),
    };
    const field = createLightField(spy);
    field.begin(penFor(field, pen, spy), 1, 'night');
    // 200 CSS px of scene width at the default scale of 0.5.
    expect(seen).toEqual([200, 200]);
    field.configure({ scale: 1 });
    expect(field.scale).toBe(1);
    expect(seen).toEqual([200, 200]);
    field.begin(penFor(field, pen, spy), 1, 'night');
    expect(seen).toEqual([200, 200, 400, 400]);
  });

  it('reads the default falloff, and a per-call falloff is deliberately not recorded anywhere', () => {
    // `add`'s seventh argument overrides the field's default for one pool and is then gone: the
    // field retains nothing about a pool once it is drawn, so there is no per-pool falloff to
    // read back and the getter keeps reporting the default. A reader that changed would be
    // reporting the last pool drawn, which is a different fact wearing the same name.
    const { surface, pen } = scene();
    const field = createLightField(surface, { falloff: 2 });
    field.begin(penFor(field, pen), 1, 'night');
    field.add(0, 0, 0, 2, 1, 'warn', 4);
    field.addScreen(10, 10, 8, 1, 1, 'warn', 4);
    expect(field.falloff).toBe(2);
  });
});

describe('lifetime', () => {
  it('retains nothing between frames — a lamp that stops drawing stops lighting', () => {
    // There is no registration and therefore nothing to forget to unregister. A builder who
    // adds a `removeLight` has reintroduced the bug the design removed.
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(penFor(field, pen), 1, 'night');
    field.add(0, 0, 0, 4, 1, 'warn');
    expect(field.count).toBe(1);
    field.begin(penFor(field, pen), 1, 'night');
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
    field.begin(penFor(field, pen, spy), 1, 'night');
    expect(seen).toEqual([200, 200]);
    field.resize(400, 300);
    expect(seen).toEqual([200, 200]);
    field.resize(800, 600);
    expect(seen).toEqual([200, 200, 400, 400]);
  });

  it('resizes itself on the next frame, so forgetting resize costs a reallocation and no bug', () => {
    // `resize` was documented as a step an author must remember, which sends people hunting a
    // bug that does not exist. `begin` sizes the buffers to `pen.surface` on every active frame,
    // and this asserts that the self-heal is real rather than merely likely.
    const seen: number[] = [];
    const { pen } = scene();
    const small = createRecordingSurface(400, 300);
    const large = createRecordingSurface(800, 600);
    const watch = (s: RecordingSurface): RecordingSurface => ({
      ...s,
      createTarget: (w: number, h: number, m?: 'image' | 'light') => {
        seen.push(w);
        return s.createTarget(w, h, m);
      },
    });
    const field = createLightField(watch(small));
    field.begin(penFor(field, pen, watch(small)), 1, 'night');
    expect(seen).toEqual([200, 200]);
    // No `resize` call anywhere between these two frames.
    field.begin(penFor(field, pen, watch(large)), 1, 'night');
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
    field.begin(penFor(field, pen, spy), 1, 'night');
    expect(seen).toEqual([1, 1, 1, 1]);
  });

  it('disposes both buffers and goes inactive', () => {
    const { surface, pen } = scene();
    const field = createLightField(surface);
    field.begin(penFor(field, pen), 1, 'night');
    field.dispose();
    expect(field.active).toBe(false);
    surface.reset();
    field.composite();
    expect(surface.ops).toHaveLength(0);
  });
});
