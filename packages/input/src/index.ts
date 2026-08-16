/**
 * `@lattice/input` — every way a person can touch a game, as one replayable stream of intents
 * in tile coordinates, bucketed to simulation ticks, behind one object that unbinds all of it.
 *
 * ```ts
 * const input = createInput({
 *   element: canvas,
 *   camera,
 *   step: loop,
 *   actions: { collect: ['tap', 'key:Space'], build: ['key:KeyB'] },
 * });
 * input.onAction('collect', (a) => collectAt(state, a.gx, a.gy));
 * loop.onUpdate((_dt, tick) => input.tick(tick));
 * loop.onRender(() => { input.frame(now); render(state, camera); });
 * onSceneEnd(() => input.dispose());
 * ```
 *
 * Four claims, each load-bearing:
 *
 * - **One stream.** A game written against this package never learns which device it is being
 *   played on. "Collect" is one handler, not three.
 * - **Tile coordinates.** Every event arrives as a tile, converted once, through the camera the
 *   player was actually looking at. No game does the conversion.
 * - **Bucketed to ticks.** Browser events arrive on the browser's schedule and a fixed-step
 *   loop runs on its own. A log of wall-clock events is not replayable; a log of tick-bucketed
 *   samples is.
 * - **One object.** Teardown is a tree, not a list of disposers you can forget to add to.
 *
 * ## The two things this package refuses to know
 *
 * **What is in the world.** There is no registry, no rect, no `pickable` flag and no hit
 * callback anywhere in this surface, so an implementation that caches hit boxes during the draw
 * pass cannot be built on it: there is nowhere to put them and nothing that would read one. In
 * the source game the cached version made every collect bubble untappable in a backgrounded
 * tab, where the draw pass had stopped running and the cached boxes were minutes old. `gx, gy`
 * is geometry; *what* is at that tile is `iso`'s `pickSorted` over the caller's own state.
 *
 * **What time it is.** No `Date.now`, no `performance.now`, no `requestAnimationFrame`, no
 * `setTimeout`, and no wall-clock timestamp in a log. Time is the tick index passed to
 * {@link InputSystem.tick} and the milliseconds passed to {@link InputSystem.frame}, and only
 * the first is recorded.
 *
 * ## What is deliberately absent
 *
 * Hit-testing (above). **The gamepad** — cut from 0.1, because it is the one input source that
 * cannot answer *where*: a stick is a direction, and making a pad honor `ActionEvent.gx/gy`
 * needs a virtual reticle that moves, accelerates, snaps to candidates and is drawn and
 * focus-managed by `ui`. That is a second interaction model, not one more row in an action map,
 * and the kit has not designed one; adding `pad:` bindings without it would give a game a
 * binding that fires at the middle of the screen for ever. It also cannot be exercised — there
 * is no headless gamepad — and non-negotiable 10 says green is not evidence. It comes back when
 * a game shape asks for it, and it comes back with the reticle, because that is the part that
 * is actually hard; the cost is one member on {@link ActionBinding}, one `RawSample` kind, one
 * poller, and the `focus` seam that positionless sources already use.
 *
 * **Double tap**, which costs every single tap ~300 ms of latency because a tap cannot be
 * delivered until a second one has failed to arrive — catastrophic and invisible in review for
 * a game whose primary verb is "tap the thing". **Release edges and analog axes**, which could
 * only ever be honest for some sources. **Rebindable keymaps and their UI**: the map is data the
 * game owns, `persist` stores the edits and `ui` renders the screen, and what this package owes
 * them is {@link InputSystem.bindings} so the sheet is generated rather than transcribed.
 * **Camera animation** beyond inertia — that is a tween over the camera, which is `loop`'s tween
 * and `iso`'s camera and needs neither imported here. **Rotation, three-finger gestures, swipe
 * and edge-scroll.** **Text entry, IME, clipboard and file drop**, where the browser is better
 * at it and what this package owes text is a guard: a key aimed at a field never becomes an
 * action, and neither does one carrying a modifier no binding asked for.
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';

// ── the surface, and the recognizer behind it ───────────────────────────────────────────────
//
// `createHeadlessInput` is not a testing shim: it is the same object, minus a producer of
// samples. Everything a game can assert about gestures is assertable in Node because of it.

export { createHeadlessInput } from './system.js';
export type { HeadlessInputOptions, InputSystem } from './system.js';

export { createInput } from './dom.js';
export type { DomInputSystem, InputOptions } from './dom.js';

// ── teardown ────────────────────────────────────────────────────────────────────────────────
//
// `Disposer` is `core`'s, re-exported rather than redeclared: a second identical alias would be
// a second thing to keep in step, and `Scope.add` from `core` must accept what `on` returns
// without a cast. There is no free-function binder here — a listener comes only from a scope,
// so an unowned listener is unconstructable.

export type { InputScope } from './scope.js';
export type { Disposer } from '@lattice/core';

// ── what a handler is handed ────────────────────────────────────────────────────────────────
//
// Coordinates in all three spaces, because guessing wrong about which one a callback wanted is
// the most common bug in this layer. The objects are reused between deliveries; copy what you
// keep.

export type {
  ActionEvent,
  DragGesture,
  GestureBase,
  GestureMap,
  TapGesture,
  ZoomGesture,
} from './events.js';
export type { GestureName, ZoomSource } from './recognize.js';
export type { ActionBinding, ActionMap } from './actions.js';

// ── the thresholds ──────────────────────────────────────────────────────────────────────────
//
// Every number that decides what a gesture is, with its derivation in the source beside it. A
// profile is part of a replay's identity: the same finger movements under a different tap slop
// are a different session.

export { DEFAULT_PROFILE } from './profile.js';
export type {
  GestureProfile,
  PointerKind,
  ProfileOverrides,
  ProfileScalar,
} from './profile.js';

// ── the fixed step ──────────────────────────────────────────────────────────────────────────
//
// Taken as the loop reports it rather than as a bare number. `step: 16` against a 16.667 ms loop
// does not fail, it lies by 4% — a long press at 432 ms, a fling that coasts short, and a log a
// replay refuses months later. `Loop` satisfies `FixedStep` structurally, so the shortest thing
// that type-checks is `step: loop`; `fixedStep(hz)` covers the callers with no loop to read.

export { fixedStep } from './step.js';
export type { FixedStep } from './step.js';

// ── the camera controller ───────────────────────────────────────────────────────────────────
//
// There is deliberately no `setZoom`. `zoomBy`'s anchor is a required parameter, so
// origin-anchored zoom — the single most common reason a tile-game camera feels broken — is not
// somewhere you can arrive by accident.

export type { CameraController } from './cameracontrol.js';

// ── samples, logs and replay ────────────────────────────────────────────────────────────────
//
// `input` records, `persist` stores and verifies, `loop` drives. `ReplayCursor` is written out
// rather than imported: `loop` is layer 1 and this is layer 2, so the edge does not exist.

export { LOG_VERSION } from './sample.js';
export type { Diagnostic, DiagnosticCode, DiagnosticSink, InputLog, RawSample } from './sample.js';
export { createLog, record, replay, replayCursor } from './record.js';
export type { InputRecording, ReplayCursor } from './record.js';

// ── vocabulary borrowed from below ──────────────────────────────────────────────────────────
//
// `hoverTile(out: GridPoint)` and `focus(out: Vec2)` are in this package's signatures, so the
// types they need are re-exported here. A caller should not have to know which package owns a
// two-field record to write an out-parameter.

export type { GridPoint } from '@lattice/iso';
export type { Vec2 } from '@lattice/core';
