/**
 * `depth` — the permutation, the partial order, and the cycle that a correct implementation
 * has to survive rather than pretend away.
 *
 * The occlusion relation, stated in full: `a` is strictly behind `b` when `a` ends before `b`
 * begins on **either** axis. Read literally — and it is meant literally — that relation admits
 * two-cycles, and they are not exotic. A footprint far to the left of the screen and one far
 * to the right each end before the other begins, on opposite axes; neither occludes the other
 * and the pair is genuinely incomparable. So I7 is asserted for every pair *except* the
 * mutually-behind ones, and the mutual ones get their own test asserting the documented
 * tie-break instead. An implementation that satisfied I7 for a mutual pair would be satisfying
 * a contradiction.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '@latticekit/core';
import { DepthSorter, pickSorted } from '../src/depth.js';
import { createCamera } from '../src/camera.js';
import type { Camera } from '../src/camera.js';
import { rectSet } from '../src/projection.js';
import type { Rect } from '../src/projection.js';

interface Box {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

const rect = (): Rect => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });

/** `a` ends before `b` begins on either axis — the relation, spelled out once so the tests
 *  cannot drift from the implementation by paraphrasing it. */
function behind(a: Box, b: Box): boolean {
  return a.gx + a.w <= b.gx || a.gy + a.d <= b.gy;
}

function fill(sorter: DepthSorter, boxes: readonly Box[]): void {
  sorter.clear();
  for (const b of boxes) sorter.add(b.gx, b.gy, b.w, b.d, b.h);
}

function permutation(sorter: DepthSorter): number[] {
  const out: number[] = [];
  for (let i = 0; i < sorter.count; i++) out.push(sorter.indexAt(i));
  return out;
}

/** A seeded scatter of footprints. Seeded rather than random so a failure is reproducible;
 *  `core`'s `Rng` rather than `Math.random` because a test that cannot be replayed is a test
 *  that will be quarantined the first time it flakes. */
function scatter(seed: number, n: number, span: number): Box[] {
  const rng = createRng(seed);
  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    boxes.push({
      gx: rng.int(0, span),
      gy: rng.int(0, span),
      w: rng.int(1, 3),
      d: rng.int(1, 3),
      h: rng.int(0, 64),
    });
  }
  return boxes;
}

describe('adding', () => {
  it('hands back the insertion index, which is the caller half of the whole contract', () => {
    const s = new DepthSorter(4);
    expect(s.add(0, 0, 1, 1, 0)).toBe(0);
    expect(s.add(5, 5, 1, 1, 0)).toBe(1);
    expect(s.count).toBe(2);
  });

  it('refuses a zero-extent footprint by name', () => {
    // Not fussiness: the readiness test in the sort relies on `gx0 < gx1` being true for every
    // item, and a zero-extent footprint is incomparable with everything that shares a span
    // with it — which is how pedestrians end up drawn through walls.
    const s = new DepthSorter(4);
    expect(() => s.add(0, 0, 0, 1, 0)).toThrow(/w and d to be finite numbers > 0, got 0 and 1/);
    expect(() => s.add(0, 0, 1, -1, 0)).toThrow(RangeError);
    expect(() => s.add(0, 0, Number.NaN, 1, 0)).toThrow(RangeError);
    expect(() => s.add(0, 0, 1, Infinity, 0)).toThrow(RangeError);
    expect(() => s.addPoint(0, 0, 0, 0)).toThrow(RangeError);
  });

  it('grows past its initial capacity without losing anything', () => {
    const s = new DepthSorter(1);
    for (let i = 0; i < 40; i++) s.add(i, i, 1, 1, 0);
    s.sort();
    expect(permutation(s)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it('clear drops everything and keeps the buffers usable', () => {
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.clear();
    expect(s.count).toBe(0);
    // The permutation is a permutation of nothing, so the refusal names *that* rather than the
    // range — the caller's next step is to refill and sort, not to pick a smaller index.
    expect(() => s.indexAt(0)).toThrow(/is not sorted/);
    s.add(3, 3, 1, 1, 0);
    expect(s.count).toBe(1);
  });

  it('indexAt refuses an out-of-range index rather than returning undefined', () => {
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.sort();
    expect(() => s.indexAt(-1)).toThrow(RangeError);
    expect(() => s.indexAt(1)).toThrow(RangeError);
    expect(() => s.indexAt(0.5)).toThrow(RangeError);
    expect(s.indexAt(0)).toBe(0);
  });

  it('refuses to be read before a sort, where it used to answer insertion order', () => {
    // This is the case the whole `sorted` flag is for. Read pre-sort, the permutation below is
    // `[0, 1]` — and so is a *sorted*, unculled frame whose two items happened to arrive
    // back-to-front. The two states are bit-identical from outside, so no caller could tell
    // them apart, and the one that read this one painted a frame in fill order that looked
    // very nearly right.
    const s = new DepthSorter(4);
    s.add(9, 9, 1, 1, 0);
    s.add(0, 0, 1, 1, 0);
    expect(() => s.indexAt(0)).toThrow(TypeError);
    expect(() => s.indexAt(0)).toThrow(/is not sorted — sort\(\) has not run since the last add\(\) or clear\(\)/);
    // And the same scene sorted: the answer the pre-sort read was impersonating.
    s.sort();
    expect(permutation(s)).toEqual([1, 0]);
  });
});

describe('the order', () => {
  it('I6: is a permutation of the survivors — nothing vanishes and nothing paints twice', () => {
    const boxes = scatter(0xc0ffee, 200, 30);
    const s = new DepthSorter(16);
    fill(s, boxes);
    s.sort();
    expect(s.count).toBe(boxes.length);
    expect([...permutation(s)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: boxes.length }, (_, i) => i),
    );
  });

  it('I7: every non-mutual "behind" pair comes out in that order, exhaustively', () => {
    const boxes = scatter(0x5eed, 120, 24);
    const s = new DepthSorter(128);
    fill(s, boxes);
    s.sort();
    const position = new Map<number, number>();
    for (let i = 0; i < s.count; i++) position.set(s.indexAt(i), i);
    let checked = 0;
    let mutual = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        const a = boxes[i] as Box;
        const b = boxes[j] as Box;
        if (!behind(a, b)) continue;
        if (behind(b, a)) {
          mutual += 1;
          continue;
        }
        checked += 1;
        expect(position.get(i)).toBeLessThan(position.get(j) as number);
      }
    }
    // The counts are asserted so this cannot quietly become a test that checks nothing: if a
    // future change made every pair mutual, `checked` would collapse and the loop above would
    // pass by doing nothing.
    expect(checked).toBeGreaterThan(1000);
    expect(mutual).toBeGreaterThan(0);
  });

  it('T2: sorts a wall in front of the pedestrian standing behind it, which a scalar cannot', () => {
    // The shipped bug: a pedestrian well down the map but far to the left of a building got a
    // larger `gx + gy` than the building and was drawn through its wall at second-storey
    // height. Here the wall at (10, 0) is strictly in front of the walker at (0, 12) on the
    // gx axis, and the walker's scalar depth is the larger of the two.
    const s = new DepthSorter(4);
    const wall = s.add(10, 0, 1, 6, 96);
    const walker = s.addPoint(0.5, 12.5, 0);
    s.sort();
    const order = permutation(s);
    expect(order.indexOf(walker)).toBeLessThan(order.indexOf(wall));
  });

  it('sorts a simple row and column strictly back to front', () => {
    const s = new DepthSorter(8);
    for (let i = 0; i < 6; i++) s.add(i * 2, 0, 1, 1, 0);
    s.sort();
    expect(permutation(s)).toEqual([0, 1, 2, 3, 4, 5]);
    s.clear();
    for (let i = 5; i >= 0; i--) s.add(0, i * 2, 1, 1, 0);
    s.sort();
    expect(permutation(s)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('I8: is deterministic — the same adds in the same order give the same output', () => {
    const boxes = scatter(0xabcdef, 300, 40);
    const a = new DepthSorter(512);
    const b = new DepthSorter(4);
    fill(a, boxes);
    a.sort();
    fill(b, boxes);
    b.sort();
    expect(permutation(b)).toEqual(permutation(a));
  });

  it('I8: terminates on a deliberately cyclic layout and breaks the tie as documented', () => {
    // Two 1x1 footprints, one at (0, 5) and one at (5, 0). The first ends before the second
    // begins on gx; the second ends before the first begins on gy. Each is "behind" the other,
    // and neither occludes the other at all — they are 320 world pixels apart.
    const a: Box = { gx: 0, gy: 5, w: 1, d: 1, h: 0 };
    const b: Box = { gx: 5, gy: 0, w: 1, d: 1, h: 0 };
    expect(behind(a, b) && behind(b, a)).toBe(true);
    const s = new DepthSorter(4);
    fill(s, [a, b]);
    s.sort();
    // Equal depth (both far corners sum to 7), so the tie falls to insertion index.
    expect(permutation(s)).toEqual([0, 1]);
    // …and reversing the insertion order reverses the output, which is what "broken by
    // insertion sequence" means and is why `add` returns the index.
    fill(s, [b, a]);
    s.sort();
    expect(permutation(s)).toEqual([0, 1]);
  });

  it('I8: terminates on a three-cycle too', () => {
    const s = new DepthSorter(8);
    s.add(0, 10, 1, 1, 0);
    s.add(10, 0, 1, 1, 0);
    s.add(20, 20, 1, 1, 0);
    s.sort();
    expect(permutation(s).length).toBe(3);
    expect([...permutation(s)].sort()).toEqual([0, 1, 2]);
  });

  it('breaks a genuine incomparable tie by depth first and insertion second', () => {
    const s = new DepthSorter(8);
    // Three items nobody is behind: identical spans, so nothing separates them on either
    // axis. Depth decides, and equal depths fall to insertion order.
    const far = s.add(0, 0, 1, 1, 0);
    const near = s.add(0, 0, 3, 3, 0);
    const alsoFar = s.add(0, 0, 1, 1, 0);
    s.sort();
    const order = permutation(s);
    expect(order.indexOf(far)).toBeLessThan(order.indexOf(near));
    expect(order.indexOf(far)).toBeLessThan(order.indexOf(alsoFar));
    expect(order.indexOf(alsoFar)).toBeLessThan(order.indexOf(near));
  });

  it('T15: elevation does not enter the sort', () => {
    const flat = new DepthSorter(8);
    const raised = new DepthSorter(8);
    const boxes = scatter(0x111, 60, 20);
    fill(flat, boxes.map((b) => ({ ...b, h: 0 })));
    flat.sort();
    fill(raised, boxes.map((b, i) => ({ ...b, h: i * 37 })));
    raised.sort();
    // A lamp on a ridge and a lamp in a valley sort by their ground footprints. Sorting by
    // `gx + gy + z` draws the ridge lamp in front of the gate standing between it and the
    // camera.
    expect(permutation(raised)).toEqual(permutation(flat));
  });

  it('handles zero and one item', () => {
    const s = new DepthSorter(4);
    s.sort();
    expect(s.count).toBe(0);
    s.add(1, 1, 1, 1, 0);
    s.sort();
    expect(permutation(s)).toEqual([0]);
  });

  it('sorts a fully nested stack, where every pair is incomparable', () => {
    const s = new DepthSorter(8);
    for (let i = 0; i < 5; i++) s.add(-i, -i, 2 * i + 1, 2 * i + 1, 0);
    s.sort();
    // Every one contains the next, so nothing is strictly behind anything; depth decides, and
    // the depth grows with the extent.
    expect(permutation(s)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('culling', () => {
  it('drops what the camera cannot see and keeps count honest', () => {
    const cam = createCamera(400, 300, { bounds: rectSet(rect(), -1e6, -1e6, 1e6, 1e6) });
    cam.centerOnTile(0, 0);
    const s = new DepthSorter(16);
    s.add(0, 0, 1, 1, 0);
    s.add(500, 500, 1, 1, 0);
    s.sort(cam);
    expect(s.count).toBe(1);
    expect(s.indexAt(0)).toBe(0);
    // Without a camera nothing is culled, which is what makes an offscreen pass and a test the
    // same code path as a frame.
    s.sort();
    expect(s.count).toBe(2);
  });

  it('T8: keeps a tall building whose base is below the viewport', () => {
    const cam = createCamera(400, 300, { bounds: rectSet(rect(), -1e6, -1e6, 1e6, 1e6) });
    cam.centerOnTile(0, 0);
    const s = new DepthSorter(8);
    // Six tiles down the screen is 96 world pixels below the center, well past the 150-pixel
    // half-viewport once the tile margin is counted — but a 400-pixel tower reaches back up.
    const short = s.add(14, 14, 1, 1, 0);
    s.sort(cam);
    expect(s.count).toBe(0);
    s.clear();
    const tall = s.add(14, 14, 1, 1, 400);
    s.sort(cam);
    expect(s.count).toBe(1);
    expect(s.indexAt(0)).toBe(tall);
    expect(short).toBe(0);
  });

  it('re-sorts correctly after a frame that culled everything', () => {
    const cam = createCamera(400, 300, { bounds: rectSet(rect(), -1e6, -1e6, 1e6, 1e6) });
    cam.centerOnTile(0, 0);
    const s = new DepthSorter(8);
    s.add(900, 900, 1, 1, 0);
    s.sort(cam);
    expect(s.count).toBe(0);
    s.clear();
    s.add(0, 0, 1, 1, 0);
    s.add(2, 2, 1, 1, 0);
    s.sort(cam);
    expect(permutation(s)).toEqual([0, 1]);
  });
});

describe('addPoint', () => {
  it('gives a walker a small square so it can be beside a wall rather than ambiguous with it', () => {
    const s = new DepthSorter(8);
    const wall = s.add(5, 0, 1, 10, 96);
    const infront = s.addPoint(6.5, 5, 0);
    const behindIt = s.addPoint(4.5, 5, 0);
    s.sort();
    const order = permutation(s);
    expect(order.indexOf(behindIt)).toBeLessThan(order.indexOf(wall));
    expect(order.indexOf(wall)).toBeLessThan(order.indexOf(infront));
  });

  it('takes a radius, and a bigger one blurs a distinction a smaller one keeps', () => {
    const tight = new DepthSorter(4);
    tight.add(5, 0, 1, 4, 0);
    tight.addPoint(4.9, 2, 0, 0.05);
    tight.sort();
    expect(permutation(tight)).toEqual([1, 0]);
  });
});

describe('pickSorted', () => {
  it('I9: returns the last-painted item whose test passes', () => {
    const s = new DepthSorter(8);
    s.add(0, 0, 1, 1, 0);
    s.add(4, 4, 1, 1, 0);
    s.add(8, 8, 1, 1, 0);
    s.sort();
    // Everything matches, so the answer is whatever `indexAt(count - 1)` is — the item painted
    // last, which is the one on top.
    expect(pickSorted(s, () => true)).toBe(s.indexAt(s.count - 1));
    expect(pickSorted(s, (i) => i === 0)).toBe(0);
    expect(pickSorted(s, () => false)).toBe(-1);
  });

  it('I9: two items at equal depth resolve to the one painted last, not the one added first', () => {
    // The shipped bug: a tap on a rack opened the headquarters beside it, both at depth 14,
    // because the picker walked descending by depth and forgot to also walk descending by
    // insertion index. Walking the sorter itself is what makes that unrepresentable.
    const s = new DepthSorter(8);
    const rack = s.add(7, 7, 1, 1, 40);
    const hq = s.add(7, 7, 1, 1, 40);
    s.sort();
    expect(s.indexAt(0)).toBe(rack);
    expect(s.indexAt(1)).toBe(hq);
    expect(pickSorted(s, () => true)).toBe(hq);
  });

  it('is the exact reverse of the paint order, for a whole scene', () => {
    const boxes = scatter(0x9001, 80, 20);
    const s = new DepthSorter(128);
    fill(s, boxes);
    s.sort();
    const painted = permutation(s);
    // Picking with a test that accepts everything, one item at a time from the top, has to
    // reproduce the paint order reversed. This is the property the cross-package contract
    // with `draw` rests on: same instance, opposite direction.
    const picked: number[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < painted.length; k++) {
      const hit = pickSorted(s, (i) => !seen.has(i));
      seen.add(hit);
      picked.push(hit);
    }
    expect(picked).toEqual([...painted].reverse());
  });

  it('is -1 on an empty sorter', () => {
    const s = new DepthSorter(4);
    s.sort();
    expect(pickSorted(s, () => true)).toBe(-1);
  });

  it('refuses a sorter that was refilled after it painted, rather than answering', () => {
    // The `draw`-side half of I9 that this package can actually see: paint, then add, then
    // tap. The permutation no longer covers the contents, so every answer it could give names
    // an item at a slot the sort never placed.
    const s = new DepthSorter(8);
    s.add(0, 0, 1, 1, 0);
    s.add(4, 4, 1, 1, 0);
    s.sort();
    expect(pickSorted(s, () => true)).toBe(1);
    s.add(8, 8, 1, 1, 0);
    expect(() => pickSorted(s, () => true)).toThrow(TypeError);
    expect(() => pickSorted(s, () => true)).toThrow(/pickSorted: this order is not sorted/);
  });

  it('refuses a cleared sorter instead of reporting empty ground', () => {
    // `count` is 0 here, so the walk below would never reach `indexAt` and the guard in
    // `pickSorted` is the only thing between the caller and a `-1`. That `-1` is the dangerous
    // shape: it does not look like a failure, it looks like the player tapping grass.
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.sort();
    s.clear();
    expect(s.count).toBe(0);
    expect(() => pickSorted(s, () => true)).toThrow(/is not sorted/);
  });
});

describe('the sorted flag', () => {
  /**
   * What the flag asserts is not "sort has been called" but "the permutation is valid for the
   * contents", and the difference is the whole design: `add`, `addPoint` and `clear` are the
   * only three ways the contents can move, so lowering it in those three makes the cheap bit
   * and the honest question the same bit. These tests are written against the honest question.
   */
  it('is false on a new sorter, true after a sort, and false again after any fill', () => {
    const s = new DepthSorter(4);
    expect(s.sorted).toBe(false);
    s.sort();
    expect(s.sorted).toBe(true);
    s.add(0, 0, 1, 1, 0);
    expect(s.sorted).toBe(false);
    s.sort();
    expect(s.sorted).toBe(true);
    s.addPoint(2, 2, 0);
    expect(s.sorted).toBe(false);
    s.sort();
    s.clear();
    expect(s.sorted).toBe(false);
  });

  it('survives reading the permutation, and a second sort', () => {
    // Reads do not consume it: `each` and a pick in the same frame are two walks of one sort.
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.add(3, 3, 1, 1, 0);
    s.sort();
    expect(s.indexAt(0)).toBe(0);
    expect(pickSorted(s, () => true)).toBe(1);
    expect(s.sorted).toBe(true);
    s.sort();
    expect(s.sorted).toBe(true);
  });

  it('stays raised through a rejected add, which stored nothing', () => {
    // A throwing `add` leaves the contents untouched, so the permutation is still valid for
    // them. Lowering the flag there would turn one named error into two — the argument error
    // the caller has to fix, and a spurious "not sorted" on the next read.
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.sort();
    expect(() => s.add(0, 0, 0, 1, 0)).toThrow(RangeError);
    expect(s.sorted).toBe(true);
    expect(s.indexAt(0)).toBe(0);
    expect(s.count).toBe(1);
  });

  it('stays down when the caller’s camera throws mid-cull', () => {
    // `#cull` runs the caller's `isVisible` and writes `#order` as it goes, so a throw from
    // there leaves a permutation of neither the old contents nor the new. Raising the flag on
    // entry to `sort` would publish that wreckage as sorted.
    const cam = createCamera(400, 300, { bounds: rectSet(rect(), -1e6, -1e6, 1e6, 1e6) });
    let calls = 0;
    const flaky: Camera = {
      ...cam,
      isVisible(): boolean {
        calls += 1;
        if (calls > 1) throw new RangeError('the camera said no');
        return true;
      },
    };
    const s = new DepthSorter(4);
    s.add(0, 0, 1, 1, 0);
    s.add(3, 3, 1, 1, 0);
    expect(() => s.sort(flaky)).toThrow(/the camera said no/);
    expect(s.sorted).toBe(false);
    expect(() => s.indexAt(0)).toThrow(TypeError);
    // And it recovers: the contents were never touched, so a sort that completes is enough.
    s.sort();
    expect(permutation(s)).toEqual([0, 1]);
  });

  it('is true after a cull that removed everything — sorted and empty is a state, not a gap', () => {
    // The distinction the flag exists to draw, in its sharpest form: `count` is 0 here for the
    // same reason it is 0 on a cleared sorter, and only `sorted` separates "nothing survived
    // the cull" from "nothing has been ordered". A pick answers `-1` here and throws there.
    const cam = createCamera(400, 300, { bounds: rectSet(rect(), -1e6, -1e6, 1e6, 1e6) });
    cam.centerOnTile(0, 0);
    const s = new DepthSorter(4);
    s.add(900, 900, 1, 1, 0);
    s.sort(cam);
    expect(s.count).toBe(0);
    expect(s.sorted).toBe(true);
    expect(pickSorted(s, () => true)).toBe(-1);
  });

  it('separates an unsorted frame from a sorted, unculled one that is bit-identical to it', () => {
    // The reason a detector could not be written above this package. Two sorters, same three
    // footprints added in depth order; one is sorted and one is not, and `count` and every
    // `indexAt` agree on both. `sorted` is the only bit that differs.
    const boxes = [
      { gx: 0, gy: 0, w: 1, d: 1, h: 0 },
      { gx: 2, gy: 2, w: 1, d: 1, h: 0 },
      { gx: 4, gy: 4, w: 1, d: 1, h: 0 },
    ] as const;
    const unsorted = new DepthSorter(8);
    const sorted = new DepthSorter(8);
    fill(unsorted, boxes);
    fill(sorted, boxes);
    sorted.sort();
    expect(unsorted.count).toBe(sorted.count);
    expect(permutation(sorted)).toEqual([0, 1, 2]);
    expect(unsorted.sorted).toBe(false);
    expect(sorted.sorted).toBe(true);
    expect(() => unsorted.indexAt(0)).toThrow(TypeError);
  });
});
