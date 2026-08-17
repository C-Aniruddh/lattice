/**
 * @art — the overlay's nodes. Four cards and a dialog, built and handed back; nothing is read from
 * them and nothing is decided here.
 *
 * Delete this module and the exhibit still walks, talks, takes, uses and saves — with no words on
 * screen. It holds no state, returns no value any decision reads, and moves no number.
 *
 * ## Why the DOM structure is art and the readout is not
 *
 * `docs/GALLERY.md` settles the `hud.ts` case one way and the CSS case the other: a HUD that *"reads
 * game state, formats it, and owns the button"* is logic, while *"its appearance is the CSS, which
 * is art, and that is the seam rule 7 already asks for."* This file is the third thing that seam
 * implies. `@lattice/ui` ships no stylesheet at all, so a class name is not decoration around the
 * appearance — **it is the appearance's only attachment point**, and `.card`, `.obj-tag`,
 * `.say-row` and the rest exist for no other reason than that `index.html` styles them.
 *
 * So the split is: this module decides that the objective is a paragraph under a tag inside a plate
 * with a rule down its left edge, and `hud.ts` decides what the paragraph says and when. Delete
 * the plate and the rule and the tag and the errand is unchanged. Change what the paragraph says
 * and it is not.
 *
 * The one thing that is deliberately **not** here is the acting button's `onclick`. That button is
 * the only way a stage moves, and a handler that advances a state machine does not belong in a file
 * whose whole claim is that it decides nothing. `hud.ts` attaches it, in one line.
 */
import { el, roll, type Overlay, type Panel, type Roll } from '@lattice/ui';
import { BRIEF, CARRYING } from './script.js';

/** The handles `hud.ts` writes into. Every one of them is a node or a roll; none of them is state. */
export interface Cards {
  readonly objective: HTMLElement; readonly carrying: HTMLElement;
  readonly ago: Roll; readonly size: HTMLElement; readonly trouble: HTMLElement; readonly saveCard: HTMLElement;
  readonly worst: HTMLElement; readonly costCard: HTMLElement;
  readonly who: HTMLElement; readonly says: HTMLElement;
  readonly act: HTMLElement; readonly leave: HTMLElement;
}

/**
 * Build the overlay's furniture.
 *
 * The left dock is what the player is doing and the right dock is what the exhibit is claiming —
 * that it saved, and what its worst frame cost. The two claims are on the right together on purpose:
 * they are the two numbers a visitor is invited to disbelieve and then test.
 */
export function buildCards(ui: Overlay, sheet: Panel): Cards {
  const brief = el('section', { class: 'card brief' }, el('h1', { class: 'brief-title' }, 'ERRAND'), el('p', { class: 'brief-line' }, BRIEF));
  const objective = el('p', { class: 'obj-line' }), carrying = el('span', { class: 'chip' }, CARRYING);
  const objCard = el('section', { class: 'card obj' }, el('span', { class: 'obj-tag' }, 'NEXT'), objective, carrying);

  // A roll rather than plain text for the save clock, because the number it shows is the one claim a
  // visitor is being asked to test, and a counter that eases is a counter people watch.
  const ago = roll(ui, { format: (v) => (v < 0 ? 'not yet' : `${Math.round(v)}s ago`), ms: 240 });
  const size = el('span', { class: 'save-size' }), trouble = el('p', { class: 'save-trouble' });
  const saveCard = el('section', { class: 'card save' }, el('span', { class: 'save-tag' }, 'SAVED'), ago.node, size, trouble);
  const worst = el('span', { class: 'cost-ms' });
  const costCard = el('section', { class: 'card cost' }, el('span', { class: 'cost-tag' }, 'WORST FRAME / 10s'), worst);
  ui.mount(el('div', { class: 'dock dock-left' }, brief, objCard), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, saveCard, costCard), { layer: 'panels' });

  // The dialog's contents. `panel` already gave it a scrim, a focus trap, Escape and pointer events;
  // what a conversation in a farming valley looks like inside that is this exhibit's business.
  const who = el('div', { class: 'say-who' }), says = el('p', { class: 'say-line' });
  const act = el('button', { class: 'btn btn-act', type: 'button' }), leave = el('button', { class: 'btn', type: 'button' });
  sheet.node.append(el('div', { class: 'card say' }, who, says, el('div', { class: 'say-row' }, act, leave)));

  return { objective, carrying, ago, size, trouble, saveCard, worst, costCard, who, says, act, leave };
}
