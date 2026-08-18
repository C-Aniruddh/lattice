# @latticekit/input

> Every way a person can touch a game — finger, mouse, pen, key — as **one replayable stream of
> intents in tile coordinates**, bucketed to simulation ticks, behind **one object** that unbinds
> all of it.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @latticekit/input
```

---

## The five lines a game actually writes

```ts
const input = createInput({
  element: canvas,
  camera,
  step: loop, //                                   the loop itself, so the step cannot drift
  terrain: 'flat', //                              or { field, maxHeightPx } if the ground rises
  actions: { collect: ['tap', 'key:Space'], build: ['key:KeyB'] },
});
input.onAction('collect', (a) => collectAt(state, a.gx, a.gy));
loop.onUpdate((_dt, tick) => input.tick(tick));
loop.onRender(() => input.frame(now));
onSceneEnd(() => input.dispose());
```

**`step` takes the loop, not a number.** Every duration this package reports is a count of ticks
times that step; it never reads a clock. A step that is not the loop's does not fail, it lies by a
constant ratio — `16` against a 16.667 ms loop is a long press at 432 ms, a fling 4% low, and a
recorded log that a replay refuses *months* later, none of which surfaces where the mistake was
made. So `stepMs: 16` no longer compiles, and neither does `{ stepMs: 16 }`: the shortest thing
that type-checks is the loop itself. Where there is no loop — a headless replay, a test — use
`fixedStep(hz)`, which derives the step with `createLoop`'s own arithmetic so the two are
bit-identical rather than merely close.

Pinch, wheel, two-finger pan, drag-to-pan and the arrow keys are all live in those five lines:
the camera controller is on by default, because a tile game whose camera does not move is not a
tile game, and making every game write that wiring is how every game gets it subtly different.

`'colect'` in the handler is a **compile error** — the action names are inferred from the object
literal above it.

> **Under Vite, `dispose` on hot reload or the game becomes a zombie.** HMR re-evaluates the
> module, `createInput` correctly throws on the second binding to the same canvas — and the
> *first* instance is still bound and still rendering. So the symptom is not the error: it is a
> game that keeps drawing while every tap does nothing and the HUD is frozen at whatever it last
> showed, with the real message buried in a console nobody is looking at by then. One line pays
> for itself: `if (import.meta.hot) import.meta.hot.dispose(() => input.dispose());`

---

## The ground, and why `gx`/`gy` depend on it

`terrain` is the one option with no safe default, so it is the one option worth reading about
before you write any of the others.

Screen → grid is the exact inverse of the projection **on the plane `z = 0`**, and on no other
plane. Raise a point by `HALF_H` world pixels and it lands on precisely the same screen pixel as
the point one unit of `gx + gy` further from the viewer at sea level — so a pixel does not name a
tile, it names a *family* of them, one per elevation. Without a heightfield this package answers
with the sea-level member of that family. On level ground that is the right answer. On a hillside
it is a real tile, next to the right one, moving smoothly with the pointer, and **wrong**:
`examples/terraces` measures 281 px and 14–16 tiles of it on its own slope, and it is worse than
static in `examples/clay`, where the visitor raises the ground under their own cursor and a brush
driven by `event.gx` walks off the far side of the hill while their hand holds still.

```ts
const input = createInput({
  element: canvas,
  camera,
  step: loop,
  terrain: { field: hill, maxHeightPx: hill.tallestUnits * hill.stepPx },
});

input.onAction('build', (a) => {
  if (!a.onGround) return; //          the tap was on the sky, and gx/gy are NaN
  place(state, a.gx, a.gy); //         the tile the player can see, not the one at sea level
});
```

| you pass | `gx`/`gy` resolve | `onGround` |
|---|---|---|
| `{ field, maxHeightPx }` | on the terrain, marched by `iso` | `false` where the ray leaves the map — a tap on the sky |
| `'flat'` | on the plane `z = 0` | always `true`: off the map is still a number, and `iso` decides what is in bounds |
| nothing | the plane `z = 0`, **and one `flat-ground-pick` diagnostic** the first time a coordinate is read | always `true` |

The third row is the point. This package cannot see your terrain — it has no map, no registry and
no way to acquire one — so it cannot detect the mistake, and nothing downstream can either. What
it *can* tell is that nobody ever said. `'flat'` is that statement, it costs one word, and it is
the difference between an answer you chose and an answer you inherited.

**`maxHeightPx` is where the march starts**: the tallest terrain on the map, in world pixels. Too
low and the search begins below a peak and misses it; too high and every pick scans ground that is
not there. Change it, or the whole declaration, with `input.setTerrain(...)` — the field is held
rather than copied, so ground the player raises this frame is ground the next event resolves on,
and a map generated after the input system was bound is one call away.

---

## The same thing, with no browser, run end to end

Everything below runs in Node with no DOM and no shim, and is executed by
[`test/readme.test.ts`](./test/readme.test.ts) on every commit.

```ts
import { createCamera } from '@latticekit/iso';
import { createHeadlessInput, createLog, fixedStep, record, replay } from '@latticekit/input';

const camera = createCamera(800, 600); //          CSS pixels, centered on (0, 0)
const input = createHeadlessInput({
  camera,
  step: fixedStep(60), //                          or `step: loop` in a game
  terrain: 'flat', //                              this world is a plane, and says so
  actions: { collect: ['tap', 'key:Space'] }, //   two sources, one handler
  focus: (at) => {
    at.x = 400; //                                 where the keyboard aims: the game's
    at.y = 300; //                                 selection, or the viewport center
    return true;
  },
});

const collected: string[] = [];
input.onAction('collect', (a) => {
  collected.push(`${a.source} via ${a.binding} at ${a.gx},${a.gy}`);
});

const tape = record(input); //                     everything from here is replayable

// a tap: press in one tick, release in the next
input.submit({ kind: 'down', id: 1, sx: 520, sy: 330, pointerType: 'touch' });
input.tick(0);
input.submit({ kind: 'up', id: 1, sx: 520, sy: 330 });
input.tick(1);

// a drag: past the finger's 9 px of slop, so it pans instead of tapping
input.submit({ kind: 'down', id: 1, sx: 400, sy: 300, pointerType: 'touch' });
input.tick(2);
input.submit({ kind: 'move', id: 1, sx: 340, sy: 300 }); //  crosses the slop: dragstart
input.tick(3);
input.submit({ kind: 'move', id: 1, sx: 280, sy: 300 }); //  60 px of pan
input.tick(4);
input.submit({ kind: 'up', id: 1, sx: 220, sy: 300 }); //    released moving: a fling
input.tick(5);

// the keyboard, which reaches the same handler
input.submit({ kind: 'key', code: 'Space', down: true });
input.tick(6);

const log = tape.stop();
console.log(collected.join('\n'));
console.log(`camera x after the drag: ${camera.x}`);
console.log(`gliding: ${input.camera.gliding}`);
console.log(`log: ${log.samples.length} samples, stepMs ${log.stepMs.toFixed(3)}`);
```

```
pointer via tap at 2,-1
key via key:Space at 0,-1
camera x after the drag: 60
gliding: true
log: 14 samples, stepMs 16.667
```

Four things worth reading out of that output:

- **The tap arrived as a tile.** No game code converted anything, and nothing could have
  converted it against the wrong camera.
- **The keyboard action landed on a different tile from the tap** — `0,-1` rather than `2,-1` —
  because the camera had panned in between and the focus point is a *screen* point. That is the
  whole reason a positionless source still has to answer "where".
- **The drag panned but the first 60 px did not.** Crossing the slop starts the drag; it does not
  pan by it, so the map picks up under the finger rather than jumping.
- **The release is still gliding.** The flick's inertia integrates in `frame`, at display rate.

Feed the log back and it replays exactly:

```ts
const again = createHeadlessInput({ /* the same options */ });
replay(again, log); //  identical gestures, identical ticks, identical tiles
```

`@latticekit/persist` stores that log verbatim and compares three fields before it will agree to
replay it — `version`, `stepMs` and `profile`. Read them off a fresh log rather than typing them
at the call site, so the recorded and the current cannot drift apart:

```ts
createVerifier(storedLog, { kit, game, inputs: createLog(input), digest });
```

---

## What it is

| | |
|---|---|
| **One stream** | A game never learns which device it is being played on. "Collect" is one handler, not three. |
| **Tile coordinates** | Every event carries `sx/sy` (screen), `wx/wy` (world) and `gx/gy` (tile), resolved once, through the camera as it stood when the tick opened **and the ground the system was told about**. |
| **Bucketed to ticks** | A tap cannot be dropped by a slow frame or fired twice on a fast one, because *ticks* deliver and each sample is in exactly one bucket. |
| **One object** | `input.dispose()` unbinds every listener, every child scope, every pointer capture, and any key the player was holding. |

### Gestures

`tap`, `longpress`, `dragstart`, `drag`, `dragend`, `zoom`. One `zoom` for wheel, trackpad pinch,
two-finger pinch and the zoom keys, because the camera does not care which it was and neither
does a game.

```ts
const scope = input.scope(); //             a scene holds this, not an array of disposers
scope.on('drag', (g) => {
  ghost.moveTo(g.gx, g.gy);
  g.claim(); //                             …and the camera will not also pan
});
scope.on('dragend', (g) => place(g.gx, g.gy));
scope.dispose(); //                         everything above, gone
```

There is **no free-function binder** in this package. A listener can only come from a scope, so
an unowned listener is not a thing that can be constructed — which is the difference between
"remember to unsubscribe" as documentation and as a property of the API.

### Queries, not streams

Continuous input is asked for, never pushed:

```ts
if (input.held('build')) chargeUp(dt);
if (input.hoverTile(tile)) highlight(tile.gx, tile.gy);
```

`hoverTile` returns `false` when there is no pointer over the world — which is every touch
device, always, between taps. A control that only appears on hover does not exist on a phone, and
this signature exists to make that impossible to forget.

### Rebinding a key

The action map is data, and it moves while the game runs:

```ts
input.setActions({ collect: ['tap', 'key:Space'], build: ['key:KeyN'] }); // was KeyB
input.bindings('build'); //                                      ['key:KeyN'] — read it back
```

Every handler survives, which is the point: rebinding used to mean `dispose`, rebuild, and
re-register every `onAction` in the game. `bindings()` and `actionNames` are live reads off the
system, so a shortcut sheet re-renders from the map instead of from a second copy that drifts.

**The names are identity; only the bindings move.** A map that adds a name or drops one is
refused — `A` was inferred from the constructor's map and every handler is already keyed to it,
so a new name has no handler list to reach and a vanished one takes a live handler with it.
Adding an action is a new system. Which *key* produces `build` is what a settings screen moves,
and that is what this is for.

**And it refuses while a recording is running**, for a reason that is not `setProfile`'s and is
worth reading once:

> A log records `RawSample`s, and the action map is **not** in the compatibility triple. So a
> rebind mid-recording changes nothing about what the log *says* and everything about what a
> replay of it *does* — behind a triple that still matches exactly. Nothing downstream could
> refuse it, and the replay would report a divergence that is confidently wrong.

The other way out was to put the map in the triple, which is a much larger claim: it would make
every log ever recorded unreplayable the first time a player rebound a key. Refusing for the
seconds a recording is open costs one boolean; see `docs/rfc/live-options.md` §6b.

The same reasoning closes the mirror case. `replayCursor` verifies the triple once and then hands
control to the driver between every tick, so a `setProfile` or `setActions` in that gap would
replay half a log under rules it was not recorded under. The cursor carries the system's epoch and
refuses the first `applyAt` that finds it moved.

### The thresholds

Every number that decides what a gesture is lives in one `GestureProfile`, and every default
carries its derivation in the source. The three that matter most:

| knob | default | why |
|---|---:|---|
| `tapSlopPx.touch` | 9 | A fingertip's contact patch shifts several pixels during a press people experience as perfectly still. Below ~6 half the taps on a phone become one-pixel drags; above ~12 a deliberate small pan opens whatever was under the finger. |
| `tapSlopPx.mouse` | 4 | Windows' `SM_CXDRAG`. A mouse does not wobble, so touch's 9 would eat every short deliberate drag and make the camera feel stuck. |
| `longPressMs` | 450 | iOS is ~500 and Android ~400; inside that band the duration is one people's hands already know. Rounded up to whole ticks. |

Override what you need, keep the rest:

```ts
createInput({ …, profile: { tapSlopPx: { touch: 12 }, longPressMs: 600 } });
```

Retune while the game is running, and keep every handler:

```ts
input.setProfile({ tapSlopPx: { touch: 14 } }); //  handlers, scopes and camera all survive
```

`setProfile` **replaces** the override set rather than patching it — it resolves against the
defaults exactly as construction does, so `setProfile({})` returns to them and the thresholds
depend only on the object you pass, never on the order the sliders were moved. A path-dependent
profile is one a log's fingerprint cannot be reasoned about.

Every live gesture ends first, under the *old* thresholds: each drag gets its `dragend` and each
held key its release, exactly as `dispose` does it and for the same reason. It refuses from inside
a handler (the bucket being delivered was recognized under the rules that are about to change) and
while a recording is running (the fingerprint is a third of a log's identity).

The step is deliberately **not** retunable. Changing it would re-time every gesture and invalidate
every log; that is a new system, not a knob.

**A profile is part of a replay's identity.** The same finger movements under a tap slop of 8 px
and of 12 px are a different sequence of actions, so a log records which profile it was made
under and a replay under a different one is refused rather than migrated.

### When a HUD covers the world

A transparent element over the canvas eats every tap and nothing anywhere reports it, so
`createInput` watches for a `pointerdown` that lands inside the world's rect and is delivered to
something else. The question it then has to answer is whether that node is *legitimate chrome* or
the thing swallowing the game — and it answers it without learning anything about what is in the
world:

| how the node came to take the press | reported? |
|---|---|
| `pointer-events` set **inline**, on it or an ancestor — which is what `@latticekit/ui` writes on every node it grants | no |
| listed in `createInput({ overlays: [hud] })` | no |
| `auto` from a stylesheet, with an inline `none` above it that lost the specificity fight | **yes** — this is the bug |
| `auto` from a stylesheet, with nothing declared anywhere | **yes** |

The first row is why a `@latticekit/ui` panel is silent with no configuration at all: that package
ships **no stylesheet** and writes the grant per node, so "somebody named this node" is a fact
already recorded in the DOM. `overlays` is the escape for a HUD styled entirely from CSS, which
cannot be told apart from a spacer any other way. It is read when a cover is found rather than at
construction, so a HUD built after the input still counts.

### The camera

`iso` owns where the camera may be; this owns where the player is trying to put it.

```ts
input.camera.panBy(dx, dy);
input.camera.zoomBy(1.15, anchorSx, anchorSy); //  the anchor is not optional
input.camera.stop(); //                            when a modal opens
input.camera.enabled = false; //                   for a fixed-camera game
```

There is deliberately no `setZoom`. Origin-anchored zoom — the thing you are looking at sliding
out from under you as you zoom towards it — is the single most common reason a tile-game camera
feels broken, and the only way to reach it here is to deliberately type the viewport center as
the anchor.

---

## Two entry points, two clocks

| call | carries | what happens |
|---|---|---|
| `input.tick(index)` | an integer tick index | the bucket closed before it started is delivered. **The only place a handler ever runs.** |
| `input.frame(nowMs)` | wall-clock milliseconds | the camera integrates its glide. **Delivers nothing and calls no handler.** |

Run them in this order: `input.tick`, then the game's update, then `input.frame`, then draw.
Draining input in the render callback, or after the camera has moved, means the tile a tap
resolves to is not the tile that was under the finger in the last frame the player actually saw.

Nothing in this package reads a clock. There is no `Date.now`, no `performance.now`, no
`requestAnimationFrame` and no `setTimeout` in its source, and no wall-clock timestamp in a log —
a log of timestamped events replayed against a fixed-step loop does not land on the same pixel,
which makes timestamps not merely unnecessary but actively misleading.

---

## What is deliberately absent

- **Hit-testing.** This package will never tell you *what* you tapped, only *where*. It has no
  registry, no rect, no `pickable` flag and no hit callback — so an implementation that caches hit
  boxes during the draw pass cannot be built on it, because there is nowhere to put them and
  nothing that would read one. (In the source game the cached version made every collect bubble
  untappable in a backgrounded tab, where the draw pass had stopped running and the cached boxes
  were minutes old.) Picking is `iso`'s `pickSorted`, called from a handler with the coordinates
  this package has already computed.
- **The gamepad**, cut from 0.1. It is the one input source that cannot answer *where*: a stick is
  a direction, and making a pad honor `a.gx/gy` needs an on-screen reticle that moves,
  accelerates, snaps to candidates and is drawn and focus-managed by `ui`. That is a second
  interaction model, not one more row in an action map. It comes back when a game shape asks for
  it — steering a character, or a build targeting a TV — and it comes back with the reticle,
  because that is the part that is actually hard.
- **Double tap**, which costs every single tap ~300 ms of latency, because a tap cannot be
  delivered until a second one has failed to arrive. Invisible in review, and catastrophic for a
  game whose primary verb is "tap the thing".
- **Release edges and analog axes**, which could only ever be honest for some sources. `held()`
  covers charge-ups.
- **Rebindable keymaps and their UI.** The map is data the game owns; `persist` stores a player's
  edits and `ui` renders the screen. What this package owes them is `bindings(action)`, so a
  shortcut sheet is generated rather than transcribed.
- **Camera animation** beyond inertia — a tween over the camera is `loop`'s tween and `iso`'s
  camera, and needs neither imported here.
- **Rotation, three-finger gestures, swipe, edge-scroll**, and a virtual joystick.
- **Text entry, IME, clipboard, file drop.** What this package owes text is a guard: a key aimed
  at an `<input>`, `<textarea>` or `contenteditable` never becomes an action, and neither does one
  carrying a modifier no binding asked for.

---

## Performance

Apple Silicon, Node 24. Full table in [`docs/PERFORMANCE.md`](../../docs/PERFORMANCE.md).

| path | rate | per call |
|---|---:|---:|
| `submit` — one `pointermove` into the open bucket | 37.7 M/s | ~27 ns |
| `hoverTile` — the query a placement ghost makes every frame | 21.1 M/s | ~47 ns |
| `frame` — integrating a glide | 18.6 M/s | ~54 ns |
| `tick` — an empty bucket, which is most ticks | 14.5 M/s | ~69 ns |
| `tick` — a realistic frame: 8 coalesced moves delivered as drags | 1.41 M/s | ~708 ns |

A realistic input frame is **0.009% of an 8 ms budget**.

**What the ground costs**, measured on the same machine against a 192 px hill — twelve steps down
the lattice and twelve bisections per pick:

| path | flat | on terrain |
|---|---:|---:|
| `tick` — 8 coalesced moves | ~1.4 µs | ~2.0 µs |
| `hoverTile` | ~32 ns | ~107 ns |

That is **~75 ns per event**, and it is per *event* rather than per entity: the tile is resolved
on the first read of `gx`/`gy` and held until the event object is aimed at the next pointer
position, so a handler that reads it four times marches once and a game that never reads it does
not march at all. Three million moves through three
thousand ticks, with a forced GC either side, retain **zero bytes**: the sample buffer owns its
slots for the life of the system and overwrites them in place, and the gesture handed to a
handler is the same object every time. Copy what you keep.

---

## Environment

`createInput` is the only part of this package that knows a browser exists; `src/dom.ts` is the
only module that names a DOM type, and it declares itself `@browser-only`. Everything else —
the recognizer, the action map, the buffer, the log, the camera controller — runs unchanged in
Node, which is how every invariant in the RFC is tested with no shim and how a replay runs
headless.

Depends on `@latticekit/core` and `@latticekit/iso`, and on nothing else.
