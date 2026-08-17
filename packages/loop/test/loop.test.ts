/**
 * `loop` — the invariants, one test each, all of them exact.
 *
 * There are no fake timers here and nothing waits. Every "an hour passed" below is
 * `clock.advance(3_600_000)` followed by one pump, which is why the whole file runs in single
 * -digit milliseconds and cannot flake.
 *
 * Where a number needs a derivation it carries one. The recurring one, because half the file
 * rests on it: at the default 60 Hz the step is `round(1e6 / 60) = 16_667 µs`, and the default
 * catch-up ceiling is `250_000 µs`. `floor(250_000 / 16_667) = 14`, leaving `16_662 µs` in the
 * accumulator — **not** fifteen steps, and not a rounding error. That is what "at most
 * `ceil(maxCatchUpMs / 1000 * hz)`" means once the accumulator is honest about microseconds.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { manualClock } from '../src/clock.js';
import { manualFrames } from '../src/frames.js';
import {
  createLoop,
  DEFAULT_BUDGET_MS,
  DEFAULT_HZ,
  DEFAULT_MAX_CATCH_UP_MS,
  type Loop,
  type LoopPhase,
} from '../src/loop.js';

const STEP_US = 16_667;
const STEP_MS = 16.667;
const CATCH_UP_STEPS = 14; // floor(250_000 / 16_667)
const CATCH_UP_REMAINDER_US = 250_000 - CATCH_UP_STEPS * STEP_US; // 16_662

/** A loop with a clock and frames a test owns outright. The only construction shape here. */
function harness(): { clock: ReturnType<typeof manualClock>; frames: ReturnType<typeof manualFrames>; loop: Loop } {
  const clock = manualClock();
  const frames = manualFrames();
  return { clock, frames, loop: createLoop({ clock, frames }) };
}

describe('construction', () => {
  it('nothing runs on import or on construction — there is no ambient loop', () => {
    const clock = manualClock();
    const frames = manualFrames();
    let updates = 0;
    const loop = createLoop({ clock, frames, update: () => (updates += 1) });
    clock.advance(10_000);
    expect(loop.running).toBe(false);
    expect(frames.started).toBe(false);
    expect(updates).toBe(0);
    expect(loop.tick).toBe(0);
  });

  it('I-7: start() owes nothing for the wait before it', () => {
    // Construct the loop, spend an hour loading assets, then start. Without recording the
    // clock at start() the first elapsed is everything since this clock's arbitrary origin,
    // which the clamp dutifully turns into fourteen wasted steps and one enormous onStall.
    const clock = manualClock();
    const frames = manualFrames();
    let stalls = 0;
    const loop = createLoop({ clock, frames, onStall: () => (stalls += 1) });
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    clock.advance(3_600_000);
    loop.start();
    frames.pump();
    expect(updates).toBe(0);
    expect(stalls).toBe(0);
    expect(loop.stats.droppedSeconds).toBe(0);
  });

  it('I-25: stepMs and stepSeconds are computed once and are equal for equal hz', () => {
    const a = harness().loop;
    const b = harness().loop;
    expect(a.stepMs).toBe(STEP_MS);
    expect(a.stepMs).toBe(b.stepMs);
    expect(a.stepSeconds).toBe(STEP_US / 1e6);
    // The reviewer's double-take: 60 Hz is really 59.9988 Hz, which is why this reads 16.667
    // and not 16.666666666666668. It is 0.002% and it is what makes the number comparable.
    expect(a.stepMs).not.toBe(1000 / 60);
    expect(createLoop({ clock: manualClock(), frames: manualFrames(), hz: 50 }).stepMs).toBe(20);
    expect(createLoop({ clock: manualClock(), frames: manualFrames(), hz: 20 }).stepMs).toBe(50);
  });

  it('I-25: stepMs survives a thousand pumps, a pause, a speed change and a stall', () => {
    const { clock, frames, loop } = harness();
    const before = loop.stepMs;
    loop.start();
    for (let i = 0; i < 1000; i += 1) {
      clock.advance(16);
      frames.pump();
    }
    loop.pause();
    clock.advance(3_600_000);
    frames.pump();
    loop.resume();
    loop.setSpeed(4);
    clock.advance(3_600_000);
    frames.pump();
    expect(loop.stepMs).toBe(before);
    expect(loop.stepSeconds).toBe(STEP_US / 1e6);
  });

  it('defaults match the documented constants', () => {
    expect(DEFAULT_HZ).toBe(60);
    expect(DEFAULT_MAX_CATCH_UP_MS).toBe(250);
    expect(DEFAULT_BUDGET_MS).toBe(8);
  });

  it('I-18: refuses nonsense options by name and value', () => {
    const clock = manualClock();
    const frames = manualFrames();
    expect(() => createLoop({ clock, frames, hz: 0 })).toThrow(RangeError);
    expect(() => createLoop({ clock, frames, hz: 0 })).toThrow(/createLoop\.hz/);
    expect(() => createLoop({ clock, frames, hz: 0 })).toThrow(/\b0\b/);
    expect(() => createLoop({ clock, frames, hz: -60 })).toThrow(RangeError);
    expect(() => createLoop({ clock, frames, hz: 59.94 })).toThrow(/integer/);
    expect(() => createLoop({ clock, frames, hz: NaN })).toThrow(RangeError);
    // Above a million a step rounds to zero microseconds and the step loop never terminates.
    expect(() => createLoop({ clock, frames, hz: 2_000_000 })).toThrow(/createLoop\.hz/);
    expect(() => createLoop({ clock, frames, maxCatchUpMs: 0 })).toThrow(/createLoop\.maxCatchUpMs/);
    expect(() => createLoop({ clock, frames, maxCatchUpMs: -1 })).toThrow(RangeError);
    expect(() => createLoop({ clock, frames, maxCatchUpMs: Infinity })).toThrow(RangeError);
    expect(() => createLoop({ clock, frames, budgetMs: -1 })).toThrow(/createLoop\.budgetMs/);
    expect(() => createLoop({ clock, frames, budgetMs: NaN })).toThrow(RangeError);
  });

  it('names the missing seam rather than failing on the first pump', () => {
    const clock = manualClock();
    const frames = manualFrames();
    expect(() => createLoop(undefined as unknown as { clock: typeof clock; frames: typeof frames })).toThrow(
      /createLoop/,
    );
    expect(() => createLoop({ frames } as unknown as { clock: typeof clock; frames: typeof frames })).toThrow(
      /createLoop\.clock/,
    );
    expect(() => createLoop({ clock: {} as typeof clock, frames })).toThrow(/now\(\)/);
    expect(() => createLoop({ clock } as unknown as { clock: typeof clock; frames: typeof frames })).toThrow(
      /createLoop\.frames/,
    );
    expect(() => createLoop({ clock, frames: { start: () => {} } as unknown as typeof frames })).toThrow(
      /manualFrames/,
    );
  });

  it('refuses a subscriber or a job body that is not a function', () => {
    const { loop } = harness();
    expect(() => loop.onUpdate(undefined as unknown as () => void)).toThrow(/loop\.onUpdate/);
    expect(() => loop.onRender(undefined as unknown as () => void)).toThrow(/loop\.onRender/);
    expect(() => loop.coalesce(undefined as unknown as () => void)).toThrow(/loop\.coalesce/);
  });
});

describe('the fixed step', () => {
  it('I-1: every update gets exactly stepSeconds, over ten thousand varied pumps', () => {
    const { clock, frames, loop } = harness();
    const deltas = new Set<number>();
    loop.onUpdate((dt) => deltas.add(dt));
    loop.start();
    // A deliberately ragged frame pattern: fast, slow, stalled, zero-length.
    const pattern = [0, 1, 4, 8, 16, 17, 33, 100, 400, 7];
    for (let i = 0; i < 10_000; i += 1) {
      clock.advance(pattern[i % pattern.length] ?? 0);
      frames.pump(i % 3 === 0 ? 'tick' : 'paint');
    }
    expect(deltas.size).toBe(1);
    expect([...deltas]).toEqual([loop.stepSeconds]);
  });

  it('I-24: tick is a non-negative integer starting at 0 and increasing by exactly one', () => {
    // This is the join that `input`'s event buckets and `persist`'s replay envelope are keyed
    // on. A gap or a repeat is a replay that reports a confident wrong answer.
    const { clock, frames, loop } = harness();
    const seen: number[] = [];
    loop.onUpdate((_dt, tick) => seen.push(tick));
    loop.start();
    for (let i = 0; i < 500; i += 1) {
      clock.advance(i % 7);
      frames.pump(i % 2 === 0 ? 'tick' : 'paint');
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe(0);
    for (let i = 0; i < seen.length; i += 1) expect(seen[i]).toBe(i);
    expect(loop.tick).toBe(seen.length);
  });

  it('I-24: tick does not restart after stop() and start()', () => {
    const { clock, frames, loop } = harness();
    const seen: number[] = [];
    loop.onUpdate((_dt, tick) => seen.push(tick));
    loop.start();
    clock.advance(100);
    frames.pump();
    loop.stop();
    clock.advance(3_600_000);
    loop.start();
    clock.advance(100);
    frames.pump();
    expect(new Set(seen).size).toBe(seen.length);
    for (let i = 0; i < seen.length; i += 1) expect(seen[i]).toBe(i);
  });

  it('time is tick * stepSeconds and lags real time on purpose', () => {
    const { clock, frames, loop } = harness();
    loop.start();
    clock.advance(1000);
    frames.pump();
    expect(loop.tick).toBe(CATCH_UP_STEPS);
    expect(loop.time).toBe(CATCH_UP_STEPS * (STEP_US / 1e6));
    expect(loop.realTime).toBe(1);
    // A hidden tab advances at roughly a quarter speed: one second of real time bought
    // 233,338 µs of sim, so 766,662 µs of the second is simply gone. Anything that must be
    // true against the player's wall clock is a `loop.real` timer or a timestamp in state,
    // never `loop.time`.
    expect(loop.realTime - loop.time).toBe(1 - CATCH_UP_STEPS * (STEP_US / 1e6));
    expect(loop.realTime - loop.time).toBe(0.766662);
  });

  it('realTime counts only the time the loop was running', () => {
    const { clock, frames, loop } = harness();
    loop.start();
    clock.advance(1000);
    frames.pump();
    loop.stop();
    clock.advance(3_600_000);
    loop.start();
    clock.advance(1000);
    frames.pump();
    expect(loop.realTime).toBe(2);
  });

  it('runs zero steps when no time has passed', () => {
    const { frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.start();
    frames.pump();
    frames.pump();
    frames.pump();
    expect(updates).toBe(0);
    expect(loop.stats.pumps).toBe(3);
  });
});

describe('catch-up', () => {
  it('I-3: an hour in one pump is clamped, not 216,000 steps', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    const dropped: number[] = [];
    loop.onUpdate(() => (updates += 1));
    const loop2 = createLoop({
      clock,
      frames,
      onStall: (s) => dropped.push(s),
    });
    void loop2;
    loop.start();
    clock.advance(3_600_000);
    frames.pump();
    expect(updates).toBe(CATCH_UP_STEPS);
    expect(updates).toBeLessThanOrEqual(Math.ceil((DEFAULT_MAX_CATCH_UP_MS / 1000) * DEFAULT_HZ));
  });

  it('I-3: onStall reports the dropped seconds exactly, once per stalled pump', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const dropped: number[] = [];
    const loop = createLoop({ clock, frames, onStall: (s) => dropped.push(s) });
    loop.start();
    clock.advance(3_600_000);
    frames.pump();
    // 3,600,000,000 µs accumulated, clamped to 250,000 µs. The rest ceases to exist here —
    // `@latticekit/sim` has already integrated the same interval from its own epoch timestamp.
    expect(dropped).toEqual([(3_600_000_000 - 250_000) / 1e6]);
    expect(dropped).toEqual([3599.75]);
    expect(loop.stats.droppedSeconds).toBe(3599.75);
  });

  it('I-4: dropped time is dropped, not owed — the next 16 ms pump runs exactly one step', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.start();
    clock.advance(3_600_000);
    frames.pump();
    updates = 0;
    clock.advance(16);
    frames.pump();
    // 16,662 µs left over plus 16,000 µs is 32,662 µs: one step of 16,667, leaving 15,995.
    // Two would mean the excess had been deferred and the spiral only postponed.
    expect(updates).toBe(1);
  });

  it('a stall does not fire onStall on pumps that did not stall', () => {
    const clock = manualClock();
    const frames = manualFrames();
    let stalls = 0;
    const loop = createLoop({ clock, frames, onStall: () => (stalls += 1) });
    loop.start();
    for (let i = 0; i < 100; i += 1) {
      clock.advance(16);
      frames.pump();
    }
    expect(stalls).toBe(0);
    clock.advance(3_600_000);
    frames.pump();
    expect(stalls).toBe(1);
  });

  it('a stall with no onStall still counts the dropped seconds', () => {
    const { clock, frames, loop } = harness();
    loop.start();
    clock.advance(1000);
    frames.pump();
    expect(loop.stats.droppedSeconds).toBe((1_000_000 - 250_000) / 1e6);
  });

  it('honors a custom ceiling, including one below a single step', () => {
    const clock = manualClock();
    const frames = manualFrames();
    let updates = 0;
    const loop = createLoop({ clock, frames, maxCatchUpMs: 10, update: () => (updates += 1) });
    loop.start();
    clock.advance(10_000);
    frames.pump();
    // 10 ms is 10,000 µs, less than one 16,667 µs step, so nothing steps at all — legal, and
    // never what a game wants.
    expect(updates).toBe(0);
    expect(loop.stats.droppedSeconds).toBe((10_000_000 - 10_000) / 1e6);
  });
});

describe('the two pump kinds', () => {
  it('I-2: update runs on tick pumps and render does not — this is the hidden tab', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    let renders = 0;
    loop.onUpdate(() => (updates += 1));
    loop.onRender(() => (renders += 1));
    loop.start();
    for (let i = 0; i < 60; i += 1) {
      clock.advance(1000);
      frames.pump('tick');
    }
    expect(loop.tick).toBe(60 * CATCH_UP_STEPS);
    expect(updates).toBe(loop.tick);
    expect(renders).toBe(0);
    expect(loop.stats.renders).toBe(0);
  });

  it('renders at most once per pump, even though both sources fire while visible', () => {
    const { clock, frames, loop } = harness();
    let renders = 0;
    loop.onRender(() => (renders += 1));
    loop.start();
    clock.advance(16);
    frames.pump('paint');
    clock.advance(0);
    frames.pump('tick');
    clock.advance(16);
    frames.pump('paint');
    expect(renders).toBe(2);
  });

  it('I-23: real timers fire from tick pumps alone — every autosave in the kit rides on this', () => {
    const { clock, frames, loop } = harness();
    let saves = 0;
    loop.real.after(5, () => (saves += 1));
    loop.start();
    for (let i = 0; i < 60; i += 1) {
      clock.advance(1000);
      frames.pump('tick');
    }
    expect(saves).toBe(1);
  });
});

describe('the blend factor', () => {
  it('I-5: alpha is accumulator / step and stays inside [0, 1]', () => {
    const { clock, frames, loop } = harness();
    const alphas: number[] = [];
    loop.onRender((alpha) => alphas.push(alpha));
    loop.start();
    for (let i = 0; i < 300; i += 1) {
      clock.advance(i % 23);
      frames.pump('paint');
    }
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('I-5: alpha is exactly the remaining fraction of a step', () => {
    const { clock, frames, loop } = harness();
    let alpha = -1;
    loop.onRender((a) => (alpha = a));
    loop.start();
    clock.advance(3_600_000);
    frames.pump('paint');
    expect(alpha).toBe(CATCH_UP_REMAINDER_US / STEP_US);
  });

  it('I-5: alpha is exactly 1 while paused', () => {
    const { clock, frames, loop } = harness();
    let alpha = -1;
    loop.onRender((a) => (alpha = a));
    loop.pause();
    loop.start();
    clock.advance(7);
    frames.pump('paint');
    expect(alpha).toBe(1);
    expect(loop.paused).toBe(true);
  });

  it('render is told the instant being drawn, and this pump’s single clock reading', () => {
    const { clock, frames, loop } = harness();
    let time = -1;
    let nowMs = -1;
    let alpha = -1;
    loop.onRender((a, t, n) => {
      alpha = a;
      time = t;
      nowMs = n;
    });
    loop.start();
    clock.advance(25);
    frames.pump('paint');
    // 25,000 µs is one step of 16,667 with 8,333 left over.
    expect(loop.tick).toBe(1);
    expect(alpha).toBe(8_333 / STEP_US);
    expect(time).toBe(loop.time + alpha * loop.stepSeconds);
    expect(nowMs).toBe(25);
  });

  it('hands every render subscriber the same alpha, time and nowMs', () => {
    const { clock, frames, loop } = harness();
    const seen: Array<readonly [number, number, number]> = [];
    loop.onRender((a, t, n) => seen.push([a, t, n]));
    loop.onRender((a, t, n) => seen.push([a, t, n]));
    loop.start();
    clock.advance(25);
    frames.pump('paint');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
  });
});

describe('a clock that misbehaves', () => {
  it('I-6: a backwards clock costs game time, never the loop', () => {
    // `Date.now()` moves backwards on an NTP correction. A loop that accumulated the negative
    // delta would stop firing timers for however long the jump was.
    const clock = manualClock(10_000);
    const frames = manualFrames();
    const deltas: number[] = [];
    const loop = createLoop({ clock, frames, update: (dt) => deltas.push(dt) });
    loop.start();
    clock.advance(1000);
    frames.pump();
    const before = loop.tick;
    clock.set(5_000);
    expect(() => frames.pump()).not.toThrow();
    expect(loop.tick).toBe(before);
    expect(deltas.every((d) => d === loop.stepSeconds)).toBe(true);
    // And the pump after it still runs a step: the clock, not the loop, lost the time.
    clock.advance(1000);
    frames.pump();
    expect(loop.tick).toBeGreaterThan(before);
  });

  it('refuses a non-finite reading rather than silently never stepping again', () => {
    // `accumulator += NaN` makes `while (NaN >= step)` false forever: the game stops stepping
    // with no exception anywhere near the cause. This one is not routed to `onError` — the
    // loop cannot trust its own accounting, so it stops and throws either way.
    let reading = 0;
    const frames = manualFrames();
    const errors: unknown[] = [];
    const loop = createLoop({ clock: { now: () => reading }, frames, onError: (e) => errors.push(e) });
    loop.start();
    reading = NaN;
    let thrown: unknown;
    try {
      frames.pump();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(String(thrown)).toMatch(/clock\.now\(\)/);
    // Stopped, so it does not throw again on every frame for the rest of the session.
    expect(loop.running).toBe(false);
    expect(errors).toHaveLength(0);
    expect(() => frames.pump()).not.toThrow();
  });

  it('refuses a non-finite reading at start(), leaving a stopped loop rather than a broken one', () => {
    const frames = manualFrames();
    const loop = createLoop({ clock: { now: () => Infinity }, frames });
    expect(() => loop.start()).toThrow(RangeError);
    expect(loop.running).toBe(false);
    expect(frames.started).toBe(false);
  });
});

describe('speed', () => {
  it('scales sim time and leaves real time alone', () => {
    const { clock, frames, loop } = harness();
    loop.setSpeed(2);
    loop.start();
    clock.advance(100);
    frames.pump();
    // 100 ms at 2× is 200,000 µs of sim: 11 steps of 16,667 (183,337), 16,663 left over.
    expect(loop.tick).toBe(11);
    expect(loop.realTime).toBe(0.1);
    expect(loop.speed).toBe(2);
  });

  it('at zero, sim time stops and real time does not', () => {
    const { clock, frames, loop } = harness();
    loop.setSpeed(0);
    loop.start();
    clock.advance(10_000);
    frames.pump();
    expect(loop.tick).toBe(0);
    expect(loop.time).toBe(0);
    expect(loop.realTime).toBe(10);
    expect(loop.paused).toBe(true);
  });

  it('I-8: sim timers pause and real timers do not', () => {
    const { clock, frames, loop } = harness();
    let simCalls = 0;
    let realCalls = 0;
    let realRepeats = 0;
    loop.sim.every(1, () => (simCalls += 1));
    loop.real.every(1, (n) => {
      realCalls += 1;
      realRepeats += n;
    });
    loop.pause();
    loop.start();
    clock.advance(60_000);
    frames.pump();
    expect(simCalls).toBe(0);
    expect(realCalls).toBe(1);
    expect(realRepeats).toBe(60);
  });

  it('pause remembers the speed and resume restores it', () => {
    const { loop } = harness();
    loop.setSpeed(4);
    loop.pause();
    expect(loop.speed).toBe(0);
    loop.resume();
    expect(loop.speed).toBe(4);
  });

  it('pause is a no-op when already paused, so resume cannot restore zero', () => {
    const { loop } = harness();
    loop.setSpeed(3);
    loop.pause();
    loop.pause();
    loop.resume();
    expect(loop.speed).toBe(3);
  });

  it('resume is a no-op when not paused', () => {
    const { loop } = harness();
    loop.setSpeed(2);
    loop.resume();
    expect(loop.speed).toBe(2);
  });

  it('setSpeed(0) directly is a pause resume can undo', () => {
    const { loop } = harness();
    loop.setSpeed(2.5);
    loop.setSpeed(0);
    loop.resume();
    expect(loop.speed).toBe(2.5);
  });

  it('resume from a loop that was never given a speed goes back to 1', () => {
    const { loop } = harness();
    loop.pause();
    loop.resume();
    expect(loop.speed).toBe(1);
  });

  it('I-18: refuses a negative, NaN or infinite multiplier by name', () => {
    const { loop } = harness();
    expect(() => loop.setSpeed(-1)).toThrow(RangeError);
    expect(() => loop.setSpeed(-1)).toThrow(/loop\.setSpeed/);
    expect(() => loop.setSpeed(-1)).toThrow(/-1/);
    expect(() => loop.setSpeed(NaN)).toThrow(RangeError);
    expect(() => loop.setSpeed(Infinity)).toThrow(RangeError);
    expect(loop.speed).toBe(1);
  });

  it('a pause called from inside update takes effect on the next pump, not this one', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => {
      updates += 1;
      loop.pause();
    });
    loop.start();
    clock.advance(100);
    frames.pump();
    // 100 ms is 100,000 µs: five steps of 16,667 (83,335), with 16,665 left over. All five
    // run; the pause lands on the next pump.
    expect(updates).toBe(5);
    clock.advance(100);
    frames.pump();
    expect(updates).toBe(5);
  });
});

describe('subscribers', () => {
  it('I-22: run in registration order, with the constructor pair first', () => {
    const clock = manualClock();
    const frames = manualFrames();
    const order: string[] = [];
    const loop = createLoop({
      clock,
      frames,
      update: () => order.push('game'),
      render: () => order.push('game-render'),
    });
    loop.onUpdate(() => order.push('overlay'));
    loop.onRender(() => order.push('overlay-render'));
    loop.start();
    clock.advance(20);
    frames.pump('paint');
    expect(order).toEqual(['game', 'overlay', 'game-render', 'overlay-render']);
  });

  it('I-22: a disposer removes exactly one subscription and is safe to call twice', () => {
    const { clock, frames, loop } = harness();
    let a = 0;
    let b = 0;
    const disposeA = loop.onUpdate(() => (a += 1));
    loop.onUpdate(() => (b += 1));
    loop.start();
    clock.advance(20);
    frames.pump();
    expect([a, b]).toEqual([1, 1]);
    disposeA();
    disposeA();
    clock.advance(20);
    frames.pump();
    expect([a, b]).toEqual([1, 2]);
  });

  it('I-22: a subscriber added inside a firing pass does not run in that pass', () => {
    const { clock, frames, loop } = harness();
    const seen: string[] = [];
    let added = false;
    loop.onUpdate(() => {
      seen.push('outer');
      if (!added) {
        added = true;
        loop.onUpdate(() => seen.push('inner'));
      }
    });
    loop.start();
    clock.advance(20);
    frames.pump();
    expect(seen).toEqual(['outer']);
    clock.advance(20);
    frames.pump();
    expect(seen).toEqual(['outer', 'outer', 'inner']);
  });

  it('I-22: a subscriber disposed from inside a firing pass does not run in that pass', () => {
    const { clock, frames, loop } = harness();
    const seen: string[] = [];
    let disposeSecond = (): void => {};
    loop.onUpdate(() => {
      seen.push('first');
      disposeSecond();
    });
    disposeSecond = loop.onUpdate(() => seen.push('second'));
    loop.start();
    clock.advance(20);
    frames.pump();
    expect(seen).toEqual(['first']);
  });

  it('the same rules hold for render subscribers', () => {
    const { clock, frames, loop } = harness();
    const seen: string[] = [];
    let disposeSecond = (): void => {};
    loop.onRender(() => {
      seen.push('first');
      disposeSecond();
      loop.onRender(() => seen.push('added'));
    });
    disposeSecond = loop.onRender(() => seen.push('second'));
    loop.start();
    clock.advance(20);
    frames.pump('paint');
    expect(seen).toEqual(['first']);
    clock.advance(20);
    frames.pump('paint');
    expect(seen).toEqual(['first', 'first', 'added']);
  });

  it('a loop with no subscribers at all still keeps its books', () => {
    const { clock, frames, loop } = harness();
    loop.start();
    clock.advance(100);
    frames.pump('paint');
    expect(loop.tick).toBe(5); // floor(100_000 / 16_667)
    expect(loop.stats.renders).toBe(1);
  });
});

describe('coalesced jobs', () => {
  it('I-21: fifty requests in one drag produce exactly one sweep', () => {
    const { clock, frames, loop } = harness();
    let sweeps = 0;
    const rebuild = loop.coalesce(() => (sweeps += 1));
    for (let i = 0; i < 50; i += 1) rebuild.request();
    loop.start();
    clock.advance(16);
    frames.pump();
    expect(sweeps).toBe(1);
  });

  it('I-21: a request inside every one of fourteen catch-up steps still produces one sweep', () => {
    // The guarantee is per pump, not per step. `iso`'s flow field is far too expensive to
    // rebuild twice in one frame.
    const { clock, frames, loop } = harness();
    let sweeps = 0;
    const rebuild = loop.coalesce(() => (sweeps += 1));
    let steps = 0;
    loop.onUpdate(() => {
      steps += 1;
      rebuild.request();
    });
    loop.start();
    clock.advance(3_600_000);
    frames.pump();
    expect(steps).toBe(CATCH_UP_STEPS);
    expect(sweeps).toBe(0); // requested during the steps, so serviced next pump
    clock.advance(16);
    frames.pump();
    expect(sweeps).toBe(1);
  });

  it('runs before the step loop, so the updates that follow see the rebuilt state', () => {
    const { clock, frames, loop } = harness();
    const order: string[] = [];
    const job = loop.coalesce(() => order.push('job'));
    loop.onUpdate(() => order.push('update'));
    job.request();
    loop.start();
    clock.advance(20);
    frames.pump();
    expect(order).toEqual(['job', 'update']);
  });

  it('runs on tick pumps and while paused, because a rule does not stop when the painting does', () => {
    const { clock, frames, loop } = harness();
    let sweeps = 0;
    const job = loop.coalesce(() => (sweeps += 1));
    loop.pause();
    loop.start();
    job.request();
    clock.advance(1000);
    frames.pump('tick');
    expect(sweeps).toBe(1);
  });

  it('reports whether it is queued, and cancel un-queues it', () => {
    const { clock, frames, loop } = harness();
    let sweeps = 0;
    const job = loop.coalesce(() => (sweeps += 1));
    expect(job.queued).toBe(false);
    job.request();
    expect(job.queued).toBe(true);
    job.cancel();
    job.cancel();
    expect(job.queued).toBe(false);
    loop.start();
    clock.advance(16);
    frames.pump();
    expect(sweeps).toBe(0);
  });

  it('runs jobs in creation order', () => {
    const { clock, frames, loop } = harness();
    const order: number[] = [];
    const jobs = [0, 1, 2, 3].map((i) => loop.coalesce(() => order.push(i)));
    for (const job of [...jobs].reverse()) job.request();
    loop.start();
    clock.advance(16);
    frames.pump();
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('a job created inside a pump does not run in that pump', () => {
    const { clock, frames, loop } = harness();
    const order: string[] = [];
    let made = false;
    const outer = loop.coalesce(() => {
      order.push('outer');
      if (made) return;
      made = true;
      loop.coalesce(() => order.push('inner')).request();
    });
    outer.request();
    loop.start();
    clock.advance(16);
    frames.pump();
    expect(order).toEqual(['outer']);
    clock.advance(16);
    frames.pump();
    expect(order).toEqual(['outer', 'inner']);
  });

  it('costs nothing when no job is queued', () => {
    const { clock, frames, loop } = harness();
    let sweeps = 0;
    loop.coalesce(() => (sweeps += 1));
    loop.start();
    for (let i = 0; i < 100; i += 1) {
      clock.advance(16);
      frames.pump();
    }
    expect(sweeps).toBe(0);
  });
});

describe('errors', () => {
  const phases: ReadonlyArray<readonly [LoopPhase, (loop: Loop, boom: () => never) => void]> = [
    ['update', (loop, boom) => loop.onUpdate(boom)],
    ['render', (loop, boom) => loop.onRender(boom)],
    [
      'job',
      (loop, boom) => {
        loop.coalesce(boom).request();
      },
    ],
    ['timer', (loop, boom) => loop.real.after(0.001, boom)],
  ];

  for (const [phase, attach] of phases) {
    it(`I-14: stops the loop and names the '${phase}' phase`, () => {
      const clock = manualClock();
      const frames = manualFrames();
      const reported: Array<readonly [unknown, LoopPhase]> = [];
      const loop = createLoop({ clock, frames, onError: (e, p) => reported.push([e, p]) });
      const boom = (): never => {
        throw new Error('boom');
      };
      attach(loop, boom);
      loop.start();
      clock.advance(20);
      frames.pump('paint');
      expect(loop.running).toBe(false);
      expect(frames.started).toBe(false);
      expect(reported).toHaveLength(1);
      expect(reported[0]?.[1]).toBe(phase);
      expect(String(reported[0]?.[0])).toMatch(/boom/);
      // And nothing runs afterwards. A loop that swallowed this and kept pumping would leave
      // the picture moving and the state frozen, with nothing in the console to say so.
      clock.advance(20);
      frames.pump('paint');
      expect(reported).toHaveLength(1);
    });
  }

  it('I-14: rethrows when there is no onError, having stopped itself first', () => {
    const { clock, frames, loop } = harness();
    loop.onUpdate(() => {
      throw new RangeError('bad state');
    });
    loop.start();
    clock.advance(20);
    expect(() => frames.pump()).toThrow(RangeError);
    expect(loop.running).toBe(false);
  });

  it('I-14: a second update never arrives after a throw', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => {
      updates += 1;
      throw new Error('boom');
    });
    loop.start();
    clock.advance(1000);
    expect(() => frames.pump()).toThrow();
    expect(updates).toBe(1);
  });

  it('reports a throwing onStall as the update phase', () => {
    const clock = manualClock();
    const frames = manualFrames();
    let phase: LoopPhase | undefined;
    const loop = createLoop({
      clock,
      frames,
      onStall: () => {
        throw new Error('boom');
      },
      onError: (_e, p) => (phase = p),
    });
    loop.start();
    clock.advance(3_600_000);
    frames.pump();
    expect(phase).toBe('update');
    expect(loop.running).toBe(false);
  });
});

describe('start and stop', () => {
  it('I-17: stop() releases the frame source and delivers nothing more', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.start();
    expect(frames.started).toBe(true);
    clock.advance(100);
    frames.pump();
    const before = updates;
    loop.stop();
    expect(frames.started).toBe(false);
    expect(loop.running).toBe(false);
    clock.advance(100_000);
    frames.pump();
    expect(updates).toBe(before);
  });

  it('I-17: timers survive a stop, deliberately — a scene transition keeps its cooldowns', () => {
    const { loop } = harness();
    loop.sim.after(1, () => {});
    loop.real.after(1, () => {});
    loop.start();
    loop.stop();
    expect(loop.sim.pending).toBe(1);
    expect(loop.real.pending).toBe(1);
  });

  it('stop() from inside update abandons the rest of the pump immediately', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    let renders = 0;
    loop.onUpdate(() => {
      updates += 1;
      loop.stop();
    });
    loop.onRender(() => (renders += 1));
    loop.start();
    clock.advance(1000);
    frames.pump('paint');
    expect(updates).toBe(1);
    expect(renders).toBe(0);
  });

  it('stop() from inside a render subscriber stops the rest of the render pass', () => {
    const { clock, frames, loop } = harness();
    const seen: string[] = [];
    loop.onRender(() => {
      seen.push('first');
      loop.stop();
    });
    loop.onRender(() => seen.push('second'));
    loop.start();
    clock.advance(20);
    frames.pump('paint');
    expect(seen).toEqual(['first']);
  });

  it('stop() from inside a real timer abandons the pump before any step runs', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.real.after(0.001, () => loop.stop());
    loop.start();
    clock.advance(1000);
    frames.pump();
    expect(updates).toBe(0);
    expect(loop.tick).toBe(0);
  });

  it('stop() from inside a sim timer leaves the tick unspent, so it is issued once on restart', () => {
    const { clock, frames, loop } = harness();
    const seen: number[] = [];
    loop.onUpdate((_dt, tick) => seen.push(tick));
    loop.sim.after(0.001, () => loop.stop());
    loop.start();
    clock.advance(100);
    frames.pump();
    expect(seen).toEqual([]);
    loop.start();
    clock.advance(100);
    frames.pump();
    expect(seen[0]).toBe(0);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('stop() from inside a job abandons the pump before any step runs', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.coalesce(() => loop.stop()).request();
    loop.start();
    clock.advance(1000);
    frames.pump();
    expect(updates).toBe(0);
  });

  it('start() twice is a no-op, and stop() twice is too', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.start();
    loop.start();
    clock.advance(20);
    frames.pump();
    expect(updates).toBe(1);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('a pump on a stopped loop does nothing at all', () => {
    const { clock, frames, loop } = harness();
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    clock.advance(1000);
    frames.start(() => {});
    // Reach the pump directly by starting and stopping around it.
    loop.start();
    loop.stop();
    clock.advance(1000);
    expect(updates).toBe(0);
    expect(loop.stats.pumps).toBe(0);
  });

  it('ignores a pump delivered by a frame source that kept the callback after stop()', () => {
    // A `FrameSource` is somebody else's code. One that hangs on to the pump — or a stale rAF
    // callback the host dispatched before the cancel landed — must not advance a stopped game.
    const clock = manualClock();
    let captured: ((kind: 'paint' | 'tick') => void) | undefined;
    const leaky = {
      start(pump: (kind: 'paint' | 'tick') => void) {
        captured = pump;
      },
      stop() {},
    };
    const loop = createLoop({ clock, frames: leaky });
    let updates = 0;
    loop.onUpdate(() => (updates += 1));
    loop.start();
    loop.stop();
    clock.advance(1000);
    captured?.('paint');
    expect(updates).toBe(0);
    expect(loop.stats.pumps).toBe(0);
  });

  it('survives a hundred start/stop cycles', () => {
    const { clock, frames, loop } = harness();
    for (let i = 0; i < 100; i += 1) {
      loop.start();
      clock.advance(16);
      frames.pump();
      loop.stop();
    }
    // 100 pumps of 16,000 µs is 1,600,000 µs, and floor(1,600,000 / 16,667) is 95. The
    // sub-step remainder survives the stop, which is why it is 95 and not 100 — a restart
    // resumes the accumulator, it does not zero it.
    expect(loop.tick).toBe(95);
    expect(frames.started).toBe(false);
  });
});

describe('the source, as evidence', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const sources = readdirSync(SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ name: f, text: readFileSync(join(SRC, f), 'utf8') }));

  /** Strip comments and string literals — a rule that fires on its own documentation is noise. */
  const code = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');

  it('I-16: names no clock and no randomness anywhere', () => {
    for (const { name, text } of sources) {
      expect(`${name}: ${code(text)}`).not.toMatch(/Date\.now|performance\.now|Math\.random|new Date/);
    }
  });

  it('I-19: nothing here can tell a caller the date — Clock has exactly one method', () => {
    // `loop` receives an injected monotonic clock and has no opinion about the calendar. There
    // is deliberately no `loop.epoch`, no second method on `Clock`, and no `stampedAt` on
    // anything this package emits. `persist` stamps; `sim` integrates from the stamp.
    for (const { name, text } of sources) {
      expect(`${name}: ${code(text)}`).not.toMatch(/\bepoch|\bDate\b|stampedAt/i);
    }
    const clockSource = sources.find((s) => s.name === 'clock.ts')?.text ?? '';
    expect(clockSource).toMatch(/export interface Clock \{\s*now\(\): number;\s*\}/);
  });

  it('publishes no duration alias — every duration is a bare number named for its unit', () => {
    // `type Millis = number` guarded nothing and said otherwise. It was read twice as a brand
    // that would refuse `{ stepMs: 16 }`, because `.lattice/kit.json` lists a type by name and
    // an alias over `number` is indistinguishable there from `core`'s branded `EpochMillis`.
    // A brand separates two kinds of value; a duration has one kind, so there is nothing to
    // separate and the parameter name is the whole mechanism. See `docs/rfc/durations.md`.
    //
    // This fires if any module reintroduces the alias under this or any other name, which is
    // the failure mode: the next author reaches for `Duration` instead.
    for (const { name, text } of sources) {
      expect(`${name}: ${code(text)}`).not.toMatch(
        /export\s+type\s+(Millis|Seconds|Duration|Ms|Milliseconds)\b/,
      );
    }
    // Nor may one be imported and used as an annotation — the alias is equally misleading
    // when it comes from somewhere else.
    for (const { name, text } of sources) {
      expect(`${name}: ${code(text)}`).not.toMatch(/:\s*(Millis|Seconds|Duration)\b/);
    }
    // The four durations this package publishes are bare numbers, and their names carry the
    // unit. This fails if any of them is re-typed.
    const publicDurations: readonly [string, RegExp][] = [
      ['loop.ts', /readonly stepMs: number;/],
      ['loop.ts', /readonly budgetMs\?: number;/],
      ['loop.ts', /readonly maxCatchUpMs\?: number;/],
      ['frames.ts', /readonly idleMs\?: number;/],
    ];
    for (const [file, pattern] of publicDurations) {
      const source = sources.find((s) => s.name === file)?.text ?? '';
      expect({ file, pattern: String(pattern), found: pattern.test(source) }).toEqual({
        file,
        pattern: String(pattern),
        found: true,
      });
    }
  });

  it('I-16/I-20: only frames.ts declares itself browser-only, and no module defines a curve', () => {
    for (const { name, text } of sources) {
      const declares = text.slice(0, 2000).includes('@browser-only');
      expect(`${name}:${String(declares)}`).toBe(`${name}:${String(name === 'frames.ts')}`);
      // Every easing this package can name comes from `core`'s table.
      expect(`${name}: ${code(text)}`).not.toMatch(/\b(ease|easing)(In|Out)[A-Za-z]*\s*=/);
    }
  });

  it('I-16: runs a whole game in Node with requestAnimationFrame deleted', () => {
    const target = globalThis as unknown as Record<string, unknown>;
    const saved = target['requestAnimationFrame'];
    try {
      delete target['requestAnimationFrame'];
      const { clock, frames, loop } = harness();
      let updates = 0;
      loop.onUpdate(() => (updates += 1));
      loop.start();
      for (let i = 0; i < 600; i += 1) {
        clock.advance(16);
        frames.pump(i % 2 === 0 ? 'paint' : 'tick');
      }
      loop.stop();
      expect(updates).toBe(loop.tick);
      expect(updates).toBeGreaterThan(500);
    } finally {
      if (saved !== undefined) target['requestAnimationFrame'] = saved;
    }
  });
});
