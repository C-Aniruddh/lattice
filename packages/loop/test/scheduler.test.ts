/**
 * `scheduler` — one timer model, and the three properties that make it usable from a loop.
 *
 * Coalescing (at most one call per advance, carrying `repeats`), ordering (due time then
 * registration, never ambiguous), and mutation safety (a timer registered inside a firing
 * callback does not run in that fire; one cancelled inside it never runs at all).
 *
 * Everything is exact. Due times are integer microseconds, so `every(1/3)` lands on
 * 333,333 µs and stays there for a thousand periods — which is the whole reason the module is
 * written that way, and the reason there is no `toBeCloseTo` in this file.
 */

import { describe, expect, it } from 'vitest';
import { createTimeline } from '../src/scheduler.js';

describe('createTimeline', () => {
  it('starts at zero with nothing scheduled', () => {
    const timeline = createTimeline();
    expect(timeline.time).toBe(0);
    expect(timeline.pending).toBe(0);
  });

  it('advances by exactly what it is given', () => {
    const timeline = createTimeline();
    timeline.advance(0.5);
    timeline.advance(0.25);
    expect(timeline.time).toBe(0.75);
  });

  it('does not drift over ten thousand advances of a third of a step', () => {
    // 1/60 s is 16,667 µs after rounding. Ten thousand of them is exactly 166,670,000 µs.
    // Float addition of 1/60 ten thousand times lands at 166.66666666668056 s instead.
    const timeline = createTimeline();
    for (let i = 0; i < 10_000; i += 1) timeline.advance(1 / 60);
    expect(timeline.time).toBe(166.67);
  });
});

describe('after', () => {
  it('fires once, at the advance that reaches its due time', () => {
    const timeline = createTimeline();
    let fired = 0;
    timeline.after(1, () => {
      fired += 1;
    });
    timeline.advance(0.9);
    expect(fired).toBe(0);
    timeline.advance(0.1);
    expect(fired).toBe(1);
    timeline.advance(100);
    expect(fired).toBe(1);
  });

  it('leaves nothing pending once it has fired', () => {
    const timeline = createTimeline();
    timeline.after(1, () => {});
    expect(timeline.pending).toBe(1);
    timeline.advance(1);
    expect(timeline.pending).toBe(0);
  });

  it('accepts a zero delay and fires on the next advance, including a zero one', () => {
    const timeline = createTimeline();
    let fired = 0;
    timeline.after(0, () => {
      fired += 1;
    });
    timeline.advance(0);
    expect(fired).toBe(1);
  });

  it('I-18: refuses a negative, NaN or infinite delay, naming the parameter and the value', () => {
    const timeline = createTimeline();
    expect(() => timeline.after(-1, () => {})).toThrow(RangeError);
    expect(() => timeline.after(-1, () => {})).toThrow(/scheduler\.after\.delay/);
    expect(() => timeline.after(-1, () => {})).toThrow(/-1/);
    expect(() => timeline.after(NaN, () => {})).toThrow(/scheduler\.after\.delay/);
    expect(() => timeline.after(Infinity, () => {})).toThrow(RangeError);
    expect(timeline.pending).toBe(0);
  });

  it('refuses a duration too large to hold exactly in integer microseconds', () => {
    // 2^53 µs is about 285 years. Past it, `dueUs + periodUs === dueUs` and the timer fires on
    // every advance, forever.
    const timeline = createTimeline();
    expect(() => timeline.after(1e10, () => {})).toThrow(/microseconds/);
  });

  it('refuses a callback that is not one, at the line that made the mistake', () => {
    const timeline = createTimeline();
    expect(() => timeline.after(1, undefined as unknown as () => void)).toThrow(TypeError);
    expect(() => timeline.after(1, undefined as unknown as () => void)).toThrow(/scheduler\.after\.fn/);
  });
});

describe('every', () => {
  it('fires on each period, at absolute due times that do not drift', () => {
    const timeline = createTimeline();
    const at: number[] = [];
    timeline.every(1 / 3, () => at.push(timeline.time));
    for (let i = 0; i < 3; i += 1) timeline.advance(1 / 3);
    // 333,333 µs each, so the third fire is at 999,999 µs. A float accumulator would have
    // reported 0.9999999999999999 or 1.0000000000000002 depending on the machine.
    expect(at).toEqual([0.333333, 0.666666, 0.999999]);
  });

  it('I-9: an hour advanced in one call is one invocation carrying repeats, not 3,600 of them', () => {
    const timeline = createTimeline();
    let calls = 0;
    let repeats = 0;
    timeline.every(1, (n) => {
      calls += 1;
      repeats += n;
    });
    timeline.advance(3600);
    expect(calls).toBe(1);
    expect(repeats).toBe(3600);
  });

  it('reports repeats === 1 for an ordinary period', () => {
    const timeline = createTimeline();
    const seen: number[] = [];
    timeline.every(1, (n) => seen.push(n));
    timeline.advance(1);
    timeline.advance(1);
    expect(seen).toEqual([1, 1]);
  });

  it('carries the count exactly at a boundary: 2.5 periods is one call of 2, then one of 1', () => {
    const timeline = createTimeline();
    const seen: number[] = [];
    timeline.every(1, (n) => seen.push(n));
    timeline.advance(2.5);
    timeline.advance(1);
    expect(seen).toEqual([2, 1]);
  });

  it('stays scheduled after firing', () => {
    const timeline = createTimeline();
    timeline.every(1, () => {});
    timeline.advance(10);
    expect(timeline.pending).toBe(1);
  });

  it('I-18: refuses a zero or negative period — a zero period is an infinite loop', () => {
    const timeline = createTimeline();
    expect(() => timeline.every(0, () => {})).toThrow(RangeError);
    expect(() => timeline.every(0, () => {})).toThrow(/scheduler\.every\.period/);
    expect(() => timeline.every(0, () => {})).toThrow(/infinite loop/);
    expect(() => timeline.every(-1, () => {})).toThrow(RangeError);
    expect(() => timeline.every(NaN, () => {})).toThrow(RangeError);
    // Below a microsecond rounds to zero, which is the same infinite loop wearing a decimal.
    expect(() => timeline.every(1e-9, () => {})).toThrow(RangeError);
  });

  it('refuses a callback that is not one', () => {
    const timeline = createTimeline();
    expect(() => timeline.every(1, null as unknown as () => void)).toThrow(/scheduler\.every\.fn/);
  });
});

describe('ordering', () => {
  it('I-10: due-time order, then registration order, identically under different advance patterns', () => {
    const run = (pattern: readonly number[]): readonly string[] => {
      const timeline = createTimeline();
      const seen: string[] = [];
      // Registered out of due order on purpose, and two of them share an instant.
      timeline.after(2, () => seen.push('late'));
      timeline.after(1, () => seen.push('first-registered-at-1'));
      timeline.after(1, () => seen.push('second-registered-at-1'));
      for (const dt of pattern) timeline.advance(dt);
      return seen;
    };
    const oneBigAdvance = run([3]);
    const manySmall = run([0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 1]);
    expect(oneBigAdvance).toEqual(['first-registered-at-1', 'second-registered-at-1', 'late']);
    // The pattern changes when they fire relative to each other in wall-clock terms and
    // changes nothing about the sequence. That is what makes a recorded session replayable.
    expect(manySmall).toEqual(oneBigAdvance);
  });

  it('breaks a tie by insertion sequence and exposes no comparator', () => {
    const timeline = createTimeline();
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) timeline.after(1, () => seen.push(i));
    timeline.advance(1);
    expect(seen).toEqual([...Array(20).keys()]);
  });

  it('orders a repeating timer by the instant it first came due, not by its period', () => {
    const timeline = createTimeline();
    const seen: string[] = [];
    timeline.every(3, () => seen.push('slow'));
    timeline.after(1, () => seen.push('quick'));
    timeline.advance(5);
    expect(seen).toEqual(['quick', 'slow']);
  });
});

describe('mutation during a fire', () => {
  it('I-11: a timer registered inside a firing callback does not run in that same advance', () => {
    const timeline = createTimeline();
    const seen: string[] = [];
    timeline.after(1, () => {
      seen.push('outer');
      timeline.after(0, () => seen.push('inner'));
    });
    timeline.advance(10);
    expect(seen).toEqual(['outer']);
    timeline.advance(0);
    expect(seen).toEqual(['outer', 'inner']);
  });

  it('I-11: a timer cancelled inside a firing callback never runs at all', () => {
    const timeline = createTimeline();
    const seen: string[] = [];
    let victim = 0;
    timeline.after(1, () => {
      seen.push('first');
      timeline.cancel(victim);
    });
    victim = timeline.after(1, () => seen.push('victim'));
    timeline.advance(1);
    expect(seen).toEqual(['first']);
    expect(timeline.pending).toBe(0);
  });

  it('cancelAll from inside a firing callback stops the rest of the batch', () => {
    const timeline = createTimeline();
    const seen: string[] = [];
    timeline.after(1, () => {
      seen.push('first');
      timeline.cancelAll();
    });
    timeline.after(1, () => seen.push('second'));
    timeline.after(1, () => seen.push('third'));
    timeline.advance(1);
    expect(seen).toEqual(['first']);
    expect(timeline.pending).toBe(0);
  });

  it('a repeating timer that cancels itself does not fire again', () => {
    const timeline = createTimeline();
    let fired = 0;
    const id: number = timeline.every(1, () => {
      fired += 1;
      timeline.cancel(id);
    });
    timeline.advance(10);
    timeline.advance(10);
    expect(fired).toBe(1);
  });
});

describe('cancel', () => {
  it('reports whether a live timer was removed, and is safe to call twice', () => {
    const timeline = createTimeline();
    const id = timeline.after(1, () => {});
    expect(timeline.cancel(id)).toBe(true);
    expect(timeline.cancel(id)).toBe(false);
    expect(timeline.pending).toBe(0);
  });

  it('reports false for an id from a different timeline, rather than cancelling a stranger', () => {
    // Ids come from one process-wide allocator precisely so this returns false instead of
    // silently cancelling whichever timer happened to get the same small integer.
    const a = createTimeline();
    const b = createTimeline();
    const id = a.after(1, () => {});
    expect(b.cancel(id)).toBe(false);
    expect(a.pending).toBe(1);
  });

  it('reports false for an id that never existed', () => {
    expect(createTimeline().cancel(-999)).toBe(false);
  });

  it('cancelAll clears everything and leaves the timeline usable', () => {
    const timeline = createTimeline();
    let fired = 0;
    timeline.after(1, () => {
      fired += 1;
    });
    timeline.every(1, () => {
      fired += 1;
    });
    timeline.cancelAll();
    timeline.advance(100);
    expect(fired).toBe(0);
    expect(timeline.pending).toBe(0);
    timeline.after(1, () => {
      fired += 1;
    });
    timeline.advance(1);
    expect(fired).toBe(1);
  });
});

describe('advance', () => {
  it('accepts zero, which is what a pump with no elapsed time hands it', () => {
    const timeline = createTimeline();
    expect(() => timeline.advance(0)).not.toThrow();
  });

  it('I-18: refuses a negative, NaN or infinite advance, naming the value', () => {
    const timeline = createTimeline();
    expect(() => timeline.advance(-0.001)).toThrow(RangeError);
    expect(() => timeline.advance(-0.001)).toThrow(/timeline\.advance/);
    expect(() => timeline.advance(NaN)).toThrow(RangeError);
    expect(() => timeline.advance(-Infinity)).toThrow(RangeError);
  });

  it('costs nothing when there is nothing scheduled', () => {
    const timeline = createTimeline();
    for (let i = 0; i < 1000; i += 1) timeline.advance(1 / 60);
    expect(timeline.pending).toBe(0);
  });

  it('handles a hundred timers due in one advance without losing any', () => {
    const timeline = createTimeline();
    const seen: number[] = [];
    for (let i = 0; i < 100; i += 1) timeline.after((i + 1) / 100, () => seen.push(i));
    timeline.advance(1);
    expect(seen).toEqual([...Array(100).keys()]);
  });
});
