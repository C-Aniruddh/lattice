/**
 * `@lattice/audio` — sound without assets. Layer 1, depends only on `@lattice/core`.
 *
 * A table of oscillator recipes becomes the sound of a game: no files, no `AudioContext` until
 * the player touches something, a hard ceiling on how loud a burst can get, and one continuous
 * bed that follows a number the game already has.
 *
 * ```ts
 * const audio = createAudio({ sounds: {
 *   tap:     { bus: 'ui',  minGapMs: 40, layers: [{ wave: 'sine', hz: 1180, gain: 0.05, hold: 0.03, cutoff: 2400 }] },
 *   collect: { bus: 'sfx', minGapMs: 45, ladder: { steps: 5, windowMs: 900 },
 *              layers: [{ wave: 'triangle', hz: 660, toHz: 880, gain: 0.16, hold: 0.1, cutoff: 3200 }] },
 * } });
 *
 * addEventListener('pointerdown', () => audio.unlock()); // nothing exists before this line runs
 * audio.play('collect');                                 // the argument type is 'tap' | 'collect'
 * ```
 *
 * ## The four rules, and the fourth is what makes the rest testable
 *
 * 1. **No `AudioContext` until a user gesture unlocks it.** Not at module load, not at
 *    construction. A context created at boot is a console warning on every refresh and a
 *    suspended object in every unit test.
 * 2. **Silent, never throwing, where there is no WebAudio.** Importing this in a Node test is
 *    free, and `play()` in a headless run produces no sound and does not throw.
 * 3. **Bursts must not stack.** A per-sound minimum gap *and* a hard voice ceiling: summed
 *    gains above 1 clip into a click, and twenty simultaneous voices never sound twenty times
 *    better.
 * 4. **Policy above, rendering below.** Throttling, the ladder, the voice ceiling, bus
 *    resolution, sequencer step times and bed targets are all pure and clock-injected, emitting
 *    a reused {@link VoicePlan} through {@link Audio.onScheduled}. Almost everything is
 *    assertable with no mock at all. The price is stated openly rather than hidden: `play()`
 *    returns *accepted*, not *a speaker moved* — {@link Audio.available} answers that.
 *
 * ## What this package deliberately does not have
 *
 * Audio files and `decodeAudioData`; a modular routing graph, LFOs or an effects rack — the
 * moment routing is author-defined the clipping ceiling can no longer be validated statically;
 * `PannerNode` and HRTF, which is 3D machinery for a 2D game priced per voice; `AnalyserNode`,
 * because a visualiser needs a real device and `onScheduled` gives a HUD the beat without one;
 * a module-level singleton, which would make two games on one page impossible; any use of
 * `localStorage` — {@link Mixer.snapshot} returns a value and the game hands it to
 * `@lattice/persist`; and an auto-unlock listener of its own, because `@lattice/input` owns the
 * DOM event surface and the game calls {@link Audio.unlock}.
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';

// ── the vocabulary and the table ────────────────────────────────────────────────
export { ATTACK_SEC, BUS_NAMES, MAX_VOICES, RAMP_SEC, SEMITONE, validateSounds } from './sounds.js';
export type { BusId, BusName, Layer, PlayOptions, SoundDef, SoundProblem, VoicePlan, Wave } from './sounds.js';

// ── the mixer ───────────────────────────────────────────────────────────────────
//
// Gain and mute are two values, never one: a mute implemented as "set the gain to 0" is the
// bug where turning the music back on returns it at full volume.
export { effectiveGain } from './bus.js';
export type { Mixer, MixerState } from './bus.js';

// ── the engine ──────────────────────────────────────────────────────────────────
export { createAudio } from './engine.js';
export type { Audio, AudioOptions } from './engine.js';

// ── the bed: the continuous half ────────────────────────────────────────────────
//
// Argued before the sequencer and it matters more. A loop is annoying at twenty minutes
// because it is the same twenty minutes regardless of what the player did — melody wears out,
// texture does not.
export { createBed } from './bed.js';
export type { Bed, BedLayer, BedOptions } from './bed.js';

// ── the deck: opt-in, so a game that wants only the drone does not ship it ───────
export { LOOKAHEAD_SEC, PUMP_INTERVAL_MS, createDeck, validateSong } from './music.js';
export type { MusicDeck, Note, Song, SongProblem, Track, TrackVoice } from './music.js';
