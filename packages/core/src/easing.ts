/**
 * The curve library — thirteen easings, all Tier A.
 *
 * **There is no sine easing and no expo easing in this kit, deliberately.** The textbook
 * `easeInOutSine` is `Math.cos`, and `easeOutExpo` is `Math.pow`; neither is required by
 * ECMA-262 to be correctly rounded, so either one silently demotes every tween that uses it
 * out of Tier A. A tween drives a position, a position gets written to a save, and the save
 * no longer replays. Polynomials and `sqrt` cover the same feel with an exact guarantee, so
 * `bounceOut` here is piecewise quadratic rather than a damped sine, and `quartOut` stands
 * in for the expo curve.
 *
 * Every curve satisfies `e(0) === 0` and `e(1) === 1` **exactly**, not approximately. That is
 * an arithmetic constraint on how each one is written, not a property that comes free: the
 * usual `backIn` form `c3*t³ - c1*t²` evaluates to 0.9999999999999998 at `t === 1`, and a
 * panel that ends its slide two-tenths of a nanometre short is a panel that never fires its
 * "arrived" callback. Values *between* the endpoints may leave [0, 1] — that is what `backIn`
 * and `backOut` are for.
 *
 * The curves themselves allocate nothing. `reverse` and `inOut` allocate one closure each,
 * at authoring time; calling either inside a frame is the mistake their doc comments name.
 */

import { clamp01, smoothstep } from './math.js';

/**
 * A curve from normalised time to normalised progress.
 *
 * The contract a consumer may rely on: `e(0) === 0` and `e(1) === 1` exactly, and `e` is
 * finite across [0, 1]. Inputs outside [0, 1] are the caller's problem — most curves here
 * extrapolate rather than clamp, so a tween that overruns its duration must clamp `t` before
 * the call, not after.
 */
export type Easing = (t: number) => number;

/**
 * The name of a built-in curve.
 *
 * A union of string literals rather than an enum so that `{ ease: 'backOut' }` in a config
 * file, a level definition or a save is checked by the compiler with no import and no runtime
 * value. Adding a name here is a breaking change for anything that persisted the old one.
 */
export type EasingName =
  | 'linear'
  | 'quadIn'
  | 'quadOut'
  | 'quadInOut'
  | 'cubicIn'
  | 'cubicOut'
  | 'cubicInOut'
  | 'quartOut'
  | 'backIn'
  | 'backOut'
  | 'bounceOut'
  | 'smooth'
  | 'smoother';

/**
 * The overshoot constant for the `back` curves: 1.70158, which places the peak overshoot at
 * about 10%. Not exported — a caller who wants a different amount wants a different curve,
 * and parameterising it would make `Easing` stop being a plain `(t) => number`.
 */
const BACK = 1.70158;

/** Identity. Present so that "no easing" is a value rather than a `null` check at every call
 *  site that takes an `Easing`. */
export const linear: Easing = (t) => t;

/** Accelerates from rest. Use for something leaving the screen — an object that starts slow
 *  and speeds up reads as *departing*, and the reverse reads as arriving. */
export const quadIn: Easing = (t) => t * t;

/** Decelerates into rest. The default for anything appearing: it is the cheapest curve that
 *  does not stop dead. */
export const quadOut: Easing = (t) => t * (2 - t);

/** Symmetric ease-in-out. The general-purpose move between two resting states. */
export const quadInOut: Easing = (t) => {
  if (t < 0.5) return 2 * t * t;
  const u = 1 - t;
  return 1 - 2 * u * u;
};

/** Accelerates harder than `quadIn`. */
export const cubicIn: Easing = (t) => t * t * t;

/** Decelerates harder than `quadOut`, and the most-reached-for curve in the kit: most of the
 *  motion happens in the first third, so the eye registers the change immediately and the
 *  settle is still smooth. */
export const cubicOut: Easing = (t) => {
  const u = 1 - t;
  return 1 - u * u * u;
};

/** Symmetric cubic ease-in-out. */
export const cubicInOut: Easing = (t) => {
  if (t < 0.5) return 4 * t * t * t;
  const u = 1 - t;
  return 1 - 4 * u * u * u;
};

/** Decelerates harder still — the "expensive" feel for a panel that slides in. This is the
 *  curve to reach for instead of an expo easing, which would cost the module its Tier A
 *  guarantee for a difference nobody can see. */
export const quartOut: Easing = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u;
};

/**
 * Pulls back below 0 before moving. Anticipation without a spring simulation.
 *
 * Because it leaves [0, 1], never drive an index, an array position, a colour channel or
 * anything clamped with it — the excursion is the effect, and clamping it away leaves a curve
 * that visibly stalls at its start.
 */
export const backIn: Easing = (t) => t * t * (t + BACK * (t - 1));

/** Overshoots past 1 and settles back. The same warning as `backIn`: it leaves [0, 1]. */
export const backOut: Easing = (t) => {
  const u = 1 - t;
  return 1 - u * u * (u + BACK * (u - 1));
};

/**
 * Four decaying bounces, piecewise quadratic.
 *
 * Chosen over the usual damped sine so the whole module stays Tier A — see the module note.
 * It stays inside [0, 1] and touches 1 at each bounce apex, so it is safe on a clamped value,
 * unlike the `back` pair.
 */
export const bounceOut: Easing = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) {
    const s = t - 1.5 / 2.75;
    return 7.5625 * s * s + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const s = t - 2.25 / 2.75;
    return 7.5625 * s * s + 0.9375;
  }
  const s = t - 2.625 / 2.75;
  return 7.5625 * s * s + 0.984375;
};

/** `smoothstep(0, 1, t)`: symmetric, zero derivative at both ends. Clamped, so — with
 *  `smoother` — it is one of the two curves here that tolerate a `t` outside [0, 1] rather
 *  than extrapolating into a shape nobody designed. */
export const smooth: Easing = (t) => smoothstep(0, 1, t);

/**
 * Ken Perlin's quintic: zero *second* derivative at both ends as well as the first.
 *
 * Use it when the curve drives a value that is itself differentiated — a camera pan, where a
 * discontinuity in acceleration reads as a jolt at the start and end of the move even though
 * the position and the velocity are both continuous.
 */
export const smoother: Easing = (t) => {
  const u = clamp01(t);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/**
 * Every curve above, keyed by name.
 *
 * This is what lets a tween be authored as *data* — `{ ease: 'backOut' }` in a config object,
 * a level file or a save — without every consumer growing its own string-to-function switch,
 * each with a different fallback for an unknown name. `loop`'s tween API takes
 * `Easing | EasingName` and resolves through this table.
 *
 * A frozen object literal, not a table built by a loop: a loop would run on every import of
 * the package, including in a bundle that only wanted `clamp`.
 */
export const EASINGS: Readonly<Record<EasingName, Easing>> = Object.freeze({
  linear,
  quadIn,
  quadOut,
  quadInOut,
  cubicIn,
  cubicOut,
  cubicInOut,
  quartOut,
  backIn,
  backOut,
  bounceOut,
  smooth,
  smoother,
});

/**
 * Run a curve backwards: `reverse(quadIn)` is the corresponding out-curve.
 *
 * A combinator instead of thirty more constants — and the reason the table above has no
 * `quartIn` or `bounceIn`. Allocates one closure per call, so hoist it to module scope or
 * build it at setup; calling `reverse` inside a frame allocates a function per frame, which
 * is the shape of garbage collection pause that non-negotiable #7 exists to prevent.
 *
 * Endpoints survive: if `e(0) === 0` and `e(1) === 1`, so does the reversal.
 */
export function reverse(easing: Easing): Easing {
  return (t) => 1 - easing(1 - t);
}

/**
 * Mirror an in-curve into a symmetric in-out curve: the first half is the curve at double
 * speed and half scale, the second half is its reflection.
 *
 * Same reason as `reverse`, and the same allocation warning. `inOut(quadIn)` reproduces
 * `quadInOut` to within rounding; the named constants exist because they are one polynomial
 * rather than two calls, and this exists for the curves that have no named in-out form.
 */
export function inOut(easing: Easing): Easing {
  return (t) => (t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2);
}
