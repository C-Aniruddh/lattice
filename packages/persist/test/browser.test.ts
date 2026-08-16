import { describe, expect, it } from 'vitest';
import { asEpochMillis } from '@lattice/core';
import { memoryStorage, type StorageLike } from '../src/adapters.js';
import { migrations, type Recognise } from '../src/migrate.js';
import { createStore, type Autosave, type WriteResult } from '../src/store.js';
import { browserStorage, installFlushTriggers, type FlushTargets, type ListenerTarget } from '../src/browser.js';

/** `document` and `window`, structurally, in Node with no shims. */
function fakeTargets(visibilityState = 'visible'): FlushTargets & {
  fire: (target: 'visibility' | 'page', type: string) => void;
  bound: () => number;
  setVisibility: (value: string) => void;
} {
  const listeners = { visibility: new Map<string, Set<() => void>>(), page: new Map<string, Set<() => void>>() };
  let state = visibilityState;

  const target = (which: 'visibility' | 'page'): ListenerTarget => ({
    addEventListener: (type, listener) => {
      const set = listeners[which].get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners[which].set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners[which].get(type)?.delete(listener);
    },
  });

  const visibilityTarget = target('visibility');
  return {
    visibility: {
      addEventListener: visibilityTarget.addEventListener,
      removeEventListener: visibilityTarget.removeEventListener,
      get visibilityState(): string {
        return state;
      },
    },
    page: target('page'),
    fire: (which, type) => {
      for (const listener of [...(listeners[which].get(type) ?? [])]) listener();
    },
    bound: () =>
      [...listeners.visibility.values(), ...listeners.page.values()].reduce((n, set) => n + set.size, 0),
    setVisibility: (value) => {
      state = value;
    },
  };
}

/** A handle that records what it was asked to do, so the wiring is what is under test. */
function recordingAutosave(): Autosave & { flushes: number } {
  const handle = {
    flushes: 0,
    tick: () => false,
    flush(): WriteResult {
      handle.flushes += 1;
      return { written: true, bytes: 0, skipped: null, error: null };
    },
    lastWrite: null,
    stop: () => undefined,
  };
  return handle;
}

describe('installFlushTriggers', () => {
  it('flushes on pagehide, and on visibilitychange only when the page is hidden', () => {
    const targets = fakeTargets();
    const auto = recordingAutosave();
    installFlushTriggers(auto, targets);

    // Coming back to a visible tab is not a moment that owes anyone a write.
    targets.fire('visibility', 'visibilitychange');
    expect(auto.flushes).toBe(0);

    targets.setVisibility('hidden');
    targets.fire('visibility', 'visibilitychange');
    expect(auto.flushes).toBe(1);

    targets.fire('page', 'pagehide');
    expect(auto.flushes).toBe(2);
  });

  it('binds neither beforeunload nor anything else — two listeners, no more', () => {
    const targets = fakeTargets();
    installFlushTriggers(recordingAutosave(), targets);
    expect(targets.bound()).toBe(2);

    const auto = recordingAutosave();
    installFlushTriggers(auto, targets);
    targets.fire('page', 'beforeunload');
    expect(auto.flushes).toBe(0);
  });

  it('returns a disposer that removes both listeners and does not write', () => {
    const targets = fakeTargets('hidden');
    const auto = recordingAutosave();
    const dispose = installFlushTriggers(auto, targets);

    dispose();
    expect(auto.flushes).toBe(0);
    expect(targets.bound()).toBe(0);

    targets.fire('visibility', 'visibilitychange');
    targets.fire('page', 'pagehide');
    expect(auto.flushes).toBe(0);

    // Idempotent: removing a listener that is not bound is a no-op.
    expect(() => dispose()).not.toThrow();
  });

  it('is the other half of the reset trap: a reset survives every teardown event', () => {
    // The whole trap in one test. The game has a live autosave wired to page events; the
    // player hits START OVER; the page is then hidden and unloaded. Storage must stay empty.
    const isState: Recognise<{ readonly coin: number }> = (value) => {
      const coin = (value as { coin?: unknown }).coin;
      if (typeof coin !== 'number') throw new TypeError('save.coin: expected a number');
      return { coin };
    };
    const adapter = memoryStorage();
    const store = createStore({
      key: 'campus',
      chain: migrations(1, isState).seal(),
      adapter,
      fresh: () => ({ coin: 0 }),
      now: () => asEpochMillis(1000),
    });

    store.open();
    let live = { coin: 500 };
    store.save(live);
    const auto = store.autosave(() => live);
    const targets = fakeTargets();
    const dispose = installFlushTriggers(auto, targets);
    expect(adapter.get('campus')).toBeTypeOf('string');

    live = store.reset();

    targets.setVisibility('hidden');
    targets.fire('visibility', 'visibilitychange');
    targets.fire('page', 'pagehide');
    dispose();

    expect(adapter.get('campus')).toBe(null);
  });
});

describe('browserStorage', () => {
  it('wraps a storage the platform hands over, and reports it durable', () => {
    const cells = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => cells.get(key) ?? null,
      setItem: (key, value) => {
        cells.set(key, value);
      },
      removeItem: (key) => {
        cells.delete(key);
      },
    };

    const adapter = browserStorage({ localStorage: storage });
    expect(adapter.durable).toBe(true);
    adapter.set('campus', 'payload');
    expect(adapter.get('campus')).toBe('payload');
    // The probe key never outlives the check.
    expect([...cells.keys()]).toEqual(['campus']);
  });

  it('degrades to memory when the property access itself throws — the private-mode trap', () => {
    // Safari in private mode has historically thrown here, not on setItem, so a try/catch
    // around the write alone still takes the page down at module scope.
    const scope = {};
    Object.defineProperty(scope, 'localStorage', {
      get(): StorageLike {
        throw new Error('SecurityError: the operation is insecure');
      },
    });

    const adapter = browserStorage(scope as { readonly localStorage?: StorageLike });
    expect(adapter.durable).toBe(false);
    adapter.set('campus', 'payload');
    expect(adapter.get('campus')).toBe('payload');
  });

  it('degrades to memory when the object is handed over but refuses every write', () => {
    const adapter = browserStorage({
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => undefined,
      },
    });
    expect(adapter.durable).toBe(false);
  });

  it('degrades to memory when there is no storage at all', () => {
    expect(browserStorage({}).durable).toBe(false);
    // A host that sets the property to `null` rather than leaving it absent — which is what a
    // few embedded webviews do, and what an untyped caller can always hand over.
    const nulled = { localStorage: null } as unknown as { readonly localStorage?: StorageLike };
    expect(browserStorage(nulled).durable).toBe(false);
  });

  it('reads globalThis when given no scope, and finds nothing under plain node', () => {
    const host = globalThis as { localStorage?: StorageLike };
    const had = 'localStorage' in host;
    expect(browserStorage().durable).toBe(had);

    if (!had) {
      const cells = new Map<string, string>();
      host.localStorage = {
        getItem: (key) => cells.get(key) ?? null,
        setItem: (key, value) => {
          cells.set(key, value);
        },
        removeItem: (key) => {
          cells.delete(key);
        },
      };
      try {
        expect(browserStorage().durable).toBe(true);
      } finally {
        delete host.localStorage;
      }
    }
  });
});
