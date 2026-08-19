/**
 * The readout: what is hanging, how hard it is blowing, and the phrase the wind is playing.
 *
 * Everything that would be *wrong* if it stopped goes on `every` (the loop's update, which runs
 * in a hidden tab). Nothing goes on `paint`, because nothing here is eased.
 */
import {
  acknowledge,
  applyPalette,
  auditOverlay,
  createOverlay,
  drive,
  el,
  interactive,
  setText,
  toasts,
} from '@latticekit/ui';
import type { Overlay } from '@latticekit/ui';
import { paletteVars } from '@latticekit/draw';
import type { Palette } from '@latticekit/draw';
import type { Loop } from '@latticekit/loop';
import { NOTE_NAMES } from './notes.js';

export interface HudModel {
  readonly count: number;
  readonly gust: number;
  readonly phrase: readonly number[];
  /** Ring energy per chime, in the same order as `phrase`. */
  readonly lit: readonly number[];
  /** Bumped whenever the set of chimes changes shape. */
  readonly version: number;
  readonly hint: string;
  /** What the save layer is doing. `ok` says nothing to the player. */
  readonly storage: 'ok' | 'not-persistent' | 'write-failing' | 'refusing-newer';
}

export function createHud(
  loop: Loop,
  palette: Palette,
  read: () => HudModel,
  onStartOver: () => void,
): { ui: Overlay; destroy: () => void } {
  const now = (): number => loop.realTime * 1000;
  const ui = createOverlay({ now });

  const countV = el('span', { class: 'v' }, '0');
  const gustV = el('span', { class: 'v' }, '0');
  const gustBar = el('i');
  const strip = el('div', { class: 'strip' });
  const hint = el('p', { class: 'hint' }, 'Tap the trail to hang a chime');
  const keys = el('p', { class: 'keys' }, 'drag to walk the ridge · scroll to zoom · space for a gust');
  const clear = interactive(el('button', { class: 'clear', type: 'button' }, 'Take them down'));
  clear.addEventListener('click', onStartOver);

  ui.mount(
    el(
      'div',
      { class: 'hud' },
      interactive(
        el(
          'div',
          { class: 'plate' },
          el('h1', { class: 'title' }, 'Chime Path'),
          el('span', { class: 'k' }, 'Hung'),
          countV,
          el('span', { class: 'k' }, 'Wind'),
          gustV,
          el('div', { class: 'gust' }, gustBar),
          clear,
        ),
      ),
      interactive(strip),
      hint,
      keys,
    ),
  );

  const toast = toasts(ui);
  let pills: HTMLElement[] = [];
  let builtVersion = -1;
  let pushedRev = -1;
  let acknowledged = false;

  // Latched on the CONDITION, never on the rendered text — a message carrying a count changes on
  // every rediscovery and defeats the deduplication it was written for. And the choice between a
  // toast and a modal is not how alarming it sounds, it is what the player loses by missing it:
  // storage that may not persist is a toast, a save that has stopped being written is not.

  ui.every(() => {
    const m = read();
    setText(countV, String(m.count));
    setText(gustV, `${Math.round(m.gust * 100)}%`);
    gustBar.style.width = `${Math.round(m.gust * 100)}%`;

    if (m.version !== builtVersion) {
      builtVersion = m.version;
      strip.replaceChildren();
      pills = [];
      if (m.phrase.length === 0) {
        strip.append(el('span', { class: 'empty' }, 'the path is silent'));
      } else {
        for (const pitch of m.phrase) {
          const pill = el('span', { class: 'note' }, NOTE_NAMES[pitch] ?? '?');
          pills.push(pill);
          strip.append(pill);
        }
      }
    }
    for (let i = 0; i < pills.length; i++) {
      pills[i]?.classList.toggle('lit', (m.lit[i] ?? 0) > 0.12);
    }
    setText(hint, m.hint);
    clear.toggleAttribute('disabled', m.count === 0);

    if (m.storage === 'not-persistent') {
      toast.once('storage-not-persistent', 'This browser may not keep your chimes');
    } else if (m.storage !== 'ok' && !acknowledged) {
      acknowledged = true;
      void acknowledge(ui, {
        title: 'Your chimes are not being saved',
        body:
          m.storage === 'refusing-newer'
            ? 'A newer version of the game saved this path. Everything you hang from now on will be here for this visit only.'
            : 'This browser has stopped accepting saves. Everything you hang from now on will be here for this visit only.',
        confirmText: 'I understand',
      });
    }

    // The palette reaches the HUD from UPDATE. Pushed from render it would stop in a hidden tab
    // and the player would come back to a night world under a noon HUD. `lerp` quantizes, so
    // most of these are no-ops and the guard is what makes that cheap rather than merely safe.
    if (palette.rev !== pushedRev) {
      pushedRev = palette.rev;
      applyPalette(ui, paletteVars(palette));
    }
  });

  // One English sentence per problem. It catches a node granted `auto` by a stylesheet rather
  // than by `interactive()`, and a `transform` or `filter` on a layer, which silently re-parents
  // every fixed descendant.
  if (import.meta.env.DEV) {
    for (const problem of auditOverlay(ui)) console.warn('overlay:', problem);
  }

  const stop = drive(ui, loop);
  return {
    ui,
    destroy: () => {
      stop();
      ui.destroy();
    },
  };
}
