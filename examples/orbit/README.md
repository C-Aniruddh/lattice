# Orbit

**No ground at all.** Platforms, stars and a cold palette: eight stations turning on five rings
over a void, with three parallax star bands behind them and not one tile of terrain anywhere.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-orbit
# http://localhost:5180
```

Then: **drag** to cross the void, **scroll** to dive, **tap** to move the beacon between stations,
and open **knobs** to put four hundred and eighty objects in orbit or stop the clock. `?seed=`
turns the field.

---

## Who built this, and from what

**Built by Codex**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row, the whole standard and the tools, and it was
deliberately **not** shown any existing exhibit's source — reading a neighbour tests the
neighbour, not the spec.

The void, the palette, the parallax and every stroke of `orbit-art.ts` are that agent's.

---

## The one idea: the kit is not only for grass

`draw`'s defaults are a daylight world with a ground plane, and a reader who has seen five
exhibits of it will reasonably conclude that is what the renderer *is*. This row exists to be the
counterexample: there is no `TileGrid` here, no terrain pass, no height field and nothing drawn
that a floor could be mistaken for. The projection is a coordinate system, and what a world is
made of is a decision the palette makes.

What replaces the ground:

| | |
|---|---|
| **the void** | a vertical `polyRamp` between two authored slots, plus two constant-color haze ellipses. Never a flat fill — a flat background is what makes a world look like a sticker on one |
| **three star bands** | parallaxed at 0.08, 0.17 and 0.26 of the camera, dimmer and smaller as they recede. This is § Scale's depth row with no terrain to hang it on |
| **the rings** | every platform's angle is a closed-form function of `pen.t`. Nothing integrates, nothing is spawned and nothing is kept, so the count in the panel is a loop bound |
| **the orbit line** | one stroked ellipse with a dash offset that is also a function of `t` |

## Where `docs/GALLERY.md` made its author guess

Kept verbatim.

- **Void versus the one-third fill rule.** Orbit explicitly makes void its subject, while § Scale
  says no more than one third may be empty. I interpreted "empty" as *flat, uncomposed
  background*, not all negative space. The final void remains spacious but is structured with
  gradients, haze, stars and parallax.
- **What constitutes world extent without ground.** There is no physical land rectangle to
  measure. I treated the camera's navigable orbital volume as the world bounding rectangle.
- **The edges rule without a horizon.** Space has no natural horizon or ground edge. I assumed a
  star field and orbital traffic visibly continuing through every edge satisfies the intent better
  than inventing a horizon.
- **What counts toward density.** The standard names trees, towers, walkers and lamps but does not
  say whether background stars count. I used the stricter reading: the sorted platform field alone
  stays in the hundreds, without relying on stars for the density claim.
- **How depth applies to a void.** I mapped the required near/mid/far bands to parallax speed,
  brightness, scale, orbital radius and station detail rather than to terrain distance.
- **Whether isometric coordinates imply a tilemap.** The objects use the grid projection for
  placement and sorting, but there is no tile storage, tile iteration, terrain pass or drawn
  ground. I assumed "no tilemap" forbids a tiled world representation, not use of the coordinate
  system.
- **The performance gate conflicts with its later cadence advice.** § Scale says "60 fps", under
  which the 10.4 ms worst gap passes comfortably; the looking guidance suggests comparing against
  observed cadence at roughly 1.5×, and the headless browser reported an unusually fast 6.3 ms
  cadence, making the same sample 1.65×. I reported both rather than silently choosing the
  favorable interpretation.
- **Requested viewport versus actual harness viewport.** `--size 1440x900` produced a reported
  1440×813 page viewport. I judged and reported the actual harness dimensions.
- **Control-panel location.** The spec says the panel lives in `examples/_shared`, but this
  standalone directory contains no gallery repository and no shared bootstrap. I implemented the
  required panel locally with `@latticekit/ui`, real parameters and URL persistence. **I did not
  fabricate an external shared directory.**
- **"One idea" versus mandatory controls and interaction.** The panel, camera gestures, beacon
  tap, HUD and cost meter could be read as additional ideas. I treated them as gallery
  instrumentation required elsewhere in the same spec.
- **Determinism with continuous animation.** *"Same seed, same world"* is clear; *"the same pixel"*
  is underspecified for a scene captured at different elapsed times. I assumed identical seed, URL
  parameters and session time must produce identical placement and pixels.
- **Static markup is art, yet the overlay must be `@latticekit/ui`.** I constructed the HUD
  through `ui` and conservatively counted its module as logic because it reads live state.

## The numbers it reported

| | |
|---|---|
| logic / art | **92 logic**, 80 art plus 18 of CSS, against a cap of 200 |
| extent | 2.07× the viewport width, 1.96× its height |
| density | 214–215 sorted platforms and fragments visible, plus hundreds of stars |
| worst gap / 10 s | 10.4 ms against a 6.3 ms observed cadence |
| bundle | 27.94 kB gzipped |
| harness | all five rows pass: 518 colors, 30% modal frame, 23% border, 3.51% motion, clean console |

## What changed when it moved into the repository

1. **The hand-rolled boot became `examples/_shared`'s `bootstrap`** — including the two
   `performance.now()` calls the kit bans in exhibit source, which that module owns once.
2. **The locally built slider panel became `controlPanel`.** Its two rows survive verbatim as
   exhibit knobs, each now declaring the kit parameter it drives and carrying the wrong end
   § The control panel asks for; the kit rows beside them come from `knobs`.
3. **`?cost=0` is `costNode()`**, and the URL is `boot.params` rather than this exhibit's own
   `history.replaceState`.
4. **`terrain: 'flat'` is now a `bootstrap` option** rather than a `createInput` one. It was
   already declared correctly, which matters more here than anywhere else: nothing in this exhibit
   has a surface, so every pick genuinely is the plane `z = 0`, and this is the one row where
   saying so is a statement rather than a formality.
