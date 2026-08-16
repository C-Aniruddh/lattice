/**
 * Replay: the kit's headline claim, made falsifiable.
 *
 * `AGENTS.md` #1 promises that a session replays from a seed and an input log and lands on
 * the same pixel. Nothing owned that, which made the claim unfalsifiable — the worst state
 * for a kit selling determinism, because it is either the best feature or a lie and nothing
 * decides which. A replay is a save with a different payload: it needs a version, integrity,
 * and an envelope, and all three already live here.
 *
 * ## A replay is evidence, and evidence is never migrated
 *
 * Everything in `migrate.ts` argues that a save must survive at almost any cost. **A replay
 * takes the opposite policy**, and a reader arriving from there will assume otherwise, so it
 * is stated here as a contrast rather than left to be inferred.
 *
 * A save is a player's progress, and progress that cannot be read is a loss the player feels.
 * A replay is *evidence*, and evidence that has been migrated is no longer evidence. A
 * session recorded at a 16.667 ms step and replayed at 20 ms will not land on the same pixel;
 * a session recorded under a tap threshold of 8 px and replayed at 12 px turns one pointer
 * stream into a different sequence of actions. "Migrating" either would produce a **confident
 * wrong answer**, and a divergence report that cannot be trusted puts the determinism claim
 * back where it started while looking like it has been tested.
 *
 * | | **save** | **replay** |
 * |---|---|---|
 * | old format | migrated, rung by rung | **refused** — `orphaned` |
 * | mechanism | a chain with rungs from floor to head | a chain with **no rungs**: `migrations(N, isLog).seal()`, floor === head |
 * | near-miss | tolerated; a recogniser may normalise as it validates | **refused**, exactly: `version`, `stepMs` and `profile` are compared for equality and the differing field is named |
 * | failure costs | a player's campus | a test result nobody should have trusted |
 *
 * The mechanism is worth noticing: **"never migrate" is expressible in the machinery already
 * here, as a chain with zero rungs.** A replay store is an ordinary `createStore` whose chain
 * has floor equal to head, so a replay in an older format reads as `orphaned` — an existing
 * failure reason, already meaning "older than anything this build will read", already
 * degrading without a throw. No second code path, and no exception to the read pipeline.
 *
 * The compatibility triple is checked in a second, separate place — `createVerifier`, before
 * the first tick — because the two refusals answer different questions. `orphaned` means
 * *this build cannot read the file*. A `Refusal` means *the file is readable and was recorded
 * under conditions this build does not reproduce*. Collapsing them would lose the distinction
 * that tells you whether to go and find an older build or go and fix the step.
 *
 * ## What is not here, and where it went
 *
 * The **cursor** that plays a log back belongs to `@lattice/input`: this package stores the
 * log verbatim, which necessarily means opaquely, and a package that cannot see inside a
 * structure cannot iterate it. The **driver** — constructing a game, restoring the rng
 * snapshot, turning the fixed-step crank — belongs to `@lattice/loop`, which this package may
 * not import. `persist` hands over a log and a verifier; `loop` turns the crank.
 */

import type { RngSnapshot } from '@lattice/core';

/** Ten seconds at 60 Hz. Long enough to be cheap, short enough to bracket a bug usefully. */
const DEFAULT_CHECKPOINT_EVERY = 600;

/**
 * The only three fields this package reads out of a recorded input log.
 *
 * `@lattice/input` owns the log's shape and `persist` may not import it — input is layer 2 and
 * this is layer 1, so the edge does not exist. This structural constraint is therefore the
 * entire coupling between them: three fields, compared for exact equality, never interpreted.
 * Everything else about a log is opaque here and is stored verbatim.
 */
export interface ReplayCompat {
  /** The input log's own format version. */
  readonly version: number;
  /**
   * The fixed step the session was recorded at. A replay driven at a different step is a
   * different simulation, however similar it looks — which is why this is compared for
   * equality and never coerced.
   */
  readonly stepMs: number;
  /**
   * The gesture/binding profile in force. A tap threshold that moved turns one recorded
   * pointer stream into a different sequence of actions.
   */
  readonly profile: string;
}

/**
 * "The same pixel", reduced to a uint32.
 *
 * The game supplies it because only the game knows what is canonical: the wallet and the
 * building list, probably; a camera position and a tween phase, definitely not, or every
 * replay diverges the first time somebody scrolls. Build it from `core`'s `hashParts`, and
 * keep it **Tier A** — a digest that reaches `Math.pow` may disagree in the last bit between
 * two conforming engines, and a determinism check that fails on a different browser is worse
 * than none.
 */
export type Digest<T> = (state: T) => number;

/**
 * Eight bytes. The interval between them trades log size against how tightly a divergence can
 * be bracketed — a checkpoint every ten seconds means "somewhere in these 600 ticks".
 */
export interface Checkpoint {
  readonly tick: number;
  readonly digest: number;
}

/**
 * A recorded session: a starting stream, an input log, and the digests that make the claim
 * checkable.
 *
 * Store it in an ordinary `createStore` whose chain has **no rungs**, so an old one reads as
 * `orphaned` rather than being migrated into a confident wrong answer.
 */
export interface ReplayLog<L extends ReplayCompat> {
  /**
   * The kit build this was recorded under. A divergence against an unknown build is
   * unattributable, and an unattributable divergence report is theatre.
   */
  readonly kit: string;
  /** The game's own build identity, however the game versions itself. */
  readonly game: string;
  /**
   * The stream the session started from, **cursor included** — not just the seed. A log that
   * restores a seed but not the cursor re-rolls every draw the session had already spent, and
   * it looks correct for the first few draws, which is what makes it expensive.
   */
  readonly rng: RngSnapshot;
  readonly startTick: number;
  readonly endTick: number;
  /**
   * The input log, **verbatim**. Never rewritten, never normalised, never migrated.
   *
   * `stepMs` and `profile` live in here rather than being copied up to this level,
   * deliberately: a duplicated field is a field that can disagree with itself, and the copy
   * that disagrees is always the one the check reads.
   */
  readonly inputs: L;
  /** Ascending by tick. */
  readonly checkpoints: readonly Checkpoint[];
}

/** What a recorder needs to know before the first tick. */
export interface RecorderOptions<T> {
  readonly kit: string;
  readonly game: string;
  /** The stream's full state at `startTick`, cursor included. */
  readonly rng: RngSnapshot;
  readonly startTick: number;
  readonly digest: Digest<T>;
  /** Ticks between checkpoints. Default 600 — ten seconds at 60 Hz. */
  readonly checkpointEvery?: number;
}

/**
 * Records checkpoints, and nothing else.
 *
 * It does not record inputs: `@lattice/input` already keeps a per-tick bucketed log keyed by
 * an integer tick index, and a second recorder here would be a second copy of the same data
 * with its own ordering bugs. The game hands that log over once, at `stop`.
 *
 * Checkpoints are **digests, not states**. Storing states would make a replay a save-scumming
 * format and a hundred times larger, and would answer a question nothing asked ("what did it
 * look like") in place of the one that matters ("did it diverge").
 */
export interface Recorder<T> {
  /**
   * Advance to `tick`, taking a checkpoint if one is due. Returns whether it took one.
   *
   * **A boolean, not a result object**: this is called every tick for the whole session, and
   * `digest` runs only on the ticks that actually checkpoint.
   *
   * A no-op returning `false` after `stop()`. Ticks that arrive out of order or behind the
   * next due point are ignored rather than rejected, because a driver that skipped is a
   * driver problem and losing the recording is not the proportionate answer.
   */
  mark(tick: number, state: T): boolean;
  readonly checkpointCount: number;
  /**
   * Take a final checkpoint and seal the log around the input log you pass in. **Idempotent**:
   * the second call returns the first call's log and ignores its arguments, so a driver that
   * stops in both a normal path and a teardown path does not record two different endings.
   */
  stop<L extends ReplayCompat>(tick: number, state: T, inputs: L): ReplayLog<L>;
}

/**
 * Why a replay was not run. **A refusal is never a pass**, and the field that differed is
 * named because "incompatible" sends someone reading five things to find out which one.
 */
export type Refusal =
  | {
      readonly kind: 'mismatch';
      readonly field: 'kit' | 'game' | 'log-version' | 'stepMs' | 'profile';
      readonly recorded: string | number;
      readonly current: string | number;
    }
  | { readonly kind: 'no-checkpoints' };

/** Where two runs first disagreed, and the bracket the bug is inside. */
export interface Divergence {
  /** The checkpoint tick where the digests first disagreed. */
  readonly tick: number;
  /**
   * The last tick known to agree. **The bug is between these two numbers** — which is the
   * entire value of a checkpoint interval, and why the report leads with the bracket.
   */
  readonly lastAgreedTick: number;
  readonly expected: number;
  readonly actual: number;
  readonly checkpointIndex: number;
}

/** The answer. `matched` is true only if every recorded checkpoint was checked and agreed. */
export interface ReplayVerdict {
  /**
   * True only when every checkpoint in the log was reached and agreed. A driver that stopped
   * early reports `false` with no divergence, because a verifier that reported green over
   * checkpoints it never visited is the same failure as one that reported green because it
   * refused to check.
   */
  readonly matched: boolean;
  readonly checkpointsChecked: number;
  /**
   * The **first** divergence only. Every later one is a consequence of this one, and reporting
   * them is noise that buries the line that matters.
   */
  readonly divergence: Divergence | null;
  /**
   * Non-null means the replay was declined before it started. `matched` is then `false`, never
   * `true` — a verifier that reported green because it had refused to check is exactly how a
   * determinism claim rots into a slogan.
   */
  readonly refused: Refusal | null;
}

/** Drives digest comparisons tick by tick. One per replay attempt; not reusable. */
export interface ReplayVerifier<T> {
  /**
   * Compare at `tick` if a checkpoint is due there. Returns `false` once it has diverged or
   * refused, so a driver can stop immediately rather than run an hour of ticks past the
   * answer.
   */
  mark(tick: number, state: T): boolean;
  finish(): ReplayVerdict;
}

/**
 * Start recording checkpoints for a session.
 *
 * @throws TypeError if `digest` is not a function — without one there is nothing to compare
 *   and the recording would be a log that always matches.
 * @throws RangeError if `checkpointEvery` is not a positive integer. Zero would checkpoint
 *   every tick and make the log the size of the session.
 */
export function createRecorder<T>(options: RecorderOptions<T>): Recorder<T> {
  const { kit, game, rng, startTick, digest } = options;
  if (typeof digest !== 'function') {
    throw new TypeError(`createRecorder: expected a digest function, got ${String(digest)}`);
  }
  const every = options.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY;
  if (!Number.isInteger(every) || every <= 0) {
    throw new RangeError(`createRecorder: expected checkpointEvery to be an integer > 0, got ${String(every)}`);
  }

  const checkpoints: Checkpoint[] = [];
  let nextDue = startTick;
  let sealed: ReplayLog<ReplayCompat> | null = null;

  return {
    mark(tick: number, state: T): boolean {
      if (sealed !== null || tick < nextDue) return false;
      checkpoints.push({ tick, digest: digest(state) });
      nextDue = tick + every;
      return true;
    },

    get checkpointCount(): number {
      return checkpoints.length;
    },

    stop<L extends ReplayCompat>(tick: number, state: T, inputs: L): ReplayLog<L> {
      // The second `stop` returns the first one's log. `L` was fixed by that first call and
      // erased here; re-claiming it is safe because the sealed log's `inputs` is the very
      // object the caller handed over, and a caller stopping twice with two different log
      // types has a bigger problem than this cast.
      if (sealed !== null) return sealed as ReplayLog<L>;
      const last = checkpoints[checkpoints.length - 1];
      if (last === undefined || last.tick !== tick) {
        checkpoints.push({ tick, digest: digest(state) });
      }
      const log: ReplayLog<L> = {
        kit,
        game,
        rng: { seed: rng.seed, state: rng.state },
        startTick,
        endTick: tick,
        inputs,
        checkpoints: [...checkpoints],
      };
      sealed = log;
      return log;
    },
  };
}

/** One compatibility comparison. Five of these run, in order, before the first tick. */
function mismatch(
  field: 'kit' | 'game' | 'log-version' | 'stepMs' | 'profile',
  recorded: string | number,
  current: string | number,
): Refusal | null {
  return recorded === current ? null : { kind: 'mismatch', field, recorded, current };
}

/**
 * Build the verifier for a log, against **this** build's identity and input configuration.
 *
 * The compatibility check is exact equality on five values and runs before the first tick. It
 * is not a migration and there is no coercion: a near-miss is refused by name, because the
 * alternative is a divergence report nobody should trust.
 *
 * Pass `current.inputs` read off a **freshly created input log** rather than typed out at the
 * call site, so the recorded and current triples cannot drift apart in a refactor.
 */
export function createVerifier<T, L extends ReplayCompat>(
  log: ReplayLog<L>,
  current: {
    readonly kit: string;
    readonly game: string;
    readonly inputs: ReplayCompat;
    readonly digest: Digest<T>;
  },
): ReplayVerifier<T> {
  const refused: Refusal | null =
    mismatch('kit', log.kit, current.kit) ??
    mismatch('game', log.game, current.game) ??
    mismatch('log-version', log.inputs.version, current.inputs.version) ??
    mismatch('stepMs', log.inputs.stepMs, current.inputs.stepMs) ??
    mismatch('profile', log.inputs.profile, current.inputs.profile) ??
    (log.checkpoints.length === 0 ? { kind: 'no-checkpoints' } : null);

  let index = 0;
  let divergence: Divergence | null = null;

  return {
    mark(tick: number, state: T): boolean {
      if (refused !== null || divergence !== null) return false;
      const checkpoint = log.checkpoints[index];
      if (checkpoint === undefined || checkpoint.tick !== tick) return true;
      const actual = current.digest(state);
      if (actual !== checkpoint.digest) {
        const previous = index === 0 ? undefined : log.checkpoints[index - 1];
        divergence = {
          tick: checkpoint.tick,
          lastAgreedTick: previous === undefined ? log.startTick : previous.tick,
          expected: checkpoint.digest,
          actual,
          checkpointIndex: index,
        };
        return false;
      }
      index += 1;
      return true;
    },

    finish(): ReplayVerdict {
      return {
        matched: refused === null && divergence === null && index === log.checkpoints.length,
        checkpointsChecked: index,
        divergence,
        refused,
      };
    },
  };
}
