# Lattice

> The grid underneath.

**A TypeScript kit for isometric, deterministic, zero-asset games.** Nine small libraries that
compose: the projection and the camera, a fixed-step loop, procedural art on a `Surface` it does
not own, synthesised sound, saves that survive a version bump, and an idle economy solved in
closed form rather than ticked.

There are no images, no audio files and no fonts anywhere in it, because there is nothing to
load: every building is drawn from one color, every sound is built from oscillators, and the
whole kit weighs less than a photograph with **no dependency outside itself**.

| | |
|---|---|
| **nine packages** | `core` `iso` `draw` `loop` `input` `audio` `persist` `sim` `ui` — a DAG, and it points one way |
| **zero dependencies** | not on npm, not on the DOM unless the package name says so. One `npm i`, nothing transitive |
| **zero assets** | art is procedural, sound is synthesised. A Lattice game is a few dozen kilobytes and recolourable at runtime |
| **12 kB per package** | a hard gzipped budget checked by `npm run size`, with every exception written down and argued in `kit.json` |
| **2,000+ tests** | across 83 files, including contract tests sited *above* the packages, where the interesting bugs live |
| **deterministic** | seed + input log → the same pixel. Checked by a test that fails when it is not true — see below |

---

## What it looks like

A valley at dusk. Tap a tile and a lamp goes up there, and the night opens around it. This is the
whole program — there is no scene file, no asset pipeline and no build step beyond `tsc`.

```ts
import { DepthSorter, createCamera } from '@latticekit/iso';
import {
  BASE_SLOTS, VARIANT_ZERO, beginFrame, createCanvas2dSurface, createLightField,
  createPalette, defineSprite, drawSprite, endFrame, isoTile, renderFrame, spriteHeightPx,
} from '@latticekit/draw';
import type { Variant } from '@latticekit/draw';
import { browserFrames, createLoop } from '@latticekit/loop';
import { createInput } from '@latticekit/input';

// A sprite is a footprint and a function. `massing` draws the object; `emit` is the light it
// throws, which runs only when the frame is actually dark.
const lamp = defineSprite({
  id: 'lamp',
  w: 1,
  d: 1,
  massing: (s) => {
    s.post(0, 0, 0, 3, 'metal');           // coordinates are relative to the footprint
    s.glow(0.5, 0.5, 3, 'warn', 0.4, 0.9); // the fixture
    s.shadow(0, 0, 1, 1);                  // what grounds it
  },
  emit: (field, gx, gy) => field.add(gx + 0.5, gy + 0.5, 0, 3, 0.9, 'warn'),
});

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('index.html needs a <canvas>');

const camera = createCamera(canvas.clientWidth, canvas.clientHeight);
camera.centerOnTile(8, 8);

const surface = createCanvas2dSurface(canvas);   // the only object that knows what a canvas is
const palette = createPalette(BASE_SLOTS);
const light = createLightField(surface);
const order = new DepthSorter(256);
const lamps: { gx: number; gy: number; v: Variant }[] = [];   // your state. the kit holds none

const loop = createLoop({
  clock: { now: () => performance.now() },       // the one global clock read in the whole app
  frames: browserFrames(),                       // rAF paints; an interval ticks when hidden
});

const input = createInput({
  element: canvas,
  camera,                    // drag pans it, wheel zooms about the pointer, both for free
  step: loop,                // the loop itself — a literal here mistimes every gesture
  actions: { place: ['tap', 'key:KeyL'] },       // one handler, two devices
});

input.onAction('place', (a) => {
  lamps.push({ gx: a.gx, gy: a.gy, v: { ...VARIANT_ZERO, seed: lamps.length } });
});

loop.onUpdate((_dt, tick) => input.tick(tick));  // gestures arrive on ticks, never on frames
loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);
  const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky', light });
  light.begin(pen, 0.7, 'night');                // 0 is full day, and then it costs nothing

  order.clear();
  for (const l of lamps) order.add(l.gx, l.gy, 1, 1, spriteHeightPx(lamp, l.v));

  renderFrame(pen, {
    terrain: (p, visible) => {
      for (let gy = visible.gy0; gy <= visible.gy1; gy++) {
        for (let gx = visible.gx0; gx <= visible.gx1; gx++) isoTile(p, gx, gy, 'ground');
      }
    },
    solids: (p, sorted) => {
      // Sorted and culled already. Walk it forwards; the tap that picks walks it backwards.
      for (let i = 0; i < sorted.count; i++) {
        const l = lamps[sorted.indexAt(i)];
        if (l !== undefined) drawSprite(p, lamp, l.gx, l.gy, l.v);
      }
    },
  }, order);

  endFrame(pen);
});

loop.start();
```

Three things in there are the design rather than the API.

**`a.gx, a.gy` is a tile.** No game written on this kit converts a pointer position into a grid
cell, because the conversion has to happen through the camera *as it stood when the tick opened*
and a game that does it in a handler does it through the camera as it stands now — which is a
different tile, on any frame where the map was moving.

**The sorted list is walked forwards, and picked backwards.** There is exactly one sorted list in
the kit, `iso` owns it, and `renderFrame` calls `sort()` itself immediately before handing it
over — so there is no window in which a caller holds a sorted order and is tempted to improve it.
Partitioning it (all the shadows, then all the bodies) is a *stable* reorder that looks harmless
and makes a player tap one building and open the one behind it.

**`lamps` is yours.** No registry, no entity system, no scene graph, no component store. The
kit hands back a permutation over the array you already had.

> `docs/GUIDE.md` builds this out into a real game, in the order you will need it: the frame, the
> first building, input, time, the economy, saving, sound, and how to test all of it in Node.

---

## Determinism is checked, not claimed

Every kit says it is deterministic. The claim is only worth something if something breaks when it
stops being true, so here it is, in `packages/loop/test/replay.test.ts` (an excerpt, not a
whole program):

```ts ignore
update(dt, tick) {
  x = (x + input + tick) | 0;
  y = (y + rng.int(0, 4)) | 0;
  if (nondeterministic && Math.random() < 0.5) x = (x + 1) | 0;   // ← the experiment
}
```

A session is recorded through a real loop, then replayed against the same game with that one line
armed. The replay reports the tick where it first disagreed. With the flip off, `divergedAt` is
`-1`; with it on, it is `63` — the first checkpoint, because 64 coin flips have happened by the
time it is compared and the odds of all 64 landing tails are `2⁻⁶⁴`, about 5.4 × 10⁻²⁰. A suite
run once a second since the formation of the Earth would not have seen it. That is not a flaky
test; it is a certain one with the arithmetic written down beside it.

The falsification runs in both directions and both are asserted, which is the part usually
skipped: a test that only ever fails proves nothing about the case it is supposed to catch. There
is a control that the same build replayed against itself never diverges, so the flip is the only
variable.

`Math.random()`, `Date.now()` and `performance.now()` are banned inside every package's `src/` and
`npm run lint` enforces it. Randomness arrives as a seeded `Rng` the caller owns; time arrives as
a parameter.

### The two-tier rule, which is the thing most kits get wrong by not knowing it exists

"Deterministic" was two claims wearing one word. ECMA-262 specifies `+ - * /`, `Math.sqrt`,
`Math.imul` and the bitwise operators **exactly**. It explicitly does *not* require `sin`, `cos`,
`pow`, `exp` or `log` to be correctly rounded — so two conforming engines may disagree in the last
bit, and a save file written on one will not verify on the other.

| | arithmetic | promise | may reach |
|---|---|---|---|
| **Tier A** | `+ - * /`, `sqrt`, `imul`, bitwise | bit-identical on every engine | hashes, save files, replays, anything |
| **Tier B** | `sin`, `cos`, `pow`, `exp`, `log`, … | correct to within an ulp or so | pixels only — never hashed, never persisted |

Tier B is not banned — a cost curve is `b · rᵏ` and there is no honest way around that. It is
required to **declare itself**: mark the site `@tier-b` and the linter is satisfied. That makes
every one of them greppable, so an auditor can ask of each in turn whether it ever reaches a save
file.

It changes real decisions. `iso`'s A\* heuristic is the integer octile metric `14·min(dx,dy) +
10·|dx−dy|` rather than a Euclidean one, because a path reaches a save file. `sim`'s cost curve is
exponentiation by squaring rather than `Math.pow`, because a player is charged that number. There
are deliberately no sine or expo easings in the kit. And a color is stored as the player's *hue*,
never as the `#rrggbb` it derives to, because the derivation needs `cbrt`.

---

## Numbers, not convictions

Two of the more useful things in `docs/PERFORMANCE.md` are decisions that went the other way from
the intuition.

### A sprite cache that was measured and deleted

`draw`'s RFC listed a sprite bitmap cache as provisional and named deleting it as a clean outcome.
Then it was measured:

| | 400 sprites of 42 draw calls each |
|---|---:|
| direct path, every sprite drawn from its massing | 2.14 ms |
| **a perfect cache: key, lookup and blit, 100% hits, no misses** | **0.04 ms** |
| the most a cache could ever save | 2.10 ms, of an 8 ms budget |

So the honest comparison was never "2.14 ms versus nothing". It was 2.14 ms versus 0.04 ms **plus
four new ways to render something stale** — zoom buckets, palette revisions, blit snapping, and a
don't-fill-while-moving rule that exists because filling during a pinch is strictly *worse* than
having no cache at all — plus 8 MiB of resident bitmaps on a phone. The module is not built.

The condition under which it reopens is a row in the same table rather than a footnote, so whoever
hits it can point at the number: a thousand buildings of that complexity is 5.40 ms, 68% of the
budget, and that is where a cache would start to earn what it costs.

### Out-parameters are not faster, and that is not why they exist

Rule 7 says the hot path allocates nothing. Every vector signature therefore takes an output
parameter, which costs every call site something real. Comparing mean throughput says the rule is
wrong:

| operation | ops/sec | max latency |
|---|---:|---:|
| allocating add, result escapes | 50,709,067 | **2.3168 ms** |
| out-parameter add, identical work | 40,714,999 | **0.0274 ms** |

Allocating wins the mean by about 25%, and that is not measurement error — V8's nursery is a bump
allocator and an object that dies in the same iteration is nearly free.

**Look at the second column.** The allocating form's worst observed call is **85× slower**. That
is the garbage collector, showing up exactly where a mean cannot see it, and a 2.3 ms pause inside
an 8 ms budget is not a slow frame, it is a dropped one — arriving in a burst, so the player sees
a hitch rather than a lower frame rate. A game protects its frame-time tail, not its mean. Anyone
relaxing the rule because "allocation is cheap now" is right about the mean and wrong about the
only number that matters.

---

## The nine packages

They form a DAG and it points one way. `core` imports nothing; nothing imports `ui`.

```
core ─┬─▶ iso ──┬─▶ draw ─┬─▶ ui
      ├─▶ loop  │         │
      ├─▶ sim   └─────────┤
      ├─▶ persist         │
      ├─▶ input ──────────┘
      └─▶ audio
```

| package | what it is for | environment |
|---|---|---|
| [`core`](packages/core) | seeded rng, stateless hashing, noise, maths, easing, typed events, pools, formatting | isomorphic |
| [`iso`](packages/iso) | the three coordinate spaces, camera, depth sort, tile maps, footprints, hit-testing, paths | isomorphic |
| [`draw`](packages/draw) | a `Surface` with a Canvas2D backend, color derivation, and the isometric solid kit | browser + headless |
| [`loop`](packages/loop) | wall-clock loop, fixed-step simulation, schedulers on two timelines, tweens, replay | isomorphic |
| [`input`](packages/input) | pointer/touch/keyboard into one replayable stream of intents, in tile coordinates | browser |
| [`audio`](packages/audio) | WebAudio synthesis from declarative recipes, voice limiting, buses, a music deck | browser |
| [`persist`](packages/persist) | versioned saves, an explicit migration chain, injected storage, integrity | isomorphic |
| [`sim`](packages/sim) | idle-economy maths in closed form: cost curves, flow, offline accrual, capacity | isomorphic |
| [`ui`](packages/ui) | DOM overlay primitives — panels, toasts, number rolls. Deliberately not a framework | browser |

`.lattice/kit.json` is the same table, machine-readable, with every package's exports and
invariants — read it before you read source.

---

## Status

**Eight of the nine packages are complete**, with `ui` and the demo game the work in flight as
this is written. The gate is `npm run verify` — build, lint and the whole suite — and nothing
lands red. CI runs it on Node 20, 22 and 24, and then runs the suite **twice in separate
processes and diffs the recorded streams**, because a stray `Date.now()` or a `Set` iteration
order is exactly what a single run cannot catch.

The version is `0.1.0` and the public surface should be treated as such. What is deliberately
absent is written down per package — `iso` has no entity system, `draw` has no bezier paths,
`input` has no gamepad and says why in four sentences — and those absences are the part of the
design most likely to be argued with, which is why each one carries its reasoning.

---

## Getting started

```bash
git clone https://github.com/C-Aniruddh/lattice
cd lattice
npm install
npm run verify     # build + lint + test. nothing lands red
npm run dev        # the demo game, on :5173
```

Or install what you need. Every package brings only the ones below it in the DAG:

```bash
npm i @latticekit/iso     # brings @latticekit/core, and nothing else
```

| if you want | read |
|---|---|
| to build a game with it | **[`docs/GUIDE.md`](docs/GUIDE.md)** — start to finish, in order |
| a whole game, wired, at real scale | [`examples/demo/src/`](examples/demo/src) |
| to know which package owns a thing | [`.lattice/kit.json`](.lattice/kit.json), then that package's `README.md` |
| to work *on* it, as a human or an agent | **[`AGENTS.md`](AGENTS.md)** — the ten non-negotiables, and they are not a style guide |
| the numbers behind any performance claim | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| why two packages split a responsibility the way they did | [`docs/SEAMS.md`](docs/SEAMS.md) |
| to send a pull request | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## License

MIT.
