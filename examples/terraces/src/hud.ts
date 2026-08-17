/**
 * The overlay — **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule.**
 *
 * It is worth saying rather than assuming, because this is exactly the exhibit that would have
 * drawn its readout into the canvas and never noticed: the number belongs beside the two markers
 * it measures, `draw.screenText` is right there, and it would have been four lines. It is wrong
 * for four reasons this file gets for free.
 *
 * | | canvas text | `ui` |
 * |---|---|---|
 * | the error climbing as you pan uphill | jumps between strings | {@link roll} eases, and is correct if no frame paints |
 * | the picking toggle | a rectangle you hit-test yourself — **on the exhibit about hit-testing** | a `<button>`, with focus, hover and a pressed state |
 * | a hidden tab | freezes with the canvas, showing a stale number | `ui.every` runs on the loop's **update** |
 * | the type | one font, one size | tabular numerals, letter-spacing, a stylesheet |
 *
 * The second row settled it. An exhibit whose thesis is *"the obvious way to turn a pixel into a
 * thing is wrong"* cannot ship a control that turns a pixel into a thing the obvious way.
 *
 * ## The worst frame is on screen, and it is not the average
 *
 * `docs/GALLERY.md` § The cost row asks every exhibit to carry its own worst frame, because an
 * average of 16 ms with every eighth frame at 40 ms is a visible stutter and a healthy-looking
 * number. So the readout below is the **longest gap between two painted frames in the last ten
 * seconds**, and it turns red past 17. It is deliberately neither `loop.stats.frameMs`, which is
 * an exponential moving average and is the shape of number that rule exists to reject, nor
 * `loop.stats.worstFrameMs`, which never decays and therefore reports the worst frame of the
 * *session* — including the first, which is always the slowest.
 *
 * ## The cross-package promise this file executes, and what it costs here
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting the two together is what
 * makes the overlay's ink the hill's ink rather than a second, nearly-matching set of hexes in a
 * stylesheet — including the two that carry the whole readout, `ok` and `bad`, which are the same
 * values the markers on the hill are drawn in.
 *
 * It is pushed **once**, and that is a property of this exhibit rather than a shortcut. `island`
 * pushes on the state cadence guarded on `palette.rev`, because its palette rolls through four
 * hours; this one holds a single hour and nothing anywhere mutates it, so a rev check on every
 * update would be a guard against an event that cannot happen. A custom property written on the
 * root invalidates style for every node under it, so the cheapest correct number of pushes is
 * the one a static palette needs.
 *
 * **This module owns no stylesheet.** Every color, cut corner and transition is in `index.html`,
 * reading the properties written here, and all of it is uncounted art.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, el, roll, setText, type Overlay } from '@latticekit/ui';

/** What the exhibit tells the overlay, once per update. A pull, not a push, so there is exactly
 *  one place the HUD can be a frame behind the world and it is the `read` call.
 *
 *  `errorPx` is the gap between the two answers in screen pixels — the quantity Lamp Road
 *  reported by hand as 212–237. `terrace` is how many steps above the valley floor the cursor is,
 *  which is the *cause* of that gap, in units a visitor can count on the hill in front of them. */
export interface Hud {
  readonly errorPx: number; readonly tilesApart: number; readonly terrace: number;
  readonly aware: boolean; readonly onMap: boolean; readonly worstMs: number;
}

export interface HudOptions {
  /** The world's live palette. Read once and pushed to the DOM; never mutated. */
  readonly palette: WorldPalette;
  readonly read: () => Hud;
  /** Flip terrain-aware picking. The one control, and the whole exhibit. */
  readonly onToggle: () => void;
  /** Milliseconds, and it must be the clock `@latticekit/loop` was given — `boot.loop.realTime`,
   *  never a second reading of `performance.now()`. Two clocks in one HUD is a poll racing a
   *  settle, and the kit bans the raw call besides. */
  readonly now: () => number;
}

/** Hand `ui` to `drive(view.ui, boot)`; the overlay owns no clock until you do. */
export interface HudView { readonly ui: Overlay; destroy(): void }

const BRIEF = 'Stepped fields on a hillside. The green diamond is the tile under your cursor; the red one is where a flat-ground pick thinks you are — the classic isometric bug, and it grows the higher you climb.';
const HINT = 'Drag to climb. Tap to plant a stake where the live pick lands.';

export function createHud(opts: HudOptions): HudView {
  const ui = createOverlay({ now: opts.now });
  const err = roll(ui, { format: (v) => `${v.toFixed(0)} px` });
  const apart = el('b'), terrace = el('b'), worst = el('b');
  const mode = el('button', { class: 'mode', type: 'button', onclick: opts.onToggle }, '');
  const gauge = el('section', { class: 'card gauge' },
    el('span', { class: 'gauge-cap' }, 'pick error'), err.node,
    el('div', { class: 'gauge-rows' }, el('span', {}, 'tiles apart ', apart),
      el('span', {}, 'terrace ', terrace), el('span', { class: 'worst' }, 'worst frame / 10s ', worst)));

  ui.mount(el('div', { class: 'dock dock-left' }, el('section', { class: 'card brief' },
    el('h1', { class: 'brief-title' }, 'TERRACES'), el('p', { class: 'brief-line' }, BRIEF),
    el('p', { class: 'brief-hint' }, HINT))), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, gauge), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-foot' }, mode), { layer: 'panels', interactive: true });
  applyPalette(ui, paletteVars(opts.palette));

  const stop: Disposer = ui.every(() => {
    const h = opts.read();
    err.set(h.onMap ? h.errorPx : 0);
    setText(apart, h.onMap ? String(h.tilesApart) : '—');
    setText(terrace, h.onMap ? String(h.terrace) : '—');
    setText(worst, `${h.worstMs.toFixed(1)} ms`);
    setText(mode, h.aware ? 'terrain-aware picking: ON' : 'terrain-aware picking: OFF');
    mode.dataset['off'] = h.aware ? '0' : '1';
    gauge.dataset['off'] = h.aware ? '0' : '1';
    gauge.dataset['slow'] = h.worstMs > 17 ? '1' : '0';
  });

  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
