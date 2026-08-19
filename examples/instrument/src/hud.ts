/**
 * The overlay. `@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes that a rule.
 *
 * The tree lives in `index.html`. This module writes four strings. The opening line has to
 * say the exhibit is silent on purpose: nothing exists before `Audio.unlock()`, and a dark
 * hall that makes no sound is indistinguishable from a broken one unless something says so.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, setText, show, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';

export interface HudState {
  readonly woke: boolean; readonly hearing: boolean; readonly wave: string;
  readonly hz: number; readonly voices: number; readonly worstMs: number;
}

function pick(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (node instanceof HTMLElement) return node;
  throw new Error(`instrument/hud: index.html has no ${selector}`);
}

export function createHud(opts: { readonly palette: WorldPalette; readonly now: () => number; readonly read: () => HudState }): { readonly ui: Overlay; destroy(): void } {
  const ui = createOverlay({ now: opts.now }), root = pick(document, '#hud');
  const wake = pick(root, '.wake'), asking = pick(root, '.asking'), recipe = pick(root, '.recipe');
  const voices = pick(root, '.voices'), worst = costNode(pick(root, '.worst'));
  root.removeAttribute('hidden');
  ui.mount(pick(root, '.dock-left'), { layer: 'panels' });
  ui.mount(pick(root, '.dock-right'), { layer: 'panels' });
  let rev = -1;
  const stop: Disposer = ui.every(() => {
    const s = opts.read();
    if (opts.palette.rev !== rev) { rev = opts.palette.rev; applyPalette(ui, paletteVars(opts.palette)); }
    show(wake, !s.woke);
    setText(asking, !s.woke ? 'ASLEEP' : !s.hearing ? 'NO AUDIO DEVICE' : 'LISTENING');
    setText(recipe, s.hz > 0 ? `${s.wave} · ${s.hz.toFixed(1)} Hz` : '—');
    setText(voices, `${String(s.voices)} voices`);
    setText(worst, `worst ${s.worstMs.toFixed(1)} ms`);
  });
  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
