import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asEpochMillis, createRng, type EpochMillis } from '@lattice/core';
import { memoryStorage, type StorageAdapter } from '../src/adapters.js';
import { defaultChecksum } from '../src/integrity.js';
import { migrations, type Recognise } from '../src/migrate.js';
import {
  createStore,
  elapsedSince,
  inspect,
  scheduleFrom,
  type Autosave,
  type Cancel,
  type FailureReason,
  type OpenResult,
  type Schedule,
  type SecondsTimeline,
  type Store,
  type StoreOptions,
} from '../src/store.js';

// ── the fixture game: three save formats, the middle one a real reshape ──────────

interface V1 {
  readonly version: 1;
  readonly coins: number;
}
interface V2 {
  readonly version: 2;
  readonly wallet: { readonly coin: number };
}
interface V3 {
  readonly version: 3;
  readonly wallet: { readonly coin: number };
  readonly name: string;
}

const isV1: Recognise<V1> = (value) => {
  const coins = (value as { coins?: unknown }).coins;
  if (typeof coins !== 'number' || !Number.isFinite(coins)) {
    throw new RangeError(`save.v1.coins: expected a finite number, got ${String(coins)}`);
  }
  return { version: 1, coins };
};

const isV2: Recognise<V2> = (value) => {
  const coin = (value as { wallet?: { coin?: unknown } }).wallet?.coin;
  if (typeof coin !== 'number' || !Number.isFinite(coin)) {
    throw new RangeError(`save.v2.wallet.coin: expected a finite number, got ${String(coin)}`);
  }
  return { version: 2, wallet: { coin } };
};

const isV3: Recognise<V3> = (value) => {
  const { wallet } = isV2(value);
  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string') {
    throw new TypeError(`save.v3.name: expected a string, got ${String(name)}`);
  }
  return { version: 3, wallet, name };
};

const chain = migrations(1, isV1)
  .step(2, 'one coin counter became a wallet of currencies', (v1) => ({ version: 2 as const, wallet: { coin: v1.coins } }), isV2)
  .step(3, 'campuses got a player-chosen name', (v2) => ({ ...v2, version: 3 as const, name: 'unnamed' }), isV3)
  .seal();

const FRESH: V3 = { version: 3, wallet: { coin: 0 }, name: 'unnamed' };

/** An adapter that can be made to misbehave on demand, and counts what it was asked to do. */
interface Spy {
  readonly adapter: StorageAdapter;
  readonly cells: Map<string, string>;
  writes: number;
  removes: number;
  /** Thrown by every `set` while non-null. */
  rejectWrites: unknown;
  /** Thrown by every `get` while non-null. */
  rejectReads: unknown;
}

function spyStorage(durable = true): Spy {
  const cells = new Map<string, string>();
  const spy: Spy = {
    cells,
    writes: 0,
    removes: 0,
    rejectWrites: null,
    rejectReads: null,
    adapter: {
      durable,
      get: (key: string): string | null => {
        if (spy.rejectReads !== null) throw spy.rejectReads;
        return cells.get(key) ?? null;
      },
      set: (key: string, value: string): void => {
        spy.writes += 1;
        if (spy.rejectWrites !== null) throw spy.rejectWrites;
        cells.set(key, value);
      },
      remove: (key: string): void => {
        spy.removes += 1;
        cells.delete(key);
      },
    },
  };
  return spy;
}

interface Harness {
  readonly store: Store<V3>;
  readonly spy: Spy;
  readonly clock: { t: number };
}

function harness(overrides: Partial<StoreOptions<3, V3>> = {}, spy: Spy = spyStorage()): Harness {
  const clock = { t: 1_700_000_000_000 };
  const store = createStore<3, V3>({
    key: 'campus',
    chain,
    adapter: spy.adapter,
    fresh: () => ({ version: 3, wallet: { coin: 0 }, name: 'unnamed' }),
    now: () => asEpochMillis(clock.t),
    ...overrides,
  });
  return { store, spy, clock };
}

/** A save on disk, built by hand so a test can damage exactly one part of it. */
function envelope(v: number, payload: unknown, damage: { c?: string; t?: number; n?: number; d?: string } = {}): string {
  const d = damage.d ?? JSON.stringify(payload);
  return JSON.stringify({
    v,
    t: damage.t ?? 1_699_999_000_000,
    n: damage.n ?? 1,
    c: damage.c ?? defaultChecksum(d),
    d,
  });
}

// ── the surface ──────────────────────────────────────────────────────────────────

describe('createStore', () => {
  it('takes its version off the chain head, and there is no other version number', () => {
    const { store } = harness();
    expect(store.version).toBe(chain.head);
    expect(store.version).toBe(3);
  });

  it('starts in phase "new" and opens into "open"', () => {
    const { store } = harness();
    expect(store.phase).toBe('new');
    store.open();
    expect(store.phase).toBe('open');
    store.close();
    expect(store.phase).toBe('closed');
  });

  it('refuses nonsense options loudly, at construction rather than at a player’s boot', () => {
    expect(() => harness({ key: '' })).toThrow(TypeError);
    expect(() => harness({ key: 7 as unknown as string })).toThrow(/non-empty storage key/);
    expect(() => harness({ fresh: undefined as unknown as () => V3 })).toThrow(/fresh/);
    expect(() => harness({ now: undefined as unknown as () => EpochMillis })).toThrow(/may not read a clock/);
    expect(() => harness({ minWriteIntervalMs: -1 })).toThrow(RangeError);
    expect(() => harness({ minWriteIntervalMs: Number.NaN })).toThrow(/minWriteIntervalMs/);
    expect(() => harness({ maxBytes: 0 })).toThrow(RangeError);
    expect(() => harness({ maxBytes: Number.POSITIVE_INFINITY })).toThrow(/maxBytes/);
  });
});

describe('open on an empty key', () => {
  it('is a first run, not a lost save', () => {
    const { store } = harness();
    const opened = store.open();

    expect(opened.source).toBe('fresh');
    expect(opened.firstRun).toBe(true);
    expect(opened.failure).toBe(null);
    expect(opened.savedAt).toBe(null);
    expect(opened.migratedFrom).toBe(null);
    expect(opened.writable).toBe(true);
    expect(opened.state).toEqual(FRESH);
  });

  it('reports durability from the adapter, so a private-mode player can be told at the door', () => {
    expect(harness({}, spyStorage(false)).store.open().durable).toBe(false);
    expect(harness({}, spyStorage(true)).store.open().durable).toBe(true);
  });
});

describe('the round trip', () => {
  it('encode → decode returns the same state, stamped with the caller’s clock', () => {
    const { store, clock } = harness();
    store.open();
    clock.t = 1_700_000_123_456;

    const state: V3 = { version: 3, wallet: { coin: 42 }, name: 'north campus' };
    const decoded = store.decode(store.encode(state));

    expect(decoded.source).toBe('save');
    expect(decoded.state).toEqual(state);
    expect(decoded.migratedFrom).toBe(null);
    expect(decoded.savedAt).toBe(1_700_000_123_456);
    expect(decoded.failure).toBe(null);
  });

  it('save → open survives a store restart on the same adapter', () => {
    const spy = spyStorage();
    const first = harness({}, spy);
    first.store.open();
    first.store.save({ version: 3, wallet: { coin: 9 }, name: 'south' });

    const second = harness({}, spy);
    const opened = second.store.open();
    expect(opened.source).toBe('save');
    expect(opened.firstRun).toBe(false);
    expect(opened.state).toEqual({ version: 3, wallet: { coin: 9 }, name: 'south' });
  });

  it('stamps the envelope with the injected clock and nothing else', () => {
    const { store, spy, clock } = harness();
    store.open();
    clock.t = 1000;
    store.save(FRESH);

    const written = spy.cells.get('campus') ?? '';
    const parsed = inspect(written);
    expect(parsed?.t).toBe(1000);
    expect(parsed?.v).toBe(3);
    expect(parsed?.n).toBe(1);
    expect(parsed?.c).toBe(defaultChecksum(parsed?.d ?? ''));
  });
});

describe('migration', () => {
  it('walks a floor save all the way to the head and says where it came from', () => {
    const spy = spyStorage();
    spy.cells.set('campus', envelope(1, { coins: 12 }));
    const { store } = harness({}, spy);

    const opened = store.open();
    expect(opened.source).toBe('save');
    expect(opened.migratedFrom).toBe(1);
    expect(opened.state).toEqual({ version: 3, wallet: { coin: 12 }, name: 'unnamed' });
  });

  it('has a fixture per version from the floor up, and every one reaches the head', () => {
    // The only one of the three hole-proofs that catches a rung which exists and is *wrong*.
    const fixtures: ReadonlyArray<{ readonly version: number; readonly text: string }> = [
      { version: 1, text: envelope(1, { coins: 5 }) },
      { version: 2, text: envelope(2, { wallet: { coin: 5 } }) },
      { version: 3, text: envelope(3, { wallet: { coin: 5 }, name: 'unnamed' }) },
    ];
    const { store } = harness();

    for (const fixture of fixtures) {
      const decoded = store.decode(fixture.text);
      expect(decoded.source, `fixture v${String(fixture.version)}`).toBe('save');
      expect(decoded.migratedFrom).toBe(fixture.version === chain.head ? null : fixture.version);
      expect(decoded.state).toEqual({ version: 3, wallet: { coin: 5 }, name: 'unnamed' });
    }
    expect(fixtures.length).toBe(chain.head - chain.floor + 1);
  });
});

// ── the seven ways a save fails to become a state ────────────────────────────────

describe('boot survives every failure reason', () => {
  /** Each case leaves the store's adapter in the state that produces exactly one reason. */
  const cases: ReadonlyArray<{
    readonly reason: FailureReason;
    readonly arrange: (spy: Spy) => void;
    readonly savedVersion: number | null;
    readonly atVersion: number | null;
  }> = [
    {
      reason: 'unreadable',
      arrange: (spy) => {
        spy.rejectReads = new Error('storage is disabled');
      },
      savedVersion: null,
      atVersion: null,
    },
    {
      reason: 'malformed',
      arrange: (spy) => spy.cells.set('campus', '{"not":"an envelope"}'),
      savedVersion: null,
      atVersion: null,
    },
    {
      reason: 'corrupt',
      arrange: (spy) => spy.cells.set('campus', envelope(3, { wallet: { coin: 1 }, name: 'n' }, { c: '00000000' })),
      savedVersion: 3,
      atVersion: null,
    },
    {
      reason: 'future',
      arrange: (spy) => spy.cells.set('campus', envelope(4, { anything: true })),
      savedVersion: 4,
      atVersion: null,
    },
    {
      reason: 'orphaned',
      arrange: (spy) => spy.cells.set('campus', envelope(0, { ancient: true })),
      savedVersion: 0,
      atVersion: null,
    },
    {
      reason: 'migration-failed',
      arrange: (spy) => spy.cells.set('campus', envelope(1, { coins: 'many' })),
      savedVersion: 1,
      atVersion: 1,
    },
    {
      reason: 'invalid',
      arrange: (spy) => spy.cells.set('campus', envelope(3, { wallet: { coin: 1 } })),
      savedVersion: 3,
      atVersion: null,
    },
  ];

  it.each(cases)('$reason degrades to a fresh state and never throws', ({ reason, savedVersion, atVersion }) => {
    const spy = spyStorage();
    const found = cases.find((c) => c.reason === reason);
    found?.arrange(spy);
    const seen: FailureReason[] = [];
    const { store } = harness({ onFailure: (failure) => seen.push(failure.reason) }, spy);

    let opened: OpenResult<V3> | null = null;
    expect(() => {
      opened = store.open();
    }).not.toThrow();

    const result = opened as OpenResult<V3> | null;
    expect(result).not.toBe(null);
    expect(result?.state).toEqual(FRESH);
    expect(result?.source).toBe('fresh');
    expect(result?.firstRun).toBe(false);
    expect(result?.savedAt).toBe(null);
    expect(result?.failure?.reason).toBe(reason);
    expect(result?.failure?.savedVersion).toBe(savedVersion);
    expect(result?.failure?.atVersion).toBe(atVersion);
    expect(result?.failure?.message).toContain('campus');
    expect(seen).toEqual([reason]);
  });

  it('covers every member of the closed union — count the branches', () => {
    const reasons = new Set(cases.map((c) => c.reason));
    expect(reasons.size).toBe(7);
  });

  it('separates damaged bytes from a payload the checksum never covered', () => {
    const { store } = harness();
    // A checksum over garbage: the envelope is intact, the checksum agrees, and the payload
    // is still not JSON. That is a different bug from a flipped bit and gets the same reason
    // with a different message.
    const text = envelope(3, null, { d: '{"wallet":' });
    const decoded = store.decode(text);
    expect(decoded.failure?.reason).toBe('corrupt');
    expect(decoded.failure?.message).toMatch(/intact checksum over a payload that is not JSON/);
    expect(decoded.failure?.cause).toBeInstanceOf(SyntaxError);
  });

  it('names the rung when a migration throws, and carries what it threw unchanged', () => {
    const sentinel = 'the aquifer table did not exist in v1';
    const brittle = migrations(1, isV1)
      .step(
        2,
        'a rung that fails on some data',
        (v1): V2 => {
          if (v1.coins < 0) throw sentinel;
          return { version: 2, wallet: { coin: v1.coins } };
        },
        isV2,
      )
      .step(3, 'a name', (v2) => ({ ...v2, version: 3 as const, name: 'unnamed' }), isV3)
      .seal();

    const spy = spyStorage();
    spy.cells.set('campus', envelope(1, { coins: -1 }));
    const store = createStore<3, V3>({
      key: 'campus',
      chain: brittle,
      adapter: spy.adapter,
      fresh: () => FRESH,
      now: () => asEpochMillis(0),
    });

    const opened = store.open();
    expect(opened.failure?.reason).toBe('migration-failed');
    expect(opened.failure?.atVersion).toBe(1);
    expect(opened.failure?.cause).toBe(sentinel);
    expect(opened.failure?.message).toContain(sentinel);
  });

  it('reports a truncated payload as corrupt, and never parses it', () => {
    const good = envelope(3, { wallet: { coin: 1 }, name: 'n' });
    const truncated = good.slice(0, good.length - 12);
    const { store } = harness();
    // Truncating the whole envelope destroys its JSON, so it is malformed…
    expect(store.decode(truncated).failure?.reason).toBe('malformed');
    // …and truncating only the payload leaves a readable envelope with a broken checksum.
    const parsed = inspect(good);
    const clipped = JSON.stringify({ ...parsed, d: (parsed?.d ?? '').slice(0, 5) });
    expect(store.decode(clipped).failure?.reason).toBe('corrupt');
  });
});

describe('open never throws, for any content whatsoever', () => {
  it('returns a result for a thousand arbitrary strings', () => {
    const rng = createRng('persist:open-never-throws');
    const valid = envelope(3, { wallet: { coin: 1 }, name: 'n' });
    const corpus: string[] = [
      '',
      ' ',
      'null',
      'true',
      '0',
      '{',
      '}',
      '[]',
      '[1,2,3]',
      '"a string"',
      '{"v":1}',
      '{"v":"three","t":0,"n":0,"c":"x","d":"{}"}',
      '{"v":3,"t":null,"n":0,"c":"x","d":"{}"}',
      '{"v":3,"t":0,"n":null,"c":"x","d":"{}"}',
      '{"v":3.5,"t":0,"n":0,"c":"x","d":"{}"}',
      '{"v":3,"t":0,"n":0,"c":7,"d":"{}"}',
      '{"v":3,"t":0,"n":0,"c":"x","d":7}',
      'a'.repeat(1_000_000),
      valid,
    ];
    while (corpus.length < 1000) {
      const at = rng.int(0, valid.length);
      const replacement = String.fromCharCode(rng.int(32, 127));
      corpus.push(`${valid.slice(0, at)}${replacement}${valid.slice(at + 1)}`);
    }

    const spy = spyStorage();
    const { store } = harness({}, spy);
    let results = 0;
    for (const text of corpus) {
      spy.cells.set('campus', text);
      const opened = store.open();
      expect(opened.state).toBeTypeOf('object');
      results += 1;
    }
    expect(results).toBe(1000);
  });
});

// ── a save from the future ───────────────────────────────────────────────────────

describe('a save from the future', () => {
  function future(): Harness {
    const spy = spyStorage();
    spy.cells.set('campus', envelope(9, { wallet: { coin: 500 }, name: 'a newer build' }));
    return harness({}, spy);
  }

  it('is discoverable the moment open() returns, with no tick in between', () => {
    const { store } = future();
    const opened = store.open();
    expect(store.status).toBe('refusing-newer');
    expect(opened.writable).toBe(false);
    expect(opened.failure?.reason).toBe('future');
    expect(opened.firstRun).toBe(false);
    expect(opened.failure?.message).toMatch(/version 9 but this build reads up to 3/);
  });

  it('leaves storage byte-identical through every write path there is', () => {
    const { store, spy } = future();
    const before = spy.cells.get('campus');
    store.open();
    const auto = store.autosave(() => ({ version: 3, wallet: { coin: 1 }, name: 'clobber' }));

    for (let i = 0; i < 100; i += 1) auto.tick();
    const flushed = auto.flush();
    const saved = store.save({ version: 3, wallet: { coin: 2 }, name: 'clobber' });

    expect(flushed.skipped).toBe('not-writable');
    expect(saved.skipped).toBe('not-writable');
    expect(saved.written).toBe(false);
    expect(spy.cells.get('campus')).toBe(before);
    expect(spy.writes).toBe(0);
  });

  it('is never quarantined, because nothing is being destroyed', () => {
    const { store, spy } = future();
    store.open();
    expect(store.rejected()).toBe(null);
    expect(spy.cells.has('campus:rejected')).toBe(false);
  });

  it('is cleared by reset(), which is the deliberate one-line escape hatch', () => {
    const { store } = future();
    store.open();
    expect(store.status).toBe('refusing-newer');

    store.reset();
    expect(store.status).toBe('ok');
    expect(store.writable).toBe(true);

    const reopened = store.open();
    expect(reopened.firstRun).toBe(true);
    expect(store.status).toBe('ok');
  });

  it('is cleared by an open() that no longer finds a newer save', () => {
    const { store, spy } = future();
    store.open();
    expect(store.status).toBe('refusing-newer');

    spy.cells.set('campus', envelope(3, { wallet: { coin: 1 }, name: 'n' }));
    const reopened = store.open();
    expect(store.status).toBe('ok');
    expect(reopened.source).toBe('save');
  });
});

// ── the reset trap ───────────────────────────────────────────────────────────────

describe('reset closes the store and stops its handles before it removes the key', () => {
  it('is final until open(), whatever the game does afterwards', () => {
    const { store, spy } = harness();
    store.open();
    store.save({ version: 3, wallet: { coin: 99 }, name: 'the campus' });
    const auto = store.autosave(() => ({ version: 3, wallet: { coin: 99 }, name: 'the campus' }));
    expect(spy.cells.get('campus')).toBeTypeOf('string');

    const state = store.reset();
    const writesAfterReset = spy.writes;

    // Everything a page teardown can still call, in the order a real one calls it.
    expect(auto.tick()).toBe(false);
    expect(auto.flush().skipped).toBe('closed');
    expect(store.save({ version: 3, wallet: { coin: 99 }, name: 'the campus' }).skipped).toBe('closed');

    expect(state).toEqual(FRESH);
    expect(spy.writes).toBe(writesAfterReset);
    expect(spy.adapter.get('campus')).toBe(null);
    expect(spy.adapter.get('campus:rejected')).toBe(null);
    expect(store.phase).toBe('closed');
  });

  it('survives a reset on a store whose adapter refuses to remove anything', () => {
    const spy = spyStorage();
    const { store } = harness({}, spy);
    store.open();
    const hostile: StorageAdapter = {
      durable: true,
      get: spy.adapter.get,
      set: spy.adapter.set,
      remove: () => {
        throw new Error('storage went away mid-reset');
      },
    };
    const stubborn = createStore<3, V3>({
      key: 'campus',
      chain,
      adapter: hostile,
      fresh: () => FRESH,
      now: () => asEpochMillis(0),
    });
    stubborn.open();
    const auto = stubborn.autosave(() => FRESH);

    expect(() => stubborn.reset()).not.toThrow();
    // The half of reset that actually prevents the trap still happened.
    expect(stubborn.phase).toBe('closed');
    expect(auto.flush().skipped).toBe('closed');
  });

  it('reopens on the next open()', () => {
    const { store } = harness();
    store.open();
    store.reset();
    expect(store.phase).toBe('closed');
    store.open();
    expect(store.phase).toBe('open');
    expect(store.save(FRESH).written).toBe(true);
  });
});

describe('close', () => {
  it('is silent by default — what a "delete my save" button wants', () => {
    const { store, spy } = harness();
    store.open();
    const before = spy.writes;
    store.close();
    expect(spy.writes).toBe(before);
    expect(store.save(FRESH).skipped).toBe('closed');
  });

  it('flushes on the way out when handed a getter', () => {
    const { store, spy } = harness();
    store.open();
    store.close({ flush: true, get: () => ({ version: 3, wallet: { coin: 3 }, name: 'last' }) });
    expect(store.decode(spy.cells.get('campus') ?? '').state).toEqual({
      version: 3,
      wallet: { coin: 3 },
      name: 'last',
    });
  });

  it('is idempotent, and the second close does not write again', () => {
    const { store, spy } = harness();
    store.open();
    store.close({ flush: true, get: () => FRESH });
    const after = spy.writes;
    store.close({ flush: true, get: () => FRESH });
    store.close({ flush: false });
    expect(spy.writes).toBe(after);
  });

  it('stops every handle it made', () => {
    const { store } = harness();
    store.open();
    const a = store.autosave(() => FRESH);
    const b = store.autosave(() => FRESH);
    store.close();
    expect(a.flush().skipped).toBe('closed');
    expect(b.flush().skipped).toBe('closed');
  });
});

// ── coalescing, and the injected schedule ────────────────────────────────────────

describe('autosave', () => {
  it('coalesces: 240 ticks over 3999 ms write once, and 4001 ms writes again', () => {
    const { store, spy, clock } = harness({ minWriteIntervalMs: 4000 });
    store.open();
    const auto = store.autosave(() => FRESH);

    const start = clock.t;
    for (let i = 0; i < 240; i += 1) {
      clock.t = start + Math.round((i * 3999) / 239);
      auto.tick();
    }
    expect(spy.writes).toBe(1);

    clock.t = start + 4001;
    expect(auto.tick()).toBe(true);
    expect(spy.writes).toBe(2);
  });

  it('does not write until the injected schedule chooses to run — proving there is no real timer', () => {
    const pending: Array<{ readonly afterMs: number; readonly fn: () => void }> = [];
    let cancelled = 0;
    const schedule = (afterMs: number, fn: () => void): Cancel => {
      pending.push({ afterMs, fn });
      return () => {
        cancelled += 1;
      };
    };

    const { store, spy } = harness({ minWriteIntervalMs: 4000 });
    store.open();
    const auto = store.autosave(() => FRESH, { schedule });

    expect(pending.length).toBe(1);
    expect(pending[0]?.afterMs).toBe(4000);
    expect(spy.writes).toBe(0);

    pending[0]?.fn();
    expect(spy.writes).toBe(1);
    expect(auto.lastWrite?.written).toBe(true);
    // It re-arms itself, so the game never calls tick.
    expect(pending.length).toBe(2);

    pending[1]?.fn();
    expect(spy.writes).toBe(2);

    auto.stop();
    expect(cancelled).toBe(1);
    auto.stop();
    expect(cancelled).toBe(1);
  });

  it('makes tick a no-op when a schedule was supplied, so wiring both is not a double write', () => {
    const pending: Array<() => void> = [];
    const { store, spy } = harness();
    store.open();
    const auto = store.autosave(() => FRESH, {
      schedule: (_afterMs, fn) => {
        pending.push(fn);
        return () => undefined;
      },
    });

    for (let i = 0; i < 50; i += 1) expect(auto.tick()).toBe(false);
    expect(spy.writes).toBe(0);
  });

  it('will not write after stop(), even when its scheduler’s cancel does nothing', () => {
    let fire: (() => void) | null = null;
    const { store, spy } = harness();
    store.open();
    const auto = store.autosave(() => FRESH, {
      schedule: (_afterMs, fn) => {
        fire = fn;
        return () => undefined; // a scheduler that lies about cancelling
      },
    });

    auto.stop();
    const before = spy.writes;
    (fire as unknown as () => void)();
    expect(spy.writes).toBe(before);
  });

  it('flushes regardless of the interval, which is what the visibility handler needs', () => {
    const { store, spy } = harness({ minWriteIntervalMs: 4000 });
    store.open();
    const auto = store.autosave(() => FRESH);

    auto.tick();
    expect(spy.writes).toBe(1);
    expect(auto.tick()).toBe(false);
    expect(auto.flush().written).toBe(true);
    expect(spy.writes).toBe(2);
  });

  it('keeps one result object per attempt, not per tick', () => {
    const { store, clock } = harness({ minWriteIntervalMs: 4000 });
    store.open();
    const auto = store.autosave(() => FRESH);
    expect(auto.lastWrite).toBe(null);

    auto.tick();
    const first = auto.lastWrite;
    for (let i = 0; i < 100; i += 1) auto.tick();
    expect(auto.lastWrite).toBe(first);

    clock.t += 5000;
    auto.tick();
    expect(auto.lastWrite).not.toBe(first);
  });

  it('is stopped by stop(), and a stopped handle detaches from the store', () => {
    const { store, spy } = harness();
    store.open();
    const auto = store.autosave(() => FRESH);
    auto.stop();

    expect(auto.tick()).toBe(false);
    expect(auto.flush().skipped).toBe('closed');
    expect(auto.lastWrite?.skipped).toBe('closed');
    expect(spy.writes).toBe(0);
    // The store no longer holds it, so closing does not touch it again.
    store.close();
    expect(auto.flush().skipped).toBe('closed');
  });
});

// ── the seconds/milliseconds seam ────────────────────────────────────────────────

/**
 * `loop.real`, structurally — `after(delay: Seconds, fn): TimerId` and `cancel(id): boolean`,
 * plus the rest of `Scheduler` so that assignability to `SecondsTimeline` is really tested and
 * not merely asserted against a two-method stub.
 */
function fakeTimeline(): SecondsTimeline & {
  readonly delaysSeen: number[];
  readonly cancelledIds: number[];
  readonly time: number;
  readonly pending: number;
  every(period: number, fn: (repeats: number) => void): number;
  cancelAll(): void;
  fire(id: number): void;
} {
  const timers = new Map<number, () => void>();
  const delaysSeen: number[] = [];
  const cancelledIds: number[] = [];
  let nextId = 1;
  return {
    delaysSeen,
    cancelledIds,
    time: 0,
    pending: 0,
    after(delay: number, fn: () => void): number {
      delaysSeen.push(delay);
      const id = nextId;
      nextId += 1;
      timers.set(id, fn);
      return id;
    },
    every(): number {
      return 0;
    },
    cancel(id: number): boolean {
      cancelledIds.push(id);
      return timers.delete(id);
    },
    cancelAll(): void {
      timers.clear();
    },
    fire(id: number): void {
      timers.get(id)?.();
    },
  };
}

describe('scheduleFrom — the one place the 1000 lives', () => {
  it('converts milliseconds to seconds, so four seconds is not sixty-seven minutes', () => {
    const timeline = fakeTimeline();
    const { store, spy } = harness({ minWriteIntervalMs: 4000 });
    store.open();
    const auto = store.autosave(() => FRESH, { schedule: scheduleFrom(timeline) });

    // The assertion the whole function exists for. `4`, not `4000`.
    expect(timeline.delaysSeen).toEqual([4]);
    expect(spy.writes).toBe(0);

    timeline.fire(1);
    expect(spy.writes).toBe(1);
    expect(auto.lastWrite?.written).toBe(true);
    // …and it re-arms in seconds too.
    expect(timeline.delaysSeen).toEqual([4, 4]);
  });

  it('cancels the timer it armed, exactly once, however many times the disposer is called', () => {
    const timeline = fakeTimeline();
    const schedule: Schedule = scheduleFrom(timeline);

    const cancel: Cancel = schedule(2500, () => undefined);
    expect(timeline.delaysSeen).toEqual([2.5]);

    cancel();
    cancel();
    cancel();
    expect(timeline.cancelledIds).toEqual([1]);
  });

  it('is what store.autosave().stop() reaches through', () => {
    const timeline = fakeTimeline();
    const { store } = harness();
    store.open();
    const auto = store.autosave(() => FRESH, { schedule: scheduleFrom(timeline) });

    auto.stop();
    expect(timeline.cancelledIds).toEqual([1]);
    timeline.fire(1);
    expect(auto.lastWrite).toBe(null);
  });

  it('makes the wrong wiring a compile error rather than an hour-long outage', () => {
    const timeline = fakeTimeline();

    // `loop.real.after` counts in seconds and returns a TimerId. Passing it as a `Schedule`
    // fails on the return type — and forced through with a cast it would ask for a write
    // every 4,000 seconds while reporting `ok` the entire time.
    // @ts-expect-error a TimerId is not a Cancel, and the unit is seconds
    const wrong: Schedule = timeline.after;
    expect(typeof wrong).toBe('function');

    expect(() => {
      // @ts-expect-error scheduleFrom takes the timeline, not one of its methods
      scheduleFrom(timeline.after);
    }).toThrow(TypeError);
  });

  it('refuses a method or a nothing at wiring time, which beats the first missed autosave', () => {
    const timeline = fakeTimeline();
    expect(() => scheduleFrom(timeline.after as unknown as SecondsTimeline)).toThrow(/loop\.real\.after/);
    expect(() => scheduleFrom(undefined as unknown as SecondsTimeline)).toThrow(TypeError);
    expect(() => scheduleFrom({ after: timeline.after } as unknown as SecondsTimeline)).toThrow(TypeError);
  });
});

// ── the status is a condition, not a message ─────────────────────────────────────

describe('status', () => {
  it('is known at construction for a non-durable adapter, before anything is opened', () => {
    const { store } = harness({}, spyStorage(false));
    expect(store.status).toBe('not-persistent');
    store.open();
    expect(store.status).toBe('not-persistent');
  });

  it('is the identical string across twenty consecutive rejected writes, so a latch fires once', () => {
    const { store, clock } = harness({ minWriteIntervalMs: 4000 }, spyStorage());
    const spy = spyStorage();
    const local = harness({ minWriteIntervalMs: 4000 }, spy);
    local.store.open();
    const auto = local.store.autosave(() => FRESH);
    spy.rejectWrites = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });

    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      local.clock.t += 4001;
      auto.tick();
      seen.push(local.store.status);
    }

    expect(seen.length).toBe(20);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe('write-failing');
    expect(auto.lastWrite?.error?.reason).toBe('quota');

    // …and one successful write returns it to 'ok'.
    spy.rejectWrites = null;
    local.clock.t += 4001;
    expect(auto.tick()).toBe(true);
    expect(local.store.status).toBe('ok');

    expect(store.status).toBe('ok');
    expect(clock.t).toBeGreaterThan(0);
  });

  it('reports refusing-newer over write-failing over not-persistent', () => {
    const spy = spyStorage(false);
    spy.cells.set('campus', envelope(9, { newer: true }));
    const { store } = harness({}, spy);

    expect(store.status).toBe('not-persistent');
    store.open();
    // A store refusing to write has nothing to say about whether its writes would survive.
    expect(store.status).toBe('refusing-newer');
    store.reset();
    expect(store.status).toBe('not-persistent');
  });

  it('never carries a detail that changes between rediscoveries', () => {
    const spy = spyStorage();
    const { store, clock } = harness({}, spy);
    store.open();
    spy.rejectWrites = new Error('nope');

    clock.t += 10;
    store.save(FRESH);
    const first = store.status;
    clock.t += 999_999;
    store.save(FRESH);
    expect(store.status).toBe(first);
  });
});

// ── writes that do not happen ────────────────────────────────────────────────────

describe('write outcomes', () => {
  it('classifies a quota rejection and hands the detail to onWriteError', () => {
    const spy = spyStorage();
    const failures: string[] = [];
    const { store } = harness({ onWriteError: (failure) => failures.push(failure.reason) }, spy);
    store.open();

    spy.rejectWrites = Object.assign(new Error('exceeded'), { name: 'QuotaExceededError' });
    expect(store.save(FRESH).error?.reason).toBe('quota');

    spy.rejectWrites = { code: 22, message: 'legacy' };
    expect(store.save(FRESH).error?.reason).toBe('quota');

    spy.rejectWrites = { code: 1014 };
    expect(store.save(FRESH).error?.reason).toBe('quota');

    spy.rejectWrites = new Error('something else entirely');
    expect(store.save(FRESH).error?.reason).toBe('unavailable');

    spy.rejectWrites = 'a thrown string';
    const thrownString = store.save(FRESH);
    expect(thrownString.error?.reason).toBe('unavailable');
    expect(thrownString.error?.cause).toBe('a thrown string');
    expect(thrownString.error?.message).toContain('a thrown string');

    expect(failures).toEqual(['quota', 'quota', 'quota', 'unavailable', 'unavailable']);
  });

  it('refuses a too-large envelope rather than discovering the quota by throwing', () => {
    const { store, spy } = harness({ maxBytes: 200 });
    store.open();
    const result = store.save({ version: 3, wallet: { coin: 1 }, name: 'x'.repeat(500) });

    expect(result.skipped).toBe('too-large');
    expect(result.written).toBe(false);
    expect(result.bytes).toBeGreaterThan(200);
    expect(spy.writes).toBe(0);
  });

  it('reports a state JSON cannot represent instead of throwing inside a page-hide handler', () => {
    const { store } = harness();
    store.open();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const result = store.save(cyclic as unknown as V3);
    expect(result.written).toBe(false);
    expect(result.error?.reason).toBe('unavailable');
    expect(result.error?.message).toContain('could not be serialised');
    expect(store.status).toBe('write-failing');

    // `encode` is the developer-facing half and is allowed to throw.
    expect(() => store.encode(undefined as unknown as V3)).toThrow(TypeError);
    expect(() => store.encode(cyclic as unknown as V3)).toThrow();
  });

  it('skips with "closed" before open() and after close()', () => {
    const { store } = harness();
    expect(store.save(FRESH).skipped).toBe('closed');
    store.open();
    expect(store.save(FRESH).written).toBe(true);
    store.close();
    expect(store.save(FRESH).skipped).toBe('closed');
  });
});

describe('two tabs', () => {
  it('detects that another tab wrote, when asked to', () => {
    const spy = spyStorage();
    // Both tabs open the same existing save, so both start from the same write sequence.
    spy.cells.set('campus', envelope(3, { wallet: { coin: 0 }, name: 'shared' }, { n: 1 }));
    const mine = harness({ conflict: 'refuse' }, spy);
    const theirs = harness({}, spy);
    mine.store.open();
    theirs.store.open();

    expect(theirs.store.save({ version: 3, wallet: { coin: 2 }, name: 'theirs' }).written).toBe(true);

    const refused = mine.store.save({ version: 3, wallet: { coin: 3 }, name: 'mine again' });
    expect(refused.skipped).toBe('conflict');
    expect(refused.written).toBe(false);
    expect(mine.store.decode(spy.cells.get('campus') ?? '').state).toEqual({
      version: 3,
      wallet: { coin: 2 },
      name: 'theirs',
    });
  });

  it('is last-write-wins by default, which is what every shipped game does', () => {
    const spy = spyStorage();
    const mine = harness({}, spy);
    const theirs = harness({}, spy);
    mine.store.open();
    theirs.store.open();

    mine.store.save({ version: 3, wallet: { coin: 1 }, name: 'mine' });
    theirs.store.save({ version: 3, wallet: { coin: 2 }, name: 'theirs' });
    const mineAgain = mine.store.save({ version: 3, wallet: { coin: 3 }, name: 'mine again' });
    expect(mineAgain.written).toBe(true);
    expect(mine.store.decode(spy.cells.get('campus') ?? '').state).toEqual({
      version: 3,
      wallet: { coin: 3 },
      name: 'mine again',
    });
  });

  it('does not call a conflict when storage cannot be read or holds something else', () => {
    const spy = spyStorage();
    const { store } = harness({ conflict: 'refuse' }, spy);
    store.open();

    spy.cells.set('campus', 'not an envelope');
    expect(store.save(FRESH).written).toBe(true);

    spy.cells.delete('campus');
    expect(store.save(FRESH).written).toBe(true);

    spy.rejectReads = new Error('read refused');
    expect(store.save(FRESH).written).toBe(true);
  });
});

// ── quarantine ───────────────────────────────────────────────────────────────────

describe('quarantine', () => {
  it('keeps the bytes that could not be read, so a bug report can carry them', () => {
    const spy = spyStorage();
    const broken = envelope(3, { wallet: { coin: 1 }, name: 'n' }, { c: 'ffffffff' });
    spy.cells.set('campus', broken);
    const { store } = harness({}, spy);

    const opened = store.open();
    expect(opened.failure?.quarantined).toBe(true);

    const kept = store.rejected();
    expect(kept?.text).toBe(broken);
    expect(kept?.truncated).toBe(false);
    expect(kept?.failure.reason).toBe('corrupt');
    expect(kept?.failure.savedVersion).toBe(3);
    expect(kept?.failure.quarantined).toBe(true);
    expect(kept?.failure.message).toContain('campus');

    store.clearRejected();
    expect(store.rejected()).toBe(null);
  });

  it('truncates at the cap and says so', () => {
    const spy = spyStorage();
    spy.cells.set('campus', `{"junk":"${'a'.repeat(5000)}"}`);
    const { store } = harness({ quarantine: { maxBytes: 64 } }, spy);
    store.open();

    const kept = store.rejected();
    expect(kept?.truncated).toBe(true);
    expect(kept?.text.length).toBe(64);
  });

  it('can be switched off entirely', () => {
    const spy = spyStorage();
    spy.cells.set('campus', 'garbage');
    const { store } = harness({ quarantine: false }, spy);

    expect(store.open().failure?.quarantined).toBe(false);
    expect(store.rejected()).toBe(null);
    expect(spy.cells.has('campus:rejected')).toBe(false);
  });

  it('reports quarantined: false when storage refuses to keep the evidence', () => {
    const spy = spyStorage();
    spy.cells.set('campus', 'garbage');
    const { store } = harness({}, spy);
    spy.rejectWrites = new Error('full');

    const opened = store.open();
    expect(opened.failure?.reason).toBe('malformed');
    expect(opened.failure?.quarantined).toBe(false);
    expect(opened.state).toEqual(FRESH);
  });

  it('carries the migration cause as prose, because a thrown value need not survive JSON', () => {
    const spy = spyStorage();
    spy.cells.set('campus', envelope(1, { coins: 'many' }));
    const { store } = harness({}, spy);
    store.open();

    expect(store.rejected()?.failure.cause).toMatch(/save\.v1\.coins/);
    expect(store.rejected()?.failure.atVersion).toBe(1);
  });

  it('returns null rather than throwing for a quarantine record that is itself damaged', () => {
    const spy = spyStorage();
    const { store } = harness({}, spy);

    spy.cells.set('campus:rejected', 'not json');
    expect(store.rejected()).toBe(null);

    spy.cells.set('campus:rejected', '[1,2,3]');
    expect(store.rejected()).toBe(null);

    spy.cells.set('campus:rejected', '{"text":7,"truncated":false,"failure":{"reason":"corrupt"}}');
    expect(store.rejected()).toBe(null);

    spy.cells.set('campus:rejected', '{"text":"t","truncated":false,"failure":null}');
    expect(store.rejected()).toBe(null);

    spy.cells.set('campus:rejected', '{"text":"t","truncated":false,"failure":{"reason":"nonsense"}}');
    expect(store.rejected()).toBe(null);

    spy.cells.set('campus:rejected', '{"text":"t","truncated":false,"failure":{"reason":7}}');
    expect(store.rejected()).toBe(null);

    spy.cells.set(
      'campus:rejected',
      '{"text":"t","truncated":false,"failure":{"reason":"corrupt","savedVersion":"x","savedAt":null}}',
    );
    const partial = store.rejected();
    expect(partial?.failure.message).toBe('');
    expect(partial?.failure.savedVersion).toBe(null);
    expect(partial?.failure.savedAt).toBe(null);
    expect(partial?.failure.cause).toBe(null);

    spy.rejectReads = new Error('gone');
    expect(store.rejected()).toBe(null);
  });

  it('is removed by reset, along with the save', () => {
    const spy = spyStorage();
    spy.cells.set('campus', 'garbage');
    const { store } = harness({}, spy);
    store.open();
    expect(spy.cells.has('campus:rejected')).toBe(true);

    store.reset();
    expect(spy.cells.has('campus:rejected')).toBe(false);
  });
});

// ── stores are isolated ──────────────────────────────────────────────────────────

describe('stores on one adapter are isolated', () => {
  interface Settings {
    readonly version: 1;
    readonly volume: number;
  }
  const isSettings: Recognise<Settings> = (value) => {
    const volume = (value as { volume?: unknown }).volume;
    if (typeof volume !== 'number') throw new TypeError('settings.volume: expected a number');
    return { version: 1, volume };
  };

  it('never reads or writes another store’s key, and an export carries only its own payload', () => {
    const spy = spyStorage();
    const clock = { t: 5000 };
    const now = (): EpochMillis => asEpochMillis(clock.t);
    const save = createStore<3, V3>({ key: 'campus:save', chain, adapter: spy.adapter, fresh: () => FRESH, now });
    const settings = createStore<1, Settings>({
      key: 'campus:settings',
      chain: migrations(1, isSettings).seal(),
      adapter: spy.adapter,
      fresh: () => ({ version: 1, volume: 0.25 }),
      now,
    });

    save.open();
    settings.open();
    save.save({ version: 3, wallet: { coin: 7 }, name: 'north' });
    settings.save({ version: 1, volume: 0.9 });

    const settingsBytes = spy.cells.get('campus:settings');
    const exported = save.encode({ version: 3, wallet: { coin: 7 }, name: 'north' });
    expect(exported).not.toContain('volume');
    expect(exported).not.toContain('0.9');

    // A reset of the save store is START OVER, and the player's volume survives it.
    save.reset();
    expect(spy.cells.get('campus:settings')).toBe(settingsBytes);
    expect(settings.open().state).toEqual({ version: 1, volume: 0.9 });

    // A save from the future locks the save store and leaves the settings store writable.
    spy.cells.set('campus:save', envelope(9, {}));
    save.open();
    expect(save.status).toBe('refusing-newer');
    expect(settings.status).toBe('ok');
    expect(settings.save({ version: 1, volume: 0.1 }).written).toBe(true);
  });
});

// ── the calendar ─────────────────────────────────────────────────────────────────

describe('the timestamp is the caller’s, and the gap is clamped only from below', () => {
  it('produces the instant the injected clock returned, and no other', () => {
    const { store, spy, clock } = harness();
    store.open();
    clock.t = 1000;
    store.save(FRESH);
    expect(inspect(spy.cells.get('campus') ?? '')?.t).toBe(1000);
  });

  it('measures nothing on a first run and nothing on a degraded read', () => {
    const spy = spyStorage();
    const { store } = harness({}, spy);
    expect(elapsedSince(store.open(), asEpochMillis(9_999_999))).toBe(0);

    spy.cells.set('campus', 'garbage');
    expect(elapsedSince(store.open(), asEpochMillis(9_999_999))).toBe(0);
  });

  it('is exact for a real save and zero for a device clock that moved backwards', () => {
    const spy = spyStorage();
    spy.cells.set('campus', envelope(3, { wallet: { coin: 1 }, name: 'n' }, { t: 10_000 }));
    const { store } = harness({}, spy);
    const opened = store.open();

    expect(opened.savedAt).toBe(10_000);
    expect(elapsedSince(opened, asEpochMillis(25_000))).toBe(15_000);
    expect(elapsedSince(opened, asEpochMillis(10_000))).toBe(0);
    expect(elapsedSince(opened, asEpochMillis(9_000))).toBe(0);
  });

  it('reports a save stamped in the future faithfully rather than clamping it away', () => {
    const spy = spyStorage();
    spy.cells.set('campus', envelope(3, { wallet: { coin: 1 }, name: 'n' }, { t: 999_999_999 }));
    const { store } = harness({}, spy);
    const opened = store.open();

    expect(opened.savedAt).toBe(999_999_999);
    expect(elapsedSince(opened, asEpochMillis(1000))).toBe(0);
  });
});

// ── inspect ──────────────────────────────────────────────────────────────────────

describe('inspect', () => {
  it('reads the envelope without touching the payload', () => {
    const text = envelope(3, { wallet: { coin: 1 }, name: 'n' }, { t: 7, n: 4 });
    const parsed = inspect(text);
    expect(parsed?.v).toBe(3);
    expect(parsed?.t).toBe(7);
    expect(parsed?.n).toBe(4);
    expect(parsed?.d).toBe('{"wallet":{"coin":1},"name":"n"}');
  });

  it('reads `v` off a save whose payload is unreadable garbage', () => {
    // The whole reason `d` is a string: the future check must not need to parse a payload
    // written by a build that no longer exists.
    expect(inspect(envelope(99, null, { d: '  not json at all' }))?.v).toBe(99);
  });

  it('returns null rather than throwing for everything that is not an envelope', () => {
    for (const text of [
      '',
      '{',
      'null',
      '[]',
      '"str"',
      '{"v":1}',
      '{"v":1.5,"t":0,"n":0,"c":"x","d":"{}"}',
      '{"v":1,"t":"nope","n":0,"c":"x","d":"{}"}',
      '{"v":1,"t":0,"n":"nope","c":"x","d":"{}"}',
      '{"v":1,"t":0,"n":0,"c":0,"d":"{}"}',
      '{"v":1,"t":0,"n":0,"c":"x","d":{}}',
    ]) {
      expect(inspect(text), text).toBe(null);
    }
  });
});

// ── decode is the pipeline, not the store ────────────────────────────────────────

describe('decode', () => {
  it('touches no storage and changes no store state', () => {
    const { store, spy } = harness();
    store.open();
    const before = { writes: spy.writes, removes: spy.removes };

    const decoded = store.decode(envelope(9, { newer: true }));
    expect(decoded.failure?.reason).toBe('future');
    expect(decoded.writable).toBe(false);
    expect(decoded.failure?.quarantined).toBe(false);

    // The store itself is untouched: `decode` is a function of a string.
    expect(store.status).toBe('ok');
    expect(store.writable).toBe(true);
    expect(spy.writes).toBe(before.writes);
    expect(spy.removes).toBe(before.removes);
    expect(store.rejected()).toBe(null);
  });

  it('still calls onFailure, because a counter wants both paths', () => {
    const onFailure = vi.fn();
    const { store } = harness({ onFailure });
    store.decode('garbage');
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

// ── the package-level invariants a grep can check ────────────────────────────────

describe('the package owns no clock, no timer and no host', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));
  const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

  /** Prose that *names* a banned global is not a use of one, so read the code without it. */
  function codeOnly(file: string): string {
    return readFileSync(join(srcDir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
  }

  it('mentions no clock, timer or host global outside the one declared adapter', () => {
    const banned = /\b(Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame|document|window|sessionStorage)\b/;
    for (const file of files) {
      expect(codeOnly(file), file).not.toMatch(banned);
    }
  });

  it('names localStorage in exactly one module, and that module declares itself', () => {
    const naming = files.filter((file) => /\blocalStorage\b/.test(codeOnly(file)));
    expect(naming).toEqual(['browser.ts']);
    expect(readFileSync(join(srcDir, 'browser.ts'), 'utf8').slice(0, 2000)).toContain('@browser-only');
  });

  it('never writes to the console — a library that logs is noisy in someone else’s product', () => {
    for (const file of files) {
      expect(readFileSync(join(srcDir, file), 'utf8'), file).not.toMatch(/console\s*\./);
    }
  });
});

// ── the exported handle types are the ones the browser module wants ──────────────

describe('Autosave is structurally what installFlushTriggers needs', () => {
  it('exposes tick, flush, lastWrite and stop', () => {
    const { store } = harness();
    store.open();
    const auto: Autosave = store.autosave(() => FRESH);
    expect(typeof auto.tick).toBe('function');
    expect(typeof auto.flush).toBe('function');
    expect(typeof auto.stop).toBe('function');
    expect(auto.lastWrite).toBe(null);
  });
});

// ── the README's example, under test rather than under review ────────────────────

describe('the README example, verbatim', () => {
  // The example on the front page of this package, copied line for line, with every
  // `console.log` turned into the assertion it was implicitly making. It lives here because
  // an example that is only checked when its author remembers to check it is the same kind of
  // artefact as the two seams that rotted: a claim nothing compiles and nothing runs.
  it('prints exactly what the README says it prints', () => {
    interface V1 {
      readonly version: 1;
      readonly coins: number;
    }
    interface V2 {
      readonly version: 2;
      readonly wallet: { readonly coin: number };
    }

    const isReadmeV1: Recognise<V1> = (value) => {
      const coins = (value as { coins?: unknown }).coins;
      if (typeof coins !== 'number' || !Number.isFinite(coins)) {
        throw new RangeError(`save.v1.coins: expected a finite number, got ${String(coins)}`);
      }
      return { version: 1, coins };
    };

    const isReadmeV2: Recognise<V2> = (value) => {
      const coin = (value as { wallet?: { coin?: unknown } }).wallet?.coin;
      if (typeof coin !== 'number' || !Number.isFinite(coin)) {
        throw new RangeError(`save.v2.wallet.coin: expected a finite number, got ${String(coin)}`);
      }
      return { version: 2, wallet: { coin } };
    };

    const readmeChain = migrations(1, isReadmeV1)
      .step(
        2,
        'one coin counter became a wallet of currencies',
        (v1) => ({ version: 2 as const, wallet: { coin: v1.coins } }),
        isReadmeV2,
      )
      .seal();

    let clock = 1_700_000_000_000;
    const adapter = memoryStorage();
    const readmeStore = createStore({
      key: 'campus:save',
      chain: readmeChain,
      adapter,
      fresh: (): V2 => ({ version: 2, wallet: { coin: 0 } }),
      now: () => asEpochMillis(clock),
    });

    const payload = '{"coins":250}';
    adapter.set(
      'campus:save',
      JSON.stringify({ v: 1, t: clock - 90_000, n: 1, c: defaultChecksum(payload), d: payload }),
    );

    const opened = readmeStore.open();
    // > save 1 {"version":2,"wallet":{"coin":250}}
    expect([opened.source, opened.migratedFrom, JSON.stringify(opened.state)]).toEqual([
      'save',
      1,
      '{"version":2,"wallet":{"coin":250}}',
    ]);
    // > not-persistent 2 90000
    expect([readmeStore.status, readmeStore.version, elapsedSince(opened, asEpochMillis(clock))]).toEqual([
      'not-persistent',
      2,
      90_000,
    ]);

    let live: V2 = opened.state;
    const auto = readmeStore.autosave(() => live);
    live = { version: 2, wallet: { coin: 300 } };
    // > true false
    expect([auto.tick(), auto.tick()]).toEqual([true, false]);
    clock += 4001;
    // > true 94
    expect([auto.tick(), auto.lastWrite?.bytes]).toEqual([true, 94]);

    adapter.set('campus:save', '{"v":2,"t":0,"n":9,"c":"00000000","d":"{}"}');
    const broken = readmeStore.open();
    // > fresh false corrupt
    expect([broken.source, broken.firstRun, broken.failure?.reason]).toEqual(['fresh', false, 'corrupt']);
    // > persist: save "campus:save" failed its checksum — the envelope claims 00000000 …
    expect(readmeStore.rejected()?.failure.message).toBe(
      'persist: save "campus:save" failed its checksum — the envelope claims 00000000 and the payload hashes to 446b98f4. The payload was not parsed.',
    );

    live = readmeStore.reset();
    // > closed null
    expect([auto.flush().skipped, adapter.get('campus:save')]).toEqual(['closed', null]);
    expect(live).toEqual({ version: 2, wallet: { coin: 0 } });
  });
});
