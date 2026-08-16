import { bench, describe } from 'vitest';

import { bulkCost, costOfNext, maxBuyable, milestoneMultiplier } from '../src/cost.js';
import type { CostCurve, Milestones } from '../src/cost.js';

const CURVE: CostCurve = { base: 10, growth: 1.07 };
const MILESTONES: Milestones = { thresholds: [10, 20, 35, 50], multiplier: 2 };

/** The buy-loop the closed form exists to replace. Here to be *measured*, never to ship. */
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

describe('the shop, per frame', () => {
  // Every one of these renders a button label, so they run once per button per frame.
  bench('costOfNext at 4,000 owned', () => {
    costOfNext(CURVE, 4_000);
  });

  bench('bulkCost — a x25 batch at 4,000 owned', () => {
    bulkCost(CURVE, 4_000, 25);
  });

  bench('maxBuyable at 4,000 owned — closed form', () => {
    maxBuyable(CURVE, 4_000, 1e200, 1_000_000);
  });

  bench('milestoneMultiplier — four thresholds', () => {
    milestoneMultiplier(4_000, MILESTONES);
  });
});

describe('the trap it replaces (T1)', () => {
  // The same answer by the naive route. This is the comparison the RFC's first trap is about: a
  // "buy max" label at four thousand owned should not cost four thousand `pow` calls a frame.
  bench('naive buy-loop — 400 iterations', () => {
    naiveMaxBuyable(CURVE, 0, 1e14, 1_000_000);
  });

  bench('maxBuyable — the same answer, closed form', () => {
    maxBuyable(CURVE, 0, 1e14, 1_000_000);
  });
});
