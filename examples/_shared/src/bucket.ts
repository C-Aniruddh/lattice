/**
 * The frame bucket — the array a `DepthSorter`'s integers index into, owned by the frame.
 *
 * This module is **pure**: no DOM, no clock, no randomness. It is the only file in
 * `examples/_shared` that can be unit-tested in Node, and `test/bucket.test.ts` does.
 *
 * `docs/rfc/depth-bucket.md` is the specification. Read it for why the item channel is not on
 * `DepthSorter` — briefly: a `DepthSorter<T>` would put `T` in `renderFrame`, `Passes.solids` and
 * `pickSorted`, `draw` would have to write `DepthSorter<unknown>`, and TypeScript's
 * method-parameter bivariance would make `DepthSorter<Thing>` assign to it *unsoundly*. The
 * generic belongs one level up, where it can be `Thing | Walker` without anybody below being told.
 */

import { DepthSorter, pickSorted } from '@lattice/iso';

/**
 * A frame's drawables, in one array whose indices are the sorter's own insertion indices.
 *
 * The bucket exists because {@link DepthSorter} returns integers and refuses — correctly — to
 * know what they stand for. Somebody has to hold the array those integers index into. Doing it by
 * hand is four lines and one of them is an offset subtraction that is silently wrong the first
 * time a second collection joins the frame; that mis-pick opens the building *behind* the one
 * under the player's finger, which is the exact bug `pickSorted` exists to prevent.
 *
 * The five lines an exhibit writes:
 *
 * ```ts
 * const bucket = createBucket<Thing | Walker>(boot.order);   // once, at setup
 * bucket.clear();                                            // top of the frame
 * for (const t of things) bucket.add(t, t.gx, t.gy, t.def.w, t.def.d, t.top);
 * for (let i = 0; i < walkers; i++) bucket.addPoint(pilgrims[i], here.gx, here.gy, z);
 * bucket.each(paint);                                        // in the solids pass
 * ```
 *
 * and on a tap, the line that is the whole point:
 *
 * ```ts
 * const hit = bucket.pick(underFinger);   // a Thing | Walker | undefined. never an integer
 * ```
 *
 * **One bucket per sorter, one sorter per frame.** Two buckets sharing a sorter is the same
 * desync in a more expensive costume, and {@link Bucket.add} refuses it by name.
 *
 * ## What cannot go wrong, and what merely throws
 *
 * Three of the four failures in the RFC's trap list are *unrepresentable* here rather than
 * caught, which is a stronger claim and the reason this is a helper rather than a paragraph:
 *
 * | the mistake | why it cannot be written |
 * |---|---|
 * | `index - things.length` | there is one array, and no caller is ever handed an index to do arithmetic on |
 * | the item array and the sorter disagreeing about a fill | `add` performs *both* writes; there is no way to do one without the other |
 * | clearing one and not the other | {@link Bucket.clear} clears both — see its note |
 *
 * What is left is a caller reaching *around* the bucket to `order.add` directly, and that is the
 * one thing a helper cannot prevent. It is detected at three points instead — the index compare
 * in `add`, the count guard in `each` and `pick`, and the per-item bound in `each` — so the whole
 * class is thrown, named, and on the offending line rather than silent and intermittent.
 */
export interface Bucket<T> {
  /** The sorter this bucket fills. Pass it to `renderFrame`; do not call `add` on it. */
  readonly order: DepthSorter;

  /**
   * Items added this frame — **before** `sort()` culls. Not `order.count` after it.
   *
   * The two are deliberately different numbers with deliberately different names: this is the
   * fill count and `order.count` is the survivor count, and assuming the first survives `sort()`
   * is how a frame paints `undefined`.
   */
  readonly count: number;

  /**
   * Drop the frame's items, and the sorter's with them.
   *
   * **This clears `order` too**, which is a deliberate departure from the RFC's surface and the
   * only one. The RFC's reason for keeping the two clears separate was that a game might share
   * the sorter with something else in the same frame — but `add` already refuses that by name
   * (invariant B3), so there is never anything in the sorter that this bucket did not put there,
   * and a clear that drops half of a pair it is the sole author of is a trap with no upside.
   * `order.clear()` is idempotent, so the RFC's `order.clear(); bucket.clear();` still reads and
   * behaves exactly as written.
   *
   * Slots are not truncated and references are not nulled — a discarded item stays reachable
   * until its slot is overwritten, bounded by the largest scene the bucket has ever held. That is
   * deliberate: truncating an array frees its backing store and buys a reallocation on the next
   * frame, and this runs sixty times a second.
   */
  clear(): void;

  /**
   * Add a footprint and the item standing on it, in one call that cannot do one without the other.
   *
   * @returns the insertion index, for symmetry with `DepthSorter.add`. You will not need it.
   * @throws RangeError if the sorter's fill count and this bucket's have diverged — i.e. if
   *   something called `order.add` or `order.addPoint` directly. See the class doc.
   * @throws RangeError (from `DepthSorter.add`) if `w` or `d` is not a positive finite number.
   *   Nothing is stored when it does, so the bucket and the sorter stay level across the throw.
   */
  add(item: T, gx: number, gy: number, w: number, d: number, heightPx: number): number;

  /**
   * A walker, a dropped coin, a floating number's origin. `radius` defaults to `iso`'s.
   *
   * @throws RangeError under the same two conditions as {@link Bucket.add}.
   */
  addPoint(item: T, gx: number, gy: number, heightPx: number, radius?: number): number;

  /**
   * The item at an insertion index. Only needed when interoperating with a raw `pickSorted`.
   *
   * @throws RangeError outside `[0, count)`. Returning `undefined` there is what an array does,
   *   and the `!` a caller would reach for to silence it is how a renderer ships a black screen.
   */
  at(index: number): T;

  /**
   * Walk the sorted order **forwards** and paint. This is the painter's algorithm, correctly.
   *
   * Visits exactly `order.count` items — the survivors of the cull, not {@link Bucket.count}.
   *
   * @param visit hoist it to module scope. A closure allocated here is a closure per frame.
   * @throws RangeError if the sorter holds items this bucket did not put there. That is the
   *   bypass again, seen from the other end: `add`'s compare cannot fire for a stray `order.add`
   *   made *after* the last `bucket.add`, so the walk checks it once per frame and once per item.
   */
  each(visit: (item: T, sortedPos: number) => void): void;

  /**
   * Walk **backwards** and return the first item the test accepts, or `undefined`.
   *
   * The exact reverse of the paint order including the tie-break, because it is `pickSorted` on
   * the same sorter instance rather than a second implementation of the same walk. This is the
   * method the whole helper is for: it returns a `T`, so there is no integer for a call site to
   * be wrong about.
   *
   * `pickSorted` stops at the first accepted item, so the walk examines every item painted
   * *after* its answer and none painted before it. That is exactly the set whose identity could
   * change the answer, which is why an early return is still a checked one.
   *
   * @param test hoist it. On a drag this runs per pointer event.
   * @throws RangeError under the same condition as {@link Bucket.each}.
   */
  pick(test: (item: T) => boolean): T | undefined;
}

/**
 * The one implementation.
 *
 * A class rather than a closure over locals so that the methods live on a prototype and are
 * shared by every bucket in the process: fourteen exhibits each carrying five closures per bucket
 * is not a cost anyone would notice, but neither is the class, and this way `add` is one
 * monomorphic call site the engine can see through.
 */
class FrameBucket<T> implements Bucket<T> {
  readonly order: DepthSorter;

  /**
   * Slots `[0, #n)` were written by this bucket this frame. Above `#n` is last frame's rubbish,
   * kept on purpose — see {@link Bucket.clear} — and reachable only through a bug this file
   * throws on.
   */
  readonly #items: T[] = [];
  #n = 0;

  /** The current {@link Bucket.pick} test, held in a field so {@link FrameBucket.#probe} can be
   *  allocated once for the life of the bucket instead of once per pointer event. */
  #test: ((item: T) => boolean) | undefined = undefined;

  /**
   * The adapter between `pickSorted`'s index-shaped test and the caller's item-shaped one.
   *
   * One arrow per bucket, built at construction. Writing `pickSorted(order, i => test(at(i)))`
   * inline would be the same code and would allocate a closure on every pointer event of every
   * drag, which is precisely what `pickSorted`'s own doc comment tells callers not to do.
   */
  readonly #probe = (index: number): boolean => {
    const test = this.#test;
    // Unreachable: `#probe` is only ever passed to `pickSorted` with `#test` set, and `pickSorted`
    // does not retain it. Answering `false` rather than throwing keeps the path free of a branch
    // that exists only to satisfy the type.
    if (test === undefined) return false;
    if (index >= this.#n) this.#stray(index, 'Bucket.pick');
    return test(this.#items[index] as T);
  };

  constructor(order: DepthSorter) {
    this.order = order;
  }

  get count(): number {
    return this.#n;
  }

  clear(): void {
    this.#n = 0;
    this.order.clear();
  }

  add(item: T, gx: number, gy: number, w: number, d: number, heightPx: number): number {
    const i = this.order.add(gx, gy, w, d, heightPx);
    this.#keep(i, item, 'Bucket.add');
    return i;
  }

  addPoint(item: T, gx: number, gy: number, heightPx: number, radius?: number): number {
    const i = this.order.addPoint(gx, gy, heightPx, radius);
    this.#keep(i, item, 'Bucket.addPoint');
    return i;
  }

  at(index: number): T {
    if (!Number.isInteger(index) || index < 0 || index >= this.#n) {
      throw new RangeError(
        `Bucket.at: expected an integer index in [0, ${String(this.#n)}), got ${String(index)}`,
      );
    }
    // Every slot below `#n` was written by `#keep` this frame, in ascending order with no gaps.
    return this.#items[index] as T;
  }

  each(visit: (item: T, sortedPos: number) => void): void {
    const order = this.order;
    const n = order.count;
    this.#assertMine(n, 'Bucket.each');
    const items = this.#items;
    const fill = this.#n;
    for (let i = 0; i < n; i++) {
      const index = order.indexAt(i);
      // One compare per drawable, and it is the last hole: a stray `order.add` after the fill
      // survives the count guard whenever the cull happens to remove at least as many items as
      // the stray added, and then `items[index]` is last frame's sprite at this frame's depth.
      if (index >= fill) this.#stray(index, 'Bucket.each');
      visit(items[index] as T, i);
    }
  }

  pick(test: (item: T) => boolean): T | undefined {
    this.#assertMine(this.order.count, 'Bucket.pick');
    const previous = this.#test;
    this.#test = test;
    try {
      const index = pickSorted(this.order, this.#probe);
      return index < 0 ? undefined : this.at(index);
    } finally {
      // Restored rather than cleared, so a `test` that itself picks — a hit-test that falls back
      // to a second pass — leaves the outer walk's test in place instead of nulling it.
      this.#test = previous;
    }
  }

  /** The compare that is the entire reason this file exists. One integer, per drawable, per
   *  frame, and it converts every misalignment reachable from here into a named throw. */
  #keep(i: number, item: T, where: string): void {
    if (i !== this.#n) {
      throw new RangeError(
        `${where}: the sorter has ${String(i)} items and this bucket has ${String(this.#n)}. ` +
          `Something called order.add() or order.addPoint() directly — every drawable in a frame goes ` +
          `through one bucket, or the item array stops lining up with the permutation and the next tap ` +
          `opens the thing behind the thing the player touched.`,
      );
    }
    this.#items[i] = item;
    this.#n = i + 1;
  }

  /** `order.count` can only ever shrink at `sort()`, so a sorter holding more than the bucket
   *  filled is holding somebody else's items. Once per `each`, once per `pick` — not per item. */
  #assertMine(count: number, where: string): void {
    if (count > this.#n) {
      throw new RangeError(
        `${where}: the sorter holds ${String(count)} items and this bucket only filled ` +
          `${String(this.#n)}. Something called order.add() or order.addPoint() directly after the ` +
          `bucket's fill — the permutation now covers slots the bucket never wrote, and painting it ` +
          `would put last frame's drawable at this frame's depth.`,
      );
    }
  }

  #stray(index: number, where: string): never {
    throw new RangeError(
      `${where}: the sorted order points at insertion index ${String(index)} and this bucket ` +
        `only filled ${String(this.#n)} items. Something called order.add() or order.addPoint() ` +
        `directly after the bucket's fill and the cull then hid the count mismatch — that slot ` +
        `holds whatever the largest earlier frame left in it.`,
    );
  }
}

/**
 * Build a bucket over a sorter. Once, at setup — never per frame.
 *
 * `T` is opaque and is meant to be a union: the demo's is `Thing | number`, a sprite for the built
 * world and a bare id for the crowd. Discriminating that union at paint time is the exhibit's job
 * and always was; what the bucket removes is the *index arithmetic* that used to stand in for the
 * discrimination and was wrong in a way nothing reported.
 *
 * @param order the frame's sorter. The bucket does not own it, does not sort it, and does not
 *   know about the camera — `renderFrame` calls `order.sort(camera)` immediately before the
 *   solids pass precisely so no window exists in which somebody holds a sorted order and improves
 *   it, and a bucket that sorted would reopen it.
 */
export function createBucket<T>(order: DepthSorter): Bucket<T> {
  return new FrameBucket<T>(order);
}
