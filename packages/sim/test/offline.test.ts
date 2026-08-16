import { describe, expect, it } from 'vitest';

import {
  maxOfflineCredit,
  offlineCredit,
  offlineCreditRate,
  offlineElapsed,
} from '../src/offline.js';
import type { OfflineCurve } from '../src/offline.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

const HOUR = 3600;

/** The source game's shipping numbers: 3 h uncapped, exponent 0.6, flat after 24 h. */
const SHIPPED: OfflineCurve = {
  uncappedSeconds: 3 * HOUR,
  exponent: 0.6,
  flatAfterSeconds: 24 * HOUR,
};

/** The same curve with the demo's dyadic exponent, which buys Tier A for three per cent of reward. */
const DYADIC: OfflineCurve = { ...SHIPPED, exponent: 0.625 };

/**
 * Two ulps of `reference`.
 *
 * `ulp(x) = 2^(e−52)` where `2^e ≤ |x| < 2^(e+1)`, so `ulp(x) ≤ EPSILON·|x|` and two of them are
 * at most `2·EPSILON·|x|`. Nothing here is allowed a looser bound than that.
 */
function twoUlps(reference: number): number {
  return 2 * Number.EPSILON * Math.abs(reference);
}

describe('offlineCredit — the shape of the curve (I15)', () => {
  it('is the identity below the knot, and exactly the identity at it', () => {
    expect(offlineCredit(0, SHIPPED)).toBe(0);
    expect(offlineCredit(1, SHIPPED)).toBe(1);
    expect(offlineCredit(SHIPPED.uncappedSeconds, SHIPPED)).toBe(SHIPPED.uncappedSeconds);
  });

  it('does not step at the knot — the first near-miss (T6)', () => {
    const knot = SHIPPED.uncappedSeconds;
    const justPast = offlineCredit(knot + 1, SHIPPED);
    // `W(T) = U + T^e` would jump by U^e ≈ 259 credited seconds here. Continuity to well under a
    // second is what rules that form out; the true difference is a shade under 0.6 s.
    expect(Math.abs(justPast - knot)).toBeLessThan(1e-6 + 1);
    expect(Math.abs(offlineCredit(knot + 1e-6, SHIPPED) - knot)).toBeLessThan(1e-6);
  });

  it('never pays faster than live, even in the first instants past the knot — the second near-miss (T6)', () => {
    // `W(T) = U + (T − U)^e` is continuous and has an *infinite* slope at U⁺, so closing the tab at
    // 2h59m would be optimal play. Here every increment past the knot is worth at most itself.
    const knot = SHIPPED.uncappedSeconds;
    for (const delta of [1e-6, 1e-3, 1, 60, 600]) {
      const gained = offlineCredit(knot + delta, SHIPPED) - offlineCredit(knot, SHIPPED);
      expect(gained).toBeLessThanOrEqual(delta);
      expect(gained).toBeGreaterThan(0);
    }
  });

  it('is non-decreasing and never generous, across four decades of absence', () => {
    let previous = 0;
    for (let seconds = 0; seconds <= 72 * HOUR; seconds += 137) {
      const credited = offlineCredit(seconds, SHIPPED);
      expect(credited).toBeGreaterThanOrEqual(previous);
      expect(credited).toBeLessThanOrEqual(seconds);
      previous = credited;
    }
  });

  it('is flat past the horizon, to the bit — 48 h and a year return what 24 h returns', () => {
    const atHorizon = offlineCredit(SHIPPED.flatAfterSeconds, SHIPPED);
    expect(offlineCredit(48 * HOUR, SHIPPED)).toBe(atHorizon);
    expect(offlineCredit(72 * HOUR, SHIPPED)).toBe(atHorizon);
    // A device clock a year fast (I19). Coming back later must never pay more.
    expect(offlineCredit(365 * 24 * HOUR, SHIPPED)).toBe(atHorizon);
    expect(maxOfflineCredit(SHIPPED)).toBe(atHorizon);
  });

  it('is the upper clamp on the gap: a year credits hours, not a year', () => {
    const yearly = offlineCredit(365 * 24 * HOUR, SHIPPED);
    expect(yearly / HOUR).toBeGreaterThan(10);
    expect(yearly / HOUR).toBeLessThan(11);
  });

  it('credits nothing for a backwards or zero gap', () => {
    expect(offlineCredit(-1, SHIPPED)).toBe(0);
    expect(offlineCredit(-1e12, SHIPPED)).toBe(0);
  });

  it('takes the real haircut the mechanic is for: eight hours of sleep is worth about five', () => {
    const credited = offlineCredit(8 * HOUR, SHIPPED) / HOUR;
    expect(credited).toBeGreaterThan(5.3);
    expect(credited).toBeLessThan(5.5);
  });

  it('clamps at the elapsed time even when the exponent is 1 and rounding would overshoot', () => {
    // At e = 1 the softcap is off, and `U·(T/U)` rounds *above* T for most T — 3·(10/3) is
    // 10.000000000000002. The clamp is what keeps `W(T) ≤ T` true to the bit rather than to within
    // a rounding error, and `Math.min` is exactly specified so it costs nothing in tier.
    const flat: OfflineCurve = { uncappedSeconds: 7, exponent: 1, flatAfterSeconds: 1e6 };
    expect(7 * (29 / 7)).toBeGreaterThan(29);
    expect(offlineCredit(29, flat)).toBe(29);
  });
});

describe('offlineCredit — determinism (I17)', () => {
  it('is exactly a single sqrt at exponent 0.5', () => {
    const curve: OfflineCurve = { ...SHIPPED, exponent: 0.5 };
    for (const seconds of [4 * HOUR, 7.5 * HOUR, 23 * HOUR]) {
      const x = seconds / curve.uncappedSeconds;
      expect(offlineCredit(seconds, curve)).toBe(curve.uncappedSeconds * Math.sqrt(x));
    }
  });

  it('is exactly the sqrt chain at exponent 0.75', () => {
    const curve: OfflineCurve = { ...SHIPPED, exponent: 0.75 };
    for (const seconds of [4 * HOUR, 7.5 * HOUR, 23 * HOUR]) {
      const x = seconds / curve.uncappedSeconds;
      // 0.75 = 2⁻¹ + 2⁻², so the chain is sqrt(x) · sqrt(sqrt(x)), multiplied in that order.
      expect(offlineCredit(seconds, curve)).toBe(
        curve.uncappedSeconds * (Math.sqrt(x) * Math.sqrt(Math.sqrt(x))),
      );
    }
  });

  it('is exactly the sqrt chain at exponent 0.625 — the demo`s choice', () => {
    for (const seconds of [4 * HOUR, 7.5 * HOUR, 23 * HOUR]) {
      const x = seconds / DYADIC.uncappedSeconds;
      // 0.625 = 2⁻¹ + 2⁻³, so the chain is sqrt(x) · x^(1/8), and x^(1/8) is three nested sqrts.
      expect(offlineCredit(seconds, DYADIC)).toBe(
        DYADIC.uncappedSeconds * (Math.sqrt(x) * Math.sqrt(Math.sqrt(Math.sqrt(x)))),
      );
    }
  });

  it('agrees with `pow` to within two ulps for any exponent, dyadic or not', () => {
    for (const exponent of [0.3, 0.5, 0.6, 0.625, 0.75, 0.9, 1]) {
      const curve: OfflineCurve = { ...SHIPPED, exponent };
      for (const seconds of [4 * HOUR, 10 * HOUR, 23 * HOUR]) {
        const reference = curve.uncappedSeconds * (seconds / curve.uncappedSeconds) ** exponent;
        expect(Math.abs(offlineCredit(seconds, curve) - Math.min(seconds, reference))).toBeLessThanOrEqual(
          twoUlps(reference),
        );
      }
    }
  });

  it('costs three per cent of reward to move from 0.6 to 0.625, and buys a determinism tier', () => {
    const shipped = offlineCredit(8 * HOUR, SHIPPED);
    const dyadic = offlineCredit(8 * HOUR, DYADIC);
    expect(dyadic).toBeGreaterThan(shipped);
    expect((dyadic - shipped) / shipped).toBeLessThan(0.05);
  });
});

describe('offlineCredit — the curve arrives as data, so it is checked as data', () => {
  it('names a non-finite elapsed time', () => {
    for (const bad of [Number.NaN, Infinity]) {
      expect(messageOf(() => offlineCredit(bad, SHIPPED))).toContain(
        'sim.offlineCredit: elapsedSeconds',
      );
    }
  });

  it('names a non-positive uncapped window', () => {
    for (const uncappedSeconds of [0, -1]) {
      expect(messageOf(() => offlineCredit(1, { ...SHIPPED, uncappedSeconds }))).toContain(
        'curve.uncappedSeconds must be > 0',
      );
    }
    expect(messageOf(() => offlineCredit(1, { ...SHIPPED, uncappedSeconds: Number.NaN }))).toContain(
      'curve.uncappedSeconds',
    );
  });

  it('names an exponent that pays a bonus for leaving', () => {
    for (const exponent of [0, -0.5, 1.1, 2]) {
      expect(messageOf(() => offlineCredit(1, { ...SHIPPED, exponent }))).toContain(
        'curve.exponent must be in (0, 1]',
      );
    }
    expect(messageOf(() => offlineCredit(1, { ...SHIPPED, exponent: Number.NaN }))).toContain(
      'curve.exponent',
    );
  });

  it('names a horizon that cuts into the uncapped region', () => {
    expect(
      messageOf(() => offlineCredit(1, { ...SHIPPED, flatAfterSeconds: SHIPPED.uncappedSeconds - 1 })),
    ).toContain('must be >= curve.uncappedSeconds');
  });

  it('refuses an infinite horizon, which is no ceiling at all (T23)', () => {
    expect(messageOf(() => offlineCredit(1, { ...SHIPPED, flatAfterSeconds: Infinity }))).toContain(
      'curve.flatAfterSeconds',
    );
  });
});

describe('offlineElapsed — the map back to the calendar', () => {
  it('inverts the credit to within a relative 1e-9 across the whole curve (I15)', () => {
    for (const curve of [SHIPPED, DYADIC]) {
      for (let seconds = 0; seconds <= curve.flatAfterSeconds; seconds += 613) {
        const round = offlineElapsed(offlineCredit(seconds, curve), curve);
        // Two `pow`s in opposite directions, each correct to about an ulp, over values up to 86400.
        // A relative 1e-9 is seven orders of magnitude looser than that and four orders tighter
        // than any real error in the formula.
        expect(Math.abs(round - seconds) / Math.max(seconds, 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('is exactly the identity below the knot', () => {
    expect(offlineElapsed(0, SHIPPED)).toBe(0);
    expect(offlineElapsed(-5, SHIPPED)).toBe(0);
    expect(offlineElapsed(1234, SHIPPED)).toBe(1234);
    expect(offlineElapsed(SHIPPED.uncappedSeconds, SHIPPED)).toBe(SHIPPED.uncappedSeconds);
  });

  it('reports Infinity for a credit no amount of real time reaches — which is what flat means', () => {
    expect(offlineElapsed(maxOfflineCredit(SHIPPED) * 1.0001, SHIPPED)).toBe(Infinity);
    expect(offlineElapsed(1e9, SHIPPED)).toBe(Infinity);
  });

  it('never reports a real time past the horizon', () => {
    expect(offlineElapsed(maxOfflineCredit(SHIPPED), SHIPPED)).toBeLessThanOrEqual(
      SHIPPED.flatAfterSeconds,
    );
  });

  it('is Tier A at exponent 0.5, where the inverse exponent is a whole 2', () => {
    const curve: OfflineCurve = { ...SHIPPED, exponent: 0.5 };
    const credit = offlineCredit(9 * HOUR, curve);
    const x = credit / curve.uncappedSeconds;
    expect(offlineElapsed(credit, curve)).toBe(Math.min(curve.uncappedSeconds * (x * x), curve.flatAfterSeconds));
  });

  it('names a non-finite credit and a degenerate curve', () => {
    expect(messageOf(() => offlineElapsed(Number.NaN, SHIPPED))).toContain(
      'sim.offlineElapsed: creditedSeconds',
    );
    expect(messageOf(() => offlineElapsed(1, { ...SHIPPED, exponent: 3 }))).toContain('curve.exponent');
  });
});

describe('offlineCreditRate — what the next second is worth', () => {
  it('is 1 while uncapped and steps down to the exponent at the knot', () => {
    expect(offlineCreditRate(0, SHIPPED)).toBe(1);
    expect(offlineCreditRate(SHIPPED.uncappedSeconds - 1, SHIPPED)).toBe(1);
    // The right derivative: what the *next* second pays. `W` is continuous here and `w` is not.
    expect(offlineCreditRate(SHIPPED.uncappedSeconds, SHIPPED)).toBe(SHIPPED.exponent);
  });

  it('decays monotonically to the horizon and is exactly zero from there on', () => {
    let previous = offlineCreditRate(SHIPPED.uncappedSeconds, SHIPPED);
    for (let seconds = SHIPPED.uncappedSeconds; seconds < SHIPPED.flatAfterSeconds; seconds += 601) {
      const rate = offlineCreditRate(seconds, SHIPPED);
      expect(rate).toBeLessThanOrEqual(previous);
      previous = rate;
    }
    expect(offlineCreditRate(SHIPPED.flatAfterSeconds, SHIPPED)).toBe(0);
    expect(offlineCreditRate(SHIPPED.flatAfterSeconds + 1, SHIPPED)).toBe(0);
    expect(offlineCreditRate(1e12, SHIPPED)).toBe(0);
  });

  it('matches the derivative of the credit it belongs to', () => {
    const at = 6 * HOUR;
    const delta = 1e-4;
    const numeric = (offlineCredit(at + delta, SHIPPED) - offlineCredit(at, SHIPPED)) / delta;
    // A forward difference of a smooth function is accurate to O(delta·W''), and W'' here is about
    // 1e-8, so 1e-6 is two orders of margin.
    expect(Math.abs(offlineCreditRate(at, SHIPPED) - numeric)).toBeLessThan(1e-6);
  });

  it('is 1 everywhere below the horizon when the exponent is 1', () => {
    const flat: OfflineCurve = { uncappedSeconds: 10, exponent: 1, flatAfterSeconds: 1000 };
    expect(offlineCreditRate(500, flat)).toBe(1);
  });

  it('names a non-finite elapsed time and a degenerate curve', () => {
    expect(messageOf(() => offlineCreditRate(Infinity, SHIPPED))).toContain(
      'sim.offlineCreditRate: elapsedSeconds',
    );
    expect(messageOf(() => offlineCreditRate(1, { ...SHIPPED, uncappedSeconds: 0 }))).toContain(
      'curve.uncappedSeconds',
    );
  });
});

describe('maxOfflineCredit', () => {
  it('is derived from the curve rather than restated', () => {
    expect(maxOfflineCredit(SHIPPED)).toBe(offlineCredit(SHIPPED.flatAfterSeconds, SHIPPED));
    expect(maxOfflineCredit(DYADIC) / HOUR).toBeGreaterThan(maxOfflineCredit(SHIPPED) / HOUR);
  });

  it('validates the curve it is asked about', () => {
    expect(messageOf(() => maxOfflineCredit({ ...SHIPPED, exponent: 0 }))).toContain('curve.exponent');
  });
});
