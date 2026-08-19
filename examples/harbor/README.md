# Harbor

**Tall thin objects and depth sorting.** A hundred and ninety-six masts, crane towers, cabin
lights and hulls over open water, plus a jetty ninety tiles long — and **one** `DepthSorter`
holding every one of them.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-harbor
# http://localhost:5179
```

Then: **drag** along the jetty, **wheel** to zoom, and watch what happens where a hull crosses in
front of a piling. `?seed=` turns the fleet: the same seed is the same boats in the same water,
every time.

---

## Who built this, and from what

**Built by Codex**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row of the exhibits table, the whole of the
standard, and the tools — and it was deliberately **not** pointed at any existing exhibit's
source. Pattern-matching a neighbouring exhibit tests the neighbour; the fan-out was testing
whether the written spec is followable by a stranger.

The scene, the palette, the depth policy and every stroke of `art.ts` are that agent's. What
changed on the way into the repository is listed at the bottom of this file, and none of it is
the exhibit.

---

## The one idea: a narrow footprint says almost nothing about depth

A mast is about a twentieth of a tile wide and twelve storeys high. Nothing about the box it
*draws* tells you where it belongs in the order — only its base does — and that is the whole
reason this row exists. `iso`'s `DepthSorter` sorts on the footprint's base extent and never on
the drawn silhouette, so a mast that rises two hundred pixels up the screen still sorts as the one
tile of water it is standing in.

The failure the exhibit is built to *not* have is the jetty. It is one object, ninety-two tiles
long, one and a bit tiles deep, and it is in the same sorter as everything on and behind it. Sort
it separately — draw it in the terrain pass, which is the obvious thing to do with a long flat
thing — and hulls swim through it on the frames they cross. That defect is invisible in a
screenshot and wrong on every frame, which is the class of bug a depth demonstration exists to
make visible.

Three distance bands, and they are bands of *detail* as well as of distance: the far row of hulls
is a single pale slot with no glass and no glow, the middle row is the working harbor, and the
near row carries lit cabins and swaying rigging.

## Where `docs/GALLERY.md` made its author guess

Kept verbatim, because these are the deliverable as much as the exhibit is. Each is a place the
document could not be acted on without a decision, made by a reader who did not write it.

- **§ Scale fixes evaluation at 1440×900, and the harness reports a 1440×813 page** after being
  launched with `--size 1440x900`. I used the harness's reported 1440×813 for looking results and
  the specified 1440×900 for gallery extent ratios.
- **"Empty background" explicitly includes sea** — although water is Harbor's ground and its
  subject. I assumed visibly tiled, color-varied, animated water counts as world content, while
  still requiring its dominant-color reading to remain below one third.
- **"Density … measured in hundreds" does not say** whether that means generated worldwide or
  visible in the opening frame. I required both: 197 total and 184 visible.
- **"Far and dimmer" has no measurable threshold.** I interpreted it as simpler, paler hulls in
  the rear `gy` band, not a whole-scene opacity effect.
- **"Tall thin objects" supplies no aspect ratio.** I used mast widths around 0.045–0.055 tiles
  with heights up to twelve storeys, alongside narrow crane towers and cables.
- **The 60-fps cost gate names a "mid laptop" but no reference machine and no pass formula.** I
  used the required local Chrome, sampled `worstGapMs` for ten seconds, reported cadence beside
  it, and compared the worst gap with 16.7 ms.
- **Extent measures the world's bounding rect; fill measures the opening frame.** Two rows of one
  table, measured against two different things. I measured extent from the complete world bounds
  and framing from the harness screenshot.
- **"Something the exhibit is about is off-screen" is qualitative.** I satisfied it with the jetty
  and the harbor silhouettes continuing beyond multiple frame edges.
- **The cost-suppression mechanism references a shared gallery bootstrap that does not exist in
  this standalone directory.** I implemented the specified observable contract directly: `?cost=0`
  hides only the cost readout. *(In the repository it now reads `examples/_shared`'s `costNode` —
  see below.)*
- **Invalid or missing seed syntax is unspecified.** I chose decimal integer parsing, a stable
  default, and unsigned 32-bit normalization.
- **The spec does not say whether the jetty itself must participate in depth sorting.** I treated
  it as required, because boats crossing behind a terrain-painted jetty would undermine Harbor's
  central claim.

## The numbers it reported

| | |
|---|---|
| logic / art | **59 logic**, 50 art, against a cap of 200 |
| density | 197 objects sorted, 184 visible in the opening frame |
| extent | 8,064 × 4,302 px — **5.6×** the 1,440 px viewport on its long axis |
| worst gap / 10 s | 15.4 ms against a 10.1 ms cadence |
| harness | all five rows pass: 1,766 colors, 22% modal frame, 26% border, 3.21% motion, clean console |

`npm run gallery` reprints the split. It reads a little differently now — the boot moved into
`examples/_shared`, which the line rule never counts — and the exhibit is well under either way.

## What changed when it moved into the repository

Four things, none of them the scene:

1. **The hand-rolled boot became `examples/_shared`'s `bootstrap`.** The agent could not reach
   that directory and wrote the thirty lines itself, including `createLoop({ clock: { now: () =>
   performance.now() } })` — which the kit bans in exhibit source, and which `bootstrap` exists to
   own exactly once. The surface, palette, camera, input, resize handler and teardown all come
   from there now.
2. **`?cost=0` is `costNode()`** from the same module, rather than this exhibit's own reading of
   the query string. Same behaviour; one implementation instead of nineteen.
3. **The control panel arrived**, which § The control panel requires of every exhibit and which
   the agent explicitly declined to fabricate.
4. **The parallel array beside the sorter became `createBucket`**, so the sorter's integers and
   the array they index cannot come apart.

`terrain: 'flat'` was already declared, correctly, in the agent's own build.
