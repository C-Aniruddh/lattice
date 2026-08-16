/**
 * The seven passes, and the runner that makes their order unforgeable. **Not the sort.**
 *
 * **No DOM, no canvas — this module runs unchanged in Node.**
 *
 * ## The boundary, settled
 *
 * `iso` owns the occlusion relation, the topological sort and the backwards walk —
 * `DepthSorter` and `pickSorted`. `draw` owns which pass the order is walked in, and nothing
 * else about ordering. **There is one sorted list in the kit.**
 *
 * Count how many of the seven passes are depth-sorted. Backdrop is one quad. Terrain iterates a
 * `TileRange` in grid order, which is already back-to-front. Placement is a handful of items.
 * Light is a composite. Overlay and Effects are screen space and deliberately unsorted. *Exactly
 * one pass sorts* — and a scalar depth key cannot express *beside*, so that sort is a
 * topological one and it lives in `iso`.
 *
 * **Nor does `draw` supply an item bucket.** `DepthSorter` deliberately cannot name a drawable,
 * and the reflex is for this package to provide the half it appears to be missing. It should
 * not: the game already has its buildings in an array, the permutation indexes *that*, and a
 * bucket here would be a second copy of the caller's world kept in step by hand. The whole
 * Solids pass is four lines the game writes itself.
 *
 * ## The contract that used to be a constructor, and what `draw` must not do
 *
 * An earlier `iso` draft had a `Scene` that held ids, sorted them and picked among them.
 * Splitting it into `DepthSorter` + `pickSorted` was right, and it moved a guarantee out of the
 * type system and into prose: **`draw` paints `indexAt(0…count)` forward, `pickSorted` walks
 * that same instance backward, and nothing between the two may change the order.**
 *
 * Concretely, after `sort()` this package must:
 *
 * - **not re-sort**, by anything, for any reason;
 * - **not partition.** This is the one that will actually happen. Drawing every contact shadow
 *   first and every body second looks better and is a *stable* partition of the sorted order —
 *   and it is a reorder. If you want shadows first, walk `indexAt` forward **twice**, shadows on
 *   the first walk and bodies on the second. Two forward walks preserve the order; one
 *   partitioned walk destroys it while looking like it preserved it;
 * - **not skip and re-add.** Culling already happened inside `sort`;
 * - **not paint from a second collection** that happens to hold the same items in a different
 *   arrangement.
 *
 * Break it and `iso` hit-tests one arrangement while `draw` painted another; both packages are
 * internally correct, both suites stay green, and a player taps a rack and opens the
 * headquarters behind it. {@link renderFrame} is shaped to make the compliant path the easy one:
 * it calls `sort` itself, immediately before the Solids callback, so there is no window in which
 * a caller holds a sorted order and is tempted to improve it.
 */

import { TILE_H } from '@lattice/iso';
import type { Camera, DepthSorter, Rect, TileRange } from '@lattice/iso';
import type { Pen } from './surface.js';

/**
 * The pass ordinals. **The order is the product**, and it is closed at seven.
 *
 * There is no way to add an eighth and no way to get a second Solids pass — a second Solids pass
 * is how the tree-through-wall bug comes back, and an eighth is how somebody puts the HUD under
 * the darkness. The seventh was found by the demo's own RFC before a line of this was written;
 * the next one, if there is one, gets found the same way.
 */
export const Layer = {
  /** A vertical ramp. Never a flat color: flat backgrounds make an island look like a sticker. */
  Backdrop: 0,
  /** Culled tile diamonds, color varied per tile from a stateless hash. */
  Terrain: 1,
  /** Buildings *and* scenery, one list, one sort. Two sorted lists is what makes trees pop
   *  through walls. */
  Solids: 2,
  /** Ghost and selection: above the world, below the UI. */
  Placement: 3,
  /** The night mask goes down and the bloom goes up, in one composite. */
  Light: 4,
  /** Bubbles and timers, in screen space, unsorted, always on top. */
  Overlay: 5,
  /** Floating numbers and bursts. */
  Effects: 6,
} as const;

/** The pass ordinal type, so a profiler can key an array by it. */
export type Layer = (typeof Layer)[keyof typeof Layer];

/** Pass names in order. For a profiler's labels, a debug overlay, and error messages. */
export const PASS_NAMES: readonly [
  'backdrop',
  'terrain',
  'solids',
  'placement',
  'light',
  'overlay',
  'effects',
] = ['backdrop', 'terrain', 'solids', 'placement', 'light', 'overlay', 'effects'];

/**
 * The game's painting, one callback per pass.
 *
 * **Hoist these to module scope and reuse the object** — they are allocated once at setup, never
 * per frame. Every pass is optional: a game with no night supplies no light field anywhere and
 * pays for nothing; a game with no placement mode omits `placement`.
 */
export interface Passes {
  /** `visible` is `camera.visibleWorldBounds()` — a gradient needs the world box, not tiles. */
  readonly backdrop?: ((pen: Pen, visible: Readonly<Rect>) => void) | undefined;
  /** `visible` is `camera.visibleTileBounds()`, already computed and margined by
   *  {@link Passes.maxHeightPx}. */
  readonly terrain?: ((pen: Pen, visible: Readonly<TileRange>) => void) | undefined;
  /**
   * The tallest ground on the map, in **world pixels** — the margin the Terrain cull needs.
   *
   * `renderFrame` computes the visible tile range for you, and it computes it **on the ground
   * plane**, because a camera has no idea what a heightfield is. A tile whose corner stands
   * `zPx` above sea level is painted `zPx` further up the screen, so it is on screen while the
   * flat tile at its address is already off the bottom — and the range, honestly answering the
   * question it was asked, leaves it out. The symptom is a summit that vanishes the moment its
   * base leaves the bottom edge, with nothing missing anywhere else in the frame.
   *
   * Taking the cull away from a game and then not exposing its one parameter is the failure this
   * field exists to close: **the one place this package takes ownership from the game is the one
   * place the game had the number.** A game reads it off its own generator —
   * `maxUnits * field.stepPx` — and states it once here, on the `Passes` object it hoists at
   * setup.
   *
   * *The conversion, so an over- or under-margin can be reasoned about rather than tuned:* screen
   * `y` advances by `HALF_H` per unit of `gx + gy`, so a `zPx` lift is worth `zPx / HALF_H` of
   * `gx + gy`. Growing a **box** range by one tile on each of its two axes grows `gx + gy` by
   * two, so the margin is `zPx / (2 · HALF_H)` — that is, `zPx / TILE_H`, rounded up. Which is
   * exactly what `Camera.visibleTileBounds` documents its `marginTiles` to be.
   *
   * Omit it on flat ground and nothing is margined and nothing is wasted. Costs one extra ring
   * of tiles per unit of height, in a loop that is already generous by roughly 2× — see
   * `Camera.visibleTileBounds`.
   */
  readonly maxHeightPx?: number | undefined;
  /**
   * `order` is sorted and culled before this is called. **Walk it forwards:**
   * `for (i = 0; i < order.count; i++) paint(myItems[order.indexAt(i)])`.
   *
   * Do not sort it, partition it, or paint from anything else — see this module's header. If you
   * need two sweeps, take two forward walks.
   */
  readonly solids?: ((pen: Pen, order: DepthSorter) => void) | undefined;
  /** The placement ghost and the selection rim. */
  readonly placement?: ((pen: Pen) => void) | undefined;
  /** Screen-space HUD, drawn *after* the light composite so it reads at midnight. */
  readonly overlay?: ((pen: Pen) => void) | undefined;
  /** Floating numbers and bursts, above everything. */
  readonly effects?: ((pen: Pen) => void) | undefined;
}

/**
 * Scratch rectangles, one pair per nesting level.
 *
 * `renderFrame` may legitimately nest — a frame that renders a minimap into a sub-pen inside its
 * Overlay pass is a real thing — and a single shared pair would hand the outer Terrain pass the
 * inner frame's bounds halfway through. Pooled by depth rather than allocated per frame, so the
 * steady state is two objects for the life of the process.
 */
const worldScratch: Rect[] = [];
/** See {@link worldScratch}. */
const tileScratch: TileRange[] = [];
/** How deep the current `renderFrame` nesting is. See {@link worldScratch}. */
let frameDepth = 0;

/**
 * Run one frame's passes in the fixed order.
 *
 * It calls `camera.visibleWorldBounds` before Backdrop, `visibleTileBounds` — margined by
 * {@link Passes.maxHeightPx} — before Terrain,
 * `order.sort(camera)` immediately before Solids, and `pen.light.composite()` between Placement
 * and Overlay — **and the light composite is not a callback**, so there is no way for a game to
 * put the night mask over its own HUD.
 *
 * The two culling calls happen only when their pass exists, so a game with no backdrop pays
 * nothing for one; each happens at most once per frame, so three passes can never each recompute
 * the visible region and disagree at the margins.
 *
 * @param order The frame's `DepthSorter`, already filled by the caller. Sorting happens here
 *   rather than in the caller so that no window exists in which somebody holds a sorted order
 *   and improves it.
 * @throws RangeError if a `solids` pass is supplied without an `order`. Silently skipping the
 *   pass would mean a frame that draws terrain and nothing else, which reads as "the save did
 *   not load" and has no other symptom.
 * @throws RangeError if `passes.maxHeightPx` is negative or not finite. A negative margin
 *   *shrinks* the terrain range, which paints a strip of background along two edges of the
 *   screen and looks like a camera bug.
 */
export function renderFrame(pen: Pen, passes: Passes, order?: DepthSorter): void {
  if (passes.solids !== undefined && order === undefined) {
    throw new RangeError('renderFrame: a solids pass needs the DepthSorter you filled this frame');
  }
  const maxHeightPx = passes.maxHeightPx ?? 0;
  if (!(Number.isFinite(maxHeightPx) && maxHeightPx >= 0)) {
    throw new RangeError(
      `renderFrame: expected passes.maxHeightPx to be a finite number >= 0, got ${String(passes.maxHeightPx)}`,
    );
  }
  const camera: Camera = pen.camera;
  const level = frameDepth;
  frameDepth += 1;
  try {
    if (passes.backdrop !== undefined) {
      let box = worldScratch[level];
      if (box === undefined) {
        box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        worldScratch[level] = box;
      }
      passes.backdrop(pen, camera.visibleWorldBounds(box));
    }
    if (passes.terrain !== undefined) {
      let range = tileScratch[level];
      if (range === undefined) {
        range = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
        tileScratch[level] = range;
      }
      // `Math.ceil`, so half a tile of relief still buys a whole tile of margin: the range is
      // integral and rounding down is the one direction that loses geometry.
      passes.terrain(pen, camera.visibleTileBounds(range, Math.ceil(maxHeightPx / TILE_H)));
    }
    if (passes.solids !== undefined && order !== undefined) {
      order.sort(camera);
      passes.solids(pen, order);
    }
    passes.placement?.(pen);
    // Not a callback, and pass 5 rather than 6. A coin pill and a build timer are not in the
    // valley, and a HUD the player cannot read at midnight is a HUD that is broken for half of
    // every cycle.
    pen.light?.composite();
    passes.overlay?.(pen);
    passes.effects?.(pen);
  } finally {
    frameDepth -= 1;
  }
}
