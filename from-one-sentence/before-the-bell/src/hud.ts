import { fmtDuration } from '@latticekit/core';
import { paletteVars, type Palette } from '@latticekit/draw';
import {
  applyPalette,
  createOverlay,
  el,
  hide,
  interactive,
  roll,
  setText,
  show,
  type Overlay,
} from '@latticekit/ui';

export interface Readout {
  readonly customers: number;
  readonly remainingMs: number;
  readonly stalls: number;
  readonly closed: boolean;
  readonly hint: string;
}

export interface Hud {
  readonly ui: Overlay;
  destroy(): void;
}

export function createHud(palette: Palette, now: () => number, read: () => Readout, onAgain: () => void): Hud {
  const ui = createOverlay({ now });
  const sold = roll(ui, { format: (n) => String(Math.round(n)) });
  const clock = el('span', { class: 'val' });
  const stalls = el('span', { class: 'val' });
  const hint = el('p', { class: 'hint' });
  const result = el('p', { class: 'lede' });
  const again = interactive(el('button', { class: 'again', type: 'button' }, 'Open again tomorrow'));
  again.addEventListener('click', onAgain);
  const closed = el('section', { class: 'card closed' }, result, again);

  ui.mount(
    el(
      'div',
      { class: 'dock' },
      el('section', { class: 'card' },
        el('div', { class: 'mark' }, 'Before the Bell'),
        el('h1', {}, 'The morning oven'),
        el('p', { class: 'lede' }, 'Pull the market to your door before they ring closing.'),
      ),
      el('section', { class: 'card figures' },
        el('div', { class: 'row' }, el('span', { class: 'key' }, 'CUSTOMERS'), sold.node),
        el('div', { class: 'row' }, el('span', { class: 'key' }, 'UNTIL CLOSE'), clock),
        el('div', { class: 'row' }, el('span', { class: 'key' }, 'STALLS LEFT'), stalls),
      ),
      closed,
    ),
    { layer: 'panels' },
  );
  ui.mount(el('div', { class: 'dock-foot' }, el('section', { class: 'card' }, hint)), { layer: 'panels' });

  let rev = -1;
  ui.every(() => {
    if (palette.rev !== rev) {
      rev = palette.rev;
      applyPalette(ui, paletteVars(palette));
    }
    const m = read();
    sold.set(m.customers);
    const late = m.remainingMs < 20_000 && !m.closed;
    setText(clock, m.closed ? 'closed' : fmtDuration(m.remainingMs / 1000, 'clock'));
    clock.classList.toggle('is-late', late);
    setText(stalls, String(m.stalls));
    stalls.classList.toggle('is-ok', m.stalls > 0);
    setText(hint, m.hint);
    if (m.closed) {
      setText(result, `${m.customers} found the oven before the bell.`);
      show(closed);
      closed.classList.add('is-on');
    } else {
      hide(closed);
      closed.classList.remove('is-on');
    }
  });

  return { ui, destroy() { ui.destroy(); } };
}
