/**
 * The two cadences, with the DOM taken out.
 *
 * Pure: two subscriber lists and a dispatcher. It is its own module because the thing worth
 * proving about this package — *state advances on `update` and never on `render`* — is a
 * property of these two lists, and proving it should not require a browser.
 *
 * | list | fed by | runs when | may hold |
 * |---|---|---|---|
 * | `every` | the loop's `update` | wall time, hidden tab included | anything whose absence makes the HUD **wrong** |
 * | `paint` | the loop's `render` | rAF: 0 Hz hidden, throttled, skipped under load | anything whose absence makes the HUD **plainer** |
 *
 * There is no third list and no way to register into `paint` by accident, because the failure
 * being designed out is not a crash: it is a HUD that looks alive in a background tab — the
 * canvas still showing its last painted frame — while its prices, its affordability marks and
 * its build timers froze twenty minutes ago.
 */

import type { Disposer } from '@latticekit/core';
import { expectFinite } from '@latticekit/core';

/** Work registered on a cadence. The argument is wall-clock milliseconds from the overlay's
 *  injected clock — never a delta, and never `requestAnimationFrame`'s own timestamp. */
export type CadenceFn = (nowMs: number) => void;

/** One subscriber list plus its dispatcher. Two of these make an overlay's cadences. */
export interface Cadence {
  /** Subscribe. The disposer is idempotent, and calling it during a dispatch removes the
   *  subscriber before its next turn rather than shifting the ones after it. */
  add(fn: CadenceFn): Disposer;
  /**
   * Run every subscriber with `nowMs`, in registration order.
   *
   * Two properties a caller depends on and neither is free:
   *
   * - **A subscriber added during a dispatch runs on the *next* one.** The alternative is a
   *   toast host that spawns a toast in a tick and expires it in the same tick, which is a
   *   message that never reaches a screen.
   * - **A throwing subscriber does not stop the others.** All of them still run and the
   *   failures are rethrown together, exactly as `Scope.dispose` does. One widget's bug
   *   freezing the other eleven readouts is how a HUD becomes wrong instead of noisy.
   *
   * @throws AggregateError, after every subscriber has run, if any of them threw.
   * @throws RangeError if `nowMs` is not finite — a `NaN` clock spreads into every duration on
   * screen and surfaces a hundred frames from the mistake.
   */
  run(nowMs: number): void;
  /** How many subscribers are live. The leak assertion for a screen that opens and closes. */
  readonly size: number;
}

/**
 * A subscriber, boxed.
 *
 * The box is what makes a disposer safe: it clears `fn` on the object it was handed rather than
 * on an index it remembered. An index-based disposer is correct until the first compaction moves
 * the slots, after which it unsubscribes *somebody else's* widget — and the symptom is a readout
 * that stops updating with nothing in the stack trace to say why.
 */
interface Slot {
  fn: CadenceFn | undefined;
  /** The dispatch this slot was registered during, or 0. Compared against the dispatch now
   *  running so that a subscriber added mid-dispatch waits for the next one. */
  readonly born: number;
}

/**
 * A fresh, empty cadence.
 *
 * No options: a cadence with a policy is a second thing to agree on, and the whole point of
 * this module is that both of an overlay's cadences behave identically and differ only in what
 * drives them.
 */
export function createCadence(label: string): Cadence {
  const slots: Slot[] = [];
  let live = 0;
  let holes = 0;
  let depth = 0;
  /** Counts dispatches. It is what tells a subscriber registered *during* a dispatch from one
   *  registered before it, without a snapshot of the array to allocate every frame. */
  let dispatch = 0;

  /** Drop the disposed slots. Deferred until no dispatch is walking the array. */
  function compact(): void {
    if (holes === 0 || depth > 0) return;
    let write = 0;
    for (const slot of slots) {
      if (slot.fn !== undefined) {
        slots[write] = slot;
        write += 1;
      }
    }
    slots.length = write;
    holes = 0;
  }

  return {
    add(fn: CadenceFn): Disposer {
      if (typeof fn !== 'function') {
        throw new TypeError(`${label}: expected a function, got ${typeof fn}`);
      }
      const slot: Slot = { fn, born: dispatch };
      slots.push(slot);
      live += 1;
      return () => {
        if (slot.fn === undefined) return;
        slot.fn = undefined;
        live -= 1;
        holes += 1;
        compact();
      };
    },

    run(nowMs: number): void {
      expectFinite(nowMs, label);
      // A generation rather than a snapshot: a subscriber registered during this dispatch runs
      // next time, and nothing is allocated on a path that runs sixty times a second. The
      // alternative — copying the array each dispatch — is the garbage collector pause that
      // non-negotiable 7 is about, paid to answer a question a counter answers for free.
      const generation = (dispatch += 1);
      let count = 0;
      let failures: unknown[] | undefined;
      depth += 1;
      try {
        for (const slot of slots) {
          const fn = slot.fn;
          if (fn === undefined || slot.born >= generation) continue;
          count += 1;
          try {
            fn(nowMs);
          } catch (error) {
            failures ??= [];
            failures.push(error);
          }
        }
      } finally {
        depth -= 1;
        compact();
      }
      if (failures !== undefined) {
        throw new AggregateError(
          failures,
          `${label}: ${failures.length} of ${count} subscribers threw; all of them still ran — the causes are in \`.errors\``,
        );
      }
    },

    get size(): number {
      return live;
    },
  };
}
