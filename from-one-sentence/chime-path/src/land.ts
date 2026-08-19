/**
 * The mountain, and the one path up it.
 *
 * Everything here is a pure function of (SEED, gx, gy) so the same ridge arrives on every
 * reload and the trail that switchbacks up it lands on the same tiles.
 */
import { clamp, fbm2, hash2, toUnit } from '@latticekit/core';
import {
  Path,
  PathFinder,
  TileGrid,
  heightAt,
  pathSample,
  pathSimplify,
  tileBounds,
} from '@latticekit/iso';
import type { GridPoint, HeightField, Rect, TileCost } from '@latticekit/iso';

export const SEED = 0x63f1;

/** Tiles a side. 128 leaves real camera travel inside the diamond — see the sizing rule. */
export const W = 128;
export const H = 128;

/** Height units are integers 0–44 on an 8-bit grid; `stepPx` is the one conversion out. */
export const MAX_UNITS = 120;
export const STEP_PX = 8;
export const MAX_HEIGHT_PX = MAX_UNITS * STEP_PX;

/** Where the trees stop. */
export const TREELINE = 66;

/** The peak, and the far end of the trail. */
export const SUMMIT = { gx: 74, gy: 54 } as const;
const SUMMIT_GX = SUMMIT.gx;
const SUMMIT_GY = SUMMIT.gy;
const TRAIL_GX = 114;
const TRAIL_GY = 113;

function unitsAt(gx: number, gy: number): number {
  // One peak, one lower spur, and two scales of noise on top — the same three-scale rule the
  // sprites follow, applied to the land.
  const cone = Math.max(0, 1 - Math.hypot((gx - SUMMIT_GX) / 46, (gy - SUMMIT_GY) / 46)) ** 1.45;
  const spur = Math.max(0, 1 - Math.hypot((gx - 40) / 34, (gy - 96) / 30)) ** 1.8;
  // Ridged noise, scaled by the cone, so the spurs and gullies radiate from the peak instead
  // of being sprinkled evenly over a dome.
  const ridge = (1 - Math.abs(fbm2(SEED ^ 0x33, gx * 0.042, gy * 0.042, 3))) ** 2;
  const rough = fbm2(SEED, gx * 0.026, gy * 0.026, 4);
  const fine = fbm2(SEED ^ 0x11, gx * 0.062, gy * 0.062, 3);
  const u =
    MAX_UNITS * (cone * 0.72 + cone * ridge * 0.3 + spur * 0.22) + rough * 11 + fine * 1.4 + 3;
  return clamp(Math.round(u), 0, MAX_UNITS);
}

/** One value per grid VERTEX, so the grid is one wider than the tile map on each axis. */
export const heights = new TileGrid(W + 1, H + 1);
heights.fillFrom(unitsAt);

export const land: HeightField = { heights, stepPx: STEP_PX };

/** The camera's fence. A much smaller height than the framing rect, or the player can park the
 *  viewport in the sky above the far corner and still satisfy `keepVisible`. */
export const fenceRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
// Much smaller than the framing rect's height, deliberately. `tileBounds`' height argument
// extends `minY` upward, which is right for composing a shot and wrong for a fence: pass the
// summit here and the player can park the viewport in the sky above the far corner and still
// satisfy `keepVisible`.
tileBounds(0, 0, W, H, 300, fenceRect);

// ── the cost of crossing a tile, baked once ──────────────────────────────────────────
// Quadratic in steepness, which is what makes the route zigzag rather than charge the slope.
const walkCost = new Uint8Array(W * H);
for (let gy = 0; gy < H; gy++) {
  for (let gx = 0; gx < W; gx++) {
    const h0 = heights.get(gx, gy);
    const steep = Math.abs(heights.get(gx + 1, gy) - h0) + Math.abs(heights.get(gx, gy + 1) - h0);
    // Superlinear, not quadratic: quadratic made climbing so expensive that A* walked halfway
    // round the mountain to avoid it, which is a detour rather than a trail. This zigzags.
    walkCost[gy * W + gx] = clamp(1 + Math.round(steep ** 1.75 * 1.6), 1, 200);
  }
}

const cost: TileCost = (gx, gy) => {
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return 0;
  return walkCost[gy * W + gx] ?? 1;
};

// ── the trail ────────────────────────────────────────────────────────────────────────
export const trail = new Path(4096);
const finder = new PathFinder(W * H);
// Bounded to the flank facing the camera. Without it the cheapest route is a long contour
// round the back of the peak — correct, and not a mountain path anybody would walk up.
const found = finder.find(cost, TRAIL_GX, TRAIL_GY, SUMMIT_GX, SUMMIT_GY, trail, {
  bounds: { gx0: 46, gy0: 34, gx1: 126, gy1: 126 },
});
// Check the boolean WHERE the search happens: a failed search leaves an empty Path and
// `pathSample` throws on one, in the render loop, about arc length, a long way from here.
if (!found) throw new Error(`no route up the mountain: ${trail.searchFailure ?? 'unknown'}`);
pathSimplify(trail, cost);

/** Ground under a point on the trail, in world pixels. Bilinear, so a walker never steps. */
export function groundAt(gx: number, gy: number): number {
  return heightAt(land, gx, gy);
}

// ── trees, addressed by position so panning away and back finds the same forest ───────
export interface Tree {
  readonly gx: number;
  readonly gy: number;
  readonly zPx: number;
  readonly seed: number;
  readonly level: number;
}

export const trees: Tree[] = [];
for (let gy = 2; gy < H - 2; gy++) {
  for (let gx = 2; gx < W - 2; gx++) {
    const u = heights.get(gx, gy);
    if (u < 3 || u > TREELINE) continue;
    const r = toUnit(hash2(SEED ^ 0x7ee, gx, gy));
    // Thinning out toward the treeline reads as a real forest edge rather than a hard cut.
    const density = 0.05 + 0.13 * (1 - u / TREELINE) ** 1.4;
    if (r > density) continue;
    trees.push({
      gx: gx + toUnit(hash2(SEED ^ 0xa1, gx, gy)) * 0.6 - 0.3,
      gy: gy + toUnit(hash2(SEED ^ 0xb2, gx, gy)) * 0.6 - 0.3,
      zPx: heightAt(land, gx + 0.5, gy + 0.5),
      seed: hash2(SEED ^ 0xc3, gx, gy) >>> 0,
      level: 1 + (hash2(SEED ^ 0xd4, gx, gy) & 3),
    });
  }
}

/** Which tiles the trail runs over, for painting the track into the ground. */
export const onTrail = new Set<number>();
{
  const at: GridPoint = { gx: 0, gy: 0 };
  for (let s = 0; s <= trail.arcLength; s += 4) {
    pathSample(trail, s, at);
    // One tile of tread plus one neighbour, chosen by position: a full 3×3 stamp per sample
    // reads as a four-lane road rather than as something feet wore into a hillside.
    const gx = Math.floor(at.gx);
    const gy = Math.floor(at.gy);
    onTrail.add(gy * W + gx);
    const side = hash2(SEED ^ 0x2f, gx, gy) & 3;
    onTrail.add((gy + (side === 0 ? 1 : side === 1 ? -1 : 0)) * W + (gx + (side === 2 ? 1 : side === 3 ? -1 : 0)));
  }
}

/** The trail's own trodden width, so the ground under it reads as worn. */
export function isTrail(gx: number, gy: number): boolean {
  return onTrail.has(gy * W + gx);
}
