/**
 * The hillside: one seed to a terraced height field, and the things standing on it.
 *
 * **This is logic, and it is deliberately the smaller half of the exhibit.** It answers three
 * questions and refuses every other: how high is the ground at this vertex, how much does the
 * ground fall across this tile, and where do the props stand. What a terrace *looks* like — the
 * crop rows, the wall courses, the flooded paddies, the water stepping down through them — is
 * `fields.ts`, which this file knows nothing about.
 *
 * ## The one decision the exhibit rests on
 *
 * **Elevation is quantized before it is stored, not after.** The continuous landform — a slope
 * with spurs and gullies fbm'd into it — is rounded to a whole multiple of {@link RISE} at every
 * vertex, and *that* is what goes in the grid. Two consequences, and both are the exhibit:
 *
 * - Any tile whose four corners agree is exactly flat, so a terrace is a genuine plateau rather
 *   than a slope that happens to be gentle. `isoTerrain` draws it as one unbroken quad, and crop
 *   rows drawn on it lie down instead of tilting.
 * - Any tile whose corners disagree is a **bank**, one terrace step tall and one tile deep, and
 *   {@link riseAt} finds it with four array reads. That is the whole of how the retaining walls
 *   are located: no edge detection, no second grid, no marking pass. A hillside's walls are a
 *   property of its heights, and a quantized heightfield states it.
 *
 * Rounding *after* sampling — terracing a smooth field at draw time — would have given the same
 * picture and none of this, because `screenToTileOnHeights` marches the field that is *stored*.
 * Picking would then have been solved against a hill nobody could see.
 *
 * ## Two things `iso` decides and this file obeys
 *
 * Heights live on grid **vertices**, so adjacent tiles share their corners exactly and
 * `isoTerrain` cannot leave a seam between them — which is why the grid is `W + 1` wide. And a
 * prop's ground elevation comes from `footprintBase`, so the sprite and its depth key are handed
 * one number rather than two that can drift apart on a bank.
 *
 * `Hill` carries the same grid twice, as `field.heights` and as `grid`, and that is a kit gap
 * rather than a slip: `HeightField.heights` is typed `TileSource`, which is the read-only surface
 * — `get` and `has` — while the Terrain pass walks a range with `TileGrid.forEach`, which is on
 * the class and not on the interface. A game with a heightfield therefore cannot iterate it
 * through the type the heightfield hands it. See the README.
 */
import { fbm2, hash2, hashString, noise2, toUnit } from '@lattice/core';
import { TILE_H, TileGrid, footprintBase, type HeightField } from '@lattice/iso';

/** Tiles across, and the same down. Sized so the world box is roughly four times the viewport on
 *  its long axis at the opening zoom, with the hill leaving every edge of the frame. */
export const W = 160, H = 160;
/** World pixels per height unit — a quarter of a tile's depth, the value `iso` suggests. */
export const STEP_PX = TILE_H / 4;
/**
 * Height units between one terrace and the next: four, so a wall stands a whole `TILE_H` tall and
 * reads as something you would need steps to get down. Below three it is a plough furrow.
 *
 * It also sets two things that are easy to tune one at a time and get jointly wrong. With
 * {@link FALL} it fixes how many terraces fit in a frame — `RISE / FALL` tiles per step, about
 * seven steps across 1440 px, which is where a hillside reads as stepped without reading as
 * corduroy. And it fixes what **fraction of the map is wall**: a tile is a bank when its corners
 * straddle a step, so that fraction is roughly `|∇h| / RISE`, and a wall is drawn `RISE · STEP_PX`
 * tall against a tile only `TILE_H` deep — so it covers about two and a half times its share of
 * the screen. At `RISE = 3` this measured 40% of tiles and the hillside came out muddy and slow
 * for the same reason. At 4 it is 31%.
 */
export const RISE = 4;
/** Units of elevation at the far corner of the map, before the landform noise, and units lost per
 *  tile of `gx + gy` — the axis running toward the viewer. `CREST / FALL` is where the hill runs
 *  out into a flat valley floor, deliberately a little beyond the near edge of the map so that
 *  dragging downhill arrives somewhere rather than at a wall of grid. */
const CREST = 178, FALL = 0.65;
/** The tile the camera opens on, on both axes, chosen so its ground stands about 250 world pixels
 *  up: the opening frame's picking error is then the same 200-odd pixels Lamp Road measured by
 *  hand, and there is a further 1,100 px of hill above it for a visitor who drags up to see the
 *  error triple. Far enough from every edge that the opening frame is all hillside. */
export const OPEN_AT = 113;

/** One standing thing. `kind` indexes `props.ts`'s shapes and nothing else reads it; `v` is
 *  per-instance identity, so a tree's lean is *that* tree's on every reload; `base` is the ground
 *  under the footprint in world pixels, from `footprintBase`, so the sprite and the depth key are
 *  handed one number rather than two that can drift apart on a bank. */
export interface Prop {
  readonly gx: number; readonly gy: number; readonly kind: number; readonly v: number; readonly base: number;
}

/** `maxHeightPx` is both the margin `renderFrame`'s terrain cull needs and the ceiling the terrain
 *  march starts from — one number, because two would be a picking bug you can only see at the
 *  summit, on the one seed in five that has one. */
export interface Hill {
  readonly seed: number; readonly field: HeightField; readonly grid: TileGrid;
  readonly props: readonly Prop[]; readonly maxHeightPx: number;
}

/**
 * How far the ground falls across tile `(gx, gy)`, in height units: `0` on a terrace, {@link RISE}
 * on a bank.
 *
 * Four reads and two comparisons rather than `iso.slopeAt`, which answers in world pixels and in
 * the *steepest edge* — the right answer for a movement cost, and one conversion too many for a
 * question whose whole vocabulary is terrace steps.
 */
export function riseAt(field: HeightField, gx: number, gy: number): number {
  const h = field.heights;
  const a = h.get(gx, gy), b = h.get(gx + 1, gy), c = h.get(gx + 1, gy + 1), d = h.get(gx, gy + 1);
  return Math.max(Math.max(a, b), Math.max(c, d)) - Math.min(Math.min(a, b), Math.min(c, d));
}

/** The landform before it is terraced, in units. A straight fall down `gx + gy`, bent by two
 *  scales of noise so the contours curve into spurs and gullies instead of running dead straight
 *  across the screen — which is what makes the walls read as following a hill. */
function landform(seed: number, gx: number, gy: number): number {
  return CREST - (gx + gy) * FALL + fbm2(seed, gx * 0.017, gy * 0.017, 4, 0.5) * 14
    + noise2(seed ^ 0x51, gx * 0.075, gy * 0.075) * 2.4;
}

/**
 * Generate. Once, at boot, from the seed the URL chose.
 *
 * The prop scatter is denser on the banks than on the fields, which is the one thing that makes a
 * terraced hill read as farmed rather than as a heightmap: the flat ground is *worked*, and the
 * unworkable strip between two levels is where everything woody survives.
 */
export function createHill(seedText: string): Hill {
  const seed = hashString(seedText);
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  heights.fillFrom((gx, gy) => {
    const level = Math.round(landform(seed, gx, gy) / RISE) * RISE;
    return level < 0 ? 0 : level > 212 ? 212 : level;
  });
  const field: HeightField = { heights, stepPx: STEP_PX };
  const props: Prop[] = [];
  for (let gy = 1; gy < H - 1; gy++) {
    for (let gx = 1; gx < W - 1; gx++) {
      const bank = riseAt(field, gx, gy) > 0, grove = noise2(seed ^ 0x2d, gx * 0.05, gy * 0.05);
      if (toUnit(hash2(seed ^ 0x7ee, gx, gy)) > (bank ? 0.3 + grove * 0.26 : 0.05 + grove * 0.05)) continue;
      // Hedgerow scrub and trees on the banks; sheds, stooks and hedges out on the flat.
      const pick = toUnit(hash2(seed ^ 0x1b3, gx, gy));
      const kind = bank ? (pick < 0.62 ? 0 : 1) : pick < 0.42 ? 2 : pick < 0.8 ? 3 : 1;
      props.push({ gx, gy, kind, v: hash2(seed, gx, gy), base: footprintBase(field, { gx, gy, w: 1, d: 1 }) });
    }
  }
  return { seed, field, grid: heights, props, maxHeightPx: 184 * STEP_PX };
}
