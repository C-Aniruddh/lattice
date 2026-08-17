/**
 * The warp on **time**, never on yield.
 *
 * Offline progress answers one question — *how many seconds does the player get credit for?* —
 * and hands the answer to the same closed-form integrator live play uses. Scaling the *output*
 * instead is a dupe with a plausible-looking formula: a player returns from fourteen hours with
 * more of a downstream resource than their producers could have made in the credited window.
 * Warping the clock cannot do that, because every edge in the graph sees the same shortened
 * interval.
 *
 * ## The curve
 *
 * With `U = uncappedSeconds`, `e = exponent`, `F = flatAfterSeconds`:
 *
 * ```
 *            ⎧ T                  0 ≤ T ≤ U     second for second
 *     W(T) = ⎨ U · (T/U)^e        U < T ≤ F     softcapped
 *            ⎩ U · (F/U)^e        T > F         flat — the curve stops rising
 * ```
 *
 * ## Where the middle branch comes from, and the constant of integration
 *
 * Think of a credit *rate* `w(t) = dW/dt` — the fraction of a second you are paid for the `t`-th
 * second away. It is `1` while `t ≤ U`, then decays as a power law:
 *
 * ```
 *     w(t) = e · U^(1−e) · t^(e−1)                 for U < t ≤ F
 *     W(T) = U + ∫_U^T w = U + U^(1−e)·(T^e − U^e)
 *          = U + U^(1−e)·T^e − U          ← the two U terms cancel exactly: C = 0
 *          = U · (T/U)^e
 * ```
 *
 * **The `U^(1−e)` normalization is the whole trick**, and there are two near-misses that pass a
 * casual test:
 *
 * - `W(T) = U + T^e` drops the normalization and **jumps** by `U^e` at the knot — about 259
 *   credited seconds at 3 h / 0.6 — so returning at 3h00m01s pays more than at 2h59m59s. A
 *   visible, farmable step.
 * - `W(T) = U + (T − U)^e` is continuous and wrong more subtly: its slope at `U⁺` is *infinite*
 *   because `e < 1`, so for the first seconds past the knot the player earns **faster than
 *   live**, and closing the tab at 2h59m becomes optimal play. A softcap that opens by paying a
 *   bonus is not a softcap.
 *
 * The form here does neither: `W(U) = U` exactly, and the slope steps *down* from `1` to `e`.
 *
 * ## `W` does not compose, and must never be asked to
 *
 * It is strictly concave, therefore subadditive: two twelve-hour gaps credit **more** than one
 * twenty-four-hour gap. No choice of curve fixes this, because a softcap that composed additively
 * would be linear, i.e. not a softcap. So apply it **exactly once per return**, over the one gap
 * between the ledger's anchor and now. A player who genuinely opened the tab at hour twelve was
 * away for two gaps and is correctly paid more, because they did in fact come back. Splitting is
 * generous, which is the safe direction: nobody is punished for a visit the game failed to record.
 *
 * A schedule inside one absence is *not* a second application — see `schedule.ts`, which
 * distributes this function by evaluating it at phase boundaries and never restarts it.
 *
 * ## Determinism
 *
 * A fractional power is Tier B in general. It is **Tier A when `exponent` is a dyadic rational
 * with denominator ≤ 64** — 0.5, 0.75, 0.625, … — because the implementation then computes it as
 * a chain of `Math.sqrt` and multiplies, both exactly specified by ECMA-262. A game that needs
 * credited time to be bit-identical across engines picks 0.625 instead of 0.6 and gets it for
 * free; the demo does exactly that.
 *
 * Isomorphic: no clock, no randomness, no platform.
 */

import { expectFinite } from '@latticekit/core';

/** The dyadic denominator the sqrt chain reaches: `e = n / 64` for integer `n`. */
const DYADIC_DENOMINATOR = 64;

/** The largest whole exponent taken by exponentiation-by-squaring rather than by `pow`. */
const MAX_WHOLE_EXPONENT = 64;

/**
 * `base^exponent` for a non-negative whole `exponent`, by exponentiation by squaring.
 *
 * Multiplication is exactly specified, so this is Tier A: the same chain of roundings on every
 * engine. `Math.pow` would be at most one ulp more accurate and is not required to be correctly
 * rounded, and for a number that reaches a player's balance, reproducible wins.
 */
function ipow(base: number, exponent: number): number {
  let result = 1;
  let square = base;
  let remaining = exponent;
  while (remaining > 0) {
    if (remaining % 2 === 1) result *= square;
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) square *= square;
  }
  return result;
}

/**
 * `x^(n/64)` for `1 ≤ n < 64`, as a chain of square roots.
 *
 * `n/64` in binary is `Σ bⱼ 2⁻ʲ` for `j` in 1…6, and `x^(2⁻ʲ)` is `j` nested square roots — so
 * the whole fractional power is at most six `Math.sqrt` calls and five multiplies, every one of
 * them exactly specified. `n = 32` reduces to exactly `Math.sqrt(x)`, because the leading `1 *`
 * is exact.
 */
function sqrtChain(x: number, n: number): number {
  let result = 1;
  let root = x;
  for (let j = 1; j <= 6; j += 1) {
    root = Math.sqrt(root);
    if (((n >> (6 - j)) & 1) === 1) result *= root;
  }
  return result;
}

/**
 * `x^p` — Tier A where the exponent allows it, Tier B where it does not.
 *
 * Splits `p` into a whole part and a fraction. A whole part goes through {@link ipow}; a fraction
 * that is a multiple of 1/64 goes through {@link sqrtChain}. Anything else — 0.6, 1/0.625 — falls
 * through to `Math.pow`, which is correct to about an ulp and *not* required to be correctly
 * rounded, so two conforming engines may disagree in the last bit.
 */
function power(x: number, p: number): number {
  const whole = Math.floor(p);
  const numerator = (p - whole) * DYADIC_DENOMINATOR;
  if (whole >= 0 && whole <= MAX_WHOLE_EXPONENT && Number.isInteger(numerator)) {
    return ipow(x, whole) * (numerator === 0 ? 1 : sqrtChain(x, numerator));
  }
  // @tier-b — a fractional power that is not a dyadic rational. Credited seconds computed
  // through here may differ between engines in the sixteenth significant figure, which is fine
  // for a reward and is the reason `offlineCredit` is documented as Tier B by default.
  return Math.pow(x, p);
}

/**
 * Uncapped for `uncappedSeconds`, softcapped at `exponent`, flat after `flatAfterSeconds`.
 *
 * The shipping numbers in the game this kit came from: 3 h, 0.6, 24 h. Every field is a balance
 * decision, and a balance pass is a data diff — so a wrong number arrives as *data*, and each is
 * validated where it is read rather than three hours into a run.
 */
export interface OfflineCurve {
  /**
   * How long an absence is credited second for second. Below this, `W` is the identity.
   *
   * **A design constraint, not just a generosity dial.** If any standing charge in the economy
   * accrues on a *cycle* — a nightly oil bill, an upkeep that only bites while it is dark — then
   * `U` must exceed that cycle's period by a wide margin, or the cycle is skippable. The warp
   * shrinks credited time, and shrinking credited time shrinks the *charge* as well as the
   * income: a player who closes the tab during the night skips most of the oil bill and most of
   * the darkness. Nothing is minted — burn and income shrink together — so this is not a dupe,
   * but it is an incentive pointing exactly away from the intended play.
   *
   * Keep `U` well above the cycle period and a single-cycle absence is credited in full, so
   * there is nothing to skip. Set it below the period and every absence discounts the charge.
   * The other two ways out are the designer's, not this package's: let the night *earn* as well
   * as cost, or make the night's punishment **state** rather than **flow** — lamps that go out
   * and stay out, which `solveCrossing` gives you exactly.
   */
  readonly uncappedSeconds: number;
  /**
   * In (0, 1]. Above 1 pays a bonus for leaving, which is not a softcap.
   *
   * Prefer a dyadic rational with denominator ≤ 64 — 0.5, 0.625, 0.75 — and credited time
   * becomes Tier A, i.e. bit-identical on every engine, for free. 0.625 and 0.6 are three per
   * cent apart in reward and a whole determinism tier apart in kind.
   */
  readonly exponent: number;
  /**
   * The horizon. Past it the curve is flat: nothing later credits anything.
   *
   * Must be finite, and this is the **upper clamp on the offline gap** — the whole of it. A
   * device clock a year fast credits `maxOfflineCredit(curve)`, not a year, because the *input*
   * is clamped here before the power. There is no second cap to add and no configuration for
   * one; the flat branch of the softcap **is** the ceiling, which is why this curve has three
   * parameters rather than two.
   *
   * It is also a bound on **work**: a schedule walk stops at the first phase beginning at or
   * after this, because every later one credits exactly zero.
   */
  readonly flatAfterSeconds: number;
}

/**
 * Reject a curve that would not be monotonic, continuous, or a softcap.
 *
 * `U ≤ 0` divides by zero; `e > 1` makes being away better than being present; `F < U` makes the
 * flat clamp cut into the uncapped region; and an infinite `F` is no ceiling at all, which is the
 * one thing this curve exists to provide.
 */
function expectCurve(curve: OfflineCurve, label: string): OfflineCurve {
  expectFinite(curve.uncappedSeconds, `${label}: curve.uncappedSeconds`);
  if (!(curve.uncappedSeconds > 0)) {
    throw new RangeError(
      `${label}: curve.uncappedSeconds must be > 0, got ${String(curve.uncappedSeconds)} — it is the divisor in U·(T/U)^e`,
    );
  }
  expectFinite(curve.exponent, `${label}: curve.exponent`);
  if (!(curve.exponent > 0 && curve.exponent <= 1)) {
    throw new RangeError(
      `${label}: curve.exponent must be in (0, 1], got ${String(curve.exponent)} — above 1 pays a bonus for leaving, which is not a softcap`,
    );
  }
  expectFinite(curve.flatAfterSeconds, `${label}: curve.flatAfterSeconds`);
  if (!(curve.flatAfterSeconds >= curve.uncappedSeconds)) {
    throw new RangeError(
      `${label}: curve.flatAfterSeconds (${String(curve.flatAfterSeconds)}) must be >= curve.uncappedSeconds (${String(curve.uncappedSeconds)}) — the flat clamp would otherwise cut into the uncapped region`,
    );
  }
  return curve;
}

/**
 * Credited seconds for a **single contiguous absence**.
 *
 * Apply it once per return, over the one gap between the ledger's anchor and now — see the module
 * header for why it does not compose, and `advanceOver` for the only correct way to spread it
 * across a schedule.
 *
 * The result is clamped at the elapsed time it was given, so `W(T) ≤ T` holds to the bit rather
 * than to within a rounding error near the knot. `Math.min` is exactly specified, so the clamp
 * costs nothing in determinism: a dyadic exponent stays Tier A through it.
 *
 * @tier B in general — a fractional power. **Tier A when `exponent` is a dyadic rational with
 *   denominator ≤ 64**, which is computed as a `Math.sqrt` chain rather than a `pow`.
 * @param elapsedSeconds - Real seconds away. Non-positive credits `0`: a backwards clock must
 *   never mint or destroy resources.
 * @throws RangeError if `elapsedSeconds` is not finite, or the curve is degenerate.
 */
export function offlineCredit(elapsedSeconds: number, curve: OfflineCurve): number {
  expectFinite(elapsedSeconds, 'sim.offlineCredit: elapsedSeconds');
  expectCurve(curve, 'sim.offlineCredit');
  if (elapsedSeconds <= 0) return 0;
  if (elapsedSeconds <= curve.uncappedSeconds) return elapsedSeconds;
  // Clamp the *input* at the horizon, so 48 h and 72 h return the identical value 24 h returns
  // rather than approaching it. Coming back later must never pay more.
  const capped = Math.min(elapsedSeconds, curve.flatAfterSeconds);
  const raw = curve.uncappedSeconds * power(capped / curve.uncappedSeconds, curve.exponent);
  return Math.min(capped, raw);
}

/**
 * The most any absence can ever be worth. Derived from the curve, never restated.
 *
 * What a "you have banked the maximum" HUD line reads, and the number a reviewer should compare
 * against a game's own plausibility threshold for a bad device clock: about 37.6 ks — 10.4 hours
 * — at 3 h / 0.6 / 24 h.
 *
 * @throws RangeError if the curve is degenerate.
 */
export function maxOfflineCredit(curve: OfflineCurve): number {
  expectCurve(curve, 'sim.maxOfflineCredit');
  return offlineCredit(curve.flatAfterSeconds, curve);
}

/**
 * `W⁻¹` — the real elapsed time at which `creditedSeconds` of credit had accrued.
 *
 * The map back from the physics to the calendar, and the reason a game can say "the lamps went
 * out at 3:41 into the second night" rather than "at 1:52 of credited time, which is not a thing
 * the player experienced". Under a warp the two clocks differ by a factor that grows with the
 * absence, so a toast built from the credited number is confidently wrong about the player's own
 * evening.
 *
 * Closed form: the identity below `U`, and `U·(c/U)^(1/e)` above it. Tier A when `1/e` is a whole
 * number or a dyadic rational — `e = 0.5` gives `1/e = 2`, one multiply — and Tier B otherwise,
 * including for `e = 0.625`, whose reciprocal 1.6 is not dyadic. The forward direction and the
 * inverse therefore do not always share a tier, which is worth knowing before a game hashes
 * either.
 *
 * @returns `0` for a non-positive credit; `Infinity` for a credit above
 *   {@link maxOfflineCredit} — no amount of real time reaches it, which is what "flat" means.
 * @throws RangeError if `creditedSeconds` is not finite, or the curve is degenerate.
 */
export function offlineElapsed(creditedSeconds: number, curve: OfflineCurve): number {
  expectFinite(creditedSeconds, 'sim.offlineElapsed: creditedSeconds');
  expectCurve(curve, 'sim.offlineElapsed');
  if (creditedSeconds <= 0) return 0;
  if (creditedSeconds <= curve.uncappedSeconds) return creditedSeconds;
  if (creditedSeconds > maxOfflineCredit(curve)) return Infinity;
  const real =
    curve.uncappedSeconds * power(creditedSeconds / curve.uncappedSeconds, 1 / curve.exponent);
  return Math.min(real, curve.flatAfterSeconds);
}

/**
 * `dW/dt` — "the next second away is worth this much of a second". A read for the UI; the
 * integrator never needs it.
 *
 * Reported as the **right** derivative at both knots, because what a player wants to know is what
 * the *next* second pays: it steps `1 → exponent` at `U`, decays, and is `0` from `F` onwards.
 * `W` is continuous there and `w` is not, which is the honest thing to show on a meter — a value
 * interpolated across the kink would tell the player the softcap is gentler than it is.
 *
 * @throws RangeError if `elapsedSeconds` is not finite, or the curve is degenerate.
 */
export function offlineCreditRate(elapsedSeconds: number, curve: OfflineCurve): number {
  expectFinite(elapsedSeconds, 'sim.offlineCreditRate: elapsedSeconds');
  expectCurve(curve, 'sim.offlineCreditRate');
  if (elapsedSeconds < curve.uncappedSeconds) return 1;
  if (elapsedSeconds >= curve.flatAfterSeconds) return 0;
  // `x^(e−1)` written as `1/x^(1−e)`, so the exponent stays in [0, 1) and the dyadic sqrt chain
  // still applies. Division is exactly specified, so this costs nothing in tier.
  return curve.exponent / power(elapsedSeconds / curve.uncappedSeconds, 1 - curve.exponent);
}
