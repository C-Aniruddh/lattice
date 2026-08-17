/**
 * The per-frame paths, measured.
 *
 * A HUD gets one budget: **8 ms is the whole frame** and the overlay is not the thing the player
 * came for. What is benchmarked here is exactly what runs sixty times a second in a real game —
 * the two cadence dispatches, a roll's paint step, a burst of floats, and a palette push — and
 * the numbers are in `packages/ui/README.md` beside the frame they have to fit inside.
 *
 * Everything else in this package runs on a tap or on a message and is not timed.
 */

import { bench, describe } from 'vitest';
import { DAY, NIGHT, lerpPalette } from '@latticekit/draw';
import { createCadence } from '../src/cadence.js';
import { el, setText } from '../src/el.js';
import { createOverlay } from '../src/overlay.js';
import { floats, roll } from '../src/roll.js';
import { applyPalette } from '../src/theme.js';
import { fakeClock, installDom } from './dom.js';

installDom();
const clock = fakeClock(0);
const ui = createOverlay({ now: clock.now });

describe('cadence', () => {
  const cadence = createCadence('bench');
  for (let i = 0; i < 32; i++) cadence.add(() => undefined);
  let t = 0;

  bench('dispatch 32 subscribers', () => {
    cadence.run((t += 16));
  });
});

describe('el', () => {
  const node = el('span');
  let value = 0;

  bench('setText, unchanged — the 37 fields it replaced', () => {
    setText(node, 'Gold 1,240');
  });

  bench('setText, changed', () => {
    setText(node, `Gold ${String((value += 1))}`);
  });
});

describe('roll', () => {
  const gold = roll(ui);
  let t = 0;

  bench('paint step, mid-roll', () => {
    t += 16;
    gold.set(t);
    ui.repaint(t);
  });
});

describe('floats', () => {
  const host = floats(ui, { capacity: 24 });
  let t = 0;

  bench('spawn — the hot path in a collect-and-spend game', () => {
    host.spawn(120, 48, '+120', 'gain');
  });

  bench('expire 24 from the state cadence', () => {
    ui.tick((t += 2000));
  });
});

describe('theme', () => {
  const dusk = lerpPalette(DAY, NIGHT, 0.5);
  const midnight = lerpPalette(DAY, NIGHT, 1);
  let flip = false;

  bench('applyPalette, unchanged — the guard that makes a dusk free', () => {
    applyPalette(ui, dusk);
  });

  bench('applyPalette, every key changed', () => {
    flip = !flip;
    applyPalette(ui, flip ? midnight : dusk);
  });
});
