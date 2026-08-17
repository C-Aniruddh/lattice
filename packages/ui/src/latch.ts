/**
 * The one-shot latch, twice — the smallest module here and the one that exists because of a
 * data-loss bug rather than a tidiness argument.
 *
 * Pure. No DOM, no clock, no allocation past the set. It is separate from `panel` and `toast`
 * because both of them need it and because the property worth testing — *a thousand calls
 * produce exactly one `true`* — is a property of a counter, not of a dialog.
 *
 * ## Why a latch at all
 *
 * The natural way to drive UI from a game is to check a condition on every update. That is a
 * poll, and a poll of *derived* state races whatever settles it. The source game polled "is the
 * player being asked to name their company?" every 900 ms against a condition that cleared on a
 * 1000 ms settle, so the namer reopened — blank — after the player pressed CONFIRM. The obvious
 * recovery, pressing CONFIRM again, overwrote the name they had just typed with a random roll.
 * **The recovery the bug invited was the bug's payload.**
 *
 * A latch makes the racing poll harmless without the caller having to know it races:
 * `ui.every(() => { if (questIsNaming) namer.openOnce(); })` is correct at any poll rate,
 * including one faster than the state that drives it.
 */

/** A latch that fires once, ever. `Panel.openOnce` is this plus an `open()`. */
export interface Latch {
  /**
   * `true` on the first call and `false` on every call after it, forever.
   *
   * The return value is the whole API: it is what lets the caller do the expensive thing —
   * open a dialog, build a node, write a save flag — only on the call that won.
   */
  fire(): boolean;
  /** Whether {@link Latch.fire} has ever returned `true`. Read in tests and in `auditOverlay`. */
  readonly fired: boolean;
}

/**
 * A fresh latch, unfired.
 *
 * There is deliberately **no reset**. A latch you can reset is a latch that will be reset from
 * inside the same poll that is racing the state, which is the bug with an extra step; if a
 * condition genuinely recurs, it needs a new latch, and the place that decides that is the
 * place that knows what "again" means.
 */
export function createLatch(): Latch {
  let fired = false;
  return {
    fire(): boolean {
      if (fired) return false;
      fired = true;
      return true;
    },
    get fired(): boolean {
      return fired;
    },
  };
}

/** Many latches, one per key. `ToastHost.once` is this plus a `show()`. */
export interface KeyedLatch {
  /** `true` the first time this key is seen, `false` for every repeat of it. */
  fire(key: string): boolean;
  /** Whether this key has fired. */
  fired(key: string): boolean;
  /** How many distinct keys have fired. The leak assertion: a HUD keying on rendered text
   *  grows this without bound, which is the failure `once` exists to prevent. */
  readonly size: number;
}

/**
 * A fresh keyed latch, empty.
 *
 * **The key names the condition, never the rendered text.** `'storage-not-persistent'`, not
 * `'Storage full — 4.2 MB used'`. A message carrying a detail — a timestamp, a byte count, an
 * attempt number — changes on every rediscovery, so a latch keyed on it never matches twice and
 * silently stops deduplicating in exactly the case it was written for. That failure is invisible
 * in a test that shows the notice once and fatal in a session where an autosave rediscovers the
 * condition every thirty seconds.
 *
 * Held in memory, for this host, for this session. "Once ever, across reloads" is a boolean in
 * the game's saved state and `@latticekit/persist` owns saved state; a UI package writing storage
 * behind the save layer's back is a second owner of the same truth.
 */
export function createKeyedLatch(): KeyedLatch {
  const seen = new Set<string>();
  return {
    fire(key: string): boolean {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    fired(key: string): boolean {
      return seen.has(key);
    },
    get size(): number {
      return seen.size;
    },
  };
}
