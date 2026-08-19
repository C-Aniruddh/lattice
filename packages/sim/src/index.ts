/**
 * @latticekit/sim — Idle-economy mathematics in closed form: cost curves, the flow integrator,
 * offline accrual, capacity gating, and the instant a stock runs out.
 *
 * **`sim` is the arithmetic of an idle economy in closed form — a production graph you can
 * integrate in one step, a cost curve you can invert, an offline warp on time, capacity gating,
 * and the instant a stock runs out — with no tick, no clock and no state of its own.**
 *
 * The load-bearing half of that sentence is *closed form*, and the unifying rule the rest of the
 * package is a consequence of:
 *
 * > **Everything in `sim` is linear between commits.** Gates, milestones, clamps, purchases,
 * > nightfall and a stock hitting zero are the discontinuities, and every one of them is a
 * > *boundary* — an instant at which the caller re-enters. That is what makes one integration of
 * > fourteen hours equal to fifty thousand integrations of one second.
 *
 * A boundary is not a tick. A tick's cost scales with elapsed time; a boundary's cost scales with
 * **how many interesting things happened**, and this package's job is to find those instants
 * exactly rather than to walk past them at 60 Hz hoping to notice.
 *
 * ## What "linear" does and does not rule out — read this before concluding your rate is impossible
 *
 * > **A rate may be any expression you like — `√`, thresholds, milestones, capacity shares, a
 * > curve read off a spreadsheet — as long as it is *piecewise constant in time*.** `EdgeScale` is
 * > where those expressions go, and it is the sanctioned way to write them, not a workaround: it
 * > is evaluated **once per {@link buildFlow}** and frozen for the integration that follows, so
 * > rebuild at every boundary. The one rate `sim` refuses is one that reads a **stock this graph
 * > produces**, because that is a discontinuity inside an integral and it makes the same save
 * > answer two ways.
 *
 * The distinction is what the rate is a function *of*, never what shape it has:
 *
 * | a real idle-game rate | function of | legal |
 * |---|---|---|
 * | every 10th press doubles all presses | a purchased count | yes — `scale: () => milestoneMultiplier(bought, MILESTONES)` |
 * | output scales with `√(prestige)` | a banked, player-facing total | yes — `scale: () => Math.sqrt(prestige)` |
 * | producers above 100 get 3× | a purchased count | yes — a threshold inside `scale` |
 * | income scales with how far the road reaches | a length the player extends by tapping | yes — and with no `from`, it is a **source** |
 * | output ∝ `√(coin you currently hold)` | **a stock this graph produces** | **no, and it must stay no** |
 *
 * And a rate may multiply **nothing at all**: an {@link EdgeSpec} with no `from` is a *source*,
 * `d(to)/dt += per × scale × gate`. That is what an idle economy's headline rate usually is, and
 * writing it any other way — nominating a `from` and dividing it back out in `scale` — puts a
 * node in `EconomySpec.nodes`, which is *the save's field order*, purely to be a multiplicand.
 *
 * Isomorphic — it runs unchanged in Node with no shims, reads no clock, and takes no delta.
 *
 * The public surface of this package. Every symbol a consumer may use is re-exported here and
 * nowhere else; `.lattice/kit.json` lists them, and `npm run lint` keeps that list honest.
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.1';

// ── the graph ───────────────────────────────────────────────────────────────────
//
// Declared node order is the *save's* field order; evaluation order is computed by Kahn and
// therefore proven. Keeping them apart is what lets a v4 node be appended without moving a v1
// save's fields.

export { defineEconomy, zeroStocks, degreeOf } from './graph.js';
export type { Stocks, StockVec, EdgeScale, EdgeSpec, EconomySpec, Edge, Economy } from './graph.js';

// ── rates and the integrator ────────────────────────────────────────────────────
//
// `exp(At)` for a nilpotent `A` is a terminating polynomial, so the "matrix exponential" never
// calls `exp`: Tier A, bit-identical, safe to persist.

export { createFlow, buildFlow, NO_GATES, integrate, ratesOf } from './flow.js';
export type { Flow, GateRatios } from './flow.js';

// ── the ledger and the calendar ─────────────────────────────────────────────────
//
// Every entry point that moves the anchor takes a required `EpochMillis`, so a frame delta has
// nowhere to go. Accrual reads `ledger.atMs` and never a save envelope's write stamp.

export { elapsedSeconds, project, advance, reanchor, expectFiniteStocks } from './ledger.js';
export type { Ledger } from './ledger.js';

// ── the offline warp ────────────────────────────────────────────────────────────
//
// A warp on time, never on yield. The flat branch of the softcap is the upper clamp on the gap,
// and it is the whole of it.

export { offlineCredit, offlineElapsed, maxOfflineCredit, offlineCreditRate } from './offline.js';
export type { OfflineCurve } from './offline.js';

// ── schedules and crossings ─────────────────────────────────────────────────────
//
// `W` is applied once per absence and distributed across phases by evaluation at their
// boundaries. `CatchUp.fromSeconds` is what makes a partially-consumed absence resumable without
// restarting it.

export { advanceOver, solveCrossingOver } from './schedule.js';
export type { Phase, CatchUp, Crossing } from './schedule.js';
export { solveCrossing } from './crossing.js';

// ── capacity ────────────────────────────────────────────────────────────────────
//
// Two curves that are not interchangeable: a wall you must fear, and a share that merely limits.

export { capacityWall, capacityShare, capacityLoad } from './capacity.js';
export type { CapacityCurve } from './capacity.js';

// ── cost ────────────────────────────────────────────────────────────────────────
//
// Exponentiation by squaring, not `Math.pow`: for a number a player is charged, reproducible beats
// one ulp more accurate.

export { costOfNext, bulkCost, maxBuyable, milestoneMultiplier } from './cost.js';
export type { CostCurve, Milestones } from './cost.js';

// ── entity ids ──────────────────────────────────────────────────────────────────
//
// A saved counter, never reused. A time-derived id cannot replay and a random one would draw from
// a stream something else is also drawing from.

export { createIdSource, mintId, asEntityId } from './ids.js';
export type { EntityId, IdSource } from './ids.js';
