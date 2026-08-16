/**
 * The hot path, measured.
 *
 * Rule 7 of the constitution says anything called per-frame or per-entity allocates nothing,
 * and every vector signature in the kit takes an output parameter because of it. That is a
 * cost — two extra characters at every call site, and a scratch value the caller has to own —
 * so it needs a number behind it rather than a conviction.
 *
 * ## Reading these honestly
 *
 * Two things make a naive vector benchmark lie, and both are guarded here.
 *
 * **Loop-invariant inputs.** Feeding the same two vectors a million times lets V8 hoist the
 * whole computation out of the loop and measure nothing. Inputs are cycled through a table
 * of 1,024 pre-built vectors instead; the table lookup is included in every figure, so all
 * the numbers carry the same small constant and stay comparable to each other.
 *
 * **Escape analysis.** An allocating `add` that returns `{ x, y }` looks nearly free when the
 * result dies in the same scope, because V8 proves the object never escapes and never builds
 * it. Real callers store the result, pass it on, or put it in an array — so the allocating
 * comparison below deliberately lets the result escape into a sink. The gap between those two
 * numbers is the actual cost of the ergonomic API this kit refused.
 */

import { bench, describe } from 'vitest';
import {
  v2,
  v2Add,
  v2AddScaled,
  v2Dot,
  v2Len,
  v2Lerp,
  v2Normalize,
  v2Perp,
  v2Rotate,
  createRng,
  type Vec2,
} from '@lattice/core';

/** Enough distinct inputs to defeat hoisting, few enough to stay in L1. */
const N = 1024;
const rng = createRng(0x1a771ce);
const table: Vec2[] = Array.from({ length: N }, () =>
  v2(rng.float(-100, 100), rng.float(-100, 100)),
);

const out = v2(0, 0);
let i = 0;
/** Advance the cursor and hand back one of the table's vectors. */
const next = (): Vec2 => table[(i = (i + 1) & (N - 1))] as Vec2;

/** Somewhere for escaping results to go, so the optimizer cannot delete them. */
let sink: unknown = null;

describe('vec2 — out-parameter forms', () => {
  bench('v2Add', () => {
    v2Add(out, next(), next());
  });
  bench('v2AddScaled', () => {
    v2AddScaled(out, next(), next(), 0.5);
  });
  bench('v2Lerp', () => {
    v2Lerp(out, next(), next(), 0.5);
  });
  bench('v2Normalize', () => {
    v2Normalize(out, next());
  });
  bench('v2Perp', () => {
    v2Perp(out, next());
  });
  bench('v2Dot — returns a scalar, allocates nothing by construction', () => {
    sink = v2Dot(next(), next());
  });
  bench('v2Len', () => {
    sink = v2Len(next());
  });
  bench('v2Rotate — Tier B, sin and cos', () => {
    v2Rotate(out, next(), 0.7);
  });
});

describe('vec2 — what the out-parameter buys', () => {
  bench('v2 — the allocator alone', () => {
    sink = v2(1, 2);
  });

  // The comparison the design rests on. The result escapes into `sink`, which is what a
  // real caller does with it and what stops V8 optimising the allocation away entirely.
  bench('allocating add, result escapes', () => {
    const a = next();
    const b = next();
    sink = { x: a.x + b.x, y: a.y + b.y };
  });

  bench('out-parameter add, same work', () => {
    v2Add(out, next(), next());
    sink = out;
  });
});

describe('a frame of it', () => {
  // 400 sprites, three vector operations each — a plausible isometric frame. The budget is
  // 8 ms for everything, so this wants to be invisible against it rather than merely fast.
  const scratch = v2(0, 0);
  bench('400 sprites x 3 ops', () => {
    for (let s = 0; s < 400; s += 1) {
      v2AddScaled(scratch, next(), next(), 0.25);
      v2Normalize(scratch, scratch);
      v2Lerp(scratch, scratch, next(), 0.5);
    }
    sink = scratch;
  });
});
