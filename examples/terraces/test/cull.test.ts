/**
 * The cull that feeds the sort must not change the sort.
 *
 * `docs/SEAMS.md` pins one contract this exhibit is unusually close to: `iso` sorts, `draw` paints
 * that permutation forwards, and `iso.pickSorted` walks the *same instance* backwards. Both sides
 * are individually correct and jointly broken the moment one of them knows about a cull the other
 * does not, and the symptom — a tap that opens the thing behind the thing under your finger — is
 * exactly the class of bug this exhibit exists to make visible.
 *
 * `props.fillProps` culls before `DepthSorter.add` so there is only ever **one** list. That is the
 * structural half of the argument. This file is the other half: the sorted, culled order is
 * asserted **identical**, item for item, to the order produced by adding every prop on the map and
 * letting the sorter do all the work — including with the camera parked hard against the edge of
 * the world, which is where a superset that is not quite a superset would first show.
 */
import { expect, it } from 'vitest';
import { DepthSorter, createCamera, gridToWorldX, gridToWorldY, heightAt, tileBounds, type Camera, type Rect } from '@lattice/iso';
import { createBucket } from '../../_shared/src/index.js';
import { H, OPEN_AT, W, createHill, type Hill, type Prop } from '../src/hill.js';
import { fillProps } from '../src/props.js';

const hill = createHill('contour');

/**
 * The sorted frame as a list of tile addresses.
 *
 * `fill` is the camera `fillProps` culls against and `camera` is the one the sorter culls against.
 * Passing the same camera twice is the shipping path; passing {@link EVERYTHING} as `fill` is the
 * same frame with the pre-cull disabled, because a camera that can see the whole map keeps every
 * prop. Same fill function either way — a second, hand-written enumeration in the test would only
 * prove that the test and the exhibit agree with each other.
 */
function frame(camera: Camera, fill: Camera): string[] {
  const bucket = createBucket<Prop>(new DepthSorter(8192));
  fillProps(bucket, hill, 0, fill);
  bucket.order.sort(camera);
  const out: string[] = [];
  bucket.each((p) => out.push(`${String(p.gx)},${String(p.gy)}`));
  return out;
}

/** A camera whose viewport contains the entire world, so `fillProps` culls nothing against it. */
const EVERYTHING = createCamera(1 << 20, 1 << 20);

function look(gx: number, gy: number, zoom: number): Camera {
  const bounds: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  tileBounds(0, 0, W, H, hill.maxHeightPx, bounds);
  const camera = createCamera(1440, 900, { zoom, minZoom: 0.4, maxZoom: 3.2, keepVisible: 0.15, bounds });
  camera.centerOn(gridToWorldX(gx, gy), gridToWorldY(gx, gy) - heightAt(hill.field, gx, gy));
  return camera;
}

it.each([
  ['the opening frame', OPEN_AT, OPEN_AT, 0.95],
  ['zoomed out to the clamp', OPEN_AT, OPEN_AT, 0.4],
  ['the top corner of the map', 1, 1, 0.95],
  ['the bottom corner', W - 2, H - 2, 0.95],
  ['the west corner', 2, H - 2, 0.6],
  ['the east corner', W - 2, 2, 0.6],
])('paints the same order with the cull as without it: %s', (_what, gx, gy, zoom) => {
  const camera = look(gx, gy, zoom);
  const culled = frame(camera, camera);
  expect(culled).toEqual(frame(camera, EVERYTHING));
  // Two guards, against the two ways this could pass while proving nothing: both sides empty,
  // and a "cull" that keeps everything. A corner of the map legitimately shows few props, so the
  // floor is low; the ceiling is what says a cull happened at all.
  expect(culled.length).toBeGreaterThan(10);
  expect(culled.length).toBeLessThan(hill.props.length / 2);
});
