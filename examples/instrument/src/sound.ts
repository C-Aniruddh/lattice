/**
 * The recipes. Every sound the hall can make, and the bed it sits in.
 *
 * @art
 *
 * `docs/GALLERY.md` settles this classification by name — synthesis is art; the zero-asset
 * rule is the only reason it is code. Delete this file and the hall still knows which pipe
 * was tapped and still draws a waveform from the last `VoicePlan`; it simply has no voice.
 *
 * Twelve steps × five waves is sixty ids on purpose. `minGapMs` is keyed on the sound id, so
 * two pipes that shared one id would be two plays of the same sound in the same instant and
 * one of them would be thrown away. That is right for a collect-all button and wrong for a
 * board. The table is generated so a reader can see the rule rather than sixty copies of it.
 *
 * Partials are exact small-integer ratios (`f * 2`). Intervals walk `SEMITONE` by multiply,
 * never `pow` — a detune that is not a semitone sounds like a fault rather than like music.
 */
import { SEMITONE, type BedLayer, type SoundDef, type Wave } from '@latticekit/audio';
import { STEPS, WAVES } from './board.js';

const PREFIX: Record<(typeof WAVES)[number], string> = {
  sine: 'si',
  triangle: 'tr',
  square: 'sq',
  sawtooth: 'sw',
  noise: 'nz',
};

/** A2. High enough that a laptop speaker can find it, low enough that a hall can rumble. */
const ROOT_HZ = 110;

function hzOf(step: number): number {
  let hz = ROOT_HZ;
  for (let i = 0; i < step; i += 1) hz *= SEMITONE;
  return hz;
}

function recipe(wave: Wave, hz: number): SoundDef {
  if (wave === 'noise') {
    return {
      bus: 'sfx',
      minGapMs: 70,
      spatial: true,
      layers: [
        { wave: 'noise', hz: 0, gain: 0.1, hold: 0.22, highpass: 1800, cutoff: 7000 },
        { wave: 'triangle', hz, gain: 0.045, hold: 0.18, cutoff: 2400 },
      ],
    };
  }
  const hold = wave === 'sine' ? 1.35 : wave === 'triangle' ? 0.95 : 0.55;
  const cut = wave === 'sine' ? 2200 : wave === 'triangle' ? 2800 : wave === 'square' ? 1400 : 3600;
  const body = wave === 'sine' ? 0.13 : 0.1;
  return {
    bus: 'sfx',
    minGapMs: 55,
    spatial: true,
    layers: [
      { wave, hz, gain: body, hold, cutoff: cut },
      { wave: 'sine', hz: hz * 2, gain: 0.04, hold: hold * 0.45, cutoff: cut + 800, delay: 0.012 },
    ],
  };
}

function table(): Record<string, SoundDef> {
  const out: Record<string, SoundDef> = {
    /**
     * The first gesture, made audible. Nothing exists before `unlock()`, so the moment a
     * context appears has to sound like a room opening or a visitor cannot tell whether
     * their tap worked.
     */
    wake: {
      bus: 'sfx',
      minGapMs: 800,
      layers: [
        { wave: 'sine', hz: 55, toHz: 110, gain: 0.15, hold: 2.4, attack: 0.45, cutoff: 700 },
        { wave: 'triangle', hz: 220, gain: 0.05, hold: 1.6, attack: 0.3, cutoff: 1800, delay: 0.08 },
      ],
    },
  };
  for (const wave of WAVES) {
    for (let step = 0; step < STEPS; step += 1) {
      out[`${PREFIX[wave]}${String(step)}`] = recipe(wave, hzOf(step));
    }
  }
  return out;
}

export const SOUNDS = table();

/**
 * The hall itself, on the **music** bus, so a duck under a struck pipe does not silence the
 * room with the note. Two sines a third of a hertz apart beat; noise is air; the triangle
 * arrives only once the board has been touched.
 */
export const BED: readonly BedLayer[] = [
  { wave: 'sine', hz: 55, gain: 0.09, cutoff: 200, cutoffAtFull: 1.6 },
  { wave: 'sine', hz: 55, beat: 0.31, gain: 0.07, cutoff: 220, cutoffAtFull: 1.5 },
  { wave: 'noise', hz: 0, gain: 0.05, cutoff: 280, cutoffAtFull: 4.2, band: [0, 0.62] },
  { wave: 'triangle', hz: 110, gain: 0.035, cutoff: 480, cutoffAtFull: 2.2, band: [0.38, 1] },
];
