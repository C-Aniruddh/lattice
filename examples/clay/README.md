# Clay

**The ground is material: push it up, cut it down, and watch water, paths and everything standing
on it resettle under your hand.** `iso.height` · `iso.path`

```bash
npm run build                       # the exhibits render against each package's dist, not its src
npm run dev --workspace=@latticekit/example-clay
# http://localhost:5196/  ·  ?seed=riverbed
```

Drag on the ground. It rises under your finger. Drag a ridge across the river and the river backs up
behind it into a lake, finds the lowest lip you left, and goes around; the walkers crossing the
valley re-plan; the trees ride the ground up and let go of it once you make it too steep; the new
face catches the sun and the other one goes into shadow. Hold **shift**, or press **CUT**, and the
same drag takes it away. Arrow keys pan, the wheel zooms — the drag belongs to the brush.

---

## The one idea

`Canyon` and this exhibit make the same claim — **terrain in this kit is a live field, not a fixed
asset** — and `docs/GALLERY.md` keeps both because they make it in opposite ways. Canyon shows the
change happening *to* the world over a million years, and it took four rebuilds to make legible,
because a scrub bar asks a visitor to notice that a picture differs from one they saw ten seconds
ago. Clay puts the change **under the visitor's finger**, where noticing is not something anyone has
to be asked to do.

So this exhibit is not trying to be the beautiful one. It is trying to be **unmistakable**, and
every design decision below was taken in that order.

---

## The brush, and what one drag actually mutates

One brush. Drag raises, shift-drag (or the CUT button) lowers. There is no size control, no second
brush, no undo, no save — `docs/GALLERY.md` names *building a tool rather than an exhibit* as the
trap and those four are exactly how it starts.

**A stroke writes to one array and nothing else.** `sculpt` adds `RATE · dt · (1 − d²/r²)²` to every
vertex of `Clay.terr` inside 4.6 tiles of the pick, clamped into `[1, 100]`, and returns. That is
the whole mutation. Everything else on screen is downstream of that one array:

| | how it finds out |
|---|---|
| the water | it re-solves against `terr` on the next of the frame's five steps. Nothing tells it |
| the walkers | `touch` marks the routes whose polyline the stroke crossed, and repaints the router's cost bytes over the brush's own box |
| the trees, rocks and huts | they are a *pure function* of `heightAt` and `slopeAt`, so they were never anywhere else |
| the light | `isoTerrain` reads the four corners it is about to draw |

The falloff is squared rather than linear because a linear one has a corner at the rim of the brush,
and `isoTerrain`'s relief term reads exactly that corner and draws a hard ring around every stroke.

**`RATE` is 9 height units per second, and it was 30.** Thirty is too fast to sculpt with: a
two-second stroke reached the ceiling and produced a flat-topped wall with vertical sides, which is
not a landform, it is the exhibit having one setting. The ceiling moved too — `MAX_UNITS` was 58,
twenty-four units above the valley floor, and a clamp is a plane, so every hill became a mesa. At
100 the ceiling is somewhere a visitor arrives on purpose.

---

## Water, which is the row that had to work

**`terr` is rock and `wat` is the depth of water standing on it, on the same grid vertices; the
water surface is the sum.** That one decision is why the convincing behaviors need no code:

| | because |
|---|---|
| cut a channel and the river moves into it | the surface is lower there, so the next step sends water there |
| dam it and a lake forms *behind* the dam | water arriving has nowhere lower to go, so depth accumulates until the surface clears the lowest lip |
| the lake finds a new outlet and drains | that lip is found by the same arithmetic, with no spillway logic anywhere |
| a lake's shoreline is a contour of the terrain | it is one, exactly: the set where `terr` meets the pooled surface |
| raising ground under a lake makes an island | the water is still there, it is simply no longer above that vertex |

The solver is one relaxation: every wet vertex gives away a fraction of its water, **split in
proportion to how much lower each of its four neighbors' surfaces is**. Jacobi rather than in place,
because a row-major in-place sweep moves water several tiles down-grid per pass and one tile up-grid,
so the same river flows visibly faster one way than the other — an artifact of the loop order wearing
the costume of a physical law. Proportional splitting rather than steepest descent, because
steepest-descent rivers run in perfect grid staircases.

### The one that took a rebuild: a leveling term is not a flow

The first build moved `total · 0.25` — pure leveling — and **the river reached about forty tiles and
then vanished**. The reason is structural: a leveling transfer's throughput is set by the *drop*, not
by the *depth*. On a valley floor falling 0.062 units per tile, the most that can move downstream per
cell per step is about 0.0096 units, no matter how much water is poured in. Everything above that
maximum simply pools at the spring, and the rest of the valley is dry.

Water on a slope has to **advect**. `RUSH` carries 0.3 of a vertex's own depth downhill every step on
top of the leveling term, split between the same lower neighbors, so throughput scales with depth the
way a channel's does. It cannot destabilize, and the reason is structural rather than tuned: the
total given away is still clamped to `w`, and every share goes to a neighbor whose surface is
*strictly lower* — so a level pool has `total = 0` and moves nothing, whatever `RUSH` is.

The second half of the same fix is in the generator rather than the solver: two Lorentzians on one
centre line, a wide valley and a **narrow bed cut into it**, because water with nothing to confine it
spreads across thirty tiles of valley floor as a sheet nobody can see.

### What it costs

| | |
|---|---|
| one water step, 25,921 vertices, ~890 of them wet | **0.146 ms** |
| five steps a frame — the frame's whole water budget | **0.73 ms** |
| what makes that affordable | a dry vertex costs three operations and leaves, so the loop's real bound is the wet count and not the grid |
| the terrain walk | 10,183 tiles visited against a 38,809-tile bounding box — the `u`/`v` interval walk and the per-tile floor and ceiling tests are what take it there |
| warm-up before the first paint | 2,400 steps, about 200 ms of the 256 ms the module takes to evaluate |
| dam break front | five tiles a frame — fast enough to read as immediate, slow enough to watch |

`Clay.wetCount` is on the HUD, which is both the water's whole story in one integer and the honest
bound on what the solver is costing.

---

## Paths, and the question no other exhibit has had to answer

`docs/GALLERY.md` says a walker re-routing around a ridge is the thing **nothing else in the gallery
exercises**. `Wayfinding` re-routes a crowd when the map changes; it does not have a visitor changing
it sixty times a second with their finger. A `Path` here is a curve computed against a map that moves
*while a walker is partway along it*.

There are three honest policies and two of them are wrong:

| policy | why not |
|---|---|
| recompute every walker every frame | sixteen searches a frame, nearly all re-deriving a route nothing touched. The answer that looks safest and spends the frame on nothing |
| recompute round-robin on a timer | bounded, and blind: a stroke drawn straight across a route waits its turn while the walker climbs a cliff that did not exist a moment ago |
| **recompute the routes the stroke actually crossed** | what is built |

**The stroke knows where it struck.** A `Path` from `PathFinder` has a node per tile, so *did this
stroke land on this route* is a squared-distance test per node — sixteen routes of about thirty nodes
is 480 comparisons, roughly a thousandth of one search. Crossed routes are marked stale and replanned
at **two a frame**; routes the stroke missed are never considered at all.

**What that leaves, stated rather than hidden.** A walker whose route was crossed keeps walking the
stale one for `ceil(marked / 2)` frames — one frame in the common case, eight in the worst case of a
stroke that crosses every route at once, so up to 130 ms of a walker heading at a hill that now
exists. It is invisible because the hill is still growing under the finger that is making it. The
same budget spent round-robin would cost the same 130 ms **for a stroke nowhere near anybody**, which
is the whole of the difference. A walker keeps its position across a replan and loses only its
progress, because `s` is an arc length along whichever curve it holds and the new curve begins under
its feet — that part `iso.path` gives away free.

### The router reads a byte per tile

`TileCost` is called once per examined neighbor, and the obvious implementation — sample the height
field, take `slopeAt`, divide — makes every one of those a bilinear read. Measured on the eight legs
these walkers actually use, over this map:

| cost function | mean search | worst |
|---|---|---|
| computed live from the height field | **2.18 ms** | 8.9 ms |
| read from a baked `Uint8Array` | **0.51 ms** | 2.0 ms |
| constant `1` everywhere | 0.13 ms | 0.5 ms |

So the grid is baked, and repainted in exactly two places: the box the brush struck, on the stroke
that struck it, and **a rolling eighth of the map every frame**, which is what carries a rising lake
into the router without anybody having to notice it rose. The whole map refreshes in eight frames and
the brush's own box never waits at all.

**The third row of that table is a finding about `iso` and not a curiosity** — see below.

### Fords, and twelve stranded walkers

The first build made water above 0.55 units impassable, and the opening frame was **twelve stranded
walkers out of sixteen**, because the posts alternate across the valley and the river runs the length
of it. Blocking is now reserved for water a person could not walk through — 2.4 units, which is a
dammed lake and nothing else here — and depth *costs* rather than blocks below that. Every route
therefore seeks the shallowest crossing it can find, so the walkers converge on **fords**, and the
fords move when the visitor moves the river. That is a better demonstration than the rule it replaced.

A walker who is genuinely walled in stays walled in, and the HUD counts it. It re-asks once per full
sweep of the cost grid rather than every frame, which is also what lets a lake draining on its own
free a walker nobody went back for.

---

## Things standing on it, and why none of them are stored

**2,200 trees, boulders and huts**, about three hundred of them in frame, and there is no list of
them anywhere. A prop is a pure function of its index and the live height field —
its tile from `hash2`, its base from `heightAt`, and how far it has slid from `slopeAt`.

That is worth more than the line-rule classification it happens to buy. A stored slide has to decide
*when* to run, and therefore has a wrong answer available to it: props that settle on the frame the
brush struck and on no frame between. A derived one cannot lag by construction — and lower the ground
back and the tree stands up again, which is the half nobody implements. Past 1.25 units of rise per
tile a prop starts to go over, drifting down the fall line and flattening as it goes; past about 2.6
it is a log lying on the scree. Flood a wood and the trees go under; drain the lake and they are
standing there again, because nothing was ever destroyed.

---

## The light, and the `draw` finding this exhibit could not avoid

> **`isoTerrain` shades a tile by `east − west`, which is the screen *horizontal*.** A landform whose
> gradient runs along the other diagonal has a relief term of exactly zero and renders flat-shaded,
> with no error and nothing to grep for.

`Canyon` paid two rebuilds for this and reported it. There it was survivable, because a canyon has
one axis and an author can turn it. **Here it is not survivable at all, and that is the sharper
version of the finding: the visitor chooses the axis.** A ridge dragged across the screen runs along
`gx − gy`, its gradient runs along `gx + gy`, and under the kit's own relief that ridge is invisible —
while the identical ridge dragged the other way is fully shaded. An exhibit whose entire subject is
*the thing you just made* cannot ship a renderer in which half of what you make does not appear.

One subtraction — `north − south`, supplied through `isoTerrain`'s `tint` — is the whole fix, and the
two axes together are a full two-axis relief. **The relief axis wants to be an option on
`HeightField`**, and until it is, every exhibit with a player-chosen landform will write this same
line.

Two things beside the relief, both of which were needed:

- **The ground is banded by height as well as shaded by slope.** Relief reads a *slope*; a broad
  gentle dome has almost none anywhere on it, so under shading alone a visitor who raises one sees
  nothing until it becomes a cliff — which is the exhibit failing at its first gesture. Five bands
  from silt to bare rock give elevation its own axis, measured against the valley's own datum rather
  than against absolute elevation, and interpolated over sixteen quantized stops. Hard bands were the
  first build and they produced a **mosaic of flat diamonds**: on a field with any roughness at all,
  adjacent tiles land either side of a boundary. It is the color version of the triangle problem
  Canyon paid three rebuilds for.
- **The tint sits at 0.88 on flat ground, and the number was measured off the canvas.** `isoTerrain`
  adds up to ±0.32 of its own relief to whatever tint it is handed, so a flat-ground tint of 1 puts
  the brightest lit face at 1.5 — and `shade` at 1.5 on a pale rock clips. A fresh mountain sampled at
  four separate points came back `255, 249, 212` at every one of them, which is not a highlight, it is
  a hole in the image where the shading used to be.

---

## `ActionEvent.gx/gy` is a flat-ground answer, and this is the worst case for it

`@latticekit/input` resolves a pointer through `worldToTile`, the exact inverse of the projection **on
the plane `z = 0`** — the only plane it inverts. It has no seam for a `HeightField` and no way to be
handed one, so `gx`/`gy` on every gesture and every action it fires assume the ground is flat.
`Terraces` measured that at 281 px and 14 tiles on a static hillside and filed it as **K44**.

Here it is worse than static, in a way no other exhibit can reproduce: **the error moves as the
visitor sculpts.** Raising ground under the cursor pushes the true tile toward the viewer, so a brush
driven by `event.gx` walks *away* from the finger exactly as fast as the ridge grows — you make a hill
and the brush slides off the far side of it while you hold still.

**The workaround and what it cost:**

| | |
|---|---|
| the call | `screenToTileOnHeights(camera, sx, sy, clay.land, MAX_UNITS · STEP_PX, out)`, from `sx`/`sy` and never from `gx`/`gy` |
| where | once per **update**, against the field as it stands *this* step — not once per gesture, because the ground moves between the top of a stroke and the bottom of it |
| what it costs | one terrain march: `ceil(1400 / HALF_H)` = 88 steps plus 12 bisections, about 400 bilinear samples, **under 0.05 ms**, paid whether or not the brush is down because the ring has to sit on the ground either way |
| the second half of it | `tileSourceOf` answers `has` with `true` **everywhere**, and `has` is `screenToTileOnHeights`'s only off-map test — so the `TileSource` had to be hand-written with a real bound, or a tap on the sky sculpts grid (−4000, 900) |

Three code lines and one hand-written `TileSource`. Cheap to work around, invisible if you do not,
and the failure it produces on moving ground looks like the brush is broken rather than like the
coordinate is wrong.

---

## What it costs

Measured in this exhibit's own HUD and in `loop.stats`, at 1440 × 813 CSS pixels, device ratio 2,
with seven other gallery exhibits live in the same browser.

| | frame | update | render | worst gap / cadence | fps |
|---|---|---|---|---|---|
| **idle** — water flowing, sixteen walkers, ~300 props | **4.99 ms** | 0.19 | 4.80 | 20.7 / 4.6 ms | 122 |
| **mid-stroke** — a six-second drag across the valley | **10.14 ms** | 5.03 | 5.10 | 27.0 / 4.7 ms | 113 |

`update` while sculpting is almost entirely the two A\* searches; the water is 0.73 ms of it and the
terrain march under 0.05.

A pixel-ratio sweep says where the cost is **not**, and it disagrees with `Canyon`:

| `dpr` | render |
|---|---|
| 0.5 | 4.77 ms |
| 1 | 5.01 ms |
| 2 | 4.91 ms |

Canyon measured 7.95 → 16.21 ms across the same sweep and concluded that a full-frame terrain is
fill-bound. This one is flat, so **this workload is op-bound**, and the draw-call census says why.
Counted on the live surface, one frame at the opening camera:

| call | per frame |
|---|---|
| `poly` | **7,763** — terrain quads, water quads and every box face |
| `polyRamp` | 921 — one cylinder body each, plus the sky |
| `ellipse` | 1,318 — cylinder caps |
| `stroke` | 245 |
| | **10,247 draw calls**, against 627 sorted solids and 10,183 tiles visited by the terrain walk |

Ten thousand small calls is an op-bound frame by construction; Canyon's is 5,510 calls of which the
terrain quads are individually much larger and carry per-tile strokes. Both numbers are right, and
"a full-frame terrain is fill-bound" turns out to be a property of Canyon's terrain pass rather than
of terrain.

> **A caveat on how these were taken, because it invalidated the first set entirely.** This gallery's
> automation drives Chrome with the exhibit in a **hidden** tab, where `document.visibilityState` is
> `"hidden"` forever, `requestAnimationFrame` never fires, and the loop reports a confident
> `0.0 ms` — and, worse here than elsewhere, a fixed-step loop that is being pumped by a throttled
> timer reports an `updateMs` of 9.2 ms for work that measures 0.19. **A frame readout of exactly
> zero is a hidden tab and not a fast scene, and every other number beside it is also wrong.** The
> figures above were taken with `rAF` shimmed onto a `MessageChannel`, which visibility does not
> throttle. Every frame then costs its own work with no display idle in it, so the *gap* is the work:
> a pessimistic reading, and the only honest one available without a visible window. It is also why
> the cadence reads 4.6 ms rather than a display period — the worst gap should be read against the
> 16.7 ms a 60 Hz frame has, which both rows clear.

Radial-gradient allocations per frame: **0**. Nothing here calls `softEllipse` or anything built on
it, so § Scale's animated-color trap cannot fire — but the colors are snapped anyway, because the
trap's cause is present in full: every ground color is a continuous function of a height a finger is
moving. Nine levels of light, six of haze, eight of water depth and sixteen ramp stops is a bounded
set of solid fills; the *geometry* stays perfectly continuous, which is the half a visitor can resolve.

---

## The map is 160 tiles because of the diamond, not because of § Scale

The first build used 96 and produced § Scale's own named failure — **a hard corner with background
behind it** — at the opening zoom, with no camera position that avoided it. The arithmetic is worth
writing down, because it is a property of every square-gridded isometric world and not of this one:

A square grid projects to a **diamond**. A viewport of `w × h` centred at `(cx, cy)` stays inside a
diamond of half-width `W` and height `H` only if `|cx| + w/2 ≤ 2·(cy − h/2)` **and**
`|cx| + w/2 ≤ 2·(H − cy − h/2)`. Add the two and the camera drops out: `w ≤ 2H − 4h`. At 96 tiles
that is 3,044 world pixels against a 2,939-pixel frame — satisfiable at exactly one camera position,
which is not a world, it is a photograph. At 160 the same inequality leaves 1,950 pixels of vertical
camera travel and 3,400 of horizontal, which is what `REACH` is.

### § Scale, row by row

| row | here |
|---|---|
| **extent** | 10,240 × 5,120 world pixels against a viewport of about 2,940 × 1,550 — three and a half viewports on the long axis, with the head of the valley and its mouth both off screen |
| **fill** | the ground reaches every edge; the only background is the strip of air above the far upland, under a sixth of the frame |
| **edges** | the camera is penned inside the diamond's inscribed rectangle, so no pan ever finds a corner, and the far ground dissolves into `air` over twenty-two diagonals of haze rather than ending |
| **density** | 2,200 trees, boulders and huts scattered over the map and **627 solids in the sorted frame**, sixteen walkers, and a terrain pass that visits 10,183 tiles |
| **depth** | three bands — the near upland at full saturation, the valley with the river in it, the far upland washing into `air` |
| **cost** | the table above. A gate, and it clears |

**The one row this composition deliberately does not honor in spirit is extent's second sentence.**
The first gesture here is not an invitation to go and look; it is a drag, and a drag sculpts, because
`gesture.claim()` takes every drag away from the camera controller before it reaches it. Panning
moves to the arrow keys and the pinch. An exhibit whose subject is *what your finger does* cannot make
the finger do something else first, and that trade is stated rather than hidden.

---

## The line split

`npm run gallery`:

```
clay          198 logic    349 art   64% art   ok, 2 to spare
   logic  clay.ts  62   hud.ts  25   life.ts  59   main.ts  51
   art    ground.ts 83  palette.ts 37  props.ts 122  readout.ts 25
          view.ts  35   index.html <style>  47
```

The four logic modules are the material, the walkers, the numbers on the overlay and the wiring.
`ground.ts` and `props.ts` are the two that took the most thought to classify and both are honestly
art: delete either and the ground still deforms, the water still finds its way and every walker still
replans the routes the brush crossed. `props.ts` in particular holds **no state at all** — see above —
which is what makes it art by the rule rather than by argument. `readout.ts` is the overlay's fixed
element tree, art under § *Static markup is art*; every listener and every `setText` stayed in
`hud.ts`, which is where that section puts them.

Two to spare is tight, and it was 261 before a compression pass that joined statements without
removing any. The next thing this exhibit needs would have to buy the room from `main.ts`.

---

## Where the kit fought back

Ranked by how much time each cost.

1. **`PathFinder`'s heuristic ignores the weights, and weights are 17× (`iso.path`).** The integer
   octile metric has no weight in it, so the moment a `TileCost` returns anything above `1` the
   heuristic stops being tight and A\* slides toward Dijkstra. On identical geometry: 0.13 ms mean
   with a flat cost, 2.18 ms with a weighted one — and the weighted map is the documented way to say
   *shorter but harder*, which the package's own doc comment recommends. Nothing warns you, and the
   symptom is a frame-time cliff that appears the day you add a second weight. A weighted heuristic
   (scale the octile estimate by the map's minimum weight) would be admissible and free.
2. **`isoTerrain` reads one of the two diagonals (`draw`).** Filed by `Canyon`; this exhibit is the
   case where it cannot be worked around by turning the landform, because the player turns it. One
   subtraction through `tint` is the fix at every call site that will ever need it, which is the
   argument for it being a `HeightField` option.
3. **K44 — `ActionEvent.gx`/`gy` is the flat-ground answer (`input`).** Table above. The new
   information this exhibit adds is that on *moving* ground the error is not a constant offset, it
   tracks the height under the finger, so the brush drifts while the visitor holds still.
4. **`tileSourceOf` answers `has` with `true` everywhere (`iso`).** That is documented and correct for
   an unbounded procedural world, but `screenToTileOnHeights` uses `has` as its *only* off-map test,
   so the two compose into a pick that never returns `false`. A `boundedTileSource(get, w, h)` beside
   it would close it; as it stands, every bounded heightfield exhibit hand-writes the same six lines.
5. **`@latticekit/ui` has no button, no toggle and no segmented control.** `Canyon` reported the same
   absence about a slider. Two exhibits needing two different missing primitives is a finding rather
   than a coincidence: the package ships `roll`, `panel`, `toasts`, `floats`, `thumbnails` and
   `acknowledge`, and an exhibit's *one control* is usually none of those. Every millimetre of this
   exhibit's RAISE/CUT pair is CSS in `index.html`.
6. **No `camera.setZoom`, so a chosen zoom is a fabricated rectangle (`iso`).** Filed by `Canyon`;
   hit again from a cold start, in the same three lines. The absence is not obvious until you look
   for it.
7. **No hover gesture (`input`).** Six gestures and none of them is a pointer that is not pressing.
   The brush ring has to follow the cursor, so this exhibit adds a raw `pointermove` listener —
   `Terraces` reported the same gap for the same reason.
8. **`bootstrap` exposes no `now()` (`examples/_shared`).** `@latticekit/ui` requires the clock `loop`
   was given and the kit bans reading `performance.now()` in exhibit source, so the overlay is driven
   from `boot.loop.realTime * 1000`. Reported by `Terraces` too.

---

## What this exhibit does not do

No lighting (`draw.light` is untouched — the shading is `isoTerrain`'s relief plus this exhibit's own
second axis), no sound, no save, no undo, no brush size, no second brush. Nothing is persisted:
`?seed=` is the only thing that chooses a valley, and reloading is the reset.

It does not use `sim`, `persist` or `audio`, and it uses `input` for exactly two things — claiming
the drag away from the camera, and `held('cut')`.

**And it does not snap its vertices.** `Canyon`'s bench snap exists because canyon country is
flat-topped and a continuous field on a diamond grid renders as triangles. Clay is the case where
that fix would be *wrong*: this ground is meant to be soft, and the one thing a visitor must be able
to see is the difference between what they have made and what they have not. Steep faces are
therefore faceted, and they read as scree rather than as a bug — but an exhibit that wanted a
flat-topped result from this brush would need Canyon's snap, and would need it in the render.
