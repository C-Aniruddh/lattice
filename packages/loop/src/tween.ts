/**
 * Interpolation over a clock somebody else owns.
 *
 * Tweens interpolate **numbers**. A position is two of them, or one driving a `lerp` inside
 * `onUpdate`. There is no `tween(sprite, 'pos.x', …)`: a path string is reflection — it costs
 * a split and a walk every step, it defeats rename, and a typo fails silently forever.
 *
 * ## The curve vocabulary is `core`'s, whole
 *
 * This package defines **no easing curve and no easing name**, and never will. Easing names
 * get written into level data and save files, so data that names a curve must resolve it
 * through the one table the whole kit shares — `'cubicOut'` has to mean the same thing in
 * `ui`, in `draw` and here, forever. An unknown name throws a `RangeError` listing the valid
 * ones; it must never quietly fall back to linear, because a level file with a typo would
 * then ship feeling wrong and passing its tests.
 *
 * A corollary worth stating out loud: there is no `easeInOutSine` and no expo curve anywhere
 * in Lattice. `Math.cos` and `Math.pow` are not required by ECMA-262 to be correctly rounded,
 * so either one silently demotes every tween that uses it out of Tier A — and a tween drives
 * a position, a position gets written to a save, and the save no longer replays.
 *
 * ## Where `step` is called from, and why that is the caller's business
 *
 * `Tweens.step(dt)` is called by the game, from wherever in its `update` the ordering should
 * be. A camera tween stepped after the world lags it by a frame. A tween stepped in `render`
 * is a mutation in the one callback that must not mutate, and it makes the animation
 * frame-rate dependent, which is the whole reason the fixed step exists.
 *
 * Because a curve out of `EASINGS` is Tier A, a tween stepped on the fixed `dt` is safe to
 * have write simulation state. `core`'s `damp` is the opposite — it is Tier B — so a damped
 * camera position may reach a pixel and may never reach a save, a hash or a checksum.
 *
 * Timing is integer microseconds, for the same reason the scheduler's is: `elapsed += 1 / 60`
 * ten thousand times does not land where the arithmetic says, and a tween that ends a
 * ten-thousandth short never fires its "arrived" callback.
 */

import { EASINGS, expectFinite, type Easing, type EasingName } from '@lattice/core';

/** Opaque, never reused within a session. Shared allocator, like {@link TimerId}. */
export type TweenId = number;

/** The shared allocator behind {@link TweenId}. Monotone for the life of the process. */
let nextTweenId = 1;

/**
 * `EASINGS` seen as a lookup that may miss.
 *
 * `EASINGS[name]` is typed `Easing` because `name` is an `EasingName`, so the compiler
 * believes the miss is impossible — and it is, until a level file or a save hands over a
 * string that was an `EasingName` in the build that wrote it. This alias is what keeps the
 * runtime check from looking like dead code to a reader.
 */
const CURVES: Readonly<Record<string, Easing | undefined>> = EASINGS;

/**
 * Convert a duration in seconds to integer microseconds. Local to this module on purpose: the
 * scheduler has its own, and each names its own callers in the error rather than sharing a
 * helper whose message could only say "a duration".
 */
function toMicros(seconds: number, label: string): number {
  expectFinite(seconds, label);
  const micros = Math.round(seconds * 1_000_000);
  if (!Number.isSafeInteger(micros)) {
    throw new RangeError(
      `${label}: expected a duration expressible in integer microseconds, got ${String(seconds)} s — above 2^53 µs the arithmetic stops being exact`,
    );
  }
  return micros;
}

/** Options for {@link Tweens.start}. */
export interface TweenOptions {
  /** The value at `t = 0`. `RangeError` if it is not finite — a `NaN` here spreads silently. */
  readonly from: number;
  /** The value handed to `onUpdate` exactly once at the end, before `onDone`. */
  readonly to: number;

  /**
   * Duration.
   *
   * @throws RangeError if it is not finite and greater than zero, or if it rounds to less than
   * one microsecond. A zero-length tween is an assignment, and writing it as a tween hides the
   * assignment behind a callback that fires on some later frame.
   */
  readonly seconds: number;

  /**
   * Called with the eased value every `step`, and exactly once more with **exactly `to`**
   * before `onDone`.
   *
   * `t` is clamped to `[0, 1]`, so a tween that overruns its duration by half a step still
   * ends on `to` rather than extrapolating past it. The *value* may leave `[from, to]` in the
   * middle if the curve overshoots — that is what `backOut` and `bounceOut` are for, and a
   * consumer that cannot tolerate an overshoot should not name one of those curves.
   */
  readonly onUpdate: (value: number) => void;

  /**
   * A curve, or the **name** of one in `core`'s `EASINGS`. Default is linear.
   *
   * @throws RangeError on a name that is not in the table, listing the valid ones. Falling
   * back to linear would let a typo in a level file ship, feeling wrong and passing.
   */
  readonly ease?: Easing | EasingName;

  /**
   * Wait this long before the first `onUpdate`. This is the whole sequencing story: `delay`
   * covers most of it and `onDone` covers the rest in three lines.
   *
   * @throws RangeError if negative or not finite.
   */
  readonly delay?: number;

  /**
   * A **slot**, not a tag. Starting a tween with a slot cancels any live tween in the same
   * slot, silently and without its `onDone`.
   *
   * Two tweens writing one property is the commonest animation bug there is: each writes its
   * own idea of the value on alternate steps and the thing shudders between two paths.
   * `slot: 'panel.y'` makes re-targeting mid-flight the default behavior instead of a thing
   * you remember to do.
   */
  readonly slot?: string;

  /**
   * Fires once, after the final `onUpdate`. **Never fires for a canceled or slot-displaced
   * tween** — which is what makes it safe to put "the panel has arrived, enable the buttons"
   * in here, because a re-target must not enable them halfway.
   */
  readonly onDone?: () => void;
}

/** A live tween. Never escapes this module. */
interface Tween {
  readonly id: TweenId;
  readonly from: number;
  readonly to: number;
  readonly durationUs: number;
  readonly delayUs: number;
  readonly ease: Easing;
  readonly onUpdate: (value: number) => void;
  readonly onDone: (() => void) | undefined;
  readonly slot: string | undefined;
  elapsedUs: number;
  live: boolean;
}

/**
 * A bag of running tweens the game steps itself.
 *
 * Not owned by the loop, deliberately: the loop would have to choose an ordering relative to
 * `update`, and there is no right answer to that — it depends on whether the tween drives the
 * world or follows it.
 */
export interface Tweens {
  /** How many tweens are live, including ones still inside their `delay`. */
  readonly active: number;

  /**
   * Begin a tween. Validates everything at this call, so a bad curve name or a zero duration
   * fails at the line that wrote it rather than on some later frame.
   */
  start(options: TweenOptions): TweenId;

  /** Stop one. `true` if a live tween was removed. `onDone` does **not** fire. */
  cancel(id: TweenId): boolean;

  /** Stop all of them. No `onDone` fires. The teardown call for a scene. */
  cancelAll(): void;

  /**
   * Advance every live tween by `dt` seconds.
   *
   * A tween started from inside an `onUpdate` or `onDone` does **not** step in the same pass,
   * and one canceled from inside one never runs again — the classic
   * mutation-during-iteration crash, and the canceled-callback-that-fires-once-anyway bug,
   * both closed here rather than left to the caller.
   *
   * @throws RangeError if `dt` is negative, `NaN` or infinite.
   */
  step(dt: number): void;
}

/** Resolve `ease` to a curve, or refuse by name. See {@link TweenOptions.ease}. */
function resolveEase(ease: Easing | EasingName | undefined): Easing {
  if (ease === undefined) return EASINGS.linear;
  if (typeof ease === 'function') return ease;
  const curve = CURVES[ease];
  if (curve === undefined) {
    throw new RangeError(
      `tween.ease: '${String(ease)}' is not a curve in @lattice/core's EASINGS — expected one of ${Object.keys(EASINGS).join(', ')}. This package defines no curves of its own, so a name that is not in that table would have to silently mean linear`,
    );
  }
  return curve;
}

/** An empty set of tweens. One per scene, or one per game; they cost nothing when idle. */
export function createTweens(): Tweens {
  const tweens = new Map<TweenId, Tween>();
  // Keyed to the tween itself rather than to its id: a map of ids would need a second lookup
  // that can miss, and a branch that can never be taken is a branch no test can cover and no
  // reader can trust.
  const slots = new Map<string, Tween>();

  /** Remove without firing `onDone`. The cancel path and the slot-displacement path. */
  const drop = (tween: Tween): void => {
    tween.live = false;
    tweens.delete(tween.id);
    if (tween.slot !== undefined && slots.get(tween.slot) === tween) slots.delete(tween.slot);
  };

  return {
    get active() {
      return tweens.size;
    },

    start(options) {
      const from = expectFinite(options.from, 'tween.from');
      const to = expectFinite(options.to, 'tween.to');
      const durationUs = toMicros(options.seconds, 'tween.seconds');
      if (durationUs < 1) {
        throw new RangeError(
          `tween.seconds: expected a finite number of seconds > 0 (at least one microsecond), got ${String(options.seconds)} — a zero-length tween is an assignment`,
        );
      }
      const delayUs = options.delay === undefined ? 0 : toMicros(options.delay, 'tween.delay');
      if (delayUs < 0) {
        throw new RangeError(
          `tween.delay: expected a non-negative number of seconds, got ${String(options.delay)}`,
        );
      }
      if (typeof options.onUpdate !== 'function') {
        throw new TypeError(
          `tween.onUpdate: expected a function, got ${typeof options.onUpdate} — a tween with nowhere to write is a timer with extra arithmetic`,
        );
      }
      const ease = resolveEase(options.ease);

      const slot = options.slot;
      if (slot !== undefined) {
        const displaced = slots.get(slot);
        // Silently, and without `onDone`: a re-target must not tell the caller the old journey
        // arrived.
        if (displaced !== undefined) drop(displaced);
      }

      const id = nextTweenId++;
      const tween: Tween = {
        id,
        from,
        to,
        durationUs,
        delayUs,
        ease,
        onUpdate: options.onUpdate,
        onDone: options.onDone,
        slot,
        elapsedUs: 0,
        live: true,
      };
      tweens.set(id, tween);
      if (slot !== undefined) slots.set(slot, tween);
      return id;
    },

    cancel(id) {
      const tween = tweens.get(id);
      if (tween === undefined) return false;
      drop(tween);
      return true;
    },

    cancelAll() {
      for (const tween of tweens.values()) tween.live = false;
      tweens.clear();
      slots.clear();
    },

    step(dt) {
      const dtUs = toMicros(dt, 'tweens.step');
      if (dtUs < 0) {
        throw new RangeError(
          `tweens.step: expected a non-negative number of seconds, got ${String(dt)} — running a tween backwards would re-enter a curve it has already left`,
        );
      }
      if (tweens.size === 0) return;

      // The id an as-yet-unstarted tween would receive. A `Map` iterator yields entries
      // inserted during the walk, so this is what stops a tween started inside an `onUpdate`
      // from taking a step in the same pass — and it costs nothing, where a snapshot array
      // would allocate on every frame that has a tween running.
      const horizon = nextTweenId;

      for (const tween of tweens.values()) {
        if (!tween.live || tween.id >= horizon) continue;
        tween.elapsedUs += dtUs;
        const activeUs = tween.elapsedUs - tween.delayUs;
        if (activeUs < 0) continue;
        if (activeUs >= tween.durationUs) {
          drop(tween);
          // Exactly `to`, not `to` minus a rounding: a panel that ends its slide two-tenths of
          // a nanometre short is a panel whose "arrived" test compares unequal forever.
          tween.onUpdate(tween.to);
          if (tween.onDone !== undefined) tween.onDone();
          continue;
        }
        tween.onUpdate(tween.from + (tween.to - tween.from) * tween.ease(activeUs / tween.durationUs));
      }
    },
  };
}
