/**
 * Path sampling and the two searches.
 *
 * `pathSample` is the per-entity, per-frame number: fifty walkers is fifty calls a frame, and
 * the whole design claim of the `path` module is that this replaces per-walker state. If it
 * is not cheap, the claim is not worth making.
 *
 * `find` and `build` are the per-*event* numbers — a tap, a wall, a rockfall — and the RFC's
 * argument for full recompute over an incremental replanner rests on them: a 48×48 valley is
 * 2,304 tiles, and if a worst-case search over it is a few tens of microseconds against an
 * 8 ms budget, then D* Lite buys back a fraction of a percent of one frame in exchange for the
 * subtlest code in the package.
 */

import { bench, describe } from 'vitest';
import { createRng } from '@latticekit/core';
import { FlowField, Path, PathFinder, pathDirAt, pathProject, pathSample, pathSimplify } from '../src/path.js';
import type { TileCost } from '../src/path.js';
import { TileGrid } from '../src/tilemap.js';
import type { GridPoint } from '../src/projection.js';

const here: GridPoint = { gx: 0, gy: 0 };

/** A road with a realistic number of nodes: a searched route across a valley, simplified. */
function road(nodes: number): Path {
  const rng = createRng(0x40ad);
  const p = new Path(nodes);
  let gx = 0;
  let gy = 0;
  for (let i = 0; i < nodes; i++) {
    p.push(gx, gy);
    gx += rng.int(0, 3);
    gy += rng.int(0, 3);
  }
  return p;
}

describe('pathSample', () => {
  const short = road(8);
  const long = road(512);

  bench('50 walkers on an 8-node road — the demo crowd, one frame', () => {
    for (let i = 0; i < 50; i++) {
      pathSample(short, ((i * 37) % 100) * 0.01 * short.arcLength, here);
    }
  });

  bench('50 walkers on a 512-node road', () => {
    for (let i = 0; i < 50; i++) {
      pathSample(long, ((i * 37) % 100) * 0.01 * long.arcLength, here);
    }
  });

  bench('one sample, 512-node road', () => {
    pathSample(long, long.arcLength * 0.618, here);
  });

  bench('pathDirAt, 512-node road', () => {
    pathDirAt(long, long.arcLength * 0.618);
  });

  bench('pathProject, 512-node road — linear, and the reason reach is not free', () => {
    pathProject(long, 300, 300);
  });
});

describe('PathFinder', () => {
  const grid = new TileGrid(48, 48, { fill: 1 });
  const rng = createRng(0xa5747);
  for (let i = 0; i < 300; i++) grid.set(rng.int(1, 48), rng.int(0, 48), 0);
  const cost: TileCost = (gx, gy) => grid.get(gx, gy);
  const open: TileCost = () => 1;
  const finder = new PathFinder(4096);
  const out = new Path(256);

  bench('48x48 valley, corner to corner, 300 obstacles', () => {
    finder.find(cost, 0, 0, 47, 47, out, undefined);
  });

  bench('the same, then simplified with a line-of-sight pull', () => {
    finder.find(cost, 0, 0, 47, 47, out, undefined);
    pathSimplify(out, cost);
  });

  bench('48x48 open ground, corner to corner — the easy case', () => {
    finder.find(open, 0, 0, 47, 47, out, undefined);
  });

  bench('unreachable goal, capped at the node ceiling — the worst case', () => {
    finder.find(open, 0, 0, 20, 20, out, { bounds: { gx0: 0, gy0: 0, gx1: 48, gy1: 48 }, maxNodes: 2304 });
  });
});

/**
 * K58 — what a weighted map costs, and what declaring its floor gives back.
 *
 * The `clay` exhibit measured a 17× spread between a weighted cost function and a flat one on
 * identical geometry, and named the octile heuristic as the cause: it is the true cost over
 * weight-**1** ground, so on ground that weighs `w` it is `w` times too small and A\* slides
 * toward Dijkstra. {@link PathOptions.minWeight} lets the caller say what the floor really is.
 *
 * The four rows are one query over four descriptions of the same shape of ground. The first is
 * the reference; the pairs either side of it are the same map searched blind and searched told.
 * **The endpoints are a long shallow leg rather than corner to corner**, because on a square
 * every tile lies on some cheapest diagonal route between opposite corners, so no heuristic —
 * not even an exact one — can narrow that particular frontier.
 */
describe('PathFinder — the weighted heuristic', () => {
  const bounds = { gx0: 0, gy0: 0, gx1: 48, gy1: 48 };
  const pillar = (gx: number, gy: number): boolean => (gx * 5 + gy * 3) % 17 === 0 && gx > 2 && gx < 45;
  const flat: TileCost = (gx, gy) => (pillar(gx, gy) ? 0 : 1);
  const heavy: TileCost = (gx, gy) => (pillar(gx, gy) ? 0 : 6);
  const rough: TileCost = (gx, gy) => (pillar(gx, gy) ? 0 : 3 + (((gx * 7 + gy * 13) >>> 0) % 6));
  const finder = new PathFinder(8192);
  const out = new Path(256);

  bench('weight 1 everywhere — the flat reference', () => {
    finder.find(flat, 0, 0, 47, 2, out, { bounds });
  });

  bench('weight 6 everywhere, minWeight 1 — the defect', () => {
    finder.find(heavy, 0, 0, 47, 2, out, { bounds, minWeight: 1 });
  });

  bench('weight 6 everywhere, minWeight 6 — the fix', () => {
    finder.find(heavy, 0, 0, 47, 2, out, { bounds, minWeight: 6 });
  });

  bench('weights 3..8, minWeight 1 — the defect', () => {
    finder.find(rough, 0, 0, 47, 2, out, { bounds, minWeight: 1 });
  });

  bench('weights 3..8, minWeight 3 — the fix, on a map whose floor is not its ceiling', () => {
    finder.find(rough, 0, 0, 47, 2, out, { bounds, minWeight: 3 });
  });

  bench('weights 1..8, minWeight 1 — the case the fix cannot help', () => {
    // One tile of weight 1 anywhere holds the whole floor down, so there is nothing to declare
    // and nothing to win. This row is here so nobody has to re-measure to find that out.
    const mixed: TileCost = (gx, gy) => (pillar(gx, gy) ? 0 : 1 + (((gx * 7 + gy * 13) >>> 0) % 8));
    finder.find(mixed, 0, 0, 47, 2, out, { bounds, minWeight: 1 });
  });
});

describe('FlowField', () => {
  const grid = new TileGrid(48, 48, { fill: 1 });
  const rng = createRng(0xf10e);
  for (let i = 0; i < 300; i++) grid.set(rng.int(1, 48), rng.int(0, 48), 0);
  const cost: TileCost = (gx, gy) => grid.get(gx, gy);
  const field = new FlowField(0, 0, 48, 48);
  field.addGoal(47, 47);

  bench('one sweep over a 48x48 valley — the rockfall rebuild', () => {
    field.build(cost, undefined, grid.version);
  });

  bench('50 walkers each taking one step', () => {
    for (let i = 0; i < 50; i++) field.step(i % 48, (i * 7) % 48, here);
  });
});
