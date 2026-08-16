/**
 * Recording, refusing, and playing back.
 *
 * The refusals carry the weight here. `@lattice/persist` compares the same three fields and
 * refuses on the same reasoning, and the reasoning is worth repeating: a migrated input log is
 * a log that no longer replays, so a "repaired" mismatch produces a **confident wrong answer**
 * — which is worse than no answer, because it looks like it has been tested.
 */

import { describe, expect, it } from 'vitest';
import { createCamera } from '@lattice/iso';
import { createHeadlessInput } from '../src/system.js';
import { createLog, record, replay, replayCursor } from '../src/record.js';
import { LOG_VERSION } from '../src/sample.js';
import type { InputLog } from '../src/sample.js';
import { STEP_60, down, harness, move, types, up, watch } from './harness.js';

function session(): { log: InputLog; seen: ReturnType<typeof watch> } {
  const input = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
  const seen = watch(input);
  const recording = record(input);
  input.submit(down(1, 400, 300, 'touch'));
  input.tick(0);
  input.submit(move(1, 480, 300));
  input.tick(1);
  input.submit(up(1, 520, 300));
  input.tick(2);
  return { log: recording.stop(), seen };
}

describe('createLog', () => {
  it('is the compatibility triple, read off a live system', () => {
    const h = harness({ profile: { longPressMs: 700 } });
    const log = createLog(h.input);
    expect(log.version).toBe(LOG_VERSION);
    expect(log.stepMs).toBe(STEP_60);
    expect(log.profile).toContain('longPressMs:700');
    expect(log.samples).toEqual([]);
  });
});

describe('record', () => {
  it('records every sample verbatim, with a marker per tick', () => {
    const { log } = session();
    expect(log.samples).toEqual([
      { kind: 'down', id: 1, sx: 400, sy: 300, pointerType: 'touch' },
      { kind: 'tick', index: 0 },
      { kind: 'move', id: 1, sx: 480, sy: 300 },
      { kind: 'tick', index: 1 },
      { kind: 'up', id: 1, sx: 520, sy: 300 },
      { kind: 'tick', index: 2 },
    ]);
  });

  it('is idempotent to stop, so two teardown paths do not record two endings', () => {
    const h = harness();
    const recording = record(h.input);
    h.step(down(1, 0, 0));
    const first = recording.stop();
    expect(recording.stop()).toBe(first);
  });

  it('refuses a second recorder on one system', () => {
    const h = harness();
    record(h.input);
    expect(() => record(h.input)).toThrow(/already recording/);
  });

  it('costs nothing when it is not running', () => {
    const h = harness();
    h.step(down(1, 0, 0));
    const log = record(h.input).stop();
    // Nothing that happened before `record` is in the log: a recording starts where it starts.
    expect(log.samples).toEqual([]);
  });
});

describe('replay', () => {
  it('reproduces the session exactly', () => {
    const { log, seen } = session();
    const again = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const againSeen = watch(again);
    replay(again, log);
    expect(againSeen).toEqual(seen);
  });

  it('names the field that differs, and refuses rather than migrating', () => {
    const { log } = session();
    const slower = createHeadlessInput({ camera: createCamera(800, 600), stepMs: 20 });
    expect(() => replay(slower, log)).toThrow(/recorded at stepMs 16\.6.* and this system runs at 20/);

    const retuned = createHeadlessInput({
      camera: createCamera(800, 600),
      stepMs: STEP_60,
      profile: { tapSlopPx: { touch: 12 } },
    });
    expect(() => replay(retuned, log)).toThrow(/recorded under a different gesture profile/);

    const fresh = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    expect(() => replay(fresh, { ...log, version: LOG_VERSION + 1 })).toThrow(
      /recognition rules change with the version/,
    );
  });

  it('refuses a log that is not one, rather than reporting a session with nothing in it', () => {
    const h = harness();
    expect(() => replay(h.input, undefined as unknown as InputLog)).toThrow(
      /a missing log replays as a session in which the player did nothing/,
    );
    expect(() => replay(h.input, { ...createLog(h.input), samples: 'no' as never })).toThrow(
      TypeError,
    );
  });
});

describe('replayCursor', () => {
  it('counts the ticks and carries the step, so a driver can refuse a mismatch', () => {
    const { log } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const cursor = replayCursor(fresh, log);
    expect(cursor.ticks).toBe(3);
    expect(cursor.stepMs).toBe(STEP_60);
    expect(cursor.checkpointAt(0)).toBeUndefined();
  });

  it('satisfies the driver contract: once per tick, ascending, before the update', () => {
    const { log, seen } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const freshSeen = watch(fresh);
    const cursor = replayCursor(fresh, log);
    const updates: number[] = [];
    // The shape `@lattice/loop`'s replay driver drives: `applyAt(tick)` exactly once per tick,
    // in ascending order, before that tick's update.
    for (let tick = 0; tick < cursor.ticks; tick++) {
      cursor.applyAt(tick);
      updates.push(tick);
    }
    expect(updates).toEqual([0, 1, 2]);
    expect(freshSeen).toEqual(seen);
  });

  it('delivers an empty bucket past the end of the recording', () => {
    const { log } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const seen = watch(fresh);
    const cursor = replayCursor(fresh, log);
    for (let tick = 0; tick < cursor.ticks + 5; tick++) cursor.applyAt(tick);
    // A driver running longer than the log still advances the game rather than repeating the
    // last tick's input.
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });
});
