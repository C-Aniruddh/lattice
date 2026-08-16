import { describe, expect, it } from 'vitest';

import { createRenderer, type Renderer } from '../src/render.js';
import type { BusName } from '../src/sounds.js';
import { createVoiceRequest, type VoiceRequest } from '../src/voice.js';

import {
  FakeBufferSource,
  FakeContext,
  FakeGain,
  FakeOscillator,
  FakePanner,
  asContext,
} from './fake-context.js';

/**
 * The only file in the suite that needs anything shaped like a device.
 *
 * It covers node construction and teardown, and it asserts nothing about policy — the throttle,
 * the ladder, the ceiling and the bed's targets are all proved with no context at all, which is
 * the whole point of the split. What is left here is the ~150 lines that turn a plan into
 * nodes, and those genuinely need something with `createOscillator` on it.
 */

function setup(): { readonly fake: FakeContext; readonly renderer: Renderer } {
  const fake = new FakeContext();
  return { fake, renderer: createRenderer(asContext(fake)) };
}

function voice(over: Partial<VoiceRequest> = {}): VoiceRequest {
  return Object.assign(createVoiceRequest(), {
    source: 'test',
    bus: 'sfx' as BusName,
    wave: 'sine' as const,
    hz: 440,
    toHz: 440,
    gain: 0.2,
    start: 1,
    end: 1.106,
    attack: 0.006,
    ...over,
  });
}

describe('the bus graph', () => {
  it('is four gain nodes: master into the device, three buses into master', () => {
    const { fake } = setup();
    expect(fake.countOf('gain')).toBe(4);
    expect(fake.live).toBe(4);
  });

  it('ramps a bus rather than assigning to it', () => {
    const { fake, renderer } = setup();
    fake.currentTime = 3;
    renderer.setBusGain('music', 0.25, 0.015);
    const events = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).map((node) => node.gain.events);
    const ramps = events.flat().filter((event) => event.kind === 'target');
    expect(ramps).toEqual([{ kind: 'target', value: 0.25, at: 3, seconds: 0.015 }]);
  });

  it('assigns rather than ramps when the ramp is zero, which is what unlock does', () => {
    const { fake, renderer } = setup();
    renderer.setBusGain('master', 0.7, 0);
    const master = fake.nodes.find((node): node is FakeGain => node instanceof FakeGain);
    expect(master?.gain.events[0]?.kind).toBe('set');
  });

  it('ignores a bus it does not have rather than throwing', () => {
    const { renderer } = setup();
    expect(() => renderer.setBusGain('reverb' as BusName, 1, 0.01)).not.toThrow();
  });
});

describe('the envelope', () => {
  it('rises linearly from zero and decays exponentially to a floor, never to zero', () => {
    // Trap 1, both halves. An exponential ramp *from* zero is silence, and an exponential ramp
    // *to* zero is a spec violation — the stub throws on the second, exactly as the spec says.
    const { fake, renderer } = setup();
    renderer.play(voice());
    const envelope = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    expect(envelope?.gain.events).toEqual([
      { kind: 'set', value: 0, at: 1 },
      { kind: 'linear', value: 0.2, at: 1.006 },
      { kind: 'exponential', value: 0.0001, at: 1.106 },
    ]);
  });

  it('keeps the ramp times strictly increasing even for a layer with no hold at all', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ start: 0, end: 0, attack: 0 }));
    const envelope = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    const times = envelope?.gain.events.map((event) => event.at) ?? [];
    expect(times[1]).toBeGreaterThan(times[0] ?? 0);
    expect(times[2]).toBeGreaterThan(times[1] ?? 0);
  });

  it('never asks for a peak of exactly zero, which cannot be ramped away from', () => {
    const { fake, renderer } = setup();
    expect(() => renderer.play(voice({ gain: 0 }))).not.toThrow();
    const envelope = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    expect(envelope?.gain.events[1]?.value).toBeGreaterThan(0);
  });
});

describe('pitch', () => {
  it('sweeps exponentially, because pitch is heard logarithmically', () => {
    // Trap 2: a linear 880 → 190 sweep spends most of its life in the bottom octave.
    const { fake, renderer } = setup();
    renderer.play(voice({ hz: 880, toHz: 190 }));
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.frequency.events).toEqual([
      { kind: 'set', value: 880, at: 1 },
      { kind: 'exponential', value: 190, at: 1.106 },
    ]);
  });

  it('does not ramp a layer that does not sweep', () => {
    const { fake, renderer } = setup();
    renderer.play(voice());
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.frequency.events.map((event) => event.kind)).toEqual(['set']);
  });

  it('never ramps toward zero hertz, whatever the recipe says', () => {
    const { fake, renderer } = setup();
    expect(() => renderer.play(voice({ hz: 200, toHz: 0 }))).not.toThrow();
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.frequency.events[1]?.value).toBe(1);
  });

  it('carries the wave shape through', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ wave: 'sawtooth' }));
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.type).toBe('sawtooth');
  });
});

describe('the fixed chain', () => {
  it('builds no filter when the recipe asks for none', () => {
    const { fake, renderer } = setup();
    renderer.play(voice());
    expect(fake.countOf('filter')).toBe(0);
  });

  it('builds a low-pass for a cutoff and a high-pass for a highpass', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ cutoff: 3200 }));
    renderer.play(voice({ highpass: 7200 }));
    const filters = fake.nodes.filter((node) => node.kind === 'filter');
    expect(filters).toHaveLength(2);
  });

  it('builds both, in the order the chain declares, for a band-pass', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ cutoff: 3200, highpass: 400 }));
    const filters = fake.nodes.filter((node) => node.kind === 'filter');
    expect(filters).toHaveLength(2);
    // source → highpass → lowpass → gain: the high-pass is built second and sits first.
    const [lowpass, highpass] = filters;
    expect(lowpass?.outputs.size).toBe(1);
    expect(highpass?.outputs.has(lowpass as never)).toBe(true);
  });

  it('builds a panner only for a voice that is actually off-center', () => {
    const { fake, renderer } = setup();
    renderer.play(voice());
    expect(fake.countOf('panner')).toBe(0);
    renderer.play(voice({ pan: -0.4 }));
    const panner = fake.nodes.find((node): node is FakePanner => node instanceof FakePanner);
    expect(panner?.pan.value).toBe(-0.4);
  });

  it('drops the pan rather than the sound on a browser with no stereo panner', () => {
    // Safari before 14.1. A missing node type must cost the pan, never the voice.
    const fake = new FakeContext();
    fake.stereo = false;
    const renderer = createRenderer(asContext(fake));
    expect(() => renderer.play(voice({ pan: 0.5 }))).not.toThrow();
    expect(fake.countOf('panner')).toBe(0);
    expect(fake.countOf('oscillator')).toBe(1);
  });

  it('drops a voice on a bus that does not exist rather than connecting it to nothing', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ bus: 'reverb' as BusName }));
    expect(fake.countOf('oscillator')).toBe(0);
  });
});

describe('noise', () => {
  it('is a looped buffer source rather than an oscillator', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ wave: 'noise' }));
    const source = fake.nodes.find((node): node is FakeBufferSource => node instanceof FakeBufferSource);
    expect(source?.loop).toBe(true);
    expect(fake.countOf('oscillator')).toBe(0);
  });

  it('builds one buffer and shares it, rather than filling 48,000 floats per hi-hat', () => {
    // Trap 10. A fresh buffer per hat is an allocation and a fill on the beat.
    const { fake, renderer } = setup();
    renderer.play(voice({ wave: 'noise' }));
    renderer.play(voice({ wave: 'noise' }));
    const sources = fake.nodes.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);
    expect(sources).toHaveLength(2);
    expect(sources[0]?.buffer).toBe(sources[1]?.buffer);
  });

  it('fills it deterministically, in range, and not with silence', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ wave: 'noise' }));
    const source = fake.nodes.find((node): node is FakeBufferSource => node instanceof FakeBufferSource);
    const buffer = source?.buffer as { getChannelData: () => Float32Array } | null;
    const data = buffer?.getChannelData() ?? new Float32Array(0);
    expect(data).toHaveLength(fake.sampleRate);
    let sum = 0;
    for (const sample of data) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
      sum += Math.abs(sample);
    }
    // White noise averages about half of full scale in magnitude; anything near zero here
    // means the fill did nothing.
    expect(sum / data.length).toBeGreaterThan(0.4);
  });
});

describe('teardown', () => {
  it('starts and stops every source on the clock, with a tail past the envelope', () => {
    const { fake, renderer } = setup();
    renderer.play(voice({ start: 2, end: 2.5 }));
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.startedAt).toBe(2);
    expect(oscillator?.stopAt).toBeGreaterThan(2.5);
  });

  it('returns the graph to its baseline after a hundred plays and a full release tail', () => {
    // Invariant 21, and the leak it names is the one that presents as a tab using two
    // gigabytes an hour into a session.
    const { fake, renderer } = setup();
    const baseline = fake.live;
    for (let i = 0; i < 100; i += 1) {
      renderer.play(voice({ start: i * 0.01, end: i * 0.01 + 0.2, cutoff: 2000, pan: 0.3 }));
    }
    expect(fake.live).toBeGreaterThan(baseline);
    fake.advance(1000);
    expect(fake.live).toBe(baseline);
  });

  it('disconnects each node exactly once, so a collected node is never disconnected twice', () => {
    // Trap 11, the other half: disconnecting a node the engine has already collected throws.
    const { fake, renderer } = setup();
    renderer.play(voice({ cutoff: 2000 }));
    fake.advance(10);
    expect(() => fake.advance(20)).not.toThrow();
  });
});

describe('resume and close', () => {
  it('resumes only a suspended context', () => {
    const { fake, renderer } = setup();
    renderer.resume();
    expect(fake.resumes).toBe(1);
    renderer.resume();
    expect(fake.resumes).toBe(1);
  });

  it('closes once, stops what is sounding, and goes quiet afterwards', () => {
    const { fake, renderer } = setup();
    renderer.play(voice());
    renderer.close();
    expect(fake.closes).toBe(1);
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.stopAt).toBe(0);

    renderer.close();
    expect(fake.closes).toBe(1);
    renderer.play(voice());
    renderer.resume();
    expect(fake.countOf('oscillator')).toBe(1);
  });

  it('swallows a rejected resume and a rejected close', async () => {
    // A browser declining to resume is a browser that plays no sound, not an unhandled
    // rejection in the game's console on every gesture.
    const fake = new FakeContext();
    fake.resume = (): Promise<void> => Promise.reject(new Error('gesture required'));
    fake.close = (): Promise<void> => Promise.reject(new Error('already closing'));
    const renderer = createRenderer(asContext(fake));
    renderer.resume();
    renderer.close();
    await Promise.resolve();
    expect(true).toBe(true);
  });

  it('survives a source that refuses to stop', () => {
    const fake = new FakeContext();
    const renderer = createRenderer(asContext(fake));
    renderer.play(voice());
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    if (oscillator !== undefined) {
      oscillator.stop = (): never => {
        throw new Error('already stopped');
      };
    }
    expect(() => renderer.close()).not.toThrow();
  });
});

describe('a continuous tone', () => {
  it('is a source, a gain and a filter, silent on arrival', () => {
    const { fake, renderer } = setup();
    renderer.startTone('sfx', 'sine', 50, 220, undefined);
    expect(fake.countOf('oscillator')).toBe(1);
    expect(fake.countOf('filter')).toBe(1);
    const gain = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    // A bed that starts at its target thumps in on the first frame.
    expect(gain?.gain.value).toBe(0);
  });

  it('takes a high-pass when one is asked for', () => {
    const { fake, renderer } = setup();
    renderer.startTone('sfx', 'noise', 0, 320, 7000);
    expect(fake.countOf('filter')).toBe(2);
    expect(fake.countOf('buffer-source')).toBe(1);
  });

  it('ramps its three parameters over the glide rather than assigning them', () => {
    const { fake, renderer } = setup();
    const tone = renderer.startTone('sfx', 'sine', 50, 220, undefined);
    tone.set(0.1, 45, 300, 1.5, 4);
    const gain = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(gain?.gain.events).toEqual([{ kind: 'target', value: 0.1, at: 4, seconds: 1.5 }]);
    expect(oscillator?.frequency.events.at(-1)).toEqual({ kind: 'target', value: 45, at: 4, seconds: 1.5 });
  });

  it('does not try to retune noise, which has no frequency', () => {
    const { fake, renderer } = setup();
    const tone = renderer.startTone('sfx', 'noise', 0, 320, undefined);
    expect(() => tone.set(0.1, 45, 300, 1, 0)).not.toThrow();
    expect(fake.countOf('oscillator')).toBe(0);
  });

  it('fades out on stop and ignores everything afterwards', () => {
    const { fake, renderer } = setup();
    const tone = renderer.startTone('sfx', 'sine', 50, 220, undefined);
    tone.stop(3, 10);
    const gain = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    expect(gain?.gain.events.at(-1)).toEqual({ kind: 'target', value: 0, at: 10, seconds: 1 });
    const oscillator = fake.nodes.find((node): node is FakeOscillator => node instanceof FakeOscillator);
    expect(oscillator?.stopAt).toBeGreaterThanOrEqual(13);

    tone.set(1, 1, 1, 1, 20);
    tone.stop(1, 21);
    expect(gain?.gain.events).toHaveLength(1);
  });

  it('disconnects its whole chain once the fade has run out', () => {
    const { fake, renderer } = setup();
    const baseline = fake.live;
    const tone = renderer.startTone('sfx', 'sine', 50, 220, undefined);
    expect(fake.live).toBeGreaterThan(baseline);
    tone.stop(1, 0);
    fake.advance(10);
    expect(fake.live).toBe(baseline);
  });

  it('is silent after the renderer closes', () => {
    const { fake, renderer } = setup();
    const tone = renderer.startTone('sfx', 'sine', 50, 220, undefined);
    renderer.close();
    tone.set(0.5, 60, 400, 1, 1);
    const gain = fake.nodes.filter((node): node is FakeGain => node instanceof FakeGain).at(-1);
    expect(gain?.gain.events).toEqual([]);
  });

  it('falls back to master for a bus that does not exist', () => {
    const { fake, renderer } = setup();
    expect(() => renderer.startTone('reverb' as 'sfx', 'sine', 50, 220, undefined)).not.toThrow();
    expect(fake.countOf('oscillator')).toBe(1);
  });
});
