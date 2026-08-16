/**
 * The fixed step, as a value that cannot be guessed at.
 *
 * This package never reads a clock. Every duration it reports — a `longpress` at 450 ms, a fling
 * at 1200 px/s, the `heldMs` on a tap — is a count of ticks multiplied by one number, and that
 * number is the loop's step. There is no second source for it and no way to detect a wrong one
 * at runtime: a system told the step is 16 ms while the loop runs at 16.667 does not fail, it
 * *lies*, uniformly, by 4%.
 *
 * ## What the 4% actually costs
 *
 * | symptom | with `stepMs: 16` against a 16.667 ms loop |
 * |---|---|
 * | long press | fires at 432 ms, not 450 — inside the band where people are still deciding |
 * | fling velocity | 4% low, so every flick coasts short and the camera feels heavy |
 * | recorded log | carries `stepMs: 16`, and `@lattice/persist` refuses to replay it against a real 60 Hz loop **months later**, naming a mismatch nobody can explain |
 *
 * None of those surfaces where the mistake was made. That is the whole reason this module
 * exists: the previous signature was `stepMs: number`, it rejected only `0` and `NaN`, and every
 * other wrong number was accepted in silence.
 *
 * ## Why it is a pair and not a branded number
 *
 * The obvious fix is a branded `Millis` that only the loop can mint. It is not available:
 * `@lattice/loop` sits beside this package rather than under it, so the edge cannot be imported
 * (non-negotiable 3), and its `Millis` is in any case a plain unbranded `number` whose own doc
 * comment says it "guards nothing".
 *
 * So the step is taken **structurally, as the loop reports it** — `stepMs` *and* `stepSeconds`,
 * the two fields `Loop` already publishes. `loop` satisfies {@link FixedStep} with no ceremony
 * at the call site, and the pair does two things one number cannot:
 *
 * 1. **`step: 16` no longer compiles**, and neither does `{ stepMs: 16 }`. The shortest thing
 *    that type-checks is the loop itself, which is the correct answer.
 * 2. **The two are cross-checked.** They are the same integer microsecond count divided by
 *    1e3 and by 1e6, so they agree to within a rounding error; a hand-written pair that
 *    disagrees is a guess, and {@link resolveStep} refuses it by name.
 *
 * For the cases with no loop to read — a headless replay, a test, a component page —
 * {@link fixedStep} builds the pair from an `hz`, using the same arithmetic `createLoop` uses,
 * so the two are bit-identical rather than merely close.
 *
 * Pure: no clock, no DOM.
 */

import { expectInt } from '@lattice/core';

/**
 * The upper bound on `hz`, mirroring `createLoop.hz` exactly.
 *
 * Above a million the accumulator's integer microseconds round a step to zero, and the loop's
 * step loop never terminates. The number is restated here rather than imported for the reason in
 * this module's header — but it is the *same* number on purpose, so a step this package accepts
 * is a step a loop can be built with.
 */
const MAX_HZ = 1_000_000;

/**
 * How far `stepSeconds × 1000` may sit from `stepMs` before the pair is called a guess.
 *
 * Derived, not chosen. Both fields come from one integer microsecond count `u`: `stepMs = u/1e3`
 * and `stepSeconds = u/1e6`. Each division and the multiplication back are correctly rounded, so
 * the relative disagreement is a few units in the last place — measured across every legal `hz`
 * from 1 to 1,000,000, the worst case is `2.21e-16`, one ulp.
 *
 * `1e-12` therefore sits **four orders of magnitude above the float noise** and **ten below** the
 * 4.2% disagreement of the mistake this check exists to catch (`stepMs: 16` beside
 * `stepSeconds: 0.016667`). There is no value in between that any real pair could occupy.
 */
const STEP_AGREEMENT = 1e-12;

/**
 * A loop's fixed step, in both units it publishes.
 *
 * **Pass `loop`.** `@lattice/loop`'s `Loop` satisfies this exactly, and reading the step off the
 * object that owns it is the only way the two cannot drift. Where there is no loop — a headless
 * replay, a test — build one with {@link fixedStep}.
 *
 * Declared structurally rather than imported: `loop` and `input` are siblings on the graph, so
 * the edge does not exist and must not be invented. `Loop` satisfies this without knowing that
 * `input` exists.
 */
export interface FixedStep {
  /**
   * Milliseconds per fixed step. **This is the number every duration in this package is counted
   * in**, and the number a recorded log carries as one third of its compatibility triple.
   */
  readonly stepMs: number;

  /**
   * The same step in seconds.
   *
   * This package never uses it. It is required for two reasons, both of them about the caller:
   * it makes the shortest type-checking argument the loop itself rather than a literal, and it
   * gives {@link resolveStep} a second reading of the same quantity to check the first against.
   * A pair that disagrees by more than a rounding error was typed by hand, and a step typed by
   * hand is the bug this whole module exists to remove.
   */
  readonly stepSeconds: number;
}

/**
 * Build a step from a rate, for the callers that have no loop to read one off.
 *
 * ```ts
 * const input = createHeadlessInput({ camera, step: fixedStep(60) });
 * ```
 *
 * The arithmetic is `createLoop`'s, to the digit: microseconds are rounded to an integer first
 * and both fields are derived from that count. `fixedStep(60).stepMs` is therefore `16.667` —
 * **not** `1000 / 60`, which is `16.6666…` and differs from what a real 60 Hz loop reports in the
 * twelfth decimal place. That difference is invisible in a gesture and fatal in a log, because
 * `@lattice/persist` compares the recorded `stepMs` for exact equality.
 *
 * @param hz Fixed steps per second, as an integer — the same argument, with the same bounds,
 *   that `createLoop` takes.
 * @throws RangeError if `hz` is not an integer in `[1, 1000000]`. Non-integer rates are refused
 *   rather than rounded, because a caller who wrote `62.5` meant something and silently giving
 *   them `63` is how a log ends up recorded at a step nobody chose.
 */
export function fixedStep(hz: number): FixedStep {
  expectInt(hz, 'fixedStep.hz');
  if (hz < 1 || hz > MAX_HZ) {
    throw new RangeError(
      `fixedStep.hz: expected an integer in [1, ${String(MAX_HZ)}], got ${String(hz)} — the bound is createLoop's, so that every step this accepts is a step a loop can be built with`,
    );
  }
  // Integer microseconds first, exactly as `createLoop` does it, so a `fixedStep(hz)` and a
  // `createLoop({ hz })` produce the same double and a log recorded under one replays under the
  // other. Deriving `stepMs` as `1000 / hz` instead would be off in the last few bits and the
  // symptom would be a replay refusal, not a wrong gesture.
  const stepUs = Math.round(1_000_000 / hz);
  return { stepMs: stepUs / 1_000, stepSeconds: stepUs / 1_000_000 };
}

/**
 * Validate a step and return the milliseconds, or refuse it naming the caller's mistake.
 *
 * @param label The caller's option path, so the message names `createInput.step` rather than
 *   this function.
 * @throws TypeError if `step` is not an object — which is what the old `stepMs: number` call
 *   looks like from here, so the message is the migration note.
 * @throws RangeError if either field is not a finite number greater than zero, or if the two
 *   disagree by more than a rounding error. A zero step makes every long press instantaneous and
 *   a `NaN` one makes every duration `NaN`; a disagreeing pair is a step somebody guessed.
 */
export function resolveStep(step: FixedStep, label: string): number {
  if (step === null || typeof step !== 'object') {
    throw new TypeError(
      `${label}: expected the loop, or fixedStep(hz) — got ${typeof step === 'number' ? `the bare number ${String(step)}` : String(step)}. Every gesture duration this package reports is a count of ticks times this step, so a step that is not the loop's is a long press at the wrong moment, a fling at the wrong speed, and a recorded log that will not replay.`,
    );
  }
  const stepMs = positive(step.stepMs, `${label}.stepMs`);
  const stepSeconds = positive(step.stepSeconds, `${label}.stepSeconds`);
  const drift = stepSeconds * 1000 - stepMs;
  if ((drift < 0 ? -drift : drift) > stepMs * STEP_AGREEMENT) {
    throw new RangeError(
      `${label}: stepMs ${String(stepMs)} and stepSeconds ${String(stepSeconds)} describe different steps — ${String(stepSeconds * 1000)} ms against ${String(stepMs)} ms. A real loop derives both from one integer microsecond count, so this pair was typed by hand; pass the loop, or fixedStep(hz).`,
    );
  }
  return stepMs;
}

/** One field of a step, refused by name. Both are finite and greater than zero. */
function positive(value: number, label: string): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${label}: expected a finite number > 0, got ${String(value)}`);
  }
  return value;
}
