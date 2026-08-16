# RFC: `@lattice/loop`

**Status:** proposed · **Task:** A4 · **Owner:** lattice-architect · **Layer:** 1 (`core` only)

---

## 1. The one sentence

**`@lattice/loop` is the only part of the kit that knows what time it is: it advances a
game's rules at a fixed rate off an injected wall clock whether or not anything is being
painted, and hands the renderer a blend factor so the pictures can run at whatever rate the
display manages.**

Two consequences fall straight out of that sentence and the rest of this document is mostly
their bookkeeping:

- Because the clock is a parameter, a test runs a simulated hour in a millisecond with no
  timers, no `vi.useFakeTimers()`, and no flake.
- Because the loop advances on the clock and not on frames, a backgrounded tab keeps its
  books straight instead of quietly deleting every minute the player spent elsewhere.

---

## 2. The five-line example

This is 90% of what anyone does with this package, and every decision below was made to
keep it this short.

```ts
import { createLoop, browserFrames } from '@lattice/loop';

const loop = createLoop({
  clock: { now: () => performance.now() },        // the one global clock read in the whole app
  frames: browserFrames(),                        // rAF paints; an interval ticks when hidden
  update: (dt) => world.step(dt),                 // exactly 1/60 s, 0–15 times per pump
  render: (alpha) => world.draw(surface, alpha),  // never mutates; blends previous → current
});
loop.start();
```

Read the five option lines as the five promises this package makes.

| line | promise |
|---|---|
| `clock` | time is a parameter. The kit never reads a global clock, so `lint` can ban `Date.now()` in every `src/` and mean it. |
| `frames` | *when to run* is a parameter too, and the browser adapter is deliberately not one source but two — see §6.1. |
| `update` | `dt` is the same number every call, forever. Nothing else in this package matters as much. |
| `render` | `alpha ∈ [0, 1]`, and it is the *only* thing render is told about time that update is not. |
| `loop.start()` | nothing runs on import. There is no ambient loop, no singleton, no autostart. |

A test of the same game, with no timers anywhere:

```ts
const clock = manualClock();
const frames = manualFrames();
const loop = createLoop({ clock, frames, update, render });
loop.start();
clock.advance(1000); frames.pump('paint');   // one second of game, instantly
```

---

## 3. The full public surface

Five modules — `clock`, `loop`, `scheduler`, `tween`, `stats` — plus one the brief did not
list. **I am proposing a sixth module, `frames`,** and arguing for it in §3.2.

### 3.1 `clock` — time as a parameter

```ts
/** Milliseconds. Every duration in this package's *options* is in these. */
export type Millis = number;

/**
 * Seconds. Every duration in this package's *callbacks* is in these, because a game's own
 * constants ("0.4 s of hop", "12 s to build") read wrong in milliseconds and get typo'd by
 * a factor of a thousand. The boundary between the two units is exactly here: options in,
 * seconds out.
 */
export type Seconds = number;

/**
 * The host's clock, injected.
 *
 * Must be **monotonic**: two calls in a row must never go backwards. `performance.now()`
 * qualifies; `Date.now()` does not — an NTP correction or a user changing the system clock
 * moves it backwards, and a loop that accumulates a negative delta stops firing timers for
 * however long the jump was. If you inject `Date.now()` anyway, the loop clamps negative
 * deltas to zero (invariant I-6) and you lose that much game time rather than the loop.
 *
 * This clock is **not** the calendar and must never be used as one. It may or may not
 * advance while the machine is asleep — that is platform-dependent — which is precisely why
 * `@lattice/sim` keeps its own epoch timestamp and why this package credits nothing. See §4.1.
 */
export interface Clock {
  now(): Millis;
}

/**
 * A clock a test owns outright.
 *
 * Exists so that no test in this kit ever imports a fake-timer library. A test that wants
 * an hour of game says `clock.advance(3_600_000)` and gets it in a microsecond.
 */
export interface ManualClock extends Clock {
  /** Move forward. Negative values throw — they are always a bug, never a rewind you meant. */
  advance(ms: Millis): void;
  /** Jump to an absolute reading. For reproducing a captured trace, not for rewinding. */
  set(ms: Millis): void;
}

export function manualClock(startMs?: Millis): ManualClock;
```

### 3.2 `frames` — when to run, injected (**new module; argued for**)

The brief's module list has `clock` but no frame source, which implies the loop reaches for
`requestAnimationFrame` itself. It must not: that is a global, it is DOM, and it is the one
call in the whole design that is wrong 100% of the time in a hidden tab. So the *cadence* is
injected exactly as the clock is.

`browserFrames()` is the only symbol in this package that touches a global, it lives alone in
`src/frames.ts` (constitution rule 4: pure and impure never share a file), it touches nothing
until called, and it is tree-shaken out of a Node build. It reads `requestAnimationFrame` and
`setInterval` — neither of which is banned by rule 1, because **neither tells you what time
it is**. That is the seam: *the kit ships the cadence, the game ships the clock.*

```ts
/**
 * Why a pump happened.
 *
 * - `'paint'` — the host is about to display a frame. `render` may run.
 * - `'tick'`  — the host is not painting (hidden tab, occluded window, minimised), but time
 *               has still passed. `update` runs; `render` does not.
 *
 * A boolean was rejected: `pump(true)` at a call site says nothing, and this distinction is
 * the single most important one in the package.
 */
export type PumpKind = 'paint' | 'tick';

/** A callback the loop hands to its frame source. Calling it runs one pump, synchronously. */
export type Pump = (kind: PumpKind) => void;

/**
 * Where pumps come from. The loop never schedules anything itself.
 *
 * `start` must be safe to call after `stop` (a loop can be restarted), and `stop` must
 * cancel everything it registered — a source that leaks a callback keeps a whole dead game
 * alive, canvas and all.
 */
export interface FrameSource {
  start(pump: Pump): void;
  stop(): void;
}

/** Just enough of `window` to drive a loop. Structural, so `window` satisfies it. */
export interface FrameHost {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setInterval(cb: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export interface BrowserFramesOptions {
  /**
   * Period of the non-painting pump. Default {@link DEFAULT_IDLE_PUMP_MS}.
   *
   * Do not lower it hoping for a faster hidden tab: browsers clamp background intervals to
   * roughly one second, and Chrome throttles harder still after five minutes. This number
   * is a floor on how stale a hidden game is allowed to get, not a frame rate.
   */
  readonly idleMs?: Millis;
  /** Injected for tests. Defaults to `globalThis`. */
  readonly host?: FrameHost;
}

/**
 * **Browser only.** The two-source pump: `requestAnimationFrame` for paints, a plain
 * interval for everything else.
 *
 * This is the trap that this whole package exists to make un-steppable-in. rAF is 0 Hz in a
 * background tab, so a loop built on rAF alone stops advancing the game the moment the
 * player looks at another tab — and because the canvas keeps showing its last painted
 * frame, it *looks* alive. Both pumps run when visible; the extra `'tick'` pumps cost one
 * clock read and an empty accumulator check.
 */
export function browserFrames(options?: BrowserFramesOptions): FrameSource;

/** A frame source a test drives by hand. `pump()` defaults to `'paint'`. */
export interface ManualFrames extends FrameSource {
  pump(kind?: PumpKind): void;
  readonly started: boolean;
}

export function manualFrames(): ManualFrames;
```

### 3.3 `loop` — the fixed step and the blend factor

```ts
/** Fixed steps per second when `hz` is not given. 60 is what the interpolation hides best. */
export const DEFAULT_HZ = 60;

/**
 * How much real time one pump may spend catching up, in ms. Default 250 — fifteen steps at
 * 60 Hz, and the same quarter-second the source game clamped its animation delta to.
 * Everything past it is dropped, never deferred. §4.1 says who credits it instead.
 */
export const DEFAULT_MAX_CATCH_UP_MS = 250;

/** Background pump period. See {@link BrowserFramesOptions.idleMs}. */
export const DEFAULT_IDLE_PUMP_MS = 1000;

/** A pump costing more than this counts against `stats.overBudget`. Matches `kit.json`. */
export const DEFAULT_BUDGET_MS = 8;

export interface LoopOptions {
  readonly clock: Clock;
  readonly frames: FrameSource;

  /**
   * Advance the game by exactly `dt` seconds. Called 0..n times per pump, n bounded by
   * `maxCatchUpMs`; called on `'tick'` pumps as well, so this is where **everything that is
   * not painting** belongs — economy, HUD data, autosave decisions, quest settlement.
   *
   * `tick` counts fixed steps since `start()` and never skips: it is the cursor a replay
   * indexes an input log by.
   *
   * Must not: read a clock, read live input listeners (sample them into a buffer instead),
   * touch the canvas, allocate per entity, or assume it runs once per frame. Must: copy
   * *current* to *previous* for anything the renderer interpolates, before moving it.
   */
  readonly update: (dt: Seconds, tick: number) => void;

  /**
   * Draw the world as it stands `alpha` of the way from the last completed step to the next
   * one. Called at most once per pump and only on `'paint'` pumps — which means **it may
   * never be called at all**, for minutes at a time.
   *
   * `time` is the exact instant being drawn (`loop.time + alpha * stepSeconds`) so that
   * everything sampled from a clock — bobbing, pulsing, shimmer — is sampled at one
   * consistent moment rather than at whatever `alpha` happened to be per call site.
   *
   * Must not: mutate simulation state, accumulate its own delta, step tweens, cache
   * hit-boxes, or start timers.
   */
  readonly render: (alpha: number, time: Seconds) => void;

  /** Fixed steps per second. Default {@link DEFAULT_HZ}. An idle game is happy at 20. */
  readonly hz?: number;

  /** Catch-up ceiling. Default {@link DEFAULT_MAX_CATCH_UP_MS}. */
  readonly maxCatchUpMs?: Millis;

  /** Pump cost above which `stats.overBudget` increments. Default {@link DEFAULT_BUDGET_MS}. */
  readonly budgetMs?: Millis;

  /**
   * Called once per pump that hit the catch-up ceiling, with the seconds thrown away.
   *
   * **Diagnostics and presentation only.** It is not an offline-earnings feed: this number
   * is monotonic-clock time, which may not include the machine's sleep, and crediting it
   * would double-count against `@lattice/sim`, which has already integrated the same
   * interval from its own timestamp. Legitimate uses: a "welcome back" panel, a perf
   * warning, deciding to skip an expensive re-layout. See §4.1.
   */
  readonly onStall?: (droppedSeconds: Seconds) => void;

  /**
   * Called when `update` or `render` throws. The loop stops itself first, then calls this,
   * then rethrows if this is absent.
   *
   * A loop that swallows an exception and keeps pumping produces the worst bug shape there
   * is: the picture still moves, the state is frozen, and nothing in the console says so.
   */
  readonly onError?: (error: unknown, phase: 'update' | 'render') => void;
}

export interface Loop {
  /** Started and not stopped. Independent of `paused`. */
  readonly running: boolean;
  /** `speed === 0`. Sim time is not advancing; real time still is. */
  readonly paused: boolean;
  /** Sim-time multiplier. 1 is normal, 2 is fast-forward, 0 is paused. Never negative. */
  readonly speed: number;
  /** Sim seconds elapsed: `tick * stepSeconds`. Pauses, scales, and **lags real time**. */
  readonly time: Seconds;
  /** Real seconds since `start()`. Never pauses, never scales, never clamped. */
  readonly realTime: Seconds;
  /** Fixed steps run since `start()`. The replay cursor. */
  readonly tick: number;
  /** `1 / hz`, precomputed, exact. What `update` is always handed. */
  readonly stepSeconds: Seconds;

  /**
   * Timers on **sim time**: they pause when the game pauses, scale with `speed`, are clamped
   * with the simulation, and replay identically from a seed. Use for anything that is part
   * of the game's fiction: a spawn wave, a cooldown, a patrol.
   */
  readonly sim: Scheduler;

  /**
   * Timers on **real time**: they fire while paused, while hidden, and while the game runs
   * at 4×. Use for anything that is about the player's world rather than the game's:
   * autosave, telemetry flush, a daily-reward check, an idle prompt.
   */
  readonly real: Scheduler;

  /** Live figures. The **same object every read** — snapshot it if you keep it. See §3.6. */
  readonly stats: FrameStats;

  /** Begin pumping. Records the clock now, so a loop built before a 4 s asset wait owes nothing. */
  start(): void;
  /** Stop the frame source and abandon the rest of the current pump. Restartable. */
  stop(): void;
  /** `setSpeed(0)`, remembering the previous speed. */
  pause(): void;
  /** Restore the speed from before `pause()`. A no-op if not paused. */
  resume(): void;
  /** Throws `RangeError` on a negative, NaN or infinite multiplier. */
  setSpeed(multiplier: number): void;
  /** Zero the counters and the smoothing window. Totals included. */
  resetStats(): void;
}

export function createLoop(options: LoopOptions): Loop;
```

**One pump, in order.** This ordering is the package's contract; every invariant in §5
refers to it.

```
1  elapsed = clamp(clock.now() - last, 0, ∞); last = clock.now()
2  realTime += elapsed;            real.advance(elapsed)      ← unclamped, unpaused
3  accumulator += elapsed * speed
4  if accumulator > maxCatchUp: dropped += excess; accumulator = maxCatchUp; onStall(excess)
5  while accumulator >= step:
       sim.advance(step)                                      ← timers fire before the step
       update(step, tick++); accumulator -= step
6  if kind === 'paint': render(paused ? 1 : accumulator / step, time + alpha * step)
7  stats
```

Control calls take effect at the **next** pump boundary — `pause()` from inside `update`
does not truncate the pump it was called from — except `stop()`, which takes effect
immediately, because a game stopping itself on a fatal error must not be updated again.

### 3.4 `scheduler` — one timer model, two timelines

```ts
/** Opaque, never reused within a session, and cheap: a number, not an object. */
export type TimerId = number;

export interface Scheduler {
  /** Current time on this timeline, in seconds since it was created. */
  readonly time: Seconds;
  /** Live timers. `0` is a fine assertion for "nothing is left running". */
  readonly pending: number;

  /** Fire once, at or after `delay`. `RangeError` if `delay` is negative or not finite. */
  after(delay: Seconds, fn: () => void): TimerId;

  /**
   * Fire every `period`. `RangeError` if `period <= 0` — a zero period is an infinite loop,
   * not a fast timer.
   *
   * **`repeats` is how many periods this one call stands for.** A callback never runs more
   * than once per pump on either timeline (invariant I-9): an hour spent hidden gives one
   * call with `repeats === 3600`, not 3600 calls in one frame. Write the body so that it is
   * correct for any `repeats` — `credit(perTick * repeats)`, not `credit(perTick)`.
   */
  every(period: Seconds, fn: (repeats: number) => void): TimerId;

  /** `true` if a live timer was removed. Cancelling twice is not an error. */
  cancel(id: TimerId): boolean;
  cancelAll(): void;
}

/** A scheduler somebody advances. The loop keeps its two to itself and exposes `Scheduler`. */
export interface Timeline extends Scheduler {
  advance(dt: Seconds): void;
}

/**
 * A third timeline, for a game that needs one the loop does not own — a cutscene clock, a
 * per-level timer that resets, a replay scrubber.
 */
export function createTimeline(): Timeline;
```

### 3.5 `tween` — interpolation over a clock

```ts
/**
 * One easing vocabulary for the whole kit, owned by layer 0. This package resolves a name
 * through `core`'s `EASINGS` table and defines no curve of its own — see the note below.
 */
import type { Easing, EasingName } from '@lattice/core';

export type TweenId = number;

export interface TweenOptions {
  readonly from: number;
  readonly to: number;
  /** Duration. `RangeError` if not finite and > 0; a zero-length tween is an assignment. */
  readonly seconds: Seconds;

  /**
   * Called with the eased value every `step`, and exactly once more with **exactly `to`**
   * before `onDone`. Never with a value from beyond the range.
   */
  readonly onUpdate: (value: number) => void;

  /**
   * A curve, or the **name** of one in `core`'s `EASINGS`. Default is linear.
   *
   * A name is accepted because easing names get written into level data and save files, and
   * data that names a curve must resolve it through the one table the whole kit shares —
   * `'easeOutCubic'` must mean the same thing in `ui`, in `draw` and here, forever. This
   * package therefore defines **no easing curves of its own** and never will; an unknown
   * name throws a `RangeError` listing the valid ones rather than silently going linear.
   */
  readonly ease?: Easing | EasingName;

  /** Wait this long before the first `onUpdate`. This is the whole sequencing story. */
  readonly delay?: Seconds;

  /**
   * A **slot**, not a tag. Starting a tween with a slot cancels any live tween in the same
   * slot, silently and without its `onDone`.
   *
   * Two tweens writing one property is the commonest animation bug there is: each one
   * writes its own idea of the value on alternate steps and the thing shudders between two
   * paths. `slot: 'panel.y'` makes re-targeting mid-flight the default behaviour instead of
   * a thing you remember to do.
   */
  readonly slot?: string;

  /** Fires once, after the final `onUpdate`. **Never fires for a cancelled tween.** */
  readonly onDone?: () => void;
}

export interface Tweens {
  readonly active: number;
  start(options: TweenOptions): TweenId;
  cancel(id: TweenId): boolean;
  cancelAll(): void;
  /**
   * Advance every live tween. You call this, from wherever in your `update` the ordering
   * should be — a camera tween stepped after the world lags it by a frame, and a tween
   * stepped in `render` is a mutation in the one callback that must not mutate.
   */
  step(dt: Seconds): void;
}

export function createTweens(): Tweens;
```

Tweens interpolate **numbers**. A position is two of them, or one driving a `lerp` inside
`onUpdate`. See §4.4 for why there is no `tween(object, 'a.b.c', …)`.

**Which curves can exist, and what a tweened value may touch.** `core`'s RFC establishes a
two-tier rule that this package inherits whole: ECMA-262 pins `+ - * /`, `Math.sqrt`,
`Math.imul` and the bitwise operators to an exact result, and explicitly does *not* require
correctly-rounded `sin`, `cos`, `pow`, `exp` or `log`. So the kit's easings are polynomial and
`sqrt`-based only — **there is no `easeInOutSine` and no expo curve anywhere in Lattice**, and
a builder who adds one to make a panel feel nicer has made two engines disagree about a save.
Nothing in this RFC assumes one.

The consequence for tweens, stated as a rule a reviewer can apply:

| tier | what it is | may drive | may **not** drive |
|---|---|---|---|
| A | the whole `EASINGS` table, and every number this package computes about time | anything, including simulation state and hashes | — |
| B | `core`'s `damp` and anything else marked presentation-only | pixels, colours, camera, audio gain | a save file, a hash, a replay, a checksum, an economy input |

A tween whose curve comes from `EASINGS` is Tier A and is therefore safe to run inside
`update` and to have write simulation state — which is exactly why tweens are stepped on the
fixed step (§3.5) rather than on a frame delta. `damp` is the opposite: it is
frame-rate-independent smoothing and it is Tier B, so the camera-follow story — `damp` in
`update`, drawn in `render` — produces a value that may only ever reach a pixel. Persisting a
damped camera position, or feeding one into anything `persist` writes, is the failure this
table exists to prevent.

### 3.6 `stats` — the frame budget, measured

```ts
/**
 * Live frame figures.
 *
 * `loop.stats` returns the **same object on every read**; the loop mutates it in place. That
 * is what keeps reading it every frame free (constitution rule 7). If you need to keep a
 * reading — for a graph, for a report — copy the fields you want. Storing the object stores
 * a live view that changes under you.
 *
 * Every millisecond here is measured with the injected clock, so a coarse clock gives coarse
 * stats; that is a property of your clock, not a bug in this.
 */
export interface FrameStats {
  /** Smoothed paints per second over the last second of real time. */
  readonly fps: number;
  /** Smoothed cost of a whole pump: update + render + this bookkeeping. */
  readonly frameMs: number;
  /** Smoothed cost of all `update` calls in a pump — the number that grows with entity count. */
  readonly updateMs: number;
  /** Smoothed cost of `render`. */
  readonly renderMs: number;
  /** Worst `frameMs` since the last `resetStats()`. Averages hide exactly the frame players feel. */
  readonly worstFrameMs: number;
  /** Pumps that cost more than `budgetMs`. The number `npm run bench` should assert on. */
  readonly overBudget: number;
  /** Fixed steps run in the most recent pump. `>1` sustained means the game cannot keep up. */
  readonly stepsLastPump: number;
  readonly ticks: number;
  readonly renders: number;
  readonly pumps: number;
  /** Total sim seconds discarded by the catch-up clamp. Diagnostics only — §4.1. */
  readonly droppedSeconds: number;
}
```

### 3.7 Saying "this must keep running when nobody is looking"

The demo's night falls whether or not the tab is in front, and every idle game has something
like it. "Keep accruing while hidden" is a first-class concept here, and it is expressed by
**choosing which of three things you attach the work to** — not by a flag, and not by hoping.

| what you attach it to | runs hidden? | truthful about wall time? | use it for |
|---|---|---|---|
| `render(alpha, time)` | **no** — rAF is 0 Hz | no | pixels, and nothing else |
| `update(dt, tick)` | yes, on `'tick'` pumps | no — clamped, ~¼ speed hidden | rules, HUD data, anything that must not freeze |
| `loop.real.every(s, fn)` | yes | **yes** — unclamped, unpaused | autosave, telemetry, "has the day rolled over?" |
| a timestamp in state, integrated on read | yes, on the first read after resume | **yes**, exactly | the economy, and any long duration |

The pattern the demo wants, in full:

```ts
const epochNow = () => Date.now();               // the game's one calendar reading

const loop = createLoop({
  clock: { now: () => performance.now() },
  frames: browserFrames(),                       // the 'tick' pump is what makes this work at all
  update: () => {
    integrate(economy, epochNow());              // sim: exact, however long we were away
    hud.setData(economy);                        // fresh the instant the tab comes back
  },
  render: (alpha, time) => world.draw(surface, alpha, time),
});

loop.real.every(30, () => save(economy, epochNow()));   // fires while hidden and while paused
```

Note what is *not* there: no accumulation of `dt` into anything that has to be right, and no
`night += dt`. A day/night phase is `phaseAt(epochNow())` — a pure function of the calendar,
sampled in `update` and drawn in `render`. Accumulating it would make the night shorter for
the player who looked away, which is the same bug as the economy one wearing a nicer hat.

### 3.8 The whole export list

`Millis`, `Seconds`, `Clock`, `ManualClock`, `manualClock`, `PumpKind`, `Pump`, `FrameSource`,
`FrameHost`, `BrowserFramesOptions`, `browserFrames`, `ManualFrames`, `manualFrames`,
`LoopOptions`, `Loop`, `createLoop`, `TimerId`, `Scheduler`, `Timeline`, `createTimeline`,
`TweenId`, `TweenOptions`, `Tweens`, `createTweens`, `FrameStats`, `DEFAULT_HZ`,
`DEFAULT_MAX_CATCH_UP_MS`, `DEFAULT_IDLE_PUMP_MS`, `DEFAULT_BUDGET_MS`, `VERSION`.

Six functions. Everything else is a type or a constant.

---

## 4. What is deliberately absent

### 4.1 Offline accrual — and the line between `loop` and `sim`

**`@lattice/loop` credits nothing. Ever.** It has no `offlineSeconds`, no "welcome back"
event, no `awayMs` on any callback, and it will not grow one.

The clamp in step 4 of the pump does not defer the excess to a later frame — that only moves
the spiral one frame along — and it does not hand it to anybody either. It is **dropped**,
counted in `stats.droppedSeconds`, and reported to `onStall` for diagnostics. An hour spent
in a background tab arrives at the loop as one enormous `elapsed`, becomes 250 ms of ticks,
and the other 3,599.75 seconds cease to exist as far as this package is concerned.

They are not lost, because they were never this package's to lose:

| | `@lattice/loop` | `@lattice/sim` |
|---|---|---|
| owns | time the player is **watching** | time the player was **not** |
| clock | monotonic, injected, may freeze in sleep | epoch timestamp stored **in the save** |
| shape | a fixed step, run n times | closed form, integrated once on read |
| an hour away | clamped to 250 ms and dropped | one `integrate(state, epochNow)`, exact |
| may credit resources | **no** | yes, and only it |
| stamps a save | **no** — its clock has no epoch (§4.1a) | reads the stamp `persist` wrote |

The rule, stated so a reviewer can hold both packages to it: **the loop advances callbacks;
`sim` advances value.** `sim`'s own invariant — "the economy has no tick; state is
`(stocks, rates, lastTimestamp)` integrated on read" — means the economy never needed the
loop to tell it anything. The game's `update` calls `integrate(state, epochNow)` with an
epoch it reads itself, and gets the same answer whether that update is the 60th this second
or the first in an hour. Two packages cannot double-credit an interval when only one of them
credits anything at all.

Three corollaries worth writing on the wall:

1. **Never derive economy from `dt`.** `update(dt)` runs a clamped number of times; summing
   `rate * dt` deletes exactly the time the player was away. This shipped in the source game
   and the fix is in its playbook as non-negotiable #6.
2. **`loop.time` is not real time and drifts below it on purpose.** A hidden tab pumps once
   a second and may advance at most 250 ms of sim per pump, so sim time runs at roughly a
   quarter speed while hidden and `realTime - time` grows. Anything that must be true against
   the player's wall clock — a build timer, a research countdown, a daily reward — is either
   a `loop.real` timer or a timestamp in `sim` state. Putting it on `loop.sim` gives a
   thirty-second build that takes two minutes if the player looks away, which reads as a bug
   and is worse than one, because it is a bug you cannot reproduce in the foreground.
3. **Do not "fix" the drift by raising `maxCatchUpMs`.** The ceiling is what stops a restored
   tab spending four seconds inside one frame while the browser paints nothing. A game that
   wants faithful sim time in the background wants timestamps, not more catch-up.

#### 4.1a Who stamps "now" on a save — `loop` says: not me

Raised by the demo designer (A10, gap 7): three packages could each reasonably own the
saved-at timestamp. **`@lattice/loop`'s answer is unambiguous and it is a refusal.**

`loop` receives an injected clock and has no opinion about the calendar. It cannot stamp a
save even if asked: its `Clock` is monotonic and **has no epoch** — `performance.now()`
counts from an arbitrary origin per document, so `clock.now()` is meaningless the moment it
crosses a reload boundary, which is the only boundary a save exists to cross. A `loop` that
handed out "now" would be handing out a number that is wrong by exactly the amount that
matters. There is deliberately no `loop.epoch`, no second method on `Clock`, and no
`stampedAt` on anything this package emits.

So, stated for checking against the other two RFCs:

- **The calendar is one function, `() => Millis` since the Unix epoch, owned by the game**, and
  injected — into `persist` (which writes it into the save) and passed to `sim` (which
  integrates from it). It is the game's *second* clock seam, sibling to `LoopOptions.clock`,
  and for the same reason: rule 1 bans `Date.now()` inside every package's `src/`, so somebody
  outside has to read it exactly once and hand it around.
- **`persist` stamps.** It is writing the record; a record that does not know when it was
  written is not a record. `sim` reads that stamp back and integrates to the current epoch.
- **`loop` contributes the cadence and nothing else.** `loop.real.every(30, save)` decides
  *when* a save happens — it is the only thing in the kit that can, since it is the only thing
  with an unclamped, unpaused view of real time — and the number written into that save comes
  from the game's epoch function, never from `loop`.

If `persist` and `sim` both declare their own `now`-shaped parameter, that is fine and they
will agree, because the game passes the same function to both. What must not happen is a
fourth reading taken somewhere else: two epoch reads milliseconds apart are two different
answers to "when was this", and the drift lands in the player's offline earnings. One
function, made once, passed down. The shared type for it belongs in `core` (routed note 5).

### 4.2 A variable-timestep mode

No `update(frameDelta)`, not behind a flag. Variable steps make integration frame-rate
dependent, so a 144 Hz machine and a 60 Hz machine produce different worlds, replays diverge,
and every physical constant becomes a function of the display. One timestep mode, and the
interpolated `alpha` is what buys back the smoothness that a variable step was reaching for.

### 4.3 Multiple update rates

No `physicsHz` alongside `aiHz`. Two accumulators means two definitions of "now" and an
ordering question at every co-prime crossing. A system that wants to run at 10 Hz registers
`loop.sim.every(0.1, …)` and gets a deterministic, documented ordering for free.

### 4.4 Tween timelines, keyframes, and tweening object paths

No `sequence([...])`, no `tween(sprite, 'pos.x', …)`. A path string is reflection: it costs a
split and a walk per step, it defeats rename, and a typo fails silently forever. `delay`
covers most sequencing and `onDone` covers the rest in three lines. If chaining becomes the
thing everybody hand-rolls, it comes back — as a `core` combinator over callbacks, not as a
second scheduler in here.

### 4.5 Springs and physical easing

`core` owns `easing`, and a spring is a solver with state and a stability class of its own.
Not in a 12 KB budget, and not before a game has asked twice.

### 4.6 `visibilitychange`, `pagehide`, and every other DOM lifecycle hook

The loop never listens to the document. It does not need to: `browserFrames` degrades on its
own when rAF stops, which is the same signal arriving by a cheaper road. `persist` already
owns `visibilitychange` (it is one of its invariants, and mobile Safari does not deliver
`beforeunload`), and a second listener racing it is exactly the kind of duplicated ownership
this kit is trying not to have. A game that genuinely wants to pause when hidden writes one
line of its own.

### 4.7 A frame-rate cap, `requestIdleCallback`, and priority queues

The host owns the paint cadence. A `maxFps: 30` option is a `FrameSource` — write one in
fifteen lines and inject it — not a fourth clamp interacting with the other three.

### 4.8 A headless runner, and workers

No `loop.runFor(60)`. `manualClock` + `manualFrames` is three lines and keeps exactly one
model of how time advances in this package. No worker support: a fixed-step loop across a
thread boundary is a message-ordering problem, and it belongs in a game that has measured a
need, not in the primitive.

### 4.9 A global loop, and autostart

No singleton, no start-on-import. Two live loops driving one canvas is a real failure mode
(Vite HMR produces it routinely) and it is much easier to notice when every loop has an owner
that constructed it.

### 4.10 `Date.now()`, in any form

There is no `epochClock()` here and no second field on `Clock` for calendar time. The moment
this package can tell you the date, half the kit starts asking it, and the ban in rule 1
becomes advisory. The calendar belongs to the save (`persist`) and to the economy (`sim`).

---

## 5. Invariants a reviewer can test

Each is phrased so that its failure is a specific, writable test.

| # | invariant | the failing case |
|---|---|---|
| I-1 | `update` is called with `stepSeconds` on every single call, for the life of the loop. | Any call whose `dt` differs from `1/hz`. Collect every `dt` over 10,000 varied pumps; the set must have size 1. |
| I-2 | `update` runs on `'tick'` pumps. | Start a loop, only ever pump `'tick'` for a simulated minute, and assert `tick > 0` and `stats.renders === 0`. This is the hidden tab. |
| I-3 | Catch-up is clamped. | `clock.advance(3_600_000)` then one pump: `update` runs at most `ceil(maxCatchUpMs / 1000 * hz)` times — 15 at defaults — and never 216,000. |
| I-4 | Dropped time is dropped, not owed. | After I-3, the next pump with a 16 ms advance runs exactly one step. If it runs more, the excess was deferred and the spiral was only postponed. |
| I-5 | `alpha ∈ [0, 1]`, is `accumulator / step`, and is exactly `1` while paused. | Any recorded `alpha` outside the range, or a paused frame whose `alpha` is not `1`. |
| I-6 | A backwards clock costs game time, never the loop. | Inject a clock that jumps back 5,000 ms. No negative `dt`, no exception, `tick` does not decrease, and the pump after it still runs a step. |
| I-7 | Nothing runs before `start()`, and `start()` owes nothing for the wait. | Construct the loop, advance the clock an hour, then `start()` and pump: exactly zero dropped seconds and zero catch-up steps. |
| I-8 | Sim timers pause; real timers do not. | With the loop paused for a simulated minute: a `loop.sim.every(1, …)` has fired zero times and a `loop.real.every(1, …)` has fired once with `repeats === 60`. |
| I-9 | No scheduler callback runs more than once per pump, on either timeline. | An hour advanced in one pump must produce one call per timer, with `repeats` carrying the count. A test that counts invocations, not repeats. |
| I-10 | Timers due in the same advance fire in due-time order, then registration order, every run. | Register three timers due at the same instant across two runs with different pump patterns and compare the call sequences. |
| I-11 | A timer or tween registered inside a firing callback does not run in that same fire; one cancelled inside it never runs at all. | The classic mutation-during-iteration crash, or a cancelled callback that fires once anyway. |
| I-12 | A cancelled or slot-displaced tween never calls `onDone`; a completed one calls `onUpdate` with exactly `to` before `onDone`, and `onDone` exactly once. | An `onDone` after a cancel, or a final value of `0.9999999`. |
| I-13 | Two tweens can never share a slot. | Start two in slot `'x'`; `active === 1` and only the second one's values are ever seen. |
| I-14 | The loop stops itself when a callback throws, and says so. | A throwing `update` that leaves `running === true`, or a second `update` call after the throw. |
| I-15 | `loop.stats` is the same object identity on every read, and reading it allocates nothing. | Identity comparison across frames, plus a bench with an allocation counter. |
| I-16 | No global is read anywhere except inside `browserFrames`. | Import the package in Node with `globalThis.requestAnimationFrame` deleted and run a full manual-clock game to completion. Also: `grep -rn 'Date\.now\|performance\.now\|Math\.random' packages/loop/src` returns nothing. |
| I-17 | `stop()` releases everything. | `stop()` leaves `frames.started === false`, `sim.pending` untouched (timers survive a restart, deliberately), and no further callbacks arrive after it returns. |
| I-18 | Every duration argument rejects nonsense by name. | `setSpeed(-1)`, `every(0, …)`, `after(NaN, …)`, `hz: 0` must each throw a `RangeError` naming the parameter and the value, per constitution rule 9. |
| I-19 | Nothing exported here can tell a caller the date. | Any symbol or field returning an epoch time. `Clock` has exactly one method; `grep -rn 'epoch\|Date' packages/loop/src` returns only prose saying it does not do this (§4.1a). |
| I-20 | This package defines no easing curve and no easing name. | `grep -rn 'ease\(In\|Out\)' packages/loop/src` finds only the type `EasingName` from `core`. An unknown name passed to `start` throws a `RangeError` naming the valid ones; it must never silently run linear, because a level file with a typo would then ship feeling wrong and passing. |

---

## 6. The traps

Every one of these has already cost somebody time, most of them in `../foom-simple-ui`,
whose playbook is cited by number.

### 6.1 rAF is 0 Hz in a hidden tab, and the canvas keeps lying about it

*(playbook trap 3, non-negotiable #6.)* The last painted frame stays on screen, so a game
whose loop stopped an hour ago looks exactly like one that is running. The naive
implementation — `requestAnimationFrame(frame)` and everything inside `frame` — deletes every
minute the player spends on another tab, and nobody notices until a player complains that
their production "resets" when they switch tabs.

The fix is structural and it is why `FrameSource` exists: two sources, one that paints and one
that only ticks. A builder who "simplifies" `browserFrames` down to rAF alone will pass every
test that runs in the foreground.

Second-order: a diagnosis of "nothing animates" from an automated browser pass is worthless
until `document.visibilityState` has been checked — the source project threw away two full
player passes to this, because Chrome marks a tab hidden when its *window* is occluded.

### 6.2 Everything that is not painting must be on the tick, not the paint

*(playbook trap 9.)* The source game's HUD updated only inside the frame callback, so in a
background tab it froze with the renderer: stale prices, stale disabled buttons, a shop that
would not open. Everything was working; only the *painting* had stopped, and the HUD had been
attached to the wrong one of the two.

This is why `update` — not `render` — is the callback that runs unconditionally, and it is
worth telling `ui` explicitly: its invariant "anything that is not painting updates on an
interval, not inside the frame loop" is satisfied by putting the HUD refresh in `update`.
There is no need for a second `setInterval` in a Lattice game, and a second one is worse than
none, because it introduces §6.3.

### 6.3 A poll racing a settle is a data-loss bug, not a flicker

*(playbook trap 12 — the subtlest thing in this package.)* The source game polled "should the
namer be open?" every 900 ms while quests settled every 1000 ms. Between a settle and the next
one, the derived condition was briefly true again, so the modal **reopened after the player
had confirmed**; the obvious recovery — press CONFIRM again — overwrote the company name they
had just chosen. Two periods, no shared factor, and a one-shot dialog driven off a poll of
derived state. The result was not a flicker. It was the loss of the single most personal piece
of data in the save.

A scheduler makes polls one line long, which makes this trap *cheaper to fall into here than
anywhere else in the kit*, so the package must push back:

- **One-shot UI is driven off a latch or an event, never off a poll of derived state.** The
  source game's actual fix was a `namerShown` boolean.
- `every` schedules by absolute due time and does not drift, which makes such a race
  reproducible rather than intermittent — better, but the race is still there.
- A repeat callback must be **idempotent and correct for any `repeats`**. If it is not safe to
  run twice, it is not safe on a timer.
- If two periodic jobs must not interleave, they are one job, or one is `after` re-armed from
  inside the other.

### 6.4 Interpolating across a teleport draws a smear

`render(alpha)` blends previous → current. When a game moves something discontinuously — a
respawn, a camera cut, a wrap at the edge of the map, loading a save — the blend runs across
the discontinuity and draws the entity sliding through everything in between for one frame.
The rule the game must follow, and that this RFC must state because nothing can enforce it:
**a teleport sets previous = current as well.**

### 6.5 The spiral of death, and its disguise

Without the clamp, a pump that takes longer than its steps produce more steps than the next
pump can afford, and the loop accelerates into a locked tab. The clamp is not an optimisation;
it is the termination condition. Its disguise: with the clamp in place the game *degrades*
instead of hanging — sim time simply falls behind real time — so a game that is far too slow
looks like a game running in slow motion. `stats.stepsLastPump` sustained above 1 and a
growing `realTime - time` are the tells.

### 6.6 Float drift in the accumulator

`accumulator -= 1/60` ten thousand times does not land where the arithmetic says it should.
Keep the accumulator and the step in **integer milliseconds** internally, and convert to the
seconds handed to `update` exactly once, from a precomputed constant, so that every `dt` is
bit-identical (I-1). A game that seeds an RNG per tick will otherwise diverge on replay for
reasons no one will find.

### 6.7 Reading the clock more than once per pump

Steps 1 and 7 must read the same value. A pump that reads the clock again for its stats
attributes the time between the two reads to nothing at all, and worse, a re-read after
`update` can produce a *shorter* elapsed than the one already accumulated. One read, cached
for the pump.

### 6.8 The first pump after `start()`

If `start()` does not record the clock, the first `elapsed` is "everything since the epoch of
this clock", which the clamp then dutifully turns into 15 wasted steps and one enormous
`onStall`. Related: constructing the loop and starting it after a four-second asset load must
owe nothing (I-7).

### 6.9 Double rendering when both pumps fire

While visible, `browserFrames` fires rAF *and* the interval. Rendering on both would paint
twice per interval period and skew `fps`. Only `'paint'` pumps render, and each pump renders
at most once — a builder tempted to "always render, it's cheap" has doubled the cost of the
most expensive thing in the frame.

### 6.10 A stats object stored is a stats object that changes

`const before = loop.stats` then comparing to `loop.stats` later compares an object with
itself. This is the price of allocating nothing per frame, and it is paid with a doc comment
loud enough that nobody pays it twice.

### 6.11 A frame source that cannot be torn down keeps the game alive

An rAF chain that re-arms unconditionally survives `stop()`, and with it the whole object
graph — canvas, world, audio. `stop()` must cancel the pending rAF handle *and* clear the
interval, and a restarted loop must not end up with two chains. `input`'s "every listener
returns a disposer" is the same rule; this package's version is that `FrameSource.stop` is
not optional and is tested by starting and stopping a hundred times.

---

## Notes routed to the orchestrator

These are outside `docs/rfc/loop.md`'s ownership and are for other packages' owners:

1. **`input` needs a per-tick sample buffer.** DOM events arrive on the browser's schedule,
   not the fixed step's. A fixed-step `update` that reads live listener state consumes a
   different input depending on how many steps ran that pump, which breaks replay. Somebody
   must own "drain events into a snapshot at the tick boundary"; it is not `loop`, because
   `loop` must not know what an event is, and it does not appear in `input`'s module list.
2. **`persist`'s debounced write and `loop.real` are the same feature.** `persist` cannot
   import `loop` (both layer 1), so either it takes a `schedule` callback the game wires to
   `loop.real.after`, or it keeps its own timer and the kit has two timer implementations.
   I would rather it took the callback.
3. **`ui`'s third invariant should say "not inside the render callback"**, not "on an
   interval". With this design, `update` *is* the interval, and a `ui` that starts its own
   `setInterval` re-creates §6.3 in the one package most likely to hold one-shot dialogs.
4. **Accepted from `core` (routing 2): `TweenOptions.ease` is `Easing | EasingName`,
   resolved through `core`'s `EASINGS`.** This package defines no curve and owns no name.
   Two consequences I am holding the builder to: an unknown name throws a `RangeError`
   listing the table rather than falling back to linear, and there are no sine or expo
   easings in the kit at all, so no example, test or default here may reach for one.
5. **`core` should export the calendar type that `loop` refuses to own** — one line,
   `export type EpochMillis = number;` and `export type Now = () => EpochMillis;` — so that
   `persist`'s writer parameter and `sim`'s integrate parameter are visibly the same seam
   rather than two coincidentally-shaped numbers (see §4.1a). `loop` does not use it and does
   not want it; `core` is the only package all three can import.
