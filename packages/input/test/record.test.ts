/**
 * Recording, refusing, and playing back.
 *
 * The refusals carry the weight here. `@latticekit/persist` compares the same three fields and
 * refuses on the same reasoning, and the reasoning is worth repeating: a migrated input log is
 * a log that no longer replays, so a "repaired" mismatch produces a **confident wrong answer**
 * — which is worse than no answer, because it looks like it has been tested.
 */

import { describe, expect, it } from 'vitest';
import { createCamera } from '@latticekit/iso';
import { createHeadlessInput } from '../src/system.js';
import { createLog, record, replay, replayCursor } from '../src/record.js';
import { LOG_VERSION } from '../src/sample.js';
import type { InputLog, RawSample } from '../src/sample.js';
import { fixedStep } from '../src/step.js';
import { STEP_60, down, harness, move, types, up, watch } from './harness.js';

function session(): { log: InputLog; seen: ReturnType<typeof watch> } {
  const input = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
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
    expect(log.stepMs).toBe(STEP_60.stepMs);
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
    const again = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const againSeen = watch(again);
    replay(again, log);
    expect(againSeen).toEqual(seen);
  });

  it('names the field that differs, and refuses rather than migrating', () => {
    const { log } = session();
    const slower = createHeadlessInput({ camera: createCamera(800, 600), step: fixedStep(50) });
    expect(() => replay(slower, log)).toThrow(/recorded at stepMs 16\.6.* and this system runs at 20/);

    const retuned = createHeadlessInput({
      camera: createCamera(800, 600),
      step: STEP_60,
      profile: { tapSlopPx: { touch: 12 } },
    });
    expect(() => replay(retuned, log)).toThrow(/recorded under a different gesture profile/);

    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
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
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const cursor = replayCursor(fresh, log);
    expect(cursor.ticks).toBe(3);
    expect(cursor.stepMs).toBe(STEP_60.stepMs);
    expect(cursor.checkpointAt(0)).toBeUndefined();
  });

  it('satisfies the driver contract: once per tick, ascending, before the update', () => {
    const { log, seen } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const freshSeen = watch(fresh);
    const cursor = replayCursor(fresh, log);
    const updates: number[] = [];
    // The shape `@latticekit/loop`'s replay driver drives: `applyAt(tick)` exactly once per tick,
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
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const seen = watch(fresh);
    const cursor = replayCursor(fresh, log);
    for (let tick = 0; tick < cursor.ticks + 5; tick++) cursor.applyAt(tick);
    // A driver running longer than the log still advances the game rather than repeating the
    // last tick's input.
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });
});

/**
 * `K20`, in the direction the recording refusals cannot reach.
 *
 * `setProfile` and `setActions` refuse while a *recording* is open. A replay is not a recording,
 * and `replayCursor` hands control back to the driver between every tick — so the log is verified
 * once and the thing verifying it is free to change afterwards. That is the same hole as the
 * `actions` one and it is worse, because a replay is the artifact the triple exists to protect.
 */
describe('replayCursor — the system may not move under it', () => {
  it('refuses a setProfile that lands between two ticks', () => {
    const { log } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const cursor = replayCursor(fresh, log);
    cursor.applyAt(0);
    // Exactly what a game does when a settings slider moves during a replay exhibit. Nothing in
    // `setProfile` can refuse it: a replay is not a recording.
    fresh.setProfile({ tapSlopPx: { touch: 40 } });
    expect(() => cursor.applyAt(1)).toThrow(
      /setProfile or setActions moved between two applyAt calls, at tick 1/,
    );
  });

  it('refuses a setActions that lands between two ticks — the half no triple could catch', () => {
    const { log } = session();
    const fresh = createHeadlessInput<'collect'>({
      camera: createCamera(800, 600),
      step: STEP_60,
      actions: { collect: ['tap'] },
    });
    // The log's triple matches this system exactly, before and after the rebind — `actions` is
    // not in it. Re-comparing the fingerprint per tick would have found nothing.
    const cursor = replayCursor(fresh, log);
    expect(createLog(fresh).profile).toBe(log.profile);
    cursor.applyAt(0);
    fresh.setActions({ collect: ['longpress'] });
    expect(createLog(fresh).profile).toBe(log.profile);
    expect(() => cursor.applyAt(1)).toThrow(/setProfile or setActions moved between two applyAt/);
  });

  it('does not refuse a replay nobody touched', () => {
    const { log, seen } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const freshSeen = watch(fresh);
    const cursor = replayCursor(fresh, log);
    for (let tick = 0; tick < cursor.ticks; tick++) cursor.applyAt(tick);
    // The guard costs one integer compare per tick and refuses nothing that did not move.
    expect(freshSeen).toEqual(seen);
  });
});

describe('a log whose samples are not samples', () => {
  it('refuses a hole rather than replaying a session the player did not play', () => {
    const h = harness();
    const holed = [down(1, 400, 300), undefined as never, up(1, 400, 300)];
    expect(() => replay(h.input, { ...createLog(h.input), samples: holed })).toThrow(
      /log\.samples\[1\] is undefined, not a sample/,
    );
    expect(() => replay(h.input, { ...createLog(h.input), samples: [null as never] })).toThrow(
      TypeError,
    );
    // The claim is exactly one level deep: `submit` already asks whether a `down` is well formed,
    // and `@latticekit/persist` owns whether this is the log that was saved.
    expect(() => replay(h.input, { ...createLog(h.input), samples: [down(1, 0, 0)] })).not.toThrow();
  });

  it('refuses an element deleted after the cursor opened, rather than truncating in silence', () => {
    const { log } = session();
    const fresh = createHeadlessInput({ camera: createCamera(800, 600), step: STEP_60 });
    const cursor = replayCursor(fresh, log);
    cursor.applyAt(0);
    // The one way past `checkCompatible`: the cursor does not own the array, so a caller can
    // still take an element out of it. The old code broke out of the loop here and then closed
    // the tick, which reported a green replay of a log that was no longer whole.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (log.samples as RawSample[])[2];
    expect(() => cursor.applyAt(1)).toThrow(/log\.samples\[2\] was removed while the replay was running/);
  });
});
