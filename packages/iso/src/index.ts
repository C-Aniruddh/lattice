/**
 * `@lattice/iso` — the three coordinate spaces of a 2:1 tile game, and every operation that is
 * only correct because it knows which one it is in.
 *
 * Grid, world and screen: projection, elevation, camera, depth order, footprints, picking, and
 * paths that can be *sampled* as well as followed. If a bug can be described as "the wrong
 * tile", "drawn through a wall", "the tap opened the building behind", "the walkers hitch on
 * the diagonals" or "I lost my island off the edge of the screen", it is this package's fault
 * and nobody else's.
 *
 * ## The frame, in six lines
 *
 * ```ts
 * const camera = createCamera(960, 540, { bounds: tileBounds(0, 0, 48, 48, 0, worldRect) });
 * const order = new DepthSorter(512);                    // allocated once, reused for ever
 * order.clear();
 * for (const b of buildings) order.add(b.gx, b.gy, b.w, b.d, b.heightPx);
 * order.sort(camera);                                    // culls, then orders back-to-front
 * for (let i = 0; i < order.count; i++) paint(buildings[order.indexAt(i)]);
 * ```
 *
 * And the line on tap, which has to be the exact reverse of the fifth:
 *
 * ```ts
 * const hit = pickSorted(order, (i) => silhouetteHit(buildings[i], pointerX, pointerY));
 * ```
 *
 * ## The allocation contract, which is not negotiable
 *
 * **No function here returns a point, a rectangle or any other object the caller did not hand
 * in.** There are exactly three shapes:
 *
 * | shape | example | for |
 * |---|---|---|
 * | **scalar** | `camera.toScreenX(wx)` | the innermost loop; returns a number, so it cannot allocate and the engine inlines it |
 * | **out-parameter** | `gridToScreen(cam, gx, gy, zPx, out)` | anywhere a point is genuinely wanted as a point |
 * | **buffer** | `boxSilhouette(cam, gx, gy, vol, out)` | geometry with more than one point |
 *
 * The only functions that produce an object are the constructors and `createCamera`, which run
 * at setup. Everything else writes into what it was given. `@lattice/draw` cannot meet the
 * constitution's rule 7 otherwise, and the rule is checkable by reading the emitted `.d.ts`:
 * no return type is a bare interface the caller did not pass in.
 *
 * Note that `toScreenX` takes only `wx` and `toScreenY` only `wy`. Screen x depends on world x
 * alone, so the eight corners of a box need four x projections, not eight.
 *
 * ## Determinism
 *
 * **No function in this package calls a trigonometric, exponential or logarithmic function.**
 * The geometry here is linear and it costs nothing: the facing is one of eight direction
 * codes, the A\* heuristic is the integer octile metric, an isometric "rotation" does not
 * exist, and the only `Math.sqrt` is arc length — which ECMA-262 specifies exactly. `iso`
 * contains no randomness of any kind and holds no `Rng`; everything that varies comes in
 * through a `TileSource` the caller filled.
 *
 * ## What is deliberately not here
 *
 * A runtime tile size (any uniform size is exactly a camera zoom). A third grid axis — but
 * elevation itself *is* here, as a layer. Anything that draws, including `LEVEL_H`, which is
 * an art proportion and `@lattice/draw`'s. Camera feel: inertia, pinch, edge-scroll and smooth
 * follow need a clock and a pointer, and both live in `@lattice/input`. Steering, avoidance
 * and anything that owns a walker. Entities, components and any scene graph. Serialization.
 * Fog of war and line of sight. An incremental replanner — recompute is a few tens of
 * microseconds against an 8 ms budget, and `MutableTileSource.version` makes it happen exactly
 * once. And a priority queue as an export: `iso` builds one, and does not publish it.
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';

// ── projection: grid ↔ world, the rectangle, the depth key ──────────────────────
//
// `Rect` lives here because `iso` is the lowest common ancestor of everyone who needs one —
// `draw` culls with it, `input` tests hit regions with it, `ui` lays panels out with it. `core`
// declined it, correctly: a layer-0 package that accretes convenience types makes every
// consumer pay for the spatial half of the kit.

export {
  TILE_W,
  TILE_H,
  HALF_W,
  HALF_H,
  gridToWorldX,
  gridToWorldY,
  gridToWorld,
  worldToGridX,
  worldToGridY,
  worldToGrid,
  worldToTile,
  depthOf,
  tileDiamond,
  footprintBounds,
  tileBounds,
  rectSet,
  rectFromSize,
  rectWidth,
  rectHeight,
  rectCenterX,
  rectCenterY,
  rectContains,
  rectIntersects,
  rectExpand,
  rectUnion,
  rectMakeEmpty,
  rectIsEmpty,
} from './projection.js';
export type { GridPoint, Tile, Rect, TileRange } from './projection.js';

// ── camera: world ↔ screen ───────────────────────────────────────────────────────
//
// An interface over private state and a factory, not a class with public fields: `zoomAt`
// exists to keep the world point under the pointer pinned, and if any path can assign `zoom`
// it skips the anchoring — a rule no test can catch being broken.

export { createCamera, gridToScreen } from './camera.js';
export type { Camera, CameraOptions } from './camera.js';

// ── depth: an order over footprints ──────────────────────────────────────────────
//
// `pickSorted` walks the same sorter instance that painted, backwards. That is a contract with
// `@lattice/draw`, which must not reorder after `sort()`, and it is why picking is structural
// rather than a comment someone has to remember.

export { DepthSorter, pickSorted } from './depth.js';

// ── tilemap and height ───────────────────────────────────────────────────────────

export { TileGrid, ChunkGrid, tileSourceOf } from './tilemap.js';
export type {
  TileSource,
  MutableTileSource,
  TileGridOptions,
  ChunkGridOptions,
} from './tilemap.js';

export { heightAt, slopeAt } from './height.js';
export type { HeightField } from './height.js';

// ── footprints and anchors ───────────────────────────────────────────────────────
//
// Both produce the same currency as `pathSample` does: a grid position. That is what makes the
// unification with path sampling literal — `pathSample(road, s, anchor)` fills a walker's
// anchor directly — rather than two APIs that merely rhyme.

export {
  footprintContains,
  footprintOverlaps,
  forEachFootprintTile,
  footprintFlatness,
  footprintBase,
  footprintAnchor,
} from './footprint.js';
export type { Footprint } from './footprint.js';

export { anchorToScreen, anchorVisible, anchorPan } from './anchor.js';
export type { Anchor } from './anchor.js';

// ── hit testing ──────────────────────────────────────────────────────────────────
//
// The six-point order `boxSilhouette` writes is a cross-package contract: `draw`'s solid kit
// must stroke a box in the same order, or hit-testing and pixels diverge with no test in
// either package noticing.

export {
  screenToTile,
  screenToTileOnHeights,
  boxSilhouette,
  pointInPolygon,
  pointInTile,
} from './hittest.js';
export type { Volume } from './hittest.js';

// ── paths ────────────────────────────────────────────────────────────────────────
//
// A path is a curve to be sampled by arc length in world pixels, not a list of nodes to be
// stepped through. Grid-unit parameterisation makes a walker 58% faster on one diagonal than
// on the axis beside it, which looks exactly like a frame-rate problem and is not one.

export {
  STEP_ORTHO,
  STEP_DIAG,
  DIR_DX,
  DIR_DY,
  Path,
  pathSample,
  pathDirAt,
  pathProject,
  pathSimplify,
  PathFinder,
  FlowField,
} from './path.js';
export type { TileCost, PathOptions } from './path.js';

// The binary heap in `heap.ts` is deliberately absent. `core` refused to own a priority queue
// on the grounds that there was exactly one confirmed consumer, and one consumer owns its own
// container; publishing it from here would promise a general-purpose container from a package
// about isometric space, and admitting one admits `Deque` and `RingBuffer` on identical
// reasoning. The day a second package needs one it moves to `core` rather than being written
// twice — which is cheap, because the Lattice ordering rule it is built to is already fixed.
