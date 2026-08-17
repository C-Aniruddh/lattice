/**
 * `replay` — the test that makes non-negotiable #1 falsifiable.
 *
 * The headline is `I-26`, two tests down: a session recorded from a correct game replays to
 * `divergedAt === -1`, and **the same session replayed against a build with one `Math.random()`
 * in its update reports the tick where it first disagreed**. Everything else in this file is
 * scaffolding for that pair.
 *
 * The odds, written down because a probabilistic assertion should never be taken on trust: the
 * nondeterministic build flips a fair coin on every tick and adds one when it lands heads. The
 * first checkpoint is at tick 63, so the replay agrees with the recording only if all 64 coins
 * land tails — `2^-64`, about 5.4e-20. A suite run once a second since the formation of the
 * Earth would not have seen it. It is not a flaky test; it is a certain one with the arithmetic
 * shown.
 */

import { describe, expect, it } from 'vitest';
import { createRng, mix32 } from '@latticekit/core';
import { manualClock } from '../src/clock.js';
import { manualFrames } from '../src/frames.js';
import { createLoop } from '../src/loop.js';
import { replay, type ReplayOptions, type ReplaySource } from '../src/replay.js';

const TICKS = 256;
const CHECKPOINT_EVERY = 64;
/** The first checkpoint. 64 coin flips have happened by the time it is compared. */
const FIRST_CHECKPOINT = CHECKPOINT_EVERY - 1;

/**
 * A toy game with exactly the shape the contract cares about: state advanced by a fixed step,
 * driven by a per-tick input and a seeded rng, hashed with Tier A arithmetic only.
 *
 * `nondeterministic` is the whole experiment. When it is on, `update` does the one thing the
 * constitution bans, in the shape a real system would do it — a coin flip that nudges a value.
 */
function walker(seed: number, nondeterministic = false): {
  setInput(value: number): void;
  update(dt: number, tick: number): void;
  hash(): number;
  readonly steps: number;
  readonly deltas: ReadonlySet<number>;
} {
  const rng = createRng(seed);
  let x = 0;
  let y = 0;
  let input = 0;
  let steps = 0;
  const deltas = new Set<number>();
  return {
    setInput(value) {
      input = value;
    },
    update(dt, tick) {
      steps += 1;
      deltas.add(dt);
      x = (x + input + tick) | 0;
      y = (y + rng.int(0, 4)) | 0;
      if (nondeterministic && Math.random() < 0.5) x = (x + 1) | 0;
    },
    // `^`, `+`, `*` and `Math.imul` inside mix32 — Tier A, so two conforming engines agree in
    // every bit. A hash over a damped camera value would fail forever on a machine the author
    // does not have.
    hash: () => mix32(x ^ mix32(y)) | 0,
    get steps() {
      return steps;
    },
    get deltas() {
      return deltas;
    },
  };
}

/** A recorded input log: one value per tick, plus the checkpoints taken while recording. */
interface Recording {
  readonly inputs: readonly number[];
  readonly checkpoints: ReadonlyMap<number, number>;
}

/**
 * Record a session by running it through a real loop, exactly as a game would.
 *
 * Deliberately not through `replay()`: a recording made by the thing under test would only
 * prove the driver agrees with itself.
 */
function record(seed: number, ticks = TICKS): Recording {
  const inputs: number[] = [];
  const rng = createRng(seed ^ 0x5eed);
  for (let i = 0; i < ticks; i += 1) inputs.push(rng.int(-3, 4));

  const game = walker(seed);
  const checkpoints = new Map<number, number>();
  const clock = manualClock();
  const frames = manualFrames();
  const loop = createLoop({ clock, frames });
  loop.onUpdate((_dt, tick) => game.setInput(inputs[tick] ?? 0));
  loop.onUpdate(game.update);
  loop.onUpdate((_dt, tick) => {
    if ((tick + 1) % CHECKPOINT_EVERY === 0) checkpoints.set(tick, game.hash());
  });
  loop.start();
  while (loop.tick < ticks) {
    clock.advance(loop.stepMs);
    frames.pump('tick');
  }
  loop.stop();
  return { inputs, checkpoints };
}

/** Wrap a recording in the structural shape the driver is defined against. */
function sourceOf(
  recording: Recording,
  apply: (value: number) => void,
  extra: { readonly stepMs?: number; readonly ticks?: number } = {},
): ReplaySource {
  const seen: number[] = [];
  const source = {
    ticks: extra.ticks ?? recording.inputs.length,
    ...(extra.stepMs === undefined ? {} : { stepMs: extra.stepMs }),
    applyAt(tick: number) {
      seen.push(tick);
      apply(recording.inputs[tick] ?? 0);
    },
    checkpointAt(tick: number) {
      return recording.checkpoints.get(tick);
    },
    appliedAt: seen,
  };
  return source;
}

describe('I-26 — the constitution, made falsifiable', () => {
  it('a session recorded from a correct game replays with no divergence at all', () => {
    const recording = record(7);
    const game = walker(7);
    const result = replay({
      source: sourceOf(recording, game.setInput),
      update: game.update,
      hash: game.hash,
    });
    expect(result.divergedAt).toBe(-1);
    expect(result.expected).toBe(0);
    expect(result.actual).toBe(0);
    expect(result.ticks).toBe(TICKS);
    expect(result.checkpoints).toBe(TICKS / CHECKPOINT_EVERY);
  });

  it('one Math.random() anywhere in update makes the replay fail, at the first checkpoint', () => {
    // The single most valuable assertion in the kit. If this ever passes with the flip in
    // place, the driver has stopped proving anything and the kit's headline claim is back to
    // being aspirational.
    const recording = record(7);
    const nondeterministic = walker(7, true);
    const result = replay({
      source: sourceOf(recording, nondeterministic.setInput),
      update: nondeterministic.update,
      hash: nondeterministic.hash,
    });
    expect(result.divergedAt).toBe(FIRST_CHECKPOINT);
    expect(result.actual).not.toBe(result.expected);
    // It stopped there, rather than reporting a pass or running on regardless.
    expect(result.ticks).toBe(FIRST_CHECKPOINT + 1);
  });

  it('the same game replayed twice agrees with itself, so the flip above is the only variable', () => {
    // Without this the test above could be passing because *any* second run diverges.
    const recording = record(11);
    for (let run = 0; run < 3; run += 1) {
      const game = walker(11);
      const result = replay({ source: sourceOf(recording, game.setInput), update: game.update, hash: game.hash });
      expect(result.divergedAt).toBe(-1);
    }
  });

  it('a game seeded differently diverges too — the seed is part of what must match', () => {
    const recording = record(7);
    const game = walker(8);
    const result = replay({ source: sourceOf(recording, game.setInput), update: game.update, hash: game.hash });
    expect(result.divergedAt).toBe(FIRST_CHECKPOINT);
  });

  it('stopOnDivergence: false runs to the end and still reports the first disagreement', () => {
    const recording = record(7);
    const game = walker(8);
    const result = replay({
      source: sourceOf(recording, game.setInput),
      update: game.update,
      hash: game.hash,
      stopOnDivergence: false,
    });
    expect(result.divergedAt).toBe(FIRST_CHECKPOINT);
    expect(result.ticks).toBe(TICKS);
    expect(result.checkpoints).toBe(TICKS / CHECKPOINT_EVERY);
  });
});

describe('the driver', () => {
  it('applies each tick’s inputs exactly once, in ascending order, before that tick’s update', () => {
    // Applying a tick's inputs after its update makes every tick one late, the world diverges
    // immediately, and the report blames the game for the driver's bug.
    const recording = record(3);
    const order: string[] = [];
    const game = walker(3);
    const source: ReplaySource = {
      ticks: 8,
      applyAt(tick) {
        order.push(`apply:${String(tick)}`);
        game.setInput(recording.inputs[tick] ?? 0);
      },
      checkpointAt(tick) {
        order.push(`check:${String(tick)}`);
        return undefined;
      },
    };
    replay({
      source,
      update: (dt, tick) => {
        order.push(`update:${String(tick)}`);
        game.update(dt, tick);
      },
      hash: game.hash,
    });
    expect(order.slice(0, 6)).toEqual([
      'apply:0',
      'update:0',
      'check:0',
      'apply:1',
      'update:1',
      'check:1',
    ]);
    expect(order.filter((s) => s.startsWith('apply:'))).toHaveLength(8);
  });

  it('advances exactly one step per pump, so the catch-up clamp is never in play', () => {
    const recording = record(5, 400);
    const game = walker(5);
    replay({ source: sourceOf(recording, game.setInput), update: game.update, hash: game.hash });
    expect(game.steps).toBe(400);
    // Every dt identical, and identical to a live session's.
    expect([...game.deltas]).toEqual([16_667 / 1e6]);
  });

  it('paints nothing — a replay that rendered would be measuring the renderer', () => {
    const recording = record(5, 32);
    const game = walker(5);
    let renders = 0;
    // There is no seam to attach a renderer to, which is the point: the driver builds its own
    // loop and pumps `'tick'` only. The proof is that the game's own hash never moves for a
    // reason other than an update.
    const result = replay({
      source: sourceOf(recording, game.setInput),
      update: (dt, tick) => {
        game.update(dt, tick);
        renders += 0;
      },
      hash: game.hash,
    });
    expect(renders).toBe(0);
    expect(result.ticks).toBe(32);
  });

  it('runs at another hz when told, and the step follows', () => {
    const inputs = Array.from({ length: 10 }, (_v, i) => i);
    let sum = 0;
    const deltas = new Set<number>();
    replay({
      source: { ticks: 10, applyAt: (t) => (sum += inputs[t] ?? 0), checkpointAt: () => undefined },
      update: (dt) => deltas.add(dt),
      hash: () => sum | 0,
      hz: 50,
    });
    expect([...deltas]).toEqual([0.02]);
    expect(sum).toBe(45);
  });

  it('a zero-tick source runs nothing and reports a clean, empty verdict', () => {
    let applied = 0;
    const result = replay({
      source: { ticks: 0, applyAt: () => (applied += 1), checkpointAt: () => undefined },
      update: () => {},
      hash: () => 0,
    });
    expect(result).toEqual({ ticks: 0, checkpoints: 0, divergedAt: -1, expected: 0, actual: 0 });
    expect(applied).toBe(0);
  });

  it('a one-tick source with a checkpoint is the smallest useful replay there is', () => {
    let x = 0;
    const result = replay({
      source: { ticks: 1, applyAt: () => (x += 5), checkpointAt: (t) => (t === 0 ? 5 : undefined) },
      update: () => {},
      hash: () => x,
    });
    expect(result).toEqual({ ticks: 1, checkpoints: 1, divergedAt: -1, expected: 0, actual: 0 });
  });

  it('a log with no checkpoints runs to the end and proves very little, honestly', () => {
    const result = replay({
      source: { ticks: 100, applyAt: () => {}, checkpointAt: () => undefined },
      update: () => {},
      hash: () => 0,
    });
    expect(result.checkpoints).toBe(0);
    expect(result.divergedAt).toBe(-1);
    expect(result.ticks).toBe(100);
  });

  it('reports progress every thousand ticks and once at the end', () => {
    const seen: number[] = [];
    replay({
      source: { ticks: 2500, applyAt: () => {}, checkpointAt: () => undefined },
      update: () => {},
      hash: () => 0,
      onProgress: (t) => seen.push(t),
    });
    expect(seen).toEqual([1000, 2000, 2500]);
  });

  it('does not report the final tick twice when it lands on the interval', () => {
    const seen: number[] = [];
    replay({
      source: { ticks: 2000, applyAt: () => {}, checkpointAt: () => undefined },
      update: () => {},
      hash: () => 0,
      onProgress: (t) => seen.push(t),
    });
    expect(seen).toEqual([1000, 2000]);
  });

  it('lets an update throw straight out, having stopped its loop first', () => {
    expect(() =>
      replay({
        source: { ticks: 10, applyAt: () => {}, checkpointAt: () => undefined },
        update: (_dt, tick) => {
          if (tick === 3) throw new RangeError('bad state at 3');
        },
        hash: () => 0,
      }),
    ).toThrow(/bad state at 3/);
  });
});

describe('the stepMs guard', () => {
  it('throws on a mismatch rather than reporting a divergence at tick 1', () => {
    // A log recorded at 60 Hz replayed at 50 has tick indices that still line up and mean
    // something completely different. The two failures deserve different words.
    const recording = record(7, 8);
    const game = walker(7);
    expect(() =>
      replay({
        source: sourceOf(recording, game.setInput, { stepMs: 16.667 }),
        update: game.update,
        hash: game.hash,
        hz: 50,
      }),
    ).toThrow(/16\.667/);
    expect(() =>
      replay({
        source: sourceOf(recording, game.setInput, { stepMs: 16.667 }),
        update: game.update,
        hash: game.hash,
        hz: 50,
      }),
    ).toThrow(/20/);
  });

  it('accepts a matching stepMs and runs', () => {
    const recording = record(7, 8);
    const game = walker(7);
    const result = replay({
      source: sourceOf(recording, game.setInput, { stepMs: 16.667 }),
      update: game.update,
      hash: game.hash,
    });
    expect(result.ticks).toBe(8);
  });

  it('is optional, because an array in a test does not have one', () => {
    const result = replay({
      source: { ticks: 4, applyAt: () => {}, checkpointAt: () => undefined },
      update: () => {},
      hash: () => 0,
    });
    expect(result.ticks).toBe(4);
  });
});

describe('validation', () => {
  const ok = { ticks: 1, applyAt: () => {}, checkpointAt: () => undefined };

  it('names what is missing, rather than failing inside a pump', () => {
    expect(() => replay(undefined as unknown as ReplayOptions)).toThrow(/replay/);
    expect(() => replay({ update: () => {}, hash: () => 0 } as unknown as ReplayOptions)).toThrow(
      /replay\.source/,
    );
    expect(() =>
      replay({ source: { ticks: 1 } as unknown as ReplaySource, update: () => {}, hash: () => 0 }),
    ).toThrow(/applyAt/);
    expect(() => replay({ source: ok, hash: () => 0 } as unknown as ReplayOptions)).toThrow(
      /replay\.update/,
    );
    expect(() => replay({ source: ok, update: () => {} } as unknown as ReplayOptions)).toThrow(
      /replay\.hash/,
    );
    expect(() => replay({ source: ok, update: () => {} } as unknown as ReplayOptions)).toThrow(
      /Tier A/,
    );
  });

  it('refuses a tick count that is not a non-negative integer', () => {
    const bad = (ticks: number): (() => unknown) => () =>
      replay({ source: { ...ok, ticks }, update: () => {}, hash: () => 0 });
    expect(bad(-1)).toThrow(/replay\.source\.ticks/);
    expect(bad(1.5)).toThrow(/integer/);
    expect(bad(NaN)).toThrow(RangeError);
    expect(bad(Infinity)).toThrow(RangeError);
  });

  it('refuses an hz the loop would refuse, in the same words', () => {
    expect(() => replay({ source: ok, update: () => {}, hash: () => 0, hz: 0 })).toThrow(/createLoop\.hz/);
    expect(() => replay({ source: ok, update: () => {}, hash: () => 0, hz: 59.94 })).toThrow(/integer/);
  });
});
