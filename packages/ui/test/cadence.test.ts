import { describe, expect, it, vi } from 'vitest';
import { createCadence } from '../src/cadence.js';

describe('createCadence', () => {
  it('runs every subscriber in registration order with the time it was given', () => {
    const cadence = createCadence('ui.every');
    const seen: string[] = [];
    cadence.add((now) => seen.push(`a${String(now)}`));
    cadence.add((now) => seen.push(`b${String(now)}`));
    cadence.run(1200);
    expect(seen).toEqual(['a1200', 'b1200']);
  });

  it('counts live subscribers and drops them on dispose', () => {
    const cadence = createCadence('ui.every');
    expect(cadence.size).toBe(0);
    const stop = cadence.add(() => undefined);
    cadence.add(() => undefined);
    expect(cadence.size).toBe(2);
    stop();
    expect(cadence.size).toBe(1);
  });

  it('has an idempotent disposer', () => {
    const cadence = createCadence('ui.every');
    const stop = cadence.add(() => undefined);
    stop();
    stop();
    expect(cadence.size).toBe(0);
  });

  it('runs a subscriber added during a dispatch on the next dispatch, not this one', () => {
    // A toast host that spawned in a tick and expired in the same tick would be a message that
    // never reached a screen.
    const cadence = createCadence('ui.every');
    const late = vi.fn();
    cadence.add(() => {
      cadence.add(late);
    });
    cadence.run(0);
    expect(late).not.toHaveBeenCalled();
    cadence.run(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('does not shift the next subscriber when one disposes itself mid-dispatch', () => {
    const cadence = createCadence('ui.every');
    const seen: string[] = [];
    const stopFirst = cadence.add(() => {
      seen.push('first');
      stopFirst();
    });
    cadence.add(() => seen.push('second'));
    cadence.add(() => seen.push('third'));
    cadence.run(0);
    expect(seen).toEqual(['first', 'second', 'third']);
    seen.length = 0;
    cadence.run(1);
    expect(seen).toEqual(['second', 'third']);
    expect(cadence.size).toBe(2);
  });

  it('unsubscribes the right subscriber after a compaction has moved the slots', () => {
    // The bug this pins: a disposer that remembers its index and clears whatever now sits there
    // takes somebody else's widget off the cadence, and the symptom is a readout that stops
    // updating for no reason a stack trace can show.
    const cadence = createCadence('ui.every');
    const seen: string[] = [];
    const stopA = cadence.add(() => seen.push('a'));
    const stopB = cadence.add(() => seen.push('b'));
    cadence.add(() => seen.push('c'));
    stopA();
    stopB();
    cadence.run(0);
    expect(seen).toEqual(['c']);
  });

  it('runs every subscriber even when one throws, and reports them together', () => {
    const cadence = createCadence('ui.every');
    const after = vi.fn();
    cadence.add(() => {
      throw new Error('a widget broke');
    });
    cadence.add(after);
    expect(() => cadence.run(0)).toThrow(AggregateError);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('names the cadence and counts the failures in the aggregate message', () => {
    const cadence = createCadence('ui.paint');
    cadence.add(() => {
      throw new Error('one');
    });
    cadence.add(() => {
      throw new Error('two');
    });
    let caught: unknown;
    try {
      cadence.run(0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.message).toContain('ui.paint');
    expect(aggregate.message).toContain('2 of 2');
  });

  it('keeps dispatching after a throwing dispatch', () => {
    const cadence = createCadence('ui.every');
    let calls = 0;
    cadence.add(() => {
      calls += 1;
      if (calls === 1) throw new Error('first only');
    });
    expect(() => cadence.run(0)).toThrow(AggregateError);
    expect(() => cadence.run(1)).not.toThrow();
    expect(calls).toBe(2);
  });

  it('rejects a non-function subscriber at the line that made the mistake', () => {
    const cadence = createCadence('ui.every');
    expect(() => cadence.add(undefined as unknown as () => void)).toThrow(TypeError);
  });

  it('rejects a clock that is not finite', () => {
    const cadence = createCadence('ui.every');
    cadence.add(() => undefined);
    expect(() => cadence.run(Number.NaN)).toThrow(RangeError);
    expect(() => cadence.run(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('accepts zero, a negative reading and a very large one', () => {
    // A monotonic clock starts at 0, a test clock may run backwards across a reset, and an epoch
    // clock is 1.7e12 today. None of those is this module's business to have an opinion about.
    const cadence = createCadence('ui.every');
    const seen: number[] = [];
    cadence.add((now) => seen.push(now));
    cadence.run(0);
    cadence.run(-1);
    cadence.run(Number.MAX_SAFE_INTEGER);
    expect(seen).toEqual([0, -1, Number.MAX_SAFE_INTEGER]);
  });

  it('dispatches an empty cadence without complaint', () => {
    const cadence = createCadence('ui.every');
    expect(() => cadence.run(0)).not.toThrow();
    expect(cadence.size).toBe(0);
  });

  it('survives a nested dispatch without losing a subscriber', () => {
    const cadence = createCadence('ui.every');
    const seen: string[] = [];
    let nested = false;
    cadence.add(() => {
      seen.push('outer');
      if (!nested) {
        nested = true;
        cadence.run(1);
      }
    });
    cadence.add(() => seen.push('tail'));
    cadence.run(0);
    expect(seen).toEqual(['outer', 'outer', 'tail', 'tail']);
    expect(cadence.size).toBe(2);
  });
});
