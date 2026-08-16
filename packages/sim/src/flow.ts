/**
 * Rates, and the closed-form integrator that consumes them.
 *
 * > **The economy has no tick.** State is `(vector, rates, anchor)` and is *integrated on read*.
 *
 * A function that steps the economy N times is a bug, not a slow implementation: it answers
 * differently at different frame rates, and it cannot answer "where would this player be after
 * fourteen hours away?" without doing fourteen hours of work.
 *
 * ## Why a closed form exists at all
 *
 * `graph` guarantees the edges point strictly forward, so written as `dx/dt = A·x` the matrix
 * `A` is strictly triangular and therefore **nilpotent**: `A^(depth+1) = 0`. Then
 *
 * ```
 * x(t) = exp(A·t)·x₀ = Σ_{k≥0} A^k x₀ tᵏ / k!
 * ```
 *
 * is a **terminating polynomial** of degree `eco.depth`, not a series anyone truncates. There
 * is no step size here to get wrong and no stiffness to be afraid of, and the "matrix
 * exponential" never calls `exp` — it is `+ − × ÷` throughout, which is **Tier A**: bit-
 * identical on every conforming engine given the same rates.
 *
 * ## What a `Flow` is, and the two ways to break it
 *
 * A `Flow` is a mutable scratchpad belonging to exactly one simulated world. Two states advanced
 * at the same time need two of them, or their intermediate matrix powers interleave and produce
 * garbage that is not obviously garbage. And the rates inside it are **cached**: rebuild with
 * {@link buildFlow} whenever anything feeding a rate has moved — a purchase, a milestone,
 * nightfall, a brownout — or the sun goes down and the oil does not start burning until the
 * player's next click.
 *
 * Isomorphic: no clock, no randomness, no platform.
 */

import { expectFinite } from '@lattice/core';
import type { Economy, Stocks, StockVec } from './graph.js';

/**
 * Read a typed-array slot as the number it always is.
 *
 * `noUncheckedIndexedAccess` types every typed-array read as `number | undefined`, and the
 * tempting fix is a `!` — which in the source game shipped a black screen to two of four
 * biomes, because the type was the bug report and someone silenced it. This is the honest
 * version, in one place, so the redundant branch exists once rather than fifteen times. Every
 * index passed here is derived from an array's own length or from `Economy.index`, both of
 * which are in range by construction.
 */
function slot(array: Float64Array | Int32Array, index: number): number {
  return array[index] ?? 0;
}

/**
 * The evaluated rate of every edge, plus the integrator's workspace.
 *
 * One `Flow` per simulated world; see the module header for what sharing one costs. **Treat
 * everything but `rates` as opaque** — the remaining fields are the integrator's and the root
 * finder's scratch, they are sized against one particular {@link Economy}, and writing to them
 * corrupts the next integration rather than the current one, which is the hardest kind of bug
 * to trace back.
 */
export interface Flow {
  /** Effective rate per edge, parallel to `Economy.edges`. Never resized. */
  readonly rates: Float64Array;
  /** Workspace: `Economy.index[edge.from]` per edge slot. Opaque. */
  readonly edgeFrom: Int32Array;
  /** Workspace: `Economy.index[edge.to]` per edge slot. Opaque. */
  readonly edgeTo: Int32Array;
  /** Workspace: the accumulating Taylor sum, one slot per node. Opaque. */
  readonly acc: Float64Array;
  /** Workspace: the polynomial coefficients of a single node's trajectory. Opaque. */
  readonly poly: Float64Array;
  /**
   * Workspace: `A^k x₀` and `A^(k+1) x₀`.
   *
   * Deliberately mutable and deliberately a pair — the integrator swaps the two references
   * rather than copying a vector on every matrix application, which is what keeps the hot path
   * free of both allocation and a `width`-length memcpy per term.
   */
  term: Float64Array;
  /** Workspace: the other half of the swap pair. Opaque. */
  next: Float64Array;
}

/**
 * Allocate the workspace for one simulated world.
 *
 * Call it once per world at load, next to {@link defineEconomy}'s result, and keep it. It is the
 * only allocation in the per-frame path of this package, and it happens before the first frame.
 */
export function createFlow<N extends string, G extends string>(eco: Economy<N, G>): Flow {
  const width = eco.order.length;
  const count = eco.edges.length;
  const edgeFrom = new Int32Array(count);
  const edgeTo = new Int32Array(count);
  for (const edge of eco.edges) {
    edgeFrom[edge.slot] = eco.index[edge.from];
    edgeTo[edge.slot] = eco.index[edge.to];
  }
  return {
    rates: new Float64Array(count),
    edgeFrom,
    edgeTo,
    acc: new Float64Array(width),
    poly: new Float64Array(eco.depth + 1),
    term: new Float64Array(width),
    next: new Float64Array(width),
  };
}

/** The ratios in force, one per declared gate. `1` is healthy; `0` stops the tagged edges. */
export type GateRatios<G extends string> = Readonly<Record<G, number>>;

/**
 * For an economy with no gates.
 *
 * Frozen, and a single shared instance: an economy without gates reads nothing out of it, so
 * there is nothing to allocate per frame and nothing a caller could usefully put in.
 */
export const NO_GATES: GateRatios<never> = Object.freeze({});

/**
 * Reject a `Flow` that was built for a different economy.
 *
 * Two worlds sharing one `Flow` is trap 14 and produces garbage that is not obviously garbage.
 * The cheap half of that mistake — a `Flow` whose slot count does not match the graph — is
 * catchable with one integer comparison, so it is caught rather than documented.
 */
function expectMatched<N extends string, G extends string>(
  eco: Economy<N, G>,
  flow: Flow,
  label: string,
): void {
  if (flow.rates.length !== eco.edges.length || flow.acc.length !== eco.order.length) {
    throw new RangeError(
      `${label}: this Flow was made for a different economy (${String(flow.rates.length)} edge slots and ${String(flow.acc.length)} nodes, against ${String(eco.edges.length)} and ${String(eco.order.length)}) — one Flow per simulated world, from createFlow(eco)`,
    );
  }
}

/**
 * Fold `per × scale(stocks) × gateRatio` into `out.rates`.
 *
 * Cheap and allocation-free: one pass over tens of edges. Call it whenever **anything** that
 * feeds a rate has moved — a purchase, a milestone, nightfall, a brownout. Forgetting to call
 * it after a gate reading changes is the bug where the sun goes down and the oil does not start
 * burning until the player's next click.
 *
 * The multiplication order is fixed here — `per`, then `scale`, then the gate, and the identity
 * factors are skipped rather than multiplied — so a gate ratio of `r` is bit-identical to the
 * same graph with that edge's `per` pre-multiplied by `r` and no gate at all. A gate is exactly
 * a rate multiplier and nothing subtler.
 *
 * Tier A.
 *
 * @throws RangeError if a declared gate is missing from `gates` or is not finite, or if an
 *   `EdgeScale` returns a non-finite factor. An `undefined` ratio becomes `NaN`, and a `NaN` in
 *   a stock vector is a corrupted save that no later call can repair.
 */
export function buildFlow<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  gates: GateRatios<G>,
  out: Flow,
): Flow {
  expectMatched(eco, out, 'sim.buildFlow');
  for (const gate of eco.gates) {
    const ratio = gates[gate];
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
      throw new RangeError(
        `sim.buildFlow: gates.${gate} is ${String(ratio)} — every gate declared on the economy needs a finite ratio in this call, because an undefined one becomes NaN and a NaN reaches the save`,
      );
    }
  }
  const rates = out.rates;
  for (const edge of eco.edges) {
    let rate = edge.per;
    const scale = edge.scale;
    if (scale !== undefined) {
      const factor = scale(stocks);
      expectFinite(factor, `sim.buildFlow: scale for edge ${edge.from} → ${edge.to}`);
      rate *= factor;
    }
    const gate = edge.gate;
    if (gate !== undefined) rate *= gates[gate];
    rates[edge.slot] = rate;
  }
  return out;
}

/**
 * Integrate the whole vector forward by `seconds`, exactly, in one step.
 *
 * Evaluates `x(t) = Σ_k A^k x₀ tᵏ/k!`, which terminates after `eco.depth` terms because `A` is
 * nilpotent. Uses only `+ − × ÷`: **Tier A**, bit-identical across engines given the same rates,
 * and therefore safe to persist.
 *
 * Composes exactly the way the underlying flow map does: integrating `t₁ + t₂` once and
 * integrating `t₁` then `t₂` agree in exact arithmetic and differ only by accumulated double
 * rounding — about 1e-13 relative, asserted at 1e-9. That identity is what makes one fourteen-
 * hour catch-up and fifty thousand one-second steps the same code path, and it is the reason
 * there is no clamp anywhere in this function: a clamp is a nonlinearity, the result would stop
 * being the integral of anything, and the discrepancy would depend on how often you called it.
 * Solve for the crossing instead and put a boundary there.
 *
 * @param seconds - Non-positive is a **bit-identical copy** of `stocks` into `out`: clocks are
 *   not monotonic across machines or across a laptop suspend, and time appearing to run
 *   backwards must never mint or destroy resources.
 * @param out - May alias `stocks`; the whole vector is read before anything is written.
 * @throws RangeError if `seconds` is not finite. Silently producing `NaN` stocks corrupts a save.
 * @returns `out`, so a caller can chain. Allocates nothing.
 */
export function integrate<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  seconds: number,
  out: StockVec<N>,
): StockVec<N> {
  expectFinite(seconds, 'sim.integrate: seconds');
  expectMatched(eco, flow, 'sim.integrate');

  const acc = flow.acc;
  let term = flow.term;
  let next = flow.next;
  const width = eco.order.length;
  const edgeCount = eco.edges.length;

  let read = 0;
  for (const node of eco.order) {
    const value = stocks[node];
    acc[read] = value;
    term[read] = value;
    read += 1;
  }

  if (seconds > 0) {
    const rates = flow.rates;
    const edgeFrom = flow.edgeFrom;
    const edgeTo = flow.edgeTo;
    let coefficient = 1;
    for (let k = 1; k <= eco.depth; k += 1) {
      next.fill(0);
      let live = false;
      for (let e = 0; e < edgeCount; e += 1) {
        const contribution = slot(rates, e) * slot(term, slot(edgeFrom, e));
        if (contribution !== 0) {
          const target = slot(edgeTo, e);
          next[target] = slot(next, target) + contribution;
          live = true;
        }
      }
      if (!live) break;
      coefficient *= seconds / k;
      for (let j = 0; j < width; j += 1) {
        const value = slot(next, j);
        if (value !== 0) acc[j] = slot(acc, j) + value * coefficient;
      }
      const swap = term;
      term = next;
      next = swap;
    }
  }

  flow.term = term;
  flow.next = next;

  let write = 0;
  for (const node of eco.order) {
    out[node] = slot(acc, write);
    write += 1;
  }
  return out;
}

/**
 * `dx/dt` at this instant — what a HUD prints as "per second".
 *
 * This is the derivative **now** and nothing else. Multiplying it by elapsed time is the classic
 * wrong answer: production arriving during the next minute makes the real accrual super-linear,
 * so the number a player is shown and the number they get disagree — in the player's disfavour,
 * by more the better they are doing. To answer "how much in the next minute", integrate 60 and
 * subtract.
 *
 * Tier A, allocation-free, and safe against `out` aliasing `stocks`.
 *
 * @returns `out`, so a caller can chain.
 */
export function ratesOf<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  out: StockVec<N>,
): StockVec<N> {
  expectMatched(eco, flow, 'sim.ratesOf');
  const term = flow.term;
  let read = 0;
  for (const node of eco.order) {
    term[read] = stocks[node];
    read += 1;
  }
  for (const node of eco.order) out[node] = 0;
  for (const edge of eco.edges) {
    out[edge.to] += slot(flow.rates, edge.slot) * slot(term, eco.index[edge.from]);
  }
  return out;
}
