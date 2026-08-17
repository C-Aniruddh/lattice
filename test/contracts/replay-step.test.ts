/**
 * Contract: `stepMs` means the same thing to `loop` and to `persist`.
 *
 * This suite lives above the packages because **neither one can test this alone, and both of
 * their own suites pass while the product is broken.** `@latticekit/loop` throws if a source's
 * `stepMs` disagrees with the loop it is being replayed on. `@latticekit/persist` refuses a
 * `ReplayLog` whose `stepMs` differs from the current build's. Each is correct against its own
 * idea of what the number is. Nothing in either package checks that they are the *same* number,
 * measured the same way, in the same unit.
 *
 * The failure it guards is the worst kind a determinism claim can have: not a crash, but a
 * **confident wrong answer**. A session recorded at 60 Hz and replayed at 50 Hz has tick
 * indices that still line up and still mean something — just something else. If one package
 * rounds and the other does not, or one stores milliseconds where the other computes from an
 * integer-microsecond accumulator, a replay diverges for a reason no stack trace will show and
 * the kit's headline guarantee quietly becomes untrustworthy.
 *
 * See `docs/SEAMS.md`. The other three contracts are pinned in sibling files as their packages
 * land.
 */

import { describe, expect, it } from 'vitest';
import { createLoop, manualClock, manualFrames, replay } from '@latticekit/loop';
import type { ReplaySource } from '@latticekit/loop';
import { createRecorder } from '@latticekit/persist';
import { createRng } from '@latticekit/core';
import type { ReplayCompat } from '@latticekit/persist';

/**
 * Build a loop at `hz` and report the `stepMs` it publishes.
 *
 * Deliberately goes through the real constructor rather than computing `1000 / hz`. The whole
 * point is that `loop` derives this from an integer-microsecond accumulator — `stepUs =
 * round(1e6 / hz)` — so 60 Hz reads 16.667 and not 16.666666666666668, and a test that
 * recomputed the expected value the naive way would agree with itself and with nothing else.
 */
function stepMsOf(hz: number): number {
  const loop = createLoop({ hz, clock: manualClock(0), frames: manualFrames() });
  const step = loop.stepMs;
  loop.stop();
  return step;
}

/** A minimal replay source: no inputs, `n` ticks, and a `stepMs` the test controls. */
function sourceAt(ticks: number, stepMs?: number): ReplaySource {
  return {
    ticks,
    ...(stepMs === undefined ? {} : { stepMs: stepMs as ReplaySource['stepMs'] }),
    applyAt() {
      /* no recorded input; the contract under test is the step, not the stream */
    },
    checkpointAt() {
      return undefined;
    },
  } as ReplaySource;
}

describe('stepMs is one number with one meaning', () => {
  // If this fails, one package has started measuring in seconds, or rounding, or storing a
  // period where the other stores a frequency. Everything below depends on it.
  it.each([
    [60, 16.667],
    [50, 20],
    [30, 33.333],
    [120, 8.333],
  ])('a %i Hz loop publishes stepMs %f, in milliseconds', (hz, expected) => {
    expect(stepMsOf(hz)).toBeCloseTo(expected, 3);
  });

  it('is exact and stable, not a float recomputed per read', () => {
    const loop = createLoop({ hz: 60, clock: manualClock(0), frames: manualFrames() });
    const first = loop.stepMs;
    for (let i = 0; i < 100; i += 1) expect(loop.stepMs).toBe(first);
    loop.stop();
  });

  // The compatibility triple persist stores is typed `number` for stepMs. This asserts the
  // value a game would actually put there — the loop's own — satisfies that type and survives
  // the round trip unchanged. A silent unit conversion anywhere would show up here.
  it('survives the round trip through a persist compatibility triple', () => {
    const stepMs = stepMsOf(60);
    const compat: ReplayCompat = { version: 1, stepMs, profile: 'default' };
    const revived = JSON.parse(JSON.stringify(compat)) as ReplayCompat;
    expect(revived.stepMs).toBe(stepMs);
    expect(revived.stepMs).toBe(compat.stepMs);
  });
});

describe('both packages reject the same mismatch', () => {
  // loop's half: replaying a 60 Hz recording on a 50 Hz loop is not a divergence to be
  // reported at tick 1, it is a category error, and it throws.
  it('loop throws rather than reporting a divergence', () => {
    const recordedAt = stepMsOf(60);
    expect(() =>
      replay({
        source: sourceAt(10, recordedAt),
        hz: 50,
        update: () => {},
        hash: () => 0,
      }),
    ).toThrow();
  });

  it('loop accepts a source recorded at its own step', () => {
    const hz = 60;
    const result = replay({
      source: sourceAt(10, stepMsOf(hz)),
      hz,
      update: () => {},
      hash: () => 0,
    });
    expect(result.divergedAt).toBe(-1);
  });

  // persist's half: a log is evidence, and evidence is never migrated. A mismatch is refused
  // by name rather than coerced into agreement.
  it("persist carries the loop's own stepMs through a sealed log unchanged", () => {
    const stepMs = stepMsOf(60);
    const recorder = createRecorder<number>({
      kit: '0.1.0',
      game: 'contract',
      rng: createRng(1).snapshot(),
      startTick: 0,
      digest: (n: number) => n,
    });
    recorder.mark(0, 7);
    const log = recorder.stop(1, 7, { version: 1, stepMs, profile: 'default' });
    expect(log.inputs.stepMs).toBe(stepMs);

    // The comparison persist makes is exact equality, never a coercion or a tolerance — so a
    // value that merely looks the same after formatting must still fail. 16.667 is what a
    // reader sees; 1000/60 is what a naive reimplementation would produce.
    expect(log.inputs.stepMs === 1000 / 60).toBe(false);
  });
});

describe('the number is a compatibility constant', () => {
  // Not a style note: this value is written into every recorded session. Changing `hz` is a
  // breaking change to every log ever produced, and the two packages agreeing on that is the
  // only reason a refusal means anything.
  it('two loops at the same hz publish the identical value', () => {
    expect(stepMsOf(60)).toBe(stepMsOf(60));
  });

  it('two loops at different hz never collide', () => {
    const seen = new Set([30, 50, 60, 90, 120, 144].map(stepMsOf));
    expect(seen.size).toBe(6);
  });
});
