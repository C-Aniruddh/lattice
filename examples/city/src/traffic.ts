/**
 * Traffic: where the cars are, and what a car looks like.
 *
 * @art
 *
 * **Both halves are art, and the position half is the one worth arguing about.** `carAt` returns
 * a number, and a number a module returns is normally the tell that it is logic — but nothing
 * outside this file's own drawing ever reads it. There is no per-car state, nothing hit-tests a
 * car, no car is tappable, and deleting this module changes exactly one thing: whether the
 * streets are empty. It is closed form in `t` and a hash of the car's own id, so twenty-four cars
 * cost twenty-four expressions and are identical on every reload.
 *
 * It has its own module rather than sitting in `sprites.ts` for a mechanical reason as well as a
 * tidy one: it needs the street grid from `city.ts`, and `city.ts` imports `sprites.ts`. One more
 * file is cheaper than an import cycle nobody can see.
 */
import { hash2, toUnit } from '@latticekit/core';
import type { GridPoint } from '@latticekit/iso';
import { isoBox, mix, pxToLevels, withAlpha, type Pen } from '@latticekit/draw';
import { at } from './sprites.js';
import { BLOCK, BLOCKS, PERIOD, STREET } from './city.js';

/** How far the lane center sits outside the block it laps, in tiles. Half a tile puts it on the
 *  center line of the carriageway tile touching the curb — the near lane — which is what makes
 *  two rings sharing a street pass rather than collide. */
const LANE = 0.5;

/** Cars on the road at once. A hundred and twenty across forty-nine blocks; the depth sorter culls
 *  every one that is not on screen, so the number is a density and not a frame cost. */
export const CARS = 120;

/**
 * Where car `i` is at time `t`, and which of the four ways it is pointing.
 *
 * ## Why this is a ring and not a line
 *
 * The first version ran each car along one street from one edge of the map to the other, wrapping
 * a tile past each end. That is one expression shorter and it is the single most damaging bug an
 * exhibit can have: at both ends of every run a car drove **off the drawn road and out into the
 * background**, and a vehicle moving through a place where there is no world is the moment a
 * visitor stops believing the scene. No camera change fixes it, because the car really is out
 * there.
 *
 * So a car's path is a **closed circuit around one block** — four legs, four corners, and no end
 * to fall off. Every point on it is asphalt by construction rather than by luck:
 *
 * | | tiles | why it is road |
 * |---|---|---|
 * | a block | `[ox, ox + BLOCK)` | buildable, and the ring never enters it |
 * | the lane before it | `ox - 1` | `(ox - 1) % PERIOD === STREET - 1`, so `isRoad` |
 * | the lane after it | `ox + BLOCK` | `(ox + BLOCK) % PERIOD === 0`, so `isRoad` |
 *
 * **Every ring turns the same way, and each uses the lane against its own block.** That is what
 * makes the two lanes of a shared street carry opposite traffic without a single explicit rule:
 * the street between blocks A and B is A's far lane and B's near lane, A drives it one way round
 * and B the other. A car that instead picked its direction from its own hash would meet its
 * neighbor head-on in the same lane about half the time.
 */
export function carAt(i: number, t: number, out: GridPoint): number {
  const h = hash2(0xca7, i, 1) >>> 0;
  // Which block's ring, and whether it laps one block or a two-by-two superblock. The long ring
  // is what keeps a few cars running straight for six seconds instead of turning every two.
  const wide = ((h >>> 12) & 3) === 0 && BLOCKS > 1 ? 1 : 0;
  const bx = (h >>> 3) % (BLOCKS - wide);
  const by = (h >>> 17) % (BLOCKS - wide);
  const x0 = STREET + bx * PERIOD - LANE;
  const y0 = STREET + by * PERIOD - LANE;
  const side = wide * PERIOD + BLOCK + LANE * 2;
  const speed = 1.9 + toUnit(hash2(0xca7, i, 2)) * 1.8;
  const s = (t * speed + toUnit(hash2(0xca7, i, 3)) * side * 4) % (side * 4);
  const leg = Math.floor(s / side);
  const u = s - leg * side;
  // Counter-clockwise in grid space: down the near edge, along the far edge, back up, home.
  out.gx = leg === 0 ? x0 : leg === 1 ? x0 + u : leg === 2 ? x0 + side : x0 + side - u;
  out.gy = leg === 0 ? y0 + u : leg === 1 ? y0 + side : leg === 2 ? y0 + side - u : y0;
  return leg === 0 ? 2 : leg === 1 ? 0 : leg === 2 ? 3 : 1;
}

/** The four ways a car can be pointing, as unit steps in grid space. */
const HEADINGS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * One car: a body, a roof, a warm pool ahead of it and two red lamps behind.
 *
 * Drawn straight rather than as a sprite, for the same reason the hero's pilgrims are: a car is a
 * point on a curve, its position comes from a closed-form expression that holds no state, and
 * everything about it — length, color, whether it is a van — is derived from its id, so the same
 * car is the same car on every frame and after every re-sort.
 */
export function drawCar(pen: Pen, id: number, gx: number, gy: number, heading: number, zPx: number): void {
  const z = pxToLevels(zPx);
  const k = pen.camera.zoom;
  const dir = HEADINGS[heading % 4] ?? HEADINGS[0];
  if (dir === undefined) return;
  const [dx, dy] = dir;
  const van = toUnit(hash2(0xca7, id, 4)) < 0.28;
  const len = van ? 0.62 : 0.46;
  const wide = 0.26;
  const hue = pen.palette.get(
    toUnit(hash2(0xca7, id, 5)) < 0.3 ? 'brand' : toUnit(hash2(0xca7, id, 6)) < 0.5 ? 'metal' : 'ink',
  );
  const ax = Math.abs(dx) > 0 ? len : wide;
  const ay = Math.abs(dy) > 0 ? len : wide;
  isoBox(pen, gx - ax * 0.5, gy - ay * 0.5, ax, ay, { color: hue, h: van ? 0.34 : 0.2, z });
  isoBox(pen, gx - ax * 0.34, gy - ay * 0.34, ax * 0.68, ay * 0.68, {
    color: mix(hue, pen.palette.get('glass'), 0.55),
    h: van ? 0.1 : 0.16,
    z: z + (van ? 0.34 : 0.2),
    outline: false,
  });
  // Headlights: a warm wash thrown *along* the road, not a dot on the bumper.
  const warm = mix(pen.palette.get('warn'), 0xfff4d8ff, 0.45);
  const hx = gx + dx * (len * 0.5 + 0.7);
  const hy = gy + dy * (len * 0.5 + 0.7);
  const p = at(pen, hx, hy, z + 0.02);
  pen.surface.softEllipse(p.x, p.y, 22 * k, 13 * k, withAlpha(warm, 0.36), withAlpha(warm, 0));
  const lamp = at(pen, gx + dx * len * 0.5, gy + dy * len * 0.5, z + 0.12);
  pen.surface.ellipse(lamp.x, lamp.y, 2.2 * k, 1.6 * k, warm);
  const tail = at(pen, gx - dx * len * 0.5, gy - dy * len * 0.5, z + 0.14);
  const red = pen.palette.get('bad');
  pen.surface.softEllipse(tail.x, tail.y, 7 * k, 5 * k, withAlpha(red, 0.5), withAlpha(red, 0));
  pen.surface.ellipse(tail.x, tail.y, 1.7 * k, 1.3 * k, mix(red, 0xffffffff, 0.3));
  // Small, bright, and steep. A headlight that lit two tiles at a third intensity was a smudge
  // that merged with the next car's; one tile at half intensity with a hard shoulder is a beam.
  pen.light?.add(hx, hy, zPx, 0.85, 0.6, 'warn', 3.4);
}
