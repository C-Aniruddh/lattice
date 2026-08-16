/**
 * The camera: a pan, a zoom, and a clamp. **No DOM anywhere in this file.**
 *
 * It is given a viewport *size*, never a canvas, which is what lets the whole of `iso` run in
 * Node and be tested without a shim — and the two things most worth testing here, the clamp
 * and the pointer-anchored zoom, are precisely the two that a browser-only camera can only be
 * tested by hand.
 *
 * **The viewport is in CSS pixels.** A pointer event arrives in CSS pixels, so a camera that
 * worked in device pixels would make every input path multiply by a ratio this package must
 * not name. `devicePixelRatio` is `@lattice/draw`'s business at the point it sets a
 * transform, and nowhere else.
 *
 * **`x`, `y` and `zoom` are getters over private state and there is no setter.** That is not
 * tidiness. `zoomAt` exists to keep the world point under the pointer pinned; if any path can
 * write `camera.zoom = 2` it skips the anchoring, and no test can catch what it cannot
 * observe — the invariant holds in the suite and breaks in the game. Making the assignment
 * unavailable turns a documented rule into an unrepresentable state, which is why this module
 * exports an interface and a factory rather than a class with public fields.
 *
 * No inertia, no drag handling, no pinch, no edge-scroll, no smooth follow, no shake. Feel
 * needs a clock and a pointer and both live in `@lattice/input`, which drives this camera
 * through `panByScreen`, `zoomAt` and `centerOn`. A camera that eases itself cannot be
 * stepped deterministically in a replay.
 */

import { clamp } from '@lattice/core';
import type { Vec2 } from '@lattice/core';
import type { Rect, TileRange } from './projection.js';
import { HALF_H, HALF_W, TILE_H, TILE_W } from './projection.js';

/** Default reachable world rectangle: ±1e4 pixels, about ±312 tiles each way. Effectively
 *  unbounded, which is the right default for an infinite world and the wrong one for an
 *  island — a finite game should always pass its own. */
const DEFAULT_EXTENT = 1e4;

/**
 * What a camera is allowed to do, decided once at construction.
 *
 * Every field here is a policy rather than a state: the camera's *position* moves through
 * `panByScreen`, `zoomAt` and `centerOn`, and nothing in this object moves after the camera
 * exists. `bounds` is the exception a game changes at runtime, and it changes through
 * {@link Camera.setBounds} so that the clamp is re-applied in the same statement.
 */
export interface CameraOptions {
  /** How far out you may pull. Below this the art stops being readable and the depth sort
   *  starts costing more than the pixels are worth. Default `0.5`. */
  readonly minZoom?: number;
  /** How far in you may push. Default `4`; vector art costs nothing to magnify. */
  readonly maxZoom?: number;
  /** Starting zoom. Default `1`. Clamped into `[minZoom, maxZoom]` at construction rather
   *  than rejected, because a saved zoom outliving a change to the limits is a migration
   *  problem and not a reason to refuse to open the game. */
  readonly zoom?: number;
  /**
   * The world rectangle the player is allowed to look at. Default ±{@link DEFAULT_EXTENT}.
   *
   * Copied at construction, so a caller may reuse the rectangle it passed in — this is the
   * one place in the package where an input rectangle is retained, and retaining the
   * caller's object would make every later `rectSet` on it move the camera's world.
   */
  readonly bounds?: Readonly<Rect>;
  /**
   * The fraction of the viewport that must still show `bounds` on each axis after any
   * gesture. Default `0.35`.
   *
   * `0` lets a player strand themselves on empty ground with nothing to tap and no idea which
   * way is back; `1` requires the viewport to lie entirely inside the bounds, which pins the
   * map rigidly and feels stuck — and, on a map smaller than the viewport, is unsatisfiable,
   * which is the case {@link Camera.clamp} has to detect rather than hand to a `min > max`
   * comparison.
   */
  readonly keepVisible?: number;
}

/**
 * The transform. Every method is a pure function of its arguments and the current state; the
 * only mutation is through the five mutators, all of which re-clamp.
 */
export interface Camera {
  /** World x at the centre of the viewport. Read-only, and not merely by convention — see
   *  the module header for why the field is unavailable rather than discouraged. */
  readonly x: number;
  /** World y at the centre of the viewport. See {@link Camera.x}. */
  readonly y: number;
  /** World pixels per CSS pixel. Moved only by {@link Camera.zoomAt}, so the pointer anchor
   *  cannot be skipped. */
  readonly zoom: number;
  /** Viewport width in **CSS pixels** — never device pixels, never a canvas. */
  readonly viewW: number;
  /** Viewport height in CSS pixels. See {@link Camera.viewW}. */
  readonly viewH: number;
  /** The reachable world rectangle. The camera's own copy; mutating it does nothing until
   *  {@link Camera.setBounds} is called, which is the honest half of that trade. */
  readonly bounds: Readonly<Rect>;

  /**
   * Re-clamps against a new viewport size. Call it on every viewport change including an
   * orientation flip: the clamp depends on the half-viewport in world units, so a camera that
   * is not told the window shrank keeps letting the player look outside the map.
   *
   * @throws RangeError if either dimension is not a finite number greater than zero.
   */
  resize(viewW: number, viewH: number): void;

  /** Replace the reachable rectangle — the island grew, the level loaded — and re-clamp at
   *  once, so no frame is ever drawn against bounds the camera has not been checked against. */
  setBounds(bounds: Readonly<Rect>): void;

  /**
   * world → screen x. **Takes `wx` alone**, because screen x depends on world x alone.
   *
   * This is the form that writes into a `Float64Array`: `pen[i] = cam.toScreenX(wx);
   * pen[i + 1] = cam.toScreenY(wy);` — no intermediate object at any point. A caller
   * projecting the eight corners of a box projects four x values, not eight, which is the
   * whole reason the two axes are separate functions.
   */
  toScreenX(wx: number): number;
  /** world → screen y. See {@link Camera.toScreenX}. */
  toScreenY(wy: number): number;
  /** world → screen, both axes, into a caller-owned `Vec2`. Returns `out` so calls chain. */
  toScreen(wx: number, wy: number, out: Vec2): Vec2;

  /**
   * Where a world x sits **across** the viewport: `-1` at the left edge, `0` at the centre,
   * `+1` at the right, continuing past them rather than clamping.
   *
   * The third member of the projection family, and it exists because `@lattice/audio` needs
   * it and may not depend on this package: a sound's stereo pan is the `normalizedX` of the
   * thing that made it. **Unclamped on purpose** — how far a pan may go is a mixing policy
   * (`audio` caps at ±0.6, because full-width panning is unpleasant on headphones and
   * inaudible on a phone speaker) and a policy does not belong in a projection.
   *
   * There is no `normalizedY`. Stereo has one axis.
   */
  normalizedX(wx: number): number;

  /** screen → world x. The exact inverse of {@link Camera.toScreenX}. */
  toWorldX(sx: number): number;
  /** screen → world y. */
  toWorldY(sy: number): number;
  /** screen → world, both axes, into a caller-owned `Vec2`. */
  toWorld(sx: number, sy: number, out: Vec2): Vec2;

  /**
   * Pan by a screen-space delta — a drag.
   *
   * Divided by zoom internally so the world tracks the finger exactly at any scale.
   * Multiplying instead of dividing is the bug where a zoomed-in map slides at a crawl and a
   * zoomed-out one bolts, and it looks like a tuning problem rather than a sign error.
   */
  panByScreen(dxScreen: number, dyScreen: number): void;

  /**
   * Zoom, keeping the world point under `(sx, sy)` pinned to that screen pixel.
   *
   * @param factor Multiplicative step; `> 1` zooms in. A wheel notch is about 1.1, a pinch is
   *   the ratio of the current finger distance to the previous one. Non-finite or
   *   non-positive factors throw rather than turning the camera into `NaN`, which is a state
   *   nothing downstream recovers from and nothing reports.
   *
   * Origin-anchored zoom — the naive `zoom *= factor` — is the single most common reason a
   * tile-game camera feels broken: the thing you were looking at slides away as you zoom
   * towards it. The correct implementation is three lines and they are all here.
   */
  zoomAt(factor: number, sx: number, sy: number): void;

  /** Put a world point at the centre of the viewport immediately, then clamp. */
  centerOn(wx: number, wy: number): void;

  /** Put a tile at the centre. The form callers actually want after loading a save, and the
   *  one that stops every game writing `gridToWorld` into a scratch vector to do it. */
  centerOnTile(gx: number, gy: number): void;

  /**
   * Re-apply the clamp. Every mutator calls it already; it is exposed for a caller who
   * changed the bounds rectangle by some other route, and for tests asserting idempotence —
   * `clamp(); clamp()` must be a no-op, and the version that oscillates between two positions
   * is the one that fed `min > max` to a two-sided clamp.
   */
  clamp(): void;

  /**
   * Is this world box worth drawing? A cheap AABB reject, generous by one tile on each axis
   * so that geometry poking outside its declared box does not flicker at the edge of the
   * screen.
   */
  isVisible(minX: number, minY: number, maxX: number, maxY: number): boolean;

  /**
   * The conservative **grid** rectangle covering the viewport — the terrain loop's bounds.
   *
   * Computed by projecting the four **screen** corners into grid space and taking the
   * min/max, because the visible region is a *diamond* in grid space, not a rectangle. A loop
   * derived from a grid-space rectangle silently misses the two side corners of the screen
   * and leaves triangular holes of unpainted ground. The returned range over-covers by
   * roughly 2×, and that is the correct trade against a per-tile diamond intersection test.
   *
   * @param marginTiles Extra tiles on every side. Pass the height of the tallest thing on
   *   your map in world pixels divided by {@link TILE_H}, or roofs pop in along the top edge.
   *   In world pixels because that is the only height unit this package has — a storey is not
   *   a thing `iso` can count.
   */
  visibleTileBounds(out: TileRange, marginTiles?: number): TileRange;

  /**
   * The **world** rectangle covering the viewport, for culling anything not on the tile
   * lattice — a backdrop gradient, a light pool, a cached scenery chunk.
   *
   * The `Rect`-shaped counterpart to {@link Camera.isVisible}: that one asks about a box you
   * have, this one hands over the box to test against.
   */
  visibleWorldBounds(out: Rect, marginPx?: number): Rect;
}

/** Reject a viewport dimension. Named separately so `createCamera` and `resize` produce the
 *  identical message shape — an error a caller learns to recognise is worth more than one
 *  tailored to its site. */
function expectPositiveViewport(value: number, fn: string, param: string): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${fn}: expected ${param} to be a finite number > 0, got ${String(value)}`);
  }
  return value;
}

/**
 * Build a camera.
 *
 * @throws RangeError if `viewW`/`viewH` are not finite and positive, if `minZoom` or
 *   `maxZoom` are not finite and positive, if `minZoom > maxZoom`, or if `keepVisible` is
 *   outside `[0, 1]`. Every message names the parameter and the value it got:
 *   `createCamera: expected viewW to be a finite number > 0, got 0`.
 */
export function createCamera(viewW: number, viewH: number, options?: CameraOptions): Camera {
  let vw = expectPositiveViewport(viewW, 'createCamera', 'viewW');
  let vh = expectPositiveViewport(viewH, 'createCamera', 'viewH');

  const minZoom = options?.minZoom ?? 0.5;
  const maxZoom = options?.maxZoom ?? 4;
  if (!(Number.isFinite(minZoom) && minZoom > 0)) {
    throw new RangeError(
      `createCamera: expected minZoom to be a finite number > 0, got ${String(minZoom)}`,
    );
  }
  if (!(Number.isFinite(maxZoom) && maxZoom > 0)) {
    throw new RangeError(
      `createCamera: expected maxZoom to be a finite number > 0, got ${String(maxZoom)}`,
    );
  }
  if (minZoom > maxZoom) {
    throw new RangeError(
      `createCamera: expected minZoom <= maxZoom, got minZoom ${String(minZoom)} and maxZoom ${String(maxZoom)}`,
    );
  }
  const keepVisible = options?.keepVisible ?? 0.35;
  if (!(keepVisible >= 0 && keepVisible <= 1)) {
    throw new RangeError(
      `createCamera: expected keepVisible in [0, 1], got ${String(keepVisible)}`,
    );
  }

  let zoom = clamp(options?.zoom ?? 1, minZoom, maxZoom);
  if (!Number.isFinite(zoom)) {
    throw new RangeError(`createCamera: expected zoom to be a finite number, got ${String(zoom)}`);
  }

  // The camera's own rectangle. A copy, not the caller's object: `bounds` is the one input
  // this package retains, and retaining the caller's would make every later `rectSet` on it
  // silently move the world the player is allowed to reach.
  const bounds: Rect = { minX: -DEFAULT_EXTENT, minY: -DEFAULT_EXTENT, maxX: DEFAULT_EXTENT, maxY: DEFAULT_EXTENT };

  let cx = 0;
  let cy = 0;

  /**
   * Confine one axis of the centre.
   *
   * `half` is the half-viewport in world units and `need` is how much of the viewport must
   * still show the bounds. Where the overlap can be satisfied at all the centre lives in
   * `[min + need - half, max + half - need]`; where it cannot — a map narrower than the part
   * of the viewport that has to be covered — the range would invert, `min > max`, and a naive
   * two-sided clamp returns whichever endpoint it tests last, so the camera jitters between
   * two positions on every pan. Detect it and pin to the bounds centre instead.
   */
  function clampAxis(value: number, min: number, max: number, half: number): number {
    const need = 2 * half * keepVisible;
    const span = max - min;
    if (!(span > need)) return min + span / 2;
    return clamp(value, min + need - half, max + half - need);
  }

  function reclamp(): void {
    const halfW = vw / (2 * zoom);
    const halfH = vh / (2 * zoom);
    cx = clampAxis(cx, bounds.minX, bounds.maxX, halfW);
    cy = clampAxis(cy, bounds.minY, bounds.maxY, halfH);
  }

  reclamp();

  const camera: Camera = {
    get x() {
      return cx;
    },
    get y() {
      return cy;
    },
    get zoom() {
      return zoom;
    },
    get viewW() {
      return vw;
    },
    get viewH() {
      return vh;
    },
    get bounds() {
      return bounds;
    },

    resize(nextW: number, nextH: number): void {
      vw = expectPositiveViewport(nextW, 'camera.resize', 'viewW');
      vh = expectPositiveViewport(nextH, 'camera.resize', 'viewH');
      reclamp();
    },

    setBounds(next: Readonly<Rect>): void {
      bounds.minX = next.minX;
      bounds.minY = next.minY;
      bounds.maxX = next.maxX;
      bounds.maxY = next.maxY;
      reclamp();
    },

    toScreenX(wx: number): number {
      return (wx - cx) * zoom + vw / 2;
    },
    toScreenY(wy: number): number {
      return (wy - cy) * zoom + vh / 2;
    },
    toScreen(wx: number, wy: number, out: Vec2): Vec2 {
      out.x = (wx - cx) * zoom + vw / 2;
      out.y = (wy - cy) * zoom + vh / 2;
      return out;
    },

    normalizedX(wx: number): number {
      return ((wx - cx) * zoom * 2) / vw;
    },

    toWorldX(sx: number): number {
      return (sx - vw / 2) / zoom + cx;
    },
    toWorldY(sy: number): number {
      return (sy - vh / 2) / zoom + cy;
    },
    toWorld(sx: number, sy: number, out: Vec2): Vec2 {
      out.x = (sx - vw / 2) / zoom + cx;
      out.y = (sy - vh / 2) / zoom + cy;
      return out;
    },

    panByScreen(dxScreen: number, dyScreen: number): void {
      cx -= dxScreen / zoom;
      cy -= dyScreen / zoom;
      reclamp();
    },

    zoomAt(factor: number, sx: number, sy: number): void {
      if (!(Number.isFinite(factor) && factor > 0)) {
        throw new RangeError(
          `camera.zoomAt: expected factor to be a finite number > 0, got ${String(factor)}`,
        );
      }
      // World point before, apply the zoom, world point after, add the difference. Those
      // three lines are the whole of pointer-anchored zoom, and their absence is the single
      // most common reason a tile-game camera feels broken.
      const wx = (sx - vw / 2) / zoom + cx;
      const wy = (sy - vh / 2) / zoom + cy;
      zoom = clamp(zoom * factor, minZoom, maxZoom);
      cx = wx - (sx - vw / 2) / zoom;
      cy = wy - (sy - vh / 2) / zoom;
      reclamp();
    },

    centerOn(wx: number, wy: number): void {
      cx = wx;
      cy = wy;
      reclamp();
    },

    centerOnTile(gx: number, gy: number): void {
      cx = (gx - gy) * HALF_W;
      cy = (gx + gy) * HALF_H;
      reclamp();
    },

    clamp(): void {
      reclamp();
    },

    isVisible(minX: number, minY: number, maxX: number, maxY: number): boolean {
      // One tile of slack on each axis. Geometry routinely pokes a few pixels outside the box
      // its owner declared — a stroke width, a shadow, a rounded corner — and a reject that
      // is exact makes those few pixels flicker along the screen edge as the camera moves.
      const halfW = vw / (2 * zoom) + TILE_W;
      const halfH = vh / (2 * zoom) + TILE_H;
      return (
        maxX >= cx - halfW && minX <= cx + halfW && maxY >= cy - halfH && minY <= cy + halfH
      );
    },

    visibleTileBounds(out: TileRange, marginTiles = 0): TileRange {
      // Project the four screen corners into grid space, not the corners of a grid-space
      // rectangle: the visible region is a diamond in grid space, and a range derived the
      // other way misses the two side corners of the screen entirely.
      const w0 = (0 - vw / 2) / zoom + cx;
      const w1 = (vw - vw / 2) / zoom + cx;
      const h0 = (0 - vh / 2) / zoom + cy;
      const h1 = (vh - vh / 2) / zoom + cy;
      // grid gx = (wx / HALF_W + wy / HALF_H) / 2 is increasing in both wx and wy, so its
      // extremes over the box are at two opposite corners; gy is decreasing in wx and
      // increasing in wy, so its extremes are at the other two. Four expressions, no min/max
      // loop, and no chance of pairing the wrong corners.
      const gxMin = (w0 / HALF_W + h0 / HALF_H) / 2;
      const gxMax = (w1 / HALF_W + h1 / HALF_H) / 2;
      const gyMin = (h0 / HALF_H - w1 / HALF_W) / 2;
      const gyMax = (h1 / HALF_H - w0 / HALF_W) / 2;
      out.gx0 = Math.floor(gxMin) - marginTiles;
      out.gy0 = Math.floor(gyMin) - marginTiles;
      out.gx1 = Math.floor(gxMax) + 1 + marginTiles;
      out.gy1 = Math.floor(gyMax) + 1 + marginTiles;
      return out;
    },

    visibleWorldBounds(out: Rect, marginPx = 0): Rect {
      const halfW = vw / (2 * zoom) + marginPx;
      const halfH = vh / (2 * zoom) + marginPx;
      out.minX = cx - halfW;
      out.minY = cy - halfH;
      out.maxX = cx + halfW;
      out.maxY = cy + halfH;
      return out;
    },
  };

  if (options?.bounds !== undefined) camera.setBounds(options.bounds);
  return camera;
}

/**
 * grid → screen, including elevation. The composite the renderer calls most.
 *
 * `zPx` is world pixels of elevation and shifts screen **y** by `-zPx * zoom` and nothing
 * else — elevation is not a third projection axis. Two different `(grid, z)` pairs therefore
 * land on the same screen pixel, which is precisely why picking cannot be done by inverting
 * this function: screen → (grid, z) is one equation short of solvable. Pick by walking the
 * sorted order and testing silhouettes, or, on terrain, with `screenToTileOnHeights`.
 */
export function gridToScreen(
  camera: Camera,
  gx: number,
  gy: number,
  zPx: number,
  out: Vec2,
): Vec2 {
  out.x = camera.toScreenX((gx - gy) * HALF_W);
  out.y = camera.toScreenY((gx + gy) * HALF_H - zPx);
  return out;
}
