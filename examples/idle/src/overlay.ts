/**
 * The overlay's structure: a fixed tree, written once, with fixed labels.
 *
 * @art
 *
 * Appearance is art; the reading of state is `hud.ts`. Nothing here holds a number, decides
 * a purchase, or chooses how many hours an absence is. The three handlers are attached, not
 * defined. The tree is the same nine nodes on every seed.
 */
import { el, roll, type Overlay, type Roll } from '@latticekit/ui';

export interface Chrome {
  readonly coin: Roll;
  readonly kilns: HTMLElement;
  readonly rate: HTMLElement;
  readonly price: HTMLElement;
  readonly maxN: HTMLElement;
  readonly would: HTMLElement;
  readonly last: HTMLElement;
  readonly perf: HTMLElement;
  readonly buy: HTMLButtonElement;
  readonly max: HTMLButtonElement;
  readonly away: HTMLButtonElement;
}

const BRIEF =
  'Closed-form prices. Buy-max is a logarithm, not a loop. Fourteen hours away is one step — not 50,400 ticks.';

export function mountChrome(
  ui: Overlay,
  format: (value: number) => string,
  onBuy: () => void,
  onMax: () => void,
  onAway: () => void,
): Chrome {
  const brief = el(
    'section',
    { class: 'card brief' },
    el('h1', { class: 'brief-title' }, 'IDLE'),
    el('p', { class: 'brief-line' }, BRIEF),
  );

  const coin = roll(ui, { format });
  const kilns = el('span', { class: 'stat-v' });
  const rate = el('span', { class: 'stat-v' });
  const price = el('span', { class: 'stat-v' });
  const maxN = el('span', { class: 'stat-v' });
  const would = el('p', { class: 'would' });
  const last = el('p', { class: 'last' });
  const perf = el('span', { class: 'perf' });

  const buy = el('button', { class: 'act', type: 'button' }, 'Buy one') as HTMLButtonElement;
  const max = el('button', { class: 'act act-max', type: 'button' }, 'Buy max') as HTMLButtonElement;
  const away = el('button', { class: 'away', type: 'button' }, 'Fourteen hours away') as HTMLButtonElement;
  buy.addEventListener('click', onBuy);
  max.addEventListener('click', onMax);
  away.addEventListener('click', onAway);

  const shop = el(
    'section',
    { class: 'card shop' },
    el('div', { class: 'coin-row' }, el('span', { class: 'coin-k' }, 'COIN'), coin.node),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('span', { class: 'stat-k' }, 'KILNS'), kilns),
      el('div', { class: 'stat' }, el('span', { class: 'stat-k' }, 'PER SEC'), rate),
      el('div', { class: 'stat' }, el('span', { class: 'stat-k' }, 'NEXT'), price),
      el('div', { class: 'stat' }, el('span', { class: 'stat-k' }, 'MAX'), maxN),
    ),
    el('div', { class: 'acts' }, buy, max),
    away,
    would,
    last,
    perf,
  );

  ui.mount(el('div', { class: 'dock dock-left' }, brief), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, shop), { layer: 'panels', interactive: true });
  return { coin, kilns, rate, price, maxN, would, last, perf, buy, max, away };
}
