import { describe, expect, it } from 'vitest';
import { asEpochMillis } from '@latticekit/core';
import type { EpochMillis } from '@latticekit/core';

import { defineEconomy, zeroStocks } from '../src/graph.js';
import type { Economy } from '../src/graph.js';
import { NO_GATES, buildFlow, createFlow } from '../src/flow.js';
import { advance, elapsedSeconds, expectFiniteStocks, project, reanchor } from '../src/ledger.js';
import type { Ledger } from '../src/ledger.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/** Two lamps burning one oil each per second, plus a press making coin. */
function lamps(): Economy<'press' | 'coin' | 'lamp' | 'oil', never> {
  return defineEconomy({
    nodes: ['press', 'coin', 'lamp', 'oil'],
    edges: [
      { from: 'press', to: 'coin', per: 0.5 },
      { from: 'lamp', to: 'oil', per: -1 },
    ],
  });
}

const START: Ledger<'press' | 'coin' | 'lamp' | 'oil'> = {
  stocks: { press: 4, coin: 0, lamp: 2, oil: 1000 },
  atMs: asEpochMillis(1_700_000_000_000),
};

/** `START.atMs` plus a whole number of seconds, kept branded. */
function later(seconds: number): EpochMillis {
  return asEpochMillis(START.atMs + seconds * 1000);
}

describe('elapsedSeconds', () => {
  it('is the one place the ms→s conversion lives', () => {
    expect(elapsedSeconds(START, later(90))).toBe(90);
    expect(elapsedSeconds(START, asEpochMillis(START.atMs + 1))).toBe(0.001);
  });

  it('clamps a backwards clock at zero rather than taking its absolute value (T9)', () => {
    expect(elapsedSeconds(START, later(-3600))).toBe(0);
    expect(elapsedSeconds(START, START.atMs)).toBe(0);
  });

  it('names a non-finite instant instead of returning NaN', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(messageOf(() => elapsedSeconds(START, bad as EpochMillis))).toContain(
        'sim.elapsedSeconds: atMs is not finite',
      );
    }
  });

  it('names a non-finite anchor, which is a save to validate at load', () => {
    const corrupt = { stocks: START.stocks, atMs: Number.NaN as EpochMillis };
    expect(messageOf(() => elapsedSeconds(corrupt, later(1)))).toContain(
      'sim.elapsedSeconds: ledger.atMs is not finite',
    );
  });
});

describe('project — the per-frame read', () => {
  it('integrates from the anchor to the instant and reports the interval', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const view = zeroStocks(eco);
    expect(project(eco, START, flow, later(100), view)).toBe(100);
    expect(view.coin).toBe(0.5 * 4 * 100);
    expect(view.oil).toBe(1000 - 2 * 100);
  });

  it('changes neither the ledger nor its stocks', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    project(eco, START, flow, later(100), zeroStocks(eco));
    expect(START.stocks).toEqual({ press: 4, coin: 0, lamp: 2, oil: 1000 });
    expect(START.atMs).toBe(1_700_000_000_000);
  });

  it('always answers from the same anchor, so it is an expression rather than an accumulation (T8)', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const view = zeroStocks(eco);
    // Ten frames' worth of reads at 10 Hz, then one read at the end. The last read is the answer;
    // the nine before it left nothing behind.
    for (let i = 1; i <= 10; i += 1) project(eco, START, flow, later(i / 10), view);
    const once = project(eco, START, flow, later(1), zeroStocks(eco));
    expect(once).toBe(1);
    expect(view.coin).toBe(0.5 * 4);
  });

  it('credits exactly zero for a backwards clock (I19)', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const view = zeroStocks(eco);
    expect(project(eco, START, flow, later(-86_400), view)).toBe(0);
    expect(view).toEqual(START.stocks);
  });

  it('does not check the result for finiteness, because one bad frame is visible and harmless', () => {
    const eco = lamps();
    const flow = createFlow(eco);
    buildFlow(eco, START.stocks, NO_GATES, flow);
    const huge = { stocks: { press: 1e308, coin: 0, lamp: 0, oil: 0 }, atMs: START.atMs };
    const view = zeroStocks(eco);
    project(eco, huge, flow, later(1e10), view);
    expect(Number.isFinite(view.coin)).toBe(false);
  });
});

describe('advance — the boundary call', () => {
  it('moves the anchor and credits what it was told to', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const led = advance(eco, START, flow, 100, later(100));
    expect(led.atMs).toBe(later(100));
    expect(led.stocks.coin).toBe(200);
    expect(led.stocks.oil).toBe(800);
  });

  it('separates the anchor from the credit, which is what a warp needs', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    // Eight hours of absence, five hours of credit: the anchor still lands on the real instant.
    const led = advance(eco, START, flow, 5 * 3600, later(8 * 3600));
    expect(led.atMs).toBe(later(8 * 3600));
    expect(led.stocks.coin).toBe(0.5 * 4 * 5 * 3600);
  });

  it('returns the ledger unchanged for an instant before the anchor (I19)', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    expect(advance(eco, START, flow, 3600, later(-1))).toBe(START);
  });

  it('writes its vector in storage order, so two saves are byte-comparable', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const led = advance(eco, START, flow, 1, later(1));
    expect(Object.keys(led.stocks)).toEqual(['press', 'coin', 'lamp', 'oil']);
  });

  it('names the node when the result would not survive a save (I20)', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    const huge = { stocks: { press: 1e308, coin: 0, lamp: 0, oil: 0 }, atMs: START.atMs };
    const message = messageOf(() => advance(eco, huge, flow, 1e10, later(1e10)));
    expect(message).toContain('sim.advance: stocks.coin is not finite (Infinity)');
    expect(message).toContain('valid checksum');
  });

  it('names a non-finite instant', () => {
    const eco = lamps();
    const flow = createFlow(eco);
    expect(messageOf(() => advance(eco, START, flow, 1, Number.NaN as EpochMillis))).toContain(
      'sim.advance: atMs is not finite',
    );
  });
});

describe('reanchor — the clock-correction tool (T22)', () => {
  it('moves the anchor backwards, which advance deliberately will not', () => {
    const corrected = reanchor(START, later(-86_400));
    expect(corrected.atMs).toBe(later(-86_400));
    expect(corrected.stocks).toBe(START.stocks);
  });

  it('un-freezes an economy that a forward clock jump had stopped for a year', () => {
    const eco = lamps();
    const flow = buildFlow(eco, START.stocks, NO_GATES, createFlow(eco));
    // A phone a year ahead: the credit is capped elsewhere, but the anchor lands in the future.
    const jumped = advance(eco, START, flow, 3600, later(365 * 86_400));
    // Every later read now sees time running backwards and credits nothing.
    expect(project(eco, jumped, flow, later(10), zeroStocks(eco))).toBe(0);
    // Reanchoring keeps the stocks, forfeits nothing earned, and is running again next frame.
    const fixed = reanchor(jumped, later(10));
    expect(fixed.stocks).toBe(jumped.stocks);
    expect(project(eco, fixed, flow, later(20), zeroStocks(eco))).toBe(10);
  });

  it('names a non-finite instant', () => {
    expect(messageOf(() => reanchor(START, Infinity as EpochMillis))).toContain(
      'sim.reanchor: atMs is not finite',
    );
  });
});

describe('expectFiniteStocks — the save boundary (I20)', () => {
  it('returns the vector it was given when everything survives JSON', () => {
    const eco = lamps();
    expect(expectFiniteStocks(eco, START.stocks, 'sim.load')).toBe(START.stocks);
  });

  it('catches an Infinity that made a round trip and came back as null', () => {
    const eco = lamps();
    const written = JSON.stringify({ press: 4, coin: Infinity, lamp: 2, oil: 1000 });
    expect(written).toContain('"coin":null');
    const parsed: Record<string, number> = JSON.parse(written) as Record<string, number>;
    const message = messageOf(() =>
      expectFiniteStocks(eco, parsed as unknown as Record<'press' | 'coin' | 'lamp' | 'oil', number>, 'sim.load'),
    );
    expect(message).toContain('sim.load: stocks.coin is not finite (null)');
  });

  it('catches a NaN, which JSON also writes as null', () => {
    const eco = lamps();
    const parsed: Record<string, number> = JSON.parse(
      JSON.stringify({ press: 4, coin: 0, lamp: Number.NaN, oil: 1000 }),
    ) as Record<string, number>;
    expect(
      messageOf(() =>
        expectFiniteStocks(eco, parsed as unknown as Record<'press' | 'coin' | 'lamp' | 'oil', number>, 'sim.load'),
      ),
    ).toContain('sim.load: stocks.lamp is not finite (null)');
  });

  it('catches a key the save never had at all', () => {
    const eco = lamps();
    expect(
      messageOf(() =>
        expectFiniteStocks(
          eco,
          { press: 1, coin: 2, lamp: 3 } as unknown as Record<'press' | 'coin' | 'lamp' | 'oil', number>,
          'sim.load',
        ),
      ),
    ).toContain('sim.load: stocks.oil is not finite (undefined)');
  });

  it('quotes a string that arrived where a number was expected', () => {
    // A hand-edited save, or a schema drift. The value is rendered rather than interpolated,
    // because an error thrown while building an error message is the worst way to learn about one.
    const eco = lamps();
    expect(
      messageOf(() =>
        expectFiniteStocks(
          eco,
          { press: 4, coin: '12' as unknown as number, lamp: 2, oil: 0 },
          'sim.load',
        ),
      ),
    ).toContain("sim.load: stocks.coin is not finite ('12')");
  });

  it('names the first offending node in storage order, not in evaluation order', () => {
    const eco = lamps();
    const message = messageOf(() =>
      expectFiniteStocks(eco, { press: 4, coin: Number.NaN, lamp: Number.NaN, oil: 0 }, 'sim.load'),
    );
    expect(message).toContain('stocks.coin');
  });
});
