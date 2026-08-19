/**
 * Contract: what `draw` painted last at a pixel is what `iso` names when the player taps it.
 *
 * `iso.pickSorted` walks a `DepthSorter` **backwards**, on the promise that `draw` walked that
 * same instance forwards and that nothing between the two changed the sequence. Paint order and
 * pick order are the same permutation or the game is lying about what the player tapped.
 *
 * ## Why this cannot live in either package
 *
 * `packages/iso/test/depth.test.ts` proves `pickSorted` is the reverse of `indexAt`. That is a
 * statement about one object and it is true no matter what the renderer does with it — `iso`
 * never paints, so it cannot tell whether the frame on screen came out in that order.
 * `packages/draw/test/layers.test.ts` proves the seven passes run in order and that `renderFrame`
 * sorts before Solids. That is a statement about callbacks and it is true no matter what order
 * the surface actually received the shapes in — `draw` never picks, so it cannot tell whether a
 * tap would agree with what it emitted.
 *
 * Both are correct. Between them sits the only question that matters to a player, and it is
 * asked here: **take the sequence of shapes the surface actually recorded, and check that the
 * last one covering a point is the one `pickSorted` returns for that point.**
 *
 * ## The edit this catches
 *
 * `packages/draw/src/layers.ts` names it as the one that will actually happen: a pass that
 * **stably partitions** the sorted walk — every contact shadow first and every body second,
 * every building then every walker — because it looks better and because a stable partition
 * feels like it preserved the order. It did not. The same shape is reached by a batching backend
 * that groups `poly` calls by color before flushing, or by any helper `draw` might grow that
 * walks the order on the game's behalf in two phases instead of two forward passes.
 *
 * Every one of those leaves `iso`'s suite untouched (it never paints) and `draw`'s suite green
 * (every primitive still emits the right shape; only the *sequence between primitives* moved),
 * and ships a tap that opens the building behind the one under the finger: silent, intermittent,
 * and unreproducible from a screenshot.
 *
 * That is why the paint order below is recovered from `RecordingSurface.ops` — what the surface
 * was actually handed — and never from the walk that produced it. A test that bookkept its own
 * callback could not see a reorder that happens after the callback returns. The last suite here
 * makes the partition on purpose and watches the assertion catch it, so the detector is known to
 * have teeth rather than assumed to.
 *
 * See `docs/SEAMS.md` § *Contracts that no single package can test*.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '@latticekit/core';
import {
  DepthSorter,
  boxSilhouette,
  createCamera,
  pickSorted,
  pointInPolygon,
} from '@latticekit/iso';
import type { Camera, Volume } from '@latticekit/iso';
import {
  BASE_SLOTS,
  beginFrame,
  createPalette,
  createRecordingSurface,
  isoBox,
  levelsToPx,
  renderFrame,
  rgba,
} from '@latticekit/draw';
import type { Pen, RecordingSurface } from '@latticekit/draw';

/** Viewport, in CSS pixels. Small enough that a raster over every pixel is cheap. */
const WIDTH = 420;
/** See {@link WIDTH}. */
const HEIGHT = 320;

/** One building the frame draws and the player may tap. */
interface Item {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  /** Storeys. `draw` owns `LEVEL_H`, so the pick side converts with `levelsToPx`. */
  readonly h: number;
  /** Unique, and the only thing that identifies this item in the recorded op stream. */
  readonly topColor: number;
}

/** A color no two items share and no face shade collides with — every item's body is `brand`,
 *  so the face fills are all the same value and none of them is in this range. */
function markerFor(index: number): number {
  return rgba(index + 1, 0, 0, 255);
}

/** A cluster whose silhouettes overlap on screen: adjacent tiles, two to five storeys tall.
 *  Overlap is the whole point — a frame where nothing occludes anything cannot tell a correct
 *  pick from a wrong one. */
function cluster(): Item[] {
  const rng = createRng('paint-order-contract');
  const items: Item[] = [];
  for (let gx = 0; gx < 5; gx += 1) {
    for (let gy = 0; gy < 5; gy += 1) {
      items.push({
        gx,
        gy,
        w: rng.float(0.7, 1.6),
        d: rng.float(0.7, 1.6),
        h: rng.float(1, 5),
        topColor: markerFor(items.length),
      });
    }
  }
  return items;
}

/** A camera that holds the whole cluster, and a pen with the snap off: this suite is about
 *  sequence, and `silhouette.test.ts` is where the half-pixel offset is argued. */
function view(): { camera: Camera; surface: RecordingSurface; pen: Pen } {
  const camera = createCamera(WIDTH, HEIGHT, {
    zoom: 1,
    bounds: { minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 },
  });
  camera.centerOn(0, 160);
  const surface = createRecordingSurface(WIDTH, HEIGHT, 1);
  const pen = beginFrame({
    surface,
    camera,
    palette: createPalette(BASE_SLOTS),
    t: 0,
    snap: false,
  });
  surface.reset();
  return { camera, surface, pen };
}

/** Fill a sorter from the items, in item order, so the insertion index *is* the item index. */
function fill(items: readonly Item[]): DepthSorter {
  const order = new DepthSorter(items.length);
  for (const item of items) order.add(item.gx, item.gy, item.w, item.d, levelsToPx(item.h));
  return order;
}

/** The screen polygon `iso` would hit-test each item against, six points packed x,y. */
function silhouettes(items: readonly Item[], camera: Camera): Float64Array[] {
  return items.map((item) => {
    const volume: Volume = {
      ox: 0,
      oy: 0,
      w: item.w,
      d: item.d,
      zPx: 0,
      hPx: levelsToPx(item.h),
    };
    return boxSilhouette(camera, item.gx, item.gy, volume, new Float64Array(12));
  });
}

/**
 * The order the **surface** received the items in, as item indices.
 *
 * Read out of the recorded ops rather than out of the walk that made them, because a reorder
 * that happens between the callback and the backend is exactly the failure this file exists to
 * catch, and a test that trusted its own callback would be blind to it.
 */
function paintedOrder(surface: RecordingSurface, items: readonly Item[]): number[] {
  const byColor = new Map<number, number>();
  items.forEach((item, index) => byColor.set(item.topColor, index));
  const painted: number[] = [];
  for (const op of surface.ops) {
    if (op.op !== 'poly') continue;
    const index = byColor.get(op.colors[0] ?? -1);
    if (index !== undefined) painted.push(index);
  }
  return painted;
}

/** Every screen point on a coarse raster, so "the same answer everywhere" is checked rather
 *  than sampled at the four places a test author happened to think of. */
function* raster(step = 4): Generator<readonly [number, number]> {
  for (let sy = 0; sy < HEIGHT; sy += step) {
    for (let sx = 0; sx < WIDTH; sx += step) yield [sx, sy];
  }
}

describe('a tap names the building the player can see', () => {
  it('opens the last thing painted over that pixel, never the one behind it', () => {
    const items = cluster();
    const { camera, surface, pen } = view();
    const order = fill(items);

    renderFrame(
      pen,
      {
        solids: (p, sorted): void => {
          // The compliant walk, and the only compliant walk: forwards, once, from the sorter
          // `renderFrame` just sorted.
          for (let i = 0; i < sorted.count; i += 1) {
            const index = sorted.indexAt(i);
            const item = items[index] as Item;
            isoBox(p, item.gx, item.gy, item.w, item.d, {
              color: 'brand',
              topColor: item.topColor,
              h: item.h,
            });
          }
        },
      },
      order,
    );

    const painted = paintedOrder(surface, items);
    expect(painted).toHaveLength(order.count);

    const polys = silhouettes(items, camera);
    let overlaps = 0;
    let hits = 0;
    for (const [sx, sy] of raster()) {
      const covers = (index: number): boolean =>
        pointInPolygon(sx, sy, polys[index] as Float64Array, 6);

      // What the screen shows: the last shape the surface was handed that covers this pixel.
      let onTop = -1;
      let count = 0;
      for (const index of painted) {
        if (!covers(index)) continue;
        onTop = index;
        count += 1;
      }
      if (count > 1) overlaps += 1;
      if (onTop !== -1) hits += 1;

      expect(pickSorted(order, covers)).toBe(onTop);
    }

    // Guards against a frame that proves nothing: with no occlusion every order is the right
    // order, and with nothing on screen every order is vacuously right.
    expect(hits).toBeGreaterThan(1000);
    expect(overlaps).toBeGreaterThan(200);
  });

  it('agrees about empty ground, rather than answering with the nearest building', () => {
    const items = cluster();
    const { camera, surface, pen } = view();
    const order = fill(items);
    renderFrame(
      pen,
      {
        solids: (p, sorted): void => {
          for (let i = 0; i < sorted.count; i += 1) {
            const item = items[sorted.indexAt(i)] as Item;
            isoBox(p, item.gx, item.gy, item.w, item.d, {
              color: 'brand',
              topColor: item.topColor,
              h: item.h,
            });
          }
        },
      },
      order,
    );
    expect(paintedOrder(surface, items)).toHaveLength(order.count);

    const polys = silhouettes(items, camera);
    const nowhere = polys.every((poly) => !pointInPolygon(2, HEIGHT - 2, poly, 6));
    expect(nowhere).toBe(true);
    expect(
      pickSorted(order, (index) => pointInPolygon(2, HEIGHT - 2, polys[index] as Float64Array, 6)),
    ).toBe(-1);
  });

  it('paints only what survived the cull, and picks from the same survivors', () => {
    // A frame where the camera can see part of the world. Paint and pick must agree about the
    // *set* as well as the sequence: an item `draw` never emitted must never be what a tap
    // names, or a player taps empty ground and a building off the left edge opens.
    const items = cluster();
    const { camera, surface, pen } = view();
    camera.centerOn(-2000, 160);
    const order = fill(items);
    renderFrame(
      pen,
      {
        solids: (p, sorted): void => {
          for (let i = 0; i < sorted.count; i += 1) {
            const item = items[sorted.indexAt(i)] as Item;
            isoBox(p, item.gx, item.gy, item.w, item.d, {
              color: 'brand',
              topColor: item.topColor,
              h: item.h,
            });
          }
        },
      },
      order,
    );

    expect(order.count).toBe(0);
    expect(paintedOrder(surface, items)).toEqual([]);
    expect(pickSorted(order, () => true)).toBe(-1);
  });
});

describe('the detector has teeth', () => {
  // The edit `packages/draw/src/layers.ts` names as the one that will actually happen, made on
  // purpose: two forward walks, each internally in sorted order, partitioned by kind — short
  // things first so the tall ones read as standing over them. It is a *stable* partition of the
  // correct order, every item is still drawn exactly once and drawn correctly, and every
  // assertion inside either package still passes. This test exists so that the suite above is
  // known to fail when it happens, rather than assumed to.
  it('sees a stable partition of the sorted walk, which looks like it preserved the order', () => {
    const items = cluster();
    const { camera, surface, pen } = view();
    const order = fill(items);
    const isShort = (index: number): boolean => (items[index] as Item).h < 3;

    renderFrame(
      pen,
      {
        solids: (p, sorted): void => {
          const paint = (index: number): void => {
            const item = items[index] as Item;
            isoBox(p, item.gx, item.gy, item.w, item.d, {
              color: 'brand',
              topColor: item.topColor,
              h: item.h,
            });
          };
          for (let i = 0; i < sorted.count; i += 1) {
            const index = sorted.indexAt(i);
            if (isShort(index)) paint(index);
          }
          for (let i = 0; i < sorted.count; i += 1) {
            const index = sorted.indexAt(i);
            if (!isShort(index)) paint(index);
          }
        },
      },
      order,
    );

    const painted = paintedOrder(surface, items);
    expect(painted).toHaveLength(order.count);
    // Every item is still there, exactly once. This is what makes the bug survive review.
    expect([...painted].sort((a, b) => a - b)).toEqual(items.map((_, i) => i));

    const polys = silhouettes(items, camera);
    let disagreements = 0;
    for (const [sx, sy] of raster()) {
      const covers = (index: number): boolean =>
        pointInPolygon(sx, sy, polys[index] as Float64Array, 6);
      let onTop = -1;
      for (const index of painted) if (covers(index)) onTop = index;
      if (pickSorted(order, covers) !== onTop) disagreements += 1;
    }
    expect(disagreements).toBeGreaterThan(0);
  });
});
