/**
 * The overlay's structure: one fixed tree of elements, written once, with fixed labels.
 *
 * @art
 *
 * Delete this file and the yard still runs, every save still climbs, every refusal still happens
 * and every counter still counts — there is simply nothing on top of the canvas saying so.
 *
 * ## Why the tree is here and not in `index.html`
 *
 * `GALLERY.md` § *Static markup is art* settles this: *"the same tree assembled by `el()` calls in
 * a `.ts` file, still fixed, still written once — **art**. The language it is written in is not
 * the test."* The test it does give is `would deleting it change only how the exhibit looks?`, and
 * for a `<div class="rung">` carrying the sentence *the stored `#rrggbb` became the hue it was
 * derived from*, the answer is yes.
 *
 * It is in TypeScript rather than in HTML for one reason and it is not convenience: those four
 * sentences are `chain.WHY`, which is what `migrations().step()` was given as its `why` argument
 * and therefore what `chain.steps` carries. Copying them into markup would put the ladder's own
 * prose in two files, and the copy would be wrong the first time a rung was reworded — silently,
 * because nothing compares a string in an HTML file to a string in a chain. **The rungs on screen
 * are the rungs in the chain, by construction.**
 *
 * The one thing that is *not* here is every number: `hud.ts` owns the reading of state, which is
 * the seam `GALLERY.md` draws and the reason this module is uncounted and that one is not.
 */
import { el } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';
import { HEAD, WHY } from './chain.js';

/** The nodes `hud.ts` writes into. Named for what they say, not for where they sit. */
export interface Plates {
  readonly docks: readonly HTMLElement[];
  readonly steps: readonly HTMLElement[];
  readonly rungs: readonly HTMLElement[];
  readonly bytes: HTMLElement;
  readonly age: HTMLElement;
  readonly opener: HTMLElement;
  readonly carrying: HTMLElement;
  readonly verdict: HTMLElement;
  readonly migrated: HTMLElement;
  readonly refused: HTMLElement;
  readonly reasons: HTMLElement;
  readonly worst: HTMLElement;
}

const BRIEF =
  'One archive of save files, and five builds of the same game standing in a row. Every crate is ' +
  'a v1 save. It is handed to the v1 build, then the v2 build, then the v3 — one terrace, one ' +
  'migration — and what it is carrying changes shape under you as it climbs.';
const HINT = 'Drag to pan, scroll to zoom, tap a crate to follow it. A save a build refuses topples back over the rung it failed, and lies at the foot of that wall.';

/** The five decks and the four rungs between them, top down, so the card and the yard agree
 *  about which way is up. */
function ladder(steps: HTMLElement[], rungs: HTMLElement[]): HTMLElement {
  const rows: HTMLElement[] = [];
  for (let k = HEAD - 1; k >= 0; k--) {
    const step = el('div', { class: 'step', 'data-v': String(k + 1) }, el('b', {}, `v${String(k + 1)}`), el('span', {}, k === 0 ? 'the archive floor' : k === HEAD - 1 ? 'the vault' : ''));
    steps[k] = step;
    rows.push(step);
    if (k === 0) continue;
    const rung = el('div', { class: 'rung' }, el('b', {}, `${String(k)}→${String(k + 1)}`), el('span', {}, WHY[k - 1] ?? ''));
    rungs[k - 1] = rung;
    rows.push(rung);
  }
  return el('section', { class: 'card ladder' }, ...rows);
}

/** Build the whole overlay. Returns the nodes and the docks; nothing here is ever rebuilt. */
export function plates(): Plates {
  const steps: HTMLElement[] = [];
  const rungs: HTMLElement[] = [];
  const bytes = el('code', { class: 'bytes' }, '');
  const age = el('b'), opener = el('b'), carrying = el('code', { class: 'state' }, '');
  const verdict = el('p', { class: 'verdict' }, '');
  const migrated = el('b'), refused = el('b'), reasons = el('div', { class: 'reasons' }), worst = el('b');

  const brief = el('section', { class: 'card brief' },
    el('h1', {}, 'MIGRATION'),
    el('p', { class: 'line' }, BRIEF),
    el('p', { class: 'hint' }, HINT));

  const follow = el('section', { class: 'card follow' },
    el('span', { class: 'cap' }, 'the save being followed'),
    bytes,
    el('div', { class: 'rows' },
      el('span', {}, 'written ', age),
      el('span', {}, 'opened by ', opener)),
    el('span', { class: 'cap' }, 'what it is carrying now'),
    carrying,
    verdict);

  const counts = el('section', { class: 'card counts' },
    el('div', { class: 'rows' },
      el('span', {}, 'carried to the top build ', migrated),
      el('span', {}, 'refused, with a reason ', refused)),
    reasons,
    costNode(el('div', { class: 'rows worstrow' }, el('span', {}, 'worst frame / 10s ', worst))));

  return {
    docks: [
      el('div', { class: 'dock dock-left' }, brief, ladder(steps, rungs)),
      el('div', { class: 'dock dock-right' }, follow, counts),
    ],
    steps, rungs, bytes, age, opener, carrying, verdict, migrated, refused, reasons, worst,
  };
}
