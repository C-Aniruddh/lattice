/**
 * The overlay's structure: a fixed tree of elements, written once, with fixed labels.
 *
 * @art
 *
 * Delete this file and the exhibit still generates the same coast, still runs the same ninety
 * seconds, and still knows what time it is — it would have nowhere to *say* so. Nothing here holds
 * state that outlives a frame, decides anything, or moves a number.
 *
 * ## Why this is a separate module from `hud.ts`
 *
 * `docs/GALLERY.md` § Static markup is art settles it: **appearance is art, and the reading of
 * state is logic**, and the language the appearance happens to be written in is not the test. A
 * `<span class="hour-name">` is the same declaration whether it is typed into `index.html` or
 * built by `el()`, and neither version tells a visitor anything until something writes `NOON` into
 * it. So the tree lives here beside the stylesheet that colors it, and the two `ui.every` readers
 * that fill it in live in `hud.ts`, which is the seam rule 7 was already asking for.
 *
 * The boundary the same section draws is the one this file is careful about. **It does not decide
 * anything.** `onSkip` is passed in and attached; what half a day forward *means* is `main.ts`'s,
 * and moving that here would be exactly the "decision in an `onclick`" the ruling refuses. And
 * nothing below is generated from data: there is no list whose length the coast chooses and no
 * element that exists only on some seeds. It is the same nine nodes on every frame of every run.
 *
 * **It owns no stylesheet either.** `ui` ships none by design and neither does this file; every
 * color, radius and cut corner is in `index.html`, reading the custom properties `hud.ts` pushes
 * from `draw`'s live palette. That seam is the whole reason the package can be dropped into a
 * game whose art direction was decided first.
 */
import { el, roll, type Overlay, type Roll } from '@lattice/ui';

/** The nodes `hud.ts` writes into, and nothing else. Handing back the whole tree would invite a
 *  reader to go looking for something to restructure, which is the half of this that is logic. */
export interface Chrome {
  /** The wall clock. Eased by `ui`, so it is correct even on a frame that never paints. */
  readonly clock: Roll;
  /** The name of the hour — `NOON`, `NIGHTFALL`. */
  readonly hour: HTMLElement;
  /** The sun's height, as a bar. Driven by the `--sun` custom property. */
  readonly arc: HTMLElement;
  /** The worst frame of the last ten seconds. See `docs/GALLERY.md` § Scale's cost row. */
  readonly perf: HTMLElement;
  /** The clock plate, which carries `data-night` so the orb can become a moon in CSS alone. */
  readonly card: HTMLElement;
}

/** One line, and it is the exhibit's whole pitch. Fixed text, so it is art by the same rule the
 *  `<h1>` above it is. */
const BRIEF = 'A coast, the water off it, and one whole day in ninety seconds. Drag to look, scroll to zoom.';

/**
 * Build the overlay and mount it. Called once.
 *
 * @param format Handed in rather than chosen here, because turning a count of minutes into
 *   `18:51` is a reading of state and belongs to `hud.ts` with the rest of them.
 * @param onSkip Attached, not decided. See the header.
 */
export function mountChrome(ui: Overlay, format: (value: number) => string, onSkip: () => void): Chrome {
  const brief = el(
    'section',
    { class: 'card brief' },
    el('h1', { class: 'brief-title' }, 'ISLAND'),
    el('p', { class: 'brief-line' }, BRIEF),
  );

  const clock = roll(ui, { format });
  const hour = el('span', { class: 'hour-name' });
  const arc = el('div', { class: 'arc-fill' });
  const perf = el('span', { class: 'perf' });
  const card = el(
    'section',
    { class: 'card clock' },
    el('span', { class: 'clock-orb' }),
    el('div', { class: 'clock-body' }, clock.node, hour, el('div', { class: 'arc-track' }, arc), perf),
  );

  // The one interactive node in the whole overlay. Everything else is `pointer-events: none`,
  // which is `ui`'s most important decision: a drag that is not on a node you named reaches the
  // world, and the world is what this exhibit is.
  const skip = el('button', { class: 'skip', type: 'button', onclick: onSkip }, 'Skip half a day');

  ui.mount(el('div', { class: 'dock dock-left' }, brief), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-right' }, card), { layer: 'panels' });
  ui.mount(el('div', { class: 'dock dock-foot' }, skip), { layer: 'panels', interactive: true });

  return { clock, hour, arc, perf, card };
}
