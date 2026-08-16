/**
 * Time as a parameter, and the two units this package speaks.
 *
 * Nothing here reads a clock. That is the whole point: `lint` bans `Date.now()` and
 * `performance.now()` inside every package's `src/`, so somebody outside the kit reads the
 * host clock exactly once and hands the reading down. A game passes
 * `{ now: () => performance.now() }`; a test passes {@link manualClock} and runs a simulated
 * hour in a microsecond with no fake-timer library anywhere.
 *
 * The unit boundary is here and nowhere else: **options in milliseconds, callbacks in
 * seconds.** A game's own constants read as "0.4 s of hop" and "12 s to build", and writing
 * those in milliseconds is how a duration gets typo'd by a factor of a thousand; a host
 * clock, meanwhile, is milliseconds on every platform that has one. Converting at the
 * boundary costs one divide and removes the ambiguity from every call site inside.
 *
 * **Both units are a plain `number`, and the parameter name is the entire defense.** This
 * package deliberately exports no `Millis` or `Seconds` alias: an alias over `number` checks
 * nothing, and a name in the manifest that looks like a guarantee is read as one — `Millis`
 * sat beside `Loop` and `Scheduler` in `.lattice/kit.json` and was twice mistaken for a brand
 * that would refuse a hand-typed step. A brand separates two *kinds* of value; a duration has
 * one kind and only a wrong number of them, so there is nothing here for a type to separate.
 * Write `after(3000, …)` against a callback measured in seconds and you have written fifty
 * minutes; the last word of the parameter name is what tells you, and nothing else can.
 * `docs/rfc/durations.md` has the reasoning and the three tiers.
 *
 * Tier A: `+ - * /` and comparison only. No transcendentals, no platform, no allocation
 * after construction.
 */

import { expectFinite } from '@lattice/core';

/**
 * The host's clock, injected.
 *
 * Must be **monotonic**: two calls in a row must never go backwards. `performance.now()`
 * qualifies; `Date.now()` does not — an NTP correction or a user changing the system clock
 * moves it backwards, and a loop that accumulates a negative delta stops firing timers for
 * however long the jump was. If you inject `Date.now()` anyway, the loop clamps negative
 * deltas to zero (invariant I-6) and you lose that much game time rather than the loop.
 *
 * This clock is **not** the calendar and must never be used as one. It may or may not
 * advance while the machine is asleep — that is platform-dependent — which is precisely why
 * `@lattice/sim` keeps its own epoch timestamp and why this package credits nothing. There is
 * deliberately no second method here and no `loop.epoch`: the moment this package can tell
 * you the date, half the kit starts asking it and the determinism rule becomes advisory.
 */
export interface Clock {
  now(): number;
}

/**
 * A clock a test owns outright.
 *
 * Exists so that no test in this kit ever imports a fake-timer library. A test that wants an
 * hour of game says `clock.advance(3_600_000)` and gets it in a microsecond — which is also
 * why the whole `loop` suite runs in milliseconds and cannot flake on a loaded CI box.
 */
export interface ManualClock extends Clock {
  /**
   * Move forward.
   *
   * @throws RangeError on a negative or non-finite amount. A negative advance is always a
   * bug and never a rewind you meant: the loop clamps a backwards clock to a zero delta
   * (I-6), so a test that "rewound" here would be asserting on a code path the loop deletes.
   * Use {@link ManualClock.set} if you genuinely want to reproduce a clock that jumped back.
   */
  advance(ms: number): void;

  /**
   * Jump to an absolute reading.
   *
   * For reproducing a captured trace — including one that goes *backwards*, which is the only
   * way to test a loop against an NTP correction. Nothing here stops you; the loop is what
   * refuses to accumulate the negative delta.
   *
   * @throws RangeError if the reading is not finite. `NaN` would poison the loop's
   * accumulator permanently and silently: `while (NaN >= step)` is false forever, so the game
   * would stop stepping with no exception anywhere.
   */
  set(ms: number): void;
}

/**
 * A clock that only moves when a test moves it.
 *
 * @param startMs - the initial reading. Defaults to `0`. The origin is arbitrary — a
 *   monotonic clock has no epoch — so this exists only for reproducing a trace that started
 *   somewhere else.
 * @throws RangeError if `startMs` is not finite.
 */
export function manualClock(startMs: number = 0): ManualClock {
  let current = expectFinite(startMs, 'manualClock.startMs');
  return {
    now: () => current,
    advance(ms) {
      expectFinite(ms, 'manualClock.advance');
      if (ms < 0) {
        throw new RangeError(
          `manualClock.advance: expected a non-negative number of milliseconds, got ${String(ms)} — a monotonic clock never goes backwards; use set() to reproduce a clock that did`,
        );
      }
      current += ms;
    },
    set(ms) {
      current = expectFinite(ms, 'manualClock.set');
    },
  };
}
