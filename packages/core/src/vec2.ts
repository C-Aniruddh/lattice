/**
 * 2D vectors, written for the frame budget rather than for the call site.
 *
 * **Every function that produces a vector takes `out` first and returns it.** That is
 * non-negotiable #7 made concrete: at 400 sprites and 60Hz a returned `{ x, y }` is 24,000
 * allocations a second, and a garbage collector pause with a pleasant API is still a pause.
 * `out` comes first rather than last so the writable argument is visible at a glance at every
 * call site in the kit — you never have to read to the end of the line to find out what got
 * clobbered.
 *
 * **`Vec2` is mutable on purpose, and the read side is a separate type.** `Vec2` is assignable
 * to `ReadonlyVec2`; `ReadonlyVec2` is not assignable to `Vec2`. The assignability runs
 * exactly one way and it is the useful way, so a caller declares everything — variables,
 * fields, scratch, array elements — as `Vec2`, and `ReadonlyVec2` appears only inside
 * signatures, on parameters that are read. Nobody converts and no call site has to choose.
 * There is deliberately no `MutableVec2` in this kit. That one-way rule needs one line of
 * machinery to be true at all — `readonly` alone does not do it — and the note on
 * `READONLY_VEC2` below is the one place in the kit that explains why.
 *
 * **The aliasing rule.** Every function here is safe to call with `out` aliasing any input:
 * `v2Add(a, a, b)` and `v2Normalize(a, a)` do what you expect. That is not free — it is why
 * each body reads every component it needs into a local before writing a single one. Adding a
 * function that writes `out.x` before reading `a.y` breaks it silently for exactly the callers
 * who were being careful about allocation.
 *
 * **The returned reference is the one you passed in.** `const mid = v2Lerp(scratch, a, b, 0.5)`
 * hands you `scratch`, and the next call overwrites it. A value that must survive the frame is
 * copied into a vector the caller owns.
 *
 * Three functions here are Tier B — `v2Rotate`, `v2Angle`, `v2FromAngle` — and each says so.
 * Everything else is Tier A: `+ - * /` and `Math.sqrt` only.
 */

import { EPSILON } from './math.js';

/**
 * The phantom that makes the one-way assignability real.
 *
 * **`readonly` on a property is not enough, and this is the surprise that costs the kit its
 * whole out-parameter guarantee if it is missed.** TypeScript deliberately ignores `readonly`
 * property modifiers when it checks assignability between object types: given nothing but
 * `{ readonly x, readonly y }` and `{ x, y }`, *each* is assignable to the other, so a frozen
 * shared constant passes as an `out` without a word of complaint and throws a `TypeError` on
 * the frame that path first executes.
 *
 * So the two types carry a phantom optional property whose declared types conflict in exactly
 * one direction: `never` on the writable side, `true` on the read side. `never` is assignable
 * to `true`, so `Vec2` still flows into `ReadonlyVec2` — the direction callers need every
 * line. `true` is not assignable to `never`, so `ReadonlyVec2` does not flow back. Optional on
 * both, so a plain `{ x: 0, y: 0 }` literal, a class field, and any foreign `{x, y}` still
 * satisfy either type with nothing to declare.
 *
 * It is erased at runtime and costs zero bytes. The one gap worth knowing: `Readonly<Vec2>`
 * (the utility type) is *not* this type — it keeps the `never` and is still assignable to
 * `Vec2`. Write `ReadonlyVec2`.
 */
declare const READONLY_VEC2: unique symbol;

/**
 * A mutable 2D point — the storage, scratch and output type of the whole kit.
 *
 * Mutable **on purpose**: an out-parameter API cannot take a readonly type, and making the
 * fields `readonly` here would force a second writable interface into every signature that
 * fills one. Declare your variables and your entity fields as this — there is deliberately no
 * `MutableVec2` in the kit, because there is only ever one type a caller declares.
 */
export interface Vec2 {
  x: number;
  y: number;
  /** Phantom. Never present at runtime; see `READONLY_VEC2` above for what it buys. */
  readonly [READONLY_VEC2]?: never;
}

/**
 * The read side. Use it for any parameter a function does not write to.
 *
 * `Vec2` is assignable to it, so a caller never converts and no call site has to choose. The
 * reverse is not, which is what stops a frozen shared constant —
 * `const ORIGIN: ReadonlyVec2 = Object.freeze(v2(0, 0))` — being handed in as an output
 * parameter. That rejection happens at compile time, where the alternative is a `TypeError`
 * thrown in strict mode on the one frame that path executes, in the one build nobody
 * type-checked.
 */
export interface ReadonlyVec2 {
  readonly x: number;
  readonly y: number;
  /** Phantom, and the half of the pair that does the work. See `READONLY_VEC2` above. */
  readonly [READONLY_VEC2]?: true;
}

/**
 * Allocate a vector.
 *
 * The one function here that allocates, and the reason every other one does not. Call it at
 * setup, when an entity is created, or to build the scratch vectors a system reuses — never
 * inside a loop that runs per frame or per entity. If you find yourself writing `v2(` inside
 * a render pass, the fix is a scratch vector hoisted to module or system scope.
 */
export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

/** Write components into `out`. The assignment form, so a system can set a position without
 *  naming both fields at every call site and without allocating a temporary to copy from. */
export function v2Set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

/** Copy `a` into `out`. This — not assignment — is how a value escapes a scratch vector: `p =
 *  scratch` aliases the scratch and every later write to it silently moves `p`. */
export function v2Copy(out: Vec2, a: ReadonlyVec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

/** `out = a + b`. */
export function v2Add(out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

/** `out = a - b`. Note the order: this is the vector *from* `b` *to* `a`, which is the
 *  direction a "look at" or a separation impulse needs reversed. */
export function v2Sub(out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

/** `out = a * scalar`. */
export function v2Scale(out: Vec2, a: ReadonlyVec2, scalar: number): Vec2 {
  out.x = a.x * scalar;
  out.y = a.y * scalar;
  return out;
}

/**
 * `out = a + b * scalar` — the integration step, without a temporary.
 *
 * `v2AddScaled(pos, pos, velocity, dt)` is one call where the obvious spelling is a scale into
 * a scratch and then an add. It exists because that scratch is per entity per frame in the
 * only code path that runs for every entity every frame.
 */
export function v2AddScaled(
  out: Vec2,
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  scalar: number,
): Vec2 {
  out.x = a.x + b.x * scalar;
  out.y = a.y + b.y * scalar;
  return out;
}

/**
 * `out = (1 - t) * a + t * b`, component-wise and unclamped.
 *
 * Written in the same expensive form as `lerp` for the same reason: at `t === 1` it lands on
 * `b` exactly, so a tween that finishes leaves the sprite on its tile rather than a
 * sub-pixel off it forever.
 */
export function v2Lerp(out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2, t: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  out.x = (1 - t) * ax + t * b.x;
  out.y = (1 - t) * ay + t * b.y;
  return out;
}

/** Dot product. Zero when perpendicular; its sign says whether `b` points with or against
 *  `a`, which is how a facing test is written without a single trig call. */
export function v2Dot(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * The z component of the 3D cross product.
 *
 * The sign tells you which side of `a` the point `b` lies on — positive is counter-clockwise.
 * This is how `iso` decides facing and polygon winding, and it is exact: a comparison of two
 * cross products orders two directions without an `atan2` anywhere, which keeps depth sorting
 * in Tier A.
 */
export function v2Cross(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Squared length. Prefer it to `v2Len` for comparisons and radius tests: it is exact where
 *  the square root is merely correctly rounded, and it is a multiply instead of a `sqrt`. */
export function v2LenSq(a: ReadonlyVec2): number {
  return a.x * a.x + a.y * a.y;
}

/** Length. `Math.sqrt` is one of the operations ECMA-262 specifies exactly, so this stays
 *  Tier A — unlike `Math.hypot`, which is not specified exactly and is slower. */
export function v2Len(a: ReadonlyVec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

/** Squared distance. The one to use inside a proximity loop — see `v2LenSq`. */
export function v2DistSq(a: ReadonlyVec2, b: ReadonlyVec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Distance between two points. */
export function v2Dist(a: ReadonlyVec2, b: ReadonlyVec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Unit vector in the direction of `a`, or `(0, 0)` when `a` has no length.
 *
 * Returning `(0, 0)` rather than `NaN` is deliberate and is the single most valuable decision
 * in this module. A `NaN` position propagates silently through a whole scene graph — every
 * add, every lerp, every projection downstream of it — and surfaces as an invisible sprite
 * three systems away from the zero-length subtraction that caused it. A zero vector is wrong
 * in an obvious, local, debuggable way.
 *
 * A `NaN` or infinite input yields `(0, 0)` for the same reason, as does a vector whose
 * squared length overflows to `Infinity` (components beyond ~1e154) — there is no direction
 * to recover once the sum has saturated, and the alternative is `NaN` again.
 *
 * The squared length is also where the precision floor sits: components below ~1e-154 square
 * into the subnormal range and the direction loses digits, and below ~1e-162 they underflow to
 * zero and this returns `(0, 0)`. No game coordinate is within a hundred orders of magnitude
 * of that, which is why the fast form is the right one.
 */
export function v2Normalize(out: Vec2, a: ReadonlyVec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  const lenSq = ax * ax + ay * ay;
  if (lenSq > 0 && lenSq < Infinity) {
    // Two divisions rather than one reciprocal and two multiplies. The reciprocal is the
    // classic optimisation and it is wrong here: `3 * (1 / 5)` is 0.6000000000000001 where
    // `3 / 5` is 0.6, and a normal that is not exactly axis-aligned puts a wall one ulp off
    // its own tile edge. Division is correctly rounded by specification, so this stays Tier A.
    const len = Math.sqrt(lenSq);
    out.x = ax / len;
    out.y = ay / len;
    return out;
  }
  out.x = 0;
  out.y = 0;
  return out;
}

/**
 * Rotate 90° counter-clockwise: `(-y, x)`.
 *
 * Exact, no trigonometry, and it is what almost every "perpendicular" in a game actually
 * needs — a normal for a wall segment, an offset for a parallel line, the side vector of a
 * heading. Note the local reads in the body: written the obvious way, `v2Perp(a, a)` would
 * clobber `a.x` before reading it and produce `(-y, -y)`.
 */
export function v2Perp(out: Vec2, a: ReadonlyVec2): Vec2 {
  const ax = a.x;
  const ay = a.y;
  // `0 - ay`, not `-ay`: negating a zero component gives `-0`, which `JSON.stringify` writes
  // as `"0"` — so a wall normal derived from an axis-aligned edge would come back from a save
  // as a different value than it went in, and fail an integrity comparison for a reason
  // nobody finds. Axis-aligned edges are most of them in a tile game.
  out.x = 0 - ay;
  out.y = ax;
  return out;
}

/** Component-wise comparison within `epsilon` (default `EPSILON`), inclusive. Named `approx`
 *  and not `equals` so that no call site reads as exact — two positions that pass this may
 *  still hash and serialise differently. */
export function v2Approx(a: ReadonlyVec2, b: ReadonlyVec2, epsilon: number = EPSILON): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return (dx < 0 ? -dx : dx) <= epsilon && (dy < 0 ? -dy : dy) <= epsilon;
}

/**
 * Rotate `a` counter-clockwise by `radians`.
 *
 * @tier-b — `Math.cos` and `Math.sin`, which ECMA-262 does not require to be correctly
 *   rounded. **Presentation only:** a rotated position may differ in its last bit between two
 *   engines, so never hash it, never write it to a save, and never compare it for replay
 *   equality. Store the angle (Tier A, it is just a number you chose) and rotate at draw time.
 *   For the quarter turn, use `v2Perp`, which is exact.
 */
export function v2Rotate(out: Vec2, a: ReadonlyVec2, radians: number): Vec2 {
  const ax = a.x;
  const ay = a.y;
  // @tier-b: Math.cos/Math.sin — presentation only, never hashed or persisted.
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out.x = ax * c - ay * s;
  out.y = ax * s + ay * c;
  return out;
}

/**
 * The direction of `a` as an angle in `(-PI, PI]`, measured counter-clockwise from +x.
 *
 * `v2Angle(0, 0)` is `0` because that is what `Math.atan2(0, 0)` returns — a zero vector has
 * no direction, and the value is meaningless rather than wrong. Check the length first if the
 * distinction matters.
 *
 * @tier-b — `Math.atan2`. Presentation only. If you need to *order* two directions rather
 *   than name them, `v2Cross` does it exactly and faster.
 */
export function v2Angle(a: ReadonlyVec2): number {
  // @tier-b: Math.atan2 — presentation only, never hashed or persisted.
  return Math.atan2(a.y, a.x);
}

/**
 * Build a vector of the given `length` (default 1) pointing at `radians`.
 *
 * @tier-b — `Math.cos` and `Math.sin`. Presentation only: a position produced from an angle
 *   is a Tier B value from then on, and everything computed from it inherits that. Keep the
 *   angle in your state and derive the vector each frame rather than the other way round.
 */
export function v2FromAngle(out: Vec2, radians: number, length = 1): Vec2 {
  // @tier-b: Math.cos/Math.sin — presentation only, never hashed or persisted.
  out.x = Math.cos(radians) * length;
  out.y = Math.sin(radians) * length;
  return out;
}
