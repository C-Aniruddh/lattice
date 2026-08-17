# Looking at it

The step the preflight was protecting. With a browser available this is not optional and
"it compiles" is not done.

---

## The loop

1. `npm run check` — a type error is a wrong game, not a red squiggle.
2. Open `http://localhost:5173` in a tab and **take a screenshot**.
3. **Read the console.** Warnings from `@lattice/*` are written for you and usually name the
   exact mistake — `input`'s covered-by-overlay diagnostic, `draw`'s missing light field,
   `iso`'s "you did not call sort()".
4. Judge the screenshot against the five rows below.
5. Fix **one** thing. Screenshot again.

Repeat until it is worth showing. Then show it: the link, the picture, and one sentence about
what to touch.

Browser tools live behind `mcp__claude-in-chrome__*`. If a `claude-in-chrome` skill is listed in
this session, invoke it **before** calling any of them. Load the tools with a single `ToolSearch`
for `navigate`, `computer`, `read_console_messages` and `tabs_create_mcp` rather than one at a
time — each separate lookup is a wasted round trip.

---

## What you are looking for

A screenshot answers all five of these and a passing test answers none of them.

| | the question | the failure it catches |
|---|---|---|
| **anything** | is there a picture at all, or a flat field of one color? | a black or single-color screen. See below — there are six ordinary causes and none of them throws |
| **framing** | does the world fill the frame, or is it a small diamond in a big empty background? | a camera that was never framed. A fresh camera looks at world (0, 0), which in this projection is the **top corner** of the map, so the opening frame is empty space *beside* the world |
| **motion** | is anything moving before you touch it? | a static first frame reads as a screenshot of a game rather than a game |
| **depth** | are there at least three distance bands — something near, something mid, something far and dimmer? | one plane at one scale is why a diorama looks small |
| **density** | is the thing the game repeats measured in hundreds, or in a dozen? | thirty of anything disproves the whole point of the kit |

Two more worth a glance once the picture is right: **no more than about a third** of the frame
should be empty sky or sea, and the world should meet a frame edge somewhere rather than
floating as a slab with background all around it.

---

## A blank or one-color screen

Six causes, none of which throws. Check in this order — it is cheapest-first, not
most-likely-first, and the first three take one look each.

1. **The camera is looking at the corner of the world.** Symptom: a mostly-empty frame with a
   sliver of something at one edge, or nothing at all. Cause: a camera was constructed and never
   framed. Fix: `camera.fitBounds(worldRect, 24)` — and pass your map's tallest elevation as
   `tileBounds`' height argument, or a tall world frames as though it were flat and the summit
   is off the top of the first frame.
2. **`sort()` was never called on the depth sorter**, so nothing painted. This one *does* throw
   — a `TypeError` naming the missing `sort()` — so it is in the console.
3. **The whole frame is night.** A light field with `darkness` at 1 and no lights in it is a
   correct, working, entirely black picture. Turn the darkness down and see if a world appears.
4. **The light field was never attached to the pen.** Symptom: full daylight, no night at all,
   and everything you did to make it dark had no effect. `beginFrame({ …, light })` is the one
   line; leave `light` out and `renderFrame`'s composite does nothing, every sprite's `emit`
   hook is skipped, and the field goes on reporting that it is active with a live pool count.
5. **The canvas has no size.** Symptom: a genuinely empty page with a canvas element in it. The
   surface is sized in CSS pixels from the element, so an element with no height gets a zero
   frame. The scaffold's `#app { position: fixed; inset: 0 }` is what prevents it.
6. **The tab is hidden.** If a frame-time readout says `0.0 ms`, the tab is not fast — it is
   backgrounded, `requestAnimationFrame` is at 0 Hz and nothing has painted since you looked
   away. Bring it to the front before believing any number on it.

---

## Numbers you can read off the running game

Only two, and both have a wrong sibling that reads better and means nothing.

**Frame time.** Read `loop.stats.worstGapMs`, never `loop.stats.worstFrameMs`. The second one
measures the pump's own work, so a garbage collection or a style recalculation landing *between*
two pumps is in neither reading — one exhibit measured 23.1 ms worst on one machine and 13.1 ms
on another *for the same build*, because whether the pause lands inside a pump is
machine-dependent and the readout is not.

And read it next to `loop.stats.cadenceMs`, never next to a budget. A gap contains a whole
display period that is not work: 16.7 ms is a perfect frame on a 60 Hz panel and 8.3 ms is a
perfect one at 120 Hz, so the verdict is the ratio. Under about one and a half cadences dropped
no frames.

**How much is on screen.** `order.count` after `sort()` — the number of things that survived
culling. If it is in the dozens when the game is supposed to be about hundreds of something,
the density row above is failing and no amount of art will fix it.

---

## What to do with what you find

**Fix one thing, then look again.** Two changes and a changed picture tell you nothing about
which one did it, and half the failures in this kit are two correct things composing into a
wrong answer.

**Three attempts on the same symptom means stop.** Cut the feature that is failing, get back to
a screen that works, say what you cut in one sentence, and move on. A smaller game they can see
beats a bigger one they cannot.

**Never** report what the code should do. Report what the screenshot shows.
