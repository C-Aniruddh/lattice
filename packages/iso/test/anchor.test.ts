/**
 * `anchor` — the three things a world position has to become, and the one thing they must
 * agree about.
 *
 * A HUD tag drawn by `ui` and a canvas ring drawn by `draw` on the same building must not
 * disagree by a subpixel. They cannot, as long as both call this rather than each deriving its
 * own projection, and the first test here is that agreement stated as an assertion.
 */

import { describe, expect, it } from 'vitest';
import { v2 } from '@latticekit/core';
import { anchorPan, anchorToScreen, anchorVisible } from '../src/anchor.js';
import type { Anchor } from '../src/anchor.js';
import { createCamera, gridToScreen } from '../src/camera.js';
import { rectSet } from '../src/projection.js';
import type { Rect } from '../src/projection.js';
import { Path, pathSample } from '../src/path.js';

const rect = (): Rect => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
const huge = (): Rect => rectSet(rect(), -1e6, -1e6, 1e6, 1e6);
const anchor = (gx = 0, gy = 0, zPx = 0): Anchor => ({ gx, gy, zPx });

describe('anchorToScreen', () => {
  it('is exactly gridToScreen, so a DOM tag and a canvas ring cannot disagree', () => {
    const cam = createCamera(960, 540, { bounds: huge(), zoom: 2 });
    cam.centerOnTile(3, 3);
    const a = anchor(5.25, -2.5, 37);
    const viaAnchor = anchorToScreen(cam, a, v2());
    const viaGrid = gridToScreen(cam, a.gx, a.gy, a.zPx, v2());
    expect(viaAnchor).toEqual(viaGrid);
  });

  it('writes into the caller-owned vector and returns it', () => {
    const cam = createCamera(100, 100, { bounds: huge() });
    const out = v2(9, 9);
    expect(anchorToScreen(cam, anchor(0, 0, 0), out)).toBe(out);
    expect(out).toEqual({ x: 50, y: 50 });
  });

  it('takes zPx straight up the screen and nowhere else', () => {
    const cam = createCamera(200, 200, { bounds: huge(), zoom: 3 });
    cam.centerOn(0, 0);
    const flat = anchorToScreen(cam, anchor(2, 2, 0), v2());
    const hung = anchorToScreen(cam, anchor(2, 2, 10), v2());
    expect(hung.x).toBe(flat.x);
    expect(hung.y).toBe(flat.y - 30);
  });

  it('takes a walker position straight from pathSample with no conversion', () => {
    // The unification `ui` asked for, made literal: an Anchor *is* a GridPoint, so the sampler
    // writes into it directly and the caller only fills in zPx.
    const road = new Path(4);
    road.push(0, 0);
    road.push(10, 0);
    const walker = anchor();
    pathSample(road, road.arcLength / 2, walker);
    walker.zPx = 12;
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(anchorToScreen(cam, walker, v2())).toEqual(
      gridToScreen(cam, 5, 0, 12, v2()),
    );
  });
});

describe('anchorVisible', () => {
  it('is true inside the viewport and false outside it', () => {
    const cam = createCamera(200, 100, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(anchorVisible(cam, anchor(0, 0, 0))).toBe(true);
    // A tag for an off-screen building must be hidden, not positioned at -4000px: the browser
    // still lays out and composites the second one.
    expect(anchorVisible(cam, anchor(100, 100, 0))).toBe(false);
    expect(anchorVisible(cam, anchor(-100, -100, 0))).toBe(false);
  });

  it('is inclusive of the exact edge, and the margin pushes it out', () => {
    const cam = createCamera(200, 100, { bounds: huge() });
    cam.centerOn(0, 0);
    // The world x that lands exactly on the left edge.
    const edgeGrid = cam.toWorldX(0) / 32;
    expect(anchorVisible(cam, anchor(edgeGrid, 0, 0))).toBe(true);
    const justOut = anchor(edgeGrid - 0.1, 0, 0);
    expect(anchorVisible(cam, justOut)).toBe(false);
    expect(anchorVisible(cam, justOut, 100)).toBe(true);
  });

  it('accounts for the height, so the tag of a tall thing leaves the top of the screen first', () => {
    const cam = createCamera(200, 100, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(anchorVisible(cam, anchor(0, 0, 0))).toBe(true);
    expect(anchorVisible(cam, anchor(0, 0, 500))).toBe(false);
  });
});

describe('anchorPan', () => {
  it('is normalizedX of the anchor, ignoring its height', () => {
    const cam = createCamera(400, 400, { bounds: huge() });
    cam.centerOn(0, 0);
    expect(anchorPan(cam, anchor(0, 0, 0))).toBe(0);
    expect(anchorPan(cam, anchor(0, 0, 999))).toBe(0);
    // Raising a lamp does not move its sound sideways.
    expect(anchorPan(cam, anchor(1, 0, 0))).toBe(anchorPan(cam, anchor(1, 0, 400)));
  });

  it('is -1 at the left edge, +1 at the right, and unclamped past them', () => {
    const cam = createCamera(640, 480, { bounds: huge() });
    cam.centerOn(0, 0);
    // gridToWorldX(gx, 0) = gx * 32, so the left edge of a 640-wide viewport is gx = -10.
    expect(anchorPan(cam, anchor(-10, 0, 0))).toBe(-1);
    expect(anchorPan(cam, anchor(10, 0, 0))).toBe(1);
    // Unclamped, because how far a pan may travel is a mixing policy: `audio` caps at ±0.6 and
    // that decision belongs to whoever owns the mixer.
    expect(anchorPan(cam, anchor(30, 0, 0))).toBe(3);
  });

  it('moves with the camera, which is why nothing caches a screen position', () => {
    const cam = createCamera(640, 480, { bounds: huge() });
    const lamp = anchor(4, 4, 0);
    cam.centerOnTile(4, 4);
    expect(anchorPan(cam, lamp)).toBe(0);
    cam.panByScreen(320, 0);
    expect(anchorPan(cam, lamp)).toBe(1);
  });
});
