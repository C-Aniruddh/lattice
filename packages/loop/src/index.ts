/**
 * `@lattice/loop` — the only part of the kit that knows what time it is.
 *
 * It advances a game's rules at a fixed rate off an **injected** wall clock whether or not
 * anything is being painted, and hands the renderer a blend factor so the pictures can run at
 * whatever rate the display manages.
 *
 * ```ts
 * import { createLoop, browserFrames } from '@lattice/loop';
 *
 * const loop = createLoop({
 *   clock: { now: () => performance.now() },        // the one global clock read in the whole app
 *   frames: browserFrames(),                        // rAF paints; an interval ticks when hidden
 *   update: (dt) => world.step(dt),                 // exactly 1/60 s, 0–15 times per pump
 *   render: (alpha) => world.draw(surface, alpha),  // never mutates; blends previous → current
 * });
 * loop.start();
 * ```
 *
 * Read those five option lines as the five promises this package makes.
 *
 * | line | promise |
 * |---|---|
 * | `clock` | time is a parameter. The kit never reads a global clock, so `lint` can ban `Date.now()` in every `src/` and mean it. |
 * | `frames` | *when to run* is a parameter too, and the browser adapter is deliberately not one source but two. |
 * | `update` | `dt` is the same number every call, forever. Nothing else here matters as much. |
 * | `render` | `alpha ∈ [0, 1]` blends the last step into the next. Render is told more about time than update is, and allowed to do less with it. |
 * | `start()` | nothing runs on import. No ambient loop, no singleton, no autostart. |
 *
 * ## Saying "this must keep running when nobody is looking"
 *
 * It is expressed by **choosing what you attach the work to** — not by a flag, and not by
 * hoping.
 *
 * | attach it to | runs hidden? | truthful about wall time? | use it for |
 * |---|---|---|---|
 * | `render(alpha, time)` | **no** — rAF is 0 Hz | no | pixels, and nothing else |
 * | `update(dt, tick)` | yes, on `'tick'` pumps | no — clamped, ~¼ speed hidden | rules, HUD data, anything that must not freeze |
 * | `loop.real.every(s, fn)` | yes | **yes** — unclamped, unpaused | autosave, telemetry, "has the day rolled over?" |
 * | a timestamp in state, integrated on read | yes, on the first read after resume | **yes**, exactly | the economy, and any long duration |
 *
 * Never accumulate `dt` into anything that has to be right. A day/night phase is
 * `phaseAt(epochNow())` — a pure function of the calendar, sampled in `update` and drawn in
 * `render`. Accumulating it makes the night shorter for the player who looked away, which is
 * the offline-earnings bug wearing a nicer hat.
 *
 * Every symbol a consumer may use is re-exported here and nowhere else.
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';

// ── time as a parameter ─────────────────────────────────────────────────────────
//
// Options in milliseconds, callbacks in seconds, and the boundary is exactly here. A host
// clock is milliseconds on every platform; a game's own constants read as "0.4 s of hop" and
// get typo'd by a factor of a thousand when written the other way.
//
// Every duration this package publishes is a plain `number` whose name ends in its unit. No
// `Millis` or `Seconds` alias is exported, because an alias over `number` refuses nothing and
// a type name is read as a promise — see `clock.ts` and `docs/rfc/durations.md`.

export { manualClock } from './clock.js';
export type { Clock, ManualClock } from './clock.js';

// ── the cadence, injected ───────────────────────────────────────────────────────
//
// `browserFrames` is the only symbol in this package that touches a global, and it is the
// two-source pump: rAF for paints, a plain interval for everything else. A loop built on rAF
// alone stops advancing the game the moment the player looks at another tab — and the canvas
// keeps showing its last painted frame, so it *looks* alive. It would also stop the kit
// saving, since `persist` schedules its autosave through `loop.real` and every timer here
// advances only when a pump arrives.

export { browserFrames, manualFrames, DEFAULT_IDLE_PUMP_MS } from './frames.js';
export type { BrowserFramesOptions, FrameHost, FrameSource, ManualFrames, Pump, PumpKind } from './frames.js';

// ── the loop ────────────────────────────────────────────────────────────────────

export {
  createLoop,
  DEFAULT_ABSENCE_MS,
  DEFAULT_BUDGET_MS,
  DEFAULT_HZ,
  DEFAULT_MAX_CATCH_UP_MS,
  DEFAULT_WARMUP_FRAMES,
  DEFAULT_WINDOW_MS,
} from './loop.js';
export type { Job, Loop, LoopOptions, LoopPhase } from './loop.js';

/**
 * One teardown vocabulary for the whole kit, owned by layer 0.
 *
 * Re-exported rather than redeclared: a second identical alias here would be a second thing to
 * keep in step, and `Scope.add` from `core` must accept what `onUpdate` returns without a cast.
 */
export type { Disposer } from '@lattice/core';

// ── timers, on two timelines ────────────────────────────────────────────────────
//
// `loop.sim` pauses, scales and is clamped with the simulation. `loop.real` fires while paused,
// while hidden and while the game runs at 4×. Choosing wrongly gives a thirty-second build
// timer that takes two minutes if the player looks away — a bug you cannot reproduce in the
// foreground.

export { createTimeline } from './scheduler.js';
export type { Scheduler, Timeline, TimerId } from './scheduler.js';

// ── tweens ──────────────────────────────────────────────────────────────────────
//
// The curve vocabulary is `core`'s, whole. This package defines no easing and owns no name, and
// an unknown name throws rather than quietly running linear — a level file with a typo would
// otherwise ship feeling wrong and passing.

export { createTweens } from './tween.js';
export type { TweenId, TweenOptions, Tweens } from './tween.js';

// ── measurement ─────────────────────────────────────────────────────────────────
//
// Two instruments, because one of them is blind. `frameMs` and `worstFrameMs` are the **pump's
// own work** — the wall time between the loop's two clock readings — and a collection or a style
// recalculation that lands *between* two pumps is in neither of them. `worstGapMs` is the wall
// time from one painted frame to the next, so everything the machine did in between is inside it
// by construction; `cadenceMs` is the display's period as this loop observed it, and a gap is
// only legible next to it.

export type { FrameStats } from './stats.js';

// ── replay ──────────────────────────────────────────────────────────────────────
//
// `input` records, `persist` stores and verifies, and this presses play. Defined against a
// structural `ReplaySource` so that layer 1 never imports upward.

export { replay } from './replay.js';
export type { ReplayOptions, ReplayResult, ReplaySource } from './replay.js';
