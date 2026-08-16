import { describe, expect, it } from 'vitest';

import { createBed } from '../src/bed.js';
import { createAudio } from '../src/engine.js';
import { validateSounds, type SoundDef, type VoicePlan } from '../src/sounds.js';

/**
 * The README's example, run.
 *
 * A README that has drifted from the package is the same class of defect as a sound that is
 * declared and never played: correct in isolation, and a lie about the product. This is the
 * cheapest possible guard against it — if the numbers printed in `README.md` stop being the
 * numbers the package produces, this fails.
 */

const SOUNDS = {
  tap: { bus: 'ui', minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  collect: {
    bus: 'sfx',
    minGapMs: 45,
    ladder: { steps: 5, windowMs: 900 },
    layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 }],
  },
} satisfies Record<string, SoundDef>;

describe('the README example', () => {
  it('prints what the README says it prints', () => {
    const lines: string[] = [];
    const log = (line: string): void => {
      lines.push(line);
    };

    log(`problems: ${String(validateSounds(SOUNDS).length)}`);

    let seconds = 0;
    const audio = createAudio({ sounds: SOUNDS, now: () => seconds });
    audio.onScheduled((plan: Readonly<VoicePlan>) => {
      log(`  ${plan.source} on ${plan.bus} at ${plan.hz.toFixed(2)} Hz, gain ${plan.gain.toFixed(3)}`);
    });

    log(`available: ${String(audio.available)}`);
    log(`play: ${String(audio.play('collect'))}`);
    log(`play: ${String(audio.play('collect'))}`);
    seconds += 0.1;
    log(`play: ${String(audio.play('collect'))}`);

    const bed = createBed(audio, [
      { wave: 'sine', hz: 50, gain: 0.16, cutoff: 220, cutoffAtFull: 1.2 },
      { wave: 'noise', hz: 0, gain: 0.1, cutoff: 320, cutoffAtFull: 4.2 },
    ]);
    bed.set(0.5, 1);
    audio.dispose();

    expect(lines).toEqual([
      'problems: 0',
      'available: false',
      '  collect on sfx at 660.00 Hz, gain 0.160',
      'play: true',
      'play: false',
      '  collect on sfx at 699.25 Hz, gain 0.160',
      'play: true',
      '  bed on sfx at 50.00 Hz, gain 0.080',
      '  bed on sfx at 0.00 Hz, gain 0.050',
    ]);
  });
});
