/**
 * `stats` — the frame budget, measured, and every number here is exact.
 *
 * Two things make that possible. The clock is injected, so "this update cost 8 ms" is written
 * as `clock.advance(8)` inside the update and is true by construction rather than by timing.
 * And the smoothing weight is 1/8 — a negative power of two, exact in binary — so an EMA of 8
 * then 16 is 9, not 9.000000000000002. There is no `toBeCloseTo` in this file and there does
 * not need to be one.
 *
 * The loop below is deliberately built with `hz: 100, maxCatchUpMs: 10`, which makes the
 * ceiling exactly one step: every pump that has 10 ms of elapsed time runs exactly one step and
 * leaves an empty accumulator, so a cost sample is one update's cost and not fourteen.
 */

import { describe, expect, it } from 'vitest';
import { manualClock } from '../src/clock.js';
import { manualFrames } from '../src/frames.js';
import { createLoop, type Loop } from '../src/loop.js';

const STEP_MS = 10;

/** A loop whose update and render cost exactly what the test says they cost. */
function costed(): {
  clock: ReturnType<typeof manualClock>;
  frames: ReturnType<typeof manualFrames>;
  loop: Loop;
  setCost(update: number, render: number): void;
} {
  const clock = manualClock();
  const frames = manualFrames();
  let updateCost = 0;
  let renderCost = 0;
  const loop = createLoop({
    clock,
    frames,
    hz: 100,
    maxCatchUpMs: STEP_MS,
    update: () => clock.advance(updateCost),
    render: () => clock.advance(renderCost),
  });
  return {
    clock,
    frames,
    loop,
    setCost(update, render) {
      updateCost = update;
      renderCost = render;
    },
  };
}

describe('identity', () => {
  it('I-15: loop.stats is the same object on every read', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    const first = loop.stats;
    loop.start();
    for (let i = 0; i < 100; i += 1) {
      clock.advance(16);
      frames.pump();
    }
    expect(loop.stats).toBe(first);
    expect(loop.stats).toBe(loop.stats);
  });

  it('is a live view, which is exactly the trap the doc comment shouts about', () => {
    // `const before = loop.stats` then comparing to `loop.stats` later compares an object with
    // itself and finds no difference, ever. Copy the number, not the object.
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    const held = loop.stats;
    const copied = held.pumps;
    clock.advance(16);
    frames.pump();
    expect(held.pumps).toBe(1);
    expect(copied).toBe(0);
  });

  it('starts at zero on every field', () => {
    const loop = createLoop({ clock: manualClock(), frames: manualFrames() });
    expect(loop.stats).toEqual({
      fps: 0,
      frameMs: 0,
      updateMs: 0,
      renderMs: 0,
      worstFrameMs: 0,
      overBudget: 0,
      stepsLastPump: 0,
      ticks: 0,
      renders: 0,
      pumps: 0,
      droppedSeconds: 0,
    });
  });
});

describe('the smoothed costs', () => {
  it('takes the first sample whole, so the reading is never dragged up out of zero', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 0);
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.updateMs).toBe(8);
    expect(loop.stats.frameMs).toBe(8);
  });

  it('smooths by exactly one eighth thereafter', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 0);
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    setCost(16, 0);
    clock.advance(STEP_MS);
    frames.pump('paint');
    // 8 + (16 - 8) / 8 = 9, exactly, because 1/8 is exact in binary.
    expect(loop.stats.updateMs).toBe(9);
    clock.advance(STEP_MS);
    frames.pump('paint');
    // 9 + (16 - 9) / 8 = 9.875, also exact.
    expect(loop.stats.updateMs).toBe(9.875);
  });

  it('attributes update and render separately, and frameMs to the whole pump', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 4);
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.updateMs).toBe(8);
    expect(loop.stats.renderMs).toBe(4);
    expect(loop.stats.frameMs).toBe(12);
  });

  it('leaves renderMs alone on a pump that did not paint', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 4);
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.renderMs).toBe(4);
    setCost(8, 100);
    clock.advance(STEP_MS);
    frames.pump('tick');
    expect(loop.stats.renderMs).toBe(4);
    expect(loop.stats.renders).toBe(1);
  });

  it('keeps the worst frame, because averages hide exactly the frame players feel', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(2, 0);
    loop.start();
    for (let i = 0; i < 20; i += 1) {
      clock.advance(STEP_MS);
      frames.pump('paint');
    }
    setCost(90, 0);
    clock.advance(STEP_MS);
    frames.pump('paint');
    setCost(2, 0);
    for (let i = 0; i < 20; i += 1) {
      clock.advance(STEP_MS);
      frames.pump('paint');
    }
    expect(loop.stats.worstFrameMs).toBe(90);
    // And the smoothed number has already forgotten it, which is the point of keeping both:
    // the hitch pushed the EMA to 2 + (90 - 2)/8 = 13, and twenty more 2 ms frames decay that
    // by (7/8)^20 ≈ 0.0693 back towards 2, landing at about 2.76.
    expect(loop.stats.frameMs).toBeLessThan(3);
    expect(loop.stats.frameMs).toBeGreaterThan(2.7);
  });

  it('counts pumps over the budget, and only those', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 0); // exactly the default budget, which is not *over* it
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.overBudget).toBe(0);
    setCost(8.001, 0);
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.overBudget).toBe(1);
  });

  it('honors a custom budget', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames, budgetMs: 2, update: () => clock.advance(3) });
    loop.start();
    clock.advance(20);
    frames.pump('paint');
    expect(loop.stats.overBudget).toBe(1);
  });
});

describe('the counters', () => {
  it('counts pumps of both kinds, renders of one, and ticks', () => {
    const { clock, frames, loop } = costed();
    loop.start();
    for (let i = 0; i < 10; i += 1) {
      clock.advance(STEP_MS);
      frames.pump(i % 2 === 0 ? 'paint' : 'tick');
    }
    expect(loop.stats.pumps).toBe(10);
    expect(loop.stats.renders).toBe(5);
    expect(loop.stats.ticks).toBe(10);
    expect(loop.stats.ticks).toBe(loop.tick);
  });

  it('reports the steps in the most recent pump — the tell for a game that cannot keep up', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    clock.advance(16);
    frames.pump();
    expect(loop.stats.stepsLastPump).toBe(0); // 16,000 µs is less than one 16,667 µs step
    clock.advance(16);
    frames.pump();
    expect(loop.stats.stepsLastPump).toBe(1); // 32,000 µs is one step, with 15,333 left
    clock.advance(3_600_000);
    frames.pump();
    expect(loop.stats.stepsLastPump).toBe(14); // the clamp: floor(250,000 / 16,667)
    clock.advance(16);
    frames.pump();
    expect(loop.stats.stepsLastPump).toBe(1);
  });

  it('counts dropped seconds cumulatively, as diagnostics and nothing else', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    for (let i = 0; i < 3; i += 1) {
      clock.advance(1000);
      frames.pump();
    }
    // Pump 1: 1,000,000 µs in, clamped to 250,000, so 750,000 dropped; 14 steps leave 16,662.
    // Pumps 2 and 3: 16,662 + 1,000,000 clamped to 250,000, so 766,662 dropped each.
    // 750,000 + 766,662 + 766,662 = 2,283,324 µs, and each term is exact in binary.
    expect(loop.stats.droppedSeconds).toBe((750_000 + 766_662 + 766_662) / 1e6);
  });
});

describe('fps', () => {
  it('is zero until a full second of real time has passed', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    for (let i = 0; i < 9; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    expect(loop.stats.fps).toBe(0);
  });

  it('counts paints over the window, exactly', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    for (let i = 0; i < 10; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    // Ten paints in exactly 1,000 ms.
    expect(loop.stats.fps).toBe(10);
  });

  it('does not count tick pumps as paints — the hidden tab is not running at 60', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    for (let i = 0; i < 10; i += 1) {
      clock.advance(100);
      frames.pump('tick');
    }
    expect(loop.stats.fps).toBe(0);
    expect(loop.stats.pumps).toBe(10);
  });

  it('starts its window at start(), not at the clock’s arbitrary origin', () => {
    const clock = manualClock(500_000);
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    clock.advance(100);
    frames.pump('paint');
    expect(loop.stats.fps).toBe(0);
    for (let i = 0; i < 9; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    expect(loop.stats.fps).toBe(10);
  });
});

describe('resetStats', () => {
  it('zeroes every counter, including the totals', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(8, 4);
    loop.start();
    clock.advance(3_600_000);
    frames.pump('paint');
    for (let i = 0; i < 20; i += 1) {
      clock.advance(STEP_MS);
      frames.pump('paint');
    }
    expect(loop.stats.pumps).toBeGreaterThan(0);
    loop.resetStats();
    expect(loop.stats).toEqual({
      fps: 0,
      frameMs: 0,
      updateMs: 0,
      renderMs: 0,
      worstFrameMs: 0,
      overBudget: 0,
      stepsLastPump: 0,
      ticks: 0,
      renders: 0,
      pumps: 0,
      droppedSeconds: 0,
    });
  });

  it('does not touch tick or time, which are not counters', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    clock.advance(1000);
    frames.pump();
    const tick = loop.tick;
    loop.resetStats();
    expect(loop.tick).toBe(tick);
    expect(loop.time).toBe(tick * loop.stepSeconds);
  });

  it('reseeds the smoothing window, so the next sample is taken whole again', () => {
    const { clock, frames, loop, setCost } = costed();
    setCost(90, 0);
    loop.start();
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.frameMs).toBe(90);
    loop.resetStats();
    setCost(2, 0);
    clock.advance(STEP_MS);
    frames.pump('paint');
    expect(loop.stats.frameMs).toBe(2);
    expect(loop.stats.renderMs).toBe(0);
  });

  it('restarts the fps window from the reset, not from start()', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    for (let i = 0; i < 5; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    loop.resetStats();
    for (let i = 0; i < 4; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    expect(loop.stats.fps).toBe(0);
    for (let i = 0; i < 6; i += 1) {
      clock.advance(100);
      frames.pump('paint');
    }
    expect(loop.stats.fps).toBe(10);
  });
});
