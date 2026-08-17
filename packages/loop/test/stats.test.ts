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
      worstGapMs: 0,
      cadenceMs: 0,
      absences: 0,
      warmingUp: true,
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
      worstGapMs: 0,
      cadenceMs: 0,
      absences: 0,
      warmingUp: true,
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

// ── the gap, which is the figure the pump figures cannot see ─────────────────────────────────
//
// Everything below is one argument: a pause that lands *between* two pumps is invisible to a
// measurement bounded by one pump's two clock readings, and the gallery gated itself on exactly
// that measurement. The first test in the block is the one that would have failed against the
// build this was written for.

/** A loop with no warm-up filter, which is what a test that asserts on the first gap wants. */
function gapped(options: { windowMs?: number; absenceMs?: number } = {}): {
  clock: ReturnType<typeof manualClock>;
  frames: ReturnType<typeof manualFrames>;
  loop: Loop;
} {
  const clock = manualClock();
  const frames = manualFrames();
  const loop = createLoop({ clock, frames, warmupFrames: 0, ...options });
  return { clock, frames, loop };
}

describe('a pause between pumps', () => {
  it('appears in worstGapMs and does not appear in the pump figures', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('paint');

    // The pause. No pump is open, nothing the loop invoked is running, and the clock moves 90 ms
    // — a collection, a style recalculation, another tab. This is the failure `crowd` measured as
    // 23.1 ms on one machine and 13.1 ms on another for one build: whether it lands inside a pump
    // is the machine's business, and a readout that only sees inside a pump is not a readout.
    clock.advance(90);
    frames.pump('paint');

    expect(loop.stats.worstGapMs).toBe(90);
    // The pump itself did nothing and cost nothing, and every pump-time figure says so. Delete
    // the gap instrument and this test still passes on these two lines, which is precisely the
    // green light the gallery was reading.
    expect(loop.stats.worstFrameMs).toBe(0);
    expect(loop.stats.frameMs).toBe(0);
    expect(loop.stats.overBudget).toBe(0);
  });

  it('contains the pump that preceded it, so the gap is never the smaller number', () => {
    const clock = manualClock();
    const frames = manualFrames();
    let renderCost = 0;
    const loop = createLoop({ clock, frames, warmupFrames: 0, render: () => clock.advance(renderCost) });
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('paint');

    renderCost = 30;
    clock.advance(16);
    frames.pump('paint');
    expect(loop.stats.worstFrameMs).toBe(30);

    renderCost = 0;
    clock.advance(16);
    frames.pump('paint');
    // 30 ms of work plus 16 ms of waiting: the gap is a superset of the pump, always.
    expect(loop.stats.worstGapMs).toBe(46);
  });

  it('is paint to paint, so a hidden tab’s tick pumps do not split one', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('tick');
    clock.advance(16);
    frames.pump('paint');
    // What a player feels is the interval between two *pictures*. A pump that painted nothing did
    // not end a frame, and counting it would report 16 for a scene that showed one frame in 32.
    expect(loop.stats.worstGapMs).toBe(32);
  });

  it('reports the display period as cadenceMs, so a worst gap is legible across machines', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    for (const gap of [8, 8, 25, 8]) {
      clock.advance(gap);
      frames.pump('paint');
    }
    // 25 against a cadence of 8 is two dropped frames on a 120 Hz panel and would read as a
    // healthy 60 Hz frame to anything comparing it against 16.7.
    expect(loop.stats.worstGapMs).toBe(25);
    expect(loop.stats.cadenceMs).toBe(8);
  });

  it('is zero until a gap exists, rather than flattering', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(0);
    expect(loop.stats.cadenceMs).toBe(0);
    clock.advance(16);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(16);
  });

  it('ignores a clock that did not move between two paints', () => {
    const { frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    frames.pump('paint');
    // A zero gap is not a cadence of zero; recording one would make every ratio meaningless.
    expect(loop.stats.cadenceMs).toBe(0);
    expect(loop.stats.worstGapMs).toBe(0);
  });
});

describe('the rolling window', () => {
  it('forgets a spike once the window has passed, with no resetStats() anywhere', () => {
    const { clock, frames, loop } = gapped({ windowMs: 1000 });
    loop.start();
    frames.pump('paint');
    clock.advance(90);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(90);

    for (let i = 0; i < 60; i += 1) {
      clock.advance(20);
      frames.pump('paint');
    }
    // Twelve hundred milliseconds of twenty. `worstFrameMs` would still be reporting the spike,
    // and five exhibits called resetStats() on a timer to get this — which zeroes `fps` and
    // `frameMs` for every other reader of the same object.
    expect(loop.stats.worstGapMs).toBe(20);
    expect(loop.stats.fps).toBeGreaterThan(0);
  });

  it('keeps a spike for at least nine tenths of the window', () => {
    const { clock, frames, loop } = gapped({ windowMs: 1000 });
    loop.start();
    frames.pump('paint');
    clock.advance(90);
    frames.pump('paint');
    for (let i = 0; i < 44; i += 1) {
      clock.advance(20);
      frames.pump('paint');
    }
    // 970 ms after the spike: a bucket is retired whole, so the figure covers between 0.9 and 1.0
    // of the window. That imprecision is documented rather than hidden.
    expect(loop.stats.worstGapMs).toBe(90);
  });

  it('empties in one step when a gap swallows the whole window', () => {
    const { clock, frames, loop } = gapped({ windowMs: 1000 });
    loop.start();
    frames.pump('paint');
    clock.advance(20);
    frames.pump('paint');
    // An hour hidden. Retiring a bucket at a time here would spin thirty-six thousand times
    // inside the first pump back; past a whole window there is nothing left to retire separately.
    clock.advance(3_600_000);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(0);
  });
});

describe('an absence is not a slow frame', () => {
  it('excludes it, counts it, and recovers on the very next paint', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('paint');

    // The tab goes away for twenty seconds. `resonance` measured exactly this and read 20,063 ms.
    clock.advance(20_063);
    frames.pump('paint');
    expect(loop.stats.absences).toBe(1);
    // The window it spanned is genuinely empty, so zero is the truthful reading for one frame —
    // and it is only one frame, because the absence re-bases the next gap rather than being kept
    // as `lastPaint`. A readout stuck at 0.0 until the next window is the bug `island` reported.
    expect(loop.stats.worstGapMs).toBe(0);

    clock.advance(16);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(16);
    expect(loop.stats.cadenceMs).toBe(16);
    expect(loop.stats.absences).toBe(1);
  });

  it('draws the line at absenceMs, so a quarter-second hitch is still a frame', () => {
    const { clock, frames, loop } = gapped({ absenceMs: 1000 });
    loop.start();
    frames.pump('paint');
    clock.advance(250);
    frames.pump('paint');
    // Two exhibits hand-rolled this ceiling at 250 ms, which discards a catastrophic frame along
    // with the tab switch. A quarter of a second is the most interesting number a HUD can show.
    expect(loop.stats.worstGapMs).toBe(250);
    expect(loop.stats.absences).toBe(0);
  });

  it('does not spend a warm-up frame on one', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames, warmupFrames: 1 });
    loop.start();
    frames.pump('paint');
    clock.advance(5000);
    frames.pump('paint');
    expect(loop.stats.warmingUp).toBe(true);
    clock.advance(40);
    frames.pump('paint');
    expect(loop.stats.warmingUp).toBe(false);
    clock.advance(12);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(12);
  });
});

describe('the warm-up window', () => {
  it('discards the opening frames and says so while it is doing it', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    expect(loop.warmupFrames).toBe(10);
    expect(loop.stats.warmingUp).toBe(true);
    loop.start();
    frames.pump('paint');
    for (let i = 0; i < 10; i += 1) {
      clock.advance(50);
      frames.pump('paint');
    }
    // Ten fifty-millisecond frames of page load, and the gate reads nothing rather than reading
    // the load. `warmingUp` is what stops that being a silent choice.
    expect(loop.stats.worstGapMs).toBe(0);
    expect(loop.stats.warmingUp).toBe(false);

    clock.advance(20);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(20);
  });

  it('measures the page load when asked to', () => {
    const { clock, frames, loop } = gapped();
    expect(loop.warmupFrames).toBe(0);
    expect(loop.stats.warmingUp).toBe(false);
    loop.start();
    frames.pump('paint');
    clock.advance(50);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(50);
  });
});

describe('the window across start, stop and reset', () => {
  it('does not count the time a stopped loop spent stopped', () => {
    const { clock, frames, loop } = gapped();
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('paint');
    loop.stop();
    clock.advance(9000);
    loop.start();
    frames.pump('paint');
    clock.advance(16);
    frames.pump('paint');
    // A loop stopped for a scene transition comes back owing nothing — the same promise `start()`
    // already makes about the wait before the first pump. Nine seconds is not a frame and is not
    // an absence either, because nothing was running to be absent from.
    expect(loop.stats.worstGapMs).toBe(16);
    expect(loop.stats.absences).toBe(0);
  });

  it('resetStats empties the window and re-arms the warm-up', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames, warmupFrames: 2 });
    loop.start();
    frames.pump('paint');
    for (let i = 0; i < 4; i += 1) {
      clock.advance(30);
      frames.pump('paint');
    }
    expect(loop.stats.worstGapMs).toBe(30);

    loop.resetStats();
    expect(loop.stats.worstGapMs).toBe(0);
    expect(loop.stats.cadenceMs).toBe(0);
    expect(loop.stats.warmingUp).toBe(true);
    clock.advance(30);
    frames.pump('paint');
    clock.advance(30);
    frames.pump('paint');
    clock.advance(30);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(0);
    clock.advance(12);
    frames.pump('paint');
    expect(loop.stats.worstGapMs).toBe(12);
  });
});

describe('the options behind the window are readable back', () => {
  it('reads back every measurement option, defaulted or given', () => {
    const defaults = createLoop({ clock: manualClock(), frames: manualFrames() });
    expect(defaults.hz).toBe(60);
    expect(defaults.maxCatchUpMs).toBe(250);
    expect(defaults.budgetMs).toBe(8);
    expect(defaults.windowMs).toBe(10_000);
    expect(defaults.warmupFrames).toBe(10);
    expect(defaults.absenceMs).toBe(1000);

    const given = createLoop({
      clock: manualClock(),
      frames: manualFrames(),
      hz: 30,
      maxCatchUpMs: 100,
      budgetMs: 4,
      windowMs: 5000,
      warmupFrames: 3,
      absenceMs: 400,
    });
    // Non-negotiable 11: a value a caller supplied and cannot read back is a value they must
    // store twice. A HUD quoting `worstGapMs` is quoting a filtered number and the size of the
    // filter is exactly the thing a reader is entitled to check.
    expect(given.hz).toBe(30);
    expect(given.maxCatchUpMs).toBe(100);
    expect(given.budgetMs).toBe(4);
    expect(given.windowMs).toBe(5000);
    expect(given.warmupFrames).toBe(3);
    expect(given.absenceMs).toBe(400);
  });

  it('refuses a window, a warm-up or an absence that would silence the figure', () => {
    const clock = manualClock();
    const frames = manualFrames();
    expect(() => createLoop({ clock, frames, windowMs: 0 })).toThrow(/createLoop\.windowMs/);
    expect(() => createLoop({ clock, frames, warmupFrames: -1 })).toThrow(/createLoop\.warmupFrames/);
    expect(() => createLoop({ clock, frames, warmupFrames: 1.5 })).toThrow(/createLoop\.warmupFrames/);
    expect(() => createLoop({ clock, frames, absenceMs: 0 })).toThrow(/createLoop\.absenceMs/);
    // Non-negotiable 9: the message names the option and says what breaks.
    expect(() => createLoop({ clock, frames, absenceMs: -1 })).toThrow(/every interval is an absence/);
  });
});
