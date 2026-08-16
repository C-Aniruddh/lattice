/**
 * Scalar maths, in the exact forms the rest of the kit depends on.
 *
 * Everything here is Tier A — `+ - * /`, `Math.abs`, `Math.sqrt`, comparison — and therefore
 * bit-identical on every conforming engine, safe to feed a hash, a save file or a replay.
 * The single exception is `damp`, which is marked `@tier-b` and is presentation-only.
 *
 * The forms matter more than the functions. `lerp` is written the expensive way on purpose,
 * `mod` exists because `%` is not a modulo, and `damp` exists because the smoothing everyone
 * writes by hand is frame-rate dependent. Each doc comment below names the bug the naive
 * version ships.
 *
 * Nothing in this module allocates: no object literal, no array, no closure. It is called
 * per entity per frame by four packages downstream.
 */

/**
 * Full turn in radians.
 *
 * Present because `2 * Math.PI` otherwise appears in every package in the kit and half of
 * them eventually write `6.28`, which is a fifth of a degree short and shows up as a seam
 * where a swept arc fails to close.
 */
export const TAU = Math.PI * 2;

/**
 * The kit's default comparison tolerance: `1e-9`.
 *
 * Deliberately *not* `Number.EPSILON`, which is the gap between representable doubles near
 * 1.0 (~2.2e-16) and is a property of the format rather than of the game. Comparing world
 * positions against `Number.EPSILON` means "approximately" never returns true and every
 * settle-detection loop runs forever.
 */
export const EPSILON = 1e-9;

/**
 * Constrain `value` to `[min, max]`.
 *
 * `NaN` propagates rather than snapping to a bound: both comparisons are false, so a `NaN`
 * comes back out. That is the wanted behaviour — a clamp that silently turned `NaN` into
 * `min` would hide the division by zero that produced it until it reached the screen.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** `clamp(value, 0, 1)`. The normalised-time and normalised-progress case, which is most of
 *  them; spelled out so call sites do not carry two magic numbers. */
export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Linear interpolation, in the precise form `(1 - t) * a + t * b`.
 *
 * NOT `a + (b - a) * t`, which is one operation cheaper and does **not** return exactly `b`
 * at `t === 1`. A tween that ends at 0.9999999 of its target leaves a sprite a sub-pixel off
 * its tile forever, which presents as text that looks slightly blurry and never as a bug in
 * the tween. No test that checks "approximately" catches it, so the form is the contract:
 * `lerp(a, b, 0) === a` and `lerp(a, b, 1) === b`, exactly, for every finite pair.
 *
 * Unclamped: `t` outside [0, 1] extrapolates, which is what makes it usable for overshoot.
 */
export function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b;
}

/**
 * Where `value` sits between `a` and `b`, as a fraction. The inverse of `lerp`.
 *
 * Returns `0` when `a === b` rather than `NaN`, because the degenerate case is a progress
 * bar with no range or a gradient with one stop — a display with nothing to show, not an
 * arithmetic fault. A `NaN` here would propagate through the whole layout before anyone saw
 * it, and it would surface as an invisible element rather than as a divide by zero.
 */
export function inverseLerp(a: number, b: number, value: number): number {
  const span = b - a;
  if (span === 0) return 0;
  return (value - a) / span;
}

/**
 * Move `value` from one range to another: `inverseLerp` then `lerp`, **unclamped**.
 *
 * The workhorse for turning a noise sample in [-1, 1] into a game quantity, or a progress
 * value into a pixel. Unclamped because clamping is a separate decision — a caller that
 * wants the ends held calls `clamp` on the result and can see it doing so; a caller that
 * wants extrapolation cannot recover it from a version that clamped.
 *
 * A zero-width input range yields `outMin`, following `inverseLerp`.
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
}

/**
 * Hermite smoothstep, clamped to [0, 1].
 *
 * The zero derivative at both endpoints is the entire point: a linear fade meets flat colour
 * at an angle, and the eye reads that discontinuity in the *slope* as a visible band even
 * though the value itself is continuous. Fog, vignettes, distance culling and audio
 * crossfades all want this rather than `clamp01`.
 *
 * `edge0 === edge1` returns 0 rather than `NaN`, per `inverseLerp`.
 */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
}

/**
 * Euclidean modulo: the result carries the sign of `divisor`, never of `value`.
 *
 * `-1 % 8` is `-1` in JavaScript, which indexes off the front of every wrap-around table in
 * the kit — tile lookups west of the origin, hue wrapping below zero, a ring buffer stepped
 * by a negative delta. Each of those reads as a rendering glitch in one quadrant of the map,
 * never as an arithmetic mistake. Use this and never the operator on a value that can be
 * negative.
 *
 * `mod(v, 0)` is `NaN`, as the operator is: a zero divisor has no answer to give.
 */
export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Wrap `value` into the half-open range `[min, max)`.
 *
 * Half-open on purpose: `max` maps back to `min`, so an angle of exactly `TAU` and an angle
 * of `0` are the same heading and a tiling coordinate at the seam belongs to exactly one
 * tile. A closed range would let two representations of one position compare unequal.
 *
 * Built on `mod`, so negative inputs behave.
 */
export function wrap(value: number, min: number, max: number): number {
  return min + mod(value - min, max - min);
}

/**
 * Step at most `maxDelta` toward `target`, never overshooting.
 *
 * The Tier A alternative to `damp` for anything a replay depends on: constant speed, exact
 * arithmetic, and it *arrives* — it reaches `target` exactly and stays, where exponential
 * smoothing only ever approaches. Use it for a build timer, a resource transfer, or any
 * motion whose end state is compared for equality.
 *
 * A negative `maxDelta` holds position rather than stepping away from the target: a negative
 * distance is a sign error at the call site, and turning it into motion nobody ordered is
 * how it stays hidden.
 */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  const step = maxDelta > 0 ? maxDelta : 0;
  if (delta <= step && delta >= -step) return target;
  return current + (delta > 0 ? step : -step);
}

/**
 * Frame-rate-independent exponential smoothing — the correct form of "ease toward target".
 *
 * `current += (target - current) * 0.1`, the version everyone writes, converges at a rate
 * proportional to frame rate: twice as fast at 120Hz as at 60Hz, and differently again on a
 * machine that drops frames. The camera then follows tighter on a better monitor, which
 * nobody files a bug for and everybody feels. This takes `dt` and a rate `lambda` (larger is
 * snappier, units of 1/second) and lands in the same place at any step size.
 *
 * `lambda * dt` is the whole model: at `lambda = 1` the remaining distance falls by a factor
 * of `e` per second.
 *
 * @tier-b — uses `Math.exp`, which ECMA-262 does not require to be correctly rounded, so two
 *   engines may disagree in the last bit. **Presentation only.** Never feed the result to a
 *   hash, a save file, or a replay comparison; use `moveTowards` when the motion must be
 *   Tier A.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  // @tier-b: Math.exp — presentation only, never hashed or persisted.
  return target + (current - target) * Math.exp(-lambda * dt);
}

/**
 * Absolute-difference comparison against `epsilon` (default `EPSILON`), inclusive.
 *
 * Named `approx` and not `equals` so that no call site can be read as an exact comparison —
 * the name is the documentation at the place it is needed. Use it for settle detection and
 * for tests; never for a value that keys a map or gates a save, where two "equal" values
 * must be `Object.is`-equal.
 *
 * `NaN` is never approximately anything, including itself.
 */
export function approx(a: number, b: number, epsilon: number = EPSILON): boolean {
  const d = a - b;
  return (d < 0 ? -d : d) <= epsilon;
}
