/**
 * The numbers on the overlay, and the two buttons that are the brush's second control.
 *
 * **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule.** There is no canvas
 * text anywhere in this exhibit. The *structure* of the overlay is `readout.ts` and is art per
 * § *Static markup is art*; what is left here is what that section calls logic and always will be —
 * code that reads state and writes it into the tree, plus the handlers that change what the exhibit
 * does.
 *
 * ## What the readout is for
 *
 * This exhibit's claim is that a change the visitor caused resettles everything downstream of it,
 * so the overlay carries the numbers that make each of those claims checkable rather than the ones
 * that would make it pretty:
 *
 * | | |
 * |---|---|
 * | **the ground under the brush, in feet** | the thing their finger is doing, stated as a number. It moves while they hold still, which is how a visitor discovers the brush keeps working without being told |
 * | **water** | vertices with more than a puddle on them. Dam the river and watch it climb; cut the dam and watch it fall. It is the water's whole story in one integer |
 * | **routes** | A\* searches run since the page loaded, and how many walkers are currently walled in. This is the cost of `life.ts`'s replan policy, published so a reader can check it against the claim |
 * | **the worst frame** | § Scale's cost row, which is a gate and not a trade, beside the display's own cadence — because 21.4 against 16.7 dropped a frame and 8.4 against 8.3 did not, and neither number can be judged without the other |
 *
 * `boot.worstMs` and `boot.cadenceMs`, never a meter written here. Four exhibits hand-rolled that
 * readout before `loop` grew `stats.worstGapMs` and produced three different wrong answers.
 */
import { fmtInteger, type Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, roll, setText } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';
import { buildReadout } from './readout.js';

/** Height units to feet. An art scale, and the only place this exhibit names a real-world unit —
 *  a valley wall reads about four hundred feet, which is the size a person can imagine walking. */
const FEET = 34;

/**
 * `read` is a pull and not a push, so there is exactly one place the HUD can be a frame behind the
 * world. `onMode` is the visitor pressing RAISE or CUT — `true` means cut, and the mode it changes
 * is the exhibit's, which is what makes this module logic and `readout.ts` markup. `now` is
 * milliseconds, and it must be the clock `@latticekit/loop` was given.
 */
export interface HudOptions {
  readonly palette: WorldPalette;
  readonly read: () => { units: number; water: number; searches: number; stranded: number; worstMs: number; cadenceMs: number; cutting: boolean };
  readonly onMode: (cut: boolean) => void; readonly now: () => number;
}

export function createHud(opts: HudOptions) {
  const ui = createOverlay({ now: opts.now }), feet = roll(ui, { format: (ft) => `${fmtInteger(ft)} ft`, ms: 160 });
  const plate = buildReadout(ui, feet.node); costNode(plate.cost);
  plate.raise.addEventListener('click', () => { opts.onMode(false); }); plate.lower.addEventListener('click', () => { opts.onMode(true); });
  // `addEventListener` rather than `el`'s `on*` keys, for the reason § *Static markup is art* gives:
  // by the time a handler changes what the exhibit does, the element is somebody else's markup.
  // Pushed once: this exhibit's palette has no cycle, so guarding on `rev` would guard a number
  // that never moves. The seam is still the one rule 7 asks for — `draw` names the colors, `ui`
  // writes the custom properties, and `index.html` is the only file that decides how a card looks.
  applyPalette(ui, paletteVars(opts.palette));
  const stop: Disposer = ui.every(() => {
    const r = opts.read();
    feet.set(Math.round(r.units * FEET));
    setText(plate.water, `${fmtInteger(r.water)} TILES UNDER WATER`);
    setText(plate.routes, `${fmtInteger(r.searches)} ROUTES PLANNED · ${String(r.stranded)} STRANDED`);
    setText(plate.cost, `GAP ${r.worstMs.toFixed(1)}/${r.cadenceMs.toFixed(1)} ms`);
    plate.modes.dataset['mode'] = r.cutting ? 'cut' : 'raise';
  });
  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
