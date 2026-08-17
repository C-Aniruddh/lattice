/**
 * The system: construction, the two entry points, the queries, and teardown.
 *
 * Most of what this file asserts is a refusal. That is the shape of the package: every one of
 * these mistakes — a step of zero, a repeated tick index, a `NaN` from a synthetic event — is
 * silent at the point it is made and catastrophic somewhere else, and the whole value of
 * naming them here is that the stack trace points at the line that made the mistake.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCamera } from '@latticekit/iso';
import type { GridPoint } from '@latticekit/iso';
import type { Vec2 } from '@latticekit/core';
import { createHeadlessInput, internalsOf } from '../src/system.js';
import type { Diagnostic } from '../src/sample.js';
import { createLog, record } from '../src/record.js';
import { STEP_60, camera, down, harness, move, types, up, watch } from './harness.js';

describe('construction', () => {
  it('refuses a system with no camera to resolve through', () => {
    expect(() => createHeadlessInput({ camera: undefined as never, step: STEP_60 })).toThrow(
      /expected an @latticekit\/iso Camera/,
    );
    expect(() => createHeadlessInput({ camera: {} as never, step: STEP_60 })).toThrow(TypeError);
  });

  it('refuses a step that makes every duration wrong by the same ratio', () => {
    // The mistake K13 names: a bare 16 against a 16.667 ms loop. It used to be accepted, and the
    // symptom arrived months later as a replay refusal.
    expect(() => createHeadlessInput({ camera: camera(), step: 16 as never })).toThrow(
      /createHeadlessInput\.step: expected the loop, or fixedStep\(hz\) — got the bare number 16/,
    );
    expect(() => createHeadlessInput({ camera: camera(), step: null as never })).toThrow(TypeError);

    for (const stepMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createHeadlessInput({ camera: camera(), step: { stepMs, stepSeconds: stepMs / 1000 } }),
      ).toThrow(/createHeadlessInput\.step\.stepMs: expected a finite number > 0/);
      expect(() =>
        createHeadlessInput({ camera: camera(), step: { stepMs: 16.667, stepSeconds: stepMs } }),
      ).toThrow(/createHeadlessInput\.step\.stepSeconds: expected a finite number > 0/);
    }
  });

  it('refuses a pair that describes two different steps', () => {
    // A hand-written loop-alike: 16 ms beside 60 Hz worth of seconds. Nothing else in the kit
    // could catch this — both fields are finite and positive.
    expect(() =>
      createHeadlessInput({ camera: camera(), step: { stepMs: 16, stepSeconds: 0.016667 } }),
    ).toThrow(/describe different steps — 16.667 ms against 16 ms/);
  });

  it('accepts a real loop reading, whose two fields agree only to a rounding error', () => {
    // Exactly how `createLoop` derives them: integer microseconds, then two divisions. The
    // agreement tolerance has to survive this and refuse the pair above.
    const stepUs = Math.round(1_000_000 / 60);
    const input = createHeadlessInput({
      camera: camera(),
      step: { stepMs: stepUs / 1_000, stepSeconds: stepUs / 1_000_000 },
    });
    expect(input.stepMs).toBe(16.667);
  });

  it('exposes the resolved profile, the step and the action names', () => {
    const h = harness<'collect' | 'build'>({
      actions: { collect: ['tap'], build: ['key:KeyB'] },
      profile: { longPressMs: 900 },
    });
    expect(h.input.stepMs).toBe(STEP_60.stepMs);
    expect(h.input.profile.longPressMs).toBe(900);
    expect(h.input.profile.tapSlopPx.touch).toBe(9);
    expect(h.input.actionNames).toEqual(['collect', 'build']);
    expect(h.input.bindings('build')).toEqual(['key:KeyB']);
  });
});

describe('tick', () => {
  it('refuses an index that is not an integer', () => {
    const h = harness();
    expect(() => h.input.tick(1.5)).toThrow(/input\.tick: expected an integer/);
  });

  it('refuses a repeat and a regression, because the index is the log time axis', () => {
    const h = harness();
    h.input.tick(4);
    expect(() => h.input.tick(4)).toThrow(/expected an index greater than the previous 4/);
    expect(() => h.input.tick(3)).toThrow(RangeError);
    expect(() => h.input.tick(5)).not.toThrow();
  });

  it('starts wherever the loop is, so a system built mid-session still works', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.input.submit(down(1, 400, 300, 'touch'));
    h.input.submit(up(1, 400, 300));
    h.input.tick(50_000);
    expect(seen[0]?.tick).toBe(50_000);
  });
});

describe('frame', () => {
  it('refuses a time that is not a number', () => {
    const h = harness();
    expect(() => h.input.frame(Number.NaN)).toThrow(/expected a finite number of milliseconds/);
  });

  it('integrates the camera and nothing else', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 400, 300));
    h.step(move(1, 440, 300));
    h.step(up(1, 480, 300));
    const before = h.view.x;
    // The first frame has no previous one to measure against, so it moves nothing at all.
    h.input.frame(1000);
    expect(h.view.x).toBe(before);
    h.input.frame(1016);
    expect(h.view.x).not.toBe(before);
    // And no handler ran: everything game-visible happens in `tick`.
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });
});

describe('submit', () => {
  it('refuses a tick sample, which is a marker and not an arrival', () => {
    const h = harness();
    expect(() => h.input.submit({ kind: 'tick', index: 0 })).toThrow(
      /a tick sample is a marker the log gets from input\.tick/,
    );
  });

  it('refuses a coordinate that would reach the camera as NaN', () => {
    const h = harness();
    expect(() => h.input.submit(move(1, Number.NaN, 0))).toThrow(/expected finite sx\/sy/);
    expect(() => h.input.submit(down(1, 0, Number.POSITIVE_INFINITY))).toThrow(RangeError);
    expect(() =>
      h.input.submit({ kind: 'wheel', sx: 0, sy: 0, dz: Number.NaN, pinch: false }),
    ).toThrow(/expected a finite dz/);
    expect(() => h.input.submit(undefined as never)).toThrow(TypeError);
  });

  it('accepts the kinds that carry no coordinates', () => {
    const h = harness();
    expect(() => {
      h.input.submit({ kind: 'cancel', id: 1 });
      h.input.submit({ kind: 'key', code: 'KeyA', down: true });
      h.input.submit({ kind: 'blur' });
    }).not.toThrow();
    expect(h.input.buffered).toBe(3);
  });
});

describe('the queries', () => {
  it('reports no pointer before anything has happened, and on a touch device between taps', () => {
    const h = harness();
    const tile: GridPoint = { gx: 0, gy: 0 };
    const point: Vec2 = { x: 0, y: 0 };
    // A control that only appears on hover does not exist on a phone.
    expect(h.input.hoverTile(tile)).toBe(false);
    expect(h.input.pointerScreen(point)).toBe(false);

    h.input.submit(down(1, 400, 300, 'touch'));
    expect(h.input.pointerScreen(point)).toBe(true);
    expect(point).toEqual({ x: 400, y: 300 });
    h.input.submit(up(1, 400, 300));
    expect(h.input.hoverTile(tile)).toBe(false);
  });

  it('keeps a mouse position after a click, because the mouse is still there', () => {
    const h = harness();
    const point: Vec2 = { x: 0, y: 0 };
    h.input.submit(down(1, 200, 100, 'mouse'));
    h.input.submit(up(1, 210, 110));
    expect(h.input.pointerScreen(point)).toBe(true);
    expect(point).toEqual({ x: 210, y: 110 });
    h.input.submit({ kind: 'blur' });
    expect(h.input.pointerScreen(point)).toBe(false);
  });

  it('treats a hover with no press before it as a pointer that can hover', () => {
    const h = harness();
    const point: Vec2 = { x: 0, y: 0 };
    h.input.submit(move(7, 50, 60));
    expect(h.input.pointerScreen(point)).toBe(true);
    h.input.submit({ kind: 'cancel', id: 7 });
    // A finger cannot hover, so a cancel only clears the hover when the pointer was one.
    expect(h.input.pointerScreen(point)).toBe(true);
  });

  it('clears the hover when a canceled touch goes away', () => {
    const h = harness();
    const point: Vec2 = { x: 0, y: 0 };
    h.input.submit(down(1, 50, 60, 'touch'));
    h.input.submit({ kind: 'cancel', id: 1 });
    expect(h.input.pointerScreen(point)).toBe(false);
  });

  it('answers held from any binding, and keyHeld for a key with no action', () => {
    const h = harness<'charge'>({ hz: 10, actions: { charge: ['tap', 'key:Space'] } });
    expect(h.input.held('charge')).toBe(false);
    h.step(down(1, 400, 300, 'touch'));
    expect(h.input.held('charge')).toBe(true);
    h.step(up(1, 400, 300));
    expect(h.input.held('charge')).toBe(false);
    h.step({ kind: 'key', code: 'F3', down: true });
    expect(h.input.keyHeld('F3')).toBe(true);
    expect(h.input.held('charge')).toBe(false);
  });

  it('counts what is waiting for the next tick', () => {
    const h = harness();
    expect(h.input.buffered).toBe(0);
    h.input.submit(down(1, 0, 0));
    h.input.submit(move(1, 1, 1));
    expect(h.input.buffered).toBe(2);
    h.idle(1);
    expect(h.input.buffered).toBe(0);
  });
});

describe('the camera controller', () => {
  it('drives the camera from gestures by default', () => {
    const h = harness();
    h.step(down(1, 400, 300), move(1, 500, 300));
    h.step(move(1, 560, 300));
    expect(h.view.x).toBeLessThan(0);
    h.step({ kind: 'wheel', sx: 400, sy: 300, dz: -100, pinch: false });
    expect(h.view.zoom).toBeGreaterThan(1);
  });

  it('leaves the camera alone when the game says its camera is fixed', () => {
    const h = harness({ control: false });
    const seen = watch(h.input);
    h.step(down(1, 400, 300), move(1, 500, 300));
    h.step({ kind: 'wheel', sx: 400, sy: 300, dz: -100, pinch: false });
    h.input.frame(0);
    h.input.frame(100);
    expect(h.view.x).toBe(0);
    expect(h.view.zoom).toBe(1);
    // The gestures still arrive, which is what makes this an option rather than a fork.
    expect(types(seen)).toEqual(['dragstart', 'zoom']);
  });
});

describe('diagnostics', () => {
  it('goes to console.warn by default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createHeadlessInput({ camera: camera(), step: STEP_60, actions: { odd: ['key:Lang1'] } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('unknown-key-code');
  });

  it('reports each code at most once, however many times it happens', () => {
    const seen: Diagnostic[] = [];
    const h = harness({
      profile: { maxBufferedSamples: 4 },
      onDiagnostic: (d): void => {
        seen.push(d);
      },
    });
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 20; i++) h.input.submit(move(1, i, 0));
      h.idle(1);
    }
    // A diagnostic that repeats sixty times a second is one nobody reads.
    expect(seen.map((d) => d.code)).toEqual(['buffer-overflow']);
  });
});

describe('the names are inferred from the map', () => {
  it('refuses a misspelled action at compile time', () => {
    const h = harness<'collect' | 'build'>({
      actions: { collect: ['tap'], build: ['key:KeyB'] },
    });
    // The headline claim of the action map, asserted by the compiler rather than by prose.
    // Never called: each line below is a *type* error, and `tsc` reports an unused
    // `@ts-expect-error` if it stops being one — which is what makes this a test and not a
    // comment. (Every one of them also throws at runtime, which the tests above cover.)
    function refusedByTheCompiler(): void {
      // @ts-expect-error — 'colect' is not a declared action
      h.input.onAction('colect', () => undefined);
      // @ts-expect-error — 'swipe' is not a gesture
      h.input.on('swipe', () => undefined);
      // @ts-expect-error — 'collect' is not declared on a system with no action map
      harness().input.held('collect');
      // @ts-expect-error — a drag has no keyboard equivalent that is not a lie
      harness({ actions: { pan: ['drag'] } });
    }
    expect(typeof refusedByTheCompiler).toBe('function');
    expect(h.input.actionNames).toEqual(['collect', 'build']);
  });
});

describe('a system with no actions at all', () => {
  it('says so, rather than listing nothing', () => {
    const h = harness();
    expect(() => h.input.onAction('collect' as never, () => undefined)).toThrow(
      /declared: \(none\)/,
    );
    expect(() => h.input.bindings('collect' as never)).toThrow(/declared: \(none\)/);
    expect(() => h.input.held('collect' as never)).toThrow(/declared: \(none\)/);
    expect(h.input.actionNames).toEqual([]);
  });
});

describe('internalsOf', () => {
  it('refuses anything this package did not build', () => {
    // A structural duck-type would be worse: `record` would silently record nothing and hand
    // back an empty log that replays green.
    expect(() => internalsOf({ tick: () => undefined })).toThrow(
      /expected an InputSystem from createInput or createHeadlessInput/,
    );
  });

  it('hands back an empty log when a recording was stopped that never started', () => {
    // Reachable only through the internals seam, which is why it is asserted here rather than
    // through `record`: `stop()` with no `start()` before it must be an empty session, not a
    // `TypeError` from a hook a debugging tool called in the wrong order.
    const h = harness();
    expect(internalsOf(h.input).stop()).toEqual([]);
  });
});

describe('dispose', () => {
  it('stops the camera and ignores everything afterwards', () => {
    const h = harness();
    h.step(down(1, 400, 300), move(1, 460, 300));
    h.step(move(1, 520, 300));
    h.step(up(1, 580, 300));
    expect(h.input.camera.gliding).toBe(true);
    h.input.dispose();
    // A camera still coasting under a dialog has moved somewhere the player did not choose
    // while they could not see it.
    expect(h.input.camera.gliding).toBe(false);
    const at = h.view.x;
    h.input.frame(0);
    h.input.frame(100);
    expect(h.view.x).toBe(at);
    expect(h.input.buffered).toBe(0);
  });

  it('is a no-op for a camera with no gesture in flight', () => {
    const h = harness();
    const seen = watch(h.input);
    h.input.dispose();
    expect(seen).toEqual([]);
  });
});

/**
 * K13's third finding: there was no `setProfile`, so retuning one threshold meant dispose,
 * recreate and re-register every handler — the only reason the gallery bootstrap grew its own
 * `onAction`/`on` indirection and a `Binding[]` to replay onto each new system.
 */
describe('setProfile', () => {
  it('puts the new thresholds in force and keeps every handler', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    // 40 px of travel: a drag under the default mouse slop of 4, still a drag under 30, and a
    // tap once the slop is 60.
    h.step(down(1, 400, 300), move(1, 440, 300));
    h.step(up(1, 440, 300));
    expect(types(seen)).toEqual(['dragstart', 'dragend']);

    expect(h.input.setProfile({ tapSlopPx: { mouse: 60 } }).tapSlopPx.mouse).toBe(60);
    expect(h.input.profile.tapSlopPx.mouse).toBe(60);

    seen.length = 0;
    h.step(down(2, 400, 300), move(2, 440, 300));
    h.step(up(2, 440, 300));
    // The same handler, never re-registered, now sees the same movement as a tap.
    expect(types(seen)).toEqual(['tap']);
  });

  it('keeps action handlers and child scopes too, which is the whole point', () => {
    const h = harness<'collect'>({ hz: 10, actions: { collect: ['tap'] } });
    const fired: number[] = [];
    const scope = h.input.scope();
    scope.onAction('collect', (a) => fired.push(a.gx));
    h.input.setProfile({ longPressMs: 800 });
    h.step(down(1, 400, 300));
    h.step(up(1, 400, 300));
    expect(fired).toHaveLength(1);
    scope.dispose();
  });

  it('replaces the override set rather than patching it, so the result is path-independent', () => {
    const h = harness({ hz: 10, profile: { longPressMs: 900, pinchStartPx: 30 } });
    expect(h.input.profile.longPressMs).toBe(900);
    // Naming only one knob drops the other: a patching version would make the thresholds depend
    // on the order the sliders were moved, and a path-dependent profile is one a log's
    // fingerprint cannot be reasoned about.
    h.input.setProfile({ longPressMs: 300 });
    expect(h.input.profile.longPressMs).toBe(300);
    expect(h.input.profile.pinchStartPx).toBe(12);
    // And nothing at all is a return to the defaults, not a no-op.
    expect(h.input.setProfile({}).longPressMs).toBe(450);
    expect(h.input.setProfile(undefined).pinchStartPx).toBe(12);
  });

  it('counts the new long press in ticks of the same step', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.input.setProfile({ longPressMs: 300 });
    h.step(down(1, 400, 300, 'touch'));
    // 100 ms a tick, so 300 ms is three ticks past the press: it matures on tick 3 and not on
    // tick 2. Under the default 450 ms it would be five, so this cannot pass without the retune.
    h.idle(2);
    expect(types(seen)).toEqual([]);
    h.idle(1);
    expect(types(seen)).toEqual(['longpress']);
  });

  it('retunes the camera controller in place, so a held reference still drives it', () => {
    const h = harness({ hz: 10 });
    const control = h.input.camera;
    h.step({ kind: 'key', code: 'ArrowRight', down: true });
    h.input.frame(0);
    h.input.frame(1000);
    // One second of held pan at the default 700 px/s. Negative because the player is dragging
    // the viewport right, which moves the camera's world origin left — see PAN_KEYS.
    expect(h.view.x).toBe(-700);

    h.input.setProfile({ keyPanPxPerS: 100 });
    // The retune released the key, exactly as dispose does, so the camera is not left panning
    // under thresholds nobody chose.
    expect(h.input.keyHeld('ArrowRight')).toBe(false);
    expect(h.input.camera).toBe(control);

    // Advance the frame clock first, with nothing held, so the second measurement is one clean
    // second of the new speed rather than two of it.
    h.input.frame(2000);
    h.step({ kind: 'key', code: 'ArrowRight', down: true });
    h.input.frame(3000);
    expect(h.view.x).toBe(-800);
  });

  it('moves the stall ceiling on the buffer that already exists', () => {
    const h = harness({ hz: 10, onDiagnostic: (): void => undefined });
    h.input.setProfile({ maxBufferedSamples: 4 });
    for (let i = 0; i < 12; i++) h.input.submit(move(1, 400 + i, 300));
    // Collapsed to the newest move for that pointer rather than growing to twelve.
    expect(h.input.buffered).toBeLessThanOrEqual(4);
  });

  it('ends every live gesture first, under the thresholds that recognized it', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300), move(1, 460, 300));
    expect(types(seen)).toEqual(['dragstart']);
    h.input.setProfile({ tapSlopPx: { mouse: 60 } });
    // A drag whose `dragend` never arrives is a placement ghost stuck to the cursor.
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });

  it('validates before it touches anything, so a refused override changes nothing', () => {
    const h = harness({ hz: 10, profile: { longPressMs: 900 } });
    expect(() => h.input.setProfile({ longPressMs: -1 })).toThrow(
      /input\.setProfile\.longPressMs: expected a finite number > 0/,
    );
    expect(() => h.input.setProfile({ maxPointers: 1.5 })).toThrow(RangeError);
    expect(h.input.profile.longPressMs).toBe(900);
  });

  it('refuses a retune from inside a handler, mid-bucket', () => {
    const h = harness({ hz: 10 });
    let thrown: unknown;
    h.input.on('tap', () => {
      try {
        h.input.setProfile({ longPressMs: 300 });
      } catch (error) {
        thrown = error;
      }
    });
    h.step(down(1, 400, 300));
    h.step(up(1, 400, 300));
    // The samples behind this one would meet a recognizer that never saw their press.
    expect(String(thrown)).toMatch(/called from inside a handler/);
    expect(h.input.profile.longPressMs).toBe(450);
    // And the flag is cleared afterwards, so one refusal does not brick the knob.
    expect(h.input.setProfile({ longPressMs: 300 }).longPressMs).toBe(300);
  });

  it('clears the guard even when a handler throws', () => {
    const h = harness({ hz: 10 });
    h.input.on('tap', () => {
      throw new Error('the game is broken, and that is the game to fix');
    });
    h.step(down(1, 400, 300));
    expect(() => h.step(up(1, 400, 300))).toThrow(/the game is broken/);
    expect(() => h.input.setProfile({ longPressMs: 300 })).not.toThrow();
  });

  it('refuses while a recording is running, because the fingerprint is a third of its identity', () => {
    const h = harness({ hz: 10 });
    const tape = record(h.input);
    expect(() => h.input.setProfile({ longPressMs: 300 })).toThrow(/a recording is running/);
    const log = tape.stop();
    // Now it is allowed, and the log that was sealed keeps the profile it was recorded under.
    h.input.setProfile({ longPressMs: 300 });
    expect(log.profile).toContain('longPressMs:450');
    expect(createLog(h.input).profile).toContain('longPressMs:300');
  });

  it('makes a log recorded after a retune refuse to replay into a system that was not retuned', () => {
    const h = harness({ hz: 10 });
    h.input.setProfile({ tapSlopPx: { touch: 20 } });
    expect(internalsOf(h.input).fingerprint).toContain('tap:4,20,6');
    const fresh = harness({ hz: 10 });
    expect(internalsOf(fresh.input).fingerprint).toContain('tap:4,9,6');
  });

  it('refuses after dispose, rather than storing thresholds nothing reads', () => {
    const h = harness({ hz: 10 });
    h.input.dispose();
    expect(() => h.input.setProfile({ longPressMs: 300 })).toThrow(/has been disposed/);
  });
});

/**
 * `K20`. Rebinding a key used to cost a full dispose and re-register, which is why the gallery
 * bootstrap kept a `Binding[]` to replay onto each new system.
 *
 * The refusal is the interesting half, and its reason is **not** `setProfile`'s. The log stores
 * `RawSample`s and the map is not in the compatibility triple, so a mid-recording rebind leaves a
 * log that replays without complaint and fires different actions than the session it came from —
 * the only failure in this package that produces no error, no visible defect, and a confident
 * wrong answer months later.
 */
describe('setActions', () => {
  it('rebinds the key and keeps every handler, which is the whole point', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    const fired: string[] = [];
    const scope = h.input.scope();
    scope.onAction('build', (a) => fired.push(a.binding));

    h.step({ kind: 'key', code: 'KeyB', down: true });
    expect(fired).toEqual(['key:KeyB']);

    h.input.setActions({ build: ['key:KeyN'] });

    // The old key is dead and the new one fires, through the handler that was never re-registered.
    h.step({ kind: 'key', code: 'KeyB', down: true }, { kind: 'key', code: 'KeyN', down: true });
    expect(fired).toEqual(['key:KeyB', 'key:KeyN']);
    scope.dispose();
  });

  it('is read back off the system, so a shortcut sheet needs no second copy of the map', () => {
    const h = harness<'build' | 'collect'>({
      hz: 10,
      actions: { collect: ['tap'], build: ['key:KeyB'] },
    });
    expect(h.input.bindings('build')).toEqual(['key:KeyB']);
    h.input.setActions({ collect: ['tap', 'key:Space'], build: ['key:KeyN', 'longpress'] });
    // Rule 11: the getter reads the field the setter wrote, not a copy taken at construction.
    expect(h.input.bindings('build')).toEqual(['key:KeyN', 'longpress']);
    expect(h.input.bindings('collect')).toEqual(['tap', 'key:Space']);
    expect([...h.input.actionNames].sort()).toEqual(['build', 'collect']);
  });

  it('refuses a name that was never declared, because a name is identity', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    expect(() =>
      h.input.setActions({ sprint: ['key:KeyS'] } as unknown as { build: readonly 'key:KeyS'[] }),
    ).toThrow(/'sprint' was not declared when this system was built/);
    // And the message lists what is declared, so the caller does not go looking.
    expect(() =>
      h.input.setActions({ sprint: ['key:KeyS'] } as unknown as { build: readonly 'key:KeyS'[] }),
    ).toThrow(/Declared: build/);
  });

  it('refuses a map that drops a declared action, rather than muting its handlers', () => {
    const h = harness<'build' | 'collect'>({
      hz: 10,
      actions: { collect: ['tap'], build: ['key:KeyB'] },
    });
    expect(() =>
      h.input.setActions({ collect: ['tap'] } as unknown as {
        collect: readonly 'tap'[];
        build: readonly 'tap'[];
      }),
    ).toThrow(/declares 1 of this system's 2 actions/);
  });

  it('validates in the same words as construction, from both entrances', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    // The near-miss check, the empty-list check and the shape check are one validator, so the
    // only difference between the two messages is the name of the entrance.
    expect(() => h.input.setActions({ build: ['key:space'] as never })).toThrow(
      /input\.setActions\.build: 'key:space' is not a KeyboardEvent\.code; did you mean 'key:Space'\?/,
    );
    expect(() => h.input.setActions({ build: [] })).toThrow(
      /input\.setActions\.build: expected at least one binding/,
    );
    expect(() =>
      createHeadlessInput({ camera: camera(), step: STEP_60, actions: { build: ['key:space'] } }),
    ).toThrow(/createHeadlessInput\.actions\.build: .* did you mean 'key:Space'\?/);
  });

  it('changes nothing when it is refused', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    // A binding this package cannot dispatch. It sits *after* a valid one in the list, so a
    // validator that applied as it went would leave `build` bound to `tap` and nothing else.
    expect(() => h.input.setActions({ build: ['tap', 'wiggle' as never] })).toThrow(RangeError);
    expect(h.input.bindings('build')).toEqual(['key:KeyB']);
    // Still dispatching through the old map, not a half-applied one.
    const fired: string[] = [];
    h.input.onAction('build', (a) => fired.push(a.binding));
    h.step({ kind: 'key', code: 'KeyB', down: true });
    expect(fired).toEqual(['key:KeyB']);
  });

  it('refuses a rebind from inside a handler, mid-bucket', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    let thrown: unknown;
    h.input.onAction('build', () => {
      try {
        h.input.setActions({ build: ['key:KeyN'] });
      } catch (error) {
        thrown = error;
      }
    });
    h.step({ kind: 'key', code: 'KeyB', down: true });
    expect(String(thrown)).toMatch(/called from inside a handler/);
    expect(h.input.bindings('build')).toEqual(['key:KeyB']);
    // And the guard clears, so one refusal does not brick the knob.
    h.input.setActions({ build: ['key:KeyN'] });
    expect(h.input.bindings('build')).toEqual(['key:KeyN']);
  });

  it('refuses while a recording is running, for a reason the triple does not cover', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    const tape = record(h.input);
    expect(() => h.input.setActions({ build: ['key:KeyN'] })).toThrow(
      /a recording is running.*not in the compatibility triple/s,
    );

    // The proof that the refusal is load-bearing: had it gone through, the log's triple would be
    // byte-identical to the one a fresh system reports, so nothing downstream could have refused
    // the replay — `actions` is not in the triple, and the log records samples rather than
    // actions. That is the whole of the hole this refusal closes.
    const log = tape.stop();
    h.input.setActions({ build: ['key:KeyN'] });
    expect(createLog(h.input).profile).toBe(log.profile);
    expect(createLog(h.input).stepMs).toBe(log.stepMs);
    expect(createLog(h.input).version).toBe(log.version);
  });

  it('refuses after dispose, rather than storing a map nothing dispatches through', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    h.input.dispose();
    expect(() => h.input.setActions({ build: ['key:KeyN'] })).toThrow(/has been disposed/);
  });

  it('needs no gesture to end first, because an action map holds no live state', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['tap'] } });
    const seen = watch(h.input);
    h.step(down(1, 400, 300), move(1, 460, 300));
    expect(types(seen)).toEqual(['dragstart']);
    // Unlike `setProfile`, which must end the drag under the thresholds that recognized it: the
    // drag here is unaffected, because nothing about it was dispatched through the map.
    h.input.setActions({ build: ['longpress'] });
    expect(types(seen)).toEqual(['dragstart']);
    h.step(up(1, 460, 300));
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });

  it('answers held through the map in force, which is what held means', () => {
    const h = harness<'build'>({ hz: 10, actions: { build: ['key:KeyB'] } });
    h.step({ kind: 'key', code: 'KeyB', down: true });
    expect(h.input.held('build')).toBe(true);
    h.input.setActions({ build: ['key:KeyN'] });
    // KeyB is still physically down; it is simply no longer what `build` means.
    expect(h.input.keyHeld('KeyB')).toBe(true);
    expect(h.input.held('build')).toBe(false);
  });

  it('is legal on a system with no actions, and says so when asked for one', () => {
    const h = harness({ hz: 10 });
    h.input.setActions({});
    expect(h.input.actionNames).toEqual([]);
    expect(() => h.input.bindings('nope' as never)).toThrow(/declared: \(none\)/);
  });
});
