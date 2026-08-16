import { describe, expect, it } from 'vitest';
import { asEpochMillis, createRng, hashParts, type RngSnapshot } from '@lattice/core';
import { memoryStorage } from '../src/adapters.js';
import { migrations, type Recognise } from '../src/migrate.js';
import { createStore } from '../src/store.js';
import {
  createRecorder,
  createVerifier,
  type Digest,
  type ReplayCompat,
  type ReplayLog,
} from '../src/replay.js';

/** A game state small enough to reason about and canonical enough to digest. */
interface World {
  readonly coin: number;
  readonly buildings: number;
  /** Presentation only. A digest that included this would diverge the first time anyone scrolled. */
  readonly cameraX: number;
}

const digest: Digest<World> = (state) => hashParts(state.coin, state.buildings);

/** `@lattice/input` owns this shape; this package reads three fields and interprets none. */
interface Log extends ReplayCompat {
  readonly version: number;
  readonly stepMs: number;
  readonly profile: string;
  readonly frames: readonly (readonly [tick: number, action: string])[];
}

const inputs: Log = {
  version: 2,
  stepMs: 1000 / 60,
  profile: 'default',
  frames: [
    [0, 'tap'],
    [37, 'drag'],
    [900, 'tap'],
  ],
};

const rngAt = (state: number): RngSnapshot => ({ seed: 12345, state });

/** A session that steps the world deterministically, so a replay can be driven twice. */
function run(
  ticks: number,
  onTick: (tick: number, state: World) => void,
  perturbAt = Number.POSITIVE_INFINITY,
): World {
  let state: World = { coin: 0, buildings: 0, cameraX: 0 };
  for (let tick = 0; tick < ticks; tick += 1) {
    onTick(tick, state);
    state = {
      coin: state.coin + (tick === perturbAt ? 2 : 1),
      buildings: tick % 100 === 0 ? state.buildings + 1 : state.buildings,
      cameraX: state.cameraX + 3,
    };
  }
  // The terminal tick is marked with the terminal state, which is what `stop` seals around.
  onTick(ticks, state);
  return state;
}

describe('the recorder', () => {
  it('checkpoints at the start tick and every interval after it', () => {
    const recorder = createRecorder<World>({
      kit: '0.1.0',
      game: 'campus@3',
      rng: rngAt(7),
      startTick: 0,
      digest,
      checkpointEvery: 600,
    });

    const marked: number[] = [];
    const final = run(1500, (tick, state) => {
      if (recorder.mark(tick, state)) marked.push(tick);
    });

    expect(marked).toEqual([0, 600, 1200]);
    expect(recorder.checkpointCount).toBe(3);

    const log = recorder.stop(1500, final, inputs);
    expect(log.checkpoints.map((c) => c.tick)).toEqual([0, 600, 1200, 1500]);
    expect(log.startTick).toBe(0);
    expect(log.endTick).toBe(1500);
  });

  it('defaults to a checkpoint every 600 ticks — ten seconds at 60 Hz', () => {
    const recorder = createRecorder<World>({ kit: 'k', game: 'g', rng: rngAt(0), startTick: 0, digest });
    const marked: number[] = [];
    run(700, (tick, state) => {
      if (recorder.mark(tick, state)) marked.push(tick);
    });
    expect(marked).toEqual([0, 600]);
  });

  it('stores the rng cursor as well as the seed — the failure that looks correct at first', () => {
    const log = createRecorder<World>({ kit: 'k', game: 'g', rng: rngAt(918_273), startTick: 0, digest }).stop(
      0,
      { coin: 0, buildings: 0, cameraX: 0 },
      inputs,
    );
    expect(log.rng).toEqual({ seed: 12345, state: 918_273 });
  });

  it('copies the snapshot, so a stream that keeps drawing does not rewrite the recording', () => {
    const rng = createRng(4);
    rng.next();
    const snapshot = rng.snapshot();
    const log = createRecorder<World>({ kit: 'k', game: 'g', rng: snapshot, startTick: 0, digest }).stop(
      0,
      { coin: 0, buildings: 0, cameraX: 0 },
      inputs,
    );
    const before = { ...log.rng };
    rng.next();
    rng.next();
    expect(log.rng).toEqual(before);
  });

  it('is idempotent at stop, so two teardown paths do not record two endings', () => {
    const recorder = createRecorder<World>({ kit: 'k', game: 'g', rng: rngAt(0), startTick: 0, digest });
    const first = recorder.stop(10, { coin: 1, buildings: 1, cameraX: 0 }, inputs);
    const second = recorder.stop(99, { coin: 5, buildings: 5, cameraX: 0 }, inputs);
    expect(second).toBe(first);
    expect(second.endTick).toBe(10);
    expect(recorder.mark(1000, { coin: 9, buildings: 9, cameraX: 0 })).toBe(false);
  });

  it('does not take a duplicate final checkpoint when stop lands on one', () => {
    const recorder = createRecorder<World>({
      kit: 'k',
      game: 'g',
      rng: rngAt(0),
      startTick: 0,
      digest,
      checkpointEvery: 10,
    });
    const state: World = { coin: 0, buildings: 0, cameraX: 0 };
    recorder.mark(0, state);
    recorder.mark(10, state);
    const log = recorder.stop(10, state, inputs);
    expect(log.checkpoints.map((c) => c.tick)).toEqual([0, 10]);
  });

  it('ignores a tick behind the next due point rather than rejecting the recording', () => {
    const recorder = createRecorder<World>({
      kit: 'k',
      game: 'g',
      rng: rngAt(0),
      startTick: 100,
      digest,
      checkpointEvery: 50,
    });
    const state: World = { coin: 0, buildings: 0, cameraX: 0 };
    expect(recorder.mark(99, state)).toBe(false);
    expect(recorder.mark(100, state)).toBe(true);
    expect(recorder.mark(120, state)).toBe(false);
    expect(recorder.mark(150, state)).toBe(true);
  });

  it('refuses to be built without a digest or with a nonsense interval', () => {
    const base = { kit: 'k', game: 'g', rng: rngAt(0), startTick: 0 };
    expect(() => createRecorder<World>({ ...base, digest: undefined as unknown as Digest<World> })).toThrow(TypeError);
    expect(() => createRecorder<World>({ ...base, digest, checkpointEvery: 0 })).toThrow(RangeError);
    expect(() => createRecorder<World>({ ...base, digest, checkpointEvery: 1.5 })).toThrow(/integer > 0/);
  });
});

describe('the verifier', () => {
  function record(perturbAt = Number.POSITIVE_INFINITY): ReplayLog<Log> {
    const recorder = createRecorder<World>({
      kit: '0.1.0',
      game: 'campus@3',
      rng: rngAt(7),
      startTick: 0,
      digest,
      checkpointEvery: 600,
    });
    const final = run(1500, (tick, state) => recorder.mark(tick, state), perturbAt);
    return recorder.stop(1500, final, inputs);
  }

  const current = { kit: '0.1.0', game: 'campus@3', inputs, digest };

  it('matches a replay that lands on the same digest at every checkpoint', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, current);
    run(1500, (tick, state) => verifier.mark(tick, state));

    const verdict = verifier.finish();
    expect(verdict.matched).toBe(true);
    expect(verdict.divergence).toBe(null);
    expect(verdict.refused).toBe(null);
    expect(verdict.checkpointsChecked).toBe(log.checkpoints.length);
  });

  it('brackets the first divergence and reports no later one', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, current);
    // The replay diverges at tick 900; the next checkpoint is 1200 and the last agreed is 600.
    run(1500, (tick, state) => verifier.mark(tick, state), 900);

    const verdict = verifier.finish();
    expect(verdict.matched).toBe(false);
    expect(verdict.divergence?.tick).toBe(1200);
    expect(verdict.divergence?.lastAgreedTick).toBe(600);
    expect(verdict.divergence?.checkpointIndex).toBe(2);
    expect(verdict.divergence?.expected).not.toBe(verdict.divergence?.actual);
    expect(verdict.checkpointsChecked).toBe(2);
    expect(verdict.refused).toBe(null);
  });

  it('brackets a divergence at the very first checkpoint against the start tick', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, {
      ...current,
      digest: (state) => digest(state) + 1,
    });
    expect(verifier.mark(0, { coin: 0, buildings: 0, cameraX: 0 })).toBe(false);

    const verdict = verifier.finish();
    expect(verdict.divergence?.tick).toBe(0);
    expect(verdict.divergence?.lastAgreedTick).toBe(0);
    expect(verdict.divergence?.checkpointIndex).toBe(0);
  });

  it('stops answering once it has diverged, so a driver can quit immediately', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, { ...current, digest: () => 0 });
    expect(verifier.mark(0, { coin: 0, buildings: 0, cameraX: 0 })).toBe(false);
    expect(verifier.mark(600, { coin: 0, buildings: 0, cameraX: 0 })).toBe(false);
    expect(verifier.finish().divergence?.tick).toBe(0);
  });

  it('is not green when a driver stopped before every checkpoint was reached', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, current);
    run(600, (tick, state) => verifier.mark(tick, state));

    const verdict = verifier.finish();
    expect(verdict.matched).toBe(false);
    expect(verdict.divergence).toBe(null);
    expect(verdict.checkpointsChecked).toBe(2);
  });

  it('ignores ticks that are not checkpoints, and ticks past the last one', () => {
    const log = record();
    const verifier = createVerifier<World, Log>(log, current);
    expect(verifier.mark(1, { coin: 0, buildings: 0, cameraX: 0 })).toBe(true);
    run(1500, (tick, state) => verifier.mark(tick, state));
    expect(verifier.mark(9999, { coin: 0, buildings: 0, cameraX: 0 })).toBe(true);
    expect(verifier.finish().matched).toBe(true);
  });
});

describe('a refusal is never a pass', () => {
  const log = createRecorder<World>({
    kit: '0.1.0',
    game: 'campus@3',
    rng: rngAt(7),
    startTick: 0,
    digest,
    checkpointEvery: 600,
  });
  log.mark(0, { coin: 0, buildings: 0, cameraX: 0 });
  const recorded = log.stop(600, { coin: 600, buildings: 7, cameraX: 0 }, inputs);

  const cases: ReadonlyArray<{
    readonly field: 'kit' | 'game' | 'log-version' | 'stepMs' | 'profile';
    readonly current: { readonly kit: string; readonly game: string; readonly inputs: ReplayCompat };
    readonly recordedValue: string | number;
    readonly currentValue: string | number;
  }> = [
    {
      field: 'kit',
      current: { kit: '0.2.0', game: 'campus@3', inputs },
      recordedValue: '0.1.0',
      currentValue: '0.2.0',
    },
    {
      field: 'game',
      current: { kit: '0.1.0', game: 'campus@4', inputs },
      recordedValue: 'campus@3',
      currentValue: 'campus@4',
    },
    {
      field: 'log-version',
      current: { kit: '0.1.0', game: 'campus@3', inputs: { ...inputs, version: 3 } },
      recordedValue: 2,
      currentValue: 3,
    },
    {
      field: 'stepMs',
      current: { kit: '0.1.0', game: 'campus@3', inputs: { ...inputs, stepMs: 20 } },
      recordedValue: 1000 / 60,
      currentValue: 20,
    },
    {
      field: 'profile',
      current: { kit: '0.1.0', game: 'campus@3', inputs: { ...inputs, profile: 'touch' } },
      recordedValue: 'default',
      currentValue: 'touch',
    },
  ];

  it.each(cases)('refuses on $field by name, and never reports matched', ({ field, current, recordedValue, currentValue }) => {
    const verifier = createVerifier<World, Log>(recorded, { ...current, digest });
    expect(verifier.mark(0, { coin: 0, buildings: 0, cameraX: 0 })).toBe(false);

    const verdict = verifier.finish();
    expect(verdict.matched).toBe(false);
    expect(verdict.divergence).toBe(null);
    expect(verdict.refused).toEqual({ kind: 'mismatch', field, recorded: recordedValue, current: currentValue });
  });

  it('names five distinct fields — a report that says "incompatible" sends someone reading five things', () => {
    expect(new Set(cases.map((c) => c.field)).size).toBe(5);
  });

  it('refuses a log with no checkpoints at all', () => {
    const empty: ReplayLog<Log> = { ...recorded, checkpoints: [] };
    const verifier = createVerifier<World, Log>(empty, { kit: '0.1.0', game: 'campus@3', inputs, digest });
    expect(verifier.mark(0, { coin: 0, buildings: 0, cameraX: 0 })).toBe(false);
    expect(verifier.finish()).toEqual({
      matched: false,
      checkpointsChecked: 0,
      divergence: null,
      refused: { kind: 'no-checkpoints' },
    });
  });
});

describe('a replay round-trips its rng, and diverges when the cursor is dropped', () => {
  /** A session whose state depends on the stream, so the cursor is load-bearing. */
  function drive(snapshot: RngSnapshot, mark: (tick: number, state: World) => void): World {
    const rng = createRng(0).restore(snapshot);
    let state: World = { coin: 0, buildings: 0, cameraX: 0 };
    for (let tick = 0; tick <= 300; tick += 1) {
      mark(tick, state);
      state = { coin: state.coin + rng.int(0, 100), buildings: state.buildings, cameraX: 0 };
    }
    return state;
  }

  it('produces identical digests at every checkpoint when the snapshot is restored', () => {
    const source = createRng('a session already under way');
    for (let i = 0; i < 17; i += 1) source.next();
    const snapshot = source.snapshot();

    const recorder = createRecorder<World>({
      kit: 'k',
      game: 'g',
      rng: snapshot,
      startTick: 0,
      digest,
      checkpointEvery: 100,
    });
    const final = drive(snapshot, (tick, state) => {
      recorder.mark(tick, state);
    });
    const recorded = recorder.stop(300, final, inputs);

    const verifier = createVerifier<World, Log>(recorded, { kit: 'k', game: 'g', inputs, digest });
    drive(recorded.rng, (tick, state) => {
      verifier.mark(tick, state);
    });
    expect(verifier.finish().matched).toBe(true);
  });

  it('diverges when a replay restores the seed but not the cursor', () => {
    const source = createRng('a session already under way');
    for (let i = 0; i < 17; i += 1) source.next();
    const snapshot = source.snapshot();

    const recorder = createRecorder<World>({
      kit: 'k',
      game: 'g',
      rng: snapshot,
      startTick: 0,
      digest,
      checkpointEvery: 100,
    });
    const final = drive(snapshot, (tick, state) => {
      recorder.mark(tick, state);
    });
    const recorded = recorder.stop(300, final, inputs);

    const verifier = createVerifier<World, Log>(recorded, { kit: 'k', game: 'g', inputs, digest });
    // Seed only — the cursor rewound to the start of the stream. This is the failure that
    // looks correct for the first few draws, which is what makes it expensive.
    drive({ seed: recorded.rng.seed, state: recorded.rng.seed }, (tick, state) => {
      verifier.mark(tick, state);
    });

    const verdict = verifier.finish();
    expect(verdict.matched).toBe(false);
    expect(verdict.divergence).not.toBe(null);
  });
});

// ── the doctrine: a replay is evidence, and evidence is never migrated ───────────

describe('a replay store is an ordinary store whose chain has no rungs', () => {
  const isLog: Recognise<ReplayLog<Log>> = (value) => {
    const log = value as Partial<ReplayLog<Log>>;
    if (typeof log.kit !== 'string' || log.checkpoints === undefined || log.inputs === undefined) {
      throw new TypeError('replay: expected a ReplayLog with kit, inputs and checkpoints');
    }
    return log as ReplayLog<Log>;
  };

  function replayStore(version: number) {
    const adapter = memoryStorage();
    // floor === head. There is nowhere for a migration to go, by construction.
    const chain = migrations(version, isLog).seal();
    return {
      adapter,
      store: createStore({
        key: 'campus:replay:1',
        chain,
        adapter,
        // A replay store has no fresh state: there is no "new empty recording".
        fresh: (): ReplayLog<Log> | null => null,
        now: () => asEpochMillis(1000),
      }),
    };
  }

  const recorded = ((): ReplayLog<Log> => {
    const recorder = createRecorder<World>({
      kit: '0.1.0',
      game: 'campus@3',
      rng: rngAt(3),
      startTick: 0,
      digest,
      checkpointEvery: 100,
    });
    const final = run(200, (tick, state) => recorder.mark(tick, state));
    return recorder.stop(200, final, inputs);
  })();

  it('round-trips an input log through storage unchanged, field order included', () => {
    const { store } = replayStore(2);
    store.open();
    expect(store.save(recorded).written).toBe(true);

    const reopened = store.open();
    expect(reopened.source).toBe('save');
    expect(reopened.state?.inputs).toEqual(inputs);
    expect(JSON.stringify(reopened.state?.inputs)).toBe(JSON.stringify(inputs));
    expect(reopened.state?.checkpoints).toEqual(recorded.checkpoints);
    expect(reopened.state?.rng).toEqual(recorded.rng);
  });

  it('reads a replay written at format N as orphaned under a build at N + 1 — not migrated', () => {
    const written = replayStore(2);
    written.store.open();
    written.store.save(recorded);
    const onDisk = written.adapter.get('campus:replay:1');

    // The next build bumps the replay format. There are no rungs, so there is no migration.
    const next = createStore({
      key: 'campus:replay:1',
      chain: migrations(3, isLog).seal(),
      adapter: written.adapter,
      fresh: (): ReplayLog<Log> | null => null,
      now: () => asEpochMillis(2000),
    });

    const opened = next.open();
    expect(opened.failure?.reason).toBe('orphaned');
    expect(opened.source).toBe('fresh');
    expect(opened.state).toBe(null);
    expect(opened.failure?.savedVersion).toBe(2);
    // The old evidence is still on disk and still quarantined, not silently upgraded.
    expect(written.adapter.get('campus:replay:1:rejected')).toBeTypeOf('string');
    expect(onDisk).toBeTypeOf('string');
  });
});
