/**
 * The gesture state machine. **Pure**: no DOM, no clock, no timers, no allocation per event.
 *
 * It sees nothing but {@link SampleSlot}s and a tick index, which is what makes every invariant
 * in this package testable in Node with no shim and a replay bit-identical to the session it
 * came from. Durations are counted in ticks and multiplied by `stepMs`; there is no timer that
 * could fire a long press, which is why nothing game-visible can escape outside a tick.
 *
 * ## The four traps this file exists to close
 *
 * 1. **The release after a long press counting as a tap.** The press latches as *consumed* the
 *    moment the hold fires, so `tap` and `longpress` are mutually exclusive for one press. In
 *    the source game the missing version of this meant the `pointerup` ending a hold also
 *    counted as a tap, which instantly re-dropped the building the player had just lifted.
 * 2. **Not disarming the hold when the finger travels.** One number governs it: crossing
 *    `tapSlopPx` ends the press, starts the drag and disarms the hold, in that order. Without
 *    it a slightly shaky drag lifts a building mid-pan.
 * 3. **Fling velocity from the last two points.** A finger that pauses before lifting produces
 *    either zero or nonsense, and both make flicks feel random. Velocity is averaged over
 *    `flingSampleMs` of tick history.
 * 4. **A pinch seeded from a spread of zero.** The two pointers never land in the same tick, so
 *    the spread is seeded when the second lands, the pinch waits for `pinchStartPx` of change,
 *    and a spread below `pinchMinSpreadPx` refuses to be a denominator.
 *
 * ## The one thing it can never be
 *
 * **Latched.** For every `down` there is exactly one terminal event, and every way a host can
 * take a pointer away — `pointerup`, `pointercancel`, `lostpointercapture`, blur,
 * `visibilitychange`, dispose — arrives here as an `up` or a `cancel`. A recognizer that can be
 * left in a dragging state is worse than one that occasionally drops a drag, because the first
 * symptom is a camera that pans for ever and the second is a gesture you repeat.
 */

import type { GestureProfile, PointerKind } from './profile.js';
import type { SampleSlot } from './sample.js';
import { zoomKeyDirection } from './cameracontrol.js';

/** The six things a player can do that this package has a name for. */
export type GestureName = 'tap' | 'longpress' | 'dragstart' | 'drag' | 'dragend' | 'zoom';

/** What produced a zoom. The camera does not care and neither does a game; a tutorial might. */
export type ZoomSource = 'wheel' | 'pinch' | 'key';

/**
 * The recognizer's one output record, reused for every gesture it ever emits.
 *
 * Deliberately flat and un-narrowed: it is an internal hand-off to the system, which copies
 * the fields that belong to the gesture's kind into the public event object and leaves the
 * rest alone. Making this a discriminated union would buy type safety across a boundary two
 * files wide and cost an allocation per pointer move, sixty times a second.
 */
export interface GestureOut {
  type: GestureName;
  pointerType: PointerKind;
  /** CSS pixels relative to the bound element: the position, the anchor, or the midpoint. */
  sx: number;
  sy: number;
  /** Movement since the previous event of this gesture, or a pinch midpoint's own travel. */
  dx: number;
  dy: number;
  /** CSS px/s, averaged over `flingSampleMs`. Zero on a canceled `dragend`. */
  vx: number;
  vy: number;
  /** Multiplicative; `> 1` zooms in. Only meaningful for `zoom`. */
  scale: number;
  source: ZoomSource;
  /** Whole ticks × `stepMs`. Only meaningful for `tap` and `longpress`. */
  heldMs: number;
}

/** What the recognizer needs from around it. Two callbacks and two numbers; no objects it owns. */
export interface RecognizerOptions {
  readonly profile: Readonly<GestureProfile>;
  /**
   * The loop's fixed step in milliseconds. Every duration here is a whole number of ticks
   * times this, so a long press is the same length on every machine — and getting it wrong
   * makes every threshold wrong by the same ratio.
   */
  readonly stepMs: number;
  /** Called synchronously per gesture. The record is reused; copy what you keep. */
  readonly emit: (gesture: GestureOut) => void;
  /** The press edge and the release edge of a key, after auto-repeat has been filtered out. */
  readonly onKey: (code: string, down: boolean) => void;
}

/** One tracked pointer. Allocated `maxPointers` times at construction and never again. */
interface PointerState {
  active: boolean;
  id: number;
  kind: PointerKind;
  startSx: number;
  startSy: number;
  /** Position at the previous emitted event of this drag. The `dx`/`dy` baseline. */
  lastSx: number;
  lastSy: number;
  curSx: number;
  curSy: number;
  startTick: number;
  dragging: boolean;
  /** A hold fired, or a second finger arrived: this press can no longer become a tap. */
  consumed: boolean;
  /** Velocity history, one entry per tick, newest at `vHead`. */
  vTick: number[];
  vX: number[];
  vY: number[];
  vCount: number;
  vHead: number;
}

/**
 * The state machine, fed one sample at a time.
 *
 * Every method takes the tick it is being run for, because that is the only clock in the
 * package: the recognizer never asks what time it is and could not find out if it wanted to.
 */
export interface Recognizer {
  /** The viewport, for gestures with no position of their own — the keyboard's zoom. */
  setView(viewW: number, viewH: number): void;
  /** Consume one sample as part of tick `tick`. May emit any number of gestures, synchronously. */
  feed(slot: SampleSlot, tick: number): void;
  /** After the bucket: fire any hold that matured during this tick. */
  mature(tick: number): void;
  /**
   * End everything as if the host had taken it away: a `dragend` with zero velocity for any
   * live drag, a release for every held key. Blur, `visibilitychange` and `dispose` all land
   * here, which is what makes "the recognizer cannot be latched" a property rather than a hope.
   */
  releaseAll(): void;
  isKeyHeld(code: string): boolean;
  /** A pointer is pressed and has not yet become a drag — what a `tap` binding means by held. */
  readonly pressed: boolean;
  /** A drag is live. Exposed so a test can prove no path leaves one behind. */
  readonly dragging: boolean;
}

/**
 * Build a recognizer.
 *
 * @throws RangeError if `stepMs` is not a finite number greater than zero — every duration in
 *   the profile is measured in ticks of it, so a zero step makes a long press instantaneous.
 */
export function createRecognizer(options: RecognizerOptions): Recognizer {
  const { profile, stepMs, emit, onKey } = options;
  if (!(Number.isFinite(stepMs) && stepMs > 0)) {
    throw new RangeError(
      `createRecognizer: expected stepMs to be a finite number > 0, got ${String(stepMs)} — pass loop.stepMs rather than a literal`,
    );
  }

  /**
   * A hold, in whole ticks, rounded **up**.
   *
   * Rounding down would let a hold fire before `longPressMs` had elapsed, which is the
   * direction that misfires during ordinary taps. At least one tick, so a step longer than the
   * threshold still requires a tick to pass rather than firing on the press itself.
   */
  const longPressTicks = Math.max(1, Math.ceil(profile.longPressMs / stepMs));

  /**
   * Velocity history length: enough ticks to cover `flingSampleMs`, plus the two endpoints.
   *
   * Sized once, from the step, so the window is the same duration on a 60 Hz game and a 10 Hz
   * one. Capped at 256 because a game with a 1 ms step has bigger problems than fling accuracy.
   */
  const ringSize = Math.min(256, Math.max(2, Math.ceil(profile.flingSampleMs / stepMs) + 2));

  const pointers: PointerState[] = [];
  for (let i = 0; i < profile.maxPointers; i++) pointers.push(createPointerState(ringSize));

  const keys = new Set<string>();

  /** The output record, reused for every gesture. See {@link GestureOut}. */
  const out: GestureOut = {
    type: 'tap',
    pointerType: 'mouse',
    sx: 0,
    sy: 0,
    dx: 0,
    dy: 0,
    vx: 0,
    vy: 0,
    scale: 1,
    source: 'wheel',
    heldMs: 0,
  };

  let viewW = 0;
  let viewH = 0;

  // Two-pointer state. `seedSpread` is taken when the second finger lands; the pinch does not
  // start until the spread has changed by `pinchStartPx`, because two fingers never land in the
  // same tick and the spread jitters as the second one settles.
  let pinching = false;
  /** A pointer moved while two were down; the pinch is evaluated once, at the end of the tick. */
  let pinchDirty = false;
  let seedSpread = 0;
  let prevSpread = 0;
  let prevMidX = 0;
  let prevMidY = 0;

  function activeCount(): number {
    let n = 0;
    for (const p of pointers) if (p.active) n += 1;
    return n;
  }

  function find(id: number): PointerState | undefined {
    for (const p of pointers) if (p.active && p.id === id) return p;
    return undefined;
  }

  function emitPointer(
    type: GestureName,
    p: PointerState,
    dx: number,
    dy: number,
    vx: number,
    vy: number,
    heldMs: number,
  ): void {
    out.type = type;
    out.pointerType = p.kind;
    out.sx = p.curSx;
    out.sy = p.curSy;
    out.dx = dx;
    out.dy = dy;
    out.vx = vx;
    out.vy = vy;
    out.scale = 1;
    out.source = 'wheel';
    out.heldMs = heldMs;
    emit(out);
  }

  function emitZoom(
    source: ZoomSource,
    kind: PointerKind,
    scale: number,
    sx: number,
    sy: number,
    dx: number,
    dy: number,
  ): void {
    out.type = 'zoom';
    out.pointerType = kind;
    out.sx = sx;
    out.sy = sy;
    out.dx = dx;
    out.dy = dy;
    out.vx = 0;
    out.vy = 0;
    out.scale = scale;
    out.source = source;
    out.heldMs = 0;
    emit(out);
  }

  /** End a live drag. `flung` is false for every path that is not a deliberate release. */
  function endDrag(p: PointerState, flung: boolean): void {
    if (!p.dragging) return;
    p.dragging = false;
    if (!flung) {
      emitPointer('dragend', p, 0, 0, 0, 0, 0);
      return;
    }
    velocity(p, stepMs, profile.flingSampleMs);
    emitPointer('dragend', p, p.curSx - p.lastSx, p.curSy - p.lastSy, velX, velY, 0);
  }

  /** Two fingers are down: no single-pointer drag survives it, and neither can become a tap. */
  function beginTwoPointer(): void {
    for (const p of pointers) {
      if (!p.active) continue;
      // Not a fling: the drag was interrupted by a second finger, and a camera that flings as
      // the player starts a pinch is a camera that runs away from the thing being framed.
      endDrag(p, false);
      p.consumed = true;
    }
    const [a, b] = twoActive();
    if (a === undefined || b === undefined) return;
    pinching = false;
    pinchDirty = false;
    seedSpread = spread(a, b);
    prevSpread = seedSpread;
    prevMidX = (a.curSx + b.curSx) / 2;
    prevMidY = (a.curSy + b.curSy) / 2;
  }

  /** The two live pointers, in slot order, or `undefined`s if there are not two. */
  function twoActive(): readonly [PointerState | undefined, PointerState | undefined] {
    let a: PointerState | undefined;
    let b: PointerState | undefined;
    for (const p of pointers) {
      if (!p.active) continue;
      if (a === undefined) a = p;
      else if (b === undefined) b = p;
    }
    return [a, b];
  }

  function spread(a: PointerState, b: PointerState): number {
    const dx = a.curSx - b.curSx;
    const dy = a.curSy - b.curSy;
    // Tier A: `sqrt` is specified exactly by ECMA-262. `Math.hypot` is not, and is slower.
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** A pointer moved while two are down. Scale from the spread, pan from the midpoint. */
  function updatePinch(): void {
    const [a, b] = twoActive();
    if (a === undefined || b === undefined) return;
    const now = spread(a, b);
    const midX = (a.curSx + b.curSx) / 2;
    const midY = (a.curSy + b.curSy) / 2;
    if (!pinching) {
      const change = now - seedSpread;
      if ((change < 0 ? -change : change) >= profile.pinchStartPx) {
        pinching = true;
        // Re-baseline, so the first scale of the pinch is exactly 1 and the map does not jump
        // by the amount of jitter it took to cross the threshold.
        prevSpread = now;
      }
    }
    // A ratio of spreads, so a denominator near zero teleports the zoom. Refuse to divide by
    // one: report a scale of exactly 1 and keep the midpoint's pan, which is the half of the
    // gesture that is still meaningful — and which is also what a two-finger *pan* is, before
    // the spread has changed enough to be a pinch at all.
    const usable =
      pinching && now >= profile.pinchMinSpreadPx && prevSpread >= profile.pinchMinSpreadPx;
    const scale = usable ? now / prevSpread : 1;
    emitZoom('pinch', a.kind, scale, midX, midY, midX - prevMidX, midY - prevMidY);
    if (pinching) prevSpread = now;
    prevMidX = midX;
    prevMidY = midY;
  }

  /** Scratch for {@link velocity}, so the hot path returns two numbers without an object. */
  let velX = 0;
  let velY = 0;

  /**
   * Average velocity over the last `flingSampleMs` of tick history, in CSS px/s.
   *
   * Averaged and never differenced: a finger that pauses before lifting has a last-two-points
   * velocity of nearly zero or of nearly anything. A window that spans no ticks at all — a
   * whole drag inside one fixed step — reports zero, because a fixed-step log has no finer time
   * axis to measure it on and a made-up number would not survive a replay.
   */
  function velocity(p: PointerState, step: number, windowMs: number): void {
    velX = 0;
    velY = 0;
    if (p.vCount < 2) return;
    const newestIndex = p.vHead;
    const newestTick = p.vTick[newestIndex];
    const newestX = p.vX[newestIndex];
    const newestY = p.vY[newestIndex];
    if (newestTick === undefined || newestX === undefined || newestY === undefined) return;
    const size = p.vTick.length;
    let chosen = newestIndex;
    for (let back = 1; back < p.vCount; back++) {
      const index = (newestIndex - back + size * 2) % size;
      const tick = p.vTick[index];
      if (tick === undefined) break;
      // The immediately preceding entry is always taken, whatever the window says. A game whose
      // fixed step is longer than `flingSampleMs` — 100 ms steps and a 60 ms window, entirely
      // plausible for an idle economy — has no two entries inside the window, and reporting
      // zero there would mean flicks simply do not work on slow-stepping games. Beyond the
      // first, the window rules.
      if (back > 1 && (newestTick - tick) * step > windowMs) break;
      chosen = index;
    }
    const oldestTick = p.vTick[chosen];
    const oldestX = p.vX[chosen];
    const oldestY = p.vY[chosen];
    if (oldestTick === undefined || oldestX === undefined || oldestY === undefined) return;
    const dtMs = (newestTick - oldestTick) * step;
    if (dtMs <= 0) return;
    velX = ((newestX - oldestX) / dtMs) * 1000;
    velY = ((newestY - oldestY) / dtMs) * 1000;
  }

  /** Record where a pointer was at the end of tick `tick`. One entry per tick, newest wins. */
  function trackVelocity(p: PointerState, tick: number): void {
    if (p.vCount > 0 && p.vTick[p.vHead] === tick) {
      p.vX[p.vHead] = p.curSx;
      p.vY[p.vHead] = p.curSy;
      return;
    }
    p.vHead = p.vCount === 0 ? 0 : (p.vHead + 1) % p.vTick.length;
    p.vTick[p.vHead] = tick;
    p.vX[p.vHead] = p.curSx;
    p.vY[p.vHead] = p.curSy;
    if (p.vCount < p.vTick.length) p.vCount += 1;
  }

  function down(slot: SampleSlot, tick: number): void {
    if (find(slot.id) !== undefined) return;
    let free: PointerState | undefined;
    for (const p of pointers) {
      if (!p.active) {
        free = p;
        break;
      }
    }
    // A third finger on a two-finger gesture is a palm. Ignoring it beats letting it move the
    // midpoint, which is what makes the map lurch when a hand rests on the screen.
    if (free === undefined) return;
    free.active = true;
    free.id = slot.id;
    free.kind = slot.pointerType;
    free.startSx = slot.sx;
    free.startSy = slot.sy;
    free.lastSx = slot.sx;
    free.lastSy = slot.sy;
    free.curSx = slot.sx;
    free.curSy = slot.sy;
    free.startTick = tick;
    free.dragging = false;
    free.consumed = false;
    free.vCount = 0;
    free.vHead = 0;
    trackVelocity(free, tick);
    if (activeCount() >= 2) beginTwoPointer();
  }

  function move(slot: SampleSlot, tick: number): void {
    const p = find(slot.id);
    if (p === undefined) return;
    p.curSx = slot.sx;
    p.curSy = slot.sy;
    trackVelocity(p, tick);

    if (activeCount() >= 2) {
      // Evaluated once per tick, in `mature`, and never per sample. Two fingers move as two
      // separate samples, so a spread computed after the first one has moved and before the
      // second has is a spread that never existed: a genuine two-finger *pan* would cross the
      // start threshold on the way through and the map would breathe. The tick is the time
      // quantum everything else in this package is measured in, and it is the right one here.
      pinchDirty = true;
      return;
    }
    if (!p.dragging) {
      const dx = p.curSx - p.startSx;
      const dy = p.curSy - p.startSy;
      const slop = profile.tapSlopPx[p.kind];
      if (dx * dx + dy * dy <= slop * slop) return;
      // Ends the press, starts the drag and disarms the hold, in that order.
      p.dragging = true;
      p.consumed = true;
      emitPointer('dragstart', p, dx, dy, 0, 0, 0);
      p.lastSx = p.curSx;
      p.lastSy = p.curSy;
      return;
    }
    emitPointer('drag', p, p.curSx - p.lastSx, p.curSy - p.lastSy, 0, 0, 0);
    p.lastSx = p.curSx;
    p.lastSy = p.curSy;
  }

  function up(slot: SampleSlot, tick: number): void {
    const p = find(slot.id);
    if (p === undefined) return;
    p.curSx = slot.sx;
    p.curSy = slot.sy;
    trackVelocity(p, tick);
    if (p.dragging) endDrag(p, true);
    else if (!p.consumed) emitPointer('tap', p, 0, 0, 0, 0, (tick - p.startTick) * stepMs);
    p.active = false;
    afterRelease(tick);
  }

  function cancel(id: number, tick: number): void {
    const p = find(id);
    if (p === undefined) return;
    // A canceled drag ends, but does not fling. A gesture interrupted by an incoming call must
    // not leave the camera flying.
    endDrag(p, false);
    p.active = false;
    afterRelease(tick);
  }

  /**
   * One finger has gone. If exactly one is left, it continues as a pan **from where it is
   * now**.
   *
   * Without the re-seed the surviving finger's press origin is where it landed *before* the
   * pinch, so the first move after the lift reports the whole distance traveled during the
   * pinch as one delta and the map jumps by it. Its velocity history is dropped for the same
   * reason: a fling must not inherit the speed of a gesture that has already ended.
   */
  function afterRelease(tick: number): void {
    if (activeCount() >= 2) return;
    pinching = false;
    pinchDirty = false;
    for (const p of pointers) {
      if (!p.active) continue;
      p.startSx = p.curSx;
      p.startSy = p.curSy;
      p.lastSx = p.curSx;
      p.lastSy = p.curSy;
      p.dragging = false;
      // No tap either: the press was part of a two-finger gesture, and a pinch that ends with
      // one finger lifting must not also collect whatever is under the other one.
      p.consumed = true;
      p.vCount = 0;
      p.vHead = 0;
      trackVelocity(p, tick);
    }
  }

  function wheel(slot: SampleSlot): void {
    const rate = slot.pinch ? profile.wheelPinchRate : profile.wheelZoomRate;
    // Exponential rather than additive, so a notch feels the same at 0.6× and at 4× and
    // wheeling up then down returns exactly where you started; additive zoom is unusable above
    // 2×.
    //
    // @tier-b — `Math.exp` is not required by ECMA-262 to be correctly rounded, so two
    // conforming engines may disagree in the last bit. **This value reaches the camera and
    // nothing else.** The log records `dz`, never the scale, so no Tier B number is ever
    // written down, hashed, or compared by a replay.
    const scale = Math.exp(-slot.dz * rate);
    emitZoom(slot.pinch ? 'pinch' : 'wheel', 'mouse', scale, slot.sx, slot.sy, 0, 0);
  }

  function key(slot: SampleSlot): void {
    if (slot.down) {
      // Auto-repeat does not fire an edge: the repeat rate is an operating-system accessibility
      // setting, so an action that repeats is an action whose count is not reproducible.
      if (keys.has(slot.code)) return;
      keys.add(slot.code);
      const direction = zoomKeyDirection(slot.code);
      if (direction !== 0) {
        const factor = direction > 0 ? profile.keyZoomStep : 1 / profile.keyZoomStep;
        // No position of its own, so it anchors at the viewport center — the one anchor a
        // positionless source can honestly claim.
        emitZoom('key', 'mouse', factor, viewW / 2, viewH / 2, 0, 0);
      }
      onKey(slot.code, true);
      return;
    }
    if (!keys.delete(slot.code)) return;
    onKey(slot.code, false);
  }

  const recognizer: Recognizer = {
    setView(w: number, h: number): void {
      viewW = w;
      viewH = h;
    },

    feed(slot: SampleSlot, tick: number): void {
      switch (slot.kind) {
        case 'down':
          down(slot, tick);
          return;
        case 'move':
          move(slot, tick);
          return;
        case 'up':
          up(slot, tick);
          return;
        case 'cancel':
          cancel(slot.id, tick);
          return;
        case 'wheel':
          wheel(slot);
          return;
        case 'key':
          key(slot);
          return;
        case 'blur':
          // Everything held is released, and no `up` was needed. `keydown` without its `keyup`
          // happens on every alt-tab, and on macOS whenever a command chord is held.
          recognizer.releaseAll();
          return;
        default:
          // A `tick` sample is a marker in the log, never an arrival: `InputSystem.tick`
          // produces it and `submit` refuses one, so it can never reach the state machine.
          return;
      }
    },

    mature(tick: number): void {
      if (pinchDirty) {
        pinchDirty = false;
        updatePinch();
      }
      if (activeCount() !== 1) return;
      for (const p of pointers) {
        if (!p.active || p.dragging || p.consumed) continue;
        if (tick - p.startTick < longPressTicks) continue;
        p.consumed = true;
        emitPointer('longpress', p, 0, 0, 0, 0, (tick - p.startTick) * stepMs);
      }
    },

    releaseAll(): void {
      for (const p of pointers) {
        if (!p.active) continue;
        endDrag(p, false);
        p.active = false;
      }
      pinching = false;
      // A copy, because `onKey` may re-enter — a handler that rebinds on release would
      // otherwise mutate the set being walked. Blur is rare; the allocation is not a hot path.
      for (const code of [...keys]) {
        keys.delete(code);
        onKey(code, false);
      }
    },

    isKeyHeld(code: string): boolean {
      return keys.has(code);
    },

    get pressed(): boolean {
      for (const p of pointers) if (p.active && !p.dragging && !p.consumed) return true;
      return false;
    },

    get dragging(): boolean {
      for (const p of pointers) if (p.active && p.dragging) return true;
      return false;
    },
  };

  return recognizer;
}

/** One pointer's state, with its velocity ring sized once and never resized. */
function createPointerState(ringSize: number): PointerState {
  return {
    active: false,
    id: -1,
    kind: 'mouse',
    startSx: 0,
    startSy: 0,
    lastSx: 0,
    lastSy: 0,
    curSx: 0,
    curSy: 0,
    startTick: 0,
    dragging: false,
    consumed: false,
    vTick: new Array<number>(ringSize).fill(0),
    vX: new Array<number>(ringSize).fill(0),
    vY: new Array<number>(ringSize).fill(0),
    vCount: 0,
    vHead: 0,
  };
}
