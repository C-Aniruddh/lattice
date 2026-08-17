---
name: input
description: Taps, drags, pinch-zoom, keyboard and camera control in an isometric game. Use for tap to place or select, drag to pan, pinch or wheel to zoom, a placement ghost that follows the pointer, key bindings, "nothing happens when I tap", a tap that hits the wrong thing or the building behind, or taps that miss on hills.
---

# Input

Every way a person can touch a game — finger, mouse, pen, key — arrives as **one replayable
stream of intents in tile coordinates**, bucketed to simulation ticks, behind one object that
unbinds all of it.

The two properties that shape everything else:

- **Input never learns what is in the world.** There is no registry, no rect, no `pickable` flag
  and no hit callback — so an implementation that caches hit boxes during the draw pass cannot
  be built on it, because there is nowhere to put them and nothing that would read one. (In the
  source game the cached version made every collect bubble untappable in a backgrounded tab,
  where the draw pass had stopped running and the cached boxes were minutes old.)
- **Gestures are delivered on simulation ticks, never on frames.** So a tap cannot be dropped by
  a slow frame or fired twice on a fast one.

---

## The five lines a game writes

```ts
import { createInput } from '@latticekit/input';
import type { Camera } from '@latticekit/iso';
import type { Loop } from '@latticekit/loop';

export function wire(canvas: HTMLCanvasElement, camera: Camera, loop: Loop): void {
  const input = createInput({
    element: canvas,
    camera,
    step: loop,                    // the loop itself, so the step cannot drift
    actions: { place: ['tap', 'key:Space'], cancel: ['key:Escape'] },
  });

  input.onAction('place', (a) => { void a.sx; void a.sy; });
  loop.onUpdate((_dt, tick) => input.tick(tick));
  loop.onRender((_alpha, _time, nowMs) => input.frame(nowMs));

  // Under Vite: without this a hot reload leaves a zombie game drawing and not responding.
  if (import.meta.hot) import.meta.hot.dispose(() => input.dispose());
}
```

Pinch, wheel, two-finger pan, drag-to-pan and the arrow keys are all live in those lines: the
camera controller is on by default, because a tile game whose camera does not move is not a tile
game, and making every game write that wiring is how every game gets it subtly different.

`'plce'` in the handler is a **compile error** — the action names are inferred from the object
literal above.

**Run them in this order: `input.tick`, the game's update, `input.frame`, then draw.** Draining
input in the render callback, or after the camera has moved, means the tile a tap resolves to is
not the tile that was under the finger in the last frame the player actually saw.

| call | what happens |
|---|---|
| `input.tick(index)` | the bucket that closed before this tick started is delivered. **The only place a handler ever runs** |
| `input.frame(nowMs)` | the camera integrates its glide. **Delivers nothing and calls no handler** |

---

## `gx`/`gy` on an event is a flat-ground answer

This is the single most serious correctness trap in the kit, and it is silent.

Every `ActionEvent` and every gesture carries `gx`/`gy` resolved through `worldToTile` — **as
though the ground were flat**. There is no seam anywhere in the input options for a heightfield.
So on any map with elevation those coordinates are wrong, plausibly, and by more the taller the
terrain.

Measured on real games: **281 px and 14 tiles** on one static hillside; **212 to 237 CSS pixels**
on another; and about 250 px where one exhibit opens, rising to **over 1,400 px at its ridge**.
The error always points the same way — up the slope from the finger — because the naive answer
has the smaller `gx + gy`.

```ts wrong
import type { ActionEvent } from '@latticekit/input';
declare function buildAt(gx: number, gy: number): void;

// Correct on flat ground. On a hill, wrong by more the higher the hill, and nothing reports it.
export function onPlace(e: ActionEvent<'place'>): void {
  buildAt(e.gx, e.gy);
}
```

```ts
import { screenToTileOnHeights } from '@latticekit/iso';
import type { Camera, HeightField, Tile } from '@latticekit/iso';
import type { ActionEvent } from '@latticekit/input';

const hit: Tile = { gx: 0, gy: 0 };
declare function buildAt(gx: number, gy: number): void;

export function onPlace(
  e: ActionEvent<'place'>,
  camera: Camera,
  land: HeightField,
  maxHeightPx: number,
): void {
  // From sx/sy, never from gx/gy. The boolean is the off-map test.
  if (screenToTileOnHeights(camera, e.sx, e.sy, land, maxHeightPx, hit)) buildAt(hit.gx, hit.gy);
}
```

**On flat ground, use `gx`/`gy`** — that is what they are for and they cost nothing. **The moment
your world has a heightfield, re-pick.** And if the ground itself *moves* — a sculpting brush, a
terraforming game — re-pick once per **update** against the field as it stands this step, not
once per gesture: raising ground under the cursor pushes the true tile toward the viewer, so a
brush driven by `event.gx` walks away from the finger exactly as fast as the ridge grows. You
make a hill and the brush slides off the far side of it while you hold still, which reads as a
broken brush rather than as a wrong coordinate.

---

## What did they tap? — pick backwards through the same sorter that painted

`iso.pickSorted` walks the same `DepthSorter` instance backwards, so paint order and pick order
are the same permutation or the game is lying about what the player tapped.

```ts
import { boxSilhouette, pickSorted, pointInPolygon } from '@latticekit/iso';
import type { Camera, DepthSorter, Volume } from '@latticekit/iso';
import { spriteVolume } from '@latticekit/draw';
import type { SpriteDef, Variant } from '@latticekit/draw';

interface Thing {
  readonly def: SpriteDef;
  readonly gx: number;
  readonly gy: number;
  readonly v: Variant;
  /** Ground height under the footprint, in world pixels. The SAME number handed to
   *  `drawSprite` and to `DepthSorter.add`, or the picture and the tap target disagree. */
  readonly base: number;
}

// Hoisted, all three: a closure per tap is a closure per tap, and these are reused.
const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const outline = new Float64Array(12);

export function pickAt(
  camera: Camera,
  order: DepthSorter,
  frame: readonly Thing[],
  px: number,
  py: number,
): Thing | undefined {
  const hits = (index: number): boolean => {
    const t = frame[index];
    if (t === undefined) return false;
    spriteVolume(t.def, t.v, vol, t.base);          // the 4th argument is the ground. See below
    boxSilhouette(camera, t.gx, t.gy, vol, outline);
    return pointInPolygon(px, py, outline, 6);
  };
  const at = pickSorted(order, hits);
  return at < 0 ? undefined : frame[at];
}
```

**`spriteVolume`'s fourth argument is the ground, and omitting it is silent.** Leave it off and
the volume is measured at sea level while the sprite is painted up the hill: measured at **212 to
237 CSS pixels** of vertical error on three seeds of one exhibit, every tap there landing in mid
air. It was half-masked by a hand-written bubble fallback that *did* know the elevation, which is
why nothing looked broken — the marker still lit, through a circle test that no longer had
anything to do with what was on screen.

**After `sort()`, do not reorder.** Not by anything, for any reason. In particular do not
*partition* — drawing every contact shadow first and every body second looks better and is a
stable partition of the sorted order, and it is a reorder. If you want shadows first, walk
`indexAt` forward twice. Break this and both packages stay green while a player taps one thing
and opens the one behind it.

**Keep one array in the sorter's own index space.** One array filled in the same loop that fills
the sorter, so the only expression that ever reads it is `frame[order.indexAt(i)]`. Two
collections and an offset — `index - things.length` — is arithmetic that is correct only while
three unchecked facts hold at once, and whose failure is exactly the silent mis-pick above.

---

## Gestures, scopes, and taking the drag away from the camera

`tap`, `longpress`, `dragstart`, `drag`, `dragend`, `zoom`. One `zoom` for wheel, trackpad
pinch, two-finger pinch and the zoom keys, because the camera does not care which it was and
neither does a game.

```ts
import type { InputSystem } from '@latticekit/input';

export function placementMode(input: InputSystem<'place'>): () => void {
  const scope = input.scope();          // a scene holds this, not an array of disposers
  scope.on('drag', (g) => {
    moveGhost(g.gx, g.gy);
    g.claim();                          // …and the camera will NOT also pan
  });
  scope.on('dragend', (g) => commit(g.gx, g.gy));
  return () => scope.dispose();         // everything above, gone
}
declare function moveGhost(gx: number, gy: number): void;
declare function commit(gx: number, gy: number): void;
```

There is **no free-function binder**: a listener can only come from a scope, so an unowned
listener is not a thing that can be constructed.

`claim()` is the trade you have to state out loud. If a drag sculpts, a drag no longer pans, and
panning has to move to the arrow keys and the pinch. That is a design decision, not a detail.

**There is no hover gesture.** `GestureMap` has six members and none of them is a pointer
position with no button down — so a tile highlight that follows the cursor, the single most
common thing an isometric builder does, cannot be built from this package. Two exhibits hit it
independently. Add a raw `pointermove` listener to the canvas and do the coordinate work
yourself; it is a known gap, not something you are missing.

---

## Continuous input is asked for, never pushed

```ts
import type { InputSystem } from '@latticekit/input';
import type { Tile } from '@latticekit/iso';

const tile: Tile = { gx: 0, gy: 0 };

export function everyStep(input: InputSystem<'charge'>, dt: number): void {
  if (input.held('charge')) chargeUp(dt);
  if (input.hoverTile(tile)) highlight(tile.gx, tile.gy);
}
declare function chargeUp(dt: number): void;
declare function highlight(gx: number, gy: number): void;
```

`hoverTile` returns `false` when there is no pointer over the world — which is every touch
device, always, between taps. **A control that only appears on hover does not exist on a phone**,
and this signature exists to make that impossible to forget.

---

## Thresholds, and the ends of them that break the game

Every number that decides what a gesture is lives in one profile, and every default carries its
derivation.

| knob | default | why, and the end that breaks |
|---|---:|---|
| `tapSlopPx.touch` | 9 | a fingertip's contact patch shifts several pixels during a press people experience as perfectly still. **At 1 px nothing on a touchscreen can be tapped — and it still works on a mouse, which is how it ships** |
| `tapSlopPx.mouse` | 4 | Windows' own drag threshold. Touch's 9 would eat every short deliberate drag and make the camera feel stuck |
| `longPressMs` | 450 | iOS is ~500 and Android ~400. **Under 200 it fires during ordinary taps** |
| fling half-life | — | **over 700 ms and the camera is still moving when the next gesture starts** |
| fling floor | — | **near 0 and every drag drifts, so the camera can never be placed exactly** |

```ts
import type { InputSystem } from '@latticekit/input';

export function retune(input: InputSystem<'place'>): void {
  // REPLACES the override set rather than patching it, so setProfile({}) returns to defaults
  // and the thresholds depend only on the object you pass, never on the order sliders moved.
  input.setProfile({ tapSlopPx: { touch: 14 }, longPressMs: 600 });
}
```

**A profile is part of a replay's identity.** The same finger movements under a tap slop of 8 px
and of 12 px are a different sequence of actions, so a log records which profile it was made
under and a replay under a different one is refused rather than migrated. Both `setProfile` and
`setActions` refuse while a recording is open, and `setActions` refuses for a subtler reason: the
action map is *not* in the compatibility triple, so a mid-recording rebind changes nothing about
what the log says and everything about what a replay of it does — behind a triple that still
matches exactly.

**The step is deliberately not retunable.** Changing it re-times every gesture and invalidates
every log; that is a new system, not a knob.

---

## Rebinding a key

```ts
import type { InputSystem } from '@latticekit/input';

export function rebind(input: InputSystem<'place' | 'cancel'>): readonly string[] {
  input.setActions({ place: ['tap', 'key:KeyN'], cancel: ['key:Escape'] });
  return input.bindings('place');    // ['tap', 'key:KeyN'] — read it back, never a second copy
}
```

Every handler survives. **The names are identity; only the bindings move** — a map that adds a
name or drops one is refused, because every handler is already keyed to the names the constructor
inferred. Adding an action is a new system.

---

## When a HUD covers the world

A transparent element over the canvas eats every tap and nothing anywhere reports it, so
`createInput` watches for a `pointerdown` that lands inside the world's rect and is delivered to
something else.

| how the node came to take the press | reported? |
|---|---|
| `pointer-events` set **inline**, on it or an ancestor — which `@latticekit/ui` writes on every node it grants | no |
| listed in `createInput({ overlays: [hud] })` | no |
| `auto` from a stylesheet, with an inline `none` above it that lost the specificity fight | **yes — this is the bug** |
| `auto` from a stylesheet, with nothing declared anywhere | **yes** |

So a `@latticekit/ui` panel is silent with no configuration at all. `overlays` is the escape for a
HUD styled entirely from CSS, which cannot be told apart from a spacer any other way.

---

## Deliberately absent, so you stop looking

**Hit-testing** (that is `iso.pickSorted`, called from a handler with the coordinates this
package already computed) · **the gamepad**, because a stick cannot answer *where* without an
on-screen reticle that is a second interaction model · **double tap**, which costs every single
tap ~300 ms of latency because a tap cannot be delivered until a second one has failed to arrive
· **release edges and analog axes** · **camera animation** beyond inertia · **rotation, swipe,
edge-scroll, a virtual joystick** · **text entry, IME, clipboard, file drop** — though a key
aimed at an `<input>`, `<textarea>` or `contenteditable` never becomes an action, so a text field
in your HUD is already safe.

---

## What this skill does not cover

| you want | read |
|---|---|
| where `input.tick` and `input.frame` go | `starting` |
| terrain-aware picking in depth, and the maths under it | `world` |
| drawing the ghost you are dragging | `art` |
| a button in the HUD rather than a tap on the world | `hud` |
| recording and replaying a session | `determinism` |

Long form, on disk: `node_modules/@latticekit/input/README.md`.
