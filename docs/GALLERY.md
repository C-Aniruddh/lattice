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
6. **Zero assets, like everything else here.** Drawn and synthesized, no exceptions.
7. **The overlay is `@lattice/ui`, not canvas text.** This is a rule rather than a preference,
   and it exists because an audit found that **not one of the fifteen rows below named `ui` at
   all**. A whole package reached 100% coverage with no consumer in the entire plan — and the
   one UI-shaped artifact in the gallery, the control panel, lives in `examples/_shared`
   precisely because `ui` is deliberately not a controls library. So the HUD is where `ui`
   gets exercised, and if an exhibit finds it easier to draw its readouts into the canvas,
   that is a finding about `ui` and it gets reported rather than worked around.

   It also carries the one cross-package promise **nothing has ever executed**: `draw`'s
   `paletteVars` reaching the DOM as CSS custom properties, so the overlay darkens with the
   world instead of glowing in daylight colors over a night scene.

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
| **Resonance** | a game you play *by ear*: gates hum a chord and you have to answer it | `audio` `draw.light` |

Fifteen. The list is expected to lose one or two that turn out to be dull and gain one or
two nobody has thought of.

### Resonance, because an audio package needs a game and not a demo

`Instrument` shows the synthesis. It does not prove anyone would ever *use* it, and a sound
board is the kind of exhibit people admire for nine seconds. So one exhibit puts sound on the
critical path: you walk a dark cavern, every locked gate hums a chord, and you carry a few
tuned strings. Strike the combination that answers the gate and it opens.

It is the right test of `audio` for reasons a board is not. **You cannot fake it** — the pitch
relationships have to be actually correct, the attack has to be fast enough to feel like an
instrument rather than a notification, and voices have to stack without clipping when a player
mashes all of them at once, which is the first thing anyone does. It also forces the two halves
together: the bed has to duck under the puzzle tones and come back, which is the one thing a
board never asks of a mixer.

Pair it with the light field and it earns two exhibits' worth of screen: a cavern lit only by
what you have opened, and sound as the sense you navigate by.

---

## The control panel

**Every exhibit ships a slider panel that exposes the real parameters underneath it.**

This started as a nicety and is better than that. The kit's configurability is currently
invisible: it lives in doc comments and RFC tables, and a visitor has no way to discover that
the camera's zoom clamp, the day length, the offline exponent, a light's radius and falloff,
the voice ceiling and the tap-versus-drag thresholds are all knobs. A panel that moves them
live, in a running scene, is better documentation than the paragraph explaining them — and it
costs one shared module.

It also turns each exhibit into an experiment a visitor can run:

- **Show the failure, not just the setting.** Push the voice ceiling to two and hear a burst
  choke. Drag the offline exponent to 1.0 and watch a fourteen-hour absence pay out
  uncapped. Set the tap slop to 1 px and discover you can no longer tap anything on a
  touchscreen. The knobs that matter are the ones with a visible wrong end.
- **Every panel value is in the URL**, so a visitor can share the configuration that made the
  thing look good, and a bug report can be a link.
- **Nothing in the panel is exhibit-specific plumbing.** A control declares the kit parameter
  it drives, and reading a panel tells you what the kit lets you change. If an exhibit wants a
  slider for something the kit does not expose, that is a finding.

It lives in `examples/_shared/`, not in `packages/`. It is a gallery instrument, not a kit
feature, and `@lattice/ui` is deliberately not a controls library.

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

Built last, by an agent, once the exhibits exist. It has one job: **make Lattice the obvious
choice for anyone building an isometric game with an agent, within about four seconds of
arriving.**

### The resolution of the two briefs

"Clean, minimal, dark, IBM Plex Mono" and "a visual treat showing the full wrath of the kit"
sound like opposite instructions. They are not, and the resolution is the whole design:

> **The chrome is minimal. The content is maximal.**

Restrained monospace typography, near-black ground, almost no ornament, generous space — and
inside that frame, worlds that move. Every dev-tool page worth remembering works this way: the
type gets out of the way so the thing being sold is the only loud object on screen. A page
that is itself decorated competes with its own product.

### The one rule that makes it a treat rather than a brochure

**Nothing on this page is a picture of Lattice. Everything is Lattice, running.**

No screenshots. No recorded video. No "watch the demo" button. The hero is a live isometric
world rendering in a canvas the moment the page paints, and the gallery below it is fourteen
*live* scenes in a grid — not fourteen thumbnails. Fourteen worlds animating at once, in a
page that weighs less than one hero image on a typical framework site, is a claim no
competitor can make and no visitor can misread.

That single decision does the persuading. A visitor does not need to be told the renderer is
fast; they are watching fourteen of them.

### What the page has to land, in order

1. **The first frame.** A world, moving, before any text is read. Saturated, framed to fill,
   with something already happening in it — pilgrims walking, a light coming on, a crane
   turning. If the hero is static for even a second on load, it reads as an image and the
   entire premise is lost.
2. **What it is, in one line**, under it. Not a feature list.
3. **The proof, as numbers rather than adjectives.** Zero dependencies. Zero asset files.
   Nine packages. Roughly 78 kB gzipped for all of them. ~2,300 tests. A frame budget the
   page is meeting live — and it may as well *show* the frame time, because a page confident
   enough to display its own render cost is making an argument.
4. **The agent story, prominently and early.** This is the differentiator and it is the part
   a generic gamedev library cannot copy: install the skills, point an agent at it, get a
   game. Show the actual invocation. Show what an agent produces. The audience is people who
   will build this *with* an agent, and the page should be legible to the agent too.
5. **The gallery.** Fourteen live tiles, each one line of caption, each linking to source.
   The source is the point — a visitor who likes a tile wants the file, immediately.
6. **One paste-able example** that compiles, sized so the whole thing fits on screen at once.

### Interaction

The hero should be **playable, not merely animated** — drag to pan, scroll to zoom, tap
something and watch it respond. The moment a visitor discovers the header image is a game,
the page has won, and that discovery should take under two seconds of idle cursor movement.

Scroll can direct the hero: day into night as the reader descends, or an empty valley filling
in. The kit already does this; the page should use its own product as its scroll animation
rather than importing a library to fake one.

### Constraints

- The page is **not part of the kit** and is not bound by the zero-asset rule — a webfont is
  fine here. But it should hold itself to the rule anyway wherever it can, because a landing
  page that quietly needs a sprite sheet to look good is an argument against its own product.
- **Nothing it does may leak into `packages/`**, and no exhibit may depend on it.
- It must be **fast on a phone**. Fourteen live scenes is a spectacle on a laptop and a
  disaster on a mid-range Android unless the tiles are paused until scrolled into view and
  the hero drops to a lower cadence off-screen. The kit gives you exactly the tools for this
  and it would be embarrassing to get wrong on a page selling frame-time discipline.
- **It works with JavaScript disabled** to the extent of showing what the project is. Not
  gracefully — just honestly.
