# Is this ready? — removed from the landing page, for the README

**This file is not published and is not read by the site build.** It is the verbatim content of
the landing page's `#ready` section, which `docs/GALLERY.md`'s copy doctrine removed from the page:

> **"Is this ready?"** — Legitimate content, wrong venue. Stability tables, versioning policy and
> browser floors are what a README is *for*; on a landing page they are a page-length apology.

The content was not deleted, because none of it is wrong — it is in the wrong document. **Moving it
into `README.md` is outstanding work that the page's author does not own** (`README.md` is outside
`site/`), and it is routed in that author's report. The machine-readable equivalents stay published
at `/api.json` (`readiness`, `browsers`, `alternatives`) and `/llms.txt`, because the doctrine is
about what a human visitor is made to read, not about what an agent can look up.

Figures below were current at `9ccacae`, 2026-08-17. Anything counted should be re-counted when
this is moved, rather than copied forward.

---

## Is this ready?

Not for everything, and the honest answer has three parts: what is stable, what is not, and what
will break before `1.0`. Today is **v0.1.0**, and nothing has been published to npm yet.

| this | status | why you can check it |
|---|---|---|
| the 524 exported symbols | **stable in shape** | `npm run lint` fails the build if a package exports a name `.lattice/kit.json` does not list, so the API reference cannot drift from the code. |
| behavior of everything exported | **tested** | 2,599 tests across 97 files, 90% statements per package and 100% on everything in `core`, enforced rather than aspired to. |
| the layering and the determinism rule | **enforced** | `Math.random()`, `Date.now()` and `performance.now()` are lint errors inside a package. CI also runs the whole suite twice and diffs the results. |
| the size of each package | **budgeted** | a gzip budget per package, 12 kB by default, with every override written down and argued for in the manifest. |
| function *signatures* | **may change** | nothing has shipped to a registry, so nothing has been used by anybody outside this repository yet. That is the whole reason the version starts with a zero. |
| the `/lattice` plugin | **specified, not shipped** | the flow is `docs/SKILLS.md`, which is a specification and says so. Read it as a promise about a design, not about a build. |
| the gallery | **10 of 18** | the brief specifies eighteen exhibits and one hero. The eight that are not built are named below, and in `/llms.txt` and `/api.json`. |
| the API reference | **names, not signatures** | it answers "which package, which symbol" and never "how do I call it", because the manifest carries no types. Generating from the `.d.ts` files is a tool this project has not written. |

## Versioning, and what a breaking change means here

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
  constant because it appears in every recorded session, and `docs/SEAMS.md` is the list of every
  place the two are connected. A change of this kind ships with a migration or it does not ship.

## What it needs from a browser

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

> That floor is read off the built output and the compiler target, *not* off a browser test matrix.
> CI runs the suite in Node on 20.19, 22 and 24; there is no browser matrix yet. So the claim is
> "it requires nothing those browsers lack", which is checkable, rather than "it is tested there
> every commit", which would not be true.

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

Three things here are not on that list. It is **deterministic by rule** rather than by discipline —
the clock and the random source are banned inside every package and the linter fails the build over
them — which is what makes a replay land on the same pixel and a seed a link you can send. It has
**no asset pipeline at all**, because a solid is one color with its faces derived and a sound is
synthesized from a declaration, so there is nothing to load, nothing to license, nothing to pack,
and a recolor is a runtime value. And it is **written to be handed to an agent**: the manifest, the
invariants, the cross-package contracts and the traps that cost this project real time are all
machine-readable at `/api.json`, which is a thing you can check in ten seconds rather than a claim.

If none of those three is worth anything to you, the honest recommendation is Phaser.

---

## The eight exhibits that are specified and not built

Moved here from the landing page's `/gallery` section, where they were printed by name under ten
worlds that were running. Three places on that page were separately telling a first-time visitor
what had **not** been built — *"Eighteen specified. Ten built."* as the gallery's heading, this
list under the grid, and *"The plugin is not built yet"* as the closing sentence of the section
above it — which is the pattern `docs/GALLERY.md` already deleted once as *"a page-length
apology"*, regrown in three new places. No competitor in the comparison set scores itself as 44%
incomplete on its own front page.

The list is not deleted, because none of it is wrong and a gallery that quietly ships fewer than
it promised is the one thing a gallery must not do. It is *addressed to the reader who is auditing
the project* rather than to the one who arrived four seconds ago, and it stays published in
`/llms.txt` and `/api.json` (`gallery.specifiedNotBuilt`), which is where an agent auditing the
kit will look for it. The source of truth is `site/data/exhibits.json` → `pending`.

| exhibit | what it is for |
|---|---|
| **Harbor** | tall thin objects and depth sorting — masts, cranes, a jetty over water |
| **Orbit** | no ground at all: platforms, stars, a cold palette |
| **Wayfinding** | a flow field re-routing a moving crowd the instant the map changes |
| **Builder** | placement: footprints, a ghost, validity, and the tap-to-tile seam |
| **Idle** | cost curves and buy-max in closed form, then fourteen hours of offline in one frame |
| **Replay** | record, scrub, and prove it: the same seed and log land on the same pixel |
| **Migration** | a v1 save opened by a v5 build, stepping the chain in front of you |
| **Instrument** | sound with no files — a board that shows the synthesis as it plays |

## The `/lattice` plugin, and where its status is stated

The plugin and its skills are **the product**; the nine libraries are what make the agent driving
them succeed. It is specified in `docs/SKILLS.md` and it is **not shipped**.

That is not hidden and must not be. It is stated **once** on the landing page, as a factual line
inside the how-it-works section and immediately beside what *is* shipped — `/llms.txt`,
`/api.json` and `/kit.json`, which an agent can be pointed at today. What was removed is its
position: it used to be the **closing sentence of the agent section**, which is the last thing a
reader carried out of the page's own differentiator, and the five-step flow above it walked
through a build sequence no visitor could run. The flow is `docs/SKILLS.md`'s content and it is
whole there.

The rule this follows: **state a status once, factually, and never as a section's closing word.**

---

## What the landing page kept of it

One sentence, in the note under the size table in `/what`: *"If you want a game engine — scenes,
physics, a loader, a decade of documentation every agent has already read — use Phaser."* That is
the strongest line in the whole section and it survives at one line, which is what the doctrine asks
of a paragraph that cannot be replaced by something already running.
