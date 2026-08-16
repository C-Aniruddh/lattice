import { bench, describe } from 'vitest';
import { asEpochMillis } from '@lattice/core';

import { defineEconomy, zeroStocks } from '../src/graph.js';
import { NO_GATES, buildFlow, createFlow, integrate, ratesOf } from '../src/flow.js';
import { project } from '../src/ledger.js';
import type { Ledger } from '../src/ledger.js';
import { advanceOver } from '../src/schedule.js';
import type { OfflineCurve, Phase } from '../src/index.js';
import { solveCrossing } from '../src/crossing.js';

/**
 * A fourteen-node graph of depth 4 — the shape the source game shipped, which is roughly the
 * biggest an idle economy gets before it is really two economies.
 */
type Node =
  | 'campus'
  | 'cluster'
  | 'agent'
  | 'researcher'
  | 'capability'
  | 'capital'
  | 'compute'
  | 'narrative'
  | 'sand'
  | 'memory'
  | 'power'
  | 'water'
  | 'lamp'
  | 'oil';

const NODES: readonly Node[] = [
  'campus',
  'cluster',
  'agent',
  'researcher',
  'capability',
  'capital',
  'compute',
  'narrative',
  'sand',
  'memory',
  'power',
  'water',
  'lamp',
  'oil',
];

const eco = defineEconomy<Node, 'grid'>({
  nodes: NODES,
  gates: ['grid'],
  edges: [
    { from: 'campus', to: 'cluster', per: 0.05 },
    { from: 'cluster', to: 'agent', per: 0.2, gate: 'grid' },
    { from: 'agent', to: 'researcher', per: 0.4, gate: 'grid' },
    { from: 'researcher', to: 'capability', per: 1.1 },
    { from: 'capability', to: 'capital', per: 0.3 },
    { from: 'compute', to: 'capability', per: 0.2, gate: 'grid' },
    { from: 'narrative', to: 'capital', per: 0.05 },
    { from: 'sand', to: 'memory', per: 0.01 },
    { from: 'memory', to: 'compute', per: 0.02 },
    { from: 'power', to: 'compute', per: 0.03, gate: 'grid' },
    { from: 'water', to: 'power', per: 0.004 },
    { from: 'lamp', to: 'oil', per: -1, gate: 'grid' },
  ],
});

const flow = createFlow(eco);
const stocks = zeroStocks(eco);
let seed = 3;
for (const node of NODES) {
  seed = (seed * 48_271) % 2_147_483_647;
  stocks[node] = 10 + (seed % 1000);
}
stocks.oil = 1e6;
buildFlow(eco, stocks, { grid: 0.85 }, flow);

const out = zeroStocks(eco);
const ledger: Ledger<Node> = { stocks, atMs: asEpochMillis(1_700_000_000_000) };
const now = asEpochMillis(1_700_000_060_000);

describe('per frame', () => {
  // Frame budget is 8 ms for everything. These three are what a HUD runs every frame, and between
  // them they should not be visible in a profile at all.
  bench('project — 14 nodes, depth 4', () => {
    project(eco, ledger, flow, now, out);
  });

  bench('buildFlow — 12 edges, one gate', () => {
    buildFlow(eco, stocks, { grid: 0.85 }, flow);
  });

  bench('ratesOf — the HUD"s per-second line', () => {
    ratesOf(eco, stocks, flow, out);
  });

  bench('integrate — fourteen hours in one step', () => {
    integrate(eco, stocks, flow, 50_400, out);
  });
});

describe('per boundary', () => {
  bench('solveCrossing — degree 1, a fourteen-hour horizon', () => {
    solveCrossing(eco, stocks, flow, 'oil', 0, 50_400);
  });

  bench('solveCrossing — degree 4, bisection', () => {
    solveCrossing(eco, stocks, flow, 'capital', 1e9, 50_400);
  });
});

const CURVE: OfflineCurve = { uncappedSeconds: 3 * 3600, exponent: 0.625, flatAfterSeconds: 24 * 3600 };

/** 45 s days and 60 s nights out to the 24-hour horizon: about 1,370 phases. */
const phases: Phase<'grid'>[] = [];
{
  let t = 0;
  let dark = false;
  while (t <= 24 * 3600) {
    phases.push({ atSeconds: t, gates: { grid: dark ? 0.2 : 0.85 } });
    t += dark ? 60 : 45;
    dark = !dark;
  }
}

describe('per absence', () => {
  // The whole of a player's night, resolved once at the hydrate seam. The cost is the number of
  // *semantic boundaries*, so a six-month absence costs exactly what this one does.
  bench(`advanceOver — ${String(phases.length)} phases across a 20-hour absence`, () => {
    advanceOver(eco, ledger, flow, { fromSeconds: 0, spanSeconds: 20 * 3600, phases, curve: CURVE }, now);
  });

  bench('advanceOver — the same schedule across a six-month absence', () => {
    advanceOver(
      eco,
      ledger,
      flow,
      { fromSeconds: 0, spanSeconds: 180 * 86_400, phases, curve: CURVE },
      now,
    );
  });
});

/**
 * The same fourteen-node graph with one **source** added: a flat drip into `sand`, the root of
 * the deepest chain, which raises `eco.depth` from 4 to 5.
 *
 * The question these two answer is whether a source costs the hot loop anything. It should cost
 * exactly one more edge and — here, because the source lands on the root of the longest chain —
 * one more term of the Taylor sum. There is no branch on `from === undefined` anywhere in
 * `integrate`; a source is a slot index like any other, pointing one past the last node.
 */
const sourcedEco = defineEconomy<Node, 'grid'>({
  nodes: NODES,
  gates: ['grid'],
  edges: [
    { to: 'sand', per: 4 },
    { from: 'campus', to: 'cluster', per: 0.05 },
    { from: 'cluster', to: 'agent', per: 0.2, gate: 'grid' },
    { from: 'agent', to: 'researcher', per: 0.4, gate: 'grid' },
    { from: 'researcher', to: 'capability', per: 1.1 },
    { from: 'capability', to: 'capital', per: 0.3 },
    { from: 'compute', to: 'capability', per: 0.2, gate: 'grid' },
    { from: 'narrative', to: 'capital', per: 0.05 },
    { from: 'sand', to: 'memory', per: 0.01 },
    { from: 'memory', to: 'compute', per: 0.02 },
    { from: 'power', to: 'compute', per: 0.03, gate: 'grid' },
    { from: 'water', to: 'power', per: 0.004 },
    { from: 'lamp', to: 'oil', per: -1, gate: 'grid' },
  ],
});

const sourcedFlow = createFlow(sourcedEco);
buildFlow(sourcedEco, stocks, { grid: 0.85 }, sourcedFlow);
const sourcedOut = zeroStocks(sourcedEco);

describe('sources', () => {
  bench(`integrate — 14 nodes, one source, depth ${String(sourcedEco.depth)}`, () => {
    integrate(sourcedEco, stocks, sourcedFlow, 50_400, sourcedOut);
  });

  bench('buildFlow — 13 edges, one of them a source', () => {
    buildFlow(sourcedEco, stocks, { grid: 0.85 }, sourcedFlow);
  });

  bench('ratesOf — with a source in the graph', () => {
    ratesOf(sourcedEco, stocks, sourcedFlow, sourcedOut);
  });
});
