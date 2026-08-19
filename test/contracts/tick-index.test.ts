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
import { createLoop, manualClock, manualFrames, replay } from '@latticekit/loop';
import type { ReplaySource } from '@latticekit/loop';
import { createRng, hashNumber, hashStep } from '@latticekit/core';
import { createCamera } from '@latticekit/iso';
import { createHeadlessInput, createLog, fixedStep, record, replayCursor } from '@latticekit/input';
import type { InputLog, RawSample } from '@latticekit/input';
import { createRecorder, createVerifier } from '@latticekit/persist';
import type { ReplayLog } from '@latticekit/persist';

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

// ── the third property: one session, all three packages ─────────────────────────
//
// The two suites above are each half of the join, and each of them could pass while the join
// itself is broken: `loop` counting perfectly and `input` bucketing perfectly proves nothing
// about whether the *same* integer reached `persist`. What follows records a session through
// all three and replays it, because that is the only shape in which the question can be asked.

/** Ticks in the recorded session. Long enough for several checkpoints. */
const TICKS = 24;
/** How often `persist` takes a digest. Small, so a divergence is caught near where it started. */
const CHECKPOINT_EVERY = 4;
/** Where the taps land in the session, as `down` tick → `up` tick. */
const TAPS: readonly (readonly [number, number])[] = [
  [2, 3],
  [9, 10],
  [17, 18],
];

/** The game: a number, advanced every tick, and moved further whenever a gesture lands.
 *
 * Tier A throughout — `hashStep` is `imul` and bitwise — because this stands in for a real
 * game's state hash and a Tier B one would make the whole exercise a claim about one engine. */
function advance(state: number, tick: number): number {
  return hashStep(state, tick);
}

/** What a gesture does to it. Reads the tick it arrived on, which is the entire point: a
 *  gesture delivered one tick early or late produces a different number here and nowhere
 *  else. */
function react(state: number, tick: number): number {
  return hashStep(state, tick * 1_000_003);
}

/** A pointer press and release, as `input` receives them from a device. */
function samplesAt(tick: number): readonly RawSample[] {
  for (const [downAt, upAt] of TAPS) {
    if (tick === downAt) return [{ kind: 'down', id: 1, sx: 400, sy: 300, pointerType: 'mouse' }];
    if (tick === upAt) return [{ kind: 'up', id: 1, sx: 401, sy: 300 }];
  }
  return [];
}

/** Everything one recorded session produces. */
interface Session {
  /** `input`'s log: every sample, and a marker per tick. */
  readonly log: InputLog;
  /** `persist`'s envelope: the checkpoints, sealed around that log. */
  readonly sealed: ReplayLog<InputLog>;
  /** The ticks the loop actually issued, in the order it issued them. */
  readonly ticks: readonly number[];
  /** The ticks a gesture was delivered on. */
  readonly gestures: readonly number[];
  /** The final state, for a test that wants to compare against the replay's. */
  readonly finalState: number;
}

/**
 * Play a session: `loop` drives, `input` records, `persist` checkpoints.
 *
 * The three `onUpdate` registrations are in the order `loop`'s replay driver uses — inputs,
 * then the game, then the checkpoint — because a recording made in a different order is a
 * recording of a different game, and the replay would report the difference as the game's
 * fault.
 */
function playSession(): Session {
  const clock = manualClock(0);
  const frames = manualFrames();
  const loop = createLoop({ hz: 60, clock, frames });
  const input = createHeadlessInput({
    camera: createCamera(800, 600),
    step: loop,
    terrain: 'flat',
  });

  let state = 1;
  const ticks: number[] = [];
  const gestures: number[] = [];
  input.on('tap', (g): void => {
    gestures.push(g.tick);
    state = react(state, g.tick);
  });

  const recorder = createRecorder<number>({
    kit: '0.1.0',
    game: 'tick-index-contract',
    rng: createRng('tick-index-contract').snapshot(),
    startTick: 0,
    checkpointEvery: CHECKPOINT_EVERY,
    digest: hashNumber,
  });
  const recording = record(input);

  loop.onUpdate((_dt, at) => {
    for (const sample of samplesAt(at)) input.submit(sample);
    input.tick(at);
  });
  loop.onUpdate((_dt, at) => {
    ticks.push(at);
    state = advance(state, at);
  });
  loop.onUpdate((_dt, at) => {
    recorder.mark(at, state);
  });

  loop.start();
  while (loop.tick < TICKS) {
    clock.advance(loop.stepMs);
    frames.pump('tick');
  }
  loop.stop();

  const log = recording.stop();
  const sealed = recorder.stop(TICKS - 1, state, log);
  return { log, sealed, ticks, gestures, finalState: state };
}

/** A fresh system, a cursor over the log, and a verifier over the envelope — the replay side. */
function replaySession(
  session: Session,
  wrap?: (cursor: ReplaySource) => ReplaySource,
): { verdict: ReturnType<ReturnType<typeof createVerifier<number, InputLog>>['finish']>; gestures: number[]; finalState: number } {
  const fresh = createHeadlessInput({
    camera: createCamera(800, 600),
    // `fixedStep(60)` and a 60 Hz `Loop` publish the same `stepMs`, and they had better: if they
    // did not, this line would refuse the log by name and the join would never be tested.
    step: fixedStep(60),
    terrain: 'flat',
  });
  let state = 1;
  const gestures: number[] = [];
  fresh.on('tap', (g): void => {
    gestures.push(g.tick);
    state = react(state, g.tick);
  });

  const verifier = createVerifier<number, InputLog>(session.sealed, {
    kit: '0.1.0',
    game: 'tick-index-contract',
    inputs: createLog(fresh),
    digest: hashNumber,
  });

  const cursor: ReplaySource = replayCursor(fresh, session.log);
  replay({
    source: wrap === undefined ? cursor : wrap(cursor),
    hz: 60,
    update: (_dt, tick) => {
      state = advance(state, tick);
      verifier.mark(tick, state);
    },
    hash: () => state,
  });

  return { verdict: verifier.finish(), gestures, finalState: state };
}

describe('one index, recorded by three packages and read back by three packages', () => {
  it('replays a recorded session and agrees, tick for tick', () => {
    const session = playSession();

    // The join, stated across all three at once: the ticks `loop` issued, the tick markers
    // `input` wrote into the log, and the ticks `persist` sealed checkpoints at are all the same
    // integers, from the same run, and every checkpoint lands on a tick that happened.
    const markers = session.log.samples.flatMap((s) => (s.kind === 'tick' ? [s.index] : []));
    const expected = Array.from({ length: TICKS }, (_, i) => i);
    expect(session.ticks).toEqual(expected);
    expect(markers).toEqual(expected);
    expect(session.sealed.checkpoints.map((c) => c.tick)).toEqual(
      session.sealed.checkpoints.map((c) => c.tick).slice().sort((a, b) => a - b),
    );
    for (const checkpoint of session.sealed.checkpoints) {
      expect(markers).toContain(checkpoint.tick);
    }
    expect(session.gestures).toEqual(TAPS.map(([, up]) => up));

    const { verdict, gestures, finalState } = replaySession(session);
    expect(verdict.refused).toBeNull();
    expect(verdict.divergence).toBeNull();
    expect(verdict.matched).toBe(true);
    expect(verdict.checkpointsChecked).toBe(session.sealed.checkpoints.length);
    // Every gesture landed on the tick it was recorded on, and the game ended where it ended.
    expect(gestures).toEqual(session.gestures);
    expect(finalState).toBe(session.finalState);
  });

  // The edit this catches, and the reason property 3 exists at all: a driver that applies each
  // tick's inputs one tick late. Nothing throws. `loop` still counts 0, 1, 2 …; `input` still
  // delivers every sample exactly once, in order; `persist` still compares the checkpoints it
  // stored. Every one of the three suites is green, and the report says the *game* diverged at
  // tick 4 — which is a confident wrong answer, and worse than a replay that refuses.
  it('reports a divergence when inputs land one tick off, rather than a plausible pass', () => {
    const session = playSession();
    const late = (cursor: ReplaySource): ReplaySource => ({
      ticks: cursor.ticks,
      ...(cursor.stepMs === undefined ? {} : { stepMs: cursor.stepMs }),
      applyAt(tick: number): void {
        if (tick > 0) cursor.applyAt(tick - 1);
      },
      checkpointAt: (tick: number): number | undefined => cursor.checkpointAt(tick),
    });

    const { verdict, gestures, finalState } = replaySession(session, late);
    expect(verdict.matched).toBe(false);
    expect(verdict.refused).toBeNull(); // not a refusal: the log is perfectly compatible
    expect(verdict.divergence).not.toBeNull();
    expect(verdict.divergence?.tick).toBeGreaterThanOrEqual(TAPS[0]?.[1] ?? 0);

    // The symptom, and the reason this is the dangerous one rather than the obvious one.
    // `input` is not confused: every gesture still carries the index it was recorded under, so
    // a log dump, a debug overlay and `input`'s own suite all look exactly right. What moved is
    // *which update* those gestures were applied before, and the only place that is visible is
    // the state — which is why `persist`'s digest has to be in the loop for this to be caught
    // at all, and why a contract that stopped at "the ticks are contiguous" would pass.
    expect(gestures).toEqual(session.gestures);
    expect(finalState).not.toBe(session.finalState);
  });

  // The other half of the same failure. `persist` compares the triple by name, and `stepMs` is
  // the field the tick index is meaningless without — see `replay-step.test.ts`. Here it is
  // reached through a real recorded session rather than through a hand-built compat object.
  it('refuses a recorded session whose step is not the one being replayed at', () => {
    const session = playSession();
    const other = createHeadlessInput({
      camera: createCamera(800, 600),
      step: fixedStep(50),
      terrain: 'flat',
    });
    const verifier = createVerifier<number, InputLog>(session.sealed, {
      kit: '0.1.0',
      game: 'tick-index-contract',
      inputs: createLog(other),
      digest: hashNumber,
    });
    const verdict = verifier.finish();
    expect(verdict.matched).toBe(false);
    expect(verdict.refused).toEqual({
      kind: 'mismatch',
      field: 'stepMs',
      recorded: session.log.stepMs,
      current: createLog(other).stepMs,
    });
  });
});
