/**
 * @art — synthesis is art; the zero-asset rule is the only reason it is code rather than five
 * `.wav` files in a folder nobody counts. Mute the whole module and the economy is unchanged.
 *
 * Four recipes and one bed. No files, and nothing exists until the first tap.
 *
 * The bed's `tone` is the *same* `daylight` number that drives `Palette.lerp` and the light
 * field's darkness, so color and sound cannot drift apart — two schedules would be a valley whose
 * blue and whose crickets disagree, and it gets reported as a lighting bug. The banded layers are
 * what make it a soundscape rather than a hum with a knob on it: a high shimmer that only speaks
 * in daylight, a low one that only speaks after dark, and the same number trading them over.
 */
import { createAudio, createBed, type Audio, type Bed, type BedLayer, type SoundDef } from '@latticekit/audio';

export const SOUNDS = {
  /** The strike: a flint rasp under a rising tone. Laddered, so a run of taps reads as a run. */
  strike: {
    bus: 'sfx',
    minGapMs: 70,
    ladder: { steps: 5, windowMs: 1600 },
    layers: [
      { wave: 'noise', hz: 300, gain: 0.14, hold: 0.06, cutoff: 3000, highpass: 700 },
      { wave: 'triangle', hz: 430, toHz: 780, gain: 0.2, hold: 0.3, cutoff: 2600, attack: 0.02 },
    ],
  },
  /** An offering, dropped in the box at the gate. */
  coin: {
    bus: 'sfx',
    minGapMs: 90,
    ladder: { steps: 4, windowMs: 1400 },
    layers: [{ wave: 'triangle', hz: 940, toHz: 1240, gain: 0.07, hold: 0.11, cutoff: 4200 }],
  },
  /** Not yet: a short, low, unmistakably negative blip on the interface bus. */
  deny: {
    bus: 'ui',
    minGapMs: 160,
    layers: [{ wave: 'square', hz: 190, toHz: 150, gain: 0.06, hold: 0.09, cutoff: 900 }],
  },
  /** The hour turning. Played once at each boundary, so dusk is an event and not just a fade. */
  chime: {
    bus: 'music',
    minGapMs: 4000,
    layers: [
      { wave: 'sine', hz: 294, gain: 0.1, hold: 2.2, cutoff: 2400, attack: 0.4 },
      { wave: 'sine', hz: 441, gain: 0.07, hold: 2.4, cutoff: 2800, attack: 0.6, delay: 0.25 },
      { wave: 'triangle', hz: 588, gain: 0.05, hold: 2.6, cutoff: 3400, attack: 0.8, delay: 0.5 },
    ],
  },
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

const LAYERS: readonly BedLayer[] = [
  { wave: 'sine', hz: 55, gain: 0.05, cutoff: 300, cutoffAtFull: 700, beat: 0.3 },
  { wave: 'noise', hz: 0, gain: 0.045, cutoff: 420, cutoffAtFull: 2400 },
  { wave: 'triangle', hz: 494, gain: 0.022, cutoff: 1800, cutoffAtFull: 4000, band: [0.4, 1] },
  { wave: 'sine', hz: 165, gain: 0.035, cutoff: 700, cutoffAtFull: 1400, band: [0, 0.65], beat: 0.7 },
];

export function createSound(): { audio: Audio<SoundId>; bed: Bed } {
  const audio = createAudio<SoundId>({ sounds: SOUNDS });
  return { audio, bed: createBed(audio, LAYERS, { bus: 'music', sagTo: 0.72, glideSec: 2 }) };
}
