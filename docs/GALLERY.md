# The gallery

Lattice does not ship one demo. It ships **10–15 small examples**, shown on a landing page,
each of which a visitor can understand in one to two minutes.

That is a deliberate choice over a single flagship game, for three reasons:

- **A kit is judged by range, not by depth.** One base-builder proves the kit can build that
  base-builder. Twelve exhibits across different layouts, palettes and mechanics prove it can
  build things nobody has designed yet, which is the actual claim.
- **Small exhibits get finished and stay beautiful.** A full game accretes systems until the
  art stops being the priority, which is precisely what happened to the first attempt here —
  it reached 1,450 lines and a near-black opening frame.
- **They are the documentation people actually use.** Nobody reads an API reference to find
  out how a thing feels. They open the example nearest what they want and start deleting.

**Each exhibit is inspiration and a starting point, not a product.** No endings, no meta
progression, no settings screens. If it is not visible in the first ninety seconds, it does
not belong in an exhibit.

---

## What makes an exhibit good

1. **The first frame is the pitch.** A visitor decides in about a second. It must be
   saturated, framed so the world fills the viewport, and immediately legible — you can see
   what the thing is and what you would touch.
2. **One idea, shown well.** Each exhibit exists to demonstrate *one* capability. If you
   cannot say which in a sentence, it is two exhibits or none.
3. **Something moves before the visitor does anything.** A static first frame reads as a
   screenshot of a game rather than a game.
4. **Under 250 lines, most of it art.** The logic-to-art ratio is the kit's own report card:
   art code growing means the kit is working, logic code growing means it is not.
5. **Deterministic.** Same seed, same world. Every exhibit takes its seed from the URL so a
   visitor can share exactly what they saw.
6. **Zero assets, like everything else here.** Drawn and synthesised, no exceptions.

---

## The exhibits

Provisional. Each row names the one thing it exists to show, so an exhibit that drifts from
its row is either finished or is a different exhibit.

### Layouts and art direction — what the renderer can look like

| exhibit | the one idea | leans on |
|---|---|---|
| **Island** | terrain, shoreline, trees, a full day/night cycle in ninety seconds | `draw` `iso` |
| **City block** | dense setback massing and a window rhythm — the technique that carries the whole look | `draw` |
| **Terraces** | elevation: a hillside of stepped fields, and why picking must be terrain-aware | `iso.height` |
| **Harbour** | tall thin objects and depth sorting — masts, cranes, a jetty over water | `iso.depth` |
| **Orbit** | no ground at all: platforms, stars, a cold palette. The kit is not only for grass | `draw.palette` |
| **Caverns** | the light field alone — darkness, torches, pools that meet without a bright seam | `draw.light` |

### Mechanics — what the kit can do that is hard elsewhere

| exhibit | the one idea | leans on |
|---|---|---|
| **Crowd** | two hundred walkers from one closed-form expression, no per-walker state | `iso.path` |
| **Wayfinding** | a flow field re-routing a moving crowd the instant the map changes | `iso.path` |
| **Builder** | placement: footprints, a ghost, validity, and the tap→tile seam | `iso` `input` |
| **Idle** | cost curves and buy-max in closed form, then fourteen hours of offline in one frame | `sim` |
| **Lamplighter** | capacity gating made visible — light as the resource, and dusk as the pressure | `sim` `draw.light` |
| **Replay** | record, scrub, and prove it: the same seed and log land on the same pixel | `loop` `persist` `input` |
| **Migration** | a v1 save opened by a v5 build, stepping the chain in front of you | `persist` |
| **Instrument** | sound with no files — a board that shows the synthesis as it plays | `audio` |

Fourteen. The list is expected to lose one or two that turn out to be dull and gain one or
two nobody has thought of.

---

## What the gallery is really for

**It is the widest test the kit will ever get, and it will find things.** Nine packages were
designed in parallel against one game's capability matrix. Fourteen exhibits will exercise
combinations nobody designed for, and every place two of them hand-roll the same thirty lines
of bootstrap is a gap in the kit rather than a coincidence.

So each exhibit's author reports the same two things the first demo was asked for: **where the
kit fought back**, and **the logic-to-art line split**. Those reports are the input to the next
cycle, and they matter more than the exhibits.

---

## The landing page

Built last, by an agent, once the exhibits exist.

- **Clean, minimal, dark.** IBM Plex Mono throughout.
- The gallery is the page. Exhibits are the content; prose is the caption.
- Each exhibit runs live and links to its source, because the source is the point.

Note that the landing page is **not part of the kit** and is not bound by the zero-asset rule
— a webfont is fine there. Nothing it does may leak into `packages/`, and no exhibit may
depend on it.
