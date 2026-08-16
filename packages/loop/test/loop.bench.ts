/**
 * The per-frame paths, measured.
 *
 * Everything here is driven by a manual clock, so the numbers are the cost of *this package's*
 * bookkeeping and nothing else — no rAF jitter, no host clock resolution, no renderer. The
 * frame budget in `kit.json` is 8 ms; the loop's own share of it should be invisible against
 * that, and these benchmarks are what says whether it still is.
 *
 * The one worth watching over time is `pump: idle`. It is the cost a game pays on every pump
 * for having a loop at all, including the `'tick'` pumps a hidden tab produces, and it must
 * stay in the tens of nanoseconds or the "extra tick pumps cost one clock read and an empty
 * accumulator check" claim in `frames.ts` stops being true.
 */

import { bench, describe } from 'vitest';
import { manualClock } from '../src/clock.js';
import { manualFrames } from '../src/frames.js';
import { createLoop } from '../src/loop.js';
import { createTimeline } from '../src/scheduler.js';
import { createTweens } from '../src/tween.js';
import { replay } from '../src/replay.js';

describe('pump', () => {
  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    bench('idle — no subscribers, no elapsed time', () => {
      frames.pump('tick');
    });
  }

  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    bench('one step, one update subscriber, one render subscriber', () => {
      clock.advance(16.667);
      frames.pump('paint');
    });
    loop.onUpdate(() => {});
    loop.onRender(() => {});
  }

  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    for (let i = 0; i < 32; i += 1) loop.onUpdate(() => {});
    for (let i = 0; i < 32; i += 1) loop.onRender(() => {});
    loop.start();
    bench('32 update and 32 render subscribers', () => {
      clock.advance(16.667);
      frames.pump('paint');
    });
  }

  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames, update: () => {} });
    loop.start();
    bench('a full catch-up pump — fourteen steps and a clamp', () => {
      clock.advance(1000);
      frames.pump('paint');
    });
  }

  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    const jobs = Array.from({ length: 8 }, () => loop.coalesce(() => {}));
    loop.start();
    bench('eight coalesced jobs, all requested', () => {
      for (const job of jobs) job.request();
      clock.advance(16.667);
      frames.pump('paint');
    });
  }

  {
    const clock = manualClock();
    const frames = manualFrames();
    const loop = createLoop({ clock, frames });
    loop.start();
    let sink = 0;
    bench('reading stats — the same object, no allocation', () => {
      const stats = loop.stats;
      sink += stats.fps + stats.frameMs + stats.updateMs + stats.stepsLastPump;
      if (sink === Number.MAX_SAFE_INTEGER) sink = 0;
    });
  }
});

describe('scheduler', () => {
  {
    const timeline = createTimeline();
    bench('advance with nothing scheduled', () => {
      timeline.advance(1 / 60);
    });
  }

  {
    const timeline = createTimeline();
    for (let i = 0; i < 64; i += 1) timeline.every(60 + i, () => {});
    bench('advance with 64 timers, none due', () => {
      timeline.advance(1 / 60);
    });
  }

  {
    const timeline = createTimeline();
    for (let i = 0; i < 64; i += 1) timeline.every(1 / 60, () => {});
    bench('advance with 64 timers, all due — sorted and fired', () => {
      timeline.advance(1 / 60);
    });
  }
});

describe('tweens', () => {
  {
    const tweens = createTweens();
    bench('step with nothing running', () => {
      tweens.step(1 / 60);
    });
  }

  {
    const tweens = createTweens();
    let sink = 0;
    bench('step with 200 live tweens', () => {
      while (tweens.active < 200) {
        tweens.start({ from: 0, to: 1, seconds: 1000, ease: 'cubicOut', onUpdate: (v) => (sink = v) });
      }
      tweens.step(1 / 60);
      if (sink === -1) tweens.cancelAll();
    });
  }
});

describe('replay', () => {
  const ticks = 10_000;
  const inputs = Array.from({ length: ticks }, (_v, i) => (i * 2654435761) | 0);
  bench('10,000 ticks, checkpointed every 60', () => {
    let state = 0;
    let input = 0;
    replay({
      source: {
        ticks,
        applyAt: (tick) => {
          input = inputs[tick] ?? 0;
        },
        checkpointAt: () => undefined,
      },
      update: () => {
        state = (state + input) | 0;
      },
      hash: () => state,
    });
  });
});
