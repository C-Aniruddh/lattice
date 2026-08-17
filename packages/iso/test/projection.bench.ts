/**
 * The projection, and the allocation number the whole kit's rule 7 rests on.
 *
 * A frame projects the corners of everything it draws. At 400 sprites with eight corners each
 * that is 3,200 calls, and the two things being measured here are whether that costs anything
 * (it should not — the scalar forms are two multiplies and an add) and whether it *allocates*
 * (it must not, at all).
 *
 * **On the allocation measurement.** A heap-size delta cannot detect this: the objects a
 * leaking implementation would create are dead the instant they are made, so a scavenge
 * collects them and the heap ends where it started. What a scavenge cannot hide is that it
 * happened. So the instrument is a GC *count* from `PerformanceObserver`, and the reading to
 * look for is zero: a loop that allocates nothing cannot trigger a collection, because
 * collection in V8 is triggered by allocation.
 */

import { bench, describe } from 'vitest';
import { v2 } from '@latticekit/core';
import { createCamera, gridToScreen } from '../src/camera.js';
import {
  gridToWorld,
  gridToWorldX,
  gridToWorldY,
  rectSet,
  worldToGrid,
  worldToTile,
} from '../src/projection.js';
import type { GridPoint, Rect, TileRange } from '../src/projection.js';
import { boxSilhouette, screenToTile } from '../src/hittest.js';
import type { Volume } from '../src/hittest.js';

const camera = createCamera(1920, 1080, {
  bounds: rectSet({ minX: 0, minY: 0, maxX: 0, maxY: 0 } as Rect, -1e6, -1e6, 1e6, 1e6),
});
camera.centerOnTile(24, 24);

const point = v2();
const grid: GridPoint = { gx: 0, gy: 0 };
const range: TileRange = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const silhouette = new Float64Array(12);
const volume: Volume = { ox: 0, oy: 0, w: 2, d: 2, zPx: 0, hPx: 52 };
/** The pen `@latticekit/draw` writes polygon corners into. The scalar forms exist for this. */
const pen = new Float64Array(8);

describe('the scalar forms', () => {
  bench('3,200 toScreenX/toScreenY pairs — 400 sprites, eight corners each', () => {
    for (let i = 0; i < 3200; i++) {
      pen[i & 7] = camera.toScreenX(i * 0.5);
      pen[(i + 1) & 7] = camera.toScreenY(i * 0.25);
    }
  });

  bench('3,200 gridToWorldX/Y pairs', () => {
    for (let i = 0; i < 3200; i++) {
      pen[i & 7] = gridToWorldX(i * 0.01, i * 0.02);
      pen[(i + 1) & 7] = gridToWorldY(i * 0.01, i * 0.02);
    }
  });
});

describe('the out-parameter forms', () => {
  bench('3,200 gridToScreen', () => {
    for (let i = 0; i < 3200; i++) gridToScreen(camera, i * 0.01, i * 0.02, 24, point);
  });

  bench('3,200 gridToWorld', () => {
    for (let i = 0; i < 3200; i++) gridToWorld(i * 0.01, i * 0.02, point);
  });

  bench('3,200 worldToGrid', () => {
    for (let i = 0; i < 3200; i++) worldToGrid(i * 0.5, i * 0.25, grid);
  });

  bench('3,200 worldToTile — the floor is two extra operations', () => {
    for (let i = 0; i < 3200; i++) worldToTile(i * 0.5, i * 0.25, grid);
  });

  bench('3,200 screenToTile — the pointer path in @latticekit/input', () => {
    for (let i = 0; i < 3200; i++) screenToTile(camera, i * 0.6, i * 0.3, grid);
  });
});

describe('the buffer form', () => {
  bench('400 box silhouettes — six points each, four x projections', () => {
    for (let i = 0; i < 400; i++) boxSilhouette(camera, i % 48, (i * 7) % 48, volume, silhouette);
  });
});

describe('the camera itself', () => {
  bench('400 visibility rejects', () => {
    for (let i = 0; i < 400; i++) camera.isVisible(i * 3, i * 2, i * 3 + 64, i * 2 + 96);
  });

  bench('visibleTileBounds, once a frame', () => {
    camera.visibleTileBounds(range, 4);
  });

  bench('visibleWorldBounds, once a frame', () => {
    camera.visibleWorldBounds(worldRect, 64);
  });

  bench('one pointer-anchored zoom', () => {
    camera.zoomAt(1.0001, 960, 540);
  });
});
