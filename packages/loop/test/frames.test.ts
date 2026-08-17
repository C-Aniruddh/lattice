/**
 * `frames` — the two-source pump, tested in Node with no browser anywhere.
 *
 * The invariant this file exists for is I-23: **`browserFrames` keeps pumping with
 * `requestAnimationFrame` stubbed to never call back.** That is the hidden tab, and it is the
 * only thing keeping `@latticekit/persist`'s autosave alive at the exact moment tabs get closed.
 * A "simplification" of `browserFrames` down to rAF alone passes every test that runs in the
 * foreground, so the test below is written so that it cannot.
 */

import { describe, expect, it } from 'vitest';
import { browserFrames, manualFrames, DEFAULT_IDLE_PUMP_MS, type FrameHost, type PumpKind } from '../src/frames.js';

/**
 * A `window` in fifteen lines. Both queues are driven by hand, so "the tab went hidden" is
 * "stop calling `flushFrames`" and nothing else changes.
 */
function fakeHost(): FrameHost & {
  flushFrames(): void;
  flushInterval(): void;
  readonly liveFrames: number;
  readonly liveIntervals: number;
  readonly intervalPeriods: readonly number[];
} {
  const frameQueue = new Map<number, (t: number) => void>();
  const intervals = new Map<number, () => void>();
  const periods: number[] = [];
  let nextHandle = 1;
  return {
    requestAnimationFrame(cb) {
      const handle = nextHandle++;
      frameQueue.set(handle, cb);
      return handle;
    },
    cancelAnimationFrame(handle) {
      frameQueue.delete(handle);
    },
    setInterval(cb, ms) {
      const handle = nextHandle++;
      intervals.set(handle, cb);
      periods.push(ms);
      return handle;
    },
    clearInterval(handle) {
      intervals.delete(handle);
    },
    flushFrames() {
      // Copy first: a callback re-arms, and iterating the live map would run the new one too.
      const due = [...frameQueue.entries()];
      for (const [handle, cb] of due) {
        frameQueue.delete(handle);
        cb(0);
      }
    },
    flushInterval() {
      for (const cb of [...intervals.values()]) cb();
    },
    get liveFrames() {
      return frameQueue.size;
    },
    get liveIntervals() {
      return intervals.size;
    },
    get intervalPeriods() {
      return periods;
    },
  };
}

describe('manualFrames', () => {
  it('starts unstarted and reports it', () => {
    expect(manualFrames().started).toBe(false);
  });

  it('delivers a paint pump by default, because that is the one a test usually means', () => {
    const frames = manualFrames();
    const kinds: PumpKind[] = [];
    frames.start((kind) => kinds.push(kind));
    frames.pump();
    frames.pump('tick');
    frames.pump('paint');
    expect(kinds).toEqual(['paint', 'tick', 'paint']);
  });

  it('is a silent no-op once stopped — the shape I-17 is written against', () => {
    const frames = manualFrames();
    let pumps = 0;
    frames.start(() => {
      pumps += 1;
    });
    frames.pump();
    frames.stop();
    frames.pump();
    frames.pump('tick');
    expect(pumps).toBe(1);
    expect(frames.started).toBe(false);
  });

  it('is a silent no-op before it has ever been started', () => {
    const frames = manualFrames();
    expect(() => frames.pump()).not.toThrow();
  });

  it('restarts with a different pump, which is what a restarted loop needs', () => {
    const frames = manualFrames();
    const seen: string[] = [];
    frames.start(() => seen.push('first'));
    frames.pump();
    frames.start(() => seen.push('second'));
    frames.pump();
    expect(seen).toEqual(['first', 'second']);
  });
});

describe('browserFrames', () => {
  it('registers both sources: one rAF chain and one interval', () => {
    const host = fakeHost();
    const frames = browserFrames({ host });
    frames.start(() => {});
    expect(host.liveFrames).toBe(1);
    expect(host.liveIntervals).toBe(1);
  });

  it('paints from rAF and ticks from the interval, and never confuses the two', () => {
    const host = fakeHost();
    const kinds: PumpKind[] = [];
    browserFrames({ host }).start((kind) => kinds.push(kind));
    host.flushFrames();
    host.flushInterval();
    host.flushFrames();
    expect(kinds).toEqual(['paint', 'tick', 'paint']);
  });

  it('I-23: keeps pumping with requestAnimationFrame stubbed to never call back', () => {
    // The hidden tab, exactly. rAF is 0 Hz here — `flushFrames` is never called — and the
    // interval is the only thing left. Every autosave in the kit rides on this assertion.
    const host = fakeHost();
    const kinds: PumpKind[] = [];
    browserFrames({ host }).start((kind) => kinds.push(kind));
    for (let i = 0; i < 60; i += 1) host.flushInterval();
    expect(kinds).toHaveLength(60);
    expect(kinds.every((k) => k === 'tick')).toBe(true);
  });

  it('re-arms the rAF chain so paints keep coming', () => {
    const host = fakeHost();
    let paints = 0;
    browserFrames({ host }).start(() => {
      paints += 1;
    });
    for (let i = 0; i < 100; i += 1) host.flushFrames();
    expect(paints).toBe(100);
    expect(host.liveFrames).toBe(1);
  });

  it('defaults the idle period to one second, the granularity a browser will actually honor', () => {
    const host = fakeHost();
    browserFrames({ host }).start(() => {});
    expect(host.intervalPeriods).toEqual([DEFAULT_IDLE_PUMP_MS]);
    expect(DEFAULT_IDLE_PUMP_MS).toBe(1000);
  });

  it('takes a custom idle period', () => {
    const host = fakeHost();
    browserFrames({ host, idleMs: 250 }).start(() => {});
    expect(host.intervalPeriods).toEqual([250]);
  });

  it('refuses a zero or negative idle period by name — a busy loop is not a fast timer', () => {
    expect(() => browserFrames({ idleMs: 0 })).toThrow(RangeError);
    expect(() => browserFrames({ idleMs: 0 })).toThrow(/browserFrames\.idleMs/);
    expect(() => browserFrames({ idleMs: -1 })).toThrow(/-1/);
    expect(() => browserFrames({ idleMs: NaN })).toThrow(RangeError);
    expect(() => browserFrames({ idleMs: Infinity })).toThrow(RangeError);
  });

  it('I-11 (frames): stop() cancels the pending frame AND clears the interval', () => {
    // An rAF chain that re-arms unconditionally survives stop(), and with it the whole object
    // graph — canvas, world, audio.
    const host = fakeHost();
    const frames = browserFrames({ host });
    frames.start(() => {});
    frames.stop();
    expect(host.liveFrames).toBe(0);
    expect(host.liveIntervals).toBe(0);
  });

  it('delivers nothing after stop(), even if the host runs a callback it already had', () => {
    const host = fakeHost();
    let pumps = 0;
    const frames = browserFrames({ host });
    frames.start(() => {
      pumps += 1;
    });
    host.flushFrames();
    const stale = host.requestAnimationFrame;
    void stale;
    frames.stop();
    host.flushFrames();
    host.flushInterval();
    expect(pumps).toBe(1);
  });

  it('survives a hundred start/stop cycles without leaking a chain', () => {
    const host = fakeHost();
    const frames = browserFrames({ host });
    for (let i = 0; i < 100; i += 1) {
      frames.start(() => {});
      frames.stop();
    }
    expect(host.liveFrames).toBe(0);
    expect(host.liveIntervals).toBe(0);
  });

  it('never ends up with two chains when start() is called twice', () => {
    // Vite's HMR produces exactly this, and two live chains read as "the game is twice as
    // fast today".
    const host = fakeHost();
    const frames = browserFrames({ host });
    let pumps = 0;
    frames.start(() => {
      pumps += 1;
    });
    frames.start(() => {
      pumps += 1;
    });
    expect(host.liveFrames).toBe(1);
    expect(host.liveIntervals).toBe(1);
    host.flushFrames();
    expect(pumps).toBe(1);
  });

  it('ignores a stale rAF callback that a host runs after stop() anyway', () => {
    // `cancelAnimationFrame` is a request, not a guarantee: a callback already dispatched by
    // the host still arrives. Without the liveness check inside the chain, that one late frame
    // would pump a game that had already been torn down.
    const host = fakeHost();
    let stale: ((t: number) => void) | undefined;
    const leaky: FrameHost = {
      requestAnimationFrame(cb) {
        stale = cb;
        return host.requestAnimationFrame(cb);
      },
      cancelAnimationFrame: () => {},
      setInterval: host.setInterval,
      clearInterval: () => {},
    };
    const frames = browserFrames({ host: leaky });
    let pumps = 0;
    frames.start(() => {
      pumps += 1;
    });
    frames.stop();
    stale?.(0);
    host.flushInterval();
    expect(pumps).toBe(0);
  });

  it('stop() before start() is a no-op, not a crash', () => {
    expect(() => browserFrames({ host: fakeHost() }).stop()).not.toThrow();
  });

  it('stops from inside a paint callback without arming a fresh frame on the way out', () => {
    // A game that stops itself on a fatal error must not be pumped again. The chain re-arms
    // *before* the pump runs precisely so the stop() cancels the handle it just made.
    const host = fakeHost();
    const frames = browserFrames({ host });
    let pumps = 0;
    frames.start(() => {
      pumps += 1;
      frames.stop();
    });
    host.flushFrames();
    host.flushFrames();
    host.flushInterval();
    expect(pumps).toBe(1);
    expect(host.liveFrames).toBe(0);
  });

  it('names the missing method when there is no host at all — Node, a worker, an SSR pass', () => {
    const frames = browserFrames();
    expect(() => frames.start(() => {})).toThrow(TypeError);
    expect(() => frames.start(() => {})).toThrow(/requestAnimationFrame/);
    expect(() => frames.start(() => {})).toThrow(/manualFrames/);
  });

  it('names each missing method in turn, rather than failing later inside a callback', () => {
    const complete = fakeHost();
    for (const missing of ['requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', 'clearInterval'] as const) {
      const partial: Record<string, unknown> = {
        requestAnimationFrame: complete.requestAnimationFrame,
        cancelAnimationFrame: complete.cancelAnimationFrame,
        setInterval: complete.setInterval,
        clearInterval: complete.clearInterval,
      };
      delete partial[missing];
      const frames = browserFrames({ host: partial as unknown as FrameHost });
      expect(() => frames.start(() => {})).toThrow(new RegExp(missing));
    }
  });

  it('falls back to globalThis when no host is injected', () => {
    // The one branch that cannot be reached with an injected host. Restored immediately: a
    // leaked global here would change how every other suite in the workspace behaves.
    const target = globalThis as unknown as Record<string, unknown>;
    const saved = {
      requestAnimationFrame: target['requestAnimationFrame'],
      cancelAnimationFrame: target['cancelAnimationFrame'],
      setInterval: target['setInterval'],
      clearInterval: target['clearInterval'],
    };
    const host = fakeHost();
    try {
      target['requestAnimationFrame'] = host.requestAnimationFrame;
      target['cancelAnimationFrame'] = host.cancelAnimationFrame;
      target['setInterval'] = host.setInterval;
      target['clearInterval'] = host.clearInterval;
      const frames = browserFrames();
      const kinds: PumpKind[] = [];
      frames.start((kind) => kinds.push(kind));
      host.flushFrames();
      host.flushInterval();
      frames.stop();
      expect(kinds).toEqual(['paint', 'tick']);
      expect(host.liveFrames).toBe(0);
      expect(host.liveIntervals).toBe(0);
    } finally {
      for (const [key, value] of Object.entries(saved)) target[key] = value;
    }
  });
});
