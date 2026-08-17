/**
 * Seeded randomness and hashing, measured.
 *
 * These are on the hot path in a way that is easy to miss. A tile renderer calls `hash2`
 * once per visible tile per frame to pick a grass shade; a crowd calls `Rng.float` per
 * person per frame; an audio deck calls `hash3` per track per step. None of them is doing
 * anything expensive, and all of them are doing it thousands of times a second.
 *
 * The comparison worth having is **stateless against streaming**. `hash2(seed, x, y)` and
 * `rng.float()` look interchangeable and are not: the hash depends only on its coordinates,
 * so a caller may sample tiles in any order and get the same field, while the stream depends
 * on how many draws came before it. If the hash were much slower, that correctness property
 * would cost something and the trade would need arguing. These numbers are why it does not.
 */

import { bench, describe } from 'vitest';
import { createRng, hash2, hash3, hashStep, hashString, mix32, noise2, fbm2 } from '@latticekit/core';

const rng = createRng(0xbeef);
let sink = 0;
let i = 0;

describe('streams', () => {
  bench('Rng.next — the raw uint32-derived unit float', () => {
    sink = rng.next();
  });
  bench('Rng.float(0, 1)', () => {
    sink = rng.float(0, 1);
  });
  bench('Rng.int(0, 63) — rejection sampled, so no modulo bias', () => {
    sink = rng.int(0, 63);
  });
  bench('Rng.derive — forks a sub-stream from identity, not cursor', () => {
    sink = rng.derive('crowd').float(0, 1);
  });
});

describe('stateless hashes', () => {
  bench('mix32', () => {
    sink = mix32((i += 1));
  });
  bench('hashStep', () => {
    sink = hashStep(0x9e37, (i += 1));
  });
  bench('hash2 — one per visible tile per frame', () => {
    i += 1;
    sink = hash2(1, i & 255, (i >> 8) & 255);
  });
  bench('hash3 — one per track per step in the audio deck', () => {
    i += 1;
    sink = hash3(1, i & 63, (i >> 6) & 63, (i >> 12) & 63);
  });
  bench('hashString — short key', () => {
    sink = hashString('lattice.save.v1');
  });
});

describe('noise', () => {
  bench('noise2', () => {
    i += 1;
    sink = noise2(7, i * 0.01, i * 0.017);
  });
  bench('fbm2, 4 octaves', () => {
    i += 1;
    sink = fbm2(7, i * 0.01, i * 0.017, 4, 0.5);
  });
});

describe('a frame of terrain', () => {
  // Roughly what a visible tile range costs at a typical zoom: one hash per tile to vary the
  // grass, which is the cheapest way to give a lattice texture without a texture.
  bench('2,400 tiles, one hash2 each', () => {
    let acc = 0;
    for (let t = 0; t < 2400; t += 1) acc ^= hash2(3, t & 63, t >> 6);
    sink = acc;
  });
});

export { sink };
