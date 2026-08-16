/**
 * The isometric solid kit: eight primitives, one color each, three faces derived.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.** Everything here computes screen
 * coordinates into `pen.xy` and hands them to a `Surface`.
 *
 * ## Two rules that are the difference between art and programmer art
 *
 * 1. **One stroke around the silhouette, never one per face.** Per-face strokes cross-hatch the
 *    interior and destroy the chunky read that makes this style work at thumbnail size. It is
 *    the difference between "reads at 40 px" and "reads as a wireframe".
 * 2. **Faces are derived from one color.** There is no `leftColor`. Offering one is offering
 *    the caller a way to break the look, and a kit whose look can be broken by a single call is
 *    a kit whose look will be broken.
 *
 * ## Heights are storeys here and world pixels in `iso`
 *
 * Every height a sprite author writes — `BoxOpts.h`, `BoxOpts.z`, {@link isoRoof}'s `rise`,
 * {@link isoPost}'s `h` — is in storeys, because "three storeys" is what a person means. Every
 * height that crosses into `iso` is in world pixels. {@link levelsToPx} is the one conversion,
 * it runs in one direction, and it happens at the boundary rather than at a call site.
 *
 * ## The six-point stroke order is a cross-package contract
 *
 * {@link isoBox} strokes north-top, east-top, east-base, south-base, west-base, west-top — the
 * order `iso.boxSilhouette` returns. Reverse the winding or start at a different corner and the
 * painted outline still looks perfect, because it is the same hexagon, while the *hit polygon*
 * is a different hexagon and taps land on the wrong building near the edges. Nothing in either
 * package can see that from the inside.
 */

import { HALF_H, HALF_W } from '@lattice/iso';
import type { Ink, Rgba } from './color.js';
import { FACE_LEFT, FACE_RIGHT, FACE_TOP, outlineOf, shade, withAlpha } from './color.js';
import type { Pen } from './surface.js';

/**
 * World pixels per storey. **The only bridge between `draw`'s heights and `iso`'s.**
 *
 * 26 rather than 32 on purpose: a storey exactly one tile tall makes every building a cube, and
 * cubes read as programmer art. It is an art proportion, tuned beside {@link FACE_LEFT}, and it
 * lives here rather than in `iso` because `iso`'s entire height vocabulary is world pixels —
 * there is no signature there a storey could enter through.
 */
export const LEVEL_H = 26;

/** Storeys → world pixels. **The only sanctioned way to produce a `zPx` for `iso`** — a raw
 *  multiply at a call site is how a `Volume` ends up built in storeys, which makes
 *  `boxSilhouette` return an outline that is *nearly* right and picking wrong only near a roof. */
export function levelsToPx(levels: number): number {
  return levels * LEVEL_H;
}

/**
 * World pixels → storeys. The direction every *reading* of `iso` needs.
 *
 * Everything `iso` hands back is world pixels — `heightAt`, `footprintBase`, `Volume.zPx` — and
 * every height a sprite author writes is storeys. Without this the divisor appears at every
 * boundary in game code, spelled `/ 26` on the day somebody forgets the constant exists, and a
 * kit whose art proportion is copied into a game is a kit that cannot change it.
 *
 * **The round trip is not bit-identical and does not need to be.** `levelsToPx(pxToLevels(px))`
 * differs from `px` by at most a part in 10¹⁵ — four femtopixels at the tallest elevation this
 * kit can draw, nine orders below one device pixel, and *deterministic*, because `/` and `*` are
 * Tier A and specified exactly. It is still a different number, so anything that must compare
 * equal to an `iso` elevation rather than merely land on the same pixel — a `Volume` handed to
 * `boxSilhouette` — carries the pixels through untouched instead. {@link spriteVolume} does.
 */
export function pxToLevels(px: number): number {
  return px / LEVEL_H;
}

/**
 * The z-fight ladder, in storeys. Anything drawn *on* the ground must be lifted off it by one
 * of these, in this order, or it flickers against the tile beneath at some zooms and not others
 * — which looks like a hardware bug rather than a missing constant.
 */
export const GROUND_LIFT = 0.002;
/** A placement ghost, above anything painted onto the ground. See {@link GROUND_LIFT}. */
export const GHOST_LIFT = 0.01;
/** A selection rim, above the ghost. See {@link GROUND_LIFT}. */
export const SELECT_LIFT = 0.02;

/** The silhouette stroke width, in CSS pixels. One, and it stays one across a pan because
 *  `Pen.snapX` puts the geometry on whole device pixels. */
const STROKE_W = 1;

/** Segments per half-arc of a cylinder silhouette. Eight reads as round at every zoom the
 *  camera allows and costs an 18-point polygon; sixteen is indistinguishable and twice the
 *  vertices on a shape that is never the subject of a screenshot. */
const CYLINDER_SEGMENTS = 8;

/**
 * `cos` and `sin` of `π·i/CYLINDER_SEGMENTS`, interleaved, built once at module load.
 *
 * A table rather than a call per vertex per frame, which is the difference between one Tier B
 * site in this package and one on the innermost line of the renderer. The values reach pixels
 * only: a cylinder outline is never hashed and never persisted.
 */
const ARC = buildArc();

/** Fill {@link ARC}. Called once, at module load, and never again. */
function buildArc(): Float64Array {
  const out = new Float64Array((CYLINDER_SEGMENTS + 1) * 2);
  for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
    const angle = (Math.PI * i) / CYLINDER_SEGMENTS;
    // @tier-b — presentation only, evaluated once at module load, never hashed or persisted.
    out[i * 2] = Math.cos(angle);
    out[i * 2 + 1] = Math.sin(angle);
  }
  return out;
}

/**
 * Everything a box-shaped solid can be told. **The only object a primitive takes**, and
 * deliberately so: eight positional arguments would be unreadable and every one a number.
 *
 * `readonly` throughout and never retained by the kit, so the intended use is a module-level
 * constant reused every frame, and the intended *misuse* — a fresh literal per building per
 * frame — is one small short-lived object rather than a retained one.
 */
export interface BoxOpts {
  /** Base color. The three faces are derived from it; there is no per-face override. */
  readonly color: Ink;
  /** Height in **storeys**. */
  readonly h: number;
  /** Base height in storeys, so a box can sit on top of another. Default 0. */
  readonly z?: number | undefined;
  /** Shrink the footprint on all sides, in tiles. Ledges and setbacks. Default 0. */
  readonly inset?: number | undefined;
  /** Silhouette stroke. Set `false` for stacked sub-volumes, which would otherwise double-line
   *  along every shared edge and read as a seam. Default true. */
  readonly outline?: boolean | undefined;
  /** Override the top face only — roofs, solar glass, water. **The one sanctioned exception**
   *  to faces-are-derived. */
  readonly topColor?: Ink | undefined;
  /** 0–1 opacity, for ghosts. Applied to the whole solid, not per face. */
  readonly alpha?: number | undefined;
}

/** Reject a dimension that would paint nothing and report nothing. One branch, so it costs a
 *  predicted comparison per primitive on the hot path rather than a call per argument. */
function expectFiniteBox(fn: string, w: number, d: number, h: number, z: number): void {
  if (!(Number.isFinite(w) && Number.isFinite(d) && Number.isFinite(h) && Number.isFinite(z))) {
    throw new RangeError(
      `${fn}: expected finite w, d, h and z, got ${String(w)} ${String(d)} ${String(h)} ${String(z)}`,
    );
  }
}

/** Apply a solid's alpha and hand back the multiplier to restore. `1` and `undefined` both
 *  mean "leave it alone", so the ordinary case costs one comparison and no surface call. */
function pushAlpha(pen: Pen, alpha: number | undefined): number {
  return alpha === undefined || alpha === 1 ? 1 : pen.surface.alpha(alpha);
}

/** Undo {@link pushAlpha}. Never a `save`/`restore` pair: there is no stack to leave unbalanced
 *  and `begin()` resets the multiplier regardless of what a frame did. */
function popAlpha(pen: Pen, alpha: number | undefined, previous: number): void {
  if (!(alpha === undefined || alpha === 1)) pen.surface.alpha(previous);
}

/**
 * Write one grid vertex at elevation `zPx` into the scratch buffer, snapped.
 *
 * The general form, and **internal to this package** — it is not in the barrel. The primitives
 * that project many points on the innermost loop — a box, a roof — do not call it, because a
 * box's eight corners have only **four distinct world x values** and calling a two-axis
 * projection eight times doubles the hottest line in the package for nothing. Everything that
 * runs a handful of times a frame uses it and is shorter for it.
 */
export function put(pen: Pen, at: number, gx: number, gy: number, zPx: number): number {
  pen.xy[at] = pen.camera.toScreenX((gx - gy) * HALF_W) + pen.snapX;
  pen.xy[at + 1] = pen.camera.toScreenY((gx + gy) * HALF_H - zPx) + pen.snapY;
  return at + 2;
}

/** A flat quad in the ground plane, from two grid corners. The shared body of {@link isoTile}
 *  and {@link isoPatch}, which differ only in whether the caller names a size. */
function groundQuad(
  pen: Pen,
  nx: number,
  ny: number,
  fx: number,
  fy: number,
  zPx: number,
  fill: Rgba,
  stroke: Rgba | undefined,
): void {
  let at = put(pen, 0, nx, ny, zPx);
  at = put(pen, at, fx, ny, zPx);
  at = put(pen, at, fx, fy, zPx);
  put(pen, at, nx, fy, zPx);
  pen.surface.poly(pen.xy, 4, fill);
  if (stroke !== undefined) pen.surface.stroke(pen.xy, 4, true, stroke, STROKE_W);
}

/**
 * A single flat tile diamond: terrain, pads, the placement grid.
 *
 * @param inset Shrink on all sides in tiles, for a grid whose cells read as separate cells.
 * @param z Height in **storeys**. Use {@link GROUND_LIFT} and its siblings for anything meant
 *   to sit *on* the ground rather than be the ground.
 */
export function isoTile(
  pen: Pen,
  gx: number,
  gy: number,
  fill: Ink,
  stroke?: Ink,
  inset = 0,
  z = 0,
): void {
  const p = pen.palette;
  groundQuad(
    pen,
    gx + inset,
    gy + inset,
    gx + 1 - inset,
    gy + 1 - inset,
    levelsToPx(z),
    p.ink(fill),
    stroke === undefined ? undefined : p.ink(stroke),
  );
}

/**
 * A flat quad **lying in the ground plane** at height `z` — solar glass, helipads, gravel.
 *
 * Separate from a zero-height box because a zero-height box still draws two degenerate side
 * faces, and those slivers alias badly at low zoom. **Not for windows**: a patch lies flat, so
 * using one for a window paints a horizontal sliver hovering in mid-air at window height —
 * which shipped, on every building on the map, in the game this kit came from. Use
 * {@link isoWall}.
 */
export function isoPatch(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  z: number,
  fill: Ink,
  stroke?: Ink,
): void {
  expectFiniteBox('isoPatch', w, d, 0, z);
  const p = pen.palette;
  groundQuad(
    pen,
    gx,
    gy,
    gx + w,
    gy + d,
    levelsToPx(z),
    p.ink(fill),
    stroke === undefined ? undefined : p.ink(stroke),
  );
}

/**
 * The workhorse: an axis-aligned box on the grid.
 *
 * Draws left face, right face, top, then **one** stroke around the silhouette.
 *
 * **The six stroke points are, in order: north-top, east-top, east-base, south-base, west-base,
 * west-top — the order `iso.boxSilhouette` returns, and this is load-bearing.** It is the one
 * genuine coupling between the two packages, and the failure mode is the worst kind: `iso`
 * hit-tests one polygon, `draw` paints another, both are internally consistent, every test in
 * both packages passes, and a player taps a building and opens its neighbor.
 *
 * @throws RangeError if `w`, `d`, `opts.h` or `opts.z` is not finite. A `NaN` here paints
 *   nothing and reports nothing, and the building is simply missing.
 */
export function isoBox(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  opts: BoxOpts,
): void {
  const z = opts.z ?? 0;
  expectFiniteBox('isoBox', w, d, opts.h, z);
  const inset = opts.inset ?? 0;
  const nx = gx + inset;
  const ny = gy + inset;
  const fx = gx + w - inset;
  const fy = gy + d - inset;
  const base = levelsToPx(z);
  const top = base + levelsToPx(opts.h);

  const cam = pen.camera;
  const dx = pen.snapX;
  const dy = pen.snapY;
  const xy = pen.xy;
  const surface = pen.surface;

  // Four x projections for eight corners: the top four sit directly above the bottom four, and
  // elevation moves screen y alone.
  const xN = cam.toScreenX((nx - ny) * HALF_W) + dx;
  const xE = cam.toScreenX((fx - ny) * HALF_W) + dx;
  const xS = cam.toScreenX((fx - fy) * HALF_W) + dx;
  const xW = cam.toScreenX((nx - fy) * HALF_W) + dx;

  const wyN = (nx + ny) * HALF_H;
  const wyE = (fx + ny) * HALF_H;
  const wyS = (fx + fy) * HALF_H;
  const wyW = (nx + fy) * HALF_H;

  const yNt = cam.toScreenY(wyN - top) + dy;
  const yEt = cam.toScreenY(wyE - top) + dy;
  const yEb = cam.toScreenY(wyE - base) + dy;
  const ySt = cam.toScreenY(wyS - top) + dy;
  const ySb = cam.toScreenY(wyS - base) + dy;
  const yWt = cam.toScreenY(wyW - top) + dy;
  const yWb = cam.toScreenY(wyW - base) + dy;

  const color = pen.palette.ink(opts.color);
  const previous = pushAlpha(pen, opts.alpha);

  // Left face: the `+gy` plane, screen-left, and the lit one.
  xy[0] = xS;
  xy[1] = ySt;
  xy[2] = xS;
  xy[3] = ySb;
  xy[4] = xW;
  xy[5] = yWb;
  xy[6] = xW;
  xy[7] = yWt;
  surface.poly(xy, 4, shade(color, FACE_LEFT));

  // Right face: the `+gx` plane, screen-right, and the shaded one.
  xy[0] = xE;
  xy[1] = yEt;
  xy[2] = xE;
  xy[3] = yEb;
  xy[4] = xS;
  xy[5] = ySb;
  xy[6] = xS;
  xy[7] = ySt;
  surface.poly(xy, 4, shade(color, FACE_RIGHT));

  // Top.
  xy[0] = xN;
  xy[1] = yNt;
  xy[2] = xE;
  xy[3] = yEt;
  xy[4] = xS;
  xy[5] = ySt;
  xy[6] = xW;
  xy[7] = yWt;
  surface.poly(
    xy,
    4,
    opts.topColor === undefined ? shade(color, FACE_TOP) : pen.palette.ink(opts.topColor),
  );

  if (opts.outline !== false) {
    // north-top, east-top, east-base, south-base, west-base, west-top. This order is
    // `iso.boxSilhouette`'s and changing it breaks hit-testing without changing a pixel.
    xy[0] = xN;
    xy[1] = yNt;
    xy[2] = xE;
    xy[3] = yEt;
    xy[4] = xE;
    xy[5] = yEb;
    xy[6] = xS;
    xy[7] = ySb;
    xy[8] = xW;
    xy[9] = yWb;
    xy[10] = xW;
    xy[11] = yWt;
    surface.stroke(xy, 6, true, outlineOf(color), STROKE_W);
  }

  popAlpha(pen, opts.alpha, previous);
}

/**
 * An upright cylinder — cooling towers, tanks, silos.
 *
 * An ellipse cap over a body filled with a horizontal ramp. A swept solid would be more correct
 * and completely indistinguishable at this size; the ramp is what sells curvature.
 *
 * `radiusTiles` is measured the same way a light pool is: `rx = radiusTiles · HALF_W · zoom`,
 * and `ry` is half of that, because a circle on the ground projects 2:1 like everything else
 * lying flat in this world.
 *
 * @throws RangeError if `radiusTiles`, `opts.h` or `opts.z` is not finite.
 */
export function isoCylinder(
  pen: Pen,
  gx: number,
  gy: number,
  radiusTiles: number,
  opts: BoxOpts,
): void {
  const z = opts.z ?? 0;
  expectFiniteBox('isoCylinder', radiusTiles, radiusTiles, opts.h, z);
  const cam = pen.camera;
  const surface = pen.surface;
  const xy = pen.xy;
  const base = levelsToPx(z);
  const top = base + levelsToPx(opts.h);
  const radius = radiusTiles - (opts.inset ?? 0);
  const rx = (radius > 0 ? radius : 0) * HALF_W * cam.zoom;
  const ry = rx / 2;

  const cx = cam.toScreenX((gx - gy) * HALF_W) + pen.snapX;
  const worldY = (gx + gy) * HALF_H;
  const cyBase = cam.toScreenY(worldY - base) + pen.snapY;
  const cyTop = cam.toScreenY(worldY - top) + pen.snapY;

  const color = pen.palette.ink(opts.color);
  const left = shade(color, FACE_LEFT);
  const right = shade(color, FACE_RIGHT);
  const previous = pushAlpha(pen, opts.alpha);

  // The base cap first: its upper half is covered by the body, and its lower half is the part
  // of the silhouette a flat-bottomed quad would leave square.
  surface.ellipse(cx, cyBase, rx, ry, right);

  xy[0] = cx - rx;
  xy[1] = cyTop;
  xy[2] = cx + rx;
  xy[3] = cyTop;
  xy[4] = cx + rx;
  xy[5] = cyBase;
  xy[6] = cx - rx;
  xy[7] = cyBase;
  surface.polyRamp(xy, 4, cx - rx, cyTop, cx + rx, cyTop, left, right);

  surface.ellipse(
    cx,
    cyTop,
    rx,
    ry,
    opts.topColor === undefined ? shade(color, FACE_TOP) : pen.palette.ink(opts.topColor),
  );

  if (opts.outline !== false) {
    // The silhouette: the top cap's upper arc, down the left side, the base cap's lower arc,
    // and back up the right. Convex, so it is one closed stroke and not two.
    let at = 0;
    for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
      xy[at] = cx + rx * (ARC[i * 2] as number);
      xy[at + 1] = cyTop - ry * (ARC[i * 2 + 1] as number);
      at += 2;
    }
    for (let i = 0; i <= CYLINDER_SEGMENTS; i++) {
      xy[at] = cx - rx * (ARC[i * 2] as number);
      xy[at + 1] = cyBase + ry * (ARC[i * 2 + 1] as number);
      at += 2;
    }
    surface.stroke(xy, CYLINDER_SEGMENTS * 2 + 2, true, outlineOf(color), STROKE_W);
  }

  popAlpha(pen, opts.alpha, previous);
}

/** How much light the far slope of a roof keeps. Lower than the near slope because it tilts
 *  away from a sun that sits front-left. */
const ROOF_FAR = 0.66;
/** The near slope, which faces the light and is very nearly a top face. */
const ROOF_NEAR = 0.94;

/**
 * A gabled roof: a prism ridged along the `gx` axis.
 *
 * What sheds the "everything is a box" read that flat-topped-only kits fall into. A kit without
 * it produces cities that look like spreadsheets.
 *
 * The far slope is drawn only while it faces the camera. Past `rise · LEVEL_H · 2 ≥ d · HALF_H`
 * the ridge projects above the far eave and the slope turns away; painting it anyway would put
 * a wedge of roof above the ridge line, which reads as a hole in the building.
 *
 * @param z Base of the roof, in storeys. @param rise Height of the ridge above `z`, in storeys.
 * @throws RangeError if `w`, `d`, `rise` or `z` is not finite.
 */
export function isoRoof(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  z: number,
  rise: number,
  color: Ink,
  outline = true,
): void {
  expectFiniteBox('isoRoof', w, d, rise, z);
  const cam = pen.camera;
  const surface = pen.surface;
  const xy = pen.xy;
  const dx = pen.snapX;
  const dy = pen.snapY;
  const base = levelsToPx(z);
  const risePx = levelsToPx(rise);
  const ridgeZ = base + risePx;
  const fx = gx + w;
  const fy = gy + d;
  const mid = gy + d / 2;

  const xN = cam.toScreenX((gx - gy) * HALF_W) + dx;
  const xE = cam.toScreenX((fx - gy) * HALF_W) + dx;
  const xS = cam.toScreenX((fx - fy) * HALF_W) + dx;
  const xW = cam.toScreenX((gx - fy) * HALF_W) + dx;
  const xR0 = cam.toScreenX((gx - mid) * HALF_W) + dx;
  const xR1 = cam.toScreenX((fx - mid) * HALF_W) + dx;

  const yN = cam.toScreenY((gx + gy) * HALF_H - base) + dy;
  const yE = cam.toScreenY((fx + gy) * HALF_H - base) + dy;
  const yS = cam.toScreenY((fx + fy) * HALF_H - base) + dy;
  const yW = cam.toScreenY((gx + fy) * HALF_H - base) + dy;
  const yR0 = cam.toScreenY((gx + mid) * HALF_H - ridgeZ) + dy;
  const yR1 = cam.toScreenY((fx + mid) * HALF_H - ridgeZ) + dy;

  const fill = pen.palette.ink(color);

  if (risePx * 2 < d * HALF_H) {
    xy[0] = xN;
    xy[1] = yN;
    xy[2] = xE;
    xy[3] = yE;
    xy[4] = xR1;
    xy[5] = yR1;
    xy[6] = xR0;
    xy[7] = yR0;
    surface.poly(xy, 4, shade(fill, ROOF_FAR));
  }

  // The `+gx` gable end, a triangle, always facing the camera.
  xy[0] = xE;
  xy[1] = yE;
  xy[2] = xR1;
  xy[3] = yR1;
  xy[4] = xS;
  xy[5] = yS;
  surface.poly(xy, 3, shade(fill, FACE_RIGHT));

  xy[0] = xR0;
  xy[1] = yR0;
  xy[2] = xR1;
  xy[3] = yR1;
  xy[4] = xS;
  xy[5] = yS;
  xy[6] = xW;
  xy[7] = yW;
  surface.poly(xy, 4, shade(fill, ROOF_NEAR));

  if (outline) {
    xy[0] = xN;
    xy[1] = yN;
    xy[2] = xE;
    xy[3] = yE;
    xy[4] = xR1;
    xy[5] = yR1;
    xy[6] = xS;
    xy[7] = yS;
    xy[8] = xW;
    xy[9] = yW;
    xy[10] = xR0;
    xy[11] = yR0;
    surface.stroke(xy, 6, true, outlineOf(fill), STROKE_W);
  }
}

/**
 * A rectangle **on a vertical face** — windows, doors, vents, signage, hazard panels.
 *
 * Takes the two grid endpoints of the wall segment and the two heights it spans, in storeys, so
 * it lands flush on the face rather than hovering in front of it. This is the primitive
 * {@link isoPatch} is not: a patch lies flat, and a window drawn with one is a horizontal
 * sliver in mid-air.
 */
export function isoWall(
  pen: Pen,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  z1: number,
  fill: Ink,
  stroke?: Ink,
): void {
  const lo = levelsToPx(z0);
  const hi = levelsToPx(z1);
  let at = put(pen, 0, ax, ay, hi);
  at = put(pen, at, bx, by, hi);
  at = put(pen, at, bx, by, lo);
  put(pen, at, ax, ay, lo);
  pen.surface.poly(pen.xy, 4, pen.palette.ink(fill));
  if (stroke !== undefined) {
    pen.surface.stroke(pen.xy, 4, true, pen.palette.ink(stroke), STROKE_W);
  }
}

/** Default post width in tiles. Thin enough to read as a mast, wide enough to survive being
 *  scaled down to a phone. */
const POST_WIDTH = 0.12;

/** No post is ever thinner than this on screen, or it disappears entirely at low zoom and the
 *  building loses its aerial without anybody noticing. */
const MIN_POST_PX = 0.75;

/**
 * A thin upright post — antennae, lightning rods, flagpoles, pylons.
 *
 * @param z Base in storeys. @param h Height in storeys. @param width Thickness in tiles.
 */
export function isoPost(
  pen: Pen,
  gx: number,
  gy: number,
  z: number,
  h: number,
  color: Ink,
  width = POST_WIDTH,
): void {
  const cam = pen.camera;
  const cx = cam.toScreenX((gx - gy) * HALF_W) + pen.snapX;
  const worldY = (gx + gy) * HALF_H;
  const yBase = cam.toScreenY(worldY - levelsToPx(z)) + pen.snapY;
  const yTop = cam.toScreenY(worldY - levelsToPx(z + h)) + pen.snapY;
  const spread = (width * HALF_W * cam.zoom) / 2;
  const half = spread < MIN_POST_PX ? MIN_POST_PX : spread;

  const xy = pen.xy;
  xy[0] = cx - half;
  xy[1] = yTop;
  xy[2] = cx + half;
  xy[3] = yTop;
  xy[4] = cx + half;
  xy[5] = yBase;
  xy[6] = cx - half;
  xy[7] = yBase;
  const fill = pen.palette.ink(color);
  // A ramp rather than a flat fill: a post is a cylinder too small to be worth one, and the
  // ramp is the only thing that stops a mast reading as a rectangle of paint.
  pen.surface.polyRamp(
    xy,
    4,
    cx - half,
    yTop,
    cx + half,
    yTop,
    shade(fill, FACE_TOP),
    shade(fill, FACE_RIGHT),
  );
}

/** Default glow radius in tiles. A status LED, not a lamp — a lamp's pool is `LightField.add`. */
const GLOW_RADIUS = 0.12;

/** How far the halo reaches past the core. Below about 2 the dot reads as a flat disc; above
 *  about 4 a hundred of them fog the whole campus. */
const GLOW_HALO = 3;

/** Peak alpha of the halo at full intensity. The core is opaque; the halo is what sells the
 *  glow, and at 1 it becomes a second disc. */
const GLOW_HALO_ALPHA = 0.5;

/**
 * A glowing point: a hard core inside a soft halo — status LEDs, lit windows, strobes.
 *
 * A hundred of these sell "operational facility" better than any amount of geometry, and they
 * cost one ellipse and one soft ellipse each.
 *
 * **Round, not squashed**, and that is not an oversight: this is a light source *in the air*
 * seen head-on, where a ground-plane pool — `LightField.add` — is a flat thing and is 2:1.
 *
 * `intensity` at or below 0 draws nothing at all, so a blink is `intensity: on ? 1 : 0` and
 * costs nothing on the dark half of its cycle.
 */
export function glowDot(
  pen: Pen,
  gx: number,
  gy: number,
  z: number,
  color: Ink,
  radius = GLOW_RADIUS,
  intensity = 1,
): void {
  if (!(intensity > 0)) return;
  const cam = pen.camera;
  const cx = cam.toScreenX((gx - gy) * HALF_W) + pen.snapX;
  const cy = cam.toScreenY((gx + gy) * HALF_H - levelsToPx(z)) + pen.snapY;
  const r = radius * HALF_W * cam.zoom;
  const strength = intensity > 1 ? 1 : intensity;
  const fill = pen.palette.ink(color);
  pen.surface.softEllipse(
    cx,
    cy,
    r * GLOW_HALO,
    r * GLOW_HALO,
    withAlpha(fill, GLOW_HALO_ALPHA * strength),
    withAlpha(fill, 0),
  );
  pen.surface.ellipse(cx, cy, r, r, withAlpha(fill, strength));
}
