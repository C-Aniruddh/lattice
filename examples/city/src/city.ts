/**
 * The block plan: the grid, and which archetype stands on each lot.
 *
 * **Logic, and deliberately the only logic with any shape to it.** Delete this file and nothing
 * runs — the frame walks its lots, the tap tests against them, and the streets are drawn from its
 * arithmetic. Everything that would merely look different is in the four `@art` modules beside
 * it, including the traffic and the road surface: nothing outside the drawing reads either.
 *
 * The plan is one period: **five tiles of block, two of street, repeated.** Each block splits
 * into four lots — 3×3, 2×3, 3×2, 2×2 — which is where the density comes from without a
 * placement solver: four buildings of four footprints per block, nine blocks, thirty-six
 * buildings, and a lot list a reader can check by hand.
 *
 * The one seeded decision that matters is **which archetype**, and it is biased by how downtown
 * a block is rather than drawn flat. A city with its towers scattered at random has no skyline; a
 * city whose tall things cluster has a *peak*, and a peak is what makes thirty-six objects read
 * as one composition.
 */
import { clamp01, hash2, hashString, toUnit } from '@lattice/core';
import { LEVEL_H, spriteHeightPx, type SpriteDef, type Variant } from '@lattice/draw';
import { crown, drum, kiosk, park, pencil, rowHouses, shedWide, signal, site, slab, spire, streetLamp, twins, vent, walkup } from './sprites.js';

/** Tiles of buildable block, tiles of street between them, and how many blocks each way. */
export const BLOCK = 5;
export const STREET = 2;
export const PERIOD = BLOCK + STREET;
/** Blocks each way. **Seven, not three**, and the number is the exhibit's answer to § Scale: at
 *  three the map's four corners were all on screen at once and the frame was two thirds sky. At
 *  seven it runs off every edge, downtown is below the bottom of the opening frame, and the first
 *  thing a visitor does is drag toward it. Density is a loop bound and costs nothing else. */
export const BLOCKS = 7;
/** The map is square: `BLOCKS` blocks and the streets between and around them. */
export const W = BLOCKS * PERIOD + STREET;
/** How far the sidewalk stands above the asphalt, in storeys and in world pixels. Every building
 *  is drawn on it, so every `drawSprite` in this exhibit is handed `CURB_PX`. */
export const CURB = 0.1;
export const CURB_PX = CURB * LEVEL_H;
/** The tallest thing that can stand here — the Terrain cull's margin and the camera's box. */
export const MAX_HEIGHT_PX = 34 * LEVEL_H;

/** One thing standing on the map. `v` is not readonly: a tap replaces it, and that is the only
 *  state in this exhibit that outlives a frame. */
export interface Lot {
  readonly def: SpriteDef;
  readonly gx: number;
  readonly gy: number;
  /** Cached from a measuring replay at build time. It is what the depth sorter is handed, and
   *  `spriteHeightPx` is a full massing replay that has no business running per frame. */
  readonly hPx: number;
  v: Variant;
}

export interface City {
  readonly seed: number;
  readonly lots: readonly Lot[];
}

/** The four archetype lists, by lot footprint, **tallest first**: `choose` reads position in the
 *  list as height, so downtown takes the front and the edges take the back. */
const BIG: readonly SpriteDef[] = [spire, crown, twins, drum, site, park];
const EAST: readonly SpriteDef[] = [walkup, rowHouses];
const SOUTH: readonly SpriteDef[] = [slab, shedWide];
const CORNER: readonly SpriteDef[] = [pencil, kiosk];

/**
 * One lamp at the curb, a signal on the corner, a vent in the road — placed per block, relative to
 * its origin.
 *
 * **One lamp, not three.** A street lamp is the only object in this city that throws a real pool,
 * and three per block put every pool inside its neighbor's: the ground between them never got dark,
 * so none of them read as light. It is also the one place the exhibit pays twice for a mistake,
 * because `draw`'s light field is not occluded — a pool on a street composites over the roof of the
 * tower in front of it, and forty of those are forty pale discs floating fourteen storeys up.
 * Scarcity fixes the look and the artifact with the same number.
 */
const FURNITURE: readonly (readonly [SpriteDef, number, number])[] = [
  [streetLamp, -0.75, 1.2], [signal, -0.85, -0.85], [vent, 3.1, -0.7],
];

/** Pick an archetype: the front of the list downtown, the back at the edges, with enough of the
 *  seed left in that a ring of nine blocks does not read as a bullseye. */
function choose(list: readonly SpriteDef[], r: number, downtown: number): SpriteDef {
  const def = list[Math.min(list.length - 1, Math.floor(clamp01(r * 0.5 + (1 - downtown) * 0.72) * list.length))];
  if (def === undefined) throw new RangeError('city.choose: an archetype list is empty');
  return def;
}

/** Put one thing on one lot, and measure it once. */
function place(out: Lot[], seed: number, gx: number, gy: number, def: SpriteDef, level: number): void {
  const v: Variant = { level, seed: hash2(seed, gx * 32, gy * 32), flags: 0, progress: 1, label: '' };
  out.push({ def, gx, gy, hPx: CURB_PX + spriteHeightPx(def, v), v });
}

/** Build the city. Same seed, same city, every time. */
export function createCity(seedText: string): City {
  const seed = hashString(seedText);
  const lots: Lot[] = [];
  // **The peak stays at the middle of the map, and the horizon is why.** Moving it toward the far
  // corner was tried and it closes the frame: a fifteen-storey tower standing *on* the horizon line
  // rises four hundred pixels above it and paints out the sky, the distance bands and the depth row
  // with them. The edge of the city has to be low-rise for a horizon to exist at all — so the
  // opening frame is outskirts at the top, mid-rise through the middle, and downtown looming out of
  // the bottom edge with its feet off-screen, which is the drag § Scale asks the visitor to make.
  const mid = (BLOCKS - 1) / 2;
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const ox = STREET + bx * PERIOD;
      const oy = STREET + by * PERIOD;
      const downtown = clamp01(1 - (Math.abs(bx - mid) + Math.abs(by - mid)) / (BLOCKS - 0.5));
      const storeys = (n: number): number => Math.round(3 + downtown * 10 + toUnit(hash2(seed, ox, oy ^ n)) * 5);
      const pick = (list: readonly SpriteDef[], n: number): SpriteDef =>
        choose(list, toUnit(hash2(seed, ox + n, oy)), downtown);
      place(lots, seed, ox, oy, pick(BIG, 0), storeys(0x9d));
      place(lots, seed, ox + 3, oy, pick(EAST, 1), storeys(0x3a));
      place(lots, seed, ox, oy + 3, pick(SOUTH, 2), storeys(0x71));
      place(lots, seed, ox + 3, oy + 3, pick(CORNER, 3), storeys(0xc4));
      for (const [def, dx, dy] of FURNITURE) place(lots, seed, ox + dx, oy + dy, def, 1);
    }
  }
  return { seed, lots };
}
