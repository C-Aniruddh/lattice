/**
 * The bed: the continuous half, and the real answer to "what survives twenty minutes".
 *
 * ## Why the drone comes before the sequencer
 *
 * A loop is annoying at twenty minutes because it is *the same twenty minutes regardless of
 * what the player did*. What wears out is **melody** — the thing the ear learns, predicts and
 * then resents. Texture does not wear out; nobody has ever been annoyed by rain.
 *
 * A bed has nothing to remember, and when it is driven by game state it stops being decoration
 * and becomes a **readout**: it thickens as the world grows, so scale is something you hear
 * before you look at a number, and it *sags in pitch* when the power goes, because plant
 * losing power winds down. A drop in level alone reads as a mixing change; a drop in pitch
 * reads as machinery stopping. Information does not become tedious.
 *
 * And without one, a Lattice game is silent between taps — which for an idle game is 95% of a
 * session. Every game built on this kit would hand-roll a bed, badly, with `Math.random`.
 *
 * ## A note is an event; a drone is a state
 *
 * That is why this is not the sequencer with a 0 bpm mode. What the two share, and all they
 * share, is a vocabulary: both take a 0–1 level with the same meaning, both write to the same
 * buses, and a game drives both from the same number in one line.
 *
 * Everything here is pure and clock-injected except the two lines that hand a target to a
 * `ToneHandle`. Targets are emitted through `onScheduled` as they change, so what a bed is
 * *doing* is assertable in Node with no device at all.
 */

import { clamp, type Disposer } from '@lattice/core';

import { internalsOf, type Audio } from './engine.js';
import type { Renderer, ToneHandle } from './render.js';
import type { BusId, Wave } from './sounds.js';
import { createVoiceRequest } from './voice.js';

/** Pitch multiplier at `tone = 0`, by default. Fans spinning down, not fans switched off. */
const DEFAULT_SAG_TO = 0.55;

/**
 * Seconds for a change to arrive, by default.
 *
 * Roughly a second, and far slower than {@link RAMP_SEC}. A bed that arrives in 15 ms reads as
 * an *edit*; a bed that takes a second reads as a room you walked into.
 */
const DEFAULT_GLIDE_SEC = 1;

/**
 * How far the top end closes at `tone = 0`, as a multiple of the layer's cutoff.
 *
 * Not zero: a bed whose filter shuts completely is a bed that vanishes, and the point of
 * `tone` is that the world changes character rather than disappearing.
 */
const TONE_CUTOFF_FLOOR = 0.35;

/**
 * One continuous layer of a bed. Every layer runs forever; only its gain, filter and pitch
 * move.
 *
 * There is deliberately no `pan`. Panning a *transient* by screen position makes a world a
 * place rather than a picture; panning anything *continuous* means it sweeps across the stereo
 * field every time the camera moves, which reads as a fault.
 */
export interface BedLayer {
  readonly wave: Wave;
  /** Base frequency in Hz, before the sag. Ignored when `wave` is `noise`. */
  readonly hz: number;
  /**
   * Gain at level 1, scaled toward silence as the level falls — linearly, so `level` and
   * loudness are the same number and a test can assert an exact product. An empty world is
   * silent, not quiet.
   */
  readonly gain: number;
  /** Low-pass corner in Hz at level 0. Filtered noise is the only honest way to do moving air. */
  readonly cutoff: number;
  /**
   * Multiple the cutoff opens to at full level. This, and not gain, is what makes a busy hall
   * sound busy: volume alone reads as "the same hum, nearer", while the top end arriving reads
   * as "there is a lot of it".
   */
  readonly cutoffAtFull?: number;
  /**
   * Detune in Hz, added to `hz`. Write two layers with the same `hz` and give the second a
   * `beat` of a fraction of a hertz: two near-identical sources beat, audibly, and that beat
   * is what stops a bed sounding like a synthesiser pad. Real plant is never in phase.
   */
  readonly beat?: number;
  /**
   * The range of `tone` this layer speaks over, at full weight in the middle and fading to
   * nothing at each edge. Omit for "always".
   *
   * **This is what makes the bed a soundscape rather than a hum with a knob.** Crickets on a
   * low band and coil whine on a high one, and the valley crossfades between them as the same
   * number that lerps the palette moves: one filter sweep sounds like a filter sweep, two
   * layers trading places sounds like evening.
   *
   * A band that touches 0 or 1 does not fade at that end — a layer banded `[0, 0.5]` is at
   * full weight at `tone = 0`, not silent there. **Overlap adjacent bands** (`[0, 0.5]` and
   * `[0.4, 1]`, not `[0, 0.4]` and `[0.55, 1]`), or keep one unbanded layer: a bed that is
   * completely silent at some middle value of `tone` is a hole the player walks into.
   */
  readonly band?: readonly [number, number];
}

/** How a bed is wired, as opposed to what it sounds like. Every field has a working default. */
export interface BedOptions {
  /**
   * Default `'sfx'`, so a player muting *music* does not silence the world. The bed is not a
   * soundtrack — it is the room.
   */
  readonly bus?: BusId;
  /** Pitch multiplier at `tone = 0`. Default 0.55. Clamped to (0, 1]. */
  readonly sagTo?: number;
  /** Seconds for a change to arrive. Default ~1. Clamped to at least a millisecond. */
  readonly glideSec?: number;
}

/** A running bed. Build it with {@link createBed}; drive it every frame; stop it once. */
export interface Bed {
  /**
   * Drive the bed. **Safe to call every frame** — it ramps toward the figures rather than
   * resetting anything, so nothing clicks, nothing restarts, and nothing is allocated. A layer
   * whose targets have not moved is not re-issued at all: `setTargetAtTime` with an unchanged
   * target re-anchors the curve, so a bed nudged every frame would never actually arrive.
   *
   * A non-finite argument leaves that value as it was, rather than clamping to an edge: `NaN`
   * reaching an `AudioParam` poisons it for the life of the node, and a bed layer's node lives
   * as long as the session.
   *
   * @param level 0–1, how much of the world is running. Scales gain and opens the filters.
   * @param tone  0–1, what kind of world it is right now: daylight, health, power. Below 1 the
   *              pitch sags, the top end closes, and banded layers trade places. Default 1.
   */
  set(level: number, tone?: number): void;
  /** The last level given, clamped. For a HUD, and so a game need not keep its own copy. */
  readonly level: number;
  /** The last tone given, clamped. */
  readonly tone: number;
  /**
   * Fade out and tear the layers down. A stopped bed cannot restart — build another. Safe to
   * call twice, and safe to call with no device.
   */
  stop(fadeSec?: number): void;
}

/**
 * Stand up a bed on an engine.
 *
 * A free function rather than a method on `Audio` so that a game wanting sounds and nothing
 * else does not carry it, and so that two beds — a valley and an interior — are the obvious
 * thing rather than a special case.
 *
 * **A bed built before `unlock()` stands its nodes up on the first unlock**, at whatever
 * level it has been driven to in the meantime, so a game may create it during boot and drive
 * it from frame one. Bed layers are **not** counted against the voice ceiling: they never end,
 * so a counter driven by `onended` could never decrement them, and five layers must not eat a
 * fifth of the ceiling forever. They are bounded by construction instead — the layer count is
 * fixed here and cannot grow.
 */
export function createBed<Ids extends string>(
  audio: Audio<Ids>,
  layers: readonly BedLayer[],
  options?: BedOptions,
): Bed {
  const engine = internalsOf(audio);
  const bus: BusId = options?.bus ?? 'sfx';
  const sagTo = clamp(finiteOr(options?.sagTo, DEFAULT_SAG_TO), 0.01, 1);
  const glideSec = Math.max(0.001, finiteOr(options?.glideSec, DEFAULT_GLIDE_SEC));
  const count = layers.length;

  // Preallocated, so `set` allocates nothing on a per-frame path. NaN means "never applied",
  // which is what makes the first call always take.
  const lastGain = new Float64Array(count).fill(Number.NaN);
  const lastHz = new Float64Array(count).fill(Number.NaN);
  const lastCutoff = new Float64Array(count).fill(Number.NaN);
  const handles: (ToneHandle | undefined)[] = new Array<ToneHandle | undefined>(count);
  const request = createVoiceRequest();

  let level = 0;
  let tone = 1;
  let stopped = false;

  /** Apply the current level and tone to every layer, optionally ignoring the change filter. */
  const drive = (force: boolean): void => {
    if (engine === undefined || stopped || engine.isDisposed()) return;
    const at = engine.now();
    for (let index = 0; index < count; index += 1) {
      const layer = layers[index];
      if (layer === undefined) continue;
      const gain = layer.gain * level * bandWeight(layer.band, tone);
      const hz = (layer.hz + (layer.beat ?? 0)) * (sagTo + (1 - sagTo) * tone);
      const cutoff =
        layer.cutoff *
        (1 + ((layer.cutoffAtFull ?? 1) - 1) * level) *
        (TONE_CUTOFF_FLOOR + (1 - TONE_CUTOFF_FLOOR) * tone);

      if (!force && gain === lastGain[index] && hz === lastHz[index] && cutoff === lastCutoff[index]) {
        continue;
      }
      lastGain[index] = gain;
      lastHz[index] = hz;
      lastCutoff[index] = cutoff;

      handles[index]?.set(gain, hz, cutoff, glideSec, at);

      // A bed is a state, not an event, so what it emits is "this layer is now heading here".
      // It is emitted whether or not there is a device, which is what makes the crossfade
      // assertable in a Node test.
      request.source = 'bed';
      request.bus = bus;
      request.layer = index;
      request.wave = layer.wave;
      request.hz = hz;
      request.toHz = hz;
      request.gain = gain;
      request.pan = 0;
      request.start = at;
      request.end = at + glideSec;
      request.attack = glideSec;
      request.cutoff = cutoff;
      request.highpass = undefined;
      engine.emit(request);
    }
  };

  const teardown = (fadeSec: number): void => {
    const at = engine?.now() ?? 0;
    for (let index = 0; index < count; index += 1) {
      handles[index]?.stop(fadeSec, at);
      handles[index] = undefined;
    }
  };

  /** Removes the pending unlock registration, so a stopped bed cannot stand up later. */
  let cancelStandUp: Disposer | undefined;

  if (engine !== undefined) {
    // No `stopped` guard here, and that is a property rather than an oversight: the only way
    // in is the unlock listener, and both `stop()` and the engine's teardown cancel it before
    // setting the flag. A bed that has been stopped cannot be reached by a later gesture.
    const stand = (device: Renderer): void => {
      for (let index = 0; index < count; index += 1) {
        const layer = layers[index];
        if (layer === undefined) continue;
        handles[index] = device.startTone(
          bus,
          layer.wave,
          layer.hz + (layer.beat ?? 0),
          layer.cutoff,
          undefined,
        );
      }
      // Force, because the handles are new and know nothing of the targets already chosen.
      drive(true);
    };
    const device = engine.renderer();
    // Registered only when there is nothing to stand up on yet, so the listener is never a
    // second chance to build a graph that already exists.
    if (device === null) cancelStandUp = engine.onUnlock(stand);
    else stand(device);
    engine.scope.add(() => {
      cancelStandUp?.();
      teardown(0.05);
      stopped = true;
    });
  }

  return {
    set(nextLevel: number, nextTone?: number): void {
      if (stopped) return;
      if (Number.isFinite(nextLevel)) level = clamp(nextLevel, 0, 1);
      if (nextTone === undefined) tone = 1;
      else if (Number.isFinite(nextTone)) tone = clamp(nextTone, 0, 1);
      drive(false);
    },

    get level(): number {
      return level;
    },

    get tone(): number {
      return tone;
    },

    stop(fadeSec?: number): void {
      if (stopped) return;
      stopped = true;
      cancelStandUp?.();
      teardown(Math.max(0, finiteOr(fadeSec, DEFAULT_GLIDE_SEC)));
    },
  };
}

/**
 * How loudly a banded layer speaks at this tone: 1 in the middle of its band, 0 outside it,
 * and a straight line between.
 *
 * The fade is half the band's width at each end, and it is **suppressed at the edges of the
 * domain** — a band of `[0, 0.5]` is at full weight at `tone = 0`. Without that, every bed
 * would be quietest at exactly the two values a game is most likely to sit at: full daylight
 * and full dark.
 */
function bandWeight(band: readonly [number, number] | undefined, tone: number): number {
  if (band === undefined) return 1;
  const low = band[0];
  const high = band[1];
  if (!(high > low)) return 0;
  if (tone < low || tone > high) return 0;
  const edge = (high - low) / 2;
  let weight = 1;
  if (low > 0) weight = Math.min(weight, (tone - low) / edge);
  if (high < 1) weight = Math.min(weight, (high - tone) / edge);
  return clamp(weight, 0, 1);
}

/** A caller's number, or the default when it is absent or not finite. */
function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
