import { describe, expect, it } from 'vitest';

import { createBed, type BedLayer, type BedOptions } from '../src/bed.js';
import { createAudio, type Audio } from '../src/engine.js';
import type { SoundDef, VoicePlan } from '../src/sounds.js';

import { FakeContext, FakeOscillator, asContext } from './fake-context.js';

/** The source game's room, trimmed to the three layers that behave differently. */
const VALLEY: readonly BedLayer[] = [
  { wave: 'sine', hz: 50, gain: 0.16, cutoff: 220, cutoffAtFull: 1.2 },
  { wave: 'noise', hz: 0, gain: 0.1, cutoff: 320, cutoffAtFull: 4.2 },
  { wave: 'sawtooth', hz: 100, gain: 0.035, cutoff: 400, cutoffAtFull: 2.4, beat: 0.7 },
];

const NO_SOUNDS: Record<string, SoundDef> = {};

interface Harness {
  readonly audio: Audio<string>;
  readonly plans: VoicePlan[];
  at(seconds: number): void;
}

function harness(context: () => AudioContext | null = () => null): Harness {
  let seconds = 0;
  const audio = createAudio<string>({ sounds: NO_SOUNDS, context, now: () => seconds });
  const plans: VoicePlan[] = [];
  audio.onScheduled((plan) => plans.push({ ...plan }));
  return {
    audio,
    plans,
    at(next: number): void {
      seconds = next;
    },
  };
}

/** The last target emitted for each layer — what the bed is currently heading toward. */
function targets(plans: readonly VoicePlan[], count: number): number[] {
  const gains = new Array<number>(count).fill(Number.NaN);
  for (const plan of plans) if (plan.source === 'bed') gains[plan.layer] = plan.gain;
  return gains;
}

function bedOn(layers: readonly BedLayer[], options?: BedOptions): { harness: Harness; bed: ReturnType<typeof createBed> } {
  const h = harness();
  return { harness: h, bed: createBed(h.audio, layers, options) };
}

describe('driving the bed', () => {
  it('reports the clamped values it was given', () => {
    const { bed } = bedOn(VALLEY);
    bed.set(5, -2);
    expect(bed.level).toBe(1);
    expect(bed.tone).toBe(0);
    bed.set(0.25, 0.75);
    expect(bed.level).toBe(0.25);
    expect(bed.tone).toBe(0.75);
  });

  it('defaults tone to 1 when it is not given', () => {
    const { bed } = bedOn(VALLEY);
    bed.set(0.5, 0.2);
    bed.set(0.5);
    expect(bed.tone).toBe(1);
  });

  it('keeps the last value when handed a NaN rather than jumping to an edge', () => {
    const { bed } = bedOn(VALLEY);
    bed.set(0.4, 0.6);
    expect(() => bed.set(Number.NaN, Number.NaN)).not.toThrow();
    expect(bed.level).toBe(0.4);
    expect(bed.tone).toBe(0.6);
  });

  it('raises every layer and lowers none as the world fills up', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(0.2, 1);
    const quiet = targets(h.plans, VALLEY.length);
    bed.set(0.8, 1);
    const busy = targets(h.plans, VALLEY.length);
    for (let i = 0; i < VALLEY.length; i += 1) {
      expect(busy[i]).toBeGreaterThan(quiet[i] ?? 0);
    }
  });

  it('is silent at level 0 — an empty world is silent, not quiet', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(1, 1);
    bed.set(0, 1);
    expect(targets(h.plans, VALLEY.length)).toEqual([0, 0, 0]);
  });

  it('scales gain linearly, so level and loudness are the same number', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(0.5, 1);
    expect(targets(h.plans, VALLEY.length)).toEqual([0.08, 0.05, 0.0175]);
  });

  it('sags in pitch as the tone falls, because plant losing power winds down', () => {
    // A drop in level alone reads as a mixing change; a drop in pitch reads as machinery
    // stopping, which is the thing that actually happened.
    const { harness: h, bed } = bedOn([VALLEY[0] as BedLayer], { sagTo: 0.5 });
    bed.set(1, 1);
    expect(h.plans.at(-1)?.hz).toBe(50);
    bed.set(1, 0);
    expect(h.plans.at(-1)?.hz).toBe(25);
    bed.set(1, 0.5);
    expect(h.plans.at(-1)?.hz).toBe(37.5);
  });

  it('offsets a beating layer by its detune, which is what stops it sounding like a pad', () => {
    const { harness: h, bed } = bedOn([VALLEY[2] as BedLayer], { sagTo: 1 });
    bed.set(1, 1);
    expect(h.plans.at(-1)?.hz).toBe(100.7);
  });

  it('never re-issues an unchanged target, or the ramp re-anchors and never arrives', () => {
    // Trap 13. A bed driven every frame with the same numbers must cost nothing at all.
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(0.5, 1);
    const after = h.plans.length;
    for (let i = 0; i < 1000; i += 1) bed.set(0.5, 1);
    expect(h.plans).toHaveLength(after);
  });

  it('emits one plan per layer per change, and no more', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(0.5, 1);
    expect(h.plans).toHaveLength(3);
    bed.set(0.6, 1);
    expect(h.plans).toHaveLength(6);
  });

  it('reports itself as the bed, on the world bus by default', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(1, 1);
    expect(h.plans[0]?.source).toBe('bed');
    expect(h.plans[0]?.bus).toBe('sfx');
  });

  it('can be put on another bus for a game that wants it under the music switch', () => {
    const { harness: h, bed } = bedOn(VALLEY, { bus: 'music' });
    bed.set(1, 1);
    expect(h.plans[0]?.bus).toBe('music');
  });

  it('glides over about a second, not over a frame', () => {
    // A bed that arrives in 15 ms reads as an edit; a bed that takes a second reads as a room.
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(1, 1);
    const plan = h.plans[0];
    expect((plan?.end ?? 0) - (plan?.start ?? 0)).toBe(1);
  });

  it('starts its glide at the engine clock', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    h.at(12.5);
    bed.set(1, 1);
    expect(h.plans[0]?.start).toBe(12.5);
  });
});

describe('bands', () => {
  const crickets: BedLayer = { wave: 'triangle', hz: 2400, gain: 0.02, cutoff: 5000, band: [0, 0.5] };
  const coil: BedLayer = { wave: 'sawtooth', hz: 3150, gain: 0.012, cutoff: 6000, band: [0.4, 1] };

  it('crossfades rather than switches', () => {
    const { harness: h, bed } = bedOn([crickets]);
    bed.set(1, 0);
    expect(targets(h.plans, 1)[0]).toBe(0.02);
    bed.set(1, 1);
    expect(targets(h.plans, 1)[0]).toBe(0);
    bed.set(1, 0.45);
    const middle = targets(h.plans, 1)[0] ?? 0;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(0.02);
  });

  it('speaks at full weight at the edge of the domain, not at half', () => {
    // A band touching 0 or 1 does not fade at that end. Without that rule every bed would be
    // quietest at exactly the two values a game is most likely to sit at.
    const { harness: h, bed } = bedOn([crickets]);
    bed.set(1, 0);
    expect(targets(h.plans, 1)[0]).toBe(0.02);
  });

  it('leaves two adjacent bands both audible in their overlap', () => {
    const { harness: h, bed } = bedOn([crickets, coil]);
    bed.set(1, 0.45);
    const [low, high] = targets(h.plans, 2);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
  });

  it('is never completely silent anywhere in the range', () => {
    // The bug invariant 11 names: a bed with a hole in it is a hole the player walks into.
    const { harness: h, bed } = bedOn([crickets, coil]);
    for (let step = 0; step <= 100; step += 1) {
      const tone = step / 100;
      bed.set(1, tone);
      const total = targets(h.plans, 2).reduce((sum, gain) => sum + gain, 0);
      expect(total, `silent at tone ${String(tone)}`).toBeGreaterThan(0);
    }
  });

  it('silences a layer outside its band entirely', () => {
    const { harness: h, bed } = bedOn([coil]);
    bed.set(1, 0.3);
    expect(targets(h.plans, 1)[0]).toBe(0);
  });

  it('treats a degenerate band as silence rather than as a division by zero', () => {
    const { harness: h, bed } = bedOn([{ ...crickets, band: [0.5, 0.5] }]);
    bed.set(1, 0.5);
    expect(targets(h.plans, 1)[0]).toBe(0);
  });

  it('lets an unbanded layer speak at every tone', () => {
    const { harness: h, bed } = bedOn([VALLEY[0] as BedLayer]);
    for (const tone of [0, 0.25, 0.5, 0.75, 1]) {
      bed.set(1, tone);
      expect(targets(h.plans, 1)[0]).toBe(0.16);
    }
  });
});

describe('standing the nodes up', () => {
  it('creates nothing before a gesture, and everything on the first unlock', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    const bed = createBed(h.audio, VALLEY);
    bed.set(0.7, 0.5);
    expect(fake.countOf('oscillator')).toBe(0);

    h.audio.unlock();
    // Two oscillators and one buffer source: the layers that were driven before the device
    // existed arrive at the level they were driven to.
    expect(fake.countOf('oscillator')).toBe(2);
    expect(fake.countOf('buffer-source')).toBe(1);
    h.audio.dispose();
  });

  it('stands up immediately when the device is already there', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    createBed(h.audio, VALLEY);
    expect(fake.countOf('oscillator')).toBe(2);
    h.audio.dispose();
  });

  it('creates no nodes at all as it is driven, however hard', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const bed = createBed(h.audio, VALLEY);
    const after = fake.nodes.length;
    for (let i = 0; i < 1000; i += 1) bed.set(i / 1000, 1 - i / 1000);
    expect(fake.nodes).toHaveLength(after);
    h.audio.dispose();
  });

  it('ramps the running oscillators rather than assigning to them', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const bed = createBed(h.audio, [VALLEY[0] as BedLayer], { sagTo: 0.5, glideSec: 2 });
    bed.set(1, 0);
    const oscillator = fake.nodes.find((node) => node instanceof FakeOscillator);
    const last = oscillator?.frequency.events.at(-1);
    expect(last?.kind).toBe('target');
    expect(last?.value).toBe(25);
    expect(last?.seconds).toBe(2);
    h.audio.dispose();
  });

  it('gives two beds their own layers rather than stacking one', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const before = fake.nodes.length;
    const first = createBed(h.audio, VALLEY);
    const perBed = fake.nodes.length - before;
    expect(perBed).toBe(VALLEY.length * 3); // source, gain, filter
    const second = createBed(h.audio, VALLEY);
    expect(fake.nodes.length - before).toBe(perBed * 2);

    // And stopping one leaves the other running: two beds, not one shared graph.
    first.stop(0);
    second.set(1, 1);
    expect(second.level).toBe(1);
    h.audio.dispose();
  });
});

describe('stopping', () => {
  it('goes quiet and stays quiet', () => {
    const { harness: h, bed } = bedOn(VALLEY);
    bed.set(1, 1);
    const emitted = h.plans.length;
    bed.stop();
    bed.set(0.5, 0.5);
    expect(h.plans).toHaveLength(emitted);
    expect(bed.level).toBe(1);
  });

  it('is safe to stop twice, and safe with no device', () => {
    const { bed } = bedOn(VALLEY);
    expect(() => {
      bed.stop();
      bed.stop(0.25);
    }).not.toThrow();
  });

  it('fades the nodes out rather than cutting them', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const bed = createBed(h.audio, [VALLEY[0] as BedLayer]);
    bed.set(1, 1);
    bed.stop(3);
    const oscillator = fake.nodes.find((node) => node instanceof FakeOscillator);
    expect(oscillator?.stopAt).toBeGreaterThanOrEqual(3);
    h.audio.dispose();
  });

  it('is torn down by the engine, before the context closes', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const bed = createBed(h.audio, VALLEY);
    bed.set(1, 1);
    h.audio.dispose();
    expect(fake.closes).toBe(1);
    // Every source was stopped on the way out, and driving a torn-down bed is a no-op.
    expect(() => bed.set(0.5, 0.5)).not.toThrow();
  });
});

describe('a bed on something that is not one of our engines', () => {
  it('is inert rather than an exception', () => {
    const foreign = {
      mixer: {} as Audio<string>['mixer'],
      available: false,
      voices: 0,
      unlock: () => false,
      play: () => false,
      onScheduled: () => () => undefined,
      dispose: () => undefined,
    } satisfies Audio<string>;
    const bed = createBed(foreign, VALLEY);
    expect(() => {
      bed.set(1, 1);
      bed.stop();
    }).not.toThrow();
    expect(bed.level).toBe(1);
  });

  it('copes with an empty layer list', () => {
    const { bed } = bedOn([]);
    expect(() => bed.set(1, 1)).not.toThrow();
  });

  it('skips a hole in a layer list rather than building a tone out of undefined', () => {
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    h.audio.unlock();
    const holed = new Array<BedLayer>(3);
    holed[2] = { wave: 'sine', hz: 50, gain: 0.16, cutoff: 220 };
    const bed = createBed(h.audio, holed);
    bed.set(1, 1);
    expect(fake.countOf('oscillator')).toBe(1);
    expect(new Set(h.plans.map((plan) => plan.layer))).toEqual(new Set([2]));
    h.audio.dispose();
  });

  it('does not stand up on a later unlock once it has been stopped', () => {
    // A bed stopped during the loading screen must not reappear when the player finally taps.
    const fake = new FakeContext();
    const h = harness(() => asContext(fake));
    const bed = createBed(h.audio, VALLEY);
    bed.stop(0);
    h.audio.unlock();
    expect(fake.countOf('oscillator')).toBe(0);
    h.audio.dispose();
  });
});
