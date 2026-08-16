/**
 * The seeded stream: one deterministic generator, forked by identity rather than by cursor.
 *
 * A game built on Lattice must be able to replay a session from a seed and an input log and
 * land on the same pixel. That promise rests entirely on this file, so it obeys three rules
 * that are stricter than the rest of the kit's:
 *
 * - **Bit-exact across platforms.** Every intermediate stays in uint32 space via
 *   `Math.imul`, `>>>` and `^`, whose semantics ECMA-262 fixes exactly. The only division
 *   is by `2 ** 32`: an exact integer below 2^32 over a power of two is exactly
 *   representable as an IEEE-754 double, so {@link Rng.next} is bit-identical on every
 *   conforming engine. Tier A throughout — no `sin`, no `pow`, no `exp`.
 * - **No module-level mutable state.** There is deliberately no default or global `Rng`,
 *   and no `Math.random` fallback. A shared implicit stream makes every subsystem's output
 *   depend on every other subsystem's draw count, which is the single highest-value absence
 *   in the package.
 * - **One `Rng` per subsystem, obtained by {@link Rng.derive}, never shared.** Two
 *   subsystems on one stream is the bug; a stream per subsystem is free.
 *
 * Ported from `foom-simple-ui/src/core/rng.ts`, which shipped, with `weighted`,
 * `shuffleInPlace` and the {@link hashStep} fold added.
 */

import { expectFinite, expectNonEmpty } from './guard.js';
import { hashNumber, hashStep, hashString } from './hash.js';

/** Two to the 32nd: the uint32 modulus, and the exact divisor {@link Rng.next} uses. */
const TWO_32 = 4294967296;

/** mulberry32's odd increment. Odd is what makes the state cycle the full 2^32. */
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** True when `value` is an integer in [0, 2^32) — the shape a snapshot field must have. */
function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < TWO_32;
}

/**
 * Normalise anything usable as a seed or a fork label into a uint32.
 *
 * The finite check lives here rather than in `hashNumber` so the message can name the
 * method the caller actually called, per non-negotiable #9. The tell for the mistake this
 * catches is a seed computed as `Number(searchParams.get('seed'))`, which is `NaN` for a
 * missing parameter and would otherwise seed every player with the same world.
 */
function seedPart(part: number | string, caller: string): number {
  if (typeof part === 'string') return hashString(part);
  return hashNumber(expectFinite(part, caller));
}

/**
 * A serialisable capture of an {@link Rng}'s full internal state.
 *
 * `seed` is the stream's identity and never changes with drawing; `state` is the cursor and
 * advances once per draw. Both are uint32, so this round-trips through JSON losslessly —
 * which is what lets `persist` store a stream mid-run and resume the exact sequence. Store
 * only one of the two fields and the resumed run either repeats itself or diverges.
 */
export interface RngSnapshot {
  readonly seed: number;
  readonly state: number;
}

/**
 * One deterministic random stream (mulberry32).
 *
 * Instances are mutable — each draw advances the cursor — and must **not** be shared
 * between subsystems. Two subsystems on one stream means the contents of each depend on how
 * often the other drew, which is a bug that only ever shows up as "the world changed when I
 * opened the menu". Use {@link Rng.derive} instead; that is the entire reason it exists.
 *
 * Construct with {@link createRng}, or with {@link Rng.fromSnapshot} to resume a saved one.
 */
export class Rng {
  /**
   * The stream's identity as a uint32, invariant under drawing.
   *
   * `derive` forks from this and never from the cursor, so a child stream is the same
   * stream no matter how far its parent has advanced. It is also what `noise` and `hash`
   * want: `fbm2(rng.derive('terrain').seed, ...)` is a pure function of a number, with no
   * stream to thread through a renderer.
   */
  readonly seed: number;

  /** The mulberry32 cursor. uint32, advances once per {@link Rng.nextUint32}. */
  private state: number;

  private constructor(seed: number, state: number) {
    this.seed = seed >>> 0;
    this.state = state >>> 0;
  }

  /**
   * Build a stream whose identity and cursor are both `seed`.
   *
   * @internal Prefer {@link createRng}, which hashes its argument first. Seeding mulberry32
   * with a raw 1, 2, 3 produces visibly correlated first draws — three worlds that share
   * their first tree. Exposed for {@link Rng.derive} and for snapshot restore, both of
   * which pass an already-avalanched value.
   */
  static fromUint32Seed(seed: number): Rng {
    const normalised = seed >>> 0;
    return new Rng(normalised, normalised);
  }

  /**
   * Rebuild a stream from a snapshot — the save/load and replay path.
   *
   * @throws RangeError if either field is not a uint32, i.e. a corrupted or hand-edited
   *   save. Accepting it would resume a stream at a cursor that no longer means anything,
   *   and the divergence would be blamed on whatever drew next.
   */
  static fromSnapshot(snapshot: RngSnapshot): Rng {
    if (!isUint32(snapshot.seed) || !isUint32(snapshot.state)) {
      throw new RangeError(
        `Rng.fromSnapshot: expected uint32 seed and state, got seed=${String(snapshot.seed)}, ` +
          `state=${String(snapshot.state)}`,
      );
    }
    return new Rng(snapshot.seed, snapshot.state);
  }

  /**
   * The raw generator: one mulberry32 step, uniform over the full uint32 range.
   *
   * Every multiply is `Math.imul` because a plain `a * b` on two 32-bit integers produces up
   * to 64 bits, which exceeds the 53-bit mantissa — and the bits that round away are the low
   * ones, which are the entire output of a hash.
   */
  nextUint32(): number {
    this.state = (this.state + MULBERRY_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    // `t + imul(...)` can exceed 32 bits, but stays far below 2^53 — so it is exact as a
    // double — and `^` then reduces it modulo 2^32 via ToInt32. No rounding occurs.
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * A float in [0, 1). Exactly `nextUint32() / 2**32`.
   *
   * An integer below 2^32 over a power of two is exactly representable as a double, so this
   * is bit-identical everywhere. Any other normalisation — `/ (2**32 - 1)`, or the rounded
   * literal `* 2.3283064365386963e-10` — reintroduces rounding and quietly breaks replay on
   * one engine out of three.
   */
  next(): number {
    return this.nextUint32() / TWO_32;
  }

  /**
   * A uniform integer in [minInclusive, maxExclusive).
   *
   * Rejection-samples against the largest multiple of the span that fits in a uint32.
   * `min + (nextUint32() % span)` over-represents the low `2^32 % span` values: invisible on
   * a d6, and visible on a one-in-three loot table over a session — a bias with no symptom
   * until someone counts. The expected number of retries is below one.
   *
   * The bound checks are written out here rather than delegated to `guard`, deliberately:
   * `shuffleInPlace` calls this once per element per frame, and `guard`'s own contract is
   * that a validator belongs at an API entry point and not in a per-entity loop.
   *
   * @throws RangeError unless both bounds are integers, `max > min`, and the span is at
   *   most 2^32. A span of exactly 2^32 is allowed and never rejects a draw.
   */
  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError(
        `rng.int: expected integer bounds, got [${String(minInclusive)}, ${String(maxExclusive)})`,
      );
    }
    const span = maxExclusive - minInclusive;
    if (span <= 0) {
      throw new RangeError(
        `rng.int: expected max > min, got [${minInclusive}, ${maxExclusive})`,
      );
    }
    if (span > TWO_32) {
      throw new RangeError(`rng.int: expected a span of at most 2^32, got ${span}`);
    }
    // Both operands are exact integers, so this modulo is exact.
    const limit = TWO_32 - (TWO_32 % span);
    let draw = this.nextUint32();
    while (draw >= limit) {
      draw = this.nextUint32();
    }
    return minInclusive + (draw % span);
  }

  /**
   * A float in [min, max), or exactly `min` when the bounds are equal.
   *
   * @throws RangeError unless both bounds are finite and `max >= min`. An infinite bound
   *   would produce `Infinity` or `NaN`, and `JSON.stringify` writes both as `null` — a
   *   value that vanishes from a save with the checksum still matching.
   */
  float(min: number, max: number): number {
    expectFinite(min, 'rng.float(min)');
    expectFinite(max, 'rng.float(max)');
    if (max < min) {
      throw new RangeError(`rng.float: expected max >= min, got [${min}, ${max})`);
    }
    return min + this.next() * (max - min);
  }

  /**
   * A coin flip.
   *
   * `probability <= 0` never fires and `>= 1` always does, since {@link Rng.next} is
   * half-open — so a rate driven to its extremes by a game's own maths degrades to
   * "never" and "always" rather than to an off-by-one.
   *
   * @param probability - chance of `true`, default 0.5.
   * @throws RangeError if `probability` is not finite. `NaN` would compare false against
   *   everything and read as a silently dead branch.
   */
  bool(probability = 0.5): boolean {
    expectFinite(probability, 'rng.bool(probability)');
    return this.next() < probability;
  }

  /**
   * A uniformly chosen element.
   *
   * @throws RangeError on an empty array. Under `noUncheckedIndexedAccess` that is the only
   *   way to return `T` rather than `T | undefined`, and an empty pick is a caller bug in
   *   every case we have — a table that is empty for two of four biomes is exactly the
   *   shape that shipped a black screen in the source game.
   */
  pick<T>(items: readonly T[]): T {
    expectNonEmpty(items, 'rng.pick');
    const index = this.int(0, items.length);
    // Guarded by the length check above: the index is < items.length by construction.
    return items[index] as T;
  }

  /**
   * The index of a weighted choice. Weights need not sum to 1, and zero weights are never
   * chosen.
   *
   * This exists because every game hand-rolls it and half of them accumulate in a different
   * order each call — a determinism bug with no symptom until a replay diverges. Exactly one
   * draw is consumed regardless of the table's size, so adding a zero-weight row to a loot
   * table does not shift every later draw in the session.
   *
   * A hole in a sparse array counts as a zero weight, the same as an explicit 0.
   *
   * @throws RangeError if `weights` is empty, contains a negative or non-finite value, or
   *   sums to zero. A table that sums to zero has no answer to give, and returning 0 would
   *   make "everything is disabled" look like "the first one always wins".
   */
  weighted(weights: readonly number[]): number {
    expectNonEmpty(weights, 'rng.weighted');
    let total = 0;
    let last = -1;
    for (let i = 0; i < weights.length; i += 1) {
      const weight = weights[i] ?? 0;
      if (!Number.isFinite(weight) || weight < 0) {
        throw new RangeError(
          `rng.weighted: expected a finite weight >= 0 at index ${i}, got ${String(weight)}`,
        );
      }
      if (weight > 0) {
        total += weight;
        last = i;
      }
    }
    if (last < 0) {
      throw new RangeError('rng.weighted: expected the weights to sum above zero, got 0');
    }
    const target = this.next() * total;
    let accumulated = 0;
    // Falling out of the loop means the target sits in the final non-zero bucket, so `last`
    // is the answer and no unreachable fallback is needed. Iterating past `last` could only
    // ever select a zero-weight row through floating-point slack.
    for (let i = 0; i < last; i += 1) {
      accumulated += weights[i] ?? 0;
      if (target < accumulated) return i;
    }
    return last;
  }

  /**
   * Fisher-Yates.
   *
   * Not `items.sort(() => rng.next() - 0.5)`: that is not a uniform permutation under any
   * sort algorithm, and its result depends on the engine's sort implementation — so it is
   * non-deterministic *across platforms* on top of being biased.
   *
   * @returns a NEW array; the input is never mutated, because callers pass frozen constant
   *   tables into this constantly.
   */
  shuffle<T>(items: readonly T[]): T[] {
    return this.shuffleInPlace(items.slice());
  }

  /**
   * Fisher-Yates in place, returning the same array.
   *
   * The hot-path form: shuffling a 400-entry draw order every frame must not allocate a
   * 400-entry array every frame. Draws the same sequence as {@link Rng.shuffle} for the same
   * input, so switching between them does not change a replay.
   */
  shuffleInPlace<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      // Read both before writing either: `i === j` is common and a naive swap would
      // otherwise depend on the write order.
      const a = items[i] as T;
      const b = items[j] as T;
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  /**
   * Fork an independent child stream from this stream's IDENTITY, not its cursor.
   *
   * `rng.derive('scenery')` returns the same stream whether the parent has drawn zero times
   * or a million. That is what lets terrain stay byte-stable while the UI draws freely, and
   * what lets a per-tick stream be addressed as `derive('event', tick)`. Forking from the
   * cursor instead passes every test and then regenerates the world differently because a
   * menu animation drew a sparkle first — which is the exact failure this method exists to
   * make unreachable.
   *
   * Labels are order-sensitive: `derive('a', 'b')` and `derive('b', 'a')` are different
   * streams, so a `(category, id)` pair cannot collide with its own transpose. They are also
   * a *path*: `derive('a').derive('b')` is `derive('a', 'b')`, so a subsystem may be handed
   * either a pre-derived stream or the labels to derive with and reach the same world.
   *
   * @throws RangeError if called with no labels — an unlabelled fork is a clone, and
   *   silently sharing a stream is the bug this method exists to prevent — or if a numeric
   *   label is not finite.
   */
  derive(...labels: readonly (number | string)[]): Rng {
    if (labels.length === 0) {
      throw new RangeError('rng.derive: expected at least one label, got none');
    }
    let h = this.seed >>> 0;
    for (const label of labels) {
      h = hashStep(h, seedPart(label, 'rng.derive'));
    }
    return Rng.fromUint32Seed(h);
  }

  /** Capture the full internal state. JSON-serialisable; see {@link RngSnapshot}. */
  snapshot(): RngSnapshot {
    return { seed: this.seed, state: this.state };
  }

  /**
   * Restore in place when the identity matches, otherwise return a new instance.
   *
   * `seed` is `readonly`, and a stream that could change identity under you would make every
   * `derive` call above it a lie — the children would keep forking from an identity their
   * parent no longer has. So a cross-identity restore hands back a different object, and a
   * caller that ignores the return value keeps the stream it already had rather than a
   * silently mutated one.
   *
   * @throws RangeError if either snapshot field is not a uint32.
   */
  restore(snapshot: RngSnapshot): Rng {
    if (!isUint32(snapshot.seed) || !isUint32(snapshot.state)) {
      throw new RangeError(
        `rng.restore: expected uint32 seed and state, got seed=${String(snapshot.seed)}, ` +
          `state=${String(snapshot.state)}`,
      );
    }
    if (snapshot.seed !== this.seed) {
      return Rng.fromSnapshot(snapshot);
    }
    this.state = snapshot.state;
    return this;
  }

  /** An independent copy positioned exactly here. Advancing it never touches this one —
   *  which is what lets a system speculate ahead (a preview, a lookahead) without spending
   *  draws the real stream will need. */
  clone(): Rng {
    return Rng.fromSnapshot(this.snapshot());
  }
}

/**
 * Create a stream from a numeric or string seed.
 *
 * The seed is hashed first, so `1`, `2`, `3` — or `'level-1'`, `'level-2'` — are
 * well-separated streams and not correlated ones. Pass the key itself, not a pre-hash of
 * it: `createRng(hashString(key))` hashes twice, which is harmless but reads as though the
 * first hash were load-bearing, and someone will later optimise away the wrong one.
 *
 * This is also the answer to "materialise a stream from a key that already identifies the
 * thing": per-instance sprite variation from `createRng(spriteKey)` is identical whether the
 * sprite is drawn directly, drawn into a cache, or redrawn after an eviction. Allocation is
 * fine there — an `Rng` is a two-field object and one per cache *miss* is nothing. One per
 * sprite per *frame* is not; that case wants `hash2`/`hash3` with `toUnit`, which allocates
 * nothing and needs no stream at all.
 *
 * @throws RangeError if a numeric seed is not finite.
 */
export function createRng(seed: number | string): Rng {
  return Rng.fromUint32Seed(seedPart(seed, 'createRng'));
}
