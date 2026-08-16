import { bench, describe } from 'vitest';
import { hashParts } from '@lattice/core';
import { createRecorder, createVerifier, type Digest, type ReplayCompat, type ReplayLog } from '../src/replay.js';

/**
 * `mark` is called every tick for a whole session — 216,000 times in an hour at 60 Hz — so the
 * ticks that do *not* checkpoint must cost a comparison and nothing else. That is the reason
 * both `Recorder.mark` and `ReplayVerifier.mark` return a boolean rather than a result object:
 * one allocation per tick is a garbage-collector pause with a pleasant signature.
 */

interface World {
  readonly coin: number;
  readonly buildings: number;
}

const digest: Digest<World> = (state) => hashParts(state.coin, state.buildings);
const state: World = { coin: 123456, buildings: 40 };

interface Log extends ReplayCompat {
  readonly version: number;
  readonly stepMs: number;
  readonly profile: string;
}
const inputs: Log = { version: 1, stepMs: 1000 / 60, profile: 'default' };

describe('the per-tick path', () => {
  const recorder = createRecorder<World>({
    kit: '0.1.0',
    game: 'bench',
    rng: { seed: 1, state: 1 },
    startTick: 0,
    digest,
    checkpointEvery: 600,
  });
  recorder.mark(0, state);

  bench('Recorder.mark — a tick with no checkpoint due', () => {
    recorder.mark(1, state);
  });

  const recorded: ReplayLog<Log> = createRecorder<World>({
    kit: '0.1.0',
    game: 'bench',
    rng: { seed: 1, state: 1 },
    startTick: 0,
    digest,
    checkpointEvery: 600,
  }).stop(0, state, inputs);

  const verifier = createVerifier<World, Log>(recorded, {
    kit: '0.1.0',
    game: 'bench',
    inputs,
    digest,
  });

  bench('ReplayVerifier.mark — a tick with no checkpoint due', () => {
    verifier.mark(1, state);
  });
});

describe('the checkpoint itself', () => {
  bench('digest + push, the one tick in 600 that costs anything', () => {
    const recorder = createRecorder<World>({
      kit: '0.1.0',
      game: 'bench',
      rng: { seed: 1, state: 1 },
      startTick: 0,
      digest,
      checkpointEvery: 1,
    });
    recorder.mark(0, state);
    recorder.mark(1, state);
  });
});
