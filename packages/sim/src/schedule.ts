/**
 * An alternating rate, warped, without a tick — and the crossings hidden inside it.
 *
 * Production runs at one rate by day and another by night, and the boundaries move, because
 * every night is longer than the last. A constant-rate accrual warp is the obvious offline design
 * and it cannot cross those boundaries. This module is the shape that can.
 *
 * ## The insight
 *
 * `W` warps a scalar, so it **distributes across a partition of the absence by evaluation at the
 * boundaries, not by re-application.** For an absence `[0, T]` cut into phases
 * `0 = a₀ < a₁ < … < a_K = T`, phase *i* is credited
 *
 * ```
 *     W(a_{i+1}) − W(a_i)          seconds
 * ```
 *
 * and the pieces sum to exactly `W(T)`, because the sum telescopes. `W` is evaluated at **absolute
 * offsets from the start of the absence and never restarted**, so the once-per-return rule is not
 * merely preserved — it is the mechanism. Each piece is then one exact closed-form integration
 * with that phase's gate ratios in force.
 *
 * ## Why this is not a tick
 *
 * A tick's step size is arbitrary and its count scales with elapsed time; halving the step changes
 * the answer, and the answer *converges* rather than being right. Here the pieces are the instants
 * at which the rate actually changed — nightfall, dawn, a purchase, a lamp guttering — every piece
 * is integrated exactly, and a schedule with no changes is one step however long the absence.
 *
 * ## The schedule itself is the game's
 *
 * `sim` does not generate one, does not know what a day is, and has no calendar. It consumes
 * `Phase[]`. A cycle clock is about eight lines of game code and they are the right eight lines to
 * write in the game.
 *
 * Isomorphic: no clock, no randomness, no platform.
 */

import { clamp, isSerializable, expectFinite, expectNonEmpty, type EpochMillis } from '@lattice/core';
import type { Economy, StockVec } from './graph.js';
import { zeroStocks } from './graph.js';
import { buildFlow, integrate, type Flow, type GateRatios } from './flow.js';
import { expectFiniteStocks, type Ledger } from './ledger.js';
import { offlineCredit, offlineElapsed, type OfflineCurve } from './offline.js';
import { solveCrossing } from './crossing.js';

/** One piece of a piecewise-constant schedule. */
export interface Phase<G extends string> {
  /**
   * Offset in seconds from the **start of the absence** at which this phase begins. Strictly
   * ascending across the array, and the first must be `0`.
   *
   * The start of the absence is the ledger's anchor when {@link CatchUp.fromSeconds} is `0`, and
   * `ledger.atMs − fromSeconds·1000` otherwise. That is deliberate: the phase array is generated
   * once, from the game's day/night clock, and stays valid across every re-entry into the same
   * absence even though the ledger's anchor moves each time.
   */
  readonly atSeconds: number;
  /** The gate ratios in force during it. */
  readonly gates: GateRatios<G>;
}

/**
 * An absence, and the schedule that ran during it.
 *
 * The coordinate system is **real seconds from the start of the absence**. `fromSeconds` says
 * where the ledger's anchor currently sits in it and `spanSeconds` says where this call stops;
 * the phases are absolute in the same frame and never need re-basing.
 */
export interface CatchUp<G extends string> {
  /**
   * How much of the absence has **already been credited**, in real seconds from its start.
   *
   * Required, not optional, and the reason is an exploit rather than an ergonomic. Every guttered
   * lamp is a commit partway through an absence: the crossing is discovered, the game advances to
   * it, extinguishes a lamp, rebuilds the flow, and comes back in for the rest. Re-entering with a
   * fresh `spanSeconds` and no `fromSeconds` **restarts `W`** — the player is paid for K absences
   * instead of one, and because each restart begins in the uncapped region again, each one is
   * *cheaper* in real time than the last. The exploit climbs back in through the very function
   * written to close it.
   *
   * The credit for a call is `W(spanSeconds) − W(fromSeconds)`, which telescopes across the whole
   * re-entry sequence to exactly `W(T)` — one absence, paid once, however many boundaries were
   * discovered inside it. {@link Crossing.atSeconds} is in these coordinates precisely so it can
   * be handed straight back as the next call's `fromSeconds`.
   *
   * Writing `fromSeconds: 0` is the deliberate act that says "this is the start of the absence".
   * A reviewer can grep for the field and see every re-entry in the codebase.
   */
  readonly fromSeconds: number;
  /** The **real-time** span of the absence in seconds — `elapsedSeconds(ledger, atMs)`. */
  readonly spanSeconds: number;
  /**
   * Ascending phases covering `[0, min(spanSeconds, curve.flatAfterSeconds)]`.
   *
   * Generating phases beyond the horizon is harmless and pointless: every one of them credits
   * exactly zero seconds, and the walk stops before visiting them. That bound is what keeps this
   * finite — for 45 s days and `15 + 9d` second nights, a 24-hour horizon is about 270 pieces, and
   * **so is a six-month absence**.
   */
  readonly phases: readonly Phase<G>[];
  /**
   * The warp, or an explicit `null` for live time.
   *
   * **Required and nullable rather than optional**, because this field is the upper clamp on the
   * offline gap and a forgotten optional is how a device clock jump becomes a finished game.
   * `null` says "I know this interval is short" — a live frame, an action boundary — and at a
   * hydrate seam it is always wrong. A reviewer can grep for it.
   */
  readonly curve: OfflineCurve | null;
}

/** Where a crossing landed, in both clocks. */
export interface Crossing {
  /**
   * **Real** seconds from the start of the absence — what a player experienced, and exactly what
   * {@link CatchUp.fromSeconds} takes on the next iteration of a guttering loop. `Infinity` if it
   * never crosses.
   */
  readonly atSeconds: number;
  /** **Credited** seconds from the start of the absence — where it sits in the physics. */
  readonly creditedSeconds: number;
  /** Index into `plan.phases`, or `-1` for no crossing. */
  readonly phase: number;
}

/** What a plan's walker hands to each piece it visits. Returning `false` stops the walk. */
type Visit<G extends string> = (
  phase: Phase<G>,
  index: number,
  fromSeconds: number,
  toSeconds: number,
  creditedSeconds: number,
) => boolean;

/**
 * Validate a plan and walk the pieces it actually covers, in order.
 *
 * A "piece" is a phase clipped to `[fromSeconds, min(spanSeconds, horizon)]`. Pieces that clip to
 * nothing are not visited at all — no `buildFlow`, no integration — which is what makes a
 * partially-consumed absence cost the same as a fresh one and a six-month absence cost the same as
 * a one-day one.
 *
 * The ascending check runs *as the walk proceeds* rather than over the whole array first. That is
 * deliberate: the horizon is meant to be a hard bound on **work**, and validating 100,000
 * generated phases to reach the 270 that matter would hand that bound straight back.
 */
function walkPlan<G extends string>(plan: CatchUp<G>, label: string, visit: Visit<G>): void {
  expectFinite(plan.fromSeconds, `${label}: plan.fromSeconds`);
  expectFinite(plan.spanSeconds, `${label}: plan.spanSeconds`);
  if (plan.fromSeconds < 0) {
    throw new RangeError(
      `${label}: plan.fromSeconds must be >= 0, got ${String(plan.fromSeconds)} — it is an offset into the absence, and a negative one would credit time before the absence began`,
    );
  }
  if (plan.spanSeconds < 0) {
    throw new RangeError(
      `${label}: plan.spanSeconds must be >= 0, got ${String(plan.spanSeconds)} — elapsedSeconds already clamps a backwards clock at zero`,
    );
  }
  expectNonEmpty(plan.phases, `${label}: plan.phases`);

  const curve = plan.curve;
  const horizon = curve === null ? Infinity : curve.flatAfterSeconds;
  const from = plan.fromSeconds;
  const to = Math.min(plan.spanSeconds, horizon);

  /** `W`, or the identity for live time. Evaluated at absolute offsets, never restarted. */
  const credit = (t: number): number => (curve === null ? t : offlineCredit(t, curve));

  let index = -1;
  let previousStart = 0;
  let openPhase: Phase<G> | undefined;
  let openIndex = 0;
  let openStart = 0;
  let stopped = false;

  /** Clip one phase's piece and hand it over. `false` means the caller is done. */
  const emit = (phase: Phase<G>, at: number, lo: number, hi: number): boolean => {
    const clipped = Math.max(lo, from);
    if (hi <= clipped) return true;
    return visit(phase, at, clipped, hi, credit(hi) - credit(clipped));
  };

  for (const phase of plan.phases) {
    index += 1;
    const start = phase.atSeconds;
    expectFinite(start, `${label}: plan.phases[${String(index)}].atSeconds`);
    if (index === 0) {
      if (start !== 0) {
        throw new RangeError(
          `${label}: plan.phases[0].atSeconds must be 0, got ${String(start)} — the phases partition the whole absence, so the first one begins where the absence does`,
        );
      }
    } else if (!(start > previousStart)) {
      throw new RangeError(
        `${label}: plan.phases[${String(index)}].atSeconds (${String(start)}) must be strictly greater than plan.phases[${String(index - 1)}].atSeconds (${String(previousStart)}) — a schedule that goes backwards would credit an interval twice`,
      );
    }
    previousStart = start;

    if (openPhase !== undefined) {
      if (!emit(openPhase, openIndex, openStart, Math.min(start, to))) {
        stopped = true;
        break;
      }
      openPhase = undefined;
    }
    if (start >= to) break;
    openPhase = phase;
    openIndex = index;
    openStart = start;
  }
  if (!stopped && openPhase !== undefined) emit(openPhase, openIndex, openStart, to);
}

/** Copy a ledger's stocks into a fresh mutable vector, in storage order. */
function copyStocks<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
): StockVec<N> {
  const out = zeroStocks(eco);
  for (const node of eco.nodes) out[node] = ledger.stocks[node];
  return out;
}

/**
 * Advance across a piecewise-constant schedule, applying the warp once across the whole span and
 * distributing it across the phases by evaluation at their boundaries.
 *
 * This takes a *curve* rather than a *number* — the opposite of `advance`, and the asymmetry is
 * the point. With one phase there is nothing to distribute and the caller may as well warp the
 * scalar itself. With a schedule, distributing the warp by hand is exactly the thing that goes
 * wrong: restarting `W` at each phase pays a player for K absences instead of one, it is
 * *invisible* for short gaps because `W` is the identity below `U`, and the error grows without
 * bound with the length of the absence.
 *
 * Cost is O(visited phases × edges × depth) — semantic boundaries, not fixed steps. Doubling the
 * length of the absence past the horizon does not change it at all: with a curve, the walk stops
 * at the first phase beginning at or after `curve.flatAfterSeconds`, because every later one
 * credits exactly zero. That makes the horizon a hard bound on work as well as on reward, so a
 * phase array generated from a bad device clock cannot cost anything either.
 *
 * An `atMs` earlier than the anchor returns the ledger **unchanged**, for the same reason
 * `advance` does. The anchor otherwise lands on `atMs` even when nothing was credited — a fully
 * consumed absence still happened.
 *
 * Leaves `flow` holding the last visited phase's rates. Rebuild it before the next live frame.
 *
 * @throws RangeError if the phases are empty, do not start at 0, are not strictly ascending, or
 *   name a gate the economy did not declare; if `fromSeconds` or `spanSeconds` is negative or not
 *   finite; or if the resulting vector is not finite, naming the node.
 */
export function advanceOver<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  plan: CatchUp<G>,
  atMs: EpochMillis,
): Ledger<N> {
  const label = 'sim.advanceOver';
  if (!isSerializable(atMs)) {
    throw new RangeError(`${label}: atMs is not finite (${String(atMs)})`);
  }
  if (atMs < ledger.atMs) return ledger;

  let current = copyStocks(eco, ledger);
  let spare = zeroStocks(eco);
  walkPlan(plan, label, (phase, _index, _from, _to, creditedSeconds) => {
    buildFlow(eco, current, phase.gates, flow);
    integrate(eco, current, flow, creditedSeconds, spare);
    const swap = current;
    current = spare;
    spare = swap;
    return true;
  });
  expectFiniteStocks(eco, current, label);
  return { stocks: current, atMs };
}

/**
 * The same solve as `solveCrossing`, across a whole schedule: walk the phases, integrate each
 * exactly, and solve inside the first one whose interior contains the crossing.
 *
 * The two clocks in {@link Crossing} are why this exists rather than being a loop in game code.
 * The physics happens in credited time; the sentence the player reads is in real time, and the map
 * between them is `offlineElapsed` evaluated at the phase's own offset. Getting that backwards
 * produces a toast that is confidently wrong about when the lights went out — by a factor that
 * grows the longer the player was away.
 *
 * Pass the **same plan** you will pass to {@link advanceOver}, including the same `fromSeconds`.
 * The two functions walk identically, so the crossing this reports is exactly the instant that one
 * will integrate to.
 *
 * Leaves `flow` holding the rates of the phase the crossing was found in — which is the flow the
 * caller wants anyway, since the next thing it does is commit at that instant.
 *
 * Allocates one `Crossing` and two stock vectors. A hydrate-boundary call.
 *
 * @throws RangeError on the same plan and node mistakes as {@link advanceOver}.
 */
export function solveCrossingOver<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  plan: CatchUp<G>,
  node: N,
  level: number,
): Crossing {
  const label = 'sim.solveCrossingOver';
  const curve = plan.curve;
  let current = copyStocks(eco, ledger);
  let spare = zeroStocks(eco);
  let found: Crossing = { atSeconds: Infinity, creditedSeconds: Infinity, phase: -1 };

  walkPlan(plan, label, (phase, index, from, to, creditedSeconds) => {
    buildFlow(eco, current, phase.gates, flow);
    const inside = solveCrossing(eco, current, flow, node, level, creditedSeconds);
    if (inside !== Infinity) {
      const credited = (curve === null ? from : offlineCredit(from, curve)) + inside;
      const real = curve === null ? credited : offlineElapsed(credited, curve);
      // Clamped into the piece it was found in: the inverse warp is a `pow` away from the forward
      // one, and an answer a rounding outside its own phase would read as the wrong night.
      found = { atSeconds: clamp(real, from, to), creditedSeconds: credited, phase: index };
      return false;
    }
    integrate(eco, current, flow, creditedSeconds, spare);
    const swap = current;
    current = spare;
    spare = swap;
    return true;
  });
  return found;
}
