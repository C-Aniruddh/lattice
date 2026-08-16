# RFC: `@lattice/core`

- **Status:** proposed
- **Layer:** 0 — imports nothing, from npm or from this repo
- **Environment:** isomorphic. No DOM, no Node builtins, no timers, no clock
- **Owner of this document:** `lattice-architect` (task A1)
- **Amends `.lattice/kit.json`:** yes — see [§3.0](#30-the-module-list-argued-with)

The signatures in §3 are written with `declare` so the whole section can be pasted into a
`.ts` file under the repo's `tsconfig.base.json` (`strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`) and type-checked as-is.

---

## 1. The one sentence

**`@lattice/core` is the set of primitives that every other Lattice package needs and that
must produce the same bits on every machine — so that a seed and an input log replay to the
same pixel, on a phone, in CI, and on a server.**

If a proposed addition is not *needed by two packages in different layers* and not
*deterministic*, it does not belong here. That test is the whole charter, and §4 is the
list of things it has already rejected.

---

## 2. The five-line example

This is written before the API on purpose. The API below exists to serve it.

```ts
import { createRng, fbm2, remap, fmtCompact } from '@lattice/core';

const run = createRng('run:42');                              // one seed owns the session
const terrain = run.derive('terrain');                        // a fork that ignores draw order
const height = fbm2(terrain.seed, tx * 0.06, ty * 0.06, 4);   // [-1, 1], bit-identical anywhere
const ore = Math.round(remap(height, -1, 1, 0, 12_500));      // 0 … 12500
const label = fmtCompact(ore);                                // '9.4K' — never wider than six chars
```

Five lines, four modules, and every hard decision in the package is visible in them:

| the line | what it forces on the API |
|---|---|
| `createRng('run:42')` | seeds are hashed, so `'run:41'` and `'run:42'` are uncorrelated streams, not adjacent ones. Strings and numbers both work. |
| `run.derive('terrain')` | forks come from the stream's **identity**, never its cursor. Terrain must not change because the UI drew a sparkle first. |
| `fbm2(terrain.seed, …)` | noise takes a `uint32` seed, not an `Rng`. It is a pure function of its arguments — no cursor, no order dependence, and a tile can be regenerated in isolation years later. |
| `remap(…)` | the arithmetic helpers are free functions on `number`. No wrapper types, no chaining, no allocation. |
| `fmtCompact(ore)` | formatting is in layer 0 because `draw` (canvas text) and `ui` (DOM text) both need it and neither may depend on the other. |

Note what is *not* in the example: no `new`, no config object, no `init()`, no context. Core
has no setup step and no module-level state. That is not an accident — see §5.1.

---

## 3. The full public surface

### 3.0 The module list, argued with

`.lattice/kit.json` declares nine modules: `rng, noise, math, easing, vec2, events, pool,
format, assert`. Two changes are proposed.

| change | why |
|---|---|
| **split `hash` out of `rng`** | `persist` needs a checksum for its integrity check, `draw` needs a stable key for its sprite cache, and `iso` needs a stable per-tile scramble. All three will otherwise write their own 32-bit hash, and we will end up with three. The mixing functions are already inside `rng`; exporting them as their own module costs nothing and pre-empts three duplicates. `rng` then imports `hash`. |
| **rename `assert` → `guard`** | a module called `assert` invites `assert(cond, 'message')`. That form cannot name the offending value (it only sees a boolean), which violates non-negotiable #9, and it is the exact shape that build tools strip in production — so the check exists only where it is least needed. `guard` exports *validators that return the value*, so the check is load-bearing and cannot be stripped. See §4.4. |

Two more modules arrived after the first draft was accepted, both requested by packages
designed against it, and both **vocabulary rather than machinery** — which is the only
category that clears the charter once core exists:

- **`time`** (§3.12) — `loop`, `persist` and `sim` all name the calendar and are siblings,
  so there is no home for it below core. Types and two validators; core still reads no clock.
- **`dispose`** (§3.13) — five packages had each invented a teardown vocabulary. This one
  *removes* an export (`events`' own `Unsubscribe`) as it lands.

A third request, `iso`'s priority queue, was **refused** and routed back — §4.9 gives the
reasoning at length. Both limits in [§4.0](#40-the-charter--what-core-will-never-grow-into)
have been accounted for there.

The resulting twelve modules:

| module | tier (§3.1) | one line |
|---|---|---|
| `hash` | A | 32-bit avalanche mixing for seeds, coordinates, cache keys and checksums |
| `rng` | A | the seeded stream: `Rng`, `createRng`, snapshots, forks |
| `noise` | A | value/gradient noise and fBm, as pure functions of a seed |
| `math` | A + one B | clamp, lerp, remap, euclidean mod, smoothstep, frame-rate-independent damping |
| `easing` | A | the named easing curves, and a name→curve table for data-driven tweens |
| `vec2` | A + three B | 2D vectors with output parameters |
| `events` | A | a typed emitter with deterministic dispatch order |
| `pool` | A | object reuse for the hot path |
| `format` | A | numbers a player can read at a glance, with no `Intl` |
| `guard` | A | argument validators that throw the error non-negotiable #9 demands |
| `time` | A | the calendar *type* — `EpochMillis` vs `MonotonicMillis`. No clock, no reading |
| `dispose` | A | `Disposer` and `Scope` — one teardown tree per scene, for all nine packages |

### 3.1 Two determinism tiers, stated once

This is the most important thing in the RFC after §4, because getting it wrong produces a
bug that only appears on one player's phone.

ECMA-262 specifies `+ - * / %`, `Math.sqrt`, `Math.abs`, `Math.floor/ceil/round/trunc`,
`Math.imul` and the bitwise operators **exactly**. It explicitly does *not* require
correctly-rounded results from `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log`, or
`cbrt` — implementations may differ in the last bits, and in practice they do.

So core declares two tiers, and every symbol below belongs to exactly one:

- **Tier A — bit-identical.** Uses only the exactly-specified operations. Safe to feed into
  the RNG, into persisted state, into anything a replay depends on. **Everything in core is
  Tier A unless the doc comment says otherwise.**
- **Tier B — platform-stable to within an ULP or two.** Touches a transcendental. Safe for
  presentation — a camera angle, a rotation, a smoothing curve — and **banned from anything
  whose output is hashed, persisted, or compared for replay equality.**

There are exactly four Tier B symbols: `damp`, `v2Rotate`, `v2Angle`, `v2FromAngle`. Each
one carries `@tier B` in its doc comment. `npm run lint` should reject a transcendental
inside any other core module (this needs a rule beyond the existing `Math.random`/`Date.now`
ban — routed to whoever owns `tools/`).

### 3.2 `hash`

> **Do not fold this module back into `rng`.** It was split out on a prediction, and the
> prediction has since been tested four times by packages that could not see each other's
> work: `persist` wanted a save checksum, `iso` a per-tile scramble, `audio` a stateless
> roll over `(bar, step, track)`, `draw` a sprite-cache key and a frame digest. Four
> independent callers, four different domains, one module — and only one of the four
> (`iso`, sometimes) also wanted an `Rng`. That is the strongest evidence in this repo that
> layer 0 is drawn in the right place, and it is recorded here because the fold-it-back
> proposal is the kind that sounds like tidying.
>
> The shape of the convergence is worth naming, because it is what the module is *for*:
> every one of those callers needed a value that depends **only on its coordinates** — a
> tile, a bar, a sprite key — and not on how many times anything else had been drawn,
> played or saved first. That is a different primitive from a random stream, and giving it
> a different module makes choosing correctly the obvious thing rather than the informed
> thing.

```ts
/**
 * murmurhash3's 32-bit finaliser (fmix32) — an avalanche bijection over uint32.
 *
 * Why it exists: seeds arrive in narrow ranges (0, 1, 2; tick indices; entity ids). Fed
 * to a generator raw, adjacent inputs produce visibly correlated first draws. This
 * spreads them across the whole 32-bit space first.
 */
export declare function mix32(value: number): number;

/**
 * Deterministic 32-bit hash of a string (xmur3-style, fmix32 finalise).
 *
 * Hashes by UTF-16 code unit, so "é" as U+00E9 and as U+0065 U+0301 hash differently.
 * Normalise (`.normalize('NFC')`) before hashing anything that crosses a platform
 * boundary or a save file. This is the one portability seam in the package.
 */
export declare function hashString(value: string): number;

/**
 * Fold an arbitrary finite number into a uint32 without discarding its high bits —
 * timestamps and ids both exceed 2^32, and truncating them collides millions of inputs.
 *
 * @throws RangeError if `value` is not finite.
 */
export declare function hashNumber(value: number): number;

/**
 * Fold one more value into a running hash. **This is the general mechanism; everything
 * below is a convenience over it.**
 *
 * `hash2` and `hash3` are literally two and three of these, unrolled — not separate
 * algorithms — which is why there is no `hash4` and never will be. Four coordinates is
 * `hashStep(hashStep(hashStep(hashStep(seed, a), b), c), d)`: still one expression, still
 * allocation-free, still the same avalanche. A package that needs five does the same
 * thing. Nothing gets added to core.
 *
 * The step avalanches the incoming value *before* combining it and avalanches the
 * accumulator *after*, which is what makes the result non-linear in every argument
 * independently. It is order-sensitive by construction: the nesting differs, so
 * `(a, b)` and `(b, a)` fold to different values.
 *
 * `value` is truncated to int32.
 */
export declare function hashStep(accumulator: number, value: number): number;

/**
 * Combine parts into one uint32, non-commutatively: `hashParts('a', 'b')` and
 * `hashParts('b', 'a')` differ. This is what makes `(worldSeed, chunkX, chunkY)` a usable
 * key. A `hashStep` fold, with string parts routed through `hashString` first.
 *
 * Variadic, so it allocates a rest array, and it accepts strings. Setup and cache keys,
 * not the hot path — use `hash2`/`hash3`/`hashStep` for numbers in a loop.
 *
 * @throws RangeError if called with no parts.
 */
export declare function hashParts(...parts: readonly (number | string)[]): number;

/**
 * White noise from a coordinate pair: a uint32 that is a pure function of
 * `(seed, x, y)` and nothing else. No stream, no cursor, no allocation.
 *
 * This is the per-tile variation primitive — grass tint, prop rotation, whether this
 * cobble is the cracked one. Drawing that from an `Rng` instead would make every tile's
 * appearance depend on the order tiles were visited, which locks a renderer into one
 * traversal order forever and breaks the moment anything culls, batches or re-sorts.
 *
 * The `seed` argument is not optional and not decorative: two systems sampling the same
 * tile (tree jitter and grass tint) must not receive the same number, or the jitter and
 * the tint correlate and the field reads as a visible grid. Give each system its own
 * constant, or `rng.derive('grass').seed`.
 *
 * `x` and `y` are truncated to int32. Fractional coordinates hash to their integer cell,
 * which is what a tile lookup wants and a surprise to anyone passing world pixels.
 */
export declare function hash2(seed: number, x: number, y: number): number;

/**
 * The same, over three integers — `hash2` plus one `hashStep`.
 *
 * It exists because two packages arrived at it independently from different domains:
 * `iso` samples a tile grid by `(x, y)` and needed a third axis for layers; `audio`'s
 * sequencer rolls per `(bar, step, track)`, where there is no stream position to advance
 * and no ordering guarantee between tracks — a track muted at load must not shift what
 * every other track plays. Two unrelated callers with the same shape is what a layer-0
 * primitive is for.
 *
 * Beyond three axes, fold with `hashStep` directly. That is the whole point of `hashStep`
 * being exported.
 */
export declare function hash3(
  seed: number, x: number, y: number, z: number,
): number;

/**
 * Digest an integer array — a frame buffer, a serialised save, any byte sequence.
 *
 * `draw`'s headless renderer digests a rendered frame to compare against a golden;
 * `persist` digests a serialised save to detect corruption. Neither can reach `hashString`
 * without first turning a megabyte of bytes into a string, which allocates the megabyte
 * again to hash it once.
 *
 * **Values are truncated to int32**, like every other input in this module. That is
 * correct for `Uint8Array`, `Uint8ClampedArray` and integer arrays generally, and silently
 * wrong for a `Float32Array` — every value between -1 and 1 truncates to zero, and the
 * digest of a float buffer becomes a digest of its length. View the bytes instead:
 * `new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)`.
 *
 * Length is folded in, so a run of trailing zeroes cannot be dropped without changing the
 * digest.
 */
export declare function hashBytes(seed: number, bytes: ArrayLike<number>): number;

/**
 * A uint32 as a float in [0, 1) — exactly `hashed / 2**32`, the same normalisation
 * `Rng.next` uses, so a hashed value and a drawn value are interchangeable in any
 * threshold test.
 *
 * Exists so `hash2` can stay integer-valued (callers who want a bucket want `% n`, not a
 * float they immediately re-scale) without every consumer writing the magic constant.
 */
export declare function toUnit(hashed: number): number;
```

`hashString` is 32-bit, which is a birthday collision at ~77,000 distinct inputs. That is
plenty for corruption detection and cache keys and **not** a content-address. It is not
cryptographic and never will be — see §4.

**There is deliberately no symbol named `hash32`** (requested by `draw`). Every function in
this module returns a uint32, so a name that describes only the output width says nothing
about which one to call, and it would sit in the import list next to four functions it could
plausibly be any of. The request maps onto existing surface: a sprite-cache key is
`hashString(key)` or `hashParts(kind, tint, zoom)`; a frame digest is `hashBytes(seed,
pixels)`. If a call site genuinely wants "the general one", it wants `hashParts`.

### 3.3 `rng`

Ported from `foom-simple-ui/src/core/rng.ts`, which shipped, with `weighted` and
`shuffleInPlace` added.

**On named sub-streams** (asked for by the `demo` RFC): `derive` *is* that feature, and it
is stronger than a convention. The source game solved cross-subsystem contamination by
passing fresh instances around by hand — a discipline that holds until one caller forgets.
`derive(label)` makes the whole class of bug unreachable instead, because it forks from the
stream's identity rather than its cursor: `world.derive('lamps')` returns the same stream
whether the valley has drawn zero times or a million, so buying a lamp out of order cannot
reshuffle the valley. Invariant 9 is the test for exactly that property, and invariant 10
covers the corollary — `derive('a','b')` and `derive('b','a')` must not collide.

The rule the demo should follow: **one `Rng` per subsystem, obtained by `derive`, never
shared.** Two subsystems on one stream is the bug; a stream per subsystem is free.

**On `rngFrom(seed)`** (asked for by `draw`, which has written cache invariants against the
answer): **no new export — `createRng(key)` is exactly that function, and it is the right
one.** It hashes its argument and returns a fresh, independent stream, so per-instance
sprite variation drawn from `createRng(spriteKey)` is identical whether the sprite is drawn
directly, drawn into a cache, or redrawn after an eviction. Nothing about it depends on how
many other sprites were drawn first, which is the hazard.

Two notes for that call site, since the cache key already exists by the time this is called:

- **Pass the key itself**, `createRng(key)`, not `createRng(hashString(key))`. `createRng`
  hashes internally, so the second form hashes twice — harmless, but it reads as though the
  first hash were load-bearing, and someone will later "optimise" the wrong one away.
- **Allocation is fine here and only here.** An `Rng` is a two-field object; one per cache
  *miss* is nothing. One per sprite per *frame* would violate non-negotiable #7 — if that is
  where this ends up, the answer is `hash2`/`hash3` with `toUnit`, which allocates nothing
  and needs no stream at all.

`derive` is for the other case: forking a child from a stream that already exists, where the
child must not move when the parent draws. `createRng` is for materialising a stream from a
key that already identifies the thing. Neither is a shared stream, which is the only property
that actually matters.

```ts
/**
 * A serialisable capture of an Rng's full internal state.
 *
 * `seed` is the stream's identity and never changes with drawing; `state` is the cursor
 * and advances once per draw. Both uint32, so this round-trips through JSON losslessly —
 * which is what lets `persist` store a stream mid-run.
 */
export interface RngSnapshot {
  readonly seed: number;
  readonly state: number;
}

/**
 * One deterministic random stream (mulberry32).
 *
 * Instances are mutable — each draw advances the cursor — and must NOT be shared between
 * subsystems. Two subsystems on one stream means the contents of each depend on how often
 * the other drew, which is a bug that only shows up as "the world changed when I opened
 * the menu". Use `derive` instead; that is the entire reason it exists.
 */
export declare class Rng {
  /** The stream's identity as a uint32. Invariant under drawing. */
  readonly seed: number;
  private state: number;
  private constructor(seed: number, state: number);

  /** @internal Prefer `createRng`. Exposed for `derive` and for snapshot restore. */
  static fromUint32Seed(seed: number): Rng;

  /** @throws RangeError if either field is not a uint32 — i.e. a corrupted save. */
  static fromSnapshot(snapshot: RngSnapshot): Rng;

  /** The raw generator: one mulberry32 step. Uniform over the full uint32 range. */
  nextUint32(): number;

  /**
   * A float in [0, 1). Exactly `nextUint32() / 2**32` — an integer below 2^32 over a
   * power of two is exactly representable as a double, so this is bit-identical
   * everywhere. Any other normalisation reintroduces rounding.
   */
  next(): number;

  /**
   * A uniform integer in [minInclusive, maxExclusive), by rejection sampling against the
   * largest multiple of the span that fits in a uint32. `% span` alone is biased toward
   * the low end of the range, which is visible in a loot table long before it is visible
   * in a test.
   *
   * @throws RangeError unless both bounds are integers, `max > min`, and the span <= 2^32.
   */
  int(minInclusive: number, maxExclusive: number): number;

  /** A float in [min, max), or exactly `min` when the bounds are equal.
   *  @throws RangeError unless both bounds are finite and `max >= min`. */
  float(min: number, max: number): number;

  /** A coin flip. `probability <= 0` never fires and `>= 1` always does, since `next()`
   *  is half-open. @throws RangeError if `probability` is not finite. */
  bool(probability?: number): boolean;

  /** A uniformly chosen element.
   *  @throws RangeError on an empty array — under `noUncheckedIndexedAccess` that is the
   *  only way to return `T` rather than `T | undefined`, and an empty pick is a caller
   *  bug in every case we have. */
  pick<T>(items: readonly T[]): T;

  /**
   * The index of a weighted choice. Weights need not sum to 1; zero weights are never
   * chosen. This exists because every game hand-rolls it and half of them accumulate in a
   * different order each call, which is a determinism bug with no symptom until replay.
   *
   * @throws RangeError if `weights` is empty, contains a negative or non-finite value, or
   *   sums to zero.
   */
  weighted(weights: readonly number[]): number;

  /** Fisher-Yates. Returns a NEW array; the input is never mutated, because callers pass
   *  frozen constant tables into this constantly. */
  shuffle<T>(items: readonly T[]): T[];

  /** Fisher-Yates in place, returning the same array. The hot-path form: shuffling a
   *  400-entry draw order every frame must not allocate a 400-entry array every frame. */
  shuffleInPlace<T>(items: T[]): T[];

  /**
   * Fork an independent child stream from this stream's IDENTITY, not its cursor.
   *
   * `rng.derive('scenery')` returns the same stream whether the parent has drawn zero
   * times or a million. That is what lets terrain stay byte-stable while the UI draws
   * freely, and what lets a per-tick stream be addressed as `derive('event', tick)`.
   *
   * Labels are order-sensitive: `derive('a', 'b') !== derive('b', 'a')`.
   *
   * @throws RangeError if called with no labels — an unlabelled fork is a clone, and
   *   silently sharing a stream is the exact bug this method exists to prevent.
   */
  derive(...labels: readonly (number | string)[]): Rng;

  /** Capture the full internal state. JSON-serialisable. */
  snapshot(): RngSnapshot;

  /** Restore in place when the identity matches, otherwise return a new instance —
   *  `seed` is readonly, and a stream that could change identity under you would make
   *  every `derive` call above it a lie. */
  restore(snapshot: RngSnapshot): Rng;

  /** An independent copy positioned exactly here. Advancing it never touches this one. */
  clone(): Rng;
}

/**
 * Create a stream from a numeric or string seed. The seed is hashed first, so `1`, `2`,
 * `3` — or `'level-1'`, `'level-2'` — are well-separated streams and not correlated ones.
 *
 * @throws RangeError if a numeric seed is not finite.
 */
export declare function createRng(seed: number | string): Rng;
```

### 3.4 `noise`

```ts
/**
 * 2D gradient noise in [-1, 1]. A pure function of (seed, x, y): no cursor, no setup, no
 * permutation table. A tile can therefore be regenerated in isolation, in any order, on
 * any machine, five versions later.
 *
 * Integer coordinates land on lattice points and return ~0; sample at a fractional scale
 * (`x * 0.06`) or you will get a field of zeroes and conclude the noise is broken.
 *
 * Coordinates must stay under ~2^24 in magnitude; beyond that the fractional part loses
 * resolution and the field visibly flattens.
 */
export declare function noise2(seed: number, x: number, y: number): number;

/** 3D gradient noise in [-1, 1]. The third axis is usually time — which is how a
 *  zero-asset kit animates water, smoke and glow without storing a single frame. */
export declare function noise3(seed: number, x: number, y: number, z: number): number;

/**
 * Fractal Brownian motion: `octaves` layers of `noise2`, each at twice the frequency and
 * `gain` times the amplitude, normalised back into [-1, 1].
 *
 * The normalisation is the point. Un-normalised fBm has a range that depends on the
 * octave count, so raising the detail of a terrain silently changes its sea level.
 *
 * Lacunarity is fixed at 2 rather than exposed: it is the only value anyone uses, it is a
 * power of two (so the frequency ladder stays exact), and a fourth positional number here
 * would be write-only code at every call site.
 *
 * @param octaves - default 4. Above ~8 the extra layers are below one screen pixel.
 * @param gain - default 0.5. Above 1 the sum diverges and the normalisation is meaningless.
 */
export declare function fbm2(
  seed: number, x: number, y: number, octaves?: number, gain?: number,
): number;

/** fBm over `noise3`. Same contract. */
export declare function fbm3(
  seed: number, x: number, y: number, z: number, octaves?: number, gain?: number,
): number;
```

### 3.5 `math`

```ts
/** Full turn in radians. Present because `2 * Math.PI` appears in every one of these
 *  packages otherwise, and half of them write `6.28`. */
export declare const TAU: number;

/** The comparison tolerance the kit uses by default: 1e-9. Not `Number.EPSILON`, which is
 *  a property of the representation near 1.0 and useless as a game-space tolerance. */
export declare const EPSILON: number;

export declare function clamp(value: number, min: number, max: number): number;
export declare function clamp01(value: number): number;

/**
 * Linear interpolation, in the precise form `(1 - t) * a + t * b`.
 *
 * NOT `a + (b - a) * t`, which is one operation cheaper and does not return exactly `b`
 * at `t === 1`. A tween that ends at 0.9999999 of its target leaves a sprite one
 * sub-pixel off its tile, forever, and no test that checks "approximately" will catch it.
 */
export declare function lerp(a: number, b: number, t: number): number;

/** Where `value` sits between `a` and `b`, as a fraction. Returns 0 when `a === b`
 *  rather than NaN, because the degenerate case is a bar with no range, not a bug. */
export declare function inverseLerp(a: number, b: number, value: number): number;

/** `inverseLerp` then `lerp`, unclamped. The workhorse for turning a noise field or a
 *  progress value into a game quantity. */
export declare function remap(
  value: number, inMin: number, inMax: number, outMin: number, outMax: number,
): number;

/** Hermite smoothstep, clamped to [0, 1]. The zero-derivative endpoints are what stop a
 *  fade or a fog band showing a visible seam where it meets flat colour. */
export declare function smoothstep(edge0: number, edge1: number, value: number): number;

/**
 * Euclidean modulo: the result carries the sign of `divisor`, never of `value`.
 *
 * `-1 % 8` is `-1` in JavaScript, which indexes off the front of every wrap-around table
 * in the kit — tile lookups west of the origin, hue wrapping below 0, ring buffers on a
 * negative delta. Use this and never the operator on a value that can be negative.
 */
export declare function mod(value: number, divisor: number): number;

/** Wrap into [min, max). Angles and tiling coordinates. Built on `mod`, so negatives
 *  behave. */
export declare function wrap(value: number, min: number, max: number): number;

/** Step at most `maxDelta` toward `target`, never overshooting. The Tier A alternative to
 *  `damp` when the motion must be replay-safe. */
export declare function moveTowards(
  current: number, target: number, maxDelta: number,
): number;

/**
 * Frame-rate-independent exponential smoothing: the correct form of "ease toward target".
 *
 * `current += (target - current) * 0.1` — the version everyone writes — converges twice as
 * fast at 120fps as at 60fps, so a camera follows differently on a better monitor. This
 * takes `dt` and a rate `lambda` (larger = snappier) and behaves identically at any
 * frame rate.
 *
 * @tier B — uses `Math.exp`. Presentation only. Never feed its output to a hash, a save,
 *   or a replay comparison.
 */
export declare function damp(
  current: number, target: number, lambda: number, dt: number,
): number;

/** Absolute-difference comparison against `epsilon` (default `EPSILON`). Named `approx`
 *  and not `equals` so nobody reads a call site as exact. */
export declare function approx(a: number, b: number, epsilon?: number): boolean;
```

### 3.6 `easing`

```ts
/** A curve from normalised time to normalised progress. `e(0) === 0` and `e(1) === 1` for
 *  every curve here; values in between may leave [0, 1] (that is what `back` is for). */
export type Easing = (t: number) => number;

export type EasingName =
  | 'linear'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'quartOut'
  | 'backIn' | 'backOut'
  | 'bounceOut'
  | 'smooth' | 'smoother';

export declare const linear: Easing;
export declare const quadIn: Easing;
export declare const quadOut: Easing;
export declare const quadInOut: Easing;
export declare const cubicIn: Easing;
export declare const cubicOut: Easing;
export declare const cubicInOut: Easing;
/** Decelerates harder than cubic. The "expensive" feel for a panel that slides in. */
export declare const quartOut: Easing;
/** Overshoots past 1 and settles. Anticipation without a spring simulation. */
export declare const backIn: Easing;
export declare const backOut: Easing;
/** Piecewise quadratic. Chosen over a damped sine so the whole module stays Tier A. */
export declare const bounceOut: Easing;
/** `smoothstep(0, 1, t)`. Symmetric, zero derivative at both ends. */
export declare const smooth: Easing;
/** Ken Perlin's quintic. Zero *second* derivative too — the one to use when a curve
 *  drives a value that is itself differentiated, like a camera pan. */
export declare const smoother: Easing;

/**
 * Every curve above, by name.
 *
 * This exists so a tween can be authored as data — `{ ease: 'backOut' }` in a config
 * object or a save file — without every consumer writing its own string→function switch.
 * `loop`'s tween API should take `Easing | EasingName` and resolve through this.
 */
export declare const EASINGS: Readonly<Record<EasingName, Easing>>;

/** Run a curve backwards: `reverse(quadIn)` is the out-curve. A combinator instead of
 *  thirty more constants. */
export declare function reverse(easing: Easing): Easing;

/** Mirror an in-curve into an in-out curve. Same reason. */
export declare function inOut(easing: Easing): Easing;
```

### 3.7 `vec2`

Every function that produces a vector takes `out` **first** and returns it. That is
non-negotiable #7 made concrete: at 400 sprites and 60Hz, a returned `{ x, y }` is 24,000
allocations a second.

#### The mutability ruling, and the rule for callers

`iso`, `draw`, `input` and `ui` all inherit this, so it is settled here once. **`Vec2` is
mutable.** `ui` and `iso` asked for this independently, and `draw`, `iso` and `ui` have all
now written signatures against a mutable `{ x, y }`; three packages agreeing before seeing
each other's work is the same evidence that settled the `hash` split. `iso` put the
mechanism most sharply — *an out-parameter API cannot take a `Readonly<Vec2>`* — and this
RFC adopts that reading: `AGENTS.md`'s
"`readonly` on every interface field that is not deliberately mutated" is *satisfied*, not
broken, because an output parameter is the definition of deliberately mutated. A `readonly`
`Vec2` would force a second writable type into every signature that fills one, and the kit
would carry `Vec2` and `MutableVec2` side by side with the compiler unable to tell anyone
which to pick.

The resolution is the pair already in the surface below, and the reason it does not become
that same two-type problem is one fact about structural typing:

> **`Vec2` is assignable to `ReadonlyVec2`. `ReadonlyVec2` is not assignable to `Vec2`.**

The assignability runs exactly one way, and it is the useful way. So there is only ever one
type a caller *declares* — `Vec2`, for every variable, field, scratch and array element —
and one that appears *only inside signatures*, `ReadonlyVec2`, on parameters that are read.
Nobody converts, nobody casts, and no call site has to choose.

Three rules, for every package downstream:

1. **Read-only parameters are `ReadonlyVec2`.** If a function does not write to it, it says
   so in the type. This costs the author one word and buys the caller the guarantee.
2. **Output parameters are `Vec2`, come first, and are returned.** `out` first is a
   convention worth more than argument-order aesthetics: it makes the writable argument
   visible at a glance at every call site in the kit.
3. **Declare a shared constant as `ReadonlyVec2` and freeze it.** `const ORIGIN: ReadonlyVec2
   = Object.freeze(v2(0, 0))` cannot be passed as an `out` — the compiler rejects it, rather
   than a frozen object throwing at runtime in strict mode on the one frame that path
   executes. This is the case that would otherwise justify a separate `Point` type; it does
   not, because the pair already covers it.

A distinct readonly `Point` type for values was considered and rejected: two names for one
shape means conversion functions, conversion functions mean allocation, and allocation in
this module is the thing the whole design exists to avoid.

```ts
/**
 * A mutable 2D point — the storage, scratch and output type. Mutable **on purpose**; see
 * the ruling above. Declare your variables and fields as this.
 */
export interface Vec2 { x: number; y: number; }

/**
 * The read side. Use it for any parameter that is not written to. `Vec2` is assignable to
 * it, so a caller never converts; the reverse is not, which is what stops a frozen shared
 * constant being handed in as an output parameter.
 */
export interface ReadonlyVec2 { readonly x: number; readonly y: number; }

/** Allocate. Call this at setup, never inside a loop. */
export declare function v2(x?: number, y?: number): Vec2;

export declare function v2Set(out: Vec2, x: number, y: number): Vec2;
export declare function v2Copy(out: Vec2, a: ReadonlyVec2): Vec2;
export declare function v2Add(out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2): Vec2;
export declare function v2Sub(out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2): Vec2;
export declare function v2Scale(out: Vec2, a: ReadonlyVec2, scalar: number): Vec2;
/** `a + b * scalar` in one call — the integration step, without a temporary. */
export declare function v2AddScaled(
  out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2, scalar: number,
): Vec2;
export declare function v2Lerp(
  out: Vec2, a: ReadonlyVec2, b: ReadonlyVec2, t: number,
): Vec2;

export declare function v2Dot(a: ReadonlyVec2, b: ReadonlyVec2): number;
/** The z of the 3D cross product. Sign tells you which side of `a` the point `b` is on —
 *  which is how `iso` decides facing and winding. */
export declare function v2Cross(a: ReadonlyVec2, b: ReadonlyVec2): number;

export declare function v2LenSq(a: ReadonlyVec2): number;
export declare function v2Len(a: ReadonlyVec2): number;
export declare function v2DistSq(a: ReadonlyVec2, b: ReadonlyVec2): number;
export declare function v2Dist(a: ReadonlyVec2, b: ReadonlyVec2): number;

/** Unit vector, or (0, 0) for a zero-length input. Returning (0,0) rather than NaN is
 *  deliberate: a NaN position propagates silently through a whole scene graph and shows
 *  up as an invisible sprite three systems away. */
export declare function v2Normalize(out: Vec2, a: ReadonlyVec2): Vec2;

/** Rotate 90° counter-clockwise: `(-y, x)`. Exact, no trigonometry, and it is what almost
 *  every "perpendicular" actually needs. */
export declare function v2Perp(out: Vec2, a: ReadonlyVec2): Vec2;

/** Component-wise comparison within `epsilon` (default `EPSILON`). */
export declare function v2Approx(
  a: ReadonlyVec2, b: ReadonlyVec2, epsilon?: number,
): boolean;

/** @tier B — `Math.cos`/`Math.sin`. Presentation only. */
export declare function v2Rotate(out: Vec2, a: ReadonlyVec2, radians: number): Vec2;
/** @tier B — `Math.atan2`. Returns (-PI, PI]. */
export declare function v2Angle(a: ReadonlyVec2): number;
/** @tier B — `Math.cos`/`Math.sin`. */
export declare function v2FromAngle(out: Vec2, radians: number, length?: number): Vec2;
```

### 3.8 `events`

```ts
// `on` and `once` return a `Disposer` from §3.13 — the kit has one teardown vocabulary,
// not one per package. They return it rather than relying on `off` because matching a
// function reference silently fails for `this.handler.bind(this)`, which creates a new
// function on every call and therefore never matches. That leak has a name in every
// codebase that has shipped an emitter.

/**
 * A typed synchronous emitter.
 *
 * Declare the event map as an interface: `interface GameEvents { built: { id: string };
 * ready: void }`. An event with no payload is typed `void` and emitted as
 * `emit('ready', undefined)`.
 *
 * Dispatch is synchronous, in registration order, and there is no queue. Asynchrony here
 * would mean a listener runs on a different tick than the state change that caused it,
 * which is how a replay diverges from a live session.
 */
export declare class Emitter<TEvents extends Record<string, unknown>> {
  /** @returns a `Disposer` that unsubscribes. Idempotent, per that type's contract — so it
   *  can be handed straight to `Scope.add` and disposed again with the scene. */
  on<K extends keyof TEvents & string>(
    event: K, listener: (payload: TEvents[K]) => void,
  ): Disposer;

  /** Fires at most once, then unsubscribes itself before the listener body runs — so a
   *  listener that re-emits its own event does not recurse. */
  once<K extends keyof TEvents & string>(
    event: K, listener: (payload: TEvents[K]) => void,
  ): Disposer;

  /** Remove by reference. Prefer the `Disposer` from `on`; this is here for the
   *  case where the reference is genuinely stable. */
  off<K extends keyof TEvents & string>(
    event: K, listener: (payload: TEvents[K]) => void,
  ): void;

  /**
   * Dispatch, synchronously, in registration order, over a snapshot of the listener list
   * taken before the first call. A listener that unsubscribes during dispatch is still
   * called this round; one that subscribes during dispatch is not. Without the snapshot,
   * `off` inside a listener skips the *next* listener — the classic index-shift bug.
   *
   * A throwing listener propagates. Swallowing it would turn a crash into a silent
   * half-updated world, which is strictly harder to debug.
   */
  emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): void;

  /** Drop listeners for one event, or all of them. What a scene teardown calls. */
  clear(event?: keyof TEvents & string): void;

  /** For tests and leak assertions: a screen that has been closed should be at zero. */
  listenerCount(event: keyof TEvents & string): number;
}
```

### 3.9 `pool`

```ts
export interface PoolOptions<T> {
  /** Build a fresh instance. Called only when the free list is empty. */
  readonly create: () => T;
  /**
   * Return an instance to a neutral state on release.
   *
   * Clear every reference here, not just the numbers. A pooled particle that keeps a
   * pointer to the entity that spawned it holds that entity's whole subtree alive, and
   * the leak is invisible because the pool "reuses" objects — which sounds like the
   * opposite of a leak.
   */
  readonly reset?: (item: T) => void;
  /** Instances to build up front. Do this at load, not during the first explosion. */
  readonly initial?: number;
  /**
   * Hard ceiling on total instances. Exceeding it throws rather than growing, because a
   * pool that grows without bound has become a slower `new` with extra steps — and the
   * throw names the leak at the moment it happens instead of at the OOM twenty minutes
   * later. Omit for unbounded.
   */
  readonly max?: number;
  /**
   * O(n) double-release detection. Off by default because it is O(n) per release; turn it
   * on in tests. A double release puts one object on the free list twice, so two callers
   * are handed the same instance and each sees the other's writes — the single nastiest
   * bug this module can cause, and the one that looks most like a physics glitch.
   */
  readonly checked?: boolean;
}

export declare class Pool<T> {
  constructor(options: PoolOptions<T>);
  /** Instances ever created. Watch this flatten; if it climbs forever, something never
   *  releases. */
  readonly size: number;
  /** Instances currently available. */
  readonly free: number;
  /** @throws RangeError when `max` is reached, naming the pool's size. */
  acquire(): T;
  /** @throws Error on a double release when `checked` is on. */
  release(item: T): void;
  /** Grow the free list ahead of time. */
  preallocate(count: number): void;
}
```

`Pool` deliberately has no `releaseAll()`. Tracking live instances to support it costs a
per-object bookkeeping slot on the hot path, and the discipline it papers over — release in
the same frame you acquire — is the one that keeps a pool honest.

### 3.10 `format`

Ported and sharpened from `foom-simple-ui/src/ui/dom.ts`. Every function here is
locale-free by construction; see §4.5.

> **Known pressure point — this module's place in layer 0 is the weakest claim in the RFC.**
> `ui` has delivered and deliberately does *not* import `fmt`: it judged number display to
> belong to the game. That is a live vote against the argument in §1's charter, and it is
> recorded here rather than rediscovered in cycle three. The module survives on `draw`
> alone, which needs it for canvas text and cannot import `ui` (the DAG points the other
> way). **The test to apply later:** if `draw` ends up formatting only through a game-supplied
> callback, `format` has one consumer, fails charter question 1, and should move out of core
> — to `ui`, or to the demo game. Nothing else in core depends on it, so that move is cheap
> for exactly as long as nobody builds on it. Do not add a tenth formatter here in the
> meantime.

```ts
/**
 * Compact magnitude: `12500` → `'12.5K'`.
 *
 * An idle game lives on this function — a player reads a magnitude in a glance with their
 * thumb already moving. Output is never wider than six characters, so a resource pill
 * never reflows; a wallet that changes width as you play feels unstable.
 *
 * Non-finite input returns `'—'` rather than `'NaN'`, because a HUD showing NaN reads as
 * a broken game and a HUD showing an em dash reads as "not yet".
 */
export declare function fmtCompact(value: number, decimals?: number): string;

/** Same, with an explicit sign on positives: `'+12.5K'`. For deltas, where the sign is
 *  the information. */
export declare function fmtSigned(value: number): string;

/** Grouped integer: `1234567` → `'1,234,567'`. Always an ASCII comma — see §4.5. */
export declare function fmtInteger(value: number): string;

/** `'1.2/s'`. Rates get an extra decimal below 10 because early-game rates are below 1,
 *  and `'0/s'` next to a visibly-filling bar is the kind of thing players file bugs about.
 *  @param suffix - default `'/s'`. */
export declare function fmtRate(perSecond: number, suffix?: string): string;

/** `0.075` → `'7.5%'`. Takes a fraction, not a percentage, so there is one convention in
 *  the kit and not two. */
export declare function fmtPercent(fraction: number, decimals?: number): string;

export type DurationStyle = 'short' | 'clock';

/** `'2m 30s'` (short) or `'02:30'` (clock). Clock style is monospace-stable in width for
 *  a countdown; short style reads better in prose. Negative input clamps to zero. */
export declare function fmtDuration(seconds: number, style?: DurationStyle): string;

/** The magnitude ladder: `['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc']`.
 *  Exported so a game can show its own ladder, and so a test can assert the boundary
 *  behaviour at every tier without duplicating the table. */
export declare const COMPACT_SUFFIXES: readonly string[];
```

### 3.11 `guard`

```ts
/**
 * Validators, not assertions. Each returns the value, so the check sits inside the
 * assignment and cannot be dropped by a build step or forgotten by a refactor:
 *
 * ```ts
 * this.zoom = expectRange(zoom, 0.25, 8, 'camera.zoom');
 * ```
 *
 * Every message follows non-negotiable #9 — it names the caller's symbol, the
 * expectation, and the value received: `camera.zoom: expected a finite number in
 * [0.25, 8], got -1`.
 *
 * These run at construction and at API entry points. They do NOT run per frame or per
 * entity; a guard inside a per-sprite loop is a measurable cost for a mistake that a
 * caller makes once.
 */
export declare function expectFinite(value: number, label: string): number;
export declare function expectInt(value: number, label: string): number;
/** Inclusive on both ends. @throws RangeError */
export declare function expectRange(
  value: number, min: number, max: number, label: string,
): number;
/** @throws RangeError if `index` is not an integer in [0, length). */
export declare function expectIndex(index: number, length: number, label: string): number;
/** @throws RangeError on an empty array, returning it otherwise. */
export declare function expectNonEmpty<T>(
  items: readonly T[], label: string,
): readonly T[];

/**
 * Reject a number that will not survive `JSON.stringify` — the save-path guard.
 *
 * `JSON.stringify(Infinity)` is `"null"`, and so is `NaN`. That is the worst corruption
 * shape in the kit: the bytes are intact, the checksum matches, the schema is the right
 * shape, and an infinite stock silently returns as nothing. No layer downstream can detect
 * it, which is why the check belongs at the moment of writing rather than the moment of
 * reading. See §4.8.
 *
 * Normalises `-0` to `0`, because `JSON.stringify(-0)` is `"0"` and a value that changes
 * across a round trip fails an integrity comparison for a reason nobody will find.
 *
 * @throws RangeError naming the caller and the value, per non-negotiable #9.
 */
export declare function expectSerializable(value: number, label: string): number;

/**
 * The non-throwing form — the load-path predicate.
 *
 * `persist`'s invariant is that a corrupt save degrades to a fresh one with a reported
 * reason and never throws on boot, so the load path needs to *ask* rather than assert.
 * Same rule, both directions of the boundary.
 */
export declare function isSerializable(value: number): boolean;

/**
 * Reject a count that has left the exactly-representable integers — `Number.isSafeInteger`
 * with a message.
 *
 * For quantities that must be counted rather than measured: buildings owned, ticks
 * elapsed, entity ids. Above 2^53 a double cannot hold consecutive integers, so `n + 1`
 * quietly becomes `n` and two different logical values compare equal. See §4.8 for why
 * this is a *different* problem from the one `expectSerializable` solves, and why an idle
 * game's stocks are deliberately not subject to it.
 *
 * @throws RangeError
 */
export declare function expectSafeInteger(value: number, label: string): number;

/**
 * Exhaustiveness check for a discriminated union. In the default branch of a switch,
 * `unreachable(kind, 'building.kind')` fails to compile the day a case is added — which
 * is the only kind of error worth having.
 */
export declare function unreachable(value: never, label: string): never;
```

### 3.12 `time` — the calendar type, and only the type

`loop` has refused to own an epoch, correctly: its `Clock` is monotonic, `performance.now()`
has no calendar, and a package that cannot stamp anything should not define the stamp. But
`persist` stamps the save, `sim` integrates elapsed time from that stamp, and the game
injects the one function that reads a wall clock. Three packages now name the same concept.

**This module is types and two validators. Core still may not read a clock** — non-negotiable
#1 is unchanged, `lint` still bans `Date.now()` in every `src/`, and there is deliberately no
default implementation of `Now` anywhere in the kit. Owning the *word* is not owning the
*reading*.

#### Why the calendar comes back up to layer 0 when `Rect` and entity ids did not

The charter question is *not* "does more than one package want it" — it is **"do its
consumers have a common ancestor below core?"** Work the three cases:

| type | consumers | common ancestor below core | verdict |
|---|---|---|---|
| `Rect`/`Bounds` | `draw`, `input`, `ui` | **`iso`** — every consumer sits above it in the DAG | `iso` owns it |
| entity ids | `sim`, and the game | **`sim`** — sole consumer in the kit | `sim` owns it |
| `EpochMillis` | `persist`, `sim`, `loop` (by exclusion), and the game | **none** — all three are layer-1 siblings | **core owns it** |

Siblings have no shared home but core. That is the whole rule, and it is why this one type
travels upward while the other two travelled down.

Two facts make it cheap. A type is **erased**: it adds zero bytes to the bundle, so the
"everyone pays" objection that blocks most core additions does not apply — core may own a
type where it would refuse the corresponding function. And the alternative is not "no type",
it is *three* `type Millis = number` aliases that agree today and drift later, which is
exactly how a save file ends up carrying the wrong unit.

```ts
declare const EPOCH_MILLIS: unique symbol;
declare const MONOTONIC_MILLIS: unique symbol;

/**
 * Milliseconds since the Unix epoch — **wall-clock calendar time**, as `Date.now()`
 * returns it.
 *
 * It answers "what time is it", it survives a reload, and it is the only kind of time
 * that may be written to a save file. It can also jump backwards: an NTP correction, a
 * timezone change, or a player setting their clock forward to skip a timer all move it.
 * Anything that subtracts two of these must tolerate a negative result.
 *
 * Branded, so a monotonic reading cannot be assigned here by accident. See the note on
 * the brand below.
 */
export type EpochMillis = number & { readonly [EPOCH_MILLIS]: true };

/**
 * Milliseconds from an arbitrary origin — **monotonic time**, as `performance.now()`
 * returns it.
 *
 * It answers "how long since", it never goes backwards, and it is **meaningless in a save
 * file**: the origin is the document, so a value stamped before a reload compares against
 * a different zero afterwards. It may also freeze while the machine sleeps, which is why
 * `loop` clamps catch-up and credits nothing.
 *
 * Branded for symmetry, and because the confusion runs both ways.
 */
export type MonotonicMillis = number & { readonly [MONOTONIC_MILLIS]: true };

/**
 * The calendar: the game's single wall-clock reading, injected.
 *
 * There is exactly one of these per application, the game owns it, and it is almost always
 * `() => asEpochMillis(Date.now())`. `persist` takes one to stamp a save; `sim` takes one
 * to integrate to the present. Injecting it is what lets a test run a year of offline
 * accrual in a millisecond, and what lets `lint` ban the global read everywhere else.
 */
export type Now = () => EpochMillis;

/**
 * The stopwatch: a monotonic reading, injected. Usually
 * `() => asMonotonicMillis(performance.now())`.
 *
 * Separate from `Now` so the two cannot be swapped at an injection site — which is the
 * failure this whole module exists to prevent, and which no amount of documentation on a
 * `number` prevents on its own.
 */
export type MonotonicNow = () => MonotonicMillis;

/**
 * Brand a number as calendar time, at the one boundary where a real clock is read.
 *
 * Validates finite and nothing else — deliberately. A range check that rejected "this
 * looks like seconds, not milliseconds" would also reject `0` and `1000`, which is what
 * every manual clock in every test starts at.
 *
 * @throws RangeError naming the caller, per non-negotiable #9.
 */
export declare function asEpochMillis(value: number, label?: string): EpochMillis;

/** As `asEpochMillis`, for monotonic readings. @throws RangeError */
export declare function asMonotonicMillis(
  value: number, label?: string,
): MonotonicMillis;
```

**On the brand, since it costs something.** A bare `type EpochMillis = number` documents and
enforces nothing, and the two kinds of millisecond are silently interchangeable — which is
precisely the bug. The brand makes the dangerous assignment a compile error. The cost is one
call to `asEpochMillis` per application (at the single `Date.now()` the kit permits) and a
re-brand after arithmetic, because `epochA + 1000` widens to `number`. That widening is a
feature: `epochA - epochB` is a *duration*, not a calendar instant, and the type system
saying so out loud is worth the keystroke.

The brand is erased at runtime. A value read back from storage is a plain `number` and an
unvalidated `as EpochMillis` cast is a lie about data you did not produce — `persist` must
put it through `asEpochMillis` at the load boundary, which is a real check, not a cast.

**Core does not export `Millis` or `Seconds`.** `loop` already owns those two names for
durations, and a second identical alias in core would be the exact drift this module exists
to prevent, with core as the culprit. Durations elsewhere in the kit stay plain `number`
with the unit in the parameter name.

### 3.13 `dispose` — one teardown tree per scene

`input` calls this the biggest gap in the kit, while looking at its own package, and the
count is the argument: `input` returns disposers from a scope, `ui` from `interactive`,
`loop` from subscriptions, `persist` from store handles, `audio` from buses. **Five
vocabularies for one idea.** A game tearing down a scene has to remember all five, and the
one it forgets is a listener that stays live — invisible for an hour, then the tab is using
two gigabytes.

Charter check: five consumers spanning layers 1, 2 and 3, with no common ancestor below core
— the most decisive question-1 pass in this document. Deterministic (no clock, no platform).
One reasonable implementation, once the ordering rule is fixed. It is a **vocabulary type
plus fifteen lines that make it enforceable**, which is the same category as `time` and the
opposite of the container refused in §4.9.

This also **removes** an export. `events` previously declared its own `Unsubscribe`, which
was vocabulary number six being invented inside core itself. There is now one name.

```ts
/**
 * Undo one thing.
 *
 * **Idempotent by contract.** Calling a disposer twice must be safe and must not undo
 * something else — a handle that was released and whose slot was reused is the bug this
 * rule prevents. Every disposer the kit returns satisfies it, and every disposer a game
 * writes is expected to.
 */
export type Disposer = () => void;

/**
 * A teardown tree. One per scene, screen, or anything with a lifetime.
 *
 * The shape `input` proved and the kit adopts: a package ships **no free-function binder**,
 * so a listener can only be created through a scope and an unowned listener is
 * unconstructable. That turns "remember to unsubscribe" from documentation into something
 * the type system enforces, which is the difference between a guarantee and a hope.
 */
export interface Scope {
  /**
   * Register a disposer. Returns it unchanged, so a caller can also hold it directly for
   * early disposal without losing the scope's ownership.
   *
   * **Registering on a disposed scope runs the disposer immediately** rather than storing
   * it. A subscription created during teardown — by a disposer that emits, say — would
   * otherwise outlive the scope that was supposed to own it, and it is unreachable by
   * definition, so nothing could ever clean it up.
   */
  add(disposer: Disposer): Disposer;

  /**
   * A nested scope, disposed with this one.
   *
   * There is only one ordering rule, because `child()` registers the child's `dispose`
   * into this scope's own list: **everything disposes in reverse registration order.**
   * A child created after a resource is torn down before that resource, exactly as if it
   * were one. Two rules — "children first, then own disposers" — would have to be
   * remembered; this one falls out.
   */
  child(): Scope;

  /**
   * Tear down everything, in reverse registration order, then mark this scope disposed.
   *
   * **Idempotent**: the second call does nothing. A throwing disposer does not stop the
   * rest — every remaining disposer still runs, and the failures are collected and thrown
   * together as an `AggregateError` afterwards. One bad teardown must not leak the other
   * fourteen.
   */
  dispose(): void;

  /** True once disposed. */
  readonly disposed: boolean;

  /** Registered disposers not yet run. A closed screen asserts zero in tests. */
  readonly size: number;
}

export declare function createScope(): Scope;
```

`Scope` is an interface with a factory, not a class, deliberately: `input` has already built
one, and a structural type lets it conform without inheriting. Five packages agreeing on a
shape is the goal; five packages extending a base class is a different and worse thing.

### 3.14 Package metadata

```ts
/** The kit version this package was built as part of. */
export declare const VERSION: string;
```

**Export count: 85** — 8 types, 3 classes, 60 functions, 14 constants. That is the budget,
and §4 exists to keep it there.

Two thirds of it is `vec2` (20) and `easing` (17), which are one-liners by nature. The
easing curves are exported *individually as well as* through `EASINGS`, which looks like
duplication and is not: a bundler can drop an unreferenced `const bounceOut`, but it cannot
drop an entry of a record that something imported. A game that names one curve pays for one
curve; a game that authors tweens as data pays for the table it asked for.

---

## 4. What is deliberately absent

This is the section that matters. Every package in the kit depends on core, so anything
added here is added to everyone's bundle and to everyone's API surface forever. **A layer-0
package that accretes is how a kit dies:** it becomes the place where anything pure goes,
then the place where anything shared goes, then a second standard library that every
package must import in full.

### 4.0 The charter — what `core` will never grow into

Three questions. An addition needs **all three**, and the burden is on the proposer.

1. **Do its consumers have no common ancestor below core?** Not "do two packages want it" —
   that test was too weak, and §3.12 is where it was corrected. Find the lowest package in
   the DAG that every consumer already depends on; if one exists, it owns the thing and core
   does not. `Rect` has `iso`. Entity ids have `sim`. The calendar type has nothing but core,
   because `loop`, `persist` and `sim` are siblings. Point at the RFCs, not at a guess about
   who might want it later.
2. **Is it Tier A, or Tier B with a named presentation-only justification?** If its output
   can differ between two machines and anyone might persist it, it is not a core primitive.
3. **Is there exactly one reasonable implementation?** If a game could plausibly want a
   different curve, layout, policy or algorithm, core would be picking a winner for
   everybody. That is a decision for the layer that renders, simulates, or saves.

And two hard limits, checkable by a script: **twelve modules** and **6 KB gzipped** (half the
kit's 12 KB per-package budget — core is the floor everyone pays, not a place to spend).
Crossing either is an RFC amendment with a name on it, not a commit.

> **The module limit has been raised twice during the design phase, from ten to twelve, and
> this is the accounting.** Ten → eleven bought `time` (§3.12); eleven → twelve bought
> `dispose` (§3.13). Two raises in one phase is one more than is comfortable, so here is why
> it is not a slope:
>
> - Both are **vocabulary, not machinery** — types and, between them, about twenty lines.
>   Neither meaningfully spends the 6 KB, which is the budget that actually protects
>   consumers, and that number has not moved.
> - Both **collapse existing duplication** rather than adding capability. `time` replaced
>   three packages' `Millis` aliases; `dispose` replaced five teardown vocabularies and
>   deleted one of core's own exports doing it. Core got *more precisely drawn*, not wider.
> - In the same phase, `iso`'s priority queue was **refused** (§4.9) — a well-argued request
>   from a package that genuinely needs one. A limit that only ever moves outward is not a
>   limit; the refusal is what makes this one real.
>
> **The count is now closed for the build phase.** A thirteenth module requires deleting one,
> and anything with an implementation is competing for 6 KB that nine packages already spend.

The requests below will be made. Here is the answer in advance.

### 4.1 Colour maths — belongs in `draw`, and here is the argument

`foom-simple-ui/src/game/color.ts` is 733 lines of OKLab/OKLCH conversion, gamut mapping by
chroma reduction, and a WCAG contrast audit. It is pure, dependency-free and isomorphic —
it passes every surface test for "this is a core primitive". **It still goes in `draw`.**

Three reasons, in order of weight:

1. **It cannot honour core's headline invariant.** OKLab conversion needs `Math.cbrt` and
   `Math.pow`; sRGB transfer needs `Math.pow` again. None are correctly rounded by
   specification. That module's own doc says so: *"the final 8-bit hex could differ by one
   unit in the last place on an exotic engine. Persist the hue, never the derived tokens."*
   Core's one promise is bit-identical output. A module that ships with a portability
   caveat in its header cannot live behind that promise without weakening it for
   everything else in the package.
2. **Colour is an output encoding, not a primitive.** `#rrggbb` exists because CSS and
   Canvas2D want it; linear-light triples exist because renderers want them. Both are
   facts about a rendering target. `sim` and `persist` have no opinion about colour and
   should not pay for one — and under the charter's question 1, the only two consumers are
   `draw` and `ui`, which are adjacent layers.
3. **Colour derivation is a design system, not arithmetic.** The valuable part of that file
   is the *policy* — fixed lightness, capped chroma, contrast-safe by construction, faces
   derived from one solid colour with shadows cool and highlights warm. That policy is
   `draw`'s invariant, stated in `kit.json` in its own words. Splitting the arithmetic into
   core and the policy into draw would put the two halves of one argument in two packages.

**What core does owe `draw`:** `mod` (hue wrapping below zero), `clamp01`, `lerp`,
`smoothstep`, `mix32`/`hashParts` (sprite cache keys), and `Rng` (procedural variation).
All present. The `hueToHex` one-liner at the bottom of `foom-simple-ui/src/ui/dom.ts` is
the shortcut that colour.ts replaced; it should not be ported anywhere.

### 4.2 Time, in every form

No clock, no `dt` source, no timers, no `requestAnimationFrame`, no `Promise`, no `async`,
no scheduler, no tweens. Non-negotiable #1 says time arrives as a parameter, and `loop`
owns the parameter. Core exports `Easing` functions — pure `(t) => t'` — and `loop` builds
tweens from them. The instant core knows what "now" is, every package below it can become
non-deterministic without changing a line of its own code.

§3.12 adds the calendar *type* and nothing else, and that distinction is the whole of it:

| core owns | core will never own |
|---|---|
| `EpochMillis`, `MonotonicMillis` — the vocabulary | any function that returns one |
| `Now`, `MonotonicNow` — the shape of the injected reading | a default implementation of either |
| `asEpochMillis` — validation of a number you already read | the read itself |

Also absent permanently: any `Date` wrapper, timezone handling, calendar arithmetic ("start
of day", "days between"), and date/time *formatting*. The last is §4.5 again —
`Intl.DateTimeFormat` is locale-dependent, engine-dependent and enormous. A game that shows
"last played Tuesday" formats it in its own layer, where the locale actually lives.

### 4.3 A default `Rng`, and any `Rng`-shaped interface

- **No global/default RNG, no `Math.random` fallback.** A shared implicit stream makes every
  subsystem's output depend on every other subsystem's draw count. This is the single
  highest-value absence in the package.
- **No `RngLike` interface and no injectable generator.** Two implementations means two
  streams, and a replay guarantee is worth exactly nothing if the algorithm behind it is
  swappable. A test that needs a specific sequence uses `Rng.fromSnapshot`, or finds a seed.
- **No `gaussian()`/`normal()`.** Box-Muller needs `Math.log`, `Math.sqrt` and `Math.cos` —
  Tier B, in the one module that must be Tier A. A game that genuinely needs a normal
  distribution can sum four uniforms in its own layer and know what it traded away.

### 4.4 `assert(condition, message)`

A boolean has already thrown away the value that was wrong, so the message can only ever be
prose — which is precisely the failure non-negotiable #9 names. Worse, the `assert` shape is
what bundlers strip in production, so the check runs only where it is least needed. `guard`
exports validators that return their argument instead; the call site cannot compile without
using the result.

### 4.5 `Intl`, locales, pluralisation, i18n

`fmtCompact` and friends are ASCII-only and locale-free. Three reasons: `Intl.NumberFormat`
formats differently across engines and ICU versions (so a screenshot test and a save file
both become platform-dependent), constructing one per call is one of the slowest things
you can do in a frame, and a localised suffix ladder is a content decision. A game that
wants French number grouping formats in its own layer.

### 4.6 Geometry beyond `Vec2`

No `Vec3`, no matrices, no quaternions, no `Rect`/`Bounds`, no polygon or ray intersection,
no spatial index. The kit is 2.5D: the isometric projection is four numbers and `iso` owns
it. **`Rect`/`Bounds` specifically goes in `iso`** — `draw`, `input` and `ui` all reach it
through the existing DAG (`draw → iso`, `input → iso`, `ui → draw`), so putting it in core
buys nothing and costs everyone. `Vec2` is here only because `iso`, `draw` and `input` need
the same shape and two of them are siblings.

### 4.7 The generic infrastructure everyone eventually proposes

| absent | why, and where it goes instead |
|---|---|
| ECS, entity store, component registry | there is exactly one reasonable ECS per game and it is never this one. The demo game owns its entities. |
| structural clone, deep equal, immutability helpers | `persist` owns serialisation and is the only package that needs to walk a graph. Deep equality in a hot path is a bug regardless of where it lives. |
| schema validation / parsing | `persist` owns save shape and migrations; validating at the storage boundary is the whole point of a migration chain. |
| logging, debug channels | a logger in layer 0 is a global mutable sink, and non-negotiable #4 keeps I/O in packages that name it. |
| a `Result`/`Either` type | non-negotiable #9 says throw, with a message that names the mistake. Two error conventions is worse than either one. |
| collections (LinkedList, Deque, PriorityQueue) | the only one anyone needs is a binary heap for A*, and A* lives in `iso/path`. Asked for, and ruled on at length, in §4.9 — core takes the ordering *contract* and not the container. |
| a stable sort / comparator kit | `Array.prototype.sort` has been stable since ES2019. `iso` owns depth sort because depth sort is a spatial algorithm, not a general one. |
| SoA / typed-array containers | real, and premature. Revisit when a benchmark in `docs/PERFORMANCE.md` shows `Vec2` object churn as the frame's top cost — with the number, not the intuition. |
| crypto, UUIDs, content addressing | 32-bit hashes for cache keys and corruption checks are all this kit needs; anything stronger needs `crypto`, which is a platform dependency. Entity ids belong to whoever owns entities. |

### 4.8 A bignum, and a canonical number encoding — with the ruling `persist` asked for

Three packages each assumed someone else had thought about this. The ruling, because silence
is the option that ships the bug.

**First, separate three hazards that get discussed as one.**

| hazard | what actually happens | whose problem |
|---|---|---|
| `Infinity` / `NaN` in a save | `JSON.stringify` writes `null`. Bytes intact, checksum valid, schema correct, value gone. **Silent, and undetectable downstream.** | core names the rule, `persist` enforces it at the boundary |
| a value above 2^53 | round-trips through JSON **exactly** — `JSON.stringify` emits enough digits to recover any finite double. What breaks is *arithmetic*: `n + 1 === n`, and two different logical values compare equal | `sim`, at the point it counts rather than measures |
| `-0` | serialises as `"0"`, so a round trip changes the value and an integrity comparison fails for a reason nobody finds | core normalises it in `expectSerializable` |

The second row is the one most often stated wrongly. **2^53 is not a serialisation limit.**
An idle economy's stocks are *measured* quantities produced by a closed-form exponential, and
`1e40` is a perfectly good double that saves and loads exactly; it simply cannot be counted
in ones. So core does not cap magnitude. It caps it only where a value is a *count* —
`expectSafeInteger`, for building counts, tick indices and ids.

**Ruled in:** `expectSerializable` (save path, throws), `isSerializable` (load path,
predicate — `persist` may not throw on boot), `expectSafeInteger` (counts). Three functions
in `guard`, no new module, no new type.

**Ruled out — a canonical encode/decode pair** (`Infinity` ⇄ `{"$inf":1}` or `"Infinity"`).
It would make core the owner of a wire format, which is `persist`'s job and `persist`'s
migration chain; every save file in the kit would carry core's encoding forever. Worse, it
makes the encoded type `number | object`, which poisons every signature downstream of it. An
infinite stock is a bug in whatever produced it — `Math.exp` overflowing in the integrator, a
division by a zero rate — and the fix is to clamp at the source, not to teach the file format
to carry infinity.

**Ruled out — any bignum.** Correct, and wrong for a 6 KB layer-0 package: it would be
larger than the rest of core combined, it would make every arithmetic call site a method
call, and `sim`'s closed-form integrator is built on `Math.exp`, which has no bignum form
anyway.

**The connection to §3.1, which a reader will otherwise assume.** Tier A promises
**bit-identical arithmetic**. It promises nothing about a value's **round trip through
JSON**. Those are two different guarantees about the same number, and the second does not
follow from the first: `Infinity` is a perfectly Tier A result — every conforming engine
produces it from the same overflow — and it is exactly the value that does not survive being
written down. A number is replay-safe and persistence-safe independently, and a value
crossing the storage boundary needs both checks.

### 4.9 A priority queue — and the ordering rule that goes in its place

`iso` asked for a deterministic binary heap with an insertion tie-break, for A\* and
Dijkstra, on the grounds that `sim` may want one too and two heaps would break ties
differently. **The reasoning about ties is exactly right. The placement is not, on the
evidence available: `iso` owns the heap.**

Question 1 asks who the consumers are and says *point at the RFCs, not at a guess about who
might want it later*. Applying it: `iso` needs one, definitely. `loop` explicitly refuses
priority queues for its scheduler in its own §4.7. `sim` does not ask for one — its RFC is
closed-form by construction, and its own headline invariant is "closed form, never a loop".
That is **one confirmed consumer**, and one consumer means the consumer owns it — the same
answer `Rect` and entity ids got, and it would be incoherent to give this one a different
one because the request arrived with a better argument attached.

The second reason is the shape. `Scope` and `EpochMillis` are vocabulary that makes other
packages' guarantees enforceable; a priority queue is a **generic container**, and core has
none — `Pool` is an allocator, not a collection. Admitting the first container admits the
argument for `Deque`, `RingBuffer` and `SortedSet`, each with an identical "two packages
might both need it" case. That is the accretion pathway §4.7 names, and this is the request
that tests whether the charter is real.

**What core takes instead is the part that must not be duplicated — the contract, which
costs nothing:**

> **The Lattice ordering rule.** Any structure in this kit that orders by a numeric key
> breaks ties by **insertion sequence**, and exposes **no comparator parameter**. A
> comparator that may return 0 reintroduces the ambiguity the rule exists to remove, and a
> caller cannot supply a total order it does not know the insertion sequence for. This is a
> determinism rule of the same standing as the tier rule in §3.1, and it applies to `iso`'s
> path heap, `iso`'s depth sort, and anything added later.

Without it, two grid routes of equal cost resolve by whatever the heap's sift order happens
to be, A\* returns a different path on a different engine, and the kit's replay guarantee
becomes a coin flip in the case that is *most* common on a square grid. `iso` has already
written this as its invariant I13; core's job is to make it kit-wide rather than one
package's habit.

**The trigger for revisiting, named so nobody has to relitigate it from scratch:** the day a
second package needs a priority queue, it **moves** to core — it does not get a second
implementation. The move is cheap precisely because the contract above is already fixed, so
what moves is code, not a decision.

---

## 5. The invariants

Phrased so that a failing case is obvious. Each should map to at least one test; core's
coverage floor is 100%.

### 5.1 Package-level

1. **Zero imports.** `src/**/*.ts` contains no `import` from any package specifier. A grep
   for `from '` that is not `from './` or `from '../` fails the build.
2. **Zero DOM, zero platform.** No `window`, `document`, `navigator`, `globalThis`,
   `process`, `localStorage`, `AudioContext`. The whole package runs under `node --input-type=module`
   with no shims.
3. **Zero module-level mutable state.** Every top-level binding is `const` and either a
   primitive, a frozen table, or a function declaration. Importing core twice, or importing
   two copies of it, changes nothing observable.
4. **Zero import-time side effects.** `package.json` says `"sideEffects": false`; a bundler
   that keeps only `fmtCompact` must emit no other core code. Test by building a fixture
   that imports one symbol and asserting the bundle does not contain `mulberry`.
5. **Every exported symbol appears in `.lattice/kit.json` under `core.exports`**, and every
   name there is exported. `npm run lint` enforces this both ways.
6. **Every export has a doc comment that says what breaks**, not what it does.

### 5.2 Determinism

7. **Tier A is bit-identical.** For every Tier A function, running it in Node, in a browser
   and on ARM produces `Object.is`-equal doubles. The practical test: a golden file of
   10,000 values from `Rng`, `noise2`, `fbm2`, every `Easing`, and every Tier A `math`
   function, compared exactly — not approximately. A single `toBeCloseTo` in core's suite
   is a bug in the suite.
8. **No transcendentals outside the four Tier B symbols.** A grep for
   `Math.(sin|cos|tan|atan2?|pow|exp|log|cbrt|hypot)` in `src/` matches only `math.ts`
   (`damp`) and `vec2.ts` (`v2Rotate`, `v2Angle`, `v2FromAngle`).
9. **`derive` is cursor-independent.** `a.derive('x').next()` equals
   `b.derive('x').next()` when `a` and `b` share a seed and `a` has drawn a million times.
10. **`derive` is order-sensitive.** `r.derive('a','b')` and `r.derive('b','a')` produce
    different first draws.
11. **Snapshot round-trip is exact.** For any `r` and any n, `Rng.fromSnapshot(r.snapshot())`
    produces the same next 1,000 draws as `r`. Through `JSON.parse(JSON.stringify(...))` too.
12. **`Rng.int` is unbiased.** 1,000,000 draws over a span that does not divide 2^32 (e.g.
    `int(0, 3)`) land within 0.5% of uniform in every bucket. A modulo-only implementation
    fails this at n=1e6.
13. **Seed separation.** `createRng(1)` and `createRng(2)` differ in their first draw by
    more than 0.01 — as do `createRng('a')` and `createRng('b')`, and every adjacent pair
    up to 1,000.
14. **`nextUint32` output is always a uint32.** `Number.isInteger(v) && v >= 0 && v < 2**32`
    over a million draws — the check that catches a missing `>>> 0`.
15. **`hash2` is stateless and order-free.** Sampling a 64x64 grid forwards, backwards, and
    in a shuffled order produces three identical grids; interleaving a million `Rng` draws
    between samples changes nothing. Distinct seeds over the same grid correlate below
    0.01, and `toUnit(hash2(...))` over a million cells is uniform to within 0.5% in 16
    buckets — a weak coordinate hash shows as diagonal banding long before it shows here.
16. **`fbm2` stays in range.** Over a million samples at 1, 4 and 8 octaves and gains from
    0.1 to 0.9, every output is within [-1, 1] and the min/max at each octave count are
    within 5% of each other. Un-normalised fBm fails the second half.

17. **`hashStep` folds to the unrolled forms.** `hash2(s, x, y)` equals
    `hashStep(hashStep(s, x), y)` and `hash3(s, x, y, z)` equals that plus one more step,
    for a thousand random triples. If they ever diverge, the "there is no `hash4`" promise
    is false and a four-axis caller is on a different algorithm from a three-axis one.
18. **Every hash axis avalanches independently.** For `hash2` and `hash3`, changing any one
    argument by 1 flips 12–20 of the 32 output bits on average over 10,000 trials. A linear
    fold (`31x + 17y`) passes a naive uniformity test and fails this one, which is why this
    is the test that ships.
19. **`hashBytes` is length-sensitive and order-sensitive.** `[1, 2]`, `[2, 1]` and
    `[1, 2, 0]` produce three different digests. The third is the one a naive implementation
    fails, and it is how a truncated save passes a checksum.

### 5.3 Numeric contracts

20. **`lerp(a, b, 1) === b` exactly**, for a hundred random `(a, b)` pairs including ones
    many orders of magnitude apart. `lerp(a, b, 0) === a` likewise.
21. **`mod(v, d)` has the sign of `d`** and lands in `[0, d)` for positive `d`, for `v` from
    -1000 to 1000. `mod(-1, 8) === 7`.
22. **Every `Easing` satisfies `e(0) === 0` and `e(1) === 1` exactly**, and is finite across
    101 samples of [0, 1]. `backOut` and `bounceOut` are allowed outside [0, 1] in between;
    the rest are not.
23. **`damp` is frame-rate independent.** Integrating from 0 toward 1 for one second at
    dt=1/30 and at dt=1/240 lands within 1e-6. The naive `x += (t-x)*k` fails by ~2x.

### 5.4 Aliasing and allocation

24. **Every `vec2` function is alias-safe.** `v2Add(a, a, b)`, `v2Normalize(a, a)`,
    `v2Lerp(a, a, b, 0.5)` produce the same result as the non-aliased call. The test that
    catches a write-before-read.
25. **The hot path allocates nothing.** A benchmark that runs 100,000 `v2Add`/`v2Lerp`/
    `noise2`/`fbm2`/`Pool.acquire`+`release` calls shows zero growth in
    `process.memoryUsage().heapUsed` after a forced GC — and no function in `vec2`, `noise`,
    `math`, or `easing` contains an object, array, or closure literal.

### 5.5 Behavioural

26. **Emitter dispatch order is registration order**, and unsubscribing listener #2 from
    inside listener #1 still calls #3.
27. **A listener subscribed during dispatch is not called during that dispatch.**
28. **`once` unsubscribes before it invokes**, so a listener that re-emits its own event
    terminates.
29. **A listener `Disposer` is idempotent** — calling it twice does not remove a later listener that
    reused the slot.
30. **`Pool.acquire` after `release` returns the same object**, reset. With `checked: true`,
    a double release throws.
31. **`fmtCompact` is monotonic and width-bounded.** Over 10,000 log-spaced values, the
    formatted output never exceeds six characters, and no larger input formats to a
    lexically-smaller tier. Specifically: `fmtCompact(999_950)` must not be `'1000.0K'`.
32. **Every `guard` message contains the label and the received value.** A regex over the
    thrown message for the label string and `String(value)`.
33. **Errors are the right subclass.** `RangeError` for out-of-domain numbers, `TypeError`
    for wrong types. Never a bare `Error`.

### 5.6 Lifetime and the storage boundary

34. **`Scope.dispose` runs in reverse registration order**, and a child scope registered
    third disposes third-from-last — one list, one rule. Assert against a recorded sequence
    of labels, not a count.
35. **`Scope.dispose` is idempotent.** Calling it twice runs each disposer exactly once. The
    test that catches a scene torn down by both its owner and its parent — which is every
    scene, eventually.
36. **`Scope.add` on a disposed scope runs the disposer immediately** and does not retain it.
    `size` stays 0. Without this, a subscription created during teardown is unreachable and
    permanent.
37. **A throwing disposer does not strand the rest.** With five disposers where the middle
    throws, all five run, and an `AggregateError` carrying the one failure is thrown after.
38. **`expectSerializable` rejects exactly what JSON destroys.** `Infinity`, `-Infinity` and
    `NaN` throw; `-0` returns `0`; every finite double, including `1e308` and `2 ** 60`,
    passes and satisfies `JSON.parse(JSON.stringify(v)) === v`. The last clause is the one
    that proves 2^53 is not a serialisation limit — see §4.8.
39. **`isSerializable` agrees with `expectSerializable` on every input**, throwing where the
    other throws and only there. Two spellings of one rule that disagree is worse than
    either alone.
40. **A branded type cannot be assigned from a bare `number`.** A `.ts` fixture compiled with
    `expect-error` assertions: `const t: EpochMillis = 5` fails, `asEpochMillis(5)` succeeds,
    and `asMonotonicMillis(5)` is not assignable to `EpochMillis`. Type-level behaviour needs
    a type-level test; a runtime suite cannot see any of this.
41. **`Vec2` is assignable to `ReadonlyVec2` and not the reverse.** Same fixture. If this
    ever inverts, every out-parameter signature in the kit silently stops protecting anyone.

---

## 6. The traps

What a naive implementation gets wrong. Numbers 1–9 are mined from
`foom-simple-ui/src/core/rng.ts` and its `PLAYBOOK.md`; the rest are the ones this API
shape invites.

1. **`a * b` instead of `Math.imul(a, b)`.** Two 32-bit integers multiply to up to 64 bits,
   which exceeds the 53-bit mantissa, so the product rounds — and the low bits, which is
   the entire output of a hash, are exactly the ones lost. Every multiply in `hash` and
   `rng` is `Math.imul`.

2. **Forgetting `>>> 0` at a boundary.** `^`, `|`, `<<` and `>>` produce a *signed* int32.
   `(t ^ (t >>> 14))` can be negative, and a negative "uint32" divided by 2^32 gives a
   negative "probability". Every value that is documented as a uint32 is `>>> 0` on the way
   out. Invariant 14 is the test.

3. **Seeding the generator with the raw seed.** mulberry32 seeded with 1, 2, 3 produces
   visibly correlated first draws — three worlds that share their first tree. Hash the seed
   through `mix32` first, always, including inside `derive`.

4. **Normalising with `/ (2**32 - 1)` or `* 2.3283064365386963e-10`.** The first is not a
   power of two, so the division rounds and the result stops being bit-identical; the
   second is a rounded literal of the same thing. It must be `/ 4294967296`.

5. **`derive` forking from the cursor instead of the seed.** It will pass every test, and
   then the world will regenerate differently because a menu animation drew a random
   sparkle before terrain generation ran. Fork from `this.seed`, which drawing never
   changes.

6. **Modulo bias in `int()`.** `min + (nextUint32() % span)` over-represents the low
   `2^32 % span` values. Invisible on a d6, visible on a 1-in-3 loot table over a session.
   Reject draws at or above `2^32 - (2^32 % span)`.

7. **`items.sort(() => rng.next() - 0.5)` as a shuffle.** It is not a uniform permutation
   under any sort algorithm, and the result depends on the engine's sort implementation —
   so it is non-deterministic *across platforms* on top of being biased. Fisher-Yates,
   drawing `int(0, i + 1)`.

8. **String seeds and Unicode normalisation.** `hashString` walks UTF-16 code units, so
   `'café'` composed (U+00E9) and decomposed (U+0065 U+0301) are different streams. A
   player name typed on macOS and on Windows can seed two different worlds. Documented on
   `hashString`; normalise before hashing anything that crosses a boundary.

9. **`Math.random()` or `Date.now()` sneaking in as a "temporary" default.** Banned by
   non-negotiable #1 and by lint. The tell is a parameter named `seed = Date.now()`.

10. **Reaching for a transcendental for convenience.** `easeInOutSine` via `Math.cos`,
    `easeOutExpo` via `Math.pow`, a noise gradient from `Math.sin(hash) * 43758.5453` (the
    shader idiom — it is not even stable across GPUs, let alone JS engines). Every one of
    these silently demotes a Tier A module. Gradients come from a small fixed direction
    table indexed by hash bits.

11. **`lerp` written as `a + (b - a) * t`.** One operation cheaper, and it does not land
    exactly on `b` at `t === 1`. A camera that ends its tween at 0.9999999 of its target
    leaves every sprite a sub-pixel off, permanently, and only shows up as text that looks
    slightly blurry. Invariant 20.

12. **`%` on a value that can be negative.** `-1 % 8` is `-1`. This is `PLAYBOOK.md` trap 5's
    sibling: tile lookups west of the origin, hue wrapping below zero, ring buffers on a
    negative delta. Use `mod`. (And in `iso`: floor a tile lookup, never round — round snaps
    to the nearest lattice *vertex* and picks the wrong tile for three quarters of every
    diamond.)

13. **`current += (target - current) * 0.1` as smoothing.** Converges at a rate proportional
    to frame rate, so the camera behaves differently on a 144 Hz monitor than on a 60 Hz
    one, and differently again on a machine that drops frames. Use `damp(current, target,
    lambda, dt)` — or `moveTowards` when the motion must be Tier A.

14. **Writing an output parameter before reading its inputs.** `out.x = a.x + b.x; out.y =
    a.y + b.y` is fine; `out.x = a.y; out.y = -a.x` (a perp) silently corrupts the result
    when `out === a`. Read every needed component into locals first. Invariant 24.

15. **Returning `out` and then reusing it.** `const mid = v2Lerp(scratch, a, b, 0.5)` gives
    the caller a reference to `scratch`, and the next call overwrites it. Documented on
    every function; the discipline is that a value which must survive the frame is copied
    into a vector the caller owns.

16. **Mutating the listener array during dispatch.** Splicing at index `i` inside a
    `for (i…)` loop skips listener `i + 1`, so "unsubscribe when the panel closes" silently
    stops one unrelated system. Snapshot before dispatching. Invariants 26–27.

17. **`off(event, this.handler.bind(this))`.** `bind` returns a new function every call, so
    the reference never matches and the listener is never removed. Every closed screen leaks
    its whole state. This is why `on` returns a `Disposer` and why `off` is documented as
    the second choice.

18. **A `reset` that clears numbers but not references.** A pooled particle keeping
    `owner: Entity` holds an entire subtree alive. The leak hides behind the word "pool",
    which sounds like the opposite of a leak. Clear references to `undefined` in `reset`.

19. **Double release.** The object lands on the free list twice, two callers get the same
    instance, and each sees the other's writes — which presents as a physics or z-order
    glitch, never as a pool bug. `checked: true` in tests.

20. **A compact formatter that rounds across its own tier boundary.** `999_950` with one
    decimal rounds to `1000.0K`, which is seven characters and wrong. Re-check the tier
    *after* rounding, then re-divide. Invariant 31.

21. **`Intl.NumberFormat` for "just the grouping".** Different output across engines and ICU
    versions, and constructing one inside a frame is one of the most expensive things in the
    formatter. See §4.5.

22. **Non-finite input reaching the formatter.** A rate of `0/0` prints `NaN` in the HUD, and
    a player reads `NaN` as a broken game. Return `'—'`.

23. **A guard inside a per-frame loop.** `expectFinite` on every sprite position is a
    measurable cost for a mistake the caller makes once, at construction. Guards live at API
    entry points.

24. **`!` to silence the compiler.** `PLAYBOOK.md` trap 14: `runs[0]!.push(...)` on an array
    that is empty for two of four biomes shipped a black screen to those players. Under
    `noUncheckedIndexedAccess`, `items[i]` really is `T | undefined`; the type was the bug
    report. `Rng.pick` earns its single narrowing cast with a length check on the line above.

25. **Drawing per-tile variation from an `Rng`.** `if (rng.bool(0.1)) drawCrack(tile)` inside
    a render loop ties every tile's appearance to the order tiles were visited, so the
    valley reshuffles the first time anything culls, batches, or sorts differently — which
    presents as "the world changed when I bought a lamp". Per-position variation is
    `toUnit(hash2(seed, tx, ty)) < 0.1`: no cursor, no order, no state.

26. **A coordinate hash that is linear in its inputs.** `x * 31 + y * 17` fed to a mixer
    still produces visible diagonal banding, because equal values of `31x + 17y` lie on a
    line. Mix `x` and `y` *separately* through `mix32` before combining, and check for
    banding by rendering the field, not by testing a hundred samples.

27. **A frozen table computed at import time.** `Object.freeze` over a table built by a loop
    costs on every import of the package, including in a test that only wanted `clamp`. The
    tables here are literals.

---

## Appendix: gaps this RFC found that belong elsewhere

Recorded here because the architect brief asks for them; they are **not** core's work.

- **Nothing in `.lattice/kit.json` owns replay.** The constitution's headline claim is that
  a session replays from "a seed and an input log". Core provides the seed and the snapshot;
  `input` provides events; `loop` provides the tick index. No package owns the *recorder* —
  the versioned envelope of `{ kitVersion, seed, inputs[], checkpoints[] }` and the
  divergence check that makes the claim falsifiable. Proposed owner: `persist` (it already
  owns versioning and integrity), with a `replay` module. Without it the kit's central
  promise is untested.
- **`tools/` lint needs a transcendental rule.** The existing ban covers `Math.random`,
  `Date.now`, `performance.now`. Tier A additionally requires that
  `Math.sin|cos|tan|atan|atan2|pow|exp|log|cbrt|hypot` appear nowhere in `packages/core/src`
  except the four symbols named in §3.1. Also worth adding: a `!` non-null-assertion ban
  (`PLAYBOOK.md` trap 14) and a `sideEffects` check.
- **`loop`'s tween API should take `Easing | EasingName`** and resolve names through core's
  `EASINGS`, rather than defining its own curve set. If it defines its own, the kit has two
  easing vocabularies and save files reference the wrong one.
- **`draw` inherits the colour argument in §4.1**, including the rule that survived
  `foom-simple-ui`: *persist the hue, never the derived tokens* — which makes it a joint
  `draw`/`persist` constraint that neither RFC currently states.
- **`iso` should own `Rect`/`Bounds`** (§4.6) and the binary heap for A*, and must state the
  floor-not-round tile rule (`PLAYBOOK.md` trap 5) as an invariant.
- **`persist` should use `hashString` for its integrity check** rather than a bespoke CRC,
  and must document that a 32-bit digest detects corruption and does not authenticate.
- **Nothing owns entity identity.** `sim` is the natural home for a monotonic, save-stable
  id allocator; core deliberately does not provide one (§4.7).
