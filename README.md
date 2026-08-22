<div align="center">

<a href="https://plausible.ventures"><img src="https://plausible.ventures/og.png" alt="A valley at dusk rendered by Lattice: an isometric hillside with a lit shrine and a road of lamps" width="860"></a>

### The grid underneath.

**Type one sentence and get an isometric game you can play in a browser.**

[![verify](https://img.shields.io/github/actions/workflow/status/C-Aniruddh/lattice/ci.yml?branch=main&label=verify)](https://github.com/C-Aniruddh/lattice/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40latticekit%2Fcore?label=npm&color=cb3837)](https://www.npmjs.com/package/@latticekit/core)
[![license](https://img.shields.io/github/license/C-Aniruddh/lattice)](LICENSE)
[![site](https://img.shields.io/badge/site-plausible.ventures-0b7285)](https://plausible.ventures)

**[▶ Nineteen worlds, running &rarr;](https://plausible.ventures)**

</div>

---

`/lattice` is a plugin for coding agents. Under it are nine TypeScript packages with no
dependencies and no asset files — no images, no audio, no fonts — because there is nothing to
load: every building is drawn from one color and every sound is built from oscillators.

<!-- The image above is not an exception to "no asset files". It is not a drawing and nobody
     opened a paint program: it is a real frame of examples/demo, captured headless at dusk by
     site/tools/og.mjs and served from the site rather than committed here. The README used to
     open with a bare `# Lattice` over a red badge, which is what a project looks like when it
     cannot show you anything. This one can, so it does. -->

---

## Start here

Install the plugin in the agent you already use:

| | |
|---|---|
| **Claude Code** | `/plugin marketplace add C-Aniruddh/lattice` &nbsp;then&nbsp; `/plugin install lattice@lattice` |
| **Codex** | `codex plugin marketplace add C-Aniruddh/lattice` &nbsp;then&nbsp; `codex plugin add lattice@lattice` |
| **Grok** | `grok plugin install C-Aniruddh/lattice` |

Then type one sentence:

```
/lattice a game where you plant an orchard and each evening choose to harvest or let it grow
```

The plugin picks the archetype, installs the packages in the order that works, writes the game,
gets a screen up in the first minute, then **opens it in a browser and looks at it** —
screenshots it, judges it against a harness, fixes what is wrong, repeats. The only other thing
it may ask you is permission: to build blind when it cannot drive a browser, or to write into a
folder that already has your files in it. Everything else it decides, and says which way it
decided in one line.

It tells you when it is working blind rather than quietly doing it, because a suite that passes
over a black screen is a failure this project has already shipped once.

### What you get

| | |
|---|---|
| **a running game** | a real page on a dev server, yours to keep and to edit. No engine account, no editor, no runtime |
| **no assets to make** | art is procedural and sound is synthesized. Nothing to draw, license, or pack |
| **no sprite sheet to hallucinate** | there is no asset path to invent, because there are no assets. An agent cannot reference an image that was never supposed to exist |
| **the same result twice** | seed + input log → the same pixel, so a fix stays fixed |
| **12 skills, 34 named traps** | the parent that owns `/lattice` and eleven specialists. The traps are failures that compile, run, and produce a plausible-looking wrong game — written down so the agent does not re-discover them on your time |

[`docs/SKILLS.md`](docs/SKILLS.md) is the design: what the flow does, what it must never do, and
what it is allowed to decide for you.

---

## Three games nobody designed

Each was built by a **different vendor's agent**, in an empty directory, from one sentence, with
no access to this repository — it installed `@latticekit/*` from npm like anyone else. The source
is unedited, blemishes included, and two of the three carry a named defect the record states
rather than hides.

| game | agent | the sentence it was given | |
|---|---|---|---|
| **Before the Bell** | Grok | *place stalls and open gates to pull the crowd to your bakery before the market closes* | [play](https://plausible.ventures/g/before-the-bell/) |
| **Chime Path** | Claude | *hang chimes along a mountain path and tune each one, so the wind plays them in order as walkers pass* | [play](https://plausible.ventures/g/chime-path/) |
| **Evenfall Orchard** | Codex | *plant an orchard and each evening choose to harvest or let it grow, and it keeps growing while the tab is closed* | [play](https://plausible.ventures/g/evenfall-orchard/) |

Source and the full provenance — the verbatim prompts, the transcripts, what was verified by
hand, and the one thing that was changed — are in [`from-one-sentence/`](from-one-sentence).

## The gallery

Nineteen worlds: eighteen exhibits and the hero, each one proof of a capability that would
otherwise be a claim. **[See them running →](https://plausible.ventures)**

**Eight of the eighteen were built by agents from the written spec alone** — Codex built Harbor,
Wayfinding, Builder and Orbit; Grok built Idle and Instrument; Claude built Replay and Migration.
Each was given one row of the exhibit table, the standard, and the tools, and was **not** allowed
to read another exhibit's source: the test was whether the specification is followable, not
whether an agent can pattern-match. Seven of the eight passed every row of the looking harness
unaided; the exception was Replay, on legibility, for a text node too small for the check to
measure. Every one of them carries its author's own notes on what the spec failed to say, in its
`README.md`, verbatim — and each says what changed on the way into this repository, because all
eight of them had to invent a bootstrap that `examples/_shared` provides and does not ship. The
three games above are the ones whose source is unedited; an exhibit is not making that claim.

Which is the plain fact about this repository: **it was largely built by agents.** All but a
handful of its commits carry an agent co-author trailer, and the count is deliberately not written
down here — it changes with every push, and a number that goes stale on the next commit is worse
than no number. Run it instead:

```sh
git log --format=%B | grep -c 'Co-Authored-By:'   # agent-co-authored
git rev-list --count HEAD                          # total
```

The eight exhibits and three games above are in the tree so the claim can be checked against
source rather than believed.

---

## Or use the packages directly

Nine of them, published in lockstep. Every one brings only the ones below it in the DAG, and
nothing from outside the kit.

```bash
npm i @latticekit/iso     # brings @latticekit/core, and nothing else
```

This is a whole Lattice program — a surface, a camera, a palette, a loop, and a world drawn
inside it. It is [the file the landing page runs beside its own source](https://plausible.ventures/example/).

```ts
import { createCamera } from '@latticekit/iso';
import { BASE_SLOTS, beginFrame, createCanvas2dSurface, createPalette, endFrame, isoBox } from '@latticekit/draw';
import { browserFrames, createLoop } from '@latticekit/loop';

const surface = createCanvas2dSurface(document.body.appendChild(document.createElement('canvas')));
const camera = createCamera(innerWidth, innerHeight, { zoom: 0.62 }), palette = createPalette(BASE_SLOTS);

createLoop({ clock: { now: () => performance.now() }, frames: browserFrames(), render: (_alpha, t) => {
  const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });   // erase, then paint the sky
  // Back to front is just the loop order in a 2:1 projection, so this city needs no depth sort.
  for (let gy = -7; gy < 7; gy++) for (let gx = -7; gx < 7; gx++) isoBox(pen, gx, gy, 1, 1, { color: 'metal', h: 2 + 5 * Math.sin(t + (gx + gy) * 0.4) ** 2 });
  endFrame(pen);
} }).start();
```

Three things about a Lattice game are the design rather than the API, and they are what
[`docs/GUIDE.md`](docs/GUIDE.md) builds out in the order you will need it:

- **A tap arrives as a tile, never as a pixel.** No game on this kit converts a pointer position
  into a grid cell, because the conversion has to happen through the camera *as it stood when the
  tick opened*, and a game that does it in a handler does it through the camera as it stands now
  — a different tile on any frame where the map was moving.
- **The sorted list is walked forwards, and picked backwards.** There is one sorted list, `iso`
  owns it, and `renderFrame` sorts immediately before handing it over, so no caller ever holds
  one and is tempted to improve it. Partitioning it — all the shadows, then all the bodies — is a
  *stable* reorder that looks harmless and makes a player tap one building and open the one
  behind it.
- **Your entities stay yours.** No registry, no entity system, no scene graph, no component
  store. The kit hands back a permutation over the array you already had.

### The nine packages

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

[`.lattice/kit.json`](.lattice/kit.json) is the same table, machine-readable, with every
package's exports and invariants. [`/api.json`](https://plausible.ventures/api.json) and
[`/llms.txt`](https://plausible.ventures/llms.txt) are the versions an agent reads.

---

## Determinism is checked, not claimed

Every kit says it is deterministic. The claim is only worth something if something breaks when it
stops being true, so here it is, in `packages/loop/test/replay.test.ts`:

```ts ignore
update(dt, tick) {
  x = (x + input + tick) | 0;
  y = (y + rng.int(0, 4)) | 0;
  if (nondeterministic && Math.random() < 0.5) x = (x + 1) | 0;   // ← the experiment
}
```

A session is recorded through a real loop, then replayed against the same game with that one line
armed. With the flip off, `divergedAt` is `-1`; with it on, it is `63` — the first checkpoint,
because 64 coin flips have happened by the time it is compared and the odds of all 64 landing
tails are `2⁻⁶⁴`, about 5.4 × 10⁻²⁰. A suite run once a second since the formation of the Earth
would not have seen it. That is not a flaky test; it is a certain one with the arithmetic written
down beside it. The falsification runs in **both** directions and both are asserted, which is the
part usually skipped: a test that only ever fails proves nothing about the case it is meant to
catch.

`Math.random()`, `Date.now()` and `performance.now()` are banned inside every package's `src/`
and `npm run lint` enforces it. Randomness arrives as a seeded `Rng` the caller owns; time
arrives as a parameter.

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

The rule that the hot path allocates nothing costs every call site an output parameter, and
comparing mean throughput says the rule is wrong:

| operation | ops/sec | max latency |
|---|---:|---:|
| allocating add, result escapes | 50,709,067 | **2.3168 ms** |
| out-parameter add, identical work | 40,714,999 | **0.0274 ms** |

Allocating wins the mean by about 25%, and that is not measurement error — V8's nursery is a bump
allocator and an object that dies in the same iteration is nearly free. **Look at the second
column.** The allocating form's worst observed call is 85× slower: that is the garbage collector,
showing up exactly where a mean cannot see it, and a 2.3 ms pause inside an 8 ms budget is not a
slow frame, it is a dropped one. A game protects its frame-time tail, not its mean.

[`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) has the rest, including the sprite bitmap cache that
was measured and then not built — a perfect cache, 100% hits, saves 2.10 ms of an 8 ms budget and
buys four new ways to render something stale — and the row that says at what scale it reopens.

---

## Is this ready?

Today is **v0.1.1**, all nine packages, on npm. The honest answer has three parts: what is
stable, what is not, and what will break before `1.0`.

| this | status | why you can check it |
|---|---|---|
| the 527 exported symbols | **stable in shape** | `npm run lint` fails the build if a package exports a name `.lattice/kit.json` does not list, so the reference cannot drift from the code |
| behavior of everything exported | **tested** | 2,648 tests across 100 files. `npm run cover` reports 99.82% of statements and 100% of functions against a 90% floor. Coverage is not part of the gate, so run it rather than trusting this line |
| the layering and the determinism rule | **enforced** | the clock and the random source are lint errors inside a package. CI also runs the whole suite twice in separate processes and diffs the recorded streams, because a stray `Date.now()` or a `Set` iteration order is what a single run cannot catch |
| the size of each package | **budgeted** | 83.02 kB gzipped for all nine. 12 kB per package by default, with `draw` at 12.5 and `input` at 16, each override argued in the manifest rather than raised quietly |
| the `/lattice` plugin | **shipped** | it installs and runs in Claude Code, Codex and Grok. The three games above came out of it |
| the gallery | **complete** | eighteen exhibits and the hero, all nineteen built and running on the site |
| function *signatures* | **may change** | the first publish was 2026-08-18 and nobody outside this repository has depended on them yet. That is the whole reason the version starts with a zero |
| the API reference | **generated, not hand-kept** | [`/reference/`](https://plausible.ventures/reference/) is read out of the packages' own `.d.ts` files at build time |
| a browser test matrix | **absent** | CI runs the suite in Node on 20.19, 22 and 24. The browser floor below is read off the compiler target and the built output, not off a test run |

### Versioning, and what a breaking change means here

Semver, with the pre-1.0 rule stated rather than assumed: **a minor bump may break source
compatibility, a patch never does.** The nine packages version and publish **in lockstep** — one
number for the whole kit — because they are a DAG that only ever imports along its own layering,
and a visitor who installs `draw` at one version and `iso` at another has found a way to be wrong
that costs nothing to close.

Two kinds of breakage matter here and only one of them is about code:

- **Source breaks** — a renamed symbol, a changed signature. Loud, immediate, and your compiler
  finds every one of them. These are what the version number is about.
- **Artifact breaks** — a change that makes something already *written down* invalid. A save file,
  a replay log, a shareable seed. These are silent, and they are the ones this kit spends its rules
  on: `persist` refuses a version mismatch by name instead of guessing, `stepMs` is a compatibility
  constant because it appears in every recorded session, and [`docs/SEAMS.md`](docs/SEAMS.md) is
  the list of every place the two are connected. A change of this kind ships with a migration or
  it does not ship.

### What it needs from a browser

It is **Canvas2D**, and that is the whole rendering story: no WebGL, no WebGPU, no WebAssembly, no
workers, and no `OffscreenCanvas` — `draw`'s backend uses a detached `<canvas>` deliberately,
because `OffscreenCanvas` has no `toDataURL`. Beyond the canvas it asks for `requestAnimationFrame`,
`ResizeObserver` and Pointer Events with `setPointerCapture`. `@latticekit/persist` uses
`localStorage` through a swappable adapter, and `@latticekit/audio` uses `AudioContext`, which on
every browser needs a user gesture before it makes a sound. Neither is required by anything else.

**Safari and Firefox are both in.** The packages compile to ES2022, and the newest syntax actually
present in the built output is private class fields and `Array.prototype.at`, which puts the floor
at roughly **Chrome 92, Edge 92, Firefox 90 and Safari 15.4** — spring 2022. Older targets transpile
the packages like any other dependency; they ship as ES modules and nothing in them is pre-minified.

---

## Why not Phaser, Pixi or Three

Because each of them is better than this at what it is for, and none of them is for this.

**Three** is a 3D renderer. An isometric game is a 2D projection with a sorting rule, and adopting a
scene graph, a camera stack and a material system to obtain a coordinate transform is a large
dependency for a small idea. **Pixi** is a very fast 2D renderer and would draw a Lattice game
beautifully — it is also a renderer and nothing else, so the projection, the depth sort, the
pathfinding, the seeded noise, the save migrations and the sound are still yours to write, and that
is most of what is in these nine packages. **Phaser** is the closest comparison and the fairest one:
a complete engine with scenes, physics, input, audio and a loader, a decade of documentation that
every agent has already read, and a community that has answered your question. *If you want a game
engine, use Phaser.*

Three things here are not on that list. It is **deterministic by rule** rather than by discipline,
which is what makes a replay land on the same pixel and a seed a link you can send. It has **no
asset pipeline at all**, so there is nothing to load, nothing to license, nothing to pack, and a
recolor is a runtime value. And it is **written to be handed to an agent**: the manifest, the
invariants, the cross-package contracts and the traps that cost this project real time are all
machine-readable at [`/api.json`](https://plausible.ventures/api.json), which is a thing you
can check in ten seconds rather than a claim.

If none of those three is worth anything to you, the honest recommendation is Phaser.

---

## Working on it

```bash
git clone https://github.com/C-Aniruddh/lattice
cd lattice
npm install
npm run verify     # build, lint, docs, skills, tests, gallery, looking. nothing lands red
npm run dev        # the demo game, on :5173
npm run size       # per-package gzipped size against the budget
```

| if you want | read |
|---|---|
| to build a game with it | **[`docs/GUIDE.md`](docs/GUIDE.md)** — start to finish, in order |
| a whole game, wired, at real scale | [`examples/demo/src/`](examples/demo/src) |
| to know which package owns a thing | [`.lattice/kit.json`](.lattice/kit.json), then that package's `README.md` |
| to work *on* it, as a human or an agent | **[`AGENTS.md`](AGENTS.md)** — the eleven non-negotiables, and they are not a style guide |
| the numbers behind any performance claim | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| why two packages split a responsibility the way they did | [`docs/SEAMS.md`](docs/SEAMS.md) |
| to send a pull request | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| what changed in a release | [`CHANGELOG.md`](CHANGELOG.md) |
| to report something that should not be public | [`SECURITY.md`](SECURITY.md) |

---

## License

MIT. See [`LICENSE`](LICENSE).
