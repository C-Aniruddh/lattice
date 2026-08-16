/**
 * The music deck — opt-in, and the minimum that survives an hour.
 *
 * A sequencer is the difference between a game with sound and a game with a soundtrack, so it
 * stays in the package; but it is behind its own factory rather than a member of `Audio`, so a
 * game that never imports {@link createDeck} never ships it. That matters against a 12 kB
 * budget, and it makes the ranking honest: the bed is what a small game reaches for first.
 *
 * ## The five properties that make a loop survive an hour behind a spreadsheet
 *
 * 1. **It rests.** The melody speaks on well under three quarters of the steps — a note on
 *    every step is a drill. Percussion is exempt and obeys the opposite rule: a steady hat is
 *    the thing a listener stops hearing and starts moving to. {@link validateSong} enforces the
 *    first and knows about the second, which is what {@link Track.melodic} is for.
 * 2. **It is mixed under the information.** Every note is quieter than the quietest sound that
 *    means something. A theme that buries the alarm gets the whole game muted — and muting to
 *    escape the music also loses the alarm.
 * 3. **The harmony is one loop, rotated.** `C-G-Am-F` is `Am-F-C-G` started elsewhere; the same
 *    four chords read bright or wistful depending only on which one lands first.
 * 4. **Nothing is bright.** Every note goes through a low-pass. Brightness is what makes a loop
 *    nag.
 * 5. **Bars are not identical.** Two cheap deterministic mechanisms remove the seam without a
 *    composer: a per-track bar mask ({@link Track.bars}) and a seeded per-note {@link Track.drop},
 *    rolled from `hash3(seed, bar, step, track)` — stateless, so a muted track cannot shift what
 *    every other track plays, and the same song is the same twenty minutes on every machine.
 *
 * Plus **intensity**, the deck's version of the bed's level and the same 0–1 number. Tempo
 * never changes; a tempo change mid-loop is a mistake you cannot un-hear.
 */

import { clamp, expectFinite, expectInt, expectNonEmpty, expectRange, hash3, toUnit } from '@lattice/core';

import { internalsOf, type Audio, type EngineInternals } from './engine.js';
import { everyInterval } from './host.js';
import type { Wave } from './sounds.js';
import { createVoiceRequest, detuned } from './voice.js';

/**
 * How far ahead the deck schedules, in seconds.
 *
 * This number is about background tabs and nothing else. `setInterval` is throttled to a
 * second or more in a hidden tab, so a horizon shorter than that leaves audible gaps the
 * moment a player changes tab — the source game's 250 ms horizon is fine in the foreground and
 * stutters in the background. Notes inside the horizon are already pinned to the audio clock
 * and sound whatever the timer does.
 */
export const LOOKAHEAD_SEC = 1.5;

/** How often the deck's own timer pumps, in milliseconds. Comfortably inside {@link LOOKAHEAD_SEC}. */
export const PUMP_INTERVAL_MS = 200;

/**
 * The furthest behind the deck will catch up before jumping to the grid's current step.
 *
 * The one place a step is deliberately skipped, and it exists because `pump()` is public: a
 * game driving it from `requestAnimationFrame` alone gets 0 Hz in a hidden tab, and ten
 * minutes later a strict catch-up would try to schedule three hundred thousand notes in one
 * frame. Well above the worst timer throttling, so ordinary operation never reaches it.
 */
const CATCH_UP_SEC = 4;

/**
 * The summed-gain ceiling for one step of music.
 *
 * Lower than the one-shot ceiling on purpose. Master and the music bus already sit under 1, and
 * what is left has to carry the sounds that mean something; a theme that competes with them is
 * a theme that gets the whole game muted.
 */
const MUSIC_CEILING = 0.5;

/** Fraction of a bar's steps a melodic track may speak on before it stops leaving room to breathe. */
const REST_RATIO = 0.75;

/** Default fade for {@link MusicDeck.play} and {@link MusicDeck.stop}, in seconds. */
const DEFAULT_FADE_SEC = 0.6;

/**
 * The instrument a track plays. It has no pitch of its own: the sequencer supplies that from
 * the chord, which is what lets one progression change every track's notes at once.
 */
export interface TrackVoice {
  readonly wave: Wave;
  /** Peak gain of one note. See {@link validateSong} — these sum when tracks land on a step together. */
  readonly gain: number;
  /** Seconds of decay. A note longer than a step is a legato line; longer than two is a drone. */
  readonly hold: number;
  /** Override the fixed attack. Raise it and a lead becomes a pad. */
  readonly attack?: number;
  /** Low-pass corner in Hz. Give every track one: brightness is what makes a loop nag. */
  readonly cutoff?: number;
  /** High-pass corner in Hz. For a hat — everything below about 6 kHz makes one sound like a cough. */
  readonly highpass?: number;
  /**
   * Sweep to this **multiple** of the note's pitch. A kick drum is a sine at 125 Hz swept to
   * `0.35` in a tenth of a second; there is no other way to get a kick out of an oscillator,
   * and a sample would mean shipping a binary for the sake of one thud.
   */
  readonly sweepTo?: number;
  /** Fixed Hz, ignoring the chord entirely. Percussion does not follow the harmony. */
  readonly fixedHz?: number;
}

/** A step within the bar, and how far above the bar's root it speaks. Omit `semis` for the root. */
export interface Note {
  /** 0-based, inside `[0, song.steps)`. */
  readonly step: number;
  /** Semitones above the bar's root. */
  readonly semis?: number;
}

/** One instrument's part. Tracks are independent: muting one cannot move another's notes. */
export interface Track {
  /** Stable id, for {@link MusicDeck.setTrackMuted}, for `VoicePlan.source`, and for reporting. */
  readonly id: string;
  readonly voice: TrackVoice;
  readonly notes: readonly Note[];
  /**
   * Which bars of the progression this track speaks on, by index. Omit for every bar.
   *
   * The cheap anti-seam: `bars: [0, 2]` sits the arpeggio out of half the progression, so the
   * loop stops announcing where it begins.
   */
  readonly bars?: readonly number[];
  /** Silent below this intensity, 0–1. Default 0 — always speaking. */
  readonly minIntensity?: number;
  /**
   * 0–1 chance a note is dropped, decided by the song's seeded hash rather than by chance.
   * Default 0; keep it under about 0.2, past which the part stops being recognisable.
   */
  readonly drop?: number;
  /**
   * Whether this track carries melody. Only melodic tracks are held to the rest rule in
   * {@link validateSong}: a hat that fills every offbeat is correct and a lead that does is not.
   */
  readonly melodic?: boolean;
}

/** A whole piece, as data. Everything a deck needs and nothing about how it is played. */
export interface Song {
  /** Beats per minute. Never changes while playing — a tempo change mid-loop cannot be un-heard. */
  readonly bpm: number;
  /** Steps per bar. 16 is sixteenth notes. */
  readonly steps: number;
  /** Root of the whole piece in Hz. Low — 55 is A1. */
  readonly rootHz: number;
  /** Semitone offset of each bar's root. Its length is the loop length in bars. */
  readonly progression: readonly number[];
  readonly tracks: readonly Track[];
  /** Seed for {@link Track.drop}. Same seed, same twenty minutes, on every machine. Default 0. */
  readonly seed?: number;
}

/** One thing wrong with a song. Same class of check as `validateSounds`, same reasons. */
export interface SongProblem {
  /** `null` when the fault is the song's rather than one track's. */
  readonly track: string | null;
  readonly code: 'tempo' | 'no-rests' | 'clips' | 'step-out-of-bar' | 'bar-out-of-progression' | 'no-tracks';
  /** Names the mistake with the numbers in it. */
  readonly message: string;
}

/** A running deck. One song at a time; build it with {@link createDeck}. */
export interface MusicDeck {
  /** Whether a song is scheduling. False during a fade-out, which is still audible. */
  readonly playing: boolean;
  /** 0–1. Gates tracks by {@link Track.minIntensity}. */
  readonly intensity: number;
  /**
   * Fade in over `fadeSec` (default 0.6) and replace whatever was playing.
   *
   * @throws RangeError if the song cannot be played at all — a bpm of 0, a step count that is
   *   not a positive integer, an empty progression. Those are programmer errors and the caller
   *   wants the line number; a *bad-sounding* song is {@link validateSong}'s business and never
   *   throws.
   */
  play(song: Song, options?: { readonly fadeSec?: number }): void;
  /** Fade out and stop scheduling. Notes already inside the horizon still sound. */
  stop(options?: { readonly fadeSec?: number }): void;
  /** 0–1, clamped. Gates tracks by `minIntensity`. Never changes tempo. */
  setIntensity(intensity: number): void;
  /** For a settings panel that offers "no drums", and for a test that wants one track's plans. */
  setTrackMuted(trackId: string, muted: boolean): void;
  /**
   * Schedule everything due inside {@link LOOKAHEAD_SEC}. Idempotent, safe to over-call, and
   * safe to call at an irregular rate — notes are pinned to the audio clock, not to whoever
   * called this.
   *
   * The deck runs its own {@link PUMP_INTERVAL_MS} timer unless `autoPump: false`, so a game
   * never has to call this. It is public because a test needs to drive time by hand and
   * because a host with its own scheduler should be able to. **Never drive it from
   * `requestAnimationFrame` alone**: rAF is 0 Hz in a hidden tab, so the music would stop the
   * moment the player changed tabs.
   */
  pump(): void;
}

/**
 * Check a song for the faults that make it unlistenable rather than unplayable.
 *
 * Returns problems rather than throwing, in song order: the song's own faults first, then each
 * track's. A shipped game must not refuse to start because a hat is 0.02 too loud.
 */
export function validateSong(song: Song): readonly SongProblem[] {
  const problems: SongProblem[] = [];
  const report = (track: string | null, code: SongProblem['code'], message: string): void => {
    problems.push({ track, code, message });
  };

  if (!Number.isFinite(song.bpm) || song.bpm <= 0) {
    report(null, 'tempo', `bpm is ${String(song.bpm)}; a song needs a positive tempo to have step times at all`);
  } else if (song.bpm < 40 || song.bpm > 200) {
    report(
      null,
      'tempo',
      `bpm is ${String(song.bpm)}; outside 40–200 a loop reads as a dirge or as a drill rather than as a pulse`,
    );
  }
  if (song.progression.length === 0) {
    report(null, 'bar-out-of-progression', 'the progression is empty, so no bar has a root');
  }
  if (song.tracks.length === 0) {
    report(null, 'no-tracks', 'the song has no tracks, so playing it is silence');
  }

  // The worst case a step can carry: every track speaking at once, ignoring bar masks and
  // drops, because those are the cases that happen to line up rather than the ones that do not.
  const perStep = new Map<number, number>();
  for (const track of song.tracks) {
    for (const note of track.notes) {
      perStep.set(note.step, (perStep.get(note.step) ?? 0) + track.voice.gain);
    }
  }
  let peak = 0;
  for (const sum of perStep.values()) if (sum > peak) peak = sum;
  if (peak > MUSIC_CEILING) {
    report(
      null,
      'clips',
      `one step sums to ${peak.toFixed(2)}, ceiling is ${String(MUSIC_CEILING)} — a theme that competes with the sounds carrying information is a theme that gets the whole game muted`,
    );
  }

  for (const track of song.tracks) {
    for (const note of track.notes) {
      if (!Number.isInteger(note.step) || note.step < 0 || note.step >= song.steps) {
        report(
          track.id,
          'step-out-of-bar',
          `${track.id} has a note at step ${String(note.step)}, outside [0, ${String(song.steps)})`,
        );
      }
    }
    for (const bar of track.bars ?? []) {
      if (!Number.isInteger(bar) || bar < 0 || bar >= song.progression.length) {
        report(
          track.id,
          'bar-out-of-progression',
          `${track.id} speaks on bar ${String(bar)}, outside [0, ${String(song.progression.length)}) — that part is silent forever`,
        );
      }
    }
    if (track.melodic === true) {
      const speaking = new Set(track.notes.map((note) => note.step));
      if (speaking.size >= song.steps * REST_RATIO) {
        report(
          track.id,
          'no-rests',
          `${track.id} speaks on ${String(speaking.size)} of ${String(song.steps)} steps; a melody with no room to breathe is a drill`,
        );
      }
    }
  }

  return problems;
}

/**
 * Stand up a deck on an engine. Opt-in: a game that does not call this does not ship the
 * sequencer.
 *
 * Music is **off until something calls {@link MusicDeck.play}**, and "muted" is not "not
 * playing". Music nobody asked for is the fastest route to a permanently muted game, and
 * muting to escape music also loses the alarms, which are the sounds doing actual work — so
 * the engine starts with the music bus *unmuted* and no deck running. A game that restores a
 * saved mixer with `music` muted and then calls `play()` would otherwise never work out why
 * nothing happened.
 */
export function createDeck<Ids extends string>(
  audio: Audio<Ids>,
  options?: { readonly autoPump?: boolean },
): MusicDeck {
  const engine = internalsOf(audio);
  const request = createVoiceRequest();
  const mutedTracks = new Set<string>();

  let song: Song | null = null;
  let stepSec = 0;
  let startedAt = 0;
  let nextStep = 0;
  let intensity = 1;
  let playing = false;
  let fadeInSec = DEFAULT_FADE_SEC;
  let fadeOutSec = DEFAULT_FADE_SEC;
  let stopAt: number | null = null;

  const now = (): number => engine?.now() ?? 0;

  /** Schedule one step of one song. Pure apart from the one call that hands a voice down. */
  const scheduleStep = (device: EngineInternals, current: Song, absoluteStep: number, at: number): void => {
    const bar = Math.floor(absoluteStep / current.steps);
    const barIndex = bar % current.progression.length;
    const stepInBar = absoluteStep - bar * current.steps;
    const root = current.progression[barIndex] ?? 0;
    const seed = current.seed ?? 0;

    const fadeIn = fadeInSec > 0 ? clamp((at - startedAt) / fadeInSec, 0, 1) : 1;
    // `stopAt` is only ever set alongside a positive fade — a zero-fade stop drops the song
    // outright, so there is no division by zero to guard against here.
    const fadeOut = stopAt === null ? 1 : clamp((stopAt - at) / fadeOutSec, 0, 1);
    const fade = fadeIn * fadeOut;
    if (fade <= 0) return;

    for (let index = 0; index < current.tracks.length; index += 1) {
      const track = current.tracks[index];
      if (track === undefined) continue;
      if (mutedTracks.has(track.id)) continue;
      if (intensity < (track.minIntensity ?? 0)) continue;
      if (track.bars !== undefined && !track.bars.includes(barIndex)) continue;

      const voice = track.voice;
      for (const note of track.notes) {
        if (note.step !== stepInBar) continue;
        const drop = track.drop ?? 0;
        // Stateless: rolled from the coordinates, never from a stream. A track muted at load
        // must not shift what every other track plays, and it cannot, because nothing here
        // advances a cursor.
        if (drop > 0 && toUnit(hash3(seed, bar, stepInBar, index)) < drop) continue;

        const hz = voice.fixedHz ?? detuned(current.rootHz, root + (note.semis ?? 0));
        const attack = voice.attack !== undefined && voice.attack > 0 ? voice.attack : 0.006;
        request.source = track.id;
        request.bus = 'music';
        request.layer = index;
        request.wave = voice.wave;
        request.hz = hz;
        request.toHz = voice.sweepTo !== undefined ? hz * voice.sweepTo : hz;
        request.gain = voice.gain * fade;
        request.pan = 0;
        request.start = at;
        request.end = at + attack + Math.max(0, voice.hold);
        request.attack = attack;
        request.cutoff = voice.cutoff;
        request.highpass = voice.highpass;
        device.schedule(request);
      }
    }
  };

  const deck: MusicDeck = {
    get playing(): boolean {
      return playing;
    },

    get intensity(): number {
      return intensity;
    },

    play(next: Song, playOptions?: { readonly fadeSec?: number }): void {
      // Programmer errors, named at the line that made them. A song that cannot produce step
      // times would otherwise become a NaN frequency, which WebAudio accepts and renders as
      // nothing at all — the worst kind of silence to debug.
      expectRange(next.bpm, 1, 1000, 'deck.play: song.bpm');
      expectInt(next.steps, 'deck.play: song.steps');
      expectRange(next.steps, 1, 256, 'deck.play: song.steps');
      expectRange(next.rootHz, 1, 20000, 'deck.play: song.rootHz');
      expectNonEmpty(next.progression, 'deck.play: song.progression');
      if (next.seed !== undefined) expectFinite(next.seed, 'deck.play: song.seed');
      if (engine === undefined || engine.isDisposed()) return;

      song = next;
      stepSec = 60 / next.bpm / (next.steps / 4);
      startedAt = now();
      nextStep = 0;
      stopAt = null;
      playing = true;
      fadeInSec = Math.max(0, finiteOr(playOptions?.fadeSec, DEFAULT_FADE_SEC));
      deck.pump();
    },

    stop(stopOptions?: { readonly fadeSec?: number }): void {
      if (song === null) return;
      playing = false;
      fadeOutSec = Math.max(0, finiteOr(stopOptions?.fadeSec, DEFAULT_FADE_SEC));
      stopAt = now() + fadeOutSec;
      if (fadeOutSec === 0) song = null;
    },

    setIntensity(next: number): void {
      if (!Number.isFinite(next)) return;
      intensity = clamp(next, 0, 1);
    },

    setTrackMuted(trackId: string, muted: boolean): void {
      if (muted) mutedTracks.add(trackId);
      else mutedTracks.delete(trackId);
    },

    pump(): void {
      const current = song;
      if (current === null || engine === undefined || engine.isDisposed()) return;
      const at = now();
      const horizon = at + LOOKAHEAD_SEC;

      // Catch-up clamp. See CATCH_UP_SEC: without it, a game pumping from rAF alone would try
      // to schedule every step of a ten-minute background tab in one frame.
      const oldest = at - CATCH_UP_SEC;
      if (startedAt + nextStep * stepSec < oldest) {
        nextStep = Math.max(nextStep, Math.ceil((oldest - startedAt) / stepSec));
      }

      for (let time = startedAt + nextStep * stepSec; time < horizon; time = startedAt + nextStep * stepSec) {
        if (stopAt !== null && time >= stopAt) {
          song = null;
          playing = false;
          return;
        }
        scheduleStep(engine, current, nextStep, time);
        nextStep += 1;
      }
    },
  };

  if (engine !== undefined && (options?.autoPump ?? true)) {
    engine.scope.add(everyInterval(() => {
      deck.pump();
    }, PUMP_INTERVAL_MS));
  }
  if (engine !== undefined) {
    engine.scope.add(() => {
      song = null;
      playing = false;
    });
  }

  return deck;
}

/** A caller's number, or the default when it is absent or not finite. */
function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
