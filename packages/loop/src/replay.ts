/**
 * The replay driver — what makes non-negotiable #1 falsifiable rather than aspirational.
 *
 * `@latticekit/input` produces a log keyed by tick, `@latticekit/persist` stores and verifies it,
 * and nothing else in the kit can press play. This module can, and everything it needs is
 * already here: the fixed step is what makes a tick index mean anything, `stepMs` is what makes
 * a log comparable, and `tick` is the join.
 *
 * **How it stays inside the DAG.** `loop` is layer 1 and cannot import `persist`, so the driver
 * never sees a `ReplayLog`. It is defined against a structural {@link ReplaySource} that
 * `persist`'s cursor satisfies — exactly as `ui` declares its `Driveable` structurally in the
 * other direction. Nobody imports upward and nobody duplicates a format.
 *
 * ## What a green replay proves, and what it does not
 *
 * It proves the fixed step's prohibitions were obeyed. A game that reads a clock inside
 * `update`, derives from a frame delta, or lets a render pass mutate state cannot pass, because
 * none of those inputs exist here: there is no wall clock, no variable delta and nothing is
 * painted. **It is the one test in the kit that fails when someone adds `Math.random()` to a
 * system months from now.**
 *
 * It does not prove the picture matched, and two caveats are carried openly:
 *
 * - **The camera is outside the contract, deliberately.** `@latticekit/input` runs two clocks —
 *   gestures deliver on ticks, the camera integrates on frames, which is what keeps a drag
 *   under the finger when a step is long. So a log reproduces the same world and the same
 *   tiles, not the same glide. The rule that keeps that safe is the Tier B rule: a
 *   frame-integrated camera may reach pixels and must never reach a hash. Hashing one makes
 *   every replay fail for a reason that is not a bug, on a machine the author does not have.
 * - **A replay is not a save.** It reconstructs a session from its start; it does not resume
 *   one. `persist` owns resuming.
 *
 * ## Four ways to build one that reports a confident wrong answer
 *
 * All four are closed here rather than left to a caller.
 *
 * | mistake | what it produces |
 * |---|---|
 * | applying a tick's inputs *after* its update | every tick one late, and a report that blames the game for the driver |
 * | rendering during a replay | two orders of magnitude slower, frame-rate dependent, and able to *hide* a divergence if any render pass mutates |
 * | hashing a Tier B value | two correct engines disagree in the last bits and the replay fails forever |
 * | replaying at a different `hz` | tick indices still line up and mean something completely different |
 */

import { expectInt } from '@latticekit/core';
import { manualClock } from './clock.js';
import { manualFrames } from './frames.js';
import { createLoop, DEFAULT_HZ } from './loop.js';

/**
 * How often {@link ReplayOptions.onProgress} is called during a long log. Not an option: a
 * progress bar is presentation, and a knob here would be a second thing to get wrong about a
 * verdict that has to be exact.
 */
const PROGRESS_EVERY_TICKS = 1000;

/**
 * A recorded session, seen from here: a length, inputs addressable by tick, and optional
 * checkpoints.
 *
 * `@latticekit/persist`'s zero-allocation cursor satisfies this; so does an array in a test. This
 * package never learns what a log looks like on disk, which is the whole reason the driver can
 * live in layer 1.
 */
export interface ReplaySource {
  /** Total ticks recorded. The replay ends here, and ending is the point. */
  readonly ticks: number;

  /**
   * The step length the log was recorded at, if the source knows it.
   *
   * Optional because an array in a test does not have one. When it is present it is compared
   * against the replay loop's `stepMs` and a mismatch **throws** rather than being reported as
   * a divergence at tick 1 — a log recorded at 60 Hz and replayed at 50 has tick indices that
   * still line up and mean something completely different, and the two failures deserve
   * different words. `@latticekit/persist` refuses on the same comparison by name.
   */
  readonly stepMs?: number;

  /**
   * Apply everything recorded for `tick` to the live input state. Called exactly once per tick,
   * in ascending order, **before** that tick's update.
   *
   * Must allocate nothing and must not skip: a driver that applied inputs one tick late would
   * produce a divergence report that blames the game for the driver's bug.
   */
  applyAt(tick: number): void;

  /**
   * The checkpoint hash recorded at `tick`, or `undefined` if that tick carries none. Checked
   * after that tick's update.
   */
  checkpointAt(tick: number): number | undefined;
}

/** Options for {@link replay}. */
export interface ReplayOptions {
  /** The recording. See {@link ReplaySource}. */
  readonly source: ReplaySource;

  /**
   * The same `update` the live game runs. **If it is not the same function, nothing is
   * proven** — a replay of a reimplementation tests the reimplementation.
   */
  readonly update: (dt: number, tick: number) => void;

  /**
   * The state hash the recording used.
   *
   * Must be **Tier A** arithmetic: `+ - * /`, `Math.sqrt`, `Math.imul`, bitwise. A hash built
   * on `Math.exp`, or over a smoothed camera value, reports divergence between two correct
   * engines and there is no way to tell that apart from a real one.
   */
  readonly hash: () => number;

  /**
   * Steps per second. Must equal the log's. Default {@link DEFAULT_HZ}.
   *
   * @throws RangeError unless it is an integer in `[1, 1_000_000]`, and if
   *   {@link ReplaySource.stepMs} is present and disagrees with the step this `hz` produces.
   */
  readonly hz?: number;

  /**
   * Stop at the first mismatch. Default `true`.
   *
   * `false` runs to the end and still reports the *first* divergence, which is how you find out
   * whether the drift stayed in one subsystem or spread.
   */
  readonly stopOnDivergence?: boolean;

  /**
   * Called every thousand completed ticks and once at the end, for a progress bar on a long
   * log. Never called with a partial tick.
   */
  readonly onProgress?: (tick: number) => void;
}

/** The verdict. See {@link replay}. */
export interface ReplayResult {
  /** Ticks actually run — less than `source.ticks` only if it stopped at a divergence. */
  readonly ticks: number;
  /** Checkpoints compared. `0` means the log carried none and the run proved very little. */
  readonly checkpoints: number;
  /** `-1` when the replay matched the recording all the way through. */
  readonly divergedAt: number;
  /** The recorded and recomputed hashes at `divergedAt`. Both `0` when nothing diverged. */
  readonly expected: number;
  readonly actual: number;
}

/**
 * Replay a recorded session and report the first tick at which this build stopped agreeing with
 * the recording.
 *
 * Synchronous, allocation-free per tick, and as fast as the machine — there is no clock to wait
 * for, because there is no clock: it builds its own `manualClock` and `manualFrames`, advances
 * by exactly one step per pump (so the catch-up clamp is never in play and the arithmetic is
 * identical to a live session), and pumps `'tick'` only. **Nothing is painted.**
 *
 * @throws RangeError if `source.ticks` is not a non-negative integer, if `hz` is out of range,
 *   or if `source.stepMs` disagrees with the step `hz` produces.
 * @throws TypeError if `source`, `update` or `hash` is missing or the wrong shape.
 * @throws whatever `update` throws — the loop stops itself first, so a thrown replay leaves
 *   nothing running.
 */
export function replay(options: ReplayOptions): ReplayResult {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`replay: expected an options object, got ${String(options)}`);
  }
  const source = options.source;
  if (
    source === null ||
    typeof source !== 'object' ||
    typeof source.applyAt !== 'function' ||
    typeof source.checkpointAt !== 'function'
  ) {
    throw new TypeError(
      'replay.source: expected { ticks, applyAt(tick), checkpointAt(tick) } — the driver is defined against a structural source so that layer 1 never imports @latticekit/persist',
    );
  }
  if (typeof options.update !== 'function') {
    throw new TypeError('replay.update: expected the same update function the live game runs');
  }
  if (typeof options.hash !== 'function') {
    throw new TypeError(
      'replay.hash: expected a function returning a Tier A state hash — without one a replay can only report that it did not crash',
    );
  }
  expectInt(source.ticks, 'replay.source.ticks');
  if (source.ticks < 0) {
    throw new RangeError(
      `replay.source.ticks: expected a non-negative integer, got ${String(source.ticks)}`,
    );
  }

  const stopOnDivergence = options.stopOnDivergence ?? true;
  const onProgress = options.onProgress;
  const hash = options.hash;

  const clock = manualClock(0);
  const frames = manualFrames();
  // `createLoop` validates `hz` and names it; passing it through keeps one implementation of
  // that rule rather than a second copy that could drift.
  const loop = createLoop(
    options.hz === undefined
      ? { clock, frames }
      : { clock, frames, hz: options.hz },
  );

  if (source.stepMs !== undefined && source.stepMs !== loop.stepMs) {
    throw new RangeError(
      `replay: the log was recorded at stepMs ${String(source.stepMs)} and this replay runs at ${String(loop.stepMs)} — a log keyed by tick index means nothing if a tick is a different length than it was when the log was made. Replay it at the hz it was recorded at, or migrate the log`,
    );
  }

  let checkpoints = 0;
  let divergedAt = -1;
  let expected = 0;
  let actual = 0;
  let halt = false;

  // Registration order is the contract: inputs, then the game, then the checkpoint. Applying a
  // tick's inputs after its update is the first of the four ways to build a driver that reports
  // a confident wrong answer.
  loop.onUpdate((_dt, at) => {
    source.applyAt(at);
  });
  loop.onUpdate(options.update);
  loop.onUpdate((_dt, at) => {
    const recorded = source.checkpointAt(at);
    if (recorded === undefined) return;
    checkpoints += 1;
    const computed = hash();
    if (computed === recorded || divergedAt !== -1) return;
    divergedAt = at;
    expected = recorded;
    actual = computed;
    if (stopOnDivergence) halt = true;
  });

  loop.start();
  // Exactly one step per pump: `advance(stepMs)` enters the accumulator as exactly `stepUs`,
  // because both are the same integer number of microseconds expressed in different units.
  while (!halt && loop.tick < source.ticks) {
    clock.advance(loop.stepMs);
    frames.pump('tick');
    if (onProgress !== undefined && loop.tick % PROGRESS_EVERY_TICKS === 0) onProgress(loop.tick);
  }
  loop.stop();
  if (onProgress !== undefined && loop.tick % PROGRESS_EVERY_TICKS !== 0) onProgress(loop.tick);

  return { ticks: loop.tick, checkpoints, divergedAt, expected, actual };
}
