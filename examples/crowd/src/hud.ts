/**
 * The readout — `@latticekit/ui` over the canvas, and the exhibit's actual argument.
 *
 * A live walker count beside a live frame cost is half the claim. The other half is the strip of
 * controls at the bottom of this file, and it is the only part of the exhibit a visitor can *do*
 * rather than read: **a scrubber, and two buttons that jump a thousand seconds.**
 *
 * They exist because "there is no per-walker state" is a sentence, and a sentence about an absence
 * cannot be seen. A jump can. A simulated crowd asked for `t + 1000` has to integrate a thousand
 * seconds or admit it cannot answer; this one evaluates an expression and paints, in the same
 * frame, at the same cost. Drag the scrubber back and every person walks backwards through a
 * position that was never stored — and releasing it at `now` restores the opening frame *exactly*,
 * because the opening frame was never a starting condition. It was `t = 0`.
 *
 * `bytes of walker state` is a constant `0` and is not a joke. It is the only figure on screen that
 * would be wrong if the exhibit were built the ordinary way, and a visitor who has just dragged the
 * count to three thousand is exactly the person for whom it means something.
 *
 * This module also executes the cross-package promise `docs/GALLERY.md` names: `draw`'s
 * `paletteVars` reaching the DOM as `--lattice-*` custom properties through `ui`'s `applyPalette`,
 * guarded on `Palette.rev` — because a custom property written on the root invalidates style for
 * every node that inherits it, and pushing an unchanged palette sixty times a second would be sixty
 * full-subtree recalculations for a color nobody is watching change.
 *
 * There is no canvas text anywhere in this exhibit, which `docs/GALLERY.md` rule 7 makes a rule and
 * which this file is the whole of.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, el, roll, setText, type Overlay } from '@latticekit/ui';

/** What the frame knows and the overlay shows. Pulled once per update, never pushed. */
export interface Readout {
  readonly walkers: number;
  /** Survivors of the depth cull — so a visitor can see that most of the crowd is off the edges. */
  readonly drawn: number;
  /** `loop.stats.frameMs`, smoothed, so the readout is legible rather than honest-per-frame. */
  readonly frameMs: number;
  /**
   * `loop.stats.worstFrameMs` over a rolling ten seconds — **the figure this exhibit is judged on.**
   *
   * `docs/GALLERY.md` § The cost row makes it a rule for every exhibit and it lands hardest here:
   * a crowd that stutters has refuted its own claim in the most visible way available, and an
   * average would hide exactly the frame that did it. 16.7 ms is the line.
   */
  readonly worstMs: number;
  /** The instant the whole picture is a function of, in seconds. The number the scrubber moves. */
  readonly clock: number;
}

/** Hand `ui` to `drive(hud.ui, boot)`; the overlay owns no clock until you do. */
export interface Hud {
  readonly ui: Overlay;
  destroy(): void;
}

/** How far either way the scrubber reaches, in seconds. Twenty minutes of piazza, each way. */
const REACH = 1200;

export function createHud(palette: WorldPalette, read: () => Readout, onWarp: (seconds: number) => void, now: () => number): Hud {
  const ui = createOverlay({ now });
  const people = roll(ui, { format: (n) => String(Math.round(n)) });
  const drawn = el('span', { class: 'val' }), frame = el('span', { class: 'val' }), worst = el('span', { class: 'val' }), stamp = el('span', { class: 'val stamp' });
  const scrub = el('input', { class: 'scrub', type: 'range', min: -REACH, max: REACH, step: 0.5, value: 0, oninput: () => { onWarp(Number(scrub.value)); } });
  const warp = (seconds: number): void => { scrub.value = String(seconds); onWarp(seconds); };
  const row = (key: string, val: HTMLElement): HTMLElement => el('div', { class: 'row' }, el('span', { class: 'key' }, key), val);
  const jump = (label: string, s: number): HTMLElement => el('button', { class: 'jump', type: 'button', onclick: () => { warp(s); } }, label);

  ui.mount(el('div', { class: 'dock' },
    el('section', { class: 'card' }, el('h1', {}, 'CROWD'),
      el('p', { class: 'lede' }, 'Eight closed curves, and a number. Nothing here remembers where anybody is.'),
      el('code', {}, 's = ((φ·i + t·v) mod 1) · route.arcLength')),
    el('section', { class: 'card figures' }, row('PEOPLE', people.node), row('ON SCREEN', drawn),
      row('FRAME', frame), row('WORST FRAME / 10 s', worst), row('STATE PER PERSON', el('span', { class: 'val zero' }, '0 bytes')))),
    { layer: 'panels' });
  // The one interactive node in the overlay. Everything else is `pointer-events: none`, which is
  // `ui`'s most important decision: a drag that is not on a node you named reaches the world.
  ui.mount(el('div', { class: 'dock dock-foot' },
    el('section', { class: 'card time' }, row('WORLD TIME', stamp), scrub,
      el('div', { class: 'jumps' }, jump('−1000 s', -REACH), jump('now', 0), jump('+1000 s', REACH)),
      el('p', { class: 'lede' }, 'Scrub it. Nothing rewinds — every position is re-evaluated at the instant you asked for.'))),
    { layer: 'panels', interactive: true });

  let rev = -1, due = 0;
  const stopPalette: Disposer = ui.every(() => {
    if (palette.rev === rev) return;
    rev = palette.rev;
    applyPalette(ui, paletteVars(palette));
  });
  // The clock every tick, the costs twice a second: a frame-time readout that flickers through
  // four digits is a number nobody can read, and the world time is the one figure a visitor is
  // watching move while they drag.
  const stopState: Disposer = ui.every((nowMs) => {
    const r = read();
    people.set(r.walkers);
    setText(stamp, `t = ${r.clock.toFixed(2)} s`);
    if (nowMs < due) return;
    due = nowMs + 400;
    setText(drawn, String(r.drawn < 0 ? 0 : r.drawn));
    setText(frame, `${r.frameMs.toFixed(1)} ms`);
    if (setText(worst, `${r.worstMs.toFixed(1)} ms`)) worst.dataset['over'] = r.worstMs > 16.7 ? '1' : '0';
  });

  return { ui, destroy() { stopState(); stopPalette(); ui.destroy(); } };
}
