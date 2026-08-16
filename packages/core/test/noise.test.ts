/**
 * Noise is where a determinism bug hides best: a field that is subtly wrong still looks like
 * terrain, and nobody notices until two machines render the same seed differently.
 *
 * So the assertions here are exact wherever the maths is exact — integer lattice points
 * return **exactly** zero, `fbm2` at one octave **is** `noise2` on a derived seed, and the
 * recorded values are compared bit for bit — and statistical only where the claim is
 * genuinely statistical (range, symmetry, decorrelation). The range tests are the ones that
 * would catch the normalisation being dropped, which is the change that silently moves a
 * terrain's sea level when someone raises its detail.
 */

import { describe, expect, it } from 'vitest';
import { fbm2, fbm3, noise2, noise3 } from '../src/noise.js';
import { hashStep } from '../src/hash.js';
import { createRng } from '../src/rng.js';

/** A deterministic sweep of fractional coordinates, so every test samples the same field. */
function sample(count: number, span: number, take: (x: number, y: number, z: number) => number): number[] {
  const rng = createRng('sampler');
  const out = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = take(rng.float(-span, span), rng.float(-span, span), rng.float(-span, span));
  }
  return out;
}

describe('noise2', () => {
  it('reproduces recorded values', () => {
    expect([
      noise2(42, 0.5, 0.5),
      noise2(42, 1.25, -3.75),
      noise2(42, 0.06, 0.12),
      noise2(7, -0.5, 0.5),
    ]).toEqual([
      0.10355339059327376, 0.04391710917296383, 0.06973358986234215, -0.3535533905932738,
    ]);
  });

  it('returns exactly zero on lattice points, which is the documented surprise', () => {
    // Not "close to zero": the gradient at a lattice point is dotted with a zero distance
    // vector. A caller sampling integer tile coordinates gets a field of zeroes and should
    // conclude they forgot to scale, not that the noise is broken.
    for (let x = -20; x <= 20; x += 1) {
      for (let y = -20; y <= 20; y += 1) {
        expect(noise2(42, x, y)).toBe(0);
      }
    }
    expect(noise2(42, -0, -0)).toBe(0);
  });

  it('stays within [-1, 1] over two million samples', () => {
    let min = 0;
    let max = 0;
    const rng = createRng('range2');
    for (let i = 0; i < 2_000_000; i += 1) {
      const value = noise2(1234, rng.float(-500, 500), rng.float(-500, 500));
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    // And it actually fills the range — a scale factor that was too conservative would make
    // every downstream `remap` compress its output for no visible reason.
    expect(max).toBeGreaterThan(0.9);
    expect(min).toBeLessThan(-0.9);
  });

  it('is continuous: neighbouring samples move by a bounded amount', () => {
    // A gradient table indexed with the wrong bits still produces a plausible histogram and
    // a discontinuous field, which reads as tearing along the lattice lines.
    let worst = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const x = -50 + i * 0.005;
      const jump = Math.abs(noise2(3, x, 0.25) - noise2(3, x + 0.005, 0.25));
      if (jump > worst) worst = jump;
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('is a pure function: order, repetition and interleaved draws change nothing', () => {
    const forwards = sample(5000, 40, (x, y) => noise2(9, x, y));
    const noise = createRng('interference');
    const again = sample(5000, 40, (x, y) => {
      noise.nextUint32();
      return noise2(9, x, y);
    });
    expect(again).toEqual(forwards);
  });

  it('gives independent fields to different seeds', () => {
    const a = sample(20_000, 60, (x, y) => noise2(1, x, y));
    const b = sample(20_000, 60, (x, y) => noise2(2, x, y));
    let identical = 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      const va = a[i] ?? 0;
      const vb = b[i] ?? 0;
      if (va === vb) identical += 1;
      dot += va * vb;
      normA += va * va;
      normB += vb * vb;
    }
    // Two seeds agree exactly at a sample only when all four corners happen to draw the same
    // gradient, which is 1 in 4096 — so a handful of hits is the hash working, not failing.
    expect(identical).toBeLessThan(a.length / 500);
    expect(Math.abs(dot / Math.sqrt(normA * normB))).toBeLessThan(0.05);
  });

  it('has a mean near zero and uses both signs', () => {
    const values = sample(100_000, 300, (x, y) => noise2(5, x, y));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(values.some((v) => v > 0.5)).toBe(true);
    expect(values.some((v) => v < -0.5)).toBe(true);
  });

  it('reaches every gradient direction, so no branch of the table is dead', () => {
    // Sampled at cell centres, where the value is a fixed combination of the four corner
    // gradients: a selector stuck on a subset of the eight directions collapses this count,
    // and the field repeats visibly along one axis.
    const values = new Set<number>();
    for (let x = 0; x < 40; x += 1) {
      for (let y = 0; y < 40; y += 1) values.add(noise2(11, x + 0.5, y + 0.5));
    }
    expect(values.size).toBeGreaterThan(20);
  });

  it('flattens rather than exploding at the documented coordinate limit', () => {
    // Past ~2^24 the fractional part has no resolution left. The contract is that the
    // arithmetic stays finite and in range, not that the field stays interesting.
    for (const scale of [2 ** 20, 2 ** 24, 2 ** 30]) {
      const value = noise2(1, scale + 0.5, scale + 0.25);
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });
});

describe('noise3', () => {
  it('reproduces recorded values', () => {
    expect([noise3(42, 0.5, 0.5, 0.5), noise3(42, 1.25, -3.75, 0.125)]).toEqual([
      -0.10206207261596575, -0.1369320715831122,
    ]);
  });

  it('returns exactly zero on lattice points', () => {
    for (let x = -5; x <= 5; x += 1) {
      for (let y = -5; y <= 5; y += 1) {
        for (let z = -5; z <= 5; z += 1) expect(noise3(42, x, y, z)).toBe(0);
      }
    }
  });

  it('stays within [-1, 1] over a million samples', () => {
    let min = 0;
    let max = 0;
    const rng = createRng('range3');
    for (let i = 0; i < 1_000_000; i += 1) {
      const value = noise3(77, rng.float(-200, 200), rng.float(-200, 200), rng.float(-200, 200));
      if (value < min) min = value;
      if (value > max) max = value;
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0.5);
    expect(min).toBeLessThan(-0.5);
  });

  it('animates smoothly along the third axis and repeats exactly on a revisited frame', () => {
    let worst = 0;
    for (let i = 0; i < 5000; i += 1) {
      const t = i * 0.002;
      worst = Math.max(worst, Math.abs(noise3(4, 0.3, 0.7, t) - noise3(4, 0.3, 0.7, t + 0.002)));
    }
    expect(worst).toBeLessThan(0.05);
    // The same z renders the same frame, years later — which is what makes a screenshot test
    // of an animated surface possible at all.
    expect(noise3(4, 0.3, 0.7, 12.5)).toBe(noise3(4, 0.3, 0.7, 12.5));
  });

  it('varies in every axis independently', () => {
    const base = noise3(1, 0.3, 0.7, 0.2);
    expect(noise3(1, 1.3, 0.7, 0.2)).not.toBe(base);
    expect(noise3(1, 0.3, 1.7, 0.2)).not.toBe(base);
    expect(noise3(1, 0.3, 0.7, 1.2)).not.toBe(base);
  });

  it('reaches every gradient direction', () => {
    const centres = new Set<number>();
    for (let x = 0; x < 16; x += 1) {
      for (let y = 0; y < 16; y += 1) {
        for (let z = 0; z < 16; z += 1) centres.add(noise3(13, x + 0.5, y + 0.5, z + 0.5));
      }
    }
    expect(centres.size).toBeGreaterThan(10);
    const offset = new Set<number>();
    for (let x = 0; x < 16; x += 1) {
      for (let y = 0; y < 16; y += 1) {
        for (let z = 0; z < 16; z += 1) offset.add(noise3(13, x + 0.13, y + 0.61, z + 0.37));
      }
    }
    expect(offset.size).toBeGreaterThan(3000);
  });
});

describe('fbm2', () => {
  it('reproduces recorded values', () => {
    expect([fbm2(42, 0.09, 0.15), fbm2(42, 0.09, 0.15, 1), fbm2(42, 0.09, 0.15, 8, 0.9)]).toEqual([
      0.24341121334345714, 0.21650891662658175, 0.15759970480348354,
    ]);
  });

  it('defaults to four octaves at half gain', () => {
    expect(fbm2(42, 0.09, 0.15)).toBe(fbm2(42, 0.09, 0.15, 4, 0.5));
  });

  it('is exactly noise2 on a derived seed at one octave', () => {
    // The normalisation divides by the amplitude sum, which is exactly 1 here — so this is
    // an exact identity, not an approximation, and it pins the per-octave seed derivation.
    for (let i = 0; i < 100; i += 1) {
      const x = i * 0.037;
      const y = i * -0.021;
      expect(fbm2(42, x, y, 1)).toBe(noise2(hashStep(42, 0), x, y));
    }
  });

  it('stays within [-1, 1] at every octave count and gain — invariant 16', () => {
    for (const octaves of [1, 2, 4, 8]) {
      for (const gain of [0.1, 0.5, 0.9]) {
        const rng = createRng(`fbm-${octaves}-${gain}`);
        let min = 0;
        let max = 0;
        for (let i = 0; i < 200_000; i += 1) {
          const value = fbm2(9, rng.float(-300, 300), rng.float(-300, 300), octaves, gain);
          if (value < min) min = value;
          if (value > max) max = value;
        }
        expect(min).toBeGreaterThanOrEqual(-1);
        expect(max).toBeLessThanOrEqual(1);
        // Un-normalised fBm at 4 octaves and gain 0.5 reaches ~1.9, so the upper bound above
        // is the assertion that the normalisation exists. This one asserts it is a
        // normalisation and not a crush: the field still uses most of its range, and the two
        // signs stay balanced.
        expect(max).toBeGreaterThan(0.4);
        expect(min).toBeLessThan(-0.4);
        expect(Math.abs(max + min)).toBeLessThan(0.25);
      }
    }
  });

  it('keeps the same sea level as octaves are added', () => {
    // The failure this catches: dropping the `/ total` moves the mean and the coastline
    // moves with it, which nobody connects to the detail slider they nudged.
    const meanAt = (octaves: number): number => {
      const rng = createRng('sea-level');
      let sum = 0;
      const count = 100_000;
      for (let i = 0; i < count; i += 1) {
        sum += fbm2(3, rng.float(-200, 200), rng.float(-200, 200), octaves);
      }
      return sum / count;
    };
    for (const octaves of [1, 2, 4, 8]) {
      expect(Math.abs(meanAt(octaves))).toBeLessThan(0.02);
    }
  });

  it('adds detail rather than replacing the base octave', () => {
    // The four-octave field must still be recognisably the one-octave field with detail on
    // top. Independent octaves make the correlation `1 / sqrt(sum of squared amplitudes)`,
    // which is 0.87 here — high enough that the coastline stays put, low enough to prove the
    // extra layers are actually contributing.
    const rng = createRng('detail');
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < 50_000; i += 1) {
      const x = rng.float(-200, 200);
      const y = rng.float(-200, 200);
      const base = fbm2(6, x, y, 1);
      const detailed = fbm2(6, x, y, 4);
      dot += base * detailed;
      normA += base * base;
      normB += detailed * detailed;
    }
    const correlation = dot / Math.sqrt(normA * normB);
    expect(correlation).toBeGreaterThan(0.6);
    expect(correlation).toBeLessThan(0.98);
  });

  it('is exactly zero on lattice points, at every octave', () => {
    // Every octave's frequency is a power of two, so an integer coordinate stays an integer
    // all the way up the ladder.
    for (let x = -8; x <= 8; x += 1) {
      for (let y = -8; y <= 8; y += 1) expect(fbm2(42, x, y, 8)).toBe(0);
    }
  });

  it('is a pure function of its arguments', () => {
    const rng = createRng('purity');
    const first = fbm2(1, 0.31, 0.77, 5, 0.6);
    for (let i = 0; i < 100; i += 1) rng.nextUint32();
    expect(fbm2(1, 0.31, 0.77, 5, 0.6)).toBe(first);
  });

  it('rejects an octave count or gain that would make the normalisation meaningless', () => {
    expect(() => fbm2(1, 0, 0, 0)).toThrow(/fbm2.octaves: expected a finite number in \[1, 16\], got 0/);
    expect(() => fbm2(1, 0, 0, 1.5)).toThrow(/fbm2.octaves: expected an integer, got 1.5/);
    expect(() => fbm2(1, 0, 0, 17)).toThrow(RangeError);
    expect(() => fbm2(1, 0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => fbm2(1, 0, 0, -1)).toThrow(/got -1/);
    expect(() => fbm2(1, 0, 0, 4, 0)).toThrow(/fbm2.gain: expected a number in \(0, 1\]/);
    expect(() => fbm2(1, 0, 0, 4, -0.5)).toThrow(/fbm2.gain: expected a number in \(0, 1\]/);
    expect(() => fbm2(1, 0, 0, 4, 1.5)).toThrow(RangeError);
    expect(() => fbm2(1, 0, 0, 4, Number.NaN)).toThrow(RangeError);
    expect(() => fbm2(1, 0, 0, 4, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('accepts the boundary octave counts and gains', () => {
    expect(Number.isFinite(fbm2(1, 0.3, 0.4, 1, 1))).toBe(true);
    expect(Number.isFinite(fbm2(1, 0.3, 0.4, 16, 1))).toBe(true);
  });
});

describe('fbm3', () => {
  it('reproduces recorded values', () => {
    expect([fbm3(42, 0.09, 0.15, 0.2), fbm3(42, 0.09, 0.15, 0.2, 2, 0.25)]).toEqual([
      0.08622178877514909, -0.005619920062912736,
    ]);
  });

  it('defaults to four octaves at half gain and is exactly noise3 at one octave', () => {
    expect(fbm3(42, 0.09, 0.15, 0.2)).toBe(fbm3(42, 0.09, 0.15, 0.2, 4, 0.5));
    expect(fbm3(42, 0.09, 0.15, 0.2, 1)).toBe(noise3(hashStep(42, 0), 0.09, 0.15, 0.2));
  });

  it('stays within [-1, 1] and is zero on lattice points', () => {
    const rng = createRng('fbm3-range');
    for (let i = 0; i < 200_000; i += 1) {
      const value = fbm3(
        9,
        rng.float(-100, 100),
        rng.float(-100, 100),
        rng.float(-100, 100),
        4,
        0.5,
      );
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
    expect(fbm3(9, 2, 3, 4, 8)).toBe(0);
  });

  it('rejects the same bad parameters, naming itself', () => {
    expect(() => fbm3(1, 0, 0, 0, 0)).toThrow(/fbm3.octaves: expected a finite number in \[1, 16\]/);
    expect(() => fbm3(1, 0, 0, 0, 4, 2)).toThrow(/fbm3.gain: expected a number in \(0, 1\]/);
  });
});
