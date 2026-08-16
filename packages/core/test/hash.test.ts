/**
 * `hash` is the floor under the floor: four packages key cache entries, tile variation,
 * sequencer rolls and save checksums off it, so a change that shifts one value by one bit
 * invalidates every one of those at once.
 *
 * The tests are therefore written against **recorded values**, not properties alone. A
 * property test proves the algorithm is a plausible hash; the golden values prove it is
 * *this* hash, which is the thing a save file on a player's disk depends on. There is not a
 * single `toBeCloseTo` in this file, deliberately: an approximate assertion in core is a bug
 * in the suite.
 */

import { describe, expect, it } from 'vitest';
import {
  hash2,
  hash3,
  hashBytes,
  hashNumber,
  hashParts,
  hashStep,
  hashString,
  mix32,
  toUnit,
} from '../src/hash.js';
import { createRng } from '../src/rng.js';

/** True when `value` is exactly an integer in [0, 2^32) — what every function here promises. */
const isUint32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < 4294967296;

/** Population count of a uint32, for the avalanche tests. */
function popcount(value: number): number {
  let bits = 0;
  let v = value >>> 0;
  while (v !== 0) {
    bits += v & 1;
    v >>>= 1;
  }
  return bits;
}

describe('mix32', () => {
  it('reproduces recorded values', () => {
    expect([
      mix32(0),
      mix32(1),
      mix32(-1),
      mix32(2 ** 32),
      mix32(4294967295),
      mix32(1.9),
    ]).toEqual([0, 1364076727, 2180083513, 0, 2180083513, 1364076727]);
  });

  it('has a fixed point at zero, which is why hashStep carries an odd constant', () => {
    expect(mix32(0)).toBe(0);
    // The consequence, and the reason the fold is not `mix32(acc ^ mix32(v))`:
    expect(hashStep(0, 0)).not.toBe(0);
    expect(hash2(0, 0, 0)).not.toBe(0);
    expect(hash3(0, 0, 0, 0)).not.toBe(0);
  });

  it('returns a uint32 for every shape of input', () => {
    for (const value of [0, 1, -1, 0.5, -0.5, 2 ** 31, 2 ** 32, 2 ** 53, -(2 ** 53), 1e300]) {
      expect(isUint32(mix32(value))).toBe(true);
    }
  });

  it('folds non-finite input to zero rather than throwing — the boundary check belongs to callers', () => {
    expect(mix32(Number.NaN)).toBe(0);
    expect(mix32(Number.POSITIVE_INFINITY)).toBe(0);
    expect(mix32(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('reduces its argument modulo 2^32, truncating toward zero', () => {
    expect(mix32(1.9)).toBe(mix32(1));
    expect(mix32(-1)).toBe(mix32(4294967295));
    expect(mix32(2 ** 32 + 5)).toBe(mix32(5));
  });

  it('is a bijection over a large sample — a collision here would collide every caller', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200_000; i += 1) seen.add(mix32(i));
    expect(seen.size).toBe(200_000);
  });

  it('avalanches: a one-bit input change flips about half the output bits', () => {
    let bits = 0;
    const trials = 10_000;
    for (let i = 0; i < trials; i += 1) bits += popcount(mix32(i) ^ mix32(i + 1));
    const average = bits / trials;
    expect(average).toBeGreaterThan(12);
    expect(average).toBeLessThan(20);
  });
});

describe('hashString', () => {
  it('reproduces recorded values', () => {
    expect(['', 'a', 'lattice', '\u{1D49C}'].map(hashString)).toEqual([
      2872998923, 3463548254, 4071751616, 973588235,
    ]);
  });

  it('hashes the empty string to a non-zero value', () => {
    // The offset basis is folded even when the loop never runs, so '' is a real key and not
    // an alias for "nothing was hashed".
    expect(hashString('')).toBe(2872998923);
    expect(isUint32(hashString(''))).toBe(true);
  });

  it('handles astral-plane characters as their two surrogate code units', () => {
    const astral = '\u{1D49C}'; // MATHEMATICAL SCRIPT CAPITAL A, one code point, two units
    expect(astral.length).toBe(2);
    expect(isUint32(hashString(astral))).toBe(true);
    expect(hashString(astral)).toBe(hashString('𝒜'));
    // A lone surrogate is still a distinct, hashable string — no throw, no replacement.
    expect(hashString('\uD835')).not.toBe(hashString(astral));
  });

  it('is the documented portability seam: NFC and NFD hash differently', () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(composed).not.toBe(decomposed);
    expect(composed.normalize('NFC')).toBe(decomposed.normalize('NFC'));
    expect(hashString(composed)).not.toBe(hashString(decomposed));
    // And the documented fix actually fixes it.
    expect(hashString(composed.normalize('NFC'))).toBe(hashString(decomposed.normalize('NFC')));
  });

  it('folds the length in, so a trailing NUL is not free', () => {
    expect(hashString('a')).not.toBe(hashString('a\u0000'));
  });

  it('returns a uint32 and spreads a thousand adjacent keys without collision', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i += 1) {
      const h = hashString(`level-${i}`);
      expect(isUint32(h)).toBe(true);
      seen.add(h);
    }
    expect(seen.size).toBe(10_000);
  });
});

describe('hashNumber', () => {
  it('reproduces recorded values', () => {
    expect([0, 1, -1, 2 ** 32, 2 ** 53, 1.7e12, -(2 ** 40)].map(hashNumber)).toEqual([
      0, 1364076727, 2180083513, 804215951, 3368371829, 1240953082, 3943869684,
    ]);
  });

  it('keeps the bits above 2^32, which a bare `>>> 0` throws away', () => {
    // Ids and timestamps that differ only in their high half must not collide.
    expect(hashNumber(2 ** 32)).not.toBe(hashNumber(0));
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i += 1) seen.add(hashNumber(i * 2 ** 32 + 7));
    expect(seen.size).toBe(5000);
  });

  it('separates timestamps a millisecond apart', () => {
    const seen = new Set<number>();
    for (let t = 1_700_000_000_000; t < 1_700_000_010_000; t += 1) seen.add(hashNumber(t));
    expect(seen.size).toBe(10_000);
  });

  it('truncates toward zero', () => {
    expect(hashNumber(3.9)).toBe(hashNumber(3));
    expect(hashNumber(-3.9)).toBe(hashNumber(-3));
  });

  it('rejects non-finite input, naming the value', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => hashNumber(bad)).toThrow(RangeError);
      expect(() => hashNumber(bad)).toThrow(
        new RegExp(`hashNumber.*${String(bad).replace(/\W/g, '\\$&')}`),
      );
    }
  });
});

describe('hashStep', () => {
  it('reproduces recorded values', () => {
    expect([hashStep(0, 0), hashStep(1, 2), hashStep(2, 1)]).toEqual([
      2462723854, 396144453, 1087478223,
    ]);
  });

  it('is order-sensitive, so (a, b) and (b, a) are different keys', () => {
    expect(hashStep(hashStep(0, 1), 2)).not.toBe(hashStep(hashStep(0, 2), 1));
  });

  it('is the fold hash2 and hash3 are unrolled from — invariant 17', () => {
    const rng = createRng('invariant-17');
    for (let i = 0; i < 1000; i += 1) {
      const seed = rng.int(-(2 ** 20), 2 ** 20);
      const x = rng.int(-1000, 1000);
      const y = rng.int(-1000, 1000);
      const z = rng.int(-1000, 1000);
      expect(hash2(seed, x, y)).toBe(hashStep(hashStep(seed, x), y));
      expect(hash3(seed, x, y, z)).toBe(hashStep(hashStep(hashStep(seed, x), y), z));
    }
  });

  it('extends past three axes with no hash4 and no change of algorithm', () => {
    const four = hashStep(hash3(5, 1, 2, 3), 4);
    expect(four).toBe(hashStep(hashStep(hashStep(hashStep(5, 1), 2), 3), 4));
    expect(isUint32(four)).toBe(true);
  });

  it('truncates its value argument to int32 and its accumulator to uint32', () => {
    expect(hashStep(1, 2.9)).toBe(hashStep(1, 2));
    expect(hashStep(1, -1)).toBe(hashStep(1, 4294967295));
    expect(hashStep(-1, 1)).toBe(hashStep(4294967295, 1));
  });

  it('avalanches in the accumulator as well as the value', () => {
    let bits = 0;
    const trials = 10_000;
    for (let i = 0; i < trials; i += 1) bits += popcount(hashStep(i, 7) ^ hashStep(i + 1, 7));
    expect(bits / trials).toBeGreaterThan(12);
    expect(bits / trials).toBeLessThan(20);
  });
});

describe('hashParts', () => {
  it('reproduces recorded values', () => {
    expect([
      hashParts('a'),
      hashParts('a', 'b'),
      hashParts('b', 'a'),
      hashParts('ab'),
      hashParts(1, 2, 'x'),
    ]).toEqual([1339214263, 3729667078, 3644229267, 904403281, 1879484242]);
  });

  it('is non-commutative and count-sensitive', () => {
    expect(hashParts('a', 'b')).not.toBe(hashParts('b', 'a'));
    expect(hashParts('a', 'b')).not.toBe(hashParts('ab'));
    expect(hashParts(1, 2)).not.toBe(hashParts(2, 1));
  });

  it('mixes numbers and strings in one key', () => {
    expect(isUint32(hashParts('chunk', -3, 9))).toBe(true);
    expect(hashParts('chunk', -3, 9)).not.toBe(hashParts('chunk', 9, -3));
  });

  it('gives a thousand sprite keys a thousand distinct hashes', () => {
    const seen = new Set<number>();
    for (let zoom = 1; zoom <= 10; zoom += 1) {
      for (let tint = 0; tint < 100; tint += 1) seen.add(hashParts('wall', tint, zoom));
    }
    expect(seen.size).toBe(1000);
  });

  it('rejects an empty part list', () => {
    expect(() => hashParts()).toThrow(RangeError);
    expect(() => hashParts()).toThrow(/hashParts: expected at least one part/);
  });

  it('rejects a non-finite numeric part rather than folding it as zero', () => {
    expect(() => hashParts('a', Number.NaN)).toThrow(RangeError);
    expect(() => hashParts(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe('hash2 and hash3', () => {
  it('reproduce recorded values', () => {
    expect([hash2(0, 0, 0), hash2(1, 0, 0), hash2(1, 1, 0), hash2(1, 0, 1), hash2(7, -3, 9)]).toEqual([
      3553795876, 2339934983, 202207563, 1151772881, 1502415384,
    ]);
    expect([hash3(0, 0, 0, 0), hash3(1, 2, 3, 4), hash3(1, 2, 4, 3)]).toEqual([
      1422740206, 3282122174, 1419570834,
    ]);
  });

  it('distinguishes the origin from both axes — the case a linear fold gets right by luck', () => {
    expect(hash2(1, 0, 0)).not.toBe(hash2(1, 1, 0));
    expect(hash2(1, 0, 0)).not.toBe(hash2(1, 0, 1));
    expect(hash2(1, 1, 0)).not.toBe(hash2(1, 0, 1));
    expect(hash2(0, 0, 0)).not.toBe(0);
  });

  it('does not band diagonally — invariant 18 and trap 26', () => {
    // A linear fold such as `31x + 17y` gives *identical* values along the direction
    // (17, -31), because 31*17 - 17*31 is zero. This asserts the exact points where such a
    // fold collides, and would fail immediately if the axes were combined before mixing.
    const rng = createRng('banding');
    let equal = 0;
    let near = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const x = rng.int(-2000, 2000);
      const y = rng.int(-2000, 2000);
      const a = hash2(3, x, y);
      const b = hash2(3, x + 17, y - 31);
      if (a === b) equal += 1;
      if (Math.abs(toUnit(a) - toUnit(b)) < 0.001) near += 1;
    }
    expect(equal).toBe(0);
    // Chance alone puts ~0.2% of pairs within 0.001 of each other; a linear fold puts 100%.
    expect(near).toBeLessThan(20_000 * 0.01);
  });

  it('avalanches independently in every axis — invariant 18', () => {
    const averageFlips = (sample: (i: number) => readonly [number, number]): number => {
      const trials = 5000;
      let bits = 0;
      for (let i = 0; i < trials; i += 1) {
        const [a, b] = sample(i);
        bits += popcount(a ^ b);
      }
      return bits / trials;
    };
    const rng = createRng('avalanche');
    const axes: ((i: number) => readonly [number, number])[] = [
      () => {
        const [s, x, y] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash2(s, x, y), hash2(s + 1, x, y)] as const;
      },
      () => {
        const [s, x, y] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash2(s, x, y), hash2(s, x + 1, y)] as const;
      },
      () => {
        const [s, x, y] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash2(s, x, y), hash2(s, x, y + 1)] as const;
      },
      () => {
        const [s, x, y, z] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash3(s, x, y, z), hash3(s + 1, x, y, z)] as const;
      },
      () => {
        const [s, x, y, z] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash3(s, x, y, z), hash3(s, x + 1, y, z)] as const;
      },
      () => {
        const [s, x, y, z] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash3(s, x, y, z), hash3(s, x, y + 1, z)] as const;
      },
      () => {
        const [s, x, y, z] = [rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000), rng.int(-1000, 1000)];
        return [hash3(s, x, y, z), hash3(s, x, y, z + 1)] as const;
      },
    ];
    for (const axis of axes) {
      const average = averageFlips(axis);
      expect(average).toBeGreaterThan(12);
      expect(average).toBeLessThan(20);
    }
  });

  it('is stateless and traversal-order-free — invariant 15', () => {
    const forwards: number[] = [];
    for (let x = 0; x < 64; x += 1) for (let y = 0; y < 64; y += 1) forwards.push(hash2(11, x, y));

    const backwards = new Array<number>(64 * 64);
    for (let x = 63; x >= 0; x -= 1) {
      for (let y = 63; y >= 0; y -= 1) backwards[x * 64 + y] = hash2(11, x, y);
    }

    // A million stream draws interleaved between samples must change nothing.
    const noise = createRng('interference');
    const shuffled = new Array<number>(64 * 64);
    const order = noise.shuffle(Array.from({ length: 64 * 64 }, (_, i) => i));
    for (const index of order) {
      noise.nextUint32();
      shuffled[index] = hash2(11, Math.floor(index / 64), index % 64);
    }

    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('gives independent fields to different seeds over the same grid', () => {
    let same = 0;
    let close = 0;
    for (let x = 0; x < 200; x += 1) {
      for (let y = 0; y < 200; y += 1) {
        const a = hash2(1, x, y);
        const b = hash2(2, x, y);
        if (a === b) same += 1;
        if (Math.abs(toUnit(a) - toUnit(b)) < 0.001) close += 1;
      }
    }
    expect(same).toBe(0);
    expect(close).toBeLessThan(200 * 200 * 0.01);
  });

  it('is uniform over 16 buckets of a million cells', () => {
    // A chi-squared test rather than a per-bucket percentage: with 62,500 samples per
    // bucket one standard deviation is already 0.4%, so a tight per-bucket bound would fail
    // on an honest hash roughly one run in three. 15 degrees of freedom puts p = 1e-4 at
    // about 45, and a hash with visible structure lands in the hundreds.
    const buckets = new Array<number>(16).fill(0);
    let count = 0;
    for (let x = -500; x < 500; x += 1) {
      for (let y = -500; y < 500; y += 1) {
        const bucket = Math.floor(toUnit(hash2(4242, x, y)) * 16);
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
        count += 1;
      }
    }
    const expected = count / 16;
    let chiSquared = 0;
    for (const observed of buckets) {
      chiSquared += ((observed - expected) * (observed - expected)) / expected;
      expect(Math.abs(observed / expected - 1)).toBeLessThan(0.025);
    }
    expect(chiSquared).toBeLessThan(45);
  });

  it('hashes a fractional coordinate to its integer cell, truncating toward zero', () => {
    expect(hash2(7, -3.9, 9.9)).toBe(hash2(7, -3, 9));
    expect(hash3(7, 1.5, 2.5, 3.5)).toBe(hash3(7, 1, 2, 3));
    // The documented sharp edge: truncation is not `Math.floor`, so cell 0 is twice as wide.
    expect(hash2(7, -0.5, 0)).toBe(hash2(7, 0.5, 0));
  });

  it('handles -0 as 0 on either axis', () => {
    expect(hash2(0, -0, -0)).toBe(hash2(0, 0, 0));
  });
});

describe('hashBytes', () => {
  it('reproduces recorded values', () => {
    expect([
      hashBytes(0, []),
      hashBytes(0, [1, 2]),
      hashBytes(0, [2, 1]),
      hashBytes(0, [1, 2, 0]),
      hashBytes(9, new Uint8Array([255, 0, 7])),
    ]).toEqual([2462723854, 921114073, 1289698029, 3041671360, 2690712445]);
  });

  it('is order- and length-sensitive — invariant 19', () => {
    const a = hashBytes(0, [1, 2]);
    const b = hashBytes(0, [2, 1]);
    const c = hashBytes(0, [1, 2, 0]);
    expect(new Set([a, b, c]).size).toBe(3);
    // The third is the one a naive implementation fails, and it is how a truncated save
    // passes its own checksum.
    expect(c).not.toBe(a);
  });

  it('digests the empty buffer to the length-0 fold rather than to the seed', () => {
    expect(hashBytes(0, [])).toBe(hashStep(0, 0));
    expect(hashBytes(0, [])).not.toBe(0);
  });

  it('accepts every integer typed array shape', () => {
    const bytes = [3, 1, 4, 1, 5, 9, 2, 6];
    expect(hashBytes(1, new Uint8Array(bytes))).toBe(hashBytes(1, bytes));
    expect(hashBytes(1, new Uint8ClampedArray(bytes))).toBe(hashBytes(1, bytes));
    expect(hashBytes(1, new Int32Array(bytes))).toBe(hashBytes(1, bytes));
  });

  it('detects a single flipped byte in a megabyte', () => {
    const buffer = new Uint8Array(1 << 20);
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = i & 0xff;
    const before = hashBytes(0, buffer);
    buffer[999_999] = ((buffer[999_999] ?? 0) ^ 1) & 0xff;
    expect(hashBytes(0, buffer)).not.toBe(before);
  });

  it('treats a hole in a sparse array as zero', () => {
    const sparse = new Array<number>(3);
    sparse[0] = 1;
    sparse[2] = 2;
    expect(hashBytes(0, sparse)).toBe(hashBytes(0, [1, 0, 2]));
  });

  it('is the documented trap over a Float32Array, and the documented fix works', () => {
    const a = new Float32Array([0.1, 0.2, 0.3]);
    const b = new Float32Array([0.9, -0.4, 0.5]);
    // Every value truncates to zero, so the digest of a normalised buffer is a digest of
    // its length — two completely different frames compare equal.
    expect(hashBytes(0, a)).toBe(hashBytes(0, b));
    const viewOf = (f: Float32Array): Uint8Array =>
      new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    expect(hashBytes(0, viewOf(a))).not.toBe(hashBytes(0, viewOf(b)));
  });

  it('returns a uint32 for every seed', () => {
    for (const seed of [0, -1, 2 ** 32 - 1, 12345]) {
      expect(isUint32(hashBytes(seed, [1, 2, 3]))).toBe(true);
    }
  });
});

describe('toUnit', () => {
  it('reproduces recorded values and divides by exactly 2^32', () => {
    expect([toUnit(0), toUnit(1), toUnit(4294967295), toUnit(-1)]).toEqual([
      0, 2.3283064365386963e-10, 0.9999999997671694, 0.9999999997671694,
    ]);
    expect(toUnit(1)).toBe(1 / 4294967296);
    // Not `/ (2**32 - 1)`, which rounds and stops being bit-identical.
    expect(toUnit(1)).not.toBe(1 / (2 ** 32 - 1));
  });

  it('stays in [0, 1) across the whole uint32 range', () => {
    for (const value of [0, 1, 2 ** 31, 4294967295, -1, -2147483648]) {
      const unit = toUnit(value);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it('is interchangeable with a drawn value in a threshold test', () => {
    const rng = createRng('threshold');
    let hits = 0;
    const total = 100_000;
    for (let i = 0; i < total; i += 1) {
      if (toUnit(hash2(1, i, rng.int(0, 1000))) < 0.1) hits += 1;
    }
    expect(Math.abs(hits / total - 0.1)).toBeLessThan(0.005);
  });
});
