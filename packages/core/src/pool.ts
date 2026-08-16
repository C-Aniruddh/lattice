/**
 * Object reuse for the hot path.
 *
 * A pool exists for one reason: four hundred particles allocated and dropped sixty times a
 * second is a garbage collector pause with a nice API. So the rule this module holds itself
 * to is stricter than the one it enforces — **nothing here allocates per acquire or per
 * release.** No closures, no wrappers, no bookkeeping objects, no iterators.
 *
 * That rule is also why there is no `releaseAll()`. Tracking live instances to support it
 * costs a per-object slot written on every acquire, and the discipline it papers over —
 * release in the same frame you acquire — is the one that keeps a pool honest.
 *
 * Tier A: no clock, no randomness, no platform.
 */

/** How a pool builds, resets and bounds the instances it hands out. */
export interface PoolOptions<T> {
  /** Build a fresh instance. Called only when the free list is empty. */
  readonly create: () => T;
  /**
   * Return an instance to a neutral state on release.
   *
   * Clear every **reference** here, not just the numbers. A pooled particle that keeps a
   * pointer to the entity that spawned it holds that entity's whole subtree alive, and the
   * leak is invisible because the pool "reuses" objects — which sounds like the opposite of
   * a leak. Set object fields to `undefined`, not just `x` and `y` to `0`.
   */
  readonly reset?: (item: T) => void;
  /** Instances to build up front. Do this at load, not during the first explosion. */
  readonly initial?: number;
  /**
   * Hard ceiling on total instances. Exceeding it throws rather than growing, because a pool
   * that grows without bound has become a slower `new` with extra steps — and the throw
   * names the leak at the moment it happens instead of at the out-of-memory twenty minutes
   * later. Omit for unbounded.
   */
  readonly max?: number;
  /**
   * O(n) double-release detection. Off by default because it is O(n) per release; turn it on
   * in tests.
   *
   * A double release puts one object on the free list twice, so two callers are handed the
   * same instance and each sees the other's writes. It is the single nastiest bug this module
   * can cause and the one that looks least like a pool bug — it presents as a physics glitch,
   * or as sprites drawing in the wrong order.
   */
  readonly checked?: boolean;
}

/**
 * A fixed-shape allocator for one type of object.
 *
 * ```ts
 * const sparks = new Pool({
 *   create: () => ({ x: 0, y: 0, owner: undefined as Entity | undefined }),
 *   reset: (s) => { s.x = 0; s.y = 0; s.owner = undefined; },
 *   initial: 64,
 *   max: 512,
 * });
 * const spark = sparks.acquire();
 * sparks.release(spark);
 * ```
 *
 * A released instance must not be touched again. The pool cannot enforce that — enforcing it
 * would mean a wrapper per instance, which is the allocation the pool exists to avoid — so it
 * is the caller's discipline, and `checked: true` in tests is how it is verified.
 */
export class Pool<T> {
  readonly #create: () => T;
  readonly #reset: ((item: T) => void) | undefined;
  readonly #max: number | undefined;
  readonly #checked: boolean;
  /** Instances available for reuse. Acquire pops, release pushes: no scan, no allocation. */
  readonly #free: T[] = [];
  #created = 0;

  constructor(options: PoolOptions<T>) {
    if (typeof options.create !== 'function') {
      throw new TypeError(
        `pool: expected \`create\` to be a factory function, got ${String(options.create)}`,
      );
    }
    if (options.max !== undefined) {
      if (!Number.isInteger(options.max) || options.max < 1) {
        throw new RangeError(
          `pool: expected \`max\` to be an integer >= 1, got ${String(options.max)}`,
        );
      }
    }
    this.#create = options.create;
    this.#reset = options.reset;
    this.#max = options.max;
    this.#checked = options.checked ?? false;
    if (options.initial !== undefined) this.preallocate(options.initial);
  }

  /**
   * Instances ever created — not instances currently out.
   *
   * Watch this flatten. If it climbs forever, something acquires and never releases, and the
   * pool is quietly becoming a leak with a free list attached.
   */
  get size(): number {
    return this.#created;
  }

  /** Instances currently available for reuse. `size - free` is how many are out. */
  get free(): number {
    return this.#free.length;
  }

  /**
   * Take an instance, reusing a released one when there is one.
   *
   * A reused instance has already been through `reset`; a fresh one comes from `create` and
   * is assumed neutral. Either way the caller must write every field it depends on, because
   * "reset" is a contract the pool cannot check.
   *
   * @throws RangeError when `max` is reached. Raising `max` is occasionally the right fix and
   * is usually the wrong one — a pool at capacity almost always means a release was missed.
   */
  acquire(): T {
    if (this.#free.length > 0) {
      // The length check on the line above is what earns this cast: under
      // `noUncheckedIndexedAccess` a `pop()` is `T | undefined`, and here it cannot be.
      return this.#free.pop() as T;
    }
    if (this.#max !== undefined && this.#created >= this.#max) {
      throw new RangeError(
        `pool.acquire: exhausted at capacity ${this.#max}; raise \`max\` or release before acquiring`,
      );
    }
    this.#created += 1;
    return this.#create();
  }

  /**
   * Give an instance back, resetting it on the way in.
   *
   * Reset happens here rather than in `acquire` so that references die at the moment the
   * caller is finished with them. Resetting on acquire would hold the last user's entity
   * graph alive for as long as the instance sat on the free list.
   *
   * @throws TypeError on a double release when `checked` is on. It is a `TypeError` and not a
   * bare `Error` because the argument is invalid for this operation — the instance is not
   * live — and per the constitution an error names the caller's mistake with the right kind.
   */
  release(item: T): void {
    if (this.#checked && this.#free.indexOf(item) !== -1) {
      throw new TypeError(
        'pool.release: this instance is already free — a double release hands one object to two callers, and each then sees the other\'s writes',
      );
    }
    if (this.#reset !== undefined) this.#reset(item);
    this.#free.push(item);
  }

  /**
   * Build `count` instances into the free list ahead of time.
   *
   * The first explosion of the session is the worst moment to allocate four hundred
   * particles, and it is also the moment the player is most likely to be watching.
   *
   * @throws RangeError if `count` is not a non-negative integer, or if it would push the pool
   * past `max` — which is a sizing mistake, and better found at load than mid-frame.
   */
  preallocate(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(
        `pool.preallocate: expected a non-negative integer count, got ${String(count)}`,
      );
    }
    if (this.#max !== undefined && this.#created + count > this.#max) {
      throw new RangeError(
        `pool.preallocate: ${count} more instances would exceed capacity ${this.#max} (${this.#created} already created)`,
      );
    }
    for (let i = 0; i < count; i += 1) {
      this.#created += 1;
      this.#free.push(this.#create());
    }
  }
}
