/**
 * The overlay — **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule.**
 *
 * There is no canvas text anywhere in this exhibit, which is worth saying rather than assuming:
 * an exhibit whose whole claim is a pair of *numbers* is exactly the shape that would have
 * reached for `screenText` in the Overlay pass and never noticed. It is four lines, it is right
 * there, and it is wrong here for one reason beyond the four `island` lists — the Overlay pass is
 * above the light composite, so canvas text would be the one thing in the frame the darkness
 * never touches, in a scene whose entire subject is what the darkness touches.
 *
 * ## The two numbers are one claim, which is why they are side by side
 *
 * `docs/GALLERY.md` hands this exhibit the light field partly as a stress test, and the thing
 * under test is that **a light field's cost is its buffer, and the buffer scales with `scale` and
 * the viewport rather than with the number of lights**. A visitor presses "light 100 more",
 * watches `POOLS` jump by two hundred and `WORST` not move, and has run the experiment. Putting
 * them anywhere but adjacent would be putting the evidence in two places.
 *
 * `POOLS` is read straight off `LightField.count` — the field's own accounting rather than the
 * exhibit's, because a count the exhibit kept itself would be a claim about what it *meant* to
 * add. `WORST` is the worst frame of the last five to ten seconds and never an average: § Scale's
 * cost row is explicit that an average of 16 ms with every eighth frame at 40 ms is a visible
 * stutter reported as a healthy number, and the row is a gate. The plate turns red at 16.7 ms,
 * which is the gate itself drawn on the instrument that measures it.
 *
 * ## The cross-package promise this file executes
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting the two together is what
 * makes the overlay read as another thing in the cave rather than as a browser window over it.
 * This exhibit's palette never rolls, so the push happens once for the life of the page and the
 * `rev` guard is what makes "once" true rather than "sixty times a second" — a custom property
 * written on the root invalidates style for every node under it.
 *
 * **This module owns no stylesheet.** `ui` ships none by design and neither does this file; every
 * color, cut corner and letter-spacing is in `index.html`, reading the custom properties written
 * here. That seam is the whole reason the package drops into a game whose art direction was
 * decided first.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, el, roll, setText, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';

/**
 * What the exhibit tells the overlay, once per update. A pull, not a push, so there is exactly
 * one place the HUD can be a frame behind the world and it is the `read` call.
 *
 * | field | what it is |
 * |---|---|
 * | `pools` | `LightField.count` — pools accumulated last frame, the field's own number |
 * | `torches` | torches the visitor has lit. The eight braziers are always alight and are extra |
 * | `worstMs` | worst frame of the last five to ten seconds. Never an average; see the header |
 */
export interface Hud { readonly pools: number; readonly torches: number; readonly worstMs: number }

/**
 * `palette` is read on the state cadence and pushed to the DOM, never mutated. `onMore` lights a
 * hundred more torches and `onDouse` gives the dark back. `now` is milliseconds and **must be the
 * clock `@latticekit/loop` was given** — two clocks in one HUD is a poll racing a settle.
 */
export interface HudOptions {
  readonly palette: WorldPalette; readonly read: () => Hud;
  readonly onMore: () => void; readonly onDouse: () => void; readonly now: () => number;
}

/** Hand `ui` to `drive(view.ui, boot)`; the overlay owns no clock until you do. */
export interface HudView { readonly ui: Overlay; destroy(): void }

/** The frame budget § Scale gates on, in milliseconds. 60 fps on a mid laptop. */
const BUDGET = 16.7;

export function createHud(opts: HudOptions): HudView {
  const ui = createOverlay({ now: opts.now });
  const brief = el('section', { class: 'card brief' },
    el('h1', { class: 'brief-title' }, 'CAVERNS'),
    el('p', { class: 'brief-line' }, 'Tap the floor to carry your lantern into the dark. Drag to look.'),
    el('p', { class: 'brief-line brief-note' }, 'Set it down beside a brazier: the two pools become one brighter region, with no ridge where they meet and no rim where they end.'));

  const pools = roll(ui, { format: (v) => String(Math.round(v)) });
  const worst = el('span', { class: 'gauge-value' }), torches = el('span', { class: 'gauge-note' });
  const meter = el('section', { class: 'card meter' },
    el('div', { class: 'gauge' }, el('span', { class: 'gauge-key' }, 'POOLS'), pools.node),
    costNode(el('div', { class: 'gauge' }, el('span', { class: 'gauge-key' }, 'WORST'), worst)),
    torches);

  // The two interactive nodes in the whole overlay. Everything else is `pointer-events: none`,
  // which is `ui`'s most important decision: a drag that is not on a node you named reaches the
  // world, and the world is what this exhibit is.
  const more = el('button', { class: 'act', type: 'button', onclick: opts.onMore }, 'Light 100 more');
  const douse = el('button', { class: 'act act-quiet', type: 'button', onclick: opts.onDouse }, 'Douse');

  ui.mount(el('div', { class: 'dock dock-left' }, brief), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, meter), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-foot' }, more, douse), { layer: 'panels', interactive: true });

  let paletteRev = -1;
  const stopPalette: Disposer = ui.every(() => {
    if (opts.palette.rev === paletteRev) return;
    paletteRev = opts.palette.rev;
    applyPalette(ui, paletteVars(opts.palette));
  });

  const stopState: Disposer = ui.every(() => {
    const h = opts.read();
    pools.set(h.pools);
    setText(worst, `${h.worstMs.toFixed(1)} ms`);
    setText(torches, `${String(h.torches)} torches · 8 braziers`);
    meter.dataset['over'] = h.worstMs > BUDGET ? '1' : '0';
  });

  return { ui, destroy: () => { stopState(); stopPalette(); ui.destroy(); } };
}
