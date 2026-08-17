# Caverns

**The light field alone.** A cave with nothing in it but darkness, one lantern you carry, eight
braziers out in the dark and three hundred torches you can light. It is the only exhibit in the
gallery whose subject is `@latticekit/draw`'s `LightField`, and it exists partly as a stress test of
it.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-caverns
# http://localhost:5190
```

Then: **tap the floor** to carry the lantern there, **drag** to look, **scroll** to zoom, and press
**Light 100 more** to watch six hundred extra light pools arrive for under a millisecond.

`?seed=` chooses the cave. The same seed is the same passages, the same five hundred formations
and the same three hundred torch positions, every time. Every panel knob is a URL parameter too,
so `?dark=0.6&lightBloom=0.7` is a shareable configuration.

---

## The one idea: pools that meet without a bright seam

Two lights composited one at a time punch the same pixels twice — `(1−a₁)(1−a₂)` rather than
`max(a₁,a₂)` — and grow a hot lens where they overlap. `draw` removes that by accumulating every
pool into one buffer that blends by **per-channel maximum** and cutting the darkness once.

What is left for the exhibit is the part a kit cannot do for you, and it is two parameters and one
shape.

### `falloff: 1`, and why the kit default of 2 puts a hard ring on every pool

`LightFieldOpts.falloff` is documented as a plateau: the fraction of the radius that stays at full
intensity before the ramp begins. It is implemented as a **filled ellipse of radius `r·(1 − 1/falloff)`
drawn underneath a `softEllipse` that ramps from full intensity at the center to zero at `r`** —
because `Surface.softEllipse` has stops only at radius 0 and radius `r`, with no inner-stop radius.

So just inside the plateau the alpha is the union of the disc and the ramp, and just outside it the
ramp alone. At `falloff: 2` and intensity 0.9 that is a step from about **0.95 to 0.45 at exactly
half the radius** — a hard elliptical rim in the middle of every pool, and a second one where a
neighbouring pool's rim crosses it. It is the seam this exhibit exists to not have.

At `falloff: 1` the plateau is zero, the ellipse is skipped entirely, and the pool is one smooth
ramp that reaches zero at its rim. Drag the panel's **pool edge** slider up to 4 and both rims
appear across the whole cave in one frame; that is the demonstration, and the slider is there for
it.

It is also *cheaper*: no plateau means one primitive per pool instead of two.

### `bloom: 0.3`

The bloom is an **additive** blit of the light buffer, and additive is the one place two
overlapping pools genuinely do sum. Below about 0.35 the sum stays inside the 8-bit range where two
pools meet; above 0.6 it clips to white and the overlap becomes the flat lozenge the whole design
was avoiding. Both ends are on the panel.

### Two pools per light, not one

A single `add` is a linear ramp: bright in the middle, gone at the edge, with the same slope all
the way out — which the eye reads as *the size of the lamp* rather than as the reach of its light.
Nest a hot narrow core inside a wide weak halo and let the accumulator's `max` union them, and you
get a compound curve that is steep in the middle and very flat at the edge.

```ts
/** One flame: a hot core inside a wide weak halo. `zPx` is the ground under the flame, not the
 *  height of the wick — the field pools light on the floor. Neither call passes a `falloff`, so
 *  both read the field's default and the panel's slider stays live. */
function pool(field: LightField, gx: number, gy: number, zPx: number, gutter: number): void {
  field.add(gx, gy, zPx, 12 * 0.3 * gutter, 1, 'warn');
  field.add(gx, gy, zPx, 12 * gutter, 0.32, 'ember');
}
```

That is the whole answer to "without a bright seam". Two of these side by side meet in each other's
**halo**, where both curves are almost flat and both intensities are about a third, so the union is
barely brighter than either and has no edge anywhere in it. Two single-pool lights meet in each
other's ramp, where the slope is constant, and the union has a visible crease along the line
equidistant between them.

---

## The measurement

`docs/GALLERY.md` gives this exhibit the light field partly as a stress test, and the claim under
test is that **a light field's cost is its buffer, and the buffer scales with `scale` and the
viewport rather than with the number of lights.** The HUD carries `POOLS` off `LightField.count`
and `WORST` off `loop.stats.worstFrameMs`, side by side, so the experiment is one button press.

Measured on an Apple-silicon laptop, `devicePixelRatio` 2, `?seed=lampblack`. Two instruments,
because they answer different questions: the HUD's `WORST` is `loop.stats.worstFrameMs`, which
times only the pump's own body, and a **rAF interval** probe, which sees the whole frame including
compositing and any GC pause landing *between* pumps. The display is 120 Hz, so a healthy rAF
interval is 8.3 ms.

| torches lit | pools per frame | rAF p50 | rAF max | HUD `WORST` |
|---:|---:|---:|---:|---:|
| 0 | 104 | 8.3 ms | 10.1 ms | 7.1 ms |
| 100 | 304 | 8.0 ms | 8.5 ms | 9.0 ms |
| 300 | 704 | 8.3 ms | 8.4 ms | 6.9 ms |
| — (`?dark=0`, field inactive) | 0 | — | — | 4.5 ms |

**Six hundred extra pools do not move the frame interval at all** — it stays pinned to the display
cadence — and the entire light subsystem, mask and cut and bloom and 104 pools, costs about
0.2 ms against `?dark=0`. That is an over-estimate of the light cost even so, because lighting
three hundred torches also puts three hundred extra *sprites* into the depth sort. The claim
holds: the frame is the terrain and the solids, and the lights are nearly free.

An earlier run in a quieter browser gave the same shape with lower absolutes — 4.7 / 4.9 / 4.9 /
5.6 ms `WORST` across 92 / 292 / 492 / 692 pools. Every number here was taken with six other
exhibits' dev servers and live canvases running beside it, so they are pessimistic rather than
flattering.

### The ramp cache, which had to be fixed before any of the above was true

`Surface.softEllipse` is the only primitive that reaches `canvas2d.ts`'s radial-ramp cache, and
that cache is keyed on the **exact** `(inner, outer)` color pair with no quantization, with
wholesale eviction at 96 entries. Every pool in this exhibit is a `softEllipse` whose alpha is a
guttering flame or a breathing crystal — continuously varying — so every one of them missed.

Measured by wrapping `createRadialGradient`, which is reached only on a miss:

| | misses per frame |
|---|---:|
| 104 pools, before | **4.3** |
| 704 pools, before | **15.9** |
| 704 pools, after | **0.000** |

At 15.9 misses a frame the cache was being *cleared* about every six frames, taking five hundred
formations' constant-color contact shadows down with it as collateral. The fix is `ambient.ts`'s
`snap`: quantize the brightness factor to nine levels **before it becomes a color**, and leave
every radius, position, sway and timing continuous. The picture is indistinguishable; nobody
resolves nine brightness levels on a soft radial ramp.

That is a workaround in an art module, not a change to the kit, and it becomes redundant the day
`rampFor` quantizes its own key and evicts per entry.

---

## Scale

`docs/GALLERY.md` § Scale, row by row, at 1440×900 on the opening frame:

| row | how it is met |
|---|---|
| **extent** | 128 × 128 tiles = 8,192 × 4,336 world pixels, more than five times the viewport's long axis. Seven of the eight braziers are off-screen at the opening zoom |
| **fill** | there is no background: the cave floor and its rock fill the frame at every zoom and pan. Unlit rock is the subject here rather than empty space — but *flat* unlit rock would still be empty space, so the far dark carries stalagmite silhouettes, a stroked wall foot, and two hundred glow-worms whose pools are a fiftieth of a torch each |
| **edges** | the world runs off all four edges; the camera's bounds are the whole grid |
| **density** | ~550 formations, ~300 torch positions, ~200 glow-worms and ~60 motes per frame |
| **depth** | near: a parallaxed ceiling and floor band in screen space. Mid: the sorted formations and flames. Far: dim rock carrying only silhouette and glow-worm light |
| **cost** | the rAF frame interval stays pinned to the display cadence at every light count, 104 pools to 704, against a 16.7 ms gate. See § The measurement |

---

## The modules

| module | | what it is |
|---|---|---|
| `main.ts` | logic | the boot, the lantern, the passes, the frame, the panel |
| `cavern.ts` | logic | the cave field, the formations, and the list of places a flame can stand |
| `hud.ts` | logic | `@latticekit/ui` over the canvas. `POOLS` and `WORST` |
| `palette.ts` | `@art` | one stop set and seven slots the kit does not have |
| `rock.ts` | `@art` | the floor, the walls, the standing water, the near band |
| `formations.ts` | `@art` | five sprites, the flames, and every burning flame's light |
| `ambient.ts` | `@art` | fire, dust, glow-worms, the lantern, and the two-pool recipe above |
| `index.html` | `@art` | the overlay's whole appearance. `@latticekit/ui` ships no stylesheet |

`npm run gallery` reports **199 logic / 474 art**, against a cap of 200 on logic.

Every `light.add` in the exhibit is in an `@art` module, beside the fixture it belongs to, which is
where `draw` itself puts it — `SpriteDef.emit` is declared **on the sprite**. `light.begin` is
logic, because the darkness is frame state and the panel drives it.
