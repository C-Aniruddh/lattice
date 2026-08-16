# LAMP ROAD

A Lattice exhibit. A valley at dusk, a road climbing from a town gate to a shrine on the peak,
and pilgrims who will not walk into the dark. Tap a marker, the lamp lights, the road runs
further, more of them come and they come back with coin. One to two minutes.

```bash
npm run build          # the exhibit resolves @lattice/* to each package's dist, like a visitor
npm run dev            # http://localhost:5173
```

`?seed=` chooses the valley — `?seed=two-peaks`, `?seed=harbour`, `?seed=anything`. Same seed,
same valley, same pixel, every time. There is no save: every visitor sees the same first frame.

The overlay is `@lattice/ui`, per `docs/GALLERY.md`, and it takes its colors from `draw`'s live
palette through `paletteVars` → `applyPalette`, so the HUD darkens with the valley at dusk. The
whole of its appearance is the `<style>` block in `index.html`; `ui` ships no CSS by design and
neither does `hud.ts`.

---

## What the second round of kit fixes actually bought

Seven workarounds were extracted into packages and deleted from here. Every one is gone; what
follows is what changed *besides* the line count.

### The bug one of them was hiding

`hits()` called `spriteVolume(def, v, vol)` with no ground, so a marker's silhouette was
computed at sea level while the marker was painted up the hill. On the highest station of three
seeds the tap target sat **212–237 CSS pixels below the art**:

| seed | station | ground (world px) | silhouette center | at `zPx = 0` | error |
|---|---|---|---|---|---|
| `lamp-road` | 9 | 448 | y = 315 | y = 553 | 237 px |
| `harbour` | 17 | 408 | y = 233 | y = 445 | 212 px |
| `two-peaks` | 9 | 432 | y = 320 | y = 549 | 229 px |

Nothing looked broken, because a hand-written circle test around the marker's bubble — which
*did* know the elevation — caught most of the taps the silhouette missed. That fallback is gone;
the waypost in `site`'s massing is 2.5 storeys instead of 2.0 so the bubble is inside the volume
`spriteVolume` measures, and the pick is one call again.

### The relief sign

`terrainQuad` shaded `west − east`. Extracting it into `draw.isoTerrain` found that inverted:
the kit lights from the front-left, so ground is brighter as it rises toward the **east** corner,
and east and west are the only two corners a 2:1 projection puts on the same screen row. Wrong,
it still looks like terrain — terrain lit from the right, under buildings lit from the left — and
no screenshot names the problem.

### The road

`pathSimplify(road, cost)` replaced `pathSimplify(road, (gx, gy) => cost(gx, gy) === 1 ? 1 : 0)`.
Byte-identical routes across five seeds, same node counts, same arc lengths. The simplifier drops
a raw A\* route from 19–45 nodes to 7–21; the workaround was only ever a way of getting that
without losing the contour, and it is no longer needed.

### The economy

The `lit` node existed to be a multiplicand: `EdgeSpec.from` was required, so a rate that is a
property of the world had to nominate a stock and divide it back out. `from` is optional now, the
edge is a source, and `EconomySpec.nodes` — **which is the save's field order** — is one name long.

The same read found a live bug: the edge was untagged, so `gates(dark)` was passed to `buildFlow`
and never read. The dark paid nothing while the HUD said `+1.7×` and the toast said offerings are
worth more after dark. `gate: 'night'` makes all three agree; night income really is 70% higher
now and the pacing moved with it.

---

## Where the kit still fights back

1. **`examples/_shared/bucket.ts` does not exist.** `docs/rfc/depth-bucket.md` specifies it and
   assigns it to `G0`; `G0` shipped the bootstrap and the panel without it. So this exhibit still
   holds the parallel array by hand. It is *correct* now — one array, one index space, and the
   `index - things.length` offset is gone — but the compare-the-index guard that makes the whole
   failure class unreachable is the helper's, and it is not here.
2. **The boot did not disappear; it turned into an options literal.** `bootstrap()` deleted about
   thirty lines of construction and replaced them with a twelve-line options object. That is a
   good trade — the two silent mistakes are unmakeable now — but it is not the line saving the
   first report implied.
3. **World bounds are known after the seed, and the seed is `bootstrap`'s.** The rectangle goes
   in empty and has to be corrected with `camera.setBounds` on the next line, because `Camera`
   copies it. A `bootstrap` that took `bounds` as a callback of the seed would close it.
4. **`fitBounds` frames symmetrically and a composition is not symmetric.** Biasing the view down
   the screen means growing the rectangle asymmetrically by hand — which is honest (it says what
   is in frame) but is the third place this file converts storeys and overhangs into pixels.
5. **`drawRidgeline` was deleted rather than fixed.** Distant hills drawn at the sea plane's far
   corner are hundreds of pixels above the viewport at any framing that fits the island, so the
   function could never have run. It is the one piece of art here that was never once on screen.

## Where the seams fit well

`pathSample` is the whole crowd: eight walkers are eight calls with no per-walker state and
nothing allocated, and the same expression drives the light packets running up the road.
`LightField`'s accumulate-then-composite is the entire premise of the exhibit and needed no help.
`Palette.lerp` recolors the world on one number; that same number drives the light mask, the
ambience bed **and now the DOM overlay**, which is why sound, color and chrome cannot drift apart.
`isoTerrain` returning its painted color and leaving the corners in `pen.xy` is exactly the shape
the two second passes here wanted — the swell glint and the hairline seam cost no projection.
