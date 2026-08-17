# @latticekit/draw

> One color and one grid footprint into a stylised isometric solid, on a surface it does not own.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @latticekit/draw
```

The two halves of that sentence are the two things this package is for.

**One color** is the art direction: three-tone faces derived from a single hex, cool shadows,
warm highlights, a silhouette stroke on everything. There is no `leftColor`; offering one is
offering the caller a way to break the look.

**A surface it does not own** is the engineering: nothing in this package, and nothing above it,
ever holds a `CanvasRenderingContext2D`. So the same code paints the world, a shop thumbnail and
a golden test — and a WebGL backend can replace the Canvas2D one without a sprite noticing.

```ts
import { beginFrame, createCanvas2dSurface, endFrame, isoBox, isoTile } from '@latticekit/draw';

const surface = createCanvas2dSurface(canvasEl);
const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });
isoTile(pen, 4, 7, 'ground');
isoBox(pen, 4, 7, 2, 2, { color: 'brand', h: 3 });
endFrame(pen);
```

---

## A whole frame, run in Node

This is the program in `test/readme.test.ts`, and the numbers under it are what that test
asserts. **There is no canvas anywhere in it** — the recording backend is a `Surface` that keeps
a log of draw commands and a digest rather than pixels, which is what makes golden tests
possible on a machine that has no browser.

```ts
import {
  DepthSorter, boxSilhouette, createCamera, footprintBase, pickSorted, pointInPolygon, tileSourceOf,
} from '@latticekit/iso';
import {
  BASE_SLOTS, DAY, NIGHT, VARIANT_ZERO, beginFrame, createLightField, createPalette,
  createRecordingSurface, defineSprite, drawSprite, endFrame, glowDot, hexOf, hsl, isoTerrain,
  renderFrame, spriteBounds, spriteHeightPx, spriteVolume,
} from '@latticekit/draw';

// ── the art: a sprite a game owns, without forking the kit ─────────────────────
const WATER_TOWER = defineSprite({
  id: 'water-tower',
  w: 2,
  d: 2,
  // Static art. `rng` is freshly seeded from `v.seed` by the kit on every call, so a rack
  // cannot reshuffle its LEDs on reload and a replay from a seed lands on the same pixel.
  massing(s, v, rng) {
    s.shadow(0, 0, 2, 2);
    for (let i = 0; i < 4; i++) s.post(0.3 + (i % 2) * 1.4, 0.3 + (i > 1 ? 1.4 : 0), 0, 3, 'metal');
    s.cylinder(1, 1, 0.8, { color: 'brand', h: 1.4, z: 3 });
    if (v.level > 2) s.post(1, 1, 4.4, 1, 'metal');
    if (rng.next() > 0.5) s.glow(1, 1, 4.4, 'warn', 0.12);
  },
  // Live art, over the static art, every frame. `pen.t` is the only clock, and it arrived as a
  // parameter — nothing in this package reads one.
  animate(pen, gx, gy, v, rng) {
    const lit = (pen.t * 1.4 + rng.next()) % 1 < 0.5 ? 1 : 0.2;
    glowDot(pen, gx + 1, gy + 1, 4.6, 'warn', 0.14, lit * (v.level > 2 ? 1 : 0.6));
  },
  // The light it throws into the night. Runs only when the frame has one, and pools it on the
  // ground the tower stands on — `zPx` is the elevation `drawSprite` was given, passed through.
  emit(lights, gx, gy, _v, _rng, zPx) {
    lights.add(gx + 1, gy + 1, zPx, 4, 0.9, 'warn');
  },
});

// ── the palette, recoloured to a player's brand hue ────────────────────────────
const palette = createPalette(BASE_SLOTS);
palette.set('brand', hsl(28, 0.62, 0.54)); //   one number in the save, never a derived token
console.log(`brand: ${hexOf(palette.get('brand'))}, palette rev ${palette.rev}`);

// ── the ground: one height per grid *vertex*, so tiles share corners exactly ────
const ground = {
  heights: tileSourceOf((_gx, gy) => Math.max(0, 5 - gy)),
  stepPx: 8, //   world pixels per height unit: a ridge 40 px above the shore
};

// ── the frame ──────────────────────────────────────────────────────────────────
const surface = createRecordingSurface(480, 300); //   no canvas: this runs in Node
const camera = createCamera(480, 300, { bounds: { minX: -400, minY: -200, maxX: 400, maxY: 600 } });
camera.centerOnTile(3, 3);
const light = createLightField(surface);

// Deliberately not in depth order: the sorter decides that, and it is the only thing that does.
// `base` is the ground under each footprint: the *maximum* vertex height under it, because a
// building resting on the mean of a slope has one corner buried in the hill and one floating.
const buildings = [
  { gx: 1, gy: 5, v: { ...VARIANT_ZERO, seed: 3 } },
  { gx: 0, gy: 0, v: { ...VARIANT_ZERO, seed: 1 } },
  { gx: 4, gy: 1, v: { ...VARIANT_ZERO, seed: 2, level: 3 } },
].map((b) => ({ ...b, base: footprintBase(ground, { gx: b.gx, gy: b.gy, w: 2, d: 2 }) }));

const order = new DepthSorter(64); //          allocated once, reused for ever
const pen = beginFrame({ surface, camera, palette, t: 2.5, clear: 'sky', light });
light.begin(pen, 0.7, 'night'); //             darkness 0–1, and the color the dark goes

order.clear();
for (const b of buildings) order.add(b.gx, b.gy, 2, 2, b.base + spriteHeightPx(WATER_TOWER, b.v));

renderFrame(pen, {
  // The tallest ground on the map. `renderFrame` culls the terrain on the *ground plane* — a
  // camera has no idea what a heightfield is — so without this the ridge disappears the moment
  // its own base leaves the bottom of the screen.
  maxHeightPx: 5 * ground.stepPx,
  terrain(p, visible) {
    for (let gy = visible.gy0; gy < visible.gy1; gy++) {
      // One diamond per tile, on its own four corner heights, shaded by its cross-slope.
      for (let gx = visible.gx0; gx < visible.gx1; gx++) isoTerrain(p, ground, gx, gy, 'ground');
    }
  },
  // Walk it forwards. Never sort it, never partition it — `pickSorted` walks this same
  // instance backwards, and the two are the same permutation or the tap is a lie.
  solids(p, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const b = buildings[sorted.indexAt(i)];
      if (b !== undefined) drawSprite(p, WATER_TOWER, b.gx, b.gy, b.v, b.base);
    }
  },
}, order);
endFrame(pen);

console.log(`${surface.ops.length} draw calls, digest ${surface.digest()}`);
console.log(`${light.count} light pools, composited once`);

// ── the tap, which is the exact reverse of the paint ───────────────────────────
const volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const outline = new Float64Array(12);
function hitsSilhouette(index) {           // hoisted: a closure per tap is a closure per tap
  const b = buildings[index];
  if (b === undefined) return false;
  spriteVolume(WATER_TOWER, b.v, volume, b.base); // the massing knows how tall it built itself
  boxSilhouette(camera, b.gx, b.gy, volume, outline);
  return pointInPolygon(112, 125, outline, 6);
}
console.log(`tap at (112, 125) hit building ${pickSorted(order, hitsSilhouette)}`);

// ── nightfall: one number recolours the world ──────────────────────────────────
for (let i = 0; i <= 360; i++) palette.lerp(DAY, NIGHT, i / 360);
console.log(`sky at midnight: ${hexOf(palette.get('sky'))}`);
```

```
brand: #d28541, palette rev 2
527 draw calls, digest a1e37056
3 light pools, composited once
paint order: 1, 2, 0
tap at (112, 125) hit building 0
a 6-second dusk bumped rev 32 times
sky at midnight: #1a2244
level 3 is 140.4 world px tall, and frames into 128×204 css px
```

**`rev` bumped 32 times across a six-second dusk**, not 361. `Palette.lerp` quantises `t` to
`PALETTE_STEPS` levels, because a continuous lerp that bumped a revision every frame would
invalidate every cached anything on every frame of the prettiest moment in the game.

---

## The ten things worth knowing before you write a sprite

### 1. Heights are storeys here and world pixels in `iso`

Every height a sprite author writes — `BoxOpts.h`, `BoxOpts.z`, `isoRoof`'s `rise`, `isoPost`'s
`h` — is in **storeys**, because "three storeys" is what a person means. Every height that
crosses into `iso` is in **world pixels**. `levelsToPx` is the one conversion, it runs in one
direction, and it happens at the boundary rather than at a call site.

`LEVEL_H` is 26, not 32, on purpose: a storey exactly one tile tall makes every building a cube,
and cubes read as programmer art. It is an art proportion, tuned beside `FACE_LEFT`.

`pxToLevels` is the other direction, and it is the one you reach for constantly, because
everything `iso` hands *back* is world pixels: `heightAt`, `footprintBase`, `Volume.zPx`. Without
it the divisor turns up at every boundary in game code, spelled `/ 26` on the day somebody forgets
the constant exists — and a kit whose art proportion has been copied into a game is a kit that
cannot change it.

Pass one unit where the other is expected and the building is 26× wrong — which is at least
visible. The dangerous version is subtler: a `Volume` built in storeys makes `boxSilhouette`
return an outline that is *nearly* right, so picking works everywhere except near the roof.
**Use `spriteVolume`**, which does the conversion for you and is the only thing that knows how
tall the massing actually built itself.

The **ground under a sprite** crosses the border exactly once, at `drawSprite`:

```ts
const base = footprintBase(field, { gx, gy, w: def.w, d: def.d }); // iso's pixels
drawSprite(pen, def, gx, gy, v, base);      // massing, shadow and animate all stand on it
order.add(gx, gy, def.w, def.d, base + spriteHeightPx(def, v));
spriteVolume(def, v, volume, base);         // added in pixels, never converted, so picking agrees
```

Leave it out on a heightfield and every sprite floats or sinks by its own terrain height, which
reads as *the art is wrong*, sprite by sprite, rather than as one missing argument. `massing` is
not handed the number — the writer already stands on it — and `animate` and `emit` are, as their
last parameter, because they draw through the free primitives and feed `LightField.add`
respectively, and both of those speak pixels.

### 2. Do not reorder after `sort()`

`iso.pickSorted` walks the same `DepthSorter` instance backwards, so paint order and pick order
are the same permutation or the game is lying about what the player tapped. After `sort()`:

- **do not re-sort**, by anything, for any reason;
- **do not partition.** This is the one that will actually happen. Drawing every contact shadow
  first and every body second looks better and is a *stable* partition of the sorted order — and
  it is a reorder. If you want shadows first, walk `indexAt` forward **twice**;
- **do not skip and re-add**, and do not paint from a second collection.

`renderFrame` calls `sort` itself, immediately before the Solids callback, so there is no window
in which you hold a sorted order and are tempted to improve it. Break the rule and both packages
stay green while a player taps a rack and opens the headquarters behind it.

### 3. Color is one packed integer, and you persist the *input* to it

`Rgba` is `0xRRGGBBAA` in a uint32 — not a CSS string. `shade()` returning `rgb(12,34,56)` in the
game this kit came from meant three fresh strings per box per frame, which was the largest single
source of garbage in the renderer and invisible in a profile because strings die young.

**Store the player's hue, never the `#rrggbb` it derives to.** Derivation is presentation-tier: a
pixel that differs in its last unit between two engines is a pixel nobody can see, but a *save
file* that differs in its last unit travels, and the player gets a campus that is a shade off on
their phone from what it is on their laptop with nothing anywhere to explain it.

### 4. Faces are derived, and there is exactly one exception

`shade(c, f)` below 1 darkens *and* pulls toward a cool tint; above 1 brightens and pulls toward a
warm one, with the pull scaled by distance from neutral so `shade(c, 1) === c` exactly. Shading
toward blue in shadow and amber in light is what separates a stylised render from a flat gray
lerp. Replace it with a plain multiply and the kit's art dies quietly: every screenshot still
renders, and every screenshot looks like a placeholder.

`BoxOpts.topColor` is the one sanctioned per-face override — for roofs, solar glass and water.

`Palette.lerp` requires both stop sets to define exactly the same slots, because a half-defined
night palette is how one thing stays gold at midnight and the failure is silent everywhere else.
To add a color of your own to that transition — sand, foam, a faction red — extend the stop sets
rather than redefining them:

```ts
const DAY_X = extendStops(DAY, { sand: 0xe8d9a8ff });     // hoisted, at module scope
const DUSK_X = extendStops(DUSK, { sand: 0xcfa87dff });
palette.lerp(DUSK_X, DAY_X, t);
```

**Hoist them.** `lerp` compares its stop sets by identity to decide whether the frame changed
anything, so a set rebuilt inside the render callback bumps `rev` every frame — and `rev` is what
every cache in the kit keys on. The symptom is not a wrong color; it is a game that gets slower at
dusk and stays slow.

### 5. One stroke around the silhouette, never one per face

Per-face strokes cross-hatch the interior and destroy the chunky read that makes this style work
at thumbnail size. `isoBox` draws left face, right face, top, then **one** closed six-point
stroke — north-top, east-top, east-base, south-base, west-base, west-top, which is the order
`iso.boxSilhouette` returns and is a cross-package contract, not a convention.

**And `isoWall` refuses a wall it cannot draw.** World x is `(gx − gy) · HALF_W`, so a segment
whose `gx` and `gy` change by the *same* amount projects to a vertical line of zero width: every
number is finite, the projection is doing exactly what it promises, and the art is simply not
there. A run of prayer flags laid along that diagonal cost the demo a full iteration with nothing
anywhere saying why, so the primitive throws and names both tiles rather than painting nothing.
A zero-length wall is refused by the same test. `iso.isEdgeOn(gx0, gy0, gx1, gy1)` is the
predicate if you want to ask before calling — and note that an *animated* endpoint must not be
able to sweep through the diagonal, because the frame it crosses is a frame that throws.

### 6. Night is an accumulator, not a filter

Darkness is composited **once**, from a light buffer that blends by per-channel maximum. That is
the whole design, and both obvious alternatives are broken:

- recolour the world and draw a warm blob per lamp, and there is no *edge* — the blob fades into
  a world that is uniformly darker, so the player cannot tell where light ends because nothing
  ends;
- punch a hole per lamp, and two overlapping pools punch the same pixels twice — `(1−a₁)(1−a₂)`,
  not `max(a₁,a₂)` — so a hot lens-shaped seam appears between every adjacent pair of lamps. It
  looks like a driver bug because it is a rendering one.

A pool is an **ellipse**: a circle of light on the ground projects 2:1 like every other flat
thing in this world, and the field does the squashing so no caller can forget. Pools are re-added
every frame and nothing is retained between them — a lamp that stops being drawn stops lighting,
with no lifecycle to get wrong. With `darkness` at 0 the whole subsystem costs nothing at all:
no buffers, no composite, and `emit` hooks are skipped.

**The field has to be on the pen**, and `begin` throws if it is not. Leaving `light` out of the
`beginFrame` literal used to disable the entire night in silence — the composite is an optional
call, `drawSprite` skips every `emit` hook, and pools accumulate into a buffer nobody reads —
while the field went on reporting `active: true` with a live `count`, so the one thing an author
would check to diagnose it said everything was fine. One reference comparison per frame buys a
sentence on the first one.

`resize` is **optional**: `begin` sizes the buffers to `pen.surface` on every active frame, so a
field self-heals and forgetting the call costs one reallocation. And every option is live *and*
readable — `configure({ scale, falloff, bloom })` moves any of them on a running field, for a
quality toggle or a screenshot mode that pins `scale` to 1, and `field.scale`, `field.falloff`
and `field.bloom` read the current value back:

```ts
field.configure({ bloom: 0.6 });
slider.value = String(field.bloom);   // and not a copy the panel remembered
```

Liveness without readback is half a fix, which is why non-negotiable 11 exists: a panel that can
move the bloom and cannot read it has to keep a second copy, and the second copy is correct on
the day it is written and drifts afterward with no error. **`scale` reports what you set, not
what is currently rendering** — `configure` takes effect on the next `begin`, so between the two
calls the getter is ahead of the buffers.

### 7. There is no sprite cache, and the benchmark is why

The RFC wrote one as provisional. Measured, the direct path draws **400 buildings of 42 draw
calls each in 2.14 ms** — 27% of the 8 ms frame budget — and a *perfect* cache, 100% hits and no
misses, would still cost 0.04 ms for the keys, the lookups and the blits. So the most a cache
could ever have bought back is about 2.1 ms of an 8 ms budget, in exchange for zoom buckets,
palette revisions, blit snapping and a don't-fill-while-moving rule — four new ways to render
something stale. `docs/PERFORMANCE.md` has the table.

The `massing` / `animate` split survives that decision and was never only about caching: it is
what makes a sprite's static art declarative and its motion explicit, and it enforces the art
direction's third rule structurally — *something moves on every building* — in a slot that is
named rather than remembered.

If a game ever draws a thousand buildings of this complexity the question reopens: that frame is
5.4 ms, and the row is in the performance table for exactly that reason.

### 8. Nothing on the frame path allocates

A box computes its corners into `pen.xy` and hands `(buffer, count, color)` to the surface.
Nothing here returns a point. One `Pen` per frame is this package's entire per-frame allocation —
including the seeded `Rng` every sprite hook receives, which is rewound in place rather than
rebuilt. `test/invariants.test.ts` checks that by reading the source, because a heap delta cannot
see the failure: the objects a leaking primitive creates are dead the instant they are made.

### 9. The `Surface` seam is narrow on purpose

Thirteen methods, and the test applied to every candidate was *could a competent WebGL backend
implement this in under fifty lines, without lying?* Bezier paths fail it. Clipping fails it.
`globalCompositeOperation`, with its twenty-six Porter-Duff modes, fails it. What survives is
convex polygons, polylines, ellipses, text and a render target — plus three named blit modes and
two target modes, five blend states in total, each one demanded by a picture the kit has to draw.

Every coordinate on that interface is in **CSS pixels**. Device-pixel-ratio is entirely the
backend's business, which is not a convenience: in the source game the ratio transform was
applied on resize *and* re-applied by the wall-text routine, correct only because both places
agreed and one edit from a half-scale campus.

### 10. Terrain has four corners, and the sun comes from the front-left

A tile in a heightfield game has four corners at four different heights. `isoTile` and `isoPatch`
take *one*, so `isoTerrain` is the primitive that fits a `HeightField`: it reads the four vertex
heights, projects the quad, and shades it by its own cross-slope.

```ts
const painted = isoTerrain(pen, field, gx, gy, wet ? 'glass' : 'ground', undefined, 1 + grain);
if (wet) pen.surface.poly(pen.xy, 4, glint);  // the four corners are still in pen.xy
```

Three things about it are load-bearing:

- **Heights live on grid vertices**, which is `iso`'s rule and not a convention this package
  invented. Adjacent tiles therefore share their corner values exactly and cannot leave a seam.
- **The relief is measured east-to-west**, because east and west are the two corners that land on
  the same screen row — the tile's slope along the *screen horizontal*, which is the only tilt a
  2:1 projection can show. That axis is also the sun's: `FACE_LEFT` is brighter than `FACE_RIGHT`,
  so ground that rises toward the east corner is the lit ground. **Invert the sign and terrain
  still looks like terrain** — terrain lit from the right, under buildings lit from the left, and
  the picture reads as flat for a reason no screenshot names.
- **The game's own texture goes in `tint`**, not in a second `shade` call. `shade` pulls toward a
  cool or a warm tint by distance from neutral, so shading twice tints twice and the ground goes
  muddy; the kit adds its relief to your factor and calls `shade` once.

The Terrain pass is culled on the **ground plane**, because a camera has no idea what a
heightfield is. Tell `renderFrame` the tallest ground you have — `passes.maxHeightPx` — or a
summit vanishes the moment its own base leaves the bottom edge, with nothing else in the frame
missing. The margin works out to `maxHeightPx / TILE_H` tiles, and the derivation is on the field.

---

## Every option reads back off the thing it configured

Non-negotiable 11, audited across the package. A value you handed over and cannot read is a value
you have to store twice, and two copies drift with no error when they do.

| options bag | field | read it back as |
|---|---|---|
| `LightFieldOpts` | `scale` | `field.scale` — **what you set, not what is rendering**: `configure` takes effect on the next `begin` |
| | `falloff` | `field.falloff`, the default a pool gets when `add` names none. A per-call falloff is not retained and is not readable |
| | `bloom` | `field.bloom`, in force on the very next composite |
| `Canvas2dOpts` | `pixelRatio` | `surface.pixelRatio` — the ratio *in force*, which `resize` then moves |
| | `alpha` | `surface.hasAlpha`. Spelled differently because `Surface.alpha` is already the multiplier setter, and one word cannot mean both |
| | `maxPixelRatio` | **nothing, on purpose.** It does not survive its constructor: it picks the opening ratio and `resize(w, h, ratio)` walks straight past it. A getter would report a ceiling the surface does not enforce, which is worse than none. It becomes readable in the change that makes `resize` honor it |
| `OffscreenOpts` | `pixelRatio`, `alpha` | `surface.pixelRatio`, `surface.hasAlpha` |
| `FrameOpts` | `surface`, `camera`, `palette`, `t`, `light` | the same names on the `Pen` |
| | `snap` | `pen.snap`. **Not `snapX === 0`** — that is also what a *snapped* frame produces whenever the origin already lands on a whole device pixel, so inferring it from the offsets is wrong on exactly the frames where it looks right |
| | `clear` | nothing, and honestly: it is painted and then gone. Nothing retains it |
| `BoxOpts` | all | nothing retains a `BoxOpts` — it is one call's arguments, not configuration, and there is no object it configured to read it off |

Which of these is also *settable* is a separate question with its own test:
`docs/rfc/live-options.md`. `LightFieldOpts` is the package's live one; `alpha` is identity
(`getContext` fixes the channel for the element's lifetime) and its setter is a new surface.

---

## What is deliberately absent

| absent | why |
|---|---|
| **A sprite bitmap cache** | Measured and deleted. See §7 and `docs/PERFORMANCE.md`. |
| **A sorted draw list, a depth key, a comparator, a `Rect`** | All four are `iso`'s. There is one sorted list in the kit; `draw` walks its permutation and contributes nothing to how it got ordered. Nor is there an item bucket here: the game's own array already is one, and a second copy kept in step by hand is the mistake `iso` avoided by deleting its `Scene`. |
| **Bezier and arc paths, concave polygons, clipping** | None survives the fifty-line WebGL test. Every form in an isometric kit decomposes into convex polygons and ellipses; if a shape needs a curve it needs more segments, and if it is not convex the author splits it. |
| **A general composite API** | Twenty-six Porter-Duff modes most of which no isometric kit will ever use. Three `BlitMode`s and two `TargetMode`s instead. A sixth arrives the way the fifth did: a demo that cannot be built without it. |
| **A transform stack, filters, blur, `shadowBlur`** | Solids are computed in screen space; only wall text needs a matrix and it takes one per call. A stack invites a `save`/`restore` imbalance across a frame boundary — which is how the source game applied its device ratio twice. |
| **Images the kit did not render** | Rule 8, zero assets, enforced by the type system: `Bitmap` has no constructor from a URL. |
| **Lights that cast shadows or are occluded** | A lamp behind a hill still spills over it. Real occlusion needs a shadow map per light and a depth buffer this renderer does not have, and it would cost more than everything else here put together. **This is the largest honest limitation in the package**, and it belongs in this README rather than in a bug tracker: the sprite author compensates by not putting a lamp behind a hill. |
| **HDR light accumulation** | The light buffer is 8-bit and clamps. Twenty lamps in one place blow out to white. Correct is a float target and a curve; adequate is capping `intensity`. |
| **Perceptual color interpolation** | OKLab is more correct and is not this look. The byte-space lerp toward two fixed tints is *why* the faces read as painted rather than as computed. |
| **Hit-testing** | `iso` owns picking. This package contributes `spriteBounds` and `spriteVolume` — the geometry a pick test needs — and stops. In particular it never records what it drew for picking to read back, because a frame the renderer skipped would leave the controls somewhere the building is not. |
| **A serialization format for color** | The moment this package can write a color to a save, someone writes a presentation-tier value into a document that travels between engines. Store the hue. |
| **Tweening, easing, particles** | `loop` owns time. This package takes `t` and reads no clock. |
| **The WebGL backend itself** | Not in 0.1. The point of the seam is that it can land later without touching a line of sprite code, and the point of the thirteen-method list is that when it does, it will not have to lie. |

---

## The seven passes

The order is the product, and it is **closed at seven**.

| # | pass | |
|---|---|---|
| 0 | Backdrop | a vertical ramp. Never a flat color: flat backgrounds make an island look like a sticker |
| 1 | Terrain | culled tile diamonds, color varied per tile from a stateless hash |
| 2 | Solids | buildings *and* scenery, one list, one sort. Two sorted lists is what makes trees pop through walls |
| 3 | Placement | ghost and selection: above the world, below the UI |
| 4 | Light | the night mask goes down and the bloom goes up, in one composite — **and this is not a callback** |
| 5 | Overlay | bubbles and timers, in screen space, unsorted, always on top |
| 6 | Effects | floating numbers and bursts |

Light sits at 4 and the position is argued, not arbitrary. It is *after* Placement because a
ghost is a thing in the valley and a thing in the valley at night is dark — a placement preview
that stays daylit is the tell that the darkness is a filter rather than the world. It is *before*
Overlay because a coin pill and a build timer are not in the valley, and a HUD the player cannot
read at midnight is a HUD that is broken for half of every cycle.

There is no way to insert an eighth and no way to get a second Solids pass. The seventh was found
by the demo's own RFC before a line of this was written; the next one, if there is one, gets
found the same way.

---

## Testing your own art

`createRecordingSurface` is a `Surface` that records draw commands and a digest instead of
pixels. Golden tests here protect **the shape of the draw**, not the antialiasing: a command log
diffs into a sentence and a pixel diff into a number.

```ts
const rec = createRecordingSurface(320, 200);
const pen = beginFrame({ surface: rec, camera, palette, t: 0, clear: 'sky' });
drawSprite(pen, WATER_TOWER, 0, 0, VARIANT_ZERO);
endFrame(pen);
expect(rec.digest()).toBe('…');   // and rec.ops is readable when it does not
```

Two things it cannot tell you. **`measure()` differs between backends** — the recording surface
has no fonts and estimates at `ESTIMATED_ADVANCE_RATIO`, so a golden may assert that a sign's
shrink-to-fit branch ran and may not assert where a glyph landed. And **a target's contents are
folded into its parent's digest** through the blit that draws it, so nothing hides behind an
opaque bitmap.

---

## License

MIT
