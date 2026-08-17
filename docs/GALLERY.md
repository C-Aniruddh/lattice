# The gallery

Lattice does not ship one demo. It ships **seventeen small examples**, shown on a landing page,
each of which a visitor can understand in one to two minutes — **and one hero**, which is the
page's playable header and is [named and bounded below](#the-one-hero-and-the-one-exemption).

That is a deliberate choice over a single flagship game, for three reasons:

- **A kit is judged by range, not by depth.** One base-builder proves the kit can build that
  base-builder. Twelve exhibits across different layouts, palettes and mechanics prove it can
  build things nobody has designed yet, which is the actual claim.
- **Small exhibits get finished and stay beautiful.** A full game accretes systems until the
  art stops being the priority, which is precisely what happened to the first attempt here —
  it reached 1,450 lines and a near-black opening frame. The hero is the single place that risk is
  taken deliberately, and rule 1 still binds it — which is the whole difference between a flagship
  and a header.
- **They are the documentation people actually use.** Nobody reads an API reference to find
  out how a thing feels. They open the example nearest what they want and start deleting.

**Each exhibit is inspiration and a starting point, not a product.** No endings, no meta
progression, no settings screens. If it is not visible in the first ninety seconds, it does
not belong in an exhibit.

---

## What makes an exhibit good

1. **The first frame is the pitch.** A visitor decides in about a second. It must be
   saturated, framed so the world fills the viewport, and immediately legible — you can see
   what the thing is and what you would touch.
2. **One idea, shown well.** Each exhibit exists to demonstrate *one* capability. If you
   cannot say which in a sentence, it is two exhibits or none.
3. **Something moves before the visitor does anything.** A static first frame reads as a
   screenshot of a game rather than a game.
4. **Under 200 lines of *logic*. Art is not counted.** This rule used to cap an exhibit's whole
   line count at 250, and it was measuring the wrong thing — art is precisely what the gallery
   exists to encourage, and a cap that a beautiful exhibit cannot meet is either ignored or met
   by making exhibits uglier. The number did not go up; it moved off the count that includes art
   and onto the count that does not. The classification and the one command that checks it are
   in [The line rule](#the-line-rule) below, because a rule nobody can evaluate is not a rule.
5. **Deterministic.** Same seed, same world. Every exhibit takes its seed from the URL so a
   visitor can share exactly what they saw.
6. **Zero assets, like everything else here.** Drawn and synthesized, no exceptions.
7. **The overlay is `@lattice/ui`, not canvas text.** This is a rule rather than a preference,
   and it exists because an audit found that **not one of the rows below named `ui` at
   all**. A whole package reached 100% coverage with no consumer in the entire plan — and the
   one UI-shaped artifact in the gallery, the control panel, lives in `examples/_shared`
   precisely because `ui` is deliberately not a controls library. So the HUD is where `ui`
   gets exercised, and if an exhibit finds it easier to draw its readouts into the canvas,
   that is a finding about `ui` and it gets reported rather than worked around.

   It also carries the one cross-package promise **nothing has ever executed**: `draw`'s
   `paletteVars` reaching the DOM as CSS custom properties, so the overlay darkens with the
   world instead of glowing in daylight colors over a night scene.

---

## The line rule

**An exhibit's logic is under 200 code lines. Its art is not counted at all.**

The old rule capped the total, and the first exhibit came in at five times it while being exactly
the thing the rule was written to produce. Both were wrong, and they were wrong in different
directions: the cap was measuring the wrong quantity, and the exhibit was not an exhibit. This
section replaces the cap; the [exemption](#the-one-hero-and-the-one-exemption) settles the exhibit.

Three parts, each of them checkable by someone who did not write the exhibit.

### What a code line is

A line that is neither blank nor entirely a comment.

```bash
grep -cvE '^[[:space:]]*($|//|/\*|\*)' src/main.ts
```

Comments are excluded because prose is a load-bearing part of this product (non-negotiable 5), and
a rule that counted it would be a rule against explaining yourself. This is not a new metric: run
it over Lamp Road's nine modules and it returns **1,286**, and over the `<style>` block in its
`index.html` it returns **104** — the two numbers that exhibit's author reported by hand. A measure
that reproduces the figure already published is one nobody has to be talked into.

### Which module is which

**Classification is per module, and the module declares itself.** An art module carries `@art` on
its own line in its header doc comment. Everything else is logic. Non-negotiable 4 already makes a
module's first doc line the place a module confesses what it is; this is that habit, not a new one.

> **A module is `@art` if deleting it would change only what the exhibit looks like or sounds
> like.** It may draw, synthesize, and write to the DOM. It may not hold state that outlives a
> frame, may not return a value that any decision reads, and may not move a number the player is
> playing for.
>
> **Everything else is logic, and every ambiguous module is logic.** The budget is on logic, so
> the tiebreak has to cost the author something — otherwise the classification drifts to wherever
> the author needs it to be, which is what a line-by-line split does today.

There is no line-by-line classification and deliberately no way to ask for one. A module that is
half art and half wiring gets **split**, and the split is the point rather than the overhead: an
author who wants a larger art budget pays for it by moving art out of the file the next reader has
to understand. Lamp Road's `ambient.ts` was already written this way and says so in its first line
— *"everything that moves and changes no number… it has its own module precisely because it is
mechanically inert."* The rule asks every exhibit to do what that one file already did.

The cases worth settling in advance, from the only exhibit that exists:

| module | verdict | why |
|---|---|---|
| `sprites.ts`, `sky.ts`, `ambient.ts`, `palette.ts` | **art** | they draw and nothing else. Delete any one and the game still plays |
| `sound.ts` | **art** | four recipes and a bed. Synthesis is art; the zero-asset rule is the only reason it is code |
| the CSS in `index.html` | **art** | uncounted, like every other art line. An exhibit's whole appearance may live here |
| `valley.ts` | **logic**, though it reads as art | it is the landform *and* the map — the road, the stations, and the height field that hit-testing and the economy both read. Delete it and nothing runs |
| `hud.ts` | **logic** | it reads game state, formats it, and owns the button that lights a lamp. Its *appearance* is the CSS, which is art, and that is the seam rule 7 already asks for |
| `main.ts`, `rules.ts` | **logic** | wiring, state, the frame, the economy |
| **static HUD markup in `index.html`** | **art** | see below. It sits beside the CSS, which was already uncounted, and for the same reason |

### Static markup is art. Building it in TypeScript does not make it logic.

The row above was added after an exhibit reported its `hud.ts` falling from **107 lines to 18**
by moving the panel's structure into `index.html` and leaving behind only the code that writes
values into it. That is a large enough difference to be either a loophole or a correction, and
it is a correction — but it needs a boundary, or every exhibit will discover that its game fits
inside a `<template>`.

The boundary is the same one rule 7 already draws for CSS: **appearance is art, and the reading
of state is logic.** Applied to markup:

| | verdict |
|---|---|
| a fixed tree of elements, written once, with fixed labels and classes | **art** |
| the same tree assembled by `el()` calls in a `.ts` file, still fixed, still written once | **art** — the language it is written in is not the test |
| code that reads game state and writes it into that tree | **logic**, always |
| markup **generated from data** — one row per resource, a list whose length the game decides | **logic**, always. The moment the shape depends on state it is a rendering decision |
| a handler that changes what the game does | **logic** |

The test to apply, which is just § Which module is which read literally: **would deleting it
change only how the exhibit looks?** A `<div class="readout">` with the word `POOLS` in it —
yes. The line that puts `86` inside it — no, that is the exhibit telling you something.

Two things this deliberately does not license. It does not license moving a decision into an
`onclick` attribute, and it does not license a `<template>` whose contents are chosen by the
game. If you find yourself writing markup that only makes sense once you know what the player
did, you have moved logic and the tool cannot see it — which is worse than being over the cap,
because the cap is a budget and this is the honesty the whole classification rests on.

### The one command

```bash
cd examples/<exhibit>
grep -LE '^[[:space:]]*\*?[[:space:]]*@art\b' src/*.ts | xargs cat |
  grep -cvE '^[[:space:]]*($|//|/\*|\*)'
```

Under 200 and it passes. `examples/_shared` is never counted — the bootstrap and the control panel
are gallery instruments rather than parts of any exhibit — and neither is anything in `packages/`.
An `npm run gallery` that prints the split for every exhibit and fails the one that is over is
routed as a finding; until it exists, the two lines above are the rule.

### The ratio stays a report card, and is never a gate

Rule 4 used to carry the ratio as its justification, and the ratio keeps that job: **every author
reports the split, and no number gates on it.** An art *floor* would be met with padding within a
week, and rule 1 already fails an exhibit that is not worth looking at. The cap binds the half that
gets worse as it grows; the ratio is how the kit reads its own results across seventeen of them.

### Why 200 is not a relaxation

250 was chosen when it covered everything. 200 on logic alone is therefore a *tightening* for any
exhibit that would have spent its budget on wiring, and a removal of the ceiling only from the half
that was the point. If an exhibit cannot state its one idea in 200 lines of logic, it is two
exhibits or none — which is rule 2, arriving at the same place from the other side.

---

## The one hero, and the one exemption

Lamp Road is 1,286 code lines against a cap of 250 and **622 of them are logic** against a cap of
200. The 295/1,095 split it reported was counted line by line inside files; per module, on the
classification above, the honest logic figure is more than twice that. **No choice of metric
rescues it**, which is the answer to the question it raised: it is not an exhibit that grew, it is
a game, and the gallery relabeled it on the way past.

The arithmetic, so nobody has to take it on trust:

| | modules | code lines |
|---|---|---|
| **logic** | `main.ts` 305, `valley.ts` 134, `hud.ts` 124, `rules.ts` 59 | **622** |
| **art** | `sprites.ts` 365, `sky.ts` 130, `ambient.ts` 112, `sound.ts` 43, `palette.ts` 14, plus 104 of CSS | 768 |

So it is relabeled back. **Lamp Road is the landing page's hero, and not a row.** The landing-page
section below already requires something this document had not budgeted for — a world that is
*"playable, not merely animated"*, that a visitor drags, zooms and taps within two seconds of
arriving, and that "does the persuading" before any text is read. Depth is what that asks for, and
depth is the one thing a row is forbidden to have. Lamp Road already is it.

The hero is bound by **every other rule in this document** — the first frame, one idea, something
moving, deterministic and seeded from the URL, zero assets, the `ui` overlay — and by no line rule
at all.

**There is exactly one hero and this document names it.** A row may not claim the exemption, and
"it is really a hero" is not a defense available to an exhibit that overran. A second exhibit that
genuinely needs the exemption has found something wrong with the gallery rather than with the rule,
and reports it as a finding instead of taking it.

`Lamplighter` therefore leaves the table below. Its one idea — capacity gating made visible, light
as the resource, dusk as the pressure — *is* Lamp Road's, and a smaller re-take of the hero's own
premise is the weakest row this gallery could ship. That also settles a count this document has had
wrong throughout: the table listed fifteen rows while the landing-page section promised fourteen
live tiles in four separate places.

**Seventeen rows and one hero** is the shape. It was fourteen until *Endless* and *Errand* were
added, and sixteen until *Canyon*; the count is written down here, in one place, precisely
because it was wrong in four places for as long as it was written down in four places.

---

## Scale — an exhibit fills its frame

The first two rows to land were individually beautiful and jointly made the same mistake: a
small, complete world sitting in the middle of a large empty background, with more pixels
spent on sky than on anything the kit does. It reads as a *model* of a world rather than a
place, and it reads that way at every zoom, because the problem is not the zoom — it is that
the world ran out before the frame did.

**So the standard is: the world runs off the edges, and the player's first gesture is to go
look at the part they cannot see.** Concretely, on a 1440×900 viewport at the opening zoom:

| | the rule | the failure it names |
|---|---|---|
| **extent** | the world's bounding rect is **at least 1.6× the viewport on its long axis**. Something the exhibit is about is off-screen at the opening frame | a world with visible corners is a diorama. Nothing invites a drag |
| **fill** | **no more than a third** of the opening frame is empty background — sky, sea, void | a diamond of content ringed by flat color is the shape every naive isometric demo has |
| **edges** | the world meets the frame edge, or a horizon does. Never a hard corner with background behind it | a floating slab announces the map's dimensions, which are an implementation detail |
| **density** | whatever the exhibit repeats — trees, towers, walkers, lamps — is measured in **hundreds**, not dozens | the kit's whole claim is that these are cheap. Thirty of anything disproves it |
| **depth** | at least three distance bands: something near, something mid, something far and dimmer | one plane at one scale is why a diorama looks small |
| **cost** | **60 fps on a mid laptop, judged on the worst frame in ten seconds.** Density is bought with culling, caching and cheaper sprites — never with frame time | see below. This row is the price of the one above it, and it was missing for exactly one exhibit |

None of that is a line-rule problem. Extent is a constant, density is a loop bound, and the
far band is art — the three together typically cost under twenty logic lines, and an exhibit
that claims the cap forced it to be small should re-read § Which module is which first.

### The cost row, and why it is not a footnote

The first four rows shipped without it, and the first exhibit rebuilt against them came back
dense and **slow on a decent laptop**. That is the rule's fault rather than the author's: a
standard that asks for more of something and names no price is a standard that will be paid for
out of frame time, because frame time is the only budget in this repo that nobody was watching.

So the rows are read in order and **cost is a gate, not a trade**. An exhibit that is grand and
drops frames has not half-passed; it has failed, and it fails *before* the density row is
scored, because a stuttering scene reads as cheap no matter how much is in it. Grandeur that
costs the frame is the same mistake as a diorama, arrived at from the other side.

The way out is never "put fewer things in it" as a first move. It is:

- **Measure before cutting anything.** First, because the obvious suspect is usually innocent.
  `docs/PERFORMANCE.md` puts the direct draw path at **2.14 ms for 400 sprites of 42 ops — 27%
  of the budget** — so at the density § Scale asks for, *drawing* is not what makes an exhibit
  slow. Suspect instead: work done per entity for entities nobody can see, a sprite definition
  rebuilt every frame rather than once, an allocation on the hot path, or something periodic. A
  6 ms mean beside a 23 ms worst is not a scene that is too big; it is something happening every
  N frames, and cutting the count will not touch it.
- **Cull.** A sprite outside the camera's rect costs nothing if it is never sorted or drawn.
  § Scale asks for a world larger than the viewport precisely so most of it is off-screen — which
  only pays if the off-screen part is dropped *before* the sort rather than inside the draw.
- **Spend the detail where the eye is.** Cost scales with ops-per-sprite times sprites, so the
  lever on a distant thing is how many faces it is made of, not whether it exists. The far band
  is already asked to be dimmer and hazier, which is also permission for it to be *simpler*.
  Fidelity at a distance nobody can resolve is the one saving that costs nothing to take.
- **Light is priced by *area*, not by count — and area scales with zoom².** Two exhibits look
  like they contradict each other and do not: `Caverns` runs **704 pools for about 0.2 ms**,
  while `City` measured **30 pools costing 9.5 ms at maximum zoom**. Same subsystem, same
  version. A pool's radius is specified in *tiles*, so its screen area grows with the square of
  the zoom, and a player pinching in multiplies the field's fill cost without adding a single
  light.

  So: **cut lights for the look, not for speed.** A scene reads as lit by scarcity and falloff
  rather than by how many sources it has, and that is reason enough. But if the field is
  genuinely costing you, the lever is pool *radius* and `LightFieldOpts.scale` — and if your
  exhibit lets a player zoom, dividing `scale` by the zoom is what keeps the cost flat. `City`
  went 18.1 ms → 8.6 ms at 2.6× that way. That compensation arguably belongs in `draw` rather
  than in every exhibit, and is filed.

  These figures replace an earlier table showing light count costing 0.9 ms across a sweep. That
  table was not wrong about the sweep; it was taken **while the ramp-cache bug below was
  churning**, so it was measuring allocation rather than light. It is left visible as a lesson:
  a sweep can be internally consistent, reproducible, and still be a measurement of something
  other than its own variable — and the second version of this bullet was *still* wrong, because
  two honest measurements of "what does light cost" disagreed by fifty times and neither author
  could see the variable that separated them.

Only when all four are spent is reducing the count the right answer — and at that point the
number is a finding about `draw`, not a defeat, and it gets reported.

> **There is no sprite bitmap cache in `draw`. "Cache it" is not a move available to you.**
>
> This list said there was one, for a day, and agents acted on it. The cache was provisional in
> `draw`'s RFC and the benchmark deleted it on purpose: at two to four hundred sprites the direct
> path is 13–27% of the budget, so a cache would have bought zoom buckets, palette revisions,
> pixel snapping and a don't-fill-while-moving rule — four fresh ways to render something stale —
> in exchange for nothing. `packages/draw/src/index.ts` records the decision and
> `docs/PERFORMANCE.md` has the table.
>
> **The condition that reopens it is written down rather than left to taste**: a thousand sprites
> of that complexity is 5.40 ms and 68% of the budget. An exhibit that reaches it has met a
> documented threshold and should say so, pointing at the number — which is the whole reason the
> number is a row in that table instead of a footnote.

#### The one that has caught two exhibits: an animated color is an allocator

**A color that moves continuously, passed to `softEllipse` or anything built on it, allocates a
canvas every frame — and takes every other call site's cache down with it.**

`draw`'s Canvas2D backend caches each radial ramp against the *exact* color pair it was built
from. A flame whose core is mixed against a noise value, a ripple whose alpha is a continuous
function of its age, a light that breathes — each is a guaranteed miss on every frame, and a
miss allocates a `<canvas>`, a context, a gradient and a fill. Worse, the cache evicts
*wholesale*, so past ninety-six unique colors the contact shadows, the light pools, the sky and
every sprite lose their entries too, as collateral. Measured in `Crowd`: **3.74 misses a frame,
a full cache drop every 26 frames, about 3.7 MB/s of garbage** — from twenty-seven flames and a
fountain. Measured again in `Caverns`, where it **scales with the light count**: 4.3 misses a
frame at 104 pools, **15.9 at 704**, clearing the whole map every six frames and taking 550
constant-color contact shadows down with it.

It is being fixed in `draw`. Until it lands, and as a habit afterward:

**Snap the color, not the motion.** Quantize an animated color to a handful of levels — eight to
twelve has been enough in three exhibits — and leave position, scale, radius and timing
continuous. Nobody can resolve nine brightness levels on an eight-pixel flame core, and the
frame-time difference is the whole of the tail.

**And look past the flicker for the real source.** `City` measured **27.2% of all soft ellipses
missing** with no flickering light at all. The cause was `palette.lerp` advancing every frame for
its day cycle, which makes *every color in the scene* a new key — a whole-scene version of the
same bug, invisible because nothing in the exhibit appeared to be animating a color. Any exhibit
with a palette that moves continuously has this. Snapping the lerp to a few dozen stops over its
cycle is one line, and it took that exhibit to 0.26% missing.

This one is filed here rather than only in a task because of *where* it hides: an exhibit calls
`glowDot`, which calls `softEllipse`, which consults a cache the author has never heard of. It
is two layers below the line anyone would suspect, and no amount of care at the call site finds
it. **Two independent exhibits hit it and neither one could have known.**

**Every exhibit's HUD carries its own worst frame.** Not the average: an average of 16 ms with
every eighth frame at 40 ms is a visible stutter and a healthy-looking number, which is the
argument `docs/PERFORMANCE.md` makes about the tail. An exhibit that cannot show its worst
frame cannot be said to have met this row.

**The frame is the composition.** An exhibit is judged on a screenshot taken at the opening
frame, at a fixed 1440×900, before any input. If that image is mostly background, the exhibit
is not finished, whatever its suite says. This is rule 10 with a ruler against it — and rule 10
says *someone looks at it running*, which is where a frame rate is found and a screenshot is
silent.

---

## The exhibits

Provisional. Each row names the one thing it exists to show, so an exhibit that drifts from
its row is either finished or is a different exhibit.

### Layouts and art direction — what the renderer can look like

| exhibit | the one idea | leans on |
|---|---|---|
| **Island** | terrain, shoreline, trees, a full day/night cycle in ninety seconds | `draw` `iso` |
| **City block** | dense setback massing and a window rhythm — the technique that carries the whole look | `draw` |
| **Terraces** | elevation: a hillside of stepped fields, and why picking must be terrain-aware | `iso.height` |
| **Harbor** | tall thin objects and depth sorting — masts, cranes, a jetty over water | `iso.depth` |
| **Orbit** | no ground at all: platforms, stars, a cold palette. The kit is not only for grass | `draw.palette` |
| **Caverns** | the light field alone — darkness, torches, pools that meet without a bright seam | `draw.light` |

### Mechanics — what the kit can do that is hard elsewhere

| exhibit | the one idea | leans on |
|---|---|---|
| **Crowd** | two hundred walkers from one closed-form expression, no per-walker state | `iso.path` |
| **Wayfinding** | a flow field re-routing a moving crowd the instant the map changes | `iso.path` |
| **Builder** | placement: footprints, a ghost, validity, and the tap→tile seam | `iso` `input` |
| **Idle** | cost curves and buy-max in closed form, then fourteen hours of offline in one frame | `sim` |
| **Replay** | record, scrub, and prove it: the same seed and log land on the same pixel | `loop` `persist` `input` |
| **Migration** | a v1 save opened by a v5 build, stepping the chain in front of you | `persist` |
| **Instrument** | sound with no files — a board that shows the synthesis as it plays | `audio` |
| **Resonance** | a game you play *by ear*: gates hum a chord and you have to answer it | `audio` `draw.light` |
| **Canyon** | deep time: a river cutting a gorge over a million years, scrubbable, and the ground never stops moving | `iso.height` `core.noise` |

### Whole games, small — the two rows that answer "could I actually ship something with this"

| exhibit | the one idea | leans on |
|---|---|---|
| **Endless** | a world with no edge: pan forever, chunks minted from the seed, nothing loaded and nothing kept | `core.noise` `iso` |
| **Errand** | an RPG in an afternoon — walk, talk, take, use, save. The whole genre's skeleton, small enough to read | `iso.path` `ui` `persist` |

These two exist because every other row proves a *capability*, and a visitor deciding whether to
use a kit is not asking what it can do — they are asking whether the shape of the thing they want
is reachable from here. **Endless** and **Errand** are the two shapes most people arrive wanting,
and they are on the list precisely because both are traditionally where a small kit stops being
enough. They are still rows: bound by the line rule, no endings, no meta progression, nothing that
is not visible in ninety seconds.

Seventeen, plus the hero. `Lamplighter` was the fifteenth row and is now the hero's own premise; see
[The one hero](#the-one-hero-and-the-one-exemption). The list is still expected to lose one or two
that turn out to be dull and gain one or two nobody has thought of.

### Resonance, because an audio package needs a game and not a demo

`Instrument` shows the synthesis. It does not prove anyone would ever *use* it, and a sound
board is the kind of exhibit people admire for nine seconds. So one exhibit puts sound on the
critical path: you walk a dark cavern, every locked gate hums a chord, and you carry a few
tuned strings. Strike the combination that answers the gate and it opens.

It is the right test of `audio` for reasons a board is not. **You cannot fake it** — the pitch
relationships have to be actually correct, the attack has to be fast enough to feel like an
instrument rather than a notification, and voices have to stack without clipping when a player
mashes all of them at once, which is the first thing anyone does. It also forces the two halves
together: the bed has to duck under the puzzle tones and come back, which is the one thing a
board never asks of a mixer.

Pair it with the light field and it earns two exhibits' worth of screen: a cavern lit only by
what you have opened, and sound as the sense you navigate by.

### Canyon, and the exhibit where the closed-form answer is wrong

Every terrain in this gallery is a height field that was generated once and then stood still.
`Canyon` is the one where the ground is a function of *time* — a river cutting a gorge over a
million years, with strata appearing as it cuts down through them, and a scrub bar so a visitor
can watch it happen, run it backwards, and stop anywhere.

It exists because it is the honest counterweight to `Crowd`. Crowd's whole claim is that two
hundred walkers need no state at all, because a walker's position is a closed-form expression in
`t`. That is true, it is the kit's best trick, and **it does not generalize** — erosion genuinely
accumulates. Where the sediment goes next depends on where the water went last, and there is no
expression that answers "what does this valley look like at t = 400,000 years" without being the
simulation. A gallery in which every exhibit is closed-form is a gallery that has quietly
selected for problems that happen to be closed-form, and a reader would be right to distrust it.

**So the scrub bar is a re-run, not a lookup, and that is the demonstration.** Determinism is
what buys it: the same seed stepped to the same epoch produces the same canyon to the bit, so
"go to year 400,000" is "start from the seed and step, from the nearest checkpoint," and it lands
on a canyon identical to the one the visitor saw on the way past. Say that in the HUD — the
epoch, the step count, and the fact that it was recomputed rather than remembered. A scrub bar
that is secretly a cache of screenshots proves nothing and is the easy version of this exhibit.

Two consequences worth designing for rather than discovering:

- **This is the gallery's sharpest Tier A / Tier B case.** Everywhere else, Tier B reaches
  pixels and stops. Here the height field is state that feeds the next step, so a last-bit
  disagreement in a `pow` does not stay a last-bit disagreement — it compounds for a hundred
  thousand iterations and two engines end up with rivers in different places. The erosion step
  is Tier A or the exhibit's headline claim is false. Art may use whatever it likes.
- **Moving ground is the adversary of every cache in `draw`.** Sprite caching assumes a sprite
  drawn this frame looks like the one drawn last frame, and a terrain that changes continuously
  is the case that assumption was never tested against. Finding out what that costs is a
  legitimate second reason for this exhibit to exist, and the number belongs in the report.

It is not `Terraces` at a different scale. Terraces is about **picking on elevation** — the
tap→tile conversion that assumes flat ground. Canyon is about **elevation as a function of
time**, and if the two start converging, one of them is finished.

#### A mile deep has to *feel* a mile deep

The first build of this exhibit was reviewed with one sentence — *"Grand Canyon is 6000+ feet
deep, the demo didn't make that impact"* — and it is the note this exhibit will keep getting,
because depth is the only thing it is selling and depth is the hardest quantity to convey in an
isometric projection. Almost none of the fix is in the height field. Raising the number makes a
deeper groove, not a bigger impression. What actually produces the impression:

| cue | why it works |
|---|---|
| **the drop takes up the frame** | verticality is judged relative to width. A gorge wider on screen than it is deep reads as a dip no matter what the model says |
| **something in shot to size it against** | trees on the rim as specks, a river as a thread, birds *below* the rim line, a trail switchbacking down a wall. One of these beats a thousand feet of height field |
| **strata you can count** | distinct bands are how a real canyon announces its depth — the eye counts them. It is also the time axis made visible, so it does two jobs |
| **haze inside the gorge** | the far wall desaturates toward the sky and the near wall does not. This is the cue that makes a photograph read as miles rather than yards, and it is nearly free |
| **the depth on screen, in feet** | a number climbing past four, five, six thousand while the visitor watches is the claim stated plainly, and it costs one line |

This generalizes past this exhibit, which is why it is written here rather than in a task: **an
isometric projection flattens exactly the axis a landform is impressive along.** Any exhibit
whose subject is vertical — a canyon, a tower, a shaft, a cliff — has to buy that axis back with
composition and cues, and none of them are the height field.

**And the first build proved the cues are not enough on their own.** It shipped every row of the
table above — countable strata, a switchback trail for scale, haze inside the gorge, feet on
screen — and still read as a stratified hillside, because the *structure* underneath them was
wrong. Held against a photograph of the real thing, three things were missing and no amount of
cueing substitutes for them:

| | why it is structural rather than decorative |
|---|---|
| **a flat tableland with a hard rim line** | the drop reads because there is something *level* to measure it against. Terrain that rises continuously to the top of the frame never establishes what level means, so nothing is falling away from anything |
| **the river visible at the bottom of a V** | it is the brightest thing in a canyon photograph and the line the eye follows into depth. Both walls descend to it; without it there is no section, only a slope |
| **walls that step rather than slope** | hard beds stand as cliffs, soft beds as benches, alternating all the way down. A uniform talus angle is geologically defensible and is exactly what makes a wall read as a hillside |

The lesson is worth more than the exhibit: **a cue decorates a structure and cannot replace one.**
When something is not reading, check the composition before adding another cue to it.

And then a fourth thing was missing that none of the above would have fixed, because it is not a
composition problem at all:

**A continuous height field on a diamond grid renders as triangles, whatever the model says.**
The exhibit's terrain read as a field of triangular peaks through three rebuilds — with correct
geology underneath it, including per-bed talus angles that genuinely produced cliffs and benches
in the data. Every tile differed slightly from its neighbor, and a grid of diamonds turns that
into endless small triangles. Mesas are flat-topped; a landform whose silhouette should be
orthogonal cannot be got there by making the model more correct.

**The fix belongs in the render, and it must not reach the model.** Snap each drawn vertex onto
the top of the bed it stands in, inside the `HeightField` the terrain pass reads, and the benches
become flat and the risers abrupt. Two details this exhibit paid for: snap **most of the way, not
all** — full quantization is a staircase whose steps only move when a vertex crosses a boundary,
and in an exhibit about continuous time that artifact would falsify the claim it exists to make —
and snap **up rather than down**, so the snapped height stays inside the band it was classified
in and a bench is not striped with the color of the bed below it.

Generalized: **the grid is a renderer, and a landform's silhouette is its business.** Any exhibit
whose subject has a flat top — a mesa, a plateau, a rooftop, a terrace, a floe — is fighting the
same interpolation, and the answer is never in the simulation.

#### And a measurement worth writing down, because two agents got it wrong in opposite directions

Which diagonal a gorge is cut along changes its apparent depth, and the intuition is unreliable
enough that both available answers were argued confidently before either was measured. The number,
taken as **vertical screen distance from a rim tile to the water below it**:

| gorge runs | wall face, vertical | what it buys |
|---|---:|---|
| **across** the frame (`gx − gy`) | **742 px** | maximum apparent height. A wall's horizontal run lands on the *same* screen axis as its height, and the two add |
| **along** the frame (`gx + gy`) | **312 px** | both walls in shot at once, side canyons from both sides, a river receding the full height of the frame — the shape of *being in* a canyon |

The run is horizontal in the world either way; turning the landform changes which screen axis it
lands on, and on the perpendicular axis it contributes nothing, leaving the drop alone. **58% of
the apparent height is the price of the viewpoint**, and no framing recovers it.

Note what was *not* the deciding measurement. Rim-to-rim screen **separation** — how far apart the
two rims sit vertically — is a different quantity, mostly the distance between two things rather
than the height of either, and it is the one that gets measured first because it is the one that
is easy to measure.

---

## The control panel

**Every exhibit ships a slider panel that exposes the real parameters underneath it.**

This started as a nicety and is better than that. The kit's configurability is currently
invisible: it lives in doc comments and RFC tables, and a visitor has no way to discover that
the camera's zoom clamp, the day length, the offline exponent, a light's radius and falloff,
the voice ceiling and the tap-versus-drag thresholds are all knobs. A panel that moves them
live, in a running scene, is better documentation than the paragraph explaining them — and it
costs one shared module.

It also turns each exhibit into an experiment a visitor can run:

- **Show the failure, not just the setting.** Push the voice ceiling to two and hear a burst
  choke. Drag the offline exponent to 1.0 and watch a fourteen-hour absence pay out
  uncapped. Set the tap slop to 1 px and discover you can no longer tap anything on a
  touchscreen. The knobs that matter are the ones with a visible wrong end.
- **Every panel value is in the URL**, so a visitor can share the configuration that made the
  thing look good, and a bug report can be a link.
- **Nothing in the panel is exhibit-specific plumbing.** A control declares the kit parameter
  it drives, and reading a panel tells you what the kit lets you change. If an exhibit wants a
  slider for something the kit does not expose, that is a finding.

It lives in `examples/_shared/`, not in `packages/`. It is a gallery instrument, not a kit
feature, and `@lattice/ui` is deliberately not a controls library.

---

## What the gallery is really for

**It is the widest test the kit will ever get, and it will find things.** Nine packages were
designed in parallel against one game's capability matrix. Seventeen exhibits will exercise
combinations nobody designed for, and every place two of them hand-roll the same thirty lines
of bootstrap is a gap in the kit rather than a coincidence.

So each exhibit's author reports the same two things the first demo was asked for: **where the
kit fought back**, and **the logic-to-art line split** — the latter from the command in
[The line rule](#the-line-rule) rather than by hand, so that seventeen reports are one series
instead of seventeen different opinions about what a line is. Those reports are the input to the
next cycle, and they matter more than the exhibits.

---

## The landing page

Built last, by an agent, once the exhibits exist. It has one job: **make Lattice the obvious
choice for anyone building an isometric game with an agent, within about four seconds of
arriving.**

### The resolution of the two briefs

"Clean, minimal, dark, IBM Plex Mono" and "a visual treat showing the full wrath of the kit"
sound like opposite instructions. They are not, and the resolution is the whole design:

> **The chrome is minimal. The content is maximal.**

Restrained monospace typography, near-black ground, almost no ornament, generous space — and
inside that frame, worlds that move. Every dev-tool page worth remembering works this way: the
type gets out of the way so the thing being sold is the only loud object on screen. A page
that is itself decorated competes with its own product.

### The one rule that makes it a treat rather than a brochure

**Nothing on this page is a picture of Lattice. Everything is Lattice, running.**

No screenshots. No recorded video. No "watch the demo" button. The hero is a live isometric
world rendering in a canvas the moment the page paints, and the gallery below it is seventeen
*live* scenes in a grid — not seventeen thumbnails. Seventeen worlds animating at once, in a
page that weighs less than one hero image on a typical framework site, is a claim no
competitor can make and no visitor can misread.

That single decision does the persuading. A visitor does not need to be told the renderer is
fast; they are watching seventeen of them.

### What the page has to land, in order

1. **The first frame.** A world, moving, before any text is read. Saturated, framed to fill,
   with something already happening in it — pilgrims walking, a light coming on, a crane
   turning. If the hero is static for even a second on load, it reads as an image and the
   entire premise is lost.
2. **What it is, in one line**, under it. Not a feature list.
3. **The proof, as numbers rather than adjectives.** Zero dependencies. Zero asset files.
   Nine packages. Roughly 78 kB gzipped for all of them. ~2,300 tests. A frame budget the
   page is meeting live — and it may as well *show* the frame time, because a page confident
   enough to display its own render cost is making an argument.
4. **The agent story, prominently and early.** This is the differentiator and it is the part
   a generic gamedev library cannot copy: install the skills, point an agent at it, get a
   game. Show the actual invocation. Show what an agent produces. The audience is people who
   will build this *with* an agent, and the page should be legible to the agent too.
5. **The gallery.** Seventeen live tiles, each one line of caption, each linking to source.
   The source is the point — a visitor who likes a tile wants the file, immediately.
6. **One paste-able example** that compiles, sized so the whole thing fits on screen at once.

### Interaction

The hero should be **playable, not merely animated** — drag to pan, scroll to zoom, tap
something and watch it respond. The moment a visitor discovers the header image is a game,
the page has won, and that discovery should take under two seconds of idle cursor movement.

Scroll can direct the hero: day into night as the reader descends, or an empty valley filling
in. The kit already does this; the page should use its own product as its scroll animation
rather than importing a library to fake one.

### Constraints

- The page is **not part of the kit** and is not bound by the zero-asset rule — a webfont is
  fine here. But it should hold itself to the rule anyway wherever it can, because a landing
  page that quietly needs a sprite sheet to look good is an argument against its own product.
- **Nothing it does may leak into `packages/`**, and no exhibit may depend on it.
- It must be **fast on a phone**. Seventeen live scenes is a spectacle on a laptop and a
  disaster on a mid-range Android unless the tiles are paused until scrolled into view and
  the hero drops to a lower cadence off-screen. The kit gives you exactly the tools for this
  and it would be embarrassing to get wrong on a page selling frame-time discipline.
- **It works with JavaScript disabled** to the extent of showing what the project is. Not
  gracefully — just honestly.
