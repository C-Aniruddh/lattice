# Changelog

All notable changes to Lattice are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) with the pre-1.0 rule stated rather
than assumed: **a minor bump may break source compatibility, a patch never does.**

The nine `@latticekit/*` packages version and publish **in lockstep** — one number for the whole
kit — so an entry here is an entry for all nine, and a version that appears in one package's
`package.json` appears in every other's. The reasoning is in `README.md` § Versioning.

## [Unreleased]

Nothing has landed in `packages/` since `0.1.1`.

## [0.1.1] — 2026-08-19

The terrain seam. A tap on sloped ground had been resolving on the plane `z = 0` since the
beginning, which on a hillside is a real tile several tiles uphill of the finger — plausible
enough that nothing downstream reports it. A shipped exhibit measured the error at **281 px and
fourteen tiles**.

`iso` and `input` were published first, alone, on the reasoning that publishing seven unchanged
packages to keep version numbers tidy would misrepresent what shipped. That was wrong, and it was
corrected the same day: lockstep is not tidiness for nine packages that must compose, it is the
compatibility answer, and one number is cheaper than making a user reason about nine. All nine
now read `0.1.1`.

### Added

- **`iso`: `worldToTileOnHeights`** — the camera-free half of terrain picking, marching the
  heightfield rather than intersecting the ground plane. It exists as a separate export because
  its most important caller, `input`, resolves against the transform it froze when the tick
  opened and has no honest live camera to hand in.
- **`iso`: `heightAt`, `slopeAt`, `unitsToPx`, `pxToUnits`** and the `HeightField` type.
- **`iso`: `PathOptions.minWeight`** — telling A\* the cheapest ground exists, instead of paying
  Dijkstra's price on every weighted map. 6.8× on a uniform-weighted map.
- **`input`: the terrain declaration.** A game with elevation passes
  `terrain: { field, maxHeightPx }`; a game without it passes `terrain: 'flat'` and says so.
  With it come **`onGround`**, **`setTerrain`**, and a terrain-aware `hoverTile`.

### Changed

- **`input` says when it was never told about the ground.** A system with no `terrain` still
  answers on `z = 0`, and now raises the `flat-ground-pick` diagnostic once. Silence was the
  previous default and it is the wrong one: a plausible wrong tile is worse than an obvious one.
  A caller who declares nothing gets the coordinates it always got, plus the diagnostic.
- **`input`'s gzip budget moves from 12 kB to 16 kB.** Both named alternatives were measured
  first — the overlay message saves 0.248 kB against a 0.39 kB overrun, and deleting the
  known-code table would have made `CompiledActions.bindings` print a dead binding to the player
  as a working shortcut. The override and its argument are in `.lattice/kit.json`.
- **`core`: `Pool` errors name what the caller wrote.** `new Pool({ initial })` reported a
  `pool.preallocate` failure for a method the caller had never heard of. `preallocate` takes an
  optional label, and the default is exactly the message it always was.
- **`iso`: the camera-space pick** became the composition it always described in prose. No
  behavior change.

### Fixed

- **`core`: `Rng.float` could return `Infinity` or `NaN` from two finite bounds.** The guard
  checked each bound and not their difference, so `float(-Number.MAX_VALUE, Number.MAX_VALUE)`
  passed it and overflowed on every draw. That is the worst value this function could produce:
  `JSON.stringify` writes both as `null`, so the number vanishes from a save with the checksum
  still matching. The span is now checked, and the error says how to fix it.
- **The Tier B linter could not see `a ** b` at all**, which left a live undeclared
  exponentiation in `audio`'s `detuned` — its `@tier-b` marker sat six lines above a five-line
  window. The marker is now at the call site, because a declaration a machine cannot see is a
  comment rather than a declaration.
- **`sim`'s heap test was wrong in both directions.** It failed on Node 22 while passing on
  20.19 and 24 in the same CI run, and it passed three runs out of three with a real per-call
  allocation injected into `integrate`. It is a source check now, as `iso` and `draw` already
  settled on. Forcing a collection would have made the instrument stable by making it blind.
- **`core`: `fbm2`'s bounds test** timed out under full-suite load at 2.4 million calls against
  an inherited five-second default. The sample count was not cut, because that would have made
  it green by making it weaker.
- **Exhibits**: ground declared where it was missing, and text no longer hidden behind alpha.

### In the repository, not the registry

Not package changes, and recorded here because they landed in the same window and they are what
a reader is most likely to be looking for:

- **The gallery reached eighteen exhibits and the hero.** Eight of the eighteen were built by
  three vendors' agents from `docs/GALLERY.md` alone — Codex: Harbor, Wayfinding, Builder,
  Orbit; Grok: Idle, Instrument; Claude: Replay, Migration — none allowed to read another
  exhibit's source. Seven of the eight passed every row of the looking harness unaided.
- **`from-one-sentence/`**: three games, each built by a different vendor's agent in an empty
  directory from a single sentence with no access to this repository, source unedited and
  their defects named rather than fixed.
- **The four cross-package seams got contract tests** for the first time, sited above the
  packages, and one of them was already broken.
- **The landing page went live** at [lattice.plausible.ventures](https://lattice.plausible.ventures),
  with `/llms.txt` and `/api.json` for agents.

## [0.1.0] — 2026-08-18

**First publish.** All nine packages — `core`, `iso`, `draw`, `loop`, `input`, `audio`,
`persist`, `sim`, `ui` — to npm under the `@latticekit` scope, with zero dependencies outside
the kit and zero asset files in any of them.

The scope is `@latticekit` rather than `@lattice`, which belongs to somebody else.

Shipped alongside, in the repository rather than the registry: **the `/lattice` plugin and
twelve skills** — the parent that owns the command plus eleven specialists, and the named traps,
which are the failures that compile, run, and produce a plausible-looking wrong game.

[Unreleased]: https://github.com/C-Aniruddh/lattice/commits/main
[0.1.1]: https://www.npmjs.com/package/@latticekit/core/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/@latticekit/core/v/0.1.0
