/**
 * Recording a session, and playing one back.
 *
 * **`input` records, `persist` stores and verifies, `loop` drives.** Nobody owned replay and
 * the constitution's headline claim was therefore unfalsifiable; it is split three ways along
 * the dependency graph, with each side declaring the others *structurally* rather than
 * importing them. That is why {@link ReplayCursor} is written out here instead of imported:
 * `loop` is layer 1 and this package is layer 2, so the edge does not exist and must not be
 * invented.
 *
 * ## Why a log is a list of samples and not a list of events
 *
 * A stream of timestamped browser events is **not** a replay log. Replayed against a
 * fixed-step loop whose pumps fall differently, the same events land in different ticks and the
 * run diverges — so the log is bucketed to ticks at capture time, and is replayable by
 * construction rather than by luck. There is not one wall-clock timestamp in this file, and
 * there is nothing here that could produce one.
 *
 * ## The compatibility triple
 *
 * `version`, `stepMs`, `profile`. Compared for **exact equality** and refused rather than
 * migrated, because a session recorded at a 16.667 ms step and replayed at 20 ms will not land
 * on the same pixel, and a session recorded under a tap threshold of 8 px and replayed at 12 px
 * turns one pointer stream into a different sequence of actions. A migrated input log is a log
 * that no longer replays, and a divergence report nobody should trust is worse than no report.
 *
 * Read the triple off {@link createLog} rather than typing it at a call site, so the recorded
 * and the current cannot drift apart in a refactor.
 */

import { LOG_VERSION } from './sample.js';
import type { InputLog, RawSample } from './sample.js';
import { internalsOf } from './system.js';
import type { InputSystem } from './system.js';

/**
 * A running recording. `stop()` returns the finished log for `persist` to put in an envelope.
 *
 * Idempotent: the second `stop()` returns the first one's log, so a game that stops in both a
 * normal path and a teardown path does not record two different endings.
 */
export interface InputRecording {
  stop(): InputLog;
}

/**
 * A recorded log, seen the way `@lattice/loop`'s replay driver sees it.
 *
 * Structurally identical to that package's `ReplaySource`, and deliberately not imported from
 * it. The driver calls {@link applyAt} exactly once per tick, in ascending order, **before**
 * that tick's update — which is exactly the contract `InputSystem.tick` wants, and is the whole
 * reason this shape is worth conforming to rather than inventing a fourth one.
 */
export interface ReplayCursor {
  /** Ticks recorded. The replay ends here, and ending is the point. */
  readonly ticks: number;
  /** The step the log was recorded at, so the driver can refuse a mismatch by name. */
  readonly stepMs: number;
  /**
   * Submit everything recorded for one tick, then close it.
   *
   * Allocates nothing: the cursor is one integer into the log's array. Call it once per tick in
   * ascending order; a driver that applied inputs one tick late would produce a divergence
   * report that blames the game for the driver's bug.
   *
   * Ticks past the end of the log deliver an empty bucket rather than throwing, because a
   * driver running longer than the recording is a legitimate thing to do and a crash is not a
   * useful answer to it.
   */
  applyAt(tick: number): void;
  /**
   * Always `undefined`. Checkpoints are digests of **game state**, which this package cannot
   * see and must not guess at; `@lattice/persist`'s `Recorder` owns them. Present so this
   * satisfies the driver's shape without a wrapper object at the call site.
   */
  checkpointAt(tick: number): number | undefined;
}

/**
 * An empty log carrying this system's compatibility triple.
 *
 * The value to hand `@lattice/persist`'s `createVerifier` as `current.inputs`: read off a live
 * system rather than typed out, so the recorded triple and the current one cannot disagree
 * without the system itself having changed.
 */
export function createLog<A extends string>(system: InputSystem<A>): InputLog {
  const internals = internalsOf(system);
  return {
    version: LOG_VERSION,
    stepMs: internals.stepMs,
    profile: internals.fingerprint,
    samples: [],
  };
}

/**
 * Begin recording every sample this system receives, plus a marker per tick.
 *
 * Recording costs one small object per sample and nothing at all when it is off — a game that
 * never calls this pays for none of it.
 *
 * @throws RangeError if this system is already recording. Two recorders sharing one sample
 *   stream produce two logs that each claim to be the whole session.
 * @throws TypeError if `system` did not come from this package.
 */
export function record<A extends string>(system: InputSystem<A>): InputRecording {
  const internals = internalsOf(system);
  internals.start();
  let sealed: InputLog | undefined;
  return {
    stop(): InputLog {
      if (sealed !== undefined) return sealed;
      sealed = {
        version: LOG_VERSION,
        stepMs: internals.stepMs,
        profile: internals.fingerprint,
        samples: internals.stop(),
      };
      return sealed;
    },
  };
}

/**
 * Refuse a log this system cannot reproduce, naming the field that differs.
 *
 * @throws RangeError on any of the three. `TypeError` if the log is not an object with a
 *   `samples` array — a log that arrived as `undefined` from a storage miss would otherwise
 *   replay as a session in which the player did nothing, and report green.
 */
export function checkCompatible<A extends string>(system: InputSystem<A>, log: InputLog): void {
  const internals = internalsOf(system);
  if (log === null || typeof log !== 'object' || !Array.isArray(log.samples)) {
    throw new TypeError(
      'replay: expected an InputLog with a samples array — a missing log replays as a session in which the player did nothing, and reports green',
    );
  }
  if (log.version !== LOG_VERSION) {
    throw new RangeError(
      `replay: the log was recorded by input log version ${String(log.version)} and this build writes version ${String(LOG_VERSION)} — recognition rules change with the version, so this is a refusal and not a migration`,
    );
  }
  if (log.stepMs !== internals.stepMs) {
    throw new RangeError(
      `replay: the log was recorded at stepMs ${String(log.stepMs)} and this system runs at ${String(internals.stepMs)} — every gesture duration in the log is counted in ticks of the recorded step`,
    );
  }
  if (log.profile !== internals.fingerprint) {
    throw new RangeError(
      `replay: the log was recorded under a different gesture profile.\n  recorded: ${String(log.profile)}\n   current: ${internals.fingerprint}\nThe same finger movements under different thresholds are a different session, not the same one played back`,
    );
  }
}

/**
 * Feed a recorded log back in, tick by tick, using the log's own tick indices.
 *
 * Synchronous and complete when it returns: every sample submitted, every tick closed, every
 * handler run. The system must be fresh — replaying into one that has already ticked past the
 * log's first index is refused by `InputSystem.tick`, which is the honest failure.
 *
 * @throws RangeError naming the mismatch if the log's `version`, `stepMs` or `profile` differs
 *   from the system's. Replaying a log under different thresholds is not a replay; it is a
 *   different game with the same finger movements.
 */
export function replay<A extends string>(system: InputSystem<A>, log: InputLog): void {
  checkCompatible(system, log);
  for (const sample of log.samples) {
    if (sample.kind === 'tick') system.tick(sample.index);
    else system.submit(sample);
  }
}

/**
 * A cursor over a log, for `@lattice/loop`'s replay driver.
 *
 * Unlike {@link replay}, this closes each tick with the **driver's** index rather than the
 * log's. The two agree for a session recorded from tick 0, which is every session a game
 * records; where they do not — a recording started mid-game — what matters is that the *gaps*
 * between markers are preserved, and consuming exactly one marker per call preserves them.
 *
 * @throws RangeError naming the mismatch if the compatibility triple differs.
 */
export function replayCursor<A extends string>(
  system: InputSystem<A>,
  log: InputLog,
): ReplayCursor {
  checkCompatible(system, log);
  const samples: readonly RawSample[] = log.samples;
  let ticks = 0;
  for (const sample of samples) if (sample.kind === 'tick') ticks += 1;
  let cursor = 0;

  return {
    ticks,
    stepMs: log.stepMs,
    applyAt(tick: number): void {
      while (cursor < samples.length) {
        const sample = samples[cursor];
        if (sample === undefined) break;
        cursor += 1;
        if (sample.kind === 'tick') {
          system.tick(tick);
          return;
        }
        system.submit(sample);
      }
      // Past the end of the recording: an empty bucket, so a driver running longer than the log
      // still advances the game rather than silently repeating the last tick's input.
      system.tick(tick);
    },
    checkpointAt(): number | undefined {
      return undefined;
    },
  };
}
