---
name: art
description: Make procedural isometric art that reads as designed rather than as programmer output — buildings, trees, towers, terrain shading, palettes, day and night. Use when drawing a building, sprite, tree, tower or any object in an isometric game, when the art looks flat, gray, muddy, toy-like or like placeholder blocks, when choosing colors or a palette, when adding a day/night cycle, or when the frame time climbs at dusk.
---

# Art

Every solid in this kit is described by **one color** and a footprint; the three faces are
derived. There is no `leftColor`, because offering one is offering you a way to break the look.

Six rules make procedural art read as designed. They are cheap and they are not optional — a
render that skips them still produces a picture, and the picture looks like a placeholder.

| | |
|---|---|
| **silhouette first** | a shape you can recognize as a black cutout at thumbnail size. If it needs its detail to be legible, it is the wrong shape |
| **detail at three scales** | a mass, a feature on the mass, and something small enough to only just resolve. Two scales reads as a toy |
| **setback massing** | stack narrower volumes as they rise. A single extruded box is the shape every naive isometric demo has |
| **window rhythm** | repeat with a break — three, three, gap, three. Even spacing reads as a spreadsheet |
| **cool shadows, warm highlights** | this is what separates a stylised render from a gray lerp. `shade` does it for you; do not replace it with a multiply |
| **something moves on everything** | every building gets an `animate` hook. A static frame reads as a screenshot of a game |

---

## A sprite

```ts
import { VARIANT_ZERO, defineSprite, drawSprite, glowDot, spriteHeightPx } from '@latticekit/draw';
import type { Pen } from '@latticekit/draw';

const LIGHTHOUSE = defineSprite({
  id: 'lighthouse',
  w: 2,
  d: 2,
  // Static art. `rng` is freshly seeded from `v.seed` on every call, so a tower cannot
  // reshuffle itself on reload and a replay from a seed lands on the same pixel.
  massing(s, v, rng) {
    s.shadow(0, 0, 2, 2);
    s.box(0, 0, 2, 2, { color: 'stone', h: 1.2 });                       // the plinth
    s.cylinder(1, 1, 0.72, { color: 'paper', h: 4 + v.level, z: 1.2 });  // the tower
    s.cylinder(1, 1, 0.86, { color: 'stone', h: 0.3, z: 5.2 + v.level }); // the gallery
    s.roof(0.4, 0.4, 1.2, 1.2, 5.5 + v.level, 0.9, 'roof');
    if (rng.next() > 0.5) s.post(0.25, 1.7, 0, 1.4, 'stone');            // a mooring bollard
  },
  // Live art, over the static art, every frame. `pen.t` is the only clock, and it arrived as a
  // parameter — nothing in this package reads one.
  animate(pen, gx, gy, v, _rng, zPx) {
    const sweep = (pen.t * 0.22) % 1;
    const bright = sweep < 0.25 ? 1 : 0.25;
    glowDot(pen, gx + 1, gy + 1, 5.4 + v.level, 'warn', 0.2, snap(bright));
    void zPx;
  },
  // The light it throws into the night. Runs only when the frame has one, and pools it on the
  // ground the tower stands on — `zPx` is the elevation `drawSprite` was given, passed through.
  emit(lights, gx, gy, v, _rng, zPx) {
    lights.add(gx + 1, gy + 1, zPx, 3 * 0.3, 1, 'warn');       // the core
    lights.add(gx + 1, gy + 1, zPx, 3 + v.level, 0.32, 'warn'); // the halo
  },
});

/** Nine levels of brightness. See "an animated color is an allocator", below. */
function snap(x: number): number {
  return Math.round(x * 8) / 8;
}

export function paint(pen: Pen, gx: number, gy: number, groundPx: number): number {
  const v = { ...VARIANT_ZERO, seed: 7, level: 2 };
  drawSprite(pen, LIGHTHOUSE, gx, gy, v, groundPx);
  return groundPx + spriteHeightPx(LIGHTHOUSE, v);   // what DepthSorter.add wants, for culling
}
```

Three things in there are load-bearing and easy to leave out.

**`drawSprite`'s last argument is the ground under the footprint.** Leave it off on a heightfield
and every sprite floats or sinks by its own terrain height — which reads as *the art is wrong*,
sprite by sprite, rather than as one missing argument. The same number goes to `spriteVolume`
and to `DepthSorter.add`, and those three agreeing is what stops the picture, the tap target and
the sort order disagreeing about which hill this is standing on.

**Two `add` calls, not one, for a light.** A single pool is a linear ramp, and the eye reads a
linear ramp as *the size of the lamp* rather than as the reach of its light. Two pools — a small
bright core inside a wide dim halo — meet a neighbour in each other's halo, where both curves
are nearly flat, instead of in each other's ramp, where the slope is constant and the union has
a visible crease down the middle.

**`spriteHeightPx` replays the whole massing to answer.** Calling it per sprite per frame is a
second full massing pass over the entire scene every frame, for a number that cannot change.
Compute it once, when the thing is created.

---

## Heights are storeys here and world pixels everywhere else

Every height a sprite author writes — `BoxOpts.h`, `BoxOpts.z`, `roof`'s rise, `post`'s `h` — is
in **storeys**, because "three storeys" is what a person means. Every height that crosses into
`iso` — `heightAt`, `footprintBase`, `Volume.zPx`, `DepthSorter.add` — is in **world pixels**.
`levelsToPx` and `pxToLevels` are the two conversions, and they happen at the boundary.

`LEVEL_H` is 26, not 32, on purpose: a storey exactly one tile tall makes every building a cube,
and cubes read as programmer art.

Pass one unit where the other is expected and the building is 26× wrong, which is at least
visible. **The dangerous version is subtler**: a `Volume` built in storeys makes `boxSilhouette`
return an outline that is *nearly* right, so picking works everywhere except near the roof. Use
`spriteVolume`, which does the conversion for you and is the only thing that knows how tall the
massing actually built itself.

---

## A moving color is a cache key

This one sits two layers below you and no signature states it, so it is worth knowing even
though the sharpest version of it has been fixed.

`softEllipse` — which is what `glowDot`, contact shadows and every light pool are built on —
cannot draw a falloff per call at a sane price, so it renders one small ramp per `(inner, outer)`
color pair and reuses it. **The color pair is a cache key.**

That cache shipped once keyed on the exact 8-bit pair, evicting **wholesale** at 96 entries — so
a single animated color did not merely fail to cache, it **deleted every other call site's ramp
as well**. Contact shadows, light pools, sky and walkers, all constant-color sites that should
have been permanent hits, became misses as collateral. Measured by wrapping
`createRadialGradient`, which is only reached on a miss:

| | misses per frame |
|---|---:|
| 27 flames and a fountain's ripple rings | **3.74** — a full cache drop every 26 frames, ≈225 canvas elements a second, ≈**3.7 MB/s** of garbage |
| 8 braziers | 4.3 |
| the same scene with 300 torches lit | **15.9** — a full drop every six frames |

The key is now snapped to **32 levels per channel** — the resolution a 64-pixel ramp actually
has — and a full cache evicts one entry rather than all of them. **So you do not have to
quantize colors in your own art code, and if you already did, you can stop.** A flame mixed
against noise every frame visits at most 32 keys per channel and then hits for ever.

Three things remain true and are what to watch:

- **Animating *both* endpoints along independent paths multiplies pairs rather than adding
  them** — one moving end is 32 keys, two moving independently is 32². Move one end, or move the
  radius, which is what the eye tracks anyway.
- **Your palette counts as an animated color.** A day cycle running `Palette.lerp` on a
  continuous `t` every frame moves *every* slot in the scene at once, so every color in every
  call becomes a new pair — a whole-scene version of the same failure, with nothing at any call
  site that looks like an animation. One exhibit found this with **27% of its soft ellipses
  missing and no flickering light anywhere in it**. `Palette.lerp` quantizes `t` and bumps `rev`
  only when the quantized step moves, which is what absorbs it — so **do not defeat that by
  rebuilding stop sets every frame** (see below).
- **A two-second color fade steps 32 times rather than 120.** Invisible on a soft falloff. If you
  need a hard edge to move smoothly, `Surface.ellipse` is exact.

The tell in a profile was never a flicker. It was a game that got slower and stayed slower.

---

## Palettes, and the reason a game gets slower at dusk

```ts
import { DAY, DUSK, createPalette, extendStops, hexOf, hsl } from '@latticekit/draw';

// HOISTED, at module scope. See below — this is the whole point.
const DAY_X = extendStops(DAY, { sand: 0xe8d9a8ff, foam: 0xf4f8ffff });
const DUSK_X = extendStops(DUSK, { sand: 0xcfa87dff, foam: 0xc9d4e8ff });

const palette = createPalette(DAY_X);
palette.set('brand', hsl(28, 0.62, 0.54));   // one number in the save, never a derived token

export function nightfall(t: number): string {
  palette.lerp(DUSK_X, DAY_X, t);
  return hexOf(palette.get('sky'));
}
```

**`lerp` compares its stop sets by identity** to decide whether the frame changed anything. A set
rebuilt inside the render callback bumps `rev` on every frame — and `rev` is what every cache in
the kit keys on. The symptom is not a wrong color; it is a frame time that climbs at dusk and
stays climbed.

**Both stop sets must define exactly the same slots.** A half-defined night palette is how one
thing stays gold at midnight, and the failure is silent everywhere else. `extendStops` is how
you add a color of your own — sand, foam, a faction red — to the transition, rather than
redefining the sets.

**Store the player's hue, never the `#rrggbb` it derives to.** Derivation needs `cbrt` and
`pow`, which are not required by the spec to be correctly rounded, so a stored token is an
engine-specific artifact in a file that will travel to another engine — and the player gets a
world that is a shade off on their phone from what it is on their laptop, with nothing anywhere
to explain it.

`Palette.lerp` quantizes `t` internally, so a six-second dusk bumps `rev` 32 times rather than
361. That is deliberate and it is what makes a dusk affordable at all.

---

## Terrain, and the axis that is missing

`isoTerrain` fits a tile whose four corners are at four different heights: it reads the four
vertex heights, projects the quad, and shades it by its own cross-slope.

```ts
import { isoTerrain } from '@latticekit/draw';
import type { Pen } from '@latticekit/draw';
import type { HeightField } from '@latticekit/iso';

export function paintGround(pen: Pen, field: HeightField, gx: number, gy: number): void {
  //                                                       fill      stroke     tint
  isoTerrain(pen, field, gx, gy, 'ground', undefined, 0.88);
}
```

Three things about it are load-bearing, and two of them have cost exhibits multiple rebuilds.

**The relief is measured east-to-west**, because east and west are the two corners that land on
the same screen row — the tile's slope along the *screen horizontal*, which is the only tilt a
2:1 projection can show. That axis is also the sun's: the left face is brighter than the right,
so ground rising toward the east corner is the lit ground. **Invert the sign and terrain still
looks like terrain** — terrain lit from the right, under buildings lit from the left, and the
picture reads as flat for a reason no screenshot names.

**It reads one of the two diagonals, and a landform whose gradient runs along the other one
renders perfectly flat.** Both corners of a `gx + gy` slope sit on the same screen row, so the
relief term is *zero* — a six-thousand-foot cliff shading like a texture, with no error and
nothing to grep for. If your landform runs that way, supply the `north − south` term yourself
through `tint`. It is one subtraction and it is the difference between a slope and a cliff.

**`isoTerrain` adds up to ±0.32 of its own relief to whatever `tint` you hand it.** So a
flat-ground tint of `1` puts the brightest lit face at 1.5, and `shade` at 1.5 on a pale rock
clips: a fresh mountain sampled at four separate points came back `255, 249, 212` at every one
of them, which is not a highlight, it is a hole in the image. **Sit the flat-ground tint at
about 0.88.** And put your own texture in `tint` rather than in a second `shade` call — shading
twice tints twice, and the ground goes muddy.

---

## Small things that turn out to be big

**One stroke around the silhouette, never one per face.** Per-face strokes cross-hatch the
interior and destroy the chunky read that makes this style work at thumbnail size. `isoBox`
draws left face, right face, top, then one closed six-point stroke — and that order is a
cross-package contract with the hit-tester, not a convention. In a crowd, stroke the shape that
*is* the silhouette or two hundred people become a mesh of hairlines at low zoom.

**A wall along the near-far diagonal has zero screen width.** World x is `(gx − gy) · HALF_W`, so
a segment whose `gx` and `gy` change by the same amount projects to a vertical line: every number
is finite, the projection is doing exactly what it promises, and the art is simply not there. A
run of prayer flags laid along that diagonal cost one exhibit a full iteration with nothing
anywhere saying why. `isoWall` now throws and names both tiles; `iso.isEdgeOn(ax, ay, bx, by)`
is the predicate if you want to ask first. **An animated endpoint must not be able to sweep
through the diagonal**, because the frame it crosses is a frame that throws.

**`massing` and `animate` get different `Rng` streams.** A sprite whose massing chose a height
and a lean cannot recover either by drawing in the same order in `animate` — it gets different
numbers, so a moving crown sits beside the static one it is supposed to *be*, and the tree
renders with its head beside its neck. It is worst on the tallest, leaniest instances, which is
why it survives a review at a glance. Address by index instead:

```ts
import { hashStep, toUnit } from '@latticekit/core';
import type { Variant } from '@latticekit/draw';

/** The same number in `massing` and in `animate`, addressed by position rather than by order. */
export function vat(v: Variant, i: number): number {
  return toUnit(hashStep(v.seed, i));
}
```

**`emit` gets no clock.** Its parameters are `(field, gx, gy, v, rng, zPx)` — no pen, no `t` — so
a guttering torch or a lamp being switched on cannot be written through the sanctioned hook.
Drive it from `animate` with `pen.light?.add(…)` instead; two exhibits arrived at that
independently.

**Haze must not converge on the `sky` slot.** At noon `sky` is a fully saturated cyan, so mixing
a green hillside toward it trades one saturated color for another and the far range stays as
loud as the near one. Real distance loses *saturation* before it loses hue, so the target is the
sky pulled a third of the way to white by day and barely at all at night.

**Hard color bands on a noisy field make a mosaic of flat diamonds**, because adjacent tiles land
either side of a boundary. Interpolate the bands over about sixteen quantized stops — which also
keeps the ramp cache happy.

---

## What this skill does not cover

| you want | read |
|---|---|
| the boot, the loop, the frame | `starting` |
| terrain data, roads, paths, walkers | `world` |
| picking, ghosts, drag to place | `input` |
| a HUD, a panel, a toast | `hud` |
| "it's slow" or a frame budget | `performance` |
| something that renders and looks wrong | `traps` |

The long-form version of everything here, with the full primitive list, is on disk at
`node_modules/@latticekit/draw/README.md`.
