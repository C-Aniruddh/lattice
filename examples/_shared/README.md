# examples/_shared

What every exhibit in the gallery shares. Three modules, independent of each other, and none of
them a kit feature.

| | |
|---|---|
| `bootstrap()` | the thirty lines of boot that would otherwise sit at the top of fourteen files |
| `controlPanel()` | sliders over the kit's **real** parameters, every value in the URL |
| `createBucket()` | the array a `DepthSorter`'s integers index into, and the one compare that keeps it aligned |

```bash
npx vite examples/_shared      # http://localhost:5183 — the harness, which is this folder's proof
```

Nothing here may move into `packages/`. No exhibit may depend on the landing page and the
landing page may not depend on an exhibit. `@latticekit/ui` is deliberately not a controls library
and the panel is not an attempt to make it one.

---

## Using it

```ts
import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';

const boot = bootstrap<'touch'>({ bounds: worldRect, actions: { touch: ['tap'] } });

boot.onUpdate((dt) => { world.step(dt); });

boot.onRender((pen) => {
  boot.light.begin(pen, night, 'night');
  fill(boot.order);
  renderFrame(pen, passes, boot.order);
});

boot.onAction('touch', (e) => { world.tapAt(e.gx, e.gy); });

controlPanel([knobs.tapSlop(boot), knobs.lightBloom(boot)], {
  params: boot.params,
  title: 'Island',
  stats: knobs.frameTime(boot),
});

boot.start();
```

`src/harness.ts` is the same thing in full, running, and is the file to copy from. It is not an
exhibit and never will be — it is eleven blocks and a ninety-second day, chosen because between
them they touch every seam this folder owns.

---

## The frame bucket

`docs/rfc/depth-bucket.md` is the specification and the argument; this is how to use it.

```ts
import { createBucket } from '../../_shared/src/index.js';

type Drawable = Thing | Walker;                        // heterogeneous, and none of it reaches iso
const bucket = createBucket<Drawable>(boot.order);      // once, at setup

const paint = (d: Drawable): void => { … };             // hoisted. a closure here is one per frame

const passes: Passes = {
  solids(pen) { framePen = pen; bucket.each(paint); },
};

boot.onRender((pen) => {
  bucket.clear();                                       // clears boot.order too — see below
  for (const t of things) bucket.add(t, t.gx, t.gy, t.def.w, t.def.d, t.top);
  for (let i = 0; i < walkers; i++) bucket.addPoint(pilgrims[i], here.gx, here.gy, z);
  renderFrame(pen, passes, boot.order);
});

boot.onAction('touch', () => {
  const hit = bucket.pick(underFinger);                 // a Drawable | undefined. never an integer
});
```

**No exhibit ever sees an insertion index again**, which is the whole deliverable. `T` is opaque
and is meant to be a union — the demo's is `Thing | number` — and the generic stops here:
`boot.order` is a plain `DepthSorter`, and `renderFrame`, `Passes.solids` and `pickSorted` never
hear about it.

### What cannot go wrong, and what merely throws

Three of the four traps in the RFC are *unrepresentable* rather than caught:

| the mistake | why it cannot be written |
|---|---|
| `index - things.length` | one array, and no caller is handed an index to do arithmetic on |
| the array and the sorter disagreeing about a fill | `add` does *both* writes; there is no way to do one without the other |
| clearing one and not the other | `bucket.clear()` clears the sorter too |

What is left is reaching *around* the bucket to `order.add`, which a helper cannot prevent. It is
detected at three points instead — the index compare in `add`, the count guard in `each`/`pick`,
and a per-item bound in `each` for the case the cull would otherwise hide — so the whole class is
thrown, named, and on the offending line.

**`clear()` clearing the sorter is the one departure from the RFC's surface.** The RFC kept the two
clears separate in case a game shared its sorter with something else in the same frame, but `add`
already refuses that by name (invariant B3), so there is never anything in the sorter the bucket
did not put there. `order.clear()` is idempotent, so the RFC's `order.clear(); bucket.clear();`
still reads and behaves exactly as written.

### It costs about 3%

`test/bucket.bench.ts`, against the hand-written parallel array it replaces — same scene, same
sorter, same walk, so the difference is one integer compare per drawable and one bound check per
painted item:

| drawables | by hand | bucket | |
|---|---|---|---|
| 100 | 0.0125 ms | 0.0143 ms | 1.14× |
| 400 | 0.0424 ms | 0.0449 ms | 1.06× |
| 2000 | 0.174 ms | 0.179 ms | 1.03× |

The realistic number is the 400 row — a busy scene after culling — where the helper costs 2.5 µs
against an 8 ms frame budget, and the ratio falls as the scene grows because the sort dominates.
`npm run bench` does **not** run this file: the root `benchmark.include` is scoped to `packages`.
Point a config at `examples/*/test/**` to reproduce it.

### The one wart

`each(visit)` hands the visitor an item and a sorted position and nothing else, so a visitor that
needs the `pen` must either close over it — a closure per frame, which is what the doc comment
tells you not to do — or read it from a module-level slot, which is what `src/harness.ts` does and
labels. A context-carrying overload (`each(ctx, (ctx, item, pos) => …)`) would remove it. Left out
because the RFC's surface does not have one and fourteen exhibits have not yet said they want one;
if they fork `each`, that is the promotion criterion answering itself.

### Not sorted, not detected

`Bucket.each`'s doc in the RFC promises a throw when the sorter has not been sorted this frame.
**It does not throw, and it cannot from here.** `DepthSorter` publishes `count`, `clear`, `add`,
`addPoint`, `sort` and `indexAt`, and none of them separates "not sorted" from "sorted and nothing
culled": before `sort()`, `order.count === bucket.count` and `indexAt(i) === i`, and a legitimate
unculled frame whose fill happened to be in depth order is bit-identical to it. Any detector built
on that is a false alarm on a real frame, which is worse than no detector.

The fix is three lines in `packages/iso` — a `sorted` flag that `add` and `clear` lower and `sort`
raises — and it is routed, not done. `test/bucket.test.ts` asserts the gap as a tripwire so that
whoever adds the flag is told where to come back to.

---

## The two silent steps, and what was done about them

`examples/demo/README.md` reported that two steps of the hand-rolled boot are **silent when they
are wrong** — no throw, no warning, and a picture that looks plausible. It named `stepMs` and the
light-field resize. Checked against the source: **the first is right, the second is not, and the
real second one is worse.**

### 1. `stepMs` — confirmed, and removed from the surface

`createInput` counts every gesture duration in ticks and multiplies by the `stepMs` it was
handed; it never reads a clock. It rejects zero and `NaN` (`system.ts:282`) and accepts every
other number. So `stepMs: 16` against a loop running at 16.667 is a long press that fires at
432 ms, a fling velocity 4% low, and a recorded log that `persist` will refuse months later
(`record.ts:143`) with a message nobody can trace back to the literal.

**There is no `stepMs` in `BootOptions`.** `bootstrap` builds the loop and then the input and
passes `loop.stepMs` across itself — including inside `setProfile`, which is the rebuild path and
the second place the same literal used to get typed. The mistake is not documented; it is
unrepresentable, because there is nowhere to write it.

### 2. `LightField.resize` — **not** silent, and not required at all

`LightField.begin` calls `ensure(pen.surface.width, pen.surface.height)` on every active frame
(`light.ts:275`), and `ensure` is a no-op when the size is unchanged. A field is therefore
already self-healing across a resize: forgetting `light.resize` costs one buffer reallocation on
the first dark frame afterwards and nothing else.

`bootstrap` calls it anyway, from the one `fit()` that also resizes the surface and the camera —
one line, and the alternative is fourteen exhibits depending on an implementation detail of
`draw` that no part of its contract promises. But the demo's README should not send the next
author looking for a bug that is not there, and `LightField.resize`'s own doc comment should say
whether it is a requirement or an optimization. Filed below.

### 2 (really) — the light field and the pen

This is the one that matters, and it is the same shape as `stepMs`: two objects that must be the
same object, connected by an optional field in a literal.

`beginFrame({ surface, camera, palette, t, light })` — drop the last word and:

- `pen.light` is `undefined`;
- `renderFrame` calls `pen.light?.composite()` (`layers.ts:186`), which does nothing;
- `drawSprite` skips every sprite's `emit` hook (`sprite.ts:671`), so no lamp glows;
- every `light.add()` still accumulates into a buffer nobody ever reads.

No error. No warning. A fully lit world, and a `LightField` reporting `active: true` and a live
`count` exactly as if it were working. The natural diagnosis is "the night is broken" and the
natural place to look is `light.ts`, where nothing is wrong.

**The exhibit never calls `beginFrame`.** `boot.onRender` hands over a pen this module built with
this module's own field already attached, and there is no option anywhere in `BootOptions` that
detaches them. The field is created unconditionally for the same reason: a `LightField` allocates
nothing and costs nothing while `darkness` is 0, so "an exhibit with no night" and "an exhibit
that forgot to wire its night" do not need to be two code paths.

### And a third, closed for free

`surface.resize(w, h, ratio)` takes the ratio as a parameter. Writing `devicePixelRatio` there —
the obvious thing — walks straight past the `maxPixelRatio` clamp `createCanvas2dSurface` applied
at construction, so a 3× phone quietly renders 2.25× the pixels it budgeted for and nothing says
so. `fit()` reads `surface.pixelRatio` back off the surface.

---

## Is this a `@latticekit/kit` package or an examples folder?

**Keep it in `examples/` — and the reason is not that it is too small to be a package. It is that
the question is wrong, because the thirty lines are two different things wearing one name.**

Split them:

**(a) Wiring with exactly one correct form.** `input` gets `loop.stepMs`. The pen gets the light
field. `input.tick` on update, `input.frame` on render. The surface resize gets
`surface.pixelRatio`. There is no game anywhere — in this repo or outside it — that wants a
different answer to any of these. That half is not convenience, and it is not a missing package
either: **it is two packages that can be wired together wrongly without either of them noticing.**
The fix belongs inside the packages that own the two ends. `createInput` should take the loop
rather than a bare number. `LightField.begin` should refuse a pen that is not carrying it. Each of
those is a few lines inside an existing package and it deletes the trap for **every** user of
Lattice, not for fourteen exhibits. A `@latticekit/kit` package that wires them correctly would fix
this only for people who use `@latticekit/kit`, which is precisely the people least likely to hit it.

**(b) Policy that is genuinely a choice.** Where the canvas mounts. Whether the loop autostarts.
What the camera opens on. Whether resize listens to `window` or a `ResizeObserver`. What the URL
keys are called. Every one of those is a defensible decision made here for fourteen exhibits that
all render full-screen, and a game that renders into a grid tile, or runs two cameras, or wants a
minimap, wants different ones. That is gallery convention, and a package that shipped these
answers would make them the kit's answers.

Three more reasons a package is the wrong move *today*:

- **It would sit on top of six of nine packages.** Nothing imports `ui`; a `kit` would be a second
  leaf that imports nearly everything. That does not break the DAG, but it changes the kit's
  character from *nine small libraries that compose* to *a framework with nine internals*, and the
  moment it exists, "which layer does my feature go in" starts getting answered wrong.
- **It is currently shaped by one exhibit's report.** It should be shaped by fourteen. That is
  what the gallery is for.
- **Moving up is cheap and moving down is not.** A published export is a promise.

So the recommendation is not "promote this later". It is **"delete half of it later"**: file the
(a) items as kit findings, and if they land, `bootstrap` shrinks to mounting a canvas and reading
a URL — far too little to be a package, which settles the question from the other side.

---

## The panel

A control declares **the kit parameter it drives**, and the name is rendered under the label. That
line is the difference between a settings screen and a map of the kit's own surface: reading a
panel tells you what the kit lets you change. A control that cannot name a real parameter is
exhibit plumbing, and the panel is not for that.

**The rule that makes it more than a nicety: ship the knobs with a visible wrong end.** A slider
that only ever looks fine teaches nothing. `Control.wrong` marks the bad end on the track in red
and puts the consequence on screen the moment you enter it, in the words of the doc comment that
defends the default — so the panel and the package cannot drift apart.

| knob | parameter | the wrong end, and what you see |
|---|---|---|
| tap slop | `input GestureProfile.tapSlopPx` | **1 px** — a fingertip moves further than that during a press that feels still. Nothing on a touchscreen can be tapped. Still works on a mouse, which is how it ships. |
| offline exponent | `sim OfflineCurve.exponent` | **1.0** — the curve is the identity. The harness's readout goes `14h→6.75h` to `14h→14.00h` and closing the tab becomes optimal play. |
| voice ceiling | `audio AudioOptions.maxVoices` | **1–3** — mash, and `play()` starts returning `false`. The burst comes back with holes in it and the refusal count climbs. |
| bloom | `draw LightFieldOpts.bloom` | **> 0.6** — an 8-bit buffer blows out to white wherever two pools meet. The single most legible failure in the kit. |
| keep on screen | `iso CameraOptions.keepVisible` | **0** — one flick and you are on empty ground with nothing to tap and no cue which way is back. |
| pixel snap | `draw FrameOpts.snap` | **off** — pan, and every 1 px stroke shimmers between one and two device pixels. |
| pixel ratio | `draw Canvas2dOpts.pixelRatio` | **> 2.5** — past the kit's own clamp; fill rate rises with the square and the picture does not change. |
| light buffer | `draw LightFieldOpts.scale` | **1.0** — two full-screen RGBA targets at device resolution, 20 MB and 4× the fill rate, for a softness nobody can point at. |
| long press | `input GestureProfile.longPressMs` | **< 200** — fires during ordinary taps. |
| glide half-life | `input GestureProfile.flingHalfLifeMs` | **> 700 ms** — the camera is still moving when the next gesture starts. |
| glide floor | `input GestureProfile.flingMinPxPerS` | **≈ 0** — every drag drifts and the camera can never be placed exactly. |
| horizon | `sim OfflineCurve.flatAfterSeconds` | **weeks** — the only clamp on an offline gap; a device clock a month fast pays a month. |
| zoom out limit | `iso CameraOptions.minZoom` | **< 0.2** — art unreadable, and every tile in the map enters the depth sort. |

`maxZoom`, `free window` and `pool edge` ship with no marker on purpose. A panel where everything
is dangerous teaches as little as one where nothing is.

### Every value is in the URL

`?tapSlop=12&offlineExp=1&voices=1` — only what differs from the exhibit as shipped, so a link
reads as *the list of things that are not default* and a bug report can be a link. Writes are
coalesced on a 250 ms trailing timer: Safari rate-limits `history.replaceState` and throws past
the limit, so a live slider drag would be an unhandled exception on exactly one browser.

### `?cost=0` — the one key an embedder sets rather than a control

Every other URL key here is written *by* a panel control. This one is only ever read, and only
ever by whoever is embedding an exhibit rather than opening it.

`docs/GALLERY.md` § Scale makes the worst frame a gate, so an exhibit shows its cost by default and
that default is not negotiable — `bootstrap({ showCost })` starts at `true`, `?cost=0` is the only
thing that turns it off, and the resolved answer is readable back as `boot.showCost`. What it is
for is the landing page: eleven exhibits in eleven iframes, each printing a worst frame measured on
a stranger's laptop, is eleven arguments about the visitor's hardware in a place that was meant to
be an argument about the kit. `cost.ts` has the reasoning; a HUD applies it with `costNode(node)`
on the element that carries the figure and its label, or `costText(clause)` where the figure shares
a sentence with something that stays.

```ts
import { costNode } from '../../_shared/src/index.js';

// hidden when the page embedded this exhibit as `…/island/?cost=0`, shown every other time
const card = costNode(el('section', { class: 'card cost' },
  el('span', { class: 'stat-label' }, 'WORST FRAME / 10s'), worst));
```

### It costs nothing per frame

No loop subscription, no `requestAnimationFrame`, no timer. Controls are native elements built
once; the only code that runs again is a change handler. The frame-time readout is the single
exception, is opt-in, samples twice a second, and stops when the panel closes.

Native `<input>`/`<select>` rather than styled `<div>`s, and not only for accessibility:
`input`'s key handler already declines to turn a keystroke into a game action when it is aimed at
an `INPUT`, `TEXTAREA` or `SELECT` (`dom.ts:309`), so a seed typed into the panel cannot also
drive the world. A custom widget would have had to reimplement that and would have got it wrong on
the exhibit that binds `KeyB`.

### `commit: 'change'`, which is a finding wearing a feature's clothes

Most kit parameters are **construction-time and have no setter**. Moving one is not a call, it is
*rebuild the subsystem and carry the state across* — which is why `Boot.setCamera`,
`Boot.setProfile` and `Boot.setLight` exist and why every control that uses one applies on
release rather than under the finger. For the voice ceiling that is not politeness: `Audio.dispose`
closes the `AudioContext`, a document may have about six, and a live drag would exhaust the cap in
a second and silence the exhibit permanently.

`sim`'s three knobs need none of this, because an `OfflineCurve` is plain data handed to
`offlineCredit` per call. It is worth noticing which shape made that possible.

---

## What the kit does not expose

Reported as findings, in the order they cost the most.

1. **`createInput.stepMs` takes a bare `number`.** Any positive value is accepted and every wrong
   one is silent. `input` is layer 2 and `loop` is layer 1, so it may take the loop — or a
   `{ readonly stepMs, readonly stepSeconds } (the loop itself)` structurally — and the literal becomes unconstructable.
2. **`beginFrame`'s `light` is an optional field and `renderFrame` uses `pen.light?.composite()`.**
   Omitting it is completely silent. Cheapest fix: `LightField.begin` throws when
   `pen.light !== this`, naming the missing option. One comparison, at the first frame.
3. **`Camera` has no reader for its own policy.** `minZoom`, `maxZoom` and `keepVisible` go in at
   construction and are never observable again, so a panel that shows a clamp keeps a shadow copy
   (`Boot.cameraPolicy`). Want `readonly minZoom/maxZoom/keepVisible`, plus a
   `setZoomLimits(min, max)` that re-clamps — `setBounds` already establishes the pattern, and with
   it the zoom knobs stop rebuilding the camera *and the input bound to it*.
4. **`GestureProfile` cannot be retuned after construction.** `input.profile` is frozen and the
   only route is dispose → recreate → re-register every handler, which is why `Boot.onAction`
   exists at all. Want `input.setProfile(overrides)`. It belongs in `input` rather than in a
   caller because only `input` knows what a mid-session fingerprint change means for a recording
   in flight — arguably it should refuse while one is running.
5. **`AudioOptions.maxVoices` has no setter.** `mixer` is mutable after construction; the ceiling
   is one number read by the play policy and should be too. As it stands, a voice-ceiling slider
   is a control that can permanently silence a page.
6. **`LightFieldOpts.scale` and `.bloom` are construction-only.** `falloff` got this right — `add`
   takes it per call. A `field.configure(opts)` that reallocates only when `scale` actually changed
   would make bloom a live knob and delete a whole class of `commit: 'change'`.
7. **`input` cannot be told an overlay is legitimate.** The `covered-by-overlay` diagnostic fires
   on the first tap on any HUD that overlaps the canvas — which is this panel, and every
   `@latticekit/ui` panel. The gallery filters it by class name in `bootstrap`, which is a workaround
   the kit should not require. Want `InputOptions.overlays` or an `ignoreCover(element)` seam.
8. **`LightField.resize` is redundant with `begin`** and its doc comment does not say so. Either
   delete it or state that it is an optimization, not a requirement — and correct
   `examples/demo/README.md`, which currently names it as one of the two silent traps.
9. **No frame-rate knob is safely offerable.** `LoopOptions.hz` is written into recorded logs and
   its own doc calls changing it "a migration, not a tuning pass". That is correct, and it is the
   reason this panel deliberately ships no frame-rate slider. Stated here so no exhibit adds one.

Not a gap, but the shape worth copying: **`sim`'s parameters are data passed per call, so all
three of its knobs are live and none of them needed a rebuild.** Every other package's parameters
are closed over at construction. If one API change were to make the whole panel simpler, it would
be moving `CameraOptions`, `GestureProfile` and `LightFieldOpts` from closure state to readable,
settable state.

---

## What is deliberately not here

- **Framing the world.** Choosing the zoom and center that make the first frame the pitch is the
  most exhibit-specific decision there is, and `iso` is growing `camera.fitBounds` for it.
  `bootstrap` only centers on `bounds`, because a fresh camera looks at world (0, 0) — the *top
  corner* of the map in a 2:1 projection — and an exhibit that forgets to frame would otherwise
  open on empty space beside its own world.
- **A drawable list with passes, layers or a camera in it.** Which object owns the parallel array
  beside `DepthSorter` had an RFC of its own (`docs/rfc/depth-bucket.md`) and now has an answer —
  `createBucket`, above — but the answer is deliberately *only* the array. A bucket that knew
  about passes is a `DrawList`, which `draw` deleted; a bucket that sorted would reopen the window
  `renderFrame` closes by sorting immediately before the solids pass.
- **A HUD, a palette schedule, or any sound.** Those are the exhibit.
- **Anything exhibit-specific in the panel.** A control must name a kit parameter. An exhibit's
  own value — a day length, a spawn rate — may be written as a `Control` literal, and the required
  `param` field forces it to say what it drives.

## Not done

- `examples/demo` still hand-rolls its boot. Migrating it belongs to K8, which owns that folder.
- The root `tsconfig.json` does not reference `examples/_shared`, so `npm run build` does not build
  it. It is covered by `npm run typecheck` (`tsconfig.check.json` includes `examples/*/src/**`) and
  by any exhibit that adds `{ "path": "../_shared" }` to its own references. Adding it to the root
  is one line in a file this task does not own.
- **`test/` here is run but not typechecked.** `vitest.config.ts` includes
  `examples/*/test/**` so `npm run test` runs `test/bucket.test.ts`, but `tsconfig.check.json`
  includes only `examples/*/src/**`, so `npm run typecheck` never looks at it. That is the exact
  hazard `AGENTS.md` warns about for `@ts-expect-error`, one folder over. Two words in
  `tsconfig.check.json`; not this task's file.
- **`examples/demo` should adopt `createBucket`.** It hand-rolls the pattern correctly today, in
  about a dozen lines and two `undefined` guards that exist only because indexed access is
  `T | undefined`. The helper deletes those and adds the compare the hand-rolled version has no
  way to have. Belongs to whoever holds `examples/demo`.
