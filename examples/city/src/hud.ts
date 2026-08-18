/**
 * The overlay — `@latticekit/ui` over the canvas, per rule 7 of `docs/GALLERY.md`.
 *
 * Logic, not art: it reads state, formats it, and owns nothing that draws. Its *appearance* is
 * the CSS in `index.html`, which is art and is uncounted, and that seam is the whole reason the
 * package ships no stylesheet of its own.
 *
 * It also executes the cross-package promise the gallery cares about: `draw`'s `paletteVars`
 * reaching the DOM as `--lattice-*` custom properties, guarded on `palette.rev`, so the cards
 * sink from blue hour to midnight with the city instead of glowing in opening-frame colors over a
 * scene that has moved on. The smoothing is a CSS transition, not a tween — it runs on the
 * compositor and degrades to an instant jump in a hidden tab, which is correct, because nobody
 * is looking.
 *
 * Three parameters rather than an options object, and no exported state interface: this HUD reads
 * three numbers, and a named type per number is how a forty-line overlay becomes a hundred.
 */
import { fmtInteger, type Disposer } from '@latticekit/core';
import { paletteVars, type Palette } from '@latticekit/draw';
import type { Loop } from '@latticekit/loop';
import { applyPalette, createOverlay, el, roll, setText, toasts, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';

/** What the exhibit tells the overlay, once per update: the hour, and how many it has woken. */
export interface Hud { readonly hour: number; readonly woken: number; readonly buildings: number }

/**
 * Seconds in one worst-frame window.
 *
 * `FrameStats.worstFrameMs` is the worst since the last `resetStats()`, which grows monotonically
 * and would show a hitch from thirty seconds ago forever. A rolling ten seconds is what § Scale
 * asks for, so this keeps **two half-windows**: the current one, and the last one it retired. The
 * number displayed is the larger of the pair, which is the worst frame of somewhere between five
 * and ten seconds ago — never longer, and never an average.
 */
const WINDOW_SEC = 5;

export interface HudView {
  /** Hand this to `drive(view.ui, boot)`. The overlay owns no clock until you do. */
  readonly ui: Overlay;
  say(key: string, text: string, kind?: 'plain' | 'good' | 'bad'): void;
  destroy(): void;
}

/** **The loop, not a clock.** The overlay needs one, and the exhibit's worst frame lives on
 *  `loop.stats` — two arguments where one already carries both would be a second clock reading in
 *  a HUD, which is a poll racing a settle whose symptom is a number that arrives late exactly
 *  once. It also keeps `performance.now()` out of the exhibit entirely. */
export function createHud(palette: Palette, read: () => Hud, loop: Loop): HudView {
  const ui = createOverlay({ now: () => loop.realTime * 1000 });
  const woken = roll(ui, { format: fmtInteger });
  const hour = el('span', { class: 'hour-name' }, 'BLUE HOUR');
  const total = el('span', { class: 'stat-label' });
  const worst = el('span', { class: 'worst-value' }, '—');
  const brief = el('section', { class: 'card' },
    el('h1', { class: 'brief-title' }, 'CITY BLOCK'),
    el('p', { class: 'brief-line' }, 'Tap a tower. Every window in it comes on.'));
  const lit = el('section', { class: 'card lit' },
    el('span', { class: 'lit-mark' }),
    el('div', { class: 'lit-body' }, el('span', { class: 'stat-label' }, 'AWAKE'), woken.node, total),
    hour);
  const cost = costNode(el('section', { class: 'card cost' },
    el('span', { class: 'stat-label' }, 'WORST FRAME / 10s'), worst));
  ui.mount(el('div', { class: 'dock dock-left' }, brief), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, lit, cost), { layer: 'panels' });
  const host = toasts(ui, { max: 2 });

  /** `rev` is the whole guard: a custom property written on the root invalidates style for every
   *  node that inherits it, so pushing an unchanged palette sixty times a second would be sixty
   *  subtree recalculations to animate a color that moves over a minute. */
  let rev = -1;
  const stopPalette: Disposer = ui.every(() => {
    if (palette.rev === rev) return;
    rev = palette.rev;
    applyPalette(ui, paletteVars(palette));
  });
  let retired = 0;
  let mark = 0;
  const stopState: Disposer = ui.every(() => {
    const h = read();
    woken.set(h.woken);
    setText(total, `/ ${String(h.buildings)}`);
    setText(hour, h.hour < 0.35 ? 'BLUE HOUR' : h.hour < 0.8 ? 'DUSK' : 'MIDNIGHT');
    if (loop.realTime - mark >= WINDOW_SEC) { mark = loop.realTime; retired = loop.stats.worstFrameMs; loop.resetStats(); }
    setText(worst, `${Math.max(retired, loop.stats.worstFrameMs).toFixed(1)} ms`);
  });

  return {
    ui,
    say: (key, text, kind = 'plain') => host.once(key, text, kind),
    destroy: () => { stopState(); stopPalette(); ui.destroy(); },
  };
}
