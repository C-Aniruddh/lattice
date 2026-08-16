/**
 * `tween` — interpolation, and the four bugs it is shaped to prevent.
 *
 * A tween that ends at 0.9999999 and never fires "arrived"; an `onDone` after a cancel; two
 * tweens writing one property and shuddering between two paths; and a curve name that silently
 * means linear when it was a typo.
 *
 * No tolerances here either. Timing is integer microseconds and the curves are `core`'s, so
 * every expected value is either an exact endpoint or a polynomial of an exact fraction.
 */

import { describe, expect, it } from 'vitest';
import { EASINGS, type EasingName } from '@lattice/core';
import { createTweens } from '../src/tween.js';

describe('createTweens', () => {
  it('starts empty', () => {
    expect(createTweens().active).toBe(0);
  });

  it('interpolates linearly by default', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 100, seconds: 1, onUpdate: (v) => seen.push(v) });
    tweens.step(0.25);
    tweens.step(0.25);
    expect(seen).toEqual([25, 50]);
  });

  it('counts as active while it runs and stops counting the step it completes', () => {
    const tweens = createTweens();
    tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => {} });
    expect(tweens.active).toBe(1);
    tweens.step(0.5);
    expect(tweens.active).toBe(1);
    tweens.step(0.5);
    expect(tweens.active).toBe(0);
  });

  it('I-12: ends on exactly `to`, then calls onDone exactly once', () => {
    // A panel that ends its slide two-tenths of a nanometre short is a panel whose "arrived"
    // comparison is unequal forever.
    const tweens = createTweens();
    const seen: number[] = [];
    let done = 0;
    tweens.start({
      from: 0,
      to: 1 / 3,
      seconds: 1,
      onUpdate: (v) => seen.push(v),
      onDone: () => {
        done += 1;
      },
    });
    for (let i = 0; i < 7; i += 1) tweens.step(1 / 6);
    expect(seen[seen.length - 1]).toBe(1 / 3);
    expect(done).toBe(1);
  });

  it('I-12: overrunning the duration still ends on `to`, never past it', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 10, to: 20, seconds: 1, onUpdate: (v) => seen.push(v) });
    tweens.step(1000);
    expect(seen).toEqual([20]);
  });

  it('I-12: a cancelled tween never calls onDone', () => {
    const tweens = createTweens();
    let done = 0;
    const id = tweens.start({
      from: 0,
      to: 1,
      seconds: 1,
      onUpdate: () => {},
      onDone: () => {
        done += 1;
      },
    });
    tweens.step(0.5);
    expect(tweens.cancel(id)).toBe(true);
    tweens.step(10);
    expect(done).toBe(0);
    expect(tweens.active).toBe(0);
  });

  it('cancel reports false for an id it does not hold, and is safe twice', () => {
    const tweens = createTweens();
    const id = tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => {} });
    expect(tweens.cancel(id)).toBe(true);
    expect(tweens.cancel(id)).toBe(false);
    expect(tweens.cancel(-1)).toBe(false);
  });

  it('cancelAll stops everything without any onDone, and leaves the bag usable', () => {
    const tweens = createTweens();
    let done = 0;
    for (let i = 0; i < 5; i += 1) {
      tweens.start({ from: 0, to: 1, seconds: 1, slot: `s${String(i)}`, onUpdate: () => {}, onDone: () => (done += 1) });
    }
    tweens.cancelAll();
    tweens.step(10);
    expect(done).toBe(0);
    expect(tweens.active).toBe(0);
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 's0', onUpdate: () => {} });
    expect(tweens.active).toBe(1);
  });
});

describe('delay', () => {
  it('writes nothing at all until the delay has elapsed', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 1, seconds: 1, delay: 0.5, onUpdate: (v) => seen.push(v) });
    tweens.step(0.25);
    tweens.step(0.25);
    expect(seen).toEqual([0]);
    tweens.step(0.5);
    expect(seen).toEqual([0, 0.5]);
  });

  it('is the whole sequencing story: two tweens, one delayed past the other', () => {
    const tweens = createTweens();
    const order: string[] = [];
    tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => {}, onDone: () => order.push('first') });
    tweens.start({ from: 0, to: 1, seconds: 1, delay: 1, onUpdate: () => {}, onDone: () => order.push('second') });
    for (let i = 0; i < 4; i += 1) tweens.step(0.5);
    expect(order).toEqual(['first', 'second']);
  });

  it('refuses a negative or non-finite delay', () => {
    const tweens = createTweens();
    expect(() => tweens.start({ from: 0, to: 1, seconds: 1, delay: -1, onUpdate: () => {} })).toThrow(/tween\.delay/);
    expect(() => tweens.start({ from: 0, to: 1, seconds: 1, delay: NaN, onUpdate: () => {} })).toThrow(RangeError);
  });
});

describe('ease', () => {
  it('resolves a name through core EASINGS and produces that curve exactly', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 1, seconds: 1, ease: 'quadIn', onUpdate: (v) => seen.push(v) });
    tweens.step(0.5);
    // quadIn(0.5) is 0.25 by definition, and 0.25 is exact in binary.
    expect(seen).toEqual([0.25]);
    expect(EASINGS.quadIn(0.5)).toBe(0.25);
  });

  it('takes a curve directly, for a game that authored its own', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 8, seconds: 1, ease: (t) => t * t * t, onUpdate: (v) => seen.push(v) });
    tweens.step(0.5);
    expect(seen).toEqual([1]);
  });

  it('I-20: refuses an unknown name, listing the valid ones — it must never quietly go linear', () => {
    // A level file with a typo would otherwise ship feeling wrong and passing its tests.
    const tweens = createTweens();
    const bad = (): unknown => tweens.start({ from: 0, to: 1, seconds: 1, ease: 'easeOutCubic' as EasingName, onUpdate: () => {} });
    expect(bad).toThrow(RangeError);
    expect(bad).toThrow(/easeOutCubic/);
    expect(bad).toThrow(/cubicOut/);
    expect(bad).toThrow(/bounceOut/);
    expect(tweens.active).toBe(0);
  });

  it('I-20: names no curve of its own — every valid name comes from core', () => {
    const tweens = createTweens();
    for (const name of Object.keys(EASINGS) as EasingName[]) {
      const seen: number[] = [];
      tweens.start({ from: 0, to: 1, seconds: 1, ease: name, onUpdate: (v) => seen.push(v) });
      tweens.step(1);
      expect(seen[seen.length - 1]).toBe(1);
    }
    // And there is no sine or expo curve anywhere in the kit, deliberately: `Math.cos` and
    // `Math.pow` are not required by ECMA-262 to be correctly rounded, so either one demotes a
    // tween out of Tier A and out of anything that may be persisted.
    expect(Object.keys(EASINGS).some((n) => /sine|expo/i.test(n))).toBe(false);
  });

  it('lets an overshooting curve overshoot — that is what backOut is for', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 1, seconds: 1, ease: 'backOut', onUpdate: (v) => seen.push(v) });
    tweens.step(0.75);
    expect(seen[0]).toBe(EASINGS.backOut(0.75));
    expect(seen[0]).toBeGreaterThan(1);
  });
});

describe('slot', () => {
  it('I-13: two tweens can never share a slot', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 100, seconds: 1, slot: 'panel.y', onUpdate: (v) => seen.push(v) });
    tweens.start({ from: 0, to: -100, seconds: 1, slot: 'panel.y', onUpdate: (v) => seen.push(v) });
    expect(tweens.active).toBe(1);
    tweens.step(0.5);
    // Only the second one's values are ever seen. Two tweens on one property is the animation
    // bug where each writes its own idea of the value on alternate steps and the thing shudders.
    expect(seen).toEqual([-50]);
  });

  it('I-12: a slot-displaced tween never calls onDone', () => {
    const tweens = createTweens();
    let done = 0;
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'x', onUpdate: () => {}, onDone: () => (done += 1) });
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'x', onUpdate: () => {} });
    tweens.step(10);
    expect(done).toBe(0);
  });

  it('frees the slot when the tween completes, so the next one is not treated as a re-target', () => {
    const tweens = createTweens();
    let done = 0;
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'x', onUpdate: () => {}, onDone: () => (done += 1) });
    tweens.step(1);
    expect(done).toBe(1);
    tweens.start({ from: 1, to: 2, seconds: 1, slot: 'x', onUpdate: () => {}, onDone: () => (done += 1) });
    tweens.step(1);
    expect(done).toBe(2);
  });

  it('frees the slot when the tween is cancelled by id', () => {
    const tweens = createTweens();
    const id = tweens.start({ from: 0, to: 1, seconds: 1, slot: 'x', onUpdate: () => {} });
    tweens.cancel(id);
    let done = 0;
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'x', onUpdate: () => {}, onDone: () => (done += 1) });
    tweens.step(1);
    expect(done).toBe(1);
  });

  it('leaves other slots alone', () => {
    const tweens = createTweens();
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'a', onUpdate: () => {} });
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'b', onUpdate: () => {} });
    tweens.start({ from: 0, to: 1, seconds: 1, slot: 'a', onUpdate: () => {} });
    expect(tweens.active).toBe(2);
  });
});

describe('mutation during a step', () => {
  it('I-11: a tween started inside an onUpdate does not step in the same pass', () => {
    const tweens = createTweens();
    const seen: string[] = [];
    tweens.start({
      from: 0,
      to: 1,
      seconds: 1,
      onUpdate: () => {
        seen.push('outer');
        if (tweens.active === 1) {
          tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => seen.push('inner') });
        }
      },
    });
    tweens.step(0.25);
    expect(seen).toEqual(['outer']);
    tweens.step(0.25);
    expect(seen).toEqual(['outer', 'outer', 'inner']);
  });

  it('I-11: a tween started inside an onDone does not step in the same pass', () => {
    const tweens = createTweens();
    const seen: string[] = [];
    tweens.start({
      from: 0,
      to: 1,
      seconds: 1,
      onUpdate: () => {},
      onDone: () => {
        seen.push('done');
        tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => seen.push('chained') });
      },
    });
    tweens.step(1);
    expect(seen).toEqual(['done']);
    tweens.step(0.5);
    expect(seen).toEqual(['done', 'chained']);
  });

  it('I-11: a tween cancelled inside another tween’s onUpdate never runs again', () => {
    const tweens = createTweens();
    const seen: string[] = [];
    let victim = 0;
    tweens.start({
      from: 0,
      to: 1,
      seconds: 1,
      onUpdate: () => {
        seen.push('first');
        tweens.cancel(victim);
      },
    });
    victim = tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: () => seen.push('victim') });
    tweens.step(0.25);
    tweens.step(0.25);
    expect(seen).toEqual(['first', 'first']);
  });
});

describe('validation', () => {
  it('I-18: refuses a zero-length tween by name — that is an assignment', () => {
    const tweens = createTweens();
    expect(() => tweens.start({ from: 0, to: 1, seconds: 0, onUpdate: () => {} })).toThrow(RangeError);
    expect(() => tweens.start({ from: 0, to: 1, seconds: 0, onUpdate: () => {} })).toThrow(/tween\.seconds/);
    expect(() => tweens.start({ from: 0, to: 1, seconds: 0, onUpdate: () => {} })).toThrow(/assignment/);
    expect(() => tweens.start({ from: 0, to: 1, seconds: -1, onUpdate: () => {} })).toThrow(RangeError);
    // Below a microsecond rounds to a zero-length tween, so it is refused for the same reason.
    expect(() => tweens.start({ from: 0, to: 1, seconds: 1e-9, onUpdate: () => {} })).toThrow(RangeError);
    expect(() => tweens.start({ from: 0, to: 1, seconds: NaN, onUpdate: () => {} })).toThrow(RangeError);
    expect(() => tweens.start({ from: 0, to: 1, seconds: 1e12, onUpdate: () => {} })).toThrow(/microseconds/);
  });

  it('refuses a non-finite endpoint, because a NaN spreads silently through a position', () => {
    const tweens = createTweens();
    expect(() => tweens.start({ from: NaN, to: 1, seconds: 1, onUpdate: () => {} })).toThrow(/tween\.from/);
    expect(() => tweens.start({ from: 0, to: Infinity, seconds: 1, onUpdate: () => {} })).toThrow(/tween\.to/);
  });

  it('refuses a missing onUpdate — a tween with nowhere to write is a timer with arithmetic', () => {
    const tweens = createTweens();
    expect(() =>
      tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: undefined as unknown as (v: number) => void }),
    ).toThrow(TypeError);
  });

  it('I-18: refuses a negative or non-finite step', () => {
    const tweens = createTweens();
    expect(() => tweens.step(-1)).toThrow(RangeError);
    expect(() => tweens.step(-1)).toThrow(/tweens\.step/);
    expect(() => tweens.step(NaN)).toThrow(RangeError);
  });

  it('a zero step is legal and moves nothing', () => {
    const tweens = createTweens();
    const seen: number[] = [];
    tweens.start({ from: 0, to: 1, seconds: 1, onUpdate: (v) => seen.push(v) });
    tweens.step(0);
    expect(seen).toEqual([0]);
  });

  it('stepping an empty bag costs nothing and throws nothing', () => {
    const tweens = createTweens();
    expect(() => tweens.step(1 / 60)).not.toThrow();
  });

  it('does not drift over a thousand steps of a sixtieth', () => {
    // 1,000 × 16,667 µs = 16.667 s, so a 16-second tween has finished and a 17-second one has
    // not. With a float accumulator the boundary case is a coin flip on the machine.
    const tweens = createTweens();
    let done = false;
    tweens.start({ from: 0, to: 1, seconds: 16.667, onUpdate: () => {}, onDone: () => (done = true) });
    for (let i = 0; i < 999; i += 1) tweens.step(1 / 60);
    expect(done).toBe(false);
    tweens.step(1 / 60);
    expect(done).toBe(true);
  });
});
