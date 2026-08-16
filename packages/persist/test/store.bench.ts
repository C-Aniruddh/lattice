import { bench, describe } from 'vitest';
import { asEpochMillis } from '@lattice/core';
import { memoryStorage } from '../src/adapters.js';
import { migrations, type Recognise } from '../src/migrate.js';
import { createStore, inspect } from '../src/store.js';

/**
 * The two calls on a per-frame path.
 *
 * `autosave.tick()` runs sixty times a second for the life of a session and must cost a clock
 * read and a subtraction on the 239 frames out of 240 that do not write. The write itself is a
 * synchronous serialise plus a hash plus a storage call, which is why it is coalesced to once
 * every four seconds and why `minWriteIntervalMs` has a floor worth arguing about.
 */

interface Save {
  readonly version: 1;
  readonly wallet: Readonly<Record<string, number>>;
  readonly buildings: readonly { readonly id: number; readonly kind: string; readonly level: number }[];
}

const isSave: Recognise<Save> = (value) => value as Save;

const chain = migrations(1, isSave).seal();

function makeSave(buildings: number): Save {
  return {
    version: 1,
    wallet: { coin: 123456.789, ore: 42, favour: 7 },
    buildings: Array.from({ length: buildings }, (_unused, i) => ({
      id: i,
      kind: i % 3 === 0 ? 'lab' : 'dorm',
      level: (i % 7) + 1,
    })),
  };
}

const clock = { t: 1_700_000_000_000 };
const adapter = memoryStorage();
const store = createStore<1, Save>({
  key: 'campus',
  chain,
  adapter,
  fresh: () => makeSave(0),
  now: () => asEpochMillis(clock.t),
});
store.open();

const small = makeSave(20);
const large = makeSave(400);
const smallText = store.encode(small);
const largeText = store.encode(large);

describe('the per-frame path', () => {
  const auto = store.autosave(() => small);

  bench('autosave.tick — the 239 frames in 240 that do not write', () => {
    // The clock does not advance, so every call takes the interval branch.
    auto.tick();
  });
});

describe('the write path', () => {
  bench('encode — 20 buildings', () => {
    store.encode(small);
  });

  bench('encode — 400 buildings', () => {
    store.encode(large);
  });

  bench('save — 20 buildings, serialise + checksum + adapter', () => {
    store.save(small);
  });
});

describe('the read path', () => {
  bench('decode — 20 buildings', () => {
    store.decode(smallText);
  });

  bench('decode — 400 buildings', () => {
    store.decode(largeText);
  });

  bench('inspect — envelope only, payload untouched', () => {
    inspect(largeText);
  });
});
