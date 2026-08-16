import { describe, expect, it, vi } from 'vitest';

import { createBed } from '../src/bed.js';
import { effectiveGain } from '../src/bus.js';
import { createAudio, type Audio } from '../src/engine.js';
import { createDeck } from '../src/music.js';
import { MAX_VOICES, SEMITONE, type Layer, type SoundDef, type VoicePlan } from '../src/sounds.js';

import { FakeContext, asContext } from './fake-context.js';

/**
 * The example from the README, plus the two shapes the policy needs to be interesting: a
 * three-layer sound for the ceiling and an unthrottled one for the burst.
 *
 * Written as a literal with `satisfies` rather than annotated, because the annotation would
 * widen the keys to `string` and the compile-time half of this suite would silently stop
 * asserting anything.
 */
const TABLE = {
  tap: { bus: 'ui', minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  collect: {
    bus: 'sfx',
    minGapMs: 45,
    ladder: { steps: 5, windowMs: 900 },
    layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 }],
  },
  chord: {
    bus: 'sfx',
    minGapMs: 1,
    layers: [
      { wave: 'triangle', hz: 523.25, gain: 0.13, hold: 0.3 },
      { wave: 'triangle', hz: 659.25, gain: 0.11, hold: 0.32, delay: 0.045 },
      { wave: 'triangle', hz: 783.99, gain: 0.1, hold: 0.36, delay: 0.09 },
    ],
  },
  alarm: { bus: 'music', minGapMs: 1, spatial: false, layers: [{ wave: 'square', hz: 138, gain: 0.14, hold: 0.14 }] },
} satisfies Record<string, SoundDef>;

type Ids = keyof typeof TABLE;

interface Harness {
  readonly audio: Audio<Ids>;
  readonly plans: VoicePlan[];
  /** Move the injected clock, in audio-clock seconds. */
  at(seconds: number): void;
}

function harness(options: Partial<Parameters<typeof createAudio<Ids>>[0]> = {}): Harness {
  let seconds = 0;
  const audio = createAudio<Ids>({
    sounds: TABLE,
    context: () => null,
    now: () => seconds,
    ...options,
  });
  const plans: VoicePlan[] = [];
  // A copy per plan, because the engine reuses one object — a test that pushed the object
  // itself would end up with N references to the last voice and assert nothing.
  audio.onScheduled((plan) => plans.push({ ...plan }));
  return {
    audio,
    plans,
    at(next: number): void {
      seconds = next;
    },
  };
}

/**
 * A hundred *different* three-layer sounds, which is the case the ceiling exists for: a
 * per-sound gap cannot see twenty different sounds firing in the same millisecond.
 */
function burstHarness(maxVoices?: number): {
  readonly audio: Audio<string>;
  readonly plans: VoicePlan[];
  at(seconds: number): void;
} {
  const sounds: Record<string, SoundDef> = {};
  for (let i = 0; i < 100; i += 1) {
    sounds[`s${String(i)}`] = {
      minGapMs: 50,
      layers: [
        { wave: 'sine', hz: 220, gain: 0.1, hold: 0.3 },
        { wave: 'sine', hz: 330, gain: 0.1, hold: 0.3 },
        { wave: 'sine', hz: 440, gain: 0.1, hold: 0.3 },
      ],
    };
  }
  let seconds = 0;
  const audio = createAudio<string>({
    sounds,
    context: () => null,
    now: () => seconds,
    ...(maxVoices === undefined ? {} : { maxVoices }),
  });
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

describe('nothing is created before a gesture', () => {
  it('does not reach for a context at construction, or on any method before unlock', () => {
    const context = vi.fn(() => null);
    const audio = createAudio({ sounds: TABLE, context, now: () => 0 });
    audio.play('collect');
    audio.mixer.setGain('music', 0.2);
    audio.mixer.setMuted('sfx', true);
    createBed(audio, [{ wave: 'sine', hz: 50, gain: 0.16, cutoff: 220 }]).set(1, 1);
    createDeck(audio, { autoPump: false }).pump();
    expect(context).not.toHaveBeenCalled();
    expect(audio.available).toBe(false);
    audio.dispose();
  });

  it('creates exactly one context, however many times unlock is called', () => {
    const fake = new FakeContext();
    const context = vi.fn(() => asContext(fake));
    const audio = createAudio({ sounds: TABLE, context, now: () => 0 });
    expect(audio.unlock()).toBe(true);
    expect(audio.unlock()).toBe(true);
    expect(audio.unlock()).toBe(true);
    expect(context).toHaveBeenCalledTimes(1);
    audio.dispose();
  });

  it('resumes on every unlock after the first, which is what survives a backgrounded tab', () => {
    const fake = new FakeContext();
    const audio = createAudio({ sounds: TABLE, context: () => asContext(fake), now: () => 0 });
    audio.unlock();
    expect(fake.resumes).toBe(1);
    fake.state = 'suspended';
    audio.unlock();
    expect(fake.resumes).toBe(2);
    audio.dispose();
  });
});

describe('the defaults', () => {
  it('looks for a real AudioContext when no factory is given, and finds none in Node', () => {
    // The path every test run and every server render takes, with no injection at all.
    const audio = createAudio({ sounds: TABLE });
    expect(audio.unlock()).toBe(false);
    expect(audio.available).toBe(false);
    expect(audio.play('tap')).toBe(true);
    audio.dispose();
  });

  it('takes its clock from the device when no clock is given', () => {
    const fake = new FakeContext();
    const audio = createAudio({ sounds: TABLE, context: () => asContext(fake) });
    audio.unlock();
    fake.currentTime = 7.25;
    const plans: VoicePlan[] = [];
    audio.onScheduled((plan) => plans.push({ ...plan }));
    audio.play('tap');
    expect(plans[0]?.start).toBe(7.25);
    audio.dispose();
  });

  it('is a constant zero clock with no device and no injection', () => {
    const audio = createAudio({ sounds: TABLE, context: () => null });
    const plans: VoicePlan[] = [];
    audio.onScheduled((plan) => plans.push({ ...plan }));
    audio.play('tap');
    expect(plans[0]?.start).toBe(0);
    audio.dispose();
  });
});

describe('silence, never an exception', () => {
  it('runs every public method with no device at all', () => {
    const { audio } = harness();
    expect(() => {
      audio.unlock();
      audio.play('tap');
      audio.play('collect', { gain: 0.5, pan: 0.9, detune: 3, at: 12 });
      audio.mixer.setGain('master', 0.5);
      audio.mixer.setMuted('master', true);
      audio.mixer.restore(audio.mixer.snapshot());
      void audio.voices;
      void audio.available;
      audio.dispose();
      audio.dispose();
    }).not.toThrow();
  });

  it('reports unavailable when there is no context, and still accepts a play', () => {
    const { audio } = harness();
    expect(audio.unlock()).toBe(false);
    expect(audio.available).toBe(false);
    // The one departure from the source game, stated openly: this means "accepted", not "a
    // speaker moved". `available` is the question about the device.
    expect(audio.play('tap')).toBe(true);
  });

  it('treats a context that throws on construction as a context that does not exist', () => {
    const audio = createAudio({
      sounds: TABLE,
      context: () => {
        throw new Error('this browser does not allow audio');
      },
      now: () => 0,
    });
    expect(audio.unlock()).toBe(false);
    expect(audio.available).toBe(false);
    expect(() => audio.play('tap')).not.toThrow();
    audio.dispose();
  });

  it('treats a context that cannot be wired up as no context', () => {
    // A context object that is missing half of WebAudio: old browsers, and hosts that hand in
    // something that is nearly a context. The failure lands on `available`, not on the caller.
    const broken = { createGain: () => undefined } as unknown as AudioContext;
    const audio = createAudio({ sounds: TABLE, context: () => broken, now: () => 0 });
    expect(audio.unlock()).toBe(false);
    expect(audio.available).toBe(false);
    audio.dispose();
  });

  it('refuses a nonsense ceiling at construction, where the mistake is', () => {
    // A programmer error rather than a player-supplied value, so rule 9 applies: name it.
    expect(() => createAudio({ sounds: TABLE, maxVoices: 0 })).toThrow(RangeError);
    expect(() => createAudio({ sounds: TABLE, maxVoices: 2.5 })).toThrow(
      /createAudio: expected maxVoices to be an integer >= 1, got 2\.5/,
    );
  });

  it('falls back to a sane pan limit when handed a broken one', () => {
    const { audio, plans } = harness({ maxPan: Number.NaN });
    audio.play('collect', { pan: 1 });
    expect(plans[0]?.pan).toBe(0.6);
    audio.dispose();
  });

  it('survives a clock that returns NaN, which would otherwise stop the throttle throttling', () => {
    const audio = createAudio({ sounds: TABLE, context: () => null, now: () => Number.NaN });
    expect(audio.play('collect')).toBe(true);
    // NaN < gap is false, so a NaN clock would make every play the first play. It is coerced
    // to a real number at the boundary instead.
    expect(audio.play('collect')).toBe(false);
    audio.dispose();
  });
});

describe('play, without a device', () => {
  it('emits one plan per layer, in layer order', () => {
    const { audio, plans } = harness();
    expect(audio.play('chord')).toBe(true);
    expect(plans.map((p) => p.layer)).toEqual([0, 1, 2]);
    expect(plans.map((p) => p.source)).toEqual(['chord', 'chord', 'chord']);
  });

  it('renders once there is a device, one node graph per layer', () => {
    const fake = new FakeContext();
    const audio = createAudio({ sounds: TABLE, context: () => asContext(fake), now: () => 0 });
    audio.unlock();
    expect(audio.play('chord')).toBe(true);
    expect(fake.countOf('oscillator')).toBe(3);
    audio.dispose();
  });

  it('refuses a sound with no layers rather than accepting a silence', () => {
    const audio = createAudio({
      sounds: { ghost: { minGapMs: 40, layers: [] } },
      context: () => null,
      now: () => 0,
    });
    expect(audio.play('ghost')).toBe(false);
    audio.dispose();
  });

  it('skips a hole in a layer list instead of building a voice out of undefined', () => {
    // `new Array(2)` is how a game assembling layers conditionally ends up with holes, and
    // `noUncheckedIndexedAccess` is the only reason this is visible at all.
    const holed = new Array<Layer>(2);
    holed[1] = { wave: 'sine', hz: 440, gain: 0.1, hold: 0.1 };
    const audio = createAudio({
      sounds: { patchy: { minGapMs: 40, layers: holed } },
      context: () => null,
      now: () => 0,
    });
    const plans: VoicePlan[] = [];
    audio.onScheduled((plan) => plans.push({ ...plan }));
    expect(audio.play('patchy')).toBe(true);
    expect(plans.map((plan) => plan.layer)).toEqual([1]);
    audio.dispose();
  });

  it('refuses an id the table does not have, without throwing', () => {
    const { audio, plans } = harness();
    expect(audio.play('ghost' as Ids)).toBe(false);
    expect(plans).toEqual([]);
  });

  it('resolves the bus from the recipe and defaults to sfx', () => {
    const { audio, plans } = harness();
    audio.play('tap');
    audio.play('collect');
    audio.play('alarm');
    expect(plans.map((p) => p.bus)).toEqual(['ui', 'sfx', 'music']);
  });

  it('drops a second play inside the gap and lets one through after it', () => {
    const { audio, plans, at } = harness();
    expect(audio.play('collect')).toBe(true);
    expect(audio.play('collect')).toBe(false);
    expect(plans).toHaveLength(1);
    at(0.045);
    expect(audio.play('collect')).toBe(true);
    expect(plans).toHaveLength(2);
  });

  it('walks the ladder in exact semitone ratios', () => {
    const { audio, plans, at } = harness();
    for (let i = 0; i < 4; i += 1) {
      at(i * 0.1);
      audio.play('collect');
    }
    expect(plans.map((p) => p.hz)).toEqual([
      660,
      660 * SEMITONE ** 1,
      660 * SEMITONE ** 2,
      660 * SEMITONE ** 3,
    ]);
  });

  it('adds a per-play detune on top of the ladder step', () => {
    const { audio, plans, at } = harness();
    audio.play('collect');
    at(0.1);
    audio.play('collect', { detune: 12 });
    expect(plans[1]?.hz).toBe(660 * SEMITONE ** 13);
  });

  it('stops a repeat of one sound at the throttle, before the ceiling ever sees it', () => {
    // Trap 8, first half: the throttle handles the repeat of *one* sound. Twenty calls in one
    // millisecond is one chord, not twenty blips, and the ceiling is not involved at all.
    const { audio, plans } = harness();
    for (let i = 0; i < 100; i += 1) audio.play('chord');
    expect(plans).toHaveLength(3);
    expect(audio.voices).toBe(3);
  });

  it('holds the ceiling against a hundred different sounds, and then releases it', () => {
    // Trap 8, second half: the ceiling handles twenty *different* sounds, which no per-sound
    // gap can see. Every id here is distinct, so the throttle never fires.
    const { audio, plans, at } = burstHarness();
    for (let i = 0; i < 100; i += 1) audio.play(`s${String(i)}`);
    expect(plans).toHaveLength(MAX_VOICES);
    expect(audio.voices).toBe(MAX_VOICES);
    // Every layer ends within 0.4 s of the start. Past that, the ceiling is free again.
    at(1);
    expect(audio.voices).toBe(0);
    audio.play('s0');
    expect(plans).toHaveLength(MAX_VOICES + 3);
  });

  it('honours a lowered ceiling', () => {
    const { audio, plans } = burstHarness(6);
    for (let i = 0; i < 100; i += 1) audio.play(`s${String(i)}`);
    expect(plans).toHaveLength(6);
  });

  it('scales gain by the per-play multiplier and clamps it', () => {
    const { audio, plans, at } = harness();
    audio.play('collect', { gain: 0.5 });
    at(1);
    audio.play('collect', { gain: 40 });
    at(2);
    audio.play('collect', { gain: -1 });
    expect(plans.map((p) => p.gain)).toEqual([0.08, 0.16, 0]);
  });

  it('starts at the clock by default and at an explicit time when given one', () => {
    const { audio, plans, at } = harness();
    at(3);
    audio.play('tap');
    at(4);
    audio.play('tap', { at: 9.5 });
    expect(plans.map((p) => p.start)).toEqual([3, 9.5]);
  });

  it('ignores a non-finite time, gain or detune rather than poisoning a parameter', () => {
    const { audio, plans } = harness();
    audio.play('tap', { at: Number.NaN, gain: Number.NaN, detune: Number.POSITIVE_INFINITY });
    expect(plans[0]?.start).toBe(0);
    expect(plans[0]?.gain).toBe(0.05);
    expect(plans[0]?.hz).toBe(1180);
  });

  it('carries a release tail on the plan, which is what the ceiling counts', () => {
    const { audio, plans } = harness();
    audio.play('collect');
    const plan = plans[0];
    expect(plan?.end).toBeGreaterThan(plan?.start ?? 0);
    expect((plan?.end ?? 0) - (plan?.start ?? 0)).toBe(0.006 + 0.1);
  });
});

describe('panning', () => {
  it('pans a world sound and clamps it to two thirds of the field', () => {
    const { audio, plans } = harness();
    audio.play('collect', { pan: 1 });
    expect(plans[0]?.pan).toBe(0.6);
  });

  it('clamps the other way too', () => {
    const { audio, plans } = harness();
    audio.play('collect', { pan: -5 });
    expect(plans[0]?.pan).toBe(-0.6);
  });

  it('leaves interface sounds centered, because the interface does not follow the camera', () => {
    const { audio, plans } = harness();
    audio.play('tap', { pan: 1 });
    expect(plans[0]?.pan).toBe(0);
  });

  it('respects an explicit spatial: false on a world bus', () => {
    const { audio, plans } = harness();
    audio.play('alarm', { pan: 1 });
    expect(plans[0]?.pan).toBe(0);
  });

  it('honours a fixed pan written into the recipe even for a non-spatial sound', () => {
    const audio = createAudio({
      sounds: { side: { bus: 'ui', minGapMs: 1, layers: [{ wave: 'sine', hz: 440, gain: 0.1, hold: 0.1, pan: -0.4 }] } },
      context: () => null,
      now: () => 0,
    });
    const plans: VoicePlan[] = [];
    audio.onScheduled((plan) => plans.push({ ...plan }));
    audio.play('side');
    expect(plans[0]?.pan).toBe(-0.4);
    audio.dispose();
  });

  it('lets a game turn panning off entirely', () => {
    const { audio, plans } = harness({ maxPan: 0 });
    audio.play('collect', { pan: 1 });
    expect(plans[0]?.pan).toBe(0);
  });
});

describe('the mixer through the engine', () => {
  it('leaves a plan gain before the bus, so the multiplication belongs to the caller', () => {
    const { audio, plans } = harness();
    audio.mixer.setGain('master', 0.5);
    audio.mixer.setGain('sfx', 0.5);
    audio.play('collect');
    const plan = plans[0];
    expect(plan?.gain).toBe(0.16);
    expect((plan?.gain ?? 0) * effectiveGain(audio.mixer, 'sfx') * effectiveGain(audio.mixer, 'master')).toBe(0.04);
  });

  it('still accepts and reports a play on a muted bus', () => {
    // Muting is a gain of zero, not a policy decision. Making it a rejection would mean the
    // throttle and the ladder ran differently depending on a settings panel.
    const { audio, plans } = harness();
    audio.mixer.setMuted('sfx', true);
    expect(audio.play('collect')).toBe(true);
    expect(plans).toHaveLength(1);
  });
});

describe('onScheduled', () => {
  it('stops after its disposer, and the disposer is safe to call twice', () => {
    const { audio, plans, at } = harness();
    const seen: string[] = [];
    const off = audio.onScheduled((plan) => seen.push(plan.source));
    audio.play('tap');
    off();
    off();
    at(1);
    audio.play('tap');
    expect(seen).toEqual(['tap']);
    expect(plans).toHaveLength(2);
  });

  it('reuses one plan object across every listener and every voice', () => {
    const { audio } = harness();
    const seen: unknown[] = [];
    audio.onScheduled((plan) => seen.push(plan));
    audio.play('chord');
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
  });

  it('feeds every listener', () => {
    const { audio } = harness();
    const a: string[] = [];
    const b: string[] = [];
    audio.onScheduled((plan) => a.push(plan.source));
    audio.onScheduled((plan) => b.push(plan.source));
    audio.play('tap');
    expect(a).toEqual(['tap']);
    expect(b).toEqual(['tap']);
  });
});

describe('dispose is final and quiet', () => {
  it('closes the context, stops accepting, and is idempotent', () => {
    const fake = new FakeContext();
    const audio = createAudio({ sounds: TABLE, context: () => asContext(fake), now: () => 0 });
    audio.unlock();
    expect(audio.available).toBe(true);

    audio.dispose();
    expect(fake.closes).toBe(1);
    expect(audio.available).toBe(false);
    expect(audio.play('tap')).toBe(false);
    expect(audio.voices).toBe(0);
    expect(audio.unlock()).toBe(false);

    audio.dispose();
    expect(fake.closes).toBe(1);
  });

  it('stops feeding listeners', () => {
    const { audio, plans } = harness();
    audio.dispose();
    audio.play('tap');
    expect(plans).toEqual([]);
  });
});

describe('the id union', () => {
  it('is inferred from the table, so a typo is a compile error', () => {
    const { audio } = harness();
    // @ts-expect-error 'colect' is not a key of the table this engine was built from.
    audio.play('colect');
    expect(audio.play('collect')).toBe(true);
  });
});
