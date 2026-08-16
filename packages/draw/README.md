# @lattice/draw

> One color and one grid footprint into a stylised isometric solid, on a surface it does not own.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @lattice/draw
```

The two halves of that sentence are the two things this package is for.

**One color** is the art direction: three-tone faces derived from a single hex, cool shadows,
warm highlights, a silhouette stroke on everything. There is no `leftColor`; offering one is
offering the caller a way to break the look.

**A surface it does not own** is the engineering: nothing in this package, and nothing above it,
ever holds a `CanvasRenderingContext2D`. So the same code paints the world, a shop thumbnail and
a golden test — and a WebGL backend can replace the Canvas2D one without a sprite noticing.

```ts
import { beginFrame, createCanvas2dSurface, endFrame, isoBox, isoTile } from '@lattice/draw';

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
import { DepthSorter, boxSilhouette, createCamera, pickSorted, pointInPolygon } from '@lattice/iso';
import {
  BASE_SLOTS, DAY, NIGHT, VARIANT_ZERO, beginFrame, createLightField, createPalette,
  createRecordingSurface, defineSprite, drawSprite, endFrame, glowDot, hexOf, hsl, isoTile,
  renderFrame, spriteBounds, spriteHeightPx, spriteVolume,
} from '@lattice/draw';

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
  // The light it throws into the night. Runs only when the frame has one.
  emit(field, gx, gy) {
    field.add(gx + 1, gy + 1, 0, 4, 0.9, 'warn');
  },
});

// ── the palette, recoloured to a player's brand hue ────────────────────────────
const palette = createPalette(BASE_SLOTS);
palette.set('brand', hsl(28, 0.62, 0.54)); //   one number in the save, never a derived token
console.log(`brand: ${hexOf(palette.get('brand'))}, palette rev ${palette.rev}`);

// ── the frame ──────────────────────────────────────────────────────────────────
const surface = createRecordingSurface(480, 300); //   no canvas: this runs in Node
const camera = createCamera(480, 300, { bounds: { minX: -400, minY: -200, maxX: 400, maxY: 600 } });
camera.centerOnTile(3, 3);
const light = createLightField(surface);

// Deliberately not in depth order: the sorter decides that, and it is the only thing that does.
const buildings = [
  { gx: 1, gy: 5, v: { ...VARIANT_ZERO, seed: 3 } },
  { gx: 0, gy: 0, v: { ...VARIANT_ZERO, seed: 1 } },
  { gx: 4, gy: 1, v: { ...VARIANT_ZERO, seed: 2, level: 3 } },
];

const order = new DepthSorter(64); //          allocated once, reused for ever
const pen = beginFrame({ surface, camera, palette, t: 2.5, clear: 'sky', light });
light.begin(pen, 0.7, 'night'); //             darkness 0–1, and the color the dark goes

order.clear();
for (const b of buildings) order.add(b.gx, b.gy, 2, 2, spriteHeightPx(WATER_TOWER, b.v));

renderFrame(pen, {
  terrain(p, visible) {
    for (let gy = visible.gy0; gy < visible.gy1; gy++) {
      for (let gx = visible.gx0; gx < visible.gx1; gx++) isoTile(p, gx, gy, 'ground');
    }
  },
  // Walk it forwards. Never sort it, never partition it — `pickSorted` walks this same
  // instance backwards, and the two are the same permutation or the tap is a lie.
  solids(p, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const b = buildings[sorted.indexAt(i)];
      if (b !== undefined) drawSprite(p, WATER_TOWER, b.gx, b.gy, b.v);
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
  spriteVolume(WATER_TOWER, b.v, volume);  // the massing knows how tall it built itself
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
367 draw calls, digest c70db030
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

## The nine things worth knowing before you write a sprite

### 1. Heights are storeys here and world pixels in `iso`

Every height a sprite author writes — `BoxOpts.h`, `BoxOpts.z`, `isoRoof`'s `rise`, `isoPost`'s
`h` — is in **storeys**, because "three storeys" is what a person means. Every height that
crosses into `iso` is in **world pixels**. `levelsToPx` is the one conversion, it runs in one
direction, and it happens at the boundary rather than at a call site.

`LEVEL_H` is 26, not 32, on purpose: a storey exactly one tile tall makes every building a cube,
and cubes read as programmer art. It is an art proportion, tuned beside `FACE_LEFT`.

Pass one unit where the other is expected and the building is 26× wrong — which is at least
visible. The dangerous version is subtler: a `Volume` built in storeys makes `boxSilhouette`
return an outline that is *nearly* right, so picking works everywhere except near the roof.
**Use `spriteVolume`**, which does the conversion for you and is the only thing that knows how
tall the massing actually built itself.

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

### 5. One stroke around the silhouette, never one per face

Per-face strokes cross-hatch the interior and destroy the chunky read that makes this style work
at thumbnail size. `isoBox` draws left face, right face, top, then **one** closed six-point
stroke — north-top, east-top, east-base, south-base, west-base, west-top, which is the order
`iso.boxSilhouette` returns and is a cross-package contract, not a convention.

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
