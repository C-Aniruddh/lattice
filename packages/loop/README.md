# @lattice/loop

> Time. A wall-clock game loop with fixed-step simulation and interpolated rendering, plus
> scheduling, tweens and frame statistics.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @lattice/loop
```

**`@lattice/loop` is the only part of the kit that knows what time it is.** It advances a
game's rules at a fixed rate off an *injected* wall clock whether or not anything is being
painted, and hands the renderer a blend factor so the pictures can run at whatever rate the
display manages.

---

## The five-line version

```ts
import { createLoop, browserFrames } from '@lattice/loop';

const loop = createLoop({
  clock: { now: () => performance.now() },        // the one global clock read in the whole app
  frames: browserFrames(),                        // rAF paints; an interval ticks when hidden
  update: (dt) => world.step(dt),                 // exactly 1/60 s, 0–14 times per pump
  render: (alpha) => world.draw(surface, alpha),  // never mutates; blends previous → current
});
loop.start();
```

Read those five option lines as the five promises this package makes.

| line | promise |
|---|---|
| `clock` | time is a parameter. The kit never reads a global clock, so `lint` can ban `Date.now()` in every `src/` and mean it. |
| `frames` | *when to run* is a parameter too, and the browser adapter is deliberately not one source but two. |
| `update` | `dt` is the same number every call, forever. Nothing else here matters as much. |
| `render` | `alpha ∈ [0, 1)` blends the last step into the next. Render is told more about time than update is, and allowed to do less with it. |
| `start()` | nothing runs on import. No ambient loop, no singleton, no autostart. |

---

## A whole minute of game, with no timers anywhere

This is the example the rest of the README is about. **It has been run**; the output below is
copied from the run, not written by hand.

```ts
import { createLoop, manualClock, manualFrames } from '@lattice/loop';

const clock = manualClock();          // in a game: { now: () => performance.now() }
const frames = manualFrames();        // in a game: browserFrames()

const world = { x: 0, previousX: 0 };

const loop = createLoop({
  clock,
  frames,
  update: (dt) => {
    world.previousX = world.x;        // a teleport must set previous = current too
    world.x += 2 * dt;                // 2 units a second, forever, at exactly 1/60 s
  },
  render: (alpha) => {
    const drawnAt = world.previousX + (world.x - world.previousX) * alpha;
    if (loop.tick === 60) console.log(`tick 60 draws x at ${drawnAt.toFixed(4)}`);
  },
});

loop.real.every(30, (repeats) => console.log(`autosave × ${repeats} at ${loop.realTime}s`));

loop.start();
for (let i = 0; i < 3600; i += 1) {   // one simulated minute at ~60 fps
  clock.advance(16.667);
  frames.pump('paint');
}

console.log(`ticks ${loop.tick}  sim ${loop.time.toFixed(3)}s  real ${loop.realTime.toFixed(3)}s`);
console.log(`stepMs ${loop.stepMs}  fps ${loop.stats.fps}  dropped ${loop.stats.droppedSeconds}s`);

// now the tab goes to the background: rAF stops, the interval keeps pumping once a second
for (let i = 0; i < 60; i += 1) {
  clock.advance(1000);
  frames.pump('tick');
}
console.log(`after a hidden minute: renders ${loop.stats.renders}, ticks ${loop.tick}`);
console.log(`sim ${loop.time.toFixed(2)}s vs real ${loop.realTime.toFixed(2)}s`);
```

```
tick 60 draws x at 1.9667
autosave × 1 at 30.0006s
autosave × 1 at 60.0012s
ticks 3600  sim 60.001s  real 60.001s
stepMs 16.667  fps 59.99880002399491  dropped 0s
autosave × 1 at 90.0012s
autosave × 1 at 120.0012s
after a hidden minute: renders 3600, ticks 4440
sim 74.00s vs real 120.00s
```

Four things in that output are the whole package.

- **`stepMs 16.667`, not `16.666666666666668`.** The accumulator is integer microseconds and
  `stepUs = round(1e6 / hz)`, so 60 Hz is really 59.9988 Hz — which is also why `fps` reads
  `59.9988…` for a run that pumped exactly 60 times per simulated second. That 0.002% matters
  to nobody and the exactness matters to `persist`: see [`stepMs` is a compatibility
  constant](#stepms-is-a-compatibility-constant).
- **The autosaves kept firing after the tab went hidden**, at 90 s and 120 s, from `'tick'`
  pumps alone. That is `loop.real` being interval-backed rather than rAF-backed. Delete the
  interval half of `browserFrames` and every autosave in the kit dies at the exact moment tabs
  get closed.
- **`renders 3600` did not move during the hidden minute** while `ticks` climbed from 3,600 to
  4,440. Rules keep running; painting does not.
- **`sim 74.00s vs real 120.00s`.** Sixty hidden pumps of one second each were clamped to
  250 ms of catch-up apiece — 14 steps, not 60 — so sim time ran at roughly a quarter speed and
  fell 46 seconds behind. **That is correct and deliberate.** See
  [the loop credits nothing](#the-loop-advances-callbacks-sim-advances-value).

---

## One pump, in order

Every invariant in this package refers to this ordering.

```
1  nowMs = clock.now(); elapsed = max(nowMs - last, 0); last = nowMs   ← one accounting read
2  realTime += elapsed;  real.advance(elapsed)                        ← unclamped, unpaused
3  run queued jobs, in creation order, each at most once              ← off the paint path
4  accumulator += elapsed * speed
5  if accumulator > maxCatchUp: dropped += excess; accumulator = maxCatchUp; onStall(excess)
6  while accumulator >= step:
       sim.advance(step)                                              ← timers before the step
       for each update subscriber, in order: fn(stepSeconds, tick)
       tick++; accumulator -= step
7  if kind === 'paint':
       alpha = paused ? 1 : accumulator / step
       for each render subscriber: fn(alpha, time + alpha * stepSeconds, nowMs)
8  stats
```

Control calls take effect at the **next** pump boundary — `pause()` from inside `update` does
not truncate the pump it was called from — except `stop()`, which takes effect immediately,
because a game stopping itself on a fatal error must not be updated again.

---

## Saying "this must keep running when nobody is looking"

Expressed by **choosing what you attach the work to**. Not by a flag, and not by hoping.

| attach it to | runs hidden? | truthful about wall time? | use it for |
|---|---|---|---|
| `render(alpha, time)` | **no** — rAF is 0 Hz | no | pixels, and nothing else |
| `update(dt, tick)` | yes, on `'tick'` pumps | no — clamped, ~¼ speed hidden | rules, HUD data, anything that must not freeze |
| `loop.real.every(s, fn)` | yes | **yes** — unclamped, unpaused | autosave, telemetry, "has the day rolled over?" |
| a timestamp in state, integrated on read | yes, on the first read after resume | **yes**, exactly | the economy, and any long duration |

The pattern a real idle game wants, in full:

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
sampled in `update` and drawn in `render`. Accumulating it makes the night shorter for the
player who looked away, which is the offline-earnings bug wearing a nicer hat.

---

## The loop advances callbacks; `sim` advances value

**This package credits nothing. Ever.** There is no `offlineSeconds`, no "welcome back" event,
no `awayMs` on any callback, and it will not grow one.

The clamp does not defer the excess to a later frame — that only moves the spiral one frame
along — and it does not hand it to anybody either. It is **dropped**, counted in
`stats.droppedSeconds`, and reported to `onStall` for diagnostics.

| | `@lattice/loop` | `@lattice/sim` |
|---|---|---|
| owns | time the player is **watching** | time the player was **not** |
| clock | monotonic, injected, may freeze in sleep | epoch timestamp stored **in the save** |
| shape | a fixed step, run n times | closed form, integrated once on read |
| an hour away | clamped to 250 ms and dropped | one `integrate(state, epochNow)`, exact |
| may credit resources | **no** | yes, and only it |
| stamps a save | **no** — its clock has no epoch | reads the stamp `persist` wrote |

Three corollaries worth writing on the wall:

1. **Never derive economy from `dt`.** `update(dt)` runs a clamped number of times; summing
   `rate * dt` deletes exactly the time the player was away.
2. **`loop.time` is not real time and drifts below it on purpose.** Anything that must be true
   against the player's wall clock is a `loop.real` timer or a timestamp in `sim` state. Putting
   a thirty-second build timer on `loop.sim` makes it take two minutes if the player looks away
   — which reads as a bug, and is worse than one, because you cannot reproduce it in the
   foreground.
3. **Do not "fix" the drift by raising `maxCatchUpMs`.** The ceiling is what stops a restored
   tab spending four seconds inside one frame while the browser paints nothing.

`stats.droppedSeconds` and `onStall` are for a perf warning or a "welcome back" panel that
mentions no numbers. They are **not** an earnings feed.

---

## Two timelines

```ts
loop.sim.every(2, (waves) => spawnWave(waves));   // pauses, scales with speed, clamped
loop.real.after(30, () => save());                // fires while paused, hidden, and at 4×
```

`Scheduler` is one model on two clocks. Both coalesce: **a callback never runs more than once
per advance of its timeline**, and `every` reports `repeats` rather than firing a burst, so an
hour spent hidden gives `real.every(1, …)` one call with `repeats === 3600` rather than 3,600
calls inside one frame. Write the body correct for any `repeats` — `credit(perTick * repeats)`,
not `credit(perTick)` — and make it idempotent.

**The coalescing window is one `advance()`, which is one pump for `real` and one fixed step for
`sim`.** That is deliberate and it is the one place this implementation is stricter than the
RFC's wording: coalescing sim timers per *pump* would make a spawn wave fire in a pattern that
depended on how many catch-up steps a frame happened to contain, and a sim timer has to land on
the same tick under any frame rate or the recorded session it appears in stops replaying. The
clamp is what bounds a sim burst instead — a pump can never advance more than `maxCatchUpMs` of
sim time, so at the defaults that is at most fourteen calls where a real burst would be
unbounded.

Timers due in the same advance fire in **due-time order, then registration order**, and there
is no comparator parameter: a comparator that may return `0` reintroduces exactly the ambiguity
the rule removes.

A third timeline a game owns outright is `createTimeline()`, advanced from inside its own
`update`.

### The trap a scheduler makes cheap

The source game polled "should the namer be open?" every 900 ms while quests settled every
1,000 ms. Between a settle and the next one the derived condition was briefly true again, so the
modal **reopened after the player had confirmed** — and the obvious recovery, pressing CONFIRM
again, overwrote the company name they had just chosen. That was not a flicker. It was the loss
of the single most personal piece of data in the save.

- **One-shot UI is driven off a latch or an event, never off a poll of derived state.**
- If two periodic jobs must not interleave, they are one job, or one is an `after` re-armed from
  inside the other.

---

## Coalesced off-frame work

```ts
const rebuild = loop.coalesce(() => field.recompute(map));
map.onChange(() => rebuild.request());   // called fifty times while a road is dragged
```

One sweep. The guarantee is per **pump**, not per step: fourteen catch-up steps that each dirty
the field still produce exactly one rebuild. Jobs run before the step loop, so the rebuild is
always visible to the updates that follow it, and they run on `'tick'` pumps and while paused —
a hidden tab still rebuilds, because pathfinding is a rule and rules do not stop when the
painting does.

`after(0, fn)` is the trap that looks like it does this. Ten `after(0)` calls in one pump queue
ten one-shots and run the sweep ten times.

---

## Tweens

```ts
const tweens = createTweens();
loop.onUpdate((dt) => tweens.step(dt));          // on the fixed step, never in render

tweens.start({
  from: panel.y, to: 0, seconds: 0.35,
  ease: 'cubicOut',                              // a name from @lattice/core's EASINGS
  slot: 'panel.y',                               // re-targeting mid-flight is the default
  onUpdate: (y) => { panel.y = y; },
  onDone: () => panel.enableButtons(),
});
```

- **This package defines no easing curve and no easing name.** `ease` resolves through `core`'s
  `EASINGS`, so `'cubicOut'` means the same thing in `ui`, in `draw` and here, forever. An
  unknown name throws a `RangeError` listing the valid ones — it never silently goes linear,
  because a level file with a typo would then ship feeling wrong and passing.
- There is no `easeInOutSine` and no expo curve anywhere in Lattice. `Math.cos` and `Math.pow`
  are not required by ECMA-262 to be correctly rounded, so either one demotes a tween out of
  Tier A — and a tween drives a position, a position gets written to a save, and the save no
  longer replays.
- A **slot** is not a tag. Starting a tween in an occupied slot cancels the incumbent silently
  and without its `onDone`, which is what makes "the panel arrived, enable the buttons" safe to
  put in `onDone`.
- The final call is `onUpdate(to)` with **exactly** `to`, then `onDone`, exactly once. A panel
  that ends its slide at `0.9999999` never fires its "arrived" comparison.

---

## Replay — the constitution, made falsifiable

`@lattice/input` records a log keyed by tick, `@lattice/persist` stores and verifies it, and
this is the only package that can press play.

```ts
const result = replay({
  source,                    // structural: { ticks, applyAt(tick), checkpointAt(tick) }
  update: game.update,       // the same function the live game runs
  hash: () => game.hash(),   // Tier A arithmetic only
});
result.divergedAt;           // -1 when this build still agrees with the recording
```

`ReplaySource` is structural rather than imported, so `loop` (layer 1) never reaches up to
`persist` (also layer 1) and nobody duplicates a format. `persist`'s zero-allocation cursor
satisfies it; so does an array in a test.

**What a green replay proves.** That the fixed step's prohibitions were obeyed. A game that
reads a clock inside `update`, derives from a frame delta, or lets a render pass mutate state
cannot pass, because none of those inputs exist here — there is no wall clock, no variable
delta, and nothing is painted. It is the one test in the kit that fails when someone adds
`Math.random()` to a system months from now, and there is a test in `test/replay.test.ts` that
does exactly that and asserts the failure.

**What it does not prove.** Not the picture. `@lattice/input` runs two clocks — gestures deliver
on ticks, the camera integrates on frames — so a log reproduces the same world and the same
tiles, not the same glide. The rule that keeps that safe is the Tier B rule: a frame-integrated
camera may reach pixels and must never reach a hash. And a replay is not a save: it reconstructs
a session from its start, it does not resume one.

---

## `stepMs` is a compatibility constant

```ts
loop.stepMs;       // 16.667 at 60 Hz, 20 at 50 Hz. Computed once, stable for the loop's life.
```

`@lattice/persist` writes this number into a recorded input log and refuses to migrate a log
whose `stepMs` differs from the running loop's, because a log keyed by tick index means nothing
if a tick is a different length than it was when the log was made. **Changing `hz` in a shipped
game is a breaking change to every recorded session**, exactly as changing a save schema is, and
it belongs in a migration note rather than in a tuning pass.

`replay()` enforces the same thing at the other end: if the source carries a `stepMs` and it
disagrees, it throws rather than reporting a divergence at tick 1 — the two failures deserve
different words.

## Units

**Options are in milliseconds, callbacks are in seconds, and the boundary is `src/clock.ts`.**
A host clock is milliseconds on every platform that has one; a game's own constants read as
"0.4 s of hop" and "12 s to build", and writing those in milliseconds is how a duration gets
typo'd by a factor of a thousand.

Every duration here is a plain `number` **whose name ends in its unit** — `stepMs`, `budgetMs`,
`idleMs`, `stepSeconds`, `droppedSeconds`, `TweenOptions.seconds` — and that name is the entire
defense. `after(3000, …)` on a timeline measured in seconds is fifty minutes; the compiler
cannot see it and no type can, because both units are `number` and a duration has only one kind.

That is why this package exports **no `Millis` or `Seconds` alias**. It used to, both were
`= number`, and the doc comment said in as many words that they guarded nothing — but the name
in `.lattice/kit.json` sat beside `Loop` and `Scheduler` with nothing marking the difference and
was twice read as a brand that would refuse `{ stepMs: 16 }`. It would not have; `16` is a
perfectly good `number`. Where a duration has one correct value that something else already
knows, **take that thing rather than the number** — `@lattice/input` takes `step: loop`, not
`stepMs`. `docs/rfc/durations.md` has the three tiers.

## The tick index is a cross-package contract

`tick` is a non-negative integer, starts at 0, increments by exactly one per `update` call, and
**never skips or repeats for the life of the loop, including across a `stop()` and `start()`**.
`@lattice/input` buckets its events by it and `@lattice/persist` keys its replay envelope by it:
the index *is* the alignment that makes replay possible.

---

## Statistics

`loop.stats` returns **the same object on every read** and the loop mutates it in place. That is
what keeps reading it every frame free. Copy the fields you keep — `const before = loop.stats`
then comparing to `loop.stats` later compares an object with itself and finds no difference,
ever.

| field | says |
|---|---|
| `fps` | paints in the last completed second of real time. `0` until the first second elapses |
| `frameMs` / `updateMs` / `renderMs` | smoothed **pump** costs, one-eighth EMA (a negative power of two, so the arithmetic is exact) |
| `worstFrameMs` | worst pump cost since the last `resetStats()`. Never decays |
| `worstGapMs` | **worst gap between two painted frames in the last `windowMs`.** The honest one |
| `cadenceMs` | the display's period, as this loop observed it. `worstGapMs` is unreadable without it |
| `absences` | gaps of `absenceMs` or more — a hidden tab, not a slow frame. Excluded, and counted here |
| `warmingUp` | the opening `warmupFrames` gaps are still being discarded |
| `overBudget` | pumps costing more than `budgetMs` |
| `stepsLastPump` | sustained above 1 means the game cannot keep up |
| `droppedSeconds` | diagnostics only — never an earnings feed |

### There are two instruments here, and one of them is blind

`frameMs` and `worstFrameMs` are the **pump's own wall time** — the loop reads the clock on the
way into a pump and on the way out, and the difference is the work it did. **A garbage collection,
a style recalculation, or anything else that lands *between* two pumps is in neither reading.**
That is not hypothetical: one gallery exhibit measured 23.1 ms worst on one machine and 13.1 ms on
another *for the same build*, because whether the pause lands inside a pump is machine-dependent
and the readout is not; another shipped a HUD reading `0.0 ms` against a real worst gap of 9.2 ms.

`worstGapMs` is the wall time from one painted frame to the next, so everything in between is
inside it by construction. It is measured from the loop's own single clock reading at the top of
each `'paint'` pump — no `performance.now()`, no rAF timestamp, so a manual-clock test asserts it
to the millisecond.

```ts
const clock = manualClock();
const frames = manualFrames();
const loop = createLoop({ clock, frames, warmupFrames: 0 });
loop.start();
frames.pump('paint');
clock.advance(16);
frames.pump('paint');
clock.advance(90);   // a pause between pumps: nothing the loop invoked is running
frames.pump('paint');

loop.stats.worstGapMs;    // 90 — the player saw one picture for 90 ms
loop.stats.worstFrameMs;  // 0  — the pump did no work, and truthfully says so
```

**Read `worstGapMs` next to `cadenceMs`, never next to `budgetMs`.** A gap contains a whole
display period that is not work: 16.7 ms is a perfect frame on a 60 Hz panel and 8.3 ms is a
perfect one at 120 Hz. The cadence is the *shortest* gap in the window, because nothing paints
faster than the panel refreshes, so the verdict is the ratio — under about one and a half cadences
dropped no frames. `budgetMs` is a work budget and belongs to `overBudget`, which counts pumps.

Two exclusions, both deliberate and both visible. A gap of `absenceMs` or more (default one
second) is a hidden tab rather than a slow frame; it is excluded and counted in `absences`, and it
re-bases the next gap so the reading recovers on the following paint instead of sitting at zero.
And the opening `warmupFrames` gaps (default 10) are a page load rather than a scene, so they are
discarded while `warmingUp` is `true` — pass `warmupFrames: 0` to measure the load too.

`stats.stepsLastPump` above 1 and a growing `realTime - time` are the tells for the spiral of
death in its disguised form. The clamp turns a hang into a game running in slow motion, so a
game that is far too slow *looks* fine.

---

## Testing a game built on this

No fake timers. No `await`. No flake.

```ts
const clock = manualClock();
const frames = manualFrames();
const loop = createLoop({ clock, frames, update, render });
loop.start();
clock.advance(1000); frames.pump('paint');   // one second of game, instantly
frames.pump('tick');                         // and this is what a hidden tab looks like
```

This package's own suite is 215 tests at 100% statement, branch, function and line coverage and
runs in about 40 ms.

---

## Deliberately absent

| not here | because |
|---|---|
| offline accrual, `awayMs`, "welcome back" | `sim` credits; this advances callbacks |
| `epochClock()`, `loop.epoch`, a second `Clock` method | a monotonic clock has no calendar, and the moment this could tell you the date the ban on `Date.now()` becomes advisory |
| a variable timestep, even behind a flag | a 144 Hz machine and a 60 Hz machine would produce different worlds |
| `physicsHz` alongside `aiHz` | two accumulators is two definitions of "now"; use `loop.sim.every(0.1, …)` |
| tween timelines, keyframes, `tween(obj, 'a.b.c')` | a path string is reflection: it costs a walk per step, defeats rename, and a typo fails silently forever |
| springs | a solver with state and a stability class of its own, and not before a game has asked twice |
| `visibilitychange`, `pagehide` | `browserFrames` degrades on its own; `persist` already owns those listeners |
| a frame-rate cap, `requestIdleCallback` | a `maxFps: 30` option is a `FrameSource` — write one in fifteen lines and inject it |
| `loop.runFor(60)`, workers | `manualClock` + `manualFrames` is three lines; a worker is a message-ordering problem |
| a global loop, autostart | two live loops driving one canvas is a real failure mode, and Vite's HMR produces it routinely |
| `Millis`, `Seconds`, `Duration` type aliases | they were `= number`, so they refused nothing — and a type name in the manifest is read as a promise. See [units](#units) |

---

## Environment

Isomorphic. Every module runs unchanged in Node with no shims except `src/frames.ts`, which
declares itself `@browser-only` and is the only place in the package that names a host global.
`browserFrames()` touches nothing until called and is tree-shaken out of a Node build; the
`FrameSource` interface beside it is three type declarations and a hand-driven test double.

## License

MIT
