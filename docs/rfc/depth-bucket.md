# The drawable bucket — who owns the array the sorter indexes into

> **Status:** decided at `K3`. Nothing in `packages/` changes.
> **Decision:** the seam stays exactly where `iso` and `draw` put it. The bucket is a **gallery
> instrument**, built once in `examples/_shared/bucket.ts`, and the pattern it implements gets a
> name so that a game not using the helper can still be told it is doing the right thing.
> **Owner of the implementation:** `G0` (the exhibit bootstrap). This document is its spec.

---

## The one sentence

**`DepthSorter` hands back integers because an order over rectangles is all it is entitled to
know — so somebody above it has to hold the array those integers index into, and that somebody
is neither `iso` nor `draw` but the frame itself.**

## The five-line example

This is what an exhibit should write. Everything below exists to make these five lines the
easiest thing to type.

```ts
const bucket = createBucket<Drawable>(order);            // once, at setup
bucket.clear();                                          // once, at the top of the frame
for (const t of things) bucket.add(t, t.gx, t.gy, t.def.w, t.def.d, t.top);
for (let i = 0; i < walkers; i++) bucket.addPoint(pilgrims[i], here.gx, here.gy, z);
bucket.each(paint);                                      // in the solids pass. hoisted callback
```

and on a tap, the line that is the whole point:

```ts
const hit = bucket.pick(underFinger);   // returns a Drawable | undefined. never an integer
```

**No exhibit ever sees an insertion index again.** That is the entire deliverable.

---

## The evidence

`examples/demo/src/main.ts`, the exhibit that is the only thing anyone has actually built on
this kit, spends about thirty-seven lines on the bucket and gets one thing structurally wrong:

```ts
let things: Thing[] = [];                     // rebuilt only when `dirty`
…
order.clear();
for (const t of things) order.add(t.gx, t.gy, t.def.w, t.def.d, t.base + spriteHeightPx(…));
for (let i = 0; i < walkers; i++) order.addPoint(here.gx, here.gy, z, 0.2);
…
const t = things[index];
if (t !== undefined) { drawSprite(…); continue; }
const id = index - things.length;             // ← this
```

`index - things.length` is arithmetic that is correct only while three separate facts hold
simultaneously: `things` was filled before the walkers, `order` was filled in the same order as
`things`, and `walkers` did not change between the fill and the walk. None of the three is
checked, none of them is local to the line that depends on them, and the failure mode is a
**silent mis-pick** — `pickSorted` returns an honest insertion index, `things[index]` returns
the wrong sprite or `undefined`, and the tap lights a lamp the player was not pointing at.

That is the exact bug `pickSorted` was written to make impossible. It got back in one layer up.

### What the exhibit should have done, and why noticing that does not settle it

`DepthSorter.add` already returns the insertion index, and its doc comment already says
**"Keep it: it is how the caller maps a sorted position back to its own item."** The exhibit did
not keep it; it re-derived it. One array pushed in lockstep with the sorter would have been
correct by construction and needed nothing from anybody:

```ts
items.length = 0;
for (const t of things) { order.add(…); items.push(t); }
for (let i = 0; i < walkers; i++) { order.addPoint(…); items.push(pilgrims[i]); }
```

So the missing piece is not a capability. **The documentation answer has already been tried and
has already failed** — the `@returns` tag said the right thing in the right place and the first
consumer to read it still wrote the subtraction. A doc that has failed once is not the fix for
fourteen more attempts at the same file.

### Why the exhibit reached for arithmetic

Not carelessness. `things` is a **persistent** collection rebuilt on `dirty`; the walkers are a
**per-frame** one. The exhibit had one array in a persistent role and needed a second in a
per-frame role, and merged them with an offset instead of admitting they are different objects
with different lifetimes.

That is the finding worth writing down, and it is a fact about the kit's shape rather than about
this author: **the sorter's index space is per-frame, and anything parallel to it must be
per-frame too.** Nothing in `iso` or `draw` says so, because neither of them is allowed to have
an opinion about a collection they do not hold.

---

## The three options, judged

### A. An optional item channel on `DepthSorter` — rejected

`class DepthSorter<T = never>`, `add(gx, gy, w, d, h, item?: T)`, `itemAt(i): T`, and
`pickSorted` returns a `T`. It is the obvious answer and it fails on four counts, of which the
third is the one that actually decides it.

1. **The generic infects `draw`'s signatures.** `Passes.solids(pen: Pen, order: DepthSorter)` and
   `renderFrame(pen, passes, order?: DepthSorter)` both name the type. `draw` cannot know `T`, so
   it must write `DepthSorter<unknown>` — and TypeScript's method-parameter bivariance means
   `DepthSorter<Thing>` assigns to `DepthSorter<unknown>` **unsoundly**, handing `draw` an `add`
   it could call with anything. This kit already has a paragraph in `AGENTS.md` about assuming a
   `readonly` is a barrier when it is not; buying the same class of false guarantee deliberately
   is worse.
2. **It contradicts a settled seam for an ergonomic reason.** `docs/SEAMS.md` records `iso`
   deleting `Scene` and `draw` deleting `DrawList` independently, on arguments that both still
   hold. Overturning that needs a capability nobody has; it does not need a twenty-five-line
   helper's worth of convenience.
3. **It does not solve the exhibit's problem.** The demo's bucket is *heterogeneous* — `Thing`
   for the built world and a walker id for the crowd. `T` would be `Thing | Walker`, and the
   solids pass would still have to discriminate the union at paint time. The item channel removes
   the subtraction; it does **not** remove the branch, and the subtraction is already removable
   for free with `add`'s existing return value. It buys the cheap half of the problem at the cost
   of a generic in five public signatures.
4. **It breaks the class's stated premise.** `DepthSorter` is six flat typed arrays and a
   documented boast that the source game's `{ depth, x0, x1, y0, y1, draw: () => … }` per item per
   frame was its largest avoidable allocation. A `T[]` of references beside them makes the sorter
   retain the caller's entity graph for its own lifetime, and a sorter is a long-lived object.

### B. A shared helper in `examples/_shared/` — **chosen**

Twenty-five lines that own **both** halves — the sorter fill and the item array — so that the two
cannot drift, because no caller ever touches one without the other.

It goes in `_shared` rather than `packages/` for a reason that is not "packages are busy this
cycle". `GALLERY.md` says the gallery's job is to find the places several exhibits hand-roll the
same thirty lines, and that finding one **is a gap in the kit rather than a coincidence**. A
helper in `_shared` is the instrument that produces that evidence; promoting it into `iso` or
`draw` today would spend the seam before the evidence exists. See *Promotion*, below.

### C. A documented refusal with a named pattern — necessary, not sufficient

Adopted **as well as** B, never instead of it. The name is *the frame bucket* and the rule is one
line, given below. A game that does not import `_shared` still needs to be told what the correct
shape is, and "ten exhibits writing it ten times" is not an answer whether or not it is
documented.

---

## The surface

`examples/_shared/bucket.ts`. No dependency on anything but `@latticekit/iso`.

```ts
import { DepthSorter, pickSorted } from '@latticekit/iso';

/**
 * A frame's drawables, in one array whose indices are the sorter's own insertion indices.
 *
 * The bucket exists because `DepthSorter` returns integers and refuses — correctly — to know
 * what they stand for. Somebody has to hold the array those integers index into. Doing it by
 * hand is four lines and one of them is an offset subtraction that is silently wrong the first
 * time a second collection joins the frame; that mis-pick opens the building behind the one
 * under the player's finger, which is the exact bug `pickSorted` exists to prevent.
 *
 * **One bucket per sorter, one sorter per frame.** Two buckets sharing a sorter is the same
 * desync in a more expensive costume, and `add` refuses it by name.
 */
export interface Bucket<T> {
  /** The sorter this bucket fills. Pass it to `renderFrame`; do not call `add` on it. */
  readonly order: DepthSorter;

  /** Items added this frame — **before** `sort()` culls. Not `order.count` after it. */
  readonly count: number;

  /**
   * Drop the frame's items. Call it in the same statement as `order.clear()` and never
   * separately: a bucket cleared without its sorter, or the reverse, is the desync.
   *
   * Slots are not truncated and references are not nulled — a discarded item stays reachable
   * until its slot is overwritten, bounded by the largest scene the bucket has ever held. That
   * is deliberate: truncating an array frees its backing store and buys a reallocation on the
   * next frame, and this runs sixty times a second.
   */
  clear(): void;

  /** @returns the insertion index, for symmetry with `DepthSorter.add`. You will not need it. */
  add(item: T, gx: number, gy: number, w: number, d: number, heightPx: number): number;

  /** A walker, a dropped coin, a floating number's origin. `radius` defaults to `iso`'s. */
  addPoint(item: T, gx: number, gy: number, heightPx: number, radius?: number): number;

  /**
   * The item at an insertion index. Only needed when interoperating with a raw `pickSorted`.
   * @throws RangeError outside `[0, count)`.
   */
  at(index: number): T;

  /**
   * Walk the sorted order **forwards** and paint. This is the painter's algorithm, correctly.
   *
   * @param visit hoist it to module scope. A closure allocated here is a closure per frame.
   * @throws RangeError if the sorter has not been sorted this frame — the unsorted order is
   *   insertion order, which is a defined answer that paints a plausible-looking wrong picture.
   */
  each(visit: (item: T, sortedPos: number) => void): void;

  /**
   * Walk **backwards** and return the first item the test accepts, or `undefined`.
   *
   * The exact reverse of the paint order including the tie-break, because it is `pickSorted` on
   * the same sorter instance. This is the method the whole helper is for.
   *
   * @param test hoist it. On a drag this runs per pointer event.
   */
  pick(test: (item: T) => boolean): T | undefined;
}

/** @param order the frame's sorter. The bucket does not own it and does not sort it. */
export function createBucket<T>(order: DepthSorter): Bucket<T>;
```

### The one line of implementation that makes the bug impossible

`Bucket.add` calls `order.add`, and compares the index it gets back with its own:

```ts
const i = this.#order.add(gx, gy, w, d, heightPx);
if (i !== this.#n) {
  throw new RangeError(
    `Bucket.add: the sorter has ${String(i)} items and this bucket has ${String(this.#n)}. ` +
    `Something called order.add() or order.addPoint() directly — every drawable in a frame goes ` +
    `through one bucket, or the item array stops lining up with the permutation and the next tap ` +
    `opens the thing behind the thing the player touched.`,
  );
}
```

One integer compare per drawable per frame, and it converts the entire failure class from
*silent and intermittent* into *thrown, named, and on the offending line*. It is the reason this
is worth twenty-five lines rather than a paragraph telling people to push in lockstep.

---

## The named pattern, for games that do not import the helper

> **The frame bucket.** A `DepthSorter`'s index space is **per-frame**. Anything parallel to it
> is rebuilt in the same loop, in the same order, in the same frame. Persistent entity lists are
> a different object with a different lifetime and are *read into* the bucket, never used as it.
>
> The tell that you have got this wrong is arithmetic on an index — `index - things.length`,
> `index < n ? a : b`, any offset at all. There is exactly one correct expression and it is
> `items[order.indexAt(i)]`.

This belongs in `packages/iso/src/depth.ts`'s module header, beside the paragraph that already
explains why the class holds no items, and in the `lattice-art` / `lattice-world` skill. Both are
outside `K3`'s paths; see *Routed findings*.

---

## What is deliberately absent

- **A `remove`.** The bucket is per-frame; removal is `clear` and refill. A stable slot across
  frames is a different data structure and it is the caller's, not this one's.
- **Sorting, culling, or a camera.** `renderFrame` calls `order.sort(camera)` immediately before
  the solids pass precisely so no window exists in which somebody holds a sorted order and
  improves it. A bucket that sorted would reopen it.
- **Layer or pass membership.** Seven passes are closed at seven and exactly one of them is
  sorted. A bucket that knew about passes is a `DrawList`, which `draw` deleted.
- **Any coupling to `Thing`, `SpriteDef` or `Variant`.** `T` is opaque. The moment the bucket
  knows what a sprite is, it belongs in `draw` and the whole seam argument restarts.
- **A non-generic `Bucket<unknown>` convenience.** It would make `pick` return `unknown` and
  every call site would cast, which is the `any` this repo does not allow, wearing a hat.

## Invariants a reviewer can test

| # | invariant | how it fails |
|---|---|---|
| B1 | `bucket.at(bucket.add(item, …)) === item`, for every add, always. | The helper is pointless. |
| B2 | `bucket.count === bucket.order.count` at every point before `sort()`. | The desync; caught by the compare in `add`. |
| B3 | A direct `order.add(…)` between two `bucket.add(…)` calls **throws**, and the message names `order.add`. | The bypass is the only way to reintroduce the bug, so it must be loud. |
| B4 | `bucket.pick(t)` returns the same item as `bucket.at(pickSorted(order, i => t(bucket.at(i))))`. | `pick` is a wrapper; if it disagrees it is a second implementation. |
| B5 | `bucket.each` visits exactly `order.count` items — the culled count, not `bucket.count` — in `indexAt` order. | Painting culled items, or painting in insertion order and looking almost right. |
| B6 | Fill → sort → each → pick, a thousand times, allocates nothing after the first frame. | The helper reintroduces the per-item object `DepthSorter` exists to avoid. |
| B7 | With one item added by hand and `sort()` never called, `each` throws rather than painting insertion order. | Insertion order is a defined answer and a wrong picture. |

## Traps

1. **`clear()` on one and not the other.** The bucket's `clear` cannot call `order.clear()` for
   it, because a game may legitimately share the sorter with something else in the same frame —
   so the two clears must be adjacent in the source and the reviewer must check it. B2 catches it
   on the next `add`, but only if the next add exists.
2. **A pooled item reused across frames.** `bucket.add(pilgrims[i], …)` stores a *reference*.
   If the exhibit mutates `pilgrims[i].gx` between the fill and the paint, it painted the new
   position at the old sort key. Fill the pool first, then the bucket — the demo already gets
   this right and its comment (`walkerAt` fills `here`, so it must run before the arguments that
   read it) is the same hazard one level down.
3. **Two buckets, one sorter.** Reads as separation of concerns and is the desync. B3 catches it.
4. **`pick` on an unsorted sorter.** Returns the last item added that passes the test, which on a
   quiet scene is often the right answer, which is how it ships.
5. **Assuming `count` survives `sort()`.** It does not: `sort` culls. `bucket.count` is the fill
   count and `order.count` is the survivor count, and they are deliberately different numbers
   with deliberately different names.

---

## Promotion

The bucket stays in `examples/_shared/` for the whole gallery cycle. At the end of it, the
evidence decides, and the criterion is written down now so it is not relitigated later:

| what the exhibits did | what it means | where the bucket goes |
|---|---|---|
| **six or more of fifteen import it unchanged** | it is a kit feature that happens to live outside the kit | into `@latticekit/kit` beside `bootstrap()`, as the second thing that package exists for |
| **exhibits fork it** — different `T` shapes, different `each` | it is per-game plumbing | stays in `_shared`; the named pattern is the deliverable |
| **fewer than three import it** | the demo's thirty-seven lines were a demo problem | delete it, keep the pattern, and this document was still worth writing |

`@latticekit/kit` does not exist. `examples/demo/README.md` asks for it independently, for
`bootstrap({ mount, seed })`, and the two requests should be answered by one package or neither —
a kit-level convenience package with exactly one export is a package nobody installs.

## Routed findings — outside `K3`'s paths

1. **`packages/iso/src/depth.ts`** — add *the frame bucket* rule to the module header, beside the
   existing "this holds rectangles, not items" argument. That paragraph currently explains a
   refusal without naming what the caller does instead, which is the gap the exhibit fell into.
   One paragraph. Owner: `K1`/`K5` or whoever holds `iso` next.
2. **`packages/iso/src/depth.ts`, `DepthSorter.add`** — the `@returns` tag says "**Keep it**".
   Say *where*: "keep it as the index into a per-frame array you push to in the same loop." The
   current wording is true and the first reader still re-derived it.
3. **`examples/_shared/`** — `G0` owns the implementation. This document is the spec; `G0` should
   not redesign it, and should report back if any of B1–B7 cannot be met.
4. **`docs/SEAMS.md`** — the row *the sorted draw list* records two deletions and does not say who
   ended up holding the list. Add the third clause: **the frame holds it, per frame.** A seam
   table that names two refusals and no owner is how the next architect proposes `Scene` again.
