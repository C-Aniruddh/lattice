/**
 * The valley: one seed to two mountains, a river between them, a road over both, and the
 * stations along it.
 *
 * The landform is the composition. Two raised masses give the eye two anchors and turn the
 * ground between them into *distance*; the road becomes a road because it has something to climb.
 * Heights live on grid **vertices**, which is what lets adjacent tiles share their corners exactly
 * and is the whole reason `iso.height` samples the way it does.
 *
 * The road is *found*, never authored — `PathFinder` over a cost that combines terrain with slope
 * — so it contours around the steep ground rather than climbing straight up it.
 */
import { clamp01, fbm2, hash2, hashString, noise2, toUnit } from '@lattice/core';
import {
  Path,
  PathFinder,
  TILE_H,
  TileGrid,
  pathProject,
  pathSample,
  pathSimplify,
  slopeAt,
  type GridPoint,
  type HeightField,
  type TileCost,
  type TileRange,
} from '@lattice/iso';

export const W = 40;
export const H = 40;
/** The town, near the summit of the low mass. */
export const GATE: GridPoint = { gx: 25, gy: 9 };
/** The shrine, on the peak, visible and lit from the first frame. */
export const SHRINE: GridPoint = { gx: 7, gy: 22 };
/** World pixels between lamp stations. The road is measured in these and so is the economy. */
export const SPACING = 96;
export const STEP_PX = TILE_H / 4;
export const SEA = 0;
export const GRASS = 1;
export const SCREE = 2;
export const RIVER = 3;
const BOUNDS: TileRange = { gx0: 0, gy0: 0, gx1: W, gy1: H };

/** Scenery. `kind` is 0 spire, 1 crown, 2 snag, 3 bush, 4 boulder. */
export interface Prop {
  readonly gx: number;
  readonly gy: number;
  readonly kind: number;
  readonly big: boolean;
}

export interface Valley {
  readonly seed: number;
  readonly heights: TileGrid;
  readonly terrain: TileGrid;
  /** 1 where dry land touches water: the ring of sand. */
  readonly shore: TileGrid;
  readonly field: HeightField;
  readonly road: Path;
  readonly cost: TileCost;
  readonly maxHeightPx: number;
  props: Prop[];
  /** How many lamp stations the road holds. */
  stations: number;
}

/** A smooth dome: `h` at the center, zero at `r`, and flat where it meets the ground. */
function dome(gx: number, gy: number, cx: number, cy: number, r: number, h: number): number {
  const dx = gx - cx;
  const dy = gy - cy;
  const d2 = (dx * dx + dy * dy) / (r * r);
  if (d2 >= 1) return 0;
  const k = 1 - d2;
  return h * k * k;
}

/**
 * Height in units at a grid vertex: a peak in the north, a lower town hill in the south, a river
 * in the trough between them, and a rim that falls into the sea so the island has a shore.
 */
function heightUnits(seed: number, gx: number, gy: number): number {
  // The river runs *across the screen's vertical*, so the two masses sit side by side and the
  // ground between them reads as distance rather than as a gap in the middle of one hill.
  const bank = gx - gy;
  const river = 20 / (1 + 0.3 * bank * bank);
  const rim = clamp01(Math.min(gx, gy, W - gx, H - gy) / 5);
  const lumps = fbm2(seed, gx * 0.1, gy * 0.1, 4, 0.5) * 4;
  const land = 9 + dome(gx, gy, 7, 22, 15, 46) + dome(gx, gy, 25, 9, 13, 24) - river + lumps;
  return Math.max(0, Math.round(land * rim * rim));
}

/** Find the road, count its stations, and scatter the scenery around it. */
export function layRoad(v: Valley): void {
  const finder = new PathFinder(4096);
  if (!finder.find(v.cost, GATE.gx, GATE.gy, SHRINE.gx, SHRINE.gy, v.road, { bounds: BOUNDS })) {
    // A failed search clears the path, and an empty `Path` throws from `pathProject` rather than
    // answering — so a seed whose river cuts the island in two must not reach the frame loop.
    v.road.push(GATE.gx, GATE.gy);
    v.road.push(SHRINE.gx, SHRINE.gy);
  }
  // `pathSimplify` string-pulls through anything merely *passable*, which throws away the
  // weighted route it was just handed. Pulling against "cheap ground only" keeps the contours.
  pathSimplify(v.road, (gx, gy) => (v.cost(gx, gy) === 1 ? 1 : 0));
  v.stations = Math.max(1, Math.floor(v.road.arcLength / SPACING));

  const here: GridPoint = { gx: 0, gy: 0 };
  v.props = [];
  for (let gy = 1; gy < H - 1; gy++) {
    for (let gx = 1; gx < W - 1; gx++) {
      const t = v.terrain.get(gx, gy);
      if (t === SEA || t === RIVER) continue;
      // Density varies across the valley rather than being uniform, which is what stops a scatter
      // from reading as a scatter: woods on the shoulders, open meadow between them.
      const density = (noise2(v.seed ^ 0x2d, gx * 0.07, gy * 0.07) * 0.5 + 0.5) * (t === SCREE ? 0.06 : 0.2) + 0.01;
      if (toUnit(hash2(v.seed ^ 0x7ee, gx, gy)) > density) continue;
      pathSample(v.road, pathProject(v.road, gx, gy), here);
      if (Math.abs(here.gx - gx) + Math.abs(here.gy - gy) < 3) continue;
      const pick = toUnit(hash2(v.seed ^ 0x1b3, gx, gy));
      const kind = t === SCREE ? (pick < 0.86 ? 4 : 2) : pick < 0.42 ? 0 : pick < 0.72 ? 1 : pick < 0.97 ? 3 : 2;
      v.props.push({ gx, gy, kind, big: toUnit(hash2(v.seed ^ 0x55, gx, gy)) < 0.3 });
    }
  }
}

/** Grid position of lamp station `i`, into `out`. Station 0 is the first one out of the gate. */
export function stationAt(v: Valley, i: number, out: GridPoint): GridPoint {
  return pathSample(v.road, Math.min((i + 1) * SPACING, v.road.arcLength), out);
}

export function createValley(seedText: string): Valley {
  const seed = hashString(seedText);
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  heights.fillFrom((gx, gy) => heightUnits(seed, gx, gy));
  const field: HeightField = { heights, stepPx: STEP_PX };
  const terrain = new TileGrid(W, H, { bits: 8, outOfBounds: SEA });
  terrain.fillFrom((gx, gy) => {
    const h = heights.get(gx, gy);
    const inland = Math.min(gx, gy, W - gx, H - gy) > 6;
    if (h <= 1) return inland ? RIVER : SEA;
    if (h <= 3 && inland) return RIVER;
    // An organic snow-line rather than a hard threshold, or the boundary speckles.
    const line = 38 + noise2(seed ^ 0x4a, gx * 0.16, gy * 0.16) * 9;
    return h > line || slopeAt(field, gx, gy) > STEP_PX * 6.2 ? SCREE : GRASS;
  });
  const shore = new TileGrid(W, H, { bits: 8, outOfBounds: 0 });
  shore.fillFrom((gx, gy) => {
    const t = terrain.get(gx, gy);
    if (t === SEA || t === RIVER || heights.get(gx, gy) > 6) return 0;
    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        const n = terrain.get(gx + k, gy + j);
        if (n === SEA || n === RIVER) return 1;
      }
    }
    return 0;
  });
  const cost: TileCost = (gx, gy) => {
    if (!terrain.has(gx, gy)) return 0;
    const t = terrain.get(gx, gy);
    if (t === SEA) return 0;
    // Slope is the terrain half of the cost, so the road contours instead of climbing straight;
    // the river is passable at a price, which is what makes the crossing land where it does.
    return (t === RIVER ? 7 : 1) + (((slopeAt(field, gx, gy) * 7) / STEP_PX) | 0);
  };
  const v: Valley = {
    seed,
    heights,
    terrain,
    shore,
    field,
    cost,
    road: new Path(256),
    props: [],
    maxHeightPx: 72 * STEP_PX,
    stations: 1,
  };
  layRoad(v);
  return v;
}
