/**
 * Numbers that move, and numbers that fly.
 *
 * One module and two exports, because a `+120` rising off a building and a wallet ticking up to
 * 1,240 are the same feature seen twice: a number in screen space, animated, that must be
 * **correct without the animation**.
 *
 * That contract is the whole design. `set()` records the target and `value` reports it
 * immediately; the easing happens on the paint cadence, and if no frame has painted recently
 * enough for an animation to be seen — a hidden tab, a low-power device, a test, the very first
 * value at boot — `set()` writes the target text there and then. A HUD is never wrong because a
 * frame did not happen; it is only less pretty.
 */

import { clamp01, cubicOut, expectFinite, type Disposer } from '@latticekit/core';
import { el, pulse, setText, show } from './el.js';
import { internalsOf, type Overlay } from './overlay.js';

/** How a roll behaves. */
export interface RollOptions {
  /** Where it lives. Created as `<span class="lattice-roll">` if you do not pass one, and never
   *  mounted for you — a number belongs inside your own markup, not in a layer of its own. */
  readonly node?: HTMLElement;
  /** Default `String`. Pass `fmtCompact` from `@latticekit/core` for compact magnitudes. This
   *  package has no formatter and never will: formatting is a pure function of a number and
   *  belongs where pure functions live. */
  readonly format?: (value: number) => string;
  /**
   * Roll duration in ms. Default 400. Past about 600 the number is unreadable while it moves,
   * which makes the animation cost the thing it was decorating.
   *
   * It is also the staleness threshold for the paint cadence: a `set` more than `ms` after the
   * last painted frame writes its value straight out, because an animation nothing will draw is
   * not an animation.
   */
  readonly ms?: number;
  /** Pulsed on every settled change. Default `'bump'`. Pass `''` to disable, which also skips
   *  the forced layout `pulse` needs. */
  readonly bumpClass?: string;
}

/** A number that eases to its target. */
export interface Roll {
  /** The element the text is written into. */
  readonly node: HTMLElement;
  /** The target — **always the truth, even mid-roll**. Read this in a test, never
   *  `node.textContent`, which is a frame of an animation and is allowed to be behind. */
  readonly value: number;
  /**
   * Set the target.
   *
   * Cheap and idempotent: setting the value it already has does nothing at all, so calling it
   * from `every()` at 60 Hz costs one comparison. When no frame has painted recently enough for
   * an animation to be seen — a hidden tab, a test, the first value at boot — it writes the text
   * immediately rather than starting a roll nobody will watch.
   *
   * @throws RangeError if `value` is not finite — a `NaN` here reaches the screen as the word
   * "NaN" in a currency display, which is the sort of bug players screenshot.
   */
  set(value: number): void;
  /** Land on the target immediately. Called for you on `visibilitychange`, and by `set` itself
   *  whenever no frame has painted recently enough for an animation to be seen. */
  snap(): void;
  /** Unsubscribe from both cadences. The node is left where you put it. Idempotent. */
  destroy(): void;
}

/** Default roll duration, in ms. */
const DEFAULT_ROLL_MS = 400;

/**
 * A number that eases to its target on the paint cadence.
 *
 * @throws RangeError if `ms` is negative or not finite.
 */
export function roll(ui: Overlay, opts?: RollOptions): Roll {
  const internals = internalsOf(ui);
  const format = opts?.format ?? String;
  const ms = expectFinite(opts?.ms ?? DEFAULT_ROLL_MS, 'roll: ms');
  if (ms < 0) throw new RangeError(`roll: \`ms\` must not be negative, got ${String(ms)}`);
  const bumpClass = opts?.bumpClass ?? 'bump';
  const node = opts?.node ?? el('span', { class: 'lattice-roll' });

  let target = 0;
  let from = 0;
  let displayed = 0;
  let startMs = 0;
  let animating = false;
  /** When a frame last painted, on the overlay's clock, or `undefined` before the first one. */
  let lastPaintMs: number | undefined;

  setText(node, format(0));

  /**
   * Is the paint cadence alive enough for an animation to be seen?
   *
   * The whole hidden-tab guarantee turns on this one question, and the threshold is the roll's
   * own duration, which makes it a fact rather than a tuning constant: if the last frame painted
   * longer ago than a whole roll takes, an animation started now would either never be drawn or
   * be drawn once, at its end. So there is nothing to animate, and the number is written
   * straight out.
   *
   * It is asked in `set` rather than answered by a flag on `tick`, because a game registers
   * `ui.every(() => gold.set(…))` *after* this widget registered its own subscriber — so a flag
   * cleared at the top of a tick would be read before the game had set anything, and every
   * readout in a hidden tab would sit exactly one update behind the truth. Forever.
   */
  function painting(nowMs: number): boolean {
    return lastPaintMs !== undefined && nowMs - lastPaintMs <= ms;
  }

  function write(value: number): void {
    // Round only when both ends are whole numbers. A wallet interpolating 100 → 200 should not
    // show `147.38199999` under the default `String` formatter; a fractional target — a rate, a
    // multiplier — is passed through untouched, because rounding it would be this package
    // deciding how many decimals a game wants.
    const round = Number.isInteger(from) && Number.isInteger(target);
    setText(node, format(round ? Math.round(value) : value));
  }

  function settle(): void {
    displayed = target;
    animating = false;
    write(target);
    pulse(node, bumpClass);
  }

  function snap(): void {
    if (!animating) return;
    settle();
  }

  const stopPaint: Disposer = ui.paint((nowMs) => {
    lastPaintMs = nowMs;
    if (!animating) return;
    if (ms === 0) {
      settle();
      return;
    }
    const t = clamp01((nowMs - startMs) / ms);
    if (t >= 1) {
      settle();
      return;
    }
    displayed = from + (target - from) * cubicOut(t);
    write(displayed);
  });

  // The state cadence is the safety net, not the animation. It catches the roll that was
  // animating when the tab went behind another, and it *snaps* rather than starting a catch-up,
  // so a player returning after an hour sees the number instead of four seconds of counting.
  const stopEvery: Disposer = ui.every((nowMs) => {
    if (animating && !painting(nowMs)) settle();
  });

  const stopResync: Disposer = internals.onResync(snap);

  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopPaint();
    stopEvery();
    stopResync();
  }
  const release = internals.scope.add(destroy);

  return {
    node,
    get value(): number {
      return target;
    },
    set(value: number): void {
      expectFinite(value, 'roll.set: value');
      if (value === target) return;
      const nowMs = internals.now();
      from = displayed;
      target = value;
      if (!painting(nowMs)) {
        // Nothing is drawing, so there is nothing to animate: write the truth and be done. This
        // is the boot case as well as the hidden-tab one — a wallet's first value should appear,
        // not count up from zero while the player waits.
        settle();
        return;
      }
      startMs = nowMs;
      animating = true;
    },
    snap,
    destroy(): void {
      release();
      destroy();
    },
  };
}

/** How a floating number reads. */
export type FloatKind = 'gain' | 'loss' | 'plain';

/** A mutable point, used only as an output parameter. Structurally a `Vec2` from
 *  `@latticekit/core`, declared here so `ui` compiles with no import for three fields. */
export interface ScreenPoint {
  /** CSS pixels from the left of the viewport. */
  x: number;
  /** CSS pixels from the top of the viewport. */
  y: number;
}

/** How a float host behaves. */
export interface FloatOptions {
  /**
   * How many can be alive at once. Default 24. The nodes are created up front and recycled;
   * `spawn()` creates no element, because a big collect spawns a dozen of these in one tap and
   * a garbage collection during the feedback for a tap is the tap feeling bad.
   */
  readonly capacity?: number;
  /** Lifetime in ms. Default 900. */
  readonly ms?: number;
  /**
   * Re-project each live float's anchor, every paint.
   *
   * Omit it and `spawn()` takes screen pixels, which is right for a static camera. Supply it and
   * `spawn()` takes whatever coordinates you like — world units, grid units — and this converts
   * them, so a `+120` stays glued to the building it came from while the player is still
   * dragging the camera. `@latticekit/ui` does not know what a camera is and must not; three lines
   * of `worldToScreen` from `@latticekit/iso` live on the game's side of this hook.
   *
   * Called with the same `out` object every time. Write into it; do not keep it.
   */
  readonly project?: (anchorX: number, anchorY: number, out: ScreenPoint) => void;
}

/** A pool of floating numbers. */
export interface FloatHost {
  /**
   * Spawn one.
   *
   * Four primitives, no object: this is the hot path in a collect-and-spend game. Over capacity
   * the **oldest** float is recycled — the newest feedback is the one the player is looking for.
   *
   * @throws RangeError if either anchor is not finite; a `NaN` becomes `left: NaNpx`, which the
   * browser ignores, so the float appears in the top-left corner of the screen for everybody.
   */
  spawn(anchorX: number, anchorY: number, text: string, kind?: FloatKind): void;
  /** Remove the pool. Idempotent. */
  destroy(): void;
}

/** Default pool size. A dozen buildings collecting at once, doubled. */
const DEFAULT_CAPACITY = 24;
/** Default lifetime, in ms. */
const DEFAULT_FLOAT_MS = 900;
/**
 * How far a float rises, in CSS pixels.
 *
 * About two lines of HUD text: far enough to read as *leaving*, short enough that a float
 * spawned near the bottom of a phone does not cross the dock on the way out.
 */
const RISE_PX = 40;

/** One pooled float. Mutated in place; never replaced. */
interface Slot {
  readonly node: HTMLElement;
  anchorX: number;
  anchorY: number;
  spawnMs: number;
  alive: boolean;
  className: string;
  anim: Animation | undefined;
}

/**
 * Floating "+120" feedback, in the overlay's bottom layer.
 *
 * It is DOM rather than canvas because it is screen-space type: it wants the game's font, its
 * text shadow and its color tokens, and painting it through `@latticekit/draw`'s text kit would
 * mean a second typographic system that drifts from the first. It is in the *bottom* layer
 * because feedback must never intercept the next tap, and that layer is `pointer-events: none`
 * with no way to turn it on.
 *
 * Motion is a Web Animations keyframe set by this package, not a CSS class you have to supply —
 * the kit ships zero assets and that includes stylesheets, so a float must move on its own or
 * the primitive is half a primitive. The node is positioned with its **horizontal center and top
 * edge** on the anchor; style everything else with `.lattice-float`.
 *
 * **Expiry is driven from the state cadence**, with the animation's own completion as an
 * optimization and never as the mechanism. Web Animations do not run in a hidden tab, so
 * `onfinish` never fires there and a recycler that waited for it would hand back no nodes at all
 * — the pool would fill, and the first tap after the player returns would show nothing.
 *
 * @throws RangeError if `capacity` is below 1 or `ms` is not positive.
 */
export function floats(ui: Overlay, opts?: FloatOptions): FloatHost {
  const internals = internalsOf(ui);
  const capacity = Math.floor(expectFinite(opts?.capacity ?? DEFAULT_CAPACITY, 'floats: capacity'));
  if (capacity < 1) {
    throw new RangeError(`floats: \`capacity\` must be at least 1, got ${String(opts?.capacity)}`);
  }
  const ms = expectFinite(opts?.ms ?? DEFAULT_FLOAT_MS, 'floats: ms');
  if (ms <= 0) throw new RangeError(`floats: \`ms\` must be greater than 0, got ${String(ms)}`);
  const project = opts?.project;

  const layer = internals.layerNode('floats');
  const slots: Slot[] = [];
  for (let i = 0; i < capacity; i++) {
    const node = el('div', { class: 'lattice-float lattice-float-plain' });
    node.style.setProperty('position', 'absolute');
    node.style.setProperty('display', 'none', 'important');
    node.setAttribute('hidden', '');
    layer.appendChild(node);
    slots.push({
      node,
      anchorX: 0,
      anchorY: 0,
      spawnMs: 0,
      alive: false,
      className: 'lattice-float lattice-float-plain',
      anim: undefined,
    });
  }
  /** The one output point, reused for every projection. A fresh `{x, y}` per float per frame is
   *  the allocation non-negotiable 7 is about. */
  const out: ScreenPoint = { x: 0, y: 0 };
  let next = 0;

  function place(slot: Slot): void {
    let x = slot.anchorX;
    let y = slot.anchorY;
    if (project !== undefined) {
      out.x = x;
      out.y = y;
      project(x, y, out);
      x = out.x;
      y = out.y;
    }
    slot.node.style.setProperty('left', `${String(x)}px`);
    slot.node.style.setProperty('top', `${String(y)}px`);
  }

  function retire(slot: Slot): void {
    slot.alive = false;
    slot.anim?.cancel();
    slot.anim = undefined;
    slot.node.style.setProperty('display', 'none', 'important');
    slot.node.setAttribute('hidden', '');
  }

  const stopEvery: Disposer = ui.every((nowMs) => {
    for (const slot of slots) {
      if (slot.alive && nowMs - slot.spawnMs >= ms) retire(slot);
    }
  });

  const stopPaint: Disposer =
    project === undefined
      ? () => undefined
      : ui.paint(() => {
          for (const slot of slots) if (slot.alive) place(slot);
        });

  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopEvery();
    stopPaint();
    for (const slot of slots) {
      slot.anim?.cancel();
      slot.node.parentNode?.removeChild(slot.node);
    }
    slots.length = 0;
  }
  const release = internals.scope.add(destroy);

  return {
    spawn(anchorX: number, anchorY: number, text: string, kind: FloatKind = 'plain'): void {
      expectFinite(anchorX, 'floats.spawn: anchorX');
      expectFinite(anchorY, 'floats.spawn: anchorY');
      const slot = slots[next];
      if (slot === undefined) return;
      next = next + 1 === slots.length ? 0 : next + 1;
      if (slot.alive) retire(slot);

      const className = `lattice-float lattice-float-${kind}`;
      if (slot.className !== className) {
        slot.className = className;
        slot.node.className = className;
      }
      setText(slot.node, text);
      slot.anchorX = anchorX;
      slot.anchorY = anchorY;
      slot.spawnMs = internals.now();
      slot.alive = true;
      place(slot);
      show(slot.node);
      slot.anim =
        typeof slot.node.animate === 'function'
          ? slot.node.animate(
              [
                { transform: 'translate(-50%, 0)', opacity: 1 },
                { transform: `translate(-50%, ${String(-RISE_PX)}px)`, opacity: 0 },
              ],
              { duration: ms, easing: 'ease-out', fill: 'forwards' },
            )
          : undefined;
    },
    destroy(): void {
      release();
      destroy();
    },
  };
}
