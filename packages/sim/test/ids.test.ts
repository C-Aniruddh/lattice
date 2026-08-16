import { describe, expect, it } from 'vitest';

import { asEntityId, createIdSource, mintId } from '../src/ids.js';
import type { EntityId } from '../src/ids.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

describe('createIdSource', () => {
  it('starts at zero for a new world and at the saved counter for an old one', () => {
    expect(createIdSource().next).toBe(0);
    expect(createIdSource(3417).next).toBe(3417);
  });

  it('is JSON-shaped, so it belongs in the game state next to the ledger', () => {
    expect(JSON.stringify(createIdSource(3417))).toBe('{"next":3417}');
  });

  it('names a counter that could only have come from something else', () => {
    expect(messageOf(() => createIdSource(-1))).toContain('sim.createIdSource: next must be >= 0');
    expect(messageOf(() => createIdSource(1.5))).toContain('sim.createIdSource: next');
    expect(messageOf(() => createIdSource(Number.NaN))).toContain('sim.createIdSource: next');
    // Above 2⁵³ a double cannot hold consecutive integers, so the allocator would stop allocating
    // while appearing to work.
    expect(messageOf(() => createIdSource(2 ** 53))).toContain('sim.createIdSource: next');
  });
});

describe('mintId (I18)', () => {
  it('hands out ten thousand ids that are strictly increasing and never repeat', () => {
    const source = createIdSource();
    const seen = new Set<number>();
    let previous = -1;
    for (let i = 0; i < 10_000; i += 1) {
      const id = mintId(source);
      expect(id).toBeGreaterThan(previous);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      previous = id;
    }
    expect(source.next).toBe(10_000);
  });

  it('never reuses an id, even when everything it named is gone', () => {
    // Recycling a freed id is the ABA bug in a game: a reference held to a lamp that was
    // extinguished silently becomes a reference to the lamp built afterwards.
    const source = createIdSource();
    const first = mintId(source);
    const second = mintId(source);
    expect(second).not.toBe(first);
    expect(mintId(source)).toBe(2);
  });

  it('replays: the same sequence of actions mints the same ids', () => {
    const live = createIdSource();
    const replayed = createIdSource();
    const liveIds = [mintId(live), mintId(live), mintId(live)];
    const replayedIds = [mintId(replayed), mintId(replayed), mintId(replayed)];
    expect(replayedIds).toEqual(liveIds);
  });

  it('refuses to mint from a counter that has left the exact integers', () => {
    const corrupt = { next: 2 ** 53 };
    expect(messageOf(() => mintId(corrupt))).toContain('sim.mintId: source.next');
  });
});

describe('asEntityId — the load boundary (I18)', () => {
  it('narrows an integer that the counter has already handed out', () => {
    const source = createIdSource();
    const minted = mintId(source);
    mintId(source);
    expect(asEntityId(0, source, 'save.lamps[0]')).toBe(minted);
    expect(asEntityId(1, source, 'save.lamps[1]')).toBe(1);
  });

  it('refuses an id at or above the counter — proof the counter was not saved', () => {
    const source = createIdSource(5);
    const message = messageOf(() => asEntityId(5, source, 'save.lamps[3]'));
    expect(message).toContain('save.lamps[3]');
    expect(message).toContain("at or above the allocator's next id (5)");
    expect(messageOf(() => asEntityId(9, source, 'save.lamps[3]'))).toContain('entity id 9');
  });

  it('refuses an id that is not a non-negative safe integer', () => {
    const source = createIdSource(5);
    expect(messageOf(() => asEntityId(-1, source, 'save.lamps[0]'))).toContain(
      'expected a non-negative entity id',
    );
    expect(messageOf(() => asEntityId(1.5, source, 'save.lamps[0]'))).toContain('save.lamps[0]');
    expect(messageOf(() => asEntityId(Number.NaN, source, 'save.lamps[0]'))).toContain('save.lamps[0]');
  });

  it('re-narrows every id after a round trip through JSON (I18)', () => {
    const source = createIdSource();
    const lamps: EntityId[] = [mintId(source), mintId(source), mintId(source)];
    // The counter is saved *with* the entities, in the same write.
    const written = JSON.stringify({ source, lamps });
    const parsed = JSON.parse(written) as { source: { next: number }; lamps: number[] };
    const restored = createIdSource(parsed.source.next);
    const rebuilt = parsed.lamps.map((value, index) =>
      asEntityId(value, restored, `save.lamps[${String(index)}]`),
    );
    expect(rebuilt).toEqual(lamps);
    // And the next mint does not collide with anything the save already named.
    expect(mintId(restored)).toBe(3);
  });

  it('catches the migration that mints ids without writing the counter', () => {
    // The v1 `lampsLit: number` → v2 `lamps: EntityId[]` migration must write `IdSource.next` too.
    const migrating = createIdSource();
    const lamps = [mintId(migrating), mintId(migrating)];
    // The bug: the entities were saved and the counter was not.
    const restored = createIdSource(0);
    expect(messageOf(() => asEntityId(lamps[0] ?? 0, restored, 'save.lamps[0]'))).toContain(
      "at or above the allocator's next id (0)",
    );
  });
});
