# Looking at it

The step the preflight was protecting. `npm run check` passing is not this step, and "it
compiles" is not done.

There is almost always a way to look. The rest of this file is that claim made concrete.

---

## The ladder

Four instruments, best first. **Each rung works in strictly more places than the one above it**,
and you go down the ladder only when the rung above is genuinely absent — not when it is
inconvenient.

| | instrument | you have it when | what you get |
|---|---|---|---|
| **1** | a native browser tool | tool names beginning `mcp__claude-in-chrome__` resolve | the live page, clicks, the console, a real screenshot |
| **2** | a browser MCP server | the user has run one `mcp add` command | the same, in any agent that speaks MCP |
| **3** | **`look.mjs` — a script you run yourself** | there is a shell and a Chrome on the machine | screenshots as PNG files, plus the numbers |
| **4** | **the same script, numbers only** | as rung 3 | the numbers, and no need to see anything |

Rungs 3 and 4 are **one command**. That is the point of it: it writes the pictures *and* prints
the readings, so an agent that can open a PNG and an agent that cannot both get something they
can act on, and neither has to work out in advance which of the two it is.

**Reach rung 3 before you conclude you cannot look.** In the run that produced this file, the
preflight said no browser and the agent checked anyway, found Chrome installed, drove it from a
script, and caught four defects with it — a viewport that left half the frame empty ocean, a HUD
in black on black, light pools two hundred pixels off the water they were meant to light, and a
price curve that made losing the cheapest way to play. The agent that took the preflight at its
word shipped the same failure classes. **The check said no and the answer was yes.**

### Rung 1 — a native browser tool

Load them in one lookup rather than one at a time; each separate lookup is a wasted round trip:

```
ToolSearch: select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__tabs_create_mcp
```

If a `claude-in-chrome` skill is listed in this session, invoke it **before** calling any of
them. Schemas come back, you are on rung 1. Nothing comes back, go to rung 2.

### Rung 2 — a browser MCP server

Worth one sentence to the user, because it is one command and then every future session has it:

> If you want me to see this properly, run `codex mcp add chrome-devtools -- npx -y
> chrome-devtools-mcp@latest` in another terminal and say "ready". Otherwise I'll use my own
> screenshots, which works fine.

Registration verified working in Codex and in Grok. The exact command differs by agent:

| agent | command |
|---|---|
| Codex | `codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` |
| Grok | `grok mcp add chrome-devtools npx -- -y chrome-devtools-mcp@latest` |
| Claude Code | `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest` |

**Note the `--`**, and note that Grok wants the command *before* it while Codex wants it after.
Getting that wrong registers a server that hands `-y` to the CLI instead of to npx, and the
failure appears later as a server that will not start. `grok mcp doctor` reports the handshake
and the tool count without spending a model call, which makes it the cheapest way to know.

**Do not ask twice, and do not block on the answer.** This is an offer, not the consent
question — you have rung 3 either way, so if they do not answer, carry on down the ladder.

### Rung 3 — the script, which is where you will usually be

`look.mjs` ships **in this same folder**, beside the file you are reading. Copy it into the
project once and run it from there:

```bash
mkdir -p tools
cp "$(dirname "<the path you read looking.md from>")/look.mjs" tools/look.mjs
node tools/look.mjs http://localhost:5173 --out .look
```

You already know that directory — it is wherever you just read this file from. If you have lost
it, find it rather than rewriting the harness from memory:

```bash
find ~ -name look.mjs -path '*lattice*' 2>/dev/null | head -1
```

Run it against a dev server that is already up. If `npm run dev` is not running yet, start it in
the background first and give it a couple of seconds; `look.mjs` exits `2` with "is the dev
server running?" rather than hanging if it is not.

It has **no dependencies** and needs no install, in a freshly scaffolded directory or any other.
Set `CHROME_PATH` if it cannot find a browser.

It writes `.look/frame-a.png` and `.look/frame-b.png`. **If you can open an image, open them.**
Most agents can, including ones that do not advertise it — Codex reads a PNG from disk mid-session
through `view_image`, and Claude reads one with its file-reading tool. Try it before assuming
otherwise; the cost of trying is one tool call and the cost of not trying is the whole loop.

Add `.look/` to `.gitignore`.

### Rung 4 — the numbers, when nothing can see

The same command already printed them:

```
looked at http://localhost:5173 — 1280×713

  pass  anything    188 distinct colors, mean luminance 0.071
  FAIL  framing     99% of the frame is #081020, 100% of the border
  pass  motion      78.03% of pixels changed in 1.0s
  FAIL  legibility  "Stone 128" contrast 1.03, range 0.0004
  pass  console     clean
```

Exit code `0` when every row passed, `1` when a row failed, `2` when the script could not run at
all. **`2` is not a failing game — it is a failure to look**, and the two must never be reported
as the same thing.

| row | the failure it names |
|---|---|
| `anything` | nothing was drawn. A flat field, however it was reached |
| `framing` | a small diamond in a big empty frame. The diorama measured **99%**; a world that fills the viewport measures around **30%** |
| `motion` | nothing moved in a second. A screenshot of a game rather than a game |
| `legibility` | HUD text that cannot be read against what is behind it. Black on black measures **contrast 1.03** against a floor of 3 |
| `console` | the exceptions and warnings no picture shows you |

There is deliberately **no brightness floor**. A night game is legitimately dark, and a threshold
on mean luminance would fail exactly the games this kit is best at. The blank-screen test is
flatness, not darkness.

**What the numbers do not catch**, and you must not report as if they did:

- **whether the picture is any good.** A bright, busy, moving frame of complete nonsense passes
  every row;
- **depth and density** — two of the five rows below. Nothing in a histogram tells four hundred
  huts from thirty. Ask the game instead: `--eval 'order.count'`;
- **a color that came out of the wrong slot** — a roof painted in `ink`, near-black against a
  night sea. This was measured, and withdrawn: anchored to the frame's most common color it
  fires on every *good* night scene too, and a reading that is red when things are right teaches
  you to ignore the report. That defect is closed at source instead — see the fills-versus-outlines
  table at the top of the `art` skill;
- **a HUD drawn into the canvas.** `legibility` reads DOM text nodes, so a painted HUD reports
  zero nodes, and zero nodes is not a pass.

So: a floor, not a verdict. Every row green and you have established that there is a moving,
non-blank, readable frame with no exceptions in it. That is precisely what the two blind agents
failed to establish, and precisely not the same as a good game.

---

## Sample the cycle at both ends, never once

**A day cycle has a worst hour, and an author sees whichever hour was on screen when they
happened to look.** That sample time is an accident; the worst hour is the one that ships. It has
gone wrong here three times — a night game that opened on a near-black screen; a stranger's
orchard, verified by its author at *"Dawn mist"*, where it is lovely; and that same build,
measured later at the other end of its sixty-second day, at **84% of the frame near-black across
98% of the border**. Nothing was flaky. The clock had moved.

So state the hour rather than accepting it. Two flags, both the `--eval` path with the timing
moved:

```bash
node tools/look.mjs http://localhost:5173 --advance 30s      # half a day later
node tools/look.mjs http://localhost:5173 --at '__lattice.setHour(3)'
```

`--advance` shifts the page's wall clock — `Date.now()` and `new Date()` — before the first line
of the page runs. It reaches a cycle read off that clock, `(Date.now() % DAY_MS) / DAY_MS`, which
is the shape a game with offline progress already has. **It does not reach a cycle accumulated
from `dt` inside `update`**, and cannot: the loop clamps a jump to `maxCatchUpMs` on purpose.
Those games need `--at`, which runs an expression in the page before the capture — so give the
harness something to call, next to `order` and `loop` on `__lattice`.

Two looks, half a cycle apart, is the floor. **If the two reports' `anything` line is identical,
the clock never moved**: the flag did not reach this game and you still have one sample, not two.

---

## The loop

1. `npm run check` — a type error is a wrong game, not a red squiggle.
2. Look, by the best rung you have — and if there is a day cycle, at both ends of it.
3. **Read the console.** Warnings from `@latticekit/*` are written for you and usually name the
   exact mistake — `input`'s covered-by-overlay diagnostic, `draw`'s missing light field, `iso`'s
   "you did not call sort()". Rung 3 collects these for you into the `console` row.
4. Judge what you got against the five rows below.
5. Fix **one** thing. Look again.

Repeat until it is worth showing. Then show it: the link, the picture, and one sentence about
what to touch.

---

## What you are looking for

A screenshot answers all five of these and a passing test answers none of them. Rungs 3 and 4
answer the first three; the last two are yours.

| | the question | the failure it catches | measured? |
|---|---|---|---|
| **anything** | is there a picture at all, or a flat field of one color? | a black or single-color screen. Six ordinary causes below and none of them throws | yes |
| **framing** | does the world fill the frame, or is it a small diamond in a big empty background? | a camera that was never framed. A fresh camera looks at world (0, 0), which in this projection is the **top corner** of the map, so the opening frame is empty space *beside* the world | yes |
| **motion** | is anything moving before you touch it? | a static first frame reads as a screenshot of a game | yes |
| **depth** | are there at least three distance bands — something near, something mid, something far and dimmer? | one plane at one scale is why a diorama looks small | no |
| **density** | is the thing the game repeats measured in hundreds, or in a dozen? | thirty of anything disproves the whole point of the kit | no — use `--eval` |

Two more worth a glance once the picture is right: **no more than about a third** of the frame
should be empty sky or sea, and the world should meet a frame edge somewhere rather than floating
as a slab with background all around it. The `framing` row reports both.

---

## A blank or one-color screen

Six causes, none of which throws. Check in this order — it is cheapest-first, not
most-likely-first, and the first three take one look each.

1. **The camera is looking at the corner of the world.** Symptom: a mostly-empty frame with a
   sliver of something at one edge, or nothing at all; `framing` above 95%. Cause: a camera
   constructed and never framed — or framed to the *whole map*, which is its own diorama. The
   `starting` skill has the opening rect and the numbers it measures at; use those rather than
   inventing a `fitBounds` call here.
2. **`sort()` was never called on the depth sorter**, so nothing painted. This one *does* throw —
   a `TypeError` naming the missing `sort()` — so it is in the console, and in the `console` row.
3. **The whole frame is night.** A light field with `darkness` at 1 and no lights in it is a
   correct, working, entirely black picture. Turn the darkness down and see if a world appears.
4. **The light field was never attached to the pen.** Symptom: full daylight, no night at all,
   and everything you did to make it dark had no effect. `beginFrame({ …, light })` is the one
   line; leave `light` out and `renderFrame`'s composite does nothing, every sprite's `emit` hook
   is skipped, and the field goes on reporting that it is active with a live pool count.
5. **The canvas has no size.** Symptom: a genuinely empty page with a canvas element in it. The
   surface is sized in CSS pixels from the element, so an element with no height gets a zero
   frame. The scaffold's `#app { position: fixed; inset: 0 }` is what prevents it.
6. **The tab is hidden.** If a frame-time readout says `0.0 ms`, the tab is not fast — it is
   backgrounded, `requestAnimationFrame` is at 0 Hz and nothing has painted since you looked
   away. Bring it to the front before believing any number on it. (Rung 3 is immune: it runs its
   own foreground browser.)

---

## Numbers you can read off the running game

Only two, and both have a wrong sibling that reads better and means nothing. Both are reachable
without a browser tool — `node tools/look.mjs <url> --eval '<expression>'` evaluates in the page
and prints what it returns, which is how a blind agent asks the game a direct question.

**Frame time.** Read `loop.stats.worstGapMs`, never `loop.stats.worstFrameMs`. The second one
measures the pump's own work, so a garbage collection or a style recalculation landing *between*
two pumps is in neither reading — one exhibit measured 23.1 ms worst on one machine and 13.1 ms
on another *for the same build*, because whether the pause lands inside a pump is
machine-dependent and the readout is not.

And read it next to `loop.stats.cadenceMs`, never next to a budget. A gap contains a whole display
period that is not work: 16.7 ms is a perfect frame on a 60 Hz panel and 8.3 ms is a perfect one
at 120 Hz, so the verdict is the ratio. Under about one and a half cadences dropped no frames.

**How much is on screen.** `order.count` after `sort()` — the number of things that survived
culling. If it is in the dozens when the game is supposed to be about hundreds of something, the
density row above is failing and no amount of art will fix it.

To reach either from a script, hang them off the window in your boot — one line, and it is the
difference between a blind agent that can ask questions and one that cannot:

```ts
// dev only: gives the looking harness something to ask — and, if there is a day cycle,
// something to set, so `--at '__lattice.setHour(3)'` can put the world at its worst hour
(globalThis as Record<string, unknown>).__lattice = { loop, order, camera, setHour };
```

```bash
node tools/look.mjs http://localhost:5173 --eval '__lattice.order.count' --eval '__lattice.loop.stats.worstGapMs'
```

---

## What to do with what you find

**Fix one thing, then look again.** Two changes and a changed picture tell you nothing about
which one did it, and half the failures in this kit are two correct things composing into a wrong
answer.

**Three attempts on the same symptom means stop.** Cut the feature that is failing, get back to a
screen that works, say what you cut in one sentence, and move on. A smaller game they can see
beats a bigger one they cannot.

**Never** report what the code should do. Report what the screenshot shows, or what the numbers
say — and when you only had the numbers, say that too. "Every reading is clean but I have not
seen it" is an honest sentence. "It looks great" is not, if you did not look.
