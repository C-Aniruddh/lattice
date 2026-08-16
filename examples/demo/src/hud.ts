/**
 * The HUD — **`@lattice/ui` over the canvas, and the seam that had never been run.**
 *
 * This was drawn into the Overlay pass out of `draw`'s screen-space primitives, because `ui` had
 * not landed. It has now, and `docs/GALLERY.md` makes the DOM overlay a rule rather than a
 * preference. {@link Hud} is unchanged as the shape the exhibit fills; only the body below moved.
 *
 * Four things the canvas version could not do, and they are the argument for the whole package:
 *
 * | | canvas text | `ui` |
 * |---|---|---|
 * | a number changing | jumps between two integers | {@link roll} eases, and is *correct* if no frame paints |
 * | an affordance | a rectangle you have to hit-test yourself | a `<button>`, with focus, hover and a real disabled state |
 * | a message | a string you have to time, place and expire | {@link toasts}, with a latch so a notice cannot train its own dismissal |
 * | a hidden tab | freezes with the canvas, showing stale prices | `ui.every` runs on the loop's *update*, so the HUD is never wrong |
 *
 * ## The cross-package promise this file executes
 *
 * `draw` exports `paletteVars` and `ui` exports `applyPalette`, and until this file nothing in the
 * repo had ever put the two together. {@link createHud} pushes the live palette onto the overlay
 * root as `--lattice-*` custom properties on the **state** cadence, guarded on `palette.rev` —
 * so the card stock, the rules and the accent all darken with the valley at dusk instead of
 * glowing in daylight colors over a night scene. The smoothing is a CSS `transition` in
 * `index.html`, not a tween here: it runs on the compositor and degrades to an instant jump in a
 * hidden tab, which is correct, because nobody is looking.
 *
 * **This module owns no stylesheet either.** `ui` ships none by design and neither does the
 * exhibit's TypeScript; every color, radius and cut corner is in `index.html`, reading the custom
 * properties this file writes. That is the boundary, and it is why the package can be dropped
 * into a game whose art direction was decided first.
 */
import { fmtCompact, type Disposer } from '@lattice/core';
import { paletteVars, type Palette as WorldPalette } from '@lattice/draw';
import {
  applyPalette,
  createOverlay,
  el,
  roll,
  setText,
  show,
  toasts,
  type Overlay,
  type Roll,
  type ToastHost,
} from '@lattice/ui';

export interface Hud {
  /** One line, always naming the next action. The entire tutorial. */
  readonly objective: string;
  readonly coin: number;
  readonly coinRate: number;
  readonly lit: number;
  readonly stations: number;
  readonly walkers: number;
  readonly daylight: number;
  readonly showCoin: boolean;
  /** What the next lamp costs. Rolled on the button, so a price rise is something you watch. */
  readonly price: number;
  /** Whether the player can pay it — the button's affordable state, and nothing else. */
  readonly affordable: boolean;
}

/** How the HUD is built. Everything it needs and nothing about how it looks. */
export interface HudOptions {
  /** The world's live palette. Read on the state cadence and pushed to the DOM through
   *  `paletteVars`; never mutated here. */
  readonly palette: WorldPalette;
  /** The state, read once per update. A pull rather than a push, so there is exactly one place
   *  the HUD can be a frame behind the world and it is this line. */
  readonly read: () => Hud;
  /** The button. The same call the world's tap makes, so there is one code path to be wrong. */
  readonly onLight: () => void;
  /** Milliseconds, and it must be the clock `@lattice/loop` was given. Two clocks in one HUD is
   *  a poll racing a settle. */
  readonly now: () => number;
}

/** The HUD, as the exhibit holds it. */
export interface HudView {
  /** Hand this to `ui.drive(view.ui, boot)`. The overlay owns no clock until you do. */
  readonly ui: Overlay;
  /** Say something, at most once per `key` for the session. `key` names the *condition*. */
  say(key: string, text: string, kind?: 'plain' | 'good' | 'bad'): void;
  /** Remove the overlay and everything on it. */
  destroy(): void;
}

/** A label and the roll beside it, as one row. Four of these are most of the HUD. */
function stat(ui: Overlay, label: string, format: (n: number) => string): { node: HTMLElement; value: Roll } {
  const value = roll(ui, { format });
  return {
    node: el('div', { class: 'stat' }, el('span', { class: 'stat-label' }, label), value.node),
    value,
  };
}

export function createHud(opts: HudOptions): HudView {
  const ui = createOverlay({ now: opts.now });

  // ── the cards ────────────────────────────────────────────────────────────────────────────
  const objective = el('p', { class: 'brief-line' });
  const brief = el(
    'section',
    { class: 'card brief' },
    el('h1', { class: 'brief-title' }, 'LAMP ROAD'),
    objective,
  );

  const coin = roll(ui, { format: fmtCompact });
  const rate = el('span', { class: 'coin-rate' });
  const coinCard = el(
    'section',
    { class: 'card coin' },
    el('span', { class: 'coin-mark' }),
    el('div', { class: 'coin-body' }, el('span', { class: 'stat-label' }, 'COIN'), coin.node),
    rate,
  );

  const litOf = stat(ui, 'ROAD LIT', String);
  const total = el('span', { class: 'road-total' });
  const fill = el('div', { class: 'road-fill' });
  const roadCard = el(
    'section',
    { class: 'card road' },
    el('div', { class: 'road-head' }, litOf.node, total),
    el('div', { class: 'road-track' }, fill),
  );

  const hour = el('span', { class: 'hour-name' });
  const walkers = stat(ui, 'ON THE ROAD', String);
  const hourCard = el(
    'section',
    { class: 'card hour' },
    el('span', { class: 'hour-orb' }),
    el('div', { class: 'hour-body' }, hour, walkers.node),
  );

  // The one interactive node in the whole overlay. Everything else is `pointer-events: none` by
  // default, which is `ui`'s most important decision: a tap that is not on a node you named
  // reaches the world, and the world is what this exhibit is.
  const price = roll(ui, { format: fmtCompact });
  const button = el(
    'button',
    { class: 'light', type: 'button', onclick: opts.onLight },
    el('span', { class: 'light-word' }, 'Light the next lamp'),
    el('span', { class: 'light-price' }, price.node),
  );

  ui.mount(el('div', { class: 'dock dock-left' }, brief, coinCard, roadCard), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, hourCard), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-foot' }, button), { layer: 'panels', interactive: true });

  const host: ToastHost = toasts(ui, { max: 2 });

  // ── the two cadences ─────────────────────────────────────────────────────────────────────
  //
  // Everything below is on `every`, which is the loop's *update*: wall time, and it keeps running
  // when the canvas does not. Nothing here is registered on `paint` — the only paint work in this
  // HUD belongs to the rolls, which registered their own.

  /** `rev` is the whole guard. A custom property written on the root invalidates style for every
   *  node that inherits it, so pushing an unchanged palette sixty times a second would be sixty
   *  full-subtree recalculations to animate a color the player reads over three minutes. */
  let paletteRev = -1;
  const stopPalette: Disposer = ui.every(() => {
    if (opts.palette.rev === paletteRev) return;
    paletteRev = opts.palette.rev;
    applyPalette(ui, paletteVars(opts.palette));
  });

  const stopState: Disposer = ui.every(() => {
    const h = opts.read();
    setText(objective, h.objective);
    show(coinCard, h.showCoin);
    coin.set(h.coin);
    setText(rate, `+${h.coinRate.toFixed(1)}/s`);
    litOf.value.set(h.lit);
    setText(total, `/ ${String(h.stations)}`);
    fill.style.setProperty('--road', (h.lit / Math.max(1, h.stations)).toFixed(3));
    setText(hour, h.daylight > 0.5 ? 'DAY' : 'NIGHT');
    hourCard.dataset['night'] = h.daylight > 0.5 ? '0' : '1';
    walkers.value.set(h.walkers);
    // The affordable state, as data rather than as `disabled`: an unaffordable lamp is still
    // worth tapping — it is how a player learns there is a price — and a `disabled` button
    // swallows the tap, plays no sound and teaches nothing.
    button.dataset['afford'] = h.affordable ? '1' : '0';
    show(button, h.lit < h.stations);
    price.set(h.price);
  });

  return {
    ui,
    say(key, text, kind = 'plain') {
      host.once(key, text, kind);
    },
    destroy() {
      stopState();
      stopPalette();
      ui.destroy();
    },
  };
}
