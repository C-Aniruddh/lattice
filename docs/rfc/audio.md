# RFC — `@lattice/audio`

> Status: proposed. Owner: lattice-architect (task A6). Implements: `.lattice/kit.json` → `packages.audio`.
> Reviewer: hold the built package against §5 and §6.

---

## 1. The one sentence

**`@lattice/audio` turns a table of oscillator recipes into the sound of a game — with no files,
no `AudioContext` until the player touches something, and a hard ceiling on how loud a burst can
get.**

If a game author has to know what a `BiquadFilterNode` is to make a button click, this package
failed. If they have to reach past it to a raw `AudioContext` to get a kick drum, it also failed.

---

## 2. The five-line example

This is what a game does with this package roughly all of the time: declare a table, unlock on the
first gesture, and play by name.

```ts
import { createAudio } from '@lattice/audio';

const audio = createAudio({ sounds: {
  tap:     { bus: 'ui',  minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
  collect: { bus: 'sfx', minGapMs: 45, ladder: { steps: 5, windowMs: 900 },
             layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.10, cutoff: 3200 }] },
} });

addEventListener('pointerdown', () => audio.unlock());  // nothing is created before this line runs
audio.play('collect');                                   // argument type is 'tap' | 'collect'
```

Four things about that example are load-bearing, and every decision in §3 follows from them:

| the example does this | so the API must |
|---|---|
| writes sounds as a plain object literal | infer the id union from the table — no registry, no enum, no `SoundId` type to maintain by hand |
| never mentions `AudioContext`, `GainNode`, `connect` | own the whole node graph. A layer is a recipe, not a patch |
| calls `unlock()` from the game's own listener | never attach a listener of its own (see §4) |
| calls `play('collect')` with no time argument | take its clock from the audio device, not from `performance.now()` — which the constitution bans |

The shape of a `SoundDef` is deliberately the shape `foom-simple-ui`'s `src/config/audio.ts` already
proved over fourteen sounds. That table is the strongest evidence in the source game that declarative
synthesis is authorable by someone who does not want to learn WebAudio, and it is copied here nearly
field-for-field rather than improved on.

---

## 3. The public surface

Everything below is re-exported from `packages/audio/src/index.ts` and nowhere else. Modules:
`sounds` (the table and its validator), `voice` (recipe → plan), `engine` (`createAudio`, unlock,
play, taps), `bus` (the mixer), `music` (the deck), and **`bed`** — a sixth module that
`.lattice/kit.json` does not list and should; see §3.6 for the argument.

### 3.0 Waves, buses, and the one shared vocabulary

```ts
/**
 * The five sources. `noise` is a shared, deterministically-filled white-noise buffer, looped —
 * it is what makes thunks, air and hats possible without a sample.
 *
 * There is no `custom` wave. A PeriodicWave is a Fourier table, which is an asset in the shape
 * of an array, and the moment one exists somebody will paste a 512-partial one in.
 */
export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';

/**
 * The three buses, fixed and closed.
 *
 * Fixed because the reason buses exist is a player who wants the music off and the alerts on, and
 * that player needs the *same* three switches in every Lattice game. An open bus registry gives
 * every game a different settings panel and gives this package a graph it cannot prove anything
 * about. If a game needs a fourth, that is a case for widening this union in a minor release,
 * with the evidence attached.
 */
export type BusId = 'music' | 'sfx' | 'ui';

/** The buses plus the one every bus feeds. Nothing connects to `destination` except master. */
export type BusName = 'master' | BusId;

/** Hard ceiling on one-shot voices in flight. Past it, `play` drops rather than queues. */
export const MAX_VOICES = 24;

/** Fixed attack, in seconds. Long enough to kill the leading-edge click, short enough to feel instant. */
export const ATTACK_SEC = 0.006;

/** Equal temperament. A detune that is not a semitone sounds like a fault, not like variation. */
export const SEMITONE = 1.0594630943592953;

/** How far ahead the sequencer schedules. See trap 9 — this number is about background tabs. */
export const LOOKAHEAD_SEC = 1.5;

/** How often the deck's own timer pumps. */
export const PUMP_INTERVAL_MS = 200;

/** Time constant for every gain change on a running node. Below this, a slider drag clicks per pixel. */
export const RAMP_SEC = 0.015;

/** The kit version this package was built as part of. */
export const VERSION: string;
```

### 3.1 What a sound *is*, declaratively

**The answer: a sound is an ordered list of layers, and a layer is a fixed signal chain with the
knobs exposed as numbers.** The chain is `source → [highpass] → [lowpass] → gain envelope →
[pan] → bus`, always, in that order, with no way to say otherwise. That single sentence is the
whole synthesis model, and it is the line between "a game author can extend this" and "this is a
modular synth", which is a different product with a different customer.

Concretely, what an author may vary: which of five sources, one starting pitch, one exponential
sweep target, one peak gain, one decay length, one start delay, one attack override, one low-pass
corner, one high-pass corner, one pan. Ten numbers. What an author may *not* vary: the order of
the chain, the envelope's shape, the number of filters, whether anything modulates anything else.

That is enough to reproduce all fourteen sounds of the source game exactly — including the beating
detuned saws of `brownout`, the pitch-swept sine that is a kick drum, and the noise-through-a-
high-pass that is a hi-hat. It is not enough to build an FM bell, and that is the right trade: an
FM bell is one more sound, and a modulation matrix is a permanent tax on every reader of this
package's types and on the 12 kB gzip budget.

```ts
/**
 * One oscillator or noise burst inside a sound. Layers within a sound play together; `delay`
 * is what turns a chord into an arpeggio.
 */
export interface Layer {
  readonly wave: Wave;
  /** Starting frequency in Hz. Ignored when `wave` is `noise`. */
  readonly hz: number;
  /**
   * Sweep to this frequency across the layer's life. The ramp is exponential, always: pitch is
   * heard logarithmically, so a linear sweep from 880 to 190 spends most of its time in the
   * bottom octave and reads as a fault rather than a fall.
   */
  readonly toHz?: number;
  /** Peak gain, 0–1, before the sound's own gain, the bus, and master. See the clipping invariant. */
  readonly gain: number;
  /** Seconds of decay after the attack. This, not `toHz`, is what makes a sound feel heavy or brief. */
  readonly hold: number;
  /** Override {@link ATTACK_SEC}. Raise it for a swell; a longer attack is how a sound stops being a hit. */
  readonly attack?: number;
  /** Seconds before this layer starts. */
  readonly delay?: number;
  /**
   * Low-pass corner in Hz. The single most useful knob in the table: it is the difference between
   * "a square wave" and "a distant announcement in a car park".
   */
  readonly cutoff?: number;
  /**
   * High-pass corner in Hz. Rare and specific — everything below about 6 kHz is what makes a hat
   * sound like a cough. Giving both this and `cutoff` is a band-pass and costs one extra node.
   */
  readonly highpass?: number;
  /** Static pan, −1…1. Almost always wrong to set here; pan belongs to the *event*, not the recipe. §3.5. */
  readonly pan?: number;
}

/**
 * A sound, as a game author writes it. The keys of the table passed to {@link createAudio} become
 * the id union, so there is no id type to keep in sync and a typo is a compile error.
 */
export interface SoundDef {
  /** Played together. At least one, and their gains must sum under full scale — see {@link validateSounds}. */
  readonly layers: readonly Layer[];
  /** Default `'sfx'`. Put anything a player might reasonably want silenced separately on its own bus. */
  readonly bus?: BusId;
  /**
   * Minimum milliseconds between two plays of this sound.
   *
   * **Why this is required and not optional.** COLLECT ALL banks twenty buildings in one tap:
   * twenty `play('collect')` calls in the same millisecond. Twenty stacked oscillators is not
   * twenty times as satisfying — the gains sum past 1 and the output clips into a click. Making
   * the field optional means the author who most needs it is the author who omits it, so it is
   * required and {@link validateSounds} rejects zero.
   */
  readonly minGapMs: number;
  /**
   * Successive plays inside `windowMs` step UP the scale rather than repeating, wrapping after
   * `steps`, resetting once the player stops.
   *
   * This is what makes four taps in a row feel like a run rather than four identical blips. It is
   * a ladder rather than a random detune on purpose: `Math.random` is banned in this kit, and it
   * would be the wrong tool regardless — a repeat that moves *unpredictably* sounds broken, and
   * one that moves up a scale sounds alive.
   */
  readonly ladder?: { readonly steps: number; readonly windowMs: number };
  /**
   * Whether {@link PlayOptions.pan} is honoured for this sound. Defaults to `bus === 'sfx'`, which
   * is the useful default: world events pan, and the interface does not follow the camera. §3.5.
   */
  readonly spatial?: boolean;
}

/** Per-event modulation. Everything here is about *this* play, not about the recipe. */
export interface PlayOptions {
  /** 0–1 multiplier on the whole sound. Distance falloff lives here. */
  readonly gain?: number;
  /** −1…1, clamped to ±`maxPan`. Ignored unless the sound is spatial. */
  readonly pan?: number;
  /** Semitones, applied on top of the ladder step. For pitching a sound by size or by tier. */
  readonly detune?: number;
  /** Audio-clock seconds to start at. Omit for now. Use it to place a sound inside a beat. */
  readonly at?: number;
}

/**
 * What the engine decided to build, handed to every {@link Audio.onScheduled} listener.
 *
 * **This object is reused between calls.** It is emitted once per layer per play, which the
 * sequencer alone does eight times a second; a fresh object each time is a garbage collector
 * pause with a pleasant signature. Read it or copy the fields you keep — do not retain it.
 */
export interface VoicePlan {
  readonly sound: string;
  readonly bus: BusName;
  /** Index into the sound's `layers`, or into a song's `tracks` for music. */
  readonly layer: number;
  readonly wave: Wave;
  readonly hz: number;
  /** Equals `hz` when the layer does not sweep. */
  readonly toHz: number;
  /** Final gain after the sound's gain and the ladder, before bus and master. */
  readonly gain: number;
  readonly pan: number;
  /** Audio-clock seconds. */
  readonly start: number;
  /** Audio-clock seconds, including the release tail. This is what the voice ceiling counts. */
  readonly end: number;
}
```

**The table validator.** The source game spent five hand-written tests asserting that its table was
sane, and every Lattice game would write those same five. They ship here instead, as one call that
returns problems rather than throwing — a table with a bad sound should still boot the game.

```ts
/**
 * Check a sound table for the faults that produce a worse game and no error: a chord that sums
 * past full scale, a burst-capable sound with no throttle, a ladder shorter than its own gap, a
 * layer at 8 Hz that is a rumble rather than a tone.
 *
 * Returns problems rather than throwing, and the game's own test asserts the array is empty.
 * A shipped game must not refuse to start because a sound is 0.03 too loud.
 */
export function validateSounds(sounds: Readonly<Record<string, SoundDef>>): readonly SoundProblem[];

export interface SoundProblem {
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
```

### 3.2 Buses, muting, and what persists

**How a game mutes music without touching effects:** every bus is two independent values — a gain
and a mute flag — and the node gain is their product. `setMuted('music', true)` does not write the
gain, so `setMuted('music', false)` restores the exact level the player had chosen. A mute
implemented as "set gain to 0" is the bug where turning the music back on returns it at full
volume; it is very common and it is why these are two calls and not one.

**What persists, and where it lives:** this package stores nothing. `snapshot()` returns a small
plain value and `restore()` takes one back, and the game hands that value to `@lattice/persist`.
Three reasons, in order of weight:

1. **Layering.** `audio` and `persist` are both layer 1. There is no edge between them and adding
   one is a design error, not a convenience.
2. **A device preference is not save state.** The source game wrote `foom.muted` straight to
   `localStorage` precisely so that START OVER would not turn a player's sound back on, and so it
   would not ride along in an export. That distinction is right and it belongs to `persist` as a
   *separate device-scoped store*, not to this package as a private `localStorage` call.
3. **Testability.** A mixer that writes to storage cannot be tested without a storage shim.

```ts
/** The three buses and master. Gain and mute are separate on purpose — see above. */
export interface Mixer {
  /** The player's chosen level, 0–1. Unaffected by muting. */
  gain(bus: BusName): number;
  /**
   * Set a level, 0–1, clamped. Ramped over {@link RAMP_SEC} rather than assigned: a step change on
   * a running oscillator is an audible click, and a slider drag would produce one per pixel.
   */
  setGain(bus: BusName, gain: number): void;
  muted(bus: BusName): boolean;
  /** Independent of gain. Muting master silences everything and preserves every bus's level. */
  setMuted(bus: BusName, muted: boolean): void;
  /**
   * The whole mixer as a value to hand to `@lattice/persist`. Not an output parameter and not on
   * any hot path: this is called when a settings panel closes, not per frame.
   */
  snapshot(): MixerState;
  /**
   * Apply a snapshot. Unknown or out-of-range fields are clamped and ignored rather than thrown:
   * a save written by an older build must not be able to silence a game permanently.
   */
  restore(state: Readonly<MixerState>): void;
}

/** Versioned because it goes in a save, and a save that cannot say what it is cannot be migrated. */
export interface MixerState {
  readonly version: 1;
  readonly gain: Readonly<Record<BusName, number>>;
  readonly muted: Readonly<Record<BusName, boolean>>;
}
```

### 3.3 The engine

```ts
export interface AudioOptions<Ids extends string> {
  /** The table. Its keys become the type of {@link Audio.play}'s first argument. */
  readonly sounds: Readonly<Record<Ids, SoundDef>>;
  /**
   * How to obtain a context. Defaults to `window.AudioContext ?? window.webkitAudioContext`,
   * returning `null` when neither exists or when construction throws.
   *
   * This is the seam the whole test suite hangs from (§3.7). It is also how a host that already
   * owns a context — an app embedding two Lattice games — passes one in.
   */
  readonly context?: () => AudioContext | null;
  /**
   * The clock, in audio-clock **seconds**. Defaults to the context's `currentTime`, and to a
   * monotonic zero when there is no context.
   *
   * Two consequences worth stating. First, `performance.now()` never appears in this package, so
   * the determinism lint passes without an exemption. Second, throttles are measured in the same
   * time base as scheduling, so a throttle can never disagree with the notes it is throttling.
   * Author-facing fields stay in milliseconds (`minGapMs`, `windowMs`) because that is the unit a
   * human reasons about; the conversion is this package's problem.
   */
  readonly now?: () => number;
  /** Override {@link MAX_VOICES}. Lower it on a game with a busy bed; raising it is almost always wrong. */
  readonly maxVoices?: number;
  /** Absolute pan limit, default 0.6. §3.5 explains why it is not 1. */
  readonly maxPan?: number;
}

export interface Audio<Ids extends string> {
  readonly mixer: Mixer;
  readonly music: MusicDeck;
  /** Whether a real device exists. False in Node, in a locked-down browser, and before `unlock`. */
  readonly available: boolean;
  /** One-shot voices whose scheduled end is still in the future. The bed and the deck are not counted. */
  readonly voices: number;

  /**
   * Create the context, or resume one the browser suspended. Idempotent and cheap; call it from
   * every interaction handler you have.
   *
   * Resuming matters as much as creating. A tab backgrounded for long enough gets its context
   * suspended, and without the resume, sound works for one session and then silently stops — the
   * kind of bug that is reported as "audio breaks sometimes" and never reproduced.
   *
   * Returns {@link available}, so a settings panel can show "audio unavailable" truthfully.
   */
  unlock(): boolean;

  /**
   * Play a sound if policy allows it right now. Returns whether it was **accepted** — not whether
   * a speaker moved.
   *
   * Acceptance is decided by the throttle, the ladder and the voice ceiling, all of which run
   * identically with or without a device. That is deliberate and it is the single decision that
   * makes this package testable (§3.7): a headless run takes the same branch a browser takes and
   * simply renders nothing at the end of it. Use {@link available} to ask about the device.
   */
  play(id: Ids, options?: PlayOptions): boolean;

  /** Stand up a continuous bed. See §3.6. */
  bed(layers: readonly BedLayer[], options?: BedOptions): Bed;

  /**
   * Observe every voice the engine schedules, one call per layer. Returns a disposer.
   *
   * This exists for two customers at once, which is why it earns an export where a test-only mock
   * would not: a test asserts on plans with no device at all, and a HUD flashes a meter on the
   * beat without an AnalyserNode or a real context. The plan object is reused — copy what you keep.
   */
  onScheduled(listener: (plan: Readonly<VoicePlan>) => void): () => void;

  /**
   * Stop everything, disconnect, and close the context.
   *
   * Not optional politeness: browsers cap live `AudioContext`s per document (six, historically),
   * and a test file that creates one per case exhausts that cap and fails in a way that looks
   * like a broken assertion. Every method is a silent no-op afterwards.
   */
  dispose(): void;
}

/** The only constructor. There is deliberately no module-level singleton — see §4. */
export function createAudio<Ids extends string>(options: AudioOptions<Ids>): Audio<Ids>;
```

### 3.4 The music deck

**The question: what is the minimum that is worth listening to for twenty minutes?**

The source game's theme is procedural — four bars, `MUSIC.progression = [3, 10, 0, 8]` over a 55 Hz
root, an arpeggio on nine of sixteen steps, a walking bass, a kick on the quarters and a hat on the
offbeats, at 112 bpm. What makes it survive an hour behind a spreadsheet is five properties, and
they are the specification for this deck:

1. **It rests.** The melody speaks on well under three quarters of the steps. The source's own test
   says it plainly: *a note on every step is a drill*. Percussion is exempt and obeys the opposite
   rule — a steady hat is the thing a listener stops hearing and starts moving to.
2. **It is mixed under the information.** Every note is quieter than the quietest sound that means
   something. A theme that buries the brownout alarm gets the whole game muted, and muting to
   escape the music also loses the alarm — which is the real cost of a bad theme and the reason
   music is off by default.
3. **The harmony is one loop, rotated.** `C-G-Am-F` is `Am-F-C-G` started elsewhere; the same four
   chords read bright or wistful depending only on which one lands first. There is no cheaper way
   to change the mood of a piece than to change nothing in it.
4. **Nothing is bright.** Every note goes through a low-pass. Brightness is what makes a loop nag.
5. **Bars are not identical.** This is the one thing the source does *not* have, and the one thing I
   would add for twenty minutes rather than five. Four bars of exactly the same notes has an
   audible seam. Two cheap mechanisms remove it without a composer: a per-track **bar mask**
   (`bars: [0, 2]` — the arp sits out half the progression) and a seeded per-note **drop**
   probability. Both are deterministic; the drop rolls a seeded RNG keyed by `(bar, step, track)`,
   so the same song and seed produce the same twenty minutes on every machine and in every replay.

Plus one thing that is not about tedium but about a game: **intensity**. `setIntensity(0.9)` when
the campus is busy, `0.2` when it is idle, and tracks gate themselves on `minIntensity`. Tempo
does not change — a tempo change mid-loop is a mistake you cannot un-hear — only which tracks
speak. That is the whole dynamic-music feature, and it costs one number.

```ts
/** The instrument a track plays. It has no pitch: the sequencer supplies that from the chord. */
export interface TrackVoice {
  readonly wave: Wave;
  readonly gain: number;
  readonly hold: number;
  readonly attack?: number;
  readonly cutoff?: number;
  readonly highpass?: number;
  /**
   * Sweep to this **multiple** of the note's pitch. A kick drum is a sine at 125 Hz swept to
   * `0.35` in a tenth of a second — there is no other way to get a kick out of an oscillator, and
   * a sample would mean shipping a binary for the sake of one thud.
   */
  readonly sweepTo?: number;
  /** Fixed Hz, ignoring the chord. Percussion does not follow the harmony. */
  readonly fixedHz?: number;
}

/** A step within the bar, and how far above the bar's root it speaks. Omit `semis` for the root. */
export interface Note {
  readonly step: number;
  readonly semis?: number;
}

export interface Track {
  /** Stable id, for {@link MusicDeck.setTrackMuted} and for reporting. */
  readonly id: string;
  readonly voice: TrackVoice;
  readonly notes: readonly Note[];
  /** Which bars of the progression this track speaks on. Omit for every bar. The cheap anti-seam. */
  readonly bars?: readonly number[];
  /** Silent below this intensity, 0–1. Default 0 — always speaking. */
  readonly minIntensity?: number;
  /** 0–1 chance a note is dropped, decided by the song's seeded RNG. Default 0. Keep it under ~0.2. */
  readonly drop?: number;
  /**
   * Whether this track carries melody. Only melodic tracks are held to the rest rule in
   * {@link validateSong}; a hat that fills every offbeat is correct and a bass that does is not.
   */
  readonly melodic?: boolean;
}

export interface Song {
  readonly bpm: number;
  /** Steps per bar. 16 is sixteenth notes. */
  readonly steps: number;
  /** Root of the whole piece in Hz. Low — 55 is A1. */
  readonly rootHz: number;
  /** Semitone offset of each bar's root. Length is the loop length in bars. */
  readonly progression: readonly number[];
  readonly tracks: readonly Track[];
  /** Seed for `drop`. Same seed, same twenty minutes, on every machine. Default 0. */
  readonly seed?: number;
}

/** The same class of check as {@link validateSounds}, for the failures a song has that a sound does not. */
export function validateSong(song: Song): readonly SongProblem[];

export interface SongProblem {
  /** `null` when the fault is the song's rather than one track's. */
  readonly track: string | null;
  readonly code: 'tempo' | 'no-rests' | 'clips' | 'step-out-of-bar' | 'bar-out-of-progression' | 'no-tracks';
  readonly message: string;
}

export interface MusicDeck {
  readonly playing: boolean;
  readonly intensity: number;
  /** Fades in over `fadeSec` (default 0.6) and replaces whatever was playing. One song at a time. */
  play(song: Song, options?: { readonly fadeSec?: number }): void;
  /** Fades out and stops scheduling. Notes already scheduled inside the horizon still sound. */
  stop(options?: { readonly fadeSec?: number }): void;
  /** 0–1, clamped. Gates tracks by `minIntensity`. Never changes tempo. */
  setIntensity(intensity: number): void;
  /** For a settings panel that offers "no drums", and for a test that wants one track's plans. */
  setTrackMuted(trackId: string, muted: boolean): void;
  /**
   * Schedule everything due inside {@link LOOKAHEAD_SEC}. Idempotent, safe to over-call, and safe
   * to call at an irregular rate — notes are pinned to the audio clock, not to whoever called this.
   *
   * The deck runs its own {@link PUMP_INTERVAL_MS} timer, so a game never has to call this. It is
   * public because a test needs to drive time by hand, and because a host with its own scheduler
   * should be able to. Never drive it from `requestAnimationFrame` alone: rAF is 0 Hz in a hidden
   * tab and the music would stop the moment the player changed tabs. See trap 9.
   */
  pump(): void;
}
```

### 3.5 Spatialisation — a position

**Yes to stereo pan, no to anything with a listener in it.** But narrower than it first looks.

A `PannerNode` with a distance model, an orientation and an HRTF is wrong for this kit twice over:
it is 3D machinery for a 2D game, and it costs an HRTF convolution per voice. That is easy. The
interesting question is whether `StereoPannerNode` — one node, negligible cost — earns its place,
and the honest answer is *half of it does*:

- **Panning a world event by screen x adds real value.** A build site off to the left, a rack
  humming on the right: it makes the campus a place rather than a picture. This is the case where
  a player can point at the thing that made the noise.
- **Panning by screen x is actively bad as the camera moves.** Drag the camera and a stationary
  sound sweeps across the stereo field, which reads as a fault. The mitigation is not to fix the
  mapping, it is to only ever pan *transients*: a sound that lasts 200 ms cannot sweep. Anything
  continuous — the bed, the music — is centre, always.
- **Hard pan is fatiguing on headphones,** which is where most of these games are played. Hence
  `maxPan = 0.6`. Full-width panning is a gimmick; two thirds of the width is atmosphere.
- **The half that carries more than pan is gain.** An off-screen sound made *quieter* is far more
  legible than one made *left*. `PlayOptions.gain` is the distance falloff, and a game that
  implements only that and never touches `pan` has most of the benefit.

So the surface is two numbers on `PlayOptions` and a per-sound opt-out, and **this package computes
neither of them.** The screen-x-to-pan mapping needs a camera, and `audio` is layer 1 and does not
know `iso` exists. The mapping is four lines in the game — and it is a gap worth routing; see the
appendix.

### 3.6 The bed — an argued addition

`.lattice/kit.json` lists five modules for this package and the room is not among them. It should
be. In the source game, "the room" is the highest-value audio feature that shipped, and it is not a
sound effect: it is a **readout**. It thickens as the campus grows, so scale is something you hear
before you look at a number, and it *sags in pitch* during a brownout, because plant losing power
winds down and a drop in level alone reads as a mixing change while a drop in pitch reads as
machinery stopping.

Without it, a Lattice game is silent between taps — which for an idle game is 95% of the session —
and every game built on this kit will hand-roll it, badly, with `Math.random`. The surface is two
types and two methods.

```ts
/** One continuous layer of a bed. Every layer runs forever; only its gain, filter and pitch move. */
export interface BedLayer {
  readonly wave: Wave;
  readonly hz: number;
  /** Gain at intensity 1. Scaled toward silence as intensity falls — an empty world is silent. */
  readonly gain: number;
  readonly cutoff: number;
  /**
   * Multiple the cutoff opens to at full intensity. This, not gain, is what makes a busy hall
   * sound busy: volume alone reads as "the same hum, nearer".
   */
  readonly cutoffAtFull?: number;
  /**
   * Detune against the previous layer, in Hz. Two near-identical sources beat, audibly, and that
   * beat is what stops a bed sounding like a synthesiser pad. Real plant is never in phase.
   */
  readonly beat?: number;
}

export interface BedOptions {
  /** Default `'sfx'`, so muting music does not silence the world. */
  readonly bus?: BusId;
  /** Pitch multiplier at `tone = 0`. Default 0.55 — fans spinning down, not fans switched off. */
  readonly sagTo?: number;
  /** Seconds for a change to arrive. Default ~1. Anything faster reads as an edit rather than as a room. */
  readonly glideSec?: number;
}

export interface Bed {
  /**
   * Drive the bed. Safe to call every frame: it ramps toward the figures rather than resetting
   * anything, so nothing clicks and nothing restarts.
   *
   * @param intensity 0–1, how much of the world is running. Scales gain and opens the filters.
   * @param tone 0–1, how healthy it is. Below 1 the pitch sags and the top end closes. Default 1.
   */
  set(intensity: number, tone?: number): void;
  /** Fade out and tear the layers down. A bed that is stopped cannot be restarted; make a new one. */
  stop(fadeSec?: number): void;
}
```

Bed layers are *not* counted against `MAX_VOICES`. They never end, so a counter driven by `onended`
would never decrement them (trap 4), and a bed of five layers must not eat a fifth of the ceiling
forever. They are bounded by construction instead: a bed's layer count is fixed at creation.

### 3.7 Testing with no `AudioContext` — a position

**All three of the options in the brief are worse than the fourth: separate the decision from the
node graph, and make the decision observable.**

The source game's test file is honest about this: *"the engine itself is barely tested here on
purpose… a mock deep enough to exercise it would be testing the mock."* It tests the table, and
asserts only that the engine does not throw. That is a defensible position for one game and it
cannot reach 90% statements, which is this kit's floor. So:

| option | verdict |
|---|---|
| a null backend | necessary but insufficient — it proves nothing throws, and covers nothing |
| an injected `AudioContext` factory | necessary, and it is `AudioOptions.context`. But by itself it invites the deep mock |
| a recording mock of WebAudio, shipped | **no.** A mock of forty node types is a second implementation that has to be right, and asserting `createBiquadFilter` was called with 3200 tests the mock, not the sound |
| **policy above, rendering below** | **yes.** Throttle, ladder, ceiling, bus resolution, sequencer step times, bed targets — all pure, all driven by an injected clock, all emitting a `VoicePlan`. The WebAudio part is the ~120 lines that turn a plan into nodes |

The consequence for a test author is that everything interesting is assertable with **no mock at
all**: install an `onScheduled` listener, drive `now`, call `play` twice inside the gap, and count
the plans. Coverage is then a question about the renderer alone, which is the only part that
genuinely needs a browser — and a jsdom-free `happy-dom` run with a hand-written stub of the eight
node types the renderer actually uses is a reasonable way to cover *those* lines, in one file,
clearly labelled as covering node construction and nothing else.

The price is the one departure from the source game: **`play()` returns `true` in a headless run.**
The source returns `false` because it means "did a speaker move". Here it means "was this accepted",
so the same branch runs everywhere and `available` answers the other question. I think this is
right — a policy that only runs when a device exists is a policy nobody can test — but it is the
decision in this RFC I would most like a second opinion on, and it makes `.lattice/kit.json`'s
phrase *"`play()` in a headless run does nothing at all"* worth rewording to *"produces no sound"*.

---

## 4. What is deliberately absent

The most valuable section here. Each of these has been considered and refused; adding one back
needs an argument that beats the one written next to it.

1. **Audio files, `decodeAudioData`, sample playback, `AudioWorklet`.** Non-negotiable #8. A
   worklet is also a *separate file*, which is an asset by another name, and `addModule` is a
   network fetch on the boot path.
2. **A modular routing graph — user-defined node chains, LFOs, a modulation matrix, an effects
   rack (reverb, delay, distortion, compression).** This is the big one. `ConvolverNode` needs an
   impulse response, which is an asset. A delay line is genuinely one node and is *still* refused,
   because the moment routing is author-defined the clipping invariant becomes unprovable: a
   feedback delay at 0.9 turns a 0.16 chord into a runaway, and no static validator can see it.
   Fixed chain, provable ceiling. **What would change my mind:** the demo game needing a
   pre-delay-free reverb for a large space, at which point *one* fixed, gain-limited send is a
   smaller change than a graph.
3. **`PannerNode`, HRTF, listener position and orientation, distance models, Doppler.** §3.5.
   3D machinery for a 2D game, priced per voice.
4. **`AnalyserNode`, FFT, waveform data.** A visualiser needs a real device, so anything built on
   it is invisible to tests and dead in Node. `onScheduled` gives a HUD the beat without any of
   that, and it is the beat that a meter actually wants.
5. **A module-level singleton (`export const audio = new Audio()`).** The source game has one and
   it is right for a game. It is wrong for a kit: it makes two games on one page impossible, makes
   test order matter, and creates state at import time in a package whose first rule is that
   nothing exists until a gesture. `createAudio` is the only door.
6. **Any use of `localStorage`.** §3.2. `snapshot`/`restore` return a value; `persist` owns storage.
7. **Attaching its own `pointerdown`/`touchstart` listener to auto-unlock.** Tempting, and it is
   half a line. But `@lattice/input` owns the DOM event surface, a package that installs a global
   listener fights the game's handler ordering and its `passive` choices, and a listener installed
   at import time is exactly the boot-time side effect rule 1 exists to prevent. The game calls
   `unlock()`.
8. **A general parameter automation API (`ramp(param, to, over)`).** It would collapse `bed`,
   `mixer` and the deck's fades into one primitive, and it would expose the node graph, which is
   the thing §3.1 is built to keep hidden.
9. **Ducking / sidechain — music dipping when an alert fires.** The nearest miss on this list. It
   is cheap (one `setTargetAtTime` on the music bus) and it genuinely helps a theme coexist with an
   alarm. Absent for v1 only because it needs a policy — which sounds duck, how far, for how long —
   and I would rather the demo game tell us than guess. **This is the first thing to add in v2.**
10. **Reverse/negative time, offline rendering (`OfflineAudioContext`) to produce a buffer.**
    Rendering a sound once and replaying the buffer is a real optimisation for `tap`, and it is
    refused for now because it makes the ladder impossible (each step is a different render) and
    because 24 oscillators is not a measured problem. If `perf` measures one, this is the fix.
11. **Music that is generated rather than authored — Markov chains, generative harmony.** A seeded
    drop probability is variation. A generator is a composer, and a composer that is 200 lines of
    probability tables writes music that is *different* every loop and *good* in none of them.

---

## 5. Invariants a reviewer can test

Each is phrased so the failing case is obvious. Every one of them is assertable with **no
`AudioContext`**, except where marked.

1. **Nothing is created before a gesture.** `createAudio(...)` with a spy `context` factory:
   the factory is not called. Call `play`, `mixer.setGain`, `music.play`, `bed` — still not called.
   The first call to `unlock()` calls it exactly once; the second call does not call it again.
2. **Silence, never an exception.** With `context: () => null`, every public method and every
   getter runs without throwing — including `dispose()` twice, `bed().set(NaN, NaN)`,
   `mixer.restore({} as MixerState)` and `music.pump()` before any `music.play`.
3. **A context that throws on construction is a context that does not exist.** `context: () => { throw new Error('no'); }`
   leaves `available === false` and does not propagate.
4. **The throttle is real, and visible without a device.** Two `play('collect')` at the same
   injected `now` emit one plan set, not two. Advancing `now` past `minGapMs` emits again.
5. **The ladder walks and resets.** Four plays inside `windowMs` produce `hz` values in the ratio
   `SEMITONE**0`, `**1`, `**2`, `**3`; a play after the window resets to step 0; the ladder wraps
   at `steps`; two different sounds have independent ladders.
6. **The voice ceiling holds and then releases.** 100 plays of a three-layer sound at one instant
   emit at most `maxVoices` plans. Advancing `now` past the longest `end` lets plays through again.
   The bed's layers and the deck's notes do not consume the one-shot ceiling.
7. **Mute is not gain.** `setGain('music', 0.4); setMuted('music', true); setMuted('music', false)`
   ⇒ `gain('music') === 0.4` throughout, and `muted('master')` silences without changing any bus.
8. **Buses multiply.** With master 0.5 and music 0.5, a plan's rendered gain is a quarter of its
   layer gain — assertable from the plan plus the mixer, no device needed.
9. **`snapshot`/`restore` round-trips**, and `restore` of an out-of-range or truncated state
   clamps rather than throws and never leaves the game silent by accident.
10. **The sequencer is pinned to the audio clock.** Pump at wildly irregular injected times; the
    emitted `start` values form an exact arithmetic sequence of `60 / bpm / (steps / 4)` seconds
    with no drift and no duplicate step.
11. **Nothing is scheduled twice and nothing is skipped.** Pumping ten times inside one step emits
    each step exactly once; a pump after a one-second gap emits every step in between, in order.
12. **The same seed is the same twenty minutes.** Two decks, same song and seed, pumped over the
    same injected time range, emit identical plan sequences. Different seeds differ.
13. **Intensity gates tracks and nothing else.** Below a track's `minIntensity` it emits no plans;
    step times of the remaining tracks are unchanged. Tempo never changes.
14. **`validateSounds` catches what it claims.** A table with a chord summing to 1.2 reports
    `clips` naming the sound and the number; `minGapMs: 0` reports `no-throttle`; a `ladder`
    whose `windowMs <= minGapMs` reports `ladder-shorter-than-gap`; a clean table returns `[]`.
15. **`validateSong` enforces the rest rule on melody only.** A melodic track speaking on every
    step reports `no-rests`; a hat on every offbeat does not.
16. **The bed never restarts.** Two `set()` calls do not re-create nodes; `voices` is unchanged;
    with a device, `set(0, 1)` on an empty world is inaudible rather than quiet.
17. **`dispose` is final and quiet.** After it, `available === false`, `play` returns false,
    `music.pump()` does nothing, the context is closed, and a second `dispose()` is a no-op.
18. **No banned globals.** `npm run lint` finds no `Math.random`, `Date.now` or `performance.now`
    in `packages/audio/src`, and no import of any package other than `@lattice/core`.
19. **Requires a device:** every scheduled node is disconnected once its `end` has passed —
    after a hundred plays and a full release tail, the context's node count returns to its
    post-`unlock` baseline.

---

## 6. Traps a naive implementation will hit

Mined from `foom-simple-ui/src/core/audio.ts`, its config, and `PLAYBOOK.md`.

1. **`exponentialRampToValueAtTime` cannot reach zero.** Ramping to 0 is a spec violation that
   silently produces nothing in some engines. Ramp to `0.0001`. And an exponential ramp *from* zero
   is silence, so the envelope must be `setValueAtTime(0)` → `linearRampToValueAtTime(peak)` →
   `exponentialRampToValueAtTime(0.0001)`.
2. **A pitch sweep must be exponential too.** Pitch is heard logarithmically; a linear 880→190
   sweep spends most of its life in the bottom octave.
3. **Assigning `gain.value` on a running node is an audible click.** Every change to a live
   parameter goes through `setTargetAtTime` with `RAMP_SEC`. A volume slider assigning directly
   produces one click per pixel of travel.
4. **A voice counter driven by `onended` leaks.** The bed's oscillators never end, so their
   callback never fires and the counter never comes back down — a game that runs an hour ends up
   permanently at the ceiling and goes silent. Count voices by *scheduled end time*, which is known
   at schedule time and needs no callback at all. This is also what makes invariant 6 testable.
5. **A suspended context after a backgrounded tab.** `unlock()` must resume as well as create, or
   sound works for one session and stops forever after the first tab switch.
6. **`webkitAudioContext`, and a constructor that throws.** Old Safari names it differently; a
   locked-down browser throws. Both must land on `available === false`, silently. A boot path that
   can throw because of a *sound* is the worst possible trade.
7. **iOS unlocks inside the gesture, synchronously.** `await` anything before `ctx.resume()` and
   the gesture is spent — the context stays suspended and the game is silent on iPhone only. Also
   note the hardware silent switch: a correctly unlocked context on iOS can still produce nothing,
   which is not a bug to chase.
8. **A burst is one chord, not twenty blips.** COLLECT ALL is twenty calls in one millisecond. The
   throttle and the ceiling are both required — the throttle handles the repeat of *one* sound, the
   ceiling handles twenty *different* ones.
9. **`setInterval` drifts, and a background tab throttles it to ≥1 s.** The timer decides only
   *when to schedule*; the notes are pinned to `currentTime`. And the horizon must exceed the worst
   throttle — hence `LOOKAHEAD_SEC = 1.5` against a `PUMP_INTERVAL_MS = 200` timer. A 250 ms
   horizon (the source's) is fine in a foreground tab and leaves audible gaps in a background one.
   Corollary from `PLAYBOOK.md` #3: never drive `pump()` from rAF alone, which is 0 Hz when hidden.
10. **One noise buffer, built once, looped, filled deterministically.** A fresh
    `createBuffer(1, sampleRate, sampleRate)` per hat is an allocation and a fill of 48,000 floats
    on the beat. Build it lazily on first use, share it, `loop = true`. Fill it with an xorshift,
    not `Math.random` — white noise does not care where its numbers come from, and the lint does.
11. **Disconnect in `onended`, inside a `try`.** Nodes that are never disconnected are retained by
    their connection; disconnecting one the engine has already collected throws. Both halves matter.
12. **Contexts are a capped resource.** Roughly six per document, historically. A test file that
    creates one per case, or a game that creates a second on a scene change, fails in a way that
    reads as a broken assertion. `dispose()` closes; `unlock()` is idempotent.
13. **Music off by default.** Music nobody asked for is the fastest route to a permanently muted
    game — and muting to escape music also loses the alarms, which are the sounds doing actual work.
    `createAudio` must therefore start with the music bus *unmuted* but the deck *not playing*:
    those are different states and conflating them means a game that restores a saved mixer with
    `music` muted can never work out why `music.play()` did nothing.
14. **A sound declared and never played.** The source project hit this class of defect — an
    artefact correct in isolation that lies about the game — five separate times. `validateSounds`
    cannot see it. The recipe belongs in the demo game's tests and in the README: grep `src` for
    every key of the table. Worth stating because every game built on this kit needs the same test.
15. **`noUncheckedIndexedAccess` is on, and `!` is banned.** `progression[bar]` is
    `number | undefined` and the sequencer indexes arrays whose length is data. `PLAYBOOK.md`
    trap 14 is exactly this bug shipping a black screen; here it would be a silent `NaN` frequency,
    which WebAudio accepts and renders as nothing. Handle the `undefined`.
16. **`NaN` and `Infinity` reach parameters happily and produce silence forever.** A `NaN` written
    to an `AudioParam` poisons it for the life of the node. Clamp at the boundary — `PlayOptions`,
    `Mixer`, `Bed.set` — and per rule 9, a `RangeError` naming the caller's mistake is the right
    answer for a *programmer* error like `bpm: 0`, while a *player-supplied* value like a slider
    position is clamped, not thrown.
17. **The 12 kB gzip budget is real** and this is the widest surface of the layer-1 packages.
    Refusal 2 in §4 is a size decision as much as a design one.

---

## Appendix — gaps this RFC found outside its own package

Routed rather than fixed, per `docs/LOOP.md` rule 5.

- **`persist` needs a device-scoped store, distinct from the save.** Mixer state, and any other
  per-device preference, must survive START OVER and must not ride along in an export. This is the
  reasoning the source game encoded by writing `foom.muted` straight to `localStorage`. If `persist`
  offers only versioned save slots, every game will bypass it for exactly this, which defeats the
  package. Suggested shape: a second namespace with no migration chain and no export.
- **Somebody owns screen-x → pan, and it is not `audio`.** Two lines that need a camera and a
  canvas width. `iso`'s camera is the natural home (`camera.panOf(worldX, worldY): number`, −1…1),
  or the demo game absorbs it and we learn whether anyone else wants it. Left out of this RFC
  because the layering forbids me from taking the dependency.
- **`core` must export a seeded RNG that is cheap to key by a tuple.** The music deck needs
  "roll for (bar, step, track)" without keeping a stream position, i.e. a stateless hash-to-unit
  function (`hash3(seed, a, b): number` in 0–1) alongside the streaming `Rng`. If `core` only
  offers a streaming generator, this package will grow its own hash, which is a determinism
  primitive living in the wrong place.
- **`core` needs a `clamp` and a finite-number assertion that produces rule-9 error text.** This
  package clamps at four boundaries and would otherwise write its own.
- **`.lattice/kit.json` needs three edits**, which I cannot make from my paths:
  (a) add `bed` to `packages.audio.modules` (§3.6);
  (b) reword the invariant *"`play()` in a headless run does nothing at all"* → *"produces no
  sound"*, since acceptance is now device-independent (§3.7);
  (c) list this package's exports once the builder lands them.
- **The demo game should be the one to answer the ducking question** (§4, refusal 9). If its
  brownout alarm cannot be heard over its theme, that is the evidence v2 needs.
