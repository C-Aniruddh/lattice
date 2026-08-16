/**
 * The system: construction, the two entry points, the queries, and teardown.
 *
 * Most of what this file asserts is a refusal. That is the shape of the package: every one of
 * these mistakes — a step of zero, a repeated tick index, a `NaN` from a synthetic event — is
 * silent at the point it is made and catastrophic somewhere else, and the whole value of
 * naming them here is that the stack trace points at the line that made the mistake.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCamera } from '@lattice/iso';
import type { GridPoint } from '@lattice/iso';
import type { Vec2 } from '@lattice/core';
import { createHeadlessInput, internalsOf } from '../src/system.js';
import type { Diagnostic } from '../src/sample.js';
import { STEP_60, camera, down, harness, move, types, up, watch } from './harness.js';

describe('construction', () => {
  it('refuses a system with no camera to resolve through', () => {
    expect(() => createHeadlessInput({ camera: undefined as never, stepMs: 16 })).toThrow(
      /expected an @lattice\/iso Camera/,
    );
    expect(() => createHeadlessInput({ camera: {} as never, stepMs: 16 })).toThrow(TypeError);
  });

  it('refuses a step that makes every duration wrong by the same ratio', () => {
    for (const stepMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createHeadlessInput({ camera: camera(), stepMs })).toThrow(
        /createHeadlessInput\.stepMs: expected a finite number > 0/,
      );
    }
  });

  it('exposes the resolved profile, the step and the action names', () => {
    const h = harness<'collect' | 'build'>({
      actions: { collect: ['tap'], build: ['key:KeyB'] },
      profile: { longPressMs: 900 },
    });
    expect(h.input.stepMs).toBe(STEP_60);
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
    const h = harness({ stepMs: 100 });
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

  it('clears the hover when a cancelled touch goes away', () => {
    const h = harness();
    const point: Vec2 = { x: 0, y: 0 };
    h.input.submit(down(1, 50, 60, 'touch'));
    h.input.submit({ kind: 'cancel', id: 1 });
    expect(h.input.pointerScreen(point)).toBe(false);
  });

  it('answers held from any binding, and keyHeld for a key with no action', () => {
    const h = harness<'charge'>({ stepMs: 100, actions: { charge: ['tap', 'key:Space'] } });
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
    createHeadlessInput({ camera: camera(), stepMs: 16, actions: { odd: ['key:Lang1'] } });
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
