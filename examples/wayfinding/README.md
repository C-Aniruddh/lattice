# Wayfinding

**A flow field re-routing a moving crowd the instant the map changes.** One `FlowField` over a
128×128 concourse, six hundred and forty walkers reading it, and three crossings in a divider that
a visitor can close with a tap.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-wayfinding
# http://localhost:5184
```

Then: **tap an amber crossing** to close it. The field is rebuilt inside the same update step,
before anything is drawn, so every walker takes its next step off the new field — the crowd turns
as one, and the contour rings on the floor bend somewhere else while you are looking at them.
`?seed=` scatters the crowd.

---

## Who built this, and from what

**Built by Codex**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row, the whole standard and the tools, and it was
deliberately **not** shown any existing exhibit's source.

The mechanic — one field, one rebuild, a divider with three holes in it — is that agent's, and it
is intact. The **composition** was rebuilt in the repository; that is the one substantive change
made to any of the eight, and the reason is below.

---

## The one idea: one rebuild, not six hundred and forty

There is no per-walker path and no re-plan anywhere in this exhibit. A walker holds a position,
reads `flow.step(gx, gy, out)`, and steps. When a crossing closes, exactly one thing happens —
`flow.build(cost, undefined, map.version)` — and every walker's next read returns a different
answer. That is the whole argument for a flow field over per-agent A\*: the cost of a map change
is independent of the crowd.

It is legible because the field is *drawn*. The paving carries a contour every 150 cost units —
`STEP_ORTHO` is 10, so that is a ring of equal walking distance every fifteen tiles, two tiles
thick. The rings bend around the divider, and closing a crossing bends them into a new shape a
visitor can see without being told what to look at.

## Why the composition was rebuilt, and what that says about the harness

The agent's build **passed** the looking harness's framing row at **57% of the frame in one color,
across 59% of the border**, against a threshold of 60%. It passed, and it read as a clumped crowd
on a large flat repeating texture rather than as a place.

Both of those are true at once, and the gap between them is the finding. **The row measures the
*modal* color, and a repeating texture defeats a modal-color test without doing any of the work
§ Scale is asking for.** Lay one slot color across a hundred and twenty-eight tiles square, stamp
a two-tone lane pattern over it, and the modal reading falls below the threshold while the frame
still contains one material, one scale, no structure and no distance bands. The letter was
satisfied; the intent — *three distance bands, edges the world runs off, no more than a third of
the frame empty* — was not.

**The harness was not changed.** It is a floor and it says so in its own header: *"is there a
frame, is anything moving in it, can the writing be read, did anything throw… none of what makes a
game worth playing."* An exhibit that passes it and still looks wrong is a normal outcome, not a
defect in the instrument. The composition changed instead:

| | before | after |
|---|---|---|
| **paving** | one `ground` slot, plus a two-tone lane | eight quantized shades of the slot, in two-tile slabs with grout, plus contour inlay |
| **structure** | nothing standing but the divider | 72 columns on a six-by-twelve lattice, 150 planters, 96 benches — all in the frame's one sorter |
| **the divider** | a row of dark tiles painted with the ground | a two-storey wall in the sorter, so a walker behind it is behind it |
| **the crowd** | 420, massed in one 28-wide block | 640, spread across the whole west half and recycled on arrival |
| **depth** | one plane at one scale | near columns lit and capitalled, far columns simplified and taken down by a constant-color haze |
| **framing** | fit to a rectangle 76×84 tiles wide | fit to 24×26, opening on the middle crossing |
| **harness framing row** | 57% modal / 59% border | **20% modal / 23% border** |

The last row of that table is a consequence and not the goal. The goal is the one above it.

One of those changes was a plain bug rather than a judgement: `tileBounds` takes an **origin and a
size**, and the opening rectangle had been written as if it took two corners — so "a slice of the
hall" was most of the hall, and the camera clamped out at `minZoom` with the map's own corners in
shot. That is § Scale's diorama failure arrived at by a signature misreading, and it is worth
recording because nothing about the call site says which convention it is.

## Where `docs/GALLERY.md` made its author guess

Kept verbatim.

- **"Instant" is not quantified.** I interpreted it as rebuilding synchronously during the input
  update, before the next rendered frame — not within a stated millisecond threshold.
- **"The crowd turns as one" does not define** whether every walker must adopt an identical
  heading. I interpreted it as every walker reading the newly rebuilt field on the same simulation
  step; their resulting directions differ by position.
- **The spec does not define what kind of map edit Wayfinding uses.** I chose closing and
  reopening crossings in a long impassable divider, because isolated obstacles did not produce a
  sufficiently global reroute.
- **It does not say whether map edits may strand the crowd.** Three crossings are independently
  toggleable, so a visitor can eventually close all three. The resulting stranded state is honest
  flow-field behavior, but the spec does not say whether it should be prevented.
- **"Something the exhibit is about is off-screen" is not measurable.** I placed the destination
  beyond the opening view and treated it as the required off-screen subject.
- **"Three distance bands" provides no objective boundary.** I treated the near crossing, the
  central crowd and divider, and the distant crossings and field as the three.
- **"No more than a third empty background" does not define** how patterned ground, sky-colored
  ground or HUD-covered pixels are classified. I relied on the harness framing pass and visual
  edge coverage. *(This is the guess the rebuild above is a consequence of.)*
- **"The world meets the frame edge" does not specify how many edges.** I assumed continuous
  ground meeting all four is sufficient.
- **"Density … measured in hundreds" does not say total or visible population.** I used the
  stricter reading.
- **"60 fps on a mid laptop" does not define the laptop, browser, refresh rate, percentile or
  exact pass threshold.** I used the supplied Chrome harness and treated a worst gap below
  16.67 ms as the gate.
- **The cost rule asks for the worst frame over ten seconds, but the supplied harness captures a
  short window.** I retained the exhibit's continuously accumulated worst-gap HUD and reported the
  harness observation rather than claiming an exact ten-second sample.
- **The specified 1440×900 opening frame conflicts with the harness's result:** Chrome exposed a
  1440×813 inner viewport. I used the harness-reported viewport as the judged frame.
- **The line rule says art modules may write DOM but may not retain state, while fixed HUD markup
  in HTML is also art.** I placed fixed markup and styling in `index.html`, and left all
  state-derived values and handlers in logic.
- **The document requires a shared slider control panel, and this standalone directory has no
  `examples/_shared`.** I did not invent exhibit-specific sliders, because they would add a second
  interaction beside the one map-changing gesture.
- **The gallery reads `order.count` for visible density, and this exhibit did not need a
  `DepthSorter`.** I exposed an order-shaped read-only count rather than introducing a sorter
  solely for instrumentation. *(It has a real one now — the colonnade needs it.)*
- **GALLERY says a HUD must show its worst frame, and elsewhere explains that the useful value is
  `worstGapMs` and not `worstFrameMs`.** I displayed `worstGapMs`, treating "worst frame" as the
  user-facing name for that measurement.

## What changed when it moved into the repository

1. **The hand-rolled boot became `examples/_shared`'s `bootstrap`**, which owns the
   `performance.now()` the kit bans in exhibit source, and brought `controlPanel`, `costNode` and
   `boot.params` with it.
2. **The composition was rebuilt**, per the table above. `art.ts` grew the colonnade, the props
   and the paving; `main.ts` grew a `createBucket` so that the hall, the divider and the crowd are
   one sorted collection rather than three passes that can disagree.
3. **The contour test was a no-op and is now the field.** It read `cost % 6144 < 2200` against a
   field whose largest cost is under 2,000, so it was true almost everywhere: the floor was
   dressed rather than explained.
4. **`terrain: 'flat'` moved onto `bootstrap`.** It was already declared correctly.
