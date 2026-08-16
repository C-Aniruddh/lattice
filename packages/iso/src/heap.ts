/**
 * The two ordering primitives this package needs, and **neither is part of the public
 * surface.**
 *
 * `core` refused to own a priority queue and the refusal was right: `loop` explicitly
 * declines heaps, `sim` is closed-form, so there was exactly one confirmed consumer and one
 * consumer owns its own container. What `core` took instead costs zero exports and is the
 * part that could not have been duplicated:
 *
 * > **The Lattice ordering rule.** Anything that orders by a numeric key breaks ties by
 * > **insertion sequence** and exposes **no comparator parameter**. A comparator that may
 * > return `0` reintroduces exactly the ambiguity the rule exists to remove, and a caller
 * > cannot supply a total order over an insertion sequence it cannot see.
 *
 * Both things here obey it, and that is why they are here rather than each being written
 * inline where it is used. On a grid ties are *common* — two tiles at equal `f`, two
 * footprints at equal depth — so a tie-break that is "whatever the algorithm happens to do"
 * makes A\*'s replay guarantee a coin flip and makes the depth sort flicker between frames
 * and between engines.
 *
 * Publishing either would promise a general-purpose container from a package about isometric
 * space, and admitting one container admits `Deque` and `RingBuffer` on identical reasoning.
 * `index.ts` therefore re-exports neither. The named trigger for revisiting: the day a second
 * package needs a heap it **moves** to `core` rather than being written twice, and the move
 * is cheap precisely because the contract above is already fixed — what moves is code, not a
 * decision.
 *
 * **On the `as number` casts below.** Under `noUncheckedIndexedAccess` every typed-array read
 * is `number | undefined`. A `??` fallback would be a branch no test can ever take, in the
 * hottest loops in the package, and a `!` is banned for the excellent reason that it is a
 * place the compiler was told to stop helping. Where the index is provably in range — bounded
 * by `size` or by `n`, three lines above — the cast says so and costs nothing at runtime.
 * Where an index is *not* provable, this package writes the `=== undefined` check out in full;
 * `TileGrid.get` is the example.
 */

/**
 * A binary min-heap over `(key, tie)` pairs carrying an integer payload.
 *
 * Keys are `number` because A\*'s `f` is a summed integer cost and the depth key is a
 * fractional grid coordinate; ties are `number` because they are an insertion counter in one
 * caller and a tile index in the other. The pair is a **total** order — two entries compare
 * equal only if they are the same entry — which is what makes every consumer deterministic
 * without any of them supplying a comparator.
 *
 * Grows by doubling and never shrinks: it is allocated once per `PathFinder`, `FlowField` or
 * `DepthSorter` and reused for the life of the game, so its steady state is zero allocation.
 */
export class MinHeap {
  #keys: Float64Array;
  #ties: Float64Array;
  #values: Int32Array;
  #size = 0;

  constructor(capacity = 64) {
    const n = Math.max(1, capacity);
    this.#keys = new Float64Array(n);
    this.#ties = new Float64Array(n);
    this.#values = new Int32Array(n);
  }

  /** Entries currently held. */
  get size(): number {
    return this.#size;
  }

  /** Drop every entry, keeping the buffers. */
  clear(): void {
    this.#size = 0;
  }

  #grow(): void {
    const next = this.#keys.length * 2;
    const keys = new Float64Array(next);
    keys.set(this.#keys);
    this.#keys = keys;
    const ties = new Float64Array(next);
    ties.set(this.#ties);
    this.#ties = ties;
    const values = new Int32Array(next);
    values.set(this.#values);
    this.#values = values;
  }

  /** Is the entry at slot `a` ordered before the one at slot `b`? Key first, insertion
   *  sequence second, and never "equal" — that is the whole rule, in one function. */
  #before(a: number, b: number): boolean {
    const ka = this.#keys[a] as number;
    const kb = this.#keys[b] as number;
    if (ka !== kb) return ka < kb;
    return (this.#ties[a] as number) < (this.#ties[b] as number);
  }

  #swap(a: number, b: number): void {
    const k = this.#keys[a] as number;
    this.#keys[a] = this.#keys[b] as number;
    this.#keys[b] = k;
    const t = this.#ties[a] as number;
    this.#ties[a] = this.#ties[b] as number;
    this.#ties[b] = t;
    const v = this.#values[a] as number;
    this.#values[a] = this.#values[b] as number;
    this.#values[b] = v;
  }

  /** Insert. `tie` must be unique among live entries sharing a `key`, or the order stops
   *  being total and the determinism guarantee goes with it. */
  push(value: number, key: number, tie: number): void {
    if (this.#size === this.#keys.length) this.#grow();
    let i = this.#size;
    this.#size = i + 1;
    this.#keys[i] = key;
    this.#ties[i] = tie;
    this.#values[i] = value;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#before(i, parent)) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  /** Remove and return the smallest payload, or `-1` when empty. `-1` rather than `undefined`
   *  because every payload here is an array index, and a branch on `-1` compiles to the same
   *  check without handing the caller a nullable number to thread through its hot loop. */
  pop(): number {
    if (this.#size === 0) return -1;
    const top = this.#values[0] as number;
    this.#size -= 1;
    if (this.#size > 0) {
      this.#keys[0] = this.#keys[this.#size] as number;
      this.#ties[0] = this.#ties[this.#size] as number;
      this.#values[0] = this.#values[this.#size] as number;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < this.#size && this.#before(left, best)) best = left;
        if (right < this.#size && this.#before(right, best)) best = right;
        if (best === i) break;
        this.#swap(i, best);
        i = best;
      }
    }
    return top;
  }
}

/**
 * Sort `ids[0 .. n)` ascending by `keys[id]`, breaking ties by the id itself. In place, no
 * allocation, no comparator, no recursion.
 *
 * Heapsort rather than `Array.prototype.sort`: the array is an `Int32Array` of indices, the
 * comparator would be a closure allocated per call on the per-frame path, and — the part that
 * actually matters — a sort whose tie-break is "whatever the engine's sort does" is a draw
 * order that can differ between engines. Because the `(key, id)` pair is total, stability is
 * not a property this needs to have; it is one it cannot fail to have.
 *
 * `keys` is indexed by *id*, not by position, which is what lets one key array drive four
 * different orderings of the same items without copying any of them.
 *
 * The sift-down is written out twice, inline, rather than shared with a helper closure: two
 * closures per call times four orderings per frame is eight allocations a frame in the one
 * function whose whole job is to not have any.
 */
export function sortIndicesByKey(ids: Int32Array, n: number, keys: Float64Array): void {
  for (let start = (n >> 1) - 1; start >= 0; start--) {
    let root = start;
    for (;;) {
      const child = root * 2 + 1;
      if (child >= n) break;
      let swap = root;
      let a = ids[swap] as number;
      let b = ids[child] as number;
      let ka = keys[a] as number;
      let kb = keys[b] as number;
      if (ka !== kb ? ka < kb : a < b) swap = child;
      const right = child + 1;
      if (right < n) {
        a = ids[swap] as number;
        b = ids[right] as number;
        ka = keys[a] as number;
        kb = keys[b] as number;
        if (ka !== kb ? ka < kb : a < b) swap = right;
      }
      if (swap === root) break;
      const t = ids[root] as number;
      ids[root] = ids[swap] as number;
      ids[swap] = t;
      root = swap;
    }
  }
  for (let end = n - 1; end > 0; end--) {
    const t0 = ids[0] as number;
    ids[0] = ids[end] as number;
    ids[end] = t0;
    let root = 0;
    for (;;) {
      const child = root * 2 + 1;
      if (child >= end) break;
      let swap = root;
      let a = ids[swap] as number;
      let b = ids[child] as number;
      let ka = keys[a] as number;
      let kb = keys[b] as number;
      if (ka !== kb ? ka < kb : a < b) swap = child;
      const right = child + 1;
      if (right < end) {
        a = ids[swap] as number;
        b = ids[right] as number;
        ka = keys[a] as number;
        kb = keys[b] as number;
        if (ka !== kb ? ka < kb : a < b) swap = right;
      }
      if (swap === root) break;
      const t = ids[root] as number;
      ids[root] = ids[swap] as number;
      ids[swap] = t;
      root = swap;
    }
  }
}
