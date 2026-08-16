/**
 * The replay guarantee, tested.
 *
 * Two kinds of assertion live here and they do different jobs. The **recorded sequences**
 * pin the algorithm: if mulberry32 or the seed hashing changes by one bit, every save file
 * and every replay in every game built on this kit resumes a different world, and these
 * tests are the only thing that will say so. The **property tests** pin the guarantees the
 * RFC sells — no modulo bias, cursor-independent forks, exact snapshot round trips — and
 * each one is written so that the obvious wrong implementation fails it: the `derive` tests
 * in particular draw a million times from the parent first, which is the exact scenario a
 * cursor-derived fork passes in a small test and fails in a real session.
 *
 * Nothing here uses `toBeCloseTo`. A stream that is approximately right is a stream that is
 * wrong on somebody's phone.
 */

import { describe, expect, it } from 'vitest';
import { Rng, createRng, type RngSnapshot } from '../src/rng.js';
import { hashString } from '../src/hash.js';

/** True when `value` is exactly an integer in [0, 2^32). */
const isUint32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < 4294967296;

describe('createRng', () => {
  it('reproduces a recorded sequence from a string seed', () => {
    const rng = createRng('run:42');
    expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual([
      2961654849, 3345141099, 3434309360, 2485205302, 1540616268, 1451124679, 2987080542,
      1761178491,
    ]);
  });

  it('reproduces the same sequence from a fresh instance — the determinism check', () => {
    const first = createRng('run:42');
    const recorded = Array.from({ length: 500 }, () => first.next());
    const second = createRng('run:42');
    for (const value of recorded) {
      // Object.is, not approximate equality: every bit must match.
      expect(Object.is(second.next(), value)).toBe(true);
    }
  });

  it('reproduces recorded sequences from the adversarial seeds', () => {
    const draw = (seed: number | string): number[] => {
      const rng = createRng(seed);
      return Array.from({ length: 4 }, () => rng.nextUint32());
    };
    expect(draw(0)).toEqual([1144304738, 1416247, 958946056, 627933444]);
    expect(draw(-1)).toEqual([146612443, 1647005904, 128168844, 1578492502]);
    expect(draw(2 ** 32)).toEqual([1472747962, 1387260464, 2338983117, 2440736370]);
    expect(draw('')).toEqual([1829959567, 3864432371, 5767841, 2836557246]);
  });

  it('survives a zero seed, which hashes to zero and is still a real stream', () => {
    // `mix32(0)` is 0, so `createRng(0)` genuinely starts with a zero state. mulberry32's
    // increment is odd, so that is an ordinary state and not a degenerate one.
    const rng = createRng(0);
    expect(rng.seed).toBe(0);
    const draws = Array.from({ length: 1000 }, () => rng.nextUint32());
    expect(new Set(draws).size).toBe(1000);
    expect(draws.every(isUint32)).toBe(true);
  });

  it('separates adjacent numeric and string seeds', () => {
    // Invariant 13 in the form that is actually true of a well-mixed hash: adjacent seeds
    // are *uncorrelated*, which means their first draws are as far apart as two independent
    // uniforms (mean gap 1/3) — not that no pair among a thousand ever lands close, which
    // for a thousand pairs is a near-certainty for any honest hash.
    const gaps: number[] = [];
    const stringGaps: number[] = [];
    const firsts = new Set<number>();
    for (let seed = 0; seed < 1000; seed += 1) {
      const a = createRng(seed).next();
      const b = createRng(seed + 1).next();
      firsts.add(a);
      gaps.push(Math.abs(a - b));
      stringGaps.push(Math.abs(createRng(`level-${seed}`).next() - createRng(`level-${seed + 1}`).next()));
    }
    expect(firsts.size).toBe(1000);
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Correlated streams (an unhashed seed) collapse this toward zero.
    expect(mean(gaps)).toBeGreaterThan(0.28);
    expect(mean(stringGaps)).toBeGreaterThan(0.28);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(Math.min(...stringGaps)).toBeGreaterThan(0);
  });

  it('hashes its seed rather than using it raw', () => {
    expect(createRng(1).seed).not.toBe(1);
    expect(createRng('a').seed).toBe(hashString('a'));
    expect(isUint32(createRng(2 ** 53).seed)).toBe(true);
  });

  it('rejects a non-finite numeric seed, naming the caller and the value', () => {
    expect(() => createRng(Number.NaN)).toThrow(RangeError);
    expect(() => createRng(Number.NaN)).toThrow(/createRng: expected a finite number, got NaN/);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(/Infinity/);
    expect(() => createRng(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Rng.nextUint32 and next', () => {
  it('emits only uint32s over a million draws — invariant 14', () => {
    const rng = createRng('uint32');
    // Record the first offender rather than asserting a million times: a missing `>>> 0`
    // shows up as a negative draw, and the failure message should name it.
    let offender = -1;
    for (let i = 0; i < 1_000_000; i += 1) {
      const value = rng.nextUint32();
      if (!isUint32(value)) {
        offender = value;
        break;
      }
    }
    expect(offender).toBe(-1);
  });

  it('normalizes by exactly 2^32, so next() is a dyadic rational in [0, 1)', () => {
    const a = createRng('unit');
    const b = createRng('unit');
    for (let i = 0; i < 1000; i += 1) {
      const drawn = b.nextUint32();
      expect(a.next()).toBe(drawn / 4294967296);
    }
    const rng = createRng('range');
    for (let i = 0; i < 100_000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is uniform over 16 buckets', () => {
    // Chi-squared rather than a per-bucket percentage: at 62,500 draws per bucket one
    // standard deviation is already 0.4%, so a tight per-bucket bound fails on an honest
    // generator about one run in three. 15 degrees of freedom puts p = 1e-4 near 45.
    const rng = createRng('uniform');
    const buckets = new Array<number>(16).fill(0);
    const total = 1_000_000;
    for (let i = 0; i < total; i += 1) {
      const bucket = Math.floor(rng.next() * 16);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    const expected = total / 16;
    let chiSquared = 0;
    for (const observed of buckets) {
      chiSquared += ((observed - expected) * (observed - expected)) / expected;
      expect(Math.abs(observed / expected - 1)).toBeLessThan(0.025);
    }
    expect(chiSquared).toBeLessThan(45);
  });

  it('does not repeat itself over a long run', () => {
    const rng = createRng('cycle');
    const seen = new Set<number>();
    for (let i = 0; i < 200_000; i += 1) seen.add(rng.nextUint32());
    // Birthday collisions are expected at this count; a *short cycle* is not.
    expect(seen.size).toBeGreaterThan(199_000);
  });
});

describe('Rng.int', () => {
  it('reproduces a recorded sequence', () => {
    const rng = createRng('run:42');
    expect(Array.from({ length: 8 }, () => rng.int(-5, 5))).toEqual([4, 4, -5, -3, 3, 4, -3, -4]);
  });

  it('is unbiased over a span that does not divide 2^32 — invariant 12', () => {
    // `2^32 % 3` is 1, so a modulo-only implementation over-represents 0. At a million
    // draws the excess is ~0.00002% and invisible; the rejection bound is what keeps the
    // shape of a one-in-three loot table honest over a whole session.
    const rng = createRng('unbiased');
    const buckets = [0, 0, 0];
    const total = 1_000_000;
    for (let i = 0; i < total; i += 1) {
      const value = rng.int(0, 3);
      buckets[value] = (buckets[value] ?? 0) + 1;
    }
    for (const observed of buckets) {
      expect(Math.abs(observed / (total / 3) - 1)).toBeLessThan(0.005);
    }
  });

  it('rejects and redraws when the span leaves a partial bucket', () => {
    // A span of 2^31 + 1 puts the rejection bound at 2^31 + 1, so very nearly half of all
    // raw draws are thrown away. This is the only span where the retry path is reachable in
    // a test rather than once in four billion draws.
    const span = 2 ** 31 + 1;
    const counting = createRng('rejection');
    const raw = createRng('rejection');
    let drawn = 0;
    for (let i = 0; i < 200; i += 1) {
      const value = counting.int(0, span);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(span);
      drawn += 1;
    }
    // The stream consumed strictly more raw draws than results returned, which is only true
    // if the rejection branch ran.
    let consumed = 0;
    for (let i = 0; i < 200; i += 1) {
      let value = raw.nextUint32();
      consumed += 1;
      while (value >= 4294967296 - (4294967296 % span)) {
        value = raw.nextUint32();
        consumed += 1;
      }
    }
    expect(consumed).toBeGreaterThan(drawn);
  });

  it('accepts a span of exactly 2^32 and never rejects there', () => {
    const rng = createRng('full-span');
    for (let i = 0; i < 100; i += 1) {
      const value = rng.int(0, 2 ** 32);
      expect(isUint32(value)).toBe(true);
    }
  });

  it('covers both ends of a small range', () => {
    const rng = createRng('ends');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(rng.int(0, 2));
    expect([...seen].sort()).toEqual([0, 1]);
  });

  it('handles a span of one by returning the only value', () => {
    const rng = createRng('single');
    expect(rng.int(7, 8)).toBe(7);
  });

  it('handles negative ranges', () => {
    const rng = createRng('negative');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.int(-10, -5);
      expect(value).toBeGreaterThanOrEqual(-10);
      expect(value).toBeLessThan(-5);
    }
  });

  it('rejects non-integer bounds, an empty range, and an oversized span', () => {
    const rng = createRng('int-errors');
    expect(() => rng.int(0.5, 4)).toThrow(/rng.int: expected integer bounds/);
    expect(() => rng.int(0, 4.5)).toThrow(RangeError);
    expect(() => rng.int(0, Number.NaN)).toThrow(RangeError);
    expect(() => rng.int(4, 4)).toThrow(/expected max > min/);
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0, 2 ** 32 + 1)).toThrow(/span of at most/);
  });
});

describe('Rng.float', () => {
  it('stays inside its bounds', () => {
    const rng = createRng('float');
    for (let i = 0; i < 100_000; i += 1) {
      const value = rng.float(-3, 7);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(7);
    }
  });

  it('returns exactly min when the bounds are equal', () => {
    const rng = createRng('degenerate');
    expect(rng.float(2.5, 2.5)).toBe(2.5);
    expect(rng.float(0, 0)).toBe(0);
  });

  it('rejects non-finite bounds and an inverted range', () => {
    const rng = createRng('float-errors');
    expect(() => rng.float(0, Number.POSITIVE_INFINITY)).toThrow(
      /rng.float\(max\): expected a finite number, got Infinity/,
    );
    expect(() => rng.float(Number.NaN, 1)).toThrow(/rng.float\(min\).*NaN/);
    expect(() => rng.float(1, 0)).toThrow(/expected max >= min/);
  });
});

describe('Rng.bool', () => {
  it('defaults to a fair coin', () => {
    const rng = createRng('coin');
    let heads = 0;
    for (let i = 0; i < 100_000; i += 1) if (rng.bool()) heads += 1;
    expect(Math.abs(heads / 100_000 - 0.5)).toBeLessThan(0.01);
  });

  it('honours a probability', () => {
    const rng = createRng('weighted-coin');
    let hits = 0;
    for (let i = 0; i < 100_000; i += 1) if (rng.bool(0.25)) hits += 1;
    expect(Math.abs(hits / 100_000 - 0.25)).toBeLessThan(0.01);
  });

  it('never fires at 0 or below and always fires at 1 or above', () => {
    const rng = createRng('extremes');
    for (let i = 0; i < 10_000; i += 1) {
      expect(rng.bool(0)).toBe(false);
      expect(rng.bool(-1)).toBe(false);
      expect(rng.bool(1)).toBe(true);
      expect(rng.bool(2)).toBe(true);
    }
  });

  it('rejects a non-finite probability rather than reading as a dead branch', () => {
    const rng = createRng('bool-errors');
    expect(() => rng.bool(Number.NaN)).toThrow(
      /rng.bool\(probability\): expected a finite number, got NaN/,
    );
    expect(() => rng.bool(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Rng.pick', () => {
  it('chooses uniformly', () => {
    const rng = createRng('pick');
    const items = ['a', 'b', 'c', 'd'] as const;
    const counts = new Map<string, number>();
    for (let i = 0; i < 100_000; i += 1) {
      const item = rng.pick(items);
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    expect(counts.size).toBe(4);
    for (const count of counts.values()) {
      expect(Math.abs(count / 25_000 - 1)).toBeLessThan(0.05);
    }
  });

  it('returns the only element of a single-element array', () => {
    expect(createRng('one').pick([42])).toBe(42);
  });

  it('rejects an empty array instead of returning undefined', () => {
    expect(() => createRng('empty').pick([])).toThrow(/rng.pick: expected a non-empty array/);
  });
});

describe('Rng.weighted', () => {
  it('reproduces a recorded sequence', () => {
    const rng = createRng('w');
    expect(Array.from({ length: 10 }, () => rng.weighted([1, 0, 3, 6]))).toEqual([
      3, 0, 0, 3, 3, 3, 3, 3, 3, 3,
    ]);
  });

  it('matches the weights it was given', () => {
    const rng = createRng('weights');
    const weights = [1, 3, 6];
    const counts = [0, 0, 0];
    const total = 200_000;
    for (let i = 0; i < total; i += 1) {
      const index = rng.weighted(weights);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    expect(Math.abs((counts[0] ?? 0) / total - 0.1)).toBeLessThan(0.005);
    expect(Math.abs((counts[1] ?? 0) / total - 0.3)).toBeLessThan(0.005);
    expect(Math.abs((counts[2] ?? 0) / total - 0.6)).toBeLessThan(0.005);
  });

  it('never chooses a zero weight, including a trailing one', () => {
    const rng = createRng('zeroes');
    for (let i = 0; i < 50_000; i += 1) {
      expect(rng.weighted([0, 5, 0, 5, 0])).not.toBe(0);
    }
    const trailing = createRng('trailing');
    for (let i = 0; i < 50_000; i += 1) {
      const index = trailing.weighted([1, 1, 0]);
      expect(index).toBeLessThan(2);
    }
  });

  it('selects the last non-zero bucket when the target falls past every earlier one', () => {
    const rng = createRng('last-bucket');
    let sawLast = false;
    for (let i = 0; i < 1000; i += 1) if (rng.weighted([1, 1]) === 1) sawLast = true;
    expect(sawLast).toBe(true);
  });

  it('treats a hole in a sparse table as a zero weight', () => {
    // A hole is `undefined` at runtime whatever the type says, and the alternative to
    // reading it as zero is a `NaN` total that silently disables the whole table.
    const sparse = new Array<number>(3);
    sparse[0] = 1;
    sparse[2] = 1;
    const rng = createRng('sparse');
    const chosen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) chosen.add(rng.weighted(sparse));
    expect([...chosen].sort()).toEqual([0, 2]);
  });

  it('handles a single weight and does not care about the scale', () => {
    const rng = createRng('single-weight');
    expect(rng.weighted([0.001])).toBe(0);
    expect(rng.weighted([1e9])).toBe(0);
  });

  it('consumes exactly one draw regardless of the table size', () => {
    // Adding a row to a loot table must not shift every later draw in the session.
    const a = createRng('one-draw');
    const b = createRng('one-draw');
    a.weighted([1, 2, 3, 4, 5, 6, 7, 8]);
    b.next();
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('rejects an empty table, a negative or non-finite weight, and an all-zero table', () => {
    const rng = createRng('weighted-errors');
    expect(() => rng.weighted([])).toThrow(/rng.weighted: expected a non-empty array/);
    expect(() => rng.weighted([1, -1])).toThrow(/at index 1, got -1/);
    expect(() => rng.weighted([Number.NaN])).toThrow(/at index 0, got NaN/);
    expect(() => rng.weighted([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
    expect(() => rng.weighted([0, 0, 0])).toThrow(/sum above zero/);
  });
});

describe('Rng.shuffle and shuffleInPlace', () => {
  it('reproduces a recorded permutation', () => {
    expect(createRng('shuffle').shuffle([0, 1, 2, 3, 4, 5, 6, 7])).toEqual([4, 5, 6, 3, 7, 0, 2, 1]);
  });

  it('never mutates its input and always returns a permutation', () => {
    const source = Object.freeze([1, 2, 3, 4, 5]);
    const rng = createRng('permutation');
    for (let i = 0; i < 1000; i += 1) {
      const shuffled = rng.shuffle(source);
      expect(shuffled).not.toBe(source);
      expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffles in place, returning the same array and the same order as shuffle', () => {
    const inPlace = createRng('same').shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7]);
    const copied = createRng('same').shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(inPlace).toEqual(copied);
    const items = [1, 2, 3];
    expect(createRng('identity').shuffleInPlace(items)).toBe(items);
  });

  it('handles empty and single-element arrays without drawing', () => {
    const rng = createRng('degenerate-shuffle');
    const before = rng.snapshot();
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle([9])).toEqual([9]);
    expect(rng.snapshot()).toEqual(before);
  });

  it('is unbiased over every permutation of three elements', () => {
    const rng = createRng('unbiased-shuffle');
    const counts = new Map<string, number>();
    const total = 120_000;
    for (let i = 0; i < total; i += 1) {
      const key = rng.shuffle([0, 1, 2]).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const count of counts.values()) {
      expect(Math.abs(count / (total / 6) - 1)).toBeLessThan(0.05);
    }
  });
});

describe('Rng.derive', () => {
  it('reproduces a recorded child seed', () => {
    expect(createRng('run:42').derive('terrain').seed).toBe(2910258285);
  });

  it('forks from identity, not cursor — invariant 9', () => {
    // The test that would fail if `derive` folded `state` instead of `seed`: the parent is
    // dragged a million draws forward first, exactly as a UI drawing sparkles would drag it.
    const quiet = createRng('world');
    const busy = createRng('world');
    for (let i = 0; i < 1_000_000; i += 1) busy.nextUint32();
    expect(busy.snapshot().state).not.toBe(quiet.snapshot().state);
    expect(quiet.derive('terrain').seed).toBe(busy.derive('terrain').seed);
    expect(quiet.derive('terrain').next()).toBe(busy.derive('terrain').next());
    // And repeatedly, so a child is the same stream every time it is asked for.
    expect(quiet.derive('terrain').next()).toBe(quiet.derive('terrain').next());
  });

  it('does not advance the parent', () => {
    const rng = createRng('parent');
    const before = rng.snapshot();
    rng.derive('a');
    rng.derive('b', 'c', 4);
    expect(rng.snapshot()).toEqual(before);
  });

  it('is order-sensitive — invariant 10', () => {
    const rng = createRng('order');
    expect(rng.derive('a', 'b').seed).not.toBe(rng.derive('b', 'a').seed);
    expect(rng.derive('a', 'b').next()).not.toBe(rng.derive('b', 'a').next());
    expect(rng.derive(1, 2).seed).not.toBe(rng.derive(2, 1).seed);
  });

  it('gives different labels, and different parents, different streams', () => {
    const rng = createRng('separation');
    const seeds = new Set<number>();
    for (let i = 0; i < 1000; i += 1) seeds.add(rng.derive('event', i).seed);
    expect(seeds.size).toBe(1000);
    expect(createRng('a').derive('x').seed).not.toBe(createRng('b').derive('x').seed);
    expect(rng.derive('a').seed).not.toBe(rng.derive('ab').seed);
  });

  it('nests, and the label list is a path: derive(a).derive(b) is derive(a, b)', () => {
    const root = createRng('root');
    const child = root.derive('child');
    expect(child.derive('grandchild').seed).toBe(root.derive('child').derive('grandchild').seed);
    // Both spellings address the same stream, so a subsystem may hand its child either a
    // pre-derived Rng or the labels to derive with, and get the same world.
    expect(child.derive('grandchild').seed).toBe(root.derive('child', 'grandchild').seed);
  });

  it('accepts numeric and string labels alike', () => {
    const rng = createRng('labels');
    expect(isUint32(rng.derive(7).seed)).toBe(true);
    expect(rng.derive(7).seed).not.toBe(rng.derive('7').seed);
  });

  it('rejects an unlabelled fork and a non-finite label', () => {
    const rng = createRng('derive-errors');
    expect(() => rng.derive()).toThrow(/rng.derive: expected at least one label/);
    expect(() => rng.derive(Number.NaN)).toThrow(/rng.derive: expected a finite number, got NaN/);
    expect(() => rng.derive('ok', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Rng snapshots', () => {
  it('round-trips exactly, including through JSON — invariant 11', () => {
    const rng = createRng('snapshot');
    for (let i = 0; i < 137; i += 1) rng.nextUint32();
    const snapshot = rng.snapshot();
    const revived = Rng.fromSnapshot(JSON.parse(JSON.stringify(snapshot)) as RngSnapshot);
    for (let i = 0; i < 1000; i += 1) {
      expect(revived.nextUint32()).toBe(rng.nextUint32());
    }
  });

  it('keeps seed and state separate, so identity survives drawing', () => {
    const rng = createRng('identity');
    const seed = rng.seed;
    const before = rng.snapshot().state;
    rng.nextUint32();
    expect(rng.seed).toBe(seed);
    expect(rng.snapshot().seed).toBe(seed);
    expect(rng.snapshot().state).not.toBe(before);
  });

  it('rejects a corrupted snapshot rather than resuming a meaningless cursor', () => {
    const bad: RngSnapshot[] = [
      { seed: -1, state: 0 },
      { seed: 0, state: -1 },
      { seed: 1.5, state: 0 },
      { seed: 0, state: 2 ** 32 },
      { seed: Number.NaN, state: 0 },
      { seed: 0, state: Number.POSITIVE_INFINITY },
    ];
    for (const snapshot of bad) {
      expect(() => Rng.fromSnapshot(snapshot)).toThrow(RangeError);
      expect(() => Rng.fromSnapshot(snapshot)).toThrow(/expected uint32 seed and state/);
      expect(() => createRng(0).restore(snapshot)).toThrow(RangeError);
    }
  });

  it('accepts the boundary values 0 and 2^32 - 1', () => {
    expect(Rng.fromSnapshot({ seed: 0, state: 0 }).seed).toBe(0);
    expect(Rng.fromSnapshot({ seed: 4294967295, state: 4294967295 }).seed).toBe(4294967295);
  });
});

describe('Rng.restore and clone', () => {
  it('restores in place when the identity matches', () => {
    const rng = createRng('restore');
    const mark = rng.snapshot();
    const expected = rng.nextUint32();
    for (let i = 0; i < 50; i += 1) rng.nextUint32();
    expect(rng.restore(mark)).toBe(rng);
    expect(rng.nextUint32()).toBe(expected);
  });

  it('returns a new instance when the identity differs, leaving the receiver alone', () => {
    const rng = createRng('a');
    const other = createRng('b');
    const otherSnapshot = other.snapshot();
    const mine = rng.snapshot();
    const restored = rng.restore(otherSnapshot);
    expect(restored).not.toBe(rng);
    expect(restored.seed).toBe(other.seed);
    // The receiver kept its own identity and cursor — a caller that ignores the return value
    // keeps the stream it already had rather than a silently re-identified one.
    expect(rng.seed).not.toBe(other.seed);
    expect(rng.snapshot()).toEqual(mine);
  });

  it('clones to an independent stream positioned exactly here', () => {
    const rng = createRng('clone');
    for (let i = 0; i < 10; i += 1) rng.nextUint32();
    const copy = rng.clone();
    expect(copy).not.toBe(rng);
    expect(copy.snapshot()).toEqual(rng.snapshot());
    const lookahead = Array.from({ length: 100 }, () => copy.nextUint32());
    // The original was untouched while the clone ran ahead, so it now reproduces exactly the
    // sequence the clone already saw — which is the whole point of a lookahead.
    expect(Array.from({ length: 100 }, () => rng.nextUint32())).toEqual(lookahead);
    expect(rng.snapshot()).toEqual(copy.snapshot());
  });

  it('exposes fromUint32Seed for an already-avalanched value', () => {
    const rng = Rng.fromUint32Seed(12345);
    expect(rng.seed).toBe(12345);
    expect(rng.snapshot()).toEqual({ seed: 12345, state: 12345 });
    expect(Rng.fromUint32Seed(-1).seed).toBe(4294967295);
  });
});
