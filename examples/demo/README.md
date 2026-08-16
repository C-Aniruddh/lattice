# LAMP ROAD

A Lattice exhibit. A valley at dusk, a road climbing from a town gate to a shrine on the peak,
and pilgrims who will not walk into the dark. Tap a marker, the lamp lights, the road runs
further, more of them come and they come back with coin. One to two minutes.

```bash
npm run dev            # http://localhost:5173
```

`?seed=` chooses the valley — `?seed=two-peaks`, `?seed=anything`. Same seed, same valley, same
pixel, every time. There is no save: every visitor sees the same first frame.

---

## Notes for the next exhibit

This is the first thing built on the kit, so most of what follows is about **what a second
exhibit should not have to write again**.

### What every exhibit will hand-roll unless something is shared

About **thirty lines of identical boot** sit at the top of `main.ts` and would sit at the top of
every other exhibit unchanged: make a canvas, wrap it in a `Surface`, make a `Camera` with world
bounds from `tileBounds`, make a `Palette`, a `LightField`, a `DepthSorter`, a `Tweens`, a `Loop`
with `browserFrames`, an `InputSystem` bound to the canvas with `loop.stepMs`, then wire
`onUpdate → input.tick`, `onRender → input.frame` + `beginFrame`/`renderFrame`/`endFrame`, plus a
`resize` handler that has to remember to resize the surface, the camera **and** the light field.
Every one of those is a place to get the order wrong, and two of them (`stepMs`, the light field
resize) are silent when you do.

A `@lattice/kit`-style `bootstrap({ mount, seed })` returning `{ surface, camera, palette, light,
order, loop, input, scope }` would delete that from ten examples and is the clearest gap the
gallery has already found.

### Three things this exhibit had to write that felt like kit work

1. **A terrain quad on a heightfield.** `iso` ships `HeightField`/`heightAt`, and `draw` ships only
   flat diamonds — `isoTile` and `isoPatch` take one `z`. Drawing a tile whose four corners are at
   four different heights is `gridToScreen` × 4 into `pen.xy` plus `surface.poly`, and it lives in
   `sky.ts`. Every exhibit with terrain will write it.
2. **The drawable bucket.** `DepthSorter` holds rectangles and `draw` deliberately supplies no item
   list, so `main.ts` keeps a parallel `Thing[]` whose indices must line up with insertion order,
   and walkers are addressed as `index - things.length`. It is not hard, it is just the same
   thirty lines in every game, and getting it wrong is a silent mis-pick.
3. **Ground elevation into a sprite.** `drawSprite(pen, def, gx, gy, variant)` has no `zPx`, and
   `massing` is handed `(writer, variant, rng)` and nothing else — so a sprite standing on a hill
   cannot know how high the hill is. This exhibit smuggles it through `Variant.level`. See
   `sprites.ts`.

### Where the seams already fit well

`pathSample` is the whole crowd: eight walkers are eight calls with no per-walker state and
nothing allocated, and the same expression drives the light packets running up the road.
`LightField`'s accumulate-then-composite is the entire premise of the exhibit and needed no help.
`Palette.lerp` recolors the world on one number, and that same number drives the light mask and
the ambience bed, which is why sound and color cannot drift apart.
