import { createAudio, createBed, type SoundDef } from '@latticekit/audio';

const SOUNDS = {
  place: {
    bus: 'sfx',
    minGapMs: 70,
    layers: [
      { wave: 'triangle', hz: 220, toHz: 140, gain: 0.18, hold: 0.12, cutoff: 1400 },
      { wave: 'noise', hz: 0, gain: 0.08, hold: 0.05, cutoff: 2600 },
    ],
  },
  gate: {
    bus: 'sfx',
    minGapMs: 90,
    layers: [
      { wave: 'square', hz: 90, toHz: 70, gain: 0.1, hold: 0.08, cutoff: 700 },
      { wave: 'noise', hz: 0, gain: 0.07, hold: 0.06, cutoff: 1800 },
    ],
  },
  sale: {
    bus: 'sfx',
    minGapMs: 50,
    ladder: { steps: 5, windowMs: 800 },
    layers: [{ wave: 'triangle', hz: 620, toHz: 880, gain: 0.14, hold: 0.09, cutoff: 3000 }],
  },
  deny: {
    bus: 'ui',
    minGapMs: 140,
    layers: [{ wave: 'square', hz: 130, gain: 0.07, hold: 0.08, cutoff: 800 }],
  },
  bell: {
    bus: 'ui',
    minGapMs: 800,
    layers: [
      { wave: 'sine', hz: 660, toHz: 640, gain: 0.16, hold: 0.55, cutoff: 2400 },
      { wave: 'sine', hz: 990, gain: 0.08, hold: 0.35, cutoff: 2800, delay: 0.04 },
    ],
  },
} satisfies Record<string, SoundDef>;

export const audio = createAudio({ sounds: SOUNDS });
audio.mixer.setGain('master', 0.62);

export const bed = createBed(audio, [
  { wave: 'sine', hz: 52, gain: 0.12, cutoff: 200, cutoffAtFull: 1.15 },
  { wave: 'noise', hz: 0, gain: 0.07, cutoff: 380, cutoffAtFull: 3.4, band: [0, 0.6] },
  { wave: 'sine', hz: 110, gain: 0.05, cutoff: 420, cutoffAtFull: 1.8, band: [0.4, 1] },
], { bus: 'music', sagTo: 0.82 });

export function unlockAudio(): void {
  audio.unlock();
}
