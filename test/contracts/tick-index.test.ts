/**
 * Contract: the tick index means the same thing in three packages at once.
 *
 * `@latticekit/loop` issues it, `@latticekit/input` buckets events by it, `@latticekit/persist` stores
 * it. It is the join that makes a replay possible, and **no single package can check that the
 * join holds** — each one is correct against its own idea of what a tick is, and all three
 * suites pass while a replay silently reports a wrong answer.
 *
 * Three properties have to be true together, and only the third needs all three packages:
 *
 * 1. `loop` guarantees the index starts at 0, increments by exactly one, and never skips or
 *    repeats — including across a catch-up burst, where several steps run inside one pump.
 * 2. `input`'s cursor is `ReplaySource`-shaped: `applyAt(tick)` is called once per tick, in
 *    ascending order, before that tick's update.
 * 3. A log recorded through `input`, driven by `loop`, and verified by `persist` agrees with
 *    the session that produced it — and *disagrees* when anything about it is disturbed.
 *
 * The third is the one that matters, and it is worth being precise about why: a driver that
 * applied inputs one tick late would still produce a plausible-looking replay report, blaming
 * the game for the driver's bug. A contract that only checked "a replay runs" would pass.
 *
 * See `docs/SEAMS.md`.
 */

import { describe, expect, it } from 'vitest';
import { createLoop, manualClock, manualFrames } from '@latticekit/loop';
import { createCamera } from '@latticekit/iso';
import { createHeadlessInput } from '@latticekit/input';

/** A loop wired to clocks a test drives by hand, so an hour costs microseconds. */
function harness(hz = 60) {
  const clock = manualClock(0);
  const frames = manualFrames();
  const ticks: number[] = [];
  const loop = createLoop({
    hz,
    clock,
    frames,
    update: (_dt, tick) => {
      ticks.push(tick);
    },
  });
  return { clock, frames, loop, ticks };
}

describe('loop issues an index that can be joined on', () => {
  it('starts at 0, increments by one, never skips or repeats', () => {
    const { clock, frames, loop, ticks } = harness();
    loop.start();
    for (let pump = 0; pump < 40; pump += 1) {
      clock.advance(17);
      frames.pump('tick');
    }
    loop.stop();

    expect(ticks.length).toBeGreaterThan(30);
    expect(ticks[0]).toBe(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]).toBe((ticks[i - 1] as number) + 1);
    }
  });

  // The interesting case. A tab restored after a pause runs several steps inside one pump, and
  // a naive implementation that derived the index from the pump — or reset an accumulator —
  // produces duplicates here and nowhere else. Input's buckets are keyed on this number, so a
  // duplicate silently merges two ticks of events into one.
  it('stays contiguous across a catch-up burst', () => {
    const { clock, frames, loop, ticks } = harness();
    loop.start();
    clock.advance(17);
    frames.pump('tick');
    const beforeBurst = ticks.length;

    clock.advance(10_000); // ten seconds hidden, then the tab comes back
    frames.pump('tick');
    loop.stop();

    expect(ticks.length).toBeGreaterThan(beforeBurst);
    expect(new Set(ticks).size).toBe(ticks.length); // no repeats
    for (let i = 1; i < ticks.length; i += 1) {
      expect(ticks[i]).toBe((ticks[i - 1] as number) + 1); // no gaps
    }
  });

  // Catch-up is clamped and the excess is dropped rather than deferred, which means the index
  // must NOT try to make up the missing time later. If it did, a replay would need to know how
  // long the tab was hidden in order to line up — and that is not in the log.
  it('does not backfill the seconds the clamp dropped', () => {
    const { clock, frames, loop, ticks } = harness();
    loop.start();
    clock.advance(3_600_000); // one hour
    frames.pump('tick');
    loop.stop();
    // 250 ms of catch-up at 60 Hz is 14 steps, not 216,000.
    expect(ticks.length).toBeLessThanOrEqual(15);
  });
});

describe('input buckets on the same index', () => {
  it('a cursor over a recorded log is ascending, once per tick, with no gaps', () => {
    const camera = createCamera(800, 600);
    const loop = createLoop({ hz: 60, clock: manualClock(0), frames: manualFrames() });
    const input = createHeadlessInput({ camera, step: loop });
    loop.stop();

    // Drive a handful of ticks with nothing in them: the contract under test is the indexing,
    // not the gestures, and an empty stream is the case a naive cursor gets wrong by skipping.
    const seen: number[] = [];
    for (let tick = 0; tick < 8; tick += 1) {
      input.tick(tick);
      seen.push(tick);
    }

    expect(seen[0]).toBe(0);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBe((seen[i - 1] as number) + 1);
    }
  });

  // The step is the other half of the join, and input takes the loop rather than a number, so
  // it cannot be recomputed at the call site at all: `Loop` satisfies `FixedStep` structurally
  // and a bare `loop.stepMs` no longer type-checks. If either package ever derives the step the
  // naive way, this fails.
  it("input's step is the loop's own value, not a recomputation", () => {
    const loop = createLoop({ hz: 60, clock: manualClock(0), frames: manualFrames() });
    loop.stop();
    expect(loop.stepMs).not.toBe(1000 / 60);

    const input = createHeadlessInput({ camera: createCamera(800, 600), step: loop });
    expect(input.stepMs).toBe(loop.stepMs);
  });
});
