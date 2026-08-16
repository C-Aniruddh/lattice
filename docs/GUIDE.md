# Building a game with Lattice

This is the long way round: one game, built from an empty file, in the order you will actually
need the pieces. Every block is real API — the whole document is one program, type-checked
against the packages in this repo under `strict`, `exactOptionalPropertyTypes` and
`noUncheckedIndexedAccess`.

The game is **the lamplighter's valley**: a small island of tiles, lamps the player puts up by
tapping, night that falls on a schedule, an economy that pays while the tab is closed, and a save
that survives the version after this one.

If you want the API surface rather than the path through it, read
[`.lattice/kit.json`](../.lattice/kit.json) and then the package `README.md` you need. If you want
the rules the kit holds itself to, read [`AGENTS.md`](../AGENTS.md).

| | |
|---|---|
| 1 | [The shape of a Lattice game](#1-the-shape-of-a-lattice-game) |
| 2 | [A window: camera, surface, palette](#2-a-window-camera-surface-palette) |
| 3 | [A frame: the seven passes](#3-a-frame-the-seven-passes) |
| 4 | [The ground](#4-the-ground) |
| 5 | [Your first building](#5-your-first-building) |
| 6 | [Input, and the tile the player meant](#6-input-and-the-tile-the-player-meant) |
| 7 | [Time: what goes in `update`, `render` and `real`](#7-time-what-goes-in-update-render-and-real) |
| 8 | [The economy](#8-the-economy) |
| 9 | [Saving, and surviving a schema change](#9-saving-and-surviving-a-schema-change) |
| 10 | [Sound](#10-sound) |
| 11 | [Night](#11-night) |
| 12 | [Replay, which is how you find out you were wrong](#12-replay-which-is-how-you-find-out-you-were-wrong) |
| 13 | [Testing all of it in Node](#13-testing-all-of-it-in-node) |
| 14 | [The eight things that will bite you](#14-the-eight-things-that-will-bite-you) |

---

## 1. The shape of a Lattice game

A Lattice game is **your state**, plus a set of libraries that operate on it and hold none of it
themselves. There is no engine object, no registry, no entity system, no scene graph. If you have
a `lamps` array, that is the world.

Four things get wired together at boot, and the order matters:

```
             ┌── loop ───────────────────────────────────────────┐
 clock ─────▶│  update(dt, tick)   fixed step, 60 Hz, on the     │
 frames ────▶│                     wall clock, hidden or not     │
             │  render(alpha, t)   whenever the display can      │
             └───────┬────────────────────────────┬──────────────┘
                     │                            │
              input.tick(tick)             input.frame(nowMs)
                     │                     beginFrame → renderFrame → endFrame
                     ▼                            │
             your handlers, in tiles              ▼
                     │                    iso sorts, draw paints
                     ▼
             your state ──▶ sim integrates ──▶ persist writes
```

**There is exactly one thing in the game that decides when work happens**, and it is the loop.
Nothing else reads a clock: `input` counts ticks, `audio` uses the audio clock, `persist` is
handed a `now` function, and `sim` takes a timestamp as a required argument. Two clocks in one
game is the bug that overwrote a player's typed company name in the game this kit came from.

### Install

```bash
npm i @lattice/core @lattice/iso @lattice/draw @lattice/loop @lattice/input
npm i @lattice/audio @lattice/persist @lattice/sim
```

Each brings only what is below it in the DAG, and nothing from npm. Everything with
`environment: isomorphic` in `kit.json` runs in Node with no shims, which is section 13.

### The imports, once

```ts
import {
  asEpochMillis, createRng, expectObject, expectRecordOfFinite, expectSerializable,
  fmtCompact, hash2, toUnit,
} from '@lattice/core';
import type { EpochMillis } from '@lattice/core';
import { DepthSorter, TileGrid, createCamera } from '@lattice/iso';
import type { TileRange } from '@lattice/iso';
import {
  BASE_SLOTS, DAY, FLAG_POWERED, NIGHT, VARIANT_ZERO, beginFrame, createCanvas2dSurface,
  createLightField, createPalette, defineSprite, drawSprite, endFrame, glowDot, isoTile,
  renderFrame, spriteHeightPx,
} from '@lattice/draw';
import type { Pen, Variant } from '@lattice/draw';
import { browserFrames, createLoop } from '@lattice/loop';
import { createInput } from '@lattice/input';
import { createAudio } from '@lattice/audio';
import {
  NO_GATES, advance, buildFlow, createFlow, defineEconomy, costOfNext, maxBuyable, zeroStocks,
} from '@lattice/sim';
import type { Ledger } from '@lattice/sim';
import {
  browserStorage, createStore, defaultChecksum, installFlushTriggers, migrations,
} from '@lattice/persist';
import type { Recognize, Schedule } from '@lattice/persist';
```

Note the `@lattice/` scope on every one. **Inside a package** the rule is the opposite — import
from the module, never from `./index.js` — but from outside, the barrel is the only entry point
and everything else is private.

---

## 2. A window: camera, surface, palette

Three objects, built once at boot and never rebuilt.

```ts
const found = document.querySelector('canvas');
if (found === null) throw new Error('index.html needs a <canvas> filling the viewport');
const canvas: HTMLCanvasElement = found;      // a `!` is a place the compiler stopped helping

// The camera is pure maths. It has no element, no clock and no feel — pan, zoom and inertia
// are `input`'s job, and it drives this object through panByScreen / zoomAt / centerOn.
const camera = createCamera(canvas.clientWidth, canvas.clientHeight, { minZoom: 0.6, maxZoom: 3 });
camera.centerOnTile(16, 16);

// The one object in your program that knows what a canvas is. Everything above it draws through
// `Surface`, which is what makes thumbnails, golden tests and a future WebGL backend possible.
const surface = createCanvas2dSurface(canvas);

// Ten named slots — sky, ground, ink, brand, metal, glass, warn, ok, bad, night — that every
// draw call refers to by name. `palette.lerp(DAY, NIGHT, t)` recolours the whole game at once.
const palette = createPalette(BASE_SLOTS);
```

The tile is fixed at 64×32 and that is deliberate: any other *uniform* size is exactly a camera
zoom, so a game that wants 32×16 runs at `zoom = 0.5`. Parameterising it would thread a projection
object through every signature in `draw`, `input` and `ui` for the rest of the kit's life.

**Resize is yours to wire**, both halves, or the world will be drawn at the wrong scale:

```ts
function onResize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  surface.resize(w, h, window.devicePixelRatio);
  camera.resize(w, h);
}
window.addEventListener('resize', onResize);
```

---

## 3. A frame: the seven passes

A frame is `beginFrame` → `renderFrame` → `endFrame`. `renderFrame` takes one callback per pass
and runs them in a fixed order that you cannot change:

| # | pass | you get | for |
|---|---|---|---|
| 0 | `backdrop` | `visible: Rect` (world) | a vertical ramp. Never a flat color — flat backgrounds make an island look like a sticker |
| 1 | `terrain` | `visible: TileRange` (already culled and margined) | tile diamonds |
| 2 | `solids` | `order: DepthSorter`, **already sorted and culled** | buildings *and* scenery, one list |
| 3 | `placement` | — | the ghost under the player's finger, the selection rim |
| 4 | *light* | **not a callback** | the night mask goes down and the bloom goes up |
| 5 | `overlay` | — | screen-space HUD, drawn *after* the dark so it reads at midnight |
| 6 | `effects` | — | floating numbers and bursts |

Pass 4 is not a callback on purpose: there is no way for a game to put the night mask over its own
HUD. The list is closed at seven, and a second `solids` pass is how the tree-through-wall bug
comes back.

```ts
const order = new DepthSorter(1024);   // allocated once, reused for ever
```

Everything you draw goes through a `Pen`, which carries the surface, the camera, the palette, the
frame's time and a scratch buffer. Hoist the `Passes` object to module scope and reuse it — it is
a setup-time object, not a per-frame one.

---

## 4. The ground

Terrain is a `TileGrid` — a typed array with bounds — and the variation in it comes from
`core.hash2`, not from an `Rng`.

```ts
const WORLD = 32;
const SEED = 0x5eed;

const ground = new TileGrid(WORLD, WORLD, { fill: 1 });
ground.fillFrom((gx, gy) => (toUnit(hash2(SEED, gx, gy)) < 0.06 ? 0 : 1));   // 0 = water
```

**Why a hash and not a stream.** `hash2(seed, gx, gy)` depends only on its coordinates, so the
renderer may visit tiles in any order and get the same field. An `Rng` stream depends on how many
draws came before it, so a renderer that culls differently at a different zoom would produce a
different island. That is the same reason `fillFrom` takes a function of `(gx, gy)` and not a
generator: the seam where determinism enters a map is shaped so the wrong thing is hard to write.

Painting it is a nested loop over the range `renderFrame` hands you:

```ts
function paintTerrain(pen: Pen, visible: Readonly<TileRange>): void {
  for (let gy = visible.gy0; gy <= visible.gy1; gy++) {
    for (let gx = visible.gx0; gx <= visible.gx1; gx++) {
      if (!ground.has(gx, gy)) continue;
      // A palette *slot name*, never a color literal — a slot name is what lets the whole
      // island recolour at dusk from one `palette.lerp`.
      isoTile(pen, gx, gy, ground.get(gx, gy) === 0 ? 'sky' : 'ground');
    }
  }
}
```

`visibleTileBounds` is computed once per frame by `renderFrame`, before the pass runs, so three
passes cannot each recompute it and disagree at the margins.

---

## 5. Your first building

A sprite is **a footprint and a function**. There is no sprite sheet, no atlas and no image.

```ts
const lamp = defineSprite({
  id: 'lamp',                     // stable across releases: renaming it is a content migration
  w: 1,
  d: 1,
  massing: (s, v, rng) => {
    // Coordinates are relative to the footprint origin, so the same sprite draws anywhere
    // without knowing where. Heights are in storeys.
    const lean = rng.int(0, 3) - 1;        // per-instance, seeded from `v.seed`, same every frame
    s.shadow(0, 0, 1, 1);                  // what grounds it. draw it first
    s.post(0.5, 0.5, 0, 3, 'metal');
    s.box(0.2, 0.2, 0.6, 0.6, { color: 'metal', h: 0.3, z: 3, outline: false });
    if (v.level > 1) s.roof(0, 0, 1, 1, 3.3, 0.4, 'ink');
    s.glow(0.5 + lean * 0.02, 0.5, 3.2, 'warn', 0.35, 0.9);
  },
  // Live art over the static image. `pen.t` is the only clock, and it arrived as a parameter.
  animate: (pen, gx, gy, v) => {
    if ((v.flags & FLAG_POWERED) === 0) return;   // an unlit lamp does not breathe
    const breath = 0.8 + 0.2 * (v.seed % 7) / 7 * (pen.t % 2);
    glowDot(pen, gx + 0.5, gy + 0.5, 3.2, 'warn', 0.5, breath);
  },
  // The light it throws. Runs only when the frame is actually dark, so a game in daylight
  // pays nothing for the lamps it is drawing.
  emit: (field, gx, gy) => field.add(gx + 0.5, gy + 0.5, 0, 3.5, 0.9, 'warn'),
});
```

The three hooks are separate because they run at different times into different buffers, and the
split is what makes a sprite's static art declarative and its motion explicit.

**`Variant` is the whole cache key, and that is why it exists.** `massing` receives the writer, the
variant and an `Rng` — and *nothing else*. Anything an instance varies by has to be in `Variant`:

```ts
interface Lamp {
  readonly gx: number;
  readonly gy: number;
  readonly v: Variant;      // { level, seed, flags, progress, label }
}

const lamps: Lamp[] = [];
```

Putting an instance fact in a closure instead — `massing: () => s.box(..., { color: myColour })` —
is exactly the channel `Variant` exists to close, and it is how a renderer starts producing art
that disagrees with `spriteBounds`, which measures the same massing with no frame at all.

Painting the solids pass is four lines, and they are yours:

```ts
function paintSolids(pen: Pen, sorted: DepthSorter): void {
  for (let i = 0; i < sorted.count; i++) {
    const l = lamps[sorted.indexAt(i)];
    if (l !== undefined) drawSprite(pen, lamp, l.gx, l.gy, l.v);
  }
}
```

**Walk it forwards, once.** `DepthSorter` handed back a permutation over *your* array. Drawing all
the shadows first and all the bodies second is a *stable partition* of that order — it looks
harmless, it is a reorder, and `iso.pickSorted` walks the same instance backwards to decide what
the player tapped. If you want two sweeps, take two forward walks.

---

## 6. Input, and the tile the player meant

```ts
const loop = createLoop({
  clock: { now: () => performance.now() },
  frames: browserFrames(),
});

const input = createInput({
  element: canvas,
  camera,
  stepMs: loop.stepMs,     // the same number the loop runs at. Not a literal — see below
  actions: {
    place: ['tap', 'key:KeyL'],
    inspect: ['longpress'],
  },
});
```

`stepMs` is not decoration. The recognizer counts *ticks* and multiplies by this to get
durations; it never reads a clock. Pass a literal that disagrees with the loop and every threshold
in the gesture profile — tap timeout, long-press duration, fling window — is wrong by the same
ratio, and the symptom is "long press feels wrong on some machines".

An action handler receives coordinates in all three spaces, because guessing which one a callback
wanted is the most common bug in this layer:

```ts
input.onAction('place', (a) => {
  // a.sx, a.sy — screen CSS px | a.wx, a.wy — world px | a.gx, a.gy — the tile
  if (!ground.has(a.gx, a.gy) || ground.get(a.gx, a.gy) === 0) return;   // no lamps on water
  if (lamps.some((l) => l.gx === a.gx && l.gy === a.gy)) return;
  lamps.push({
    gx: a.gx,
    gy: a.gy,
    v: { ...VARIANT_ZERO, seed: hash2(SEED, a.gx, a.gy), flags: 1 },
  });
  a.claim();     // handlers not yet run will not see it, and the camera will not also pan
});
```

**Your game never converts a pixel to a tile.** That is the single most useful thing this package
does, and the reason is timing rather than convenience: the conversion has to happen through the
camera *as it stood when the tick opened*. A handler that calls `screenToTile(camera, …)` itself
converts through the camera as it stands *now*, which on any frame where the map is moving is a
different tile. `input` freezes the camera when it closes a bucket, and every event carries the
result.

The same applies to what is *at* that tile: `input` refuses to know. There is no registry, no rect
and no `pickable` flag anywhere in its surface, so an implementation that caches hit boxes during
the draw pass cannot be built on it. In the source game the cached version made every collectable
untappable in a backgrounded tab, where the draw pass had stopped running and the boxes were
minutes old.

To find *which building* was tapped, walk the sorted list backwards with `iso.pickSorted` over
your own array. `gx, gy` is geometry; ownership is yours.

### Wiring it to the loop

```ts
loop.onUpdate((_dt, tick) => {
  input.tick(tick);          // closes the bucket and delivers every handler. Before your update
});

loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);        // integrates camera glide. Painting only — never gestures
});
```

Gestures are delivered on simulation ticks and never on frames. That is what makes the log
replayable: a log of wall-clock events is not, a log of tick-bucketed samples is.

---

## 7. Time: what goes in `update`, `render` and `real`

This is the section that saves you a bug report you cannot reproduce. There are four places work
can go and they are not interchangeable:

| attach it to | runs hidden? | truthful about wall time? | use it for |
|---|---|---|---|
| `render(alpha, time)` | **no** — rAF is 0 Hz in a hidden tab | no | pixels, and nothing else |
| `update(dt, tick)` | yes | no — clamped, ~¼ speed hidden | rules, HUD data, anything that must not freeze |
| `loop.real.every(s, fn)` | yes | **yes** — unclamped, unpaused | autosave, telemetry, "has the day rolled over?" |
| a timestamp in state, integrated on read | yes, on the first read after resume | **yes**, exactly | the economy, and any long duration |

`update` is called with the same `dt` every time, forever, zero to fifteen times per pump. Catch-up
is clamped at 250 ms and the excess is **dropped, not deferred** — the loop advances callbacks,
and `sim` advances value, which is section 8.

**Never accumulate `dt` into anything that has to be right.** A day/night phase is a pure function
of the calendar, sampled in `update` and drawn in `render`:

```ts
const DAY_MS = 8 * 60 * 1000;                       // a game-day is eight real minutes

/** 0 at dawn, 1 at midnight. A pure function of the wall clock — never an accumulator. */
function darknessAt(now: EpochMillis): number {
  const phase = (now % DAY_MS) / DAY_MS;            // 0..1
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}
```

Accumulating that instead makes the night shorter for the player who looked away, which is the
offline-earnings bug wearing a nicer hat.

`loop.sim` and `loop.real` are two timelines and choosing wrongly is silent. A thirty-second build
timer on `loop.sim` takes two minutes if the player switches tabs — a bug you cannot reproduce in
the foreground, on a machine where the tab is always visible.

---

## 8. The economy

`sim` is idle-economy maths in closed form. **It has no tick and no clock.** State is
`(stocks, rates, lastTimestamp)`, integrated on read, and every call that moves the anchor takes a
required epoch timestamp — so a frame delta has nowhere to go.

```ts
// Lamps produce light; light produces coin. Declared order is the *save's* field order.
const economy = defineEconomy({
  nodes: ['lamp', 'light', 'coin'],
  edges: [
    { from: 'lamp', to: 'light', per: 0.5 },       // units of `to` per unit of `from` per second
    { from: 'light', to: 'coin', per: 0.2 },
  ],
});

const flow = createFlow(economy);                   // scratch buffers, allocated once
let ledger: Ledger<'lamp' | 'light' | 'coin'> = {
  stocks: zeroStocks(economy),
  atMs: asEpochMillis(Date.now()),
};

/** Credit everything owed up to `now`, in one step, whatever the gap. */
function settle(now: EpochMillis): void {
  buildFlow(economy, ledger.stocks, NO_GATES, flow);
  const seconds = (now - ledger.atMs) / 1000;
  ledger = advance(economy, ledger, flow, seconds, now);
}
```

The evaluation order is computed by Kahn's algorithm and therefore *proven*, and it is kept
separate from the declared node order on purpose: append a node in v4 and every v1 save still
deserialises with its fields where they were. Cycles are refused at construction, naming the
cycle, rather than falling back to a numerical solver that would be a second implementation of
your economy diverging silently on exactly the saves that matter.

The reason it is worth doing this way is one row in `docs/PERFORMANCE.md`: `advanceOver` a
**six-month** absence costs 1.12 ms, 20% more than a twenty-hour one, and only because the longer
absence credits the full horizon. The duration is not in the complexity at all. A tick-based
economy would have needed 15.7 million steps for that row.

Prices are the same shape — closed form, invertible:

```ts
const LAMP_COST = { base: 10, growth: 1.15 };

function priceOfNextLamp(): number {
  return costOfNext(LAMP_COST, lamps.length);        // 10, 11.5, 13.2 …
}

function affordableLamps(): number {
  return maxBuyable(LAMP_COST, lamps.length, ledger.stocks.coin, 100);   // O(1), not a loop
}
```

`maxBuyable` is 12× a 400-step buy loop, and the loop is legitimate only as a test oracle. Note
that `costOfNext` uses exponentiation by squaring rather than `Math.pow` — a player is charged that
number, and reproducible beats one ulp more accurate.

Format it with `core`'s `fmtCompact`, which is Tier A and has no locale in it:

```ts
const priceLabel = fmtCompact(priceOfNextLamp());     // "1.2K"
```

---

## 9. Saving, and surviving a schema change

Start with the state you actually want to persist. **Persist the input, never the derived value** —
store the player's brand *hue*, not the `#rrggbb` it derives to, because the derivation needs
`cbrt` and `pow`, which are Tier B and engine-specific.

```ts
interface SaveV1 {
  readonly version: 1;
  readonly lamps: readonly number[];    // gx, gy, gx, gy … flat, because a save is a wire format
  readonly coins: number;
  readonly hue: number;
}
```

A recognizer is **not** a type predicate. It returns the value typed, or throws:

```ts
const isV1: Recognize<SaveV1> = (value) => {
  const o = expectObject(value, 'save.v1');
  const raw = o['lamps'];
  if (!Array.isArray(raw) || raw.length % 2 !== 0) {
    throw new TypeError(`save.v1.lamps: expected a flat array of gx,gy pairs, got ${String(raw)}`);
  }
  return {
    version: 1,
    lamps: raw.map((n, i) => expectSerializable(Number(n), `save.v1.lamps[${i}]`)),
    coins: expectSerializable(Number(o['coins']), 'save.v1.coins'),
    hue: expectSerializable(Number(o['hue']), 'save.v1.hue'),
  };
};
```

Three things fall out of that shape, and they are the reason it is not a boolean. A predicate has
already discarded the thing that was wrong by the time it returns, so it can only ever say "no";
this one names the field. The thrown message travels into `ReadFailure.message`, which is the
difference between a fixable bug report and a shrug. And a recognizer may **normalize as it
validates**, returning a repaired value — the cheapest possible migration for a field that only
ever needed a default.

`expectSerializable` is doing specific work there. `Infinity` is a perfectly legitimate Tier A
result and is exactly the value that does not survive being written down: `JSON.stringify` writes
`null` for it and for `NaN`, the checksum over that is perfectly valid, and nothing downstream can
detect it. Catching it at the recognizer is catching it at the last boundary where it can still be
blamed on the save rather than on the arithmetic.

A store is a key, a chain and an adapter. **There is no `version` option, because the chain *is*
the version** — declaring version 7 and shipping a chain that ends at 6 is inexpressible.

```ts
const chainV1 = migrations(1, isV1).seal();      // one version, no rungs. A legal chain

const storeV1 = createStore({
  key: 'valley:save',
  chain: chainV1,
  adapter: browserStorage(),
  fresh: (): SaveV1 => ({ version: 1, lamps: [], coins: 0, hue: 200 }),
  now: () => asEpochMillis(Date.now()),      // required, with no default, and section 7 is why
});

const opened = storeV1.open();               // never throws, for any content whatsoever
if (opened.source === 'fresh' && !opened.firstRun) {
  // A save was **lost**, which is not the same as a new player. A game that treats the two the
  // same will report a healthy funnel while quietly losing people.
  console.warn('save lost:', opened.failure?.reason);
}
```

`opened.failure.reason` is one of seven closed values — `unreadable`, `malformed`, `corrupt`,
`future`, `orphaned`, `migration-failed`, `rejected` — returned as a value rather than thrown,
because boot is the one moment a game cannot recover from an exception: there is no UI yet to show
it in.

### Now change the schema

A month later, one coin counter becomes a wallet of currencies. Add a rung; do not touch the old
recognizer.

```ts
interface SaveV2 {
  readonly version: 2;
  readonly lamps: readonly number[];
  readonly wallet: { readonly coin: number; readonly oil: number };
  readonly hue: number;
}

const isV2: Recognize<SaveV2> = (value) => {
  const o = expectObject(value, 'save.v2');
  const raw = o['lamps'];
  if (!Array.isArray(raw) || raw.length % 2 !== 0) {
    throw new TypeError(`save.v2.lamps: expected a flat array of gx,gy pairs, got ${String(raw)}`);
  }
  const wallet = expectRecordOfFinite(o['wallet'], 'save.v2.wallet');
  return {
    version: 2,
    lamps: raw.map((n, i) => expectSerializable(Number(n), `save.v2.lamps[${i}]`)),
    // Normalize as you validate: a currency added in a patch defaults here rather than needing
    // a rung of its own.
    wallet: { coin: wallet['coin'] ?? 0, oil: wallet['oil'] ?? 0 },
    hue: expectSerializable(Number(o['hue']), 'save.v2.hue'),
  };
};

const chain = migrations(1, isV1)
  .step(
    2,
    'one coin counter became a wallet, because oil arrived and a second bare number would have',
    (v1): SaveV2 => ({
      version: 2,
      lamps: v1.lamps,
      wallet: { coin: v1.coins, oil: 0 },
      hue: v1.hue,
    }),
    isV2,
  )
  .seal();

// The only line that changes on the store is `chain`. The head of the chain is the version.
const store = createStore({
  key: 'valley:save',
  chain,
  adapter: browserStorage(),
  fresh: (): SaveV2 => ({ version: 2, lamps: [], wallet: { coin: 0, oil: 0 }, hue: 200 }),
  now: () => asEpochMillis(Date.now()),
});
```

Four things the machinery enforces, each of which is a save a player would otherwise have lost:

- **Every rung steps exactly one version.** `.step(3, …)` from a head of 1 is a compile error, not
  a runtime surprise: `Increment<Head>` is a type-level successor.
- **Every version carries a recognizer, including the floor.** That is how `migrate` receives a
  typed argument instead of `unknown`. A chain of migrations that each begin with a cast is not a
  chain, it is a stack of hopes.
- **The `why` string is required and cannot be blank.** A reviewer in two years has that sentence
  and nothing else.
- **`seal()` re-checks the rungs at runtime** for callers who arrived from JavaScript, and throws
  naming the missing version. A hole caught there is a developer error; the same hole caught at
  decode time is a player losing a campus.

And a save from a *newer* build makes the store read-only rather than overwriting it, because a
stale deploy must not eat a good save.

### Autosave, and the one unit trap in the kit

```ts
function currentSave(): SaveV2 {
  const flat: number[] = [];
  for (const l of lamps) flat.push(l.gx, l.gy);
  return {
    version: 2,
    lamps: flat,
    wallet: { coin: ledger.stocks.coin, oil: ledger.stocks.light },
    hue: 200,
  };
}

// `Schedule` is (afterMs, fn) => cancel. `loop.real.after` is (delaySeconds, fn) => TimerId.
// The two are not the same function and TypeScript will tell you so — adapt it rather than
// casting, or the autosave fires once every 67 minutes instead of every four seconds.
const schedule: Schedule = (afterMs, fn) => {
  const id = loop.real.after(afterMs / 1000, fn);
  return () => { loop.real.cancel(id); };
};

const auto = store.autosave(currentSave, { schedule });
installFlushTriggers(auto, { visibility: document, page: window });
```

Two other details that are not preferences. **`loop.real`, not `loop.sim`**: a paused or
backgrounded game still owes the player the last four seconds of progress, and `loop.sim` stops
when the simulation does. And the flush is on `visibilitychange` and `pagehide`, **not
`beforeunload`** — mobile Safari does not reliably deliver the latter, which is where saves go to
die.

If you have no scheduler at all, drive `auto.tick()` from `update` instead — but never from
`requestAnimationFrame`, which is 0 Hz in a hidden tab, so a save that stops when the tab is
backgrounded is a save that never survives the tab being closed.

### Testing the chain, which is the point of having one

`store.decode(text)` is `open()` minus the adapter: the whole read pipeline as a function of a
string. Keep one fixture per historical version and run each through it. The envelope is
`{ v, t, n, c, d }` — version, epoch stamp, write sequence, checksum, and the JSON-encoded state:

```ts
function fixtureV1(now: number): string {
  const payload = JSON.stringify({ version: 1, lamps: [4, 4, 7, 5], coins: 12, hue: 200 });
  return JSON.stringify({ v: 1, t: now - 60_000, n: 1, c: defaultChecksum(payload), d: payload });
}
```

Run it through a store built on the *current* chain and assert `migratedFrom === 1` and
`source === 'save'`. That test is the reason a chain is worth having: it fails the day someone
edits a rung, rather than the day a player with an old save opens the game.

---

## 10. Sound

No files. A table of oscillator recipes, and the keys of that table become the type of `play`'s
first argument, so `play('colect')` is a compile error rather than silence.

```ts
const audio = createAudio({
  sounds: {
    light: {
      bus: 'sfx',
      minGapMs: 60,
      ladder: { steps: 5, windowMs: 900 },   // four in a row feel like a run, not four blips
      layers: [
        { wave: 'triangle', hz: 520, toHz: 780, gain: 0.16, hold: 0.12, cutoff: 3200 },
        { wave: 'sine', hz: 1040, gain: 0.05, hold: 0.08, delay: 0.02 },
      ],
    },
    deny: {
      bus: 'ui',
      minGapMs: 120,
      layers: [{ wave: 'square', hz: 220, toHz: 160, gain: 0.06, hold: 0.09, cutoff: 900 }],
    },
  },
});
```

Then play it from the same handler that placed the lamp:

```ts
input.onAction('place', () => {
  audio.unlock();                     // idempotent and cheap. Call it from every handler you have
  audio.play('light', { gain: 0.9 });
});
```

Three rules worth knowing before you author a table:

- **Nothing exists until `unlock()`.** No `AudioContext` at module load, none at construction. And
  `unlock` *resumes* as well as creates — a tab backgrounded long enough gets its context
  suspended, and without the resume, sound works for one session and then silently stops. `audio`
  deliberately installs no listener of its own: `input` owns the DOM event surface.
- **`minGapMs` is required, not optional.** A COLLECT ALL button banks twenty buildings in one tap.
  Twenty stacked oscillators is not twenty times as satisfying — the gains sum past 1 and WebAudio
  clips into a click. Making the field optional means the author who most needs it is exactly the
  author who omits it.
- **`play` returns *accepted*, not *a speaker moved*.** The throttle, the ladder and the voice
  ceiling all run identically with or without a device, which is what makes them testable in Node.
  `audio.available` answers the other question.

Pan belongs to the event, not the recipe: `play('light', { pan: camera.normalizedX(worldX) })`.
A menu click that moves in the stereo field as the player drags the map is the most disorienting
thing this package can do, which is why `spatial` defaults to `bus === 'sfx'`.

---

## 11. Night

The light field is one buffer per frame, accumulated as sprites draw and composited once.

```ts
const light = createLightField(surface);
```

Two calls, and their positions matter more than their arguments:

```ts
function paintFrame(nowMs: number, now: EpochMillis): void {
  const pen = beginFrame({
    surface, camera, palette,
    t: nowMs / 1000,
    clear: 'sky',
    light,                                   // without this, `emit` hooks never run
  });

  const dark = darknessAt(now);
  palette.lerp(DAY, NIGHT, dark);            // the color half
  light.begin(pen, dark, 'night');           // the mask half — the SAME number

  order.clear();
  for (const l of lamps) order.add(l.gx, l.gy, 1, 1, spriteHeightPx(lamp, l.v));

  renderFrame(pen, {
    terrain: paintTerrain,
    solids: paintSolids,
  }, order);

  endFrame(pen);
}
```

**One number, two consumers.** Two schedules — one for the color, one for the mask — is a valley
whose darkness and whose blue disagree, and it always gets reported as a light bug.

`light.begin` goes *before* the terrain pass, not in the light pass: pools accumulate as sprites
draw, and only the composite happens at pass 4. At `darkness === 0` the whole subsystem costs
nothing — no buffers allocated, no buffers cleared, no pools drawn, no composite, and `drawSprite`
skips every `emit` hook.

The honest limitation, stated where you will hit it: **lights are not occluded.** A lamp behind a
hill still spills over it. Real occlusion needs a shadow map per light and a depth buffer this
renderer does not have, and it would cost more than everything else in `draw` put together.

---

## 12. Replay, which is how you find out you were wrong

Replay is split across three packages along the DAG, and none of them imports another to do it:
**`input` records, `persist` stores and verifies, `loop` drives.** The shapes conform structurally.
`InputLog` — `{ version, stepMs, profile, samples }` — happens to satisfy `persist`'s
`ReplayCompat` exactly, which is not a coincidence but a seam that was argued about and settled.

Recording is two lines around a session:

```ts
import { record } from '@lattice/input';
import { createRecorder } from '@lattice/persist';

const tape = record(input);                            // one small object per sample, while on
const recorder = createRecorder({
  kit: '0.1.0',
  game: 'valley@3',
  rng: createRng(SEED).snapshot(),                     // identity AND cursor. Not just the seed
  startTick: 0,
  digest: (s: SaveV2) => (s.lamps.length ^ (s.wallet.coin | 0)) >>> 0,
  checkpointEvery: 600,
});

loop.onUpdate((_dt, tick) => {
  recorder.mark(tick, currentSave());                // digest runs only on checkpoint ticks
});
```

Then `recorder.stop(tick, state, tape.stop())` seals a `ReplayLog` around the input log verbatim,
and you store it under its own key with a chain that has **no rungs** — `migrations(N, isLog).seal()`
— because a replay log is *evidence, not progress* and must never be migrated. A migrated recording
would produce a confident wrong answer, which is worse than a refusal.

Playing it back drives the same game from the same seed:

```ts
import { replayCursor } from '@lattice/input';
import { replay } from '@lattice/loop';
import { createVerifier } from '@lattice/persist';
```

`createVerifier` refuses before the first tick if the kit build, the game build, the log version,
`stepMs` or the gesture profile differ — **naming the field**. A tap threshold that moved turns one
recorded pointer stream into a different sequence of actions, and a log recorded at 60 Hz replayed
at 50 Hz diverges for reasons no stack trace will show.

The verdict brackets the bug: `divergence.tick` and `divergence.lastAgreedTick`, so the failure is
"somewhere in these 600 ticks" rather than "somewhere in this hour". At ~11.2 M ticks/s, verifying
an hour of recorded play takes under a third of a second — which is why a divergence check is
something CI can run on every commit rather than a thing anyone schedules.

---

## 13. Testing all of it in Node

Everything marked `isomorphic` in `kit.json` runs in Node with no shims, and the three browser
packages each have a headless door. There is no jsdom anywhere in this repo's suite.

| instead of | use | what it gives you |
|---|---|---|
| `createInput({ element })` | `createHeadlessInput({ camera, stepMs, actions })` | the same object minus a producer of samples. Feed it `submit()` and `tick()` |
| `createCanvas2dSurface(canvas)` | `createRecordingSurface(w, h)` | a `Surface` that keeps every op as data — assert on geometry, not on pixels |
| `browserFrames()` + `performance.now` | `manualFrames()` + `manualClock()` | a loop you step by hand, at whatever speed you like, with no timers |
| `browserStorage()` | `memoryStorage()` | the same adapter contract, in a `Map` |
| a real `AudioContext` | `createAudio({ …, context: () => null })` | policy runs identically; `onScheduled` reports every voice it *would* have built |

A whole frame, asserted, with no DOM:

```ts
import { createRecordingSurface } from '@lattice/draw';

function countOps(): number {
  const testSurface = createRecordingSurface(960, 540);
  const testPalette = createPalette(BASE_SLOTS);
  const pen = beginFrame({ surface: testSurface, camera, palette: testPalette, t: 0, clear: 'sky' });
  drawSprite(pen, lamp, 4, 4, VARIANT_ZERO);
  endFrame(pen);
  return testSurface.ops.length;
}
```

And a whole gesture, asserted, with no pointer:

```ts
import { createHeadlessInput } from '@lattice/input';

function tapTile(): { gx: number; gy: number } | null {
  const headless = createHeadlessInput({
    camera,
    stepMs: 1000 / 60,
    actions: { place: ['tap'] },
  });
  let hit: { gx: number; gy: number } | null = null;
  headless.onAction('place', (a) => { hit = { gx: a.gx, gy: a.gy }; });
  headless.submit({ kind: 'down', id: 1, sx: 480, sy: 270, pointerType: 'touch' });
  headless.tick(0);
  headless.submit({ kind: 'up', id: 1, sx: 480, sy: 270 });
  headless.tick(1);
  return hit;
}
```

This is not a testing shim bolted on afterwards; it is the same object, and it is why the kit can
have 2,000 tests and no browser in CI.

---

## 14. The eight things that will bite you

**1. `Readonly<Vec2>` is not a barrier.** TypeScript *ignores property `readonly` modifiers when
checking assignability*, so a `Readonly<Vec2>` flows happily into a parameter typed `Vec2` and the
callee writes to your frozen constant. Import `ReadonlyVec2` from `core`, which is built as a real
barrier — a phantom optional property whose types conflict in exactly one direction. The failure is
a `TypeError` on the one frame that path executes.

**2. Reused objects.** Gestures, `ActionEvent`, `VoicePlan`, `FrameStats` and the `Pen`'s scratch
buffer are all the same object every delivery, by design — a fresh object per pointer move sixty
times a second is a collector pause with a nice API. **Copy what you keep.** Retaining one keeps a
reference to next tick's value.

**3. Out-parameters everywhere.** `gridToScreen(cam, gx, gy, zPx, out)` writes into `out` and
returns it. Allocate your scratch `Vec2`, `Rect` and `GridPoint` at setup and reuse them. There is
no allocator for `Rect`, `GridPoint`, `Tile` or `Anchor` on purpose: they are field-only shapes, so
write the literal once. `docs/PERFORMANCE.md` has the argument, and it is not the one you expect.

**4. `.js` on relative imports.** NodeNext resolution; TypeScript will not add them. Inside a
package, import from the module and never from `./index.js`, or you will build an import cycle you
cannot see.

**5. Tier B is presentation only.** `sin`, `cos`, `pow`, `exp`, `log` are not required to be
correctly rounded, so anything derived from them must never be hashed, persisted or replayed. Mark
a site `@tier-b` and the linter is satisfied — and it stays greppable, which is the point.

**6. `Infinity` is a perfectly Tier A result and does not survive JSON.** It serializes to `null`,
with a valid checksum, so no layer downstream can detect it. `expectSerializable` and
`isSerializable` in `core` exist for exactly this, and `sim` throws a *named* error rather than
letting a `NaN` reach a save.

**7. Two clocks.** If you find yourself adding a second `setInterval`, a `Date.now()` inside an
update, or a `requestAnimationFrame` outside the loop, stop. Everything schedules through
`loop.sim`, `loop.real` or a timestamp in state.

**8. A `!` is a place where the compiler was told to stop helping.** In the source game one of them
shipped a black screen to half the players. There are none in the kit and there should be none in
your game.

---

## Where to go next

| | |
|---|---|
| a whole game, wired | `examples/demo/src/` — the same pieces at real scale, and `npm run dev` runs it |
| the exact surface of one package | its `README.md`, which opens with a runnable example, and `src/index.ts`, whose header is the design |
| every export, machine-readable | [`.lattice/kit.json`](../.lattice/kit.json) |
| why two packages split a responsibility that way | [`docs/SEAMS.md`](SEAMS.md) |
| the number behind any performance claim | [`docs/PERFORMANCE.md`](PERFORMANCE.md) |
| what a package deliberately does *not* do, and why | the "what is deliberately not here" section of its README, and `docs/rfc/` |
| the rules a change has to hold to | [`AGENTS.md`](../AGENTS.md) |

The last row is worth one more sentence. Most of what is hard about this kit is not in the API; it
is in the handful of decisions that look like preferences and are not — one clock, one sorted list,
one tier of arithmetic that may reach a save file. Each of them has a failure attached, each
failure has a story, and the stories are in the prose next to the code rather than in a design
document nobody opens.
