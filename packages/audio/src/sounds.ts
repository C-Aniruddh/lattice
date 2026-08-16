/**
 * The shared vocabulary, the shape of a sound, and the table validator.
 *
 * Everything else in this package is written in the words defined here, so this module
 * imports nothing from the rest of it and can be read first.
 *
 * ## Why a sound is a table row rather than a node graph
 *
 * A layer is **one fixed signal chain with the knobs exposed as numbers**:
 * `source → [highpass] → [lowpass] → gain envelope → [pan] → bus`, always, in that order,
 * with no way to say otherwise. Ten numbers an author may vary; nothing about the routing.
 *
 * That is not a simplification for its own sake. The moment routing is author-defined, the
 * clipping ceiling stops being checkable: a feedback delay at 0.9 turns a 0.16 chord into a
 * runaway and no static validator can see it. A fixed chain is what lets
 * {@link validateSounds} say, before a note has sounded, that this table cannot clip.
 *
 * Tier A throughout — no clock, no randomness, no platform. Safe to import in Node.
 */

/**
 * The five sources.
 *
 * `noise` is a shared, deterministically-filled white-noise buffer, looped; it is what makes
 * thunks, air and hi-hats possible without a sample. A `noise` layer ignores `hz` and
 * `toHz`, so a filter is the only thing shaping it — give one a `cutoff` or a `highpass` or
 * it is a full-spectrum hiss.
 *
 * There is deliberately no `custom` wave. A `PeriodicWave` is a Fourier table, which is an
 * asset in the shape of an array, and the moment one is possible somebody pastes a
 * 512-partial one into a config file and the package's zero-asset promise is gone.
 */
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

/**
 * The three buses, fixed and closed.
 *
 * Fixed because the reason buses exist at all is a player who wants the music off and the
 * alerts on, and that player needs the *same three switches* in every Lattice game. An open
 * bus registry gives every game a different settings panel and gives this package a graph it
 * can prove nothing about. Widening this union is a minor release with the evidence attached,
 * not a config option.
 */
export type BusId = 'music' | 'sfx' | 'ui';

/** The three buses plus the one they all feed. Nothing connects to the device except master. */
export type BusName = 'master' | BusId;

/**
 * Every bus name, in the order the mixer walks them. Master is first because it is the one
 * whose gain multiplies all the others, and a reader should meet it first.
 */
export const BUS_NAMES: readonly BusName[] = ['master', 'music', 'sfx', 'ui'];

/**
 * Hard ceiling on one-shot voices in flight. Past it, {@link SoundDef} plays are **dropped
 * rather than queued** — a queued burst arrives after the moment that caused it and reads as
 * lag, which is worse than the sound not happening.
 *
 * One layer is one voice, so a three-layer sound costs three. A sound with more layers than
 * the ceiling can therefore never play at all; that is a table to fix, not a case to special
 * case, because admitting it would mean emitting more voices than the ceiling names.
 */
export const MAX_VOICES = 24;

/**
 * Fixed attack, in seconds. Long enough to kill the leading-edge click that a gain stepping
 * from 0 to 0.3 in one sample produces, short enough that the sound still lands on the tap.
 *
 * Raise it per layer with {@link Layer.attack} for a swell; a longer attack is precisely how
 * a sound stops being a hit.
 */
export const ATTACK_SEC = 0.006;

/**
 * Equal temperament: the twelfth root of two, written out rather than computed.
 *
 * A literal and not `Math.pow(2, 1 / 12)` because `pow` is Tier B — not required by ECMA-262
 * to be correctly rounded — and a constant that differs in the last bit between two engines
 * is a constant that cannot be compared in a test with `toBe`. A detune that is not a
 * semitone sounds like a fault rather than like variation, which is why the ladder walks in
 * these and not in cents.
 */
export const SEMITONE = 1.0594630943592953;

/**
 * Time constant for every gain change made to an already-running node, in seconds.
 *
 * Assigning `gain.value` on a live node is an audible click; a volume slider that assigns
 * directly produces one click per pixel of travel. Every live parameter change in this
 * package goes through an exponential approach with this time constant instead. Below about
 * 10 ms the click comes back; above about 50 ms a settings panel feels broken.
 */
export const RAMP_SEC = 0.015;

/**
 * One oscillator or noise burst inside a sound.
 *
 * Layers within a sound play **together**; {@link Layer.delay} is what turns a chord into an
 * arpeggio. Their gains sum, which is why {@link validateSounds} exists.
 */
export interface Layer {
  /** Which of the five sources. `noise` ignores `hz` and `toHz`. */
  readonly wave: Wave;
  /** Starting frequency in Hz. Ignored when `wave` is `noise`. */
  readonly hz: number;
  /**
   * Sweep to this frequency across the layer's life.
   *
   * The ramp is exponential, always. Pitch is heard logarithmically, so a *linear* sweep from
   * 880 down to 190 spends most of its duration in the bottom octave and reads as a fault
   * rather than as a fall. Omit to hold `hz`.
   */
  readonly toHz?: number;
  /**
   * Peak gain, 0–1, before the sound's per-play gain, the bus and master.
   *
   * These sum across layers and WebAudio hard-clips above 1.0: a chord adding to 1.4 does not
   * play 40% louder, it plays distorted, and it distorts *differently* depending on what else
   * happens to overlap it — which is why it is miserable to diagnose by ear rather than with
   * {@link validateSounds}.
   */
  readonly gain: number;
  /**
   * Seconds of decay after the attack. This, and not `toHz`, is what makes a sound feel heavy
   * or brief; a hold of 2 s on a menu blip is what makes an interface feel slow.
   */
  readonly hold: number;
  /** Override {@link ATTACK_SEC}, in seconds. Raise it for a swell. */
  readonly attack?: number;
  /** Seconds before this layer starts, measured from the play. This is how a chord arpeggiates. */
  readonly delay?: number;
  /**
   * Low-pass corner in Hz. The single most useful knob in the table: it is the difference
   * between "a square wave" and "a distant announcement in a car park". Omit for no filter.
   */
  readonly cutoff?: number;
  /**
   * High-pass corner in Hz. Rare and specific — everything below about 6 kHz is what makes a
   * hi-hat sound like a cough. Giving both this and `cutoff` is a band-pass and costs one
   * extra node per voice.
   */
  readonly highpass?: number;
  /**
   * Static pan, −1…1.
   *
   * Almost always the wrong place for it: pan belongs to the *event* — where the thing was on
   * screen — not to the recipe. Set {@link PlayOptions.pan} instead. This exists for the
   * genuinely fixed case, a layer that is meant to sit off-center in every play.
   */
  readonly pan?: number;
}

/**
 * A sound, as a game author writes it.
 *
 * The **keys** of the table passed to `createAudio` become the id union, so there is no
 * `SoundId` type to keep in sync by hand and a typo at a call site is a compile error.
 */
export interface SoundDef {
  /**
   * Played together. At least one, and their overlapping gains must sum under full scale —
   * see {@link validateSounds}.
   */
  readonly layers: readonly Layer[];
  /**
   * Which bus this sound is mixed on. Default `'sfx'`.
   *
   * Put anything a player might reasonably want silenced *separately* on its own bus: the
   * interface clicks on `ui`, the world on `sfx`. A sound on the wrong bus is a player muting
   * more than they meant to.
   */
  readonly bus?: BusId;
  /**
   * Minimum milliseconds between two plays of this sound.
   *
   * **Why this is required rather than optional.** A COLLECT ALL button banks twenty
   * buildings in one tap: twenty `play('collect')` calls in the same millisecond. Twenty
   * stacked oscillators is not twenty times as satisfying — the gains sum past 1 and the
   * output clips into a click. Making the field optional means the author who most needs it
   * is exactly the author who omits it, so it is required and {@link validateSounds} rejects
   * a zero.
   */
  readonly minGapMs: number;
  /**
   * Successive plays inside `windowMs` step **up** the scale rather than repeating, wrapping
   * after `steps` and resetting once the player stops.
   *
   * This is what makes four taps in a row feel like a run rather than four identical blips.
   * A ladder rather than a random detune on purpose, and not only because `Math.random` is
   * banned in this kit: a repeat that moves *unpredictably* sounds broken, and one that moves
   * up a scale sounds alive.
   */
  readonly ladder?: { readonly steps: number; readonly windowMs: number };
  /**
   * Whether {@link PlayOptions.pan} is honoured for this sound.
   *
   * Defaults to `bus === 'sfx'`, which is the useful default: world events pan, and the
   * interface does not follow the camera. A menu click that moves in the stereo field as the
   * player drags the map is the most disorienting thing this package can do.
   */
  readonly spatial?: boolean;
}

/**
 * Per-event modulation. Everything here is about *this* play, never about the recipe.
 *
 * Every field is clamped rather than validated: these carry player- and camera-derived
 * numbers, and a `NaN` written to an `AudioParam` poisons that parameter for the life of the
 * node. A clamp at this boundary is the difference between one quiet sound and a voice that
 * is silent forever.
 */
export interface PlayOptions {
  /**
   * 0–1 multiplier on the whole sound. Distance falloff lives here, and it carries more than
   * pan does: an off-screen sound made *quieter* is far more legible than one made *left*.
   */
  readonly gain?: number;
  /** −1…1, clamped to ±`maxPan`. Ignored unless the sound is {@link SoundDef.spatial}. */
  readonly pan?: number;
  /** Semitones, applied on top of the ladder step. For pitching a sound by size or by tier. */
  readonly detune?: number;
  /**
   * Audio-clock seconds to start at. Omit for now. Use it to place a sound inside a beat —
   * it is the same clock `onScheduled` reports and the same clock the sequencer pins to.
   */
  readonly at?: number;
}

/**
 * What the engine decided to build, handed to every `onScheduled` listener — one call per
 * layer. Emitted by one-shots, by the deck and by a bed's layers alike; `source` is the sound
 * id, the track id, or `'bed'`.
 *
 * **This object is reused between calls.** It is emitted once per layer per play, which the
 * sequencer alone does eight times a second; a fresh object each time is a garbage collector
 * pause with a pleasant signature. Read it, or copy the fields you keep — do not retain it.
 */
export interface VoicePlan {
  /** The sound id, the track id, or `'bed'`. */
  readonly source: string;
  readonly bus: BusName;
  /** Index into the sound's `layers`, the song's `tracks`, or the bed's layers. */
  readonly layer: number;
  readonly wave: Wave;
  /** Hz at `start`, after the ladder and any per-play detune. */
  readonly hz: number;
  /** Hz at `end`. Equals `hz` when the layer does not sweep. */
  readonly toHz: number;
  /** Final gain after the sound's per-play gain and the ladder, and **before** bus and master. */
  readonly gain: number;
  /** −1…1, already clamped to the engine's `maxPan`. */
  readonly pan: number;
  /** Audio-clock seconds. */
  readonly start: number;
  /**
   * Audio-clock seconds, including the release tail — the decay *is* the release here, so
   * this is `start + attack + hold`. **This is what the voice ceiling counts**, which is why
   * it is on the plan rather than inside the renderer: a ceiling driven by `onended` can
   * never come back down for a voice that never ends.
   */
  readonly end: number;
}

/**
 * One thing wrong with one sound, named with the numbers in it.
 *
 * Returned rather than thrown: a shipped game must not refuse to start because a sound is
 * 0.03 too loud. The game's own test asserts the array is empty, which is where a table fault
 * should stop a build.
 */
export interface SoundProblem {
  /** The table key. */
  readonly sound: string;
  readonly code:
    | 'no-layers'
    | 'clips'
    | 'no-throttle'
    | 'ladder-shorter-than-gap'
    | 'ladder-too-short'
    | 'inaudible'
    | 'sub-audio-frequency'
    | 'zero-hold';
  /** Names the author's mistake with the numbers in it: `collect peaks at 1.24, ceiling is 0.95`. */
  readonly message: string;
}

/**
 * The summed-gain ceiling, below 1.0 rather than at it.
 *
 * Master sits under 1 by default but a player may raise it, and the bed is playing underneath
 * everything. Leaving 5% of headroom is what stops a legal table clipping the moment two
 * sounds overlap.
 */
const CLIP_CEILING = 0.95;

/** Below this, a tone is a rumble rather than a pitch, and an exponential ramp near 0 Hz is a spec violation. */
const MIN_TONE_HZ = 20;

/** Above this nobody hears it, but the oscillator still costs a voice and still sums into the mix. */
const MAX_TONE_HZ = 20000;

/** Below this a layer cannot be heard under anything else, so it is a typo rather than a choice. */
const MIN_AUDIBLE_GAIN = 0.0005;

/** A ladder of one step is not a ladder; it is a field the author meant to delete. */
const MIN_LADDER_STEPS = 2;

/**
 * The loudest instant in a sound, in gain.
 *
 * Sums only layers that are **alive at the same moment**, which is why an arpeggio of four
 * 0.3 layers 90 ms apart is not reported as a 1.2 chord. Each layer contributes its peak for
 * `[delay, delay + attack + hold)`; the real decay is exponential, so this is conservative in
 * the direction that matters.
 */
function peakGain(layers: readonly Layer[]): number {
  const edges: { readonly at: number; readonly delta: number }[] = [];
  for (const layer of layers) {
    // A hole in the array, from a game that assembled its layers conditionally. `for…of`
    // hands them over as `undefined` however confidently the type reads.
    if (layer === undefined) continue;
    const start = Math.max(0, layer.delay ?? 0);
    const life = Math.max(0, layer.attack ?? ATTACK_SEC) + Math.max(0, layer.hold);
    edges.push({ at: start, delta: layer.gain }, { at: start + life, delta: -layer.gain });
  }
  // Falls before rises at a tie, so a layer that ends exactly where the next begins is not
  // counted as overlapping it.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let live = 0;
  let peak = 0;
  for (const edge of edges) {
    live += edge.delta;
    if (live > peak) peak = live;
  }
  return peak;
}

/**
 * Check a sound table for the faults that produce a worse game and no error.
 *
 * The source game this kit came from spent five hand-written tests asserting its table was
 * sane, and every game built on Lattice would otherwise write the same five. They ship here
 * instead, as one call.
 *
 * What it catches: a chord that sums past full scale, a burst-capable sound with no throttle,
 * a ladder shorter than its own gap or shorter than two steps, a layer at 8 Hz that is a
 * rumble rather than a tone, a layer at a gain nobody can hear, a layer with no hold at all.
 *
 * **What it cannot catch** is a sound that is declared and never played. That defect needs
 * the game's own source: grep `src` for every key of the table, as the README shows. It is
 * the one failure in this class that has actually shipped, repeatedly.
 *
 * Returns problems rather than throwing, in table order, then in the order listed above.
 */
export function validateSounds<Ids extends string>(
  sounds: Readonly<Record<Ids, SoundDef>>,
): readonly SoundProblem[] {
  const problems: SoundProblem[] = [];
  const report = (sound: string, code: SoundProblem['code'], message: string): void => {
    problems.push({ sound, code, message });
  };

  for (const [sound, definition] of Object.entries(sounds) as [string, SoundDef][]) {
    const layers = definition.layers;
    if (layers === undefined || layers.length === 0) {
      report(sound, 'no-layers', `${sound} has no layers, so playing it does nothing at all`);
      continue;
    }

    const peak = peakGain(layers);
    if (peak > CLIP_CEILING) {
      report(
        sound,
        'clips',
        `${sound} peaks at ${peak.toFixed(2)}, ceiling is ${String(CLIP_CEILING)} — WebAudio sums and hard-clips above 1.0, so this plays distorted rather than louder`,
      );
    }

    if (!(definition.minGapMs > 0)) {
      report(
        sound,
        'no-throttle',
        `${sound} has minGapMs ${String(definition.minGapMs)} — one tap that fires it twenty times will stack twenty voices and clip`,
      );
    }

    const ladder = definition.ladder;
    if (ladder !== undefined) {
      if (!(ladder.windowMs > definition.minGapMs)) {
        report(
          sound,
          'ladder-shorter-than-gap',
          `${sound} has a ladder window of ${String(ladder.windowMs)} ms inside a gap of ${String(definition.minGapMs)} ms — the window closes before the next play is allowed, so the ladder can never leave step 0`,
        );
      }
      if (!(ladder.steps >= MIN_LADDER_STEPS)) {
        report(
          sound,
          'ladder-too-short',
          `${sound} has a ladder of ${String(ladder.steps)} step(s); a ladder needs at least ${String(MIN_LADDER_STEPS)} to move`,
        );
      }
    }

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer === undefined) continue;
      const where = `${sound} layer ${String(index)}`;

      if (!(layer.gain > MIN_AUDIBLE_GAIN)) {
        report(
          sound,
          'inaudible',
          `${where} has gain ${String(layer.gain)}; it costs a voice and cannot be heard`,
        );
      }
      if (!(layer.hold > 0)) {
        report(
          sound,
          'zero-hold',
          `${where} has hold ${String(layer.hold)}; a layer with no decay is a click`,
        );
      }
      if (layer.wave !== 'noise') {
        for (const hz of [layer.hz, layer.toHz]) {
          if (hz === undefined) continue;
          if (!(hz >= MIN_TONE_HZ)) {
            report(
              sound,
              'sub-audio-frequency',
              `${where} is at ${String(hz)} Hz; below ${String(MIN_TONE_HZ)} Hz that is a rumble rather than a tone, and an exponential ramp toward 0 Hz is a spec violation`,
            );
          } else if (hz > MAX_TONE_HZ) {
            report(
              sound,
              'inaudible',
              `${where} is at ${String(hz)} Hz, above the ${String(MAX_TONE_HZ)} Hz limit of hearing; it costs a voice and cannot be heard`,
            );
          }
        }
      }
    }
  }

  return problems;
}
