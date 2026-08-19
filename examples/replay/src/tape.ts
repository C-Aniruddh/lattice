/**
 * The tape: `input` records it, `persist` stores and verifies it, `loop` drives it.
 *
 * `docs/SEAMS.md` splits replay three ways along the DAG and has each side declare the others
 * *structurally* rather than importing them, which leaves exactly one job for the game: to be
 * the place the three shapes meet. That join is {@link rerun}'s `source` literal — `applyAt`
 * comes from `input`'s cursor, `checkpointAt` comes from `persist`'s log, and `loop`'s driver
 * has never heard of either of them. **The tick index is the join**, and it is the only thing
 * the three of them agree about.
 *
 * Three things in here are decisions rather than plumbing.
 *
 * **The verifier is asked before a cursor exists.** `createVerifier` answers *may this be
 * replayed at all* — kit build, game build, log version, `stepMs`, gesture profile — and names
 * the field that differed. `replayCursor` refuses the same mismatch by *throwing*, and a refusal
 * that arrives as an exception is a refusal nobody can put on screen.
 *
 * **The camera is restored before every `applyAt`, not after.** A sample carries `sx`/`sy`, and
 * the tile it means is resolved through the camera at the moment the tick closes — so the view
 * has to be the recorded one before the bucket is delivered, or the seeds land somewhere else.
 * `marsh.viewAt` is why that is three lines here instead of a field the kit has no room for.
 *
 * **The log goes through the store and comes back out before anything replays it.** `persist`
 * stores and verifies; a tape that was verified in memory and never written proves half of that.
 */

import { asEpochMillis, createRng } from '@latticekit/core';
import type { Camera } from '@latticekit/iso';
import { createHeadlessInput, createLog, fixedStep, record, replayCursor, type InputLog, type InputSystem } from '@latticekit/input';
import { replay } from '@latticekit/loop';
import { createRecorder, createStore, createVerifier, memoryStorage, migrations, type ReplayLog, type ReplayVerdict } from '@latticekit/persist';
import { MAX_HEIGHT_PX, createMarsh, digest, plant, step, viewAt, type Marsh } from './marsh.js';

/** The build this exhibit claims to be. A divergence against an unknown build is theatre. */
const KIT = '0.1.0', GAME = 'marsh@1', KEY = 'replay.take';
export const ACTIONS = { seed: ['tap'] } as const;

export type Tape = { log: ReplayLog<InputLog>; bytes: number };
export type Run = { marsh: Marsh; ticks: number; ms: number; verdict: ReplayVerdict };

const adapter = memoryStorage();
// A chain with **no rungs**: floor equals head, so a tape in an older format reads as `orphaned`
// rather than being migrated into a confident wrong answer. A save is progress and is migrated at
// almost any cost; a replay is evidence, and evidence that has been migrated is no longer
// evidence — and "never migrate" turns out to be expressible in the machinery already here.
const recognise = (v: unknown): ReplayLog<InputLog> | null =>
  v !== null && typeof v === 'object' && 'checkpoints' in v ? (v as ReplayLog<InputLog>) : null;
const store = createStore({ key: KEY, adapter, fresh: () => null, minWriteIntervalMs: 0,
  now: () => asEpochMillis(Date.now()), chain: migrations(1, recognise).seal() });
store.open();

/** Open a tape around a live session. Recording costs one small object per sample. */
export function startRecording(input: InputSystem<'seed'>, seed: number, every: number) {
  const samples = record(input);
  const recorder = createRecorder<Marsh>({ kit: KIT, game: GAME, startTick: 0, digest,
    rng: createRng(seed).snapshot(), checkpointEvery: every });
  return {
    /** Called after the world stepped: a checkpoint is the state at the *end* of its tick. */
    mark: recorder.mark,
    seal(tick: number, m: Marsh): Tape {
      const written = store.save(recorder.stop(tick, m, samples.stop()));
      // Decoded back out of the bytes that were stored, so the tape a scrub replays is the one
      // that survived the envelope and the checksum, not the one that was still in hand.
      const back = store.decode(adapter.get(KEY) ?? '').state;
      if (back === null) throw new Error('the tape did not survive its own store');
      return { log: back, bytes: written.bytes };
    },
  };
}

/**
 * Re-run the tape from tick 0 to `upTo`, and report whether this build still agrees with it.
 *
 * Synchronous, allocation-light per tick, nothing painted, and a fresh marsh every time —
 * **this is a re-run, not a lookup.** The scrub bar calls it on every pointer move for exactly
 * that reason: a bar that remembers what the world looked like proves nothing, and the way to be
 * sure it is not remembering is that it costs something, in milliseconds, on screen.
 */
export function rerun(tape: Tape, camera: Camera, seed: number, upTo: number, build: string): Run {
  const marsh = createMarsh(seed);
  const { endTick, inputs } = tape.log;
  const system = createHeadlessInput({
    camera, step: fixedStep(build === 'hz' ? 50 : 60), actions: ACTIONS, control: false,
    profile: { tapSlopPx: { mouse: build === 'slop' ? 14 : 4 } },
    terrain: { field: marsh.field, maxHeightPx: MAX_HEIGHT_PX },
  });
  const verifier = createVerifier<Marsh, InputLog>(tape.log,
    { kit: KIT, game: GAME, inputs: createLog(system), digest });
  if (verifier.finish().refused !== null) { system.dispose(); return { marsh, ticks: 0, ms: 0, verdict: verifier.finish() }; }
  system.onAction('seed', (e) => void plant(marsh, e.gx, e.gy, e.tick));
  const cursor = replayCursor(system, inputs);
  const started = performance.now();
  // `loop` drives and `persist` verifies, so the driver is given no checkpoints of its own: it
  // would otherwise run a second, parallel comparison of the same digests against the same log,
  // and two verdicts that can disagree are worse than one. `update` is the same call the live
  // session makes, followed by the same per-tick mark — the recorder's on the way in, the
  // verifier's on the way back.
  const result = replay({
    source: {
      ticks: (upTo < endTick ? upTo : endTick) + 1, stepMs: inputs.stepMs, checkpointAt: () => undefined,
      applyAt(tick) { viewAt(camera, tick); cursor.applyAt(tick); },
    },
    update: (_dt, tick) => { step(marsh, tick); verifier.mark(tick, marsh); },
    hash: () => digest(marsh),
  });
  system.dispose();
  return { marsh, ticks: result.ticks, ms: performance.now() - started, verdict: verifier.finish() };
}
