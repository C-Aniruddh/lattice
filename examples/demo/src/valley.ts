/**
 * The valley: one seed to a coast, a far range, two mountains, a river between them, a road over
 * both, and the stations along it.
 *
 * The landform is the composition. Two raised masses give the eye two anchors and turn the
 * ground between them into *distance*; the road becomes a road because it has something to climb.
 * Heights live on grid **vertices**, which is what lets adjacent tiles share their corners exactly
 * and is the whole reason `iso.height` samples the way it does.
 *
 * **It is written in `band` and `side`, not in `gx` and `gy`, and that is the whole of § Scale.**
 * A 2:1 projection puts `gx + gy` straight down the screen and `gx - gy` straight across it, so a
 * height field written in those two names is a field written in *screen* terms: a line of constant
 * `band` is horizontal, and a coast on one is a **horizon**. The rim this file used to carry fell
 * off at all four grid edges, which makes a diamond, and a diamond's two upper corners were the
 * 37% of the opening frame that was flat sea — the exact failure `docs/GALLERY.md` § Scale names.
 * Now the ground runs off the left, the right and the bottom of any frame that fits the road, and
 * the only edge in the picture is the one at the top, which is the sea meeting the sky.
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

/**
 * The map, in tiles. **96 rather than 64 is the whole of § Scale's extent row.**
 *
 * A 2:1 projection puts a `W × H` grid into `(W + H) · HALF_W` world pixels across, so 64 was a
 * 4,096-pixel world against a viewport that holds a little over 3,000 at the fitted zoom — 1.3×,
 * where the row asks for 1.6×, and a player who dragged found the edge. 96 is 6,144 and the edge
 * is four screens away in every direction but up, where the sea is.
 *
 * It is not free and the price is paid where the row says to pay it: the props loop below runs
 * over `W · H` once at boot, the terrain pass is bounded by the *camera* rather than by the map,
 * and every solid still goes through `DepthSorter.sort`'s cull, so the extra 5,000 tiles cost one
 * boot-time scan and nothing per frame.
 */
export const W = 96;
export const H = 96;
/** The town, near the summit of the low mass. */
export const GATE: GridPoint = { gx: 37, gy: 21 };
/** The shrine, on the peak, visible and lit from the first frame. */
export const SHRINE: GridPoint = { gx: 19, gy: 34 };
/**
 * Where the water ends, in `gx + gy`. A constant `band` is a horizontal line on screen, so this
 * one number is the height of the coast in the frame — and the far range stands just behind it.
 */
export const SHORE = 22;
/** Nearest `gx + gy` at which the far range is still bare. See {@link layRoad}. */
const FOREST_FROM = SHORE + 16;
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

/** The same curve as {@link dome} in one dimension: a range lying *across* the screen at `at`. */
function ridge(band: number, at: number, spread: number, h: number): number {
  const t = (band - at) / spread;
  const k = 1 - t * t;
  return k <= 0 ? 0 : h * k * k;
}

/**
 * Height in units at a grid vertex: a coast, a far range behind it, a peak and a lower town hill
 * either side of a river, and — far outside any opening frame — an edge the map falls off.
 *
 * Every term is Tier A arithmetic, and deliberately: this field feeds `PathFinder`, which decides
 * how many stations the road holds, which is a number the economy is playing for. `Math.exp` would
 * have been the natural shape for the range and is not available to a value that reaches a rule.
 */
function heightUnits(seed: number, gx: number, gy: number): number {
  const band = gx + gy;
  const side = gx - gy;
  // The river runs *across the screen's vertical*, so the two masses sit side by side and the
  // ground between them reads as distance rather than as a gap in the middle of one hill.
  const river = 20 / (1 + 0.5 * side * side);
  const coast = clamp01((band - SHORE) / 7);
  // The far range: the third distance band. Its crest is modulated along its own length so it
  // reads as a range rather than as a wall, and `sky.ts` washes it toward the sky from up here.
  const crest = 16 + noise2(seed ^ 0x71, side * 0.05, 0) * 14;
  const lumps = fbm2(seed, gx * 0.1, gy * 0.1, 4, 0.5) * 4;
  // The rolling term, and it is what makes 96 tiles *worth* having: without it the two domes sit
  // on a plain at a constant nine units and every tile the extent row bought is the same tile.
  // Its wavelength is longer than either dome's radius, so it reads as the valley having country
  // in it rather than as the domes having gained texture — and its **amplitude is a composition
  // decision, not a taste one**. At 15 units it out-voted the slope term in `cost` and the road
  // stopped contouring: the route came off the shrine straight down the screen and turned one
  // hard right angle, which is a route on a grid rather than a road over a hill. Six units is
  // what the two peaks still dominate.
  const rolling = fbm2(seed ^ 0x8c3, gx * 0.022, gy * 0.022, 3, 0.5) * 6;
  const land =
    9 +
    ridge(band, SHORE + 13, 16, crest) +
    dome(gx, gy, SHRINE.gx, SHRINE.gy, 15, 46) +
    dome(gx, gy, GATE.gx, GATE.gy, 13, 24) -
    river +
    rolling +
    lumps;
  // The other three grid edges also fall into the sea, but far enough out that no frame which
  // fits the road contains one: it is there so a player who drags to the clamp finds a coast
  // rather than a cut, and for no other reason.
  const edge = clamp01(Math.min(gx, gy, W - gx, H - gy) / 4);
  return Math.max(0, Math.round(land * coast * coast * edge));
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
  // The same cost function the search used, which is now what `pathSimplify` wants: it pulls
  // only where the straight line is no worse than the ground the route was already on, so the
  // contours survive. Passing a stricter predicate — "cheap ground only" — was the workaround,
  // and it kept the shape by refusing nearly every shortcut: five nodes here, twenty then.
  pathSimplify(v.road, v.cost);
  v.stations = Math.max(1, Math.floor(v.road.arcLength / SPACING));

  const here: GridPoint = { gx: 0, gy: 0 };
  v.props = [];
  for (let gy = 1; gy < H - 1; gy++) {
    for (let gx = 1; gx < W - 1; gx++) {
      const t = v.terrain.get(gx, gy);
      if (t === SEA || t === RIVER) continue;
      // Nothing is planted on the far range. It is the third distance band, `sky.ts` washes it
      // most of the way into the sky, and a fully saturated tree standing on hazed ground is the
      // one thing that makes a distant hill read as a near hill somebody shrank.
      if (gx + gy < FOREST_FROM) continue;
      // Density varies across the valley rather than being uniform, which is what stops a scatter
      // from reading as a scatter: woods on the shoulders, open meadow between them.
      // § Scale's density row asks for hundreds and the mean here is what buys them: about half
      // of the grass and a sixth of the scree, over a map with 2.25× the tiles it had. The number
      // that matters is not this one but what survives `DepthSorter.sort`'s cull — most of this
      // wood is off-screen at any one time, which is the point of having bought the extent first.
      const density = (noise2(v.seed ^ 0x2d, gx * 0.07, gy * 0.07) * 0.5 + 0.5) * (t === SCREE ? 0.22 : 0.56) + 0.02;
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
  // The tallest ground, measured rather than guessed: it is `Passes.maxHeightPx`, which is the
  // margin `renderFrame` adds to the Terrain cull **on all four sides**. A constant that is
  // comfortably too big is three extra rings of tiles on every frame forever, and this map is
  // 64 × 64 — the constant that used to be here claimed 72 units against an actual 60.
  let tallest = 0;
  heights.fillFrom((gx, gy) => {
    const h = heightUnits(seed, gx, gy);
    if (h > tallest) tallest = h;
    return h;
  });
  const field: HeightField = { heights, stepPx: STEP_PX };
  const terrain = new TileGrid(W, H, { bits: 8, outOfBounds: SEA });
  terrain.fillFrom((gx, gy) => {
    const h = heights.get(gx, gy);
    // Water past the shore is *sea*, which `cost` refuses; water inside the land is the river,
    // which the road may ford at a price. Telling them apart by `band` rather than by distance to
    // a grid edge is what stops the pathfinder walking out across the bay.
    const inland = gx + gy > SHORE + 6 && Math.min(gx, gy, W - gx, H - gy) > 6;
    if (h <= 1) return inland ? RIVER : SEA;
    if (h <= 2 && inland) return RIVER;
    // An organic snow-line rather than a hard threshold, or the boundary speckles. It drops on the
    // far range, which carries no scenery at all: bare grass at that distance is a green smear, and
    // rock against grass is the one tonal difference that survives the haze.
    const line = (gx + gy < FOREST_FROM ? 25 : 38) + noise2(seed ^ 0x4a, gx * 0.16, gy * 0.16) * 9;
    return h > line || slopeAt(field, gx, gy) > STEP_PX * 7.4 ? SCREE : GRASS;
  });
  // **Sand rings the sea and not the river**, and the difference is the whole middle of the frame.
  // It used to ring both, which put a two-tile band of beach down every bank of a river that runs
  // the height of the screen — and against the grass that band reads as a row of pale teeth rather
  // than as a shore. A river with grass to the water is a river; the beach belongs where the map
  // ends.
  const shore = new TileGrid(W, H, { bits: 8, outOfBounds: 0 });
  shore.fillFrom((gx, gy) => {
    const t = terrain.get(gx, gy);
    if (t === SEA || t === RIVER || heights.get(gx, gy) > 6) return 0;
    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        if (terrain.get(gx + k, gy + j) === SEA) return 1;
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
    maxHeightPx: tallest * STEP_PX,
    stations: 1,
  };
  layRoad(v);
  return v;
}
