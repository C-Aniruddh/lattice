/**
 * The per-frame paths.
 *
 * Three of them run every frame of every session: `submit` (once per browser event, and a
 * 120 Hz pointer with coalesced moves is several per frame), `tick` (once per fixed step, with
 * the whole bucket in it), and `frame` (once per paint). Everything else in this package runs
 * at setup.
 *
 * The workloads are sized from a real frame rather than from what benchmarks nicely: a drag on
 * a 120 Hz pointer is roughly two to eight moves per frame, and the 1,000-move row is the stall
 * case — a tick that arrives after the browser has queued a second of input.
 */

import { bench, describe } from 'vitest';
import { TileGrid, createCamera } from '@latticekit/iso';
import type { GridPoint, HeightField } from '@latticekit/iso';
import { createHeadlessInput } from '../src/system.js';
import type { InputSystem } from '../src/system.js';
import type { RawSample } from '../src/sample.js';
import { fixedStep } from '../src/step.js';
import type { TerrainOption } from '../src/terrain.js';

const STEP = fixedStep(60);

/**
 * A hill worth marching: 128 × 128 tiles rising to 24 units of 8 px, which is 192 px of terrain
 * and the depth the ceiling has to scan on every pick that starts above a peak.
 */
const HILL: HeightField = {
  heights: (() => {
    const grid = new TileGrid(128, 128, { originGx: -64, originGy: -64, bits: 16 });
    grid.fillFrom((gx, gy) => 12 + ((gx + 64) % 13) + ((gy + 64) % 12));
    return grid;
  })(),
  stepPx: 8,
};

/** A system with a handler on everything, because an unobserved gesture is not the real path. */
function system(terrain: TerrainOption = 'flat'): InputSystem<'collect'> {
  const input = createHeadlessInput<'collect'>({
    camera: createCamera(1280, 720),
    step: STEP,
    actions: { collect: ['tap', 'key:Space'] },
    terrain,
    // The stall benchmark deliberately overflows the buffer, which is exactly the condition the
    // diagnostic exists to report. Swallowing it here keeps the measurement out of stderr.
    onDiagnostic: (): void => undefined,
  });
  let sink = 0;
  input.on('drag', (g) => {
    sink += g.gx;
  });
  input.on('tap', (g) => {
    sink += g.gy;
  });
  input.onAction('collect', (a) => {
    sink += a.gx;
  });
  void sink;
  return input;
}

/**
 * A reused sample object, exactly as the DOM adapter uses one.
 *
 * `submit` copies, so a producer never allocates. If this benchmark allocated a fresh object
 * per call it would be measuring the garbage collector rather than the buffer.
 */
const moveSample: RawSample = { kind: 'move', id: 1, sx: 0, sy: 0 };

describe('the per-frame paths', () => {
  const buffered = system();
  buffered.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  let at = 0;

  bench('submit — one pointermove into the open bucket', () => {
    at = (at + 7) % 1024;
    buffered.submit(moveSample);
  });

  const eight = system();
  eight.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  let tick8 = 0;
  bench('tick — a realistic frame: 8 coalesced moves delivered as drags', () => {
    for (let i = 0; i < 8; i++) eight.submit(moveSample);
    eight.tick(tick8);
    tick8 += 1;
  });

  const stalled = system();
  stalled.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  let tick1k = 0;
  bench('tick — the stall case: 1,000 moves in one bucket', () => {
    for (let i = 0; i < 1000; i++) stalled.submit(moveSample);
    stalled.tick(tick1k);
    tick1k += 1;
  });

  const idle = system();
  let idleTick = 0;
  bench('tick — an empty bucket, which is most ticks', () => {
    idle.tick(idleTick);
    idleTick += 1;
  });

  const glide = system();
  glide.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  glide.tick(0);
  glide.submit({ kind: 'move', id: 1, sx: 740, sy: 360 });
  glide.tick(1);
  glide.submit({ kind: 'up', id: 1, sx: 840, sy: 360 });
  glide.tick(2);
  let now = 0;
  bench('frame — integrating a glide', () => {
    now += STEP.stepMs;
    glide.frame(now);
  });

  const hovering = system();
  hovering.submit({ kind: 'move', id: 1, sx: 640, sy: 360 });
  const tile: GridPoint = { gx: 0, gy: 0 };
  bench('hoverTile — the query a placement ghost makes every frame', () => {
    hovering.hoverTile(tile);
  });
});

/**
 * What the ground costs.
 *
 * The march is `iso`'s and is not free — a ceiling of 192 px is twelve steps down the lattice
 * and twelve bisections, each a bilinear sample — so the two rows that matter are the two a game
 * actually pays: one pick per delivered event, and one per hover query. Both are per *event*,
 * never per entity: the tile is resolved on first read and cached until the event is re-aimed,
 * so a bucket of eight moves marches at most eight times however many handlers read `gx`.
 */
describe('the ground', () => {
  const marching = { field: HILL, maxHeightPx: 24 * 8 } as const;

  const flatEight = system();
  flatEight.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  let flatTick = 0;
  bench('tick — 8 moves, flat ground', () => {
    for (let i = 0; i < 8; i++) flatEight.submit(moveSample);
    flatEight.tick(flatTick);
    flatTick += 1;
  });

  const hillEight = system(marching);
  hillEight.submit({ kind: 'down', id: 1, sx: 640, sy: 360, pointerType: 'touch' });
  let hillTick = 0;
  bench('tick — 8 moves, marched down a 192 px hill', () => {
    for (let i = 0; i < 8; i++) hillEight.submit(moveSample);
    hillEight.tick(hillTick);
    hillTick += 1;
  });

  const hillHover = system(marching);
  hillHover.submit({ kind: 'move', id: 1, sx: 640, sy: 360 });
  const hillTile: GridPoint = { gx: 0, gy: 0 };
  bench('hoverTile — on terrain', () => {
    hillHover.hoverTile(hillTile);
  });
});
