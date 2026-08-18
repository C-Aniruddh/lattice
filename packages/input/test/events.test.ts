/**
 * What a handler is handed, and the one place a pixel becomes a tile.
 *
 * The first test is a **contract with `@latticekit/iso`**: this package resolves through a frozen
 * copy of the camera's transform, but the flooring — the half that is genuinely easy to get
 * wrong, and the half that decides which diamond a pixel falls in — is `iso`'s `worldToTile`.
 * Asserting agreement with `iso.screenToTile` over a grid of points is what keeps the
 * composition honest: if `iso` ever changes what "which tile" means, this fails here rather
 * than in a game, six months later, as "the tap opens the building behind".
 */

import { describe, expect, it } from 'vitest';
import { createCamera, screenToTile } from '@latticekit/iso';
import type { GridPoint } from '@latticekit/iso';
import { TapGestureEvent, TickFrame } from '../src/events.js';
import { TilePicker } from '../src/terrain.js';
import { down, harness, move, up, watch } from './harness.js';

describe('TickFrame', () => {
  it('agrees with iso.screenToTile at every zoom and every pan', () => {
    const camera = createCamera(800, 600);
    const frame = new TickFrame();
    // Flat, declared: this test is about the frozen transform and the flooring, and the whole
    // point of the declaration is that the flat answer is only ever given to someone who asked
    // for it.
    const picker = new TilePicker(() => undefined);
    picker.set('flat');
    const mine = new TapGestureEvent(picker);
    const theirs: GridPoint = { gx: 0, gy: 0 };
    for (const [zoom, cx, cy] of [
      [1, 0, 0],
      [2, 137, -91],
      [0.5, -400, 250],
    ] as const) {
      camera.centerOn(cx, cy);
      camera.zoomAt(zoom / camera.zoom, 400, 300);
      camera.centerOn(cx, cy);
      frame.capture(camera);
      for (let sx = -80; sx <= 880; sx += 37) {
        for (let sy = -80; sy <= 680; sy += 41) {
          mine.place(frame, 7, sx, sy);
          screenToTile(camera, sx, sy, theirs);
          expect([mine.gx, mine.gy]).toEqual([theirs.gx, theirs.gy]);
          expect(mine.wx).toBe(camera.toWorldX(sx));
          expect(mine.wy).toBe(camera.toWorldY(sy));
          expect(mine.tick).toBe(7);
        }
      }
    }
  });

  it('reports the viewport it froze, for a source with no position', () => {
    const camera = createCamera(1024, 768);
    const frame = new TickFrame();
    frame.capture(camera);
    expect([frame.w, frame.h]).toEqual([1024, 768]);
  });
});

describe('the camera as it stood when the tick opened', () => {
  it('resolves every event in a tick against the same transform', () => {
    // The controller is off so that the only thing moving the camera is the handler below;
    // with it on, the drags would also pan and the second assertion would be about two things.
    const h = harness({ control: false });
    const seen = watch(h.input);
    // A handler that recenters the camera on what it was given — a perfectly ordinary thing to
    // do — must not change where the rest of this bucket resolved to.
    h.input.on('dragstart', () => {
      h.view.centerOn(5000, 5000);
    });
    h.step(down(1, 400, 300), move(1, 500, 300), move(1, 600, 300));
    const world = seen.map((s) => s.wx);
    expect(world).toEqual([100, 200]);
    // And the next tick sees the moved camera, because that is when it was frozen again.
    h.step(move(1, 600, 300));
    expect(seen.at(-1)?.wx).toBe(5200);
  });

  it('answers hoverTile from the live camera, not the frozen one', () => {
    const h = harness();
    const tile: GridPoint = { gx: 0, gy: 0 };
    expect(h.input.hoverTile(tile)).toBe(false);
    h.input.submit(down(1, 400, 300, 'mouse'));
    expect(h.input.hoverTile(tile)).toBe(true);
    const before = { ...tile };
    // No tick, no frame: a ghost following a finger has to be smooth at display rate even when
    // ticks are slow, so this is answered from the newest sample and the current camera.
    h.view.centerOn(1000, 1000);
    h.input.hoverTile(tile);
    expect(tile).not.toEqual(before);
  });
});

describe('the reused event objects', () => {
  it('carries the fields of its own kind and nothing else', () => {
    const h = harness({ hz: 10 });
    const kinds: string[] = [];
    h.input.on('tap', (g) => kinds.push(`tap heldMs=${String(g.heldMs)}`));
    h.input.on('zoom', (g) => kinds.push(`zoom source=${g.source} scale>${String(g.scale > 1)}`));
    h.input.on('dragend', (g) => kinds.push(`dragend v=${String(g.vx !== 0)}`));

    h.step(down(1, 400, 300, 'touch'));
    h.step(up(1, 400, 300));
    h.step({ kind: 'wheel', sx: 10, sy: 10, dz: -100, pinch: false });
    h.step(down(2, 100, 100), move(2, 200, 100));
    h.step(up(2, 300, 100));
    expect(kinds).toEqual([
      'tap heldMs=100',
      'zoom source=wheel scale>true',
      'dragend v=true',
    ]);
  });

  it('lets a handler claim a zoom, and the camera does not take it', () => {
    const h = harness();
    h.input.on('zoom', (g) => g.claim());
    h.step({ kind: 'wheel', sx: 400, sy: 300, dz: -100, pinch: false });
    expect(h.view.zoom).toBe(1);
  });

  it('exposes claimed as a readable flag, not only as a side effect', () => {
    const h = harness({ hz: 10 });
    const flags: boolean[] = [];
    h.input.on('tap', (g) => {
      flags.push(g.claimed);
      g.claim();
      flags.push(g.claimed);
    });
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    h.step(down(2, 400, 300, 'touch'), up(2, 400, 300));
    // Reset before every delivery: a stale `claimed` would silently swallow the next gesture.
    expect(flags).toEqual([false, true, false, true]);
  });
});
