/**
 * The place: a near coast, the channel off it, and the range on the far side of the water.
 *
 * **This is logic, and it is deliberately the smallest module here** — everything it exists for
 * is art. It answers three questions and refuses every other: how high is the ground at this
 * vertex, how far above or below the waterline is this one, and where do the trees stand. What
 * color a tile is, what a tree looks like and what the sky is doing are `ground.ts`, `trees.ts`
 * and `sky.ts`, none of which this file knows about.
 *
 * ## The composition is a landform decision, so it lives here
 *
 * The draft this replaces was a single dome in the middle of a disc of sea: a *diorama*, with
 * visible corners on four sides and two thirds of the opening frame spent on water and sky. The
 * fix is not a camera setting, it is the shape of the world. So this file is written in the two
 * coordinates the **screen** has rather than the two the grid has:
 *
 * | | | runs |
 * |---|---|---|
 * | `u` | `(gx − gy) / 2` | across the frame. World x is `u · TILE_W` |
 * | `v` | `(gx + gy) / 2` | into it — down the screen, toward the viewer. World y is `v · TILE_H` |
 *
 * Every landform below is a function of those two, which is what lets a *horizon* exist in a
 * projection that has none: {@link SKY_V} is a line of constant `v`, so it is a horizontal line
 * on screen at every zoom and from every camera position, and the four bands of the picture —
 * sky, the far range, the channel, the near island — are four intervals of one number.
 *
 * The grid is a square and the picture is a wide strip, so most of the grid is never generated
 * and never drawn. That is the trade: a rectangular grid projects to a *diamond*, and the only
 * way to get a strip out of one is to use the middle of it and let the corners go unvisited. The
 * camera's bounds in `main.ts` are what keep them off screen, and they are chosen against the
 * inequalities `|u| ≤ v` and `|u| ≤ W − v` that say where the diamond actually is.
 *
 * ## The decision the rest of the exhibit rests on
 *
 * **The seabed is stored signed and continuous, not as a terrain class.** A tile's whole
 * identity — deep water, lagoon, wet sand, dune, meadow, bare rock — is a band of one number, so
 * the shoreline is a *contour* rather than a relationship between neighbours. That is what lets
 * `ground.ts` draw surf at `|bed| < 1` and a lagoon gradient at `bed < 0` with no distance
 * transform, no flood fill and no second grid.
 *
 * ## Two things `iso` decides and this file obeys
 *
 * Heights live on grid **vertices**, so adjacent tiles share their corners exactly and
 * `isoTerrain` cannot leave a seam between them. And a tree's ground elevation comes from
 * `footprintBase`, so the sprite, its shadow and its depth key are handed one number rather than
 * three that can drift.
 */
import { clamp01, fbm2, hash2, hashString, noise2, toUnit } from '@latticekit/core';
import { TILE_H, TileGrid, footprintBase, slopeAt, type HeightField } from '@latticekit/iso';
import type { Variant } from '@latticekit/draw';

export const W = 240;
export const H = 240;
/** World pixels per height unit: a quarter of a tile's depth. Fine enough that a beach ramp is
 *  a ramp rather than a step, coarse enough that a 44-unit peak is a real mountain. */
export const STEP_PX = TILE_H / 4;
/** A `TileGrid` cell is unsigned and a seabed is not, so every stored bed value carries this
 *  bias. Read it back through {@link bedAt} and never off the grid directly. */
const BIAS = 40;

/**
 * The four bands of the picture, as intervals of `v`. See the header for what `v` is.
 *
 * `SKY_V` is the horizon: nothing is drawn above it, so it is the only edge of the world a viewer
 * can ever see, and it is a straight horizontal line with a sky above it rather than a corner with
 * a background behind it. How far in front of it the air stops tinting is `ground.ts`'s to decide,
 * because it is a question about paint rather than about landform.
 */
export const SKY_V = 93;
/** Mean `v` of the far range's near shore, before the two noise terms bend it. */
const FAR_V = 98.5;
/** Mean `v` of the near island's shoreline, and the line the art measures its own bands from.
 *  The channel is the gap between this and {@link FAR_V}. */
export const MAIN_V = 103.6;
/** The tallest thing the terrain cull has to margin for, in world pixels. */
export const MAX_HEIGHT_PX = 62 * STEP_PX;

/** One standing thing. `kind` indexes `trees.ts`'s species; nothing else reads it. */
export interface Tree {
  readonly gx: number;
  readonly gy: number;
  readonly kind: number;
  /** Per-instance identity, so a tree's lean and its sway are *that* tree's on every reload. */
  readonly v: Variant;
  /** Ground under the footprint in world pixels — what `drawSprite` and `DepthSorter.add` are
   *  each handed, so the picture and the sort cannot disagree about which hill this is on. */
  readonly base: number;
}

export interface Island {
  readonly seed: number;
  /** Signed seabed on vertices, biased. Read through {@link bedAt}. */
  readonly bed: TileGrid;
  readonly field: HeightField;
  readonly trees: readonly Tree[];
}

/** Height above — or depth below — the waterline at a grid vertex, in units. Signed. */
export function bedAt(island: Island, gx: number, gy: number): number {
  return island.bed.get(gx, gy) - BIAS;
}

/** A smooth dome: `h` at the center, zero at `r`, and flat where it meets the ground. */
function dome(u: number, v: number, cu: number, cv: number, r: number, h: number): number {
  const k = 1 - ((u - cu) * (u - cu) + (v - cv) * (v - cv)) / (r * r);
  return k <= 0 ? 0 : h * k * k;
}

/** Cubic smoothstep on an already-clamped ramp. Every shore in this file uses it, because a
 *  linear one leaves a crease along the top of the beach that reads as a lighting bug. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The seabed at one vertex, in units, signed about the waterline.
 *
 * Two coastlines and everything between them. Each shore is a line of constant `v` bent by two
 * scales of noise in `u` — one long enough to cut a bay, one short enough to roughen a headland
 * — and each landmass ramps up from its own shore so the sand is wide enough to see. Where
 * neither is above water the depth comes from the distance to the *nearer* of the two shores, so
 * the channel is deepest down its middle and shelves at both edges with no second field.
 *
 * Six domes carry the relief, and only two of them are on screen at the opening frame. That is
 * deliberate: the summit is off the bottom-right corner and the headlands are off both sides, so
 * the first thing a visitor learns about this world is that they are not looking at all of it.
 */
function bedUnits(seed: number, gx: number, gy: number): number {
  const u = (gx - gy) * 0.5;
  const v = (gx + gy) * 0.5;
  // Above the horizon and far behind the near island nothing is ever drawn, and the noise below
  // is the expensive half of generation. Skipped rather than computed and discarded.
  if (v < SKY_V - 10 || v > 196) return -26;
  const farShore = FAR_V + noise2(seed ^ 0x11, u * 0.026, 0.3) * 3 + noise2(seed ^ 0x12, u * 0.075, 1.7) * 0.7;
  const ridge = 6.5 + noise2(seed ^ 0x13, u * 0.042, 4.1) * 7.5 + fbm2(seed ^ 0x14, u * 0.055, 2.6, 2, 0.5) * 4;
  const far = ease(clamp01((farShore - v) / 2.6)) * Math.max(1.2, ridge);
  const mainShore = MAIN_V + noise2(seed ^ 0x21, u * 0.023, 2.4) * 2.8 + noise2(seed ^ 0x22, u * 0.08, 5.9) * 1.2;
  const relief = dome(u, v, 26, 133, 25, 45) + dome(u, v, -9, 117, 13, 22) + dome(u, v, -35, 109, 11, 15) +
    dome(u, v, 61, 122, 17, 27) + dome(u, v, -64, 128, 19, 31) + dome(u, v, 5, 168, 30, 40) + fbm2(seed ^ 0x31, u * 0.05, v * 0.05, 4, 0.5) * 9 + fbm2(seed ^ 0x32, u * 0.15, v * 0.15, 3, 0.5) * 3;
  // The inland rise. Without it the shore ramp settles at its own base height and the whole
  // near island is one enormous beach — which is what the first build of this coast shipped,
  // and it reads as a sandbar the size of the frame rather than as an island with a shore on it.
  const inland = clamp01((v - mainShore - 1.4) / 9) * 7;
  const main = ease(clamp01((v - mainShore) / 3.2)) * Math.max(0.5, 1.4 + inland + relief);
  // One broken chain of rock and sand out on the near island's own shelf, where a viewer is close
  // enough to see it is rock. A noise field minus a threshold is what makes it a *chain* with gaps
  // in it rather than a row of evenly spaced dots. There was a second chain off the far shore and
  // it is gone: at that distance a scatter of one-tile islands is not an archipelago, it is a
  // dither pattern along the horizon, and it was most of what made the far band read as a swatch.
  const land = Math.max(far, main, clamp01(1.5 - Math.abs(v - mainShore + 2.1)) * (noise2(seed ^ 0x42, u * 0.19, 3.1) - 0.4) * 10);
  if (land > 0.02) return land;
  const toShore = Math.min(v - farShore, mainShore - v);
  return Math.max(-18, -0.3 - toShore * 1.6);
}

/**
 * Generate. Once, at boot, from the seed the URL chose.
 *
 * The tree scatter varies its *density* across the island rather than its threshold, which is
 * what stops a scatter from reading as a scatter: closed woods on the sheltered flanks, open
 * meadow between them, bare rock above the treeline and on anything steeper than a walk. It is
 * bounded to the strip the camera can reach — a wood generated under the diamond's corners is
 * a few thousand objects that are re-culled every frame and seen by nobody.
 */
export function createIsland(seedText: string): Island {
  const seed = hashString(seedText);
  const bed = new TileGrid(W + 1, H + 1, { bits: 8 });
  bed.fillFrom((gx, gy) => Math.min(255, Math.max(0, Math.round(bedUnits(seed, gx, gy)) + BIAS)));
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  heights.fillFrom((gx, gy) => Math.max(0, bed.get(gx, gy) - BIAS));
  const field: HeightField = { heights, stepPx: STEP_PX };
  const trees: Tree[] = [];
  for (let gy = 1; gy < H; gy++) {
    for (let gx = 1; gx < W; gx++) {
      const v = (gx + gy) * 0.5;
      // Nothing is planted across the channel: at this scale a sprite is a sprite, `iso` is an
      // orthographic projection and will not shrink one, and a full-size palm on the far range is
      // the single fastest way to throw away the depth the haze just bought. `|gx − gy| ≤ 156` is
      // `|u| ≤ 78` with the halving cancelled out of a comparison run 57,600 times.
      if (v < MAIN_V - 1 || v > 172 || Math.abs(gx - gy) > 156) continue;
      const e = bed.get(gx, gy) - BIAS;
      if (e < 1.2 || e > 46 || slopeAt(field, gx, gy) > STEP_PX * 4.6) continue;
      const wood = Math.max(0, noise2(seed ^ 0x2d, gx * 0.055, gy * 0.055) + 0.28);
      if (toUnit(hash2(seed ^ 0x7ee, gx, gy)) > 0.08 + wood * wood * 1.3) continue;
      const pick = toUnit(hash2(seed ^ 0x1b3, gx, gy));
      // Palms and scrub on the low shore, mixed wood in the middle, pine and bare rock up top.
      const kind = e < 5 ? (pick < 0.58 ? 0 : pick < 0.9 ? 3 : 4)
        : e < 27 ? (pick < 0.46 ? 1 : pick < 0.74 ? 2 : pick < 0.94 ? 3 : 4) : pick < 0.68 ? 2 : 4;
      const variant: Variant = { level: 1, seed: hash2(seed, gx, gy), flags: 0, progress: 1, label: '' };
      trees.push({ gx, gy, kind, v: variant, base: footprintBase(field, { gx, gy, w: 1, d: 1 }) });
    }
  }
  return { seed, bed, field, trees };
}
