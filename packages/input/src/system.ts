/**
 * The system: the buffer, the recogniser, the action map and the camera controller, wired.
 *
 * **Nothing in this file names a browser global.** It is the same recogniser a game runs, fed
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
 */

import { createScope, expectInt } from '@lattice/core';
import type { Scope, Vec2 } from '@lattice/core';
import { screenToTile } from '@lattice/iso';
import type { Camera, GridPoint } from '@lattice/iso';
import { compileActions } from './actions.js';
import type { ActionBinding, ActionEntry, ActionMap, CompiledActions } from './actions.js';
import { createCameraControl } from './cameracontrol.js';
import type { CameraControl, CameraController } from './cameracontrol.js';
import {
  ActionEventImpl,
  DragGestureEvent,
  TapGestureEvent,
  TickFrame,
  ZoomGestureEvent,
  fill,
} from './events.js';
import type { AnyActionHandler } from './events.js';
import { profileFingerprint, resolveProfile } from './profile.js';
import type { GestureProfile, ProfileOverrides } from './profile.js';
import { createRecogniser } from './recognise.js';
import type { GestureOut, Recogniser } from './recognise.js';
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
   * The loop's fixed step, in milliseconds. **Must be the same number the loop uses.**
   *
   * The recogniser counts ticks and multiplies by this; it never reads a clock. Get it wrong
   * and every duration in the profile is wrong by the same ratio — so pass `loop.stepMs` rather
   * than a literal.
   */
  readonly stepMs: number;

  /**
   * The action map, as data.
   *
   * The names are inferred from this object, so `onAction`, `held` and `bindings` accept only
   * names that exist. This object is also the single source of truth for a shortcut sheet.
   */
  readonly actions?: ActionMap<A>;

  /** Override any threshold in the profile. Everything not named keeps its default. */
  readonly profile?: ProfileOverrides;

  /** Set `false` for a game whose camera is fixed. The gestures still arrive. */
  readonly control?: boolean;

  /**
   * Where a keyboard action points.
   *
   * Write the screen point of the current selection into `out` and return `true`; return
   * `false` and the viewport centre is used. This is the seam between "the player pressed
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
 * A recogniser, an action map and a camera controller over one camera.
 *
 * Obtained from `createHeadlessInput` or from `createInput`. It **is** an {@link InputScope}:
 * the root of the teardown tree, so `input.dispose()` is the only call a scene needs.
 */
export interface InputSystem<A extends string = never> extends InputScope<A> {
  /** The gestures-to-camera policy. `iso` owns where the camera may be; this owns where the
   *  player is trying to put it. */
  readonly camera: CameraController;
  /** The thresholds in force, defaults filled in and every override validated. */
  readonly profile: Readonly<GestureProfile>;
  /** The fixed step every duration is counted in. */
  readonly stepMs: number;

  /** Every declared action, in declaration order. */
  readonly actionNames: readonly A[];

  /**
   * What is bound to an action.
   *
   * Exists so a keyboard-shortcut sheet is rendered *from* the map rather than transcribed
   * beside it.
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
   * Feed the recogniser directly. The DOM binding is a producer of these and nothing more.
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
  /** The profile's canonical encoding, for a log's compatibility triple. */
  readonly fingerprint: string;
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
 * @throws RangeError if `stepMs` is not a finite number greater than zero, if a profile
 *   override is out of range, or if an action binding is malformed.
 * @throws TypeError if `camera` is missing.
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
      `${label}.camera: expected an @lattice/iso Camera — every coordinate this package reports is resolved through it, so there is no useful default`,
    );
  }
  const stepMs = options.stepMs;
  if (!(Number.isFinite(stepMs) && stepMs > 0)) {
    throw new RangeError(
      `${label}.stepMs: expected a finite number > 0, got ${String(stepMs)} — pass loop.stepMs rather than a literal, or every gesture duration is wrong by the same ratio`,
    );
  }

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
    console.warn(`[@lattice/input] ${diagnostic.code}: ${diagnostic.message}`);
  };

  const profile = resolveProfile(options.profile, `${label}.profile`);
  const fingerprint = profileFingerprint(profile);
  const actions: CompiledActions<A> = compileActions(options.actions, `${label}.actions`, diagnose);

  const owner: Scope = createScope();
  const gestures: GestureLists = createGestureLists();
  const actionLists = new Map<string, HandlerList<AnyActionHandler>>();
  for (const name of actions.names) actionLists.set(name, new HandlerList<AnyActionHandler>());

  const frame = new TickFrame();
  const tapEvent = new TapGestureEvent();
  const dragEvent = new DragGestureEvent();
  const zoomEvent = new ZoomGestureEvent();
  const actionEvent = new ActionEventImpl();
  const focusPoint: Vec2 = { x: 0, y: 0 };
  /** Scratch for normalising a submitted sample into a log entry. Only used while recording. */
  const recordScratch = createSampleSlot();

  let currentTick = 0;
  let lastTick: number | undefined;
  let lastNowMs: number | undefined;
  let disposed = false;
  let scopeOrder = 0;

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
    keyHeld: (code: string): boolean => recogniser.isKeyHeld(code),
    enabled: options.control ?? true,
  });

  // ── hover: the newest position anything has submitted, answered at display rate ──────────
  let hoverActive = false;
  let hoverSx = 0;
  let hoverSy = 0;
  let hoverId = -1;
  /** A touch cannot hover: when its press ends the pointer is gone. A mouse is still there. */
  let hoverIsTouch = false;

  /** Dispatch one gesture to its handlers, then to the camera, honouring `claim`. */
  function deliverGesture(out: GestureOut): void {
    switch (out.type) {
      case 'tap':
      case 'longpress': {
        tapEvent.type = out.type;
        tapEvent.pointerType = out.pointerType;
        tapEvent.heldMs = out.heldMs;
        tapEvent.claimed = false;
        fill(tapEvent, frame, currentTick, out.sx, out.sy);
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
        fill(dragEvent, frame, currentTick, out.sx, out.sy);
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
        fill(zoomEvent, frame, currentTick, out.sx, out.sy);
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
      fill(actionEvent, frame, currentTick, sx, sy);
      walk(list, actionEvent);
    }
  }

  /** A key edge. Only the press fires an action; the release exists to keep `held` honest. */
  function onKey(code: string, down: boolean): void {
    if (!down) return;
    const entries = actions.forKey(code);
    if (entries.length === 0) return;
    // A positionless source still has to answer "where". The game's current selection if it has
    // one, the viewport centre if it does not — never nothing, or the keyboard path does
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

  const recogniser: Recogniser = createRecogniser({
    profile,
    stepMs,
    emit: deliverGesture,
    onKey,
  });

  const host: ScopeHost<A> = {
    gestures,
    actionList(action: A): HandlerList<AnyActionHandler> {
      const list = actionLists.get(action);
      if (list === undefined) {
        throw new RangeError(
          `input.onAction: '${String(action)}' is not a declared action; declared: ${actions.names.length === 0 ? '(none)' : actions.names.join(', ')}`,
        );
      }
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
    profile,
    stepMs,
    actionNames: actions.names,
    bindings: actions.bindings,

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

      // Freeze the camera *before* anything is delivered. A handler that recentres the camera
      // must not change where a later event in this same bucket resolved to.
      frame.capture(camera);
      recogniser.setView(camera.viewW, camera.viewH);

      const closed = buffer.close();
      for (let i = 0; i < closed.count; i++) {
        const slot = closed.slots[i];
        if (slot === undefined) continue;
        recogniser.feed(slot, index);
      }
      // After the bucket, so a press released this tick is a tap rather than a hold that
      // matured a moment before the release arrived.
      recogniser.mature(index);
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
      return actions.held(action, recogniser.pressed, recogniser.isKeyHeld);
    },

    keyHeld(code: string): boolean {
      return recogniser.isKeyHeld(code);
    },

    hoverTile(out: GridPoint): boolean {
      if (!hoverActive) return false;
      // The **live** camera, not the frozen one: a hover highlight is a view, and a ghost that
      // lags a slow tick behind the finger is the thing this query exists to prevent.
      screenToTile(camera, hoverSx, hoverSy, out);
      return true;
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
      // a recogniser left latched is a camera that pans for ever and a handler that never
      // learns the drag ended is a placement ghost stuck to the cursor.
      frame.capture(camera);
      recogniser.releaseAll();
      control.stop();
      disposed = true;
      owner.dispose();
    },
  };

  INTERNALS.set(system, {
    stepMs,
    fingerprint,
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
