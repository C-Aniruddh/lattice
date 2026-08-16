/**
 * The state machine, driven through the headless system — which is the same thing with
 * coordinates attached, and the surface a game actually asserts against.
 *
 * The pinch tests are the fiddly ones and they exist because every one of them is a shipped
 * bug: a map that breathes while two fingers pan, a zoom that teleports when the fingers nearly
 * touch, a camera that flings away as a pinch begins, and a palm that moves the midpoint.
 */

import { describe, expect, it } from 'vitest';
import { createRecognizer } from '../src/recognize.js';
import { DEFAULT_PROFILE } from '../src/profile.js';
import { down, harness, move, types, up, watch } from './harness.js';

describe('createRecognizer', () => {
  it('refuses a step that would make every duration meaningless', () => {
    const options = {
      profile: DEFAULT_PROFILE,
      emit: (): void => undefined,
      onKey: (): void => undefined,
    };
    expect(() => createRecognizer({ ...options, stepMs: 0 })).toThrow(
      /expected stepMs to be a finite number > 0/,
    );
    expect(() => createRecognizer({ ...options, stepMs: Number.NaN })).toThrow(RangeError);
  });
});

describe('presses', () => {
  it('ignores a move, an up and a cancel for a pointer that never went down', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(move(9, 100, 100), up(9, 100, 100), { kind: 'cancel', id: 9 });
    expect(seen).toEqual([]);
  });

  it('ignores a second down for a pointer already tracked', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300, 'touch'), down(1, 700, 300, 'touch'));
    h.step(up(1, 400, 300));
    // The second down must not move the press start, or a tap would become a drag of 300 px.
    expect(types(seen)).toEqual(['tap']);
  });

  it('does not tap after a cancel', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300, 'touch'));
    h.step({ kind: 'cancel', id: 1 });
    expect(seen).toEqual([]);
  });

  it('lets a drag begin after a long press has fired', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.step(down(1, 400, 300, 'touch'));
    h.idle(5);
    expect(types(seen)).toEqual(['longpress']);
    h.step(move(1, 460, 300));
    h.step(up(1, 460, 300));
    // Press, hold, then drag: the interaction a placement ghost is built out of.
    expect(types(seen)).toEqual(['longpress', 'dragstart', 'dragend']);
  });

  it('reports drag deltas against the previous event of the same gesture', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 400, 300), move(1, 420, 310), move(1, 430, 330));
    expect(seen.map((s) => [s.type, s.dx, s.dy])).toEqual([
      ['dragstart', 20, 10],
      ['drag', 10, 20],
    ]);
  });

  it('reports no velocity for a drag that lived inside one tick', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 400, 300), move(1, 500, 300), up(1, 500, 300));
    const end = seen.at(-1);
    // A fixed-step log has no finer time axis than a tick, and a made-up number would not
    // survive a replay.
    expect(end?.type).toBe('dragend');
    expect(end?.vx).toBe(0);
  });
});

describe('two fingers', () => {
  it('pans without zooming until the spread has changed enough', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 300, 300, 'touch'), down(2, 500, 300, 'touch'));
    // Both fingers move 20 px right: the spread is unchanged, so this is a pan and nothing else.
    // The two moves arrive as two samples and the spread between them is 20 px different from
    // the spread that ever existed — which is why the pinch is evaluated once per tick.
    h.step(move(1, 320, 300), move(2, 520, 300));
    const zooms = seen.filter((s) => s.type === 'zoom');
    expect(zooms).toHaveLength(1);
    expect(zooms[0]?.scale).toBe(1);
    expect(zooms[0]?.dx).toBe(20);
    // Without the start threshold every two-finger pan zooms slightly, which reads as the map
    // "breathing".
  });

  it('scales by the ratio of spreads once the pinch has started', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 300, 300, 'touch'), down(2, 500, 300, 'touch'));
    h.step(move(2, 560, 300));
    h.step(move(2, 620, 300));
    const zooms = seen.filter((s) => s.type === 'zoom');
    // The first qualifying move re-baselines, so the map does not jump by the jitter it took to
    // cross the threshold; the second is the real ratio, 320/260.
    expect(zooms[0]?.scale).toBe(1);
    expect(zooms[1]?.scale).toBe(320 / 260);
    expect(zooms[1]?.sx).toBe(460);
  });

  it('refuses to divide by a spread below the minimum', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 400, 300, 'touch'), down(2, 420, 300, 'touch'));
    h.step(move(2, 405, 300));
    h.step(move(2, 402, 300));
    const zooms = seen.filter((s) => s.type === 'zoom');
    // 20 px, then 5, then 2 — all under `pinchMinSpreadPx`. One noisy sample there would
    // teleport the zoom, so the scale stays exactly 1 and only the midpoint moves.
    expect(zooms.every((z) => z.scale === 1)).toBe(true);
    expect(zooms.length).toBeGreaterThan(0);
  });

  it('ends a live drag when the second finger lands, without flinging', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step(down(1, 300, 300, 'touch'));
    h.step(move(1, 360, 300));
    h.step(move(1, 420, 300));
    h.step(down(2, 600, 300, 'touch'));
    const end = seen.find((s) => s.type === 'dragend');
    // A camera that flings as the player starts a pinch runs away from the thing being framed.
    expect(end).toBeDefined();
    expect(end?.vx).toBe(0);
  });

  it('ignores a third pointer, and re-seeds the survivor when one lifts', () => {
    const h = harness({ hz: 10 });
    const seen = watch(h.input);
    h.step(down(1, 300, 300, 'touch'), down(2, 500, 300, 'touch'));
    h.step(down(3, 100, 100, 'touch'), move(3, 200, 100));
    // A third finger on a two-finger gesture is a palm: it produces nothing at all.
    expect(seen).toEqual([]);

    h.step(move(1, 320, 300), move(2, 520, 300));
    expect(types(seen)).toEqual(['zoom']);
    h.step(up(2, 520, 300));
    h.step(move(1, 400, 300));
    const start = seen.find((s) => s.type === 'dragstart');
    // 80 px from where the finger was when the pinch ended — not 100 px from where the press
    // began, which would jump the map by the width of the pinch on the first move after the
    // lift.
    expect(start?.dx).toBe(80);
    h.step(up(1, 400, 300));
    // And no tap: the press was part of a two-finger gesture.
    expect(types(seen)).toEqual(['zoom', 'dragstart', 'dragend']);
  });
});

describe('the wheel', () => {
  it('zooms exponentially, so up then down returns exactly where it started', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step({ kind: 'wheel', sx: 200, sy: 150, dz: -100, pinch: false });
    h.step({ kind: 'wheel', sx: 200, sy: 150, dz: 100, pinch: false });
    const [first, second] = seen;
    expect(first?.scale).toBe(Math.exp(100 * DEFAULT_PROFILE.wheelZoomRate));
    expect(second?.scale).toBe(Math.exp(-100 * DEFAULT_PROFILE.wheelZoomRate));
    // A notch and its opposite multiply to one, which is why the zoom is not additive.
    expect(Math.abs((first?.scale ?? 0) * (second?.scale ?? 0) - 1)).toBeLessThanOrEqual(1e-12);
    expect(first?.sx).toBe(200);
  });

  it('uses the pinch rate and reports the pinch source for a trackpad', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step({ kind: 'wheel', sx: 0, sy: 0, dz: -10, pinch: true });
    // Using the scroll rate for a trackpad pinch makes it feel dead: the deltas are far smaller.
    expect(seen[0]?.scale).toBe(Math.exp(10 * DEFAULT_PROFILE.wheelPinchRate));
    expect(seen[0]?.scale).toBeGreaterThan(Math.exp(10 * DEFAULT_PROFILE.wheelZoomRate));
  });
});

describe('the keyboard', () => {
  it('zooms about the viewport center, in both directions and on both keys', () => {
    const h = harness();
    const seen = watch(h.input);
    for (const code of ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract']) {
      h.step({ kind: 'key', code, down: true });
      h.step({ kind: 'key', code, down: false });
    }
    const zooms = seen.filter((s) => s.type === 'zoom');
    expect(zooms.map((z) => z.scale)).toEqual([
      DEFAULT_PROFILE.keyZoomStep,
      DEFAULT_PROFILE.keyZoomStep,
      1 / DEFAULT_PROFILE.keyZoomStep,
      1 / DEFAULT_PROFILE.keyZoomStep,
    ]);
    // The one anchor a positionless source can honestly claim.
    expect(zooms[0]?.sx).toBe(400);
    expect(zooms[0]?.sy).toBe(300);
  });

  it('fires one edge per physical press, whatever the repeat rate is', () => {
    const h = harness();
    const seen = watch(h.input);
    h.step({ kind: 'key', code: 'Equal', down: true });
    h.step({ kind: 'key', code: 'Equal', down: true });
    h.step({ kind: 'key', code: 'Equal', down: true });
    // An action whose count is set by the player's accessibility preferences is an action whose
    // count is not reproducible.
    expect(seen).toHaveLength(1);
  });

  it('ignores a release for a key it never saw pressed', () => {
    const h = harness();
    h.step({ kind: 'key', code: 'KeyQ', down: false });
    expect(h.input.keyHeld('KeyQ')).toBe(false);
  });
});

describe('the machine on its own', () => {
  /** A recognizer with no system around it, for the states a sample stream cannot reach. */
  function bare(maxPointers = 2) {
    const emitted: string[] = [];
    const machine = createRecognizer({
      profile: { ...DEFAULT_PROFILE, maxPointers },
      stepMs: 100,
      emit: (g): void => {
        emitted.push(g.type);
      },
      onKey: (): void => undefined,
    });
    return { machine, emitted };
  }

  it('ignores a tick slot, which is a log marker and never an arrival', () => {
    const { machine, emitted } = bare();
    machine.feed({ ...blank(), kind: 'tick', index: 3 }, 0);
    expect(emitted).toEqual([]);
  });

  it('reports whether a drag is live, so no path can leave one behind', () => {
    const { machine } = bare();
    expect(machine.dragging).toBe(false);
    machine.feed({ ...blank(), kind: 'down', id: 1, sx: 0, sy: 0 }, 0);
    machine.feed({ ...blank(), kind: 'move', id: 1, sx: 90, sy: 0 }, 1);
    expect(machine.dragging).toBe(true);
    expect(machine.pressed).toBe(false);
    machine.releaseAll();
    expect(machine.dragging).toBe(false);
  });

  it('keeps the gesture alive when a third of three fingers lifts', () => {
    const { machine, emitted } = bare(3);
    for (const id of [1, 2, 3]) {
      machine.feed({ ...blank(), kind: 'down', id, sx: id * 100, sy: 0 }, 0);
    }
    machine.feed({ ...blank(), kind: 'up', id: 3, sx: 300, sy: 0 }, 1);
    // Two fingers are still down: nothing is re-seeded, because the gesture has not ended.
    machine.feed({ ...blank(), kind: 'move', id: 1, sx: 160, sy: 0 }, 2);
    machine.mature(2);
    expect(emitted).toEqual(['zoom']);
  });
});

/** A zeroed slot, so each test names only the fields its kind carries. */
function blank() {
  return {
    kind: 'blur' as const,
    id: 0,
    sx: 0,
    sy: 0,
    pointerType: 'mouse' as const,
    dz: 0,
    pinch: false,
    code: '',
    down: false,
    index: 0,
  };
}
