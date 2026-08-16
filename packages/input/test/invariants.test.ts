/**
 * The invariants a reviewer can test, from the RFC's §5, in its order.
 *
 * Each one is phrased so that a failing case is obvious, and each carries the symptom it
 * prevents — because the value of these is not that they pass, it is that the sentence beside
 * them tells the next person what breaks when they stop passing.
 *
 * Invariants 11, 12, 14 and 15 are about the DOM adapter and live in `dom.test.ts`; 10's
 * allocation half is in `system.bench.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createCamera } from '@lattice/iso';
import { createHeadlessInput } from '../src/system.js';
import { record, replay } from '../src/record.js';
import type { Diagnostic } from '../src/sample.js';
import type { DragGesture } from '../src/events.js';
import { STEP_60, down, harness, move, types, up, watch } from './harness.js';

describe('I1 — a press produces at most one of tap and longpress', () => {
  it('fires longpress only when the press outlives the threshold', () => {
    // 100 ms steps, so five ticks is 500 ms and the 450 ms threshold is crossed at tick 5.
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300));
    h.idle(5);
    h.step(up(1, 400, 300));
    expect(types(seen)).toEqual(['longpress']);
    expect(seen[0]?.heldMs).toBe(500);
  });

  it('fires tap only when it does not', () => {
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300));
    h.step(up(1, 400, 300));
    expect(types(seen)).toEqual(['tap']);
    // The release that ends a hold must not also count as a tap: in the source game that
    // instantly re-dropped the building the player had just lifted.
    expect(seen[0]?.heldMs).toBe(100);
  });
});

describe('I2 — travel beyond the slop for the device is never a tap', () => {
  it('treats 5 px as a drag on a mouse and a tap on a finger', () => {
    const mouse = harness();
    const mouseSeen = watch(mouse.input);
    mouse.step(down(1, 400, 300, 'mouse'), move(1, 405, 300), up(1, 405, 300));
    expect(types(mouseSeen)).toEqual(['dragstart', 'dragend']);

    const touch = harness();
    const touchSeen = watch(touch.input);
    touch.step(down(1, 400, 300, 'touch'), move(1, 405, 300), up(1, 405, 300));
    expect(types(touchSeen)).toEqual(['tap']);
  });

  it('disarms the hold as the finger starts travelling', () => {
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300, 'touch'));
    h.step(move(1, 430, 300));
    h.idle(10);
    // A slightly shaky drag must not lift a building mid-pan.
    expect(types(seen)).toEqual(['dragstart']);
  });
});

describe('I3 — zoom is anchored to the point it was asked to anchor at', () => {
  it('keeps the world point under the anchor pinned', () => {
    const h = harness();
    // Every combination that matters: in and out, on and off the viewport center.
    for (const [factor, sx, sy] of [
      [2, 100, 100],
      [0.5, 700, 500],
      [1.15, 400, 300],
      [1 / 1.15, 0, 0],
    ] as const) {
      const wx = h.view.toWorldX(sx);
      const wy = h.view.toWorldY(sy);
      h.input.camera.zoomBy(factor, sx, sy);
      // 1e-9 world pixels: the coordinates here are of order 1e2–1e4, where a double resolves
      // to about 1e-12, so this is three orders of margin over the arithmetic and would still
      // catch an anchor that is out by a thousandth of a pixel. The clamp cannot intervene —
      // the default bounds are ±1e4 and the camera never leaves the origin's neighbourhood.
      expect(Math.abs(h.view.toWorldX(sx) - wx)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(h.view.toWorldY(sy) - wy)).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe('I4 — output is a pure function of the sample stream', () => {
  it('replays a recorded log to an identical sequence of gestures', () => {
    const live = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const liveSeen = watch(live);
    const recording = record(live);

    // A session with one of everything, spaced unevenly in "real time" — which is exactly the
    // thing a log must not be sensitive to.
    live.submit(down(1, 400, 300, 'touch'));
    live.tick(0);
    live.tick(1);
    live.submit(move(1, 460, 320));
    live.submit(move(1, 500, 340));
    live.tick(2);
    live.submit(up(1, 500, 340));
    live.submit({ kind: 'wheel', sx: 200, sy: 200, dz: -100, pinch: false });
    live.tick(3);
    live.submit({ kind: 'key', code: 'Space', down: true });
    live.tick(4);
    const log = recording.stop();

    const again = createHeadlessInput({ camera: createCamera(800, 600), stepMs: STEP_60 });
    const againSeen = watch(again);
    replay(again, log);

    expect(againSeen).toEqual(liveSeen);
    expect(againSeen.length).toBeGreaterThan(0);
  });
});

describe('I5 — nothing game-visible is emitted outside tick', () => {
  it('runs no handler however many frames pass', () => {
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    h.input.submit(down(1, 400, 300));
    for (let i = 0; i < 1000; i++) h.input.frame(i * 16);
    // There is no timer that could fire a long press, which is why this is a property and not
    // a race.
    expect(seen).toEqual([]);
    expect(h.input.buffered).toBe(1);
  });
});

describe('I6 — a tick sees a bucket that was closed before it started', () => {
  it('delivers a sample submitted by a handler in the next tick, never the running one', () => {
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    let injected = false;
    h.input.on('tap', (): void => {
      if (injected) return;
      injected = true;
      h.input.submit(down(2, 100, 100, 'touch'));
      h.input.submit(up(2, 100, 100));
    });
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(types(seen)).toEqual(['tap']);
    expect(h.input.buffered).toBe(2);
    h.idle(1);
    expect(types(seen)).toEqual(['tap', 'tap']);
  });

  it('loses nothing on a pump with no ticks and delivers the backlog to the first of five', () => {
    const h = harness({ stepMs: 100 });
    const seen = watch(h.input);
    h.input.submit(down(1, 400, 300, 'touch'));
    h.input.submit(up(1, 400, 300));
    expect(seen).toEqual([]);
    h.idle(5);
    // A tap cannot be dropped by a slow frame and cannot fire twice on a fast one.
    expect(types(seen)).toEqual(['tap']);
    expect(seen[0]?.tick).toBe(0);
  });
});

describe('I7 — overflow degrades precision, never events', () => {
  it('keeps the up, collapses the moves, and says so once', () => {
    const diagnostics: Diagnostic[] = [];
    const h = harness({
      stepMs: 100,
      onDiagnostic: (d): void => {
        diagnostics.push(d);
      },
    });
    const seen = watch(h.input);
    h.input.submit(down(1, 400, 300));
    for (let i = 0; i < 10_000; i++) h.input.submit(move(1, 400 + i, 300));
    h.input.submit(up(1, 10_399, 300));
    h.idle(1);

    expect(diagnostics.map((d) => d.code)).toEqual(['buffer-overflow']);
    const sequence = types(seen);
    expect(sequence[0]).toBe('dragstart');
    expect(sequence[sequence.length - 1]).toBe('dragend');
    expect(sequence.filter((t) => t === 'dragend')).toHaveLength(1);
    // Ten thousand moves collapsed to a handful: precision, not events.
    expect(sequence.length).toBeLessThan(4096);
  });
});

describe('I8 — dispose is total and idempotent', () => {
  it('runs zero handlers afterwards and is safe to call twice', () => {
    const h = harness({ stepMs: 100, actions: { collect: ['tap', 'key:Space'] } });
    const seen = watch(h.input);
    let live = true;
    h.input.onAction('collect', (): void => {
      if (!live) throw new Error('an action fired after dispose');
    });
    h.input.submit({ kind: 'key', code: 'Space', down: true });
    h.idle(1);
    seen.length = 0;

    live = false;
    h.input.dispose();
    expect(h.input.disposed).toBe(true);
    expect(h.input.held('collect')).toBe(false);
    h.input.submit(down(1, 400, 300, 'touch'));
    h.input.submit(move(1, 500, 300));
    h.input.submit(up(1, 500, 300));
    h.input.tick(99);
    expect(seen).toEqual([]);
    expect(() => {
      h.input.dispose();
    }).not.toThrow();
  });

  it('leaves a sibling scope working when one child is disposed alone', () => {
    const h = harness({ stepMs: 100 });
    const first: string[] = [];
    const second: string[] = [];
    const a = h.input.scope();
    const b = h.input.scope();
    a.on('tap', (): void => {
      first.push('a');
    });
    b.on('tap', (): void => {
      second.push('b');
    });
    a.dispose();
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(first).toEqual([]);
    expect(second).toEqual(['b']);
    expect(a.disposed).toBe(true);
    expect(b.disposed).toBe(false);
  });
});

describe('I9 — focus loss releases everything', () => {
  it('releases a held key with no up', () => {
    const h = harness({ stepMs: 100, actions: { pan: ['key:KeyW'] } });
    h.step({ kind: 'key', code: 'KeyW', down: true });
    expect(h.input.keyHeld('KeyW')).toBe(true);
    expect(h.input.held('pan')).toBe(true);
    h.step({ kind: 'blur' });
    // Alt-tab with a key held, and without this the camera pans for ever afterwards.
    expect(h.input.keyHeld('KeyW')).toBe(false);
    expect(h.input.held('pan')).toBe(false);
  });
});

describe('I10 — the gesture object identity is the same across deliveries', () => {
  it('hands the same object to every drag', () => {
    const h = harness();
    const objects: DragGesture[] = [];
    h.input.on('drag', (g): void => {
      objects.push(g);
    });
    h.step(down(1, 400, 300), move(1, 440, 300), move(1, 480, 300), move(1, 520, 300));
    expect(objects.length).toBeGreaterThan(1);
    expect(objects.every((o) => o === objects[0])).toBe(true);
  });
});

describe('I13 — the recognizer cannot be latched', () => {
  const endings = [
    { name: 'up', flings: true },
    { name: 'cancel', flings: false },
    { name: 'blur', flings: false },
    { name: 'dispose', flings: false },
  ] as const;

  for (const ending of endings) {
    it(`produces exactly one dragend on ${ending.name}`, () => {
      const h = harness({ stepMs: 100 });
      const seen = watch(h.input);
      h.step(down(1, 400, 300));
      h.step(move(1, 440, 300));
      h.step(move(1, 480, 300));

      if (ending.name === 'up') h.step(up(1, 520, 300));
      else if (ending.name === 'cancel') h.step({ kind: 'cancel', id: 1 });
      else if (ending.name === 'blur') h.step({ kind: 'blur' });
      else h.input.dispose();

      const ends = seen.filter((s) => s.type === 'dragend');
      expect(ends).toHaveLength(1);
      const end = ends[0];
      if (end === undefined) throw new Error('unreachable: length was asserted');
      if (ending.flings) {
        // 40 px per 100 ms tick is 400 px/s, and the release must carry it.
        expect(end.vx).toBeGreaterThan(0);
      } else {
        // A gesture interrupted by an incoming call must not leave the camera flying.
        expect(end.vx).toBe(0);
        expect(end.vy).toBe(0);
      }
    });
  }
});
