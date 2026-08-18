/**
 * The system: the buffer, the recognizer, the action map and the camera controller, wired.
 *
 * **Nothing in this file names a browser global.** It is the same recognizer a game runs, fed
 * only by {@link InputSystem.submit}, which is how the package is tested and how a replay runs
 * in Node. The pure half of an input package genuinely is pure, and hiding that behind a DOM
 * constructor would waste it.
 *
 * ## Two entry points, two clocks, and the reason they are different
 *
 * | call | carries | what happens |
 * |---|---|---|
 * | `tick(index)` | an integer tick index | the bucket closed before it started is delivered. **The only place a handler ever runs.** |
 * | `frame(nowMs)` | wall-clock milliseconds | the camera integrates its glide. **Delivers nothing and calls no handler.** |
 *
 * Everything game-visible happens in `tick`, in the loop's fixed step, before the game's own
 * update — so input cannot be a side effect of rendering, and it happens in the half of the
 * frame that rendering is not in. Everything `frame` moves is a *view*, and no view is
 * simulation state. Draining input in the render callback, or after the camera has moved, means
 * the tile a tap resolves to is not the tile that was under the finger in the last frame the
 * player actually saw.
 *
 * The order a game runs them in is `tick`, then its own update, then `frame`, then draw — and
 * inside `frame` the controller integrates its glide after everything else, so the ordering
 * holds within the package too.
 *
 * ## What this package can never be told
 *
 * There is no option, no method and no callback here that could carry what is *in* the world:
 * no registry, no rectangle, no `pickable` flag, no hit callback. That absence is the mechanism
 * behind "input never learns what is in the world" — a naive implementation that caches hit
 * boxes during the draw pass cannot be built on this API, because there is nowhere to put them
 * and nothing that would read one.
 *
 * **`terrain` is not an exception to that, and the distinction is exact.** A `HeightField` is
 * the shape of the *ground*: one number per grid vertex, no ids, no extents, no ordering, and no
 * way to ask what is standing on it. It is a parameter of the projection, in the same sense the
 * camera is — without it "which tile is under this pixel" has no answer rather than a different
 * one — and a hit box cannot be stored in it or recovered from it. *What* is at the tile is
 * still `iso`'s `pickSorted` over the caller's own state, called from a handler.
 */

import { createScope, expectInt } from '@latticekit/core';
import type { Scope, Vec2 } from '@latticekit/core';
import type { Camera, GridPoint } from '@latticekit/iso';
import { compileActions, nameList, undeclared } from './actions.js';
import type { ActionBinding, ActionEntry, ActionMap, CompiledActions } from './actions.js';
import { createCameraControl } from './cameracontrol.js';
import type { CameraControl, CameraController } from './cameracontrol.js';
import {
  ActionEventImpl,
  DragGestureEvent,
  TapGestureEvent,
  TickFrame,
  ZoomGestureEvent,
} from './events.js';
import type { AnyActionHandler } from './events.js';
import { TilePicker, checkTerrain } from './terrain.js';
import type { Terrain, TerrainOption } from './terrain.js';
import { profileFingerprint, resolveProfile } from './profile.js';
import type { GestureProfile, ProfileOverrides } from './profile.js';
import { createRecognizer } from './recognize.js';
import type { GestureOut, Recognizer } from './recognize.js';
import { resolveStep } from './step.js';
import type { FixedStep } from './step.js';
import { SampleBuffer, createSampleSlot, toRawSample, writeSlot } from './sample.js';
import type { Diagnostic, DiagnosticCode, DiagnosticSink, RawSample } from './sample.js';
import { HandlerList, createGestureLists, createInputScope } from './scope.js';
import type { GestureLists, InputScope, ScopeHost } from './scope.js';

/**
 * Everything a system needs that is not a browser.
 *
 * `createInput` extends this with the element and the things only a DOM binding has. Splitting
 * it this way rather than by `Omit` is what keeps every DOM type in one module: nothing here
 * names `HTMLElement`, so nothing here has to be re-checked when the adapter changes.
 */
export interface HeadlessInputOptions<A extends string> {
  /** The camera every coordinate is resolved through, and the one the controller drives. */
  readonly camera: Camera;

  /**
   * The loop's fixed step. **Pass the loop.**
   *
   * ```ts
   * createInput({ element: canvas, camera, step: loop });
   * ```
   *
   * The recognizer counts ticks and multiplies by this; it never reads a clock. A step that is
   * not the loop's does not fail, it lies by a constant ratio — a long press at the wrong moment,
   * a fling at the wrong speed, and a recorded log a replay refuses months later. That is why
   * this is a {@link FixedStep} and no longer a bare number: `@latticekit/loop`'s `Loop` satisfies
   * it, `16` does not compile, and `fixedStep(hz)` covers the headless cases.
   */
  readonly step: FixedStep;

  /**
   * The action map, as data.
   *
   * The names are inferred from this object, so `onAction`, `held` and `bindings` accept only
   * names that exist. This object is also the single source of truth for a shortcut sheet.
   *
   * **The names are identity and the bindings are policy**, and the split is enforced:
   * {@link InputSystem.setActions} rebinds any of them at any time and keeps every handler, and
   * cannot add or remove a name — see its doc comment for why.
   */
  readonly actions?: ActionMap<A>;

  /** Override any threshold in the profile. Everything not named keeps its default. Not a
   *  one-shot: {@link InputSystem.setProfile} takes the same object and keeps every handler. */
  readonly profile?: ProfileOverrides;

  /** Set `false` for a game whose camera is fixed. The gestures still arrive. */
  readonly control?: boolean;

  /**
   * What the ground looks like. **Answer it even when the answer is `'flat'`.**
   *
   * ```ts
   * createInput({ element: canvas, camera, step: loop, terrain: { field: hill, maxHeightPx } });
   * createInput({ element: canvas, camera, step: loop, terrain: 'flat' }); // and mean it
   * ```
   *
   * Every `gx`/`gy` this package reports is the inverse of the projection **on the plane it is
   * given**, and screen → grid inverts on `z = 0` and nowhere else. With a {@link Terrain} the
   * pointer is marched down the heightfield by `iso` and lands on the tile the player can see;
   * without one it lands on the tile the ray crosses at sea level, which on a hillside is
   * several tiles uphill of the finger — `examples/terraces` measures 281 px and 14 tiles of it.
   *
   * Omitting this is not an error and cannot be: a game with genuinely level ground is the
   * common case and has nothing to pass. It does raise the `flat-ground-pick` diagnostic once,
   * the first time a coordinate is read, because the alternative is the silent wrong answer this
   * option exists to end. `'flat'` says the same thing as omitting it and says it *on purpose*,
   * which is the difference the diagnostic is testing for.
   *
   * Not fixed for the life of the system: {@link InputSystem.setTerrain} replaces it, and the
   * field itself is held rather than copied, so ground the player raises this frame is ground
   * the next event resolves on.
   */
  readonly terrain?: TerrainOption;

  /**
   * Where a keyboard action points.
   *
   * Write the screen point of the current selection into `out` and return `true`; return
   * `false` and the viewport center is used. This is the seam between "the player pressed
   * Space" and "at what", and a game that leaves it unimplemented is still playable — it just
   * collects from the middle.
   */
  readonly focus?: (out: Vec2) => boolean;

  /**
   * Where problems this package can detect go. Default: `console.warn`.
   *
   * **At most once per code per system**, whichever sink is used. Each of these has a
   * legitimate cause as well as a broken one, and a diagnostic that repeats sixty times a
   * second is one nobody reads.
   */
  readonly onDiagnostic?: DiagnosticSink;
}

/**
 * A recognizer, an action map and a camera controller over one camera.
 *
 * Obtained from `createHeadlessInput` or from `createInput`. It **is** an {@link InputScope}:
 * the root of the teardown tree, so `input.dispose()` is the only call a scene needs.
 */
export interface InputSystem<A extends string = never> extends InputScope<A> {
  /** The gestures-to-camera policy. `iso` owns where the camera may be; this owns where the
   *  player is trying to put it. */
  readonly camera: CameraController;
  /**
   * The thresholds in force **right now**, defaults filled in and every override validated.
   *
   * A live read, not the object handed to the constructor: after {@link setProfile} this is the
   * new one. Frozen, so a game that wants a different threshold changes it through `setProfile`
   * rather than by writing to a shared object three other things are reading.
   */
  readonly profile: Readonly<GestureProfile>;

  /**
   * Replace every threshold, and keep every handler.
   *
   * ```ts
   * input.setProfile({ tapSlopPx: { touch: 14 } }); //  handlers, scopes and camera all survive
   * ```
   *
   * **A full replacement of the override set, resolved against the defaults exactly as
   * construction does — not a patch onto the profile in force.** `setProfile({})` therefore
   * returns to the defaults, and a game that keeps its overrides in one object and re-passes it
   * gets a profile that depends only on that object and not on the order the sliders were moved.
   * A patching version would make the thresholds path-dependent, and a path-dependent value is
   * one a recorded log's fingerprint cannot be reasoned about.
   *
   * The recognizer is rebuilt behind the seam — its tick counts, its velocity rings and its
   * pointer slots are all sized from the profile — but the buffer's slot pool, the camera
   * controller, every handler, every child scope and the DOM binding are the same objects
   * afterwards. That is what makes this cheap enough to put behind a slider: retuning one
   * threshold used to mean dispose, recreate and re-register every handler.
   *
   * **Every live gesture ends first**, under the *old* thresholds: each drag gets its `dragend`
   * and each held key its release, exactly as `dispose` does it, for the same reason — a
   * recognizer replaced mid-drag is a placement ghost stuck to the cursor and a camera that pans
   * for ever.
   *
   * @returns the resolved profile, so a HUD can show what it actually got rather than what it
   *   asked for — the two differ wherever a default filled in.
   * @throws RangeError if any override is out of range, **before anything changes**; if called
   *   from inside a handler, because the bucket being delivered was recognized under the old
   *   thresholds and the samples behind it would meet a recognizer that never saw their press;
   *   if a recording is running, because the profile fingerprint is a third of a log's identity
   *   and a log that changed rules half way through describes no session that can be replayed;
   *   or if the system has been disposed.
   */
  setProfile(overrides: ProfileOverrides | undefined): Readonly<GestureProfile>;

  /**
   * Rebind every action, and keep every handler.
   *
   * ```ts
   * input.setActions({ collect: ['tap', 'key:Space'], build: ['key:KeyN'] }); // was KeyB
   * ```
   *
   * **A full replacement of the map, compiled exactly as construction compiles it** — the same
   * validator, the same errors, the same `unknown-key-code` diagnostic. A binding an action had
   * and this map does not name is gone; there is no patch form, for `setProfile`'s reason.
   *
   * ## The names are identity; only the bindings move
   *
   * Passing a map whose names are not exactly the declared ones throws. `A` was inferred from
   * the constructor's map and has already been handed out — every `onAction` handler is keyed to
   * one of those names, `actionNames` has been read into a shortcut sheet, and the type of this
   * very argument is derived from it. A name that appeared would have no handler list and no way
   * to acquire one; a name that vanished would take a live handler with it and look, from the
   * game's side, exactly like a handler that stopped being called. Adding an action is a new
   * system. Which *key* produces `build` is the thing a settings screen moves, and that is what
   * this method is for.
   *
   * Unlike {@link setProfile} this ends nothing first, because an action map holds no live
   * state: actions fire on the press edge, so every press that has already fired has already
   * been delivered under the map that was in force when it fired. {@link held} is answered
   * through the *new* map from the next call onward, which is the honest reading of "is the key
   * bound to `build` down".
   *
   * @throws RangeError if a binding is malformed, if the map names an action that was not
   *   declared or omits one that was — **before anything changes**; if called from inside a
   *   handler, because half of the bucket being delivered would dispatch through each map; if a
   *   recording is running; or if the system has been disposed.
   *
   *   The recording refusal is the one worth reading twice, because the reason is *not*
   *   `setProfile`'s. A log stores {@link RawSample}s, and `actions` is **not** in the
   *   compatibility triple — so a mid-recording rebind changes nothing about what the log says
   *   and everything about what a replay of it *does*, behind a triple that still matches
   *   exactly. `setProfile` refuses to keep the log's declared identity true; this refuses
   *   because there is no declared identity here to keep true, and the alternative is a
   *   divergence report that is confidently wrong. See `docs/rfc/live-options.md` §6b.
   */
  setActions(actions: ActionMap<A>): void;

  /**
   * The ground in force **right now**, exactly as it was declared, or `undefined` if it never
   * was.
   *
   * A live read, not the object handed to the constructor: after {@link setTerrain} this is the
   * new one. It is the same object the caller passed — not a copy — so a HUD that wants to show
   * the march ceiling reads it here instead of keeping a second copy that drifts.
   */
  readonly terrain: TerrainOption | undefined;

  /**
   * Declare the ground, or change it. Keeps every handler, every scope and the camera.
   *
   * ```ts
   * input.setTerrain({ field: hill, maxHeightPx: hill.tallestPx }); // after the map generated
   * input.setTerrain('flat');                                       // the tunnel level
   * ```
   *
   * Settable rather than baked, and the readback rule's three questions are why. **Identity:**
   * nothing allocated or handed out depends on it — every coordinate is resolved from the
   * pointer at the moment it is read, so there is no derived value to invalidate. **Record:** a
   * log stores {@link RawSample}s, which are screen pixels; `gx`/`gy` have never been in one, any
   * more than the camera position they equally depend on is, so no recording is made invalid by
   * this. **Cost:** what the hot path reads is the field itself, which is exactly what a game
   * with deformable ground needs to be live.
   *
   * The march ceiling moving under a slider is the case that settled it — `examples/terraces`
   * ships that slider — and a game whose map is generated after its input system is bound is the
   * case that made it necessary at all.
   *
   * **It does not bump the epoch {@link setProfile} and {@link setActions} bump**, and a recording
   * does not refuse it. Those two replace *recognition and dispatch* rules, which a log's samples
   * were produced under; this replaces the surface a coordinate is measured against, which is
   * game state and moves during ordinary play — `examples/clay` deforms it every frame. A cursor
   * that refused here would refuse every session in which a player dug a hole.
   *
   * @throws TypeError / RangeError for a malformed declaration, naming the field that is wrong,
   *   **before anything changes**; RangeError if called from inside a handler, because half of
   *   the bucket being delivered would then have resolved on a different surface from the other
   *   half; or if the system has been disposed.
   */
  setTerrain(terrain: TerrainOption): void;

  /** The fixed step every duration is counted in. Fixed for the life of the system: changing it
   *  would re-time every gesture and invalidate every log, which is a new system, not a knob. */
  readonly stepMs: number;

  /** Every declared action, in declaration order. A live read: after {@link setActions} the
   *  order is the new map's, and the set is necessarily the same one. */
  readonly actionNames: readonly A[];

  /**
   * What is bound to an action **right now**.
   *
   * Exists so a keyboard-shortcut sheet is rendered *from* the map rather than transcribed
   * beside it — and so that a sheet re-rendered after {@link setActions} shows the new keys
   * without the game keeping a second copy of the map to read them from.
   *
   * @throws RangeError naming an action that was never declared.
   */
  bindings(action: A): readonly ActionBinding[];

  /**
   * Close the sample buffer and deliver everything in it as simulation tick `index`.
   *
   * **The only place handlers run.** Call it once per fixed step, before the game's own update.
   * A pump with no ticks loses nothing; a pump with five delivers the backlog to the first and
   * leaves the other four empty, which is correct — they are catch-up for time that already
   * passed, and a tap did not happen five times.
   *
   * @throws RangeError if `index` is not an integer, or is not greater than the previous one.
   *   A repeated index makes the log ambiguous — two buckets under one key — and a regression
   *   makes it unreplayable, and both are silent until a replay reports a confident wrong
   *   answer months later.
   */
  tick(index: number): void;

  /**
   * Advance the view: the camera's glide, and nothing else.
   *
   * Called once per rendered frame, before drawing. **Delivers nothing and calls no handler.**
   *
   * @throws RangeError if `nowMs` is not finite. A `NaN` here propagates into the camera and
   *   the screen goes blank a hundred frames from the mistake.
   */
  frame(nowMs: number): void;

  /**
   * Feed the recognizer directly. The DOM binding is a producer of these and nothing more.
   *
   * The sample is copied, so a producer may reuse one object for every event it makes.
   *
   * @throws RangeError for a `tick` sample — `tick(index)` produces those, and one submitted by
   *   hand would put a marker in the log at a position no tick closed — or for a coordinate
   *   that is not a finite number.
   */
  submit(sample: RawSample): void;

  /** Is any binding of this action currently held? Continuous input is a query, not a stream. */
  held(action: A): boolean;

  /** Escape hatch for a key with no action, e.g. a debug overlay. `KeyboardEvent.code`. */
  keyHeld(code: string): boolean;

  /**
   * The tile under the pointer, for a hover highlight.
   *
   * A **query**, answered from the newest position submitted and through the **live** camera —
   * so a ghost following a finger is smooth at display rate even when ticks are slow. Querying
   * is safe outside a tick precisely because it cannot mutate simulation state.
   *
   * Returns `false` when there is no pointer over the world — which is every touch device,
   * always, between taps. A control that only appears on hover does not exist on a phone; this
   * signature exists to make that impossible to forget.
   *
   * On a system with {@link HeadlessInputOptions.terrain} it also returns `false` when the
   * pointer is over the sky or past the edge of the field, and leaves `out` untouched: a ghost
   * with nowhere to stand should not be drawn on the shore instead.
   */
  hoverTile(out: GridPoint): boolean;

  /** The pointer's screen position, same contract as {@link hoverTile}. */
  pointerScreen(out: Vec2): boolean;

  /** Samples waiting for the next tick. A number a stall diagnostic can watch. */
  readonly buffered: number;
}

/**
 * The parts of a system only `record` and `replay` may touch.
 *
 * Reached through a `WeakMap` rather than a property, so nothing here appears on the public
 * object: a recorder is a debugging and verification tool, and a game that can start one by
 * accident will eventually ship one that never stops.
 */
export interface SystemInternals {
  readonly stepMs: number;
  /** The canonical encoding of the profile **in force**, for a log's compatibility triple. Read
   *  at the moment a log is sealed, so a system retuned by `setProfile` seals the truth. */
  readonly fingerprint: string;
  /**
   * How many times this system's recognition or dispatch rules have been replaced.
   *
   * Incremented by `setProfile` and by `setActions`, and read by `replayCursor` — which is the
   * one caller that verifies a log's compatibility **once** and then hands control back to a
   * driver between every tick. A recording is protected by both setters refusing while one is
   * open; a *cursor* cannot be protected that way, because nothing tells the system when a
   * driver has finished with one. So the cursor remembers the number it opened under and refuses
   * the first `applyAt` that finds it changed, which is the same refusal one tick later than a
   * setter would have made it.
   *
   * An integer rather than a re-comparison of the fingerprint because `actions` is not in the
   * fingerprint — and it is the half of this that a triple comparison could never have caught.
   */
  readonly epoch: number;
  /**
   * The system's own diagnostic sink, deduplicated per code.
   *
   * Shared with the DOM adapter so that "at most once per code" is a property of the system and
   * not of each producer — an overlay diagnostic raised on every pointerdown is one nobody
   * reads, and the second producer is exactly where that rule gets forgotten.
   */
  readonly diagnose: DiagnosticSink;
  /** @throws RangeError if a recording is already running on this system. */
  start(): void;
  /** The samples recorded since `start`, in arrival order. Stops the recording. */
  stop(): RawSample[];
}

const INTERNALS = new WeakMap<object, SystemInternals>();

/**
 * The recording hooks of a system built by this package.
 *
 * @throws TypeError for anything this package did not build. A structural duck-type would be
 *   worse: `record` would silently record nothing and hand back an empty log that replays
 *   green.
 */
export function internalsOf(system: object): SystemInternals {
  const found = INTERNALS.get(system);
  if (found === undefined) {
    throw new TypeError(
      'record/replay: expected an InputSystem from createInput or createHeadlessInput',
    );
  }
  return found;
}

/**
 * Build a system with no DOM at all, fed only by {@link InputSystem.submit}.
 *
 * This is how the package is tested and how a replay runs in Node.
 *
 * @throws RangeError if `step` describes no coherent step, if a profile override is out of
 *   range, or if an action binding is malformed.
 * @throws TypeError if `camera` is missing, or if `step` is not the loop or a `fixedStep(hz)`.
 */
export function createHeadlessInput<A extends string = never>(
  options: HeadlessInputOptions<A>,
): InputSystem<A> {
  return createSystem(options, 'createHeadlessInput');
}

/**
 * The shared constructor. `createInput` calls it too, then binds a DOM adapter onto the result.
 *
 * @param label The caller's name, so every error message names the function the game called
 *   rather than this one.
 */
export function createSystem<A extends string>(
  options: HeadlessInputOptions<A>,
  label: string,
): InputSystem<A> {
  const camera = options.camera;
  if (camera === null || typeof camera !== 'object' || typeof camera.toWorldX !== 'function') {
    throw new TypeError(
      `${label}.camera: expected an @latticekit/iso Camera — every coordinate this package reports is resolved through it, so there is no useful default`,
    );
  }
  const stepMs = resolveStep(options.step, `${label}.step`);

  /** Diagnostics, at most once per code. See {@link HeadlessInputOptions.onDiagnostic}. */
  const reported = new Set<DiagnosticCode>();
  const sink = options.onDiagnostic;
  const diagnose: DiagnosticSink = (diagnostic: Diagnostic): void => {
    if (reported.has(diagnostic.code)) return;
    reported.add(diagnostic.code);
    if (sink !== undefined) {
      sink(diagnostic);
      return;
    }
    console.warn(`[@latticekit/input] ${diagnostic.code}: ${diagnostic.message}`);
  };

  // Mutable, because `setProfile` replaces them together. Every reader goes through these two
  // names rather than capturing a copy, so there is exactly one place the thresholds in force
  // are recorded and no second copy that can lag behind a retune.
  let profile = resolveProfile(options.profile, `${label}.profile`);
  let fingerprint = profileFingerprint(profile);
  // `let`, and every reader names it: `setActions` replaces it, and a reader that captured the
  // compiled object would dispatch through a map the game has already replaced — which is the
  // stale-local loophole the readback rule's third invariant exists to close.
  let actions: CompiledActions<A> = compileActions(options.actions, `${label}.actions`, diagnose);
  /** See {@link SystemInternals.epoch}. Bumped by `setProfile` and `setActions`, read by a replay. */
  let epoch = 0;

  const owner: Scope = createScope();
  const gestures: GestureLists = createGestureLists();
  const actionLists = new Map<string, HandlerList<AnyActionHandler>>();
  for (const name of actions.names) actionLists.set(name, new HandlerList<AnyActionHandler>());

  // One picker for the whole system, shared by every event object and by `hoverTile`, so a tap
  // and the ghost that was following the finger cannot resolve on two different surfaces.
  const picker = new TilePicker(diagnose);
  if (options.terrain !== undefined) {
    checkTerrain(options.terrain, `${label}.terrain`);
    picker.set(options.terrain);
  }

  const frame = new TickFrame();
  const tapEvent = new TapGestureEvent(picker);
  const dragEvent = new DragGestureEvent(picker);
  const zoomEvent = new ZoomGestureEvent(picker);
  const actionEvent = new ActionEventImpl(picker);
  const focusPoint: Vec2 = { x: 0, y: 0 };
  /** Scratch for normalizing a submitted sample into a log entry. Only used while recording. */
  const recordScratch = createSampleSlot();

  let currentTick = 0;
  let lastTick: number | undefined;
  let lastNowMs: number | undefined;
  let disposed = false;
  let scopeOrder = 0;
  /**
   * True while handlers are running: inside a tick's delivery, and inside `setProfile`'s own
   * release of live gestures.
   *
   * The only thing that reads it is `setProfile`, and it exists because swapping the recognizer
   * half way through a bucket would feed the samples behind the current one to a machine that
   * never saw their press — a `move` with no `down`, which the recognizer is entitled to ignore.
   */
  let delivering = false;

  let recording: RawSample[] | undefined;

  const buffer = new SampleBuffer(profile.maxBufferedSamples, () => {
    diagnose({
      code: 'buffer-overflow',
      message: `${String(profile.maxBufferedSamples)} samples are waiting for a tick that has not come. Moves are being collapsed to the newest per pointer; no press, release or key has been dropped. A loop that has stopped ticking is the usual cause.`,
    });
  });

  const control: CameraControl = createCameraControl({
    camera,
    keyPanPxPerS: profile.keyPanPxPerS,
    flingMinPxPerS: profile.flingMinPxPerS,
    flingHalfLifeMs: profile.flingHalfLifeMs,
    keyHeld: (code: string): boolean => recognizer.isKeyHeld(code),
    enabled: options.control ?? true,
  });

  // ── hover: the newest position anything has submitted, answered at display rate ──────────
  let hoverActive = false;
  let hoverSx = 0;
  let hoverSy = 0;
  let hoverId = -1;
  /** A touch cannot hover: when its press ends the pointer is gone. A mouse is still there. */
  let hoverIsTouch = false;

  /**
   * The two refusals `setProfile` and `setActions` share, in one function and one voice.
   *
   * The third — *a recording is running* — is deliberately **not** here. The two setters refuse a
   * recording for genuinely different reasons: `setProfile` because the fingerprint it would move
   * is a third of the log's declared identity, and `setActions` because what it moves is in no
   * part of that identity at all. Folding them together would hide exactly the distinction that
   * makes the second refusal necessary, so each states its own.
   *
   * @param fn The method the game called, so the message never names this helper.
   * @param mid Why a mid-bucket call is wrong for *this* setter, as one sentence.
   */
  function guardLive(fn: string, mid: string): void {
    if (disposed) {
      throw new RangeError(
        `${fn}: this system has been disposed — nothing feeds the recognizer and nothing drives the camera, so this would store a value no path reads and appear to have worked`,
      );
    }
    if (delivering) {
      throw new RangeError(`${fn}: called from inside a handler. ${mid} Call it after the tick returns.`);
    }
  }

  /** Dispatch one gesture to its handlers, then to the camera, honoring `claim`. */
  function deliverGesture(out: GestureOut): void {
    switch (out.type) {
      case 'tap':
      case 'longpress': {
        tapEvent.type = out.type;
        tapEvent.pointerType = out.pointerType;
        tapEvent.heldMs = out.heldMs;
        tapEvent.claimed = false;
        tapEvent.place(frame, currentTick, out.sx, out.sy);
        walk(gestures[out.type], tapEvent);
        if (tapEvent.claimed) return;
        fireActions(actions.forGesture(out.type), 'pointer', out.sx, out.sy);
        return;
      }
      case 'dragstart':
      case 'drag':
      case 'dragend': {
        dragEvent.type = out.type;
        dragEvent.pointerType = out.pointerType;
        dragEvent.dx = out.dx;
        dragEvent.dy = out.dy;
        dragEvent.vx = out.vx;
        dragEvent.vy = out.vy;
        dragEvent.claimed = false;
        dragEvent.place(frame, currentTick, out.sx, out.sy);
        walk(gestures[out.type], dragEvent);
        if (dragEvent.claimed || !control.enabled) return;
        if (out.type === 'dragstart') control.stop();
        else if (out.type === 'drag') control.panBy(out.dx, out.dy);
        else control.fling(out.vx, out.vy);
        return;
      }
      default: {
        zoomEvent.pointerType = out.pointerType;
        zoomEvent.scale = out.scale;
        zoomEvent.source = out.source;
        zoomEvent.dx = out.dx;
        zoomEvent.dy = out.dy;
        zoomEvent.claimed = false;
        zoomEvent.place(frame, currentTick, out.sx, out.sy);
        walk(gestures.zoom, zoomEvent);
        if (zoomEvent.claimed || !control.enabled) return;
        // Pan first, then zoom about the anchor: a two-finger gesture pans and zooms at once,
        // and anchoring after the pan is what keeps the midpoint under the fingers.
        if (out.dx !== 0 || out.dy !== 0) control.panBy(out.dx, out.dy);
        if (out.scale !== 1) control.zoomBy(out.scale, out.sx, out.sy);
      }
    }
  }

  /** One handler list, in order, stopping at the first `claim()`. Allocates nothing. */
  function walk<E extends { readonly claimed: boolean }>(
    list: HandlerList<(event: E) => void>,
    event: E,
  ): void {
    list.begin();
    for (let i = 0; i < list.count; i++) {
      const handler = list.at(i);
      if (handler === undefined) continue;
      handler(event);
      if (event.claimed) break;
    }
    list.end();
  }

  /** Fire every action bound to a source, in declaration order. */
  function fireActions(
    entries: readonly ActionEntry<A>[],
    source: 'pointer' | 'key',
    sx: number,
    sy: number,
  ): void {
    for (const entry of entries) {
      // Through the same lookup `onAction` uses, so an action that can fire and an action that
      // can be subscribed to are the same set by construction rather than by two maps agreeing.
      const list = host.actionList(entry.action);
      actionEvent.action = entry.action;
      actionEvent.source = source;
      actionEvent.binding = entry.binding;
      actionEvent.claimed = false;
      actionEvent.place(frame, currentTick, sx, sy);
      walk(list, actionEvent);
    }
  }

  /** A key edge. Only the press fires an action; the release exists to keep `held` honest. */
  function onKey(code: string, down: boolean): void {
    if (!down) return;
    const entries = actions.forKey(code);
    if (entries.length === 0) return;
    // A positionless source still has to answer "where". The game's current selection if it has
    // one, the viewport center if it does not — never nothing, or the keyboard path does
    // something different from the touch path and the keyboard path is the one nobody tests.
    const focus = options.focus;
    let sx = frame.w / 2;
    let sy = frame.h / 2;
    if (focus !== undefined && focus(focusPoint)) {
      sx = focusPoint.x;
      sy = focusPoint.y;
    }
    fireActions(entries, 'key', sx, sy);
  }

  // `let`, and every reader names it rather than closing over the value: `setProfile` replaces
  // the recognizer, and the camera controller's `keyHeld` bridge below would otherwise keep
  // asking the retired one which keys are down.
  let recognizer: Recognizer = createRecognizer({
    profile,
    stepMs,
    emit: deliverGesture,
    onKey,
  });

  const host: ScopeHost<A> = {
    gestures,
    actionList(action: A): HandlerList<AnyActionHandler> {
      const list = actionLists.get(action);
      if (list === undefined) throw undeclared('input.onAction', String(action), actions.names);
      return list;
    },
    nextScopeOrder(): number {
      scopeOrder += 1;
      return scopeOrder;
    },
  };

  const root = createInputScope<A>(host, owner, 0);

  /** Track the newest pointer position for {@link hoverTile}, before any tick has seen it. */
  function trackHover(sample: RawSample): void {
    switch (sample.kind) {
      case 'down':
        hoverActive = true;
        hoverSx = sample.sx;
        hoverSy = sample.sy;
        hoverId = sample.id;
        hoverIsTouch = sample.pointerType === 'touch';
        return;
      case 'move':
        hoverActive = true;
        hoverSx = sample.sx;
        hoverSy = sample.sy;
        if (sample.id !== hoverId) {
          // A move with no press before it is a mouse or a pen hovering; a finger cannot.
          hoverId = sample.id;
          hoverIsTouch = false;
        }
        return;
      case 'up':
        hoverSx = sample.sx;
        hoverSy = sample.sy;
        if (sample.id === hoverId && hoverIsTouch) hoverActive = false;
        return;
      case 'cancel':
        if (sample.id === hoverId && hoverIsTouch) hoverActive = false;
        return;
      case 'blur':
        hoverActive = false;
        return;
      default:
        return;
    }
  }

  const system: InputSystem<A> = {
    scope: root.scope,
    on: root.on,
    onAction: root.onAction,
    own: root.own,

    get disposed(): boolean {
      return disposed;
    },

    camera: control,

    get profile(): Readonly<GestureProfile> {
      return profile;
    },

    setProfile(overrides: ProfileOverrides | undefined): Readonly<GestureProfile> {
      guardLive(
        'input.setProfile',
        'The bucket being delivered was recognized under the thresholds in force when the tick opened, and the samples behind this one would meet a recognizer that never saw their press.',
      );
      if (recording !== undefined) {
        throw new RangeError(
          'input.setProfile: a recording is running, and the profile fingerprint is one third of a log\'s identity — a log whose rules changed half way through describes no session that can be replayed. Stop the recording, retune, and start a new one.',
        );
      }
      // Resolved and validated *before* anything is touched, so a rejected override leaves the
      // system exactly as it was rather than half-retuned.
      const next = resolveProfile(overrides, 'input.setProfile');

      delivering = true;
      try {
        // Under the OLD thresholds, and for the reason `dispose` does it: a drag whose `dragend`
        // never arrives is a placement ghost stuck to the cursor, and a key the recognizer still
        // believes is held is a camera that pans for ever.
        frame.capture(camera);
        recognizer.releaseAll();
      } finally {
        delivering = false;
      }

      profile = next;
      fingerprint = profileFingerprint(next);
      buffer.retune(next.maxBufferedSamples);
      control.retune(next.keyPanPxPerS, next.flingMinPxPerS, next.flingHalfLifeMs);
      // Rebuilt rather than retuned: its long-press tick count, its velocity ring sizes and its
      // pointer slots are all *sized* from the profile, and a machine that resized itself while
      // holding live state would be a second state machine to get right for no gain. It is one
      // small allocation on a call a game makes when someone moves a slider.
      recognizer = createRecognizer({ profile: next, stepMs, emit: deliverGesture, onKey });
      epoch += 1;
      return next;
    },

    setActions(next: ActionMap<A>): void {
      guardLive(
        'input.setActions',
        'The bucket being delivered is half dispatched, and the presses behind this one would fire through a map their gesture was not recognized under.',
      );
      if (recording !== undefined) {
        // The K20 refusal, and its reason is not `setProfile`'s. A log stores `RawSample`s, and
        // `actions` is not in the compatibility triple — so this changes nothing about what the
        // log *says* and everything about what a replay of it *does*, behind a triple that still
        // matches. The alternative was to put `actions` in the triple, which would make every log
        // ever recorded unreplayable after any rebind. See `docs/rfc/live-options.md` §6b.
        throw new RangeError(
          'input.setActions: a recording is running. A log records samples, not actions, and the bindings are not in the compatibility triple — so a rebind here leaves a log that replays without complaint and fires different actions than the session it came from. Stop the recording, rebind, and start a new one.',
        );
      }
      // Compiled *before* anything is touched, and the name check reads the compiled result, so a
      // map with both a bad binding and a missing action reports the binding — the mistake nearest
      // the caller's keyboard — and the system is left exactly as it was either way.
      const compiled = compileActions(next, 'input.setActions', diagnose);
      for (const name of compiled.names) {
        if (actionLists.has(name)) continue;
        throw new RangeError(
          `input.setActions: '${String(name)}' was not declared when this system was built, and an action's name is its identity — every onAction handler is keyed to a declared one and there is no list for this to reach. Rebinding is this method; adding an action is a new system. Declared: ${nameList(actions.names)}`,
        );
      }
      if (compiled.names.length !== actions.names.length) {
        throw new RangeError(
          `input.setActions: this map declares ${String(compiled.names.length)} of this system's ${String(actions.names.length)} actions. An action it leaves out keeps its handlers and loses every way to fire them, which reads exactly like a handler that quietly stopped being called. Pass every one. Declared: ${nameList(actions.names)}`,
        );
      }
      actions = compiled;
      epoch += 1;
    },

    get terrain(): TerrainOption | undefined {
      return picker.declared;
    },

    setTerrain(next: TerrainOption): void {
      guardLive(
        'input.setTerrain',
        'The bucket being delivered is half resolved, and the events behind this one would answer against a different surface from the ones already handled.',
      );
      // Validated *before* anything is touched, so a rejected declaration leaves the system
      // resolving exactly where it was rather than on half a heightfield.
      checkTerrain(next, 'input.setTerrain');
      picker.set(next);
    },

    stepMs,

    get actionNames(): readonly A[] {
      return actions.names;
    },

    bindings(action: A): readonly ActionBinding[] {
      return actions.bindings(action);
    },

    get buffered(): number {
      return buffer.buffered;
    },

    submit(sample: RawSample): void {
      if (disposed) return;
      if (sample === null || typeof sample !== 'object') {
        throw new TypeError(`input.submit: expected a RawSample object, got ${String(sample)}`);
      }
      if (sample.kind === 'tick') {
        throw new RangeError(
          'input.submit: a tick sample is a marker the log gets from input.tick(index); submitting one by hand would put a marker at a position no tick closed',
        );
      }
      guardCoordinates(sample);
      trackHover(sample);
      if (recording !== undefined) {
        writeSlot(recordScratch, sample);
        recording.push(toRawSample(recordScratch));
      }
      buffer.push(sample);
    },

    tick(index: number): void {
      if (disposed) return;
      expectInt(index, 'input.tick');
      if (lastTick !== undefined && index <= lastTick) {
        throw new RangeError(
          `input.tick: expected an index greater than the previous ${String(lastTick)}, got ${String(index)} — the tick index is the log's only time axis, so a repeat makes two buckets share one key and a regression makes the log unreplayable`,
        );
      }
      lastTick = index;
      currentTick = index;
      if (recording !== undefined) recording.push({ kind: 'tick', index });

      // Freeze the camera *before* anything is delivered. A handler that recenters the camera
      // must not change where a later event in this same bucket resolved to.
      frame.capture(camera);
      recognizer.setView(camera.viewW, camera.viewH);

      const closed = buffer.close();
      delivering = true;
      try {
        for (let i = 0; i < closed.count; i++) {
          const slot = closed.slots[i];
          if (slot === undefined) continue;
          recognizer.feed(slot, index);
        }
        // After the bucket, so a press released this tick is a tap rather than a hold that
        // matured a moment before the release arrived.
        recognizer.mature(index);
      } finally {
        // `finally`, so a handler that throws does not leave the system permanently refusing to
        // retune — the throw is the game's bug to fix and it should not acquire a second symptom.
        delivering = false;
      }
    },

    frame(nowMs: number): void {
      if (disposed) return;
      if (!Number.isFinite(nowMs)) {
        throw new RangeError(
          `input.frame: expected a finite number of milliseconds, got ${String(nowMs)}`,
        );
      }
      const dt = lastNowMs === undefined ? 0 : nowMs - lastNowMs;
      lastNowMs = nowMs;
      control.integrate(dt);
    },

    held(action: A): boolean {
      return actions.held(action, recognizer.pressed, recognizer.isKeyHeld);
    },

    keyHeld(code: string): boolean {
      return recognizer.isKeyHeld(code);
    },

    hoverTile(out: GridPoint): boolean {
      if (!hoverActive) return false;
      // The **live** camera, not the frozen one: a hover highlight is a view, and a ghost that
      // lags a slow tick behind the finger is the thing this query exists to prevent.
      //
      // Through the same picker every event uses, so a highlight and the tap that follows it
      // cannot disagree — and `false` now also means "the pointer is over the sky", which is the
      // honest answer for a ghost that has nowhere to stand.
      return picker.resolve(camera.toWorldX(hoverSx), camera.toWorldY(hoverSy), out);
    },

    pointerScreen(out: Vec2): boolean {
      if (!hoverActive) return false;
      out.x = hoverSx;
      out.y = hoverSy;
      return true;
    },

    dispose(): void {
      if (disposed) return;
      // The one place a gesture is delivered outside a tick, and it is not an exception to the
      // rule so much as the last act of the tick that was running: every live drag gets its
      // `dragend` and every held key its release **before** the handlers are torn down, because
      // a recognizer left latched is a camera that pans for ever and a handler that never
      // learns the drag ended is a placement ghost stuck to the cursor.
      frame.capture(camera);
      recognizer.releaseAll();
      control.stop();
      disposed = true;
      owner.dispose();
    },
  };

  INTERNALS.set(system, {
    stepMs,
    // A getter, so `createLog` and `record().stop()` seal the profile in force rather than the
    // one the system was born with. A recording cannot span a retune — `setProfile` refuses
    // while one is running — so this can never disagree with the samples it is sealed beside.
    get fingerprint(): string {
      return fingerprint;
    },
    // A getter for the same reason, and read by `replayCursor` on every tick rather than once.
    get epoch(): number {
      return epoch;
    },
    diagnose,
    start(): void {
      if (recording !== undefined) {
        throw new RangeError(
          'record: this system is already recording — two recorders sharing one sample stream produce two logs that each claim to be the whole session',
        );
      }
      recording = [];
    },
    stop(): RawSample[] {
      const taken = recording ?? [];
      recording = undefined;
      return taken;
    },
  });

  return system;
}

/** Reject a coordinate that would poison the camera, at the line that produced it. */
function guardCoordinates(sample: RawSample): void {
  if (
    sample.kind === 'cancel' ||
    sample.kind === 'key' ||
    sample.kind === 'blur' ||
    sample.kind === 'tick'
  ) {
    return;
  }
  if (!Number.isFinite(sample.sx) || !Number.isFinite(sample.sy)) {
    throw new RangeError(
      `input.submit: expected finite sx/sy on a ${sample.kind} sample, got ${String(sample.sx)}, ${String(sample.sy)} — a NaN here reaches the camera and the screen goes blank a hundred frames from the mistake`,
    );
  }
  if (sample.kind === 'wheel' && !Number.isFinite(sample.dz)) {
    throw new RangeError(
      `input.submit: expected a finite dz on a wheel sample, got ${String(sample.dz)}`,
    );
  }
}
