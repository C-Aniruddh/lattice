# Canyon

**Deep time: a river cutting a gorge over a million years, scrubbable, and the ground never
stops moving.** `iso.height` · `core.noise`

```bash
npm run build                       # the exhibits render against each package's dist, not its src
npm run dev --workspace=@latticekit/example-canyon
# http://localhost:5188/  ·  ?seed=colorado
```

Drag the bar. The gorge opens beneath you — strata appearing in the wall as the cut goes down
through them, side canyons branching back into the tableland, scree piling at the feet of the
walls, the depth in the corner climbing past six thousand feet. Let go and it keeps going.

---

## The one idea

Every other terrain in this gallery is a height field generated once and then held still. Here
the ground is a function of *time*, and the reason that is worth an exhibit is that erosion
genuinely **accumulates**. `Crowd` gets two hundred walkers out of a closed-form expression in
`t`; there is no expression that answers *"what does this valley look like at t = 400,000 years"*
without being the simulation.

**So the scrub bar is a re-run, not a lookup.** Every frame you see was produced by
`erosion.step`, from the seed, through every intervening epoch, in order. Determinism is what
makes that affordable: the newest exact checkpoint at or before the target is restored and the
model is stepped from there, and the result is bit-for-bit what a full run would have produced.

The HUD publishes the witness rather than the claim. `FIELD` is a hash of **every bit of every
height** in the live buffer. Driven through the running exhibit, `?seed=colorado`:

| how the frame was reached | epoch 300 | epoch 900 | epoch 1700 |
|---|---|---|---|
| first visit, on the way out | `bf514b3d` | `d0e71a80` | `dd71cc21` |
| scrubbed back from epoch 2000 | `bf514b3d` | `d0e71a80` | `dd71cc21` |
| scrubbed back again after a return to epoch 0 | `bf514b3d` | — | — |

Scrub past an epoch, come back to it, and the number has not moved. The interesting row is 1700:
the first visit resumed from **checkpoint 880** and stepped eight hundred and twenty times through
time nobody had computed; the second resumed from **checkpoint 1680** and stepped nineteen. Two
different routes, one field, to the bit. If that number ever moved, this exhibit's headline claim
would be false and the overlay would say so before anyone else noticed.

Both directions take the checkpoint. Backwards it is the only way home; **forwards it is the
difference between a scrub that lands and one that crawls**, because a visitor throwing the bar
across ground they have already covered would otherwise watch fifteen hundred steps go past at
fourteen a frame. Dragging into time nobody has visited still costs every step of it, with the
overlay saying `CATCHING UP — RE-RUNNING THE MODEL` while it does. That asymmetry is the honest
one, and it is what the exhibit is for.

---

## The model, and why every line of it is Tier A

Droplets steer down the local gradient of the bilinear surface, carrying sediment up to a
capacity set by how fast they are falling and how much water is left — cutting when under
capacity, depositing when over it, which is what makes the result *path-dependent*. Between
rains the grid relaxes: anything steeper than **the angle of the bed it is standing in** slides
its excess into its lowest neighbour, which is what widens a slot into a gorge and piles the
scree. The interior rises by a fixed uplift while the rim is pinned as base level, so the river
never finishes cutting.

**A bed's angle is the one place the picture reaches back into the model, and it belongs there.**
`BED_TALUS` gives each of the eight beds in `palette.ts`'s section its own talus — about 1.3 units
per tile for the limestone and the cemented sandstones, 0.4 for the shales — so hard beds stand as
cliffs and soft ones retreat into benches, and a finished wall is *cliff, bench, cliff, bench* down
its whole height. That is not decoration. One talus angle for the whole column is geologically
defensible and produces a uniform slope, which is exactly the hillside this exhibit was reviewed
for twice; differential resistance is what makes a wall look like a wall, and it is the same fact
that makes the strata countable. The column mean is 1.03 units per tile, exported as `WALL` so
`strata.ts` can find the rim without scanning twelve thousand cells for it.

Two notes on that number now that the gorge has been turned to run *away* from the camera. The
occlusion argument it used to carry — a cliff steeper than `HALF_H / stepPx` = 0.89 hides the bench
behind it — **no longer applies at all**, because a wall standing across the screen occludes
nothing; the risers are visible because they are lit differently, not because they are in front of
anything. And `WALL` is a fit rather than a slope: measured on the finished field the walls stand at
0.45 to 0.75 units per tile, well under 1.03, and 1.03 is simply the constant that puts `rimU` where
the rim actually is once the trough and the pinned edges are accounted for. It is used to place a
line, never to reason about visibility, and it should be read that way.

`AGENTS.md` non-negotiable 1 makes this the sharpest Tier A case in the kit. Everywhere else Tier
B reaches a pixel and stops; here the height field is state that feeds the next step, so a
last-bit disagreement in one `pow` is amplified by the next droplet that steers on the gradient
it perturbed, and after a hundred thousand iterations two conforming engines have the river in a
different valley. `erosion.ts` therefore uses `+ - * /`, `Math.sqrt`, `min`/`max`/`floor`, `| 0`
and `Math.imul` and nothing else — **and carries no `@tier-b` tag anywhere**, because the tag
declares a value that reaches pixels and every value in that file reaches the next iteration.
`core.noise2` and `core.fbm2` are Tier A by construction, which is the one fact that makes a
time-evolving height field possible at all.

Tier A is not the same as finite. This exhibit has shipped a black screen **twice**, from two
different fractional grid indices: a droplet spawned one cell past the end of a typed array, and
a terrain walk whose first diagonal came from a real-valued rim position and stayed fractional all
the way to `gy * N + gx`. Both read *between* two cells, which is `undefined`, which is `NaN` the
moment it is multiplied; `draw` then correctly refuses the tint and the frame goes black. `0/0`,
`Infinity - Infinity` and `Math.sqrt(-1)` are all exactly specified and all produce `NaN`, so this
is never a tier problem — **the guard belongs at the computation that mints it**, and in both
cases it was one `clamp` or one `Math.ceil` at a loop bound.

---

## What it costs

Measured on this machine. The simulation numbers are from a headless harness over the built
`erosion.js`; the draw-call numbers are from `draw`'s `RecordingSurface` at 1440×900.

| | |
|---|---|
| one erosion step, 112×112 grid, 64 droplets × 46 iterations + a full relaxation sweep | **0.30 ms** |
| height vertices that change in one step | **12,684 of 12,769 — 99.3%** |
| a full re-run from the seed to a million years, 2,000 steps | **0.66 s** |
| checkpoint interval | 40 steps → 51 checkpoints × 204 KB = **10.4 MB**, minted lazily, never dropped |
| worst jump over ground already covered | one restore plus ≤ 39 steps ≈ **12 ms**, spread over ≤ 3 frames by `CATCH_UP` |
| worst jump into time nobody has computed | every step of it: 1,700 steps ≈ **2 s** at 14 a frame, with the overlay saying so |
| paths in one full frame at 1440×900 | **5,510** — 3,802 terrain quads, 1,320 strokes, 388 ellipses. *Taken before the plateau; see the note below* |
| what the culls take off that | the `u`/`v` interval walk, the horizon cull at `hazeFar`, and the per-tile floor **and ceiling** tests |
| radial-gradient allocations per frame | **0** — nothing here calls `softEllipse`, so § Scale's animated-color trap cannot fire |

> **The path count predates the turn and is owed a re-measure.** The viewpoint changed, the frame
> is tighter, and `CAPROCK` replaced a flat height bracket with one that tracks the uplift and the
> snap, which takes about fifteen diagonals off the near end of every walk. Against that, `bench`
> now runs on every corner read — eight short `while` loops a tile — and the terrain covers more of
> the frame than it did. Nothing here has been counted with `RecordingSurface` since.
>
> **The path count is stale by one change and is owed a re-measure.** Moving `HAZE_LIFT` from five
> diagonals to twenty put a flat plateau above the far rim — see § *A mile deep* — which is fifteen
> more diagonals the terrain pass has to consider. Most of them are above the top of the frame, and
> the four-comparison **ceiling** test added to `rock` beside the existing floor test is what takes
> them off again before a quad is built, on the same argument the floor test was written on. It has
> not been counted with `RecordingSurface`, and it should be before this number is quoted anywhere.

Frame time is the exhibit's own HUD, which carries `loop.stats.worstGapMs` — **the worst gap
between two painted frames in the last ten seconds** — beside the display cadence, because the
verdict is the ratio and not the number. While the ground is moving, with six other gallery
exhibits live in the same browser: **median 5.3 ms, ninetieth 10.9 ms, worst gap 15.6 ms.** The
catch-up frames of a cold scrub cost about a millisecond more at the median (fourteen erosion
steps is 4 ms of the budget) and land on the same 15.6 ms worst.

> **A caveat on how those were taken, because it invalidated the first set.** This gallery's
> automation drives a *headless* Chrome, where `document.visibilityState` is `"hidden"` forever,
> `requestAnimationFrame` never fires, and the loop reports a confident `0.0 ms`. **A frame
> readout of exactly zero is almost always a hidden tab rather than a fast scene.** The figures
> above were taken with rAF shimmed onto a `MessageChannel`, which visibility does not throttle:
> every frame then costs its own work with no display idle in it, so the gap *is* the work — a
> pessimistic reading, and the only honest one available without a visible window.

A pixel-ratio sweep says where the cost actually is, and it disagrees with
`docs/PERFORMANCE.md`'s "the device ratio is not in the geometry" row — for *this* workload:

| `?dpr=` | render |
|---|---|
| 0.5 | 7.95 ms |
| 2 | 16.21 ms |

A 42-op sprite occupies a few hundred pixels; a terrain quad occupies a whole tile and the
terrain covers the entire viewport. **A full-frame terrain is fill-bound where a sprite scene is
op-bound**, so the device ratio is squarely in the cost and `maxPixelRatio` is the knob that
matters. That is a property of the workload rather than a contradiction of the benchmark.

---

## The line split

`npm run gallery`:

```
canyon        198 logic    409 art   67% art   ok, 2 to spare
   logic  deeptime.ts  28   erosion.ts  87   hud.ts  39   main.ts  44
   art    palette.ts   29   readout.ts  33   sky.ts  56   strata.ts 180
          view.ts      25   index.html <style>  86
```

Six of the eight new logic lines are `BED_TALUS` and the four-line lookup in `settle` that reads
it; the other two are the scrub bar's two custom properties in `hud.ts`. Two to spare is tighter
than this exhibit would like and the next thing it needs would have to buy the room from `main.ts`.

The four logic modules are the model, the timeline, the numbers on the overlay and the wiring.
`readout.ts` is the overlay's fixed element tree and is art under § *Static markup is art*; the
listeners on the bar and every `setText` stayed in `hud.ts`, which is where that section puts
them. `view.ts` is the composition — where the camera stands and which passes run.

---

## A mile deep has to feel a mile deep

This exhibit has now been reviewed for it **three times** — *"Grand Canyon is 6000+ feet deep, the
demo didn't make that impact"*, then *"it reads as a stratified hillside"*, then a photograph. Very
little of the answer was ever in the height field. Four things worth carrying out, in the order
they mattered:

### 1. Something flat to fall away from

> **The drop reads because there is something level to measure it against.** A frame in which the
> terrain rises continuously to the top edge has nothing that says what *level* is, so there is no
> rim to have fallen from, and the deepest gorge in the world reads as a bank.

This is the one the first builds were missing and it is worth more than every other cue here put
together, but **it is no longer bought by the framing** — it is bought by the geometry. `bench`
snaps every drawn vertex onto the top of its own bed, so the ground either side of the gorge is a
dead-flat mesa top and the walls are stacks of flat benches. There is something level in shot at
every zoom, every pan and every epoch, because level is now what the rock *is* rather than what
happens to be at the top of the frame. See § *The section, imposed on the geometry* below.

The previous build spent two constants on the same cue — twenty diagonals of untouched tableland
drawn beyond the far rim, and a frame hung from its bottom edge so the near plateau stayed out of
shot — and both are gone with the viewpoint they were built for. What replaced them is one
four-comparison function in the height lookup.

### 2. The projection decides how the drop is *split*, and `stepPx` is not the lever

> **In a 2:1 projection, `stepPx` sets the vertical exaggeration *and* the self-occlusion angle,
> and they pull opposite ways.** A tile of horizontal distance is worth `HALF_H` = 16 screen
> pixels; a unit of drop is worth `stepPx`.

At `stepPx` 26 the occlusion limit is 0.62 units per tile. The build that set the talus angle to 4.2
produced a gorge that closed over its own floor and the river became invisible at exactly the epoch
it was cutting hardest. At 18 the limit is 0.89, which is where it stayed.

**Both halves of that argument are about a gorge cut *across* the frame, and the turn retires
them.** With the canyon running away from the camera a wall occludes nothing, so there is no
occlusion limit to respect and no floor to close over; and rim-to-rim is a horizontal distance,
`2 · rimU · HALF_W`, in which `stepPx` does not appear either. What `stepPx` now buys is the whole
of the apparent depth and nothing else: a wall's face is exactly `cut · stepPx` pixels tall. It is
still 18, and raising it is now a straight trade against nothing but taste — which is a much weaker
position than the previous viewpoint's, where it was traded against being able to see the floor.

### 3. Light is what separates the two walls

The gorge is cut across the sun's own axis, so `east − west` — the only cross-slope `isoTerrain`
reads — has opposite signs on the two walls. The left wall is turned out of the light and the right
wall into it, and `strata.ts`'s `pit` term takes the shadowed one further, ramped over two units
below the rim so the lip is an **edge** rather than a fade.

The previous viewpoint needed the same term for a harder job: its *near* wall was compressed to a
hundred and fifty screen pixels by the projection, arrived the same beige as the tableland above it,
and could only be separated by value because geometry had nothing left to give. The general lesson
survives the viewpoint that produced it — *when the projection compresses the surface you need, stop
trying to un-compress it and separate it by value instead* — and this build gets it cheaply, because
neither wall is compressed any more.

### 4. A wall is stepped; a hillside is not

Uniform talus relaxation produces a uniform slope, which is geologically defensible and is precisely
the thing three reviewers called a hillside. `BED_TALUS` gives each bed its own angle — see
§ *The model* — so the wall retreats as cliff, bench, cliff, bench. It was not enough on its own: a
continuous height field on a diamond grid still renders as a field of small triangles, which is the
fourth review's *"too triangular"*. `bench` finishes the job in the renderer, and the two together
are what make the wall read as architecture. See § *The section, imposed on the geometry*.

### The axis, and what turning it actually costs

**The gorge now runs *along* `gx + gy`, away from the camera** — a drone flying up the canyon
rather than a person standing on the rim, which is the viewpoint it was asked for after the
cross-section build was reviewed as *"too triangular; I expected it to flatten out"*. It had been
turned once before and rejected, and the rejection was not wrong so much as measuring the wrong
quantity: it compared rim-to-rim **separation** on screen, which is mostly the distance between two
things rather than the height of either.

Here is the quantity that matters, measured in both orientations at epoch 2000 on `?seed=colorado`
— **the vertical screen distance from a rim to the water below it**, which is the apparent height of
the wall:

| the gorge runs along | wall face, vertically | wall face, horizontally | what else is in shot |
|---|---|---|---|
| `gx − gy`, across the frame | `cut · (HALF_H/slope + stepPx)` = **742 px** | 0 — the run has no horizontal component | one wall; the other compressed to 150 px |
| **`gx + gy`, along it, as built now** | `cut · stepPx` = **312 px** | 900 px | **both walls**, and 1,600 px of receding river |

**So the turn is genuinely worse for apparent wall height, by 58%, and the reason is structural.**
A 2:1 projection sends a tile of `gx + gy` to 16 screen px *vertically* and a tile of `gx − gy` to
32 px *horizontally*. A wall's run is horizontal in the world either way; what changes is which
screen axis it lands on. Cut across the frame it lands on the same axis as the wall's height and the
two **add**, which is where `HALF_H/slope` comes from; cut along the frame it lands on the
perpendicular axis and contributes nothing, leaving `stepPx` alone. Turning the gorge does not make
the wall shorter in the world, but it does make it shorter *on screen*, and no framing recovers it.

What the turn buys is everything else the reference photograph has: both walls in shot at the same
size, a river that recedes for the full height of the frame, side canyons cutting back into the rims
from both directions, and the shape a person recognises as *being in* a canyon rather than looking
at one. It also gives up the exhibit's only occlusion — along a line of constant `gx − gy` the
surface descends the screen monotonically, so nothing hides anything — and hands the whole job of
distance to the haze, which is why `HAZE_SPAN` is now the single most load-bearing number in
`strata.ts`.

### The section, imposed on the geometry as well as on the color

*"Too triangular"* is a diagnosis of the **grid**, not of the model. A height field is continuous, so
every vertex differs a little from its neighbours, and a diamond grid renders continuous relief as an
endless field of small triangles — including on ground that is supposed to be a plateau. Canyon
country is the opposite shape: flat-topped mesas and benches with near-vertical risers, an
orthogonal silhouette, because horizontal beds weather back to their own bedding planes.
`BED_TALUS` was aimed at this from inside the model and could not reach it: it sets the *angle* a
wall relaxes to, and any single angle is still a ramp.

So `strata.ts` § `bench` snaps every drawn vertex 86% of the way onto the top of the bed it stands
in. A whole bed's tiles land on one plane, the risers between them are abrupt, and the strata become
countable by construction rather than by contrast. Three notes on how it is done:

- **It happens in the render and never in the model.** `erosion.ts`'s field stays continuous, so the
  droplet gradients, the relaxation and every checkpoint fingerprint are untouched. The snap is the
  last thing that happens before a height becomes geometry — it is applied inside the `HeightField`
  the terrain pass hands `isoTerrain`, and to the same four corners the shading reads.
- **86% rather than 100%.** Full quantization is a staircase whose steps never move: the model would
  go on eroding underneath and the picture would change only when a vertex crossed a boundary,
  which in an exhibit whose subject is *continuous* time is the one artifact that would falsify it.
  A seventh of the real relief left in keeps every frame different from the last.
- **Snapping up, not down.** The snapped height stays inside the band it was classified in, so the
  bench a tile is drawn on and the stratum it is painted in are the same bed. Snapping down crosses
  the boundary by construction and stripes every bench with the color of the one below it.

### The `draw` finding, which the turn confirms from the other side

> **`isoTerrain` shades a tile by `east − west`, which is the screen horizontal — and a canyon
> wall's gradient is entirely in the other axis.** Both of those corners sit at the same
> `gx + gy`, so on a canyon wall the kit's relief term is **zero** and a six-thousand-foot cliff
> renders as flat-shaded texture. `north − south` is the missing axis and it costs one
> subtraction; supplying it through `isoTerrain`'s `tint` is what turned this exhibit's wall from
> a slope into a cliff. The relief axis wants to be an option on `HeightField`.

Turning the gorge is the control experiment for that finding rather than a refutation of it. Cut
along `gx + gy` the walls' gradient is back on `east − west`, the kit's own relief term does most of
the shading unaided, and the exhibit needs the custom axis only for the shadowed-wall term. The
finding stands and its scope is now exact: **`isoTerrain` reads one of the two diagonals, and any
landform whose gradient runs along the other one renders flat.** The next exhibit with a ridge on
the wrong diagonal will hit it, and it will not have a viewpoint it can turn.

### Where the five cues from § *A mile deep* are spent

| cue | here |
|---|---|
| the drop takes up the frame | across rather than down: the gorge is about 1,300 world px rim to rim at the opening epoch and 1,900 at the end, against a 2,000 px frame, and it runs the frame's full height. A wall's face is 312 px at epoch 2,000 — the price of the viewpoint, and § *The axis* has the arithmetic |
| something in shot to size it against | four — junipers four pixels tall on the mesa tops, a river drawn as a thread and never a ribbon, birds flying **below** the rim line, and a trail switchbacking four times down the lit wall |
| strata you can count | eight beds by elevation minus the uplift, so they are bedding planes *in the rock*, exposed in order as the river cuts through them — each with its own talus in the model, and each snapped onto its own plane in the renderer, so a band is a flat step rather than a stripe on a ramp |
| haze, and only up the canyon | hung off a fixed diagonal, **cubed rather than linear**, over a span short enough that the near end keeps its color and only the head of the canyon washes to `air`. In this viewpoint it is the only substitute for perspective |
| the depth on screen, in feet | 1,925 ft at epoch 1, 4,200 at the opening frame, and **5,733 at a million years** |

The one that surprised, and it survives four reviews: **almost none of it was the height field.**
The first build's plateau carried 0.7-unit bumps eight tiles apart, which is a ±12% checkerboard
under `isoTerrain`'s relief and the same size as a bed, so the strata came out shredded into
diamonds. Long wavelengths at small amplitudes made the beds countable. Everything after that was a
shading axis, a shadow, a viewpoint, and a four-comparison snap in the height lookup — and the last
of those did more for the silhouette than any change ever made to the model.

---

## The bar disagrees with the world, and now says so

Throw the handle at a million years and the model is not there: it is a few hundred thousand years
back, re-running every step in between. That is the exhibit working — an epoch nobody has computed
has to be computed — and the card in the corner said so in words. The **bar** said nothing, and a
control that quietly claims to have arrived is worse than a caption nobody reads.

So the rail is drawn by the stylesheet rather than by the `<input>`, in three clipped copies of one
gradient:

```
0 ─────────── reached ─┈┈┈┈┈┈┈┈ asked ──────────────── 1,000,000 yr
  bright, run           hatched, queued                dim, not asked for
```

`hud.ts` writes two fractions as custom properties and `clip-path: inset()` does the rest, so the
gradient is laid out once at the full travel and never stretches, and no element's width is
animated. The hatch crawls while `data-behind` is set and stops when the model arrives. All three
insets are 6 px — half a thumb — because that is where an `<input type=range>` puts the centre of
its handle at either end, and a rail that disagrees with the thumb is a rail a visitor stops
trusting.

---

## What this exhibit does not do

No lighting (`draw.light` is untouched — the shading is `isoTerrain`'s relief plus this exhibit's
own shadow term), no sound, no depth sorter and no solids: the clutter is drawn inside the
terrain pass in anti-diagonal order, which a canyon wall needs and a row-major walk does not
give. Nothing is saved — the timeline is not a save, it is a re-run from a seed, which is the
whole point and precisely why it needs no store.
