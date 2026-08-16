import { describe, expect, it } from 'vitest';
import { memoryStorage, webStorage, type StorageLike } from '../src/adapters.js';

/** A `localStorage` stand-in with three methods, which is all the seam is. */
function fakeStorage(): StorageLike & { readonly cells: Map<string, string> } {
  const cells = new Map<string, string>();
  return {
    cells,
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => {
      cells.set(key, value);
    },
    removeItem: (key) => {
      cells.delete(key);
    },
  };
}

describe('webStorage', () => {
  it('delegates all three operations and reports itself durable', () => {
    const backing = fakeStorage();
    const adapter = webStorage(backing);

    expect(adapter.durable).toBe(true);
    expect(adapter.get('absent')).toBe(null);

    adapter.set('campus', 'payload');
    expect(backing.cells.get('campus')).toBe('payload');
    expect(adapter.get('campus')).toBe('payload');

    adapter.remove('campus');
    expect(adapter.get('campus')).toBe(null);
  });

  it('passes the platform error through, because the store needs it to tell quota from success', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('storage is disabled');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('gone');
      },
    };
    const adapter = webStorage(hostile);

    expect(() => adapter.get('k')).toThrow('storage is disabled');
    expect(() => adapter.set('k', 'v')).toThrow('QuotaExceededError');
    expect(() => adapter.remove('k')).toThrow('gone');
  });
});

describe('memoryStorage', () => {
  it('is not durable, which is the field that matters', () => {
    expect(memoryStorage().durable).toBe(false);
  });

  it('round-trips and forgets', () => {
    const adapter = memoryStorage();
    expect(adapter.get('campus')).toBe(null);
    adapter.set('campus', 'payload');
    expect(adapter.get('campus')).toBe('payload');
    adapter.remove('campus');
    expect(adapter.get('campus')).toBe(null);
  });

  it('copies its seed, so a fixture object stays the test’s to mutate', () => {
    const seed: Record<string, string> = { campus: 'first' };
    const adapter = memoryStorage(seed);
    seed['campus'] = 'second';

    expect(adapter.get('campus')).toBe('first');
    adapter.set('campus', 'third');
    expect(seed['campus']).toBe('second');
  });

  it('starts empty with no seed', () => {
    expect(memoryStorage().get('anything')).toBe(null);
  });
});
