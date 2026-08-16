/**
 * The fixed step.
 *
 * Two things are being tested and only one of them is arithmetic. The other is that the *wrong*
 * step is now unrepresentable: `stepMs: 16` against a 16.667 ms loop used to construct happily
 * and lie by 4% for the life of the session, and the point of this module is that there is no
 * longer a value a caller can pass that does that quietly.
 */

import { describe, expect, it } from 'vitest';
import { fixedStep, resolveStep } from '../src/step.js';

describe('fixedStep', () => {
  it('derives both fields from integer microseconds, exactly as createLoop does', () => {
    // `createLoop` computes `stepUs = Math.round(1e6 / hz)` once and divides it twice. The
    // numbers below are that arithmetic, written out — not a re-implementation with the same
    // shape, which would agree with a bug as readily as with the truth.
    expect(fixedStep(60)).toEqual({ stepMs: 16.667, stepSeconds: 0.016667 });
    expect(fixedStep(50)).toEqual({ stepMs: 20, stepSeconds: 0.02 });
    expect(fixedStep(10)).toEqual({ stepMs: 100, stepSeconds: 0.1 });
    expect(fixedStep(1)).toEqual({ stepMs: 1000, stepSeconds: 1 });
  });

  it('is 16.667 and not 1000/60, because a log compares the step for exact equality', () => {
    // The whole reason this function exists rather than a division at the call site. The
    // difference is in the twelfth decimal place, invisible in a gesture, and fatal in a log.
    expect(fixedStep(60).stepMs).not.toBe(1000 / 60);
    expect(fixedStep(60).stepMs).toBe(16667 / 1000);
  });

  it('holds at both ends of the range createLoop allows', () => {
    expect(fixedStep(1_000_000)).toEqual({ stepMs: 0.001, stepSeconds: 0.000001 });
    expect(fixedStep(1).stepMs).toBe(1000);
  });

  it('refuses a rate that is not a whole number of steps per second', () => {
    // 62.5 Hz is exactly the 16 ms someone meant to type. Rounding it to 63 would hand them a
    // step nobody chose and record a log under it.
    expect(() => fixedStep(62.5)).toThrow(/expected an integer/);
    expect(() => fixedStep(Number.NaN)).toThrow(RangeError);
  });

  it('refuses a rate outside createLoop bounds, so every step it makes is one a loop can run', () => {
    for (const hz of [0, -60, 1_000_001, Number.POSITIVE_INFINITY]) {
      expect(() => fixedStep(hz)).toThrow(RangeError);
    }
    expect(() => fixedStep(0)).toThrow(/expected an integer in \[1, 1000000\], got 0/);
  });
});

describe('resolveStep', () => {
  it('returns the milliseconds of a coherent pair', () => {
    expect(resolveStep(fixedStep(60), 'x.step')).toBe(16.667);
  });

  it('names the bare number, because that is the call it is replacing', () => {
    expect(() => resolveStep(16 as never, 'createInput.step')).toThrow(
      /createInput\.step: expected the loop, or fixedStep\(hz\) — got the bare number 16/,
    );
  });

  it('refuses anything that is not an object at all', () => {
    for (const bad of [null, undefined, 'loop']) {
      expect(() => resolveStep(bad as never, 'x.step')).toThrow(TypeError);
    }
  });

  it('refuses each field by name', () => {
    expect(() => resolveStep({ stepMs: 0, stepSeconds: 0 }, 'x.step')).toThrow(
      /x\.step\.stepMs: expected a finite number > 0, got 0/,
    );
    expect(() => resolveStep({ stepMs: 16.667, stepSeconds: -1 }, 'x.step')).toThrow(
      /x\.step\.stepSeconds: expected a finite number > 0, got -1/,
    );
    expect(() => resolveStep({ stepMs: Number.NaN, stepSeconds: 1 }, 'x.step')).toThrow(RangeError);
  });

  it('refuses a pair that disagrees, in either direction', () => {
    // This is K13's mistake wearing its last disguise: someone who has been told to pass an
    // object and types the two numbers by hand.
    expect(() => resolveStep({ stepMs: 16, stepSeconds: 0.016667 }, 'x.step')).toThrow(
      /describe different steps — 16.667 ms against 16 ms/,
    );
    expect(() => resolveStep({ stepMs: 16.667, stepSeconds: 0.016 }, 'x.step')).toThrow(
      /describe different steps/,
    );
  });

  it('accepts every rate a loop can run, so the tolerance is not merely tuned to 60 Hz', () => {
    // The agreement bound is 1e-12 and the worst real disagreement across the whole legal range
    // is 2.21e-16 — at 995 Hz, which is in this sweep. A tolerance that only worked at 60 would
    // pass a test written at 60 and refuse a game running at 995.
    for (const hz of [1, 3, 7, 24, 30, 60, 72, 120, 144, 240, 995, 999, 1000, 65_536, 1_000_000]) {
      expect(resolveStep(fixedStep(hz), 'x.step')).toBe(fixedStep(hz).stepMs);
    }
  });

  it('accepts a step whose fields agree exactly, which a whole-millisecond rate produces', () => {
    // 50 Hz is 20 ms and 0.02 s with no rounding anywhere, so the difference is a true zero
    // rather than an ulp. The comparison has to admit that as well as the noisy case.
    expect(resolveStep({ stepMs: 20, stepSeconds: 0.02 }, 'x.step')).toBe(20);
  });
});
