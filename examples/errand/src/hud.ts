/**
 * The overlay's *behavior* — **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a
 * rule**, and this exhibit is that rule's hardest case: a dialog box is the thing an author is most
 * tempted to draw into the canvas with four lines of `screenText`.
 *
 * It was never tempting, and the reason is worth writing down for whoever reads this next:
 *
 * | | `screenText` in the Overlay pass | `@latticekit/ui` |
 * |---|---|---|
 * | a paragraph of dialog | you write the line-breaking, at every zoom and every window width | the browser does it, and has since 1994 |
 * | two buttons | two rectangles you hit-test yourself, out of the same pointer stream the world is using | two `<button>`s, with focus, hover, a pressed state and Enter |
 * | while the dialog is open | the world still takes taps behind it unless you write the modal yourself | `panel({ modal: true })` — a scrim, a focus trap, Escape |
 * | a keyboard-only visitor | nothing | Tab cycles inside the dialog and cannot leave it |
 * | the save clock in a hidden tab | freezes with the canvas and shows a stale number | `ui.every` runs on the loop's **update**, so it is never wrong |
 *
 * The one thing `ui` does not have is a **choice**, and that is a refusal rather than a gap:
 * `acknowledge` says in as many words that *"two buttons is a choice, not an acknowledgement"* and
 * declines to become a dialog system. So the dialog is `panel` plus `el` directly, which came to
 * nine lines and lives in `cards.ts` — the right amount of work for the thing. Reported as an
 * observation and not a demand; see this exhibit's README.
 *
 * ## The two cross-package promises this file executes
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting them together dyes the
 * overlay out of the same six numbers the barley is painted with. Pushed on the **state** cadence
 * and guarded on `palette.rev`, because a custom property written on the root invalidates style for
 * every node under it.
 *
 * And `persist`'s `StoreStatus` is a *condition* — stable while the condition is — which is what
 * makes it safe to poll at 60 Hz and latch a message on. This is the first exhibit to hold both
 * packages at once, and the seam between them turns out to be exactly one string.
 *
 * **This module owns no stylesheet and builds no nodes.** The structure is `cards.ts` and every
 * color is `index.html`, both of them art; what is here is the reading, the formatting, and the one
 * button that moves the game.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import type { StoreStatus } from '@latticekit/persist';
import { applyPalette, createOverlay, panel, setText, show } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';
import { buildCards } from './cards.js';
import type { SpotKind, Stage } from './errand.js';
import { OBJECTIVES, TROUBLE, speechFor } from './script.js';

/** Everything the exhibit reports to the overlay, once per update. `savedAgo` is `-1` before the
 *  first successful write; `bytes` is the envelope's size, on screen because the whole argument for a
 *  three-number save is that it is small enough to write while somebody watches; `worstMs` is
 *  § Scale's cost row, the worst frame in a rolling ten seconds. */
export interface HudRead { stage: Stage; savedAgo: number; bytes: number; worstMs: number; status: StoreStatus }

/**
 * Build the overlay and drive it.
 *
 * @param read a **pull, not a push**, so there is exactly one place the HUD can be a frame behind
 *   the world and it is this call — and it runs on `ui.every`, which is the loop's *update*, so the
 *   save clock stays right in a tab that is not painting.
 * @param onAct fires when the dialog's acting button is pressed, and is the only way a stage
 *   advances. The returned `say(kind, stage, acts)` takes `acts` from `advance()` and nothing else,
 *   because the HUD never decides whether a conversation has a consequence.
 * @param now must be the clock `@latticekit/loop` was given. Two clocks in one HUD is a poll racing a
 *   settle, which is how a one-shot dialog reopens blank after a confirm.
 */
export function createHud(palette: WorldPalette, now: () => number, onAct: (kind: SpotKind) => void, read: () => HudRead) {
  const ui = createOverlay({ now });
  const sheet = panel(ui, { modal: true, dismissible: true });
  const c = buildCards(ui, sheet);
  costNode(c.costCard);
  let speaking: SpotKind = 'you', paletteRev = -1;
  // The only handler in the overlay that changes anything, and the reason it is here rather than in
  // the module that built the button it is attached to.
  c.act.addEventListener('click', () => { sheet.close(), onAct(speaking); });
  c.leave.addEventListener('click', () => { sheet.close(); });

  const stopPalette: Disposer = ui.every(() => {
    if (palette.rev !== paletteRev) applyPalette(ui, paletteVars(palette)), (paletteRev = palette.rev);
  });
  const stopState: Disposer = ui.every(() => {
    const h = read();
    setText(c.objective, OBJECTIVES[h.stage] ?? ''), show(c.carrying, h.stage === 2), c.ago.set(h.savedAgo);
    setText(c.size, h.bytes > 0 ? `${h.bytes} B` : ''), setText(c.trouble, TROUBLE[h.status] ?? '');
    setText(c.worst, `${h.worstMs.toFixed(1)} ms`), (c.saveCard.dataset['bad'] = h.status === 'ok' ? '0' : '1');
    c.costCard.dataset['bad'] = h.worstMs > 18 ? '1' : '0';
  });

  return {
    ui,
    say(kind: SpotKind, stage: Stage, acts: boolean): void {
      const line = speechFor(kind, stage);
      speaking = kind, setText(c.who, line.who), setText(c.says, line.says);
      setText(c.act, line.act), setText(c.leave, line.leave), show(c.act, acts), sheet.open();
    },
    destroy(): void { stopState(), stopPalette(), ui.destroy(); },
  };
}
