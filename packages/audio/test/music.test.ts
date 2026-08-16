import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAudio, type Audio } from '../src/engine.js';
import { LOOKAHEAD_SEC, PUMP_INTERVAL_MS, createDeck, validateSong, type Song, type Track } from '../src/music.js';
import type { SoundDef, VoicePlan } from '../src/sounds.js';

/**
 * The source game's theme, as data: four bars over a 55 Hz root, an arpeggio on nine of
 * sixteen steps, a walking bass, a kick on the quarters and a hat on the offbeats, at 112 bpm.
 */
const THEME: Song = {
  bpm: 112,
  steps: 16,
  rootHz: 55,
  progression: [3, 10, 0, 8],
  seed: 7,
  tracks: [
    {
      id: 'bass',
      melodic: true,
      voice: { wave: 'triangle', gain: 0.06, hold: 0.34, cutoff: 420 },
      notes: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 11 }, { step: 14 }],
    },
    {
      id: 'arp',
      melodic: true,
      bars: [0, 2],
      voice: { wave: 'square', gain: 0.028, hold: 0.3, cutoff: 2800 },
      notes: [
        { step: 0, semis: 12 },
        { step: 3, semis: 24 },
        { step: 6, semis: 19 },
        { step: 10, semis: 19 },
        { step: 14, semis: 15 },
      ],
    },
    {
      id: 'kick',
      voice: { wave: 'sine', gain: 0.16, hold: 0.16, sweepTo: 0.35, fixedHz: 125 },
      notes: [{ step: 0 }, { step: 4 }, { step: 8 }, { step: 12 }],
    },
    {
      id: 'hat',
      minIntensity: 0.5,
      voice: { wave: 'noise', gain: 0.035, hold: 0.055, highpass: 7200 },
      notes: [{ step: 2 }, { step: 6 }, { step: 10 }, { step: 14 }],
    },
  ],
};

/** 60 / bpm / (steps / 4) — the definition invariant 13 pins, written out once. */
const STEP_SEC = 60 / 112 / 4;

/**
 * The same track with its bar mask removed and a drop probability applied.
 *
 * The mask is *omitted* rather than set to `undefined`: `exactOptionalPropertyTypes` is on, so
 * `{ bars: undefined }` is a different type from a track with no `bars` at all — and the flag is
 * right, because a present-but-undefined field is exactly the shape that reads as "every bar"
 * in one place and as "no bars" in another.
 */
function everyBar(track: Track, drop: number): Track {
  const { bars: _mask, ...rest } = track;
  return { ...rest, drop };
}

interface Harness {
  readonly audio: Audio<string>;
  readonly plans: VoicePlan[];
  readonly deck: ReturnType<typeof createDeck>;
  at(seconds: number): void;
}

function harness(autoPump = false): Harness {
  let seconds = 0;
  const audio = createAudio<string>({
    sounds: {} as Record<string, SoundDef>,
    context: () => null,
    now: () => seconds,
  });
  const plans: VoicePlan[] = [];
  audio.onScheduled((plan) => plans.push({ ...plan }));
  return {
    audio,
    plans,
    deck: createDeck(audio, { autoPump }),
    at(next: number): void {
      seconds = next;
    },
  };
}

/** Every distinct start time emitted, in the order it first appeared. */
function starts(plans: readonly VoicePlan[]): number[] {
  const seen: number[] = [];
  for (const plan of plans) if (!seen.includes(plan.start)) seen.push(plan.start);
  return seen;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('validateSong', () => {
  it('passes the theme', () => {
    expect(validateSong(THEME)).toEqual([]);
  });

  it('reports a song with no tracks and a song with no progression', () => {
    const problems = validateSong({ ...THEME, tracks: [], progression: [] });
    expect(problems.map((p) => p.code)).toEqual(['bar-out-of-progression', 'no-tracks']);
    expect(problems.every((p) => p.track === null)).toBe(true);
  });

  it('reports a tempo that cannot produce step times at all', () => {
    expect(validateSong({ ...THEME, bpm: 0 })[0]?.message).toContain('bpm is 0');
    expect(validateSong({ ...THEME, bpm: Number.NaN })[0]?.code).toBe('tempo');
  });

  it('reports a tempo that is a dirge or a drill', () => {
    expect(validateSong({ ...THEME, bpm: 20 }).map((p) => p.code)).toEqual(['tempo']);
    expect(validateSong({ ...THEME, bpm: 260 }).map((p) => p.code)).toEqual(['tempo']);
  });

  it('holds the rest rule against melody only', () => {
    // The rule that could have been quietly widened and was not: a note on every step is a
    // drill, and a hat that fills every offbeat is correct.
    const everyStep: Track = {
      id: 'lead',
      melodic: true,
      voice: { wave: 'square', gain: 0.02, hold: 0.1 },
      notes: Array.from({ length: 16 }, (_, step) => ({ step })),
    };
    const problems = validateSong({ ...THEME, tracks: [everyStep] });
    expect(problems.map((p) => p.code)).toEqual(['no-rests']);
    expect(problems[0]?.track).toBe('lead');

    const percussion: Track = { ...everyStep, id: 'hat', melodic: false };
    expect(validateSong({ ...THEME, tracks: [percussion] })).toEqual([]);
  });

  it('takes three quarters of the bar as the boundary, not near it', () => {
    const twelve = Array.from({ length: 12 }, (_, step) => ({ step }));
    const eleven = twelve.slice(0, 11);
    const track = (notes: readonly { step: number }[]): Track => ({
      id: 'lead',
      melodic: true,
      voice: { wave: 'square', gain: 0.02, hold: 0.1 },
      notes,
    });
    expect(validateSong({ ...THEME, tracks: [track(twelve)] }).map((p) => p.code)).toEqual(['no-rests']);
    expect(validateSong({ ...THEME, tracks: [track(eleven)] })).toEqual([]);
  });

  it('counts a repeated step once, so a chord is not mistaken for a busy melody', () => {
    const chordy: Track = {
      id: 'lead',
      melodic: true,
      voice: { wave: 'square', gain: 0.02, hold: 0.1 },
      notes: [
        { step: 0, semis: 0 },
        { step: 0, semis: 4 },
        { step: 0, semis: 7 },
      ],
    };
    expect(validateSong({ ...THEME, tracks: [chordy] })).toEqual([]);
  });

  it('reports a step that lands outside the bar', () => {
    const problems = validateSong({
      ...THEME,
      tracks: [{ id: 'bass', voice: { wave: 'sine', gain: 0.05, hold: 0.2 }, notes: [{ step: 16 }, { step: -1 }] }],
    });
    expect(problems.map((p) => p.code)).toEqual(['step-out-of-bar', 'step-out-of-bar']);
    expect(problems[0]?.message).toContain('outside [0, 16)');
  });

  it('reports a bar mask that points past the progression, which is a part that never plays', () => {
    const problems = validateSong({
      ...THEME,
      tracks: [{ id: 'arp', bars: [0, 9], voice: { wave: 'sine', gain: 0.05, hold: 0.2 }, notes: [{ step: 0 }] }],
    });
    expect(problems.map((p) => p.code)).toEqual(['bar-out-of-progression']);
    expect(problems[0]?.message).toContain('silent forever');
  });

  it('reports a step that every track lands on too loudly', () => {
    const loud = THEME.tracks.map((track) => ({ ...track, voice: { ...track.voice, gain: 0.3 } }));
    const problems = validateSong({ ...THEME, tracks: loud });
    expect(problems.map((p) => p.code)).toEqual(['clips']);
    expect(problems[0]?.message).toContain('one step sums to 0.90');
  });
});

describe('the deck refuses a song it cannot play', () => {
  it('names the field, per rule 9', () => {
    const { deck, audio } = harness();
    expect(() => deck.play({ ...THEME, bpm: 0 })).toThrow(/deck\.play: song\.bpm/);
    expect(() => deck.play({ ...THEME, steps: 0 })).toThrow(/deck\.play: song\.steps/);
    expect(() => deck.play({ ...THEME, steps: 1.5 })).toThrow(/expected an integer/);
    expect(() => deck.play({ ...THEME, rootHz: 0 })).toThrow(/deck\.play: song\.rootHz/);
    expect(() => deck.play({ ...THEME, progression: [] })).toThrow(/deck\.play: song\.progression/);
    expect(() => deck.play({ ...THEME, seed: Number.NaN })).toThrow(/deck\.play: song\.seed/);
    audio.dispose();
  });

  it('is silent, not loud, about everything else', () => {
    const { deck } = harness();
    expect(() => {
      deck.pump();
      deck.stop();
      deck.setIntensity(Number.NaN);
      deck.setTrackMuted('nobody', true);
    }).not.toThrow();
    expect(deck.playing).toBe(false);
  });
});

describe('the sequencer is pinned to the audio clock', () => {
  it('emits an exact arithmetic sequence however irregularly it is pumped', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    for (const time of [0.37, 1.02, 1.021, 2.9, 3.0, 3.0001, 7.5]) {
      at(time);
      deck.pump();
    }
    const times = starts(plans);
    // Steps with no note on them emit nothing, so the sequence is the *grid*, not the plans:
    // every start is exactly one of its points, and no point is visited twice or out of order.
    expect(times.length).toBeGreaterThan(30);
    let previous = -1;
    for (const time of times) {
      const step = Math.round(time / STEP_SEC);
      // Not "close to" — exactly the expression the deck computes, so a drift of one float
      // would fail here. A drifting sequencer sounds drunk long before it sounds wrong.
      expect(time).toBe(step * STEP_SEC);
      expect(step).toBeGreaterThan(previous);
      previous = step;
    }
  });

  it('schedules ahead by the whole horizon and no further', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: 0 });
    const times = starts(plans);
    expect(times.at(-1)).toBeLessThan(LOOKAHEAD_SEC);
    expect((times.at(-1) ?? 0) + STEP_SEC).toBeGreaterThanOrEqual(LOOKAHEAD_SEC);
  });

  it('schedules nothing twice, however many times it is pumped inside one step', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: 0 });
    const after = plans.length;
    for (let i = 0; i < 10; i += 1) deck.pump();
    expect(plans).toHaveLength(after);
  });

  it('skips nothing across a one-second gap, and emits it in order', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    const before = starts(plans).length;
    at(1);
    deck.pump();
    const times = starts(plans);
    expect(times.length).toBeGreaterThan(before);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1] ?? 0);
    }
  });

  it('gives up on catching up rather than scheduling ten minutes of notes in one frame', () => {
    // The one place a step is deliberately skipped. A game pumping from rAF alone gets 0 Hz in
    // a hidden tab; a strict catch-up would try to schedule three hundred thousand notes.
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    at(600);
    deck.pump();
    expect(plans.length).toBeLessThan(200);
    // And it lands back on the grid rather than beside it.
    const late = starts(plans).filter((time) => time > 500);
    for (const time of late) {
      expect(Math.abs(time / STEP_SEC - Math.round(time / STEP_SEC))).toBeLessThan(1e-9);
    }
  });

  it('never changes tempo, whatever the intensity does', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    deck.setIntensity(0);
    at(2);
    deck.pump();
    // Gating a track removes notes; it must not move the grid the remaining ones sit on.
    for (const time of starts(plans)) {
      expect(time).toBe(Math.round(time / STEP_SEC) * STEP_SEC);
    }
  });
});

describe('what the notes are', () => {
  it('puts every note on the music bus, named by its track', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: 0 });
    expect(plans.every((plan) => plan.bus === 'music')).toBe(true);
    expect(new Set(plans.map((plan) => plan.source))).toEqual(new Set(['bass', 'arp', 'kick', 'hat']));
  });

  it('follows the progression: the same step in two bars is two different pitches', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    at(16 * STEP_SEC);
    deck.pump();
    const bass = plans.filter((plan) => plan.source === 'bass');
    const barOne = bass.find((plan) => plan.start === 0);
    const barTwo = bass.find((plan) => plan.start === 16 * STEP_SEC);
    expect(barOne?.hz).toBeGreaterThan(0);
    expect(barTwo?.hz).not.toBe(barOne?.hz);
  });

  it('gives percussion a fixed pitch and a sweep, because that is what a kick is', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: 0 });
    const kick = plans.find((plan) => plan.source === 'kick');
    expect(kick?.hz).toBe(125);
    expect(kick?.toHz).toBe(125 * 0.35);
  });

  it('rests a bar-masked track out of the bars it does not speak on', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    at(3 * 16 * STEP_SEC);
    deck.pump();
    const bars = plans
      .filter((plan) => plan.source === 'arp')
      .map((plan) => Math.floor(Math.round(plan.start / STEP_SEC) / 16) % 4);
    expect(new Set(bars)).toEqual(new Set([0, 2]));
  });

  it('fades in over the notes rather than jumping to full', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: 1 });
    const kicks = plans.filter((plan) => plan.source === 'kick');
    // The step at the very start of the fade is silent, and a silent note is not scheduled at
    // all rather than scheduled at zero gain — a voice nobody can hear still costs a node.
    expect(kicks[0]?.start).toBeGreaterThan(0);
    expect(kicks[0]?.gain).toBeGreaterThan(0);
    expect(kicks[0]?.gain).toBeLessThan(0.16);
    // And it climbs: later notes inside the fade are louder than earlier ones.
    expect(kicks[1]?.gain).toBeGreaterThan(kicks[0]?.gain ?? 1);
  });
});

describe('the same seed is the same twenty minutes', () => {
  const dropped: Song = {
    ...THEME,
    tracks: THEME.tracks.map((track) => (track.id === 'arp' ? everyBar(track, 0.5) : track)),
  };

  function run(seed: number): string[] {
    const { deck, plans, at } = harness();
    deck.play({ ...dropped, seed }, { fadeSec: 0 });
    for (let time = 1; time <= 20; time += 1) {
      at(time);
      deck.pump();
    }
    return plans.map((plan) => `${plan.source}@${String(plan.start)}:${String(plan.hz)}`);
  }

  it('produces an identical plan sequence for the same seed', () => {
    expect(run(1)).toEqual(run(1));
  });

  it('produces a different one for a different seed', () => {
    expect(run(1)).not.toEqual(run(2));
  });

  it('drops nothing at drop 0 and everything at drop 1', () => {
    const none = harness();
    none.deck.play(
      { ...THEME, tracks: [everyBar(THEME.tracks[1] as Track, 0)] },
      { fadeSec: 0 },
    );
    expect(none.plans.length).toBeGreaterThan(0);

    const all = harness();
    all.deck.play(
      { ...THEME, tracks: [everyBar(THEME.tracks[1] as Track, 1)] },
      { fadeSec: 0 },
    );
    expect(all.plans).toEqual([]);
  });

  it('does not let one track shift another, which is why the roll is stateless', () => {
    // Rolling from a shared stream would make the arp's notes depend on how many notes the
    // bass had already played. Muting the bass proves it does not.
    const withDrop: Song = {
      ...THEME,
      tracks: THEME.tracks.map((track) => (track.id === 'arp' ? everyBar(track, 0.5) : track)),
    };
    const before = harness();
    before.deck.play(withDrop, { fadeSec: 0 });
    const arpBefore = before.plans.filter((plan) => plan.source === 'arp').map((plan) => plan.start);

    const after = harness();
    after.deck.setTrackMuted('bass', true);
    after.deck.play(withDrop, { fadeSec: 0 });
    const arpAfter = after.plans.filter((plan) => plan.source === 'arp').map((plan) => plan.start);

    expect(arpAfter).toEqual(arpBefore);
  });
});

describe('intensity gates tracks and nothing else', () => {
  it('silences a track below its threshold and leaves the rest where they were', () => {
    const quiet = harness();
    quiet.deck.setIntensity(0.2);
    quiet.deck.play(THEME, { fadeSec: 0 });
    expect(quiet.plans.some((plan) => plan.source === 'hat')).toBe(false);

    const busy = harness();
    busy.deck.setIntensity(1);
    busy.deck.play(THEME, { fadeSec: 0 });
    expect(busy.plans.some((plan) => plan.source === 'hat')).toBe(true);

    // The tracks that were speaking either way speak at exactly the same times.
    const bassQuiet = quiet.plans.filter((plan) => plan.source === 'bass').map((plan) => plan.start);
    const bassBusy = busy.plans.filter((plan) => plan.source === 'bass').map((plan) => plan.start);
    expect(bassQuiet).toEqual(bassBusy);
  });

  it('speaks at exactly its threshold, not above it', () => {
    const { deck, plans } = harness();
    deck.setIntensity(0.5);
    deck.play(THEME, { fadeSec: 0 });
    expect(plans.some((plan) => plan.source === 'hat')).toBe(true);
  });

  it('clamps and reports what it was given', () => {
    const { deck } = harness();
    deck.setIntensity(9);
    expect(deck.intensity).toBe(1);
    deck.setIntensity(-1);
    expect(deck.intensity).toBe(0);
    deck.setIntensity(Number.NaN);
    expect(deck.intensity).toBe(0);
  });
});

describe('muting a track', () => {
  it('takes it out and puts it back', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    deck.setTrackMuted('kick', true);
    at(2);
    deck.pump();
    const afterMute = plans.filter((plan) => plan.source === 'kick').length;

    deck.setTrackMuted('kick', false);
    at(4);
    deck.pump();
    expect(plans.filter((plan) => plan.source === 'kick').length).toBeGreaterThan(afterMute);
  });
});

describe('play and stop', () => {
  it('replaces whatever was playing rather than layering it', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    at(1);
    plans.length = 0;
    deck.play({ ...THEME, tracks: [THEME.tracks[2] as Track] }, { fadeSec: 0 });
    expect(new Set(plans.map((plan) => plan.source))).toEqual(new Set(['kick']));
    // And the new song starts its own grid, from now.
    expect(starts(plans)[0]).toBe(1);
  });

  it('reports playing while it plays and not after a stop', () => {
    const { deck } = harness();
    expect(deck.playing).toBe(false);
    deck.play(THEME, { fadeSec: 0 });
    expect(deck.playing).toBe(true);
    deck.stop({ fadeSec: 0 });
    expect(deck.playing).toBe(false);
  });

  it('lets the notes inside the horizon sound, fading, and then stops scheduling', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    plans.length = 0;
    deck.stop({ fadeSec: 1 });
    at(0.5);
    deck.pump();
    // Notes inside the fade still arrive, quieter than they would have been.
    const kicks = plans.filter((plan) => plan.source === 'kick');
    for (const kick of kicks) expect(kick.gain).toBeLessThan(0.16);
    at(5);
    deck.pump();
    const total = plans.length;
    at(9);
    deck.pump();
    expect(plans).toHaveLength(total);
  });

  it('stops instantly on a zero fade', () => {
    const { deck, plans, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    deck.stop({ fadeSec: 0 });
    plans.length = 0;
    at(3);
    deck.pump();
    expect(plans).toEqual([]);
  });

  it('ignores a stop when nothing is playing', () => {
    const { deck } = harness();
    expect(() => deck.stop()).not.toThrow();
    expect(deck.playing).toBe(false);
  });
});

describe('the pump timer', () => {
  it('runs itself, so a game never has to', () => {
    vi.useFakeTimers();
    const { deck, plans, audio } = harness(true);
    deck.play(THEME, { fadeSec: 0 });
    const after = plans.length;
    // The injected clock does not move, so this proves the timer fires and pumps — not that
    // it schedules anything new.
    vi.advanceTimersByTime(PUMP_INTERVAL_MS * 3);
    expect(plans).toHaveLength(after);
    audio.dispose();
    // And it is gone with the engine: no timer outlives a disposed game.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be turned off entirely for a host with its own scheduler', () => {
    vi.useFakeTimers();
    const { audio } = harness(false);
    expect(vi.getTimerCount()).toBe(0);
    audio.dispose();
  });
});

describe('teardown', () => {
  it('stops with the engine', () => {
    const { deck, plans, audio, at } = harness();
    deck.play(THEME, { fadeSec: 0 });
    audio.dispose();
    plans.length = 0;
    at(3);
    deck.pump();
    expect(plans).toEqual([]);
    expect(deck.playing).toBe(false);
  });

  it('refuses to start on a disposed engine, quietly', () => {
    const { deck, audio, plans } = harness();
    audio.dispose();
    deck.play(THEME, { fadeSec: 0 });
    expect(plans).toEqual([]);
    expect(deck.playing).toBe(false);
  });
});

describe('the adversarial songs', () => {
  it('plays a song with no seed, which is the same as seed 0', () => {
    const { bpm, steps, rootHz, progression, tracks } = THEME;
    const unseeded: Song = { bpm, steps, rootHz, progression, tracks };
    const a = harness();
    a.deck.play(unseeded, { fadeSec: 0 });
    const b = harness();
    b.deck.play({ ...unseeded, seed: 0 }, { fadeSec: 0 });
    expect(a.plans.map((plan) => plan.start)).toEqual(b.plans.map((plan) => plan.start));
  });

  it('skips a hole in a track list', () => {
    const holed = new Array<Track>(2);
    holed[1] = THEME.tracks[2] as Track;
    const { deck, plans } = harness();
    deck.play({ ...THEME, tracks: holed }, { fadeSec: 0 });
    expect(new Set(plans.map((plan) => plan.source))).toEqual(new Set(['kick']));
  });

  it('honours a track voice with its own attack, and folds it into the note end', () => {
    const pad: Track = {
      id: 'pad',
      voice: { wave: 'triangle', gain: 0.05, hold: 1, attack: 0.5, cutoff: 800 },
      notes: [{ step: 0 }],
    };
    const { deck, plans } = harness();
    deck.play({ ...THEME, tracks: [pad] }, { fadeSec: 0 });
    const note = plans[0];
    expect((note?.end ?? 0) - (note?.start ?? 0)).toBe(1.5);
  });

  it('takes a NaN fade as the default rather than as no fade', () => {
    const { deck, plans } = harness();
    deck.play(THEME, { fadeSec: Number.NaN });
    // The default fade is 0.6 s, so the note at step 0 is silent and is not scheduled.
    expect(plans.every((plan) => plan.start > 0)).toBe(true);
    expect(() => deck.stop({ fadeSec: Number.NaN })).not.toThrow();
  });

  it('runs a pump timer by default, with no options object at all', () => {
    vi.useFakeTimers();
    let seconds = 0;
    const audio = createAudio<string>({
      sounds: {} as Record<string, SoundDef>,
      context: () => null,
      now: () => seconds,
    });
    const plans: VoicePlan[] = [];
    audio.onScheduled((plan) => plans.push({ ...plan }));
    const deck = createDeck(audio);
    deck.play(THEME, { fadeSec: 0 });
    const before = plans.length;
    seconds = 3;
    vi.advanceTimersByTime(PUMP_INTERVAL_MS);
    expect(plans.length).toBeGreaterThan(before);
    audio.dispose();
  });
});

describe('a deck on something that is not one of our engines', () => {
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
    const deck = createDeck(foreign);
    expect(() => {
      deck.play(THEME);
      deck.pump();
      deck.stop();
    }).not.toThrow();
    expect(deck.playing).toBe(false);
  });
});
