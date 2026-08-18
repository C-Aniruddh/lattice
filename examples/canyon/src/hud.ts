/**
 * The numbers on the overlay, and the one control that drives the model.
 *
 * **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule.** There is no canvas
 * text anywhere in this exhibit. The *structure* of the overlay is `readout.ts` and is art, per
 * § *Static markup is art*; what is left here is what that section calls logic and always will be
 * — code that reads state and writes it into the tree, plus the handlers on the bar.
 *
 * ## What the readout is for
 *
 * This exhibit's claim is that the scrub bar is a **re-run and not a lookup**, and a claim like
 * that is worth nothing unless a visitor can check it. So the overlay carries the numbers that
 * make it checkable rather than the ones that would make it pretty:
 *
 * | | |
 * |---|---|
 * | **the year, and the depth in feet** | the two a visitor feels. The depth is measured against the plateau the river started on, and watching it climb past four, five, six thousand feet *is* the subject |
 * | **epoch and steps this frame** | how much of the model ran to produce the frame being looked at. Rarely zero, because the ground never stops moving |
 * | **resumed / recomputed** | whether this frame started from a checkpoint or carried on from the last one. Both are re-runs; a cache of pictures would be neither |
 * | **the field's fingerprint** | every bit of every height in the live buffer, hashed. Scrub past an epoch, come back to it, and it is the same eight hex digits. That is the whole exhibit in one word |
 *
 * Plus the worst frame in the last ten seconds, which § Scale's cost row makes a gate rather than
 * a trade, and which is *not* an average for the reason `docs/PERFORMANCE.md` gives at length: an
 * average of 16 ms with every eighth frame at 40 ms is a visible stutter wearing a healthy
 * number. `main.ts` owns the window, because owning it means calling `loop.resetStats()` and a
 * HUD that resets the statistics it reports is a HUD with a side effect in it.
 *
 * ## The bar's listeners are attached here, and that is the boundary
 *
 * `readout.ts` builds the `<input type="range">` and never touches it again. Three listeners live
 * here because § *Static markup is art* is explicit that a handler which changes what the exhibit
 * does is logic, always — and this one changes which million years you are looking at. They are
 * added with `addEventListener` rather than through `el`'s `on*` keys for the same reason: by
 * then the element is somebody else's markup.
 *
 * That `@latticekit/ui` has no slider, meter or track to build that control out of **at all** is the
 * finding this exhibit reports about the package. Rule 7 says an exhibit that finds it easier to
 * draw its readouts into the canvas has found something about `ui`; this one found the
 * neighbouring thing — the control had to be built beside `ui` rather than out of it.
 */
import { fmtInteger, type Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, roll, setText } from '@latticekit/ui';
import { costText } from '../../_shared/src/index.js';
import { STEPS, YEARS_PER_STEP, type DeepTime } from './deeptime.js';
import { buildReadout } from './readout.js';

/** Height units to feet, chosen so the finished gorge reads a little over six thousand. An art
 *  scale, and the only place this exhibit names a real-world unit. */
const FEET = 275;

export interface HudOptions {
  readonly palette: WorldPalette;
  /**
   * A pull, not a push, so there is exactly one place the HUD can be a frame behind the world.
   *
   * `behind` is true while the model is still stepping toward where the bar was dragged, and
   * `from` is the checkpoint the current position was resumed from, or `-1` for "stepped on from
   * the last frame". Both are computed in the render, not here: they are answers about one
   * *frame*, and this callback runs on the overlay's own timer.
   *
   * `worstMs` is `loop.stats.worstGapMs` — the worst gap between two *painted* frames — and
   * `cadenceMs` is the shortest, which is the display's own period. Neither number means anything
   * without the other: 21.4 against 16.7 dropped a frame and 8.4 against 8.3 did not.
   */
  readonly read: () => {
    time: DeepTime; worstMs: number; cadenceMs: number; behind: boolean; from: number;
  };
  /** The bar moved. The epoch it moved to; the exhibit decides how fast to get there. */
  readonly onScrub: (epoch: number) => void;
  /** The bar was let go. The ground never stops moving, so this is where play resumes. */
  readonly onRelease: () => void;
  /** Milliseconds, and it must be the clock `@latticekit/loop` was given. */
  readonly now: () => number;
}

export function createHud(opts: HudOptions) {
  const ui = createOverlay({ now: opts.now });
  const year = roll(ui, { format: (e) => `${fmtInteger(e * YEARS_PER_STEP)} yr`, ms: 220 });
  const deep = roll(ui, { format: (ft) => `${fmtInteger(ft)} ft deep`, ms: 220 });
  const plate = buildReadout(ui, year.node, deep.node);
  plate.bar.addEventListener('input', () => { opts.onScrub(Number(plate.bar.value)); });
  plate.bar.addEventListener('change', opts.onRelease);
  plate.bar.addEventListener('pointerup', opts.onRelease);
  // Pushed once: this exhibit's palette has no cycle, so guarding on `rev` would guard a number
  // that never moves. The seam is still the one rule 7 asks for — `draw` names the colors, `ui`
  // writes the custom properties, and `index.html` is the only file that decides how a card looks.
  applyPalette(ui, paletteVars(opts.palette));

  const stop: Disposer = ui.every(() => {
    const r = opts.read();
    year.set(r.time.epoch);
    deep.set(Math.round(r.time.cut * FEET));
    setText(plate.stat, `EPOCH ${r.time.epoch}/${STEPS} · ${r.time.steps} STEP${r.time.steps === 1 ? '' : 'S'} THIS FRAME${costText(` · GAP ${r.worstMs.toFixed(1)}/${r.cadenceMs.toFixed(1)}ms`)}`);
    setText(plate.origin, r.behind ? 'CATCHING UP — RE-RUNNING THE MODEL' : r.from < 0
      ? 'RECOMPUTED · STEPPED ON FROM THE LAST FRAME'
      : `RESUMED · CHECKPOINT ${r.from} OF ${r.time.checkpoints}, THEN RE-RUN`);
    setText(plate.print, `FIELD ${(r.time.fingerprint() >>> 0).toString(16).padStart(8, '0')}`);
    // The rail, and see `readout.ts` for why it is a second track rather than a caption: `reached`
    // is where the model *is*, `asked` is where the handle is, and the gap between them is the
    // re-run this exhibit exists to make visible. Written every tick because both ends move.
    plate.track.style.setProperty('--reached', (r.time.epoch / STEPS).toFixed(4));
    plate.track.style.setProperty('--asked', (Number(plate.bar.value) / STEPS).toFixed(4));
    plate.card.dataset['behind'] = plate.track.dataset['behind'] = r.behind ? '1' : '0';
  });

  /** `follow` is how the exhibit puts the bar where the model actually is when it moved the epoch
   *  itself, rather than the visitor moving it. */
  return { ui, follow: (e: number) => { plate.bar.value = String(e); }, destroy: () => { stop(); ui.destroy(); } };
}
