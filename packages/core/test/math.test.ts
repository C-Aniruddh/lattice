/**
 * `math` — the exact forms, tested exactly.
 *
 * There is no `toBeCloseTo` anywhere in this file, on purpose. Core's Tier A promise is
 * *bit-identical*, and an approximate assertion cannot tell the difference between the
 * expensive `lerp` and the cheap one that misses `b` by an ulp — which is the entire bug the
 * expensive form exists to prevent. The only tolerances here are on `damp`, which is Tier B
 * and does not make the exactness promise, and they are written out so the number is visible.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TAU,
  EPSILON,
  approx,
  clamp,
  clamp01,
  damp,
  inverseLerp,
  lerp,
  mod,
  moveTowards,
  remap,
  smoothstep,
  wrap,
} from '../src/math.js';

/**
 * A deterministic generator for the fuzz cases below.
 *
 * `Math.random()` in a test buys coverage of a different hundred pairs every run and pays for
 * it with a failure nobody can reproduce. This is a plain LCG: the same hundred pairs, on
 * every machine, forever.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tier B comparison, spelled out. Used only where the value is not promised to the bit. */
function within(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`).toBe(true);
}

describe('constants', () => {
  it('TAU is a full turn, to the bit', () => {
    expect(TAU).toBe(6.283185307179586);
    expect(TAU).toBe(Math.PI * 2);
    expect(TAU / 2).toBe(Math.PI);
  });

  it('EPSILON is a game-space tolerance, not a property of the float format', () => {
    expect(EPSILON).toBe(1e-9);
    // The mistake this constant exists to prevent: Number.EPSILON is ~2.2e-16, so a settle
    // test written against it never settles.
    expect(EPSILON > Number.EPSILON).toBe(true);
  });
});

describe('clamp', () => {
  it('holds the bounds and passes the interior through unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('is inclusive at both exact boundaries', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('works with negative and inverted-magnitude ranges', () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-20, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });

  it('propagates NaN rather than snapping it to a bound', () => {
    // A clamp that turned NaN into `min` would hide the division that produced it until it
    // reached the screen.
    expect(Number.isNaN(clamp(NaN, 0, 1))).toBe(true);
  });

  it('handles infinities', () => {
    expect(clamp(Infinity, 0, 1)).toBe(1);
    expect(clamp(-Infinity, 0, 1)).toBe(0);
    expect(clamp(5, -Infinity, Infinity)).toBe(5);
  });
});

describe('clamp01', () => {
  it('is clamp(value, 0, 1)', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(Number.isNaN(clamp01(NaN))).toBe(true);
  });
});

describe('lerp', () => {
  it('lands on both endpoints exactly, for a hundred pairs many orders apart', () => {
    // Invariant 20. `a + (b - a) * t` fails this at t === 1 for most pairs; the failure is
    // one ulp, permanent, and shows up as text that looks slightly blurry.
    const rand = lcg(0x1a77);
    for (let i = 0; i < 100; i += 1) {
      const a = (rand() - 0.5) * 10 ** (rand() * 24 - 12);
      const b = (rand() - 0.5) * 10 ** (rand() * 24 - 12);
      expect(lerp(a, b, 0)).toBe(a);
      expect(lerp(a, b, 1)).toBe(b);
    }
  });

  it('lands on the endpoints for the pathological pairs too', () => {
    const pairs: readonly (readonly [number, number])[] = [
      [0, 1],
      [-1, 1],
      [1e-300, 1e300],
      [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      [0.1, 0.2],
      [1e16, 1],
    ];
    for (const [a, b] of pairs) {
      expect(lerp(a, b, 0)).toBe(a);
      expect(lerp(a, b, 1)).toBe(b);
    }
  });

  it('normalizes a negative-zero endpoint to +0, which is what survives a round trip', () => {
    // `JSON.stringify(-0)` is `"0"`, so a -0 that came back as -0 would fail an integrity
    // comparison after a save. The multiply form gives +0 here, and that is the better answer.
    expect(Object.is(lerp(-0, 5, 0), 0)).toBe(true);
  });

  it('interpolates the midpoint and extrapolates outside [0, 1]', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });

  it('is not the cheap form', () => {
    // The case that separates them: `a + (b - a) * t` at t === 1 across a wide magnitude gap,
    // which is exactly a camera at world scale tweening to a small local offset.
    const a = 1e16;
    const b = 1;
    expect(lerp(a, b, 1)).toBe(b);
    expect(a + (b - a) * 1).toBe(0);
  });
});

describe('inverseLerp', () => {
  it('reports the fraction, unclamped', () => {
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
    expect(inverseLerp(0, 10, 0)).toBe(0);
    expect(inverseLerp(0, 10, 10)).toBe(1);
    expect(inverseLerp(0, 10, 20)).toBe(2);
    expect(inverseLerp(0, 10, -10)).toBe(-1);
  });

  it('returns 0 rather than NaN for a zero-width range', () => {
    // A progress bar with no range is a display with nothing to show, not an arithmetic fault
    // — and a NaN here would propagate through the whole layout before anyone saw it.
    expect(inverseLerp(3, 3, 3)).toBe(0);
    expect(inverseLerp(3, 3, 99)).toBe(0);
  });

  it('handles a descending range', () => {
    expect(inverseLerp(10, 0, 2.5)).toBe(0.75);
  });

  it('round-trips with lerp', () => {
    expect(lerp(20, 60, inverseLerp(20, 60, 35))).toBe(35);
  });
});

describe('remap', () => {
  it('moves a value between ranges, unclamped', () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(-1, -1, 1, 0, 1)).toBe(0);
    expect(remap(1, -1, 1, 0, 1)).toBe(1);
    expect(remap(20, 0, 10, 0, 100)).toBe(200);
  });

  it('inverts when the output range descends', () => {
    expect(remap(0.25, 0, 1, 10, 0)).toBe(7.5);
  });

  it('yields outMin for a zero-width input range', () => {
    expect(remap(42, 5, 5, 7, 9)).toBe(7);
  });
});

describe('smoothstep', () => {
  it('clamps outside the edges and is exact at them', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('is 0.5 at the midpoint and symmetric about it', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      // Symmetry is a property of the polynomial, not a promise of the arithmetic: `1 - t`
      // rounds, so the sum can miss by an ulp. Bounded rather than asserted exactly.
      within(smoothstep(0, 1, t) + smoothstep(0, 1, 1 - t), 1, 1e-15);
    }
  });

  it('has a zero derivative at both ends — the reason it exists', () => {
    // The visible seam a linear fade leaves is a discontinuity in the slope, not the value.
    const h = 1e-6;
    within((smoothstep(0, 1, h) - smoothstep(0, 1, 0)) / h, 0, 1e-5);
    within((smoothstep(0, 1, 1) - smoothstep(0, 1, 1 - h)) / h, 0, 1e-5);
  });

  it('works over an arbitrary edge pair, including a descending one', () => {
    expect(smoothstep(10, 20, 15)).toBe(0.5);
    expect(smoothstep(20, 10, 15)).toBe(0.5);
    expect(smoothstep(20, 10, 20)).toBe(0);
  });

  it('returns 0 for equal edges rather than NaN', () => {
    expect(smoothstep(5, 5, 5)).toBe(0);
  });
});

describe('mod', () => {
  it('gives 7 for mod(-1, 8) — the whole reason it exists', () => {
    expect(mod(-1, 8)).toBe(7);
    expect(-1 % 8).toBe(-1);
  });

  it('carries the sign of the divisor and stays in [0, d) for every v in [-1000, 1000]', () => {
    // Invariant 21.
    for (let v = -1000; v <= 1000; v += 1) {
      const r = mod(v, 8);
      expect(r >= 0 && r < 8, `mod(${v}, 8) = ${r}`).toBe(true);
      expect(Number.isInteger(r)).toBe(true);
    }
  });

  it('carries the sign of a negative divisor', () => {
    expect(mod(1, -8)).toBe(-7);
    expect(mod(-1, -8)).toBe(-1);
    expect(mod(9, -8)).toBe(-7);
  });

  it('handles zero, exact multiples and fractions', () => {
    expect(mod(0, 8)).toBe(0);
    expect(mod(8, 8)).toBe(0);
    expect(mod(-8, 8)).toBe(0);
    expect(mod(-0.25, 1)).toBe(0.75);
  });

  it('never returns a negative zero, which would compare equal but serialize differently', () => {
    expect(Object.is(mod(-8, 8), 0)).toBe(true);
    expect(Object.is(mod(-0, 8), 0)).toBe(true);
  });

  it('is NaN for a zero divisor, as the operator is', () => {
    expect(Number.isNaN(mod(5, 0))).toBe(true);
  });
});

describe('wrap', () => {
  it('wraps into a half-open range', () => {
    expect(wrap(9, 0, 8)).toBe(1);
    expect(wrap(-1, 0, 8)).toBe(7);
    expect(wrap(0, 0, 8)).toBe(0);
    expect(wrap(8, 0, 8)).toBe(0);
  });

  it('maps the upper edge back onto the lower one, so a heading has one representation', () => {
    expect(wrap(TAU, 0, TAU)).toBe(0);
    expect(wrap(-TAU, 0, TAU)).toBe(0);
  });

  it('handles a range that does not start at zero, including a negative one', () => {
    expect(wrap(190, -180, 180)).toBe(-170);
    expect(wrap(-190, -180, 180)).toBe(170);
    expect(wrap(0, -180, 180)).toBe(0);
    expect(wrap(180, -180, 180)).toBe(-180);
  });

  it('is idempotent on an already-wrapped value', () => {
    for (let v = -100; v < 100; v += 7) {
      const once = wrap(v, 0, 8);
      expect(wrap(once, 0, 8)).toBe(once);
    }
  });
});

describe('moveTowards', () => {
  it('arrives exactly and then stays', () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(9, 10, 3)).toBe(10);
    expect(moveTowards(10, 10, 3)).toBe(10);
  });

  it('never overshoots, in either direction', () => {
    expect(moveTowards(0, 1, 100)).toBe(1);
    expect(moveTowards(0, -1, 100)).toBe(-1);
    expect(moveTowards(10, 0, 3)).toBe(7);
  });

  it('is exact at the boundary where the step equals the gap', () => {
    expect(moveTowards(0, 3, 3)).toBe(3);
    expect(moveTowards(0, -3, 3)).toBe(-3);
  });

  it('holds position for a zero step', () => {
    expect(moveTowards(2, 10, 0)).toBe(2);
    expect(moveTowards(10, 10, 0)).toBe(10);
  });

  it('holds position for a negative step rather than moving away from the target', () => {
    // A negative distance is a sign error at the call site; turning it into motion is how it
    // stays hidden.
    expect(moveTowards(2, 10, -5)).toBe(2);
    expect(moveTowards(10, 2, -5)).toBe(10);
  });

  it('converges in a finite number of steps and lands on the target to the bit', () => {
    let x = 0;
    for (let i = 0; i < 200; i += 1) x = moveTowards(x, 1, 0.01);
    expect(x).toBe(1);
  });
});

describe('damp (Tier B)', () => {
  it('is frame-rate independent: 30Hz and 240Hz land within 1e-6 after a second', () => {
    // Invariant 23. The naive `x += (t - x) * k` misses by roughly a factor of two here.
    let slow = 0;
    for (let i = 0; i < 30; i += 1) slow = damp(slow, 1, 3, 1 / 30);
    let fast = 0;
    for (let i = 0; i < 240; i += 1) fast = damp(fast, 1, 3, 1 / 240);
    within(slow, fast, 1e-6);

    let naiveSlow = 0;
    for (let i = 0; i < 30; i += 1) naiveSlow += (1 - naiveSlow) * 0.1;
    let naiveFast = 0;
    for (let i = 0; i < 240; i += 1) naiveFast += (1 - naiveFast) * 0.1;
    expect(Math.abs(naiveSlow - naiveFast) > 0.01).toBe(true);
  });

  it('does not move on a zero step', () => {
    expect(damp(3, 5, 10, 0)).toBe(3);
  });

  it('does not move at a zero rate', () => {
    expect(damp(3, 5, 0, 1)).toBe(3);
  });

  it('falls by a factor of e per second at lambda 1', () => {
    within(damp(0, 1, 1, 1), 1 - 1 / Math.E, 1e-12);
  });

  it('approaches but never crosses the target', () => {
    let x = 0;
    for (let i = 0; i < 1000; i += 1) {
      x = damp(x, 1, 5, 1 / 60);
      expect(x <= 1).toBe(true);
    }
    within(x, 1, 1e-9);
  });

  it('works downward and from a negative start', () => {
    const down = damp(10, 0, 2, 0.5);
    expect(down < 10 && down > 0).toBe(true);
    const up = damp(-10, 0, 2, 0.5);
    expect(up > -10 && up < 0).toBe(true);
  });

  it('saturates to the target for a huge dt rather than overshooting', () => {
    expect(damp(0, 1, 10, 1e6)).toBe(1);
  });
});

describe('approx', () => {
  it('is inclusive at the exact boundary', () => {
    // A difference of exactly epsilon passes; the next representable step does not. Both
    // differences here are exact in binary, so this tests the comparison and not the rounding.
    expect(approx(1, 1.5, 0.5)).toBe(true);
    expect(approx(1, 1.5, 0.25)).toBe(false);
    expect(approx(0, EPSILON, EPSILON)).toBe(true);
    expect(approx(0, 1e-9)).toBe(true);
    expect(approx(0, 1.0000001e-9)).toBe(false);
  });

  it('is symmetric and handles negatives', () => {
    expect(approx(-1, -1 - 1e-12)).toBe(true);
    expect(approx(-1 - 1e-12, -1)).toBe(true);
    expect(approx(-1, 1)).toBe(false);
  });

  it('takes a custom epsilon', () => {
    expect(approx(1, 1.4, 0.5)).toBe(true);
    expect(approx(1, 1.6, 0.5)).toBe(false);
  });

  it('is false for NaN against anything, including itself', () => {
    expect(approx(NaN, NaN)).toBe(false);
    expect(approx(NaN, 0)).toBe(false);
    expect(approx(0, NaN)).toBe(false);
  });

  it('is useless at large magnitudes, and says so by failing', () => {
    // Absolute tolerance, deliberately: a caller comparing values around 1e12 must supply an
    // epsilon that means something there. This test documents that it is not relative.
    expect(approx(1e12, 1e12 + 1)).toBe(false);
    expect(approx(1e12, 1e12 + 1, 2)).toBe(true);
  });

  it('treats zero and negative zero as equal', () => {
    expect(approx(0, -0)).toBe(true);
  });
});

describe('the module allocates nothing', () => {
  it('contains no object, array or closure literal outside its constants', () => {
    // Invariant 25, as a source check rather than a heap measurement: `heapUsed` without a
    // forced GC is noise, and this catches the mistake at the moment it is written.
    const source = readFileSync(
      fileURLToPath(new URL('../src/math.ts', import.meta.url)),
      'utf8',
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code.includes('=>')).toBe(false);
    expect(/return\s*[{[]/.test(code)).toBe(false);
    expect(/=\s*[{[]/.test(code)).toBe(false);
  });
});
