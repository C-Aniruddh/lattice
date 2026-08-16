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

describe('createFlow', () => {
  it('sizes its workspace against the economy it was made for', () => {
    const eco = chain();
    const flow = createFlow(eco);
    expect(flow.rates.length).toBe(3);
    expect(flow.acc.length).toBe(4);
    expect(flow.poly.length).toBe(eco.depth + 1);
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
