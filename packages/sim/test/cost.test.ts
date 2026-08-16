import { describe, expect, it } from 'vitest';

import { bulkCost, costOfNext, maxBuyable, milestoneMultiplier } from '../src/cost.js';
import type { CostCurve, Milestones } from '../src/cost.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/** The source game's shipping curve. */
const CURVE: CostCurve = { base: 10, growth: 1.07 };

/**
 * The oracle: the loop the closed form exists to replace.
 *
 * A naive buy-loop is a legitimate oracle **in a test** and a performance bug in a build. It is the
 * strongest check available here, because it is the definition of the thing rather than a second
 * derivation of it.
 */
function naiveBulkCost(curve: CostCurve, owned: number, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i += 1) total += curve.base * curve.growth ** (owned + i);
  return total;
}

/** The other oracle: buy one at a time until the wallet cannot pay for the next one. */
function naiveMaxBuyable(curve: CostCurve, owned: number, budget: number, cap: number): number {
  let spent = 0;
  let bought = 0;
  while (bought < cap) {
    const price = curve.base * curve.growth ** (owned + bought);
    if (spent + price > budget) break;
    spent += price;
    bought += 1;
  }
  return bought;
}

describe('costOfNext', () => {
  it('is `base · growth^owned`', () => {
    expect(costOfNext(CURVE, 0)).toBe(10);
    // Exponentiation by squaring against the oracle's repeated `**`: both are correct to a few
    // ulps of 10·1.07²⁰ ≈ 38.7, so 1e-12 relative is six orders of margin.
    for (const owned of [1, 2, 7, 20, 100, 519]) {
      const reference = CURVE.base * CURVE.growth ** owned;
      expect(Math.abs(costOfNext(CURVE, owned) - reference) / reference).toBeLessThan(1e-12);
    }
  });

  it('is Tier A: a chain of multiplications, identical on every engine', () => {
    // The property a test can actually pin: the answer is exactly what the squaring chain gives,
    // so two engines that agree on `*` agree on the price. 1.07⁸ is (((1.07²)²)²).
    const r2 = 1.07 * 1.07;
    const r4 = r2 * r2;
    const r8 = r4 * r4;
    expect(costOfNext({ base: 1, growth: 1.07 }, 8)).toBe(1 * r8);
  });

  it('saturates rather than wrapping (I23)', () => {
    // At growth 1.07 the price crosses 2⁵³ at about 520 owned and reaches Infinity at about 10,500.
    expect(costOfNext(CURVE, 520)).toBeGreaterThan(2 ** 53);
    expect(costOfNext(CURVE, 20_000)).toBe(Infinity);
    expect(costOfNext(CURVE, 20_000)).toBeGreaterThan(0);
  });

  it('names a count that is not a non-negative integer, and a curve that is not a curve', () => {
    expect(messageOf(() => costOfNext(CURVE, 1.5))).toContain('sim.costOfNext: owned');
    expect(messageOf(() => costOfNext(CURVE, -1))).toContain('expected a non-negative count');
    expect(messageOf(() => costOfNext({ base: Number.NaN, growth: 1.07 }, 1))).toContain('curve.base');
    expect(messageOf(() => costOfNext({ base: -1, growth: 1.07 }, 1))).toContain('curve.base must be >= 0');
    expect(messageOf(() => costOfNext({ base: 10, growth: 0 }, 1))).toContain('curve.growth must be > 0');
    expect(messageOf(() => costOfNext({ base: 10, growth: Infinity }, 1))).toContain('curve.growth');
  });
});

describe('bulkCost — against the naive oracle (I14)', () => {
  it('matches the loop to 1e-9 relative for every count up to 200, at four owned counts', () => {
    for (const owned of [0, 1, 37, 400]) {
      for (let count = 1; count <= 200; count += 1) {
        const closed = bulkCost(CURVE, owned, count);
        const naive = naiveBulkCost(CURVE, owned, count);
        // The oracle sums `count` terms, each correct to an ulp, so its own error is ~count·2⁻⁵²
        // relative — 4e-14 at count 200. 1e-9 is four orders looser than that and four orders
        // tighter than any structural mistake in the geometric sum.
        expect(Math.abs(closed - naive) / naive).toBeLessThan(1e-9);
      }
    }
  });

  it('matches the oracle across a sweep of growth rates, including ones below 1', () => {
    for (const growth of [1.01, 1.07, 1.15, 2, 0.5, 0.99]) {
      const curve: CostCurve = { base: 7, growth };
      for (const count of [1, 5, 40, 120]) {
        const closed = bulkCost(curve, 3, count);
        const naive = naiveBulkCost(curve, 3, count);
        expect(Math.abs(closed - naive) / naive).toBeLessThan(1e-9);
      }
    }
  });

  it('handles the removable singularity at growth 1', () => {
    expect(bulkCost({ base: 10, growth: 1 }, 5, 7)).toBe(70);
  });

  it('is zero for a non-positive count and for a free curve', () => {
    expect(bulkCost(CURVE, 5, 0)).toBe(0);
    expect(bulkCost(CURVE, 5, -3)).toBe(0);
    // `0 · Infinity` is NaN, and a NaN price compares false against every budget — the purchase
    // would be silently refused instead of being free.
    expect(bulkCost({ base: 0, growth: 1.07 }, 5, 10)).toBe(0);
  });

  it('returns Infinity on overflow, which refuses the purchase rather than making it free (I23)', () => {
    const overflowing = bulkCost(CURVE, 20_000, 10);
    expect(overflowing).toBe(Infinity);
    expect(overflowing > 1e308).toBe(true);
    expect(overflowing < 0).toBe(false);
  });

  it('names a non-integer count', () => {
    expect(messageOf(() => bulkCost(CURVE, 0, 2.5))).toContain('sim.bulkCost: count');
    expect(messageOf(() => bulkCost(CURVE, -1, 2))).toContain('sim.bulkCost: owned');
    expect(messageOf(() => bulkCost({ base: 1, growth: -1 }, 0, 2))).toContain('curve.growth');
  });
});

describe('maxBuyable — the two-sided guarantee (I13)', () => {
  it('never overshoots and never undershoots, swept across every exact boundary', () => {
    for (const owned of [0, 13, 250]) {
      for (let m = 0; m <= 200; m += 1) {
        // Sit the budget exactly on the price of `m`, and then a hair either side of it.
        const exact = bulkCost(CURVE, owned, m);
        for (const budget of [exact, exact * (1 - 1e-12), exact * (1 + 1e-12)]) {
          const n = maxBuyable(CURVE, owned, budget, 1_000_000);
          expect(bulkCost(CURVE, owned, n)).toBeLessThanOrEqual(budget);
          expect(bulkCost(CURVE, owned, n + 1)).toBeGreaterThan(budget);
        }
      }
    }
  });

  it('agrees with the naive buy-loop across a wide sweep of budgets', () => {
    for (const owned of [0, 9, 120]) {
      for (const budget of [1, 9.99, 10, 10.01, 137, 5_000, 1e6, 1e12]) {
        expect(maxBuyable(CURVE, owned, budget, 500)).toBe(
          naiveMaxBuyable(CURVE, owned, budget, 500),
        );
      }
    }
  });

  it('is a closed form, not a loop: 4,000 owned costs what 4 owned costs (T1)', () => {
    // If this were a buy-loop, "buy max" here would be four thousand `pow` calls to render a
    // label. The assertion a test can make is that the answer is right at a count no loop would
    // reach in a frame budget.
    const n = maxBuyable(CURVE, 4_000, 1e200, 1_000_000);
    expect(n).toBeGreaterThan(0);
    expect(bulkCost(CURVE, 4_000, n)).toBeLessThanOrEqual(1e200);
    expect(bulkCost(CURVE, 4_000, n + 1)).toBeGreaterThan(1e200);
  });

  it('treats an empty wallet as a normal state rather than an error', () => {
    expect(maxBuyable(CURVE, 0, 0, 100)).toBe(0);
    expect(maxBuyable(CURVE, 0, -50, 100)).toBe(0);
    expect(maxBuyable(CURVE, 0, Number.NaN, 100)).toBe(0);
    expect(maxBuyable(CURVE, 0, 9.99, 100)).toBe(0);
  });

  it('clamps to the cap, and a cap below one buys nothing', () => {
    expect(maxBuyable(CURVE, 0, 1e12, 7)).toBe(7);
    expect(maxBuyable(CURVE, 0, 1e12, 0)).toBe(0);
    expect(maxBuyable(CURVE, 0, Infinity, 42)).toBe(42);
  });

  it('caps rather than diverging on a shrinking curve whose whole series is affordable', () => {
    // With growth < 1 the infinite series converges, so the logarithm's argument goes non-positive
    // and says "all of them" as a NaN or an infinity rather than as a number.
    const shrinking: CostCurve = { base: 10, growth: 0.5 };
    expect(maxBuyable(shrinking, 0, 1e6, 30)).toBe(30);
    expect(maxBuyable(shrinking, 0, 15, 30)).toBe(naiveMaxBuyable(shrinking, 0, 15, 30));
  });

  it('handles growth exactly 1, where the answer is a division', () => {
    const flat: CostCurve = { base: 10, growth: 1 };
    expect(maxBuyable(flat, 0, 95, 100)).toBe(9);
    expect(maxBuyable(flat, 0, 100, 100)).toBe(10);
  });

  it('gives the cap for a free curve rather than dividing by zero', () => {
    expect(maxBuyable({ base: 0, growth: 1.07 }, 3, 1, 500)).toBe(500);
  });

  it('returns zero when even the first unit has overflowed to Infinity', () => {
    expect(maxBuyable(CURVE, 20_000, 1e308, 500)).toBe(0);
  });

  it('names a bad owned count or cap', () => {
    expect(messageOf(() => maxBuyable(CURVE, -1, 100, 10))).toContain('sim.maxBuyable: owned');
    expect(messageOf(() => maxBuyable(CURVE, 0, 100, 1.5))).toContain('sim.maxBuyable: cap');
    expect(messageOf(() => maxBuyable(CURVE, 0, 100, -1))).toContain('sim.maxBuyable: cap');
  });

  it('corrects downwards when the logarithm proposes one too many (T2)', () => {
    // A budget one ulp below the exact price of two units, at growth 1.15. `Math.log` proposes 2
    // and only 1 is affordable, so the Tier A correction walks it back. This is the direction that
    // matters: without it a `max` purchase would drive the balance negative.
    const curve: CostCurve = { base: 1, growth: 1.15 };
    const budget = 2.1499999999999995;
    expect(bulkCost(curve, 0, 2)).toBeGreaterThan(budget);
    expect(maxBuyable(curve, 0, budget, 100)).toBe(1);
    expect(naiveMaxBuyable(curve, 0, budget, 100)).toBe(1);
  });

  it('is all or nothing for a fixed batch, and only `max` resolves against the balance (T3)', () => {
    // A ×10 button with funds for six buys nothing, not six. That is a different transaction from
    // the one the player pressed, and the split lives in which function you call.
    const budgetForSix = bulkCost(CURVE, 0, 6);
    expect(bulkCost(CURVE, 0, 10)).toBeGreaterThan(budgetForSix);
    expect(maxBuyable(CURVE, 0, budgetForSix, 10)).toBe(6);
  });
});

describe('milestoneMultiplier', () => {
  const MILESTONES: Milestones = { thresholds: [10, 20, 35, 50], multiplier: 2 };

  it('multiplies once per threshold reached', () => {
    expect(milestoneMultiplier(0, MILESTONES)).toBe(1);
    expect(milestoneMultiplier(9, MILESTONES)).toBe(1);
    expect(milestoneMultiplier(10, MILESTONES)).toBe(2);
    expect(milestoneMultiplier(19, MILESTONES)).toBe(2);
    expect(milestoneMultiplier(20, MILESTONES)).toBe(4);
    expect(milestoneMultiplier(50, MILESTONES)).toBe(16);
    expect(milestoneMultiplier(1e6, MILESTONES)).toBe(16);
  });

  it('is exactly repeated multiplication, so it is Tier A', () => {
    const odd: Milestones = { thresholds: [1, 2, 3], multiplier: 1.1 };
    expect(milestoneMultiplier(3, odd)).toBe(1.1 * 1.1 * 1.1);
  });

  it('handles an empty threshold list and a negative owned count', () => {
    expect(milestoneMultiplier(100, { thresholds: [], multiplier: 2 })).toBe(1);
    expect(milestoneMultiplier(-5, MILESTONES)).toBe(1);
  });

  it('counts a duplicated threshold twice, which is how you spell ×4 at ten', () => {
    expect(milestoneMultiplier(10, { thresholds: [10, 10], multiplier: 2 })).toBe(4);
  });

  it('names a non-finite owned count, multiplier or threshold, with the index', () => {
    expect(messageOf(() => milestoneMultiplier(Number.NaN, MILESTONES))).toContain(
      'sim.milestoneMultiplier: owned',
    );
    expect(messageOf(() => milestoneMultiplier(1, { thresholds: [1], multiplier: Infinity }))).toContain(
      'milestones.multiplier',
    );
    expect(
      messageOf(() => milestoneMultiplier(1, { thresholds: [1, Number.NaN], multiplier: 2 })),
    ).toContain('milestones.thresholds[1]');
  });
});
