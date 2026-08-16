/**
 * The fixed step and the blend factor — the only part of the kit that knows what time it is.
 *
 * A loop advances a game's rules at a fixed rate off an injected wall clock **whether or not
 * anything is being painted**, and hands the renderer a blend factor so the pictures can run
 * at whatever rate the display manages. Two consequences fall out of that sentence and most
 * of this file is their bookkeeping: a test runs a simulated hour in a millisecond with no
 * timers and no flake, and a backgrounded tab keeps its books straight instead of quietly
 * deleting every minute the player spent elsewhere.
 *
 * ## One pump, in order
 *
 * ```
 * 1  nowMs = clock.now(); elapsed = max(nowMs - last, 0); last = nowMs   ← one accounting read
 * 2  realTime += elapsed;  real.advance(elapsed)                        ← unclamped, unpaused
 * 3  run queued jobs, in creation order, each at most once              ← off the paint path
 * 4  accumulator += elapsed * speed
 * 5  if accumulator > maxCatchUp: dropped += excess; accumulator = maxCatchUp; onStall(excess)
 * 6  while accumulator >= step:
 *        sim.advance(step)                                              ← timers before the step
 *        for each update subscriber, in order: fn(stepSeconds, tick)
 *        tick++; accumulator -= step
 * 7  if kind === 'paint':
 *        alpha = paused ? 1 : accumulator / step
 *        for each render subscriber: fn(alpha, time + alpha * stepSeconds, nowMs)
 * 8  stats
 * ```
 *
 * Control calls take effect at the **next** pump boundary — `pause()` from inside `update`
 * does not truncate the pump it was called from — except `stop()`, which takes effect
 * immediately, because a game stopping itself on a fatal error must not be updated again.
 *
 * ## Integer microseconds, and why 60 Hz reads 16.667
 *
 * `accumulator -= 1 / 60` ten thousand times does not land where the arithmetic says, and at
 * 60 Hz there is no whole number of milliseconds in a step to hide behind. So the accumulator
 * is **integer microseconds**: `stepUs = round(1e6 / hz)` — 16,667 at 60 Hz, 20,000 at 50 —
 * and elapsed enters as `round((now - last) * 1000)`. Every add and subtract is integer
 * arithmetic that cannot drift, which is what makes every `dt` bit-identical and both
 * `stepSeconds` and `stepMs` stable enough to compare against a recorded log.
 *
 * Two things follow. `hz` must be a positive integer, because it divides that constant. And
 * 60 Hz is really 59.9988 Hz — a step of 16,667 µs rather than 16,666.67 — which is 0.002%
 * and matters to nobody, but it *is* why `stepMs` reads 16.667 rather than
 * 16.666666666666668. A reviewer who expected the second number should read this paragraph
 * rather than file a bug.
 *
 * ## What this package will never do
 *
 * It credits nothing. There is no `offlineSeconds`, no "welcome back" event, no `awayMs` on
 * any callback, and it will not grow one. The clamp in step 5 does not defer the excess to a
 * later frame — that only moves the spiral one frame along — and it does not hand it to
 * anybody either: it is dropped, counted in `stats.droppedSeconds`, and reported to `onStall`
 * for diagnostics. An hour in a background tab arrives as one enormous `elapsed`, becomes
 * 250 ms of ticks, and the other 3,599.75 seconds cease to exist as far as this file is
 * concerned. They were never its to lose — `@lattice/sim` has already integrated the same
 * interval from its own stored epoch timestamp. **The loop advances callbacks; `sim` advances
 * value.**
 *
 * It also has no epoch. `Clock` is monotonic and `performance.now()` counts from an arbitrary
 * per-document origin, so `clock.now()` is meaningless the moment it crosses a reload
 * boundary — which is the only boundary a save exists to cross. `persist` stamps saves; this
 * file contributes the cadence and nothing else.
 */

import { expectFinite, expectInt, type Disposer } from '@lattice/core';
import type { Clock } from './clock.js';
import type { FrameSource, Pump } from './frames.js';
import { createTimeline, type Scheduler } from './scheduler.js';
import type { FrameStats } from './stats.js';

/** Fixed steps per second when `hz` is not given. 60 is what the interpolation hides best. */
export const DEFAULT_HZ = 60;

/**
 * How much real time one pump may spend catching up, in ms. Default 250 — about fifteen steps
 * at 60 Hz.
 *
 * This is not an optimization; it is the **termination condition**. Without it a pump that
 * takes longer than the steps it produces makes more steps than the next pump can afford, and
 * the loop accelerates into a locked tab. Its disguise: with the clamp in place a game that is
 * far too slow *degrades* — sim time simply falls behind real time — so it looks like a game
 * running in slow motion. `stats.stepsLastPump` sustained above 1 and a growing
 * `realTime - time` are the tells.
 *
 * Do not raise it to "fix" the drift a hidden tab accumulates. The ceiling is what stops a
 * restored tab spending four seconds inside one frame while the browser paints nothing. A game
 * that wants faithful sim time in the background wants timestamps, not more catch-up.
 */
export const DEFAULT_MAX_CATCH_UP_MS = 250;

/** A pump costing more than this counts against `stats.overBudget`. Matches `kit.json`'s budget. */
export const DEFAULT_BUDGET_MS = 8;

/** The largest `hz` whose step is still at least one microsecond. See {@link LoopOptions.hz}. */
const MAX_HZ = 1_000_000;

/** Smoothing weight for the timing figures. A negative power of two, so the EMA is exact. */
const SMOOTHING = 0.125;

/** The window `stats.fps` is counted over, in milliseconds. */
const FPS_WINDOW_MS = 1000;

/**
 * Where an exception came from, for `onError`.
 *
 * `'timer'` is a callback on either timeline; `'update'` covers the fixed-step subscribers and
 * also `onStall`, which is reported there because it is part of the same accounting phase and
 * a diagnostics callback that throws has still killed the pump.
 */
export type LoopPhase = 'update' | 'render' | 'job' | 'timer';

/**
 * A unit of work that must happen **soon, at most once per pump, and never on the paint
 * path** — a navigation field rebuilt after the map changed, a spatial index reinserted, a
 * layout recomputed after a resize.
 *
 * `after(0, fn)` is the trap that looks like it does this: ten `after(0)` calls in one pump
 * queue ten one-shots and run the sweep ten times, which is the bug with extra steps. The
 * guarantee here is per **pump**, not per step — fifteen catch-up steps that each dirty a flow
 * field still produce exactly one sweep.
 */
export interface Job {
  /** Mark the work as needed. Idempotent within a pump: ten requests are one run. */
  request(): void;
  /** Un-request it. A job that has already run this pump is unaffected. */
  cancel(): void;
  /** Requested and not yet run. */
  readonly queued: boolean;
}

/** Options for {@link createLoop}. Only `clock` and `frames` are required. */
export interface LoopOptions {
  /**
   * The host's clock. The one global clock reading in the whole application, injected.
   *
   * @throws TypeError at construction if it has no `now()`. Failing here rather than on the
   * first pump is the difference between an error naming the option and `undefined is not a
   * function` inside a frame callback.
   */
  readonly clock: Clock;

  /**
   * Where pumps come from. `browserFrames()` in a game, `manualFrames()` in a test.
   *
   * @throws TypeError at construction if it has no `start()`/`stop()`.
   */
  readonly frames: FrameSource;

  /**
   * Advance the game by exactly `dt` seconds. Called 0..n times per pump, n bounded by
   * `maxCatchUpMs`; called on `'tick'` pumps as well, so this is where **everything that is
   * not painting** belongs — economy, HUD data, autosave decisions, quest settlement. The
   * source game's HUD updated only inside the frame callback and froze with the renderer in a
   * background tab: stale prices, stale disabled buttons, a shop that would not open.
   * Everything was working; only the painting had stopped.
   *
   * `tick` is a **non-negative integer**, starts at 0, increments by exactly one per call, and
   * never skips or repeats for the life of the loop. `@lattice/input` keys its event buckets
   * by it and `@lattice/persist` keys its replay envelope by it: the index *is* the alignment
   * between an input log and a session, so it is a guarantee, not a convenience.
   *
   * Must not: read a clock, read live input listeners (sample them into a buffer instead),
   * touch the canvas, allocate per entity, or assume it runs once per frame. Must: copy
   * *current* to *previous* for anything the renderer interpolates, before moving it — and
   * on a teleport, set previous = current as well, or the blend draws the entity sliding
   * through everything between the two positions for one frame.
   *
   * Optional only because it is shorthand: giving it here is exactly `onUpdate(fn)` called
   * before `start()`, and it is therefore always the first subscriber.
   */
  readonly update?: (dt: number, tick: number) => void;

  /**
   * Draw the world as it stands `alpha` of the way from the last completed step to the next
   * one. Called at most once per pump and only on `'paint'` pumps — which means **it may
   * never be called at all**, for minutes at a time.
   *
   * `time` is the exact instant being drawn (`loop.time + alpha * stepSeconds`) so that
   * everything sampled from a clock — bobbing, pulsing, shimmer — is sampled at one consistent
   * moment rather than at whatever `alpha` happened to be per call site.
   *
   * `nowMs` is this pump's single reading of the injected clock, handed over so that a
   * frame-integrated presentation value can take a delta without reading a clock of its own.
   * It is monotonic and **has no epoch**: it is not the calendar, cannot be stored, and must
   * not be compared across a reload.
   *
   * Must not: mutate simulation state, accumulate anything the simulation reads, step tweens,
   * cache hit-boxes, or start timers.
   */
  readonly render?: (alpha: number, time: number, nowMs: number) => void;

  /**
   * Fixed steps per second. Default {@link DEFAULT_HZ}. An idle game is happy at 20.
   *
   * @throws RangeError unless it is an integer in `[1, 1_000_000]`. It must be an integer
   * because the accumulator is integer microseconds and `hz` is what divides it; the ceiling
   * is where `round(1e6 / hz)` would reach zero and the step loop would never terminate.
   *
   * Changing it changes `stepMs`, which is written into recorded input logs — see
   * {@link Loop.stepMs}. It is a migration, not a tuning pass.
   */
  readonly hz?: number;

  /**
   * Catch-up ceiling in milliseconds. Default {@link DEFAULT_MAX_CATCH_UP_MS}.
   *
   * @throws RangeError if it is not a finite number greater than zero. Setting it below one
   * step is legal and means the loop never steps at all — occasionally what a test wants, and
   * never what a game does.
   */
  readonly maxCatchUpMs?: number;

  /**
   * Pump cost above which `stats.overBudget` increments. Default {@link DEFAULT_BUDGET_MS}.
   *
   * @throws RangeError if negative or not finite.
   */
  readonly budgetMs?: number;

  /**
   * Called once per pump that hit the catch-up ceiling, with the seconds thrown away.
   *
   * **Diagnostics and presentation only.** It is not an offline-earnings feed: this number is
   * monotonic-clock time, which may not include the machine's sleep, and crediting it would
   * double-count against `@lattice/sim`, which has already integrated the same interval from
   * its own timestamp. Legitimate uses: a perf warning, deciding to skip an expensive
   * re-layout, a "welcome back" panel that mentions no numbers.
   */
  readonly onStall?: (droppedSeconds: number) => void;

  /**
   * Called when anything the loop **invoked** throws — a subscriber, a timer, a job. The loop
   * stops itself first, then calls this, then rethrows if this is absent.
   *
   * A clock reading that is not a finite number does not come here: the loop cannot trust its
   * own accounting at that point, so it stops and throws whether or not this is present.
   *
   * A loop that swallowed an exception and kept pumping would produce the worst bug shape
   * there is: the picture still moves, the state is frozen, and nothing in the console says
   * so.
   */
  readonly onError?: (error: unknown, phase: LoopPhase) => void;
}

/** A running (or stopped, or paused) loop. Constructed by {@link createLoop}; never a singleton. */
export interface Loop {
  /** Started and not stopped. Independent of `paused`. */
  readonly running: boolean;
  /** `speed === 0`. Sim time is not advancing; real time still is. */
  readonly paused: boolean;
  /** Sim-time multiplier. 1 is normal, 2 is fast-forward, 0 is paused. Never negative. */
  readonly speed: number;

  /**
   * Sim seconds elapsed: `tick * stepSeconds`. Pauses, scales, and **lags real time on
   * purpose**.
   *
   * A hidden tab pumps once a second and may advance at most `maxCatchUpMs` of sim per pump,
   * so sim time runs at roughly a quarter speed while hidden and `realTime - time` grows.
   * Anything that must be true against the player's wall clock — a build timer, a research
   * countdown, a daily reward — is either a `loop.real` timer or a timestamp in `sim` state.
   * Putting it on `loop.sim` gives a thirty-second build that takes two minutes if the player
   * looks away, which reads as a bug and is worse than one, because it is a bug you cannot
   * reproduce in the foreground.
   */
  readonly time: number;

  /**
   * Real seconds the loop has been running. Never pauses, never scales, never clamped.
   *
   * It counts only time between `start()` and `stop()`: a loop stopped for an hour comes back
   * owing nothing, which is the same promise `start()` makes about the wait before the first
   * pump.
   */
  readonly realTime: number;

  /**
   * Fixed steps issued since construction. The replay cursor.
   *
   * A non-negative integer that starts at 0 and increases by exactly one per `update` call,
   * for the life of the loop — **including across a `stop()` and `start()`**, because an index
   * that repeated would silently corrupt the join that `@lattice/input`'s event buckets and
   * `@lattice/persist`'s replay envelope are both keyed on.
   */
  readonly tick: number;

  /** The `dt` every `update` is handed, forever. Computed once; see {@link Loop.stepMs}. */
  readonly stepSeconds: number;

  /**
   * The same step in milliseconds — `stepUs / 1000`, computed once and stable for the life of
   * the loop.
   *
   * **This number is a compatibility constant, not a detail.** `@lattice/persist` writes it
   * into a recorded input log and refuses to migrate a log whose `stepMs` differs from the
   * running loop's, because a log keyed by tick index means nothing if a tick is a different
   * length than it was when the log was made. Changing `hz` in a shipped game is therefore a
   * **breaking change to every recorded session**, exactly as changing a save schema is, and
   * it belongs in a migration note rather than in a tuning pass.
   */
  readonly stepMs: number;

  /**
   * Timers on **sim time**: they pause when the game pauses, scale with `speed`, are clamped
   * with the simulation, and fire at a deterministic tick regardless of frame rate. Use for
   * anything that is part of the game's fiction: a spawn wave, a cooldown, a patrol.
   */
  readonly sim: Scheduler;

  /**
   * Timers on **real time**: they fire while paused, while hidden, and while the game runs at
   * 4×. Use for anything that is about the player's world rather than the game's: autosave,
   * telemetry flush, a daily-reward check, an idle prompt.
   *
   * This timeline is advanced from every pump, and in a hidden tab the only pumps are the
   * interval half of `browserFrames` — which is why that half is not optional and why a
   * hidden tab's timer granularity is `idleMs` (about a second, browser-clamped) rather than a
   * frame. A sub-second debounce is meaningless in the background. And `loop.stop()` stops the
   * pumps and therefore these timers, so a flush on `visibilitychange` is still necessary.
   */
  readonly real: Scheduler;

  /** Live figures. The **same object every read** — copy the fields you keep. */
  readonly stats: FrameStats;

  /**
   * Attach state work to the fixed step. Runs on `'tick'` pumps too — this is the callback
   * that keeps running when nobody is looking.
   *
   * Subscribers run in registration order, and `LoopOptions.update` is registered first, so an
   * overlay attached later always sees a world that has already moved this step. An overlay
   * wired *before* the game would see last step's world, one step stale, forever.
   *
   * The returned disposer removes exactly this subscription and is safe to call twice.
   */
  onUpdate(fn: (dt: number, tick: number) => void): Disposer;

  /**
   * Attach painting to the paint pump. Every subscriber gets the same `alpha`, `time` and
   * `nowMs`, computed once for the pump.
   *
   * Same prohibitions as {@link LoopOptions.render}: a render subscriber may not mutate
   * simulation state.
   */
  onRender(fn: (alpha: number, time: number, nowMs: number) => void): Disposer;

  /**
   * Create a coalescing job: work that must happen soon, at most once per pump, and off the
   * paint path. Jobs run before the step loop, so a rebuild is always visible to the updates
   * that follow it, and they run on `'tick'` pumps and while paused — a hidden tab still
   * rebuilds, because pathfinding is a rule and rules do not stop when the painting does.
   *
   * Requests made *during* a step or a render are serviced next pump, which is the one-pump
   * latency the word "soon" is buying.
   */
  coalesce(fn: () => void): Job;

  /**
   * Begin pumping. Records the clock now, so a loop constructed before a four-second asset
   * wait owes nothing for the wait. A no-op if already running.
   */
  start(): void;

  /**
   * Stop the frame source and abandon the rest of the current pump. Restartable.
   *
   * Timers survive deliberately: `sim.pending` and `real.pending` are untouched, so a loop
   * stopped for a scene transition comes back with its cooldowns intact. Nothing is called
   * after this returns.
   */
  stop(): void;

  /** `setSpeed(0)`, remembering the previous speed. A no-op if already paused. */
  pause(): void;

  /** Restore the speed from before the pause. A no-op if not paused. */
  resume(): void;

  /**
   * Set the sim-time multiplier.
   *
   * @throws RangeError on a negative, `NaN` or infinite multiplier. A negative speed would run
   * the accumulator backwards, which is not slow motion — it is a loop that never steps again.
   */
  setSpeed(multiplier: number): void;

  /** Zero the counters and the smoothing window. Totals included; `tick` and `time` are not counters. */
  resetStats(): void;
}

/** One subscription. `live` is what makes a disposer remove exactly one, even mid-pass. */
interface Subscription<F> {
  readonly fn: F;
  live: boolean;
}

/** One coalescing job's state. The `Job` handle is a view onto this. */
interface JobRecord {
  readonly fn: () => void;
  queued: boolean;
}

/** Drop the dead entries. Only ever called between passes, never during one. */
function compact<F>(subs: Subscription<F>[]): void {
  let write = 0;
  for (let read = 0; read < subs.length; read += 1) {
    const sub = subs[read];
    if (sub !== undefined && sub.live) {
      subs[write] = sub;
      write += 1;
    }
  }
  subs.length = write;
}

/**
 * Build a loop. Nothing runs until `start()`: there is no ambient loop, no singleton and no
 * autostart, because two live loops driving one canvas is a real failure mode — Vite's HMR
 * produces it routinely — and it is much easier to notice when every loop has an owner that
 * constructed it.
 *
 * @throws TypeError if `clock` or `frames` is missing or the wrong shape.
 * @throws RangeError if `hz`, `maxCatchUpMs` or `budgetMs` is out of range, naming the option
 *   and the value.
 */
export function createLoop(options: LoopOptions): Loop {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(
      `createLoop: expected an options object with at least { clock, frames }, got ${String(options)}`,
    );
  }
  const clock = options.clock;
  if (clock === null || typeof clock !== 'object' || typeof clock.now !== 'function') {
    throw new TypeError(
      'createLoop.clock: expected an object with a now() method — time is a parameter in this kit, so the loop cannot find a clock on its own',
    );
  }
  const frames = options.frames;
  if (
    frames === null ||
    typeof frames !== 'object' ||
    typeof frames.start !== 'function' ||
    typeof frames.stop !== 'function'
  ) {
    throw new TypeError(
      'createLoop.frames: expected a FrameSource with start() and stop() — use browserFrames() in a game or manualFrames() in a test',
    );
  }

  const hz = options.hz ?? DEFAULT_HZ;
  expectInt(hz, 'createLoop.hz');
  if (hz < 1 || hz > MAX_HZ) {
    throw new RangeError(
      `createLoop.hz: expected an integer in [1, ${String(MAX_HZ)}], got ${String(hz)} — the accumulator is integer microseconds, and above that ceiling a step rounds to zero and the step loop never terminates`,
    );
  }

  const maxCatchUpMs = options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS;
  expectFinite(maxCatchUpMs, 'createLoop.maxCatchUpMs');
  if (maxCatchUpMs <= 0) {
    throw new RangeError(
      `createLoop.maxCatchUpMs: expected a finite number of milliseconds > 0, got ${String(maxCatchUpMs)} — the clamp is the loop's termination condition, not an optimization`,
    );
  }

  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  expectFinite(budgetMs, 'createLoop.budgetMs');
  if (budgetMs < 0) {
    throw new RangeError(
      `createLoop.budgetMs: expected a finite number of milliseconds >= 0, got ${String(budgetMs)}`,
    );
  }

  const onStall = options.onStall;
  const onError = options.onError;

  // Computed once, and never again. This is what makes every `dt` bit-identical and `stepMs`
  // stable enough for `persist` to compare against a recorded log.
  const stepUs = Math.round(1_000_000 / hz);
  const stepSeconds = stepUs / 1_000_000;
  const stepMs = stepUs / 1000;
  const maxCatchUpUs = Math.round(maxCatchUpMs * 1000);

  const sim = createTimeline();
  const real = createTimeline();

  const updateSubs: Subscription<(dt: number, tick: number) => void>[] = [];
  const renderSubs: Subscription<(alpha: number, time: number, nowMs: number) => void>[] = [];
  let updateDirty = false;
  let renderDirty = false;

  const jobs: JobRecord[] = [];
  let queuedJobs = 0;

  const stats = {
    fps: 0,
    frameMs: 0,
    updateMs: 0,
    renderMs: 0,
    worstFrameMs: 0,
    overBudget: 0,
    stepsLastPump: 0,
    ticks: 0,
    renders: 0,
    pumps: 0,
    droppedSeconds: 0,
  };
  let frameSeeded = false;
  let renderSeeded = false;
  let fpsWindowStartMs = 0;
  let fpsWindowRenders = 0;

  let running = false;
  let speed = 1;
  let speedBeforePause = 1;
  let tick = 0;
  let accumulatorUs = 0;
  let realUs = 0;
  let lastMs = 0;
  let phase: LoopPhase = 'update';

  /** One accounting read per pump, refused if it is not a number a loop can subtract. */
  const readClock = (): number => {
    const value = clock.now();
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `loop: clock.now() returned ${String(value)}, expected a finite number of milliseconds — a non-finite reading poisons the accumulator permanently, and \`while (NaN >= step)\` is false forever, so the game would stop stepping with no exception anywhere`,
      );
    }
    return value;
  };

  /** @returns `true` if every live subscriber ran; `false` if `stop()` cut the pass short. */
  const runUpdates = (dt: number, at: number): boolean => {
    if (updateDirty) {
      compact(updateSubs);
      updateDirty = false;
    }
    const count = updateSubs.length;
    for (let i = 0; i < count; i += 1) {
      const sub = updateSubs[i];
      if (sub === undefined || !sub.live) continue;
      sub.fn(dt, at);
      if (!running) return false;
    }
    return true;
  };

  const runRenders = (alpha: number, time: number, nowMs: number): void => {
    if (renderDirty) {
      compact(renderSubs);
      renderDirty = false;
    }
    const count = renderSubs.length;
    for (let i = 0; i < count; i += 1) {
      const sub = renderSubs[i];
      if (sub === undefined || !sub.live) continue;
      sub.fn(alpha, time, nowMs);
      if (!running) return;
    }
  };

  const runJobs = (): void => {
    if (queuedJobs === 0) return;
    const count = jobs.length;
    for (let i = 0; i < count; i += 1) {
      const job = jobs[i];
      if (job === undefined || !job.queued) continue;
      job.queued = false;
      queuedJobs -= 1;
      job.fn();
      if (!running) return;
    }
  };

  const ema = (current: number, sample: number, seeded: boolean): number =>
    seeded ? current + (sample - current) * SMOOTHING : sample;

  const pump: Pump = (kind) => {
    if (!running) return;

    // Step 1. One accounting read, cached for the whole pump. A pump that read the clock again
    // for its stats would attribute the time between the two reads to nothing at all — and a
    // re-read after `update` can produce a *shorter* elapsed than the one already accumulated.
    // The three measurement reads below never feed the accumulator.
    // A clock this loop cannot subtract is a host failure, not a callback failure, so it does
    // not go to `onError` — that option is documented as covering what the loop *invoked*. The
    // loop stops itself and rethrows, because the alternative is a pump that throws forever.
    let nowMs: number;
    try {
      nowMs = readClock();
    } catch (error) {
      loop.stop();
      throw error;
    }
    let elapsedUs = Math.round((nowMs - lastMs) * 1000);
    // I-6: a backwards clock costs game time, never the loop. `Date.now()` moves backwards on
    // an NTP correction, and a loop that accumulated a negative delta would stop firing timers
    // for however long the jump was.
    if (!(elapsedUs > 0)) elapsedUs = 0;
    lastMs = nowMs;

    realUs += elapsedUs;
    stats.pumps += 1;

    let steps = 0;
    let updateStartMs = nowMs;
    let updateEndMs = nowMs;
    let rendered = false;

    try {
      // Step 2. Unclamped and unpaused: this is the timeline autosave lives on.
      phase = 'timer';
      real.advance(elapsedUs / 1_000_000);

      if (running) {
        // Step 3. Off the paint path, before the steps, at most once each.
        phase = 'job';
        runJobs();
      }

      if (running) {
        updateStartMs = readClock();

        // Steps 4 and 5.
        accumulatorUs += speed === 1 ? elapsedUs : Math.round(elapsedUs * speed);
        // Captured here so that a `pause()` called from inside `update` takes effect on the
        // *next* pump rather than retroactively changing this pump's blend factor.
        const pumpPaused = speed === 0;

        if (accumulatorUs > maxCatchUpUs) {
          const droppedUs = accumulatorUs - maxCatchUpUs;
          accumulatorUs = maxCatchUpUs;
          const droppedSeconds = droppedUs / 1_000_000;
          stats.droppedSeconds += droppedSeconds;
          if (onStall !== undefined) {
            phase = 'update';
            onStall(droppedSeconds);
          }
        }

        // Step 6.
        while (running && accumulatorUs >= stepUs) {
          const at = tick;
          phase = 'timer';
          sim.advance(stepSeconds);
          if (!running) break; // Nothing has seen this index yet, so it is not spent.

          phase = 'update';
          const completed = runUpdates(stepSeconds, at);

          // Committed whether or not the pass finished. Part of the game has already seen this
          // index, and re-issuing it after a restart would break the join that `input` and
          // `persist` are both keyed on (I-24).
          tick += 1;
          accumulatorUs -= stepUs;
          steps += 1;
          if (!completed) break;
        }
        updateEndMs = readClock();

        // Step 7. Only paint pumps render, and each pump renders at most once: while a tab is
        // visible `browserFrames` fires rAF *and* the interval, and rendering on both would
        // paint twice per interval period and skew `fps`.
        if (running && kind === 'paint') {
          phase = 'render';
          const alpha = pumpPaused ? 1 : accumulatorUs / stepUs;
          const time = tick * stepSeconds;
          runRenders(alpha, time + alpha * stepSeconds, nowMs);
          rendered = true;
        }
      }
    } catch (error) {
      // A loop that swallowed this and kept pumping would leave the picture moving and the
      // state frozen, with nothing in the console to say so.
      loop.stop();
      if (onError === undefined) throw error;
      onError(error, phase);
      return;
    }

    // Step 8.
    const endMs = readClock();
    const frameSample = endMs - nowMs;
    const updateSample = updateEndMs - updateStartMs;
    stats.frameMs = ema(stats.frameMs, frameSample, frameSeeded);
    stats.updateMs = ema(stats.updateMs, updateSample, frameSeeded);
    frameSeeded = true;
    if (rendered) {
      stats.renderMs = ema(stats.renderMs, endMs - updateEndMs, renderSeeded);
      renderSeeded = true;
      stats.renders += 1;
      fpsWindowRenders += 1;
    }
    if (frameSample > stats.worstFrameMs) stats.worstFrameMs = frameSample;
    if (frameSample > budgetMs) stats.overBudget += 1;
    stats.stepsLastPump = steps;
    stats.ticks += steps;

    const windowMs = nowMs - fpsWindowStartMs;
    if (windowMs >= FPS_WINDOW_MS) {
      stats.fps = (fpsWindowRenders * 1000) / windowMs;
      fpsWindowRenders = 0;
      fpsWindowStartMs = nowMs;
    }
  };

  const loop: Loop = {
    get running() {
      return running;
    },
    get paused() {
      return speed === 0;
    },
    get speed() {
      return speed;
    },
    get time() {
      return tick * stepSeconds;
    },
    get realTime() {
      return realUs / 1_000_000;
    },
    get tick() {
      return tick;
    },
    stepSeconds,
    stepMs,
    sim,
    real,
    stats,

    onUpdate(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError(`loop.onUpdate: expected a function, got ${typeof fn}`);
      }
      const sub: Subscription<(dt: number, at: number) => void> = { fn, live: true };
      updateSubs.push(sub);
      return () => {
        if (!sub.live) return;
        sub.live = false;
        updateDirty = true;
      };
    },

    onRender(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError(`loop.onRender: expected a function, got ${typeof fn}`);
      }
      const sub: Subscription<(alpha: number, time: number, nowMs: number) => void> = { fn, live: true };
      renderSubs.push(sub);
      return () => {
        if (!sub.live) return;
        sub.live = false;
        renderDirty = true;
      };
    },

    coalesce(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError(`loop.coalesce: expected a function, got ${typeof fn}`);
      }
      const record: JobRecord = { fn, queued: false };
      jobs.push(record);
      return {
        request() {
          if (record.queued) return;
          record.queued = true;
          queuedJobs += 1;
        },
        cancel() {
          if (!record.queued) return;
          record.queued = false;
          queuedJobs -= 1;
        },
        get queued() {
          return record.queued;
        },
      };
    },

    start() {
      if (running) return;
      // Read before committing to `running`, so a host whose clock is broken leaves a stopped
      // loop rather than a running one that has never pumped. Recorded *now*, so the four
      // seconds spent loading assets between `createLoop` and here are not owed: without this
      // the first `elapsed` is everything since this clock's arbitrary origin, which the clamp
      // dutifully turns into fourteen wasted steps and one enormous `onStall`.
      const now = readClock();
      running = true;
      lastMs = now;
      if (fpsWindowStartMs === 0) fpsWindowStartMs = lastMs;
      frames.start(pump);
    },

    stop() {
      if (!running) return;
      running = false;
      frames.stop();
    },

    pause() {
      if (speed === 0) return;
      loop.setSpeed(0);
    },

    resume() {
      if (speed !== 0) return;
      loop.setSpeed(speedBeforePause);
    },

    setSpeed(multiplier) {
      expectFinite(multiplier, 'loop.setSpeed');
      if (multiplier < 0) {
        throw new RangeError(
          `loop.setSpeed: expected a finite number >= 0, got ${String(multiplier)} — a negative speed is not slow motion, it is a loop that never steps again`,
        );
      }
      if (multiplier === 0 && speed !== 0) speedBeforePause = speed;
      speed = multiplier;
    },

    resetStats() {
      stats.fps = 0;
      stats.frameMs = 0;
      stats.updateMs = 0;
      stats.renderMs = 0;
      stats.worstFrameMs = 0;
      stats.overBudget = 0;
      stats.stepsLastPump = 0;
      stats.ticks = 0;
      stats.renders = 0;
      stats.pumps = 0;
      stats.droppedSeconds = 0;
      frameSeeded = false;
      renderSeeded = false;
      fpsWindowRenders = 0;
      fpsWindowStartMs = lastMs;
    },
  };

  // Defined as subscriptions registered before `start()`, which is why they are optional and
  // why they are always first in order. An overlay wired later always sees a world that has
  // already taken this step.
  if (options.update !== undefined) loop.onUpdate(options.update);
  if (options.render !== undefined) loop.onRender(options.render);

  return loop;
}
