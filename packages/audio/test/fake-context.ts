/**
 * A hand-written stub of the eight WebAudio node types this package actually uses.
 *
 * This is **not** a recording mock of WebAudio, and the distinction is the whole reason the
 * rest of the suite needs no device at all: a mock of forty node types is a second
 * implementation that has to be right, and asserting `createBiquadFilter` was called with 3200
 * tests the mock rather than the sound. This file exists to cover `render.ts` — node
 * construction, envelope shape, teardown — and nothing else uses it.
 *
 * Two details are faithful on purpose, because they are traps rather than decoration:
 *
 * - `exponentialRampToValueAtTime(0, …)` **throws**, as the spec says it must. That is what
 *   makes the "ramp to a floor, never to zero" rule testable rather than aspirational.
 * - `onended` fires from {@link FakeContext.advance}, so a test can walk past a voice's release
 *   tail and assert that the graph came back to its baseline instead of leaking a node per play.
 */

/** One scheduled change to a parameter, in the order it was requested. */
export interface ParamEvent {
  readonly kind: 'set' | 'linear' | 'exponential' | 'target';
  readonly value: number;
  readonly at: number;
  /** Time constant, for `setTargetAtTime` only. */
  readonly seconds?: number;
}

/** An `AudioParam` that remembers what was asked of it. */
export class FakeParam {
  #value: number;
  /** Scheduled automation, in the order it was requested. */
  readonly events: ParamEvent[] = [];
  /**
   * Direct assignments to `.value`, which automation does not record and which is exactly where
   * the one-shot gain leak lived. Kept apart from `events` so that assertions counting scheduled
   * automation are unaffected by a node also being set outright.
   */
  readonly writes: number[] = [];

  constructor(initial = 0) {
    this.#value = initial;
  }

  get value(): number {
    return this.#value;
  }

  set value(next: number) {
    this.writes.push(next);
    this.#value = next;
  }

  setValueAtTime(value: number, at: number): void {
    this.events.push({ kind: 'set', value, at });
    this.#value = value;
  }

  linearRampToValueAtTime(value: number, at: number): void {
    this.events.push({ kind: 'linear', value, at });
    this.#value = value;
  }

  exponentialRampToValueAtTime(value: number, at: number): void {
    if (value === 0) {
      throw new RangeError('exponentialRampToValueAtTime: cannot ramp to zero — this is the spec violation trap 1 names');
    }
    this.events.push({ kind: 'exponential', value, at });
    this.#value = value;
  }

  setTargetAtTime(value: number, at: number, seconds: number): void {
    this.events.push({ kind: 'target', value, at, seconds });
    this.#value = value;
  }
}

/** The base every stub node shares: connection bookkeeping, so a leak is countable. */
export class FakeNode {
  readonly outputs = new Set<FakeNode>();
  connected = false;

  constructor(readonly context: FakeContext, readonly kind: string) {
    context.nodes.push(this);
  }

  connect(target: FakeNode): FakeNode {
    this.outputs.add(target);
    if (!this.connected) {
      this.connected = true;
      this.context.live += 1;
    }
    return target;
  }

  disconnect(): void {
    if (this.disposed) {
      throw new Error('disconnect: this node has already been collected — trap 11');
    }
    this.disposed = true;
    this.outputs.clear();
    if (this.connected) {
      this.connected = false;
      this.context.live -= 1;
    }
  }

  /** Set by the first `disconnect`, so a second one throws exactly as a real engine's does. */
  disposed = false;
}

/** A source that can be started and stopped, and whose `onended` the context fires. */
export class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startedAt: number | undefined;
  stopAt: number | undefined;

  start(at = 0): void {
    this.startedAt = at;
  }

  stop(at = 0): void {
    this.stopAt = this.stopAt === undefined ? at : Math.min(this.stopAt, at);
  }
}

/** An oscillator: the only source with a frequency, which is what `isOscillator` keys on. */
export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam();
}

/** A buffer source. Deliberately has no `frequency`, exactly as the real one does not. */
export class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  loop = false;
}

/**
 * A gain node.
 *
 * `gain` starts at **1**, because that is what the Web Audio spec says `createGain()` returns and
 * a double that starts at 0 is a double that cannot fail the way the platform fails. It began at
 * 0 here, which is why the suite was blind to a full-scale sample leaking out of the one-shot
 * path for as long as it did: every test agreed with the code because both had assumed the safe
 * default. A fake is only worth its cost while it is wrong in the same places as the real thing.
 */
export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

/** A biquad filter. */
export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
}

/** A stereo panner. */
export class FakePanner extends FakeNode {
  readonly pan = new FakeParam();
}

/** The context. `advance` is the clock a test drives by hand. */
export class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  resumes = 0;
  closes = 0;
  /** Every node ever created, for counting construction. */
  readonly nodes: FakeNode[] = [];
  /** Nodes currently connected. The leak assertion: this must come back to its baseline. */
  live = 0;
  readonly destination = new FakeNode(this, 'destination');
  /** Set false to model old Safari, which has no `createStereoPanner`. */
  stereo = true;

  constructor() {
    // The destination is not "connected" in the sense the counter means.
    this.live = 0;
  }

  createGain(): FakeGain {
    return new FakeGain(this, 'gain');
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this, 'filter');
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this, 'oscillator');
  }

  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this, 'buffer-source');
  }

  createBuffer(channels: number, length: number, rate: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    void channels;
    void rate;
    return { getChannelData: () => data };
  }

  createStereoPanner(): FakePanner {
    return new FakePanner(this, 'panner');
  }

  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closes += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Move the clock, firing `onended` for every source whose stop time has passed. */
  advance(to: number): void {
    this.currentTime = to;
    for (const node of this.nodes) {
      if (!(node instanceof FakeSource)) continue;
      if (node.stopAt !== undefined && node.stopAt <= to && node.onended !== null) {
        const ended = node.onended;
        node.onended = null;
        ended();
      }
    }
  }

  /** Every node of a kind that was ever constructed. */
  countOf(kind: string): number {
    return this.nodes.filter((node) => node.kind === kind).length;
  }
}

/**
 * The stub as the type `AudioOptions.context` expects.
 *
 * The cast is the one place in the suite where the shapes are asserted rather than checked, and
 * it is contained to this line on purpose: `render.ts` uses eight members of `AudioContext` and
 * every one of them is implemented above.
 */
export function asContext(fake: FakeContext): AudioContext {
  if (!fake.stereo) {
    // An own property shadowing the prototype's method — `delete` would not reach a class
    // method, and Safari before 14.1 genuinely does not have this one.
    const loose = fake as unknown as { createStereoPanner?: unknown };
    loose.createStereoPanner = undefined;
  }
  return fake as unknown as AudioContext;
}
