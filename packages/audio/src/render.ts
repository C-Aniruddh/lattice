/**
 * The rendering half: a plan in, WebAudio nodes out. Everything above it is pure.
 *
 * This is the only module that knows what a `BiquadFilterNode` is, and it is deliberately the
 * smallest one that can be. It reads no global — it is handed a context — so it imports
 * cleanly in Node; it simply never gets called there, because nothing ever builds it without
 * a device.
 *
 * ## The five traps this file exists to have already hit
 *
 * 1. **`exponentialRampToValueAtTime` cannot reach zero.** Ramping to 0 is a spec violation
 *    that silently produces nothing on some engines. Every decay lands on {@link GAIN_FLOOR}.
 *    And an exponential ramp *from* zero is silence, so the envelope is
 *    `setValueAtTime(0)` → `linearRampToValueAtTime(peak)` → `exponentialRampToValueAtTime(floor)`.
 * 2. **A pitch sweep must be exponential too**, because pitch is heard logarithmically: a
 *    linear 880 → 190 sweep spends most of its life in the bottom octave.
 * 3. **Assigning `gain.value` on a running node is a click.** Every live change goes through
 *    `setTargetAtTime`.
 * 4. **Disconnect in `onended`, inside a `try`.** A node that is never disconnected is
 *    retained by its connection; disconnecting one the engine already collected throws. Both
 *    halves matter, which is why neither is optional here.
 * 5. **One noise buffer, built once, looped, filled deterministically.** A fresh
 *    `createBuffer(1, sampleRate, sampleRate)` per hi-hat is an allocation and a fill of
 *    48,000 floats on the beat. It is filled with an xorshift rather than `Math.random`:
 *    white noise does not care where its numbers come from, and the determinism lint does.
 */

import type { VoiceRequest } from './voice.js';
import type { BusId, BusName, Wave } from './sounds.js';

/** The floor an exponential decay lands on. Zero is a spec violation; this is −80 dB. */
const GAIN_FLOOR = 0.0001;

/** Seconds between the envelope reaching its floor and the source being stopped. */
const TAIL_SEC = 0.02;

/** The lowest frequency an exponential ramp may target. Zero and negatives are a spec violation. */
const MIN_RAMP_HZ = 1;

/** Seed for the shared noise buffer. Any odd constant does; this one is not special. */
const NOISE_SEED = 0x2f6e2b1;

/**
 * A continuous source whose gain, pitch and filter move but which never ends — the bed's
 * layer, and the one shape in this package that is a *state* rather than an *event*.
 *
 * A tone is not counted against the voice ceiling. It never ends, so an `onended`-driven
 * counter would never decrement it and a five-layer bed would eat a fifth of the ceiling
 * forever.
 */
export interface ToneHandle {
  /**
   * Ramp toward new figures. Never a step, and never re-issued with an unchanged target:
   * `setTargetAtTime` with the same value re-anchors the curve at `at`, so a bed driven every
   * frame with the same numbers would start over sixty times a second and never arrive.
   * The caller owns that check — see `bed.ts`.
   */
  set(gain: number, hz: number, cutoff: number, glideSec: number, at: number): void;
  /** Fade out over `fadeSec`, then stop and disconnect. A stopped tone cannot restart. */
  stop(fadeSec: number, at: number): void;
}

/**
 * Everything the policy layer needs from a device, and nothing more.
 *
 * The engine holds one of these or `null`. `null` is not an error state — it is Node, a
 * locked-down browser, and every moment before the first gesture — so every call site treats
 * it as "render nothing" rather than as a failure.
 */
export interface Renderer {
  /** Audio-clock seconds. The one clock this package measures anything in. */
  now(): number;
  /**
   * Resume a context the browser suspended. Idempotent.
   *
   * A tab backgrounded for long enough gets its context suspended, and without this, sound
   * works for one session and then silently stops — the bug reported as "audio breaks
   * sometimes" and never reproduced.
   */
  resume(): void;
  /** Set a bus's node gain, ramped. `effective` already accounts for muting. */
  setBusGain(bus: BusName, effective: number, rampSec: number): void;
  /** Build and schedule one voice. Every node it creates is torn down by its own `onended`. */
  play(request: Readonly<VoiceRequest>): void;
  /** Stand up one continuous layer, silent, and hand back its controls. */
  startTone(bus: BusId, wave: Wave, hz: number, cutoff: number, highpass: number | undefined): ToneHandle;
  /** Stop everything, disconnect, and close the context. Idempotent. */
  close(): void;
}

/**
 * Wrap a live `AudioContext`.
 *
 * Builds the bus graph immediately — master into the destination, three buses into master —
 * because it is only ever constructed after a gesture has produced a context, and a bus graph
 * is four nodes that live as long as the context does.
 */
export function createRenderer(context: AudioContext): Renderer {
  const master = context.createGain();
  master.connect(context.destination);
  const buses = new Map<BusName, GainNode>([['master', master]]);
  for (const bus of ['music', 'sfx', 'ui'] as const) {
    const node = context.createGain();
    node.connect(master);
    buses.set(bus, node);
  }

  /** Live sources, so `close` can stop what is still sounding. Emptied by each `onended`. */
  const live = new Set<AudioScheduledSourceNode>();
  let noise: AudioBuffer | undefined;
  let closed = false;

  const noiseBuffer = (): AudioBuffer => {
    if (noise === undefined) {
      const rate = context.sampleRate;
      const buffer = context.createBuffer(1, rate, rate);
      const data = buffer.getChannelData(0);
      let h = NOISE_SEED;
      for (let i = 0; i < data.length; i += 1) {
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        data[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
      }
      noise = buffer;
    }
    return noise;
  };

  const source = (wave: Wave, hz: number): AudioScheduledSourceNode => {
    if (wave === 'noise') {
      const node = context.createBufferSource();
      node.buffer = noiseBuffer();
      node.loop = true;
      return node;
    }
    const node = context.createOscillator();
    node.type = wave;
    node.frequency.value = hz;
    return node;
  };

  /** Disconnect a whole chain once, tolerating nodes the engine has already collected. */
  const release = (nodes: readonly AudioNode[]): void => {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Already collected. Not an error worth surfacing, and never a reason to skip the rest.
      }
    }
  };

  const ramp = (parameter: AudioParam, value: number, at: number, seconds: number): void => {
    if (seconds > 0) parameter.setTargetAtTime(value, at, seconds);
    else parameter.setValueAtTime(value, at);
  };

  return {
    now(): number {
      return context.currentTime;
    },

    resume(): void {
      if (closed) return;
      // Synchronously, inside the gesture. `await` anything before this and the gesture is
      // spent: the context stays suspended and the game is silent on iPhone only.
      if (context.state === 'suspended') {
        const resumed: unknown = context.resume();
        // A rejected resume is a browser declining, not a bug to surface.
        if (resumed instanceof Promise) resumed.catch(() => undefined);
      }
    },

    setBusGain(bus: BusName, effective: number, rampSec: number): void {
      const node = buses.get(bus);
      if (node === undefined) return;
      ramp(node.gain, effective, context.currentTime, rampSec);
    },

    play(request: Readonly<VoiceRequest>): void {
      if (closed) return;
      const bus = buses.get(request.bus);
      if (bus === undefined) return;
      const start = request.start;
      // The envelope needs strictly increasing times or the ramps collapse onto each other.
      const peak = start + Math.max(request.attack, GAIN_FLOOR);
      const end = Math.max(request.end, peak + GAIN_FLOOR);

      const gain = context.createGain();
      // Silent on arrival, for the same reason the bed below is. `createGain()` hands back a node
      // whose `gain` is **1**, and scheduling `setValueAtTime(0, start)` does not retroactively
      // silence the frames before `start`. When `start * sampleRate` lands a hair above an integer
      // — `1.1 * 48000 === 52800.00000000001` — the source's first frame and the automation's
      // first frame resolve to different samples, and one frame of the source passes at unity.
      // A sine at phase zero is zero and survives it; a noise burst is one sample at full scale,
      // which is a click. Measured at 0.72 against neighbours of 0.005, on about one start time
      // in ten.
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(Math.max(request.gain, GAIN_FLOOR), peak);
      gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, end);

      const chain: AudioNode[] = [gain];
      let tail: AudioNode = gain;
      if (request.pan !== 0 && typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner();
        panner.pan.value = request.pan;
        tail.connect(panner);
        chain.push(panner);
        tail = panner;
      }
      tail.connect(bus);

      const node = source(request.wave, request.hz);
      let head: AudioNode = gain;
      if (request.cutoff !== undefined) {
        const lowpass = context.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = request.cutoff;
        lowpass.connect(head);
        chain.push(lowpass);
        head = lowpass;
      }
      if (request.highpass !== undefined) {
        const highpass = context.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = request.highpass;
        highpass.connect(head);
        chain.push(highpass);
        head = highpass;
      }
      node.connect(head);
      chain.push(node);

      if (request.wave !== 'noise' && isOscillator(node)) {
        node.frequency.setValueAtTime(request.hz, start);
        if (request.toHz !== request.hz) {
          // Exponential, because pitch is heard logarithmically.
          node.frequency.exponentialRampToValueAtTime(Math.max(MIN_RAMP_HZ, request.toHz), end);
        }
      }

      live.add(node);
      node.onended = (): void => {
        live.delete(node);
        release(chain);
      };
      node.start(start);
      node.stop(end + TAIL_SEC);
    },

    startTone(
      bus: BusId,
      wave: Wave,
      hz: number,
      cutoff: number,
      highpass: number | undefined,
    ): ToneHandle {
      const target = buses.get(bus) ?? master;
      const gain = context.createGain();
      // Silent on arrival: a bed that starts at its target thumps in at the first frame.
      gain.gain.value = 0;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      gain.connect(filter);
      const chain: AudioNode[] = [gain, filter];
      let tail: AudioNode = filter;
      if (highpass !== undefined) {
        const above = context.createBiquadFilter();
        above.type = 'highpass';
        above.frequency.value = highpass;
        tail.connect(above);
        chain.push(above);
        tail = above;
      }
      tail.connect(target);

      const node = source(wave, hz);
      node.connect(gain);
      chain.push(node);
      live.add(node);
      node.onended = (): void => {
        live.delete(node);
        release(chain);
      };
      node.start();

      let stopped = false;
      return {
        set(nextGain: number, nextHz: number, nextCutoff: number, glideSec: number, at: number): void {
          if (stopped || closed) return;
          ramp(gain.gain, nextGain, at, glideSec);
          ramp(filter.frequency, nextCutoff, at, glideSec);
          if (isOscillator(node)) ramp(node.frequency, nextHz, at, glideSec);
        },
        stop(fadeSec: number, at: number): void {
          if (stopped) return;
          stopped = true;
          // A third of the fade as the time constant, so the exponential approach is
          // essentially arrived by the time the source is stopped.
          ramp(gain.gain, 0, at, fadeSec / 3);
          try {
            node.stop(at + fadeSec + TAIL_SEC);
          } catch {
            // Stopping a node that never started, on a context already going away.
          }
        },
      };
    },

    close(): void {
      if (closed) return;
      closed = true;
      for (const node of live) {
        try {
          node.stop();
        } catch {
          // Already stopped, or never started. Closing the context takes it either way.
        }
      }
      live.clear();
      release([master, ...buses.values()]);
      // Browsers cap live contexts per document — six, historically — so a game that opens a
      // second on a scene change without closing the first fails in a way that reads as a
      // broken assertion rather than as a resource leak.
      const closing: unknown = context.close();
      if (closing instanceof Promise) closing.catch(() => undefined);
    },
  };
}

/**
 * Whether a source has a frequency to sweep.
 *
 * A structural check rather than `instanceof OscillatorNode`, because `OscillatorNode` is a
 * global and this module reads none — that is what lets it be imported in Node without a shim
 * and what keeps the package's declared-adapter count at one.
 */
function isOscillator(node: AudioScheduledSourceNode): node is OscillatorNode {
  return 'frequency' in node;
}
