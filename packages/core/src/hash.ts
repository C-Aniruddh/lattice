/**
 * 32-bit avalanche mixing: one hash, for seeds, coordinates, cache keys and checksums.
 *
 * Four packages arrived at this module independently and from different directions —
 * `persist` wanted a save checksum, `iso` a per-tile scramble, `audio` a stateless roll
 * over `(bar, step, track)`, `draw` a sprite-cache key and a frame digest. What they share
 * is not randomness: it is a value that depends **only on its coordinates**, and not on how
 * many times anything else was drawn, played or saved first. That is a different primitive
 * from a stream, and it lives in its own module so that choosing correctly is the obvious
 * thing rather than the informed thing.
 *
 * **Everything here is Tier A** (see the tier table in `AGENTS.md`). Every multiply is
 * `Math.imul`, every intermediate is reduced with `>>>` or `^`, and the only division is by
 * `2 ** 32` — a power of two, so it is exact. There is no `Math.sin`, no `Math.pow`, and no
 * floating-point accumulation anywhere in the file. The output is therefore the same bits
 * on a phone, in CI, and on a server, which is the only reason a save file may carry a
 * digest at all.
 *
 * There is deliberately no module-level mutable state: every binding below is a `const`
 * primitive or a function declaration, so importing this module twice — or importing two
 * copies of it — changes nothing observable.
 *
 * **The one portability seam** is {@link hashString}, which walks UTF-16 code units. See
 * its own note.
 */

/** Two to the 32nd: the uint32 modulus, and the exact divisor {@link toUnit} uses. */
const TWO_32 = 4294967296;

/** murmurhash3's fmix32 multipliers. Odd, so each multiply stays a bijection over uint32. */
const FMIX_A = 0x85ebca6b;
const FMIX_B = 0xc2b2ae35;

/** FNV-1a's 32-bit offset basis — {@link hashString}'s starting accumulator. */
const FNV_OFFSET = 2166136261;

/** xmur3's multiplier. */
const XMUR_MULTIPLIER = 3432918353;

/**
 * The odd constant folded into every {@link hashStep}, and it is load-bearing.
 *
 * `mix32(0) === 0` — fmix32 is a bijection with a fixed point at zero — so a fold built
 * only from xor and `mix32` maps seed 0 at tile (0, 0) to 0, and again at (0, 0, 0). Every
 * system keyed on a zero seed would then agree exactly at the world origin, which is
 * visible as a single anomalous tile that no test samples. Adding an odd constant before
 * the final avalanche removes the fixed point without touching any other property.
 */
const STEP_ODD = 0x9e3779b9;

/**
 * murmurhash3's 32-bit finaliser (fmix32) — an avalanche bijection over uint32.
 *
 * Why it exists: seeds arrive in narrow ranges (0, 1, 2; tick indices; entity ids). Fed to
 * a generator raw, adjacent inputs produce visibly correlated first draws — three worlds
 * that share their first tree. This spreads them across the whole 32-bit space first, so
 * `1` and `2` are unrelated rather than adjacent.
 *
 * Being a bijection, it never collides and it has exactly one fixed point: `mix32(0)` is
 * `0`. Do not read a zero result as "this value was never hashed", and do not build a fold
 * out of `mix32` and `^` alone — see {@link hashStep}.
 *
 * `value` is taken modulo 2^32 (`ToUint32`), so fractions truncate toward zero and
 * negatives wrap; non-finite input becomes 0 rather than throwing, because this is the
 * primitive every other function here is built from and a throw belongs at the boundary.
 */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, FMIX_A);
  h ^= h >>> 13;
  h = Math.imul(h, FMIX_B);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic 32-bit hash of a string (xmur3-style mixing, fmix32 finalise).
 *
 * Hashes by **UTF-16 code unit**, so `'é'` as U+00E9 and as U+0065 U+0301 hash differently,
 * and an astral-plane character is hashed as its two surrogates. Normalise
 * (`value.normalize('NFC')`) before hashing anything that crosses a platform boundary or a
 * save file: a player name typed on macOS and on Windows otherwise seeds two different
 * worlds, and the bug reproduces on nobody's machine. This is the one portability seam in
 * the package, and it is a seam rather than a defect because normalising here would cost
 * every call site an allocation to protect the few that need it.
 *
 * The length is folded in, so `'a\0'` and `'a'` differ. 32 bits is a birthday collision at
 * ~77,000 distinct inputs: plenty for cache keys and corruption detection, not a
 * content-address, and never cryptographic.
 */
export function hashString(value: string): number {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h ^ value.charCodeAt(i), XMUR_MULTIPLIER);
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return mix32((h ^ value.length) >>> 0);
}

/**
 * Fold an arbitrary finite number into a uint32 **without discarding its high bits**.
 *
 * Timestamps (~1.7e12) and generated ids both exceed 2^32, and a bare `value >>> 0` throws
 * away everything above bit 31 — so a million distinct ids collapse onto a few thousand
 * hashes and two saves an hour apart key the same cache entry. This truncates toward zero
 * and mixes the high and low halves together instead.
 *
 * `hashNumber(0)` is `0`, inherited from {@link mix32}'s fixed point. That is safe for a
 * seed (mulberry32's increment is odd, so a zero state is an ordinary state) and is exactly
 * why {@link hashStep} carries an odd constant.
 *
 * @throws RangeError if `value` is not finite — `NaN` and `Infinity` would both collapse to
 *   0 under `ToUint32`, silently seeding one stream from two different mistakes.
 */
export function hashNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`hashNumber: expected a finite number, got ${String(value)}`);
  }
  const truncated = Math.trunc(value);
  const low = truncated >>> 0;
  const high = Math.trunc(truncated / TWO_32) >>> 0;
  return mix32((mix32(high) ^ low) >>> 0);
}

/**
 * Fold one more value into a running hash. **This is the general mechanism; everything
 * below is a convenience over it.**
 *
 * {@link hash2} and {@link hash3} are literally two and three of these, unrolled — not
 * separate algorithms — which is why there is no `hash4` and never will be. Four
 * coordinates is `hashStep(hashStep(hashStep(hashStep(seed, a), b), c), d)`: still one
 * expression, still allocation-free, still the same avalanche. A package that needs five
 * does the same thing, and nothing gets added to core.
 *
 * The step avalanches the incoming value *before* combining it and avalanches the
 * accumulator *after*, which is what makes the result non-linear in every argument
 * independently. Combining raw (`31 * x + 17 * y`, then one mix at the end) passes a naive
 * uniformity test and still bands diagonally, because equal values of `31x + 17y` lie on a
 * line and no single final mix can separate them again.
 *
 * It is order-sensitive by construction — the nesting differs, so `(a, b)` and `(b, a)`
 * fold to different values.
 *
 * `value` is truncated to int32 (`ToUint32` semantics); `accumulator` likewise.
 */
export function hashStep(accumulator: number, value: number): number {
  return mix32((((accumulator >>> 0) ^ mix32(value)) + STEP_ODD) >>> 0);
}

/**
 * Combine parts into one uint32, non-commutatively: `hashParts('a', 'b')` and
 * `hashParts('b', 'a')` differ. That is what makes `(worldSeed, chunkX, chunkY)` a usable
 * key rather than one that aliases its own transpose.
 *
 * A {@link hashStep} fold, with string parts routed through {@link hashString} first. The
 * part count participates, so `hashParts('a', 'b')` and `hashParts('ab')` also differ.
 *
 * Variadic, so it allocates a rest array, and it accepts strings. Setup and cache keys, not
 * the hot path — use {@link hash2}, {@link hash3} or {@link hashStep} for numbers in a loop.
 *
 * @throws RangeError if called with no parts (the empty key is almost always a bug in the
 *   caller's key construction, and returning a constant would make every such bug collide),
 *   or if a numeric part is not finite.
 */
export function hashParts(...parts: readonly (number | string)[]): number {
  if (parts.length === 0) {
    throw new RangeError('hashParts: expected at least one part, got none');
  }
  let h = FNV_OFFSET >>> 0;
  for (const part of parts) {
    h = hashStep(h, typeof part === 'string' ? hashString(part) : hashNumber(part));
  }
  return h >>> 0;
}

/**
 * White noise from a coordinate pair: a uint32 that is a pure function of `(seed, x, y)`
 * and nothing else. No stream, no cursor, no allocation.
 *
 * This is the per-tile variation primitive — grass tint, prop rotation, whether this cobble
 * is the cracked one. Drawing that from an `Rng` instead ties every tile's appearance to
 * the order tiles were visited, so the valley reshuffles the first time anything culls,
 * batches or re-sorts, and the bug presents as "the world changed when I bought a lamp".
 * The stateless form is `toUnit(hash2(seed, tx, ty)) < 0.1`.
 *
 * The `seed` argument is not optional and not decorative: two systems sampling the same
 * tile (tree jitter and grass tint) must not receive the same number, or the jitter and the
 * tint correlate and the field reads as a visible grid. Give each system its own constant,
 * or `rng.derive('grass').seed`.
 *
 * `x` and `y` are truncated to int32. Fractional coordinates therefore hash to their
 * integer cell — which is what a tile lookup wants, and a surprise to anyone passing world
 * pixels.
 */
export function hash2(seed: number, x: number, y: number): number {
  return hashStep(hashStep(seed, x), y);
}

/**
 * The same, over three integers — {@link hash2} plus one {@link hashStep}.
 *
 * It exists because two packages arrived at it independently from different domains: `iso`
 * samples a tile grid by `(x, y)` and needed a third axis for layers; `audio`'s sequencer
 * rolls per `(bar, step, track)`, where there is no stream position to advance and no
 * ordering guarantee between tracks — a track muted at load must not shift what every other
 * track plays.
 *
 * Beyond three axes, fold with {@link hashStep} directly. That is the whole point of
 * `hashStep` being exported.
 */
export function hash3(seed: number, x: number, y: number, z: number): number {
  return hashStep(hash2(seed, x, y), z);
}

/**
 * Digest an integer array — a frame buffer, a serialised save, any byte sequence.
 *
 * `draw`'s headless renderer digests a rendered frame to compare against a golden;
 * `persist` digests a serialised save to detect corruption. Neither can reach
 * {@link hashString} without first turning a megabyte of bytes into a string, which
 * allocates the megabyte again to hash it once.
 *
 * **Values are truncated to int32**, like every other input in this module. That is correct
 * for `Uint8Array`, `Uint8ClampedArray` and integer arrays generally, and silently wrong
 * for a `Float32Array` — every value between -1 and 1 truncates to zero, so the digest of a
 * normalised buffer becomes a digest of its length and two completely different frames
 * compare equal. View the bytes instead:
 * `new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)`.
 *
 * The length is folded in first, so a run of trailing zeroes cannot be dropped without
 * changing the digest — which is how a truncated save otherwise passes its own checksum.
 * A hole in a sparse array counts as 0.
 */
export function hashBytes(seed: number, bytes: ArrayLike<number>): number {
  let h = hashStep(seed, bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    h = hashStep(h, bytes[i] ?? 0);
  }
  return h >>> 0;
}

/**
 * A uint32 as a float in [0, 1) — exactly `hashed / 2**32`, the same normalisation
 * `Rng.next` uses, so a hashed value and a drawn value are interchangeable in any threshold
 * test.
 *
 * It must be `/ 4294967296` and not `/ (2**32 - 1)` or `* 2.3283064365386963e-10`: the
 * first is not a power of two so the division rounds, and the second is a rounded literal
 * of the same thing. Either one quietly stops the result being bit-identical, which is the
 * whole promise being made here.
 *
 * Exists so {@link hash2} can stay integer-valued — a caller who wants a bucket wants
 * `% n`, not a float they immediately re-scale — without every consumer writing the magic
 * constant. Input is reduced with `>>> 0`, so a signed int32 from a caller's own bit
 * twiddling cannot produce a negative "probability".
 */
export function toUnit(hashed: number): number {
  return (hashed >>> 0) / TWO_32;
}
