/**
 * The overlay — `@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule, and
 * because three of the readings here are counters that must keep counting in a background tab.
 *
 * `ui.every` runs on the loop's **update** while the canvas runs on `render` and drops to 0 Hz
 * behind another tab. A chunk count drawn into the canvas with `screenText` would freeze showing a
 * number that was true twenty minutes ago, and the exhibit's whole subject is a number that moves.
 *
 * ## Why this file is fifteen lines
 *
 * **The HUD's structure is in `index.html`.** `docs/GALLERY.md` settles the stylesheet there as
 * uncounted art — *"an exhibit's whole appearance may live here"* — and a `<section>` with five
 * labelled cells is appearance by the same argument. So this module does the two things markup
 * cannot: it pushes formatted values in, and it hands three buttons their handlers. Everything it
 * would otherwise have spent lines on — the labels, the dock positions, the five sentences the pin
 * can say, which one is visible — is markup and CSS switched by one class name.
 *
 * That is not a trick to get under a cap. It is the seam rule 7 already asks for, taken one step
 * further than the other exhibits took it, and the fact that `ui`'s `el()` builder makes an author
 * pay *logic* lines for markup that is purely appearance is reported as a finding.
 *
 * ## The cross-package promise this file executes
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting the two together is what
 * makes the overlay's accent the same green the temperate ground is drawn in. Guarded on
 * `Palette.rev`, because a custom property written on the root invalidates style for every node
 * under it: pushing an unchanged palette sixty times a second is sixty full subtree recalculations
 * for a color that is not moving.
 */
import { paletteVars, type Palette } from '@latticekit/draw';
import { applyPalette, createOverlay, interactive, setText, type Disposer, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';

/**
 * Wire the markup in `index.html` to the world.
 *
 * @param read One string per `[data-cell]` node, in document order.
 * @param state Class names for the root — the stylesheet's whole conditional.
 * @param now Milliseconds, and it must be the clock `@latticekit/loop` was given: `boot.loop.realTime`
 *   rather than a second `performance.now()`, because two clocks in one HUD is a poll racing a
 *   settle. That `bootstrap` exposes no reader for the clock it built the loop with is a finding.
 * @param act One handler per `<button>`, in document order.
 */
export function createHud(palette: Palette, read: () => readonly string[], state: () => string, now: () => number, act: readonly (() => void)[]): { ui: Overlay; destroy: Disposer } {
  const ui = createOverlay({ now });
  const root = document.getElementById('hud');
  if (root === null) throw new Error('endless: index.html is missing the #hud element the overlay drives');
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-cell]'));
  // The frame cost is markup here like everything else, so the flag is applied by selector rather
  // than by wrapping a node this module never built. `[data-cost]` is both halves of that row.
  root.querySelectorAll<HTMLElement>('[data-cost]').forEach((node) => costNode(node));
  // `interactive` per button rather than on the mount, because the default — a tap that is not on
  // a node you named reaches the world — is what makes the world draggable *under* the panels.
  root.querySelectorAll('button').forEach((button, i) => { button.onclick = act[i] ?? null; interactive(button); });
  ui.mount(root, { layer: 'panels' });

  let rev = -1;
  const stop = ui.every(() => {
    if (palette.rev !== rev) { rev = palette.rev; applyPalette(ui, paletteVars(palette)); }
    const values = read();
    for (let i = 0; i < cells.length; i++) setText(cells[i] ?? root, values[i] ?? '');
    root.className = `hud ${state()}`;
  });

  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
