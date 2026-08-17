/**
 * The cavern: one seed to a rock mass, the hollows cut through it, and the gates set into them.
 *
 * **Logic, though it reads as art**, for the reason `docs/GALLERY.md` settles for Lamp Road's
 * `valley.ts`: this is the landform *and* the map. The height field is what `rock.ts` paints, what
 * `iso` sorts against, and what decides where a gate can exist — delete it and nothing runs. What
 * a wall looks like is `rock.ts`; what a gate sounds like is `sound.ts`; the formations standing on
 * the floor are minted per frame in `props.ts` and are not here at all, because a stalagmite is
 * something this exhibit *looks* like and not something it is about.
 *
 * ## Rock is the default and the cave is the exception
 *
 * The field is generated **solid** and hollowed out, which is the opposite of every heightfield in
 * this gallery so far and is what makes the frame full. An island generated as ground with sea
 * around it spends half a wide viewport on sea; a cave generated as rock with hollows in it has no
 * empty half — every pixel is floor, wall, or the mass above the wall. There is no sky slot in this
 * exhibit's palette and nothing ever draws one.
 *
 * ## Two noise fields crossed, not one thresholded
 *
 * A single `fbm2` thresholded gives blobs, and blobs read as rooms with no way between them. The
 * tunnels here are the **zero contour of two independent fields** — `min(|a|, |b|)` is small only
 * where both are near zero, which is a network of winding corridors meeting at junctions — and the
 * chambers are a third field over the top. Corridors you can get lost in are what makes a lamp you
 * carry worth carrying, and they are why the gates are somewhere rather than everywhere.
 *
 * **The two constants in `rockUnits` are the only tuning here and they were measured, not
 * eyeballed.** The first build cut at `0.15` and `−0.3` and came out 45% open, which does not read
 * as a cave at all: the corridors are so wide that they merge, and what survives is a scatter of
 * isolated rock islands rather than a mass with passages in it. At `0.07` and `−0.55` the map is
 * about 29% floor, 8% wall face and 63% overhead mass across every seed tried, which is the
 * proportion that makes a frame full of rock with somewhere to walk.
 */
import { clamp01, fbm2, hash2, hashString, noise2 } from '@lattice/core';
import { TILE_H, TileGrid, heightAt, type HeightField } from '@lattice/iso';
import { CHORD_MAX, chordOf } from './puzzle.js';

export const W = 108, H = 108, CX = 54, CY = 54;
/** World pixels per height unit — a quarter of a tile's depth, as everywhere else in the kit. */
export const STEP_PX = TILE_H / 4;
/**
 * Height units floor to roof, and the line between floor and rock.
 *
 * Thirteen units is 104 world pixels — three tile-depths of wall, plenty to read as a cavern, and
 * chosen against § Scale's **cost** row rather than by eye. `renderFrame` margins its terrain cull
 * by `ceil(maxHeightPx / TILE_H)` tiles **on every side**, so every extra unit of roof widens the
 * tile walk in four directions at once; at thirty units this exhibit walked about 40% more tiles
 * per frame for walls nobody could tell were taller. Taller is also *worse* to read: at twenty
 * units a hollow four tiles across is a shaft, and a frame of shafts reads as floating plates
 * rather than as corridors with rock between them.
 */
const ROOF = 13, FLOOR = 5;
/**
 * Solid past this many tiles from the middle, so the map has walls and not edges; one candidate
 * gate per block of this many tiles, which is what stops two of them sharing a wall; and the
 * radius inside which a gate asks two strings rather than three, so the way to a harder puzzle is
 * to go and look for it.
 *
 * `BLOCK` was 7 and produced eight gates on the shipping seed, which is not a density — it is a
 * diorama with doors. The number that actually gated it was not this one but the wall probe below:
 * a floor point picked at random inside a block is usually more than two tiles from any rock, so
 * four out of five candidates that had standing room were thrown away for having nothing to stand
 * against. Probing a second ring and taking "the ground is rising here" rather than "there is a
 * full wall here" is what moved it from eight to about ninety.
 */
const RIM = 49, BLOCK = 4, EASY = 14;

/** A locked arch and the chord that opens it. `open` is the one thing in this file that moves. */
export interface Gate {
  /** Where it stands, the chord it hums as a bitmask over the six strings, how many strings that
   *  is (2 or 3, carried rather than recounted sixty times a second), and the floor under it in
   *  world pixels — so the drawing, the light pool and the depth key cannot disagree. */
  readonly gx: number; readonly gy: number; readonly chord: number; readonly size: number; readonly zPx: number;
  open: boolean;
}

/** `rock` is height units per grid **vertex**, roof included, and above `FLOOR` it is stone.
 *  `gates` is sorted by distance from the middle, so `gates[0]` is where the camera opens.
 *  `maxHeightPx` is the margin `renderFrame`'s terrain cull needs, or the roof vanishes at the
 *  top edge of the frame the moment its base leaves it. */
export interface Cavern {
  readonly seed: number; readonly rock: TileGrid; readonly field: HeightField;
  readonly gates: readonly Gate[]; readonly maxHeightPx: number;
}

/**
 * How much rock is at a vertex, in height units.
 *
 * Signed openness first — positive inside a hollow, negative inside the mass — then **squared**
 * into a wall. The square is what makes the transition a ramp over about a tile rather than a
 * cliff: at a cliff, adjacent vertices differ by twenty units and `isoTerrain` paints one quad
 * with two corners on the roof and two on the floor, which reads as a folded sheet.
 */
function rockUnits(seed: number, gx: number, gy: number): number {
  const dx = gx - CX, dy = gy - CY;
  const far = Math.sqrt(dx * dx + dy * dy);
  const tunnel = 0.07 - Math.min(Math.abs(noise2(seed, gx * 0.035, gy * 0.035)),
    Math.abs(noise2(seed ^ 0x51ab, gx * 0.021 + 40, gy * 0.021 - 17)));
  const chamber = fbm2(seed ^ 0x2b6d, gx * 0.052, gy * 0.052, 3, 0.5) - 0.55;
  // The rim is a subtraction and not a branch: `if (far > RIM) return ROOF` puts a circular cliff
  // around the map that a player can see the whole of from one place, which names its dimensions.
  const open = Math.max(tunnel * 3.4, chamber * 1.5) - clamp01((far - RIM + 5) / 5);
  const solid = clamp01(-open * 2.4);
  const floor = Math.max(0, 1.4 + fbm2(seed ^ 0x9d31, gx * 0.19, gy * 0.19, 3, 0.5) * 1.9);
  return floor + solid * solid * (ROOF + noise2(seed ^ 0x77c2, gx * 0.09, gy * 0.09) * 7);
}

/**
 * Generate. Once, at boot, from the seed the URL chose.
 *
 * One candidate gate per block rather than rejection sampling against the gates already placed: it
 * is a single pass, it cannot spin on an unlucky seed, and the minimum spacing is a property of
 * the loop instead of a distance test somebody has to keep in step with it.
 */
export function createCavern(seedText: string): Cavern {
  const seed = hashString(seedText), rock = new TileGrid(W + 1, H + 1, { bits: 8, outOfBounds: 255 });
  rock.fillFrom((gx, gy) => Math.min(255, Math.max(0, Math.round(rockUnits(seed, gx, gy)))));
  const field: HeightField = { heights: rock, stepPx: STEP_PX }, wall = FLOOR + 3, gates: Gate[] = [];
  for (let by = 0; by * BLOCK + BLOCK < H; by += 1) {
    for (let bx = 0; bx * BLOCK + BLOCK < W; bx += 1) {
      const h = hash2(seed ^ 0x6a71, bx, by);
      const gx = bx * BLOCK + 1 + (h % (BLOCK - 2)), gy = by * BLOCK + 1 + ((h >>> 8) % (BLOCK - 2));
      // Standing room, and rock within two tiles to set the arch against: a gate in the middle of
      // an open chamber is a door frame in a field, and a player reads it as scenery.
      if (rock.get(gx, gy) > FLOOR) continue;
      if (Math.max(rock.get(gx + 2, gy), rock.get(gx - 2, gy), rock.get(gx, gy + 2), rock.get(gx, gy - 2),
                   rock.get(gx + 3, gy), rock.get(gx - 3, gy), rock.get(gx, gy + 3), rock.get(gx, gy - 3)) < wall) continue;
      const size = middling(gx, gy) < EASY * EASY ? 2 : CHORD_MAX;
      gates.push({ gx, gy, chord: chordOf(h >>> 16, size), size, zPx: heightAt(field, gx, gy), open: false });
    }
  }
  // Nearest the middle first. One sort at boot, and it is what lets the camera open on a gate
  // without a second copy of "where is the middle" anywhere downstream.
  gates.sort((a, b) => middling(a.gx, a.gy) - middling(b.gx, b.gy));
  return { seed, rock, field, gates, maxHeightPx: (ROOF + 5) * STEP_PX };
}

/** Squared distance from the cave's middle. Squared because nothing compares it to a length —
 *  and written out rather than with `**`, which is `pow` under another name and Tier B. */
function middling(gx: number, gy: number): number { return (gx - CX) * (gx - CX) + (gy - CY) * (gy - CY); }

/**
 * The locked gate nearest a point, or `undefined` if the nearest is further than `reach` tiles.
 *
 * A linear scan over every gate, every frame, and that is the honest shape at this size: a
 * hundred-odd squared distances is nothing, and a spatial index here would be a structure the
 * exhibit has to keep correct in exchange for microseconds nobody can measure.
 */
export function nearestLocked(cave: Cavern, gx: number, gy: number, reach: number): Gate | undefined {
  let best: Gate | undefined, bestFar = reach * reach;
  for (const gate of cave.gates) {
    const far = (gate.gx - gx) * (gate.gx - gx) + (gate.gy - gy) * (gate.gy - gy);
    if (!gate.open && far < bestFar) { bestFar = far; best = gate; }
  }
  return best;
}
