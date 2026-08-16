/**
 * `bucket.ts`, against the seven invariants `docs/rfc/depth-bucket.md` says a reviewer can test.
 *
 * This is the only test file in `examples/_shared`. The rest of the folder is DOM — `bootstrap`
 * builds a canvas, `controlPanel` builds a `<details>` — and `vitest` runs in `node`, so those
 * modules are proved by `src/harness.ts` on :5183 instead. `bucket.ts` is pure, so it gets the
 * treatment every other pure module in this repo gets.
 *
 * Each test names the invariant it stands for. Two of them (B6, B7) are not clean passes and say
 * so in their own titles rather than in a comment somebody has to go looking for.
 */

import { describe, expect, it } from 'vitest';
import { DepthSorter, createCamera, pickSorted, type Camera } from '@lattice/iso';
import { createBucket, type Bucket } from '../src/bucket.js';

/** A sprite-shaped thing. `station` exists so a `pick` test has something to discriminate on. */
interface Thing {
  readonly kind: 'thing';
  readonly gx: number;
  readonly gy: number;
  readonly station: number;
}

/** The demo's actual `T`: a sprite for the built world, a bare id for the crowd. The union is
 *  the case the helper has to serve, and it is served without any package below hearing of it. */
type Drawable = Thing | number;

const thing = (gx: number, gy: number, station = -1): Thing => ({ kind: 'thing', gx, gy, station });

/** Eight buildings on a diagonal and four walkers between them — enough that the topological
 *  sort produces a permutation that is not the identity, which several tests depend on. */
function fill(bucket: Bucket<Drawable>): Thing[] {
  const things: Thing[] = [];
  for (let i = 0; i < 8; i++) {
    const t = thing(7 - i, i, i);
    things.push(t);
    bucket.add(t, t.gx, t.gy, 2, 2, 40);
  }
  for (let i = 0; i < 4; i++) bucket.addPoint(i, 1 + i * 2, 1 + i, 22);
  return things;
}

/** A camera wide enough to keep everything, so `sort()` runs its cull and keeps every item. */
const wideCamera = (): Camera => createCamera(1920, 1080, { zoom: 0.25, minZoom: 0.1 });

describe('B1 — at(add(item, …)) === item, for every add, always', () => {
  it('round-trips every item of a heterogeneous fill', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<Drawable>(order);
    const back: Drawable[] = [];
    for (let i = 0; i < 8; i++) back.push(thing(i, i));
    for (let i = 0; i < 4; i++) back.push(i);

    for (let i = 0; i < 8; i++) {
      const t = back[i] as Thing;
      expect(bucket.at(bucket.add(t, t.gx, t.gy, 1, 1, 10))).toBe(t);
    }
    for (let i = 0; i < 4; i++) {
      expect(bucket.at(bucket.addPoint(i, i, i, 10))).toBe(i);
    }
    for (let i = 0; i < 12; i++) expect(bucket.at(i)).toBe(back[i]);
  });

  it('survives growing past the sorter’s initial capacity', () => {
    const order = new DepthSorter(1);
    const bucket = createBucket<number>(order);
    for (let i = 0; i < 300; i++) expect(bucket.add(i, i, i, 1, 1, 0)).toBe(i);
    expect(bucket.count).toBe(300);
    for (let i = 0; i < 300; i++) expect(bucket.at(i)).toBe(i);
  });

  it('round-trips a falsy item — 0 and the empty string are drawables too', () => {
    const bucket = createBucket<number | string>(new DepthSorter(4));
    bucket.add(0, 0, 0, 1, 1, 0);
    bucket.add('', 1, 1, 1, 1, 0);
    expect(bucket.at(0)).toBe(0);
    expect(bucket.at(1)).toBe('');
  });

  it('at() refuses everything outside [0, count) by name', () => {
    const bucket = createBucket<number>(new DepthSorter(4));
    bucket.add(9, 0, 0, 1, 1, 0);
    expect(() => bucket.at(1)).toThrow(/Bucket\.at: expected an integer index in \[0, 1\), got 1/);
    expect(() => bucket.at(-1)).toThrow(RangeError);
    expect(() => bucket.at(0.5)).toThrow(RangeError);
    expect(() => bucket.at(Number.NaN)).toThrow(RangeError);
    expect(() => bucket.at(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => bucket.at(1e9)).toThrow(RangeError);
  });

  it('at() on an empty bucket throws rather than returning undefined', () => {
    const bucket = createBucket<number>(new DepthSorter(4));
    expect(() => bucket.at(0)).toThrow(/\[0, 0\)/);
  });
});

describe('B2 — count === order.count at every point before sort()', () => {
  it('stays level through every add of a mixed fill', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<Drawable>(order);
    expect(bucket.count).toBe(order.count);
    for (let i = 0; i < 8; i++) {
      bucket.add(thing(i, i), i, i, 1, 1, 0);
      expect(bucket.count).toBe(order.count);
    }
    for (let i = 0; i < 4; i++) {
      bucket.addPoint(i, i, i, 0);
      expect(bucket.count).toBe(order.count);
    }
    expect(bucket.count).toBe(12);
  });

  it('stays level across a rejected add — a throw from DepthSorter leaves nothing half-written', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<number>(order);
    bucket.add(1, 0, 0, 1, 1, 0);
    expect(() => bucket.add(2, 0, 0, 0, 1, 0)).toThrow(/DepthSorter\.add/);
    expect(bucket.count).toBe(1);
    // The sorter refused the item too, so the two are still level and the next add lands cleanly.
    expect(bucket.add(3, 1, 1, 1, 1, 0)).toBe(1);
    expect(bucket.at(1)).toBe(3);
  });

  it('clear() drops both halves, so the pair can never be cleared apart', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<Drawable>(order);
    fill(bucket);
    expect(order.count).toBe(12);
    bucket.clear();
    expect(bucket.count).toBe(0);
    expect(order.count).toBe(0);
    // And the RFC's two-statement form still reads and behaves exactly as written.
    bucket.add(1, 0, 0, 1, 1, 0);
    order.clear();
    bucket.clear();
    expect(bucket.count).toBe(0);
    expect(order.count).toBe(0);
    expect(bucket.add(7, 0, 0, 1, 1, 0)).toBe(0);
  });

  it('clear() is idempotent and safe on a bucket that never filled', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<number>(order);
    bucket.clear();
    bucket.clear();
    expect(bucket.count).toBe(0);
    expect(order.count).toBe(0);
  });
});

describe('B3 — a direct order.add between two bucket.add calls throws, and names order.add', () => {
  it('throws on the very next bucket.add', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<number>(order);
    bucket.add(1, 0, 0, 1, 1, 0);
    order.add(5, 5, 1, 1, 0); // the bypass
    expect(() => bucket.add(2, 1, 1, 1, 1, 0)).toThrow(
      /Bucket\.add: the sorter has 2 items and this bucket has 1\./,
    );
    expect(() => bucket.add(2, 1, 1, 1, 1, 0)).toThrow(/order\.add\(\) or order\.addPoint\(\)/);
  });

  it('throws for a bypassing addPoint too', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<number>(order);
    bucket.addPoint(1, 0, 0, 0);
    order.addPoint(5, 5, 0);
    // Named for the method the caller was in, not for its sibling.
    expect(() => bucket.addPoint(2, 1, 1, 0)).toThrow(
      /Bucket\.addPoint: the sorter has 2 items and this bucket has 1\./,
    );
  });

  it('two buckets over one sorter — the desync in a costume — throws on the second bucket', () => {
    const order = new DepthSorter(8);
    const a = createBucket<number>(order);
    const b = createBucket<number>(order);
    a.add(1, 0, 0, 1, 1, 0);
    expect(() => b.add(2, 1, 1, 1, 1, 0)).toThrow(/the sorter has 1 items and this bucket has 0/);
  });

  it('a bypass after the last bucket.add — where the compare cannot fire — is caught by each()', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<Drawable>(order);
    fill(bucket);
    order.add(3, 3, 1, 1, 0); // nothing follows it, so `add`'s compare never runs
    expect(() => bucket.each(() => undefined)).toThrow(
      /Bucket\.each: the sorter holds 13 items and this bucket only filled 12/,
    );
    expect(() => bucket.pick(() => true)).toThrow(/Bucket\.pick: the sorter holds 13 items/);
  });

  it('a bypass the cull then hides is caught by the per-item bound, not the count guard', () => {
    // The count guard alone is not enough. Six items on a long diagonal, four of them off a
    // small camera, plus one stray sitting under it: `sort` keeps three of seven, so
    // `order.count` (3) is *below* the fill count (6) and the frame looks entirely legitimate —
    // right up to the moment the permutation hands back insertion index 6.
    const order = new DepthSorter(16);
    const bucket = createBucket<number>(order);
    for (let i = 0; i < 6; i++) bucket.add(i, i * 6, i * 6, 1, 1, 0);
    order.add(0, 0, 1, 1, 0); // index 6, under the camera, so it survives the cull
    order.sort(createCamera(640, 480, { zoom: 1 }));
    expect(order.count).toBeLessThan(bucket.count);
    expect(() => bucket.each(() => undefined)).toThrow(
      /Bucket\.each: the sorted order points at insertion index 6 and this bucket only filled 6/,
    );
    expect(() => bucket.each(() => undefined)).toThrow(/order\.add\(\) or order\.addPoint\(\)/);
    // pick walks the same permutation and refuses it in its own name — when it reaches it.
    // `pickSorted` stops at the first accepted item, so a pick that returns early has examined
    // every item painted *after* its answer and none before it, which is exactly the set whose
    // identity could change the answer. A stray below the winner cannot make the pick wrong.
    expect(() => bucket.pick(() => false)).toThrow(
      /Bucket\.pick: the sorted order points at insertion index 6/,
    );
  });
});

describe('B4 — pick(t) === at(pickSorted(order, i => t(at(i))))', () => {
  it('agrees with a hand-written pickSorted on every predicate', () => {
    const order = new DepthSorter(16);
    const bucket = createBucket<Drawable>(order);
    const things = fill(bucket);
    order.sort(wideCamera());
    expect(order.count).toBe(12);

    const predicates: ((d: Drawable) => boolean)[] = [
      () => true,
      () => false,
      (d) => typeof d === 'number',
      (d) => typeof d !== 'number' && d.station % 2 === 0,
      (d) => d === things[3],
      (d) => typeof d === 'number' && d === 0,
    ];
    for (const test of predicates) {
      const byHand = pickSorted(order, (i) => test(bucket.at(i)));
      const expected = byHand < 0 ? undefined : bucket.at(byHand);
      expect(bucket.pick(test)).toBe(expected);
    }
  });

  it('returns undefined rather than an integer when nothing matches', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<number>(order);
    bucket.add(1, 0, 0, 1, 1, 0);
    order.sort();
    expect(bucket.pick(() => false)).toBeUndefined();
  });

  it('picks the last-painted candidate, which is the reverse of the paint order', () => {
    const order = new DepthSorter(16);
    const bucket = createBucket<Drawable>(order);
    fill(bucket);
    order.sort(wideCamera());
    const painted: Drawable[] = [];
    bucket.each((item) => {
      painted.push(item);
    });
    const last = painted[painted.length - 1];
    expect(bucket.pick(() => true)).toBe(last);
  });

  it('a test that itself picks leaves the outer walk intact', () => {
    const order = new DepthSorter(16);
    const bucket = createBucket<Drawable>(order);
    fill(bucket);
    order.sort(wideCamera());
    let inner: Drawable | undefined;
    const outer = bucket.pick((d) => {
      if (typeof d === 'number') {
        inner = bucket.pick((e) => typeof e !== 'number');
        return true;
      }
      return false;
    });
    expect(typeof outer).toBe('number');
    expect(typeof inner).toBe('object');
    // And the bucket is not left holding the inner test: the next pick still uses its own.
    expect(bucket.pick((d) => typeof d !== 'number')).toBe(inner);
  });

  it('picking on an empty bucket is undefined, not a throw', () => {
    const order = new DepthSorter(4);
    const bucket = createBucket<number>(order);
    order.sort();
    expect(bucket.pick(() => true)).toBeUndefined();
  });
});

describe('B5 — each visits exactly order.count items, in indexAt order', () => {
  it('walks the culled count and not the fill count', () => {
    const order = new DepthSorter(64);
    const bucket = createBucket<number>(order);
    // A long diagonal, most of it off a small camera.
    for (let i = 0; i < 40; i++) bucket.add(i, i * 4, i * 4, 1, 1, 0);
    const camera = createCamera(640, 480, { zoom: 1 });
    order.sort(camera);
    expect(order.count).toBeGreaterThan(0);
    expect(order.count).toBeLessThan(bucket.count);

    const seen: number[] = [];
    const positions: number[] = [];
    bucket.each((item, pos) => {
      seen.push(item);
      positions.push(pos);
    });
    expect(seen).toHaveLength(order.count);
    expect(positions).toEqual(seen.map((_, i) => i));
    // The item at each sorted position is the item at that position's insertion index. This is
    // the whole contract, restated without the helper.
    for (let i = 0; i < order.count; i++) expect(seen[i]).toBe(bucket.at(order.indexAt(i)));
  });

  it('visits nothing when everything was culled, and does not throw', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<number>(order);
    for (let i = 0; i < 4; i++) bucket.add(i, 900 + i, 900 + i, 1, 1, 0);
    order.sort(createCamera(320, 240, { zoom: 4, maxZoom: 8 }));
    expect(order.count).toBe(0);
    let calls = 0;
    bucket.each(() => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('visits nothing on an empty frame', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<number>(order);
    order.sort();
    let calls = 0;
    bucket.each(() => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it('one item is one visit', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<string>(order);
    bucket.add('only', 0, 0, 1, 1, 0);
    order.sort();
    const seen: string[] = [];
    bucket.each((item) => {
      seen.push(item);
    });
    expect(seen).toEqual(['only']);
  });

  it('paints back to front — the far item first — over a scene with a known answer', () => {
    // Two boxes on the same column: (0,0) is strictly behind (0,4), so it paints first.
    const order = new DepthSorter(8);
    const bucket = createBucket<string>(order);
    bucket.add('near', 0, 4, 2, 2, 0);
    bucket.add('far', 0, 0, 2, 2, 0);
    order.sort();
    const seen: string[] = [];
    bucket.each((item) => {
      seen.push(item);
    });
    expect(seen).toEqual(['far', 'near']);
    // …and the pick is its exact reverse.
    expect(bucket.pick(() => true)).toBe('near');
  });
});

describe('B6 — a thousand frames of fill/sort/each/pick stay correct and stay bounded', () => {
  /**
   * **Partial.** Whether short-lived allocation happened is not observable from a `node` test
   * without `--expose-gc`, so the honest measurement of B6 is `test/bucket.bench.ts`. What this
   * asserts is the falsifiable half: that a thousand frames of varying size produce exactly the
   * right answer every time, so the reused backing array is never serving a stale slot, and that
   * the largest frame the bucket has ever held does not leak into a later, smaller one.
   */
  it('a thousand frames, none of them wrong', () => {
    const order = new DepthSorter(256);
    const bucket = createBucket<Drawable>(order);
    const camera = wideCamera();
    for (let frame = 0; frame < 1000; frame++) {
      bucket.clear();
      // A scene that shrinks and grows, so a small frame follows a large one repeatedly.
      const n = 1 + ((frame * 7) % 40);
      const expected: Drawable[] = [];
      for (let i = 0; i < n; i++) {
        const item: Drawable = i % 3 === 0 ? i : thing(i, i, i);
        expected.push(item);
        if (typeof item === 'number') bucket.addPoint(item, i, i, 0);
        else bucket.add(item, item.gx, item.gy, 1, 1, 0);
      }
      expect(bucket.count).toBe(n);
      order.sort(camera);
      let visits = 0;
      bucket.each((item, pos) => {
        expect(item).toBe(expected[order.indexAt(pos)]);
        visits += 1;
      });
      expect(visits).toBe(order.count);
      expect(bucket.pick((d) => typeof d === 'number')).toBeDefined();
    }
  });
});

describe('B7 — NOT MET: an unsorted each paints insertion order instead of throwing', () => {
  /**
   * `DepthSorter` publishes `count`, `clear`, `add`, `addPoint`, `sort` and `indexAt`, and none of
   * them distinguishes "not sorted" from "sorted and nothing culled" — before `sort()`,
   * `order.count === bucket.count` and `indexAt(i) === i`, and a legitimate uncculled frame whose
   * fill happened to be in depth order is bit-identical to it. The only false-positive-free
   * detector would be a `sorted` flag on `DepthSorter`, which is `packages/iso`.
   *
   * So this test asserts the **gap**, deliberately, as a tripwire: when `iso` grows the flag and
   * `each` starts throwing, this test fails and whoever made the change is told where to update.
   */
  it('walks insertion order when sort() was never called — the wrong picture, quietly', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<string>(order);
    bucket.add('near', 0, 4, 2, 2, 0);
    bucket.add('far', 0, 0, 2, 2, 0);
    const seen: string[] = [];
    bucket.each((item) => {
      seen.push(item);
    });
    // Sorted, this is ['far', 'near'] — see the B5 case with the same scene.
    expect(seen).toEqual(['near', 'far']);
  });

  it('the single-item case is undetectable and also harmless', () => {
    // With one item the sorted and unsorted permutations are the same array, so nothing could
    // distinguish them and nothing needs to: the picture is identical either way.
    const order = new DepthSorter(8);
    const bucket = createBucket<string>(order);
    bucket.add('only', 0, 0, 1, 1, 0);
    const before: string[] = [];
    bucket.each((item) => {
      before.push(item);
    });
    order.sort();
    const after: string[] = [];
    bucket.each((item) => {
      after.push(item);
    });
    expect(before).toEqual(after);
  });

  it('an item added by hand with no bucket fill still throws, by the count guard', () => {
    const order = new DepthSorter(8);
    const bucket = createBucket<string>(order);
    order.add(0, 0, 1, 1, 0);
    expect(() => bucket.each(() => undefined)).toThrow(
      /the sorter holds 1 items and this bucket only filled 0/,
    );
  });
});

describe('the surface itself', () => {
  it('exposes the sorter it was given, by identity', () => {
    const order = new DepthSorter(8);
    expect(createBucket<number>(order).order).toBe(order);
  });

  it('addPoint takes iso’s default radius when none is given, and forwards one when it is', () => {
    // Through the bucket with no radius, and straight to the sorter with iso's documented
    // default: the same footprint, so the same order against the same neighbor.
    const viaBucket = new DepthSorter(4);
    createBucket<number>(viaBucket).addPoint(0, 5, 5, 0);
    viaBucket.add(5.4, 5, 1, 1, 0);
    viaBucket.sort();

    const byHand = new DepthSorter(4);
    byHand.addPoint(5, 5, 0, 0.15);
    byHand.add(5.4, 5, 1, 1, 0);
    byHand.sort();

    expect(viaBucket.indexAt(0)).toBe(byHand.indexAt(0));
    expect(viaBucket.indexAt(1)).toBe(byHand.indexAt(1));

    // And a radius the caller does supply reaches `iso` — including a bad one, which iso rejects
    // in its own words rather than the bucket's.
    const bucket = createBucket<number>(new DepthSorter(4));
    bucket.addPoint(0, 5, 5, 0, 0.4);
    expect(bucket.count).toBe(1);
    expect(() => bucket.addPoint(1, 5, 5, 0, 0)).toThrow(/DepthSorter\.add/);
    expect(bucket.count).toBe(1);
  });

  it('holds items of a union without any of it reaching the sorter', () => {
    // The type-level point of the whole design: `T` is `Thing | number` here, `order` is a plain
    // `DepthSorter` with no parameter, and it is the same object `renderFrame` would be handed.
    const order: DepthSorter = new DepthSorter(8);
    const bucket: Bucket<Drawable> = createBucket<Drawable>(order);
    bucket.add(thing(0, 0, 1), 0, 0, 1, 1, 0);
    bucket.addPoint(7, 1, 1, 0);
    order.sort();
    const hit = bucket.pick((d) => typeof d === 'number');
    expect(hit).toBe(7);
  });
});
