/**
 * **`@browser-only`** — the one switch that hides an exhibit's frame-cost readout, for an
 * embedder and for nobody else.
 *
 * ```html
 * <iframe src="/exhibits/island/?cost=0"></iframe>
 * ```
 *
 * ## Why a switch, and why the default is on
 *
 * `docs/GALLERY.md` § Scale makes the worst frame a **gate every exhibit is judged on**, and that
 * rule earned its place: four exhibits hand-rolled four different meters before `loop` grew one
 * and two of them reported figures that were not true. Nothing here relaxes it. An exhibit opened
 * directly, or run by its author, still prints its cost — that is what `costShown()` returning
 * `true` by default means, and flipping that default would quietly retire the gate.
 *
 * What the switch is for is the *other* reader. **A figure measured on the reader's own machine
 * makes their hardware the argument.** The same eleven exhibits are embedded in the landing page,
 * where a visitor is being shown what the kit can draw, not being asked to audit a frame budget —
 * and `WORST FRAME / 10s 49.2 ms` on a five-year-old laptop is an accusation the page cannot
 * answer. It is evidence during development and a liability in a shop window, so the embedder
 * says which of the two it is and the exhibit believes them.
 *
 * ## Why this lives here rather than in eleven stylesheets
 *
 * The parent page cannot reach into an iframe, and even in the same document the eleven cost
 * readouts are `.card.cost`, `.gauge`, `.worst`, `.cost-row`, `.sub.cost` and a bare `<span>` —
 * eleven bespoke selectors that would rot the first time an exhibit renamed a class. One flag,
 * read once, applied by the exhibit that owns the node, is the version that cannot drift.
 *
 * ## Suppress the cost, and only the cost
 *
 * The walker count, the pool count, the epoch, the depth in feet and the pick error are the
 * exhibits' **subjects** and they stay. So do the two static figures that look like frame costs
 * and are not — `Canyon`'s *one erosion step, 112×112 grid, 0.30 ms* and `Resonance`'s *6 ms
 * attack on a struck string*. Those are measured properties of an algorithm and are the same
 * number on every machine; nothing about them is a claim about the reader's laptop.
 */

import { readParams, type Params } from './params.js';

/**
 * The URL key, named once.
 *
 * `?cost=0` suppresses; `?cost=1`, anything unparseable, and an absent key all leave it on —
 * `Params.bool` already treats a malformed value as "the exhibit as shipped", which is the right
 * answer for a string a stranger pasted.
 */
export const COST_PARAM = 'cost';

/**
 * The resolved answer, remembered.
 *
 * `undefined` until either `bootstrap` publishes its own — see {@link resolveCost} — or the first
 * reader forces a lazy read of the URL. It is a module value rather than a parameter because
 * {@link costText} is called from inside an overlay tick, and re-parsing a query string sixty
 * times a second to answer a question whose input cannot change is an allocation on a hot path.
 */
let shown: boolean | undefined;

/**
 * `bootstrap`'s side of the flag: resolve it against the URL and the exhibit's own default, and
 * publish it so a HUD reads the same value the boot reports.
 *
 * Not exported from `index.ts`. An exhibit passes `showCost` to `bootstrap` and reads it back off
 * `boot.showCost`; this is the seam between those two and has no other caller.
 */
export function resolveCost(params: Params, fallback: boolean): boolean {
  shown = params.bool(COST_PARAM, fallback);
  return shown;
}

/**
 * Should this exhibit print its frame cost?
 *
 * The same boolean `Boot.showCost` reports, which is the point: a HUD asks the flag rather than
 * the address bar, so an exhibit that hard-codes `showCost: false` and an embedder who appends
 * `?cost=0` produce one behavior instead of two. The lazy branch only fires for a caller that ran
 * before any `bootstrap` did, and it reads the same key from the same URL.
 */
export function costShown(): boolean {
  if (shown === undefined) shown = readParams().bool(COST_PARAM, true);
  return shown;
}

/**
 * Mark the node that carries a frame cost, and hide it when the cost is suppressed.
 *
 * Returns its argument so it wraps an `el(...)` call in place — a HUD gains a marker, not a
 * branch. **Hide the node that carries the label too**, not just the number: blanking the value
 * out of `WORST FRAME / 10s 8.7 ms` leaves `WORST FRAME / 10s` sitting in the corner with nothing
 * after it, which is worse than the figure was.
 *
 * An inline `display` rather than the `hidden` attribute, because every one of these nodes is a
 * `.card` or a grid cell with a `display` of its own in the exhibit's stylesheet, and a UA rule
 * for `[hidden]` loses to all of them.
 */
export function costNode<T extends HTMLElement>(node: T): T {
  if (!costShown()) node.style.display = 'none';
  return node;
}

/**
 * The same thing for a cost that is a *clause* rather than a node — `Canyon` prints its epoch,
 * its step count and its frame gap as one sentence, and only the last of the three is a claim
 * about the reader's machine.
 *
 * Returns `text` when the cost is shown and `''` when it is not, so the call sits inside the
 * template literal that already exists.
 */
export function costText(text: string): string {
  return costShown() ? text : '';
}
