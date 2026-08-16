/**
 * `path` — arc length in world pixels, integer costs, and the staircase.
 *
 * Two of these tests are about a claim the whole module rests on. I20 asserts that sampling is
 * parameterised in *world* pixels rather than grid units, on a path whose two legs have
 * different world-per-grid ratios — the only shape where the bug shows. I13 asserts that two
 * runs of the same search agree node for node, which is what "a replay lands on the same
 * pixel" means when it is written down as a test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRng } from '@lattice/core';
import {
  DIR_DX,
  DIR_DY,
  FlowField,
  Path,
  PathFinder,
  STEP_DIAG,
  STEP_ORTHO,
  pathDirAt,
  pathProject,
  pathSample,
  pathSimplify,
} from '../src/path.js';
import type { TileCost } from '../src/path.js';
import { HALF_H, HALF_W, gridToWorldX, gridToWorldY } from '../src/projection.js';
import type { GridPoint, TileRange } from '../src/projection.js';
import { TileGrid } from '../src/tilemap.js';

const gp = (): GridPoint => ({ gx: 0, gy: 0 });
const open: TileCost = () => 1;

/** World distance between two grid positions — the unit `Path` measures in. */
function worldDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = gridToWorldX(bx, by) - gridToWorldX(ax, ay);
  const dy = gridToWorldY(bx, by) - gridToWorldY(ax, ay);
  return Math.sqrt(dx * dx + dy * dy);
}

function nodes(p: Path): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.nodeCount; i++) out.push([p.gxAt(i), p.gyAt(i)]);
  return out;
}

describe('the direction table', () => {
  it('has nine entries, with 0 meaning no route', () => {
    expect(DIR_DX.length).toBe(9);
    expect(DIR_DY.length).toBe(9);
    expect(DIR_DX[0]).toBe(0);
    expect(DIR_DY[0]).toBe(0);
  });

  it('makes odd codes orthogonal and even codes diagonal', () => {
    // That parity is the whole of `code & 1 ? STEP_ORTHO : STEP_DIAG`, so a table that broke it
    // would silently charge diagonal prices for orthogonal steps.
    for (let code = 1; code <= 8; code++) {
      const dx = DIR_DX[code] as number;
      const dy = DIR_DY[code] as number;
      const orthogonal = dx === 0 || dy === 0;
      expect(orthogonal).toBe((code & 1) === 1);
      expect(Math.abs(dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      expect(dx === 0 && dy === 0).toBe(false);
    }
  });

  it('puts the reverse of every code four steps around the circle', () => {
    // `FlowField` relies on this to write the direction a walker steps *back* along.
    for (let code = 1; code <= 8; code++) {
      const reverse = ((code + 3) % 8) + 1;
      // Summed rather than negated, because `-0` and `0` are different values to `toBe` and
      // the distinction means nothing here.
      expect((DIR_DX[reverse] as number) + (DIR_DX[code] as number)).toBe(0);
      expect((DIR_DY[reverse] as number) + (DIR_DY[code] as number)).toBe(0);
    }
  });

  it('costs 10 and 14, which is the integer octile metric', () => {
    expect(STEP_ORTHO).toBe(10);
    expect(STEP_DIAG).toBe(14);
    // 14/10 is 1.4, and √2 is 1.41421…: close enough that a diagonal route does not look
    // preferred, and exact enough that two engines agree on which node to pop.
    expect(Math.abs(STEP_DIAG / STEP_ORTHO - Math.SQRT2)).toBeLessThan(0.015);
  });
});

describe('Path', () => {
  it('measures arc length in world pixels, not grid units', () => {
    const p = new Path(4);
    p.push(0, 0);
    p.push(1, 0);
    // T17: one grid unit along +gx is √(32² + 16²) = 35.777…, not 1.
    expect(p.arcLength).toBe(Math.sqrt(HALF_W * HALF_W + HALF_H * HALF_H));
    p.clear();
    p.push(0, 0);
    p.push(1, 1);
    // …and one along the (1,1) diagonal is 32, a different number entirely. Parameterising in
    // grid units makes a walker 58% faster on one than the other.
    expect(p.arcLength).toBe(2 * HALF_H);
  });

  it('is empty until pushed, and reports zero length', () => {
    const p = new Path(2);
    expect(p.nodeCount).toBe(0);
    expect(p.arcLength).toBe(0);
    p.push(3, 4);
    expect(p.nodeCount).toBe(1);
    expect(p.arcLength).toBe(0);
    expect(p.sAt(0)).toBe(0);
  });

  it('grows past its capacity and keeps every node', () => {
    const p = new Path(1);
    for (let i = 0; i < 33; i++) p.push(i, 0);
    expect(p.nodeCount).toBe(33);
    expect(p.gxAt(32)).toBe(32);
    expect(p.sAt(32)).toBe(p.arcLength);
  });

  it('refuses an out-of-range node rather than returning undefined', () => {
    const p = new Path(4);
    p.push(0, 0);
    expect(() => p.gxAt(1)).toThrow(/Path.gxAt: expected an integer index in \[0, 1\), got 1/);
    expect(() => p.gyAt(-1)).toThrow(RangeError);
    expect(() => p.sAt(1.5)).toThrow(RangeError);
  });

  it('bumps the version on every mutation, so a cache invalidates exactly once', () => {
    const p = new Path(4);
    const start = p.version;
    p.push(0, 0);
    expect(p.version).toBe(start + 1);
    p.push(1, 1);
    expect(p.version).toBe(start + 2);
    p.clear();
    expect(p.version).toBe(start + 3);
    expect(p.nodeCount).toBe(0);
  });

  it('accepts fractional nodes, which is how an authored road arrives', () => {
    const p = new Path(4);
    p.push(0.5, 0.25);
    p.push(3.75, 1.5);
    expect(p.arcLength).toBe(worldDist(0.5, 0.25, 3.75, 1.5));
  });
});

describe('pathSample', () => {
  it('I18: is node 0 at s = 0 and the last node at s = arcLength', () => {
    const p = new Path(8);
    p.push(1, 1);
    p.push(4, 1);
    p.push(4, 6);
    const out = gp();
    expect(pathSample(p, 0, out)).toEqual({ gx: 1, gy: 1 });
    expect(pathSample(p, p.arcLength, out)).toEqual({ gx: 4, gy: 6 });
  });

  it('I18: clamps rather than wrapping, in both directions', () => {
    // A caller who wants a loop writes the modulo, and can therefore also write a ping-pong,
    // a pause at the end, or a queue that bunches at the gate.
    const p = new Path(4);
    p.push(0, 0);
    p.push(2, 0);
    const out = gp();
    expect(pathSample(p, -1e6, out)).toEqual({ gx: 0, gy: 0 });
    expect(pathSample(p, 1e6, out)).toEqual({ gx: 2, gy: 0 });
    expect(pathSample(p, Number.NaN, out)).toEqual({ gx: 0, gy: 0 });
  });

  it('I18: is monotone across a node boundary — no backwards stutter', () => {
    // The bug this catches: a binary search that returns the segment *ending* at an exact hit
    // rather than the one starting there makes a walker jerk backwards at every node.
    const p = new Path(8);
    p.push(0, 0);
    p.push(3, 0);
    p.push(3, 3);
    const out = gp();
    let previous = -1;
    for (let i = 0; i <= 400; i++) {
      pathSample(p, (i / 400) * p.arcLength, out);
      const s = pathProject(p, out.gx, out.gy);
      // 1e-9 is the RFC's figure; the true error is the float noise of one lerp on values
      // below 200, which is nearer 1e-13.
      expect(s).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = s;
    }
  });

  it('I20: 1,000 evenly spaced samples give equal world-space gaps within each leg', () => {
    // The legs are chosen so the bug is visible: (0,0)->(4,4) is 128 world pixels over a grid
    // distance of 5.66, and (4,4)->(8,4) is 143.1 world pixels over a grid distance of 4. A
    // grid-unit parameterisation gives the two legs different world speeds; a world-pixel one
    // gives them the same.
    const p = new Path(8);
    p.push(0, 0);
    p.push(4, 4);
    p.push(8, 4);
    const n = 1000;
    const out = gp();
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      pathSample(p, (i / (n - 1)) * p.arcLength, out);
      xs.push(gridToWorldX(out.gx, out.gy));
      ys.push(gridToWorldY(out.gx, out.gy));
    }
    const expected = p.arcLength / (n - 1);
    let checked = 0;
    for (let i = 1; i < n; i++) {
      const dx = (xs[i] as number) - (xs[i - 1] as number);
      const dy = (ys[i] as number) - (ys[i - 1] as number);
      const gap = Math.sqrt(dx * dx + dy * dy);
      // The one gap that straddles the corner is a chord and is legitimately shorter; every
      // other gap must match. Tolerance 1e-9: the values are below 300 and the arithmetic is
      // one lerp plus one sqrt, so the accumulated error is nearer 1e-13.
      if (Math.abs(gap - expected) > 1e-9) {
        expect(gap).toBeLessThan(expected);
        continue;
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(n - 3);
  });

  it('handles a single-node path and a zero-length segment', () => {
    const one = new Path(2);
    one.push(5, 5);
    expect(pathSample(one, 100, gp())).toEqual({ gx: 5, gy: 5 });
    const doubled = new Path(4);
    doubled.push(1, 1);
    doubled.push(1, 1);
    doubled.push(3, 1);
    // A repeated node is legal in an authored spline; it has no direction, so it resolves to
    // its own start rather than dividing by zero.
    expect(pathSample(doubled, 0, gp())).toEqual({ gx: 1, gy: 1 });
    expect(pathSample(doubled, doubled.arcLength, gp())).toEqual({ gx: 3, gy: 1 });
  });

  it('refuses an empty path rather than leaving the walker wherever out last was', () => {
    expect(() => pathSample(new Path(2), 0, gp())).toThrow(/the path is empty/);
  });

  it('is the crowd, in one expression', () => {
    // The demo's whole crowd: fifty walkers, no per-walker state, nothing allocated.
    const road = new Path(8);
    road.push(0, 0);
    road.push(10, 0);
    road.push(10, 10);
    const here = gp();
    const positions: string[] = [];
    for (let i = 0; i < 50; i++) {
      pathSample(road, (37 * 4 + (i / 50) * road.arcLength) % road.arcLength, here);
      positions.push(`${here.gx.toFixed(4)},${here.gy.toFixed(4)}`);
    }
    expect(new Set(positions).size).toBe(50);
  });
});

describe('pathDirAt', () => {
  it('gives the eight codes for the eight grid directions', () => {
    for (let code = 1; code <= 8; code++) {
      const p = new Path(4);
      p.push(0, 0);
      p.push((DIR_DX[code] as number) * 3, (DIR_DY[code] as number) * 3);
      expect(pathDirAt(p, 0)).toBe(code);
      expect(pathDirAt(p, p.arcLength)).toBe(code);
    }
  });

  it('is 0 where there is no direction at all', () => {
    expect(pathDirAt(new Path(2), 0)).toBe(0);
    const one = new Path(2);
    one.push(1, 1);
    expect(pathDirAt(one, 0)).toBe(0);
    const still = new Path(4);
    still.push(2, 2);
    still.push(2, 2);
    expect(pathDirAt(still, 0)).toBe(0);
  });

  it('picks the nearest of the eight sectors, in grid space', () => {
    // The boundary is tan(22.5°) ≈ 0.4142: a slope of 0.3 is orthogonal, 0.5 is diagonal.
    const shallow = new Path(4);
    shallow.push(0, 0);
    shallow.push(10, 3);
    expect(pathDirAt(shallow, 0)).toBe(1);
    const steeper = new Path(4);
    steeper.push(0, 0);
    steeper.push(10, 5);
    expect(pathDirAt(steeper, 0)).toBe(2);
    const vertical = new Path(4);
    vertical.push(0, 0);
    vertical.push(3, 10);
    expect(pathDirAt(vertical, 0)).toBe(3);
  });

  it('reports the direction of the segment the arc length falls in', () => {
    const p = new Path(8);
    p.push(0, 0);
    p.push(5, 0);
    p.push(5, 5);
    expect(pathDirAt(p, 0)).toBe(1);
    expect(pathDirAt(p, p.sAt(1) * 0.5)).toBe(1);
    expect(pathDirAt(p, p.sAt(1) + 1)).toBe(3);
    expect(pathDirAt(p, p.arcLength * 2)).toBe(3);
  });

  it('uses no trigonometry, which is why a facing may reach a save file', () => {
    // Comparing signs and magnitudes is exact arithmetic. `Math.atan2` is not required to be
    // correctly rounded, so an angle in a save is an engine-specific artefact.
    const src = readSource('path.ts');
    expect(src).not.toMatch(/Math\.(atan2|sin|cos|tan)\(/);
  });
});

describe('pathProject', () => {
  it('I19: a node projects to its own arc length', () => {
    const p = new Path(8);
    p.push(0, 0);
    p.push(4, 0);
    p.push(4, 7);
    p.push(1, 7);
    for (let i = 0; i < p.nodeCount; i++) {
      // 1e-6 is the RFC's figure and is loose by six orders of magnitude here: the projection
      // is a dot product over values below 300, so the error is float noise around 1e-13.
      expect(Math.abs(pathProject(p, p.gxAt(i), p.gyAt(i)) - p.sAt(i))).toBeLessThan(1e-6);
    }
  });

  it('I19: round-trips through pathSample for any point on the path', () => {
    const p = new Path(8);
    p.push(0, 0);
    p.push(6, 0);
    p.push(6, 6);
    const out = gp();
    for (let i = 0; i <= 20; i++) {
      const s = (i / 20) * p.arcLength;
      pathSample(p, s, out);
      expect(Math.abs(pathProject(p, out.gx, out.gy) - s)).toBeLessThan(1e-6);
    }
  });

  it('measures nearest in world space, so a diagonal road projects where it looks like it should', () => {
    const p = new Path(4);
    p.push(0, 0);
    p.push(8, 8);
    // A point beside the middle of the road. In world space the road runs straight down, so
    // the nearest point is at the same world y.
    const s = pathProject(p, 5, 3);
    const out = gp();
    pathSample(p, s, out);
    expect(gridToWorldY(out.gx, out.gy)).toBeCloseTo(gridToWorldY(5, 3), 9);
  });

  it('clamps to the ends for a point beyond either', () => {
    const p = new Path(4);
    p.push(2, 2);
    p.push(5, 2);
    expect(pathProject(p, -100, 2)).toBe(0);
    expect(pathProject(p, 100, 2)).toBe(p.arcLength);
  });

  it('gives the smaller arc length when a road doubles back on itself', () => {
    const p = new Path(8);
    p.push(0, 0);
    p.push(4, 0);
    p.push(0, 0);
    // The point sits on both legs. Ties go to the earlier one, so the answer does not depend on
    // which end the loop reached first.
    expect(pathProject(p, 2, 0)).toBeLessThan(p.arcLength / 2 + 1e-9);
  });

  it('tolerates a zero-length segment, which an authored spline may well contain', () => {
    const p = new Path(8);
    p.push(2, 2);
    p.push(2, 2);
    p.push(6, 2);
    // The repeated node has no direction to project onto; the segment after it does.
    expect(pathProject(p, 2, 2)).toBe(0);
    expect(pathProject(p, 6, 2)).toBe(p.arcLength);
  });

  it('is 0 for a single-node path and throws on an empty one', () => {
    const one = new Path(2);
    one.push(3, 3);
    expect(pathProject(one, 99, 99)).toBe(0);
    expect(() => pathProject(new Path(2), 0, 0)).toThrow(/the path is empty/);
  });
});

describe('pathSimplify', () => {
  it('I21: removes collinear runs without touching either end', () => {
    const p = new Path(16);
    for (let i = 0; i <= 6; i++) p.push(i, 0);
    const before = p.arcLength;
    pathSimplify(p);
    expect(nodes(p)).toEqual([
      [0, 0],
      [6, 0],
    ]);
    expect(p.arcLength).toBe(before);
  });

  it('keeps a genuine turn, and keeps a turn-around', () => {
    const turn = new Path(8);
    turn.push(0, 0);
    turn.push(2, 0);
    turn.push(2, 2);
    pathSimplify(turn);
    expect(nodes(turn)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
    // A cross product of zero also describes a path that doubles straight back, and dropping
    // the turn-around node would cut a corner the route deliberately did not cut.
    const back = new Path(8);
    back.push(0, 0);
    back.push(3, 0);
    back.push(0, 0);
    pathSimplify(back);
    expect(nodes(back)).toEqual([
      [0, 0],
      [3, 0],
      [0, 0],
    ]);
  });

  it('does nothing to a path of fewer than three nodes', () => {
    const p = new Path(4);
    p.push(1, 1);
    p.push(2, 2);
    const version = p.version;
    pathSimplify(p);
    expect(p.version).toBe(version);
    expect(nodes(p)).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('T16: collapses a staircase into a straight road, and shortens the arc length', () => {
    // A raw 8-way A* result across open ground is a stair of unit steps. A walker sampled
    // along it weaves from side to side like someone finding their keys in the dark, and the
    // arc length is about 8% longer than the road looks — which overpays a reach-based economy.
    const finder = new PathFinder(1024);
    const road = new Path(64);
    expect(finder.find(open, 0, 0, 12, 5, road, undefined)).toBe(true);
    const staircase = road.arcLength;
    const nodesBefore = road.nodeCount;
    pathSimplify(road, open);
    expect(road.nodeCount).toBeLessThan(nodesBefore);
    expect(road.arcLength).toBeLessThanOrEqual(staircase);
    expect(nodes(road)[0]).toEqual([0, 0]);
    expect(nodes(road)[road.nodeCount - 1]).toEqual([12, 5]);
  });

  it('I21: never pulls a segment through an impassable tile', () => {
    // A wall with one gap. The string pull must go through the gap, not through the wall.
    const grid = new TileGrid(20, 20, { fill: 1 });
    for (let gy = 0; gy < 20; gy++) if (gy !== 10) grid.set(10, gy, 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const finder = new PathFinder(1024);
    const road = new Path(64);
    expect(finder.find(cost, 2, 2, 18, 18, road, undefined)).toBe(true);
    pathSimplify(road, cost);
    // Walk the simplified path densely and check every sample sits on passable ground.
    const out = gp();
    for (let i = 0; i <= 2000; i++) {
      pathSample(road, (i / 2000) * road.arcLength, out);
      expect(cost(Math.floor(out.gx), Math.floor(out.gy))).toBeGreaterThan(0);
    }
  });

  it('does not spin on a NaN node — it refuses the pull and keeps the route', () => {
    // The step guard in the passability walk exists for exactly this: a coordinate that
    // arrived as a NaN makes every comparison false, and a loop that trusted its own
    // termination condition would hang the frame rather than return a wrong answer. The NaN
    // is the *last* node so that the pull actually has to walk towards it.
    const p = new Path(8);
    p.push(0, 0);
    p.push(2, 2);
    p.push(Number.NaN, Number.NaN);
    pathSimplify(p, open);
    expect(p.nodeCount).toBe(3);
    expect(p.gxAt(0)).toBe(0);
    expect(p.gxAt(1)).toBe(2);
  });

  it('pulls in every direction, not just down and right', () => {
    // The grid walk has a step sign and a boundary distance per axis, and each has a branch
    // for the negative direction and one for no movement at all. A suite that only ever pulls
    // south-east exercises a quarter of them.
    const legs: readonly (readonly [number, number])[] = [
      [-9, -7],
      [-9, 7],
      [9, -7],
      [0, 9],
      [0, -9],
      [9, 0],
      [-9, 0],
    ];
    for (const [dx, dy] of legs) {
      const p = new Path(16);
      p.push(0, 0);
      p.push(dx / 3, dy / 3);
      p.push((dx * 2) / 3, (dy * 2) / 3);
      p.push(dx, dy);
      pathSimplify(p, open);
      // Open ground everywhere, so the whole leg collapses to its two endpoints.
      expect(nodes(p)).toEqual([
        [0, 0],
        [dx, dy],
      ]);
    }
  });

  it('I21: only ever shortens', () => {
    const rng = createRng(0x51ec);
    const grid = new TileGrid(30, 30, { fill: 1 });
    // Column 0 stays clear, so the search provably succeeds: a test that only asserts inside
    // an `if` is a test that passes by doing nothing the day the map stops connecting.
    for (let i = 0; i < 120; i++) grid.set(rng.int(1, 30), rng.int(0, 29), 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const finder = new PathFinder(2048);
    const road = new Path(128);
    expect(finder.find(cost, 0, 0, 29, 29, road, undefined)).toBe(true);
    const before = road.arcLength;
    pathSimplify(road, cost);
    expect(road.arcLength).toBeLessThanOrEqual(before + 1e-9);
    expect(road.gxAt(0)).toBe(0);
    expect(road.gxAt(road.nodeCount - 1)).toBe(29);
  });
});

describe('PathFinder', () => {
  it('I11: on open ground the summed cost equals the octile distance', () => {
    const finder = new PathFinder(1024);
    const out = new Path(64);
    for (const [dx, dy] of [
      [7, 3],
      [3, 7],
      [5, 5],
      [9, 0],
      [0, 6],
    ] as const) {
      expect(finder.find(open, 0, 0, dx, dy, out, undefined)).toBe(true);
      let total = 0;
      for (let i = 1; i < out.nodeCount; i++) {
        const stepX = Math.abs(out.gxAt(i) - out.gxAt(i - 1));
        const stepY = Math.abs(out.gyAt(i) - out.gyAt(i - 1));
        total += stepX === 1 && stepY === 1 ? STEP_DIAG : STEP_ORTHO;
      }
      const lo = Math.min(dx, dy);
      const hi = Math.max(dx, dy);
      expect(total).toBe(STEP_DIAG * lo + STEP_ORTHO * (hi - lo));
    }
  });

  it('I12: every consecutive pair differs by at most one on each axis', () => {
    const finder = new PathFinder(1024);
    const out = new Path(64);
    finder.find(open, -3, -4, 9, 11, out, undefined);
    expect(out.nodeCount).toBeGreaterThan(1);
    for (let i = 1; i < out.nodeCount; i++) {
      expect(Math.abs(out.gxAt(i) - out.gxAt(i - 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(out.gyAt(i) - out.gyAt(i - 1))).toBeLessThanOrEqual(1);
    }
  });

  it('I12/T12: with cutCorners false an agent never slips through the join of two walls', () => {
    // Two walls meeting at a corner, with the only diagonal being the join itself.
    const grid = new TileGrid(5, 5, { fill: 1 });
    grid.set(2, 1, 0);
    grid.set(1, 2, 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const finder = new PathFinder(256);
    const out = new Path(32);
    finder.find(cost, 1, 1, 2, 2, out, undefined);
    for (let i = 1; i < out.nodeCount; i++) {
      const dx = out.gxAt(i) - out.gxAt(i - 1);
      const dy = out.gyAt(i) - out.gyAt(i - 1);
      if (dx !== 0 && dy !== 0) {
        expect(cost(out.gxAt(i - 1) + dx, out.gyAt(i - 1))).toBeGreaterThan(0);
        expect(cost(out.gxAt(i - 1), out.gyAt(i - 1) + dy)).toBeGreaterThan(0);
      }
    }
    // …and with the option on, the corner is cut, which is what it is for.
    const cutting = new Path(32);
    finder.find(cost, 1, 1, 2, 2, cutting, { cutCorners: true });
    expect(cutting.nodeCount).toBe(2);
  });

  it('I13: two runs of the same query produce a byte-identical path', () => {
    const rng = createRng(0xdead);
    const grid = new TileGrid(40, 40, { fill: 1 });
    // Column 0 and row 39 are left clear, so a route provably exists and this test asserts
    // agreement rather than accidentally asserting that two searches both failed. The direct
    // diagonal is far cheaper than that corridor, so the search does not simply follow it.
    for (let i = 0; i < 300; i++) {
      const gx = rng.int(1, 40);
      const gy = rng.int(0, 39);
      grid.set(gx, gy, 0);
    }
    // Weights, not just walls: a route that is shorter but rougher is the decision weighted
    // costs exist for, and equal-`f` ties are common on a grid.
    const cost: TileCost = (gx, gy) => {
      const v = grid.get(gx, gy);
      return v === 0 ? 0 : 1 + ((gx * 7 + gy * 13) % 3);
    };
    const finder = new PathFinder(4096);
    const a = new Path(128);
    const b = new Path(128);
    const other = new PathFinder(64);
    expect(finder.find(cost, 0, 0, 39, 39, a, undefined)).toBe(true);
    expect(other.find(cost, 0, 0, 39, 39, b, undefined)).toBe(true);
    // A different instance with a different starting capacity — so the table has rehashed and
    // the node arrays have grown — must still return the same route node for node.
    expect(nodes(b)).toEqual(nodes(a));
    expect(b.arcLength).toBe(a.arcLength);
  });

  it('reuses one finder across queries without leaking state', () => {
    const finder = new PathFinder(256);
    const first = new Path(32);
    const second = new Path(32);
    const again = new Path(32);
    finder.find(open, 0, 0, 5, 5, first, undefined);
    finder.find(open, 3, 1, -4, 8, second, undefined);
    finder.find(open, 0, 0, 5, 5, again, undefined);
    expect(nodes(again)).toEqual(nodes(first));
  });

  it('returns a single-node path when start and goal are the same tile', () => {
    const finder = new PathFinder(64);
    const out = new Path(8);
    expect(finder.find(open, 4, 4, 4, 4, out, undefined)).toBe(true);
    expect(nodes(out)).toEqual([[4, 4]]);
    // Fractional start and goal floor to their tile, so a walker mid-tile paths from the tile
    // it is standing on.
    expect(finder.find(open, 4.9, 4.1, 4.2, 4.7, out, undefined)).toBe(true);
    expect(nodes(out)).toEqual([[4, 4]]);
  });

  it('clears the output on failure, so a stale route cannot be walked by mistake', () => {
    const blocked: TileCost = () => 0;
    const finder = new PathFinder(256);
    const out = new Path(32);
    finder.find(open, 0, 0, 3, 3, out, undefined);
    expect(out.nodeCount).toBeGreaterThan(0);
    expect(finder.find(blocked, 0, 0, 3, 3, out, undefined)).toBe(false);
    expect(out.nodeCount).toBe(0);
  });

  it('fails on an unreachable goal without distinguishing it from the node ceiling', () => {
    // Deliberately not distinguished: a caller that behaves differently in the two cases has
    // written a bug that only appears on large maps.
    const grid = new TileGrid(9, 9, { fill: 1 });
    for (let i = 0; i < 9; i++) grid.set(4, i, 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const finder = new PathFinder(256);
    const out = new Path(32);
    expect(finder.find(cost, 1, 1, 7, 7, out, { bounds: { gx0: 0, gy0: 0, gx1: 9, gy1: 9 } })).toBe(
      false,
    );
    expect(finder.find(open, 0, 0, 60, 60, out, { maxNodes: 8 })).toBe(false);
  });

  it('refuses a goal standing on an impassable tile at once', () => {
    const cost: TileCost = (gx, gy) => (gx === 5 && gy === 5 ? 0 : 1);
    const finder = new PathFinder(256);
    expect(finder.find(cost, 0, 0, 5, 5, new Path(8), undefined)).toBe(false);
  });

  it('confines the search to bounds, and refuses endpoints outside them', () => {
    const finder = new PathFinder(512);
    const out = new Path(64);
    const bounds: TileRange = { gx0: 0, gy0: 0, gx1: 6, gy1: 6 };
    expect(finder.find(open, 0, 0, 5, 5, out, { bounds })).toBe(true);
    for (let i = 0; i < out.nodeCount; i++) {
      expect(out.gxAt(i)).toBeGreaterThanOrEqual(0);
      expect(out.gxAt(i)).toBeLessThan(6);
    }
    expect(finder.find(open, -1, 0, 5, 5, out, { bounds })).toBe(false);
    expect(finder.find(open, 0, 0, 9, 5, out, { bounds })).toBe(false);
  });

  it('walks four ways with diagonals off, and the cost is Manhattan', () => {
    const finder = new PathFinder(512);
    const out = new Path(64);
    expect(finder.find(open, 0, 0, 4, 3, out, { diagonals: false })).toBe(true);
    for (let i = 1; i < out.nodeCount; i++) {
      const dx = Math.abs(out.gxAt(i) - out.gxAt(i - 1));
      const dy = Math.abs(out.gyAt(i) - out.gyAt(i - 1));
      expect(dx + dy).toBe(1);
    }
    expect(out.nodeCount).toBe(8);
  });

  it('names a float weight rather than letting a replay diverge over it', () => {
    const finder = new PathFinder(256);
    expect(() => finder.find(() => 1.5, 0, 0, 3, 3, new Path(8), undefined)).toThrow(
      /an integer weight from the cost function at \(\d+, \d+\), got 1.5/,
    );
  });

  it('prefers the cheap road to the short scree', () => {
    // The whole point of weighted rather than binary costs: shorter but rougher is a decision
    // a game gets to offer, and this asserts the search actually makes it.
    const cost: TileCost = (gx, gy) => (gy === 0 ? 1 : gy === 1 ? 50 : 1);
    const finder = new PathFinder(1024);
    const out = new Path(64);
    expect(finder.find(cost, 0, 0, 10, 0, out, undefined)).toBe(true);
    for (let i = 0; i < out.nodeCount; i++) expect(out.gyAt(i)).toBe(0);
  });

  it('grows its node table for a search far larger than its capacity hint', () => {
    const finder = new PathFinder(16);
    const out = new Path(256);
    // Long enough to outgrow the unwind scratch as well as the node table, which are separate
    // buffers and separate growth paths.
    expect(finder.find(open, 0, 0, 90, 90, out, { maxNodes: 100000 })).toBe(true);
    expect(out.nodeCount).toBe(91);
  });
});

describe('FlowField', () => {
  it('refuses a degenerate size', () => {
    expect(() => new FlowField(0, 0, 0, 5)).toThrow(/w and h to be integers > 0, got 0 and 5/);
    expect(() => new FlowField(0, 0, 5, 1.5)).toThrow(RangeError);
  });

  it('reports its range half-open', () => {
    const f = new FlowField(-4, 7, 10, 3);
    expect(f.range).toEqual({ gx0: -4, gy0: 7, gx1: 6, gy1: 10 });
  });

  it('I14: every reachable tile walks downhill to a goal without revisiting one', () => {
    const grid = new TileGrid(20, 20, { fill: 1 });
    const rng = createRng(0xf10a);
    for (let i = 0; i < 90; i++) grid.set(rng.int(0, 19), rng.int(0, 19), 0);
    grid.set(19, 19, 1);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const field = new FlowField(0, 0, 20, 20);
    field.addGoal(19, 19);
    field.build(cost, undefined, grid.version);
    const out = gp();
    let walked = 0;
    for (let gx = 0; gx < 20; gx++) {
      for (let gy = 0; gy < 20; gy++) {
        const start = field.costAt(gx, gy);
        if (start < 0) continue;
        walked += 1;
        const seen = new Set<string>();
        let cx = gx;
        let cy = gy;
        let steps = 0;
        const limit = start / STEP_ORTHO;
        while (field.dirAt(cx, cy) !== 0) {
          seen.add(`${String(cx)},${String(cy)}`);
          expect(field.step(cx, cy, out)).toBe(true);
          cx = out.gx;
          cy = out.gy;
          expect(seen.has(`${String(cx)},${String(cy)}`)).toBe(false);
          steps += 1;
          expect(steps).toBeLessThanOrEqual(limit);
        }
        expect(field.costAt(cx, cy)).toBe(0);
      }
    }
    expect(walked).toBeGreaterThan(200);
  });

  it('handles many goals for free, which is what A* cannot do without many searches', () => {
    const field = new FlowField(0, 0, 20, 1);
    field.addGoal(0, 0);
    field.addGoal(19, 0);
    field.build(open);
    // A walker at 5 heads left and one at 15 heads right, from one sweep.
    expect(field.dirAt(5, 0)).toBe(5);
    expect(field.dirAt(15, 0)).toBe(1);
    expect(field.costAt(5, 0)).toBe(5 * STEP_ORTHO);
    expect(field.costAt(15, 0)).toBe(4 * STEP_ORTHO);
  });

  it('tells "arrived" apart from "no route" through costAt', () => {
    const field = new FlowField(0, 0, 6, 6);
    field.addGoal(3, 3);
    field.build(open);
    expect(field.dirAt(3, 3)).toBe(0);
    expect(field.costAt(3, 3)).toBe(0);
    expect(field.dirAt(99, 99)).toBe(0);
    expect(field.costAt(99, 99)).toBe(-1);
    expect(field.step(99, 99, gp())).toBe(false);
  });

  it('leaves out untouched when there is no route', () => {
    const field = new FlowField(0, 0, 4, 4);
    field.build(open);
    const out = gp();
    expect(field.step(1, 1, out)).toBe(false);
    expect(out).toEqual({ gx: 0, gy: 0 });
  });

  it('is the connectivity oracle: a wall makes the far side unreachable', () => {
    const grid = new TileGrid(9, 9, { fill: 1 });
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const field = new FlowField(0, 0, 9, 9);
    field.addGoal(0, 0);
    field.build(cost, undefined, grid.version);
    expect(field.costAt(8, 8)).toBeGreaterThan(0);
    for (let i = 0; i < 9; i++) grid.set(4, i, 0);
    field.build(cost, undefined, grid.version);
    // "Have I just walled my walkers in?" is one comparison after the wall is placed.
    expect(field.dirAt(8, 8)).toBe(0);
    expect(field.costAt(8, 8)).toBe(-1);
  });

  it('ignores goals off the edge rather than refusing to build', () => {
    // A warehouse can legitimately sit off the edge of the field, and refusing to build
    // because of one would take the whole crowd down with it.
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(100, 100);
    field.addGoal(2, 2);
    field.build(open);
    expect(field.costAt(0, 0)).toBeGreaterThan(0);
  });

  it('clears goals, and a field with none reaches nothing', () => {
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(0, 0);
    field.build(open);
    expect(field.costAt(4, 4)).toBeGreaterThan(0);
    field.clearGoals();
    field.build(open);
    expect(field.costAt(4, 4)).toBe(-1);
  });

  it('grows its goal list past the initial capacity', () => {
    const field = new FlowField(0, 0, 8, 8);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) field.addGoal(i, j);
    field.build(open);
    expect(field.costAt(0, 0)).toBe(0);
    expect(field.costAt(7, 7)).toBeGreaterThan(0);
  });

  it('tolerates the same goal added twice', () => {
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(1, 1);
    field.addGoal(1, 1);
    field.build(open);
    expect(field.costAt(1, 1)).toBe(0);
  });

  it('reports itself stale until it is told a version', () => {
    const grid = new TileGrid(6, 6, { fill: 1 });
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const field = new FlowField(0, 0, 6, 6);
    field.addGoal(0, 0);
    expect(field.builtAtVersion).toBe(-1);
    field.build(cost);
    // Failing towards a spare Dijkstra sweep is the right direction to fail; the other way
    // round, the crowd walks the old road for ever.
    expect(field.builtAtVersion).not.toBe(grid.version);
    field.build(cost, undefined, grid.version);
    expect(field.builtAtVersion).toBe(grid.version);
    grid.set(3, 3, 0);
    expect(field.builtAtVersion).not.toBe(grid.version);
  });

  it('is the rockfall beat, in three lines', () => {
    const grid = new TileGrid(12, 12, { fill: 1 });
    for (let gy = 0; gy < 12; gy++) grid.set(6, gy, 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const field = new FlowField(0, 0, 12, 12);
    field.addGoal(11, 11);
    field.build(cost, undefined, grid.version);
    expect(field.costAt(0, 0)).toBe(-1);
    grid.set(6, 6, 1);
    if (field.builtAtVersion !== grid.version) field.build(cost, undefined, grid.version);
    expect(field.costAt(0, 0)).toBeGreaterThan(0);
  });

  it('respects diagonals and cutCorners', () => {
    const straight = new FlowField(0, 0, 6, 6);
    straight.addGoal(0, 0);
    straight.build(open, { diagonals: false });
    // Without diagonals a corner tile costs the Manhattan sum rather than the octile one.
    expect(straight.costAt(3, 3)).toBe(6 * STEP_ORTHO);
    const grid = new TileGrid(5, 5, { fill: 1 });
    grid.set(2, 1, 0);
    grid.set(1, 2, 0);
    const cost: TileCost = (gx, gy) => grid.get(gx, gy);
    const blocked = new FlowField(0, 0, 5, 5);
    blocked.addGoal(2, 2);
    blocked.build(cost);
    const cutting = new FlowField(0, 0, 5, 5);
    cutting.addGoal(2, 2);
    cutting.build(cost, { cutCorners: true });
    expect(cutting.costAt(1, 1)).toBeLessThan(blocked.costAt(1, 1));
  });

  it('names a float weight, like the searcher does', () => {
    const field = new FlowField(0, 0, 4, 4);
    field.addGoal(0, 0);
    expect(() => field.build(() => 2.5)).toThrow(/an integer weight from the cost function/);
  });

  it('gives no direction to a tile a walker could not be standing on', () => {
    const cost: TileCost = (gx, gy) => (gx === 2 ? 0 : 1);
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(0, 0);
    field.build(cost);
    expect(field.dirAt(2, 2)).toBe(0);
    expect(field.costAt(2, 2)).toBe(-1);
  });

  it('gives a goal on impassable ground a cost of zero and no route out of it', () => {
    // A depot that was just buried by a rockfall. The sweep must not spread from it — nothing
    // can enter it — but it is still where it was, so it keeps its own zero.
    const cost: TileCost = (gx, gy) => (gx === 2 && gy === 2 ? 0 : 1);
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(2, 2);
    field.build(cost);
    expect(field.costAt(2, 2)).toBe(0);
    expect(field.costAt(0, 0)).toBe(-1);
  });

  it('rejects a fractional address, which is a world pixel that forgot to be converted', () => {
    const field = new FlowField(0, 0, 5, 5);
    field.addGoal(0, 0);
    field.build(open);
    expect(field.costAt(1.5, 1)).toBe(-1);
    expect(field.dirAt(1.5, 1)).toBe(0);
  });
});

/** Read a source file, for the one test that asserts about the code rather than its
 *  behaviour. Determinism claims about what a module does *not* call cannot be made any other
 *  way: no input makes a `Math.atan2` visible in a return value. */
function readSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), 'utf8');
}
