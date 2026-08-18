---
name: input
description: Taps, drags, pinch-zoom, keyboard and camera control in an isometric game. Use for tap to place or select, drag to pan, pinch or wheel to zoom, a placement ghost that follows the pointer, key bindings, "nothing happens when I tap", a tap that hits the wrong thing or the building behind, taps that land uphill or downhill of the finger, or a tile coordinate that comes back NaN.
---

# Input

Every way a person can touch a game — finger, mouse, pen, key — arrives as **one replayable
stream of intents in tile coordinates**, bucketed to simulation ticks, behind one object that
unbinds all of it.

The two properties that shape everything else:

- **Input never learns what is in the world.** There is no registry, no rect, no `pickable` flag
  and no hit callback — so an implementation that caches hit boxes during the draw pass cannot
  be built on it, because there is nowhere to put them and nothing that would read one. (In the
  source game that cache made every collect bubble untappable in a backgrounded tab.) `terrain`
  is not an exception: a heightfield is the shape of the *ground*, a parameter of the projection
  in the same sense the camera is, and no hit box can be stored in one or recovered from it.
- **Gestures are delivered on simulation ticks, never on frames.** So a tap cannot be dropped by
  a slow frame or fired twice on a fast one.

---

## The five lines a game writes

```ts
import { createInput } from '@latticekit/input';
import type { Camera, HeightField } from '@latticekit/iso';
import type { Loop } from '@latticekit/loop';

export function wire(
  canvas: HTMLCanvasElement,
  camera: Camera,
  loop: Loop,
  land: HeightField,
  maxHeightPx: number,
): void {
  const input = createInput({
    element: canvas,
    camera,
    step: loop,                    // the loop itself, so the step cannot drift
    terrain: { field: land, maxHeightPx },   // or 'flat'. Never nothing — see below
    actions: { place: ['tap', 'key:Space'], cancel: ['key:Escape'] },
  });

  input.onAction('place', (a) => {
    if (!a.onGround) return;       // the pointer was on the sky: gx/gy are NaN
    void a.gx;
    void a.gy;
  });
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

## The ground, and why `gx`/`gy` depend on it

`terrain` is the one option with no safe default, so it is the one to decide before you write any
of the others.

Screen → grid is the exact inverse of the projection **on the plane `z = 0`, and on no other
plane**. Raise a point by `HALF_H` world pixels and it lands on precisely the same screen pixel as
the point one unit of `gx + gy` further from the viewer at sea level — so a pixel does not name a
tile, it names a *family* of them, one per elevation. Told nothing, this package answers with the
sea-level member. On level ground that is right. On a hillside it is a real tile, next to the
right one, moving smoothly with the pointer, and **wrong**: measured at **281 px and 14–16 tiles**
on one exhibit's slope and **212–237 CSS pixels** on another. The error always points the same way
— up the slope from the finger — because the naive answer has the smaller `gx + gy`.

| you pass | `gx`/`gy` resolve on | `onGround` | write this when |
|---|---|---|---|
| `{ field, maxHeightPx }` | the terrain, marched by `iso` | **`false` over the sky or past the field's edge, and `gx`/`gy` are then `NaN`** | the map has any elevation at all |
| `'flat'` | the plane `z = 0` | always `true` — off the map is still a number there, and `iso` decides what is in bounds | the ground really is level. One word, and it is the whole answer |
| *omitted* | the plane `z = 0` | always `true` | never on purpose. One `flat-ground-pick` diagnostic, on the first coordinate read |

The third row is the point. This package cannot see your terrain — no map, no registry, no way to
acquire one — so it cannot detect the mistake, and nothing downstream can either. What it *can*
tell is that nobody ever said.

**`maxHeightPx` is where the march starts**: the tallest terrain on the map in world pixels,
`maxUnits × field.stepPx`. Too low and the search begins below a peak and misses it; too high and
every pick scans ground that is not there. `0` is legal and gives exactly the flat-ground answer,
which is *not* the same statement as `'flat'`.

### `onGround`, and the `NaN` behind it

On terrain there is no infinite lattice to fall back on — a pixel above the horizon corresponds to
no ground at all — so the only honest answers are `onGround: false` and `NaN`. Nothing else in the
kit hands you a `NaN` tile, and no bounds check rejects one: every comparison against it is
`false`, so the thing is placed, stored and drawn nowhere.

```ts wrong
import type { ActionEvent } from '@latticekit/input';
declare function place(gx: number, gy: number): void;

// Right on a flat system, and a NaN entry in the game's state the first time a player
// drags across the sky on a system that declared a heightfield.
export function onPlace(e: ActionEvent<'place'>): void {
  place(e.gx, e.gy);
}
```

```ts
import type { ActionEvent } from '@latticekit/input';
declare function place(gx: number, gy: number): void;

export function onPlace(e: ActionEvent<'place'>): void {
  if (!e.onGround) return;    // above the horizon, or past the edge of the field
  place(e.gx, e.gy);
}
```

`hoverTile` answers the same question with its own boolean and leaves `out` **untouched** over the
sky, so a placement ghost with nowhere to stand is simply not drawn rather than drawn on the shore.

### Ground that moves

`input.setTerrain({ field, maxHeightPx })` replaces the declaration and keeps every handler, every
scope and the camera; `input.terrain` reads back what is in force. The field is **held rather than
copied**, so ground the player raises this frame is ground the next event resolves on — a
sculpting brush re-declares nothing, and only raises `maxHeightPx` when the ridge outgrows the old
ceiling. A game whose map is generated after the input system was bound declares it there too.

Unlike `setProfile` and `setActions`, `setTerrain` **does not bump the replay epoch and a
recording does not refuse it** — terrain is game state that moves during ordinary play, and a
cursor that refused here would refuse every session in which a player dug a hole. It does throw
from inside a handler: half a bucket resolved on one surface and half on another is not a thing.

Deformable ground is also where the undeclared version stops looking like a wrong coordinate and
starts looking like a broken feature. Raising ground under the cursor pushes the true tile toward
the viewer, so a brush driven by `event.gx` walks off the far side of the hill exactly as fast as
the ridge grows, while the player's hand holds still.

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
the volume is measured at sea level while the sprite is painted up the hill: **212 to 237 CSS
pixels** of vertical error on three seeds of one exhibit, every tap there landing in mid air —
and nothing looked broken, because a hand-written bubble fallback that *did* know the elevation
kept lighting the marker through a circle test unrelated to what was on screen.

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
    g.claim();                          // …and the camera will NOT also pan
    if (!g.onGround) return;            // dragged over the sky: leave the ghost where it was
    moveGhost(g.gx, g.gy);
  });
  scope.on('dragend', (g) => { if (g.onGround) commit(g.gx, g.gy); });
  return () => scope.dispose();         // everything above, gone
}
declare function moveGhost(gx: number, gy: number): void;
declare function commit(gx: number, gy: number): void;
```

There is **no free-function binder**: a listener can only come from a scope, so an unowned
listener is not a thing that can be constructed.

`claim()` is the trade you have to state out loud. If a drag sculpts, a drag no longer pans, and
panning has to move to the arrow keys and the pinch. That is a design decision, not a detail.

**There is no hover *gesture*.** `GestureMap` has six members and none of them is a pointer
position with no button down, so a tile highlight that follows the cursor is not a callback you
can bind — it is `input.hoverTile(out)`, asked once per update. Two exhibits looked for the event
and did not find it. **Do not answer it with a raw `pointermove` listener of your own**: that
coordinate is back on the plane `z = 0` and the highlight then disagrees with the tap that
follows, which is the one thing `hoverTile` going through the same picker guarantees it cannot.

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
device, always, between taps — and, on a system with terrain, when the pointer is over the sky.
**A control that only appears on hover does not exist on a phone**, and this signature exists to
make that impossible to forget.

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
`setActions` refuse while a recording is open — a rebind mid-log changes nothing about what the
log *says* and everything about what a replay of it *does*. `setTerrain` is the exception above,
and for the opposite reason.

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
