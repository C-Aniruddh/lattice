/**
 * An order over a frame's ground footprints, and nothing else.
 *
 * **This package owns the comparator, the order, and the backwards walk that makes picking
 * correct. `@latticekit/draw` owns the items, the passes and the bucket.** A draw list is a list
 * of things to draw and `iso` must not know what a drawable is: the moment a sorter holds ids
 * it is modeling the caller's entities, and the moment it has passes it is a renderer. What
 * is genuinely ours is narrower and sharper — *given a set of ground footprints, what order do
 * they occlude in* — and that is a permutation of integers with no notion of an item at all.
 *
 * ## The frame-bucket rule
 *
 * The integers handed back here index **one** array, and the caller owns it:
 *
 * > One sorter per frame, one item array per sorter, and every drawable in the frame goes
 * > through the same fill. `add` returns the slot to write the item into; `indexAt` and
 * > `pickSorted` hand that same slot back.
 *
 * It is stated here rather than left to each caller because breaking it does not crash. An
 * insertion index is an index into the *fill*, not into any of the collections that fed it, so
 * a frame that keeps buildings in one array and walkers in another has to translate — and the
 * `items[index - buildings.length]` that does the translating is a guess about how many items
 * the first collection contributed this frame. It is right until the frame the counts differ,
 * and then a tap opens the building *behind* the one under the finger: intermittent, invisible
 * in a screenshot, and with nothing in either array to say which one is wrong.
 *
 * `docs/rfc/depth-bucket.md` is the long version, and `examples/_shared`'s `createBucket` is
 * the helper that makes the two writes a single call so they cannot drift apart.
 *
 * ## Why this is not a comparison sort
 *
 * The isometric occlusion rule is
 *
 * > `a` is strictly behind `b` ⟺ `a` ends before `b` begins on **either** axis.
 *
 * That relation is not a total order and not even transitive, so handing it to `Array.sort`
 * gives an implementation-defined result that differs between engines and flickers between
 * frames. A *scalar* depth cannot express it either: in the game this kit came from,
 * buildings sorted on the sum of their far corner and pedestrians on `gx + gy`, and a
 * pedestrian standing well down the map but far to the left of the headquarters got a larger
 * key and was drawn straight through its wall at second-storey height. Player pass 3
 * reproduced it twice.
 *
 * So {@link DepthSorter.sort} is a topological sort with a depth-ordered ready set. Genuinely
 * incomparable pairs fall back to `depthOf`, then to insertion index — the Lattice ordering
 * rule, which is why there is no comparator parameter anywhere in this file.
 *
 * ## Why it is not the obvious O(n²)
 *
 * Kahn's algorithm needs to know when an item has nothing left behind it, and the naive form
 * asks that of every pair. It does not have to. Item `b` is ready exactly when
 *
 * > `b.gx0 < min{ a.gx1 }` and `b.gy0 < min{ a.gy1 }`, over the items not yet emitted
 *
 * — because "no unemitted `a` ends before `b` begins" *is* a statement about two minima. The
 * `a ≠ b` the definition asks for turns out not to matter: the only item the exclusion could
 * affect is the one holding the minimum, and for that item the test is `b.gx0 < b.gx1`, which
 * is true for every footprint with a positive extent. That is why {@link DepthSorter.add}
 * refuses a zero-width one by name rather than quietly accepting it.
 *
 * Both minima only ever rise as items are emitted, so readiness is monotone and four sorted
 * index arrays plus four pointers find every newly-ready item in linear total time. The sort
 * is `O(n log n)`, allocation-free once warm, and identical on every engine.
 *
 * ## Elevation is not in it
 *
 * `add` takes `heightPx` for **culling only** and the sort never reads it. In a 2:1
 * projection what occludes what is decided entirely on the ground plane; height moves a
 * sprite up the screen, it does not move it towards the viewer. Sorting by `gx + gy + z`
 * draws a lamp on the ridge in front of the gate that is plainly standing between it and the
 * camera.
 */

import type { Camera } from './camera.js';
import { HALF_H, HALF_W } from './projection.js';
import { MinHeap, sortIndicesByKey } from './heap.js';

/** Flags kept per item during a sort. Named rather than inlined because a bare `1` and `2` in
 *  a bit test is the kind of thing that gets swapped in a refactor and produces a draw order
 *  that is subtly, unreproducibly wrong. */
const READY_X = 1;
const READY_Y = 2;
const EMITTED = 4;

/**
 * An order over a frame's ground footprints: fed rectangles, hands back a permutation.
 *
 * Holds five numbers per item in flat typed arrays — no ids, no closures, no entities. The
 * game this kit came from pushed `{ depth, x0, x1, y0, y1, draw: () => … }` per item per
 * frame; that is one object plus one closure per sprite per frame, and it was the largest
 * avoidable allocation in the whole renderer.
 *
 * Fill it, sort it, walk it forwards to paint, walk it backwards to pick. What sits at each
 * position is the caller's business.
 *
 * **One sorter takes everything** — buildings, scenery, walkers, ghosts. Two separately
 * sorted lists make trees pop through walls no matter how correct each list is on its own,
 * and that is the deeper reason this holds rectangles rather than typed items: a sorter that
 * knew what a building was would invite a second one for trees.
 */
export class DepthSorter {
  #x0: Float64Array;
  #y0: Float64Array;
  #x1: Float64Array;
  #y1: Float64Array;
  #height: Float64Array;
  #depth: Float64Array;

  /** The permutation, and the five orderings the sweep walks. */
  #order: Int32Array;
  #byX0: Int32Array;
  #byY0: Int32Array;
  #byX1: Int32Array;
  #byY1: Int32Array;
  #byDepth: Int32Array;
  #flags: Uint8Array;
  /** The ready set: everything with nothing left behind it, smallest depth first. */
  #ready: MinHeap;

  #added = 0;
  #count = 0;
  /** Whether `#order[0, #count)` is a sort's output over the current contents. See the getter
   *  — the whole value of this bit is in what lowers it, not in what raises it. */
  #sorted = false;

  /** @param capacity Items to pre-allocate for. Grows by doubling; sized right it never
   *   grows, which is the difference between an allocation-free frame and one that pauses
   *   the first time a busy scene appears. */
  constructor(capacity = 256) {
    const n = Math.max(1, capacity);
    this.#x0 = new Float64Array(n);
    this.#y0 = new Float64Array(n);
    this.#x1 = new Float64Array(n);
    this.#y1 = new Float64Array(n);
    this.#height = new Float64Array(n);
    this.#depth = new Float64Array(n);
    this.#order = new Int32Array(n);
    this.#byX0 = new Int32Array(n);
    this.#byY0 = new Int32Array(n);
    this.#byX1 = new Int32Array(n);
    this.#byY1 = new Int32Array(n);
    this.#byDepth = new Int32Array(n);
    this.#flags = new Uint8Array(n);
    this.#ready = new MinHeap(n);
  }

  /** Items surviving the cull. Before {@link DepthSorter.sort} this is everything added. */
  get count(): number {
    return this.#count;
  }

  /**
   * Whether the permutation is currently valid for the contents — the only question a reader
   * of {@link DepthSorter.indexAt} needs answered, and the reason it is phrased that way.
   *
   * Not "has `sort` ever been called". {@link DepthSorter.add}, `addPoint` and
   * {@link DepthSorter.clear} lower it, because they change the set the permutation is a
   * permutation *of*, and those three are the only ways the contents can move. So the honest
   * question and the cheap flag are the same bit, and the name is about the order rather than
   * about a call in the past.
   *
   * **It exists because nothing else on this surface can tell the two states apart.** Before a
   * sort, `count` is the fill count and `indexAt(i)` is `i` — and an unculled frame whose items
   * happened to arrive in depth order is bit-identical to that. Every detector assembled from
   * `count` and `indexAt` is therefore a false alarm on a real frame, which is why the frame
   * bucket above this package shipped no detector at all and routed the gap back here: one bit
   * that only this class can set closes it, and nothing outside could.
   *
   * What it deliberately does **not** claim is that the cull still matches the camera. A camera
   * that pans after `sort()` leaves the survivor set stale, and that is not this flag's
   * business: paint and pick read the same stale set from the same instance, so they still
   * agree with each other, and agreement is the property the contract with `@latticekit/draw`
   * actually rests on.
   */
  get sorted(): boolean {
    return this.#sorted;
  }

  /** Drop every item, keeping the buffers. Call it once at the top of the frame — a sorter
   *  that is not cleared paints last frame's world underneath this one's. */
  clear(): void {
    this.#added = 0;
    this.#count = 0;
    // The permutation is now a permutation of nothing. `add` lowers the flag too, so no
    // *index* read could survive this line either way — what this lowering buys is that the
    // flag is honest in the window between the clear and the first add, where `count` is 0 and
    // an unguarded `pickSorted` would answer "nothing is there" about a world it has not seen.
    this.#sorted = false;
  }

  #grow(): void {
    const next = this.#x0.length * 2;
    const wide = (src: Float64Array): Float64Array => {
      const out = new Float64Array(next);
      out.set(src);
      return out;
    };
    const wideI = (src: Int32Array): Int32Array => {
      const out = new Int32Array(next);
      out.set(src);
      return out;
    };
    this.#x0 = wide(this.#x0);
    this.#y0 = wide(this.#y0);
    this.#x1 = wide(this.#x1);
    this.#y1 = wide(this.#y1);
    this.#height = wide(this.#height);
    this.#depth = wide(this.#depth);
    this.#order = wideI(this.#order);
    this.#byX0 = wideI(this.#byX0);
    this.#byY0 = wideI(this.#byY0);
    this.#byX1 = wideI(this.#byX1);
    this.#byY1 = wideI(this.#byY1);
    this.#byDepth = wideI(this.#byDepth);
    const flags = new Uint8Array(next);
    flags.set(this.#flags);
    this.#flags = flags;
  }

  /**
   * Add a footprint.
   *
   * @param heightPx Height above the `z = 0` plane, **for culling only** — ground elevation
   *   plus the object's own height. Under-declare it and the roof pops as the base leaves the
   *   screen; over-declare it and you draw a few items you did not need to. The sort never
   *   reads it.
   * @returns the insertion index. **Keep it in the frame's one item array, at exactly this
   *   slot** — `items[order.add(…)] = thing` — because that slot is what `indexAt` hands back
   *   at paint time and what `pickSorted` answers with on a tap. Keeping it anywhere else (a
   *   second array, a map keyed by something else, an offset into the collection this item
   *   came from) is the frame-bucket rule in this module's header, broken. It is also the
   *   sort's final tie-break.
   * @throws RangeError if `w` or `d` is not a positive finite number. A zero-extent footprint
   *   is incomparable with everything that shares either of its spans, which is not a corner
   *   case but the exact condition the readiness test in this module's header relies on being
   *   impossible.
   */
  add(gx: number, gy: number, w: number, d: number, heightPx: number): number {
    if (!(w > 0) || !(d > 0) || !Number.isFinite(w) || !Number.isFinite(d)) {
      throw new RangeError(
        `DepthSorter.add: expected w and d to be finite numbers > 0, got ${String(w)} and ${String(d)}`,
      );
    }
    if (this.#added === this.#x0.length) this.#grow();
    const i = this.#added;
    this.#added = i + 1;
    this.#x0[i] = gx;
    this.#y0[i] = gy;
    this.#x1[i] = gx + w;
    this.#y1[i] = gy + d;
    this.#height[i] = heightPx;
    // The far corner, which is what makes a 2x2 building sort as if it stood on the tile
    // nearest the camera. Without the extent terms a large building draws behind the small
    // one beside it.
    this.#depth[i] = gx + w + (gy + d);
    this.#order[i] = i;
    this.#count = this.#added;
    // The permutation no longer covers the contents — it is short by this item. Lowered here
    // rather than on entry so that a *rejected* add, which stored nothing, leaves a sorted
    // order sorted: the caller's mistake was the argument, and invalidating a good permutation
    // as a side effect of throwing would turn one named error into two.
    this.#sorted = false;
    return i;
  }

  /**
   * Add a point-like thing — a walker, a floating number's origin, a dropped resource.
   *
   * Given a small square footprint rather than zero extent, so it can be strictly *beside* a
   * wall instead of forever ambiguous with it. A true point shares a span with every footprint
   * it stands near and is therefore incomparable with all of them, which is how pedestrians
   * end up drawn through a wall at second-storey height.
   *
   * @param radius Half-extent in tiles, default `0.15`. Big enough to be decidable, small
   *   enough that two walkers standing on the same tile still sort by where they are standing.
   * @throws RangeError if `radius` is not a positive finite number.
   */
  addPoint(gx: number, gy: number, heightPx: number, radius = 0.15): number {
    return this.add(gx - radius, gy - radius, radius * 2, radius * 2, heightPx);
  }

  /**
   * Cull against the camera, then order back-to-front. Allocation-free after warm-up.
   *
   * Culling lives here rather than in `draw` because it is a camera-geometry question, not a
   * rendering one — it is `Camera.isVisible` applied to a footprint's world bounds, extended
   * upward by the height. Every consumer would otherwise write the same six lines and one of
   * them would forget the height, which pops skylines in and out along the bottom edge.
   *
   * @param camera Omit to sort without culling — useful for tests and for offscreen passes.
   *   Culling reads `camera.isVisible`, which is the caller's code; if it throws, this method
   *   leaves {@link DepthSorter.sorted} down rather than half-raised.
   */
  sort(camera?: Camera): void {
    const n = this.#cull(camera);
    this.#count = n;
    // Raised after the cull, not on entry: `#cull` calls the caller's `camera.isVisible`, and a
    // throw from there leaves `#order` half-rewritten — a permutation of neither the old
    // contents nor the new. Everything below this line is arithmetic over typed arrays and
    // cannot throw, so this is the first point at which the flag would be true.
    this.#sorted = true;
    if (n <= 1) return;

    const x0 = this.#x0;
    const y0 = this.#y0;
    const x1 = this.#x1;
    const y1 = this.#y1;
    const depth = this.#depth;
    const flags = this.#flags;
    const order = this.#order;
    const byX0 = this.#byX0;
    const byY0 = this.#byY0;
    const byX1 = this.#byX1;
    const byY1 = this.#byY1;
    const byDepth = this.#byDepth;
    const ready = this.#ready;

    ready.clear();
    for (let i = 0; i < n; i++) {
      const id = order[i] as number;
      flags[id] = 0;
      byX0[i] = id;
      byY0[i] = id;
      byX1[i] = id;
      byY1[i] = id;
      byDepth[i] = id;
    }
    sortIndicesByKey(byX0, n, x0);
    sortIndicesByKey(byY0, n, y0);
    sortIndicesByKey(byX1, n, x1);
    sortIndicesByKey(byY1, n, y1);
    sortIndicesByKey(byDepth, n, depth);

    // px/py advance through the items whose near edge has been cleared; qx/qy advance past
    // items already emitted, to find the current smallest far edge; pd is the cycle-break
    // cursor and everything before it has been emitted. All five only ever move forwards,
    // which is the whole reason this is O(n log n) rather than O(n²).
    let px = 0;
    let py = 0;
    let qx = 0;
    let qy = 0;
    let pd = 0;

    for (let step = 0; step < n; step++) {
      while (qx < n && ((flags[byX1[qx] as number] as number) & EMITTED) !== 0) qx += 1;
      while (qy < n && ((flags[byY1[qy] as number] as number) & EMITTED) !== 0) qy += 1;
      // No bounds fallback: `step < n` means at least one item is still unemitted, and both
      // cursors stop at the first unemitted item, so neither can run off the end.
      const tx = x1[byX1[qx] as number] as number;
      const ty = y1[byY1[qy] as number] as number;

      while (px < n) {
        const id = byX0[px] as number;
        if (!((x0[id] as number) < tx)) break;
        px += 1;
        const f = ((flags[id] as number) | READY_X) as number;
        flags[id] = f;
        if ((f & (READY_Y | EMITTED)) === READY_Y) ready.push(id, depth[id] as number, id);
      }
      while (py < n) {
        const id = byY0[py] as number;
        if (!((y0[id] as number) < ty)) break;
        py += 1;
        const f = ((flags[id] as number) | READY_Y) as number;
        flags[id] = f;
        if ((f & (READY_X | EMITTED)) === READY_X) ready.push(id, depth[id] as number, id);
      }

      // The heap never holds an item that has already been emitted, and that is worth stating
      // because it is the reason there is no discard loop here: an item is pushed exactly once
      // — at the moment its second readiness flag is set — the push is skipped if it is
      // already emitted, and a cycle-break only fires when the heap is empty.
      let pick = ready.pop();

      if (pick < 0) {
        // Nothing is ready, so what remains contains a cycle. Cycles are real and mostly
        // harmless: two footprints far apart on opposite sides of the screen each "end before
        // the other begins" on one axis, and neither occludes the other at all. Break it the
        // way an incomparable pair is broken — smallest depth, then insertion index — so the
        // choice is the documented one rather than whichever item the loop reached first.
        // `pd` is guaranteed to find an unemitted item: `step < n` means one exists, and
        // everything before `pd` has already been emitted.
        while (((flags[byDepth[pd] as number] as number) & EMITTED) !== 0) pd += 1;
        pick = byDepth[pd] as number;
      }

      flags[pick] = ((flags[pick] as number) | EMITTED) as number;
      order[step] = pick;
    }
  }

  /**
   * The **insertion index** at sorted position `i`, `0 ≤ i < count`, back to front.
   *
   * This is the whole output: `for (let i = 0; i < s.count; i++) paint(items[s.indexAt(i)])`
   * is the painter's algorithm, correctly.
   *
   * @throws TypeError if {@link DepthSorter.sorted} is false — before the first `sort()`, or
   *   after an `add` or a `clear` invalidated the permutation. This used to return insertion
   *   order, "a defined answer rather than a useful one", and defined was the problem: it is
   *   indistinguishable from a sorted, unculled frame, so the caller got a plausible integer,
   *   painted a plausible-looking frame in fill order, and picked from a permutation that no
   *   longer described their items. There is no longer any expression that yields an index
   *   from an invalid permutation — this method and `pickSorted` are the only two readers, and
   *   both refuse. A `TypeError` rather than a `RangeError` because `i` is not the wrong value:
   *   the receiver is in the wrong state, the same kind of mistake as releasing a pooled
   *   instance twice.
   * @throws RangeError outside `[0, count)`. Checked second, because before a sort `count` is
   *   the fill count rather than the survivor count, and a range reported against it would name
   *   a bound that the caller's next correct step is about to change.
   *   An out-of-range read would return `undefined` from the typed array, and the `!` someone
   *   would reach for to silence that is how a renderer ships a black screen.
   */
  indexAt(i: number): number {
    if (!this.#sorted) {
      throw new TypeError(
        `DepthSorter.indexAt: this order is not sorted — sort() has not run since the last add() or clear(). ` +
          `The permutation here is insertion order wearing a sorted order's clothes: painting it paints ` +
          `the frame in fill order, and picking from it answers with whatever item happens to hold that slot.`,
      );
    }
    if (!Number.isInteger(i) || i < 0 || i >= this.#count) {
      throw new RangeError(
        `DepthSorter.indexAt: expected an integer index in [0, ${String(this.#count)}), got ${String(i)}`,
      );
    }
    return this.#order[i] as number;
  }

  /** Compact the surviving insertion indices into the head of `#order` and return how many
   *  there are. Without a camera every item survives, which is what makes an offscreen pass
   *  and a test the same code path as a frame. */
  #cull(camera: Camera | undefined): number {
    const n = this.#added;
    const order = this.#order;
    if (camera === undefined) {
      for (let i = 0; i < n; i++) order[i] = i;
      return n;
    }
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const gx0 = this.#x0[i] as number;
      const gy0 = this.#y0[i] as number;
      const gx1 = this.#x1[i] as number;
      const gy1 = this.#y1[i] as number;
      // footprintBounds, inlined: the loop runs once per drawable per frame and a call that
      // fills a Rect would need a Rect to fill, which is the allocation this class exists to
      // avoid. minY carries the height because a tall building whose base is below the
      // viewport still shows its roof.
      const minX = (gx0 - gy1) * HALF_W;
      const maxX = (gx1 - gy0) * HALF_W;
      const minY = (gx0 + gy0) * HALF_H - (this.#height[i] as number);
      const maxY = (gx1 + gy1) * HALF_H;
      if (camera.isVisible(minX, minY, maxX, maxY)) {
        order[kept] = i;
        kept += 1;
      }
    }
    return kept;
  }
}

/**
 * What the player tapped: the insertion index of the **last-painted** item whose `test`
 * returns true, or `-1`.
 *
 * Walks a sorted {@link DepthSorter} backwards, so it is the exact reverse of the paint order
 * *including the tie-break*. A tap on a rack that opened the headquarters beside it — both at
 * the same depth, the pick testing the one that had been painted underneath — was a real,
 * shipped, player-found bug, and it cannot recur as long as the sorter passed here is the one
 * that produced the paint order.
 *
 * **That last clause is a cross-package contract, not a hope.** `@latticekit/draw` paints
 * `for i in 0..count: paint(items[order.indexAt(i)])` and must not reorder after `sort()`;
 * this walks that same instance backwards. The two cannot disagree unless that rule is
 * broken, which is why the contract is written down above both packages rather than left as a
 * comment each side hopes the other read.
 *
 * {@link DepthSorter.sorted} now holds up one half of it. A frame that adds, or clears and
 * refills, between the paint and the tap has changed the permutation under the pick, and that
 * is the half this can see: it throws instead of answering. The other half — a pass that
 * partitions or re-walks `draw`'s *own* item array while leaving the sorter alone — is
 * invisible from here, because nothing about it touches this object; it stays a contract test
 * above both packages. Knowing which half is enforced is worth more than believing both are.
 *
 * @param order the sorter that painted. Named for what it is rather than for its state, now
 *   that the state is a property on it.
 * @param test receives the insertion index. Hoist it out of the frame — a closure allocated
 *   per tap is a closure allocated per tap, and on a drag that is per pointer event.
 * @throws TypeError if `order` is not sorted. The loop below would throw from `indexAt` on its
 *   first step anyway — but not when `count` is 0, and that is the case this guard is really
 *   for. An unsorted sorter with a count of 0 is an *empty* one, so `-1` would be a true
 *   statement about the sorter and a false one about the frame: it reads as "the player tapped
 *   empty ground" when the honest answer is "this order does not know what was painted". A
 *   caller who genuinely wants the tolerant version — a tap that can arrive before the first
 *   frame has rendered — writes `if (order.sorted) …` and gets to decide what silence means,
 *   which is the other thing publishing the bit is for.
 */
export function pickSorted(order: DepthSorter, test: (index: number) => boolean): number {
  if (!order.sorted) {
    throw new TypeError(
      `pickSorted: this order is not sorted — sort() has not run since the last add() or clear(). ` +
        `A pick has to walk the permutation that painted; walking any other one names the wrong item ` +
        `under the finger, which is the exact bug this function exists to prevent.`,
    );
  }
  for (let i = order.count - 1; i >= 0; i--) {
    const index = order.indexAt(i);
    if (test(index)) return index;
  }
  return -1;
}
