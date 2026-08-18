# Terraces

**A hillside of stepped fields, and why picking must be terrain-aware.** One idea, shown with the
bug and the fix side by side: move the cursor and two diamonds follow it — green where you actually
are, red where a flat-ground pick believes you are. The HUD reads the gap between them in pixels.
Drag uphill and watch it grow.

```bash
npm run build          # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-terraces
# → http://localhost:5181
```

Deterministic: `?seed=` chooses the hill, and the same seed is the same hill, the same walls and the
same pixel, every time. `?aware=0` opens with terrain-aware picking already off; `?ceiling=` sets
where the terrain march starts. Every panel value is in the URL, so a bug report can be a link.

---

## The one idea

In a 2:1 isometric projection, screen → grid is a linear inverse **only on the plane `z = 0`**.
Raise a point by `HALF_H` world pixels and it lands on exactly the same screen pixel as the point
one unit of `gx + gy` further from the viewer at sea level. So a screen pixel does not name a tile;
it names a whole *family* of candidates, one per elevation.

| | the call | what it assumes | what it costs |
|---|---|---|---|
| naive | `iso.screenToTile` | the ground is flat and at zero | two multiplies and two floors |
| terrain-aware | `iso.screenToTileOnHeights` | nothing | a march down the heightfield from a ceiling, then twelve bisections |

The naive answer is not a straw man. It is the *exact* inverse of the projection at `z = 0`, and it
is what `@latticekit/input` writes into `gx`/`gy` on **every action event it fires** — so an exhibit
that read `event.gx` would ship this bug without ever choosing to. That is why `main.ts` re-picks
from `event.sx`/`event.sy` and why the first finding below is the one it is.

**Which way the error goes, because it is not the intuitive one.** The naive answer has a *smaller*
`gx + gy`: it is the tile the ray crosses at sea level, which is further from the viewer, and it is
then drawn on its own — higher — ground, so both errors point the same way. On this hill that is
several terraces *up* the slope from your finger. The error in screen pixels is roughly the
elevation under the cursor: about 250 px where the exhibit opens, and over 1,400 px at the ridge.
Lamp Road hit the same bug and reported it as *"212–237 px"*.

**Tap to plant a stake.** With terrain-aware picking on, the stake lands under your finger. Turn it
off — the button under the frame, or the toggle in the panel — and the stakes land uphill of where
you asked, by more the higher you are. That is the whole exhibit, and it takes one click to see.

**The march ceiling is a slider, because it has a documented wrong end.**
`screenToTileOnHeights` says a `maxHeightPx` that is too small *"begins the march below a peak and
misses it"*. Drag `march ceiling` down and the green diamond falls back down the hill exactly as far
as the ceiling is short. At 0 it is precisely the naive pick, which is a pleasant thing to be able to
see rather than to be told.

---

## The line rule

`npm run gallery` measures it. **198 logic / 440 art — 69% art, under the 200-line cap.**

| module | | |
|---|---|---|
| `main.ts` 80 | **logic** | wiring, the frame, the panel, the frame meter |
| `hill.ts` 43 | **logic** | the terraced height field and the props standing on it. It is the map picking reads |
| `hud.ts` 44 | **logic** | reads state, formats it, owns the button |
| `pick.ts` 31 | **logic** | the two answers and the distance between them. Thirty lines, and it is the exhibit |
| `fields.ts` 169 | *art* | the terrain pass: terraces, walls, crops, water, the air in front of the far ones |
| `props.ts` 100 | *art* | trees, sheds, stooks, hedges, and seventy-two people |
| `markers.ts` 74 | *art* | the two diamonds, the dashed run between them, the stakes |
| `palette.ts` 22 | *art* | one hour, held |
| `place.ts` 10 | *art* | one grid vertex at one elevation, in `draw`'s coordinate space |
| `index.html` 65 | *art* | the overlay's whole appearance |

`test/cull.test.ts` is not counted: `tools/gallery.mjs` scans `src/` only, which is the right
scope — an exhibit should not have to choose between its budget and its tests.

---

## Cost

`docs/GALLERY.md` § Scale makes 60 fps a gate. Measured at 1440×857, `devicePixelRatio` 2, with the
panel open and several other exhibits' dev servers running:

| | |
|---|---|
| `loop.stats.frameMs` (pump CPU) | **0.4 ms** — 5% of the 8 ms budget |
| worst gap between painted frames, last 10 s | **13.3 ms** |
| terrain tiles painted per frame | ~1,200 |
| props sorted per frame | ~370 of 3,832 on the map |

The first build measured **93.9 ms**. Neither the sprite count nor the light count was the reason —
there are no lights here at all. It was two full-map traversals per frame, and both are worth
writing down because neither is visible in a profile as anything but "the renderer":

1. **`renderFrame` hands the Terrain pass a margined tile *box*.** The margin is correct — a
   summit's base can be off the bottom of the frame while the summit is on it — but it is applied
   to both axes of a box, and elevation only moves a tile along `gx + gy`. On terrain 1,470 px tall
   that box measured **26,569 tiles for a frame that paints 1,201**. `fields.paintHill` now walks
   `u = gx + gy` and `v = gx - gy` directly: same coverage, **3,081 visits**, and ascending `u` is
   strictly far-to-near, which row-major order only accidentally is.
2. **Every prop was handed to `DepthSorter` every frame** — 3,832 of them, five index sorts, to
   throw away 92%. `props.fillProps` now culls first. See finding 7 for why that is safe here and
   `test/cull.test.ts` for the proof.

The far band is also cheaper, which `docs/GALLERY.md` explicitly permits: three crop rows per tile
near, one in the middle distance, none in the mist; trees drop their second canopy lobe; walls drop
their shadowed foot.

---

## Where the kit fought back

Ranked by how much pain each caused.

**1. `@latticekit/input` resolved every pointer on flat ground and could not be told otherwise.**
**Fixed — this is K44, and it is what this exhibit was for.** `ActionEvent` carries `gx`/`gy`,
`input` filled them through `worldToTile`, and there was no seam anywhere in `InputOptions` for a
`HeightField`; the coordinates on the event were the *wrong* answer on any map with elevation —
silently, plausibly, and by more the taller the terrain. The fix landed as one optional field,
`createInput({ terrain: { field, maxHeightPx } })`, with two things this row did not ask for and
should have. `terrain: 'flat'` is a *declaration* rather than a default, so a level world says so
in one word; and a system that was told nothing raises one `flat-ground-pick` diagnostic the first
time a coordinate is actually read — which is the "the honest thing would be for `input` to warn
once, but it cannot know" line above, answered. It cannot know your terrain, but it can know that
nobody said.

This exhibit declares it too, and **nothing else here changed**: `pick.ts` still computes the naive
answer and the marched one side by side from `event.sx`/`event.sy`, because computing both *is* the
exhibit. `input` reports one tile per event, and a row whose whole subject is the gap between two
answers has to hold both.

**2. ~~There is no hover.~~ Withdrawn — there is, and it is a query rather than a gesture.**
`GestureMap` has six members and none of them is a pointer position with no button down, which is
correct: continuous input in this package is *asked for*, and `input.hoverTile(out)` is the ask. It
resolves through the same picker every gesture uses, so with `terrain` declared it is terrain-aware
for free and a highlight cannot disagree with the tap that follows it. `examples/clay` has deleted
its raw `pointermove` listener for exactly this reason. This exhibit keeps its own listener, because
what it needs is not the tile but the *screen point*, twice, at two different ceilings.

**3. `bootstrap` owns the loop's clock and exposes no `now()`.** `@latticekit/ui`'s `createOverlay`
requires *the clock `loop` was given*, and `bootstrap` builds the loop with
`{ now: () => performance.now() }` and hands back neither the clock nor a reader. Every exhibit
that mounts a `ui` overlay therefore writes `performance.now()` in its own source — the exact call
the determinism rule bans — and `examples/island` does. This one uses `boot.loop.realTime * 1000`,
which is correct and is not obvious. `Boot` should expose `now`.

**4. `HeightField.heights` is a `TileSource`, and a `TileSource` cannot be iterated.** The interface
is `get` and `has`; `forEach(range, fn)` is on the `TileGrid` class. So a game holding a
`HeightField` — which is what every terrain API in the kit takes — cannot walk it, and `Hill` ends
up carrying the same grid twice under two types. Either `TileSource` grows `forEach`, or
`HeightField` carries the source it was built from.

**5. `TileGrid.forEach` passes no context.** Its own doc comment tells callers to hoist the visitor
rather than allocate one per frame, which means the pen and the world have to reach it through
module-level variables. Two of the three exhibits that walk a grid have written the same four lines.
A `forEach(range, fn, ctx)` — or a plain iterator — removes them.

**6. `draw` publishes no projection that includes the pen's snap offset.** `iso.gridToScreen` is
public and correct; every primitive in `draw` adds `pen.snapX`/`pen.snapY` on top of it through an
internal `put` that is not in the barrel. A game drawing any geometry of its own beside the kit's —
a marker diamond, a crop row, a stake — either adds the offset by hand or draws in a space a
fraction of a pixel away from everything around it, and the symptom is a highlight that crawls
against its own tile during a pan. `place.ts` is that helper, written for the fourth time in this
gallery.

**7. `DepthSorter` culls, and a game that wants to cull earlier has to re-derive the same box.**
`#cull` inlines `footprintBounds` and calls `Camera.isVisible`, which slackens the viewport by
`TILE_W` on x and `TILE_H` on y — none of which is reachable from outside. Culling before `add`
is the strongest performance lever a large world has, and getting it *wrong* is the mis-pick
`docs/SEAMS.md` pins. `props.ts` re-derives the four numbers by hand and proves the result in
`test/cull.test.ts`; a `DepthSorter.wouldKeep(camera, gx, gy, w, d, heightPx)` — or simply making
the cull's own predicate public — would make that safe by construction for everyone.

**8. `CameraOptions` is construction-time and unreadable.** No `minZoom` getter, no `keepVisible`
getter, so the control panel keeps a shadow copy in `examples/_shared` and every knob that moves one
rebuilds the camera and the input system. Already known and already filed by the shared bootstrap;
this exhibit is the third consumer to pay for it.

**9. `docs/GALLERY.md` § Scale cited a `draw` sprite cache that does not exist.** Corrected during
this task by the caverns agent. Noting it only because the correction is load-bearing: with no
cache, "cache it" is not one of the four levers, and *measure first* has to be.

### Not a finding, but worth recording

`screenToTileOnHeights` is **exactly right**, and it is the one function in the kit this exhibit
exists to stress. Its fixed iteration count rather than a tolerance is the detail that matters —
a march that stopped when it was "close enough" would resolve the same tap differently on a slow
phone and a fast desktop, which is a replay divergence with no stack trace. It is also the only
function here whose doc comment described a failure mode (`maxHeightPx` too small) precisely enough
to be turned into a slider without reading the source.

---

## What this exhibit does not do

No day cycle, no economy, no save, no sound. `@latticekit/sim` and `@latticekit/persist` have nothing to
do here, and `@latticekit/audio` is left out for the reason `island` gives: a page that starts making
noise before it has been touched is worse than a silent one, and the gallery still has no shared
answer for the unlock gesture. The light field is created by `bootstrap` and never used — this is a
mid-afternoon exhibit and `LightField` costs nothing at zero darkness.
