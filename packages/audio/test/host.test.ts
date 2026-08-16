import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultContext, everyInterval } from '../src/host.js';

import { FakeContext } from './fake-context.js';

/**
 * The package's one declared adapter, and the only file in it that reads a global.
 *
 * Node has no `AudioContext`, which is what makes the first case here the one every test run
 * and every server render actually takes.
 */

const NAMES = ['AudioContext', 'webkitAudioContext'] as const;

function withGlobal(name: (typeof NAMES)[number], value: unknown): void {
  Reflect.set(globalThis, name, value);
}

afterEach(() => {
  for (const name of NAMES) Reflect.deleteProperty(globalThis, name);
  vi.useRealTimers();
});

describe('defaultContext', () => {
  it('is null where there is no such global at all — Node, a worker, a server render', () => {
    expect(defaultContext()).toBeNull();
  });

  it('constructs the standard one when it exists', () => {
    const built: unknown[] = [];
    withGlobal('AudioContext', class {
      constructor() {
        built.push(this);
      }
    });
    expect(defaultContext()).not.toBeNull();
    expect(built).toHaveLength(1);
  });

  it('falls back to the prefixed one, which Safari before 14.1 still ships', () => {
    withGlobal('webkitAudioContext', FakeContext);
    expect(defaultContext()).toBeInstanceOf(FakeContext);
  });

  it('prefers the standard name when a browser has both', () => {
    class Standard {}
    withGlobal('AudioContext', Standard);
    withGlobal('webkitAudioContext', FakeContext);
    expect(defaultContext()).toBeInstanceOf(Standard);
  });

  it('is null, not an exception, when the constructor throws', () => {
    // A locked-down browser, or one that has run out of contexts. A boot path that can throw
    // because of a *sound* is the worst trade in the kit.
    withGlobal('AudioContext', class {
      constructor() {
        throw new Error('AudioContext is disabled by policy');
      }
    });
    expect(defaultContext()).toBeNull();
  });
});

describe('everyInterval', () => {
  it('calls back on the interval until its disposer runs', () => {
    vi.useFakeTimers();
    let calls = 0;
    const stop = everyInterval(() => {
      calls += 1;
    }, 200);
    vi.advanceTimersByTime(650);
    expect(calls).toBe(3);
    stop();
    vi.advanceTimersByTime(1000);
    expect(calls).toBe(3);
  });

  it('has an idempotent disposer, per the teardown contract in core', () => {
    vi.useFakeTimers();
    const stop = everyInterval(() => undefined, 200);
    stop();
    expect(() => stop()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
