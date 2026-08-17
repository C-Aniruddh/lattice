/**
 * The overlay — **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule.**
 *
 * There is no canvas text anywhere in this exhibit. That is worth saying rather than assuming,
 * because an island with a clock on it is exactly the shape of exhibit that would have drawn the
 * clock into the Overlay pass with `screenText` and never noticed: it is four lines, it is right
 * there, and it is wrong for four reasons this file gets for free.
 *
 * | | canvas text | `ui` |
 * |---|---|---|
 * | the clock ticking | jumps between two strings | {@link roll} eases, and is *correct* if no frame paints |
 * | the skip control | a rectangle you hit-test yourself | a `<button>`, with focus, hover and a real pressed state |
 * | a hidden tab | freezes with the canvas, showing a stale hour | `ui.every` runs on the loop's **update**, so it is never wrong |
 * | the type | one font, one weight, one size | letter-spacing, tabular numerals, a stylesheet |
 *
 * ## The worst frame, and why it is on screen rather than in a report
 *
 * `docs/GALLERY.md` § Scale makes 60 fps a gate rather than a trade, and it makes the *worst*
 * frame the number that decides it — an average of 16 ms with every eighth frame at 40 ms is a
 * visible stutter wearing a healthy number. So the readout is here, beside the clock, in the same
 * overlay as everything else a visitor reads, and it is labelled with what it actually measures:
 * the longest gap between two painted frames, not the cost of the work inside one. `main.ts` owns
 * the window and the subtraction, because both need the loop's clock and neither is a reading a
 * HUD should be doing for itself.
 *
 * ## The cross-package promise this file executes
 *
 * `draw` exports `paletteVars`, `ui` exports `applyPalette`, and putting the two together is what
 * makes the overlay darken with the island instead of glowing in daylight colors over a night
 * scene. It is pushed on the **state** cadence and guarded on `palette.rev`, because a custom
 * property written on the root invalidates style for every node under it — pushing an unchanged
 * palette sixty times a second is sixty full subtree recalculations to animate a color a viewer
 * reads over ninety seconds.
 *
 * **This module owns no stylesheet.** `ui` ships none by design and neither does this file; every
 * color, radius and cut corner is in `index.html`, reading the custom properties written here.
 * That seam is the whole reason the package can be dropped into a game whose art direction was
 * decided first.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, setText, type Overlay } from '@latticekit/ui';
import { mountChrome } from './overlay.js';

/** What the exhibit tells the overlay, once per update. A pull, not a push, so there is exactly
 *  one place the HUD can be a frame behind the world and it is the `read` call. */
export interface Hud {
  /** 0 at first light, wrapping at 1. */
  readonly phase: number;
  readonly daylight: number;
  /**
   * Minutes since the exhibit opened, **monotonic and never wrapped**.
   *
   * This is the one shape decision in the file and it is `roll`'s. A roll eases toward whatever
   * it is set to, so handing it a value that wraps from 1439 back to 0 at first light animates
   * the clock *backwards through the entire day* over the roll's duration, once per cycle, on
   * the one frame nobody is expecting it. Counting up for ever and taking the modulo inside the
   * formatter costs nothing and cannot do that.
   */
  readonly minutes: number;
  /**
   * The longest **frame-to-frame interval** in the last ten seconds, in milliseconds.
   *
   * Not an average, which is the number that hides a stutter, and not the loop's own
   * `worstFrameMs`, which is the pump's wall time and cannot see a pause that lands between two
   * pumps. `main.ts` has the table of what each of those got wrong. At 60 Hz a healthy reading is
   * about 17 ms; past 20 a frame was dropped.
   */
  readonly worstMs: number;
}

export interface HudOptions {
  /** The world's live palette. Read on the state cadence and pushed to the DOM; never mutated. */
  readonly palette: WorldPalette;
  readonly read: () => Hud;
  /** Half a cycle forward. The one control, and it exists so a viewer who will not wait
   *  forty-five seconds for the other half of the idea does not have to. */
  readonly onSkip: () => void;
  /** Milliseconds, and it must be the clock `@latticekit/loop` was given. Two clocks in one HUD is a
   *  poll racing a settle. */
  readonly now: () => number;
}

/** Hand `ui` to `drive(view.ui, boot)`; the overlay owns no clock until you do. */
export interface HudView {
  readonly ui: Overlay;
  destroy(): void;
}

/** The eight names the ninety seconds are divided into. Eight rather than four, so the label
 *  changes about every eleven seconds and a viewer can tell the clock is running. */
const HOURS = ['FIRST LIGHT', 'MORNING', 'NOON', 'AFTERNOON', 'GOLDEN HOUR', 'DUSK', 'NIGHTFALL', 'SMALL HOURS'];

/** Elapsed minutes as a wall clock. First light is 05:30, which puts noon at the top of the arc. */
function hhmm(minutes: number): string {
  const at = (minutes + 330) % 1440;
  const h = Math.floor(at / 60);
  return `${h < 10 ? '0' : ''}${String(h)}:${at % 60 < 10 ? '0' : ''}${String(Math.floor(at % 60))}`;
}

export function createHud(opts: HudOptions): HudView {
  const ui = createOverlay({ now: opts.now });
  const { clock, hour, arc, perf, card } = mountChrome(ui, hhmm, opts.onSkip);

  let paletteRev = -1;
  const stopPalette: Disposer = ui.every(() => {
    if (opts.palette.rev !== paletteRev) { paletteRev = opts.palette.rev; applyPalette(ui, paletteVars(opts.palette)); }
  });

  const stopState: Disposer = ui.every(() => {
    const h = opts.read();
    clock.set(h.minutes);
    setText(hour, HOURS[Math.floor(h.phase * HOURS.length) % HOURS.length] ?? 'NIGHT');
    setText(perf, `SLOWEST FRAME 10s ${h.worstMs.toFixed(1)}ms`);
    arc.style.setProperty('--sun', h.daylight.toFixed(3));
    card.dataset['night'] = h.daylight < 0.42 ? '1' : '0';
  });

  return { ui, destroy: () => { stopState(); stopPalette(); ui.destroy(); } };
}
