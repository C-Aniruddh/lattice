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
   */
  readonly maxVoices?: number;
  /** Absolute pan limit, default 0.6. */
  readonly maxPan?: number;
}

/** The engine. One per game; there is deliberately no module-level singleton. */
export interface Audio<Ids extends string> {
  /** The three buses and master. Survives `unlock` — levels set before a device apply after it. */
  readonly mixer: Mixer;
  /** Whether a real device exists. False in Node, in a locked-down browser, and before `unlock`. */
  readonly available: boolean;
  /**
   * One-shot voices whose scheduled end is still in the future. A bed's layers and a deck's
   * notes are **not** counted: a bed never ends, so counting it would eat the ceiling forever.
   */
  readonly voices: number;

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
 */
export function createAudio<Ids extends string>(options: AudioOptions<Ids>): Audio<Ids> {
  const table = new Map<string, SoundDef>(Object.entries<SoundDef>(options.sounds));
  const maxVoices = options.maxVoices ?? MAX_VOICES;
  if (!Number.isInteger(maxVoices) || maxVoices < 1) {
    throw new RangeError(
      `createAudio: expected maxVoices to be an integer >= 1, got ${String(maxVoices)}`,
    );
  }
  const maxPan = clamp(finite(options.maxPan, DEFAULT_MAX_PAN), 0, 1);
  const acquire = options.context ?? defaultContext;
  const injectedClock = options.now;

  const policy = createPlayPolicy(maxVoices);
  const request = createVoiceRequest();
  const listeners = new Set<(plan: Readonly<VoicePlan>) => void>();
  const unlockListeners = new Set<(renderer: Renderer) => void>();
  const scope = createScope();

  let renderer: Renderer | null = null;
  let disposed = false;

  const now = (): number => {
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

    get available(): boolean {
      return !disposed && renderer !== null;
    },

    get voices(): number {
      return disposed ? 0 : policy.voices(now());
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

      const at = now();
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
    },
  };

  internals.set(audio, {
    scope,
    now,
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
 * A caller-supplied number, or the fallback when it is absent or not finite.
 *
 * Player- and camera-derived values arrive here, and `NaN` written to an `AudioParam` poisons
 * that parameter for the life of the node — which for a bed layer is the life of the session.
 * Clamping at the boundary is the difference between one quiet sound and permanent silence.
 */
function finite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
