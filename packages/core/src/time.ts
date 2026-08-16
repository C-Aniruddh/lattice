/**
 * The calendar type, and only the type.
 *
 * `loop` refused to own an epoch and was right to: its clock is monotonic, `performance.now()`
 * has no calendar, and a package that cannot stamp anything should not define the stamp. But
 * `persist` stamps every save, `sim` integrates elapsed time from that stamp, and the game
 * injects the one function in the whole application that reads a wall clock. Three layer-1
 * siblings naming the same concept have no common home below core, so core owns the word.
 *
 * **Core still may not read a clock.** Non-negotiable #1 is unchanged, `lint` still bans
 * `Date.now()` in every `src/`, and there is deliberately no default implementation of `Now`
 * anywhere in the kit. Owning the *word* is not owning the *reading*.
 *
 * The two kinds of millisecond are both `number` and are silently interchangeable, which is
 * precisely the bug: passing a monotonic reading where a calendar instant is expected stamps a
 * save with a number whose origin was the document, so offline accrual credits the few seconds
 * since the page loaded and the report reads "offline progress is broken" rather than "wrong
 * clock". The brands make that assignment a compile error. That is the entire product of this
 * module — everything else here is two range checks.
 *
 * **Core does not export `Millis` or `Seconds`.** `loop` owns those two names for durations,
 * and a second identical alias in core would be exactly the drift this module exists to
 * prevent, with core as the culprit. Durations elsewhere stay plain `number` with the unit in
 * the parameter name.
 */

declare const EPOCH_MILLIS: unique symbol;
declare const MONOTONIC_MILLIS: unique symbol;

/**
 * Milliseconds since the Unix epoch — **wall-clock calendar time**, as `Date.now()` returns it.
 *
 * It answers "what time is it", it survives a reload, and it is the only kind of time that may
 * be written to a save file. It can also jump *backwards*: an NTP correction, a timezone
 * change, or a player setting their clock forward to skip a build timer all move it. Anything
 * that subtracts two of these must tolerate a negative result — and must never feed it to an
 * integrator as a frame delta, which runs the simulation backwards.
 *
 * Branded, so a monotonic reading cannot be assigned here by accident. The brand is erased at
 * runtime: it costs one call to `asEpochMillis` at the single `Date.now()` the kit permits,
 * plus a re-brand after arithmetic, because `epoch + 1000` widens to `number`. That widening
 * is a feature — `epochA - epochB` is a *duration*, not an instant, and the type saying so out
 * loud is worth the keystroke.
 */
export type EpochMillis = number & { readonly [EPOCH_MILLIS]: true };

/**
 * Milliseconds from an arbitrary origin — **monotonic time**, as `performance.now()` returns it.
 *
 * It answers "how long since", it never goes backwards, and it is **meaningless in a save
 * file**: the origin is the document, so a value stamped before a reload compares against a
 * different zero afterwards. It may also freeze while the machine sleeps, which is why `loop`
 * clamps catch-up and credits nothing for the gap.
 *
 * Branded for symmetry, and because the confusion runs both ways: using a calendar reading as
 * a frame delta is trap 29, and it is just as expensive.
 */
export type MonotonicMillis = number & { readonly [MONOTONIC_MILLIS]: true };

/**
 * The calendar: the game's single wall-clock reading, injected.
 *
 * There is exactly one of these per application, the game owns it, and it is almost always
 * `() => asEpochMillis(Date.now())`. `persist` takes one to stamp a save; `sim` takes one to
 * integrate to the present. Injecting it is what lets a test run a year of offline accrual in
 * a millisecond, and what lets `lint` ban the global read everywhere else.
 */
export type Now = () => EpochMillis;

/**
 * The stopwatch: a monotonic reading, injected. Usually
 * `() => asMonotonicMillis(performance.now())`.
 *
 * A separate type from `Now` so the two cannot be swapped at an injection site — which is the
 * failure this whole module exists to prevent, and which no amount of documentation on a
 * `number` prevents on its own. Use it for cadence and elapsed time; use `Now` for the
 * calendar.
 */
export type MonotonicNow = () => MonotonicMillis;

/**
 * Brand a number as calendar time, at the one boundary where a real clock is read — or where
 * a stored value is read back.
 *
 * Use it rather than `value as EpochMillis`. The brand is erased at runtime, so a cast is a
 * claim about data you did not produce: a save hand-edited to `"lastSeen": null` becomes an
 * `EpochMillis` of `null` under a cast, and every later subtraction is `NaN` with no exception
 * anywhere near the cause. This function is a real check.
 *
 * Validates finite and nothing else, deliberately. A range check that rejected "this looks
 * like seconds, not milliseconds" would also reject `0` and `1000`, which is what every manual
 * clock in every test starts at — so the unit lives in the name and nowhere else. Never divide
 * an `EpochMillis` by 1000 and keep the type.
 *
 * @param label - the caller's symbol, for the error message. Defaults to `'value'`; pass the
 *   real name (`'save.stampedAt'`) or the message will not tell anyone where to look.
 * @throws RangeError naming the caller and the value received, per non-negotiable #9.
 */
export function asEpochMillis(value: number, label = 'value'): EpochMillis {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${label}: expected a finite number of milliseconds since the Unix epoch, got ${String(value)}`,
    );
  }
  return value as EpochMillis;
}

/**
 * Brand a number as a monotonic reading. As `asEpochMillis`, for the stopwatch.
 *
 * The same finite-only check, and the same reason: an origin is arbitrary, so no range is
 * wrong. Note that this cannot tell you the value really came from a monotonic source — it
 * brands what you hand it. Call it at the injection site, next to the `performance.now()`, and
 * nowhere else.
 *
 * @throws RangeError naming the caller and the value received.
 */
export function asMonotonicMillis(value: number, label = 'value'): MonotonicMillis {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${label}: expected a finite number of milliseconds from a monotonic origin, got ${String(value)}`,
    );
  }
  return value as MonotonicMillis;
}
