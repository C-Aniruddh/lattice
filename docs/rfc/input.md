# RFC — `@lattice/input`

Status: **proposed**. Owner: lattice-architect (task A5). Depends on `@lattice/core`, `@lattice/iso`.
Environment: **browser** (`window`, `document`, `navigator.getGamepads`). The recogniser inside it is not.

---

## 1. The one sentence

**`@lattice/input` turns every way a person can touch a game — finger, mouse, pen, key —
into one replayable stream of intents expressed in tile coordinates, and hands back one
object that unbinds all of it.**

Three claims in that sentence, and each is load-bearing:

- **one stream.** A game written against this package never learns which device it is
  being played on. "Collect" is one handler, not three. (Gamepad is cut from 0.1 — §4.2
  makes that case rather than assuming it.)
- **replayable.** The recogniser is a pure function of a sample stream and the frame times
  it is given. It reads no clock, so a recorded session replays to the same tile
  (non-negotiable 1).
- **one object.** Teardown is a tree, not a list of disposers you can forget to add to.

---

## 2. The five-line example

This is what a game does with this package 90% of the time. It was written before the API
below, and where the two disagreed, the API moved.

```ts
const input = createInput({
  element: canvas,
  camera,
  actions: { collect: ['tap', 'key:Space', 'pad:a'] },
});
input.onAction('collect', (a) => collectAt(state, a.gx, a.gy));
loop.onFrame((nowMs) => { input.update(nowMs); render(state, camera); });
onSceneEnd(() => input.dispose());
```

Read it as a list of promises the API has to keep:

| the line | what it forces on the design |
|---|---|
| `element` + `camera` and nothing else | The package needs the surface and the transform. It never sees game state, so it can never hold a stale idea of what is in the world. |
| `actions: { collect: [...] }` | Three sources, one name, declared as data. `'colect'` in the handler is a **compile error** — the action names are inferred from this object literal. |
| `a.gx, a.gy` | The handler is handed tiles. Converting screen → world → tile by hand is the step where games get the camera wrong, so the package has already done it. |
| `input.update(nowMs)` before `render` | Nothing is emitted except inside `update`. Input therefore cannot be a side effect of rendering; it is the thing that happens before it. |
| `input.dispose()` | One call. Everything bound through `input` or any scope descended from it is gone, including the camera controller's inertia and any key the player was holding. |

Pinch, wheel, two-finger pan, drag-to-pan, arrow keys and the left stick are all live in
those five lines: the camera controller is on by default, because a tile game whose camera
does not move is not a tile game, and making every game write that wiring is how every game
gets it subtly different.

---

## 3. The public surface

```ts
import type { Camera, Vec2, GridPoint } from '@lattice/iso';
```

> `Camera` is `iso`'s. `Vec2` is `{ x: number; y: number }` and `GridPoint` is
> `{ gx: number; gy: number }`, both mutable, both used only as output parameters
> (non-negotiable 7). See §7 for what this RFC needs `iso` to export.

### 3.1 Teardown: the scope

```ts
/**
 * Undoes exactly one binding.
 *
 * Idempotent by contract. A disposer that throws on the second call turns every error
 * path — where teardown runs twice because the first attempt half-failed — into a second,
 * louder error that hides the first.
 */
export type Disposer = () => void;

/**
 * A place bindings are owned.
 *
 * This is the only way to obtain a listener: there is no free function that binds
 * something and hands you a disposer to look after. An unowned listener is therefore not
 * a thing that can be constructed, which is the whole answer to "how does a scene teardown
 * avoid leaking half of itself" — see §5, invariant 6.
 */
export interface InputScope<A extends string = never> {
  /** A child scope. Disposing the parent disposes it; disposing it does not touch the parent. */
  scope(): InputScope<A>;

  /**
   * Subscribe to a recognised gesture.
   *
   * Handlers run in registration order, scopes in creation order, and the camera
   * controller runs after all of them — so a handler can `claim()` a drag and steer a
   * placement ghost with it, and the camera will not also pan. Panning away from the site
   * a player is aiming at is never what anyone means.
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
   * Hand this scope something else to unbind — an audio node, a `ResizeObserver`, a
   * `ui` panel. Present so that a scene has exactly one teardown tree rather than one
   * per package it happens to use.
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
 * wanted is the most common bug in this layer, and because a game that converts by hand
 * will eventually convert with the wrong camera.
 *
 * The object is reused between deliveries. Copy what you keep; retaining it keeps a
 * reference to next frame's gesture. Sixty pointer moves a second, each allocating a
 * fresh event with six numbers in it, is a garbage collector pause with a nice API.
 */
export interface GestureBase {
  readonly type: GestureName;
  readonly pointerType: PointerKind;
  /** CSS pixels, relative to the bound element's top-left — never `clientX`. */
  readonly sx: number;
  readonly sy: number;
  /** World space, through the camera as it stands at the moment of the drain. */
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
 * source game the missing version of that guarantee meant the `pointerup` ending a hold
 * also counted as a tap, which instantly re-dropped the building the player had just
 * lifted.
 */
export interface TapGesture extends GestureBase {
  readonly type: 'tap' | 'longpress';
  /** How long the press lasted, quantised to frames. Feed a press-progress ring with it. */
  readonly heldMs: number;
}

/**
 * A press that travelled. One `dragstart`, zero or more `drag`, exactly one `dragend`
 * — including when the gesture is cancelled by the system, because a drag with no end is
 * a camera that pans forever.
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
   */
  readonly vx: number;
  readonly vy: number;
}

/**
 * "Scale the world by `scale` about this point."
 *
 * One gesture for wheel, trackpad pinch, two-finger pinch, `+`/`-` and the shoulder
 * buttons, because the camera does not care which it was and neither does a game. `sx, sy`
 * is the anchor: the pointer, the midpoint between two fingers, or the viewport centre for
 * a source that has no position. `dx, dy` carries the midpoint's own travel, so a
 * two-finger gesture pans and zooms at once the way a map does.
 */
export interface ZoomGesture extends GestureBase {
  readonly type: 'zoom';
  readonly source: 'wheel' | 'pinch' | 'key' | 'pad';
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
/** Standard-mapping gamepad buttons, named after the layout the spec's index order matches. */
export type PadButton =
  | 'a' | 'b' | 'x' | 'y'
  | 'lb' | 'rb' | 'lt' | 'rt'
  | 'back' | 'start' | 'l3' | 'r3'
  | 'up' | 'down' | 'left' | 'right';

/**
 * One way of producing an action.
 *
 * `key:` takes a `KeyboardEvent.code` — a physical position, not a letter — so that WASD
 * stays under the same four fingers on AZERTY. Codes are validated when the map is built:
 * `'key:space'` reports `input.actions: 'key:space' is not a KeyboardEvent.code; did you
 * mean 'key:Space'?` rather than binding nothing and going quiet.
 *
 * Only `tap` and `longpress` appear here, out of six gestures. An action must mean the
 * same thing from all three devices, and a drag has no keyboard equivalent that is not a
 * lie.
 */
export type ActionBinding = 'tap' | 'longpress' | `key:${string}` | `pad:${PadButton}`;

/**
 * An action fired.
 *
 * The coordinates are always populated, which is the point. A pointer-sourced action
 * carries where the finger was; a key- or pad-sourced one carries {@link
 * InputOptions.focus} — the game's current selection — falling back to the viewport
 * centre. Without that rule the keyboard path either does nothing or does something
 * different from the touch path, and the keyboard path is the one nobody tests.
 */
export interface ActionEvent<A extends string> {
  readonly action: A;
  readonly source: 'pointer' | 'key' | 'pad';
  /** Which binding fired it. Present so a tutorial can say "you can also press Space". */
  readonly binding: ActionBinding;
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

Actions fire on the **press edge only**, once per physical press. Auto-repeat does not
fire them: the repeat rate is an operating-system setting, so an action that repeats is an
action whose count is not reproducible, and non-negotiable 1 says the log must replay. A
held action is a query (`held`), not a stream.

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
   * The action map, as data.
   *
   * The names are inferred from this object, so `onAction`, `held` and `bindings` only
   * accept names that exist. This object is also the single source of truth for a
   * shortcut sheet — see {@link InputSystem.bindings}.
   */
  readonly actions?: { readonly [K in A]: readonly ActionBinding[] };

  /** Override any threshold in §3.5. Everything not named keeps its default. */
  readonly profile?: Partial<GestureProfile>;

  /** Set `false` for a game whose camera is fixed. The gestures still arrive. */
  readonly control?: boolean;

  /**
   * Where a keyboard or gamepad action points.
   *
   * Write the screen point of the current selection into `out` and return `true`; return
   * `false` and the viewport centre is used. This is the seam between "the player pressed
   * Space" and "at what", and a game that leaves it unimplemented is still playable —
   * it just collects from the middle.
   */
  readonly focus?: (out: Vec2) => boolean;

  /** Where problems the package can detect go. Default: `console.warn`, once per code. */
  readonly onDiagnostic?: (d: Diagnostic) => void;

  /** Keep the browser context menu over the world. Default false: a long press on Android
   *  raises it mid-gesture, and it lands on top of the building you just lifted. */
  readonly keepContextMenu?: boolean;
}

export interface InputSystem<A extends string = never> extends InputScope<A> {
  readonly element: HTMLElement;
  readonly camera: CameraController;
  readonly pad: PadState;
  readonly profile: Readonly<GestureProfile>;

  /** Every declared action, in declaration order. */
  readonly actionNames: readonly A[];

  /**
   * What is bound to an action.
   *
   * Exists so that a keyboard-shortcut sheet is rendered *from* the map. In the source
   * game the entire input test file existed to catch a sheet that promised keys nothing
   * handled, and a sheet nobody could find for keys that worked. Generated from this, that
   * defect class cannot occur.
   */
  bindings(action: A): readonly ActionBinding[];

  /**
   * Advance to `nowMs` and deliver everything that has happened since the last call.
   *
   * The only place handlers run. Call it once per frame, **before** the camera moves and
   * before anything is drawn: the coordinates in every event are resolved through the
   * camera as it is at this instant, which must be the camera the player was looking at
   * when they touched the screen.
   *
   * Time arrives here as a parameter and is not read from anywhere else in the package.
   * A long press therefore fires on a frame, never on a `setTimeout`.
   */
  update(nowMs: number): void;

  /** Feed the recogniser directly. The DOM binding is a producer of these and nothing more. */
  submit(sample: RawSample): void;

  /** Is any binding of this action currently held? Continuous input is a query, not a stream. */
  held(action: A): boolean;

  /** Escape hatch for a key with no action, e.g. a debug overlay. `KeyboardEvent.code`. */
  keyHeld(code: string): boolean;

  /**
   * The tile under the pointer, for a hover highlight.
   *
   * Returns `false` when there is no pointer over the world — which is every touch device,
   * always, between taps. A control that only appears on hover does not exist on a phone;
   * this signature is shaped to make that impossible to forget.
   */
  hoverTile(out: GridPoint): boolean;

  /** The pointer's screen position, same contract as {@link hoverTile}. */
  pointerScreen(out: Vec2): boolean;
}

/**
 * Bind a world surface. Touches `document` and `window`.
 *
 * Also, on the element and reverted on dispose: `touch-action: none` (without it a browser
 * claims the pan and `pointermove` simply stops mid-gesture), `overscroll-behavior:
 * contain` (without it a downward drag near the top of an iOS page reloads the game) and
 * `user-select: none` (without it a drag selects the page).
 */
export declare function createInput<A extends string = never>(options: InputOptions<A>): InputSystem<A>;

/**
 * The same recogniser with no DOM at all, fed only by {@link InputSystem.submit}.
 *
 * This is how the package is tested, and how a replay runs in Node. It exists because the
 * pure half of this package genuinely is pure (non-negotiable 4) and hiding that behind a
 * DOM constructor would waste it.
 */
export declare function createHeadlessInput<A extends string = never>(
  options: Omit<InputOptions<A>, 'element' | 'onDiagnostic' | 'keepContextMenu'>,
): InputSystem<A>;

/** Append every sample the system is fed into `into`. This array plus a seed is a session. */
export declare function record<A extends string>(system: InputSystem<A>, into: RawSample[]): Disposer;

/** Feed a recorded log back in. Same log, same gestures, same tiles — see §5, invariant 4. */
export declare function replay<A extends string>(system: InputSystem<A>, log: readonly RawSample[]): void;
```

### 3.5 The thresholds

```ts
/**
 * Every number that decides what a gesture is.
 *
 * They are here, named, in one interface, because a magic `9` inside a `pointermove`
 * handler is a number nobody can argue with. Each default is defended in the table below.
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
  readonly stickDeadzone: number;
  readonly triggerThreshold: number;
  readonly flingMinPxPerS: number;
  readonly flingHalfLifeMs: number;
  readonly flingSampleMs: number;
  readonly maxPointers: number;
}

export declare const DEFAULT_PROFILE: Readonly<GestureProfile>;
```

| knob | default | why this number |
|---|---:|---|
| `tapSlopPx.touch` | **9** | A fingertip's contact patch shifts several pixels during a press people experience as perfectly still, and the reported point moves as the patch grows. Shipped at 9 in the source game after tuning against real hands; below ~6 half of all taps on a phone become one-pixel drags, above ~12 a deliberate small pan opens whatever was under the finger. |
| `tapSlopPx.mouse` | **4** | Matches Windows' `SM_CXDRAG`. A mouse does not wobble, so touch's 9 would eat every short deliberate drag and make the camera feel stuck. |
| `tapSlopPx.pen` | **6** | A stylus wobbles more than a mouse and far less than a finger, and pen users make small deliberate movements. Between the two, nearer the mouse. |
| `longPressMs` | **450** | iOS long-press is ~500 ms, Android ~400. Inside that band the duration is one people's hands already know. Below ~350 it fires during ordinary taps; above ~600 people let go first and report it broken. |
| `pinchStartPx` | **12** | Two fingers never land in the same frame, and the spread jitters as the second settles. Without a start threshold every two-finger pan zooms slightly, which reads as the map "breathing". |
| `pinchMinSpreadPx` | **24** | The scale factor is a ratio of spreads; near-touching fingers make its denominator tiny and one noisy sample teleports the zoom. |
| `wheelLinePx` | **16** | `WheelEvent.deltaMode === 1` means *lines*. Firefox reports 3 lines where Chrome reports 100 px; without this conversion the same flick zooms 30× less on Firefox. |
| `wheelPagePx` | **400** | `deltaMode === 2`, pages. Rare, and one page of scroll is about one viewport. |
| `wheelZoomRate` | **0.0016** | `scale = exp(-dz × rate)`. Exponential so a notch feels the same at 0.6× and at 4×, and so wheeling up then down returns to exactly where you started. 0.0016 puts a typical 100 px notch at ~1.17×, close to `keyZoomStep`. |
| `wheelPinchRate` | **0.0100** | A trackpad pinch arrives as a `wheel` with `ctrlKey` set and much smaller deltas. Using the scroll rate for it makes pinch-to-zoom on a laptop feel dead. |
| `keyZoomStep` | **1.15** | ~5 presses per doubling: coarse enough to get somewhere, fine enough to frame a building. |
| `keyPanPxPerS` | **700** | Held keys and sticks integrate per frame rather than jumping per keypress, so this is a speed: about a viewport every two seconds. |
| `stickDeadzone` | **0.22** | **Radial**, applied to the vector's magnitude, not per axis. Worn sticks rest as far out as 0.2; per-axis deadzones snap diagonals onto the axes and make a camera pan in eight directions instead of freely. |
| `triggerThreshold` | **0.5** | Analog triggers bound as digital buttons need one crossing point, with hysteresis around it so a resting finger does not chatter. |
| `flingMinPxPerS` | **120** | Below this a release is a stop, not a flick. Without a floor every drag drifts after the finger lifts and the camera can never be placed exactly. |
| `flingHalfLifeMs` | **150** | Exponential decay, so glide is frame-rate independent. A 1200 px/s flick coasts ~260 px: enough to feel alive, short enough that a second gesture is never fighting the first. |
| `flingSampleMs` | **60** | The window velocity is averaged over. See `DragGesture.vx`. |
| `maxPointers` | **2** | A third finger on a two-finger gesture is a palm. Ignoring it beats letting it move the midpoint. |

### 3.6 The camera controller

```ts
/**
 * The gestures-to-camera policy. `iso` owns where the camera may be; this owns where the
 * player is trying to put it.
 *
 * There is deliberately no `setZoom`. The only way to change scale is {@link zoomBy}, and
 * its anchor is a required parameter — so origin-anchored zoom is not something you can
 * reach by accident, only by deliberately typing the viewport centre. Origin-anchored zoom
 * is the single most common reason tile-game cameras feel broken: the thing you are
 * looking at slides out from under you as you zoom towards it.
 */
export interface CameraController {
  /** Off means gestures still arrive; nothing drives the camera. For a fixed-camera game. */
  enabled: boolean;

  /** Pan by a screen delta. Divided by zoom inside `iso`, so a drag tracks the finger. */
  panBy(dxScreen: number, dyScreen: number): void;

  /** Multiplicative zoom about a screen anchor. The anchor is not optional. */
  zoomBy(factor: number, anchorSx: number, anchorSy: number): void;

  /**
   * Kill any glide immediately.
   *
   * Call it when a modal opens or a scene ends. A camera still coasting under a dialog is
   * a camera that has moved somewhere the player did not choose while they could not see it.
   */
  stop(): void;

  readonly gliding: boolean;
}

export interface PadState {
  /** False until the player presses something: browsers hide pads until then, deliberately. */
  readonly connected: boolean;
  isDown(button: PadButton): boolean;
  /** Writes the deadzoned stick into `out` and returns its magnitude, 0..1. */
  stick(which: 'left' | 'right', out: Vec2): number;
}
```

### 3.7 Samples and diagnostics

```ts
/**
 * The entire input to the recogniser. Plain data, serialisable, no clock, no DOM.
 *
 * `frame` is how time enters: `update(nowMs)` is sugar for submitting one. That means a
 * log is a complete description of a session's input, including its timing, and that
 * nothing in this package can observe time any other way.
 */
export type RawSample =
  | { readonly kind: 'down'; readonly id: number; readonly sx: number; readonly sy: number; readonly pointerType: PointerKind }
  | { readonly kind: 'move'; readonly id: number; readonly sx: number; readonly sy: number }
  | { readonly kind: 'up'; readonly id: number; readonly sx: number; readonly sy: number }
  | { readonly kind: 'cancel'; readonly id: number }
  /** `dz` is normalised to CSS pixels; `pinch` is a trackpad pinch arriving as a wheel. */
  | { readonly kind: 'wheel'; readonly sx: number; readonly sy: number; readonly dz: number; readonly pinch: boolean }
  | { readonly kind: 'key'; readonly code: string; readonly down: boolean }
  /** Buttons as a bitmask, sticks as four numbers: one fixed-size sample, no allocation. */
  | { readonly kind: 'pad'; readonly buttons: number; readonly lx: number; readonly ly: number; readonly rx: number; readonly ry: number }
  /** The window lost focus. Everything held is released — see §6, trap 11. */
  | { readonly kind: 'blur' }
  | { readonly kind: 'frame'; readonly nowMs: number };

/** Things this package can detect about its host that are always bugs. */
export type DiagnosticCode =
  | 'covered-by-overlay'
  | 'touch-action-overridden'
  | 'unknown-key-code'
  | 'pointer-events-none';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  /** Names the caller's mistake and the element responsible. Never a bare description. */
  readonly message: string;
  readonly element?: Element;
}
```

---

## 4. What is deliberately absent

**1. Hit-testing.** This package will never tell you *what* you tapped, only *where*. It
has no way to be told what is in the world — no registry, no rect, no "pickable", no
callback that returns a hit. That absence is the mechanism behind non-negotiable 5: a
naive implementation that caches hit boxes during the draw pass cannot be built on this
API, because there is nowhere to put them and nothing that would read them. Picking is
`iso`'s pure `hitTest(state, camera, sx, sy)`, called from a handler with the coordinates
this package already computed. (The source game's version of this bug made every collect
bubble untappable in a backgrounded tab, where the draw pass had stopped running and the
cached boxes were minutes old.)

**2. Double tap.** Disambiguating it costs every single tap ~300 ms of latency, because a
tap cannot be delivered until the second one has failed to arrive. In a game whose primary
verb is "tap the thing to collect it", that trade is catastrophic and invisible in review —
it does not look broken, it just feels slow. Double-tap-to-zoom is also redundant with
pinch and the `+` key. If a game truly needs it, it can count taps itself; the package will
not make everyone else pay for it.

**3. Release edges on actions and analog axis mapping.** An action means the same thing
from finger, key and pad. A tap has no meaningful release and a key has no meaningful
pressure, so both features could only be honest for two sources out of three. `held()`
covers charge-ups; `pad.stick()` and the camera controller cover analog. A general
axis-mapping system is a large surface for a kit whose games are tile-based and
pointer-first.

**4. Rebindable keymaps, and any UI for them.** The map is data the game owns; persisting a
player's edits is `persist`'s job and rendering the rebinding screen is `ui`'s. What this
package owes them is `bindings(action)`, so the sheet is generated rather than transcribed.

**5. Camera animation — `flyTo`, `frameAll`, easing to a target.** The controller integrates
inertia because a flick's glide is the continuation of a gesture. Everything else is a tween
over `camera.x/y/zoom`, which is `loop`'s tween and `iso`'s camera, and belongs to neither
of them being imported here.

**6. Rotation, three-finger gestures, swipe, and edge-scroll.** The isometric projection
does not rotate (that is `iso`'s decision and this package honours it), a third pointer is
a palm, "swipe" is a drag whose velocity you already have, and edge-scroll on a touch device
means the edge of the screen cannot be dragged — which is where the map is.

**7. Text entry, IME, clipboard, file drop.** A field is a DOM input and the browser is
better at it. What this package does owe text is a guard: a keyboard sample whose target is
an `<input>`, `<textarea>` or `contenteditable` never reaches the action map, and neither
does anything with a meta, control or alt modifier. In the source game the missing version
of the first rule meant pasting a code containing the letter *b* opened the shop mid-paste;
the missing version of the second would mean ⌘R no longer reloads.

**8. A virtual joystick or on-screen D-pad.** Drawing controls is `ui`'s; and a tile game
that needs a thumbstick has usually failed to make its tiles tappable.

**9. `requestAnimationFrame`, `setTimeout`, and any clock.** Not one of them appears in this
package's `src/`. Time is the `nowMs` you pass to `update`. This is what makes replay real
and what stops a long press firing while the tab is hidden and the game is not running.

---

## 5. Invariants a reviewer can test

Each is phrased so a failing case is obvious. All of them are testable against
`createHeadlessInput` in Node, with no DOM and no timers.

1. **A press produces at most one of `tap` and `longpress`, never both.**
   `down; frame(+500); up` emits `longpress` only. `down; frame(+100); up` emits `tap` only.
   *Fails as:* the release that ends a hold also counts as a tap and instantly re-drops the
   building the player just lifted.

2. **A press that travels beyond the slop for its device never taps, and never long-presses
   afterwards.** `down(mouse); move(+5,0); up` → no tap. `down(touch); move(+5,0); up` →
   tap. Same sample stream, different `pointerType`, different answer.
   *Fails as:* every drag that begins on a building opens that building.

3. **Zoom is anchored.** For any `f` and any `(sx, sy)`: take `camera.toWorld(sx, sy)`
   before `zoomBy(f, sx, sy)` and after; the two agree to 1e-9, unless the clamp intervened
   — and when it does, the test asserts the clamp was the cause.
   *Fails as:* the tile you are zooming towards slides out from under the cursor.

4. **Output is a pure function of the sample stream.** Two systems, the same
   `RawSample[]` — one fed live, one via `replay` — emit an identical sequence of gesture
   types and coordinates, bit for bit. The gesture is quantised to frames, so this holds
   regardless of how the samples were spaced in real time.

5. **Nothing is emitted outside `update`.** Submit a `down` and then never a `frame`: no
   handler runs, however long the test waits. There is no timer that could fire.

6. **`dispose` is total and idempotent.** After `input.dispose()`, dispatching a full
   `pointerdown/move/up` at the element calls zero handlers, `document` and `window` carry
   no listeners from this system, the pointer capture is released, `held()` is false for
   every action, and a second `dispose()` is a no-op. A child scope disposed on its own
   leaves its siblings working.
   *Fails as:* a scene changes and the previous scene's camera controller is still panning.

7. **Focus loss releases everything.** `key('KeyW', down); blur` → `keyHeld('KeyW')` is
   false, and no `up` was needed.
   *Fails as:* alt-tab with a key held and the camera pans forever afterwards.

8. **The hot path allocates nothing.** 1,000 `move` samples through one `update` allocate
   zero bytes (`*.bench.ts`), and the gesture object identity is the same across deliveries.

9. **Coordinates are element-relative.** With the element at `(100, 50)` in the viewport, a
   client point of `(150, 80)` produces `sx = 50, sy = 30`, and still does after the page
   has been scrolled.

10. **A key aimed at a field never becomes an action**, and neither does one carrying a
    meta/ctrl/alt modifier that no binding asked for.

11. **The overlay diagnostic fires.** A transparent element covering the world with
    `pointer-events: auto` produces one `covered-by-overlay` diagnostic naming that element
    on the first pointerdown, rather than silence.

12. **Binding the same element twice throws** a named error, and disposing the first
    binding makes the second legal.

---

## 6. Traps — what a naive implementation gets wrong

Numbered so a review can cite them. Every one of these has cost time in the source game.

1. **A CSS rule swallowing every tap on the world.** `#ui > * { pointer-events: auto }`
   out-specifies a bare `.spacer { pointer-events: none }`, so an invisible spacer over the
   canvas eats every tap and nothing anywhere reports an error. This is the reason for the
   `covered-by-overlay` diagnostic: a capture-phase listener on `document` notices a
   `pointerdown` whose client point lies inside the bound element's rect but whose target is
   not the element or a descendant, and says so, naming the culprit — once, with the
   element attached. It is a diagnostic rather than a throw because a legitimate modal is
   also a cover; it fires on the first pointerdown rather than at bind time for the same
   reason.

2. **Not setting `touch-action: none`.** The browser claims the pan, `pointermove` stops
   arriving mid-gesture, and iOS double-tap-zooms the whole game. The binder sets it, and
   diagnoses if the computed style disagrees anyway — a stylesheet with `!important` wins
   over an inline style.

3. **Not capturing the pointer.** A drag that leaves the element never receives its
   `pointerup`, so the camera keeps panning when the mouse comes back. `setPointerCapture`
   on down, and treat `pointercancel` — which Android fires when the system takes over the
   gesture — exactly like an up that cannot tap. A cancelled pointer left in the active map
   makes the *next* tap believe two fingers are down.

4. **Letting the release after a long press count as a tap.** See invariant 1. The
   recogniser latches the press as consumed; a game must never have to.

5. **Not cancelling the long-press timer when the finger starts travelling.** A slightly
   shaky drag lifts a building mid-pan. One number governs it: crossing `tapSlopPx` ends the
   press, starts the drag, and disarms the hold, in that order.

6. **Trusting `WheelEvent.deltaY`.** Three delta modes; Firefox reports lines. Normalise
   with `wheelLinePx`/`wheelPagePx` before anything else touches the number. Separately, a
   trackpad pinch is a `wheel` with `ctrlKey` set — miss it and pinch-to-zoom on a laptop
   scrolls instead of zooming. And the listener must be `{ passive: false }` or the
   `preventDefault` that stops the page zooming is ignored.

7. **Using `clientX`.** Correct only for a full-window canvas at the origin, which is
   exactly the configuration the first game happens to have and the second one does not. Use
   the element's rect — but cache it, because `getBoundingClientRect()` per `pointermove`
   forces layout a thousand times a second. Invalidate on `resize`, on a capture-phase
   `scroll`, and from a `ResizeObserver` on the element.

8. **Computing fling velocity from the last two points.** A finger that pauses before
   lifting produces either zero or nonsense. Average over `flingSampleMs`, and drop the
   fling entirely below `flingMinPxPerS`.

9. **Starting a pinch from a spread of zero.** The two pointers do not land in the same
   frame. Seed the spread when the second lands, wait for `pinchStartPx` of change, and
   refuse to divide by a spread below `pinchMinSpreadPx`.

10. **Polling the gamepad wrong.** There are no gamepad events worth using: `navigator.
    getGamepads()` must be read in `update`, it allocates a fresh array on every call in
    every browser, and Safari has handed back stale objects. Read it once per frame, into a
    fixed sample, and emit a `pad` sample only when the mask or an axis has actually
    changed — otherwise a recorded log is 60 samples a second of nothing. A pad is also
    invisible until a button is pressed, so `connected` starts false with a controller
    plugged in and that is not a bug.

11. **Stuck keys.** `keydown` without its `keyup` happens on every alt-tab, and on macOS
    while a ⌘ chord is held. Listen for `blur` and `visibilitychange` and release
    everything. Also ignore `KeyboardEvent.repeat` for edges (see §3.3).

12. **Two live instances driving one canvas.** Vite HMR leaves the previous module's
    listeners bound. Hence the throw on double-binding — the failure mode without it is a
    camera that pans twice as fast and a game that is impossible to debug.

13. **Resolving a tap through the wrong camera.** If input drains *after* the camera has
    been integrated this frame, the tile a tap resolves to is not the tile that was under
    the finger in the last frame the player actually saw. `update` first, then camera, then
    draw — and `update` integrates the controller's own glide at its end, after gestures
    have been delivered, so the ordering holds inside the package too.

14. **Ignoring `getCoalescedEvents()`.** A 120 Hz pointer delivers several positions per
    frame. For panning, the newest is enough and cheaper; for anything drawing a stroke,
    the coalesced list is the difference between a smooth line and a polygon. The samples
    carry every coalesced move; the recogniser uses the last for position and the whole set
    for velocity.

---

## 7. What this RFC needs from other packages

Written out because these are other agents' files, not mine.

**From `iso` (blocking):**

1. `Camera` with `toWorld(sx, sy, out: Vec2)`, `toScreen(wx, wy, out: Vec2)`,
   `panByScreen(dx, dy)`, `zoomAt(factor, sx, sy)`, and readable `x`, `y`, `zoom`,
   `viewW`, `viewH` in **CSS pixels** (device-pixel-ratio is `draw`'s business, and if the
   camera is in device pixels every threshold in §3.5 is wrong by a factor that differs per
   phone).
2. **`zoom` must not be publicly assignable.** If a game can write `camera.zoom = 2`, it can
   bypass both the clamp and the anchoring, and invariant 3 becomes untestable in practice.
   Expose `zoomAt` as the only mutator, plus an explicit `setZoomAt(z, sx, sy)` if an
   absolute set is needed.
3. `screenToTile(camera, sx, sy, out: GridPoint)` — flooring, not rounding. Every gesture
   carries `gx, gy` and I would rather call one `iso` function per drained event than
   compose two and own the rounding rule.
4. Exported types `Vec2 { x, y }` and `GridPoint { gx, gy }`, mutable, for output parameters.
5. `hitTest` taking `(state, camera, sx, sy)` — pure, no cache, front-to-back with the tie
   broken by paint order. Not mine, but the absence of hit-testing here (§4.1) is only
   defensible if it exists there.

**From `core`:**

6. `Disposer` and a `createScope()` primitive. Teardown is not an input problem: `audio`,
   `ui`, `loop` and `persist` all need it, and a game should hold **one** tree per scene,
   not five. If `core` takes it, `input` re-exports rather than defines. This is the single
   biggest gap I found in the kit.

**From `loop`:**

7. A documented phase order — input, then fixed-step simulation, then interpolated render —
   so trap 13 is structural rather than a paragraph in this document.

**On `kit.json`:** the module list for this package (`pointer`, `keyboard`, `gamepad`,
`gestures`, `actions`, `cameracontrol`) mixes the pure recogniser and the DOM binding inside
`pointer`, which non-negotiable 4 forbids in one file. Proposed instead: `sample` (the
`RawSample` union and the log format, pure), `recognise` (the gesture state machine, pure),
`actions` (pure), `cameracontrol` (pure, given a camera), `dom` (the only impure module —
pointer, keyboard and wheel binding), `gamepad` (polling, impure at its edge), `scope`
(deleted if `core` takes item 6).
