/**
 * The instrument: six strings, six answering tones, three events, and the cave's own bed.
 *
 * @art
 *
 * `docs/GALLERY.md` settles this classification by name — *"four recipes and a bed. Synthesis is
 * art; the zero-asset rule is the only reason it is code."* Delete this file and the puzzle still
 * exists, still knows which chord opens which gate, and still knows whether you answered it; it
 * simply has no voice. **What** the intervals are is `puzzle.ts` and is logic. **How** a string
 * sounds when it is struck is here, and is not.
 *
 * ## Why there are twelve sound ids and not two with a detune
 *
 * `PlayOptions.detune` would give six pitches from one recipe — and `minGapMs` would then throw
 * five of them away. The throttle is keyed on the sound **id**, so six strings sharing one id are
 * six plays of the same sound in the same millisecond, which is precisely the burst the throttle
 * exists to refuse. That is the right call for a COLLECT ALL button and the wrong one for a
 * chord, and the package has no way to tell them apart, so a chord has to be spelled as *n*
 * different sounds. It is filed as a finding in this exhibit's README; the table below is what
 * living with it looks like, and it is honestly not bad — twelve rows a reader can scan.
 *
 * ## The two shapes, and the one number that separates them
 *
 * A **string** is plucked: the package's default `ATTACK_SEC` of 6 ms, a triangle for the body
 * and a short sine octave for the pick. A **tone** — what a gate hums back — swells over 70 ms
 * and holds. That difference is the whole reason the two are never confused for one another
 * while both are sounding, and it is one field.
 *
 * Every partial is an exact small-integer ratio of the fundamental (`f * 2`, `f * 3`), so the
 * timbre is built by multiplying — Tier A — and the only equal-tempered arithmetic in the exhibit
 * is `puzzle.ts`'s one loop.
 */
import { SEMITONE, type BedLayer, type SoundDef } from '@latticekit/audio';
import { STRINGS } from './puzzle.js';

/**
 * The lowest string, in Hz — A3.
 *
 * An octave above where a cave drone wants to sit, deliberately: the bed lives under 120 Hz and
 * the puzzle has to stay legible *over* it on a laptop speaker, which reproduces almost nothing
 * below 200 Hz. A puzzle pitched into the bed's own register is one only headphones can hear.
 */
const ROOT_HZ = 220;

/**
 * Semitones above the root, per string: A C D E G A′ — the minor pentatonic and its octave.
 *
 * Pentatonic on purpose. All twenty three-string chords over it are consonant, so a wrong answer
 * never *sounds* wrong — it simply is not the one the gate asked for. A scale with a tritone in it
 * would let a player rule combinations out by taste rather than by ear, which is an easier game.
 */
const STEPS: readonly number[] = [0, 3, 5, 7, 10, 12];

/**
 * The frequency of a scale step, by repeated multiplication rather than by `pow`. **Tier A.**
 *
 * `SEMITONE` is the twelfth root of two, written out as a literal by `@latticekit/audio` precisely so
 * that a game need not call `pow` — which ECMA-262 does not require to be correctly rounded, and
 * which `AGENTS.md` therefore files under Tier B. This walks the interval a semitone at a time
 * with `*`, which is exactly specified and bit-identical on every engine.
 *
 * That is not pedantry *here*. A gate that hums a minor third and opens for something merely near
 * it is the whole exhibit failing quietly, and the failure is inaudible from inside: a player
 * hears two pitches that are close, cannot say why one is wrong, and blames their ear. Exact
 * intervals are what makes "answer it by ear" an honest instruction. `STEPS` tops out at 12, so
 * this is at most twelve multiplies, six times, once at module load.
 */
function hzOf(step: number): number {
  let hz = ROOT_HZ;
  for (let i = 0; i < step; i += 1) hz *= SEMITONE;
  return hz;
}

/** The six pitches, measured once at module load rather than once per play. */
const HZ: readonly number[] = STEPS.slice(0, STRINGS).map((step) => hzOf(step));

const at = (index: number): number => HZ[index] ?? ROOT_HZ;

/**
 * A string you strike: a triangle body and a sine octave that is gone before the body is.
 *
 * The gap is 55 ms, which is *shorter* than a comfortable tremolo and far longer than the double
 * event a touchscreen sends for one tap. It is per string, so it never stands between two
 * different strings struck together.
 */
function string(index: number): SoundDef {
  const f = at(index);
  return {
    bus: 'sfx',
    minGapMs: 55,
    layers: [
      { wave: 'triangle', hz: f, gain: 0.105, hold: 1.15, cutoff: 2400 },
      { wave: 'sine', hz: f * 2, gain: 0.045, hold: 0.28, cutoff: 5200 },
    ],
  };
}

/**
 * A tone a gate hums: a swelling sine with a soft octave over it, and it pans.
 *
 * `spatial` is on so `PlayOptions.pan` is honoured — the game computes screen-x → pan itself from
 * `camera.normalizedX`, because `audio` is layer 1 and deliberately does not know `iso` exists.
 * Hearing which side of you a gate is on is half of navigating by ear.
 */
function tone(index: number): SoundDef {
  const f = at(index);
  return {
    bus: 'sfx',
    minGapMs: 40,
    spatial: true,
    layers: [
      { wave: 'sine', hz: f, gain: 0.125, hold: 1.4, attack: 0.07, cutoff: 1500 },
      { wave: 'sine', hz: f * 2, gain: 0.05, hold: 0.95, attack: 0.12, cutoff: 2600 },
    ],
  };
}

/**
 * The table. Twelve rows for the instrument and three for the events.
 *
 * The keys **are** the id union — `play('s7')` does not compile — so `STRING_IDS` and `TONE_IDS`
 * below are the only place an index becomes a name, and they are tuples so that `play(TONE_IDS[i])`
 * stays typed instead of widening to `string`.
 */
export const SOUNDS = {
  s0: string(0),
  s1: string(1),
  s2: string(2),
  s3: string(3),
  s4: string(4),
  s5: string(5),
  g0: tone(0),
  g1: tone(1),
  g2: tone(2),
  g3: tone(3),
  g4: tone(4),
  g5: tone(5),

  /** A gate giving way: a fifth swelling upward, a bell, and the dust coming off the hinge. */
  open: {
    bus: 'sfx',
    minGapMs: 400,
    layers: [
      { wave: 'sine', hz: 110, toHz: 220, gain: 0.17, hold: 2, attack: 0.02, cutoff: 900 },
      { wave: 'triangle', hz: 440, toHz: 660, gain: 0.085, hold: 1.5, attack: 0.05, cutoff: 3400, delay: 0.06 },
      { wave: 'noise', hz: 0, gain: 0.07, hold: 0.9, attack: 0.04, highpass: 1600, cutoff: 9000, delay: 0.02 },
    ],
  },

  /**
   * A wrong answer: a dull knock in the rock, deliberately unmusical and deliberately quiet.
   *
   * Its 260 ms gap is doing real work. A player mashing all six strings against a three-string
   * gate gives four wrong answers in half a second, and four knocks would read as a fault in the
   * exhibit rather than as four wrong answers. One knock is the honest summary.
   */
  refuse: {
    bus: 'sfx',
    minGapMs: 260,
    layers: [
      { wave: 'sine', hz: 78, toHz: 52, gain: 0.13, hold: 0.24, cutoff: 320 },
      { wave: 'noise', hz: 0, gain: 0.05, hold: 0.1, cutoff: 700 },
    ],
  },

  /**
   * The first gesture, made audible.
   *
   * Nothing exists before `unlock()`, so the moment a context appears has to sound like
   * something or a visitor cannot tell whether their tap worked, whether their machine is muted,
   * or whether the exhibit is broken. Half a second of attack, so it is a room opening rather
   * than a notification.
   */
  wake: {
    bus: 'sfx',
    minGapMs: 1000,
    layers: [
      { wave: 'sine', hz: 55, toHz: 110, gain: 0.16, hold: 2.8, attack: 0.5, cutoff: 700 },
      { wave: 'noise', hz: 0, gain: 0.06, hold: 2.4, attack: 0.9, highpass: 180, cutoff: 900 },
    ],
  },
} satisfies Record<string, SoundDef>;

/** Index → the id of the string at that index. A tuple, so the element type stays a literal. */
export const STRING_IDS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const;
/** Index → the id of the tone a gate hums for that string. */
export const TONE_IDS = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] as const;

/**
 * The cave itself, as four continuous layers on the **music** bus.
 *
 * `createBed` defaults to `sfx` — correct in general, because a player muting music should not
 * silence the world. It is wrong here, and the reason is the one thing `docs/GALLERY.md` asks
 * this exhibit for that a sound board never asks of a mixer: **the bed has to duck under the
 * puzzle tones.** A duck is a gain move on a bus, so the bed must be on a bus the puzzle is not,
 * or ducking the bed ducks the answer with it.
 *
 * The four layers:
 *
 * | | why |
 * |---|---|
 * | two sines a third of a hertz apart | they beat, slowly, and that beat is the difference between a cave and a synthesizer pad |
 * | noise banded low | air moving in a closed system. It fades out as the cave opens |
 * | a triangle banded high | the cave's own resonance, arriving only once you have opened it |
 *
 * The bands overlap at 0.38–0.62 and the two sines are unbanded, so there is no value of `tone`
 * at which the bed goes quiet — a hole in the middle of the range is one a player walks into and
 * reads as the sound having broken.
 */
export const BED: readonly BedLayer[] = [
  { wave: 'sine', hz: 41.2, gain: 0.1, cutoff: 180, cutoffAtFull: 1.7 },
  { wave: 'sine', hz: 41.2, beat: 0.33, gain: 0.08, cutoff: 200, cutoffAtFull: 1.5 },
  { wave: 'noise', hz: 0, gain: 0.075, cutoff: 240, cutoffAtFull: 5, band: [0, 0.62] },
  { wave: 'triangle', hz: 110, gain: 0.04, cutoff: 420, cutoffAtFull: 2.6, band: [0.38, 1] },
];
