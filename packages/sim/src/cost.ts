/**
 * The cost curve, in closed form.
 *
 * ```
 *   costOfNext  = b · r^k
 *   bulkCost    = b · r^k · (r^n − 1) / (r − 1)
 *   maxBuyable  = floor( log_r( c(r−1) / (b·r^k) + 1 ) )
 * ```
 *
 * `b` = base, `r` = growth, `k` = owned, `n` = how many, `c` = the budget.
 *
 * **Closed form on day one, not as an optimization.** "Buy max" at 4,000 owned is 4,000 iterations
 * on a hot path, run once per frame to render a button's *label*. The naive loop is a legitimate
 * oracle in a test — and this package's tests use one — and a performance bug in a build.
 *
 * ## Determinism
 *
 * `b · r^k` is the most important arithmetic in an idle game and `**` makes it Tier B. `owned` is
 * an integer, so the price is a chain of multiplications instead: **exponentiation by squaring**,
 * which is Tier A and bit-identical everywhere. `**` would be at most one ulp more accurate and
 * not reproducible, and for a number a player is charged, reproducible wins.
 *
 * {@link maxBuyable} is the one Tier B call left, and it is a **seed**: `Math.log` proposes an
 * integer and a bounded correction verifies it with Tier A comparisons. Two engines can only
 * disagree if their logarithms differ by enough to move the answer four whole steps. They do not.
 *
 * **A persisted price is not portable.** Recompute costs; never store one and compare it later for
 * equality. And affordability is compared **exactly** — `bulkCost <= budget`, never with an
 * epsilon — because an epsilon there lets a player buy something they cannot afford.
 *
 * ## What floating point does to this, stated as a boundary rather than a defense
 *
 * A double holds every integer exactly up to 2⁵³. Past that the spacing is 2, then 4, then 128 by
 * 2⁶⁰. Relative precision never degrades, so a cost of 1e300 is still good to fifteen significant
 * figures: **the magnitude is fine and the integers are not.** Two places it bites, and only two —
 * a balance of 1e17 minus a cost of 3 is the balance again, so the player buys forever; and at
 * `growth = 1.07` a price crosses 2⁵³ at about 520 owned and reaches `Infinity` at about 10,500.
 *
 * The kit does nothing about it, deliberately: no `BigInt`, no `Decimal`, no mantissa/exponent
 * pair. It would infect every signature in the kit, allocate per operation on the hot path this
 * package exists to protect, cost most of a package's whole size budget, and be *less* reproducible
 * than IEEE-754, which is bit-identical across platforms by specification. What it does instead is
 * refuse rather than lie: {@link bulkCost} returns `Infinity` on overflow, which compares correctly
 * against any finite balance and refuses the purchase rather than silently making it free. The
 * design answer is the real one — a game whose numbers approach 9e15 has a prestige problem, not
 * an arithmetic problem.
 *
 * Isomorphic: no clock, no randomness, no platform.
 */

import { expectFinite, expectInt } from '@latticekit/core';

/**
 * How many bounded correction steps {@link maxBuyable} may take after the logarithm.
 *
 * `Math.log` is accurate to within an ulp or two, so the analytic answer lands on the right integer
 * or one either side of it. This is a rounding fix, not a search: the bound is what keeps it honest
 * about that, and `cap` bounds arithmetic rather than CPU.
 */
const MAX_ROUNDING_CORRECTION = 4;

/** `cost(k) = base · growth^k`. `growth` must be > 1 in a shipping balance. */
export interface CostCurve {
  /** The price of the first unit. Must be finite and non-negative; `0` is a free item, not a bug. */
  readonly base: number;
  /**
   * The multiplier per unit owned. Must be finite and > 0.
   *
   * Values at or below 1 are permitted — a flat price is `1`, and a decaying one is a legitimate
   * shape for a test fixture — but a shipping balance wants > 1, because a single tier with linear
   * production and a flat cost has owned-count growing without bound and no decision in it.
   */
  readonly growth: number;
}

/**
 * `base^exponent` for a non-negative whole exponent, by exponentiation by squaring.
 *
 * This is why {@link costOfNext} is Tier A. It is `⌈log₂ k⌉` multiplications rather than one
 * `Math.pow`, every one of them exactly specified by ECMA-262, so two engines charge the same
 * price to the last bit.
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

/** Validate the two curve numbers, naming whichever one is wrong. */
function expectCurve(curve: CostCurve, label: string): CostCurve {
  expectFinite(curve.base, `${label}: curve.base`);
  if (curve.base < 0) {
    throw new RangeError(
      `${label}: curve.base must be >= 0, got ${String(curve.base)} — a negative price pays the player to buy, which no later clamp can undo`,
    );
  }
  expectFinite(curve.growth, `${label}: curve.growth`);
  if (!(curve.growth > 0)) {
    throw new RangeError(
      `${label}: curve.growth must be > 0, got ${String(curve.growth)} — a non-positive ratio makes every other price negative or zero`,
    );
  }
  return curve;
}

/** Validate a count of things already owned. */
function expectOwned(owned: number, label: string): number {
  expectInt(owned, label);
  if (owned < 0) {
    throw new RangeError(
      `${label}: expected a non-negative count, got ${String(owned)} — owning minus three of something is a bug upstream, and pricing it would hide that`,
    );
  }
  return owned;
}

/**
 * `b · r^k` — the price of the next single unit. Tier A.
 *
 * @throws RangeError on a non-integer or negative `owned`, or a non-finite curve parameter.
 */
export function costOfNext(curve: CostCurve, owned: number): number {
  expectCurve(curve, 'sim.costOfNext');
  expectOwned(owned, 'sim.costOfNext: owned');
  return curve.base * ipow(curve.growth, owned);
}

/**
 * `b · r^k · (r^n − 1)/(r − 1)` — the price of `count` more, starting from `owned`. Tier A.
 *
 * A fixed batch is **all or nothing**: a ×10 button with funds for six buys nothing, not six. Only
 * {@link maxBuyable} resolves a purchase against the balance, and that asymmetry is the point —
 * a partial batch is a different transaction from the one the player pressed.
 *
 * @returns `0` for `count <= 0` or a free curve; `Infinity` if the geometric term overflows, which
 *   compares correctly against any finite balance and therefore *refuses* the purchase rather than
 *   silently making it free.
 * @throws RangeError on a non-integer `count`, a negative `owned`, or a non-finite parameter.
 */
export function bulkCost(curve: CostCurve, owned: number, count: number): number {
  expectCurve(curve, 'sim.bulkCost');
  expectOwned(owned, 'sim.bulkCost: owned');
  expectInt(count, 'sim.bulkCost: count');
  if (count <= 0) return 0;
  const first = curve.base * ipow(curve.growth, owned);
  // A zero first price makes the whole batch free, and short-circuiting here is not an
  // optimization: `0 * Infinity` is `NaN`, and a `NaN` price compares false against every budget,
  // so the purchase would be silently refused instead of being free.
  if (first === 0) return 0;
  // `r = 1` is not a shipping balance, but the geometric sum has a removable singularity there and
  // a test fixture is entitled to probe it.
  if (curve.growth === 1) return first * count;
  return (first * (ipow(curve.growth, count) - 1)) / (curve.growth - 1);
}

/**
 * Clamp a proposed count into `[0, cap]` and walk it onto the true answer.
 *
 * Every comparison here is `bulkCost(...) <= budget`, which is Tier A — so whatever the seed was,
 * the *decision* is made by exact arithmetic. The walk is bounded at
 * {@link MAX_ROUNDING_CORRECTION} steps in each direction because it is a rounding fix and not a
 * search; if it ever needed more, the seed would be wrong rather than imprecise.
 */
function correct(
  curve: CostCurve,
  owned: number,
  budget: number,
  cap: number,
  seed: number,
): number {
  // A shrinking curve converges: the whole infinite series may cost less than the budget, and the
  // logarithm of a non-positive argument says so as a NaN or an infinity rather than as a number.
  if (!Number.isFinite(seed)) return cap;
  let n = Math.min(Math.max(seed, 0), cap);
  for (let i = 0; i < MAX_ROUNDING_CORRECTION && n > 0; i += 1) {
    if (bulkCost(curve, owned, n) <= budget) break;
    n -= 1;
  }
  for (let i = 0; i < MAX_ROUNDING_CORRECTION && n < cap; i += 1) {
    if (bulkCost(curve, owned, n + 1) > budget) break;
    n += 1;
  }
  return n;
}

/**
 * `floor( log_r( c(r−1)/(b·r^k) + 1 ) )`, corrected for float rounding, clamped to `cap`.
 *
 * The guarantee callers rely on is two-sided, and both halves hold on the engine that computed
 * them: `bulkCost(curve, owned, maxBuyable(...)) <= budget` — a `max` purchase can never drive a
 * balance negative — and `bulkCost(curve, owned, maxBuyable(...) + 1) > budget` unless the answer
 * is `cap`, so the button says what it does.
 *
 * The correction after the logarithm is at most four steps in each direction. It is a rounding fix,
 * not a search: `cap` bounds arithmetic, never CPU, and 4,000 owned costs the same as 4.
 *
 * ## This result is advisory. Do not persist it and do not send it anywhere.
 *
 * The seed is `Math.log`, which ECMA-262 does **not** require to be correctly rounded. Two
 * conforming engines can therefore disagree in the last bit, and on a cost curve that disagreement
 * can land exactly on a `floor` boundary: same save, same balance, two clients, two different
 * answers to "how many can I afford" — differing by exactly one. That is bounded and it is the
 * residual the design accepts, because the alternative is a `pow`-free integer search or an
 * epsilon, and an epsilon here would let a player buy something they cannot afford.
 *
 * What follows for a caller:
 *
 * - **Use it for a label and for the size of the purchase you are about to make**, on the engine
 *   that computed it. Within one client it is exactly consistent with {@link bulkCost}.
 * - **Never store it, never checksum it, and never put it in a replay log or on a wire.** Store the
 *   inputs — owned count and balance — and recompute. A persisted count computed on Firefox and
 *   verified on Safari can differ by one and will look like tampering.
 * - **The authoritative check is the balance test at purchase time**, and it is
 *   `bulkCost(curve, owned, n) <= budget` compared **exactly**. A verifier that re-derives `n` and
 *   demands equality will reject honest clients on a browser update; a verifier that charges the
 *   `bulkCost` of the `n` it was handed and refuses when the balance will not cover it cannot.
 *
 * @param budget - Zero, negative and `NaN` all yield `0` rather than throwing: an empty wallet is a
 *   normal state, not an error. An infinite budget yields `cap`.
 * @param cap - The most the caller will accept. Must be a non-negative integer.
 * @throws RangeError on a non-integer or negative `owned` or `cap`, or a non-finite curve parameter.
 */
export function maxBuyable(
  curve: CostCurve,
  owned: number,
  budget: number,
  cap: number,
): number {
  expectCurve(curve, 'sim.maxBuyable');
  expectOwned(owned, 'sim.maxBuyable: owned');
  expectOwned(cap, 'sim.maxBuyable: cap');
  // `!(budget > 0)` rather than `budget <= 0`, so `NaN` lands here too.
  if (!(budget > 0)) return 0;
  if (cap < 1) return 0;

  const first = curve.base * ipow(curve.growth, owned);
  if (first === 0) return cap;
  if (!(first > 0) || first > budget) return 0;
  if (!Number.isFinite(budget)) return cap;

  if (curve.growth === 1) return correct(curve, owned, budget, cap, Math.floor(budget / first));

  // The logarithm is not required by ECMA-262 to be correctly rounded, so two engines can disagree
  // in the last bit — and on a cost curve that disagreement can land exactly on a `floor` boundary
  // and propose two different integers from identical state. So it proposes and `correct` disposes,
  // with Tier A comparisons; the result is advisory and must never be persisted or sent. See the
  // doc comment above for what a caller has to do about that.
  // @tier-b — the only Tier B site in this package's cost maths, and it is a seed and nothing more.
  const ratio = Math.log((budget * (curve.growth - 1)) / first + 1) / Math.log(curve.growth);
  return correct(curve, owned, budget, cap, Math.floor(ratio));
}

/** Ascending thresholds, each multiplying once. The source game ships ×2 at 10 / 20 / 35 / 50. */
export interface Milestones {
  /**
   * Owned counts at which the bonus applies, ascending.
   *
   * Order does not change the result — the multiplier is the same at every threshold, so the
   * product is the same however they are listed — but a duplicate threshold multiplies twice, which
   * is a real way to spell "×4 at ten" and a real way to spell a typo.
   */
  readonly thresholds: readonly number[];
  readonly multiplier: number;
}

/**
 * The multiplier from milestone bonuses at an owned count. Repeated multiplication, so Tier A.
 *
 * Feed it **purchased** counts, never effective ones. This is the subtlest bug in the package: a
 * multiplier keyed on a count the flow itself produces changes the rate *inside* an integral, so a
 * client integrating at 10 Hz places the discontinuity somewhere different from a catch-up
 * integrating once — same save, two answers, neither reproducible. Purchased counts change only at
 * actions, which is exactly the property the closed form needs.
 *
 * It is a pure function of a number so a game can also use it on a shop card, which is where
 * players actually learn the mechanic exists.
 *
 * @throws RangeError if `owned`, `multiplier` or any threshold is not finite, naming the index.
 */
export function milestoneMultiplier(owned: number, milestones: Milestones): number {
  expectFinite(owned, 'sim.milestoneMultiplier: owned');
  expectFinite(milestones.multiplier, 'sim.milestoneMultiplier: milestones.multiplier');
  let multiplier = 1;
  let index = 0;
  for (const threshold of milestones.thresholds) {
    expectFinite(threshold, `sim.milestoneMultiplier: milestones.thresholds[${String(index)}]`);
    if (owned >= threshold) multiplier *= milestones.multiplier;
    index += 1;
  }
  return multiplier;
}
