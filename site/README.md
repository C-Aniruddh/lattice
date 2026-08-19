# The landing page

**The design rule, from `docs/GALLERY.md`: nothing on this page is a picture of Lattice.**
Everything on it is Lattice, running — and the page never says so, which is the *other* rule.

**What it sells, since the reframe: the AI tool, with the kit underneath.** The product is the
`/lattice` plugin and its skills; the nine libraries are the *reason an agent driving them
succeeds*. So zero assets is not a bundle-size boast on this page — it is the reason the output is
not broken, because there is no sprite sheet, no asset path and no physics constant for an agent to
invent. Every fact the old page led with is still here and every one of them is now evidence for
that argument rather than a spec sheet.

The hero is a **split**: the words in one column, `examples/demo` live and playable in the other,
full viewport, with no type over the world at all. The eighteen gallery tiles are the eighteen
exhibits, live, at their own viewports, scaled into a grid, each captioned with the ordinary
sentence it would be asked for and tagged with the capability it proves — and the eight that an
outside agent built carry a `Built by <vendor>` mark opposite that tag. Above the gallery, three
more live worlds that are **not** exhibits: the games in `from-one-sentence/`, each under the exact
sentence that produced it. The backdrop is drawn with `@latticekit/draw`,
the page's color scheme is `lerpPalette(DUSK, NIGHT, scrollProgress)`, and no frame cost is printed
anywhere a visitor can see one — see *The frame cost* below.

**The order**, and it is the argument in sequence: masthead with a dated announcement chip → the
hero → the proof strip → `/one-sentence`, where a typed sentence sits over the game it produced →
`/gallery`, which is the centre → `/built`, which is who built the eight marked tiles and how →
`/why`, which is why the agent gets it right → `/what` → `/start` → a closing band → the footer. The API reference is a route of its own at
`/reference/`: at 2,255 px it was the second-largest object on a page a newcomer has four seconds
for, and it is content for somebody who has already adopted this. It is ten documents now: an
index at `/reference/` and one per package at `/reference/<pkg>/`.

This directory is **not part of the kit**, is **not a workspace member**, and nothing in it may be
imported by a package or by an exhibit. It reads `packages/*/dist` and `examples/*` and writes only
to `site/`.

---

## Build and look at it

```bash
npm run build                                  # at the repo root, first — the page bundles dist/
node site/tools/build.mjs                      # typecheck, generate, page, exhibits, the three games
npx vite preview --config site/vite.config.ts  # http://localhost:5171
```

`node site/tools/build.mjs crowd clay` rebuilds only those exhibits and skips clearing `dist/`.

There is also `npx vite --config site/vite.config.ts` for editing the page itself, but the gallery
is served from `dist/x/` and only exists after a build, so the tiles are empty in dev.

## What is generated and what is written by hand

| | |
|---|---|
| `index.html`, `reference/**/index.html`, `public/llms.txt`, `public/api.json`, `public/kit.json` | **generated** by `tools/build-page.mjs`. Do not edit; your change is gone on the next build |
| `src/page.css`, `src/page.ts` | the design and the behavior |
| `src/reference.ts` | the reference's filter and its rail. Loaded only by `/reference/**` |
| `tools/api-model.mjs` | every public symbol read out of `packages/*/dist/**/*.d.ts`, and the cross-check against `kit.json` |
| `tools/doc-html.mjs` | the doc comments' markdown — tables, fenced code, `{@link}` — rendered |
| `src/meter.ts` | the one guard every live frame figure on the page is printed through |
| `data/measured.json` | every number the page prints, each with the command that produced it |
| `data/exhibits.json` | the gallery, as data. Adding an exhibit is one row here and nothing else; `by` on a row is the vendor whose agent built it, and it is the only thing the tile mark says |
| `data/one-sentence.json` | the three games in `from-one-sentence/`, their verbatim prompts, and the defects left in them. Not exhibits, not in the gallery manifest, and served from `/g/<name>/` rather than `/x/<name>/` |
| `example/hello.ts` | the worked example the page prints, typechecked on every build |

**The API reference is generated from the built type declarations** — `packages/*/dist/**/*.d.ts`,
which `npm run build` emits — so every symbol carries its real signature, its parameters and the
doc comment written above it. It used to come out of `.lattice/kit.json`, which carries names and
no types at all, and so could answer *"which package is `pathSample` in"* and never *"how do I call
it"*.

The manifest is still the check rather than the source. `tools/api-model.mjs` compares the exports
the compiler found against `kit.json`'s list, **per package and in both directions**, and throws —
failing the page's build — if they disagree. That is strictly stronger than the `npm run lint` rule
it replaces here, which cannot see a manifest entry the built package no longer exports. Either
way, a reference typed out beside the thing it describes drifts from it inside a week and this one
cannot.

Extraction is TypeScript's own compiler API, which is already a root devDependency and is the
program that emitted these files; the alternatives were a hand-rolled `.d.ts` reader, which is a
TypeScript parser with a smaller test suite, and a generator like typedoc, which brings a
dependency and a second theme to argue with. **The kit's own zero-dependency rule is untouched:
nothing here is installed by anything under `packages/`.**

## The frame cost

**No frame figure appears anywhere a visitor sees**, and both halves of that rule are load-bearing
(`docs/GALLERY.md` § *the frame cost is evidence in development and a liability in a shop window*).
An exhibit opened directly still prints its worst frame, because that figure is a development gate.
An exhibit *embedded here* prints none: `Scene` appends **`?cost=0`** to the `src` of every exhibit
it mounts, hero included, and `examples/_shared`'s `bootstrap` answers with `boot.showCost`.

It is a URL parameter and **not** a stylesheet. Nothing in `src/page.css` may target an exhibit's
cost node: eleven selectors reaching into eleven HUDs rot the first time any one of them is
renamed, silently, and in the direction of printing the figure again.

**Nothing on the page may state a number that is not in `data/measured.json` or read live off the
running kit.** If you want a figure that does not exist, measure it and add it with its command.

## The copy doctrine, and the three things it took off the page

`docs/GALLERY.md` § *"if it is on screen doing the thing, delete the sentence about it"* is the
brief this page is written to. **Every sentence that describes something visible is deleted.** What
survives is what a visitor cannot see: how to install it, what it costs, what it does not do.

| gone | where it went |
|---|---|
| *"Nothing here is a screenshot."*, as a heading and as a claim | nowhere. Eleven worlds moving say it, and announcing that a thing is real is what an unreal thing does |
| the **"Is this ready?"** section, and its `Ready?` nav item | `data/readiness-for-readme.md`, verbatim, **for somebody to move into the repository README** — that move is outstanding. The machine-readable `readiness`, `browsers` and `alternatives` keys are untouched in `/api.json` and `/llms.txt`, because the doctrine is about what a human is made to read |
| the **test count** and the **public-symbol count** in the proof strip | `/api.json` and `/llms.txt` only. Nobody adopts a library for its test count; working is the assumed baseline |
| **"Eighteen specified. Ten built."**, the named list of eight unbuilt exhibits, and **"The plugin is not built yet"** as a section's closing sentence | nowhere: the gallery is complete, so there is nothing left to score. The heading is **"Eighteen worlds, running right now."**, `pending` in the manifest is empty and every sentence the build printed from it now prints nothing. The plugin's status is still stated **once**, factually, in `/what`, beside the three files that *are* shipped |
| the **five-step `/lattice` flow** | `docs/SKILLS.md`, which is where it already was. It walked a build sequence no visitor can run, one section under a hero that must not imply the plugin works |
| the **`npm i` line in the hero** | the closing band, as a tabbed terminal. The thing a person installs is the plugin; a five-package npm command is not the hero's business |

**The strip leads with what the reader is spared, not with what the kit weighs.** `81.72 kB` was
first, and a bundle size is a figure a developer choosing a rendering library weighs — which is not
who this page is for. `asset files: 0` is now first: the same measurement pointed at the thing that
matters, which is that there is nothing to draw, nothing to license and no path to get wrong. The
first two cells are **drawn as one claim** (`data-pair` in the markup) because `81.72 kB` alone
invites *"so what"* and next to `0 asset files` it says *the whole game is code*.

The rest is what a visitor is deciding on: what it drags in, how many libraries there are, and the
two that are the product — the **skills** and the **traps written down**. No cell measures the
reader's machine any more; every one is a stored measurement with the command that produced it, and
each keeps its provenance popover.

## The gallery is the argument, not an exhibit of it

Each tile carries two lines the exhibit's own panel subtitle never gave it: a **capability tag**
(`EROSION`, `LIGHT POOLS`, `ELEVATION PICKING`, `CLOSED-FORM CROWDS`, …) and the **one sentence
somebody would ask for that world in**, in ordinary voice with no jargon in it. Both are rows in
`data/exhibits.json`; adding an exhibit is still one row and nothing else.

The tags scanned down the grid **are the feature list**, which is why this page never writes one —
and every entry in it is standing over the thing it names, running. The prompt is set larger than
the exhibit's name on purpose: a visitor is not choosing between eighteen exhibits, they are
deciding whether a sentence is enough.

**Eight tiles carry a second, quieter mark opposite the tag: `Built by Codex`, `Built by Grok`,
`Built by Claude`.** Those eight were built from `docs/GALLERY.md` alone by agents that were not
allowed to read another exhibit's source, and `/built` is where the method, the harness result and
what those agents could not answer are stated. A tile with **no** mark claims nothing more than
what is true of it: it was built in this repository with a person in the loop. If the distinction
cannot be made accurately, it must not be made at all — which is why the unmarked tiles say
nothing rather than carrying a second badge.

**There is deliberately no prompt input box.** Bolt and Lovable both take a sentence in the hero and
wall you at a sign-in with nothing rendered; an input that cannot produce a game is worse than no
input, and it is the exact vaporware signal this page cannot afford while the plugin is arriving.

## Color and type

- **The ground is the page's own palette slot, not `draw`'s `night`.** `night` is a blue, because
  behind a valley that is what night is; behind a document it made the whole page navy. `page.ts`
  adds `page` and `panel` to both stop sets with `extendStops` — the mechanism `packages/draw`
  documents for exactly this — so they cross-fade on the same `lerpPalette` call, in the same
  quantization, as every kit slot. `#181410` at the dusk end, `#0c0a08` at midnight. Nothing
  reaches into `packages/`.
- **Re-measure the two ink ratios if you touch the ground.** Against `#181410`, the lightest ground
  the cycle reaches and therefore the worst case: `--dimmer` **5.06:1**, `--dim` **6.79:1**,
  `--accent` **8.14:1**, `--paper` 15.81:1. Those are floors, and a ground change is exactly the
  edit that lets a legibility fix regress in silence. Re-measured with the newer surfaces on top of
  them, every one is over 4.5:1: the tile tag 7.90, the tile prompt 13.11, a tile's name and fact
  6.60, the announcement chip 5.87–9.59, the terminal's tabs 7.24 and its command 13.60, the
  closing band 11.93–15.20.
- **`/reference/**` is pinned at the midnight end.** The cycle's lightest ground is the top of a
  page, the landing page hides its top behind a hero, and the reference opened on `#181410` and
  stayed there — which is what *"it doesn't use the black theme"* was describing. `data-ground=
  "night"` in the markup, read once by `page.ts`, no scroll binding: a document nobody reads while
  scrolling past should not change color while a signature is being read. Re-measured against
  `#0c0a08`: `--dimmer` **5.46:1**, `--dim` **7.33:1**, the doc paragraph 13.76, a signature 12.59,
  a kind chip and inline code 7.82, the rail 7.33, `↳ source` 5.46. Every one is over the floors
  above.
- **A `--lattice-*` slot is a surface color and must never set type.** `--lattice-glass` is
  `#c79a76` at dusk and `#3f5f74` at midnight, so every string literal in a code block and every
  kind chip on the reference measured **2.92:1** there. `--tint` is the dusk value as a constant,
  9.7:1 on the reference's ground and identical to what the landing page already showed.
- **The drag pill's backing is a contrast floor, not a taste.** It sits over a live world whose
  brightest state is Lamp Road's noon sky (`#79c2ee`). At `rgb(8 5 3 / 66%)` the accent on *Drag*
  measured **4.46:1** against what showed through — under the floor. It is 82% and 6.78:1.
- **One display face, seven letters.** The wordmark is Fraunces 600, self-hosted, its `@font-face`
  restricted to `U+0041-005A, U+0061-007A` so it cannot leak into a heading. `font-optical-sizing:
  auto` is why it is a variable face rather than a static cut. Everything else on the page is IBM
  Plex and stays that way.

## From one sentence, which is not the gallery

`from-one-sentence/` holds three games — `before-the-bell`, `chime-path`, `evenfall-orchard` — each
built by a different vendor's agent **in an empty directory, from one sentence, with no access to
this repository**. They are built into `dist/g/<name>/` by step 5 of `tools/build.mjs`, from their
own directories, so each resolves `@latticekit/*` through its own `node_modules` — which its
lockfile pins to the **registry tarballs**, not to `packages/*`. That resolution is the artifact.
Do not add them to the workspace and do not convert their dependencies; `from-one-sentence/README.md`
§ *Not npm workspace members* is why.

Three rules for this section, and each of them is the section:

- **`/g/` and not `/x/`.** A URL a visitor can read should not call an unedited agent's game an
  exhibit. `/x/` is the gallery and is bound by `docs/GALLERY.md`; `/g/` is a record of what one
  sentence produced.
- **The prompt is printed complete.** Never trimmed to fit a column. An edited prompt makes the
  world under it worth nothing.
- **The word *unedited* has to stay true.** Two of the three ship a real, measured defect — a
  near-black phase, HUD text under the contrast floor — and the page names both rather than
  choosing a kinder frame. A page that shows unedited output and says so is believed.

They are `data-unmanaged` scenes: they call nothing from `examples/_shared`, so this page cannot
reach their loops. That costs them the preload slot — they are running or a held frame of their own
last paint, never *mounted and stopped* — and it means `?cost=0` is not sent to them, which is
right, because none of them prints a frame figure at all. That was checked rather than assumed.

## The rules this page is built against

- **Fast on a phone, and never at the expense of something on screen.** At most two scene loops
  run at once, one below 900 px of viewport, across all twenty-three live worlds on the page — the hero, eighteen tiles, three games and the ten-line example. A tile off screen is `loop.stop()`ed, not throttled.
  Both policies sort on **distance from the viewport**, and the first rule beats the budget:
  *nothing intersecting the viewport is ever evicted.* Whatever is left is spent one screen ahead.
  An evicted tile keeps its own last painted frame rather than reverting to the placeholder, so
  the second look at the gallery is never worse than the first. **How to check it by hand:** scroll
  past the gallery, scroll back, wait ten seconds, and confirm every tile intersecting the viewport
  has an `iframe` child. It did not, before — two fully visible tiles sat blank while a tile a
  pixel below the fold kept the last slot, permanently.
- **Honest without JavaScript.** An inline script stamps `.js` on `<html>`; everything that would
  be a live scene, a live number or an instruction to touch one is hidden by `html:not(.js)`. What
  remains is the writing, the figures and the complete reference. There is no fallback image,
  because there is nothing to make a fallback of.
- **Reduced motion and `saveData` are obeyed.** Neither the hero nor any tile animates on its own;
  each is built, painted once, and waits to be asked.
- **Every live figure goes through `src/meter.ts`, and nowhere else.** The worst figure is
  `worstGapMs` and never `worstFrameMs`. Four guards, all in one place because the page used to
  apply them in one widget and print bare numbers everywhere else: an **em dash** in a background
  tab (0.0 ms means `requestAnimationFrame` stopped, not that anything got faster) — the verdict is
  called `backgrounded` in the code and **the word `hidden` is never printed**, because a state name
  in a figure's slot reads as an unfilled template, and every meter on the page reaches that branch
  in the same instant, so it appeared fourteen times at once; `paused` for a
  stopped loop, whose last figure would otherwise sit there for the visit; `warming up` for a
  loop's first three seconds; and `measuring` rather than any worst *gap* under a millisecond,
  which is a loop that has not painted twice and not a fast one. A figure whose rolling window
  still contains a mount is printed with `· incl. mount` rather than as a steady state.
- **The hero's type is never over the world.** It was, on a comment in this repository claiming the
  top-left sky of Lamp Road is "the darkest, emptiest region of the frame at every hour". Measured,
  it is not: at the day end of the 73-second cycle the sky is `#79c2ee` and the ground `#57ab45`,
  which put `--paper` at **1.65:1** and **2.42:1**, and a pixel probe of the left half of the frame
  read mean luminance 129.5 (σ 37.9) in the top-left corner against 131.5 (σ 49.9) where the `<h1>`
  actually sat — two units apart, so there is no darker corner and no emptier one. Recomposing the
  shot is the better fix and it is **not available from here**: Lamp Road frames itself with
  `camera.fitBounds` in `examples/demo/src/main.ts`, and no `?seed=` reachable from this page
  changes the composition rule. The split hero retires the question instead of answering it — no
  scrim, no gradient, no card over a live scene.
- **The exhibits are untouched.** The page reads them, scales them, stops their loops and reads
  their canvases through the `__latticeBoot` handle and the same-origin document that
  `examples/_shared/src/bootstrap.ts` already gives it. No file under `examples/` or `packages/` is
  modified, and no exhibit knows this page exists. **The corollary is a limit:** an exhibit's own
  HUD is its own, so where a cost row inside a frame prints an unqualified number, the fix is in
  `examples/`, not here. The page states its own figure beside it and says which is which.

## For an agent arriving here

- `/llms.txt` — the whole kit as plain text: the eleven rules, every package with its entry
  points and invariants, every exhibit with its source path and one measured number, the traps
  that cost this project real time, and a program that compiles.
- `/api.json` — the same as JSON, plus the measured figures and the command behind each.
- `/kit.json` — the repository's own manifest, verbatim.
