/**
 * What the bucket costs against the thirty-seven hand-written lines it replaces.
 *
 * The helper is on the frame path and fourteen exhibits will each carry it, so the only number
 * that decides anything is the *ratio*: `bucket` against `by hand`, filling the same scene into
 * the same sorter and walking it the same way. `by hand` is the demo's shape before this file
 * existed — one array, one counter, `frame[frameCount++] = item` beside `order.add(…)` — so the
 * difference between the two pairs is exactly one integer compare per drawable, one bound check
 * per painted item, and one method call each way.
 *
 * If that ratio ever leaves the neighborhood of 1.0, somebody has put work in `add` that does not
 * belong there and the RFC's argument — that this is worth twenty-five lines rather than a
 * paragraph — stops being true.
 *
 * **`npm run bench` does not run this file.** The root config's `benchmark.include` is scoped to
 * `packages`, and widening it to reach `examples` is one line in `vitest.config.ts`, which this
 * task does not own — see `README.md` for the invocation that does run it, and the report.
 */

import { bench, describe } from 'vitest';
import { createRng } from '@lattice/core';
import { DepthSorter, createCamera, pickSorted } from '@lattice/iso';
import { createBucket } from '../src/bucket.js';

interface Box {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** The demo's mix: mostly buildings, a third of it walkers. `Box | number` is the heterogeneous
 *  union the helper exists for, so the benchmark carries the branch the real thing carries. */
type Drawable = Box | number;

function scene(seed: number, n: number): Drawable[] {
  const rng = createRng(seed);
  const span = Math.ceil(Math.sqrt(n) * 3);
  const out: Drawable[] = [];
  for (let i = 0; i < n; i++) {
    if (rng.next() < 0.3) out.push(i);
    else {
      out.push({
        gx: rng.int(0, span),
        gy: rng.int(0, span),
        w: rng.int(1, 4),
        d: rng.int(1, 4),
        h: rng.int(16, 128),
      });
    }
  }
  return out;
}

/** Summed rather than discarded, so no engine can decide the walk had no effect and delete it. */
let sink = 0;

for (const n of [100, 400, 2000] as const) {
  describe(`fill · sort · each · pick, ${String(n)} drawables`, () => {
    const items = scene(0x5b17c1, n);
    const camera = createCamera(1920, 1080, { zoom: 0.6, minZoom: 0.1 });

    {
      const order = new DepthSorter(n);
      const bucket = createBucket<Drawable>(order);
      const paint = (d: Drawable): void => {
        sink += typeof d === 'number' ? d : d.gx;
      };
      const isWalker = (d: Drawable): boolean => typeof d === 'number';
      bench('bucket', () => {
        bucket.clear();
        for (const d of items) {
          if (typeof d === 'number') bucket.addPoint(d, d % 17, d % 13, 22);
          else bucket.add(d, d.gx, d.gy, d.w, d.d, d.h);
        }
        order.sort(camera);
        bucket.each(paint);
        sink += bucket.pick(isWalker) === undefined ? 0 : 1;
      });
    }

    {
      const order = new DepthSorter(n);
      const frame: Drawable[] = [];
      let frameCount = 0;
      const hits = (index: number): boolean => typeof frame[index] === 'number';
      bench('by hand', () => {
        order.clear();
        frameCount = 0;
        for (const d of items) {
          if (typeof d === 'number') {
            frame[frameCount++] = d;
            order.addPoint(d % 17, d % 13, 22);
          } else {
            frame[frameCount++] = d;
            order.add(d.gx, d.gy, d.w, d.d, d.h);
          }
        }
        order.sort(camera);
        for (let i = 0; i < order.count; i++) {
          const d = frame[order.indexAt(i)];
          if (d === undefined) continue;
          sink += typeof d === 'number' ? d : d.gx;
        }
        sink += pickSorted(order, hits) < 0 ? 0 : 1;
      });
    }
  });
}

// Referenced so the accumulator is observably live.
export const observed = (): number => sink;
