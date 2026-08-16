/**
 * `clock` — the injection seam, and the reason this whole suite runs in milliseconds.
 *
 * There are no fake timers anywhere in this package's tests and there never will be. Every
 * assertion below is exact: a manual clock is integer arithmetic, so a test that wants an hour
 * says so and gets it, and there is nothing here that can be slow on a loaded CI box.
 */

import { describe, expect, it } from 'vitest';
import { manualClock } from '../src/clock.js';

describe('manualClock', () => {
  it('starts at zero, because a monotonic clock has no meaningful origin', () => {
    expect(manualClock().now()).toBe(0);
  });

  it('starts wherever a captured trace started', () => {
    expect(manualClock(1_234_567).now()).toBe(1_234_567);
  });

  it('reads the same value until somebody moves it — that is the whole product', () => {
    const clock = manualClock(10);
    expect(clock.now()).toBe(10);
    expect(clock.now()).toBe(10);
    expect(clock.now()).toBe(10);
  });

  it('advances by exactly what it was told, with no accumulated float error', () => {
    const clock = manualClock();
    // 10,000 × 0.1 ms. Naive float addition of 0.1 lands at 1000.0000000000158; these are
    // whole-millisecond additions of a value that is exact in binary, so the sum is exact.
    for (let i = 0; i < 10_000; i += 1) clock.advance(0.5);
    expect(clock.now()).toBe(5000);
  });

  it('runs a simulated hour instantly', () => {
    const clock = manualClock();
    clock.advance(3_600_000);
    expect(clock.now()).toBe(3_600_000);
  });

  it('accepts a zero advance — a pump that happens twice in the same instant is legal', () => {
    const clock = manualClock(7);
    clock.advance(0);
    expect(clock.now()).toBe(7);
  });

  it('refuses a negative advance by name, because it is always a bug and never a rewind', () => {
    const clock = manualClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(-1)).toThrow(/manualClock\.advance/);
    expect(() => clock.advance(-1)).toThrow(/-1/);
    expect(clock.now()).toBe(0);
  });

  it('refuses the three values that are not a duration', () => {
    const clock = manualClock();
    expect(() => clock.advance(NaN)).toThrow(RangeError);
    expect(() => clock.advance(Infinity)).toThrow(RangeError);
    expect(() => clock.advance(-Infinity)).toThrow(RangeError);
  });

  it('refuses a non-finite start, so a bad trace fails at construction', () => {
    expect(() => manualClock(NaN)).toThrow(/manualClock\.startMs/);
    expect(() => manualClock(Infinity)).toThrow(RangeError);
  });

  it('sets an absolute reading, forwards', () => {
    const clock = manualClock(100);
    clock.set(500);
    expect(clock.now()).toBe(500);
  });

  it('sets backwards, which is the only way to reproduce an NTP correction', () => {
    // `set` does not refuse this. The loop is what refuses to accumulate the negative delta;
    // putting the check here instead would make invariant I-6 untestable.
    const clock = manualClock(10_000);
    clock.set(5_000);
    expect(clock.now()).toBe(5_000);
  });

  it('refuses a non-finite absolute reading — NaN would silently stop the game stepping', () => {
    const clock = manualClock(10);
    expect(() => clock.set(NaN)).toThrow(/manualClock\.set/);
    expect(clock.now()).toBe(10);
  });
});
