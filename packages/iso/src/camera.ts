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
 * not name. `devicePixelRatio` is `@latticekit/draw`'s business at the point it sets a
 * transform, and nowhere else.
 *
 * **`x`, `y` and `zoom` are getters over private state and there is no setter.** That is not
 * tidiness. `zoomAt` exists to keep the world point under the pointer pinned; if any path can
 * write `camera.zoom = 2` it skips the anchoring, and no test can catch what it cannot
 * observe — the invariant holds in the suite and breaks in the game. Making the assignment
 * unavailable turns a documented rule into an unrepresentable state, which is why this module
 * exports an interface and a factory rather than a class with public fields.
 *
 * **The policy, though, is readable and settable, and that is not a hole in the rule above.**
 * Every field of {@link CameraOptions} except `zoom` has a getter, and each has a setter that
 * re-clamps in the same statement — `setZoomLimits`, `setKeepVisible`, `setBounds`, `resize`.
 * The line between the two halves is what a value *is*, not how much it is worth protecting:
 *
 * | | what moves it | why it is shaped this way |
 * |---|---|---|
 * | **position** — `x`, `y`, `zoom` | a gesture, sixty times a second | every mutator has to decide what stays put under the pointer, and a setter is a path that does not decide |
 * | **policy** — the zoom limits, `keepVisible`, `bounds`, the viewport | a settings screen, a level load, a slider | changing it is a whole-camera decision made a handful of times a session, from code holding no pointer |
 *
 * A value a caller supplied and cannot read back is a value they have to store twice, and two
 * copies drift: before these getters existed the gallery's control panel kept a shadow copy of
 * all three zoom-policy numbers and rebuilt the camera — and the input system bound to it — on
 * every drag of a slider. That is the cost of baking an option that was never expensive to
 * move.
 *
 * No inertia, no drag handling, no pinch, no edge-scroll, no smooth follow, no shake. Feel
 * needs a clock and a pointer and both live in `@latticekit/input`, which drives this camera
 * through `panByScreen`, `zoomAt` and `centerOn`. A camera that eases itself cannot be
 * stepped deterministically in a replay.
 */

import { clamp } from '@latticekit/core';
import type { Vec2 } from '@latticekit/core';
import type { Rect, TileRange } from './projection.js';
import { HALF_H, HALF_W, TILE_H, TILE_W } from './projection.js';

/** Default reachable world rectangle: ±1e4 pixels, about ±312 tiles each way. Effectively
 *  unbounded, which is the right default for an infinite world and the wrong one for an
 *  island — a finite game should always pass its own. */
const DEFAULT_EXTENT = 1e4;

/**
 * What a camera is allowed to do — the opening value of every policy, none of them baked.
 *
 * Every field here except `zoom` is a *policy* rather than a state: the camera's position
 * moves through `panByScreen`, `zoomAt` and `centerOn`, and nothing in this object moves with
 * it. But policy is not frozen either — each field has a getter of the same name on
 * {@link Camera} and a setter that re-applies the clamp in the same statement, so a caller
 * never has to keep a second copy of a number it already handed over.
 *
 * | option | read it back | move it |
 * |---|---|---|
 * | `minZoom`, `maxZoom` | {@link Camera.minZoom}, {@link Camera.maxZoom} | {@link Camera.setZoomLimits} |
 * | `keepVisible` | {@link Camera.keepVisible} | {@link Camera.setKeepVisible} |
 * | `bounds` | {@link Camera.bounds} | {@link Camera.setBounds} |
 * | `zoom` | {@link Camera.zoom} | `zoomAt` / `fitBounds` only — it is a position, not a policy |
 */
export interface CameraOptions {
  /** How far out you may pull. Below this the art stops being readable and the depth sort
   *  starts costing more than the pixels are worth. Default `0.5`. */
  readonly minZoom?: number;
  /** How far in you may push. Default `4`; vector art costs nothing to magnify. */
  readonly maxZoom?: number;
  /** Starting zoom. Default `1`. Clamped into `[minZoom, maxZoom]` at construction rather
   *  than rejected, because a saved zoom outliving a change to the limits is a migration
   *  problem and not a reason to refuse to open the game — and {@link Camera.setZoomLimits}
   *  applies that same rule for the rest of the camera's life. */
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
  /** World x at the center of the viewport. Read-only, and not merely by convention — see
   *  the module header for why the field is unavailable rather than discouraged. */
  readonly x: number;
  /** World y at the center of the viewport. See {@link Camera.x}. */
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
   * The zoom-out limit in force — `CameraOptions.minZoom`, or the default `0.5`, or whatever
   * {@link Camera.setZoomLimits} last set.
   *
   * It exists so that nobody has to keep a second copy. A settings panel that draws the zoom
   * slider needs the range the slider is allowed to span; a "zoom out" button needs to know
   * whether it should be disabled; a save file needs to record the policy it was played
   * under. Each of those, given no reader, keeps its own copy of a number this object already
   * holds — and the copies drift the first time anything else moves the limits.
   */
  readonly minZoom: number;
  /** The zoom-in limit in force. See {@link Camera.minZoom}. */
  readonly maxZoom: number;
  /** The fraction of the viewport that must still show {@link Camera.bounds} after any
   *  gesture — `CameraOptions.keepVisible`, or the default `0.35`, or whatever
   *  {@link Camera.setKeepVisible} last set. Read it to *show* the clamp you are subject to:
   *  it is the one number that explains why a pan stopped where it did. */
  readonly keepVisible: number;

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
   * Replace the zoom limits — a settings change, a difficulty tier, an accessibility option —
   * and re-clamp at once.
   *
   * **Why this exists beside a `zoom` that is deliberately unassignable.** They are not the
   * same kind of thing. `zoom` is a *position*: it moves under a pointer, and the rule
   * `zoomAt` enforces is that no path may move it without deciding what stays put — origin-
   * anchored zoom is the single most common reason a tile-game camera feels broken, and a
   * `set zoom` accessor is precisely a path that decides nothing. The limits are *policy*:
   * they say what the player is allowed to do, they are set by configuration rather than by a
   * gesture, and this method does decide what stays put — the **viewport center**, exactly as
   * `fitBounds` decides on the rectangle's center. The invariant was never "zoom is
   * immutable"; it was "nothing changes zoom without naming an anchor", and this names one.
   *
   * The escape it opens is real and worth stating rather than hiding: `setZoomLimits(2, 2)`
   * does force `zoom` to `2` with no pointer involved. It also freezes the zoom permanently,
   * which is a loud symptom and useless as a way to sneak a gesture through. The rule makes
   * the common mistake unrepresentable; it is not a security boundary and was never sold as
   * one.
   *
   * **If the current zoom falls outside the new range it is clamped on the spot, and that can
   * move the view.** Raising `minZoom` past the current zoom pushes the camera *in*; lowering
   * `maxZoom` below it pulls the camera *out*; and either can then move `x`/`y`, because the
   * half-viewport in world units changed and the {@link Camera.keepVisible} clamp is computed
   * from it. So a `minZoom` slider dragged live rescales the world under the finger. That is
   * the correct behavior — the alternative is a camera sitting outside its own declared limits
   * until the player's next wheel notch snaps it, at a moment they did not cause and cannot
   * connect to anything — but a panel that does not want the view moving mid-drag should
   * commit on release. It is the same rule `CameraOptions.zoom` already applies to a stale
   * saved zoom at construction, applied for the rest of the camera's life.
   *
   * Both limits are taken together, not one at a time, because `minZoom <= maxZoom` is a
   * relation between them: a single-field setter would have to either reject the halfway state
   * of a slider drag that crosses the other limit, or silently reorder the pair. Taking both
   * makes the invariant a thing the caller states and this method checks.
   *
   * @throws RangeError if either limit is not a finite number greater than zero, or if
   *   `minZoom > maxZoom`. The message shape is `createCamera`'s, with this method's name.
   */
  setZoomLimits(minZoom: number, maxZoom: number): void;

  /**
   * Replace the fraction of the viewport that must keep showing {@link Camera.bounds}, and
   * re-clamp at once.
   *
   * **Re-clamping is the point, and it means this call can move the camera.** Raising the
   * fraction while the player is near a map edge pulls them back toward it in the same
   * statement — with nothing in flight, no animation, no next frame required. Deferring
   * instead would leave a camera showing a view its own policy forbids until the next pan,
   * which is the failure {@link Camera.setBounds} already refuses for the same reason.
   *
   * @throws RangeError if `keepVisible` is outside `[0, 1]` — `NaN` included, which is what an
   *   unparsed slider value arrives as and which would otherwise turn the clamp into `NaN` on
   *   both axes and put the camera nowhere.
   */
  setKeepVisible(keepVisible: number): void;

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
   * Where a world x sits **across** the viewport: `-1` at the left edge, `0` at the center,
   * `+1` at the right, continuing past them rather than clamping.
   *
   * The third member of the projection family, and it exists because `@latticekit/audio` needs
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

  /** Put a world point at the center of the viewport immediately, then clamp. */
  centerOn(wx: number, wy: number): void;

  /**
   * Frame a world rectangle: the zoom that makes it fit, then the center that shows it.
   *
   * **The first thing every game does, and the one thing {@link Camera.zoomAt} cannot do.**
   * `zoomAt` takes a *factor* and a required anchor because that is what a wheel notch and a
   * pinch are. Framing a generated world is the other problem: the caller knows the rectangle
   * it wants on screen and does not know — must not have to compute — the ratio between that
   * and the zoom it happens to be at. Written against `zoomAt` it comes out as
   * `zoomAt(want / camera.zoom, viewW / 2, viewH / 2)`, and that division is this method's
   * absence rather than anyone's style.
   *
   * **Content height enters through the rectangle, and there is nowhere else it can.** A
   * rectangle is the whole of what this method knows, so a caller that frames
   * `tileBounds(0, 0, w, d, 0, out)` frames the *ground plane* and a 440-pixel summit lands off
   * the top of the screen on the first frame. Pass the map's tallest elevation as
   * {@link tileBounds}'s `heightPx` — it extends `minY` upward, which is exactly the extra span
   * the fit has to pay for — or union in the boxes of whatever stands on the map. There is
   * deliberately no separate height parameter: two ways to say the same thing is how one of
   * them gets passed twice.
   *
   * The final center is the rectangle's center *after* the bounds clamp, so on a map smaller
   * than `keepVisible` demands the two differ, and the clamp wins. Frame first, then read
   * {@link Camera.x} if you need to know where it settled.
   *
   * **Zoom is written directly here, and that is not a hole in the anchoring rule.** `zoomAt`
   * exists so that a *gesture* cannot skip pinning the world point under the pointer; a fit has
   * no pointer and pins the rectangle's center instead. The invariant is "no path changes zoom
   * without deciding what stays put", and this path decides.
   *
   * @param worldRect The world box to show. Not retained.
   * @param marginPx Gutter in **CSS pixels** on every side — screen pixels, not world pixels,
   *   so the visible margin is the same at every fitted zoom. A world-pixel margin instead
   *   would shrink on screen exactly when the fit zoomed out to accommodate it, which is when
   *   the caller wanted it most. Default `0`.
   * @throws RangeError if any edge is not finite — including the `rectMakeEmpty` state, which
   *   is what an accumulator loop that unioned nothing leaves behind — if the rectangle is
   *   inverted, or if `marginPx` is negative or not finite.
   */
  fitBounds(worldRect: Readonly<Rect>, marginPx?: number): void;

  /** Put a tile at the center. The form callers actually want after loading a save, and the
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
 *  identical message shape — an error a caller learns to recognize is worth more than one
 *  tailored to its site. */
function expectPositiveViewport(value: number, fn: string, param: string): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${fn}: expected ${param} to be a finite number > 0, got ${String(value)}`);
  }
  return value;
}

/**
 * Reject a zoom-limit pair. Shared by `createCamera` and `camera.setZoomLimits` for the same
 * reason as {@link expectPositiveViewport}: the two are the *same* mistake made at two moments,
 * and a caller who has met the message once should not have to read a second wording of it.
 *
 * The pair is checked together because the ordering is the interesting half — `minZoom` alone
 * cannot be wrong, only wrong relative to its partner.
 */
function expectZoomLimits(min: number, max: number, fn: string): void {
  if (!(Number.isFinite(min) && min > 0)) {
    throw new RangeError(`${fn}: expected minZoom to be a finite number > 0, got ${String(min)}`);
  }
  if (!(Number.isFinite(max) && max > 0)) {
    throw new RangeError(`${fn}: expected maxZoom to be a finite number > 0, got ${String(max)}`);
  }
  if (min > max) {
    throw new RangeError(
      `${fn}: expected minZoom <= maxZoom, got minZoom ${String(min)} and maxZoom ${String(max)}`,
    );
  }
}

/** Reject a `keepVisible` fraction. Written as `!(v >= 0 && v <= 1)` rather than
 *  `v < 0 || v > 1` so that `NaN` — an unparsed slider value — is rejected rather than passed
 *  through to poison both axes of the clamp. */
function expectKeepVisible(value: number, fn: string): number {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`${fn}: expected keepVisible in [0, 1], got ${String(value)}`);
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

  let minZoom = options?.minZoom ?? 0.5;
  let maxZoom = options?.maxZoom ?? 4;
  expectZoomLimits(minZoom, maxZoom, 'createCamera');
  let keepVisible = expectKeepVisible(options?.keepVisible ?? 0.35, 'createCamera');

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
   * Confine one axis of the center.
   *
   * `half` is the half-viewport in world units and `need` is how much of the viewport must
   * still show the bounds. Where the overlap can be satisfied at all the center lives in
   * `[min + need - half, max + half - need]`; where it cannot — a map narrower than the part
   * of the viewport that has to be covered — the range would invert, `min > max`, and a naive
   * two-sided clamp returns whichever endpoint it tests last, so the camera jitters between
   * two positions on every pan. Detect it and pin to the bounds center instead.
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
    get minZoom() {
      return minZoom;
    },
    get maxZoom() {
      return maxZoom;
    },
    get keepVisible() {
      return keepVisible;
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

    setZoomLimits(nextMin: number, nextMax: number): void {
      expectZoomLimits(nextMin, nextMax, 'camera.setZoomLimits');
      minZoom = nextMin;
      maxZoom = nextMax;
      // `cx`/`cy` are left alone, which is what makes the viewport center the anchor: the
      // projection is centered on them, so the world point in the middle of the screen is the
      // one point a zoom change cannot move. `reclamp` may then move both, because the
      // half-viewport in world units just changed and the keepVisible clamp is computed from
      // it — a limit change that pushes the camera in can uncover map it must now stay near.
      zoom = clamp(zoom, minZoom, maxZoom);
      reclamp();
    },

    setKeepVisible(next: number): void {
      keepVisible = expectKeepVisible(next, 'camera.setKeepVisible');
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

    fitBounds(worldRect: Readonly<Rect>, marginPx = 0): void {
      if (
        !Number.isFinite(worldRect.minX) ||
        !Number.isFinite(worldRect.minY) ||
        !Number.isFinite(worldRect.maxX) ||
        !Number.isFinite(worldRect.maxY)
      ) {
        throw new RangeError(
          `camera.fitBounds: expected finite rectangle edges, got minX ${String(worldRect.minX)}, minY ${String(worldRect.minY)}, maxX ${String(worldRect.maxX)}, maxY ${String(worldRect.maxY)} — an all-infinite rectangle is the rectMakeEmpty state, which means nothing was unioned into it`,
        );
      }
      const spanX = worldRect.maxX - worldRect.minX;
      const spanY = worldRect.maxY - worldRect.minY;
      if (spanX < 0 || spanY < 0) {
        throw new RangeError(
          `camera.fitBounds: expected maxX >= minX and maxY >= minY, got spans ${String(spanX)} and ${String(spanY)}`,
        );
      }
      if (!(Number.isFinite(marginPx) && marginPx >= 0)) {
        throw new RangeError(
          `camera.fitBounds: expected marginPx to be a finite number >= 0, got ${String(marginPx)}`,
        );
      }
      // A margin wider than half the viewport would ask for a zero or negative zoom, and a
      // negative zoom mirrors the world silently. One CSS pixel of usable viewport instead:
      // the frame comes out uselessly tight, which is visible, rather than inside out.
      const grossW = vw - 2 * marginPx;
      const grossH = vh - 2 * marginPx;
      const usableW = grossW > 1 ? grossW : 1;
      const usableH = grossH > 1 ? grossH : 1;
      // A zero-span axis constrains nothing: framing a single point or a wall that projects to
      // a line means "as close as you are allowed", not a division by zero. If both axes are
      // degenerate both fits are Infinity and the clamp below settles on `maxZoom`.
      const fitX = spanX > 0 ? usableW / spanX : Infinity;
      const fitY = spanY > 0 ? usableH / spanY : Infinity;
      zoom = clamp(fitX < fitY ? fitX : fitY, minZoom, maxZoom);
      // `min/2 + max/2`, not `(min + max) / 2`: a rectangle spanning most of the double range
      // still finds its own middle instead of `Infinity`. Halving is exact in binary.
      cx = worldRect.minX * 0.5 + worldRect.maxX * 0.5;
      cy = worldRect.minY * 0.5 + worldRect.maxY * 0.5;
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
