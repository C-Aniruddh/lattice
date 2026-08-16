/**
 * `@lattice/core` — deterministic primitives. Zero dependencies, zero DOM, layer 0.
 *
 * Everything else in the kit is built on this file, and nothing in it is built on anything.
 * That is the whole design: `core` imports nothing, holds no module-level mutable state, and
 * reads no clock. Seeds and timestamps arrive as parameters.
 *
 * ## The two tiers, because "deterministic" was two claims wearing one word
 *
 * ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators exactly.
 * It explicitly does *not* require `sin`, `cos`, `pow`, `exp` or `log` to be correctly
 * rounded, so two conforming engines may disagree in the last bit.
 *
 * | | arithmetic | promise | may reach |
 * |---|---|---|---|
 * | **Tier A** | `+ - * /`, `sqrt`, `imul`, bitwise | bit-identical on every engine | hashes, save files, replays, anything |
 * | **Tier B** | `sin`, `cos`, `pow`, … | correct to within an ulp or so | pixels only — never hashed, never persisted |
 *
 * Tier B is four symbols and five call sites in this package, every one marked `@tier-b` and
 * checked by `npm run lint`. There are deliberately **no sine or expo easings** in the kit.
 *
 * And one thing Tier A does *not* promise: a round trip through JSON. `Infinity` is a
 * perfectly Tier A result and is precisely the value that does not survive being written
 * down — it serializes to `null`, with a valid checksum, so nothing downstream can detect
 * it. That is what {@link expectSerializable} and {@link isSerializable} are for.
 */

// ── rng, hash, noise ────────────────────────────────────────────────────────────
//
// Sub-streams fork from a stream's *identity*, not its cursor, so a draw made out of order
// somewhere else cannot reshuffle this one. `hash*` is stateless by contrast: four packages
// asked for it independently — persist's checksums, iso's per-tile scramble, audio's
// sequencer rolls, draw's cache keys — and what they share is needing a value that depends
// only on its coordinates, not on how many times anything else was drawn, played or saved
// first. Do not fold `hash` back into `rng`; that proposal will arrive sounding like tidying.

export { Rng, createRng } from './rng.js';
export type { RngSnapshot } from './rng.js';

export {
  mix32,
  hashString,
  hashNumber,
  hashStep,
  hashParts,
  hash2,
  hash3,
  hashBytes,
  toUnit,
} from './hash.js';

export { noise2, noise3, fbm2, fbm3 } from './noise.js';

// ── maths, easing, vectors ──────────────────────────────────────────────────────
//
// `Vec2` is mutable on purpose: every hot-path API in the kit takes an output parameter, and
// a readonly type there would force a second type on every signature. `ReadonlyVec2` is the
// read half, and it is a real barrier rather than a `readonly` modifier — TypeScript ignores
// those when checking assignability. Import `ReadonlyVec2`; never hand-write `Readonly<Vec2>`
// and assume it is the same thing.

export {
  TAU,
  EPSILON,
  clamp,
  clamp01,
  lerp,
  inverseLerp,
  remap,
  smoothstep,
  mod,
  wrap,
  moveTowards,
  damp,
  approx,
} from './math.js';

export {
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
  EASINGS,
  reverse,
  inOut,
} from './easing.js';
export type { Easing, EasingName } from './easing.js';

export {
  v2,
  v2Set,
  v2Copy,
  v2Add,
  v2Sub,
  v2Scale,
  v2AddScaled,
  v2Lerp,
  v2Dot,
  v2Cross,
  v2LenSq,
  v2Len,
  v2DistSq,
  v2Dist,
  v2Normalize,
  v2Perp,
  v2Approx,
  v2Rotate,
  v2Angle,
  v2FromAngle,
} from './vec2.js';
export type { Vec2, ReadonlyVec2 } from './vec2.js';

// ── time ────────────────────────────────────────────────────────────────────────
//
// Types, not clocks. `core` still reads no time. `EpochMillis` and `MonotonicMillis` are
// branded because they are both `number` and silently interchangeable, and passing a
// monotonic reading where a wall-clock epoch is expected is the most damaging substitution
// available in the kit — `loop.time` runs at roughly quarter speed in a hidden tab.

export { asEpochMillis, asMonotonicMillis } from './time.js';
export type { EpochMillis, MonotonicMillis, Now, MonotonicNow } from './time.js';

// ── lifetime, validation, pooling, events ───────────────────────────────────────
//
// `Scope` replaced five teardown vocabularies with one, and deleted a sixth as it landed.
// `guard`'s validators return their argument rather than taking a boolean, because a boolean
// has already discarded the value that was wrong and so cannot name it in the error.

export { createScope } from './dispose.js';
export type { Disposer, Scope } from './dispose.js';

export { Emitter } from './events.js';

export { Pool } from './pool.js';
export type { PoolOptions } from './pool.js';

export {
  expectFinite,
  expectInt,
  expectRange,
  expectIndex,
  expectNonEmpty,
  expectSerializable,
  isSerializable,
  expectSafeInteger,
  expectObject,
  expectRecordOfFinite,
  unreachable,
} from './guard.js';

// ── formatting ──────────────────────────────────────────────────────────────────
//
// Presentation, and the one module here whose place is genuinely uncertain: `ui` declined to
// import it, leaving `draw` as its only consumer. It imports nothing, not even from the rest
// of core, so moving it out stays a file rename for as long as nobody builds on it.

export {
  COMPACT_SUFFIXES,
  fmtCompact,
  fmtSigned,
  fmtInteger,
  fmtRate,
  fmtPercent,
  fmtDuration,
} from './format.js';
export type { DurationStyle } from './format.js';
