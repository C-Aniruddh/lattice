---
name: starting
description: The wiring order for a Lattice game — canvas, surface, camera, palette, light, depth sorter, loop and input, in the one order that works. Use when starting an isometric game, setting up a Lattice project, writing the boot or main.ts, adding a game loop to a canvas, or when the first screen is blank, black, empty, or the game keeps drawing but stops responding to taps.
---

# Starting a Lattice game

Nine packages, one boot file, and an order that is not obvious. Get it wrong in two specific
places and there is no error, no warning, and a picture that looks plausible — the whole reason
this skill exists.

The layering, so you never have to guess which package a thing is in:

```
core ─┬─▶ iso ──┬─▶ draw ─┬─▶ ui
      ├─▶ loop  │         │
      ├─▶ sim   └─────────┤
      ├─▶ persist         │
      ├─▶ input ──────────┘
      └─▶ audio
```

`core` imports nothing. Nothing imports `ui`. If you find yourself wanting an upward import you
have the design backwards, not a missing export.

---

## The boot, in full

This compiles and runs. Copy it, rename it, and change the world it builds — not the order.

```ts
import { createScope } from '@latticekit/core';
import { DepthSorter, createCamera, tileBounds } from '@latticekit/iso';
import type { Rect } from '@latticekit/iso';
import {
  BASE_SLOTS,
  beginFrame,
  createCanvas2dSurface,
  createLightField,
  createPalette,
  endFrame,
  isoTile,
  renderFrame,
} from '@latticekit/draw';
import type { Passes } from '@latticekit/draw';
import { browserFrames, createLoop, createTweens } from '@latticekit/loop';
import { createInput } from '@latticekit/input';

// ── the screen ────────────────────────────────────────────────────────────────────
const host = document.getElementById('app') ?? document.body;
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%';
host.append(canvas);

const scope = createScope();
const surface = createCanvas2dSurface(canvas);
const palette = createPalette(BASE_SLOTS);

// ── the world, and the camera that has to be told about it ────────────────────────
const W = 64;
const H = 64;
const MAX_HEIGHT_PX = 96;                       // the tallest ground on the map
const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, W, H, MAX_HEIGHT_PX, worldRect);

const camera = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
  bounds: worldRect,
  minZoom: 0.25,
  keepVisible: 0.5,
});
// Frame the world on the FIRST frame. A fresh camera looks at world (0, 0), which in a 2:1
// projection is the *top corner* of the map — so without this the opening frame is empty space
// beside the world, which reads as a broken build.
camera.fitBounds(worldRect, 24);

// ── the night. Built unconditionally: it costs nothing while darkness is 0 ─────────
const light = createLightField(surface, { scale: 0.6, falloff: 1, bloom: 0.3 });

const order = new DepthSorter(512);              // allocated once, reused for ever
const tweens = createTweens();

// ── the clock, BEFORE the input, because the input needs it ────────────────────────
const loop = createLoop({
  clock: { now: () => performance.now() },
  frames: browserFrames(),                       // rAF paints; an interval ticks when hidden
});

const input = createInput({
  element: canvas,
  camera,
  step: loop,                                    // the loop itself. Never a number
  actions: { touch: ['tap'] },
});

// ── one resize handler, so there cannot be two that disagree ───────────────────────
function fit(): void {
  const w = Math.max(1, innerWidth);
  const h = Math.max(1, innerHeight);
  // `surface.pixelRatio`, never `devicePixelRatio` — the surface already clamped the device's
  // ratio, and re-reading the raw one here silently undoes that.
  surface.resize(w, h, surface.pixelRatio);
  camera.resize(w, h);
  camera.fitBounds(worldRect, 24);
}
addEventListener('resize', fit);
visualViewport?.addEventListener('resize', fit);  // iOS: a collapsing URL bar fires only this
scope.add(() => {
  removeEventListener('resize', fit);
  visualViewport?.removeEventListener('resize', fit);
});
fit();

// ── the two wirings it is fatal to cross ──────────────────────────────────────────
let daylight = 1;

loop.onUpdate((dt, tick) => {
  input.tick(tick);          // BEFORE the game's update: a handler must see the world as the
                             // player left it, not one step behind it
  daylight = 0.5 + 0.5 * Math.cos(loop.realTime * 0.1);
  tweens.step(dt);           // AFTER: a tween started this step should not also advance in it
});

const passes: Passes = {
  maxHeightPx: MAX_HEIGHT_PX,  // or a summit vanishes when its own base leaves the bottom edge
  terrain(pen, visible) {
    for (let gy = visible.gy0; gy < visible.gy1; gy++) {
      for (let gx = visible.gx0; gx < visible.gx1; gx++) isoTile(pen, gx, gy, 'ground');
    }
  },
  solids(pen, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const index = sorted.indexAt(i);
      void pen;
      void index;              // draw the thing at `index` here
    }
  },
};

loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);          // the camera's glide integrates here, at display rate
  const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky', light });
  light.begin(pen, 1 - daylight, 'night');   // darkness 0–1, and the color the dark goes
  order.clear();
  // …fill `order` with everything on screen…
  renderFrame(pen, passes, order);           // renderFrame calls sort() itself
  endFrame(pen);
});

// ── teardown, and the one line that saves an hour under Vite ──────────────────────
function dispose(): void {
  loop.stop();
  input.dispose();
  light.dispose();
  scope.dispose();
  canvas.remove();
}
if (import.meta.hot) import.meta.hot.dispose(dispose);

loop.start();                  // nothing runs before this. No ambient loop, no autostart
```

---

## The two mistakes that are silent

### 1. A `stepMs` typed by hand

```ts wrong
// This no longer compiles — and that is the fix, not the problem.
createInput({ element: canvas, camera, stepMs: 16, actions: { touch: ['tap'] } });
```

`createInput` counts every gesture duration in ticks and multiplies by the step it was handed;
it never reads a clock. A step that is not the loop's does not fail — **it lies by a constant
ratio.** `16` against a loop running at 16.667 is a long press that fires at **432 ms**, a fling
velocity **4% low**, and a recorded input log that a replay refuses months later with a message
nobody can trace back to the literal.

So `step` takes a `FixedStep` and the shortest thing that type-checks is the loop itself. Where
there is no loop — a headless test, a replay — use `fixedStep(60)`, which derives the step with
`createLoop`'s own arithmetic so the two are bit-identical rather than merely close.

```ts
import { createHeadlessInput, fixedStep } from '@latticekit/input';
import { createCamera } from '@latticekit/iso';

const camera = createCamera(800, 600);
const input = createHeadlessInput({ camera, step: fixedStep(60), actions: { collect: ['tap'] } });
```

**Build the loop before the input.** That is the whole reason for the order in the boot above.

### 2. A light field that was never attached to the pen

```ts wrong
// The field exists, `light.add()` is being called, and there is no night. No error anywhere.
const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky' });
light.begin(pen, 0.8, 'night');
```

Leave `light` out of the `beginFrame` literal and `pen.light` is `undefined`. Then
`renderFrame`'s `pen.light?.composite()` does nothing, `drawSprite` skips every sprite's `emit`
hook so no lamp glows, and every `light.add()` you make accumulates into a buffer nobody ever
reads — **while the field goes on reporting `active: true` with a live `count`.** The natural
diagnosis is "the night is broken" and the natural place to look is the light field, where
nothing is wrong.

`begin` throws when the field is not the pen's, which is one comparison per frame and buys you
that sentence on the first one. Keep the field on the `beginFrame` literal and there is nothing
to remember.

---

## Two clocks in one game is the bug

**A Lattice game contains exactly one thing that decides when work happens.** That is the loop.
Packages expose a tick-shaped method; they never go and find a clock.

In the game this kit came from, a modal polled "should the namer be open?" every 900 ms while
quests settled every 1,000 ms. Between a settle and the next one the derived condition was
briefly true again, so the modal **reopened after the player had confirmed** — and the obvious
recovery, pressing confirm again, overwrote the company name they had just chosen. That was not
a flicker. It was the loss of the most personal piece of data in the save.

So: one `createLoop`, and everything else hangs off it.

```ts
import { browserFrames, createLoop } from '@latticekit/loop';
import { createOverlay, drive } from '@latticekit/ui';

const now = (): number => performance.now();
const loop = createLoop({ clock: { now }, frames: browserFrames() });
const ui = createOverlay({ now });    // the SAME clock. Two clocks in one HUD is the bug above
drive(ui, loop);                      // update → ui.tick, render → ui.repaint
```

`@latticekit/ui` starts no timer and no rAF loop of its own, deliberately, for exactly this reason.

**`loop.realTime` is seconds; `createOverlay`'s `now` wants milliseconds.** If you need a
millisecond clock inside a game whose only clock is the loop, it is `loop.realTime * 1000` —
four separate exhibits arrived at that same expression independently.

---

## What goes on `update` and what goes on `render`

The table is short and getting it wrong is not a stutter, it is a world that stops existing.

| attach it to | runs in a hidden tab? | put here |
|---|---|---|
| `loop.onRender(alpha, time, nowMs)` | **no** — rAF is 0 Hz | pixels, and nothing else |
| `loop.onUpdate(dt, tick)` | yes | rules, HUD data, chunk streaming, anything that must not freeze |
| `loop.real.every(s, fn)` | yes, and unclamped | autosave, telemetry, "has the day rolled over?" |
| a timestamp in state, integrated on read | yes, exactly | the economy, and any long duration |

The classic version of getting this wrong: an endless world that streams chunks from `render`.
Switch tabs for ten seconds and come back, and the world has not merely stuttered — it stopped
existing while you were away.

And **`loop.time` is not real time.** It drifts below it on purpose: a hidden pump is clamped to
250 ms of catch-up and the excess is *dropped*, not deferred. A thirty-second build timer put on
`loop.sim` takes two minutes if the player looks away, which reads as a bug and is worse than
one because you cannot reproduce it in the foreground.

---

## The order inside one frame, and why

```
input.tick(tick)   →   your update   →   tweens.step(dt)        (fixed step)
input.frame(nowMs) →   beginFrame    →   renderFrame   →  endFrame   (display rate)
```

`input.tick` delivers the bucket of events that closed before this tick started; it is **the
only place a handler ever runs**. `input.frame` integrates the camera's glide and delivers
nothing. Drain input in the render callback, or after the camera has moved, and the tile a tap
resolves to is not the tile that was under the finger in the last frame the player actually saw.

---

## Under Vite, dispose on hot reload

HMR re-evaluates the module. `createInput` correctly throws on a second binding to the same
canvas — and the *first* instance is still bound and still rendering. **So the symptom is not
the error**: it is a game that keeps drawing while every tap does nothing and the readout is
frozen at whatever it last showed, with the real message buried in a console nobody is looking
at by then.

```ts
declare const dispose: () => void;
if (import.meta.hot) import.meta.hot.dispose(dispose);
```

One line. It pays for itself the first time you edit the file.

---

## Things that will bite you in the first hour

- **A camera copies the rectangle you hand it.** If the world's bounds are not known until after
  the seed is read, pass an empty rect, fill it, then call `camera.setBounds(worldRect)`. It is
  not politeness; it is the only way the second half of that order gets across.
- **`camera.zoom` has no setter, on purpose.** `zoomAt` takes a factor and a required anchor,
  which is right for a wheel notch and wrong for "show me the world I just made". Framing is
  `fitBounds(rect, marginPx)`, whose margin is in CSS pixels so the gutter is the same at every
  fitted zoom. If you genuinely want a specific zoom, hand `fitBounds` a rectangle of the
  viewport's own aspect at that scale — and know that having to fabricate it is a known gap.
- **`bounds` you omit is not "unbounded".** The default is about ±10,000 world pixels — roughly
  ±312 tiles — and a game that pans forever crosses it in fourteen screens of travel.
- **`vite` does not typecheck.** A type error will not stop the page loading; it produces a
  subtly wrong game instead. Run `tsc --noEmit` before you believe a screenshot.

---

## What this skill does not cover

| you want | read |
|---|---|
| drawing anything that is not a flat tile | `art` |
| terrain, roads, walkers, flow fields | `world` |
| taps, drags, pinch, placing things | `input` |
| numbers that grow, prices, offline progress | `economy` |
| sound | `sound` |
| saving and migrations | `saving` |
| a HUD, buttons, toasts | `hud` |
| replays, or two runs that differ | `determinism` |
| a stutter, or a bad frame number | `performance` |
| something that works and looks wrong | `traps` |

Every package also ships its own README, and it is on disk:
`node_modules/@latticekit/loop/README.md` and its siblings are the long-form version of everything
above.
