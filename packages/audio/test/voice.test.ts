import { describe, expect, it } from 'vitest';

import { ATTACK_SEC, SEMITONE, type Layer, type SoundDef } from '../src/sounds.js';
import { createPlayPolicy, createVoiceRequest, detuned, fillRequest } from '../src/voice.js';

const sound = (over: Partial<SoundDef> = {}): SoundDef => ({
  minGapMs: 100,
  layers: [{ wave: 'sine', hz: 440, gain: 0.2, hold: 0.1 }],
  ...over,
});

/**
 * Play a sound `count` times at one instant, holding every admitted voice. Returns how many
 * plays were accepted — the shape of the burst COLLECT ALL produces.
 */
function burst(policy: ReturnType<typeof createPlayPolicy>, layers: number, count: number, at: number): number {
  let accepted = 0;
  for (let i = 0; i < count; i += 1) {
    const id = `s${String(i)}`;
    if (policy.admit(id, sound(), layers, at) < 0) continue;
    accepted += 1;
    for (let layer = 0; layer < layers; layer += 1) policy.hold(at + 0.5);
  }
  return accepted;
}

describe('detuned', () => {
  it('is the identity at zero semitones, exactly', () => {
    expect(detuned(440, 0)).toBe(440);
  });

  it('is one semitone per step, and an octave after twelve', () => {
    expect(detuned(440, 1)).toBe(440 * SEMITONE);
    // Twelve semitones is an octave to within a double's worth of rounding: SEMITONE is a
    // 17-digit literal, so twelve multiplications of it land within ~1e-12 of 880.
    expect(Math.abs(detuned(440, 12) - 880)).toBeLessThan(1e-12);
  });

  it('goes down as readily as up', () => {
    expect(Math.abs(detuned(440, -12) * 2 - 440)).toBeLessThan(1e-12);
  });
});

describe('fillRequest', () => {
  const layer: Layer = { wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 };

  it('copies the recipe and computes the two times the ceiling depends on', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'collect', 'sfx', 0, layer, 10, 1, 0, 0);
    expect(request.source).toBe('collect');
    expect(request.bus).toBe('sfx');
    expect(request.layer).toBe(0);
    expect(request.wave).toBe('triangle');
    expect(request.hz).toBe(660);
    expect(request.toHz).toBe(880);
    expect(request.gain).toBe(0.16);
    expect(request.start).toBe(10);
    expect(request.end).toBe(10 + ATTACK_SEC + 0.1);
    expect(request.cutoff).toBe(3200);
    expect(request.highpass).toBeUndefined();
  });

  it('holds toHz at hz when the layer does not sweep', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'tap', 'ui', 0, { wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03 }, 0, 1, 0, 0);
    expect(request.toHz).toBe(1180);
  });

  it('detunes both ends of a sweep by the same ratio, or a fall becomes a slide', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'collect', 'sfx', 0, layer, 0, 1, 2, 0);
    expect(request.hz).toBe(660 * SEMITONE ** 2);
    expect(request.toHz).toBe(880 * SEMITONE ** 2);
  });

  it('starts a delayed layer later and ends it later by the same amount', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'quest', 'sfx', 2, { ...layer, delay: 0.24 }, 5, 1, 0, 0);
    expect(request.start).toBe(5.24);
    expect(request.end).toBe(5.24 + ATTACK_SEC + 0.1);
  });

  it('scales gain by the per-play multiplier', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'collect', 'sfx', 0, layer, 0, 0.5, 0, 0);
    expect(request.gain).toBe(0.08);
  });

  it('honours a per-layer attack override and folds it into the end time', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'swell', 'sfx', 0, { ...layer, attack: 0.4 }, 0, 1, 0, 0);
    expect(request.attack).toBe(0.4);
    expect(request.end).toBe(0.5);
  });

  it('ignores an attack of zero or less, which would put the click back', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'a', 'sfx', 0, { ...layer, attack: 0 }, 0, 1, 0, 0);
    expect(request.attack).toBe(ATTACK_SEC);
  });

  it('treats a negative hold as no hold rather than as an end before the start', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'a', 'sfx', 0, { ...layer, hold: -1 }, 0, 1, 0, 0);
    expect(request.end).toBe(ATTACK_SEC);
  });

  it('is one object refilled, which is the contract onScheduled documents', () => {
    const request = createVoiceRequest();
    fillRequest(request, 'a', 'ui', 0, layer, 0, 1, 0, 0);
    const captured = request;
    fillRequest(request, 'b', 'sfx', 1, layer, 1, 1, 0, 0);
    // The listener that retained the object sees the *next* voice. This is the trap the doc
    // comment on VoicePlan warns about, asserted so it cannot be quietly fixed into an
    // allocation per voice.
    expect(captured.source).toBe('b');
  });
});

describe('the throttle', () => {
  it('lets the first play through and drops a second at the same instant', () => {
    const policy = createPlayPolicy(24);
    expect(policy.admit('collect', sound({ minGapMs: 45 }), 1, 100)).toBe(0);
    expect(policy.admit('collect', sound({ minGapMs: 45 }), 1, 100)).toBe(-1);
  });

  it('opens again exactly at the gap, in seconds, from a millisecond field', () => {
    const policy = createPlayPolicy(24);
    const def = sound({ minGapMs: 45 });
    policy.admit('collect', def, 1, 100);
    expect(policy.admit('collect', def, 1, 100 + 0.0449)).toBe(-1);
    expect(policy.admit('collect', def, 1, 100 + 0.045)).toBe(0);
  });

  it('throttles each sound separately', () => {
    const policy = createPlayPolicy(24);
    expect(policy.admit('a', sound(), 1, 0)).toBe(0);
    expect(policy.admit('b', sound(), 1, 0)).toBe(0);
    expect(policy.admit('a', sound(), 1, 0)).toBe(-1);
  });

  it('measures the gap from the last accepted play, not from the last attempt', () => {
    const policy = createPlayPolicy(24);
    const def = sound({ minGapMs: 100 });
    policy.admit('a', def, 1, 0);
    policy.admit('a', def, 1, 0.05); // rejected, and must not restart the clock
    expect(policy.admit('a', def, 1, 0.1)).toBe(0);
  });
});

describe('the ladder', () => {
  const laddered = sound({ minGapMs: 45, ladder: { steps: 5, windowMs: 900 } });

  it('walks up one step per play inside the window', () => {
    const policy = createPlayPolicy(24);
    const steps = [0, 0.1, 0.2, 0.3].map((at) => policy.admit('collect', laddered, 1, at));
    expect(steps).toEqual([0, 1, 2, 3]);
  });

  it('wraps at its own step count rather than climbing out of hearing', () => {
    const policy = createPlayPolicy(24);
    const three = sound({ minGapMs: 10, ladder: { steps: 3, windowMs: 900 } });
    const steps = [0, 0.1, 0.2, 0.3].map((at) => policy.admit('a', three, 1, at));
    expect(steps).toEqual([0, 1, 2, 0]);
  });

  it('resets to the root once the player stops', () => {
    const policy = createPlayPolicy(24);
    policy.admit('collect', laddered, 1, 0);
    policy.admit('collect', laddered, 1, 0.1);
    // 900 ms after the last play the run is over; the next tap starts again at the root.
    expect(policy.admit('collect', laddered, 1, 0.1 + 0.9)).toBe(0);
  });

  it('treats the window boundary as closed, matching the throttle', () => {
    const policy = createPlayPolicy(24);
    policy.admit('collect', laddered, 1, 0);
    expect(policy.admit('collect', laddered, 1, 0.8999)).toBe(1);
  });

  it('gives two sounds independent ladders', () => {
    const policy = createPlayPolicy(24);
    policy.admit('a', laddered, 1, 0);
    policy.admit('a', laddered, 1, 0.1);
    expect(policy.admit('b', laddered, 1, 0.1)).toBe(0);
    expect(policy.admit('a', laddered, 1, 0.2)).toBe(2);
  });

  it('stays at the root for a sound with no ladder, however fast it is played', () => {
    const policy = createPlayPolicy(24);
    const plain = sound({ minGapMs: 1 });
    expect(policy.admit('a', plain, 1, 0)).toBe(0);
    expect(policy.admit('a', plain, 1, 0.1)).toBe(0);
  });

  it('ignores a ladder of zero steps instead of dividing by it', () => {
    const policy = createPlayPolicy(24);
    const broken = sound({ minGapMs: 1, ladder: { steps: 0, windowMs: 900 } });
    expect(policy.admit('a', broken, 1, 0)).toBe(0);
    expect(policy.admit('a', broken, 1, 0.1)).toBe(0);
  });
});

describe('the voice ceiling', () => {
  it('counts nothing before anything is played', () => {
    expect(createPlayPolicy(24).voices(0)).toBe(0);
  });

  it('admits exactly as many three-layer plays as fit, and no more', () => {
    const policy = createPlayPolicy(24);
    expect(burst(policy, 3, 100, 0)).toBe(8);
    expect(policy.voices(0)).toBe(24);
  });

  it('releases as scheduled ends pass, with no callback anywhere', () => {
    const policy = createPlayPolicy(24);
    burst(policy, 3, 100, 0);
    expect(policy.voices(0.49)).toBe(24);
    // The ends were scheduled at 0.5. Past them the voices are gone, and nothing had to fire.
    expect(policy.voices(0.5)).toBe(0);
    expect(burst(policy, 3, 100, 0.5)).toBe(8);
  });

  it('drops a play that would take it past the ceiling rather than truncating it', () => {
    const policy = createPlayPolicy(4);
    expect(policy.admit('a', sound(), 3, 0)).toBe(0);
    policy.hold(1);
    policy.hold(1);
    policy.hold(1);
    // Two more would make five. A half-played chord is worse than a dropped one.
    expect(policy.admit('b', sound(), 2, 0)).toBe(-1);
    expect(policy.admit('c', sound(), 1, 0)).toBe(0);
  });

  it('never plays a sound with more layers than the whole ceiling', () => {
    const policy = createPlayPolicy(4);
    expect(policy.admit('huge', sound(), 5, 0)).toBe(-1);
  });

  it('honours a ceiling of one', () => {
    const policy = createPlayPolicy(1);
    expect(policy.admit('a', sound(), 1, 0)).toBe(0);
    policy.hold(1);
    expect(policy.admit('b', sound(), 1, 0)).toBe(-1);
  });

  it('does not leak across a clear', () => {
    const policy = createPlayPolicy(24);
    burst(policy, 3, 100, 0);
    policy.clear();
    expect(policy.voices(0)).toBe(0);
    // And the throttle is gone with it, so the same sound may play again at the same instant.
    expect(policy.admit('s0', sound(), 3, 0)).toBe(0);
  });

  it('reads back the ceiling it was built with', () => {
    expect(createPlayPolicy(24).maxVoices).toBe(24);
    expect(createPlayPolicy(1).maxVoices).toBe(1);
  });

  it('moves, and the next admit is the one that sees it', () => {
    // The whole live-ceiling case, with no AudioContext within a mile of it: the policy layer
    // is pure and clock-injected, so a slider's behaviour is assertable in Node.
    const policy = createPlayPolicy(24);
    expect(burst(policy, 3, 100, 0)).toBe(8);
    policy.clear();

    policy.maxVoices = 6;
    expect(policy.maxVoices).toBe(6);
    expect(burst(policy, 3, 100, 0)).toBe(2);
    policy.clear();

    policy.maxVoices = 24;
    expect(burst(policy, 3, 100, 0)).toBe(8);
  });

  it('does not release or cut the voices already held when it drops below them', () => {
    const policy = createPlayPolicy(24);
    burst(policy, 3, 100, 0);
    expect(policy.voices(0)).toBe(24);

    policy.maxVoices = 2;
    // Nothing is sized from the ceiling, so lowering it frees nothing and breaks nothing —
    // it only refuses the next play. The count is still what is sounding.
    expect(policy.voices(0)).toBe(24);
    expect(policy.admit('late', sound(), 1, 0)).toBe(-1);

    // And the ends still rule it: past them the new ceiling is what applies.
    expect(policy.voices(0.5)).toBe(0);
    expect(policy.admit('late', sound(), 2, 0.5)).toBe(0);
    policy.hold(1);
    policy.hold(1);
    expect(policy.admit('later', sound(), 1, 0.5)).toBe(-1);
  });

  it('survives a ceiling dragged to its ends and back a hundred times', () => {
    const policy = createPlayPolicy(8);
    for (let i = 0; i < 100; i += 1) {
      policy.maxVoices = 2;
      expect(burst(policy, 1, 4, i)).toBe(2);
      policy.maxVoices = 8;
      expect(burst(policy, 1, 12, i + 0.5)).toBe(8);
      policy.clear();
    }
    expect(policy.maxVoices).toBe(8);
    expect(policy.voices(1e6)).toBe(0);
  });

  it('holds the count steady under ten thousand plays and releases them all', () => {
    const policy = createPlayPolicy(24);
    for (let i = 0; i < 10000; i += 1) {
      const at = i * 0.001;
      if (policy.admit(`s${String(i)}`, sound({ minGapMs: 1 }), 1, at) >= 0) policy.hold(at + 0.05);
    }
    expect(policy.voices(1e6)).toBe(0);
  });
});
