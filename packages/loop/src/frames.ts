/**
 * **`@browser-only`** — the cadence adapter. The one module in this package that names a host
 * global, and the reason every other module runs unchanged in Node with no shims.
 *
 * A loop that reaches for `requestAnimationFrame` itself is wrong 100% of the time in a
 * hidden tab, so *when to run* is injected exactly as the clock is. `browserFrames()` is the
 * **two-source pump**: rAF for `'paint'`, a plain interval for `'tick'`. Neither call tells
 * you what time it is, which is the seam — **the kit ships the cadence, the game ships the
 * clock** — and it is why the determinism rule is untouched by this file.
 *
 * Everything else here is pure and Node-safe: the `PumpKind`/`Pump`/`FrameSource` vocabulary
 * is three type declarations, and {@link manualFrames} touches nothing at all. They share the
 * file because they are one concept and because the linter's adapter count should read
 * "`loop` has exactly one module that can see a browser", not two. Nothing in this module
 * runs at import; a Node build tree-shakes {@link browserFrames} out entirely.
 *
 * ## The trap this file exists to make un-steppable-in
 *
 * rAF is 0 Hz in a background tab. A loop built on rAF alone stops advancing the game the
 * moment the player looks at another tab — and because the canvas keeps showing its last
 * painted frame, it *looks* alive. The report that eventually arrives is "my production
 * resets when I switch tabs", weeks later, from a player.
 *
 * **And it would stop the kit saving.** `@latticekit/persist` schedules its debounced autosave
 * through `loop.real`, and every timer in this package advances only when a pump arrives. The
 * interval half of this function is therefore what keeps autosave alive in a hidden tab —
 * which is precisely when tabs get closed. A one-line "simplification" down to rAF alone
 * passes every test that runs in the foreground and silently stops saving on the one code
 * path nobody watches. That is invariant I-23, and it is a separate invariant for that
 * reason.
 */

import { expectFinite } from '@latticekit/core';

/**
 * Period of the non-painting pump, in milliseconds. Default for
 * {@link BrowserFramesOptions.idleMs}.
 *
 * One second, because browsers clamp background intervals to roughly that and Chrome
 * throttles harder still after five minutes. This is a **floor on how stale a hidden game is
 * allowed to get**, not a frame rate, and lowering it buys nothing the platform will honor.
 * It is also the granularity a hidden-tab timer actually has, which is why a sub-second
 * debounce in `@latticekit/persist` is meaningless in the background.
 */
export const DEFAULT_IDLE_PUMP_MS = 1000;

/**
 * Why a pump happened.
 *
 * - `'paint'` — the host is about to display a frame. `render` may run.
 * - `'tick'`  — the host is not painting (hidden tab, occluded window, minimized), but time
 *               has still passed. `update` runs; `render` does not.
 *
 * A boolean was rejected: `pump(true)` at a call site says nothing, and this distinction is
 * the single most important one in the package. Get it backwards and either the game freezes
 * whenever it is not visible, or it repaints a canvas nobody is looking at sixty times a
 * second.
 */
export type PumpKind = 'paint' | 'tick';

/**
 * A callback the loop hands to its frame source. Calling it runs one pump, **synchronously**.
 *
 * Synchronous matters: the loop reads the clock once inside the pump and everything in that
 * pump is accounted against that one reading. A frame source that deferred the call — through
 * a promise, a microtask, a `setTimeout(0)` — would move the work away from the reading that
 * paid for it, and the elapsed time would be attributed to the wrong pump.
 */
export type Pump = (kind: PumpKind) => void;

/**
 * Where pumps come from. The loop never schedules anything itself.
 *
 * `start` must be safe to call after `stop` — a loop can be restarted, and Vite's HMR
 * restarts one on every save. `stop` must cancel **everything** it registered: an rAF chain
 * that re-arms unconditionally survives `stop()` and keeps the whole object graph alive with
 * it, canvas, world, audio and all. Two live chains driving one canvas is a real failure mode
 * and it presents as a game running at double speed for no reason anyone can find.
 */
export interface FrameSource {
  start(pump: Pump): void;
  stop(): void;
}

/**
 * Just enough of `window` to drive a loop. Structural, so a real `window` satisfies it and so
 * does a fifteen-line fake in a test.
 *
 * This is the seam that keeps this file testable at 100% coverage in Node: nothing here ever
 * has to touch a real browser to be exercised, and a game that wants a frame-rate cap or a
 * fixed-cadence recorder writes one of these instead of asking for an option.
 */
export interface FrameHost {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

/** Options for {@link browserFrames}. */
export interface BrowserFramesOptions {
  /**
   * Period of the non-painting pump. Default {@link DEFAULT_IDLE_PUMP_MS}.
   *
   * Do not lower it hoping for a faster hidden tab: browsers clamp background intervals to
   * roughly one second, and Chrome throttles harder still after five minutes. This number is
   * a floor on how stale a hidden game is allowed to get, not a frame rate.
   *
   * @throws RangeError at construction if it is not a finite number greater than zero. A zero
   * period is a busy loop wearing a timer's clothes.
   */
  readonly idleMs?: number;

  /**
   * Injected for tests. Defaults to `globalThis`.
   *
   * If you pass nothing in an environment with no `requestAnimationFrame` — Node, a worker,
   * an SSR pass — `start()` throws a `TypeError` naming the missing method rather than
   * failing later with `undefined is not a function` inside a callback three frames deep.
   */
  readonly host?: FrameHost;
}

/**
 * **Browser only.** The two-source pump: `requestAnimationFrame` for paints, a plain interval
 * for everything else.
 *
 * Both pumps run while the tab is visible — the extra `'tick'` pumps cost one clock read and
 * an empty accumulator check, and only `'paint'` pumps ever render, so nothing is drawn
 * twice. When the tab is hidden rAF stops and the interval is all that is left, which is
 * exactly the arrangement that keeps `update`, the schedulers and therefore autosave alive.
 *
 * The rAF chain re-arms **before** the pump runs, so a game that stops itself from inside a
 * callback has its pending handle canceled by the `stop()` it just called, rather than
 * arming a fresh frame on the way out of a fatal error.
 *
 * @throws RangeError if `idleMs` is not a finite number greater than zero.
 */
export function browserFrames(options: BrowserFramesOptions = {}): FrameSource {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_PUMP_MS;
  expectFinite(idleMs, 'browserFrames.idleMs');
  if (idleMs <= 0) {
    throw new RangeError(
      `browserFrames.idleMs: expected a finite number > 0, got ${String(idleMs)} — a zero period is a busy loop, not a fast timer`,
    );
  }
  const host = options.host;

  /** Everything one `start()` registered, so `stop()` can undo exactly that and nothing else. */
  interface Binding {
    readonly host: FrameHost;
    readonly pump: Pump;
    rafHandle: number;
    intervalHandle: number;
    stopped: boolean;
  }

  let bound: Binding | undefined;

  const source: FrameSource = {
    start(pump) {
      // Idempotent by construction rather than by a flag: a second `start` tears the first
      // registration down before building a new one, so a restart can never leave two chains
      // running. Two chains is the bug that reads as "the game is twice as fast today".
      source.stop();

      const target = host ?? (globalThis as unknown as Partial<FrameHost>);
      const required = ['requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', 'clearInterval'] as const;
      for (const method of required) {
        if (typeof target[method] !== 'function') {
          throw new TypeError(
            `browserFrames.start: the host has no ${method}() — browserFrames is browser-only; in Node pass { host } or use manualFrames()`,
          );
        }
      }
      const ready = target as FrameHost;

      const binding: Binding = { host: ready, pump, rafHandle: 0, intervalHandle: 0, stopped: false };
      bound = binding;

      const frame = (): void => {
        if (binding.stopped) return;
        // Re-arm first. A game that stops itself from inside a callback then has this handle
        // canceled by the `stop()` it just called; re-arming afterwards would instead start a
        // fresh chain on the way out of a fatal error, and the loop would keep pumping a game
        // that had already decided to die.
        binding.rafHandle = ready.requestAnimationFrame(frame);
        binding.pump('paint');
      };

      binding.rafHandle = ready.requestAnimationFrame(frame);
      binding.intervalHandle = ready.setInterval(() => {
        if (!binding.stopped) binding.pump('tick');
      }, idleMs);
    },

    stop() {
      const binding = bound;
      if (binding === undefined) return;
      bound = undefined;
      binding.stopped = true;
      binding.host.cancelAnimationFrame(binding.rafHandle);
      binding.host.clearInterval(binding.intervalHandle);
    },
  };

  return source;
}

/**
 * A frame source a test drives by hand.
 *
 * Together with {@link manualClock} this is the entire testing story for the package: no
 * fake timers, no `await`, no flake, and a simulated hour in a microsecond. It is also what
 * `replay()` drives, which is why it lives in the shipped surface rather than in a test
 * helper file.
 */
export interface ManualFrames extends FrameSource {
  /**
   * Run one pump synchronously. Defaults to `'paint'`, because that is the pump a test
   * usually means; pass `'tick'` to reproduce a hidden tab.
   *
   * **A pump on a stopped source is a silent no-op**, not an error. That is deliberate: the
   * assertion "no further callbacks arrive after `stop()`" (I-17) is written by pumping a
   * stopped source and checking a counter, and a throw would make that test assert on the
   * exception instead of on the thing that matters.
   */
  pump(kind?: PumpKind): void;
  /** `true` between `start()` and `stop()`. The cheapest check that `loop.stop()` released. */
  readonly started: boolean;
}

/** A frame source that does nothing until a test tells it to. See {@link ManualFrames}. */
export function manualFrames(): ManualFrames {
  let live: Pump | undefined;
  return {
    get started() {
      return live !== undefined;
    },
    start(pump) {
      live = pump;
    },
    stop() {
      live = undefined;
    },
    pump(kind = 'paint') {
      const target = live;
      if (target !== undefined) target(kind);
    },
  };
}
