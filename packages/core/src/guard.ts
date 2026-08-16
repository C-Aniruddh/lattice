/**
 * Validators, not assertions.
 *
 * Every function here takes a value, throws an error that **names what it got**, and returns
 * that value. That shape is the whole design, and it is chosen against the habit everyone
 * arrives with:
 *
 * ```ts
 * assert(zoom > 0.25 && zoom < 8, 'bad zoom');          // what this kit does not have
 * this.zoom = expectRange(zoom, 0.25, 8, 'camera.zoom'); // what it has instead
 * ```
 *
 * A boolean has **already discarded** the value that was wrong, so its message can only ever
 * be prose — which is precisely the failure the constitution's rule 9 names. And `assert` is
 * the exact call shape build tools strip in production, so the check would run only where it
 * is least needed. A validator that returns its argument cannot be stripped, because the call
 * site does not compile without the result.
 *
 * Every message follows rule 9: the caller's symbol, the expectation, and the value received.
 * `camera.zoom: expected a finite number in [0.25, 8], got -1`.
 *
 * **These run at construction and at API entry points.** They do not run per frame or per
 * entity: a guard inside a per-sprite loop is a measurable cost for a mistake a caller makes
 * once. Tier A — no clock, no randomness, no platform.
 */

/**
 * Render a received value for an error message.
 *
 * `String()` rather than a template literal because `${aSymbol}` throws a `TypeError` of its
 * own, and an error thrown *while building an error message* is the worst possible way to
 * learn about a bad argument. Strings are quoted so that `''` and `'0'` are distinguishable
 * from nothing at all.
 */
function show(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/**
 * The type half of every numeric guard below.
 *
 * A `TypeError` and not a `RangeError`, per the kit's rule: wrong kind of thing is a
 * `TypeError`, wrong value of the right kind is a `RangeError`.
 *
 * Takes `unknown` rather than `number`, which is the whole reason the two public guards below
 * can be used on the save path. A value out of `JSON.parse` is `unknown`, and a guard typed
 * `(value: number)` cannot be applied to one without a cast — so a recogniser either casts
 * (defeating the check it was reaching for) or hand-rolls a `typeof`. The runtime behaviour
 * was always correct here; only the signature was refusing the callers it was written for.
 */
function expectNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(`${label}: expected a number, got ${typeof value} ${show(value)}`);
  }
  return value;
}

/**
 * Reject `NaN` and both infinities.
 *
 * The guard for anything that will be multiplied into a position, a volume or a rate. `NaN`
 * is the value that spreads: one of them in a velocity turns a position into `NaN`, which
 * turns a camera target into `NaN`, and the screen goes blank a hundred frames from where the
 * mistake was made. Catching it at the entry point is the difference between a stack trace
 * and an afternoon.
 *
 * @throws RangeError naming the label and the value.
 */
export function expectFinite(value: unknown, label: string): number {
  const n = expectNumber(value, label);
  if (!Number.isFinite(n)) {
    throw new RangeError(`${label}: expected a finite number, got ${show(n)}`);
  }
  return n;
}

/**
 * Reject anything that is not a whole number, including `NaN` and the infinities.
 *
 * For the things that are counted rather than measured: tile coordinates, octave counts, item
 * quantities. A fractional tile index silently floors somewhere downstream, and the tile that
 * gets drawn is one the caller never asked about.
 *
 * @throws RangeError naming the label and the value.
 */
export function expectInt(value: number, label: string): number {
  expectNumber(value, label);
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label}: expected an integer, got ${show(value)}`);
  }
  return value;
}

/**
 * Inclusive on both ends: `min <= value <= max`.
 *
 * `NaN` fails, because the comparison is written so that it must — `!(value >= min && value
 * <= max)` rather than `value < min || value > max`, which lets `NaN` through both tests and
 * is the single most common way a range check does nothing at all.
 *
 * @throws RangeError naming the label, both bounds, and the value.
 */
export function expectRange(value: number, min: number, max: number, label: string): number {
  expectNumber(value, label);
  if (!(value >= min && value <= max)) {
    throw new RangeError(
      `${label}: expected a finite number in [${String(min)}, ${String(max)}], got ${show(value)}`,
    );
  }
  return value;
}

/**
 * An integer index in `[0, length)` — the half-open interval arrays actually use.
 *
 * Returns the index, so it sits inside the subscript: `items[expectIndex(i, items.length,
 * 'tileMap.at')]`. Under `noUncheckedIndexedAccess` an out-of-range read is `undefined` and
 * the type system tells you so; this is for the cases where the index came from outside and
 * the caller wants the mistake named rather than propagated as an `undefined`.
 *
 * @throws RangeError if `index` is not an integer in `[0, length)`.
 */
export function expectIndex(index: number, length: number, label: string): number {
  expectNumber(index, label);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError(
      `${label}: expected an integer index in [0, ${String(length)}), got ${show(index)}`,
    );
  }
  return index;
}

/**
 * Reject an empty array, returning it otherwise.
 *
 * The guard for every "pick one of these" API. An empty weight table, an empty biome list, an
 * empty palette: each of them returns `undefined` from an index that the code around it
 * treats as always present, which is how a `!` gets added and how a black screen ships.
 *
 * @throws TypeError if `items` is not an array, RangeError if it is empty.
 */
export function expectNonEmpty<T>(items: readonly T[], label: string): readonly T[] {
  if (!Array.isArray(items)) {
    throw new TypeError(`${label}: expected an array, got ${show(items)}`);
  }
  if (items.length === 0) {
    throw new RangeError(`${label}: expected a non-empty array, got 0 items`);
  }
  return items;
}

/**
 * Reject a number that will not survive `JSON.stringify` — the save-path guard.
 *
 * `JSON.stringify(Infinity)` is `"null"`, and so is `NaN`. That is the worst corruption shape
 * in the kit: the bytes are intact, the checksum matches, the schema is the right shape, and
 * an infinite stock silently returns as nothing. No layer downstream can detect it, which is
 * why the check belongs at the moment of writing rather than the moment of reading.
 *
 * Normalises `-0` to `0`, because `JSON.stringify(-0)` is `"0"` and a value that changes
 * across a round trip fails an integrity comparison for a reason nobody will ever find.
 *
 * **This is not a magnitude cap.** `2 ** 60` and `1e308` pass, and they round-trip through
 * JSON exactly — 2^53 is an *arithmetic* limit, not a serialisation one, and the guard for
 * that is `expectSafeInteger`.
 *
 * @throws RangeError naming the caller and the value.
 */
export function expectSerializable(value: unknown, label: string): number {
  const n = expectNumber(value, label);
  if (!Number.isFinite(n)) {
    throw new RangeError(
      `${label}: expected a value that survives JSON, got ${show(n)} — JSON.stringify writes null for NaN and both infinities, so the save would load as a missing value with a valid checksum`,
    );
  }
  return n === 0 ? 0 : n;
}

/**
 * The non-throwing form — the load-path predicate.
 *
 * `persist`'s invariant is that a corrupt save degrades to a fresh one with a reported reason
 * and **never throws on boot**, so the load path needs to *ask* rather than assert. Same rule
 * as `expectSerializable`, both directions of the boundary: it returns `false` for exactly
 * the inputs that make the other throw, and for no others.
 */
export function isSerializable(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Reject a count that has left the exactly-representable integers.
 *
 * For quantities that are counted rather than measured: buildings owned, ticks elapsed,
 * entity ids. Above 2^53 a double cannot hold consecutive integers, so `n + 1` quietly
 * becomes `n` and two different logical values compare equal — an id allocator stops
 * allocating and every entity after it is the same entity.
 *
 * Deliberately *not* applied to an idle economy's stocks: those are measured quantities from
 * a closed-form curve, `1e40` is a perfectly good double, and capping them would break the
 * genre. Count with this; measure without it.
 *
 * @throws RangeError naming the caller and the value.
 */
export function expectSafeInteger(value: number, label: string): number {
  expectNumber(value, label);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${label}: expected a safe integer in [-(2^53 - 1), 2^53 - 1], got ${show(value)} — above that a double cannot hold consecutive integers, so n + 1 silently equals n`,
    );
  }
  return value;
}

/**
 * Exhaustiveness check for a discriminated union.
 *
 * In the default branch of a `switch`, `unreachable(kind, 'building.kind')` stops compiling
 * the day a case is added — which is the only kind of error worth having, because it is found
 * by the person adding the case rather than by a player finding a building that does nothing.
 *
 * The runtime throw is the backstop for the value that arrived from outside the type system —
 * a save file, a network message, a hand-edited config — and it is a `TypeError` because the
 * value is of a kind this code has never heard of.
 */
export function unreachable(value: never, label: string): never {
  throw new TypeError(`${label}: unhandled case ${show(value)} — a variant was added without a branch here`);
}

/**
 * Narrow an unknown to a plain object with string keys.
 *
 * The one non-numeric guard here, and it exists because every save recogniser in the kit was
 * otherwise hand-rolling the same six lines. A recogniser receives whatever `JSON.parse`
 * produced — which may be `null`, an array, a string, or a number — and has to get from
 * `unknown` to something it can read a field off. Without this, each one writes its own
 * `typeof x === 'object' && x !== null && !Array.isArray(x)` and half of them forget one of
 * the three clauses.
 *
 * All three matter, and the two that get forgotten are the interesting ones. **`typeof null`
 * is `'object'`**, so a save whose payload is the literal `null` sails past a naive check and
 * fails later on a property read, at a point that no longer names the save. And an **array is
 * an object**, so a payload that was serialised as `[…]` when the schema expected `{…}` reads
 * as valid until a field comes back `undefined` — which a permissive migration will then
 * happily carry forward as a default.
 *
 * Returns a `Record<string, unknown>` rather than a generic `T`, deliberately. Narrowing to
 * the caller's own type is a *claim*, and this function has checked only the shape; handing
 * back `T` would let a recogniser skip the field checks that are the entire reason it exists.
 *
 * @param value - Anything, typically straight out of `JSON.parse`.
 * @param label - The caller's symbol, for the message.
 * @throws TypeError naming what arrived instead.
 */
export function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const got = value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
    throw new TypeError(`${label}: expected a plain object, got ${got} ${show(value)}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Narrow an unknown to a plain object whose every value is a finite number.
 *
 * The shape a stock vector, a resource wallet or a settings blob arrives in, and the one a
 * recogniser most often wants. Checking the values here rather than at first use is what lets
 * a corrupt save be *reported* as corrupt instead of turning into `NaN` three subsystems
 * later — and `NaN` is the value that spreads, so the distance between the bad byte and the
 * blank screen is otherwise arbitrary.
 *
 * Note that this rejects a value that is merely non-finite as firmly as one that is not a
 * number at all, and it should: `Infinity` does not survive `JSON.stringify` — it becomes
 * `null`, with a perfectly valid checksum over it — so a stock that reads back as `null` is
 * evidence of a write that should never have happened.
 *
 * @param value - Anything, typically straight out of `JSON.parse`.
 * @param label - The caller's symbol, for the message.
 * @throws TypeError if it is not an object, or if any value is not a finite number. The
 *   message names the offending **key**, because "expected finite numbers" without one sends
 *   the reader to look at all of them.
 */
export function expectRecordOfFinite(value: unknown, label: string): Record<string, number> {
  const record = expectObject(value, label);
  for (const key of Object.keys(record)) {
    const entry = record[key];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new TypeError(
        `${label}.${key}: expected a finite number, got ${typeof entry} ${show(entry)}`,
      );
    }
  }
  return record as Record<string, number>;
}
