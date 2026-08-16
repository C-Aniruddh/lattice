import { describe, expect, it } from 'vitest';

import {
  ATTACK_SEC,
  BUS_NAMES,
  MAX_VOICES,
  RAMP_SEC,
  SEMITONE,
  validateSounds,
  type SoundDef,
} from '../src/sounds.js';

/**
 * A table that is correct in every way, so that each case below can break exactly one thing
 * and the rest of the assertions keep their meaning.
 */
const CLEAN: Record<string, SoundDef> = {
  tap: { bus: 'ui', minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  collect: {
    bus: 'sfx',
    minGapMs: 45,
    ladder: { steps: 5, windowMs: 900 },
    layers: [
      { wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 },
      { wave: 'sine', hz: 1320, gain: 0.05, hold: 0.06, cutoff: 4000 },
    ],
  },
  thunk: { minGapMs: 90, layers: [{ wave: 'noise', hz: 0, gain: 0.13, hold: 0.1, cutoff: 1500 }] },
};

const codes = (table: Record<string, SoundDef>): string[] =>
  validateSounds(table).map((problem) => problem.code);

describe('the shared vocabulary', () => {
  it('names the buses master-first, because master multiplies the rest', () => {
    expect(BUS_NAMES).toEqual(['master', 'music', 'sfx', 'ui']);
  });

  it('is a semitone and not something near one', () => {
    // The twelfth root of two, to within the double that Math.pow would produce. Written as a
    // literal because `pow` is Tier B and two engines may disagree in the last bit, which
    // would stop a ladder assertion being an exact comparison anywhere in the suite.
    expect(Math.abs(SEMITONE ** 12 - 2)).toBeLessThan(1e-15);
    expect(SEMITONE).toBe(1.0594630943592953);
  });

  it('keeps the attack short enough to feel instant and long enough to kill a click', () => {
    // Below ~2 ms the leading edge clicks; above ~20 ms the sound stops landing on the tap.
    expect(ATTACK_SEC).toBeGreaterThan(0.002);
    expect(ATTACK_SEC).toBeLessThan(0.02);
  });

  it('keeps the live-parameter ramp under a frame and over a click', () => {
    // A slider drag at 60 Hz must not out-run the ramp (16.6 ms), and below ~10 ms the click
    // the ramp exists to remove comes back.
    expect(RAMP_SEC).toBeGreaterThanOrEqual(0.01);
    expect(RAMP_SEC).toBeLessThanOrEqual(0.0166);
  });

  it('has a ceiling low enough that a three-layer sound can be played eight times over', () => {
    expect(MAX_VOICES).toBe(24);
  });
});

describe('validateSounds', () => {
  it('returns nothing at all for a clean table', () => {
    expect(validateSounds(CLEAN)).toEqual([]);
  });

  it('reports an empty table as clean rather than as a fault', () => {
    // A game with no sounds yet must boot. Emptiness is a stage, not a mistake.
    expect(validateSounds({})).toEqual([]);
  });

  it('names a chord that sums past full scale, with the number in it', () => {
    const problems = validateSounds({
      chord: {
        minGapMs: 100,
        layers: [
          { wave: 'sine', hz: 440, gain: 0.6, hold: 0.4 },
          { wave: 'sine', hz: 550, gain: 0.64, hold: 0.4 },
        ],
      },
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('clips');
    expect(problems[0]?.sound).toBe('chord');
    expect(problems[0]?.message).toContain('chord peaks at 1.24, ceiling is 0.95');
  });

  it('does not call an arpeggio a chord', () => {
    // Three 0.5 layers that never overlap sum to 1.5 on paper and to 0.5 in the air. A
    // validator that cannot tell the difference is one an author learns to ignore.
    const problems = validateSounds({
      arp: {
        minGapMs: 200,
        layers: [
          { wave: 'triangle', hz: 523.25, gain: 0.5, hold: 0.05 },
          { wave: 'triangle', hz: 659.25, gain: 0.5, hold: 0.05, delay: 0.2 },
          { wave: 'triangle', hz: 783.99, gain: 0.5, hold: 0.05, delay: 0.4 },
        ],
      },
    });
    expect(problems).toEqual([]);
  });

  it('counts layers that overlap by a hair as overlapping', () => {
    // Layer 0 lives for ATTACK_SEC + 0.1; layer 1 starts one millisecond before that ends.
    const overlap = ATTACK_SEC + 0.1 - 0.001;
    expect(
      codes({
        pair: {
          minGapMs: 100,
          layers: [
            { wave: 'sine', hz: 440, gain: 0.6, hold: 0.1 },
            { wave: 'sine', hz: 660, gain: 0.6, hold: 0.1, delay: overlap },
          ],
        },
      }),
    ).toEqual(['clips']);
  });

  it('does not count a layer that starts exactly where another ends', () => {
    const abutting = ATTACK_SEC + 0.1;
    expect(
      codes({
        pair: {
          minGapMs: 100,
          layers: [
            { wave: 'sine', hz: 440, gain: 0.6, hold: 0.1 },
            { wave: 'sine', hz: 660, gain: 0.6, hold: 0.1, delay: abutting },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('rejects a zero throttle, because the author who needs it most is the one who omits it', () => {
    expect(codes({ burst: { minGapMs: 0, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'no-throttle',
    ]);
  });

  it('rejects a negative and a NaN throttle by the same rule', () => {
    expect(codes({ a: { minGapMs: -5, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'no-throttle',
    ]);
    expect(codes({ a: { minGapMs: Number.NaN, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'no-throttle',
    ]);
  });

  it('catches a ladder whose window closes before the next play is allowed', () => {
    const problems = validateSounds({
      step: {
        minGapMs: 900,
        ladder: { steps: 4, windowMs: 400 },
        layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }],
      },
    });
    expect(problems.map((p) => p.code)).toEqual(['ladder-shorter-than-gap']);
    expect(problems[0]?.message).toContain('can never leave step 0');
  });

  it('treats a window exactly equal to the gap as too short — the boundary, not near it', () => {
    expect(
      codes({
        step: {
          minGapMs: 400,
          ladder: { steps: 4, windowMs: 400 },
          layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }],
        },
      }),
    ).toEqual(['ladder-shorter-than-gap']);
  });

  it('rejects a ladder of one step and accepts a ladder of two', () => {
    const one = codes({
      a: { minGapMs: 40, ladder: { steps: 1, windowMs: 900 }, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }] },
    });
    expect(one).toEqual(['ladder-too-short']);
    const two = codes({
      a: { minGapMs: 40, ladder: { steps: 2, windowMs: 900 }, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }] },
    });
    expect(two).toEqual([]);
  });

  it('reports a sound with no layers once and looks no further', () => {
    const problems = validateSounds({ ghost: { minGapMs: 0, layers: [] } });
    // Only 'no-layers': there is no point telling an author their empty sound is also
    // unthrottled.
    expect(problems.map((p) => p.code)).toEqual(['no-layers']);
    expect(problems[0]?.message).toContain('does nothing at all');
  });

  it('catches a layer below the bottom of hearing and one above the top', () => {
    expect(codes({ rumble: { minGapMs: 40, layers: [{ wave: 'sine', hz: 8, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'sub-audio-frequency',
    ]);
    expect(codes({ bat: { minGapMs: 40, layers: [{ wave: 'sine', hz: 24000, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'inaudible',
    ]);
  });

  it('checks the sweep target as well as the starting pitch', () => {
    expect(
      codes({ fall: { minGapMs: 40, layers: [{ wave: 'sine', hz: 440, toHz: 4, gain: 0.2, hold: 0.3 }] } }),
    ).toEqual(['sub-audio-frequency']);
  });

  it('takes 20 Hz exactly as a tone and 19.99 as a rumble', () => {
    expect(codes({ a: { minGapMs: 40, layers: [{ wave: 'sine', hz: 20, gain: 0.2, hold: 0.1 }] } })).toEqual([]);
    expect(codes({ a: { minGapMs: 40, layers: [{ wave: 'sine', hz: 19.99, gain: 0.2, hold: 0.1 }] } })).toEqual([
      'sub-audio-frequency',
    ]);
  });

  it('never complains about the pitch of noise, which has none', () => {
    expect(codes({ air: { minGapMs: 40, layers: [{ wave: 'noise', hz: 0, gain: 0.2, hold: 0.1 }] } })).toEqual([]);
  });

  it('catches a layer nobody can hear and a layer with no decay', () => {
    expect(codes({ a: { minGapMs: 40, layers: [{ wave: 'sine', hz: 440, gain: 0, hold: 0.1 }] } })).toEqual([
      'inaudible',
    ]);
    expect(codes({ a: { minGapMs: 40, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0 }] } })).toEqual([
      'zero-hold',
    ]);
  });

  it('reports a negative gain as inaudible rather than crashing on it', () => {
    expect(codes({ a: { minGapMs: 40, layers: [{ wave: 'sine', hz: 440, gain: -1, hold: 0.1 }] } })).toEqual([
      'inaudible',
    ]);
  });

  it('names the layer index, because a nine-layer sound has nine places to look', () => {
    const problems = validateSounds({
      big: {
        minGapMs: 40,
        layers: [
          { wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 },
          { wave: 'sine', hz: 4, gain: 0.2, hold: 0.1 },
        ],
      },
    });
    expect(problems[0]?.message).toContain('big layer 1');
  });

  it('reports every fault of every sound, not the first', () => {
    expect(
      codes({
        a: { minGapMs: 0, layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0 }] },
        b: { minGapMs: 40, layers: [{ wave: 'sine', hz: 2, gain: 0.2, hold: 0.1 }] },
      }),
    ).toEqual(['no-throttle', 'zero-hold', 'sub-audio-frequency']);
  });

  it('walks past a hole in a layer list rather than reporting it as a fault', () => {
    // `new Array(2)` with one slot filled: the shape a game assembling layers conditionally
    // produces. The filled layer is still checked.
    const holed = new Array<SoundDef['layers'][number]>(2);
    holed[1] = { wave: 'sine', hz: 4, gain: 0.2, hold: 0.1 };
    const problems = validateSounds({ patchy: { minGapMs: 40, layers: holed } });
    expect(problems.map((p) => p.code)).toEqual(['sub-audio-frequency']);
    expect(problems[0]?.message).toContain('patchy layer 1');
  });

  it('survives a huge table without conflating one sound with another', () => {
    const table: Record<string, SoundDef> = {};
    for (let i = 0; i < 500; i += 1) {
      table[`s${String(i)}`] = {
        minGapMs: i === 250 ? 0 : 40,
        layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }],
      };
    }
    const problems = validateSounds(table);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.sound).toBe('s250');
  });
});
