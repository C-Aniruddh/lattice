/**
 * The overlay's reading of the yard — **`@latticekit/ui` over the canvas, because `GALLERY.md`
 * makes it a rule.**
 *
 * This is the exhibit that would otherwise have painted its readout into the canvas without ever
 * noticing: the interesting thing is a *save file*, the interesting rendering of a save file is
 * monospaced text, and `draw.screenText` is right there. It is the wrong answer four times over,
 * and this file gets all four for free.
 *
 * | | canvas text | `ui` |
 * |---|---|---|
 * | ninety characters of envelope JSON | one font, one size, no wrapping, no selection | a `<code>`, wrapped, and a visitor can select the bytes and copy them |
 * | the rung the save is on | a rectangle redrawn every frame | a `data-on` attribute and a CSS transition |
 * | a hidden tab | freezes with the canvas and shows a stale count | `ui.every` runs on the loop's **update** |
 * | the type | one weight, no tabular numerals | `font-variant-numeric`, letter-spacing, a stylesheet |
 *
 * The structure it writes into is `legend.ts`, which is art and uncounted; **this file is the
 * reading of state and is logic**, which is exactly the seam `GALLERY.md` draws between the two.
 *
 * ## The cross-package promise this file executes
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting the two together is what
 * makes the overlay's ink the yard's ink — including `--lattice-bad`, which is the same red the
 * refusal marker on the ground is drawn in. Pushed **once**: this exhibit holds a single hour and
 * nothing mutates the palette, so a `rev` check on every update would be a guard against an event
 * that cannot happen, and a custom property written on the root invalidates style for every node
 * under it.
 *
 * ## What the four states of a step row mean
 *
 * `data-on` is `1` on the deck the followed save is standing on, `-1` on a deck this build does
 * not have, and `0` otherwise. On a rung it is `2` for one already climbed and `1` for the one
 * just crossed, so the card fills in from the bottom as the crate climbs and a visitor watching
 * the yard and a visitor watching the card are watching the same event.
 */
import { asEpochMillis, fmtDuration, type Disposer } from '@latticekit/core';
import { paletteVars, type Palette } from '@latticekit/draw';
import { elapsedSince } from '@latticekit/persist';
import { applyPalette, createOverlay, setText, type Overlay } from '@latticekit/ui';
import { ARCHIVE_NOW, HEAD } from './chain.js';
import type { Yard } from './ladder.js';
import { plates } from './legend.js';

/** `now` must be the clock `@latticekit/loop` was given — `boot.loop.realTime`, never a second
 *  reading of `performance.now()`. Two clocks in one HUD is a poll racing a settle, and the kit
 *  bans the raw call besides. */
export function createHud(palette: Palette, read: () => { readonly yard: Yard; readonly worstMs: number }, now: () => number): { readonly ui: Overlay; destroy(): void } {
  const ui = createOverlay({ now });
  const p = plates();
  for (const dock of p.docks) ui.mount(dock, { layer: 'panels' });
  applyPalette(ui, paletteVars(palette));

  const stop: Disposer = ui.every(() => {
    const { yard, worstMs } = read(), c = yard.focus, at = c.open === null ? 0 : c.k + 1;
    for (let k = 0; k < HEAD; k++) p.steps[k]?.setAttribute('data-on', k + 1 === at ? '1' : k >= yard.top ? '-1' : '0');
    for (let j = 0; j < HEAD - 1; j++) p.rungs[j]?.setAttribute('data-on', j + 2 === at ? '1' : j + 2 < at ? '2' : '0');
    // The envelope, elided in the middle: the head carries the version and the checksum, the tail
    // carries the payload, and the middle is a timestamp a visitor never needs to read.
    setText(p.bytes, c.filed.text.length <= 170 ? c.filed.text : `${c.filed.text.slice(0, 44)} … ${c.filed.text.slice(-118)}`);
    setText(p.age, c.open === null ? '—' : `${fmtDuration(elapsedSince(c.open, asEpochMillis(ARCHIVE_NOW)) / 1000, 'short')} ago`);
    setText(p.opener, at === 0 ? 'nothing yet — still bytes on the archive floor' : `the v${String(at)} build`);
    setText(p.carrying, c.open === null ? '(unread bytes)' : JSON.stringify(c.open.state));
    setText(p.verdict, c.fell > 0 ? c.why : c.open === null ? 'nobody has opened it yet' : c.open.migratedFrom === null ? 'already at this build’s head — nothing to migrate' : `migrated from v${String(c.open.migratedFrom)}, one rung at a time`);
    p.verdict.setAttribute('data-bad', c.fell > 0 ? '1' : '0');
    setText(p.migrated, String(yard.migrated)); setText(p.refused, String(yard.rejected));
    setText(p.reasons, [...yard.tally].map(([why, n]) => `${why} ${String(n)}`).join('   ·   ') || 'nothing refused yet');
    setText(p.worst, `${worstMs.toFixed(1)} ms`); p.worst.setAttribute('data-slow', worstMs > 17 ? '1' : '0');
  });

  return { ui, destroy: () => { stop(); ui.destroy(); } };
}
