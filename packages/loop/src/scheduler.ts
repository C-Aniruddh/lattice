/**
 * One timer model, driven by somebody else.
 *
 * A `Timeline` has no clock. It advances when it is advanced, which is what lets the loop own
 * two of them — one on sim time, one on real time — with a single implementation, and what
 * lets a test run a simulated hour in a microsecond. The rule the whole kit follows is here in
 * miniature: **a package that needs to advance something exposes a tick-shaped method and lets
 * somebody drive it; it does not go and find a clock.**
 *
 * ## Integer microseconds, and why
 *
 * Every instant and period in here is an integer number of microseconds. `dueUs += periodUs`
 * ten thousand times is exact; `due += 1 / 60` ten thousand times is not, and the drift shows
 * up as a spawn wave that fires one step early after twenty minutes — reproducible, wrong, and
 * invisible to any test that runs for a second. Seconds are the unit at the API boundary and
 * microseconds are the unit inside; the conversion happens once per call, at the edge.
 *
 * ## Coalescing: at most one call per `advance()`, carrying `repeats`
 *
 * A timer that came due eight times during one `advance` produces **one** call with
 * `repeats === 8`, never eight calls. An hour spent in a hidden tab arrives at `loop.real` as
 * a single `advance(3600)`, and a `real.every(1, …)` that fired 3,600 times inside one frame
 * would lock the tab it was supposed to be keeping honest.
 *
 * **The window is one `advance()`, not one pump — and that distinction is deliberate.** The
 * loop advances `real` exactly once per pump, so for real timers the two are the same thing.
 * It advances `sim` once per *fixed step*, so a sim timer coalesces per step instead. That is
 * the stricter and more useful guarantee: coalescing sim timers per pump would make a spawn
 * wave fire in a pattern that depended on how many catch-up steps the frame happened to
 * contain, which is frame-rate-dependent behavior in the one timeline that has to replay
 * identically (invariant I-10 asks for exactly this — the same call sequence under two
 * different pump patterns). The bound sim timers get instead comes from the catch-up clamp:
 * a pump can never advance more than `maxCatchUpMs` of sim time, so a sim burst is bounded at
 * fifteen calls at the defaults where a real burst would be unbounded.
 *
 * ## Ordering
 *
 * Timers due in the same advance fire in **due-time order, then registration order**, and the
 * comparator can never return `0` because registration sequence is unique. That is the Lattice
 * ordering rule: anything that orders by a numeric key breaks ties by insertion sequence and
 * exposes no comparator parameter, because a comparator that may return `0` reintroduces
 * exactly the ambiguity the rule exists to remove.
 *
 * Tier A throughout: `+ - * /`, `Math.round`, `Math.floor`, comparison. No clock, no
 * randomness, no platform.
 */

import { expectFinite } from '@lattice/core';

/**
 * Opaque, never reused within a session, and cheap: a number, not an object.
 *
 * The counter is shared by every timeline in the process, so an id from `loop.sim` handed to
 * `loop.real.cancel` returns `false` instead of silently canceling a completely unrelated
 * timer that happened to be allocated the same small integer. Per-timeline counters were the
 * obvious design and would have made that collision certain.
 */
export type TimerId = number;

/** The shared allocator behind {@link TimerId}. Monotone for the life of the process. */
let nextTimerId = 1;

/** Registration sequence, for the tie-break in the ordering rule above. Also process-wide. */
let nextSeq = 1;

/** A live timer. Never escapes this module. */
interface Timer {
  readonly id: number;
  readonly seq: number;
  /** Absolute instant on this timeline, in microseconds. */
  dueUs: number;
  /** `0` for a one-shot. */
  readonly periodUs: number;
  readonly fn: (repeats: number) => void;
  live: boolean;
}

/**
 * Convert a duration in seconds to integer microseconds, refusing the values that would make
 * the accumulator stop being exact.
 *
 * @throws RangeError if the result has left the exactly-representable integers — above 2^53 a
 * double cannot hold consecutive integers, so `dueUs + periodUs` would silently equal `dueUs`
 * and the timer would fire every advance, forever.
 */
function toMicros(seconds: number, label: string): number {
  expectFinite(seconds, label);
  const micros = Math.round(seconds * 1_000_000);
  if (!Number.isSafeInteger(micros)) {
    throw new RangeError(
      `${label}: expected a duration expressible in integer microseconds, got ${String(seconds)} s — above 2^53 µs (about 285 years) the arithmetic stops being exact and a timer would fire every advance`,
    );
  }
  return micros;
}

/** Reject a callback that is not one, at the line that made the mistake. */
function expectCallback(fn: unknown, label: string): (repeats: number) => void {
  if (typeof fn !== 'function') {
    throw new TypeError(
      `${label}: expected a function, got ${typeof fn} — a timer with nothing to run is a leak that never reports itself`,
    );
  }
  return fn as (repeats: number) => void;
}

/**
 * The read-and-schedule half of a timeline. What `loop.sim` and `loop.real` hand out.
 *
 * The loop keeps `advance` to itself deliberately: a game that could advance `loop.sim`
 * directly would be the second clock that non-negotiable "one thing decides when work
 * happens" exists to prevent, and it would desynchronize sim timers from the fixed step they
 * are defined against.
 */
export interface Scheduler {
  /** Current time on this timeline, in seconds since it was created. */
  readonly time: number;

  /**
   * Live timers. `0` is a fine assertion for "nothing is left running", and the cheapest leak
   * detector this package offers: a scene torn down with `pending > 0` left a callback holding
   * its whole object graph alive.
   */
  readonly pending: number;

  /**
   * Fire once, at or after `delay`.
   *
   * `after(0, …)` fires on the next advance, which makes it look like a way to defer work off
   * the current pump. It is not the right tool for that: ten `after(0)` calls in one pump
   * queue ten one-shots and run the work ten times. Use `loop.coalesce` when the work must
   * happen **at most once** per pump.
   *
   * @throws RangeError if `delay` is negative, `NaN`, infinite, or too large to express in
   * integer microseconds.
   * @throws TypeError if `fn` is not a function.
   */
  after(delay: number, fn: () => void): TimerId;

  /**
   * Fire every `period`.
   *
   * **`repeats` is how many periods this one call stands for.** A callback never runs more
   * than once per advance of its timeline: an hour spent hidden gives one call with
   * `repeats === 3600`, not 3,600 calls in one frame. Write the body so it is correct for any
   * `repeats` — `credit(perTick * repeats)`, not `credit(perTick)` — and make it idempotent,
   * because a repeat callback that is not safe to run twice is not safe on a timer at all.
   *
   * Scheduling is by **absolute due time**, so periods do not drift: the hundredth fire of a
   * 30-second timer is at 3,000 s, not at 3,000 s plus a hundred roundings. That also makes a
   * race between two periodic jobs reproducible rather than intermittent — which is a smaller
   * mercy than it sounds, because the race is still there. If two periodic jobs must not
   * interleave, they are one job, or one is an `after` re-armed from inside the other.
   *
   * @throws RangeError if `period` is not a finite number greater than zero — a zero period is
   * an infinite loop, not a fast timer.
   * @throws TypeError if `fn` is not a function.
   */
  every(period: number, fn: (repeats: number) => void): TimerId;

  /**
   * Remove a timer. `true` if a live one was removed.
   *
   * Canceling twice is not an error, and canceling from inside a firing callback works: a
   * timer canceled during an advance never runs in that advance, even if it was already
   * collected as due.
   */
  cancel(id: TimerId): boolean;

  /** Remove every timer on this timeline. Anything already collected as due will not run. */
  cancelAll(): void;
}

/**
 * A scheduler somebody advances. The loop keeps its two to itself and exposes {@link Scheduler}.
 *
 * A game that wants a third — a cutscene clock, a per-level timer that resets, a replay
 * scrubber — makes one with {@link createTimeline} and calls `advance` from inside its own
 * `update`. That keeps the count of things that decide when work happens at exactly one.
 */
export interface Timeline extends Scheduler {
  /**
   * Move this timeline forward and fire whatever came due, once each, in due-time then
   * registration order.
   *
   * @throws RangeError if `dt` is negative, `NaN` or infinite. A negative advance would run
   * timers backwards, which has no meaning: a due time already passed cannot un-pass.
   */
  advance(dt: number): void;
}

/**
 * A timeline starting at time zero with nothing scheduled.
 *
 * Advance it from inside `update` (fixed step, replays identically) rather than from `render`,
 * where a mutation is forbidden and the delta is frame-rate dependent.
 */
export function createTimeline(): Timeline {
  const timers = new Map<TimerId, Timer>();
  let nowUs = 0;

  const add = (dueUs: number, periodUs: number, fn: (repeats: number) => void): TimerId => {
    const id = nextTimerId++;
    timers.set(id, { id, seq: nextSeq++, dueUs, periodUs, fn, live: true });
    return id;
  };

  /** Fire one collected timer, unless it was canceled between collection and here. */
  const fire = (timer: Timer): void => {
    if (!timer.live) return;
    if (timer.periodUs === 0) {
      timer.live = false;
      timers.delete(timer.id);
      timer.fn(1);
      return;
    }
    // How many whole periods elapsed between the due instant and now, inclusive of the one
    // that made it due. Integer division of integers: exact, and the same number on every
    // engine, which is what lets a recorded session replay.
    const repeats = Math.floor((nowUs - timer.dueUs) / timer.periodUs) + 1;
    timer.dueUs += repeats * timer.periodUs;
    timer.fn(repeats);
  };

  return {
    get time() {
      return nowUs / 1_000_000;
    },
    get pending() {
      return timers.size;
    },

    after(delay, fn) {
      const callback = expectCallback(fn, 'scheduler.after.fn');
      const delayUs = toMicros(delay, 'scheduler.after.delay');
      if (delayUs < 0) {
        throw new RangeError(
          `scheduler.after.delay: expected a non-negative number of seconds, got ${String(delay)} — a timer due in the past has no meaning on a timeline that only moves forward`,
        );
      }
      return add(nowUs + delayUs, 0, callback);
    },

    every(period, fn) {
      const callback = expectCallback(fn, 'scheduler.every.fn');
      const periodUs = toMicros(period, 'scheduler.every.period');
      if (periodUs <= 0) {
        throw new RangeError(
          `scheduler.every.period: expected a finite number of seconds > 0, got ${String(period)} — a zero period is an infinite loop, not a fast timer`,
        );
      }
      return add(nowUs + periodUs, periodUs, callback);
    },

    cancel(id) {
      const timer = timers.get(id);
      if (timer === undefined) return false;
      timer.live = false;
      timers.delete(id);
      return true;
    },

    cancelAll() {
      // Mark before clearing: a due list collected earlier in this advance still holds
      // references, and `fire` skips anything no longer live.
      for (const timer of timers.values()) timer.live = false;
      timers.clear();
    },

    advance(dt) {
      const dtUs = toMicros(dt, 'timeline.advance');
      if (dtUs < 0) {
        throw new RangeError(
          `timeline.advance: expected a non-negative number of seconds, got ${String(dt)} — a timeline only moves forward; a backwards clock is clamped by the loop, not run in reverse`,
        );
      }
      nowUs += dtUs;
      if (timers.size === 0) return;

      // Collect first, fire second. That single ordering is what gives invariant I-11: a timer
      // registered inside a firing callback is not in the collected list and cannot run in the
      // same advance, and one canceled inside it is skipped by `fire`'s liveness check.
      //
      // The common case — nothing due, or exactly one thing due — allocates nothing at all.
      let only: Timer | undefined;
      let batch: Timer[] | undefined;
      for (const timer of timers.values()) {
        if (timer.dueUs > nowUs) continue;
        if (batch !== undefined) batch.push(timer);
        else if (only !== undefined) batch = [only, timer];
        else only = timer;
      }

      if (batch === undefined) {
        if (only !== undefined) fire(only);
        return;
      }
      batch.sort((a, b) => a.dueUs - b.dueUs || a.seq - b.seq);
      for (const timer of batch) fire(timer);
    },
  };
}
