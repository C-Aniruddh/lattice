/**
 * The valley — the ground all five verbs stand on, and the cost function `iso` searches over.
 *
 * **Logic, and deliberately the smallest module that could hold a village.** It answers two
 * questions and refuses every other: what kind of ground is this tile, and what does it cost to
 * walk into. What a house *looks* like, what a crop is, what color the river is and where the
 * villagers wander are `sprites.ts`, `ground.ts` and `people.ts`, none of which this file knows
 * about. `docs/GALLERY.md` settles this classification by name — Lamp Road's `valley.ts` is *"logic,
 * though it reads as art: it is the landform **and** the map"* — and so is this one.
 *
 * ## Everything here is a pure function of `(seed, gx, gy)`
 *
 * There is no scatter list, no props array and no building table — not to be clever, but because a
 * ninety-six-square valley with several hundred trees, several hundred crops and a hedged field
 * system is either a pure function or it is a megabyte of state to generate, hold, cull and (worse)
 * *save*. {@link kindAt} is asked once per tile at boot to fill one `TileGrid`; the art asks
 * {@link houseAt} again per visible tile per frame. Nothing is remembered that a hash cannot
 * re-derive, which is the same reason the save file at the other end of this exhibit is three
 * numbers long.
 *
 * ## The layout, and why it is laid out this way
 *
 * § Scale asks that the world run off the frame edges and that the errand's destination be
 * off-screen at the opening frame. Grid space is not screen space, so that is arithmetic rather
 * than taste: screen x is `gx − gy` and screen y is `gx + gy`, so two places are far apart *on
 * screen* when their `gx − gy` differ.
 *
 * | | tile | `gx − gy` | at the opening frame |
 * |---|---|---|---|
 * | the square, where you start | (59, 103) | −44 | the middle of the screen |
 * | the miller | (65, 97) | −32 | a short walk right. The one thing to tap |
 * | the old well | (109, 109) | 0 | **off the bottom-right corner**, across the river |
 * | the mill gate | (113, 77) | +36 | **far off the right edge**, up the mill lane |
 *
 * So the first thing a player does is go somewhere, and the second is find out that the place they
 * were sent is across a river with exactly one bridge on it.
 *
 * ## Two facts the rest of the exhibit depends on
 *
 * **You stand at `(gx, gy + 1)` to use any of the three.** That is arranged here rather than
 * discovered there: the tile south of the gate is the mill lane's last metalled square, the tile
 * south of the well is inside its clearing, and the miller stands at `(65, 97)` precisely because
 * `(65, 98)` is a village street on every seed — `gy % 7 === 0` is a street, always. Put the miller
 * one tile north and the approach lands inside whatever house the hash rolled.
 *
 * ## Connectivity, which must not be got wrong
 *
 * Woods and hedges are impassable, and a valley that seals its own errand behind a thicket is a
 * white screen on somebody else's seed. Three rules keep it open and `main.ts` checks all three at
 * boot rather than assuming them: **roads are decided first**, so the high road crosses the river as
 * a bridge and the mill lane reaches the gate through whatever the noise wanted to put there;
 * **nothing grows within three tiles of a road** or five of the well; and **a hedgerow has gaps** —
 * every tile where `(gx + gy) % 7 === 0` is left open, which is a field gate every seven tiles on
 * every side of every field.
 */
import { hash2, hashString, noise2 } from '@lattice/core';
import { TileGrid, tileBounds, type Rect, type TileCost } from '@lattice/iso';

/**
 * The valley in tiles: square, and **much** larger than any frame of it.
 *
 * 160 rather than the 96 this started at, and the extra 64 buys exactly one thing: § Scale's *edges*
 * row. The village sits at `(59, 103)`, which is far enough from every corner of the diamond that all
 * four corners of a 1440×900 viewport land on tiles that exist. At 96 the map's own west corner was
 * in the opening frame — a hard diagonal with background behind it, which is the failure that row
 * names. Nothing else changed: the cull means only what is on screen is ever touched, so a map two
 * and a half times the area costs one extra `fillFrom` at boot and nothing per frame.
 */
export const W = 160, H = 160;
/** Ground kinds — the index into {@link WEIGHT}, and the only thing `ground.ts` switches on. */
export const WATER = 0, GRASS = 1, ROAD = 2, CROP = 3, WOOD = 4, HEDGE = 5, WALL = 6, YARD = 7;
/**
 * Movement weight per kind, in the integer units `iso.path` multiplies by `STEP_ORTHO`. `0` is
 * impassable; the rest are *weights*, which is the half of `PathFinder` worth showing — a road at 1
 * against grass at 2 sends a route a long way round to stay on the road, and that is what makes a
 * walk look like a journey rather than a straight line with a kink in it.
 */
const WEIGHT: readonly number[] = [0, 2, 1, 3, 0, 0, 0, 1];

/** The village green, the four places the errand happens, and the walled mill compound. */
export const VCX = 59, VCY = 103, START = { gx: 59, gy: 103 }, MILLER = { gx: 65, gy: 97 };
export const WELL = { gx: 109, gy: 109 }, GATE = { gx: 113, gy: 77 }, MILL = { gx: 113, gy: 71 };
const YX0 = 107, YX1 = 119, YY0 = 65, YY1 = 77;
/** The tallest thing in the valley, in world pixels: the mill's cap. Anything whose *base* is this
 *  far below the bottom edge can still have its head in frame, which is what `ground.onScreen`
 *  margins with — and the number `renderFrame` needs for its own terrain cull. */
export const MAX_HEIGHT_PX = 230;
/** What the camera may look at: the whole valley, which is over three viewports wide at the opening
 *  zoom. `Camera` *copies* this at construction rather than holding the reference. */
export const BOUNDS: Readonly<Rect> = tileBounds(0, 0, W, H, MAX_HEIGHT_PX, { minX: 0, minY: 0, maxX: 0, maxY: 0 });

/**
 * An octagon metric: 1 per unit along the axes, 1.38 along the diagonals.
 *
 * A Chebyshev radius makes a village a square in the grid, which is a **diamond** on screen — four
 * hard points, and a settlement that reads as a lozenge somebody drew. Folding a little Manhattan in
 * cuts the corners off, and an octagon is the shape a village that grew actually has.
 */
export function oct(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  return (ax > ay ? ax : ay) * 0.62 + (ax + ay) * 0.38;
}

/** Within `pad` tiles of the high road east through the village, or the mill lane north off it.
 *  Called with `0` to lay the metalling and with `3` to keep the woods off it — one function for
 *  both, because two would drift and the drift is a thicket standing in the road. */
function onRoad(gx: number, gy: number, pad: number): boolean {
  const w = 1.6 + pad;
  return (gy > 103 - w && gy < 103 + w && gx >= 51 && gx <= 115) || (gx > 113 - w && gx < 113 + w && gy >= 77 && gy <= 103);
}

/**
 * The house on village block `(bx, by)`, packed as `w | d << 3`, or `0` for an open plot.
 *
 * **Derived from the block rather than the tile**, so `sprites.ts` can ask the same question and get
 * the same answer without either side holding a list: a house is drawn once, at its origin tile, as
 * one massed solid with a roof — not as a stack of one-tile boxes, which is the shape every naive
 * isometric village has and reads as rubble. Two rings are left open and both are load-bearing: the
 * annulus between 9 and 12.6 is where the villagers' ring road runs, and everything inside radius
 * 4.5 is **the green** — where the player is standing when the exhibit opens, and where a house
 * would otherwise have been built on top of them on about one seed in three.
 */
export function houseAt(seed: number, bx: number, by: number): number {
  const r = oct(bx * 7 + 3.5 - VCX, by * 7 + 3.5 - VCY), h = hash2(seed ^ 0x5a1, bx, by);
  if (r < 4.5 || r > 13 || (r > 9 && r < 12.6) || ((h >> 2) & 7) < 2) return 0;
  return (2 + (h & 1)) | ((2 + ((h >> 1) & 1)) << 3);
}

/** Inside the village: a street grid every seven tiles, houses set two tiles into each block. */
function plotAt(seed: number, gx: number, gy: number): number {
  const bx = Math.floor(gx / 7), by = Math.floor(gy / 7), ox = gx - bx * 7 - 2, oy = gy - by * 7 - 2;
  if (ox === -2 || oy === -2) return ROAD;
  const house = houseAt(seed, bx, by);
  return house !== 0 && ox >= 0 && oy >= 0 && ox < (house & 7) && oy < (house >> 3) ? WALL : GRASS;
}

/** Outside it: thickets where the noise is high, hedged fields of barley where it is not. The
 *  `gx + gy < 46` term is § Scale's **far distance band** — screen height rises with `gx + gy`, so
 *  that triangle is the top of the frame from anywhere in the valley, and filling it with unbroken
 *  wood gives the composition a treeline to end on instead of a ruled map edge. */
function countryAt(seed: number, gx: number, gy: number): number {
  if (gx + gy < 116 || noise2(seed ^ 0x11, gx * 0.055, gy * 0.055) > 0.22) return WOOD;
  const fx = Math.floor(gx / 11), fy = Math.floor(gy / 11), ex = gx - fx * 11, ey = gy - fy * 11;
  if ((hash2(seed ^ 0x2c, fx, fy) & 3) === 0) return GRASS;
  if (ex === 0 || ey === 0 || ex === 10 || ey === 10) return (gx + gy) % 7 === 0 ? GRASS : HEDGE;
  return CROP;
}

/** One tile's kind. **The order of these tests is the map**, and three of them are load-bearing: the
 *  compound outranks the lane so the lane stops at the gate, the road outranks the river so the
 *  crossing is a bridge, and the river outranks the road's grass verge so the bridge has water
 *  beside it rather than a lawn. */
function kindAt(seed: number, gx: number, gy: number): number {
  const inYard = gx >= YX0 && gx <= YX1 && gy >= YY0 && gy <= YY1, bank = gy - gx - 10;
  const onMill = gx >= MILL.gx && gx <= MILL.gx + 1 && gy >= MILL.gy && gy <= MILL.gy + 1;
  if (inYard) return onMill || gx === YX0 || gx === YX1 || gy === YY0 || gy === YY1 ? WALL : YARD;
  if (onRoad(gx, gy, 0)) return ROAD;
  if (bank > -2.4 && bank < 2.4) return WATER;
  if (oct(gx - VCX, gy - VCY) < 14) return plotAt(seed, gx, gy);
  if (oct(gx - WELL.gx, gy - WELL.gy) < 5 || onRoad(gx, gy, 3)) return GRASS;
  return countryAt(seed, gx, gy);
}

/** The generated world. One grid, and everything else a hash away. */
export interface Valley { readonly seed: number; readonly kind: TileGrid }

/** Generate. Once, at boot, from the seed the URL chose. */
export function createValley(seedText: string): Valley {
  const seed = hashString(seedText), kind = new TileGrid(W, H, { bits: 8, outOfBounds: WOOD });
  return kind.fillFrom((gx, gy) => kindAt(seed, gx, gy)), { seed, kind };
}

/**
 * The cost function, and **the exhibit's one causal link made mechanical**.
 *
 * Everything reads the grid except one tile. The gate is `WALL` in the grid for ever — the map never
 * changes and is never regenerated — and its *weight* is a function of whether the player has used
 * the key. So "the door you opened is still open" is not a flag the renderer consults; it is a route
 * that now exists and did not before, and the proof is that you can walk through it.
 *
 * @param open asked once per examined neighbor, so it must stay arithmetic. It is one comparison.
 */
export function makeCost(valley: Valley, open: () => boolean): TileCost {
  const kind = valley.kind;
  return (gx, gy) => (gx === GATE.gx && gy === GATE.gy ? (open() ? 1 : 0) : (WEIGHT[kind.get(gx, gy)] ?? 0));
}
