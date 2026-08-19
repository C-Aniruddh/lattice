/**
 * Ten chimes, a minor pentatonic over two octaves.
 *
 * Ten sound ids rather than one sound with a pitch argument, because `minGapMs` is keyed on the
 * id: six strings sharing an id are six plays of the same sound in the same instant and five of
 * them are thrown away. A gust sweeping a run of chimes has to arrive as a chord.
 */
import { SEMITONE } from '@latticekit/audio';
import type { SoundDef } from '@latticekit/audio';

/** A minor: A C D E G, twice. Walked one multiply at a time — never `Math.pow`, which the
 *  language does not require to be correctly rounded, so two engines would tune differently. */
const STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22] as const;
export const NOTE_NAMES = ['A', 'C', 'D', 'E', 'G', 'A′', 'C′', 'D′', 'E′', 'G′'] as const;
export const PITCHES = NOTE_NAMES.length;

function hzOf(semitones: number): number {
  let hz = 220;
  for (let i = 0; i < semitones; i++) hz *= SEMITONE;
  return hz;
}

const HZ: readonly number[] = STEPS.map(hzOf);

/** A struck metal tube: the fundamental, its twelfth as an exact 3:1 partial, and the tick of
 *  the striker. Three layers summing to 0.25, well under the ceiling even four at a time. */
function chime(hz: number, hold: number): SoundDef {
  return {
    bus: 'sfx',
    minGapMs: 90,
    layers: [
      { wave: 'sine', hz, gain: 0.17, hold, attack: 0.007, cutoff: 5200 },
      { wave: 'sine', hz: hz * 3, gain: 0.055, hold: hold * 0.45, attack: 0.005, cutoff: 7000 },
      { wave: 'noise', hz: 0, gain: 0.025, hold: 0.035, highpass: 2600 },
    ],
  };
}

export const SOUNDS = {
  n0: chime(HZ[0] ?? 220, 3.2),
  n1: chime(HZ[1] ?? 220, 3.0),
  n2: chime(HZ[2] ?? 220, 2.9),
  n3: chime(HZ[3] ?? 220, 2.7),
  n4: chime(HZ[4] ?? 220, 2.6),
  n5: chime(HZ[5] ?? 220, 2.4),
  n6: chime(HZ[6] ?? 220, 2.2),
  n7: chime(HZ[7] ?? 220, 2.1),
  n8: chime(HZ[8] ?? 220, 2.0),
  n9: chime(HZ[9] ?? 220, 1.9),
  hang: {
    bus: 'ui',
    minGapMs: 80,
    layers: [
      { wave: 'triangle', hz: 300, toHz: 190, gain: 0.13, hold: 0.1, cutoff: 1600 },
      { wave: 'noise', hz: 0, gain: 0.06, hold: 0.05, highpass: 1200, cutoff: 5000 },
    ],
  },
  deny: {
    bus: 'ui',
    minGapMs: 200,
    layers: [{ wave: 'square', hz: 128, gain: 0.06, hold: 0.08, cutoff: 700 }],
  },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

/** `n0`…`n9`, indexable by a chime's pitch. */
export const NOTE_IDS = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'] as const;
