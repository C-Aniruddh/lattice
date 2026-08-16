/**
 * The game talking to the player, briefly.
 *
 * Four decisions here are not cosmetic, and each of them is a bug the source game shipped:
 *
 * | decision | what it prevents |
 * |---|---|
 * | duration scales with **length** | 3.2 s is fine for "+40 MW" and theft for a sentence, and the toasts carrying real information are exactly the long ones |
 * | it **holds while hovered** | somebody reading a toast is the one person who must not lose it |
 * | a tap **dismisses early** | the alternative to reading it is waiting it out, which nobody does |
 * | expiry runs on the **state cadence** | a tab hidden for a minute comes back with the backlog already gone, not with forty toasts to dismiss |
 *
 * Toasts live in the topmost layer, **above the scrim**: a message that lands under a modal has
 * not been shown, it has been lost, and holding it in a queue instead means the queue has to be
 * drained by somebody.
 */

import { expectFinite, type Disposer } from '@lattice/core';
import { el } from './el.js';
import { createKeyedLatch } from './latch.js';
import { internalsOf, type Overlay } from './overlay.js';

/** How a toast reads. Three, because a fourth needs a color convention and this package holds
 *  no opinion about what red means. */
export type ToastKind = 'plain' | 'good' | 'bad';

/** How a toast host behaves. */
export interface ToastOptions {
  /** Never more than this many on screen; the oldest is dropped. Default 3 — a wall of toasts
   *  hides the game they are about. */
  readonly max?: number;
  /**
   * Floor for how long one lives. Default 7000.
   *
   * The source game shipped 3200 and it was wrong: long enough for "+40 MW" and nowhere near
   * enough for a sentence.
   */
  readonly minMs?: number;
  /** Added per character on top of `minMs`, at roughly a slow reading pace. Default 55, which
   *  is about 220 words per minute at five characters a word — deliberately slower than a
   *  reader who is looking at the toast, because the player is looking at the game. */
  readonly msPerChar?: number;
}

/** A place toasts appear. One per overlay is normal; more than one is a game that has decided
 *  two regions of the screen mean different things. */
export interface ToastHost {
  /**
   * Show one.
   *
   * @throws TypeError if `text` is not a string.
   */
  show(text: string, kind?: ToastKind): void;

  /**
   * Show one **at most once per key for this session**, and say whether this call was the one
   * that showed it.
   *
   * The case that named it, from `@lattice/persist`: storage may be non-persistent — private
   * browsing, a quota-constrained device, a user who has blocked site data — and the autosave
   * rediscovers this every thirty seconds for the rest of the session. Shown every time, "your
   * browser will not keep this save" becomes furniture: the player learns the shape of a toast
   * and dismisses it unread, and the next one, which mattered, goes with it. **A notice that
   * repeats is worse than no notice, because it trains the dismissal.**
   *
   * `key` must name the **condition**, not the message: `'storage-not-persistent'`, never the
   * rendered text. `persist` exposes `store.status` as a bare union member for exactly this. A
   * text carrying a detail — a timestamp, a byte count, an attempt number — changes on every
   * discovery and defeats a latch keyed on it, which is a deduplication that silently stops
   * deduplicating in exactly the case it was written for.
   *
   * The scope is **this session and this host**, in memory. "Once ever, across reloads" is a
   * boolean in your saved state, and `@lattice/persist` owns saved state:
   * `if (!save.warnedAboutStorage) save.warnedAboutStorage = toasts.once('storage-not-persistent', …)`.
   *
   * @throws TypeError if `key` is not a non-empty string.
   */
  once(key: string, text: string, kind?: ToastKind): boolean;

  /** Remove every toast on screen now. Does **not** reset the `once` latches: those name
   *  conditions the player has already been told about, and clearing the screen is not the
   *  player forgetting. */
  clear(): void;
  /** Remove everything and unsubscribe. Idempotent. */
  destroy(): void;
}

/** Default cap. Three lines of text over a game is already most of a phone. */
const DEFAULT_MAX = 3;
/** Default floor, in ms. */
const DEFAULT_MIN_MS = 7000;
/** Default per-character extension, in ms. */
const DEFAULT_MS_PER_CHAR = 55;

/** One toast on screen. Plain fields, mutated in place: a burst of six of these during a big
 *  collect should not be six allocations plus a garbage collection during the feedback. */
interface Live {
  readonly node: HTMLElement;
  /** When it goes, in the overlay's clock. Pushed forward by the time a pointer rested on it. */
  expiresAt: number;
  /** When the pointer arrived, or `null`. While this is set the toast never expires. */
  heldAt: number | null;
  /** The life bar's animation, if the host has Web Animations. Cosmetic: expiry is driven from
   *  the state cadence and this is only paused and resumed alongside it. */
  readonly anim: Animation | undefined;
}

/**
 * A toast host bound to an overlay.
 *
 * Expiry is registered on the overlay's **state** cadence, never on paint. Web Animations do not
 * run in a hidden tab, so an `onfinish`-driven expiry never fires there and a player returning
 * after a minute finds the whole backlog waiting; the animation here is the life bar only, and
 * the clock that removes a toast is `ui.every`.
 *
 * @throws RangeError if `max` is below 1, or if `minMs` / `msPerChar` is negative or not finite.
 */
export function toasts(ui: Overlay, opts?: ToastOptions): ToastHost {
  const internals = internalsOf(ui);
  const max = Math.floor(expectFinite(opts?.max ?? DEFAULT_MAX, 'toasts: max'));
  if (max < 1) {
    throw new RangeError(`toasts: \`max\` must be at least 1, got ${String(opts?.max)}`);
  }
  const minMs = expectFinite(opts?.minMs ?? DEFAULT_MIN_MS, 'toasts: minMs');
  const msPerChar = expectFinite(opts?.msPerChar ?? DEFAULT_MS_PER_CHAR, 'toasts: msPerChar');
  if (minMs < 0 || msPerChar < 0) {
    throw new RangeError(
      `toasts: \`minMs\` and \`msPerChar\` must not be negative, got ${String(minMs)} and ${String(msPerChar)} — a toast that has already expired when it is shown is a message that was never delivered`,
    );
  }

  const latch = createKeyedLatch();
  const live: Live[] = [];

  /** Take one off the screen. Cancelling the animation matters: a paused animation on a detached
   *  node keeps the node alive on some engines, which is a leak shaped exactly like a toast. */
  function detach(entry: Live): void {
    entry.anim?.cancel();
    entry.node.parentNode?.removeChild(entry.node);
  }

  /** Remove one, wherever it is. The `-1` is reached by a second tap on a toast that has already
   *  gone: a phone dispatches two clicks for one impatient double tap. */
  function drop(entry: Live): void {
    const at = live.indexOf(entry);
    if (at === -1) return;
    live.splice(at, 1);
    detach(entry);
  }

  /** Whether one is due, in one pass with no allocation — which is the overwhelmingly common
   *  answer on a cadence that runs sixty times a second and expires something twice a minute. */
  function due(nowMs: number): boolean {
    for (const entry of live) {
      if (entry.heldAt === null && nowMs >= entry.expiresAt) return true;
    }
    return false;
  }

  function sweep(nowMs: number): void {
    if (!due(nowMs)) return;
    // A copy only on the rare pass that removes something, so the list can be spliced safely.
    for (const entry of [...live]) {
      if (entry.heldAt === null && nowMs >= entry.expiresAt) drop(entry);
    }
  }

  const stopSweep: Disposer = ui.every(sweep);

  function show(text: string, kind: ToastKind = 'plain'): void {
    if (typeof text !== 'string') {
      throw new TypeError(`toasts.show: expected a string, got ${typeof text}`);
    }
    if (!internals.alive()) return;
    const lifetime = minMs + msPerChar * text.length;
    const nowMs = internals.now();

    const bar = el('div', { class: 'lattice-toast-bar' });
    const node = el('div', { class: `lattice-toast lattice-toast-${kind}` }, text, bar);

    // The bar is a Web Animation rather than a per-frame style write: it is the platform's own
    // tween, it runs off the main thread, and a HUD that spent a frame callback on a progress
    // bar would be spending it on the least important thing on screen.
    const anim =
      typeof bar.animate === 'function'
        ? bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
            duration: lifetime,
            easing: 'linear',
            fill: 'forwards',
          })
        : undefined;

    const entry: Live = { node, expiresAt: nowMs + lifetime, heldAt: null, anim };

    node.addEventListener('pointerenter', () => {
      if (entry.heldAt !== null) return;
      entry.heldAt = internals.now();
      entry.anim?.pause();
    });
    node.addEventListener('pointerleave', () => {
      const held = entry.heldAt;
      if (held === null) return;
      // Give back exactly the time the pointer rested on it, so a toast read halfway through
      // still has half of it left rather than restarting or vanishing on release.
      entry.expiresAt += internals.now() - held;
      entry.heldAt = null;
      entry.anim?.play();
    });
    node.addEventListener('click', () => {
      drop(entry);
    });

    ui.mount(node, { layer: 'toasts', interactive: true });
    live.push(entry);
    // Drop from the front: the newest message is the one the player is looking for, and a cap
    // that dropped the newest would silently discard the reason they just tapped something.
    for (const gone of live.splice(0, Math.max(0, live.length - max))) detach(gone);
  }

  /** Take every toast off the screen at once. `splice` empties the list and hands back what it
   *  held, so nothing can be dropped twice and nothing can be missed. */
  function clearAll(): void {
    for (const gone of live.splice(0, live.length)) detach(gone);
  }

  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    clearAll();
    stopSweep();
  }
  const release = internals.scope.add(destroy);

  return {
    show,
    once(key: string, text: string, kind?: ToastKind): boolean {
      if (typeof key !== 'string' || key === '') {
        throw new TypeError(
          `toasts.once: \`key\` must be a non-empty string naming the condition, got ${JSON.stringify(key)}`,
        );
      }
      // The liveness check comes *before* the latch: burning a key on a destroyed overlay would
      // mean the notice is never shown at all, and the one thing `once` must never do is lose
      // the single showing it allows.
      if (!internals.alive()) return false;
      if (!latch.fire(key)) return false;
      show(text, kind);
      return true;
    },
    clear: clearAll,
    destroy(): void {
      release();
      destroy();
    },
  };
}
