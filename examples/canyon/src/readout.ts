/**
 * The overlay's structure: three plates, five slots for numbers, and the bar.
 *
 * @art
 *
 * Delete this file and the exhibit runs with no overlay — the canyon still forms, still scrubs on
 * the keyboard-less default, and still lands on the same fingerprint at the same epoch. Nothing
 * here reads a number, formats one, or decides anything; every element in it is written once, with
 * fixed classes and fixed labels, and `hud.ts` is what puts values into the five it hands back.
 *
 * `docs/GALLERY.md` § *Static markup is art* settles the classification and draws the line this
 * file is built against: **a fixed tree is appearance, and the language it is written in is not
 * the test.** So the `el()` calls live here beside the CSS that styles them, and the `setText`
 * calls that make them mean something live in `hud.ts` where the line rule can see them. The two
 * things it deliberately does not license are both absent: no handler is attached here, and no
 * part of this tree's *shape* depends on anything the model did.
 *
 * The bar is the interesting one. `@latticekit/ui` ships `roll`, `panel`, `toasts`, `floats`,
 * `thumbnails` and `acknowledge`, and **no slider, meter or track of any kind** — so the control
 * this whole exhibit is driven by is a bare `<input type="range">` and every millimetre of it is
 * in `index.html`. That is reported as a finding rather than worked around; see `hud.ts`.
 */
import { el, type Overlay } from '@latticekit/ui';
import { STEPS } from './deeptime.js';

/** The six nodes `hud.ts` writes into, and nothing else. */
export interface Plate {
  /** Attached to, never read, by this module. `hud.ts` owns every listener on it. */
  readonly bar: HTMLInputElement;
  /**
   * The bar's own rail, and the reason it exists is the exhibit's one asymmetry made visible.
   *
   * Dragging the handle to a million years and letting go leaves the *handle* at a million years
   * while the model is still at two hundred thousand, re-running every step in between — which is
   * honest, is the whole point, and until now was stated only in words on the card in the corner.
   * A visitor watching the bar saw a bar that had arrived.
   *
   * So the rail is drawn here rather than by the `<input>`: a bright run from zero to where the
   * model has actually reached, a hatched stretch from there to where the handle is, and a dim
   * remainder. `hud.ts` writes the two fractions as custom properties and the stylesheet clips
   * three copies of one gradient against them, so the gradient never stretches and no element's
   * width is animated. The hatch is the time nobody has computed yet.
   */
  readonly track: HTMLElement;
  readonly stat: HTMLElement;
  readonly origin: HTMLElement;
  readonly print: HTMLElement;
  /** Carries `data-behind` so the stylesheet can recolor while the model is catching up. */
  readonly card: HTMLElement;
}

const BRIEF = 'A million years of a river, at forty thousand years a second. Drag the bar and the model re-runs — every frame you see was stepped from the seed, never remembered.';

/** Build and mount. `year` and `deep` are `roll` nodes: `ui` owns their animation, this file only
 *  decides where on the plate they sit. */
export function buildReadout(ui: Overlay, year: Node, deep: Node): Plate {
  const stat = el('span', { class: 'sub' });
  const origin = el('span', { class: 'sub origin' });
  const print = el('span', { class: 'print' });
  const card = el('section', { class: 'card clock' },
    el('div', { class: 'clock-body' }, year, deep, stat, origin, print));
  const bar = el('input', {
    class: 'scrub', type: 'range', min: '0', max: String(STEPS), step: '1', value: '0',
    'aria-label': 'Epoch',
  });
  // One mount for both corners: `ui` takes a node rather than a fragment, and a bare wrapper is
  // cheaper than a second layer registration. The docks position themselves from `index.html`.
  ui.mount(el('div', {},
    el('div', { class: 'dock dock-left' }, el('section', { class: 'card brief' },
      el('h1', { class: 'brief-title' }, 'CANYON'), el('p', { class: 'brief-line' }, BRIEF))),
    el('div', { class: 'dock dock-right' }, card)), { layer: 'panels' });
  // The one subtree `ui` grants pointer events. Everything else is `pointer-events: none`, which
  // is the package's most important default: a drag that is not on a node you named reaches the
  // world, and the world is what this exhibit is.
  const track = el('div', { class: 'scrub-track' },
    el('span', { class: 'scrub-rail' }), el('span', { class: 'scrub-run' }),
    el('span', { class: 'scrub-lag' }), bar);
  ui.mount(el('div', { class: 'dock dock-foot' }, el('section', { class: 'card scrub-card' },
    el('span', { class: 'scrub-end' }, '0'), track, el('span', { class: 'scrub-end' }, '1,000,000 yr'))),
    { layer: 'panels', interactive: true });
  return { bar, track, stat, origin, print, card };
}
