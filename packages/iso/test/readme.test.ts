/**
 * The README's example, run.
 *
 * `README.md` opens with this program and prints these numbers, and the two are kept honest by
 * this file rather than by anyone remembering. A README example that has drifted is worse than
 * none: it is the first thing a new caller copies, and the failure it produces is in *their*
 * code, where they will look for it.
 *
 * The assertions are the printed lines, in order, because the printed lines are the part the
 * README promises.
 */

import { describe, expect, it } from 'vitest';
import { v2 } from '@lattice/core';
import {
  DepthSorter,
  FlowField,
  Path,
  PathFinder,
  TileGrid,
  anchorToScreen,
  createCamera,
  footprintAnchor,
  heightAt,
  pathSample,
  pathSimplify,
  pickSorted,
  screenToTile,
  tileBounds,
} from '../src/index.js';
import type { Anchor, GridPoint, Rect, Tile } from '../src/index.js';

describe('the README example', () => {
  it('prints what the README says it prints', () => {
    const out: string[] = [];

    // ── the valley ────────────────────────────────────────────────────────────
    const ground = new TileGrid(48, 48, { fill: 1 }); //         1 = ordinary ground
    const heights = new TileGrid(49, 49); //          one value per grid *vertex*
    heights.fillFrom((gx, gy) => (gx > 20 && gx < 28 && gy > 8 ? 3 : 0)); //  a ridge
    const valley = { heights, stepPx: 8 }; //          world pixels per height unit
    for (let gy = 10; gy < 40; gy++) ground.set(24, gy, 0); //       a rockfall

    // ── the camera ────────────────────────────────────────────────────────────
    const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const camera = createCamera(960, 540, {
      bounds: tileBounds(0, 0, 48, 48, 0, worldRect),
      minZoom: 0.25, //          a finite island should always pass its own limits
    });
    // frame the island on the first frame, whatever the viewport, with a 24 px gutter.
    // 96 is the tallest thing on the map: content height reaches a framing decision
    // through the rectangle and nowhere else, and a 0 there frames it as though it were flat.
    camera.fitBounds(tileBounds(0, 0, 48, 48, 96, worldRect), 24);
    // An accessibility setting widens the zoom-out limit later in the session. The limits read
    // back off the camera, so nothing else has to remember them, and the setter re-clamps in
    // the same statement — no rebuilt camera, and nothing bound to one is invalidated.
    camera.setZoomLimits(camera.minZoom / 2, camera.maxZoom);
    out.push(
      `zoom ${camera.zoom.toFixed(2)}, limits now ${String(camera.minZoom)} to ${String(camera.maxZoom)}`,
    );

    // ── one frame ─────────────────────────────────────────────────────────────
    const buildings = [
      { gx: 4, gy: 4, w: 3, d: 2, heightPx: 64 },
      { gx: 10, gy: 6, w: 2, d: 2, heightPx: 40 },
      { gx: 6, gy: 12, w: 1, d: 1, heightPx: 96 },
    ] as const;
    const order = new DepthSorter(512); //      allocated once, reused for ever
    order.clear();
    for (const b of buildings) order.add(b.gx, b.gy, b.w, b.d, b.heightPx);
    order.sort(camera); //                      culls, then orders back-to-front
    const painted: number[] = [];
    for (let i = 0; i < order.count; i++) painted.push(order.indexAt(i));
    out.push(`paint order: ${painted.join(', ')}`);

    // …and on tap, the exact reverse of that same walk.
    out.push(`tapped building ${String(pickSorted(order, (i) => i === 1))}`);

    const tile: Tile = { gx: 0, gy: 0 };
    screenToTile(camera, 480, 270, tile);
    out.push(`tile under the middle of the screen: ${String(tile.gx)}, ${String(tile.gy)}`);

    // ── a road, and fifty walkers with no state between them ──────────────────
    const cost = (gx: number, gy: number): number => ground.get(gx, gy);
    const finder = new PathFinder(4096);
    const road = new Path(128);
    finder.find(cost, 2, 2, 44, 44, road, undefined);
    out.push(`road: ${String(road.nodeCount)} nodes, ${road.arcLength.toFixed(1)} world px`);
    pathSimplify(road, cost);
    out.push(`simplified: ${String(road.nodeCount)} nodes, ${road.arcLength.toFixed(1)} world px`);

    const here: GridPoint = { gx: 0, gy: 0 };
    let sum = 0;
    for (let i = 0; i < 50; i++) {
      pathSample(road, (12 * 40 + (i / 50) * road.arcLength) % road.arcLength, here);
      sum += heightAt(valley, here.gx, here.gy);
    }
    out.push(`50 walkers, mean ground height ${(sum / 50).toFixed(2)} px`);

    // ── the rockfall beat, in three lines ─────────────────────────────────────
    const field = new FlowField(0, 0, 48, 48);
    field.addGoal(44, 44);
    field.build(cost, undefined, ground.version);
    out.push(`blocked:  cost from (2,2) is ${String(field.costAt(2, 2))}`);
    ground.set(24, 24, 1); //                              one write, version bumps
    if (field.builtAtVersion !== ground.version) field.build(cost, undefined, ground.version);
    out.push(`cleared:  cost from (2,2) is ${String(field.costAt(2, 2))}`);

    // ── an anchor, for a label that has to survive a pan ──────────────────────
    const hq = buildings[0];
    const label: Anchor = { gx: 0, gy: 0, zPx: 0 };
    footprintAnchor(hq, hq.heightPx, label);
    const screen = anchorToScreen(camera, label, v2());
    out.push(`label at ${screen.x.toFixed(0)}, ${screen.y.toFixed(0)} CSS px`);

    expect(out).toEqual([
      'zoom 0.30, limits now 0.125 to 4',
      'paint order: 0, 1, 2',
      'tapped building 1',
      'tile under the middle of the screen: 22, 22',
      'road: 59 nodes, 1976.9 world px',
      'simplified: 3 nodes, 1706.1 world px',
      '50 walkers, mean ground height 2.55 px',
      'blocked:  cost from (2,2) is 684',
      'cleared:  cost from (2,2) is 600',
      'label at 485, 87 CSS px',
    ]);
  });
});
