import { describe, expect, it } from 'vitest';

import { defineEconomy, zeroStocks } from '../src/graph.js';
import type { Economy } from '../src/graph.js';
import { NO_GATES, buildFlow, createFlow, integrate, ratesOf } from '../src/flow.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/** Relative difference, with an absolute fallback so a zero expectation is testable. */
function relative(actual: number, expected: number): number {
  const scale = Math.max(Math.abs(expected), 1);
  return Math.abs(actual - expected) / scale;
}

/**
 * A four-tier chain: `campus → cluster → agent → researcher`. Depth 3, so `researcher(t)` is a
 * cubic and every term of the Taylor sum is exercised.
 */
function chain(): Economy<'campus' | 'cluster' | 'agent' | 'researcher', never> {
  return defineEconomy({
    nodes: ['campus', 'cluster', 'agent', 'researcher'],
    edges: [
      { from: 'campus', to: 'cluster', per: 0.5 },
      { from: 'cluster', to: 'agent', per: 0.25 },
      { from: 'agent', to: 'researcher', per: 2 },
    ],
  });
}

/**
 * The oracle: `exp(A·t)` built the textbook way, as a dense matrix, and applied to the vector.
 *
 * Deliberately a *different algorithm* from the one under test rather than a second copy of it.
 * `integrate` accumulates matrix–**vector** products with a swap pair, an early exit and typed
 * arrays; this sums matrix–**matrix** powers into a full exponential with plain nested loops over
 * plain arrays, and only then multiplies. It is O(w⁴) and would be absurd in a build; in a test it
 * is the definition of the thing rather than a rearrangement of the implementation.
 *
 * The augmentation is the point: the matrix is `(width + 1)²`, the last row and column are the
 * hidden unit node, and a source edge is an entry in the last *column*. `x̃₀` ends in `1`. If the
 * package's reserved-slot trick is wrong in any way, this disagrees.
 */
function denseFlowOracle<N extends string, G extends string>(
  eco: Economy<N, G>,
  rates: readonly number[],
  stocks: Readonly<Record<N, number>>,
  t: number,
): Record<N, number> {
  const width = eco.order.length;
  const w = width + 1;
  const scaled: number[][] = Array.from({ length: w }, () => Array.from({ length: w }, () => 0));
  for (const edge of eco.edges) {
    const to = eco.index[edge.to];
    const row = scaled[to] ?? [];
    row[edge.fromIndex] = (row[edge.fromIndex] ?? 0) + (rates[edge.slot] ?? 0) * t;
  }

  // E = Σ_k (At)^k / k!, by repeated dense multiplication. Strictly triangular, so it terminates
  // at w; the loop runs the full w terms anyway, because an oracle that stops early shares a bug
  // with the thing it is checking.
  const exponential: number[][] = Array.from({ length: w }, (_, i) =>
    Array.from({ length: w }, (_, j) => (i === j ? 1 : 0)),
  );
  let power: number[][] = exponential.map((row) => [...row]);
  for (let k = 1; k <= w; k += 1) {
    const next: number[][] = Array.from({ length: w }, () => Array.from({ length: w }, () => 0));
    for (let i = 0; i < w; i += 1) {
      for (let j = 0; j < w; j += 1) {
        let sum = 0;
        for (let m = 0; m < w; m += 1) sum += (power[i]?.[m] ?? 0) * (scaled[m]?.[j] ?? 0);
        (next[i] ?? [])[j] = sum / k;
      }
    }
    power = next;
    for (let i = 0; i < w; i += 1) {
      for (let j = 0; j < w; j += 1) {
        (exponential[i] ?? [])[j] = (exponential[i]?.[j] ?? 0) + (power[i]?.[j] ?? 0);
      }
    }
  }

  const start = eco.order.map((node) => stocks[node]);
  start.push(1);
  const out = {} as Record<N, number>;
  eco.order.forEach((node, i) => {
    let sum = 0;
    for (let j = 0; j < w; j += 1) sum += (exponential[i]?.[j] ?? 0) * (start[j] ?? 0);
    out[node] = sum;
  });
  return out;
}

describe('createFlow', () => {
  it('sizes its workspace against the economy it was made for', () => {
    const eco = chain();
    const flow = createFlow(eco);
    expect(flow.rates.length).toBe(3);
    expect(flow.acc.length).toBe(4);
    expect(flow.poly.length).toBe(eco.depth + 1);
    // One element longer than the vector: the reserved unit slot every source multiplies by.
    expect(flow.term.length).toBe(5);
    expect(flow.next.length).toBe(5);
  });

  it('starts every rate at zero, so an unbuilt flow produces no motion', () => {
    const flow = createFlow(chain());
    expect([...flow.rates]).toEqual([0, 0, 0]);
  });
});

describe('buildFlow', () => {
  it('folds per × scale × gate into one rate per edge', () => {
    const eco = defineEconomy({
      nodes: ['press', 'coin'],
      gates: ['grid'],
      edges: [{ from: 'press', to: 'coin', per: 3, gate: 'grid', scale: () => 4 }],
    });
    const flow = createFlow(eco);
    buildFlow(eco, { press: 1, coin: 0 }, { grid: 0.5 }, flow);
    expect(flow.rates[0]).toBe(3 * 4 * 0.5);
  });

  it('hands the anchor stock vector to every scale function', () => {
    let seen: number | undefined;
    const eco = defineEconomy({
      nodes: ['press', 'coin'],
      edges: [
        {
          from: 'press',
          to: 'coin',
          per: 1,
          scale: (stocks) => {
            seen = stocks.press;
            return 1;
          },
        },
      ],
    });
    buildFlow(eco, { press: 17, coin: 0 }, NO_GATES, createFlow(eco));
    expect(seen).toBe(17);
  });

  it('makes a gate exactly a rate multiplier, to the bit (I6)', () => {
    const gated = defineEconomy({
      nodes: ['a', 'b'],
      gates: ['grid'],
      edges: [{ from: 'a', to: 'b', per: 0.1, gate: 'grid' }],
    });
    const baked = defineEconomy({
      nodes: ['a', 'b'],
      edges: [{ from: 'a', to: 'b', per: 0.1 * 0.5 }],
    });
    const gatedFlow = buildFlow(gated, { a: 1, b: 0 }, { grid: 0.5 }, createFlow(gated));
    const bakedFlow = buildFlow(baked, { a: 1, b: 0 }, NO_GATES, createFlow(baked));
    expect(gatedFlow.rates[0]).toBe(bakedFlow.rates[0]);

    const gatedOut = integrate(gated, { a: 3, b: 0 }, gatedFlow, 1234.5, zeroStocks(gated));
    const bakedOut = integrate(baked, { a: 3, b: 0 }, bakedFlow, 1234.5, zeroStocks(baked));
    expect(gatedOut.b).toBe(bakedOut.b);
  });

  it('returns the `out` it was handed', () => {
    const eco = chain();
    const flow = createFlow(eco);
    expect(buildFlow(eco, zeroStocks(eco), NO_GATES, flow)).toBe(flow);
  });

  it('names a gate the caller forgot to supply a ratio for', () => {
    const eco = defineEconomy({
      nodes: ['a', 'b'],
      gates: ['grid'],
      edges: [{ from: 'a', to: 'b', per: 1, gate: 'grid' }],
    });
    const message = messageOf(() =>
      buildFlow(eco, { a: 1, b: 0 }, {} as { grid: number }, createFlow(eco)),
    );
    expect(message).toContain('sim.buildFlow: gates.grid is undefined');
  });

  it('names a gate ratio that is not finite', () => {
    const eco = defineEconomy({
      nodes: ['a', 'b'],
      gates: ['grid'],
      edges: [{ from: 'a', to: 'b', per: 1, gate: 'grid' }],
    });
    for (const ratio of [Number.NaN, Infinity]) {
      expect(messageOf(() => buildFlow(eco, { a: 1, b: 0 }, { grid: ratio }, createFlow(eco)))).toContain(
        'sim.buildFlow: gates.grid is',
      );
    }
  });

  it('validates a declared gate even when no edge names it', () => {
    const eco = defineEconomy({ nodes: ['a', 'b'], gates: ['grid'], edges: [{ from: 'a', to: 'b', per: 1 }] });
    expect(messageOf(() => buildFlow(eco, { a: 1, b: 0 }, {} as { grid: number }, createFlow(eco)))).toContain(
      'gates.grid',
    );
  });

  it('names an edge whose scale returned something that is not a number', () => {
    const eco = defineEconomy({
      nodes: ['a', 'b'],
      edges: [{ from: 'a', to: 'b', per: 1, scale: () => Number.NaN }],
    });
    expect(messageOf(() => buildFlow(eco, { a: 1, b: 0 }, NO_GATES, createFlow(eco)))).toContain(
      'sim.buildFlow: scale for edge a → b',
    );
  });

  it('refuses a Flow that was made for a different economy (T14)', () => {
    const eco = chain();
    const other = defineEconomy({ nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y', per: 1 }] });
    const message = messageOf(() => buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(other)));
    expect(message).toContain('this Flow was made for a different economy');
  });
});

describe('integrate — the closed form', () => {
  it('is a polynomial of degree exactly `eco.depth` (I3)', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { campus: 4, cluster: 0, agent: 0, researcher: 0 };
    const samples: number[] = [];
    for (let t = 0; t <= eco.depth + 1; t += 1) {
      samples.push(integrate(eco, start, flow, t, zeroStocks(eco)).researcher);
    }
    // The (d+1)-th forward difference of a degree-d polynomial is identically zero. If the
    // implementation truncated the series, used a fixed term count, or took small steps, this is
    // the assertion that would notice.
    let differences = samples;
    for (let order = 0; order <= eco.depth; order += 1) {
      const next: number[] = [];
      for (let i = 1; i < differences.length; i += 1) {
        next.push((differences[i] ?? 0) - (differences[i - 1] ?? 0));
      }
      differences = next;
    }
    expect(differences).toHaveLength(1);
    // Tolerance: the samples are ≤ 4·0.5·0.25·2·3³/6 ≈ 4.5, and four differences of doubles of
    // that magnitude accumulate at most 8 ulps ≈ 8·2⁻⁵² · 4.5 ≈ 8e-15. 1e-12 is three orders of
    // margin and still four orders below any real truncation error.
    expect(Math.abs(differences[0] ?? 0)).toBeLessThan(1e-12);
  });

  it('is exact against the hand-integrated cubic', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const t = 7;
    const out = integrate(eco, { campus: 4, cluster: 0, agent: 0, researcher: 0 }, flow, t, zeroStocks(eco));
    // researcher(t) = 2 · 0.25 · 0.5 · campus₀ · t³/6
    const expected = (2 * 0.25 * 0.5 * 4 * t ** 3) / 6;
    expect(relative(out.researcher, expected)).toBeLessThan(1e-15);
    expect(out.agent).toBe((0.25 * 0.5 * 4 * t ** 2) / 2);
    expect(out.cluster).toBe(0.5 * 4 * t);
    expect(out.campus).toBe(4);
  });

  it('is path-independent: one long step equals six hundred short ones (I4)', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { campus: 2, cluster: 5, agent: 1, researcher: 0 };
    const whole = integrate(eco, start, flow, 50_400, zeroStocks(eco));

    const stepwise = Object.assign(zeroStocks(eco), start);
    for (let i = 0; i < 600; i += 1) integrate(eco, stepwise, flow, 84, stepwise);
    // 600 compositions of a cubic flow map: the source game measured ~1e-13 relative and asserts
    // at 1e-9, four orders of margin. The identity is exact in real arithmetic; everything here is
    // double rounding.
    for (const node of eco.nodes) {
      expect(relative(stepwise[node], whole[node])).toBeLessThan(1e-9);
    }
  });

  it('copies bit-identically for a non-positive interval (T9)', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { campus: 2.5, cluster: 5.25, agent: 1.125, researcher: 9 };
    for (const seconds of [0, -1, -50_400]) {
      const out = integrate(eco, start, flow, seconds, zeroStocks(eco));
      expect(out).toEqual(start);
    }
  });

  it('stops early once a matrix power is all zeros', () => {
    // Only `agent` is stocked, so A²x₀ is already zero and the cubic term is never reached.
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const out = integrate(eco, { campus: 0, cluster: 0, agent: 3, researcher: 0 }, flow, 10, zeroStocks(eco));
    expect(out.researcher).toBe(2 * 3 * 10);
    expect(out.agent).toBe(3);
  });

  it('handles an economy with no edges at all', () => {
    const eco = defineEconomy({ nodes: ['gold'], edges: [] });
    const flow = createFlow(eco);
    expect(integrate(eco, { gold: 7 }, flow, 1e6, zeroStocks(eco))).toEqual({ gold: 7 });
  });

  it('tolerates `out` aliasing `stocks`', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const vector = { campus: 4, cluster: 0, agent: 0, researcher: 0 };
    const separate = integrate(eco, vector, flow, 7, zeroStocks(eco));
    integrate(eco, vector, flow, 7, vector);
    expect(vector).toEqual(separate);
  });

  it('returns the `out` it was handed, and allocates nothing to do it', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const out = zeroStocks(eco);
    expect(integrate(eco, out, flow, 1, out)).toBe(out);
  });

  it('refuses a non-finite interval rather than writing NaN into a save', () => {
    const eco = chain();
    const flow = createFlow(eco);
    for (const seconds of [Number.NaN, Infinity, -Infinity]) {
      expect(messageOf(() => integrate(eco, zeroStocks(eco), flow, seconds, zeroStocks(eco)))).toContain(
        'sim.integrate: seconds',
      );
    }
  });

  it('refuses a mismatched Flow', () => {
    const eco = chain();
    const other = defineEconomy({ nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y', per: 1 }] });
    expect(
      messageOf(() => integrate(eco, zeroStocks(eco), createFlow(other), 1, zeroStocks(eco))),
    ).toContain('sim.integrate: this Flow was made for a different economy');
  });

  it('does not grow the heap over a hundred thousand projections (I21)', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { campus: 2, cluster: 5, agent: 1, researcher: 0 };
    const out = zeroStocks(eco);
    for (let i = 0; i < 20_000; i += 1) integrate(eco, start, flow, i, out);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100_000; i += 1) integrate(eco, start, flow, i, out);
    const grown = process.memoryUsage().heapUsed - before;
    // A single 4-key object per call is ~80 bytes; 100,000 of them is 8 MB of live-then-dead
    // objects, and enough of that survives a scavenge to show. 2 MB is a bound a genuinely
    // allocation-free path clears by two orders of magnitude and a per-call allocation does not.
    expect(grown).toBeLessThan(2_000_000);
  });
});

/**
 * A source into `a`, and `a → b`. `a(t) = 2t`, `b(t) = t²`, both exactly.
 *
 * The graph the RFC's S2 names: nothing is stocked, nothing produces `a` but the source, and `b`
 * is quadratic only if the source was counted in `depth`.
 */
function sourced(): Economy<'a' | 'b', never> {
  return defineEconomy({
    nodes: ['a', 'b'],
    edges: [
      { to: 'a', per: 2 },
      { from: 'a', to: 'b', per: 1 },
    ],
  });
}

describe('integrate — a source edge is a rate that multiplies nothing', () => {
  it('adds `per` per second, exactly, over six orders of magnitude (S1)', () => {
    const eco = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 3 }] });
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    // `toBe`, not a tolerance: `0 + 3 × t` is one multiply and one add in doubles, and every one
    // of these `t` values makes `3t` representable exactly. If a tolerance were needed here the
    // term would not be the affine term the closed form claims it is.
    for (const t of [0, 1e-6, 1, 7, 3600, 50_400, 1e6]) {
      expect(integrate(eco, { coin: 0 }, flow, t, zeroStocks(eco)).coin).toBe(3 * t);
    }
    // And it accrues on top of whatever is already banked, rather than replacing it.
    expect(integrate(eco, { coin: 11 }, flow, 4, zeroStocks(eco)).coin).toBe(11 + 12);
  });

  it('raises the degree of everything downstream by one (S2)', () => {
    const eco = sourced();
    expect(eco.depth).toBe(2);
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    for (const t of [1, 60, 3600]) {
      const out = integrate(eco, { a: 0, b: 0 }, flow, t, zeroStocks(eco));
      // a(t) = 2t and b(t) = ∫2s ds = t². Both exact in doubles for these t.
      expect(out.a).toBe(2 * t);
      expect(out.b).toBe(t * t);
    }
  });

  it('agrees with the dense matrix-exponential oracle across a wide range', () => {
    // Four graphs that exercise every combination the reserved slot has to survive: a bare source,
    // a source feeding a chain, a source landing on a node that already has a producer, and a
    // negative source (a flat standing charge).
    const cases: readonly {
      readonly eco: Economy<'a' | 'b', never>;
      readonly stocks: Record<'a' | 'b', number>;
    }[] = [
      {
        eco: defineEconomy({ nodes: ['a', 'b'], edges: [{ to: 'b', per: 0.75 }] }),
        stocks: { a: 3, b: 11 },
      },
      { eco: sourced(), stocks: { a: 1.5, b: -4 } },
      {
        eco: defineEconomy({
          nodes: ['a', 'b'],
          edges: [
            { to: 'b', per: 0.125 },
            { from: 'a', to: 'b', per: 0.5 },
            { to: 'a', per: 1.25 },
          ],
        }),
        stocks: { a: 6, b: 2 },
      },
      {
        eco: defineEconomy({
          nodes: ['a', 'b'],
          edges: [
            { to: 'a', per: -0.5 },
            { from: 'a', to: 'b', per: 3 },
          ],
        }),
        stocks: { a: 900, b: 0 },
      },
    ];
    for (const { eco, stocks } of cases) {
      const flow = buildFlow(eco, stocks, NO_GATES, createFlow(eco));
      for (const t of [1e-6, 1e-3, 1, 60, 3600, 50_400, 1e6]) {
        const actual = integrate(eco, stocks, flow, t, zeroStocks(eco));
        const expected = denseFlowOracle(eco, [...flow.rates], stocks, t);
        for (const node of eco.nodes) {
          // Both evaluate the same degree-≤2 polynomial and differ only in summation order: at
          // most four roundings each, so ~8·2⁻⁵³ ≈ 9e-16 relative. 1e-12 is three orders of
          // margin and still six orders below a dropped or doubled affine term.
          expect(relative(actual[node], expected[node])).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('agrees with the naive ODE loop, whose error is exactly 1/N', () => {
    // The other oracle: the definition rather than the closed form. Forward Euler on
    // `da/dt = 2`, `db/dt = a` with N steps of h = t/N gives
    //   b = Σ_{i<N} (2ih)·h = 2h²·N(N−1)/2 = t²·(1 − 1/N),
    // so the naive loop under-reports the quadratic term by exactly the factor 1/N — a *derived*
    // number, not a measured one. `a` is linear and Euler is exact on it.
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const t = 3600;
    const steps = 1_000_000;
    const h = t / steps;
    let a = 0;
    let b = 0;
    for (let i = 0; i < steps; i += 1) {
      const da = 2;
      const db = a;
      a += da * h;
      b += db * h;
    }
    const closed = integrate(eco, { a: 0, b: 0 }, flow, t, zeroStocks(eco));
    // `a` is linear, so Euler has *no* truncation error on it and the whole disagreement is the
    // million roundings of the running sum: at worst N·2⁻⁵³ = 1e6·1.11e-16 ≈ 1.1e-10 relative.
    // 1e-9 is one order of margin on the worst case and eight orders below a dropped term.
    expect(relative(closed.a, a)).toBeLessThan(1e-9);
    // `b` carries the derived 1/N = 1e-6 of truncation on top of the same rounding floor. 2e-6
    // covers both, and a dropped affine term would land at a relative 1.0 — six orders away.
    expect(relative(closed.b, b)).toBeLessThan(2e-6);
    expect(relative(closed.b, b)).toBeGreaterThan(1e-7);
    // And the sign of the disagreement is the truncation, not noise: Euler is *below*.
    expect(b).toBeLessThan(closed.b);
  });

  it('composes: one long integration equals six hundred short ones (S3)', () => {
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { a: 12, b: 5 };
    const whole = integrate(eco, start, flow, 50_400, zeroStocks(eco));
    const stepwise = Object.assign(zeroStocks(eco), start);
    for (let i = 0; i < 600; i += 1) integrate(eco, stepwise, flow, 84, stepwise);
    for (const node of eco.nodes) {
      // The identity is exact in real arithmetic — an affine term composes precisely because it is
      // a linear term on the augmented vector — so everything here is double rounding: ~1e-13
      // relative over 600 compositions, asserted at 1e-9 for four orders of margin, the same bar
      // the source-free case is held to.
      expect(relative(stepwise[node], whole[node])).toBeLessThan(1e-9);
    }
  });

  it('is bit-identical to the unit-node workaround it replaces', () => {
    // `b = A·e` is not an analogy. A source and a declared node pinned to 1 are the same term, so
    // they must agree to the bit — and the only difference is that the workaround's `e` is in
    // `nodes`, which is the save's field order, and `zeroStocks` sets it to 0.
    const source = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 0.1 }] });
    const unitNode = defineEconomy({
      nodes: ['one', 'coin'],
      edges: [{ from: 'one', to: 'coin', per: 0.1 }],
    });
    const sourceFlow = buildFlow(source, { coin: 0 }, NO_GATES, createFlow(source));
    const unitFlow = buildFlow(unitNode, { one: 1, coin: 0 }, NO_GATES, createFlow(unitNode));
    for (const t of [1, 7.5, 50_400]) {
      expect(integrate(source, { coin: 3 }, sourceFlow, t, zeroStocks(source)).coin).toBe(
        integrate(unitNode, { one: 1, coin: 3 }, unitFlow, t, zeroStocks(unitNode)).coin,
      );
    }
    // The failure mode that makes the workaround a trap rather than a convention: a fresh save.
    expect(
      integrate(unitNode, zeroStocks(unitNode), unitFlow, 1000, zeroStocks(unitNode)).coin,
    ).toBe(0);
    expect(integrate(source, zeroStocks(source), sourceFlow, 1000, zeroStocks(source)).coin).toBe(
      100,
    );
  });

  it('reproduces the exhibit\'s divide-it-back-out workaround, without the divide', () => {
    // The acceptance test for the whole field. The first game built on this kit wanted
    // `d(coin)/dt = rate(world)` — a rate that multiplies nothing — and the only way to spell it
    // was to nominate `lit` as a producer and divide by it inside `scale`, with a guard so the
    // division was not 0/0. Both shapes must give the same coin, and only one of them puts `lit`
    // in `nodes`, which is the save's field order.
    const rate = 4.5;
    const workaround = defineEconomy({
      nodes: ['lit', 'coin'],
      edges: [{ from: 'lit', to: 'coin', per: 1, scale: (s) => (s.lit > 0 ? rate / s.lit : 0) }],
    });
    const source = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 1, scale: () => rate }] });

    for (const lit of [1, 2, 7, 400]) {
      const oldFlow = buildFlow(workaround, { lit, coin: 0 }, NO_GATES, createFlow(workaround));
      const newFlow = buildFlow(source, { coin: 0 }, NO_GATES, createFlow(source));
      const t = 3600;
      // `rate/lit × lit` is not `rate` in doubles for every `lit` — the round trip through the
      // division is exactly what the workaround costs, and it costs an ulp. Both are within one
      // rounding of 16,200, so 1e-15 relative is a two-ulp bound with margin.
      expect(
        relative(
          integrate(workaround, { lit, coin: 0 }, oldFlow, t, zeroStocks(workaround)).coin,
          integrate(source, { coin: 0 }, newFlow, t, zeroStocks(source)).coin,
        ),
      ).toBeLessThan(1e-15);
    }

    // The save is a field shorter, and the field it lost was never produced by anything.
    expect(Object.keys(zeroStocks(workaround))).toEqual(['lit', 'coin']);
    expect(Object.keys(zeroStocks(source))).toEqual(['coin']);
    // And the guard the workaround needed is gone with it: at zero lamps the workaround earns
    // nothing at all, where the source earns the rate the world says it should.
    const zeroLit = buildFlow(workaround, { lit: 0, coin: 0 }, NO_GATES, createFlow(workaround));
    expect(integrate(workaround, { lit: 0, coin: 0 }, zeroLit, 100, zeroStocks(workaround)).coin).toBe(0);
    const fresh = buildFlow(source, { coin: 0 }, NO_GATES, createFlow(source));
    expect(integrate(source, { coin: 0 }, fresh, 100, zeroStocks(source)).coin).toBe(450);
  });

  it('never lets the reserved slot reach the output vector (S7)', () => {
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const out = integrate(eco, { a: 0, b: 0 }, flow, 10, zeroStocks(eco));
    expect(Object.keys(out)).toEqual(['a', 'b']);
    expect(JSON.stringify(out)).toBe('{"a":20,"b":100}');
  });

  it('copies bit-identically for a non-positive interval, sources and all', () => {
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { a: 2.5, b: 9.25 };
    for (const seconds of [0, -1, -50_400]) {
      expect(integrate(eco, start, flow, seconds, zeroStocks(eco))).toEqual(start);
    }
  });

  it('reseeds the unit slot every call, so a source never runs dry', () => {
    // The bug this pins: seed the `1` once at `createFlow` and the swap pair loses it after the
    // first integration, so the second call — and every call in the game after it — produces
    // nothing from the source and nothing says so.
    const eco = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 3 }] });
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    for (let i = 0; i < 5; i += 1) {
      expect(integrate(eco, { coin: 0 }, flow, 10, zeroStocks(eco)).coin).toBe(30);
    }
  });

  it('never reallocates the workspace, however many times a source is integrated', () => {
    // The heap probe in the source-free case measures the *output* vector; this measures the
    // thing a source actually touches. The extra unit element lives inside the swap pair, so the
    // failure to guard against is a resize — the pair after ten thousand integrations must still
    // be the same two `Float64Array`s, in one order or the other.
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const pair = [flow.term, flow.next];
    const out = zeroStocks(eco);
    for (let i = 0; i < 10_000; i += 1) integrate(eco, { a: 2, b: 5 }, flow, i, out);
    expect(pair).toContain(flow.term);
    expect(pair).toContain(flow.next);
    expect(flow.term).not.toBe(flow.next);
    expect(flow.term.length).toBe(3);
  });
});

describe('buildFlow — a source edge', () => {
  it('multiplies `per` by the scale and the gate, and by nothing else', () => {
    const eco = defineEconomy({
      nodes: ['coin'],
      gates: ['night'],
      edges: [{ to: 'coin', per: 2, gate: 'night', scale: () => 3 }],
    });
    const flow = buildFlow(eco, { coin: 0 }, { night: 0.5 }, createFlow(eco));
    expect(flow.rates[0]).toBe(2 * 3 * 0.5);
    // A shut gate stops a source dead, which is a plausible thing to want: no tips at night.
    expect(
      integrate(eco, { coin: 0 }, buildFlow(eco, { coin: 0 }, { night: 0 }, flow), 1e6, {
        coin: 0,
      }).coin,
    ).toBe(0);
  });

  it('hands the stock vector to a source scale, like any other edge', () => {
    // Trap 4 of the RFC, and it is correct rather than incidental: a source rate is very often a
    // function of a purchased count, and the count usually lives in the vector.
    let seen: number | undefined;
    const eco = defineEconomy({
      nodes: ['bought', 'coin'],
      edges: [
        {
          to: 'coin',
          per: 1,
          scale: (stocks) => {
            seen = stocks.bought;
            return Math.sqrt(stocks.bought);
          },
        },
      ],
    });
    const flow = buildFlow(eco, { bought: 9, coin: 0 }, NO_GATES, createFlow(eco));
    expect(seen).toBe(9);
    expect(flow.rates[0]).toBe(3);
    // A square-root rate, integrated in closed form, with no division and no guard: the shape the
    // package was always able to express and its docs did not say so.
    expect(integrate(eco, { bought: 9, coin: 0 }, flow, 100, zeroStocks(eco)).coin).toBe(300);
  });

  it('names a bad source in its error as `source`, never as `undefined`', () => {
    // A designer who reads `undefined → coin` greps their spec for a node they never wrote.
    const eco = defineEconomy({
      nodes: ['coin'],
      edges: [{ to: 'coin', per: 1, scale: () => Number.NaN }],
    });
    const message = messageOf(() => buildFlow(eco, { coin: 0 }, NO_GATES, createFlow(eco)));
    expect(message).toContain('sim.buildFlow: scale for edge source → coin');
    expect(message).not.toContain('undefined');
  });
});

describe('ratesOf', () => {
  it('reports the derivative now, which is not the next minute divided by sixty', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const start = { campus: 4, cluster: 0, agent: 0, researcher: 0 };
    const rates = ratesOf(eco, start, flow, zeroStocks(eco));
    expect(rates.cluster).toBe(0.5 * 4);
    expect(rates.agent).toBe(0);
    expect(rates.researcher).toBe(0);

    // The trap: multiplying by elapsed time under-reports, because clusters arriving during the
    // minute go on to make agents. The honest answer is an integral.
    const inSixty = integrate(eco, start, flow, 60, zeroStocks(eco));
    expect(inSixty.agent).toBeGreaterThan(rates.agent * 60);
  });

  it('reports a source as the constant it is, with nothing stocked', () => {
    // The headline number a HUD prints while the player owns zero of everything — which is
    // precisely the case the workaround could not express, because it had nothing to multiply.
    const eco = sourced();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const rates = ratesOf(eco, zeroStocks(eco), flow, zeroStocks(eco));
    expect(rates.a).toBe(2);
    expect(rates.b).toBe(0);
    // And it adds to a producer landing on the same node rather than replacing it.
    expect(ratesOf(eco, { a: 5, b: 0 }, flow, zeroStocks(eco)).b).toBe(5);
  });

  it('zeroes nodes nothing feeds', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const rates = ratesOf(eco, { campus: 1, cluster: 1, agent: 1, researcher: 99 }, flow, zeroStocks(eco));
    expect(rates.campus).toBe(0);
  });

  it('tolerates `out` aliasing `stocks`, and returns `out`', () => {
    const eco = chain();
    const flow = buildFlow(eco, zeroStocks(eco), NO_GATES, createFlow(eco));
    const vector = { campus: 4, cluster: 2, agent: 1, researcher: 0 };
    const separate = ratesOf(eco, vector, flow, zeroStocks(eco));
    expect(ratesOf(eco, vector, flow, vector)).toBe(vector);
    expect(vector).toEqual(separate);
  });

  it('refuses a mismatched Flow', () => {
    const eco = chain();
    const other = defineEconomy({ nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y', per: 1 }] });
    expect(messageOf(() => ratesOf(eco, zeroStocks(eco), createFlow(other), zeroStocks(eco)))).toContain(
      'sim.ratesOf: this Flow was made for a different economy',
    );
  });
});

describe('NO_GATES', () => {
  it('is frozen, so an economy without gates cannot grow one by accident', () => {
    expect(Object.isFrozen(NO_GATES)).toBe(true);
  });
});
