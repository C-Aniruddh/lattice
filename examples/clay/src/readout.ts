/**
 * The overlay's structure: two plates, four slots for numbers, and the pair of buttons that is the
 * brush's second control.
 *
 * @art
 *
 * Delete this file and the exhibit runs with no overlay — the ground still deforms under a drag,
 * shift still cuts, the water still finds its way and every walker still replans. Nothing here
 * reads a number, formats one, or decides anything: every element is written once with fixed
 * classes and fixed labels, and `hud.ts` is what puts values into the four it hands back and what
 * attaches every listener.
 *
 * `docs/GALLERY.md` § *Static markup is art* settles the classification and draws the line this file
 * is built against: **a fixed tree is appearance, and the language it is written in is not the
 * test.** So the `el()` calls live here beside the CSS that styles them, and the `setText` calls
 * that make them mean something live where the line rule can see them. The two things that section
 * deliberately does not license are both absent: no handler is attached here, and no part of this
 * tree's *shape* depends on anything the visitor did.
 *
 * The buttons are the interesting ones. `@latticekit/ui` ships `roll`, `panel`, `toasts`, `floats`,
 * `thumbnails` and `acknowledge`, and **no button, no segmented control and no toggle of any kind**
 * — so the one control this exhibit has besides the drag itself is a bare `<button>` pair and every
 * millimetre of it is in `index.html`. `Canyon` reported the same absence about a slider. Two
 * exhibits needing two different primitives that are not there is the finding, not a coincidence.
 */
import { el, type Overlay } from '@latticekit/ui';

/** The nodes `hud.ts` writes into, and nothing else. */
export interface Plate {
  /** Attached to, never read, by this module. `hud.ts` owns every listener on both. */
  readonly raise: HTMLButtonElement;
  readonly lower: HTMLButtonElement;
  /** Carries `data-mode` so the stylesheet can light whichever of the two is in force. */
  readonly modes: HTMLElement;
  readonly water: HTMLElement;
  readonly routes: HTMLElement;
  readonly cost: HTMLElement;
}

const BRIEF = 'Drag on the ground and it rises under your finger. Hold shift — or press CUT — and it goes down. Everything else in this valley is a consequence: the water re-routes, the walkers re-plan, the trees ride up and slide off, and the light finds the new face.';

/** Build and mount. `feet` is a `roll` node: `ui` owns its animation, this file only decides where
 *  on the plate it sits. */
export function buildReadout(ui: Overlay, feet: Node): Plate {
  const water = el('span', { class: 'sub' });
  const routes = el('span', { class: 'sub' });
  const cost = el('span', { class: 'sub cost' });
  ui.mount(el('div', {},
    el('div', { class: 'dock dock-left' }, el('section', { class: 'card brief' },
      el('h1', { class: 'brief-title' }, 'CLAY'), el('p', { class: 'brief-line' }, BRIEF))),
    el('div', { class: 'dock dock-right' }, el('section', { class: 'card gauge' },
      el('div', { class: 'gauge-body' }, feet, water, routes, cost)))), { layer: 'panels' });
  const raise = el('button', { class: 'mode', type: 'button' }, 'RAISE');
  const lower = el('button', { class: 'mode', type: 'button' }, 'CUT');
  const modes = el('div', { class: 'modes' }, raise, lower);
  // The one subtree `ui` grants pointer events. Everything else is `pointer-events: none`, which is
  // the package's most important default: a drag that is not on a node you named reaches the world,
  // and in this exhibit the world is the only thing a drag is for.
  ui.mount(el('div', { class: 'dock dock-foot' }, modes), { layer: 'panels', interactive: true });
  return { raise, lower, modes, water, routes, cost };
}
