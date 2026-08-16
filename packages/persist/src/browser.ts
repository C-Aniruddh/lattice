/**
 * `@browser-only` — the one module in this package that knows a browser exists.
 *
 * It knows through parameters. Everything here compiles without the DOM lib, tests in Node
 * against plain objects, and is the single grep-able exception to the rule that
 * `@lattice/persist` runs unchanged under `node`. If a second module in this package ever
 * needs this header, the package has stopped being isomorphic and the change should be
 * argued rather than merged.
 *
 * Two traps from the game this kit was extracted from are answered here, and both of them
 * cost real time:
 *
 * 1. **`beforeunload` does not fire reliably on mobile Safari.** A save that only runs on
 *    unload loses the session for the players whose sessions end by the phone going into a
 *    pocket. Bind `visibilitychange` (guarded on `visibilityState === 'hidden'`) and
 *    `pagehide` instead — `visibilitychange` fires when the app is backgrounded, which is the
 *    moment that actually corresponds to "the player has stopped playing".
 * 2. **Private-mode Safari throws on the property access, not merely on the write.** The
 *    guard has to wrap the read of `globalThis.localStorage` itself; a `try`/`catch` around
 *    `setItem` alone still takes the page down at module scope.
 */

import { memoryStorage, webStorage, type StorageAdapter, type StorageLike } from './adapters.js';
import type { Autosave } from './store.js';

/** The probe key. Written and removed inside the guard, so it never outlives the check. */
const PROBE_KEY = '@lattice/persist:probe';

/** `addEventListener`/`removeEventListener`, structurally, so no DOM type is imported. */
export interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** The two hosts a flush has to be wired to, and nothing else about them. */
export interface FlushTargets {
  /** `document`, structurally. */
  readonly visibility: ListenerTarget & { readonly visibilityState: string };
  /** `window`, structurally. */
  readonly page: ListenerTarget;
}

/**
 * Flush on the events that actually fire, and return a disposer.
 *
 * Binds `visibilitychange` (flushing only when `visibilityState === 'hidden'`) and `pagehide`.
 * **Not `beforeunload`** — see this module's header.
 *
 * The returned disposer removes both listeners. It does **not** flush, and that is
 * load-bearing rather than an omission: a disposer that writes is exactly the mechanism that
 * makes a reset fail. The game this kit came from had one, and `localStorage.clear()` plus a
 * reload therefore did not reset the game — the flush on the way out wrote the live state back
 * over the clear. `store.reset()` stops the handle before it removes the key, and this
 * disposer stays silent, so both halves of that trap are closed.
 *
 * It is safe to call the disposer more than once: the second `removeEventListener` for a
 * listener that is no longer bound does nothing, per the DOM spec.
 */
export function installFlushTriggers(autosave: Autosave, targets: FlushTargets): () => void {
  const onVisibility = (): void => {
    // Only on the way out. `visibilitychange` fires in both directions, and flushing on the
    // way back in is a write nobody asked for on the frame a player is returning to.
    if (targets.visibility.visibilityState === 'hidden') autosave.flush();
  };
  const onPageHide = (): void => {
    autosave.flush();
  };

  targets.visibility.addEventListener('visibilitychange', onVisibility);
  targets.page.addEventListener('pagehide', onPageHide);

  return (): void => {
    targets.visibility.removeEventListener('visibilitychange', onVisibility);
    targets.page.removeEventListener('pagehide', onPageHide);
  };
}

/**
 * The host's storage, if it will give it up, behind the guard that private mode needs.
 *
 * Read the *property* inside the `try`, not just the write: Safari in private mode has
 * historically thrown on `globalThis.localStorage` itself. Then probe with a real write and
 * remove, because a browser that hands over the object and refuses every `setItem` has told
 * you nothing until you ask.
 */
function usableStorage(scope: { readonly localStorage?: StorageLike }): StorageLike | null {
  try {
    const candidate = scope.localStorage;
    if (candidate === undefined || candidate === null) return null;
    candidate.setItem(PROBE_KEY, '1');
    candidate.removeItem(PROBE_KEY);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * `localStorage` if the platform will give it up, memory if it will not. **The only mention of
 * `localStorage` in this package.**
 *
 * A player whose browser refuses storage still gets to play. They just do not get to come back
 * to it, and `durable: false` says so — which surfaces as `store.status === 'not-persistent'`
 * from the moment the store is constructed, so a game can tell them once, at the start, rather
 * than letting them find out after two hours.
 *
 * @param scope where to look. Defaults to `globalThis`. Pass `{ localStorage: sessionStorage }`
 *   for a session-scoped store, or a fake in a test — the parameter exists so this function is
 *   testable in Node, which is the only place this package's suite runs.
 */
export function browserStorage(scope?: { readonly localStorage?: StorageLike }): StorageAdapter {
  const host: { readonly localStorage?: StorageLike } =
    scope ?? (globalThis as { readonly localStorage?: StorageLike });
  const storage = usableStorage(host);
  return storage === null ? memoryStorage() : webStorage(storage);
}
