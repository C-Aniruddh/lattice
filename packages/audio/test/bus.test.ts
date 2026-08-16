import { describe, expect, it } from 'vitest';

import { createMixer, effectiveGain, type Mixer, type MixerState } from '../src/bus.js';
import { BUS_NAMES, RAMP_SEC, type BusName } from '../src/sounds.js';

/** Every value the mixer pushed at the device, in order. The renderer's whole side of the seam. */
interface Applied {
  readonly bus: BusName;
  readonly effective: number;
  readonly rampSec: number;
}

function build(): { readonly mixer: Mixer; readonly applied: Applied[] } {
  const applied: Applied[] = [];
  const mixer = createMixer((bus, effective, rampSec) => {
    applied.push({ bus, effective, rampSec });
  });
  return { mixer, applied };
}

describe('defaults', () => {
  it('starts audible on every bus, with music unmuted and no deck running', () => {
    // Trap 14: "muted" is not "not playing". A game that restores a saved mixer with music
    // muted and then calls deck.play() would otherwise never work out why nothing happened,
    // so the default is unmuted-and-silent rather than muted-and-ready.
    const { mixer } = build();
    for (const bus of BUS_NAMES) {
      expect(mixer.muted(bus)).toBe(false);
      expect(mixer.gain(bus)).toBeGreaterThan(0);
    }
  });

  it('leaves master under full scale, so a chord at the ceiling still has headroom', () => {
    const { mixer } = build();
    expect(mixer.gain('master')).toBeLessThan(1);
  });

  it('touches the device for nothing until something is set', () => {
    expect(build().applied).toEqual([]);
  });
});

describe('gain', () => {
  it('clamps into 0–1 at both ends', () => {
    const { mixer } = build();
    mixer.setGain('sfx', 9);
    expect(mixer.gain('sfx')).toBe(1);
    mixer.setGain('sfx', -3);
    expect(mixer.gain('sfx')).toBe(0);
  });

  it('ignores a non-finite level rather than storing it', () => {
    // A NaN written to an AudioParam poisons it for the life of the node, and a bus node lives
    // as long as the context. One bad slider frame must not silence a bus for the session.
    const { mixer, applied } = build();
    mixer.setGain('sfx', 0.4);
    mixer.setGain('sfx', Number.NaN);
    mixer.setGain('sfx', Number.POSITIVE_INFINITY);
    expect(mixer.gain('sfx')).toBe(0.4);
    expect(applied).toHaveLength(1);
  });

  it('ramps rather than assigns, or a slider drag clicks once per pixel', () => {
    const { mixer, applied } = build();
    mixer.setGain('music', 0.3);
    expect(applied).toEqual([{ bus: 'music', effective: 0.3, rampSec: RAMP_SEC }]);
  });

  it('ignores a bus it has never heard of instead of inventing one', () => {
    const { mixer, applied } = build();
    mixer.setGain('reverb' as BusName, 0.5);
    expect(applied).toEqual([]);
    expect(mixer.gain('reverb' as BusName)).toBe(0);
  });
});

describe('mute is not gain', () => {
  it('restores the exact level the player chose', () => {
    const { mixer } = build();
    mixer.setGain('music', 0.4);
    mixer.setMuted('music', true);
    expect(mixer.gain('music')).toBe(0.4);
    expect(effectiveGain(mixer, 'music')).toBe(0);
    mixer.setMuted('music', false);
    expect(mixer.gain('music')).toBe(0.4);
    expect(effectiveGain(mixer, 'music')).toBe(0.4);
  });

  it('sends zero to the device while muted and the level again when unmuted', () => {
    const { mixer, applied } = build();
    mixer.setGain('music', 0.4);
    mixer.setMuted('music', true);
    mixer.setMuted('music', false);
    expect(applied.map((a) => a.effective)).toEqual([0.4, 0, 0.4]);
  });

  it('keeps a level set while muted, and applies it on unmute', () => {
    const { mixer } = build();
    mixer.setMuted('sfx', true);
    mixer.setGain('sfx', 0.25);
    expect(effectiveGain(mixer, 'sfx')).toBe(0);
    mixer.setMuted('sfx', false);
    expect(effectiveGain(mixer, 'sfx')).toBe(0.25);
  });

  it('mutes master without changing any bus', () => {
    const { mixer } = build();
    mixer.setGain('sfx', 0.8);
    mixer.setMuted('master', true);
    expect(effectiveGain(mixer, 'master')).toBe(0);
    expect(mixer.gain('sfx')).toBe(0.8);
    expect(mixer.muted('sfx')).toBe(false);
  });

  it('ignores a bus it has never heard of', () => {
    const { mixer, applied } = build();
    mixer.setMuted('reverb' as BusName, true);
    expect(mixer.muted('reverb' as BusName)).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe('buses multiply', () => {
  it('renders a layer gain through the bus and master, which is a quarter at half of each', () => {
    // Invariant 8, and it needs no device: the plan carries the gain *before* the bus, so the
    // multiplication belongs to whoever is asking.
    const { mixer } = build();
    mixer.setGain('master', 0.5);
    mixer.setGain('music', 0.5);
    const layerGain = 0.16;
    expect(layerGain * effectiveGain(mixer, 'music') * effectiveGain(mixer, 'master')).toBe(0.04);
  });
});

describe('snapshot and restore', () => {
  it('round-trips every bus, gain and mute', () => {
    const { mixer } = build();
    mixer.setGain('master', 0.55);
    mixer.setGain('music', 0.1);
    mixer.setMuted('ui', true);
    const saved = mixer.snapshot();

    const other = build().mixer;
    other.restore(saved);
    expect(other.snapshot()).toEqual(saved);
  });

  it('is a plain versioned value, so persist can migrate it later', () => {
    const state = build().mixer.snapshot();
    expect(state.version).toBe(1);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('is a copy, not a window onto the mixer', () => {
    const { mixer } = build();
    const before = mixer.snapshot();
    mixer.setGain('sfx', 0.1);
    expect(before.gain.sfx).toBe(1);
  });

  it('clamps an out-of-range save rather than throwing', () => {
    const { mixer } = build();
    mixer.restore({
      version: 1,
      gain: { master: 40, music: -2, sfx: 0.5, ui: 1 },
      muted: { master: false, music: false, sfx: false, ui: false },
    });
    expect(mixer.gain('master')).toBe(1);
    expect(mixer.gain('music')).toBe(0);
    expect(mixer.gain('sfx')).toBe(0.5);
  });

  it('survives a truncated save and leaves the missing buses alone', () => {
    const { mixer } = build();
    mixer.setGain('sfx', 0.3);
    mixer.restore({ version: 1, gain: { music: 0.2 } } as unknown as MixerState);
    expect(mixer.gain('music')).toBe(0.2);
    expect(mixer.gain('sfx')).toBe(0.3);
  });

  it('survives an empty object, a null and a wrongly-typed save', () => {
    const { mixer } = build();
    const before = mixer.snapshot();
    expect(() => mixer.restore({} as MixerState)).not.toThrow();
    expect(() => mixer.restore(null as unknown as MixerState)).not.toThrow();
    expect(() => mixer.restore({ version: 1, gain: 'loud', muted: 7 } as unknown as MixerState)).not.toThrow();
    expect(mixer.snapshot()).toEqual(before);
  });

  it('ignores a NaN gain from a save instead of silencing that bus forever', () => {
    const { mixer } = build();
    mixer.setGain('sfx', 0.6);
    mixer.restore({
      version: 1,
      gain: { master: Number.NaN, music: 0.5, sfx: Number.NaN, ui: 1 },
      muted: { master: false, music: false, sfx: false, ui: false },
    });
    expect(mixer.gain('sfx')).toBe(0.6);
    expect(mixer.gain('music')).toBe(0.5);
  });

  it('takes only a real boolean for muted, so a "1" from an old save cannot mute a game', () => {
    const { mixer } = build();
    mixer.restore({
      version: 1,
      gain: { master: 0.7, music: 0.6, sfx: 1, ui: 1 },
      muted: { master: 1, music: 'yes', sfx: false, ui: true },
    } as unknown as MixerState);
    expect(mixer.muted('master')).toBe(false);
    expect(mixer.muted('music')).toBe(false);
    expect(mixer.muted('ui')).toBe(true);
  });

  it('pushes every bus at the device once, so a restore cannot half-apply', () => {
    const { mixer, applied } = build();
    mixer.restore(mixer.snapshot());
    expect(applied.map((a) => a.bus)).toEqual([...BUS_NAMES]);
  });

  it('restores a save from a build that knew a bus this one does not', () => {
    const { mixer } = build();
    mixer.restore({
      version: 1,
      gain: { master: 0.5, music: 0.5, sfx: 0.5, ui: 0.5, ambience: 0.9 },
      muted: { master: false, music: false, sfx: false, ui: false, ambience: true },
    } as unknown as MixerState);
    expect(mixer.gain('master')).toBe(0.5);
    expect(mixer.snapshot().gain).toEqual({ master: 0.5, music: 0.5, sfx: 0.5, ui: 0.5 });
  });
});
