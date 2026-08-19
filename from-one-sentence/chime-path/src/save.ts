/**
 * What the mountain keeps: where the chimes hang and what each one is tuned to.
 *
 * Arc length and pitch, and nothing else. The trail, the terrain and every chime's grid position
 * are all pure functions of the seed, so storing them would be storing a consequence — and a
 * consequence in a save file is a save that stops matching the world the moment the world's
 * generator is touched.
 */
import { asEpochMillis } from '@latticekit/core';
import { browserStorage, createStore, migrations } from '@latticekit/persist';
import type { Recognize, Store } from '@latticekit/persist';

export interface SavedChime {
  /** Arc length along the trail, in world pixels. */
  readonly s: number;
  /** Index into the scale. */
  readonly pitch: number;
}

export interface SaveV1 {
  readonly version: 1;
  readonly chimes: readonly SavedChime[];
}

/** Returns the value typed, or throws naming the field. Never a boolean — a boolean has already
 *  discarded the value that was wrong, so it cannot say what was wrong with it. */
const isV1: Recognize<SaveV1> = (value) => {
  const raw = (value as { chimes?: unknown }).chimes;
  if (!Array.isArray(raw)) {
    throw new RangeError(`save.v1.chimes: expected an array, got ${String(raw)}`);
  }
  const chimes: SavedChime[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as { s?: unknown; pitch?: unknown };
    // JSON turns Infinity and NaN into `null`, under a perfectly valid checksum, and they come
    // back as NaN on the next tick. The finite check is the guard that matters on load.
    if (typeof c?.s !== 'number' || !Number.isFinite(c.s) || c.s < 0) {
      throw new RangeError(`save.v1.chimes[${i}].s: expected a finite arc length, got ${String(c?.s)}`);
    }
    if (typeof c.pitch !== 'number' || !Number.isInteger(c.pitch) || c.pitch < 0) {
      throw new RangeError(`save.v1.chimes[${i}].pitch: expected a scale index, got ${String(c.pitch)}`);
    }
    chimes.push({ s: c.s, pitch: c.pitch });
  }
  return { version: 1, chimes };
};

const chain = migrations(1, isV1).seal();

export function openSave(): { store: Store<SaveV1>; opened: ReturnType<Store<SaveV1>['open']> } {
  const store = createStore({
    key: 'chime-path:save',
    chain,
    adapter: browserStorage(),
    fresh: (): SaveV1 => ({ version: 1, chimes: [] }),
    // No default, deliberately: a save's timestamp is the game's own wall clock or it is a lie.
    now: () => asEpochMillis(Date.now()),
    minWriteIntervalMs: 3000,
  });
  return { store, opened: store.open() };
}
