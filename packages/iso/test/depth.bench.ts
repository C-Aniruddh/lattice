/**
 * The depth sort, at the three sizes that decide whether a game is possible.
 *
 * This is the hottest function in an isometric game: it runs once per frame over everything
 * on screen, and the naive implementation of the occlusion relation is `O(n²)` because it asks
 * "is a behind b" of every pair. At 400 drawables that is 160,000 tests a frame, which is
 * survivable; at 10,000 it is 100 million, which is not, and no amount of constant-factor
 * tuning fixes it.
 *
 * So the shape of these three numbers matters more than any one of them. They should rise
 * roughly linearly with a log factor, not quadratically. If a future change makes the 10,000
 * case forty times the 1,000 case rather than a dozen times, somebody has reintroduced the
 * pairwise scan.
 *
 * The 8 ms frame budget in `.lattice/kit.json` is the line to read them against, and the
 * realistic number is the 400-item one: a busy scene after culling.
 */

import { bench, describe } from 'vitest';
import { createRng } from '@lattice/core';
import { DepthSorter } from '../src/depth.js';
import { createCamera } from '../src/camera.js';
import type { Rect } from '../src/projection.js';
import { rectSet } from '../src/projection.js';

interface Box {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
}

/** A seeded scatter with a realistic mix: mostly small buildings, some large, some walkers. */
function scene(seed: number, n: number): Box[] {
  const rng = createRng(seed);
  const span = Math.ceil(Math.sqrt(n) * 3);
  const boxes: Box[] = [];
  for (let i = 0; i < n; i++) {
    const point = rng.next() < 0.3;
    boxes.push(
      point
        ? { gx: rng.float(0, span), gy: rng.float(0, span), w: 0.3, d: 0.3, h: 24 }
        : {
            gx: rng.int(0, span),
            gy: rng.int(0, span),
            w: rng.int(1, 4),
            d: rng.int(1, 4),
            h: rng.int(16, 128),
          },
    );
  }
  return boxes;
}

for (const n of [100, 1000, 10000] as const) {
  describe(`sort ${String(n)} footprints`, () => {
    const boxes = scene(0xd39714, n);
    const sorter = new DepthSorter(n);
    const camera = createCamera(1920, 1080, {
      bounds: rectSet({ minX: 0, minY: 0, maxX: 0, maxY: 0 } as Rect, -1e6, -1e6, 1e6, 1e6),
    });
    camera.centerOnTile(Math.sqrt(n) * 1.5, Math.sqrt(n) * 1.5);

    bench('fill and sort, no camera', () => {
      sorter.clear();
      for (const b of boxes) sorter.add(b.gx, b.gy, b.w, b.d, b.h);
      sorter.sort();
    });

    bench('fill, cull and sort', () => {
      sorter.clear();
      for (const b of boxes) sorter.add(b.gx, b.gy, b.w, b.d, b.h);
      sorter.sort(camera);
    });
  });
}

describe('the whole draw order for a busy scene', () => {
  // 400 drawables is what a full screen of a 2:1 game looks like after culling, and it is the
  // number the frame budget should be read against.
  const boxes = scene(0x1eaf, 400);
  const sorter = new DepthSorter(512);

  bench('clear, 400 adds, sort, 400 indexAt', () => {
    sorter.clear();
    for (const b of boxes) sorter.add(b.gx, b.gy, b.w, b.d, b.h);
    sorter.sort();
    let sink = 0;
    for (let i = 0; i < sorter.count; i++) sink += sorter.indexAt(i);
    if (sink < 0) throw new Error('unreachable');
  });
});
