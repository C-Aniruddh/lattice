# Builder

**Placement: footprints, a ghost, validity, and the tap-to-tile seam.** A yard, a 3×2 workshop
already in your hands, and one predicate between the pixel a finger landed on and the six tiles it
would occupy.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-builder
# http://localhost:5185
```

Then: **move over the yard** and the ghost follows the tile under the cursor, green where the
footprint fits and red where it does not. **Tap** — or press **space** — to place. Open **knobs**
and drag `tapSlopPx`: this is the one exhibit where you can feel the threshold that decides
whether a finger that moved four pixels placed a building or panned the map.

---

## Who built this, and from what

**Built by Codex**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row, the whole standard and the tools, and it was
deliberately **not** shown any existing exhibit's source.

---

## The one idea: the seam a base-builder lives or dies on

`input` owns the conversion from a pointer to a tile. `iso` owns the footprint. This exhibit owns
the one predicate between them — inside the yard, six tiles clear of anything already standing —
and everything a visitor sees is a consequence of that single function:

- the **ghost** is the same footprint, drawn before it is committed, through `drawGhost`;
- the **colour under it** is the same boolean the tap will read;
- the **refusal** is the same call returning `false`.

Two copies of that rule would be two answers, and the one a visitor sees would be the one that is
not enforced. There is one.

There is no shop, no inventory and no selection step. The visitor arrives holding the workshop,
because a picker would be a second idea and rule 2 only allows one.

## Where `docs/GALLERY.md` made its author guess

Kept verbatim.

- **"Picks something up" does not define** whether Builder needs a shop, inventory, first-tap
  selection, or starts in placement mode. I assumed the visitor begins holding the named
  workshop; adding selection UI would introduce another idea.
- **Touch has no persistent hover cursor**, while the spec requires a ghost that "follows the
  cursor". I implemented the exact desktop hover seam through `input.hoverTile`; taps still use
  action-provided tile coordinates. On touch, placement remains tap-driven, but there is no
  pre-tap hover.
- **"Density … measured in hundreds" does not say what Builder repeats.** Hundreds of placeable
  buildings would undermine footprint validity, so I counted the repeated yard tiles; obstacles
  remain in dozens.
- **"Something the exhibit is about is off-screen" is ambiguous for a mechanic** rather than a
  scenic subject. I assumed additional buildable yard and obstacles satisfy it.
- **The three-distance-bands requirement does not define measurable boundaries** or dimming
  amounts for a flat placement field. I treated foreground tiles, mid-field obstacles and
  workshop, and the receding yard as the bands.
- **"60 fps on a mid laptop" does not define the reference hardware.** I treated a worst paint gap
  below 16.67 ms on the available harness machine as passing and reported the hardware-dependent
  raw values.
- **The harness's `--size 1440x900` produced a 1440×813 content viewport** because browser chrome
  consumed height. I requested 1440×987 to obtain the binding 1440×900 measured viewport.
- **The art-ratio report does not provide one canonical treatment** for static HTML/CSS alongside
  `@art` TypeScript. I report the reproducible module-command split; the HTML/CSS is also art
  under the prose rule but is not in the 31-line TypeScript-art figure.
- **Seed-from-URL says the same seed must reproduce the same world, but does not require different
  seeds to alter terrain or obstacle layout.** I kept the yard topology fixed and used the URL
  seed for workshop variants. The demonstration is the seam, and a yard that reshuffled under the
  seed would move the interesting part off screen.
- **"Worst frame in ten seconds" does not specify whether startup frames count.** I used the kit's
  rolling ten-second `worstGapMs`, which follows its documented warm-up exclusion.

## The numbers it reported

| | |
|---|---|
| logic / art | **59 logic**, 31 art, against a cap of 200 |
| extent | 2,432 px — 1.69× the 1,440 px viewport axis |
| density | 1,444 yard tiles and 66 deterministic obstacles |
| worst gap / 10 s | 15.0 ms, on a 120 Hz machine |
| placement audit | `{22,18}` refused, `{26,16}` placed, and the occupied footprint invalid afterwards |
| harness | all five rows pass: 763 colors, 32% modal frame, 22% border, 5.89% motion, clean console |

## What changed when it moved into the repository

1. **The hand-rolled boot became `examples/_shared`'s `bootstrap`** — including its
   `performance.now()` and its `surface.resize(innerWidth, innerHeight, devicePixelRatio)`, which
   walks straight past the `maxPixelRatio` clamp `createCanvas2dSurface` applied and quietly
   renders 2.25× the pixels a 3× phone budgeted for. `bootstrap.fit` reads the ratio back off the
   surface, which is the whole reason it exists.
2. **The control panel arrived**, headed by `tapSlop` rather than by a camera row, because on this
   exhibit that knob is the subject.
3. **`?cost=0` is `costNode()`.**
4. **`hoverTile` is read through `boot.input`** rather than through a captured reference, because
   the panel replaces the input system whenever a gesture threshold moves and a cached one
   survives the swap as a live object nothing is driving.

`terrain: 'flat'` was already declared, correctly, in the agent's own build — which matters here
more than in most rows: on a map with elevation the same silence resolves several tiles uphill of
the finger, plausibly enough that nothing downstream reports it, and this is the exhibit whose
whole subject is that resolution.

## What was left alone, and is a note for whoever picks this up next

The opening frame puts the **yard's north and south corners in shot**, with background behind
them — § Scale's *edges* row, which the harness cannot see and which its framing row passed at
32%. It is the agent's own framing, it measures well, and re-cropping it was out of scope for the
move. A tighter opening rectangle and a yard that runs off two more edges is the fix.
