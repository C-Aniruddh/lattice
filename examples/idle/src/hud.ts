/**
 * The overlay as a reader: pull the shop, write the nodes, darken with the world.
 *
 * The tree lives in `overlay.ts`. This file is the lines that put `86` inside it, and the
 * handlers that change what the shop does — logic, always, per `docs/GALLERY.md`.
 */
import { fmtCompact } from '@latticekit/core';
import { paletteVars, type Palette } from '@latticekit/draw';
import { applyPalette, createOverlay, setText, toasts, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';
import { mountChrome } from './overlay.js';

export type Readout = {
  coin: number; kilns: number; rate: number; price: number; maxN: number;
  wouldH: number; lastH: number; lastCredH: number; lastSteps: number; aways: number; worstMs: number;
};

export function createHud(
  palette: Palette, read: () => Readout,
  onBuy: () => void, onMax: () => void, onAway: () => void, now: () => number,
): { ui: Overlay; destroy(): void } {
  const ui = createOverlay({ now });
  const c = mountChrome(ui, fmtCompact, onBuy, onMax, onAway);
  costNode(c.perf);
  const toast = toasts(ui);
  let paletteRev = -1, sawAway = 0;
  const stop = ui.every(() => {
    if (palette.rev !== paletteRev) { paletteRev = palette.rev; applyPalette(ui, paletteVars(palette)); }
    const h = read();
    c.coin.set(h.coin);
    setText(c.kilns, fmtCompact(h.kilns));
    setText(c.rate, `${fmtCompact(h.rate)}/s`);
    setText(c.price, fmtCompact(h.price));
    setText(c.maxN, String(h.maxN));
    setText(c.would, `14h away credits ${h.wouldH.toFixed(1)}h at this exponent`);
    setText(c.last, h.lastSteps === 0 ? 'No absence applied yet.' : `${(h.lastH / 3600).toFixed(0)}h wall · ${h.lastCredH.toFixed(1)}h credited · ${String(h.lastSteps)} step`);
    setText(c.perf, `SLOWEST FRAME 10s ${h.worstMs.toFixed(1)}ms`);
    const ok = h.coin >= h.price, many = h.maxN >= 1;
    c.buy.toggleAttribute('disabled', !ok);
    c.max.toggleAttribute('disabled', !many);
    c.buy.classList.toggle('is-on', ok);
    c.max.classList.toggle('is-on', many);
    if (h.aways > sawAway) {
      sawAway = h.aways;
      toast.show(`Fourteen hours. ${h.lastCredH.toFixed(1)}h credited. One step, not 50,400 ticks.`, 'good');
    }
  });
  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
