/**
 * Where a save goes — the seam that makes this package testable in Node.
 *
 * Nothing here knows what a browser is. `webStorage` wraps anything with the three methods
 * `localStorage` has; `memoryStorage` is a `Map`. The one function that reaches for a real
 * host lives in `browser.ts` and says so in its header.
 */

/**
 * The shape of `localStorage` and `sessionStorage`, structurally, so neither is imported.
 *
 * Three methods and no `length`, no `key(i)`, no `clear()`. The omissions are the design:
 * `clear()` is the API shape of the reset trap (a game that clears the origin wipes the
 * player's volume with their campus), and a store that could enumerate keys would be a store
 * that could read another store's key. Neither is reachable from here.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Where a save goes. Synchronous on purpose.
 *
 * The write that matters happens as the page is being discarded, and a discarded page runs
 * your synchronous work and drops the rest. An async adapter would admit IndexedDB and a
 * server and would make the last four seconds of every session a coin flip.
 *
 * **An adapter may throw exactly where the platform throws** — `set` on a full quota, `get`
 * on storage that was revoked mid-session — and **the store catches all of it**. Nothing an
 * adapter does escapes as an exception: a failed read becomes `failure.reason: 'unreadable'`
 * on the open result and a failed write becomes `WriteResult.error`, because the alternative
 * is an exception thrown inside a `pagehide` handler where there is nothing left to do about
 * it. If you write your own adapter, throwing is safe; returning a lie is not.
 */
export interface StorageAdapter {
  /**
   * Whether writes are expected to outlive the tab. `false` for the memory fallback.
   *
   * Surfaced on `OpenResult` and as `status: 'not-persistent'` so a game can tell a
   * private-mode player once, at the start, that progress will not be kept — which is useful
   * — rather than saying nothing and letting them discover it after two hours, which is what
   * silence buys you.
   */
  readonly durable: boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * Wraps any `StorageLike`. This is the seam: pass `localStorage`, `sessionStorage`, a
 * same-origin iframe's storage, or a fake with three methods in a test.
 *
 * `durable: true`, because every real `StorageLike` outlives the tab and a caller who wraps
 * something that does not has told the store a falsehood it cannot check. Wrap a
 * session-scoped or in-memory backing store with `memoryStorage` instead, or the player
 * never sees the "this will not be saved" notice they are owed.
 *
 * Errors from the underlying object are **passed through**, deliberately. That is what lets
 * the store tell a quota failure from a success and a revoked storage from an empty one; a
 * wrapper that swallowed them would report every failed write as a write.
 */
export function webStorage(storage: StorageLike): StorageAdapter {
  return {
    durable: true,
    get: (key: string): string | null => storage.getItem(key),
    set: (key: string, value: string): void => {
      storage.setItem(key, value);
    },
    remove: (key: string): void => {
      storage.removeItem(key);
    },
  };
}

/**
 * An in-process map. `durable: false`, and that is the important field.
 *
 * The default adapter in every test in this kit, and the fallback `browserStorage()` returns
 * when the platform has no usable storage. A store on one of these reports
 * `status: 'not-persistent'` from the moment it is constructed, so a private-mode player can
 * be told at the door rather than after two hours of play.
 *
 * @param seed initial contents, **copied**. The map is private afterwards, so a test can
 *   hand in a fixture and then mutate its own object without reaching into the adapter.
 */
export function memoryStorage(seed?: Readonly<Record<string, string>>): StorageAdapter {
  const cells = new Map<string, string>(seed === undefined ? [] : Object.entries(seed));
  return {
    durable: false,
    get: (key: string): string | null => cells.get(key) ?? null,
    set: (key: string, value: string): void => {
      cells.set(key, value);
    },
    remove: (key: string): void => {
      cells.delete(key);
    },
  };
}
