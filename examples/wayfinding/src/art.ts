/**
 * @art — the concourse. Its paving, its colonnade, its planters and benches, the barriers, the
 * beacon at the far end, the divider, and the bodies of six hundred and forty people.
 *
 * Deleting this module leaves the exhibit running: the field still rebuilds the instant a
 * crossing closes, every walker still reads it on the same step, and the frame is blank. Nothing
 * here holds state across a frame — every prop is a pure function of its index — and nothing here
 * returns a value any decision reads.
 *
 * ## Why the floor is not one color, which is the whole of this file's brief
 *
 * The first build of this exhibit painted the concourse as a single `ground` slot with a lane
 * pattern over it and measured **57% of the frame in one color, across 59% of the border**. The
 * harness's framing row passes under 60%, so it passed — and it passed for a reason that has
 * nothing to do with the composition being right: the row measures the *modal* color, and a
 * repeating texture defeats a modal-color test while still reading as a rug rather than a place.
 * `docs/GALLERY.md` § Scale asks for something else entirely, and it names it: three distance
 * bands, edges the world runs off, and no more than a third of the frame empty.
 *
 * So the paving here is **eight quantized shades of the ground slot** picked per tile from a hash,
 * laid in two-tile slabs with grout between them, plus a cool inlay along every contour of the
 * field. Eight rather than a continuum because a `poly` fill takes a color and the count is free,
 * and because a floor with a hundred shades reads as noise rather than as stone.
 *
 * The colonnade is the other half. Seventy-two columns on a six-by-twelve lattice give the hall a
 * near band you look past, a mid band the crowd walks through, and a far band that the haze in
 * {@link drawHaze} takes down — which is the depth row, and none of it is in the height field.
 */

import { hash2, toUnit } from '@latticekit/core';
import { glowDot, isoBox, isoPatch, isoPost, isoTile, mix, shade, withAlpha, type Pen } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';

/** What a body needs to be drawn. The walker's steering lives in `main.ts`; this is the half of
 *  it that is a picture. */
export interface PersonView { x: number; y: number; hue: number; phase: number }

// ── the colonnade, the planters and the benches ─────────────────────────────────────────────
//
// Every prop is a pure function of its index, so `addProps` and `drawProp` agree without either
// of them writing anything down. That is what lets this module claim `@art` honestly.

/** The six aisles the columns stand in. The gap between 42 and 76 is the concourse itself, which
 *  is where the crowd is and is deliberately clear. */
const AISLES = [14, 28, 42, 76, 90, 104] as const;
const BAYS = 12;
const BAY_0 = 20;
const BAY_STEP = 8;
const COLUMNS = AISLES.length * BAYS;
const PLANTERS = 150;
const BENCHES = 96;

/** How many things stand in this hall besides the people. `main.ts` adds them all to one sorter. */
export const PROPS = COLUMNS + PLANTERS + BENCHES;

/** 0 column, 1 planter, 2 bench. */
function kindOf(i: number): 0 | 1 | 2 {
  return i < COLUMNS ? 0 : i < COLUMNS + PLANTERS ? 1 : 2;
}

function propGx(i: number): number {
  if (i < COLUMNS) return AISLES[i % AISLES.length] ?? 0;
  const n = i - COLUMNS;
  // Kept out of the two aisles the crowd streams down, so scenery never blocks the demonstration.
  const u = toUnit(hash2(n, 7, 31));
  return u < 0.5 ? 8 + u * 2 * 48 : 70 + (u - 0.5) * 2 * 50;
}

function propGy(i: number): number {
  if (i < COLUMNS) return BAY_0 + Math.floor(i / AISLES.length) * BAY_STEP;
  return 14 + toUnit(hash2(i - COLUMNS, 11, 53)) * 100;
}

/** Fill the frame's one sorter with the hall. Props are `−1 − i` so one bucket can hold them and
 *  the crowd without either side needing to know the other exists. */
export function addProps(bucket: Bucket<number>): void {
  for (let i = 0; i < PROPS; i++) {
    const k = kindOf(i);
    const gx = propGx(i);
    const gy = propGy(i);
    if (k === 0) bucket.add(-1 - i, gx, gy, 1.1, 1.1, 170);
    else if (k === 1) bucket.add(-1 - i, gx, gy, 1.2, 1.2, 34);
    else bucket.add(-1 - i, gx, gy, 1.6, 0.7, 16);
  }
}

export function drawProp(pen: Pen, i: number, t: number): void {
  const gx = propGx(i);
  const gy = propGy(i);
  const k = kindOf(i);
  // Distance band. The far half of the hall gets fewer faces as well as less light: fidelity at a
  // distance nobody can resolve is the one saving that costs nothing to take.
  const far = gx + gy < 96;
  if (k === 0) {
    isoPatch(pen, gx - 0.35, gy - 0.35, 1.7, 1.7, 0.004, withAlpha(pen.palette.get('ink'), 60));
    isoBox(pen, gx - 0.1, gy - 0.1, 1.2, 1.2, { color: 'metal', h: 0.26 });
    isoBox(pen, gx + 0.12, gy + 0.12, 0.76, 0.76, { color: far ? 'metal' : 'glass', h: 5.6, z: 0.26 });
    // The capital and the lamp under it are the near band's whole detail budget, and they are what
    // makes a post read as a column. The far band gets neither, which is § Scale's own advice:
    // fidelity at a distance nobody can resolve is the one saving that costs nothing to take.
    if (!far) {
      isoBox(pen, gx - 0.14, gy - 0.14, 1.28, 1.28, { color: 'metal', h: 0.34, z: 5.86 });
      isoBox(pen, gx - 0.02, gy - 0.02, 1.04, 1.04, { color: 'glass', h: 0.12, z: 6.2 });
      glowDot(pen, gx + 0.5, gy + 0.5, 5.5, 'warn', 0.2, 0.6 + Math.sin(t * 1.2 + gy) * 0.12);
    }
    return;
  }
  if (k === 1) {
    isoBox(pen, gx, gy, 1.1, 1.1, { color: 'metal', h: 0.34 });
    isoBox(pen, gx + 0.16, gy + 0.16, 0.78, 0.78, { color: 'ok', h: 0.5 + toUnit(hash2(i, 3, 5)) * 0.5, z: 0.34 });
    return;
  }
  isoBox(pen, gx, gy, 1.5, 0.55, { color: 'ground', h: 0.16 });
  isoBox(pen, gx + 0.05, gy + 0.05, 1.4, 0.45, { color: 'glass', h: 0.1, z: 0.16 });
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────

/** How many shades of the ground slot the floor is laid in. Eight is enough that no single one of
 *  them is the frame's modal color and few enough that the floor still reads as one material. */
const SHADES = 8;

export function ground(pen: Pen, gx: number, gy: number, blocked: boolean, contour: boolean): void {
  if (blocked) {
    isoTile(pen, gx, gy, shade(pen.palette.get('ink'), 1.15), 'ink', 0.02);
    return;
  }
  const base = pen.palette.get('ground');
  // Two-tile slabs with a grout line between them, then a per-tile shade off a hash. The slab is
  // what makes it read as laid stone; the hash is what stops the frame having one modal color.
  const slab = (((gx >> 1) + (gy >> 1)) & 1) === 0 ? 1.07 : 0.94;
  const grain = Math.round(toUnit(hash2(gx, gy, 41)) * (SHADES - 1)) / (SHADES - 1);
  const fill = shade(base, slab * (0.84 + grain * 0.3));
  isoTile(pen, gx, gy, contour ? mix(fill, pen.palette.get('glass'), 0.34) : fill, undefined, 0.008);
  // A stud every fifth tile of a contour, dim enough that it reads as inlay in the floor rather
  // than as the brightest thing in the hall. The crowd has to out-rank the paving it is walking on.
  if (contour && (gx + gy) % 5 === 0) isoPatch(pen, gx + 0.38, gy + 0.38, 0.24, 0.24, 0.012, withAlpha(pen.palette.get('warn'), 150));
  else if ((gx + gy) % 23 === 0) isoPatch(pen, gx + 0.12, gy + 0.12, 0.76, 0.76, 0.01, shade(base, 0.72));
}

// ── the sky, the haze, and the three things the crowd is walking around ─────────────────────

/**
 * A vertical ramp behind everything, with the horizon attached to the *world*.
 *
 * `gx + gy = 0` is the map's far corner and projects to the same screen row at every zoom, so the
 * haze stays welded to the far end of the hall while the camera moves rather than sliding across
 * it — which is the difference between a backdrop and a sticker.
 */
export function drawSky(pen: Pen): void {
  const s = pen.surface;
  const xy = pen.xy;
  xy[0] = 0; xy[1] = 0; xy[2] = s.width; xy[3] = 0;
  xy[4] = s.width; xy[5] = s.height; xy[6] = 0; xy[7] = s.height;
  s.polyRamp(xy, 4, 0, 0, 0, s.height, pen.palette.get('sky'), shade(pen.palette.get('sky'), 1.5));
}

/** The far band, taken down. Constant color, so it is one cached ramp for the whole session. */
export function drawHaze(pen: Pen): void {
  const s = pen.surface;
  const horizon = pen.camera.toScreenY(0) + pen.snapY;
  s.softEllipse(s.width * 0.5, horizon, s.width * 0.9, s.height * 0.36, withAlpha(pen.palette.get('sky'), 150), 0);
}

/**
 * One tile of the divider, as a solid rather than as paint on the floor.
 *
 * It is in the frame's sorter — `main.ts` adds it — and that is the whole reason it is here
 * instead of in the terrain pass: a two-storey wall drawn with the ground is a wall every walker
 * paints over, including the ones standing behind it.
 */
export function wall(pen: Pen, gx: number, gy: number): void {
  isoBox(pen, gx + 0.04, gy, 0.92, 1, { color: 'metal', h: 2.1 });
  isoBox(pen, gx - 0.02, gy, 1.04, 1, { color: 'glass', h: 0.14, z: 2.1 });
}

export function barrier(pen: Pen, gx: number, gy: number, closed: boolean): void {
  const h = closed ? 2.4 : 0.32;
  isoPatch(pen, gx - 0.6, gy - 0.6, 2.2, 2.2, 0.02, withAlpha(pen.palette.get('warn'), 90));
  isoBox(pen, gx + 0.08, gy + 0.08, 0.84, 0.84, { color: closed ? 'brand' : 'metal', h, z: 0.03 });
  isoPost(pen, gx + 0.18, gy + 0.18, 0.04, h + 0.32, 'warn');
  isoPost(pen, gx + 0.82, gy + 0.82, 0.04, h + 0.32, 'warn');
}

export function goal(pen: Pen, gx: number, gy: number, t: number): void {
  const h = 2.2 + Math.sin(t * 3) * 0.12;
  isoBox(pen, gx - 1.5, gy - 1.5, 4, 4, { color: 'glass', h: 0.12, z: 0.02 });
  isoPost(pen, gx + 0.5, gy + 0.5, 0.12, h, 'warn', 0.3);
  glowDot(pen, gx + 0.5, gy + 0.5, h + 0.2, 'warn', 0.5, 0.9);
}

export function person(pen: Pen, p: PersonView, t: number, near: boolean): void {
  const bounce = Math.abs(Math.sin(t * 6 + p.phase)) * 0.08;
  isoBox(pen, p.x - 0.15, p.y - 0.15, 0.3, 0.3, {
    color: p.hue % 3 === 0 ? 'brand' : p.hue % 3 === 1 ? 'glass' : 'metal',
    h: near ? 0.62 : 0.44,
    z: bounce,
  });
  if (near) isoBox(pen, p.x - 0.1, p.y - 0.1, 0.2, 0.2, { color: 'warn', h: 0.16, z: 0.62 + bounce });
}
