import { describe, it, expect } from 'vitest';
import { noise2, noise3, fbm2, fbm3 } from '../src/noise.js';
import { hash2, hash3, toUnit } from '../src/hash.js';
import { createRng } from '../src/rng.js';

describe('probe', () => {
  it('measures ranges', () => {
    const rng = createRng('probe');
    let max2 = 0;
    let min2 = 0;
    for (let i = 0; i < 2_000_000; i += 1) {
      const v = noise2(1234, rng.float(-500, 500), rng.float(-500, 500));
      if (v > max2) max2 = v;
      if (v < min2) min2 = v;
    }
    let max3 = 0;
    let min3 = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      const v = noise3(77, rng.float(-200, 200), rng.float(-200, 200), rng.float(-200, 200));
      if (v > max3) max3 = v;
      if (v < min3) min3 = v;
    }
    console.log('noise2', min2, max2);
    console.log('noise3', min3, max3);

    for (const octaves of [1, 2, 4, 8]) {
      for (const gain of [0.1, 0.5, 0.9]) {
        let mx = 0;
        let mn = 0;
        for (let i = 0; i < 300_000; i += 1) {
          const v = fbm2(9, rng.float(-300, 300), rng.float(-300, 300), octaves, gain);
          if (v > mx) mx = v;
          if (v < mn) mn = v;
        }
        console.log('fbm2', octaves, gain, mn.toFixed(4), mx.toFixed(4));
      }
    }
    let mx3 = 0;
    let mn3 = 0;
    for (let i = 0; i < 200_000; i += 1) {
      const v = fbm3(9, rng.float(-100, 100), rng.float(-100, 100), rng.float(-100, 100), 4, 0.5);
      if (v > mx3) mx3 = v;
      if (v < mn3) mn3 = v;
    }
    console.log('fbm3 4 0.5', mn3, mx3);

    // avalanche
    for (const axis of [0, 1, 2]) {
      let bits = 0;
      const trials = 20000;
      for (let i = 0; i < trials; i += 1) {
        const s = rng.int(-1000, 1000);
        const x = rng.int(-1000, 1000);
        const y = rng.int(-1000, 1000);
        const a = hash2(s, x, y);
        const b = axis === 0 ? hash2(s + 1, x, y) : axis === 1 ? hash2(s, x + 1, y) : hash2(s, x, y + 1);
        let d = (a ^ b) >>> 0;
        let c = 0;
        while (d) {
          c += d & 1;
          d >>>= 1;
        }
        bits += c;
      }
      console.log('hash2 avalanche axis', axis, bits / trials);
    }
    for (const axis of [0, 1, 2, 3]) {
      let bits = 0;
      const trials = 20000;
      for (let i = 0; i < trials; i += 1) {
        const s = rng.int(-1000, 1000);
        const x = rng.int(-1000, 1000);
        const y = rng.int(-1000, 1000);
        const z = rng.int(-1000, 1000);
        const a = hash3(s, x, y, z);
        const b =
          axis === 0
            ? hash3(s + 1, x, y, z)
            : axis === 1
              ? hash3(s, x + 1, y, z)
              : axis === 2
                ? hash3(s, x, y + 1, z)
                : hash3(s, x, y, z + 1);
        let d = (a ^ b) >>> 0;
        let c = 0;
        while (d) {
          c += d & 1;
          d >>>= 1;
        }
        bits += c;
      }
      console.log('hash3 avalanche axis', axis, bits / trials);
    }

    // hash2 uniformity over a grid, 16 buckets
    const buckets = new Array<number>(16).fill(0);
    let n = 0;
    for (let x = -500; x < 500; x += 1) {
      for (let y = -500; y < 500; y += 1) {
        const b = Math.floor(toUnit(hash2(4242, x, y)) * 16);
        buckets[b] = (buckets[b] ?? 0) + 1;
        n += 1;
      }
    }
    console.log('hash2 buckets dev', buckets.map((c) => ((c / (n / 16) - 1) * 100).toFixed(3)).join(' '));

    // diagonal banding check: correlation between hash2 and 31x+17y
    let sameDiag = 0;
    for (let i = 0; i < 100000; i += 1) {
      const x = rng.int(-500, 500);
      const y = rng.int(-500, 500);
      // points on the same 31x+17y line
      const a = toUnit(hash2(3, x, y));
      const b = toUnit(hash2(3, x + 17, y - 31));
      if (Math.abs(a - b) < 0.001) sameDiag += 1;
    }
    console.log('diagonal near-equal rate', sameDiag / 100000);

    // int rejection path + uniformity
    const r2 = createRng(5);
    const b3 = [0, 0, 0];
    for (let i = 0; i < 1_000_000; i += 1) {
      const v = r2.int(0, 3);
      b3[v] = (b3[v] ?? 0) + 1;
    }
    console.log('int(0,3)', b3.map((c) => ((c / (1e6 / 3) - 1) * 100).toFixed(3)).join(' '));

    // seed separation
    let worst = 1;
    for (let s = 0; s < 1000; s += 1) {
      const d = Math.abs(createRng(s).next() - createRng(s + 1).next());
      if (d < worst) worst = d;
    }
    console.log('numeric seed separation worst', worst);
    let worstS = 1;
    for (let s = 0; s < 1000; s += 1) {
      const d = Math.abs(createRng(`w${s}`).next() - createRng(`w${s + 1}`).next());
      if (d < worstS) worstS = d;
    }
    console.log('string seed separation worst', worstS);
    console.log('createRng(0) draws', [createRng(0).next(), createRng(0).nextUint32()]);
    console.log('hash2(0,0,0)', hash2(0, 0, 0), 'hash3(0,0,0,0)', hash3(0, 0, 0, 0));

    // fbm2 recorded values for golden
    console.log('golden fbm2', fbm2(42, 1.5 * 0.06, 2.5 * 0.06, 4).toString());
    expect(true).toBe(true);
  }, 600_000);
});
