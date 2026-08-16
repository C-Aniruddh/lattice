import { bench, describe } from 'vitest';

import { createBed, type BedLayer } from '../src/bed.js';
import { createAudio } from '../src/engine.js';
import { createDeck, type Song } from '../src/music.js';
import type { SoundDef } from '../src/sounds.js';

/**
 * The three paths that run per frame or per entity.
 *
 * `bed.set` is the sharpest of them: a game calls it from the render loop with numbers it
 * already has, sixty times a second, forever. `play` is per entity in a burst — COLLECT ALL is
 * twenty calls in one millisecond. `pump` is only eight times a second, but it is the one that
 * allocates if the plan object is ever replaced by a fresh literal.
 *
 * All three are measured with **no device**, which is the honest measurement of the policy
 * layer: the renderer's cost is WebAudio's, and it is not this package's to optimize.
 */

const TABLE: Record<string, SoundDef> = {
  collect: {
    minGapMs: 45,
    ladder: { steps: 5, windowMs: 900 },
    layers: [
      { wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 },
      { wave: 'sine', hz: 1320, gain: 0.05, hold: 0.06, cutoff: 4000 },
    ],
  },
};

const VALLEY: readonly BedLayer[] = [
  { wave: 'sine', hz: 50, gain: 0.16, cutoff: 220, cutoffAtFull: 1.2 },
  { wave: 'noise', hz: 0, gain: 0.1, cutoff: 320, cutoffAtFull: 4.2 },
  { wave: 'sawtooth', hz: 100, gain: 0.035, cutoff: 400, cutoffAtFull: 2.4 },
  { wave: 'sawtooth', hz: 100, gain: 0.035, cutoff: 400, cutoffAtFull: 2.4, beat: 0.7 },
  { wave: 'triangle', hz: 3150, gain: 0.012, cutoff: 6000, band: [0.4, 1] },
];

const THEME: Song = {
  bpm: 112,
  steps: 16,
  rootHz: 55,
  progression: [3, 10, 0, 8],
  seed: 7,
  tracks: [
    {
      id: 'bass',
      melodic: true,
      voice: { wave: 'triangle', gain: 0.06, hold: 0.34, cutoff: 420 },
      notes: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 11 }, { step: 14 }],
    },
    {
      id: 'kick',
      voice: { wave: 'sine', gain: 0.16, hold: 0.16, sweepTo: 0.35, fixedHz: 125 },
      notes: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }],
    },
    {
      id: 'hat',
      drop: 0.15,
      voice: { wave: 'noise', gain: 0.035, hold: 0.055, highpass: 7200 },
      notes: [{ step: 2 }, { step: 6 }, { step: 10 }, { step: 14 }],
    },
  ],
};

let clock = 0;
const audio = createAudio({ sounds: TABLE, context: () => null, now: () => clock });
const bed = createBed(audio, VALLEY);
const deck = createDeck(audio, { autoPump: false });
deck.play(THEME, { fadeSec: 0 });

describe('the per-frame paths', () => {
  bench('bed.set with new figures every frame', () => {
    clock += 1 / 60;
    bed.set((clock % 60) / 60, ((clock * 2) % 60) / 60);
  });

  bench('bed.set with unchanged figures — the case that must cost nothing', () => {
    bed.set(0.5, 0.5);
  });

  bench('play, accepted', () => {
    clock += 0.1;
    audio.play('collect');
  });

  bench('play, thrown away by the throttle', () => {
    audio.play('collect');
  });

  bench('deck.pump across one step of a four-bar song', () => {
    clock += 60 / 112 / 4;
    deck.pump();
  });
});
