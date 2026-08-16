import { describe, expect, it } from 'vitest';

import { defineEconomy, zeroStocks } from '../src/graph.js';
import type { Economy } from '../src/graph.js';
import { NO_GATES, buildFlow, createFlow, integrate } from '../src/flow.js';
import { solveCrossing } from '../src/crossing.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/** Two lamps burning oil at one unit each per second. `oil` is degree 1. */
function lamps(): Economy<'lamp' | 'oil', never> {
  return defineEconomy({ nodes: ['lamp', 'oil'], edges: [{ from: 'lamp', to: 'oil', per: -1 }] });
}

/**
 * A four-link chain with unit rates, so `z(t)` is exactly
 * `z₀ + y₀t + x₀t²/2 + w₀t³/6` — a cubic whose coefficients a test can dictate.
 */
function cubic(): Economy<'w' | 'x' | 'y' | 'z', never> {
  return defineEconomy({
    nodes: ['w', 'x', 'y', 'z'],
    edges: [
      { from: 'w', to: 'x', per: 1 },
      { from: 'x', to: 'y', per: 1 },
      { from: 'y', to: 'z', per: 1 },
    ],
  });
}

/**
 * The stock vector that makes `z(t)` equal `scale·(t − 1)(t − 2)(t − 3)`.
 *
 * Expanded, that is `scale·(t³ − 6t² + 11t − 6)`, so `w₀ = 6·scale`, `x₀ = −12·scale`,
 * `y₀ = 11·scale` and `z₀ = −6·scale`. Three planted roots, at known places.
 */
function plantedRoots(scale: number): Record<'w' | 'x' | 'y' | 'z', number> {
  return { w: 6 * scale, x: -12 * scale, y: 11 * scale, z: -6 * scale };
}

describe('solveCrossing — degree 0 and 1', () => {
  it('reports zero when the stock is already at the level', () => {
    const eco = lamps();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, { lamp: 2, oil: 0 }, flow, 'oil', 0, 1000)).toBe(0);
    expect(solveCrossing(eco, { lamp: 0, oil: 5 }, flow, 'oil', 5, 1000)).toBe(0);
  });

  it('reports Infinity for a constant that never reaches the level', () => {
    const eco = lamps();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, { lamp: 0, oil: 5 }, flow, 'oil', 0, 1e9)).toBe(Infinity);
  });

  it('is one exact divide at degree 1', () => {
    const eco = lamps();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // 1000 oil, two lamps at one per second: exactly 500 s, and 1000/2 is exact in binary.
    expect(solveCrossing(eco, { lamp: 2, oil: 1000 }, flow, 'oil', 0, 1e9)).toBe(500);
    // A level other than zero, and a rising stock rather than a falling one.
    const rising = defineEconomy({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', per: 4 }] });
    const risingFlow = buildFlow(rising, zeroStocks(rising), NO_GATES, createFlow(rising));
    expect(solveCrossing(rising, { a: 2, b: 1 }, risingFlow, 'b', 33, 1e9)).toBe(4);
  });

  it('reports Infinity when the crossing is past the horizon or in the past', () => {
    const eco = lamps();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, { lamp: 2, oil: 1000 }, flow, 'oil', 0, 499)).toBe(Infinity);
    expect(solveCrossing(eco, { lamp: 2, oil: 1000 }, flow, 'oil', 0, 500)).toBe(500);
    // A refilling stock never reaches zero going forwards; the algebraic root is negative.
    const filling = defineEconomy({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', per: 1 }] });
    const fillingFlow = buildFlow(filling, zeroStocks(filling), NO_GATES, createFlow(filling));
    expect(solveCrossing(filling, { a: 1, b: 10 }, fillingFlow, 'b', 0, 1e9)).toBe(Infinity);
  });

  it('reports Infinity for a non-positive horizon', () => {
    const eco = lamps();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, { lamp: 2, oil: 1000 }, flow, 'oil', 0, 0)).toBe(Infinity);
    expect(solveCrossing(eco, { lamp: 2, oil: 1000 }, flow, 'oil', 0, -5)).toBe(Infinity);
  });
});

describe('solveCrossing — degree 2, the quadratic formula', () => {
  /** `press → lamp → oil`: lamps are produced, so oil is quadratic. */
  function quadratic(): Economy<'press' | 'lamp' | 'oil', never> {
    return defineEconomy({
      nodes: ['press', 'lamp', 'oil'],
      edges: [
        { from: 'press', to: 'lamp', per: 2 },
        { from: 'lamp', to: 'oil', per: -1 },
      ],
    });
  }

  it('matches the algebraic root', () => {
    const eco = quadratic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // oil(t) = 100 − 1·t − (2·1)·t²/2 = 100 − t − t², whose positive root is (−1 + √401)/2.
    const t = solveCrossing(eco, { press: 1, lamp: 1, oil: 100 }, flow, 'oil', 0, 1e9);
    const expected = (-1 + Math.sqrt(401)) / 2;
    // Both sides are the same closed form evaluated by the same `Math.sqrt`; a few ulps of a
    // value near 9.5 is under 1e-14.
    expect(Math.abs(t - expected)).toBeLessThan(1e-14);
  });

  it('survives the cancellation case a naive (−b ± √Δ)/2a would lose', () => {
    const eco = quadratic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // A huge linear drain and a tiny quadratic one: b² ≫ 4ac, which is exactly where the naive
    // branch loses most of the significant figures of the small root.
    const t = solveCrossing(eco, { press: 1e-9, lamp: 1e6, oil: 1e6 }, flow, 'oil', 0, 1e9);
    const out = integrate(eco, { press: 1e-9, lamp: 1e6, oil: 1e6 }, flow, t, zeroStocks(eco));
    // I9: integrating exactly `t` lands on the level. The stock started at 1e6, so an absolute
    // 1e-3 is a relative 1e-9.
    expect(Math.abs(out.oil)).toBeLessThan(1e-3);
  });

  it('reports Infinity when the discriminant is negative — it never gets there', () => {
    const eco = quadratic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // A rising quadratic that starts at 5 and only goes up never reaches zero.
    const rising = defineEconomy({
      nodes: ['a', 'b', 'c'],
      edges: [
        { from: 'a', to: 'b', per: 1 },
        { from: 'b', to: 'c', per: 1 },
      ],
    });
    const risingFlow = buildFlow(rising, zeroStocks(rising), NO_GATES, createFlow(rising));
    expect(solveCrossing(rising, { a: 1, b: 1, c: 5 }, risingFlow, 'c', 0, 1e9)).toBe(Infinity);
  });

  it('finds a tangential root when the vertex sits exactly on the level', () => {
    // z(t) = 2·(t − 3)² = 2t² − 12t + 18, built as a two-link chain: z₀ = 18, y₀ = −12, x₀ = 4.
    const eco = defineEconomy({
      nodes: ['x', 'y', 'z'],
      edges: [
        { from: 'x', to: 'y', per: 1 },
        { from: 'y', to: 'z', per: 1 },
      ],
    });
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, { x: 4, y: -12, z: 18 }, flow, 'z', 0, 1e9)).toBe(3);
  });
});

describe('solveCrossing — degree 3 and above', () => {
  it('returns the earliest of three planted roots (I9)', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const t = solveCrossing(eco, plantedRoots(1), flow, 'z', 0, 1e9);
    // 60 halvings of a bracket at most 1e9 wide leaves 1e9/2⁶⁰ ≈ 9e-10; the roots are at 1, 2, 3
    // so the bracket is far narrower than that, but 1e-9 is the honest ceiling.
    expect(Math.abs(t - 1)).toBeLessThan(1e-9);
  });

  it('reports a dip that is rescued and drained again — not the last crossing', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // −(t − 1)(t − 2)(t − 3) starts at +6, dips below zero at t = 1, is rescued at t = 2, and
    // drains again at t = 3. A bracket-first search would happily report 3.
    const start = plantedRoots(-1);
    expect(start.z).toBe(6);
    const t = solveCrossing(eco, start, flow, 'z', 0, 1e9);
    expect(Math.abs(t - 1)).toBeLessThan(1e-9);
  });

  it('never returns a value that is not a crossing, and never one that is not the first (I9)', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = plantedRoots(-1);
    const t = solveCrossing(eco, start, flow, 'z', 0, 1e9);
    const at = integrate(eco, start, flow, t, zeroStocks(eco));
    // The trajectory's scale near the root is O(1), so an absolute 1e-8 is the relative 1e-9 the
    // invariant asks for with an order of margin.
    expect(Math.abs(at.z)).toBeLessThan(1e-8);
    for (let i = 1; i < 200; i += 1) {
      const before = integrate(eco, start, flow, (t * i) / 200, zeroStocks(eco));
      expect(before.z).toBeGreaterThan(0);
    }
  });

  it('costs the same at any horizon — a horizon of 1e15 seconds still returns (I10)', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = plantedRoots(1);
    // Anything that walked time would not finish this call before the suite times out. The two
    // horizons differ by fifteen orders of magnitude and the work is identical, so the answer is
    // identical to the bit.
    const near = solveCrossing(eco, start, flow, 'z', 0, 4);
    const far = solveCrossing(eco, start, flow, 'z', 0, 1e15);
    expect(far).toBe(near);
  });

  it('recurses through degree 4', () => {
    const eco = defineEconomy({
      nodes: ['v', 'w', 'x', 'y', 'z'],
      edges: [
        { from: 'v', to: 'w', per: 1 },
        { from: 'w', to: 'x', per: 1 },
        { from: 'x', to: 'y', per: 1 },
        { from: 'y', to: 'z', per: 1 },
      ],
    });
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // z(t) = z₀ + y₀t + x₀t²/2 + w₀t³/6 + v₀t⁴/24. Choose it to be t⁴ − 1, whose only positive
    // real root is 1: v₀ = 24, w₀ = 0, x₀ = 0, y₀ = 0, z₀ = −1.
    const t = solveCrossing(eco, { v: 24, w: 0, x: 0, y: 0, z: -1 }, flow, 'z', 0, 100);
    expect(Math.abs(t - 1)).toBeLessThan(1e-9);
  });

  it('uses the state`s real degree, not the graph`s, when a higher term is zero', () => {
    // `y` sits two links into a four-node chain, so the graph allows a cubic term at k = 3 while
    // `y` itself has no path of length three into it: that coefficient is exactly zero even though
    // the matrix power is still alive further downstream. The solve must use degree 2.
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // y(t) = y₀ + x₀t + w₀t²/2 = 8 − 6t + t², whose first root is 2.
    const t = solveCrossing(eco, { w: 2, x: -6, y: 8, z: 0 }, flow, 'y', 0, 1e9);
    expect(t).toBe(2);
  });

  it('reports Infinity when a cubic has no root inside the horizon', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    expect(solveCrossing(eco, plantedRoots(1), flow, 'z', 0, 0.5)).toBe(Infinity);
  });

  it('lands exactly on a root that sits on a bracket endpoint', () => {
    const eco = cubic();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // The horizon is the root itself, so the crossing is found at the closing endpoint rather
    // than by a sign change inside a segment.
    expect(solveCrossing(eco, plantedRoots(1), flow, 'z', 0, 1)).toBe(1);
  });
});

describe('solveCrossing — what it refuses', () => {
  it('names a node it has never heard of', () => {
    const eco = lamps();
    const flow = createFlow(eco);
    expect(messageOf(() => solveCrossing(eco, { lamp: 1, oil: 1 }, flow, 'ghost' as 'oil', 0, 1))).toContain(
      "sim.solveCrossing: 'ghost' is not a node of this economy",
    );
  });

  it('names the wrong *kind* of node before deciding it is undeclared', () => {
    // Same rule as `defineEconomy`: a node object must not be reported as an undeclared node
    // called `[object Object]`, which sends the reader to edit a spec that is already correct.
    const eco = lamps();
    const flow = createFlow(eco);
    for (const [node, kind] of [
      [{ id: 'oil' }, 'object'],
      [null, 'null'],
      [3, 'number'],
    ] as const) {
      expect(
        messageOf(() => solveCrossing(eco, { lamp: 1, oil: 1 }, flow, node as unknown as 'oil', 0, 1)),
      ).toBe(`sim.solveCrossing: expected node to be a node id string, got ${kind}`);
    }
    expect(() => solveCrossing(eco, { lamp: 1, oil: 1 }, flow, 3 as unknown as 'oil', 0, 1)).toThrow(
      TypeError,
    );
  });

  it('names a non-finite level or horizon', () => {
    const eco = lamps();
    const flow = createFlow(eco);
    expect(messageOf(() => solveCrossing(eco, { lamp: 1, oil: 1 }, flow, 'oil', Number.NaN, 1))).toContain(
      'sim.solveCrossing: level',
    );
    // A bounded bracket is what bisection needs, and "ever" is not a question a game can act on.
    expect(messageOf(() => solveCrossing(eco, { lamp: 1, oil: 1 }, flow, 'oil', 0, Infinity))).toContain(
      'sim.solveCrossing: horizonSeconds',
    );
  });
});

describe('solveCrossing — the guttering loop it exists for', () => {
  it('resolves a whole night in a loop bounded by the number of lamps, not by time', () => {
    const eco = lamps();
    const flow = createFlow(eco);
    let stocks: Record<'lamp' | 'oil', number> = { lamp: 4, oil: 100 };
    const untilDawn = 1000;
    const gutteredAt: number[] = [];
    let elapsed = 0;
    for (let guard = 0; guard < 10; guard += 1) {
      buildFlow(eco, stocks, NO_GATES, flow);
      const t = solveCrossing(eco, stocks, flow, 'oil', 0, untilDawn - elapsed);
      if (t === Infinity) break;
      stocks = integrate(eco, stocks, flow, t, zeroStocks(eco));
      elapsed += t;
      gutteredAt.push(elapsed);
      // A game action, at an instant: one fewer lamp burning, and the oil is refilled a little.
      stocks = { lamp: stocks.lamp - 1, oil: 10 };
    }
    // Four lamps, four refills: the loop ran once per lamp and then the last lamp burned out with
    // nothing left to extinguish.
    expect(gutteredAt).toHaveLength(4);
    expect(gutteredAt[0]).toBe(25);
    // 100/4 = 25, then 10/3, then 10/2, then 10/1 — each exact.
    expect(gutteredAt[3]).toBe(25 + 10 / 3 + 5 + 10);
  });
});
