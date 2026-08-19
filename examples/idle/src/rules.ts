/**
 * The economy this exhibit exists to show: a geometric cost, buy-max in closed form, and
 * fourteen hours of absence resolved by one `advanceOver` — never a loop of ticks.
 *
 * `sim` is the arithmetic. This file is the only place a number the player is playing for
 * moves. Deleting it stops the shop; deleting any art module does not.
 */
import { asEpochMillis } from '@latticekit/core';
import {
  advance, advanceOver, buildFlow, bulkCost, costOfNext, createFlow,
  defineEconomy, elapsedSeconds, maxBuyable, offlineCredit, project, zeroStocks,
} from '@latticekit/sim';
import type { CostCurve, Ledger, OfflineCurve } from '@latticekit/sim';

export const KILN: CostCurve = { base: 18, growth: 1.15 };
export const FOURTEEN = 14 * 3600;
export const START_CURVE: OfflineCurve = { uncappedSeconds: 3 * 3600, exponent: 0.625, flatAfterSeconds: 24 * 3600 };
export const RATE_IDLE = 1.2;
export const RATE_KILN = 0.8;
export const rateOf = (k: number): number => RATE_IDLE + RATE_KILN * k;

const eco = defineEconomy<'kiln' | 'coin', never>({
  nodes: ['kiln', 'coin'],
  edges: [{ to: 'coin', per: RATE_IDLE }, { from: 'kiln', to: 'coin', per: RATE_KILN }],
});

/** `now` is the one wall clock. It never reaches a tile or a hash. */
export function makeShop(now: () => number) {
  const flow = createFlow(eco);
  const view = zeroStocks(eco);
  const curve = { value: { ...START_CURVE } };
  const last = { wall: 0, credited: 0, steps: 0, aways: 0 };
  let ledger: Ledger<'kiln' | 'coin'> = { stocks: { kiln: 8, coin: 220 }, atMs: asEpochMillis(now()) };
  buildFlow(eco, ledger.stocks, {}, flow);
  const at = (): ReturnType<typeof asEpochMillis> => asEpochMillis(now());
  const commit = (): void => { const t = at(); ledger = advance(eco, ledger, flow, elapsedSeconds(ledger, t), t); };
  return {
    curve, last,
    read() { project(eco, ledger, flow, at(), view); return view; },
    price: () => costOfNext(KILN, ledger.stocks.kiln),
    maxN() { project(eco, ledger, flow, at(), view); return maxBuyable(KILN, ledger.stocks.kiln, view.coin, 1_000_000); },
    buy(n: number) {
      commit();
      const want = Math.max(1, n | 0);
      const cost = bulkCost(KILN, ledger.stocks.kiln, want);
      if (!(cost <= ledger.stocks.coin)) return false;
      ledger = { stocks: { kiln: ledger.stocks.kiln + want, coin: ledger.stocks.coin - cost }, atMs: ledger.atMs };
      buildFlow(eco, ledger.stocks, {}, flow);
      return true;
    },
    away() {
      // One plan, one step. `fromSeconds: 0` names the start of this absence.
      commit();
      ledger = advanceOver(eco, ledger, flow, {
        fromSeconds: 0, spanSeconds: FOURTEEN, phases: [{ atSeconds: 0, gates: {} }], curve: curve.value,
      }, at());
      last.wall = FOURTEEN;
      last.credited = offlineCredit(FOURTEEN, curve.value);
      last.steps = 1;
      last.aways += 1;
      return last;
    },
    would: () => offlineCredit(FOURTEEN, curve.value),
  };
}
