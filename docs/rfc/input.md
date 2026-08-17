# RFC — `@latticekit/input`

Status: **proposed**. Owner: lattice-architect (task A5). Depends on `@latticekit/core`, `@latticekit/iso`.
Environment: **browser** (`window`, `document`, `Element.setPointerCapture`). The recognizer inside it is not.

Routings folded in during design, each answered explicitly rather than hedged:
the tap → grid seam (§3.7), the per-tick sample buffer (§3.8), pointer capture (§3.9),
and the call on gamepad support (§4.2).

---

## 1. The one sentence

**`@latticekit/input` turns every way a person can touch a game — finger, mouse, pen, key —
into one replayable stream of intents expressed in tile coordinates and bucketed to
simulation ticks, and hands back one object that unbinds all of it.**

Four claims, each load-bearing:

- **one stream.** A game written against this package never learns which device it is being
  played on. "Collect" is one handler, not three. (Gamepad is cut from 0.1 — §4.2 argues
  that rather than assuming it.)
- **tile coordinates.** Every event arrives as a tile, converted once, through the camera
  the player was actually looking at. No game does the conversion (§3.7).
- **bucketed to ticks.** Browser events arrive on the browser's schedule and a fixed-step
  loop runs on its own. Something has to reconcile those, and if it is not this package it
  is game code, which will drop a tap on a slow frame and fire two on a fast one. A log of
  wall-clock events is not replayable; a log of tick-bucketed samples is (§3.8).
- **one object.** Teardown is a tree, not a list of disposers you can forget to add to.

---

## 2. The five-line example

This is what a game does with this package 90% of the time. It was written before the API
below, and where the two disagreed, the API moved.

```ts
const input = createInput({
  element: canvas,
  camera,
  stepMs: loop.stepMs,
  actions: { collect: ['tap', 'key:Space'], build: ['key:KeyB'] },
});
input.onAction('collect', (a) => collectAt(state, a.gx, a.gy));
loop.onTick((index) => input.tick(index));
loop.onFrame((nowMs) => { input.frame(nowMs); render(state, camera); });
onSceneEnd(() => input.dispose());
```

(The `loop` callback names are illustrative; what this package needs from `loop` is in §7.
The two entry points — a tick carrying an integer index and a frame carrying wall-clock
milliseconds — are the part that is not negotiable.)

Read it as a list of promises the API has to keep:

| the line | what it forces on the design |
|---|---|
| `element` + `camera` and nothing else | The package needs the surface and the transform. It never sees game state, so it can never hold a stale idea of what is in the world. |
| `stepMs` | The recognizer measures durations in ticks, not in clock reads. A long press is five ticks, and five ticks is the same length on every machine. |
| `actions: { collect: [...] }` | Two sources — one that has a position, one that does not — under one name, declared as data. `'colect'` in the handler is a **compile error**: the names are inferred from this object literal. A third source is one more string in the array, and still no second handler. |
| `a.gx, a.gy` | The handler is handed tiles, not pixels. That seam is closed here so no game ever writes the conversion (§3.7). |
| `input.tick(index)` | Everything game-visible is delivered here, in the loop's fixed step, before the game's own update. Input therefore cannot be a side effect of rendering; it happens in the half of the frame that rendering is not in. |
| `input.frame(nowMs)` | Only the view moves here: camera glide, hover, press-progress. **No handler ever runs from `frame`.** |
| `input.dispose()` | One call. Everything bound through `input` or any scope descended from it is gone, including the camera's inertia, any pointer capture, and any key the player was holding. |

Pinch, wheel, two-finger pan, drag-to-pan and the arrow keys are all live in those five
lines: the camera controller is on by default, because a tile game whose camera does not
move is not a tile game, and making every game write that wiring is how every game gets it
subtly different.

---

## 3. The public surface

```ts
import type { Camera, Vec2, GridPoint } from '@latticekit/iso';
```

> `Camera` is `iso`'s. `Vec2` is `{ x: number; y: number }` and `GridPoint` is
> `{ gx: number; gy: number }`, both mutable, both used only as output parameters
> (non-negotiable 7). §7 lists exactly what this RFC needs `iso` to export.

### 3.1 Teardown: the scope

```ts
/**
 * Undoes exactly one binding.
 *
 * Idempotent by contract. A disposer that throws on its second call turns every error path
 * — where teardown runs twice because the first attempt half-failed — into a second, louder
 * error that hides the first.
 */
export type Disposer = () => void;

/**
 * A place bindings are owned.
 *
 * This is the only way to obtain a listener. There is no free function that binds something
 * and hands you a disposer to look after, so an unowned listener is not a thing that can be
 * constructed. That is the whole answer to "what shape does a game hold so that tearing down
 * a scene cannot leak half of it": it holds a scope, not an array of disposers, because an
 * array is a thing you can forget to push to and a scope is not.
 */
export interface InputScope<A extends string = never> {
  /** A child scope. Disposing the parent disposes it; disposing it does not touch the parent. */
  scope(): InputScope<A>;

  /**
   * Subscribe to a recognized gesture.
   *
   * Handlers run in registration order, scopes in creation order, and the camera controller
   * runs after all of them — so a handler can `claim()` a drag and steer a placement ghost
   * with it, and the camera will not also pan. Panning away from the site a player is aiming
   * at is never what anyone means.
   */
  on<K extends keyof GestureMap>(type: K, handler: (g: GestureMap[K]) => void): Disposer;

  /**
   * Subscribe to a declared action, whichever device produced it.
   *
   * `action` is typed to the names declared in {@link InputOptions.actions}, so a renamed
   * action breaks the build rather than silently going quiet.
   */
  onAction(action: A, handler: (a: ActionEvent<A>) => void): Disposer;

  /**
   * Hand this scope something else to unbind — an audio node, a `ResizeObserver`, a `ui`
   * panel. Present so a scene has one teardown tree rather than one per package it happens
   * to use.
   */
  own(disposer: Disposer): Disposer;

  /** Dispose this scope and every scope descended from it. Safe to call during a drain. */
  dispose(): void;

  readonly disposed: boolean;
}
```

### 3.2 Gestures

```ts
/** What the player is touching the game with. The thresholds in §3.5 differ per kind. */
export type PointerKind = 'mouse' | 'touch' | 'pen';

export type GestureName = 'tap' | 'longpress' | 'dragstart' | 'drag' | 'dragend' | 'zoom';

/**
 * The fields every gesture carries.
 *
 * Coordinates come in all three spaces because guessing wrong about which one a callback
 * wanted is the most common bug in this layer, and because a game that converts by hand will
 * eventually convert with the wrong camera.
 *
 * The object is reused between deliveries. Copy what you keep; retaining it keeps a
 * reference to next tick's gesture. A fresh event object per pointer move, sixty times a
 * second, is a garbage collector pause with a nice API.
 */
export interface GestureBase {
  readonly type: GestureName;
  readonly pointerType: PointerKind;
  /** The simulation tick this was delivered in. The log's time axis; see §3.8. */
  readonly tick: number;
  /** CSS pixels, relative to the bound element's top-left — never `clientX`. */
  readonly sx: number;
  readonly sy: number;
  /** World space, through the camera as it stood when the tick opened. */
  readonly wx: number;
  readonly wy: number;
  /** Tile, floored. Off the map is still a number; `iso` decides what is in bounds. */
  readonly gx: number;
  readonly gy: number;
  /** Take this gesture. Handlers not yet run, and the camera controller, will not see it. */
  claim(): void;
  readonly claimed: boolean;
}

/**
 * A press that stayed put.
 *
 * `tap` and `longpress` are mutually exclusive for one press — see §5, invariant 1. In the
 * source game the missing version of that guarantee meant the `pointerup` ending a hold also
 * counted as a tap, which instantly re-dropped the building the player had just lifted.
 */
export interface TapGesture extends GestureBase {
  readonly type: 'tap' | 'longpress';
  /** How long the press lasted: whole ticks × `stepMs`. Feed a press-progress ring with it. */
  readonly heldMs: number;
}

/**
 * A press that traveled. One `dragstart`, zero or more `drag`, and **exactly one
 * `dragend`** — including when the system takes the gesture away, because a drag with no end
 * is a camera that pans for ever (§3.9).
 */
export interface DragGesture extends GestureBase {
  readonly type: 'dragstart' | 'drag' | 'dragend';
  /** Screen-space movement since the previous event of this gesture, in CSS pixels. */
  readonly dx: number;
  readonly dy: number;
  /**
   * Screen-space velocity in CSS px/s, averaged over the last `flingSampleMs`.
   * Averaged, not differenced: a finger that pauses before lifting has a last-two-points
   * velocity of nearly zero or of nearly anything, and both make flicks feel random.
   * Always zero on a canceled `dragend` — an interrupted gesture must not fling.
   */
  readonly vx: number;
  readonly vy: number;
}

/**
 * "Scale the world by `scale` about this point."
 *
 * One gesture for wheel, trackpad pinch, two-finger pinch and `+`/`-`, because the camera
 * does not care which it was and neither does a game. `sx, sy` is the anchor: the pointer,
 * the midpoint between two fingers, or the viewport center for a source with no position.
 * `dx, dy` carries the midpoint's own travel, so a two-finger gesture pans and zooms at once
 * the way a map does.
 */
export interface ZoomGesture extends GestureBase {
  readonly type: 'zoom';
  readonly source: 'wheel' | 'pinch' | 'key';
  /** Multiplicative, > 1 zooms in. Never additive: additive zoom is unusable above 2×. */
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

export interface GestureMap {
  readonly tap: TapGesture;
  readonly longpress: TapGesture;
  readonly dragstart: DragGesture;
  readonly drag: DragGesture;
  readonly dragend: DragGesture;
  readonly zoom: ZoomGesture;
}
```

### 3.3 Actions

```ts
/**
 * One way of producing an action.
 *
 * `key:` takes a `KeyboardEvent.code` — a physical position, not a letter — so WASD stays
 * under the same four fingers on AZERTY. Codes are validated when the map is built:
 * `'key:space'` reports `input.actions: 'key:space' is not a KeyboardEvent.code; did you mean
 * 'key:Space'?` rather than binding nothing and going quiet.
 *
 * Only `tap` and `longpress` appear here, out of six gestures. An action must mean the same
 * thing from every device that can produce it, and a drag has no keyboard equivalent that is
 * not a lie. A `` `pad:${PadButton}` `` member is the intended shape of the third source when
 * it returns (§4.2); adding a member to this union breaks nothing.
 */
export type ActionBinding = 'tap' | 'longpress' | `key:${string}`;

/**
 * An action fired.
 *
 * The coordinates are always populated, which is the point. A pointer-sourced action carries
 * where the finger was; a key-sourced one carries {@link InputOptions.focus} — the game's
 * current selection — falling back to the viewport center. Without that rule the keyboard
 * path either does nothing or does something different from the touch path, and the keyboard
 * path is the one nobody tests. It is also the seam a gamepad needs (§4.2): a positionless
 * source is already a solved case here.
 */
export interface ActionEvent<A extends string> {
  readonly action: A;
  readonly source: 'pointer' | 'key';
  /** Which binding fired it. Present so a tutorial can say "you can also press Space". */
  readonly binding: ActionBinding;
  readonly tick: number;
  readonly sx: number;
  readonly sy: number;
  readonly wx: number;
  readonly wy: number;
  readonly gx: number;
  readonly gy: number;
  claim(): void;
  readonly claimed: boolean;
}
```

Actions fire on the **press edge only**, once per physical press. Auto-repeat does not fire
them: the repeat rate is an operating-system accessibility setting, so an action that
repeats is an action whose count is not reproducible, and non-negotiable 1 says the log must
replay. A held action is a query (`held`), not a stream.

**This is the answer to "one handler, three bindings".** The game writes
`onAction('collect', …)` once. `tap` reaches it through the gesture recognizer carrying the
finger's tile; `key:Space` reaches it through the keyboard carrying the focus point's tile;
both arrive as the same `ActionEvent`, in the same tick, in binding-declaration order. The
only things a handler can tell them apart by are `source` and `binding`, and it is free to
ignore both — which is the test of whether the abstraction is real rather than decorative.

### 3.4 The system

```ts
export interface InputOptions<A extends string> {
  /**
   * The world surface. Usually the canvas.
   *
   * Binding it twice without disposing the first throws — Vite HMR happily leaves two live
   * game instances driving one canvas, and the second one's camera fights the first's.
   */
  readonly element: HTMLElement;

  /** The camera every coordinate is resolved through, and the one the controller drives. */
  readonly camera: Camera;

  /**
   * The loop's fixed step, in milliseconds. Must be the same number the loop uses.
   *
   * The recognizer counts ticks and multiplies by this; it never reads a clock. Get it wrong
   * and every duration in §3.5 is wrong by the same ratio — so pass `loop.stepMs` rather
   * than a literal.
   */
  readonly stepMs: number;

  /**
   * The action map, as data.
   *
   * The names are inferred from this object, so `onAction`, `held` and `bindings` accept only
   * names that exist. This object is also the single source of truth for a shortcut sheet —
   * see {@link InputSystem.bindings}.
   */
  readonly actions?: { readonly [K in A]: readonly ActionBinding[] };

  /** Override any threshold in §3.5. Everything not named keeps its default. */
  readonly profile?: Partial<GestureProfile>;

  /** Set `false` for a game whose camera is fixed. The gestures still arrive. */
  readonly control?: boolean;

  /**
   * Where a keyboard action points.
   *
   * Write the screen point of the current selection into `out` and return `true`; return
   * `false` and the viewport center is used. This is the seam between "the player pressed
   * Space" and "at what", and a game that leaves it unimplemented is still playable — it just
   * collects from the middle.
   */
  readonly focus?: (out: Vec2) => boolean;

  /** Where problems this package can detect go. Default: `console.warn`, once per code. */
  readonly onDiagnostic?: (d: Diagnostic) => void;

  /** Keep the browser context menu over the world. Default false: a long press on Android
   *  raises it mid-gesture, and it lands on top of the building you just lifted. */
  readonly keepContextMenu?: boolean;
}

export interface InputSystem<A extends string = never> extends InputScope<A> {
  readonly element: HTMLElement;
  readonly camera: CameraController;
  readonly profile: Readonly<GestureProfile>;
  readonly stepMs: number;

  /** Every declared action, in declaration order. */
  readonly actionNames: readonly A[];

  /**
   * What is bound to an action.
   *
   * Exists so a keyboard-shortcut sheet is rendered *from* the map. In the source game an
   * entire test file existed to catch a sheet that promised keys nothing handled, and a
   * sheet nobody could find for keys that worked. Generated from this, that defect class
   * cannot occur.
   */
  bindings(action: A): readonly ActionBinding[];

  /**
   * Close the sample buffer and deliver everything in it as simulation tick `index`.
   *
   * The only place handlers run. Called once per fixed step, before the game's own update.
   * See §3.8 for what happens on a pump with no ticks and on a pump with five.
   */
  tick(index: number): void;

  /**
   * Advance the view: camera glide, hover position, press progress.
   *
   * Called once per rendered frame, before drawing. Delivers nothing and calls no handler —
   * see §5, invariant 5. Everything it moves is a view, and no view is simulation state.
   */
  frame(nowMs: number): void;

  /** Feed the recognizer directly. The DOM binding is a producer of these and nothing more. */
  submit(sample: RawSample): void;

  /** Is any binding of this action currently held? Continuous input is a query, not a stream. */
  held(action: A): boolean;

  /** Escape hatch for a key with no action, e.g. a debug overlay. `KeyboardEvent.code`. */
  keyHeld(code: string): boolean;

  /**
   * The tile under the pointer, for a hover highlight. A **query**, answered from the newest
   * position the binder has seen — so a ghost following a finger is smooth at display rate
   * even when ticks are slow (§3.8).
   *
   * Returns `false` when there is no pointer over the world — which is every touch device,
   * always, between taps. A control that only appears on hover does not exist on a phone;
   * this signature exists to make that impossible to forget.
   */
  hoverTile(out: GridPoint): boolean;

  /** The pointer's screen position, same contract as {@link hoverTile}. */
  pointerScreen(out: Vec2): boolean;

  /** Samples waiting for the next tick. A number a stall diagnostic can watch. */
  readonly buffered: number;
}

/**
 * Bind a world surface. Touches `document` and `window`.
 *
 * Also, on the element and reverted on dispose: `touch-action: none` (without it a browser
 * claims the pan and `pointermove` simply stops mid-gesture), `overscroll-behavior: contain`
 * (without it a downward drag near the top of an iOS page reloads the game) and
 * `user-select: none` (without it a drag selects the page).
 */
export declare function createInput<A extends string = never>(options: InputOptions<A>): InputSystem<A>;

/**
 * The same recognizer with no DOM at all, fed only by {@link InputSystem.submit}.
 *
 * This is how the package is tested and how a replay runs in Node. It exists because the pure
 * half of this package genuinely is pure (non-negotiable 4), and hiding that behind a DOM
 * constructor would waste it.
 */
export declare function createHeadlessInput<A extends string = never>(
  options: Omit<InputOptions<A>, 'element' | 'onDiagnostic' | 'keepContextMenu'>,
): InputSystem<A>;

/** Begin recording. `stop()` returns the finished log for `persist` to put in an envelope. */
export declare function record<A extends string>(system: InputSystem<A>): { stop(): InputLog };

/**
 * Feed a recorded log back in, tick by tick.
 *
 * @throws RangeError naming the mismatch if the log's `version`, `stepMs` or `profile`
 *   differs from the system's — replaying a log under different thresholds is not a replay,
 *   it is a different game with the same finger movements.
 */
export declare function replay<A extends string>(system: InputSystem<A>, log: InputLog): void;
```

### 3.5 The thresholds

```ts
/**
 * Every number that decides what a gesture is.
 *
 * Named, in one interface, because a magic `9` inside a `pointermove` handler is a number
 * nobody can argue with. Each default is defended in the table below.
 */
export interface GestureProfile {
  /** Travel above which a press is a drag and never a tap. Per device — see the table. */
  readonly tapSlopPx: Readonly<Record<PointerKind, number>>;
  readonly longPressMs: number;
  readonly pinchStartPx: number;
  readonly pinchMinSpreadPx: number;
  readonly wheelLinePx: number;
  readonly wheelPagePx: number;
  readonly wheelZoomRate: number;
  readonly wheelPinchRate: number;
  readonly keyZoomStep: number;
  readonly keyPanPxPerS: number;
  readonly flingMinPxPerS: number;
  readonly flingHalfLifeMs: number;
  readonly flingSampleMs: number;
  readonly maxPointers: number;
  readonly maxBufferedSamples: number;
}

export declare const DEFAULT_PROFILE: Readonly<GestureProfile>;
```

| knob | default | why this number |
|---|---:|---|
| `tapSlopPx.touch` | **9** | A fingertip's contact patch shifts several pixels during a press people experience as perfectly still, and the reported point moves as the patch grows. Shipped at 9 in the source game after tuning against real hands; below ~6 half the taps on a phone become one-pixel drags, above ~12 a deliberate small pan opens whatever was under the finger. |
| `tapSlopPx.mouse` | **4** | Matches Windows' `SM_CXDRAG`. A mouse does not wobble, so touch's 9 would eat every short deliberate drag and make the camera feel stuck. |
| `tapSlopPx.pen` | **6** | A stylus wobbles more than a mouse and far less than a finger, and pen users make small deliberate movements. Between the two, nearer the mouse. |
| `longPressMs` | **450** | iOS long-press is ~500 ms and Android ~400. Inside that band the duration is one people's hands already know. Below ~350 it fires during ordinary taps; above ~600 people let go first and report it broken. Rounded to whole ticks. |
| `pinchStartPx` | **12** | Two fingers never land in the same tick, and the spread jitters as the second settles. Without a start threshold every two-finger pan zooms slightly, which reads as the map "breathing". |
| `pinchMinSpreadPx` | **24** | The scale factor is a ratio of spreads; near-touching fingers make its denominator tiny and one noisy sample teleports the zoom. |
| `wheelLinePx` | **16** | `WheelEvent.deltaMode === 1` means *lines*. Firefox reports 3 lines where Chrome reports 100 pixels; without this conversion the same flick zooms 30× less on Firefox. |
| `wheelPagePx` | **400** | `deltaMode === 2`, pages. Rare, and one page of scroll is about one viewport. |
| `wheelZoomRate` | **0.0016** | `scale = exp(-dz × rate)`. Exponential, so a notch feels the same at 0.6× and at 4×, and wheeling up then down returns to exactly where you started. 0.0016 puts a typical 100 px notch at ~1.17×, close to `keyZoomStep`. |
| `wheelPinchRate` | **0.0100** | A trackpad pinch arrives as a `wheel` with `ctrlKey` set and much smaller deltas. Using the scroll rate for it makes pinch-to-zoom on a laptop feel dead. |
| `keyZoomStep` | **1.15** | ~5 presses per doubling: coarse enough to get somewhere, fine enough to frame a building. |
| `keyPanPxPerS` | **700** | Held keys integrate per tick rather than jumping per keypress, so this is a speed: about a viewport every two seconds. The source game panned 90 px per keydown and thereby inherited the operating system's key-repeat rate — a camera whose speed is set in the player's accessibility preferences. |
| `flingMinPxPerS` | **120** | Below this a release is a stop, not a flick. Without a floor every drag drifts after the finger lifts and the camera can never be placed exactly. |
| `flingHalfLifeMs` | **150** | Exponential decay, so glide is frame-rate independent. A 1200 px/s flick coasts ~260 px: enough to feel alive, short enough that a second gesture is never fighting the first. |
| `flingSampleMs` | **60** | The window velocity is averaged over. See `DragGesture.vx`. |
| `maxPointers` | **2** | A third finger on a two-finger gesture is a palm. Ignoring it beats letting it move the midpoint. |
| `maxBufferedSamples` | **4096** | The stall ceiling (§3.8). Roughly a minute of pathological input; beyond it something is wrong and dropping quietly would be worse than saying so. |

### 3.6 The camera controller

```ts
/**
 * The gestures-to-camera policy. `iso` owns where the camera may be; this owns where the
 * player is trying to put it.
 *
 * There is deliberately no `setZoom`. The only way to change scale is {@link zoomBy}, whose
 * anchor is a required parameter — so origin-anchored zoom is not somewhere you can arrive by
 * accident, only by deliberately typing the viewport center. Origin-anchored zoom is the
 * single most common reason tile-game cameras feel broken: the thing you are looking at
 * slides out from under you as you zoom towards it.
 */
export interface CameraController {
  /** Off means gestures still arrive and nothing drives the camera. For a fixed-camera game. */
  enabled: boolean;

  /** Pan by a screen delta. Divided by zoom inside `iso`, so a drag tracks the finger. */
  panBy(dxScreen: number, dyScreen: number): void;

  /** Multiplicative zoom about a screen anchor. The anchor is not optional. */
  zoomBy(factor: number, anchorSx: number, anchorSy: number): void;

  /**
   * Kill any glide immediately.
   *
   * Call it when a modal opens or a scene ends. A camera still coasting under a dialog has
   * moved somewhere the player did not choose while they could not see it.
   */
  stop(): void;

  readonly gliding: boolean;
}
```

**Where the line between `input` and `iso` falls, and why it falls there.** `iso` owns the
`Camera`: the projection, `toWorld`/`toScreen`, `panByScreen`, `zoomAt`, and the clamp that
stops a player losing their island off the edge of the world. This package owns the
*controller*: which pixel is the anchor, what a wheel notch is worth, whether a release
becomes a glide, and how a held key becomes a speed.

Each half has a hard requirement the other cannot meet.

- The camera must run in Node with no DOM. Depth sorting, culling, pathfinding, golden tests
  and a headless replay all need `toScreen`, and none of them have a pointer. A camera that
  knew about gestures could not be imported by any of them.
- The controller cannot run without the DOM. `pointerType`, `WheelEvent.deltaMode`,
  `ctrlKey`-means-trackpad-pinch, pointer capture — every decision it makes is about the
  quirks of a browser input source. Putting that in `iso` would make the kit's most reusable
  package the one that has to know Firefox reports scroll in lines.

The seam is one method: `zoomAt(factor, sx, sy)`. **`iso` owns the arithmetic of anchoring;
`input` owns the choice of anchor.** In one line: *`iso` decides where the camera is allowed
to be; `input` decides where the player is trying to put it.* Neither package can express a
zoom without an anchor, which is how "zoom is anchored to the pointer" stops being a
convention and becomes a property of the signatures.

**Which clock the camera runs on.** Gestures are delivered on ticks; the camera integrates
its pan, its zoom and its glide in `frame`, at display rate. That is a deliberate asymmetry
and the reasoning is: a camera is a view, not simulation state, and a drag must track a
finger at the rate the finger is visible moving. If a game's fixed step is 100 ms — entirely
plausible for an idle economy — a tick-rate camera would lag a drag by a step and feel
broken however good the interpolation. The cost is stated plainly in §4.10: **the replay
contract covers what the player did, not where the camera was.**

### 3.7 The tap → tile seam

`iso` owns the conversion. `input` owns performing it. **Game code never does it at all.**

That is a position, not a compromise, in three parts:

1. **The function belongs to `iso`:** `screenToTile(camera, sx, sy, out: GridPoint): void`.
   Which diamond a pixel falls in is a projection question; it must floor rather than round
   (rounding snaps to the nearest lattice *vertex* and picks the wrong tile for three quarters
   of every diamond); and it has to be callable with no DOM, because pathfinding, depth sort
   and headless tests all ask it. If it lived here, `iso` would have to duplicate it or import
   upward.
2. **The call belongs to `input`.** Every gesture and every action arrives with `gx, gy`
   already filled in, resolved once per delivered event, inside `tick`, through the camera as
   it stood when the tick opened. `hoverTile(out)` is the same seam for the hover case.
3. **Therefore the demo's 0:04 moment is one line** — `input.onAction('collect', a =>
   collectAt(state, a.gx, a.gy))` — with no conversion in it, no camera reference in it, and
   nowhere for a stale coordinate to hide.

The sharper form of the question is the right one: *who owns the gesture from press to
release, across an overlay that may sit between the finger and the world?* That is this
package, unambiguously — §3.9 — and coordinate conversion is simply the last step of owning
it. `iso` supplies the projection maths and nothing else.

If `iso` declines to export `screenToTile`, `input` composes `camera.toWorld` +
`worldToTile` and the flooring rule then exists in two packages, which is precisely how two
packages come to disagree about which tile is under a finger. I would rather take the
dependency; this is the one item in §7 I would call blocking.

What this package will never own is *what* is at that tile. `gx, gy` is geometry; "the
headquarters, not the rack behind it" is `iso`'s `hitTest` over game state, and §4.1 explains
why it cannot live here.

### 3.8 Time: samples, the tick buffer, and the log

```ts
/**
 * The entire input to the recognizer. Plain data, serialisable, no clock, no DOM.
 *
 * `tick` is how time enters — {@link InputSystem.tick} submits one — which means a log is a
 * complete description of a session's input *including its timing*, expressed on the only
 * axis a fixed-step loop can replay against: tick indices. Wall-clock timestamps are
 * deliberately absent; see §4.9.
 */
export type RawSample =
  | { readonly kind: 'down'; readonly id: number; readonly sx: number; readonly sy: number; readonly pointerType: PointerKind }
  | { readonly kind: 'move'; readonly id: number; readonly sx: number; readonly sy: number }
  | { readonly kind: 'up'; readonly id: number; readonly sx: number; readonly sy: number }
  /** The pointer was taken away: `pointercancel`, `lostpointercapture`, blur, or dispose. */
  | { readonly kind: 'cancel'; readonly id: number }
  /** `dz` is normalized to CSS pixels; `pinch` marks a trackpad pinch arriving as a wheel. */
  | { readonly kind: 'wheel'; readonly sx: number; readonly sy: number; readonly dz: number; readonly pinch: boolean }
  | { readonly kind: 'key'; readonly code: string; readonly down: boolean }
  /** The window lost focus. Everything held is released — see §6, trap 10. */
  | { readonly kind: 'blur' }
  | { readonly kind: 'tick'; readonly index: number };

/**
 * A recorded session's input, and everything needed to know the recording is still valid.
 *
 * `persist` owns the envelope this goes in — versioning, integrity, storage. This package
 * owns the contents and the three fields that make a replay honest: recognition rules change
 * with the package version, gesture durations are counted in ticks, and the same finger
 * movements under different thresholds are a different session.
 */
export interface InputLog {
  readonly version: string;
  readonly stepMs: number;
  readonly profile: Readonly<GestureProfile>;
  readonly samples: readonly RawSample[];
}
```

**The buffer.** Browser events arrive when the browser feels like it; the loop's fixed step
runs zero or several times per pump. The reconciliation lives here, and it is one rule:

> **A tick sees a bucket that was closed before it started.**

`tick(index)` swaps the buffer, appends its own `tick` sample to the log, and delivers the
closed bucket in arrival order. Concretely:

| situation | what happens |
|---|---|
| an event arrives between ticks | it joins the open bucket and is delivered by the next tick |
| an event arrives *during* a tick — including one a handler synthesises | it joins the **next** bucket, never the running one. Otherwise delivery order would depend on when the browser dispatched, which is not reproducible, and a handler that submits input could recurse |
| a pump runs **no** ticks | nothing is delivered, nothing is lost; the bucket keeps filling |
| a pump runs **five** ticks (catch-up) | the first gets the backlog; the other four are normally empty, which is correct — they are catch-up for time that already passed, and a tap did not happen five times |
| the buffer exceeds `maxBufferedSamples` | consecutive `move` samples for the same pointer collapse to the newest, first. **A `down`, `up`, `cancel`, `key` or `wheel` is never dropped**: a stall costs precision, never an event. If it still overflows, one `buffer-overflow` diagnostic is raised — a loop that has stopped ticking is a bug worth hearing about |

The consequence worth stating out loud: **a tap cannot be dropped by a slow frame and cannot
fire twice on a fast one**, because ticks — not frames, not events — are what deliver, and
each sample is in exactly one bucket.

**And smoothness is not sacrificed to it.** Events are tick-bucketed; *state queries* are
view-fresh. A placement ghost that must follow a finger reads `hoverTile(out)` in the
game's frame callback, which answers from the newest sample the binder has seen. Querying is
safe at display rate precisely because it cannot mutate simulation state.

**For `persist`:** the log is `InputLog` above — a flat array plus three scalars, JSON-clean,
no cycles, no class instances. A session is that plus the world seed. What I need from the
envelope is only that it round-trips `samples` without reordering and that a mismatch of
`version`/`stepMs`/`profile` is surfaced rather than repaired, because a "migrated" input log
is a log that no longer replays.

### 3.9 Pointer capture, and never being latched

The `ui` overlay is pointer-transparent and re-enables events on its interactive children.
That is the right design, and it has one failure mode the overlay cannot fix from its side: a
camera drag that starts on the world and passes *under* a panel stops receiving moves. The
camera halts with the finger still down, and to a player that is the game freezing.

The fix is this package's, because the overlay has no way to know a drag is in progress:

- **On `pointerdown` on the bound element, take `setPointerCapture(pointerId)` immediately.**
  Every subsequent event for that pointer retargets to the world element regardless of what
  it passes over, so a drag under a panel keeps its moves and a gesture that starts on the
  world ends on the world. A press that starts *on* the overlay never reaches this package at
  all — it is the overlay's, and capture is not taken.
- **Release is defensive, not hopeful.** The browser releases implicitly on `pointerup` and
  `pointercancel`; call `releasePointerCapture` anyway and swallow the throw for an id that
  is already gone. `dispose()` releases every held capture.
- **Every way of losing a pointer produces a terminal sample.** `pointerup` → `up`;
  `pointercancel`, `lostpointercapture`, window `blur`, `visibilitychange` to hidden, and
  `dispose()` → `cancel` for each active id. This is the important half: *the recognizer's
  only exit from a drag is a terminal sample, and every browser path that can end a gesture
  is mapped onto one.* A recognizer that can be left latched in a dragging state is worse
  than one that occasionally drops a drag, because the first symptom is a camera that pans
  for ever and the second is a gesture you repeat.
- **A canceled drag ends, but does not fling.** `dragend` is always emitted; on a cancel its
  velocity is zero. A gesture interrupted by an incoming call must not leave the camera flying.
- **A drag that ends over a button does not press it.** That is a consequence of capture, and
  it is the behavior you want: the gesture belonged to the world from the moment it started.

Invariants 8 and 13 in §5 are the tests for all of this.

### 3.10 Diagnostics

```ts
/** Things this package can detect about its host that are always bugs. */
export type DiagnosticCode =
  | 'covered-by-overlay'
  | 'touch-action-overridden'
  | 'unknown-key-code'
  | 'pointer-events-none'
  | 'buffer-overflow';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  /** Names the caller's mistake and the element responsible. Never a bare description. */
  readonly message: string;
  readonly element?: Element;
}
```

---

## 4. What is deliberately absent

**1. Hit-testing.** This package will never tell you *what* you tapped, only *where*. It has
no way to be told what is in the world: no registry, no rect, no "pickable", no callback that
returns a hit. That absence is the mechanism behind non-negotiable 5. A naive implementation
that caches hit boxes during the draw pass cannot be built on this API, because there is
nowhere to put them and nothing that would read them — and the layering forbids the shortcut
that would make it tempting, since `input` and `draw` are siblings and neither may import the
other. Picking is `iso`'s pure `hitTest(state, camera, sx, sy)`, called from a handler with
coordinates this package has already computed. (In the source game the cached version made
every collect bubble untappable in a backgrounded tab, where the draw pass had stopped running
and the cached boxes were minutes old.)

**2. The gamepad.** Cut from 0.1, and this is the entry that argues with the brief: the module
list in `kit.json` names `gamepad`, and the demo game in `docs/rfc/demo.md` — the only real
test the kit has of anything — never touches it. Three reasons, in increasing order of weight.

*It cannot be exercised.* There is no headless gamepad. Tests could feed my own normalizer its
own samples and prove nothing about `navigator.getGamepads()`, and non-negotiable 10 says green
is not evidence. Shipping it means shipping the one module nobody has ever watched work.

*It is the one input source that cannot answer "where".* Every other source here resolves to a
tile: a tap is a position, a key borrows the focus point a game maintains anyway because it has
a selection. A stick is a *direction*. Making a pad honour `ActionEvent.gx/gy` needs a virtual
cursor — an on-screen reticle that moves, accelerates, snaps to candidates, and is drawn and
focus-managed by `ui`. That is not one more row in an action map, it is a second interaction
model, and the kit has not designed one. Adding `pad:` bindings without it would give a game a
binding that fires at the middle of the screen for ever.

*The cost of its return is small and additive.* One member on `ActionBinding`, one `RawSample`
kind, one `PadState`, one poller, and the `focus()` seam that positionless sources already use.
Nothing above breaks. **It comes back when a game shape asks for it** — an isometric game whose
verb is "steer a character", or a build targeting a TV or a handheld — and it comes back with
the reticle, because that is the part that is actually hard.

What that poller will have to get right, recorded here so the knowledge is not lost: there are
no gamepad events worth using, so it is read inside `tick` and nowhere else;
`navigator.getGamepads()` allocates a fresh array on every call in every browser and Safari has
handed back stale objects, so it is read once into a fixed sample; a sample is emitted only when
the button mask or an axis actually changed, or a log becomes sixty samples a second of nothing;
the deadzone is **radial**, applied to the vector's magnitude and never per axis, because
per-axis deadzones snap diagonals onto the axes and make a camera pan in eight directions
instead of freely; worn sticks rest as far out as 0.22; analog triggers bound as buttons need
hysteresis around their threshold or a resting finger chatters; and a pad is invisible to the
page until a button is pressed, so `connected` starting false with a controller plugged in is
the specification working.

**3. Double tap.** Disambiguating it costs every single tap ~300 ms of latency, because a tap
cannot be delivered until a second one has failed to arrive. In a game whose primary verb is
"tap the thing to collect it" that trade is catastrophic and invisible in review — it does not
look broken, it just feels slow. Double-tap-to-zoom is also redundant with pinch and the `+`
key. A game that truly needs it can count taps itself; everyone else should not pay for it.

**4. Release edges on actions, and analog axis mapping.** An action means the same thing from
finger and key. A tap has no meaningful release and a key has no meaningful pressure, so both
features could only ever be honest for some of the sources. `held()` covers charge-ups. A
general axis-mapping system is a large surface for a kit whose games are tile-based and
pointer-first, and if one arrives it should arrive with the gamepad.

**5. Rebindable keymaps, and any UI for them.** The map is data the game owns; persisting a
player's edits is `persist`'s job and rendering the rebinding screen is `ui`'s. What this
package owes them is `bindings(action)`, so the sheet is generated rather than transcribed.

**6. Camera animation — `flyTo`, `frameAll`, easing to a target.** The controller integrates
inertia because a flick's glide is the continuation of a gesture. Everything else is a tween
over `camera.x/y/zoom`, which is `loop`'s tween and `iso`'s camera, and needs neither of them
imported here.

**7. Rotation, three-finger gestures, swipe, and edge-scroll.** The isometric projection does
not rotate (that is `iso`'s decision and this package honours it), a third pointer is a palm,
"swipe" is a drag whose velocity you already have, and edge-scroll on a touch device means the
edge of the screen cannot be dragged — which is where the map is.

**8. Text entry, IME, clipboard, file drop.** A field is a DOM input and the browser is better
at it. What this package owes text is a guard: a key sample whose target is an `<input>`,
`<textarea>` or `contenteditable` never reaches the action map, and neither does one carrying a
meta, control or alt modifier that no binding asked for. In the source game the missing version
of the first rule meant pasting a code containing the letter *b* opened the shop mid-paste; the
missing version of the second would mean ⌘R no longer reloads.

**9. Wall-clock timestamps in the log, and `requestAnimationFrame`, `setTimeout`, `Date.now`,
`performance.now`.** Not one of them appears in this package's `src/`. Time is the tick index
you pass to `tick` and the milliseconds you pass to `frame`, and only the first is recorded. A
log of timestamped events replayed against a fixed-step loop does not land on the same pixel,
which makes timestamps not merely unnecessary but actively misleading — they look like they
would help.

**10. The camera's position in the replay contract.** A log replays the same *intents* to the
same tiles and therefore the same world. Where the camera happened to be coasting is a function
of the display that rendered it, because glide integrates on the frame clock (§3.6). A replay
that must match pixel for pixel records the camera pose per tick alongside the log — three
numbers — and `persist` is the right place for that. Making glide tick-rate to avoid this was
the alternative, and it was rejected because it makes a drag lag by a full simulation step on
any game whose step is not tiny.

**11. A virtual joystick or on-screen D-pad.** Drawing controls is `ui`'s, and a tile game that
needs a thumbstick has usually failed to make its tiles tappable.

---

## 5. Invariants a reviewer can test

Each is phrased so a failing case is obvious. All are testable against `createHeadlessInput`
in Node, with no DOM and no timers.

1. **A press produces at most one of `tap` and `longpress`, never both.**
   `down; tick×5; up` emits `longpress` only. `down; tick×1; up` emits `tap` only.
   *Fails as:* the release that ends a hold also counts as a tap and instantly re-drops the
   building the player just lifted.

2. **A press that travels beyond the slop for its device never taps, and never long-presses
   afterwards.** `down(mouse); move(+5,0); up` → no tap. `down(touch); move(+5,0); up` → tap.
   Same sample stream, different `pointerType`, different answer.
   *Fails as:* every drag that begins on a building opens that building.

3. **Zoom is anchored.** For any `f` and any `(sx, sy)`: `camera.toWorld(sx, sy)` before
   `zoomBy(f, sx, sy)` and after agree to 1e-9 — unless the clamp intervened, and then the test
   asserts the clamp was the cause.
   *Fails as:* the tile you are zooming towards slides out from under the cursor.

4. **Output is a pure function of the sample stream.** Two systems fed the same `InputLog` —
   one live, one through `replay` — emit an identical sequence of gesture types, ticks and
   coordinates, bit for bit, however the samples were spaced in real time.

5. **Nothing game-visible is emitted outside `tick`.** Submit a `down` and call `frame()` a
   thousand times: no handler runs, no long press fires. There is no timer that could fire it.

6. **A tick sees a closed bucket.** A handler that calls `submit()` during a tick sees its own
   sample delivered in the *next* tick, never the running one. A pump with no ticks loses
   nothing; a pump with five delivers the backlog to the first.
   *Fails as:* a tap dropped on a slow frame, or fired twice on a fast one.

7. **Overflow degrades precision, never events.** Submit 10,000 moves and one `up` without
   ticking: the `up` survives, the moves collapse to the newest per pointer, and one
   `buffer-overflow` diagnostic is raised.

8. **`dispose` is total and idempotent.** Afterwards, dispatching a full
   `pointerdown/move/up` at the element calls zero handlers, `document` and `window` carry no
   listeners from this system, every pointer capture is released, `held()` is false for every
   action, and a second `dispose()` is a no-op. A child scope disposed alone leaves its
   siblings working.
   *Fails as:* a scene changes and the previous scene's camera controller is still panning.

9. **Focus loss releases everything.** `key('KeyW', down); blur` → `keyHeld('KeyW')` is false,
   and no `up` was needed.
   *Fails as:* alt-tab with a key held, and the camera pans for ever afterwards.

10. **The hot path allocates nothing.** 1,000 `move` samples through one `tick` allocate zero
    bytes (`*.bench.ts`), and the gesture object identity is the same across deliveries.

11. **Coordinates are element-relative.** With the element at `(100, 50)` in the viewport, a
    client point of `(150, 80)` produces `sx = 50, sy = 30` — and still does after the page has
    been scrolled.

12. **A key aimed at a field never becomes an action**, and neither does one carrying a
    meta/ctrl/alt modifier that no binding asked for.

13. **The recognizer cannot be latched.** For every `down` there is exactly one terminal event.
    Feed `down; move(+40,0)` and then, separately, each of `up`, `cancel`, `blur`, `dispose()`:
    each produces exactly one `dragend`, and the three that are not `up` produce it with zero
    velocity.
    *Fails as:* a drag that passes under a `ui` panel and never ends, i.e. a camera the player
    cannot stop.

14. **The overlay diagnostic fires.** A transparent element covering the world with
    `pointer-events: auto` produces one `covered-by-overlay` diagnostic naming that element on
    the first pointerdown, rather than silence.

15. **Binding the same element twice throws** a named error, and disposing the first binding
    makes the second legal.

---

## 6. Traps — what a naive implementation gets wrong

Numbered so a review can cite them. Every one has already cost time in the source game or in
its playbook.

1. **A CSS rule swallowing every tap on the world.** `#ui > * { pointer-events: auto }`
   out-specifies a bare `.spacer { pointer-events: none }`, so an invisible spacer over the
   canvas eats every tap and nothing anywhere reports an error. Hence the `covered-by-overlay`
   diagnostic: a capture-phase listener on `document` notices a `pointerdown` whose client point
   lies inside the bound element's rect but whose target is not the element or a descendant, and
   says so once, naming the culprit with the element attached. It is a diagnostic rather than a
   throw because a legitimate modal is also a cover; it fires on the first pointerdown rather
   than at bind time for the same reason.

2. **Not setting `touch-action: none`.** The browser claims the pan, `pointermove` stops
   arriving mid-gesture, and iOS double-tap-zooms the whole game. The binder sets it and
   diagnoses if the computed style disagrees anyway — a stylesheet with `!important` beats an
   inline style.

3. **Not capturing the pointer** (§3.9). A drag that leaves the element, or passes under a `ui`
   panel, stops receiving moves and the camera halts with the finger still down. Capture on
   down; map every way of losing the pointer onto a `cancel`; never leave the recognizer
   latched.

4. **Letting the release after a long press count as a tap.** See invariant 1. The recognizer
   latches the press as consumed, so a game never has to.

5. **Not canceling the long press when the finger starts travelling.** A slightly shaky drag
   lifts a building mid-pan. One number governs it: crossing `tapSlopPx` ends the press, starts
   the drag and disarms the hold, in that order.

6. **Trusting `WheelEvent.deltaY`.** Three delta modes, and Firefox reports lines. Normalize
   with `wheelLinePx`/`wheelPagePx` before anything else touches the number. Separately, a
   trackpad pinch is a `wheel` with `ctrlKey` set — miss it and pinch-to-zoom on a laptop
   scrolls instead of zooming. And the listener must be `{ passive: false }`, or the
   `preventDefault` that stops the page zooming is ignored.

7. **Using `clientX`.** Correct only for a full-window canvas at the origin, which is exactly
   the configuration the first game happens to have and the second one does not. Use the
   element's rect — but cache it, because `getBoundingClientRect()` per `pointermove` forces
   layout a thousand times a second. Invalidate on `resize`, on a capture-phase `scroll`, and
   from a `ResizeObserver` on the element.

8. **Computing fling velocity from the last two points.** A finger that pauses before lifting
   produces either zero or nonsense. Average over `flingSampleMs`, and drop the fling entirely
   below `flingMinPxPerS`.

9. **Starting a pinch from a spread of zero.** The two pointers do not land in the same tick.
   Seed the spread when the second lands, wait for `pinchStartPx` of change, and refuse to
   divide by a spread below `pinchMinSpreadPx`.

10. **Stuck keys.** `keydown` without its `keyup` happens on every alt-tab, and on macOS
    whenever a ⌘ chord is held. Listen for `blur` and `visibilitychange` and release
    everything. Also ignore `KeyboardEvent.repeat` for edges (§3.3).

11. **Two live instances driving one canvas.** Vite HMR leaves the previous module's listeners
    bound. Hence the throw on double-binding: without it the symptom is a camera that pans
    twice as fast and a game that is impossible to debug.

12. **Draining input in the render callback, or after the camera has moved.** Then the tile a
    tap resolves to is not the tile that was under the finger in the last frame the player
    actually saw. `tick` first, then the game's update, then `frame`, then draw — and inside
    `frame` the controller integrates its glide *after* everything else, so the ordering holds
    within the package too.

13. **Treating a stream of timestamped events as a replay log.** It is not one: replayed
    against a fixed-step loop whose pumps fall differently, the same events land in different
    ticks and the run diverges. Bucket to ticks at capture time — which is what §3.8 does — and
    the log is replayable by construction rather than by luck.

14. **Ignoring `getCoalescedEvents()`.** A 120 Hz pointer delivers several positions per frame.
    For panning the newest is enough and cheaper; for anything drawing a stroke the coalesced
    list is the difference between a smooth line and a polygon. The buffer keeps every coalesced
    move (subject to the collapse rule in §3.8) and the recognizer uses the last for position
    and the set for velocity.

---

## 7. What this RFC needs from other packages

Written out because these are other agents' files, not mine.

**From `iso` (item 1 is blocking):**

1. `screenToTile(camera, sx, sy, out: GridPoint): void`, flooring. §3.7 is the argument. Without
   it the flooring rule lives in two packages.
2. `Camera` with `toWorld(sx, sy, out)`, `toScreen(wx, wy, out)`, `panByScreen(dx, dy)`,
   `zoomAt(factor, sx, sy)`, and readable `x`, `y`, `zoom`, `viewW`, `viewH` in **CSS pixels**.
   Device-pixel-ratio is `draw`'s business; if the camera is in device pixels then every
   threshold in §3.5 is wrong by a factor that differs per phone.
3. **`zoom` must not be publicly assignable.** If a game can write `camera.zoom = 2` it bypasses
   both the clamp and the anchoring, and invariant 3 becomes untestable in practice. `zoomAt` as
   the only mutator, plus an explicit `setZoomAt(z, sx, sy)` if an absolute set is needed.
4. Exported `Vec2 { x, y }` and `GridPoint { gx, gy }`, mutable, for output parameters.
5. `hitTest(state, camera, sx, sy)` — pure, uncached, front-to-back with the tie broken by paint
   order. Not mine, but the absence of hit-testing here (§4.1) is only defensible if it exists
   there.

**From `loop`:**

6. A tick callback carrying an **integer tick index** and a frame callback carrying wall-clock
   milliseconds, plus a readable `stepMs`. §2 assumes `onTick(index)` / `onFrame(nowMs)` /
   `loop.stepMs`; the names are yours, the two clocks are not negotiable.
7. A documented phase order — input tick, then fixed-step simulation, then frame, then render —
   so trap 12 is structural rather than a paragraph in this document.

**From `persist`:**

8. The replay envelope stores `InputLog` (§3.8) verbatim: a flat `RawSample[]` plus `version`,
   `stepMs` and `profile`. Two asks: never reorder `samples`, and treat a mismatch on those
   three fields as a **refusal**, not a migration. A migrated input log is a log that no longer
   replays, and reporting that honestly is better than replaying something plausible.

**From `core`:**

9. `Disposer` and a `createScope()` primitive. Teardown is not an input problem: `audio`, `ui`,
   `loop` and `persist` all need it, and a game should hold **one** tree per scene rather than
   five. If `core` takes it, `input` re-exports rather than defines. This is the single biggest
   gap I found in the kit.

**On `kit.json`** (orchestrator's file, not mine — please apply):

10. Drop `gamepad` from this package's modules and from the `purpose` string; §4.2 is the
    argument.
11. The remaining module list mixes the pure recognizer with the DOM binding inside `pointer`,
    which non-negotiable 4 forbids in one file. Proposed instead: `sample` (the `RawSample`
    union, the buffer and the log format — pure), `recognize` (the gesture state machine —
    pure), `actions` (pure), `cameracontrol` (pure, given a camera), `dom` (the only impure
    module: pointer, keyboard, wheel, capture), and `scope` (deleted if `core` takes item 9).
12. Add to this package's `invariants`: *"Gestures are delivered on simulation ticks, never on
    frames, and never from a clock this package read itself."*
