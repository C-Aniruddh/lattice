/**
 * The overlay — **`@latticekit/ui` over the canvas, because `docs/GALLERY.md` makes it a rule**, and
 * because in this exhibit the strings are the instrument and an instrument wants real buttons.
 *
 * There is no canvas text anywhere here. Worth saying rather than assuming: six labelled pads
 * along the bottom of a screen is exactly the shape that gets drawn into the Overlay pass with
 * `screenText` and a hand-rolled hit test, and it is wrong for four reasons this file gets free —
 * a focus ring, a real pressed state, keyboard operation, and a flash that is a CSS animation on
 * the compositor rather than a number the render loop has to decay.
 *
 * ## The structure is markup and only the wiring is here
 *
 * The tree lives in `index.html`; this module adopts it, mounts it into `ui`'s own layers, and
 * thereafter writes three strings and toggles two attributes. That is the seam `ui` exists for —
 * it ships no stylesheet and no components on purpose — and it is the honest place for a HUD whose
 * entire dynamic surface is three readouts and a class. **It is also a hole in the line rule**,
 * which counts a `<style>` block as art and markup as nothing at all, and this exhibit's README
 * reports that rather than quietly banking it.
 *
 * ## The first frame has to say that it is silent on purpose
 *
 * Nothing exists before `Audio.unlock()`, and `@latticekit/audio` deliberately installs no listener of
 * its own. A visitor therefore arrives at a dark cave that makes no sound, which is
 * indistinguishable from a broken exhibit unless something says otherwise. {@link HudState.woke}
 * drives one pulsing line that is on screen until the first gesture and gone after it, and the
 * strings are visibly asleep until then. A line and not a modal: the world is the pitch, and a
 * scrim over it is the splash screen `docs/GALLERY.md` forbids in its first paragraph.
 *
 * The second half of that honesty is {@link HudState.hearing}, which is `Audio.available` and not
 * "did `play` return true". They are different questions, and this exhibit is unplayable if the
 * second is yes and the first is no, so it says so in the same place.
 */
import type { Disposer } from '@latticekit/core';
import { paletteVars, type Palette as WorldPalette } from '@latticekit/draw';
import { applyPalette, createOverlay, pulse, setText, show, type Overlay } from '@latticekit/ui';
import { costNode } from '../../_shared/src/index.js';

/**
 * What the exhibit tells the overlay once per update — a **pull**, so there is exactly one place
 * the HUD can be a frame behind the world and it is the `read` call.
 *
 * `woke` is "has a gesture built the `AudioContext`"; `hearing` is `Audio.available`, which is
 * "did a speaker actually move". They are different questions and `play` returning true is
 * emphatically neither. `size` is how many strings the gate in reach wants, or 0 when none is in
 * reach, and `worstMs` is the worst frame of the last ten seconds — never the average.
 */
export interface HudState {
  readonly woke: boolean; readonly hearing: boolean; readonly size: number;
  readonly opened: number; readonly worstMs: number;
}

/** The palette is the world's live one, pushed to the DOM and never mutated here; `now` is
 *  milliseconds and must be the clock `@latticekit/loop` was given, or the overlay's cadence is a
 *  second clock racing the first. */
export interface HudOptions {
  readonly palette: WorldPalette; readonly total: number; readonly now: () => number;
  readonly read: () => HudState;
  readonly onString: (index: number) => void; readonly onHum: () => void;
}

/** `flash` is called from `Audio.onScheduled`, so a lit string is a voice that really was
 *  scheduled rather than a guess that one was. */
export interface HudView {
  readonly ui: Overlay; flash(index: number): void; destroy(): void;
}

/** A node `index.html` promises, or a refusal that names which one is missing. */
function pick(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (node instanceof HTMLElement) return node;
  throw new Error(`resonance/hud: index.html has no ${selector}`);
}

export function createHud(opts: HudOptions): HudView {
  const ui = createOverlay({ now: opts.now }), root = pick(document, '#hud');
  // Everything is read before the docks are mounted, because mounting *moves* them out of `#hud`
  // and a selector run afterwards finds nothing.
  const wake = pick(root, '.wake'), asking = pick(root, '.asking'), gate = pick(root, '.gate');
  const opened = pick(root, '.opened'), worst = costNode(pick(root, '.worst')), rack = pick(root, '.rack');
  const keys = rack.querySelectorAll<HTMLElement>('.string');
  keys.forEach((key, index) => key.addEventListener('click', () => { opts.onString(index); }));
  pick(root, '.again').addEventListener('click', opts.onHum);
  setText(pick(root, '.of'), `/ ${String(opts.total)} gates`); root.removeAttribute('hidden');
  ui.mount(pick(root, '.dock-left'), { layer: 'panels' });
  ui.mount(pick(root, '.dock-right'), { layer: 'panels', interactive: true });
  ui.mount(pick(root, '.dock-foot'), { layer: 'panels', interactive: true });

  // One cadence, and the palette push inside it is guarded on `rev`: a custom property written on
  // the root invalidates style for every node under it, so pushing an unchanged palette sixty
  // times a second is sixty full subtree recalculations to animate a color read over minutes.
  let rev = -1;
  const stop: Disposer = ui.every(() => {
    const s = opts.read();
    if (opts.palette.rev !== rev) { rev = opts.palette.rev; applyPalette(ui, paletteVars(opts.palette)); }
    show(wake, !s.woke);
    setText(opened, String(s.opened));
    setText(worst, `worst ${s.worstMs.toFixed(1)} ms`);
    setText(asking, !s.woke ? 'ASLEEP' : !s.hearing ? 'NO AUDIO DEVICE'
      : s.size === 0 ? 'NO GATE IN REACH' : `${String(s.size)} TONES`);
    gate.dataset['idle'] = s.size === 0 || !s.hearing ? '1' : '0';
    rack.dataset['asleep'] = s.woke ? '0' : '1';
  });

  return { ui, flash: (i) => { pulse(keys[i] ?? rack, 'lit'); }, destroy: () => { stop(); ui.destroy(); } };
}
