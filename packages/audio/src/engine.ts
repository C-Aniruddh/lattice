/**
 * The engine: a table of recipes, a gesture, and a `play` that is honest about what it did.
 *
 * ## The four rules this module exists to keep
 *
 * **1. Nothing is created before a gesture.** No `AudioContext` at module load and none at
 * construction. Browsers block audio before a gesture anyway; the stronger reason is that a
 * context created at boot is a console warning on every refresh and a suspended object in
 * every unit test. {@link Audio.unlock} is called from the game's own interaction handler and
 * everything before it is a silent no-op.
 *
 * **2. Silent where there is no audio, never an exception.** There is no `AudioContext` in
 * Node. Every entry point checks and returns rather than throwing, so importing this in a test
 * is free and `play()` in a headless run produces no sound.
 *
 * **3. Bursts must not stack.** Two independent defences, because they fail differently: a
 * per-sound `minGapMs` and a hard voice ceiling. See `voice.ts`.
 *
 * **4. Policy above, rendering below.** Everything in this file that decides anything is pure
 * and driven by an injected clock, and it emits a reused {@link VoicePlan} through
 * {@link Audio.onScheduled}. The device is reached through one interface with five methods.
 * The price is stated openly rather than hidden: **`play()` returns "accepted", not "a speaker
 * moved"**, so the same branch runs everywhere and {@link Audio.available} answers the other
 * question. A policy that only runs when a device exists is a policy nobody can test.
 *
 * ## The fifth thing, which is a property of this file rather than a rule about sound
 *
 * **Every option reads back off the engine, and the two that are policy also move.** For
 * `maxVoices` that is not a convenience: `dispose()` closes the `AudioContext`, a document gets
 * about six of them ever, so a ceiling that can only change by rebuilding is a ceiling whose
 * slider silences the page after six drags. It is one integer in one comparison — nothing
 * allocated from it, no handle derived from it, nothing recorded carrying it — so nothing
 * downstream has a correctness claim that it did not change, and it is live. The table and the
 * context are the opposite case: the id union and the node graph are already built from them,
 * so they are readable and the setter for either is `new`. `docs/rfc/live-options.md` is the
 * test both answers come from.
 */

import { clamp, createScope, type Disposer, type Scope } from '@lattice/core';

import { createMixer, effectiveGain, type Mixer } from './bus.js';
import { defaultContext } from './host.js';
import { createRenderer, type Renderer } from './render.js';
import {
  BUS_NAMES,
  MAX_VOICES,
  type BusId,
  type PlayOptions,
  type SoundDef,
  type VoicePlan,
} from './sounds.js';
import { createPlayPolicy, createVoiceRequest, fillRequest, type VoiceRequest } from './voice.js';

/**
 * Absolute pan limit. Hard pan is fatiguing on headphones, which is where most of these games
 * are played: full-width panning is a gimmick, two thirds of the width is atmosphere.
 */
const DEFAULT_MAX_PAN = 0.6;

/** Options for {@link createAudio}. Every field has a default that is right for a game. */
export interface AudioOptions<Ids extends string> {
  /**
   * The table. Its **keys become the type** of {@link Audio.play}'s first argument, so there
   * is no id union to maintain by hand and `play('colect')` is a compile error.
   */
  readonly sounds: Readonly<Record<Ids, SoundDef>>;
  /**
   * How to obtain a context. Defaults to `AudioContext ?? webkitAudioContext`, returning
   * `null` when neither exists or when construction throws.
   *
   * This is the seam the whole test suite hangs from — `context: () => null` is a headless
   * run, and a spy proves nothing is constructed before `unlock`. It is also how a host that
   * already owns a context, an app embedding two Lattice games, passes one in.
   */
  readonly context?: () => AudioContext | null;
  /**
   * The clock, in audio-clock **seconds**. Defaults to the context's `currentTime`, and to a
   * constant zero when there is no context.
   *
   * Two consequences worth stating. First, `performance.now()` never appears in this package,
   * so the determinism lint passes with no exemption. Second, throttles are measured in the
   * same time base as scheduling, so a throttle can never disagree with the notes it is
   * throttling. Author-facing fields stay in milliseconds (`minGapMs`, `windowMs`) because
   * that is the unit a human reasons about; the conversion is this package's problem.
   *
   * Supplying one **overrides** the device clock, which is what a test wants and what a game
   * almost never does: a clock that disagrees with `currentTime` schedules notes in the past.
   */
  readonly now?: () => number;
  /**
   * Override {@link MAX_VOICES}. Lower it on a game with a busy bed; raising it is almost
   * always wrong, because twenty simultaneous voices never sound twenty times better and
   * their gains sum into a clip.
   *
   * **Policy, not identity: read it back with {@link Audio.maxVoices} and move it with
   * {@link Audio.setMaxVoices}.** It is one integer in one comparison — nothing is allocated
   * from it and nothing recorded carries it — so the honest way to offer a player a voice
   * slider is that setter and never a rebuild. `dispose()` closes the `AudioContext` and a
   * document gets about six of them; a ceiling that could only be changed by rebuilding is a
   * slider that permanently silences the page after six drags.
   */
  readonly maxVoices?: number;
  /**
   * Absolute pan limit, default 0.6. Read it back with {@link Audio.maxPan} and move it with
   * {@link Audio.setMaxPan} — `setMaxPan(0)` is a mono switch for a settings screen, and it
   * costs no nodes and no rebuild.
   */
  readonly maxPan?: number;
}

/**
 * The engine. One per game; there is deliberately no module-level singleton.
 *
 * **Every field of {@link AudioOptions} is readable off this object**, because a value a caller
 * handed over and cannot read back is a value they must store twice, and two copies drift with
 * no error when they do. Two of them also move:
 *
 * | option | read it back | move it |
 * |---|---|---|
 * | `sounds` | {@link Audio.sounds} | the id union is the table's keys — a different table is a different engine |
 * | `context` | {@link Audio.context} — the device it produced | `unlock` builds it once; there is no second |
 * | `now` | {@link Audio.now} | it is the clock; a game that wants a different one builds a different engine |
 * | `maxVoices` | {@link Audio.maxVoices} | {@link Audio.setMaxVoices} |
 * | `maxPan` | {@link Audio.maxPan} | {@link Audio.setMaxPan} |
 *
 * The line between the two halves is `docs/rfc/live-options.md`'s single question — *does
 * anything downstream have a **correctness** claim that this value did not change?* The table
 * and the context are identity: the id union, the node graph and the device are already built
 * from them. The ceiling and the pan limit are policy: two numbers read inside a comparison and
 * a clamp, with nothing allocated, handed out or written down that depends on either.
 */
export interface Audio<Ids extends string> {
  /** The three buses and master. Survives `unlock` — levels set before a device apply after it. */
  readonly mixer: Mixer;
  /** Whether a real device exists. False in Node, in a locked-down browser, and before `unlock`. */
  readonly available: boolean;
  /**
   * One-shot voices whose scheduled end is still in the future. A bed's layers and a deck's
   * notes are **not** counted: a bed never ends, so counting it would eat the ceiling forever.
   *
   * May read **above** {@link Audio.maxVoices} for one release tail after the ceiling is
   * lowered — see {@link Audio.setMaxVoices}. It is what is sounding, not what is allowed.
   */
  readonly voices: number;

  /**
   * The engine's own frozen copy of {@link AudioOptions.sounds}.
   *
   * Frozen, and a copy, for one reason: the engine looks its recipes up in a map taken at
   * construction, so a getter that handed back the caller's object would happily report an id
   * that `play` refuses the moment they added one to it. What you read here is what the engine
   * will actually play.
   *
   * For a debug overlay listing every sound, a test asserting the table it was built from, and
   * `validateSounds(audio.sounds)` on a table assembled at runtime. The `SoundDef`s inside are
   * the caller's own objects and are not deep-frozen — mutating one still changes what plays,
   * which is a thing to avoid rather than a thing this copy can prevent.
   */
  readonly sounds: Readonly<Record<Ids, SoundDef>>;

  /**
   * The device {@link AudioOptions.context} produced, or `null` before the first successful
   * `unlock` and after `dispose`.
   *
   * The *factory* is not handed back, and that is the point: calling it again is how a page
   * ends up with two contexts out of the six or so it will ever get. This is the readback for
   * that option in the only form that is useful — a settings screen showing `sampleRate` or
   * `state`, or a host embedding two Lattice games that needs to prove they share one device.
   *
   * **Do not `close()` it.** That is `dispose`'s job, and closing it behind the engine's back
   * leaves an engine that reports `available` and renders silence.
   */
  readonly context: AudioContext | null;

  /**
   * The engine's clock, in audio-clock **seconds** — {@link AudioOptions.now}, or the device's
   * `currentTime`, or a constant zero when there is neither.
   *
   * The readback for `now`, and the only honest source for {@link PlayOptions.at}: a caller
   * placing a sound inside a beat has to name a time in *this* clock, and reading
   * `context.currentTime` themselves is wrong before `unlock` and wrong again whenever a clock
   * was injected. A non-finite reading is coerced to 0 here rather than passed on, because
   * `NaN` reaching a scheduled time silently stops the throttle throttling.
   */
  now(): number;

  /**
   * The hard ceiling on one-shot voices in flight — {@link AudioOptions.maxVoices}, or
   * {@link MAX_VOICES}, or whatever {@link Audio.setMaxVoices} last set.
   *
   * It exists so nothing keeps a second copy. The slider that moves the ceiling needs its own
   * current value to render; a HUD showing "17 / 24" needs the denominator; a diagnostic
   * reporting a refused burst needs to name the number that refused it. Given no reader, each
   * of those keeps its own copy, and they agree until the first `setMaxVoices` and never after.
   */
  readonly maxVoices: number;

  /**
   * Move the voice ceiling. Takes effect on the **next** `play`.
   *
   * A setter rather than a rebuild, because rebuilding is not renewable here: `dispose()`
   * closes the `AudioContext`, browsers cap live contexts per document at about six, and a
   * ceiling slider that rebuilt the engine on every drag would permanently silence the page in
   * roughly a second. Nothing downstream has a correctness claim on this number — it is one
   * integer in one comparison, no buffer is sized from it, no handle derived from it, and no
   * save or log records it.
   *
   * **Lowering it below what is already sounding refuses new plays; it does not cut live ones
   * short.** Those voices are scheduled on the device already and stopping them early is an
   * audible chop, so {@link Audio.voices} may exceed the new ceiling until their release tails
   * pass. Raising it admits again immediately — there is nothing to rebuild on the way back up.
   *
   * @throws RangeError if `maxVoices` is not an integer >= 1 — the same refusal, in the same
   *   words, that `createAudio` gives, because this number is author-facing at both entrances
   *   and a ceiling of 0 is silence nobody can debug. A rejected call changes nothing.
   */
  setMaxVoices(maxVoices: number): void;

  /**
   * The absolute pan limit in force, 0–1 — {@link AudioOptions.maxPan}, or 0.6, or whatever
   * {@link Audio.setMaxPan} last set. `VoicePlan.pan` is already clamped to ±this.
   *
   * Read it to render a "stereo width" control without keeping a copy of the number it moves,
   * and to explain why a sound asked for `pan: 1` and landed at 0.6.
   */
  readonly maxPan: number;

  /**
   * Move the pan limit. Applies to the next `play`; voices already scheduled keep the pan they
   * were built with, because a panner's value is set once at construction of that voice.
   *
   * `setMaxPan(0)` is a mono switch, which is a real accessibility setting and costs no nodes.
   * **Clamped into `[0, 1]` and a non-finite value is ignored rather than stored**, which is
   * the same rule `createAudio` applies to the same field: this one can reach a settings
   * slider, and a `NaN` written to an `AudioParam` poisons that node for its whole life. A
   * setter inherits its value's policy; it does not get a stricter or a softer one for being a
   * setter.
   */
  setMaxPan(maxPan: number): void;

  /**
   * Create the context, or resume one the browser suspended. Idempotent and cheap; call it
   * from every interaction handler you have.
   *
   * Resuming matters as much as creating. A tab backgrounded long enough gets its context
   * suspended, and without the resume, sound works for one session and then silently stops.
   *
   * Returns {@link available}, so a settings panel can say "audio unavailable" truthfully.
   */
  unlock(): boolean;

  /**
   * Play a sound if policy allows it right now. Returns whether it was **accepted** — not
   * whether a speaker moved.
   *
   * Acceptance is decided by the throttle, the ladder and the voice ceiling, all of which run
   * identically with or without a device. A rejection means one of those three said no: the
   * same sound played again inside its `minGapMs`, or the ceiling is full. Use
   * {@link available} to ask about the device.
   */
  play(id: Ids, options?: PlayOptions): boolean;

  /**
   * Observe every voice the engine schedules, one call per layer. Returns a disposer.
   *
   * Two customers, which is why it earns an export where a test-only hook would not: a test
   * asserts on plans with no device at all, and a HUD flashes a meter on the beat without an
   * `AnalyserNode` or a real context. **The plan object is reused** — copy what you keep.
   */
  onScheduled(listener: (plan: Readonly<VoicePlan>) => void): Disposer;

  /**
   * Stop everything, disconnect, close the context, and tear down every bed and deck built on
   * this engine.
   *
   * Not optional politeness: browsers cap live contexts per document — six, historically — and
   * a test file that creates one per case exhausts that cap and fails in a way that looks like
   * a broken assertion. Every method is a silent no-op afterwards.
   */
  dispose(): void;
}

/**
 * The seam `bed.ts` and `music.ts` reach the engine through — **not part of the public API**,
 * and not re-exported from `index.ts`.
 *
 * A `WeakMap` keyed on the engine object rather than a property on it, so the public interface
 * stays exactly what the RFC specifies and a game cannot reach the renderer by accident. Both
 * of the free factories are documented as working on an engine they did not build; this is how
 * they do it, and how they degrade to a silent object when handed something else.
 */
export interface EngineInternals {
  /** Disposed with the engine. Beds and decks register their teardown here. */
  readonly scope: Scope;
  /** The engine's clock, in audio-clock seconds. */
  now(): number;
  /** True once the engine is disposed, after which every producer must fall silent. */
  isDisposed(): boolean;
  /** The device, or `null` before the first successful `unlock`. */
  renderer(): Renderer | null;
  /** Called on the unlock that creates the device — once, ever. Returns a disposer. */
  onUnlock(listener: (renderer: Renderer) => void): Disposer;
  /** Report a voice to `onScheduled` listeners without rendering it. The bed's path. */
  emit(request: Readonly<VoiceRequest>): void;
  /** Report *and* render a one-shot voice, bypassing the ceiling. The deck's path. */
  schedule(request: Readonly<VoiceRequest>): void;
}

/** The registry behind {@link internalsOf}. Weak, so an engine nobody holds is collectable. */
const internals = new WeakMap<object, EngineInternals>();

/**
 * The internals of an engine this package built, or `undefined` for anything else.
 *
 * `createBed` and `createDeck` are free functions taking an `Audio`, so they must cope with an
 * object that merely satisfies the interface. Returning `undefined` lets them hand back an
 * inert bed or deck instead of throwing, which keeps rule 2 — silent, never throwing — true
 * even for a caller doing something odd.
 */
export function internalsOf<Ids extends string>(audio: Audio<Ids>): EngineInternals | undefined {
  return internals.get(audio);
}

/**
 * Build an engine. The only constructor, and it creates nothing until {@link Audio.unlock}.
 *
 * There is deliberately no module-level singleton. The source game this kit came from has one
 * and it is right for a game; it is wrong for a kit, because it makes two games on one page
 * impossible, makes test order matter, and creates state at import time in a package whose
 * first rule is that nothing exists until a gesture.
 *
 * @throws RangeError if `maxVoices` is not a positive integer — a programmer error, and the
 *   one thing here worth refusing loudly, because a ceiling of 0 is silence nobody can debug.
 *   {@link Audio.setMaxVoices} refuses the same values in the same words.
 */
export function createAudio<Ids extends string>(options: AudioOptions<Ids>): Audio<Ids> {
  // The engine's own copy, so `audio.sounds` and the map below can never disagree: both are
  // this instant's table, and neither can be added to afterwards.
  const sounds: Readonly<Record<Ids, SoundDef>> = Object.freeze({ ...options.sounds });
  const table = new Map<string, SoundDef>(Object.entries<SoundDef>(sounds));
  const acquire = options.context ?? defaultContext;
  const injectedClock = options.now;

  // The ceiling lives on the policy and nowhere else. A second copy here would be a getter
  // over a stale local the first time one of the two assignments was forgotten.
  const policy = createPlayPolicy(adoptMaxVoices(options.maxVoices ?? MAX_VOICES, 'createAudio'));
  let maxPan = adoptMaxPan(options.maxPan, DEFAULT_MAX_PAN);
  const request = createVoiceRequest();
  const listeners = new Set<(plan: Readonly<VoicePlan>) => void>();
  const unlockListeners = new Set<(renderer: Renderer) => void>();
  const scope = createScope();

  let renderer: Renderer | null = null;
  /** The device behind {@link Audio.context}. Kept beside the renderer, never re-acquired. */
  let device: AudioContext | null = null;
  let disposed = false;

  const clock = (): number => {
    const seconds = injectedClock !== undefined ? injectedClock() : (renderer?.now() ?? 0);
    // A clock that returns NaN would poison every scheduled time and every throttle
    // comparison — `NaN < gap` is false, so the throttle would silently stop throttling.
    return Number.isFinite(seconds) ? seconds : 0;
  };

  const emit = (voice: Readonly<VoiceRequest>): void => {
    for (const listener of listeners) listener(voice);
  };

  const mixer = createMixer((bus, effective, rampSec) => {
    renderer?.setBusGain(bus, effective, rampSec);
  });

  const audio: Audio<Ids> = {
    mixer,
    sounds,

    get available(): boolean {
      return !disposed && renderer !== null;
    },

    get voices(): number {
      return disposed ? 0 : policy.voices(clock());
    },

    get context(): AudioContext | null {
      return disposed ? null : device;
    },

    now(): number {
      return clock();
    },

    get maxVoices(): number {
      return policy.maxVoices;
    },

    setMaxVoices(next: number): void {
      // Validated before it is assigned, so a rejected call leaves the ceiling exactly where
      // it was rather than half-moved.
      policy.maxVoices = adoptMaxVoices(next, 'audio.setMaxVoices');
    },

    get maxPan(): number {
      return maxPan;
    },

    setMaxPan(next: number): void {
      maxPan = adoptMaxPan(next, maxPan);
    },

    unlock(): boolean {
      if (disposed) return false;
      if (renderer !== null) {
        renderer.resume();
        return true;
      }
      let context: AudioContext | null = null;
      try {
        context = acquire();
      } catch {
        // A browser that refuses to give us a context is a browser that plays no sound. That
        // is a perfectly good outcome and must never be an exception on the boot path.
        return false;
      }
      if (context === null) return false;
      let built: Renderer;
      try {
        built = createRenderer(context);
      } catch {
        return false;
      }
      renderer = built;
      device = context;
      // Levels chosen before the device existed apply now, with no ramp: there is nothing
      // running yet to click.
      for (const bus of BUS_NAMES) built.setBusGain(bus, effectiveGain(mixer, bus), 0);
      built.resume();
      for (const listener of unlockListeners) listener(built);
      return true;
    },

    play(id: Ids, playOptions?: PlayOptions): boolean {
      if (disposed) return false;
      const definition = table.get(id);
      if (definition === undefined) return false;
      const layers = definition.layers;
      if (layers.length === 0) return false;

      const at = clock();
      const step = policy.admit(id, definition, layers.length, at);
      if (step < 0) return false;

      const bus: BusId = definition.bus ?? 'sfx';
      const spatial = definition.spatial ?? bus === 'sfx';
      const gainScale = clamp(finite(playOptions?.gain, 1), 0, 1);
      const semitones = step + finite(playOptions?.detune, 0);
      // The event's pan wins over the recipe's, but only for a sound that opted into being
      // spatial: an interface click that slides across the stereo field as the player drags
      // the map is the most disorienting thing this package can do.
      const eventPan = spatial ? playOptions?.pan : undefined;
      const start = finite(playOptions?.at, at);

      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        if (layer === undefined) continue;
        const pan = clamp(finite(eventPan, layer.pan ?? 0), -maxPan, maxPan);
        fillRequest(request, id, bus, index, layer, start, gainScale, semitones, pan);
        policy.hold(request.end);
        renderer?.play(request);
        emit(request);
      }
      return true;
    },

    onScheduled(listener: (plan: Readonly<VoicePlan>) => void): Disposer {
      listeners.add(listener);
      let removed = false;
      return scope.add((): void => {
        if (removed) return;
        removed = true;
        listeners.delete(listener);
      });
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Beds and decks first, so nothing is still ramping when the context goes away.
      scope.dispose();
      policy.clear();
      listeners.clear();
      unlockListeners.clear();
      renderer?.close();
      renderer = null;
      // The context is closed; reporting it afterwards would hand out a device that renders
      // silence and cannot be reopened.
      device = null;
    },
  };

  internals.set(audio, {
    scope,
    now: clock,
    isDisposed: () => disposed,
    renderer: () => renderer,
    onUnlock(listener: (device: Renderer) => void): Disposer {
      unlockListeners.add(listener);
      let removed = false;
      return (): void => {
        if (removed) return;
        removed = true;
        unlockListeners.delete(listener);
      };
    },
    emit,
    schedule(voice: Readonly<VoiceRequest>): void {
      renderer?.play(voice);
      emit(voice);
    },
  });

  return audio;
}

/**
 * Check a voice ceiling wherever it arrives, and hand it back.
 *
 * One validator, two entrances, the same words: a ceiling that is not a positive integer is a
 * programmer error at `createAudio` and the identical programmer error at `setMaxVoices`, and
 * an author who reads one message must not have to work out whether the other means the same
 * thing. `fn` names the entrance and nothing else changes — the same shape `draw`'s
 * `light.ts` uses for `createLightField` and `configure`.
 *
 * It throws rather than clamps because this number is **author-facing at both entrances**. A
 * player-facing value clamps (see {@link Audio.setMaxPan}, `Mixer.setGain`); an author-facing
 * one names the mistake, because a ceiling of 0 is a game that is silent with no error and a
 * ceiling of 2.5 is a comparison that behaves like neither 2 nor 3.
 */
function adoptMaxVoices(value: number, fn: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${fn}: expected maxVoices to be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

/**
 * Take a pan limit wherever it arrives, clamped into `[0, 1]`.
 *
 * The counterpart to {@link adoptMaxVoices} and deliberately the softer rule, for the reason
 * the kit splits everywhere else: this value can reach a settings slider, and a settings slider
 * must not be able to throw. A non-finite value falls back to `fallback` — the package default
 * at construction, and *the limit already in force* at the setter, so a `NaN` frame from a
 * dragged control leaves the field exactly as it was instead of snapping it to 0.6.
 */
function adoptMaxPan(value: number | undefined, fallback: number): number {
  return clamp(finite(value, fallback), 0, 1);
}

/**
 * A caller-supplied number, or the fallback when it is absent or not finite.
 *
 * Player- and camera-derived values arrive here, and `NaN` written to an `AudioParam` poisons
 * that parameter for the life of the node — which for a bed layer is the life of the session.
 * Clamping at the boundary is the difference between one quiet sound and permanent silence.
 */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
