/**
 * The thresholds, their validation, and the fingerprint a replay is refused by.
 *
 * The fingerprint tests are the load-bearing ones: `@latticekit/persist` compares that string for
 * exact equality and refuses a replay that differs, so a change in how it is built silently
 * invalidates every log ever recorded. Two of these exist to make that change loud.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  PROFILE_SCALARS,
  profileFingerprint,
  resolveProfile,
} from '../src/profile.js';

describe('DEFAULT_PROFILE', () => {
  it('carries the numbers the table in the source defends', () => {
    expect(DEFAULT_PROFILE.tapSlopPx).toEqual({ mouse: 4, touch: 9, pen: 6 });
    expect(DEFAULT_PROFILE.longPressMs).toBe(450);
    expect(DEFAULT_PROFILE.maxPointers).toBe(2);
    expect(DEFAULT_PROFILE.maxBufferedSamples).toBe(4096);
  });

  it('is frozen, so one game cannot retune another', () => {
    expect(Object.isFrozen(DEFAULT_PROFILE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PROFILE.tapSlopPx)).toBe(true);
  });

  it('has a scalar list that covers every field but the slop record', () => {
    const keys = Object.keys(DEFAULT_PROFILE).filter((k) => k !== 'tapSlopPx');
    expect([...PROFILE_SCALARS].sort()).toEqual(keys.sort());
  });
});

describe('resolveProfile', () => {
  it('fills in every default when nothing is named', () => {
    expect(resolveProfile(undefined, 'x')).toEqual(DEFAULT_PROFILE);
  });

  it('keeps the defaults for everything an override does not name', () => {
    const profile = resolveProfile({ longPressMs: 800 }, 'x');
    expect(profile.longPressMs).toBe(800);
    expect(profile.pinchStartPx).toBe(DEFAULT_PROFILE.pinchStartPx);
    expect(profile.tapSlopPx).toEqual(DEFAULT_PROFILE.tapSlopPx);
  });

  it('accepts a slop record that names only one kind', () => {
    const profile = resolveProfile({ tapSlopPx: { touch: 12 } }, 'x');
    expect(profile.tapSlopPx).toEqual({ mouse: 4, touch: 12, pen: 6 });
  });

  it('names the field and the value it refuses', () => {
    expect(() => resolveProfile({ longPressMs: -1 }, 'createInput.profile')).toThrow(
      /createInput\.profile\.longPressMs: expected a finite number > 0, got -1/,
    );
    expect(() => resolveProfile({ pinchStartPx: Number.NaN }, 'p')).toThrow(RangeError);
    expect(() => resolveProfile({ flingHalfLifeMs: 0 }, 'p')).toThrow(/> 0, got 0/);
    expect(() => resolveProfile({ tapSlopPx: { mouse: -3 } }, 'p')).toThrow(
      /p\.tapSlopPx\.mouse/,
    );
  });

  it('refuses a fractional count, because those are counted and not measured', () => {
    expect(() => resolveProfile({ maxPointers: 2.5 }, 'p')).toThrow(/expected an integer/);
    expect(() => resolveProfile({ maxBufferedSamples: 1.5 }, 'p')).toThrow(/expected an integer/);
    expect(resolveProfile({ maxPointers: 3 }, 'p').maxPointers).toBe(3);
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(resolveProfile({ keyZoomStep: 1.2 }, 'p'))).toBe(true);
  });
});

describe('profileFingerprint', () => {
  it('is stable for the same numbers however the object was built', () => {
    const a = resolveProfile(undefined, 'p');
    const b = resolveProfile({ longPressMs: DEFAULT_PROFILE.longPressMs }, 'p');
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
  });

  it('differs when any threshold differs, and shows which', () => {
    const base = profileFingerprint(resolveProfile(undefined, 'p'));
    const moved = profileFingerprint(resolveProfile({ tapSlopPx: { touch: 12 } }, 'p'));
    expect(moved).not.toBe(base);
    expect(base).toContain('tap:4,9,6');
    expect(moved).toContain('tap:4,12,6');
    expect(base).toContain('longPressMs:450');
  });

  it('walks the scalars in the declared order, which is part of the recorded format', () => {
    const text = profileFingerprint(DEFAULT_PROFILE);
    const order = text
      .split('|')
      .slice(1)
      .map((part) => part.split(':')[0]);
    expect(order).toEqual([...PROFILE_SCALARS]);
  });
});
