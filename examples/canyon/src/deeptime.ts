/**
 * Deep time: the epoch the visitor is looking at, and the checkpoints that make going back to it
 * cheap without making it a lie.
 *
 * **The scrub bar is a re-run, not a lookup.** `docs/GALLERY.md` is explicit that this is the
 * demonstration and that the easy version — caching screenshots, or interpolating between two
 * saved height fields — proves nothing. So "go to year 400,000" means: take the newest checkpoint
 * at or before it, and *step the model* from there. Every frame the visitor sees was computed by
 * `erosion.step`, from the seed, through every intervening epoch, in order.
 *
 * A checkpoint is legitimate and expected because it is **the exact state**, `Float64` for
 * `Float64`, so resuming from one is bit-for-bit indistinguishable from having stepped the whole
 * way. That is the property, and {@link DeepTime.fingerprint} is how it is *checked* rather than
 * asserted: it hashes every bit of every height in the live buffer, and a visitor who scrubs back
 * to an epoch they passed on the way out sees the same eight hex digits they saw the first time.
 * If that number ever moved, this exhibit's headline claim would be false and the HUD would say
 * so before anyone else noticed.
 *
 * ## What the interval costs, both ways
 *
 * | | |
 * |---|---|
 * | forward, in play | one `step` per frame — the checkpoint machinery is not involved at all |
 * | forward, into time nobody has visited | every step of it, at `budget` a painted frame, with the HUD saying so. This is the exhibit working, not the exhibit being slow |
 * | forward, over ground already covered | one restore, then under `CHECKPOINT_EVERY` steps |
 * | **backward** | the same: one restore, then up to `CHECKPOINT_EVERY − 1` steps, spread over as many frames as `budget` takes |
 * | memory | `2 · CELL_COUNT · 8` bytes per checkpoint, minted lazily on the way past, never dropped |
 *
 * The second and third rows are the whole feel of the bar. Dragging right the *first* time is a
 * re-run and looks like one — the canyon carves forward at fourteen epochs a frame and the readout
 * counts the steps. Dragging anywhere a second time is instant. That asymmetry is the honest one:
 * an epoch nobody has computed has to be computed, and an epoch that has been is exactly reachable.
 *
 * The interval is a straight trade between rewind latency and resident memory, and it is the one
 * number here chosen by measurement rather than taste. The README has what it measured at.
 */
import { hashBytes, hashString } from '@lattice/core';
import { CELL_COUNT, seedState, step, type State } from './erosion.js';

/** Epochs in the run, years in an epoch — a round million — and the checkpoint interval. */
export const STEPS = 2000, YEARS_PER_STEP = 500, CHECKPOINT_EVERY = 40;

/**
 * What the HUD reads, and the only surface the exhibit has on the model's history.
 *
 * Inferred from the factory rather than declared as an interface, which is a line-budget decision
 * and worth naming as one: `docs/GALLERY.md` caps an exhibit's logic at 200 lines and an eleven
 * line interface restating an object literal that is already annotated field by field is the
 * cheapest eleven lines in the file to give up. In a package it would be written out.
 */
export type DeepTime = ReturnType<typeof createDeepTime>;

export function createDeepTime(seedText: string) {
  const seed = hashString(seedText);
  // `state` is never reassigned: the `words` view below is over this buffer and a restore is a
  // `set` into it rather than a swap, so the view cannot end up watching a buffer nobody uses.
  // `cuts` rides beside `marks` because the deepest cut is **state too**, and the one place that
  // shows is a restore with nothing left to step: scrub to year zero and the depth readout would
  // otherwise still be showing four thousand feet from wherever the bar came from. It is derived
  // from the height field — a full sweep to recover — so it is remembered rather than recomputed.
  const marks: State[] = [seedState(seed)], cuts: number[] = [0], state = (marks[0] as State).slice();
  // The height half, as words. `hashBytes` truncates its inputs to int32 — which would digest a
  // `Float64Array` as a field of zeroes, a trap its own doc comment names — so the bits are
  // handed over as the `Uint32Array` they already are.
  const words = new Uint32Array(state.buffer, 0, CELL_COUNT * 2);
  const t = {
    /** Epochs stepped from the seed; the live height and flow buffer; `erosion.step` calls made
     *  for the current frame; the checkpoint epoch this frame resumed from or `-1` for "carried
     *  on"; checkpoints minted; the numeric seed the art hashes against; and how far the river
     *  has cut below the plateau it started on, in height units. */
    epoch: 0, state, steps: 0, resumedFrom: -1, checkpoints: 1, seed, cut: 0,
    /** Every bit of every height, hashed. The witness that a re-run is a re-run. */
    fingerprint: (): number => hashBytes(0, words),
    goTo(target: number, budget: number): void {
      t.steps = 0; t.resumedFrom = -1;
      // The newest checkpoint at or before the target, clamped to the ones that have actually been
      // minted — and taken **in both directions**. Backwards it is the only way home. Forwards it
      // is the difference between a scrub that lands and one that crawls: a visitor who throws the
      // bar from year 100,000 to year 850,000 over ground they have already covered would
      // otherwise watch fifteen hundred steps go past at fourteen a frame while the bar sits two
      // seconds ahead of the picture. Resuming is not a shortcut around the claim — `marks[k]` is
      // the exact state `step` produced on the way out, `Float64` for `Float64`, and
      // {@link DeepTime.fingerprint} is what checks that rather than asserts it.
      const k = Math.min((target / CHECKPOINT_EVERY) | 0, marks.length - 1), at = k * CHECKPOINT_EVERY;
      if (at > t.epoch || target < t.epoch) {
        state.set(marks[k] as State); t.epoch = at; t.resumedFrom = at; t.cut = cuts[k] ?? 0;
      }
      while (t.epoch < target && t.steps < budget) {
        t.cut = step(state, seed, t.epoch);
        t.epoch++; t.steps++;
        if (t.epoch % CHECKPOINT_EVERY === 0 && marks.length * CHECKPOINT_EVERY === t.epoch) {
          marks.push(state.slice()); cuts.push(t.cut); t.checkpoints = marks.length;
        }
      }
    },
  };
  return t;
}
