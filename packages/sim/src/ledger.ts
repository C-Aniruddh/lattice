/**
 * The ledger, the calendar, and the seam with `@latticekit/loop`.
 *
 * `sim`'s entire state is one value: a stock vector and the instant it is true at. Everything
 * else in this package is a function of that value and a number the caller passes in.
 *
 * ## The four rules, each a bug if broken in either direction
 *
 * 1. **The integrator is driven from a stored epoch timestamp, never from summed `dt`.** This
 *    package exposes **no function that takes a delta**. `project` and `advance` take an
 *    *instant* and derive the interval from the ledger, so a builder who sees `dt` in `update()`
 *    and reaches for it finds no signature to put it in. That is the intended shape of the
 *    refusal, not an oversight.
 * 2. **`loop`'s catch-up clamp must never touch the number handed to `sim`.** They bound
 *    different things: `loop`'s 250 ms clamp exists so a restored tab does not run 216,000 fixed
 *    steps in one frame; `sim`'s warp exists so eight hours of sleep is worth about five.
 *    Passing `loop`'s clamped or dropped time here silently steals the player's entire night,
 *    and it looks exactly like a working game.
 * 3. **`sim` never runs inside the fixed-step tick.** It is integrated on read. `advance` inside
 *    `loop.step` reinvents the tick and makes the economy a function of frame rate — and, given
 *    rule 2, of whether the tab was visible. Wire it as: {@link project} in render, {@link
 *    advance} in the action handler and at hydrate.
 * 4. **`loop` owns the wake cadence; `sim` owns what the wake is worth.** Neither package
 *    imports the other, and neither should: they are siblings in the layer graph.
 *
 * ## The saved-at seam
 *
 * | question | answer |
 * |---|---|
 * | what does accrual read? | **`ledger.atMs`, and only that.** It is the instant the *vector* is true at |
 * | is that a save envelope's write stamp? | **No, and conflating them is the bug.** The stamp is when the record was *written*; the anchor is when the numbers were last *true*. A debounced write 30 s after the last `advance` makes them differ by 30 s |
 * | which is right for the gap? | The anchor. Using the stamp pays a debounce interval twice, or steals it, depending on which way the two drift — every session, invisibly |
 * | how do I make them agree? | `advance` immediately before handing state to a writer. Then the stamp equals the anchor, and any mismatch is a bug a test can assert on |
 *
 * Isomorphic, and reads no clock: every entry point that moves the anchor takes `atMs` as a
 * **required, non-optional** parameter. There is no overload without it and no default, so
 * omitting it is a compile error rather than an elapsed time of fifty-six years.
 */

import { isSerializable, type EpochMillis } from '@latticekit/core';
import type { Economy, Stocks, StockVec } from './graph.js';
import { zeroStocks } from './graph.js';
import { integrate, type Flow } from './flow.js';

/**
 * A stock vector and the instant it is true at. This is the whole of `sim`'s state, and it is a
 * value — JSON-round-trippable as-is, which is what `@latticekit/persist` writes.
 *
 * `atMs` is an **epoch** timestamp and nothing else will do. Not `loop.time`, not a duration
 * accumulated on the fixed step, not a monotonic reading: those have no calendar, run at roughly
 * quarter speed in a hidden tab, and compare against a different zero after a reload. `core`
 * brands `EpochMillis` precisely so that substitution is a compile error.
 */
export interface Ledger<N extends string> {
  readonly stocks: Stocks<N>;
  readonly atMs: EpochMillis;
}

/**
 * Render a received value for an error message without risking a second throw.
 *
 * A `${symbol}` in a template literal throws a `TypeError` of its own, and an error raised
 * *while building an error message* is the worst possible way to learn about a bad save.
 */
function show(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/**
 * Validate a stock vector, returning it. `guard`-shaped, for the same reason `core`'s validators
 * are: a boolean has already thrown away the node that was wrong.
 *
 * Call it on anything that came out of `JSON.parse`. A `null` where a number should be (an
 * `Infinity` that made a round trip) and a `NaN` (which `JSON.stringify` also writes as `null`)
 * are both caught here, at the one boundary where the value can still be blamed on the save
 * rather than on the arithmetic.
 *
 * **A stock at `Infinity` means the economy has no answer, not that it has a very large one.**
 * It cannot be rendered, compared or spent, and it becomes a `NaN` downstream on the first
 * `0 × ∞`, which poisons every comparison in the game. Growth here is *polynomial* in elapsed
 * time, so no single absence can carry a sane balance to 1.8e308; what can is compounding across
 * sessions in a graph with no sink, which is exponential in *session count*. A throw from here is
 * therefore a balance report, and it is designed to arrive at `persist`'s "corrupt save → fresh,
 * with a reported reason" path rather than at a player.
 *
 * @param label - the caller's symbol. `'sim.load'` produces
 *   `sim.load: stocks.oil is not finite (null)`.
 * @throws RangeError naming the first offending node, in storage order.
 */
export function expectFiniteStocks<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  label: string,
): Stocks<N> {
  for (const node of eco.nodes) {
    const value: number = stocks[node];
    if (!isSerializable(value)) {
      throw new RangeError(
        `${label}: stocks.${node} is not finite (${show(value)}) — JSON.stringify writes null for NaN and both infinities, so this value would save with a valid checksum and load as a hole`,
      );
    }
  }
  return stocks;
}

/**
 * `(atMs − ledger.atMs) / 1000`, clamped at zero. The one place the ms→s conversion lives.
 *
 * Clamped rather than absolute: laptop suspends, NTP corrections and a user changing their
 * system date all produce an `atMs` behind the anchor, and `Math.abs` of that would run the
 * economy forwards for time that did not pass. Zero, never negative.
 *
 * @throws RangeError if either instant is not finite — a `NaN` here becomes `NaN` stocks, and by
 *   the time that reaches a save there is nothing left to blame it on.
 */
export function elapsedSeconds<N extends string>(ledger: Ledger<N>, atMs: EpochMillis): number {
  if (!isSerializable(atMs)) {
    throw new RangeError(`sim.elapsedSeconds: atMs is not finite (${show(atMs)})`);
  }
  if (!isSerializable(ledger.atMs)) {
    throw new RangeError(
      `sim.elapsedSeconds: ledger.atMs is not finite (${show(ledger.atMs)}) — an anchor out of a save is the value to validate at load, not at the first frame that needs it`,
    );
  }
  const gap = (atMs - ledger.atMs) / 1000;
  return gap > 0 ? gap : 0;
}

/**
 * Integrate to an instant **without committing**, into a caller-owned vector.
 *
 * This is what a HUD calls every frame. It changes nothing, allocates nothing, and always
 * integrates from the same anchor — so the answer is one expression evaluated at a later `t`,
 * not an accumulation. Folding a per-frame projection back into the anchor is arithmetically
 * fine and *reproducibility poison*: the state then depends on how many frames the player's
 * laptop managed, which is the end of replay from a seed and an input log.
 *
 * Deliberately does **not** check the result for finiteness. This is per-frame, and a non-finite
 * `out` is garbage on screen for one frame, which is visible and harmless. The check belongs at
 * the boundary between a number and a *durable* number — see {@link advance}.
 *
 * @returns the seconds integrated — `elapsedSeconds(ledger, atMs)`, i.e. `0` for a backwards clock.
 */
export function project<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  atMs: EpochMillis,
  out: StockVec<N>,
): number {
  const seconds = elapsedSeconds(ledger, atMs);
  integrate(eco, ledger.stocks, flow, seconds, out);
  return seconds;
}

/**
 * Move the anchor, crediting `creditedSeconds` of production.
 *
 * Two parameters, deliberately: the anchor always lands on `atMs`, and the production credited
 * for getting there is whatever the caller says. Live play passes `elapsedSeconds(...)`. An
 * absence with a schedule uses `advanceOver` instead, which is the only function in this package
 * permitted to apply a warp, because distributing one across phases is the thing you must not do
 * by hand.
 *
 * An `atMs` earlier than the anchor returns the ledger **unchanged** — it neither credits nor
 * moves the anchor backwards, because an anchor that can be walked back is an interval that can
 * be credited twice. Correcting a bad clock is {@link reanchor}, deliberately a different call.
 *
 * Allocates one `Ledger` and one vector. It is a boundary call — an action, a save, a hydrate —
 * not a per-frame one.
 *
 * @throws RangeError if the resulting vector is not finite, naming the node. One pass over the
 *   nodes at a boundary call is free, and the alternative is writing an `Infinity` that
 *   serializes to `null` with a perfectly valid checksum.
 */
export function advance<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  creditedSeconds: number,
  atMs: EpochMillis,
): Ledger<N> {
  if (!isSerializable(atMs)) {
    throw new RangeError(`sim.advance: atMs is not finite (${show(atMs)})`);
  }
  if (atMs < ledger.atMs) return ledger;
  const out = zeroStocks(eco);
  integrate(eco, ledger.stocks, flow, creditedSeconds, out);
  expectFiniteStocks(eco, out, 'sim.advance');
  return { stocks: out, atMs };
}

/**
 * Move the anchor **without crediting anything**, in either direction.
 *
 * The clock-correction tool, and the only function here that may move an anchor backwards.
 * {@link advance} deliberately refuses to.
 *
 * It exists because of the forward clock jump. A phone whose date is a year ahead hands the game
 * a gap of 31.5 million seconds; the *credit* for that is capped by the offline curve's flat
 * branch, but the **anchor** is not — it lands a year in the future, and when the clock is
 * corrected every subsequent read sees time running backwards and credits zero. **The economy
 * then freezes for a year**, with no error and a save that looks fine. That is the more damaging
 * half of a forward jump and no cap on the credit prevents it.
 *
 * So: a game that detects `atMs < ledger.atMs` by more than a plausible drift — a few seconds of
 * NTP correction — calls this, keeps its stocks, forfeits nothing it had earned, and is running
 * again on the next frame. Only the game knows its own session cadence, so only the game can set
 * that threshold.
 *
 * @throws RangeError if `atMs` is not finite.
 */
export function reanchor<N extends string>(ledger: Ledger<N>, atMs: EpochMillis): Ledger<N> {
  if (!isSerializable(atMs)) {
    throw new RangeError(`sim.reanchor: atMs is not finite (${show(atMs)})`);
  }
  return { stocks: ledger.stocks, atMs };
}
