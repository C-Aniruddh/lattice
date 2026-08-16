/**
 * One teardown vocabulary for the whole kit.
 *
 * Before this module, five packages had each invented their own: `input` returned disposers
 * from a scope, `ui` from `interactive`, `loop` from subscriptions, `persist` from store
 * handles, `audio` from buses. A game tearing down a scene had to remember all five, and the
 * one it forgot was a listener that stayed live — invisible for an hour, then the tab is
 * using two gigabytes. Everything in Lattice that binds something now hands back a
 * `Disposer`, and anything with a lifetime owns a `Scope`.
 *
 * There is exactly one ordering rule — **reverse registration order** — because `child()`
 * registers the child's `dispose` into the parent's own list. "Children before parent" is
 * not a second rule to remember; it falls out of the first.
 *
 * Tier A: no clock, no platform, no allocation beyond the disposer list itself.
 */

/**
 * Undo one thing.
 *
 * **Idempotent by contract.** Calling a disposer twice must be safe and must not undo
 * something else. The failure this rule exists to prevent: a handle is released, its slot is
 * reused by somebody else, and the second call to the stale disposer releases *their* handle
 * — a bug that presents as a completely unrelated subsystem losing its subscription. Every
 * disposer the kit returns satisfies it, and every disposer a game writes is expected to.
 *
 * A `Scope` calls each disposer exactly once, so idempotence is not for the scope's benefit:
 * it is for the caller that also holds the disposer directly and disposes early.
 */
export type Disposer = () => void;

/**
 * A teardown tree. One per scene, screen, or anything else with a lifetime.
 *
 * The shape `input` proved and the kit adopts: a package ships **no free-function binder**,
 * so a listener can only be created through a scope and an unowned listener is
 * unconstructable. That turns "remember to unsubscribe" from documentation into something
 * the type system enforces, which is the difference between a guarantee and a hope.
 *
 * This is an interface with a factory rather than a class, deliberately. `input` had already
 * built one before this module existed; a structural type lets it conform without inheriting
 * anything. Five packages agreeing on a shape is the goal — five packages extending a base
 * class is a different and worse thing.
 */
export interface Scope {
  /**
   * Register a disposer. Returns it unchanged, so a caller can also hold it directly for
   * early disposal without losing the scope's ownership.
   *
   * **Registering on a disposed scope runs the disposer immediately** rather than storing
   * it. A subscription created during teardown — by a disposer that emits, say, whose
   * listener subscribes — would otherwise outlive the scope that was supposed to own it, and
   * it is unreachable by definition, so nothing could ever clean it up. That is the leak
   * that survives its own scene.
   *
   * @throws TypeError if `disposer` is not a function. `scope.add(handle.close)` on a handle
   * that has no `close` fails here, at the line that made the mistake, instead of silently
   * registering `undefined` and failing at teardown an hour later.
   */
  add(disposer: Disposer): Disposer;

  /**
   * A nested scope, disposed with this one.
   *
   * There is only one ordering rule, because this registers the child's `dispose` into this
   * scope's own list: **everything disposes in reverse registration order.** A child created
   * after a resource is torn down before that resource, exactly as if it were one.
   *
   * Called on an already-disposed scope, the child comes back already disposed — `add` ran
   * its `dispose` immediately, per the rule above — so anything registered on it also runs
   * at once and nothing leaks.
   */
  child(): Scope;

  /**
   * Tear down everything, in reverse registration order, then mark this scope disposed.
   *
   * **Idempotent**: the second call does nothing. This is the one that matters in practice —
   * every scene is eventually torn down by both its owner and its parent, and without this
   * the second teardown double-releases everything the first one released.
   *
   * A throwing disposer does not stop the rest. Every remaining disposer still runs and the
   * failures are collected and thrown together as an `AggregateError` afterwards, because
   * one bad teardown must not leak the other fourteen.
   *
   * Safe to pass as a value: `scope.dispose` closes over its own state and never reads
   * `this`, so `onExit(scope.dispose)` works without binding.
   *
   * @throws AggregateError if any disposer threw, after all of them have run.
   */
  dispose(): void;

  /** True once disposed. Checked in tests and by anything that must not re-enter teardown. */
  readonly disposed: boolean;

  /**
   * Registered disposers not yet run.
   *
   * The leak assertion: a closed screen's scope is zero, and a screen whose count climbs
   * across open/close cycles is registering into a scope that outlives it.
   */
  readonly size: number;
}

/**
 * Build an empty scope.
 *
 * No arguments and no options on purpose — a scope with a policy would be a second thing to
 * agree on, and the whole value of this module is that there is only one.
 */
export function createScope(): Scope {
  /** Registration order. Disposal walks it backwards by popping, so `size` falls as it goes. */
  const disposers: Disposer[] = [];
  let disposed = false;

  const scope: Scope = {
    add(disposer: Disposer): Disposer {
      if (typeof disposer !== 'function') {
        throw new TypeError(
          `scope.add: expected a disposer function, got ${String(disposer)} — a missing method reads as \`undefined\` here and as a leak an hour later`,
        );
      }
      if (disposed) {
        disposer();
        return disposer;
      }
      disposers.push(disposer);
      return disposer;
    },

    child(): Scope {
      const nested = createScope();
      scope.add(nested.dispose);
      return nested;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      let failures: unknown[] | undefined;
      let total = 0;
      // Popping is both the reverse walk and the emptying of the list, so a disposer that
      // inspects `size` mid-teardown sees what is genuinely still pending.
      for (let next = disposers.pop(); next !== undefined; next = disposers.pop()) {
        total += 1;
        try {
          next();
        } catch (error) {
          failures ??= [];
          failures.push(error);
        }
      }
      if (failures !== undefined) {
        throw new AggregateError(
          failures,
          `scope.dispose: ${failures.length} of ${total} disposers threw; all of them still ran — the causes are in \`.errors\``,
        );
      }
    },

    get disposed(): boolean {
      return disposed;
    },

    get size(): number {
      return disposers.length;
    },
  };

  return scope;
}
