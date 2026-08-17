/**
 * The cave: one seed to a floor, the rock around it, and every place a light can stand.
 *
 * **This is logic, and it is deliberately the smallest module in the exhibit.** It answers four
 * questions and refuses every other: how high is the rock at this vertex, is this tile floor or
 * wall, what is standing on it, and where may a flame be put down. What any of it *looks* like is
 * `rock.ts`, `formations.ts` and `ambient.ts`, none of which this file knows about.
 *
 * ## The cave is a contour of one field, not a set of tile classes
 *
 * One signed number per vertex decides everything. Above zero is open floor; below zero is rock,
 * and how far below zero is how tall the rock stands. That is what makes a wall *rise out of* the
 * floor over three or four tiles instead of standing on it as a cliff, and it is what lets
 * `rock.ts` put water in the low ground by reading a contour rather than by flood-filling
 * anything.
 *
 * The field is two terms and the `max` of them, which is the cheapest way to get both shapes a
 * cave needs. `veins` is a **ridged** noise — the zero contour of an fbm, thresholded — and gives
 * winding passages that join and fork. `rooms` is a plain low-frequency fbm and gives chambers.
 * Neither alone reads as a cave: passages alone are a maze, chambers alone are blobs.
 *
 * ## Why the flames are a fixed list and not a spawn
 *
 * {@link Cavern.flames} is the eight braziers followed by 300 pre-chosen, hash-shuffled floor
 * tiles, and the exhibit's "light 100 more" control is a single integer saying how many of them
 * are burning. Nothing is allocated when the visitor presses it, nothing is random at press time,
 * and `?seed=` therefore fixes not only the cave but the exact hundred tiles that light up —
 * which is what "same seed, same world" has to mean for a control that adds things to the world.
 *
 * The shuffle is load-bearing rather than tidy. Scanned in grid order the first hundred spots are
 * all in the first few rows, so "light 100 more" would light the northern strip and leave the
 * rest black. Ordering them by a hash of their own coordinates spreads the first hundred over the
 * whole cave, deterministically, for one comparator.
 */
import { fbm2, hash2, hashString, smoothstep, toUnit } from '@latticekit/core';
import { TILE_H, TileGrid, footprintBase, slopeAt, type HeightField } from '@latticekit/iso';
import type { Variant } from '@latticekit/draw';

/** The grid. 128 square is 8,192 × 4,336 world pixels — more than five times the long axis of a
 *  1440-wide viewport, which is `docs/GALLERY.md` § Scale's extent row with room to spare. */
export const W = 128;
export const H = 128;
/** World pixels per height unit. A quarter of a tile's depth, as on the island: fine enough that
 *  a floor swell is a swell, coarse enough that a 24-unit wall is a wall. */
export const STEP_PX = TILE_H / 4;
/** The chamber the exhibit opens in. The art measures its drip field outward from here, so a
 *  second copy of these two numbers anywhere else is a cave that fades off-center. */
export const CX = 64;
export const CY = 64;
/** How many torches the cave has room for, and how many braziers are always alight. */
export const TORCHES = 300;
export const BRAZIERS = 8;
/** Wall height in units above the floor it grows out of. */
const RIDGE = 24;

/**
 * One thing standing on the floor.
 *
 * | field | what it is |
 * |---|---|
 * | `kind` | indexes `formations.ts`'s five shapes. Nothing else reads it |
 * | `v` | per-instance identity, so this stalagmite's lean is *its* lean on every reload |
 * | `base` | ground under the footprint in world pixels — the one number `drawSprite` and `DepthSorter.add` are both handed, so the picture and the sort cannot disagree about which shelf this is on |
 */
export interface Formation {
  readonly gx: number; readonly gy: number; readonly kind: number;
  readonly v: Variant; readonly base: number;
}

/**
 * A light standing in the cave. The first {@link BRAZIERS} entries of {@link Cavern.flames} are
 * `big` and always burning; the rest are torches the visitor lights.
 *
 * `base` is the ground under it in world pixels, which is exactly what `LightField.add` wants for
 * its own third argument — the field pools light on the floor *under* a fixture, so a torch on a
 * shelf lights the shelf. `phase` is the gutter offset, so three hundred flames do not flicker in
 * lockstep.
 */
export interface Flame {
  readonly gx: number; readonly gy: number; readonly base: number;
  readonly big: boolean; readonly phase: number;
}

/**
 * Everything that goes into the frame's one sorted order.
 *
 * A union at the bucket rather than two buckets, because there is **one sorted list in the kit**:
 * a torch standing in front of a column has to be painted after it, and two lists cannot express
 * that no matter how carefully they are interleaved. `Bucket<T>` is generic precisely so this can
 * be `Formation | Flame` without `DepthSorter` being told.
 */
export type Lit = Formation | Flame;

/** The generated world. `open` is 1 where the tile is floor; read it through {@link openAt}.
 *  `maxHeightPx` is the margin `renderFrame`'s terrain cull needs, or a wall vanishes the moment
 *  its foot leaves the bottom edge and the frame grows a strip of nothing along two sides. */
export interface Cavern {
  readonly seed: number; readonly field: HeightField; readonly open: TileGrid;
  readonly formations: readonly Formation[]; readonly flames: readonly Flame[];
  readonly maxHeightPx: number;
}

/** Whether a tile is floor. Out of range reads as rock, which is what a tap off the map wants. */
export function openAt(cave: Cavern, gx: number, gy: number): boolean { return cave.open.get(gx, gy) === 1; }

/**
 * The cave field at a vertex. Above zero is floor, below zero is rock and how deep it goes.
 *
 * `home` is the opening chamber, carved unconditionally: a seed that happened to put solid rock
 * under the camera would be a first frame with nothing in it, and the exhibit would be one
 * unlucky hash away from failing rule 1.
 */
function caveAt(seed: number, gx: number, gy: number): number {
  const veins = 0.1 - Math.abs(fbm2(seed ^ 0x51, gx * 0.036, gy * 0.036, 4, 0.5)) * 1.6;
  const rooms = fbm2(seed ^ 0x9d, gx * 0.019, gy * 0.019, 3, 0.55) * 1.6 - 0.42;
  const home = 0.5 - Math.sqrt((gx - CX) * (gx - CX) + (gy - CY) * (gy - CY)) / 15;
  return Math.max(Math.max(veins, rooms), home);
}

/** Rock height at a vertex, in units: floor relief plus the wall that grows out of it. */
function heightUnits(seed: number, gx: number, gy: number): number {
  const swell = Math.max(0, 1.7 + fbm2(seed ^ 0x2c, gx * 0.1, gy * 0.1, 3, 0.5) * 2.4);
  return swell + smoothstep(0.02, 0.42, -caveAt(seed, gx, gy)) * RIDGE;
}

/**
 * Generate. Once, at boot, from the seed the URL chose.
 *
 * One scan does both jobs, so `footprintBase` and `slopeAt` — the two expensive calls — are each
 * made once per tile rather than once per candidate. A flame needs level ground under it: a spot
 * on a steep ramp puts the pool's center below the rock it is meant to be lighting, and the pool
 * comes out clipped against the slope.
 *
 * The braziers are the first eight shuffled spots in a ring around the opening chamber: outside
 * it, because the first frame has to show a light the visitor is *not* holding, and inside the
 * opening *view*, because a landmark nobody can see is not a landmark.
 */
export function createCavern(seedText: string): Cavern {
  const seed = hashString(seedText);
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  heights.fillFrom((gx, gy) => Math.min(255, Math.round(heightUnits(seed, gx, gy))));
  const field: HeightField = { heights, stepPx: STEP_PX };
  const open = new TileGrid(W, H, { bits: 8 });
  open.fillFrom((gx, gy) => (caveAt(seed, gx, gy) > 0 ? 1 : 0));
  const formations: Formation[] = [];
  const spots: Flame[] = [];
  for (let gy = 2; gy < H - 2; gy++) {
    for (let gx = 2; gx < W - 2; gx++) {
      if (open.get(gx, gy) !== 1) continue;
      const base = footprintBase(field, { gx, gy, w: 1, d: 1 });
      const pick = toUnit(hash2(seed ^ 0x7ee, gx, gy));
      if (pick > 0.945 && slopeAt(field, gx, gy) < STEP_PX * 2.4) {
        spots.push({ gx, gy, base, big: false, phase: toUnit(hash2(seed ^ 0x2b, gx, gy)) * 7 });
      } else if (pick < 0.11) {
        const k = toUnit(hash2(seed ^ 0x1b3, gx, gy));
        const kind = k < 0.46 ? 0 : k < 0.68 ? 1 : k < 0.85 ? 2 : k < 0.95 ? 3 : 4;
        formations.push({ gx, gy, kind, base, v: { level: 1, seed: hash2(seed, gx, gy), flags: 0, progress: 1, label: '' } });
      }
    }
  }
  spots.sort((a, b) => toUnit(hash2(seed ^ 0x3f1, a.gx, a.gy)) - toUnit(hash2(seed ^ 0x3f1, b.gx, b.gy)));
  // Outside the opening chamber, which is 7.5 tiles across, and inside the opening *view*, which
  // is 18: a brazier the visitor cannot see is a landmark that does not exist.
  const away = (f: Flame): boolean => {
    const d = Math.abs(f.gx - CX) + Math.abs(f.gy - CY);
    return d > 9 && d < 21;
  };
  const flames = spots.filter(away).slice(0, BRAZIERS).map((f) => ({ ...f, big: true })).concat(spots.slice(0, TORCHES));
  return { seed, field, open, formations, flames, maxHeightPx: (RIDGE + 6) * STEP_PX };
}
