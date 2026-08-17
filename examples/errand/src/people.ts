/**
 * @art — the cast: the villagers, the loops they walk, the miller waiting by the green, and you.
 *
 * Delete this file and the errand still runs; there is simply nobody in the valley. Nothing here is
 * held between frames — {@link ROUTES} is three frozen curves built once, the same kind of constant
 * a palette's stop sets are — and nothing here decides anything.
 *
 * ## Nobody has a position, and that is the whole demonstration
 *
 * A villager is an integer. Where it is, is
 * `pathSample(route, (φ·i + t·v) mod arcLength)` — recomputed in the frame that draws it and thrown
 * away — and it is the same expression `crowd` is built on. There is no walker struct, no update
 * step and no allocation, which is also why two dozen of them cost the same as one.
 *
 * The two lanes are authored as **closed there-and-back loops**: out along one side of the road,
 * back along the other. Two directions of traffic on the same metalling, no villager knowing which
 * half it is on, and one `Path` instead of two — and a street where everyone walks the same way
 * reads as a conveyor belt no matter how well the people are drawn.
 *
 * ## Everybody is drawn from an integer
 *
 * Height, stoop, build, dye, hat, stride rate and stride phase are all `hash2(WHO, id, k)` for a
 * different `k`, and none of it comes from an `Rng` stream. That is the distinction that makes
 * villager 12 the *same person* on every frame, after every re-sort, on every reload and at every
 * zoom: a stream's `next()` depends on how many draws came before it, so the moment the depth sort
 * re-orders the cast — sixty times a second — a stream would deal villager 12 somebody else's coat.
 *
 * It is also why there is no villager struct. A villager's *position* is
 * `pathSample(route, (φ·i + t·v) mod arcLength)`, recomputed in the frame that draws it and thrown
 * away, and their *appearance* is recomputed the same way from the same integer. Two dozen people,
 * and the only thing that exists between frames is a number that counts them.
 *
 * ## Why the player is drawn by the same function
 *
 * The hero is villager `-1` with a fixed dye and a lantern-warm cloak. One drawing routine for the
 * whole cast is not a saving; it is the thing that stops the player reading as a cursor. A game
 * where the protagonist is drawn by different code from everyone else looks it, always.
 */
import { TAU, hash2, toUnit } from '@lattice/core';
import { Path, pathDirAt, pathSample, type GridPoint } from '@lattice/iso';
import { contactShadow, isoBox, isoCylinder, isoPost, mix, shade, type Pen, type Rgba } from '@lattice/draw';
import { VCX, VCY } from './valley.js';
import { haze } from './ground.js';

/** The salt every villager's appearance is drawn against. Fixed rather than seeded from the URL:
 *  the *valley* changes with the seed, the people do not, so two links can be compared. */
const WHO = 0x51c3b7;

/** A there-and-back lane as one closed loop: out along one side, back along the other. */
function lane(ax: number, ay: number, bx: number, by: number): Path {
  const p = new Path(6);
  p.push(ax, ay), p.push(bx, by), p.push(bx + 0.9, by + 0.9), p.push(ax + 0.9, ay + 0.9), p.push(ax, ay);
  return p;
}

/** The green's ring road, as a closed circle. `valley.houseAt` keeps this annulus clear of houses. */
function ring(): Path {
  const p = new Path(26);
  for (let i = 0; i <= 24; i++) {
    const a = ((i % 24) / 24) * TAU; /* @tier-b pixels only */
    p.push(VCX + Math.cos(a) * 11, VCY + Math.sin(a) * 11);
  }
  return p;
}

/** The high road, the mill lane, and the ring. Built once; never mutated. */
export const ROUTES: readonly Path[] = [lane(51, 103, 115, 103), lane(113, 103, 113, 79), ring()];

/**
 * Where villager `i` is at time `t`, written into `out`, and which of the eight directions it faces.
 *
 * `φ = 0.3819660112` is the golden ratio's conjugate: successive multiples of it modulo one are the
 * most evenly spread sequence there is, so twenty-six villagers distribute along three loops with no
 * two of them bunched and no table of offsets.
 */
export function villagerAt(i: number, t: number, out: GridPoint): number {
  const path = ROUTES[i % ROUTES.length];
  if (path === undefined) return 0;
  const s = (((i * 0.3819660112) % 1) * path.arcLength + t * 42) % path.arcLength;
  pathSample(path, s, out);
  out.gx += 0.5, out.gy += 0.5;
  return pathDirAt(path, s);
}

/** Unit facing per `pathDirAt` direction code, so legs swing along the way somebody is going. A
 *  table rather than a `sqrt`, because the eight codes stand for exactly eight constants. */
const FX = [0, 1, 0.70710678, 0, -0.70710678, -1, -0.70710678, 0, 0.70710678];
const FY = [0, 0, 0.70710678, 1, 0.70710678, 0, -0.70710678, -1, -0.70710678];

/** The slots a villager's coat is dyed from. Slot names, so the cast recolors with the palette. */
const COATS = ['brand', 'ok', 'glass', 'metal', 'bad', 'hedge'] as const;

/**
 * One person.
 *
 * @param id `-1` is the player, `-2` is the miller, and `0..n` are the villagers on the loops.
 * @param dir a `pathDirAt` code, `0` for standing still and facing the camera.
 * @param lit the player and the miller get a rim of `warn` so they can be found in a crowded frame.
 */
export function drawPerson(pen: Pen, id: number, gx: number, gy: number, dir: number, lit: boolean): void {
  // Tall and narrow, and both numbers are the difference between a person and a crate. A figure a
  // little over two storeys high beside a two-storey cottage is the proportion every isometric RPG
  // uses; the first draft was 1.0 by 0.6 tiles — wider than it was tall — and read as furniture.
  const tall = lit ? 2.15 : 1.5 + toUnit(hash2(WHO, id, 1)) * 0.6;
  const stoop = toUnit(hash2(WHO, id, 2)) * 0.18;
  const dye = toUnit(hash2(WHO, id, 3));
  const hat = hash2(WHO, id, 4) & 3;
  const build = 0.15 + toUnit(hash2(WHO, id, 5)) * 0.07;
  const rate = 1.5 + toUnit(hash2(WHO, id, 6)) * 1.3;
  const slot = COATS[(hash2(WHO, id, 7) & 7) % COATS.length] ?? 'brand';
  const coat: Rgba = haze(pen, gx, gy, lit
    ? mix(pen.palette.get('warn'), pen.palette.get('bad'), 0.42)
    : mix(pen.palette.get(slot), pen.palette.get('ink'), 0.14 + dye * 0.4));
  const flesh: Rgba = haze(pen, gx, gy, mix(0xf2ddb8ff, 0x6a4128ff, toUnit(hash2(WHO, id, 8))));

  // The gait: a triangle wave at a per-person rate and a per-person phase, so the village falls in
  // and out of step with itself for ever. A triangle rather than a sine because `Math.sin` is
  // Tier B and at fourteen pixels the two are indistinguishable.
  const cycle = dir === 0 ? 0.25 : (pen.t * rate + toUnit(hash2(WHO, id, 9)) * 8) % 1;
  const swing = (cycle < 0.5 ? cycle * 4 - 1 : 3 - cycle * 4) * 0.5;
  const bob = (cycle < 0.25 || cycle > 0.75 ? 1 : -1) * 0.016;

  const fx = FX[dir] ?? 0;
  const fy = FY[dir] ?? 0;
  // Perpendicular to travel: where the two feet are relative to each other.
  const px = fy * 0.08;
  const py = -fx * 0.08;
  const hip = tall * 0.4;
  const chest = hip + tall * 0.42 - stoop;

  contactShadow(pen, gx - 0.19, gy - 0.19, 0.38, 0.38, 0.55, 0);
  const shoe = shade(coat, 0.6);
  isoPost(pen, gx + px + fx * swing * 0.14, gy + py + fy * swing * 0.14, 0, tall * 0.42, shoe, 0.075);
  isoPost(pen, gx - px - fx * swing * 0.14, gy - py - fy * swing * 0.14, 0, tall * 0.42, shoe, 0.075);
  // The torso is the one outlined element: the stroke goes on the shape that *is* the silhouette,
  // or a village turns into a mesh of hairlines at low zoom.
  isoBox(pen, gx - build, gy - build, build * 2, build * 2, { color: coat, h: tall * 0.42 - stoop + bob, z: hip });
  isoBox(pen, gx - build * 1.22, gy - build * 1.22, build * 2.44, build * 2.44, {
    color: shade(coat, 1.15), h: 0.16, z: chest + bob, outline: false,
  });
  isoBox(pen, gx - 0.075, gy - 0.075, 0.15, 0.15, { color: flesh, h: 0.3, z: chest + 0.16 + bob, outline: false });

  const crown = chest + 0.46 + bob;
  if (hat === 1) {
    isoCylinder(pen, gx, gy, 0.19, { color: shade(coat, 0.82), h: 0.04, z: crown, outline: false });
    isoCylinder(pen, gx, gy, 0.09, { color: shade(coat, 0.9), h: 0.18, z: crown + 0.04, outline: false });
  } else if (hat === 2) {
    isoBox(pen, gx - 0.085, gy - 0.085, 0.17, 0.17, { color: pen.palette.get('bad'), h: 0.15, z: crown - 0.05, outline: false });
  } else {
    isoBox(pen, gx - 0.082, gy - 0.082, 0.164, 0.164, { color: shade(flesh, 0.42), h: 0.07, z: crown - 0.07, outline: false });
  }

  // The miller carries a staff and the player carries nothing, which is how you tell at a distance
  // which of the two upright figures in the square is you.
  if (id === -2) isoPost(pen, gx + px * 2.2, gy + py * 2.2, 0, tall * 1.2, shade(pen.palette.get('thatch'), 0.5), 0.05);
}

/** What the player is carrying, drawn in their hand: the iron key, and nothing else, ever. This is
 *  the whole of the exhibit's inventory and the whole of the argument against having one. */
export function drawCarried(pen: Pen, gx: number, gy: number): void {
  const iron = mix(pen.palette.get('metal'), pen.palette.get('warn'), 0.45);
  isoBox(pen, gx + 0.2, gy - 0.04, 0.07, 0.3, { color: iron, h: 0.06, z: 1.0, outline: false });
  isoCylinder(pen, gx + 0.235, gy + 0.24, 0.11, { color: iron, h: 0.06, z: 1.0, outline: false });
}
