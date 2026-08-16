import { describe, expect, it } from 'vitest';

import {
  COMPACT_SUFFIXES,
  fmtCompact,
  fmtDuration,
  fmtInteger,
  fmtPercent,
  fmtRate,
  fmtSigned,
} from '../src/format.js';

const DASH = '—';

/** Ten thousand log-spaced magnitudes, positive and negative, from 1e-6 to 1e308. */
function* sweep(): Generator<number> {
  for (let i = 0; i <= 10_000; i += 1) {
    const value = 10 ** (-6 + (i / 10_000) * 314);
    yield value;
    yield -value;
  }
}

describe('fmtCompact', () => {
  it('formats the magnitudes the RFC uses as its examples', () => {
    expect(fmtCompact(12_500)).toBe('12.5K');
    expect(fmtCompact(9_400)).toBe('9.4K');
  });

  it('leaves small whole numbers alone', () => {
    expect(fmtCompact(0)).toBe('0');
    expect(fmtCompact(1)).toBe('1');
    expect(fmtCompact(7)).toBe('7');
    expect(fmtCompact(250)).toBe('250');
    expect(fmtCompact(999)).toBe('999');
  });

  it('shows one decimal for a fraction below ten, and none above it', () => {
    expect(fmtCompact(5.5)).toBe('5.5');
    expect(fmtCompact(0.5)).toBe('0.5');
    expect(fmtCompact(250.7)).toBe('250');
  });

  it('carries the sign', () => {
    expect(fmtCompact(-1)).toBe('-1');
    expect(fmtCompact(-12_500)).toBe('-12.5K');
    expect(fmtCompact(-5.5)).toBe('-5.5');
    expect(fmtCompact(-0)).toBe('0');
  });

  it('truncates rather than rounding up across its own tier — trap 20', () => {
    expect(fmtCompact(999_950)).toBe('999.9K');
    expect(fmtCompact(999_950)).not.toBe('1000.0K');
    expect(fmtCompact(999_999)).toBe('999.9K');
    expect(fmtCompact(9.96)).toBe('9.9');
    expect(fmtCompact(1_000_000)).toBe('1.0M');
  });

  it('never overstates a stock', () => {
    for (const value of [1.99, 19.9, 1999, 1_999_999]) {
      const text = fmtCompact(value);
      expect(Number(text.replace(/[KMB]$/, '')) * (text.endsWith('K') ? 1e3 : text.endsWith('M') ? 1e6 : 1)).toBeLessThanOrEqual(value);
    }
  });

  it('steps through every tier of the ladder', () => {
    expect(fmtCompact(1)).toBe('1');
    for (let tier = 1; tier < COMPACT_SUFFIXES.length; tier += 1) {
      const value = Number(`1e${String(tier * 3)}`);
      expect(fmtCompact(value)).toBe(`1.0${String(COMPACT_SUFFIXES[tier])}`);
    }
    expect(fmtCompact(1e27)).toBe('1.0Oc');
  });

  it('is never wider than six characters, sign included', () => {
    for (const value of sweep()) {
      expect(fmtCompact(value).length).toBeLessThanOrEqual(6);
    }
  });

  it('never formats a larger input to an earlier tier', () => {
    const tierOf = (text: string): number => {
      if (text.includes('e')) return COMPACT_SUFFIXES.length;
      const suffix = text.replace(/^-?[\d.]*/, '');
      const index = COMPACT_SUFFIXES.indexOf(suffix);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };

    let previous = 0;
    for (let i = 0; i <= 10_000; i += 1) {
      const value = 10 ** (-6 + (i / 10_000) * 314);
      const tier = tierOf(fmtCompact(value));
      expect(tier).toBeGreaterThanOrEqual(previous);
      previous = tier;
    }
  });

  it('falls back to exponential past the ladder, and still fits', () => {
    expect(fmtCompact(1e30)).toBe('1.0e30');
    expect(fmtCompact(1e40)).toBe('1.0e40');
    expect(fmtCompact(-1e30)).toBe('-1e30');
    expect(fmtCompact(1e308)).toBe('1e308');
    expect(fmtCompact(-1e308)).toBe('-1e308');
    expect(fmtCompact(9.99e29)).toBe('999Oc');
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtCompact(Number.NaN)).toBe(DASH);
    expect(fmtCompact(Number.POSITIVE_INFINITY)).toBe(DASH);
    expect(fmtCompact(Number.NEGATIVE_INFINITY)).toBe(DASH);
  });

  it('handles the smallest positive double without inventing precision', () => {
    expect(fmtCompact(5e-324)).toBe('0.0');
    expect(fmtCompact(5e-324, 0)).toBe('0');
  });

  it('honours a decimals argument that fits, and drops one that does not', () => {
    expect(fmtCompact(12_500, 0)).toBe('12K');
    expect(fmtCompact(12_500, 2)).toBe('12.50K');
    expect(fmtCompact(12_500, 3)).toBe('12K');
    expect(fmtCompact(1.23456, 4)).toBe('1.2345');
  });

  it('names the caller when decimals is out of range', () => {
    expect(() => fmtCompact(1, -1)).toThrow(RangeError);
    expect(() => fmtCompact(1, -1)).toThrow(
      'fmtCompact: expected decimals to be an integer in [0, 6], got -1',
    );
    expect(() => fmtCompact(1, 1.5)).toThrow(RangeError);
    expect(() => fmtCompact(1, 7)).toThrow(RangeError);
    expect(() => fmtCompact(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('fmtSigned', () => {
  it('marks a gain, a loss and a standstill', () => {
    expect(fmtSigned(12_500)).toBe('+12.5K');
    expect(fmtSigned(-12_500)).toBe('-12.5K');
    expect(fmtSigned(0)).toBe('0');
    expect(fmtSigned(0.5)).toBe('+0.5');
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtSigned(Number.NaN)).toBe(DASH);
    expect(fmtSigned(Number.POSITIVE_INFINITY)).toBe(DASH);
  });
});

describe('fmtInteger', () => {
  it('groups with an ASCII comma', () => {
    expect(fmtInteger(1_234_567)).toBe('1,234,567');
    expect(fmtInteger(-1_234_567)).toBe('-1,234,567');
    expect(fmtInteger(1000)).toBe('1,000');
    expect(fmtInteger(999)).toBe('999');
    expect(fmtInteger(0)).toBe('0');
    expect(fmtInteger(12_345)).toBe('12,345');
    expect(fmtInteger(123_456)).toBe('123,456');
  });

  it('rounds to the nearest whole number', () => {
    expect(fmtInteger(0.4)).toBe('0');
    expect(fmtInteger(-0.4)).toBe('0');
    expect(fmtInteger(1999.5)).toBe('2,000');
  });

  it('falls back to compact form where a double has no exact digit string', () => {
    expect(fmtInteger(1e21)).toBe('1.0Sx');
    expect(fmtInteger(1e30)).toBe('1.0e30');
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtInteger(Number.NaN)).toBe(DASH);
    expect(fmtInteger(Number.NEGATIVE_INFINITY)).toBe(DASH);
  });
});

describe('fmtRate', () => {
  it('formats the RFC example', () => {
    expect(fmtRate(1.2)).toBe('1.2/s');
  });

  it('gives an extra decimal below one, where early-game rates live', () => {
    expect(fmtRate(0.05)).toBe('0.05/s');
    expect(fmtRate(0.01)).toBe('0.01/s');
    expect(fmtRate(0.99)).toBe('0.99/s');
  });

  it('never prints a bare zero next to a filling bar', () => {
    expect(fmtRate(0.004)).toBe('<0.01/s');
    expect(fmtRate(5e-324)).toBe('<0.01/s');
    expect(fmtRate(-0.004)).toBe('-<0.01/s');
    expect(fmtRate(0)).toBe('0/s');
    expect(fmtRate(-0)).toBe('0/s');
  });

  it('hands off to compact form at ten and above', () => {
    expect(fmtRate(9.9)).toBe('9.9/s');
    expect(fmtRate(10)).toBe('10/s');
    expect(fmtRate(12_500)).toBe('12.5K/s');
    expect(fmtRate(-2.5)).toBe('-2.5/s');
  });

  it('takes any suffix, including none', () => {
    expect(fmtRate(2.5, '/min')).toBe('2.5/min');
    expect(fmtRate(2.5, '')).toBe('2.5');
    expect(fmtRate(0, ' per tick')).toBe('0 per tick');
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtRate(Number.NaN)).toBe(DASH);
    expect(fmtRate(Number.POSITIVE_INFINITY)).toBe(DASH);
  });
});

describe('fmtPercent', () => {
  it('takes a fraction, not a percentage', () => {
    expect(fmtPercent(0.075)).toBe('7.5%');
    expect(fmtPercent(0)).toBe('0.0%');
    expect(fmtPercent(1)).toBe('100.0%');
    expect(fmtPercent(-0.25)).toBe('-25.0%');
    expect(fmtPercent(2.5)).toBe('250.0%');
  });

  it('takes a decimals argument for a fixed width', () => {
    expect(fmtPercent(0.5, 0)).toBe('50%');
    expect(fmtPercent(0.12345, 3)).toBe('12.345%');
  });

  it('names the caller when decimals is out of range', () => {
    expect(() => fmtPercent(0.5, -1)).toThrow(
      'fmtPercent: expected decimals to be an integer in [0, 6], got -1',
    );
    expect(() => fmtPercent(0.5, 7)).toThrow(RangeError);
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtPercent(Number.NaN)).toBe(DASH);
    expect(fmtPercent(Number.POSITIVE_INFINITY)).toBe(DASH);
  });
});

describe('fmtDuration', () => {
  it('formats the RFC examples in both styles', () => {
    expect(fmtDuration(150)).toBe('2m 30s');
    expect(fmtDuration(150, 'clock')).toBe('02:30');
  });

  it('rounds before splitting, not after', () => {
    expect(fmtDuration(59.6)).toBe('1m 0s');
    expect(fmtDuration(59.4)).toBe('59s');
    expect(fmtDuration(59.6, 'clock')).toBe('01:00');
  });

  it('drops a trailing zero unit in short style', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(1)).toBe('1s');
    expect(fmtDuration(60)).toBe('1m 0s');
    expect(fmtDuration(3600)).toBe('1h');
    expect(fmtDuration(3661)).toBe('1h 1m');
    expect(fmtDuration(86_400)).toBe('1d');
    expect(fmtDuration(90_061)).toBe('1d 1h');
    expect(fmtDuration(172_800)).toBe('2d');
  });

  it('stays width-stable in clock style, and widens rather than truncating', () => {
    expect(fmtDuration(0, 'clock')).toBe('00:00');
    expect(fmtDuration(59, 'clock')).toBe('00:59');
    expect(fmtDuration(3661, 'clock')).toBe('01:01:01');
    expect(fmtDuration(359_999, 'clock')).toBe('99:59:59');
    expect(fmtDuration(360_000, 'clock')).toBe('100:00:00');
  });

  it('clamps a negative duration to zero', () => {
    expect(fmtDuration(-5)).toBe('0s');
    expect(fmtDuration(-5, 'clock')).toBe('00:00');
    expect(fmtDuration(-1e9)).toBe('0s');
  });

  it('returns an em dash for anything non-finite', () => {
    expect(fmtDuration(Number.NaN)).toBe(DASH);
    expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe(DASH);
    expect(fmtDuration(Number.NaN, 'clock')).toBe(DASH);
  });

  it('rejects a style it does not know rather than silently using the other one', () => {
    const bad = 'long' as unknown as 'short';
    expect(() => fmtDuration(150, bad)).toThrow(TypeError);
    expect(() => fmtDuration(150, bad)).toThrow(
      "fmtDuration: expected style 'short' or 'clock', got long",
    );
  });
});

describe('COMPACT_SUFFIXES', () => {
  it('is the ladder, starting with the empty suffix', () => {
    expect([...COMPACT_SUFFIXES]).toEqual(['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc']);
  });

  it('is frozen, so one consumer cannot renumber every number in the game', () => {
    expect(Object.isFrozen(COMPACT_SUFFIXES)).toBe(true);
    const mutable = COMPACT_SUFFIXES as string[];
    expect(() => {
      mutable[1] = 'k';
    }).toThrow(TypeError);
  });
});

describe('the module is locale-free by construction', () => {
  it('uses ASCII digits and an ASCII comma for every formatter', () => {
    const outputs = [
      fmtCompact(1_234_567.89),
      fmtSigned(1_234_567.89),
      fmtInteger(1_234_567),
      fmtRate(1234.5),
      fmtPercent(0.1234),
      fmtDuration(3661),
      fmtDuration(3661, 'clock'),
    ];
    for (const text of outputs) {
      expect(text).toMatch(/^[-+<0-9.,:%/A-Za-z ]+$/);
    }
  });
});
