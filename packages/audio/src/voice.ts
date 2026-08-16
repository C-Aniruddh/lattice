/**
 * Policy: what may play, when, at what pitch — and the reused object a play turns into.
 *
 * This module is the reason the package is testable. Everything here is **pure and
 * clock-injected**: the throttle, the ladder and the voice ceiling take `now` as a parameter
 * and reach nothing. A headless run takes exactly the branch a browser takes and simply
 * renders nothing at the end of it, so `play()` returning `true` in Node is not a lie — it
 * means *accepted*, and the device is a separate question that `available` answers.
 *
 * The alternative, which was considered and refused, is a recording mock of WebAudio: forty
 * node types re-implemented, and every assertion about a sound becomes an assertion about the
 * mock. Splitting the decision from the node graph costs one interface and buys the whole
 * suite.
 *
 * Tier A except for one marked pitch multiplication. No clock, no randomness, no platform.
 */

import { ATTACK_SEC, SEMITONE, type BusName, type Layer, type SoundDef, type Wave } from './sounds.js';

/**
 * The writable form of a `VoicePlan`, plus the three fields only the renderer needs.
 *
 * Producers — one-shots, the bed, the deck — each own **one** of these forever and refill it
 * per voice. That is why `onScheduled` documents its argument as reused: the sequencer alone
 * emits eight of these a second, and a fresh object each time is a garbage collector pause
 * with a pleasant signature.
 *
 * It is a superset of `VoicePlan`, so one object serves both the listener and the renderer:
 * the extra fields describe the fixed chain (`attack`, `cutoff`, `highpass`) and are not part
 * of the public plan because a HUD has no use for a filter corner.
 */
export interface VoiceRequest {
  source: string;
  bus: BusName;
  layer: number;
  wave: Wave;
  hz: number;
  toHz: number;
  gain: number;
  pan: number;
  start: number;
  end: number;
  /** Seconds of attack. The renderer needs it; the plan's `end` already accounts for it. */
  attack: number;
  /** Low-pass corner in Hz, or `undefined` for no low-pass node. */
  cutoff: number | undefined;
  /** High-pass corner in Hz, or `undefined` for no high-pass node. */
  highpass: number | undefined;
}

/**
 * One reused request, zeroed.
 *
 * Call this once per producer and never in a loop — the whole point of the type is that it is
 * allocated at construction and refilled thereafter.
 */
export function createVoiceRequest(): VoiceRequest {
  return {
    source: '',
    bus: 'sfx',
    layer: 0,
    wave: 'sine',
    hz: 440,
    toHz: 440,
    gain: 0,
    pan: 0,
    start: 0,
    end: 0,
    attack: ATTACK_SEC,
    cutoff: undefined,
    highpass: undefined,
  };
}

/**
 * Multiply a frequency by a number of equal-tempered semitones.
 *
 * `@tier-b` — this is `pow` by another name, and ECMA-262 does not require it to be correctly
 * rounded, so two engines may disagree in the last bit. That is fine here and only here:
 * a frequency is a pixel, never a hash and never a save. Nothing in this package writes a
 * pitch to storage, and the deck's determinism rests on `hash3` over integers, not on this.
 */
export function detuned(hz: number, semitones: number): number {
  return semitones === 0 ? hz : hz * SEMITONE ** semitones;
}

/**
 * Fill a request from a layer recipe. Allocates nothing and reads no clock.
 *
 * `gainScale` is the per-play multiplier (distance falloff, a deck's fade); `semitones` is the
 * ladder step plus any per-play detune. `at` is when the *sound* starts — the layer's own
 * `delay` is added here, which is what makes a chord an arpeggio.
 */
export function fillRequest(
  request: VoiceRequest,
  source: string,
  bus: BusName,
  index: number,
  layer: Layer,
  at: number,
  gainScale: number,
  semitones: number,
  pan: number,
): void {
  const attack = layer.attack !== undefined && layer.attack > 0 ? layer.attack : ATTACK_SEC;
  const start = at + (layer.delay ?? 0);
  request.source = source;
  request.bus = bus;
  request.layer = index;
  request.wave = layer.wave;
  request.hz = detuned(layer.hz, semitones);
  request.toHz = detuned(layer.toHz ?? layer.hz, semitones);
  request.gain = layer.gain * gainScale;
  request.pan = pan;
  request.start = start;
  request.end = start + attack + Math.max(0, layer.hold);
  request.attack = attack;
  request.cutoff = layer.cutoff;
  request.highpass = layer.highpass;
}

/**
 * The three defences that stop a burst stacking, in one object with an injected clock.
 *
 * They are three because they fail differently. The **throttle** handles the repeat of one
 * sound — twenty `collect` calls in the same millisecond. The **ceiling** handles twenty
 * *different* sounds, which no per-sound gap can see. The **ladder** is not a defense at all;
 * it lives here because it is the same state, keyed the same way, and updated on exactly the
 * plays the throttle admits.
 *
 * Every method takes `now` in audio-clock **seconds**, the same base the notes are scheduled
 * in, so a throttle can never disagree with the notes it is throttling. Author-facing fields
 * stay in milliseconds because that is the unit a human reasons about; the conversion happens
 * here.
 */
export interface PlayPolicy {
  /**
   * One-shot voices whose scheduled end is still in the future.
   *
   * Counted by *scheduled end time*, never by an `onended` callback. A counter driven by
   * `onended` leaks: the bed's oscillators never end, so their callback never fires, the
   * counter never comes down, and a game that runs for an hour ends up permanently at the
   * ceiling and goes silent. This form also needs no device at all, which is what makes the
   * ceiling assertable in Node.
   */
  voices(now: number): number;

  /**
   * Decide whether a play is allowed right now.
   *
   * Returns the ladder step to detune by — **0 or more when accepted, −1 when rejected**. A
   * rejection is a drop and never a queue: a queued burst arrives after the moment that
   * caused it and reads as lag.
   *
   * Accepting records the play, so calling this twice per play walks the ladder twice.
   */
  admit(id: string, definition: SoundDef, layerCount: number, now: number): number;

  /** Count one scheduled voice against the ceiling until `end`. */
  hold(end: number): void;

  /** Forget every throttle, ladder and voice. For `dispose`, and for a test starting over. */
  clear(): void;
}

/**
 * Build the policy for one engine.
 *
 * @param maxVoices hard ceiling on one-shot voices in flight. A sound with more layers than
 *   this can never play; that is a table to fix rather than a case to special-case, because
 *   the alternative is emitting more voices than the ceiling names.
 */
export function createPlayPolicy(maxVoices: number): PlayPolicy {
  /** Scheduled end times of live voices, in `[0, live)`. Compacted in place, never reallocated. */
  const ends: number[] = [];
  let live = 0;
  const lastPlayed = new Map<string, number>();
  const ladderStep = new Map<string, number>();

  const prune = (now: number): number => {
    let write = 0;
    for (let read = 0; read < live; read += 1) {
      const end = ends[read];
      if (end !== undefined && end > now) {
        ends[write] = end;
        write += 1;
      }
    }
    live = write;
    return live;
  };

  return {
    voices(now: number): number {
      return prune(now);
    },

    admit(id: string, definition: SoundDef, layerCount: number, now: number): number {
      const last = lastPlayed.get(id);
      if (last !== undefined && now - last < definition.minGapMs / 1000) return -1;
      if (prune(now) + layerCount > maxVoices) return -1;

      let step = 0;
      const ladder = definition.ladder;
      if (ladder !== undefined && ladder.steps > 0) {
        // The window is measured from the *last play*, not from the first of the run, so a
        // player who keeps tapping keeps climbing and one who pauses starts again at the root.
        const within = last !== undefined && now - last < ladder.windowMs / 1000;
        step = within ? ((ladderStep.get(id) ?? 0) + 1) % ladder.steps : 0;
        ladderStep.set(id, step);
      }
      lastPlayed.set(id, now);
      return step;
    },

    hold(end: number): void {
      ends[live] = end;
      live += 1;
    },

    clear(): void {
      live = 0;
      ends.length = 0;
      lastPlayed.clear();
      ladderStep.clear();
    },
  };
}
