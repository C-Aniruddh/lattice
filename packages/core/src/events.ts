/**
 * A typed synchronous emitter, with a dispatch order a replay can depend on.
 *
 * Two decisions carry this module, and both are recorded here because both were bugs first.
 *
 * **Dispatch is synchronous, in registration order, over a snapshot.** Asynchrony would mean
 * a listener runs on a different tick than the state change that caused it, which is exactly
 * how a replay diverges from a live session. The snapshot is what makes "unsubscribe when
 * the panel closes" safe to do from inside a listener: splicing an array that a `for` loop is
 * walking skips the next listener, so one unrelated system silently stops.
 *
 * **`on` returns a `Disposer` rather than relying on `off`.** Matching a function reference
 * fails silently for `this.handler.bind(this)`, which returns a *new* function on every call
 * and therefore never matches anything — so every closed screen leaks its entire state. That
 * leak has a name in every codebase that has ever shipped an emitter.
 *
 * Tier A: no clock, no platform, no randomness. `emit` allocates nothing.
 */

import type { Disposer } from './dispose.js';

/** Internal listener shape. Not exported: the public signatures spell it out inline. */
type Listener<TPayload> = (payload: TPayload) => void;

/**
 * A typed synchronous emitter.
 *
 * Declare the event map as an interface and the payloads type-check at every call site:
 *
 * ```ts
 * interface GameEvents { built: { id: string }; ready: void }
 * const events = new Emitter<GameEvents>();
 * const off = events.on('built', ({ id }) => place(id));
 * events.emit('built', { id: 'mine' });
 * events.emit('ready', undefined);   // a payload-free event is typed `void`
 * off();
 * ```
 *
 * An event with no payload is typed `void` and emitted as `emit('ready', undefined)`. The
 * explicit `undefined` is deliberate: an optional second argument would make `emit('built')`
 * — a payload-carrying event with its payload forgotten — compile.
 *
 * The type parameter is constrained to `object` rather than `Record<string, unknown>` so that
 * an `interface` map works. TypeScript gives implicit index signatures to type aliases and
 * not to interfaces, and an emitter that rejects the more natural of the two declarations
 * would be a papercut on every consumer.
 */
export class Emitter<TEvents extends object> {
  /**
   * Listener lists, keyed by event name.
   *
   * The arrays are **never mutated in place** — `on`, `off` and `clear` replace them with a
   * new array — which is what lets `emit` iterate the live reference and still honour the
   * snapshot contract at zero allocation cost. Subscribing is a setup-time operation and can
   * afford the copy; dispatching happens sixty times a second and cannot.
   */
  readonly #lists = new Map<string, readonly Listener<never>[]>();

  /**
   * Subscribe. Returns a `Disposer` that unsubscribes.
   *
   * The disposer is idempotent per that type's contract, so it can be handed straight to
   * `Scope.add` and disposed again with the scene without removing a *later* listener that
   * happens to be the same function.
   *
   * @throws TypeError if `listener` is not a function — a typo'd method reference otherwise
   * registers `undefined` and fails inside `emit`, one stack frame away from any clue.
   */
  on<K extends keyof TEvents & string>(event: K, listener: (payload: TEvents[K]) => void): Disposer {
    if (typeof listener !== 'function') {
      throw new TypeError(
        `emitter.on('${event}'): expected a listener function, got ${String(listener)}`,
      );
    }
    const list = this.#lists.get(event);
    this.#lists.set(event, list === undefined ? [listener] : [...list, listener]);

    let live = true;
    return (): void => {
      if (!live) return;
      live = false;
      this.#remove(event, listener);
    };
  }

  /**
   * Fires at most once, then unsubscribes itself **before** the listener body runs.
   *
   * The order is the point: a listener that re-emits its own event — a `ready` handler that
   * marks the world ready, say — would otherwise recurse until the stack gives out.
   */
  once<K extends keyof TEvents & string>(
    event: K,
    listener: (payload: TEvents[K]) => void,
  ): Disposer {
    if (typeof listener !== 'function') {
      throw new TypeError(
        `emitter.once('${event}'): expected a listener function, got ${String(listener)}`,
      );
    }
    const off = this.on(event, (payload: TEvents[K]): void => {
      off();
      listener(payload);
    });
    return off;
  }

  /**
   * Remove by reference.
   *
   * Prefer the `Disposer` from `on`. This is here for the case where the reference is
   * genuinely stable — a module-level function, not `this.handler.bind(this)`, which creates
   * a new function every call and so never matches. Removing something that was never
   * subscribed is a no-op rather than an error, because teardown paths run twice.
   *
   * If the same function was subscribed twice, one registration is removed, not both.
   */
  off<K extends keyof TEvents & string>(event: K, listener: (payload: TEvents[K]) => void): void {
    this.#remove(event, listener);
  }

  /**
   * Dispatch, synchronously, in registration order, over a snapshot of the listener list
   * taken before the first call.
   *
   * A listener that unsubscribes during dispatch is still called this round; one that
   * subscribes during dispatch is not called until the next. Both fall out of the snapshot,
   * and both are what stops "unsubscribe from inside a handler" from skipping the listener
   * that happened to sit next to it.
   *
   * A throwing listener propagates and the remaining listeners do not run. Swallowing it
   * would turn a crash into a silent half-updated world, which is strictly harder to debug
   * than the crash.
   */
  emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): void {
    const list = this.#lists.get(event);
    if (list === undefined) return;
    // The stored array is immutable by construction (see `#lists`), so this reference *is*
    // the snapshot the contract promises. The cast is the inverse of the widening `on` did
    // on the way in, and the key is what guarantees the payload type matches.
    const snapshot = list as readonly ((payload: TEvents[K]) => void)[];
    for (const listener of snapshot) listener(payload);
  }

  /**
   * Drop listeners for one event, or every listener when called with no argument.
   *
   * What a scene teardown calls as a backstop. It is a backstop and not the mechanism: an
   * emitter shared with anything outside the scene loses *that* owner's listeners too, which
   * is why the primary path is a `Scope` full of disposers.
   */
  clear(event?: keyof TEvents & string): void {
    if (event === undefined) this.#lists.clear();
    else this.#lists.delete(event);
  }

  /**
   * How many listeners are subscribed to one event.
   *
   * For tests and leak assertions: a screen that has been closed should be at zero, and a
   * count that grows across open/close cycles is the bug this whole module exists to make
   * visible.
   */
  listenerCount(event: keyof TEvents & string): number {
    return this.#lists.get(event)?.length ?? 0;
  }

  /** Remove one registration of `listener`, replacing the array rather than splicing it. */
  #remove(event: string, listener: Listener<never>): void {
    const list = this.#lists.get(event);
    if (list === undefined) return;
    const at = list.indexOf(listener);
    if (at === -1) return;
    if (list.length === 1) {
      this.#lists.delete(event);
      return;
    }
    this.#lists.set(event, [...list.slice(0, at), ...list.slice(at + 1)]);
  }
}
