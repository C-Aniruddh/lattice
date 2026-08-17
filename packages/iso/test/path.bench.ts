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
