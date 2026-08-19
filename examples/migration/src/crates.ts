/**
 * A save, drawn as the thing it is carrying — and the several hundred that are not moving.
 *
 * @art
 *
 * Delete this file and the archive still opens, the chain still steps, and every counter still
 * reads what it read. Nothing here is consulted by a decision; everything here is a reading of a
 * decision already made in `ladder.ts`.
 *
 * ## The whole exhibit is in one table
 *
 * A visitor should be able to tell which build has opened a crate **without reading anything**, so
 * every rung adds a piece of geometry that was not there before. They are cumulative, so the
 * silhouette on terrace 4 contains the silhouette on terrace 1, and counting the parts is
 * counting the rungs.
 *
 * | at | what appears on the crate | the field it is |
 * |---|---|---|
 * | unopened | a plain grey box, no fittings | bytes nobody has read yet |
 * | **v1** | one bar on the lid, and the box painted the color the save carries | `coins`, `tint` |
 * | **v2** | a second bar beside the first | `wallet.ore` |
 * | **v3** | the flat paint plate becomes a bright round chip | `hue` — see below |
 * | **v4** | a mast and a pennant, as tall as the best run | `best` |
 * | **v5** | a third bar, and a gold ring around the chip | `wallet.seal` |
 *
 * ## The chip is the seam, and the panel can prove it
 *
 * At v1 and v2 the crate is painted **the exact `#rrggbb` the old build wrote into the save**.
 * From v3 it is painted `hsl(hue, …)` — derived, on the spot, from the number the save now
 * carries. Both look like a colored crate, and there is only one way to tell them apart: change
 * the derivation. Drag *brand saturation* on the panel and every crate from v3 up moves together
 * while every crate below it stays exactly where it was, because those ones are not carrying a
 * hue at all — they are carrying a token that a retune can never reach.
 *
 * That is `SEAMS.md`'s *persist the input, never the derived value*, with the wrong end of it left
 * on screen the whole time rather than described.
 */
import { clamp, hash2, toUnit } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_W, type Camera, type Rect } from '@latticekit/iso';
import { hex, hsl, isoBox, isoPatch, isoPost, mix, pxToLevels, shade, withAlpha, type Ink, type Pen, type Rgba } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import type { Save } from './chain.js';
import { HEAD } from './chain.js';
import { MAX_HEIGHT_PX, SPAN, gxOf, gyOf, liftAt, type Climber } from './ladder.js';
import { place } from './place.js';
import { hazeAt } from './yard.js';

/** A crate that is not going anywhere: shelved in the archive, or shelved in the vault. Pooled,
 *  refilled every frame from the camera's box, and never remembered. */
interface Shelved { d: number; s: number; v: number; vault: boolean }

/** Anything the depth sorter holds this frame. */
export type Standing = Climber | Shelved;

const isClimber = (x: Standing): x is Climber => 'filed' in x;

/** The pool. Positions are a closed-form function of the lattice they stand on, so this array
 *  exists so that filling seven hundred of them allocates nothing — not so that anything is
 *  remembered between frames. */
const shelves: Shelved[] = [];

/** Tallest thing a crate puts above its own ground, in world pixels. The sorter is handed this,
 *  and the cull has to use the same number or a mast pops in along the top edge one frame after
 *  the box under it. */
const LIFT = 34;

const seen: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Fill the frame's depth order: the shelves the camera can see, then the eighty saves on the
 * ladder.
 *
 * **The cull happens before `add`.** `SEAMS.md` pins that `iso` sorts and `draw` paints the same
 * permutation, walked backwards for a tap, so a cull only one side knows about is exactly the
 * silent mis-pick that contract exists to prevent. There is one list here: the sorter, `each` and
 * `pick` all see identical contents, and the sorter's own cull stays the only thing that decides.
 */
export function fillCrates(bucket: Bucket<Standing>, lanes: readonly Climber[], camera: Camera, build: number): void {
  camera.visibleWorldBounds(seen, TILE_W);
  const dLo = Math.floor(-seen.maxY / HALF_H) - 2;
  const dHi = Math.ceil((-seen.minY + MAX_HEIGHT_PX) / HALF_H) + 2;
  const sLo = Math.floor(seen.minX / HALF_W) - 2;
  const sHi = Math.ceil(seen.maxX / HALF_W) + 2;
  let n = 0;
  // Two shelf bands, both on a 2×2 lattice in ladder space: the archive out in front of the first
  // deck, and the vault along the top one. Everything between them is the working ladder and is
  // deliberately kept clear, because a crate climbing has to be the only thing that moves.
  const put = (d: number, s: number, v: number, vault: boolean): void => {
    const item = shelves[n] ?? { d: 0, s: 0, v: 0, vault: false };
    shelves[n] = item; n++;
    item.d = d; item.s = s; item.v = v; item.vault = vault;
    bucket.add(item, gxOf(d, s), gyOf(d, s), 1, 1, liftAt(d, s) + LIFT);
  };
  // Two shelf bands: the archive out in front of the first deck, and the vault along the top one.
  // Everything between them is the working ladder and is deliberately kept clear of stock, because
  // a crate climbing has to be the only thing in the yard that moves.
  // Thin the shelf lattice when a crate is under about twenty pixels: at that size a stack reads
  // as *stock* and nobody can count it, so half of them cost frame time and buy nothing. The
  // climbing saves are never thinned — they are the subject.
  const stride = camera.zoom < 0.55 ? 4 : 2;
  for (let d = Math.max(dLo, -60) | 0; d <= Math.min(dHi, (HEAD - 1) * SPAN + 34); d += stride) {
    const vault = d > (HEAD - 1) * SPAN + 1;
    if ((d > -6 && !vault) || (vault && build < HEAD)) continue;
    for (let s = sLo - (sLo & 1); s <= sHi; s += stride) {
      const h = hash2(11, d, s);
      if (toUnit(h) <= 0.72) put(d + (h & 3) * 0.18, s + ((h >>> 4) & 3) * 0.18, h, vault);
    }
  }
  for (const c of lanes) bucket.add(c, gxOf(c.d, c.s), gyOf(c.d, c.s), 1, 1, liftAt(c.d, c.s) + LIFT);
}

// ── color ────────────────────────────────────────────────────────────────────────────────────

/** How much air is in front of the crate being drawn. Frame context: every drawer needs it and
 *  none of them decides it, which is the same reason `Pen` exists. */
let air = 0;
/** The brand derivation currently in force, handed in by the frame. Held for the duration of one
 *  paint call and never across frames — the panel owns this number, not this file. */
let sat = 0.62;
const light = 0.54;

function dim(pen: Pen, c: Rgba): Rgba {
  return air <= 0 ? c : mix(c, pen.palette.get('mist'), air);
}

/**
 * The color a crate is painted, and the one line in this exhibit that carries an argument.
 *
 * Below v3 the save is carrying `#rrggbb` — a presentation token an old build wrote into a
 * document — and this reads it back verbatim, because there is nothing else in there to read.
 * From v3 the save is carrying a hue, and this *derives* the color from it with the sat and light
 * the panel currently holds. Same crate, same player, two entirely different promises about what
 * happens when the art direction changes.
 */
function coatOf(pen: Pen, s: Save | null): Rgba {
  if (s === null) return pen.palette.get('bytes');
  if (s.version === 1 || s.version === 2) return hex(s.tint);
  return hsl(s.hue, sat, light);
}

// ── the crate ────────────────────────────────────────────────────────────────────────────────

const W = 0.78;

/**
 * One post on the lid: a currency, as tall as it is worth.
 *
 * Logarithmic, because a wallet holding 9,900 beside one holding 40 on a linear scale is one post
 * and one invisible line — and with a **floor**, because `ore` and `seal` are always exactly zero
 * the moment their rung creates them. A currency that starts empty is what a real migration
 * produces, so the thing that has to be visible is the post's *presence* rather than its height:
 * one post is a v1 save, two is v2, three is v5, and that is countable at any zoom that shows a
 * crate at all.
 */
function bar(pen: Pen, d: number, sy: number, i: number, value: number, ink: Ink, z: number): void {
  const h = 0.3 + clamp(Math.log10(1 + Math.abs(value)) / 4, 0, 1) * 0.75;
  isoBox(pen, gxOf(d, sy) + 0.14 + i * 0.24, gyOf(d, sy) + 0.2, 0.18, 0.18, { color: ink, h, z, outline: false });
}

/**
 * The mast: the best run, as height.
 *
 * It is the field the third rung introduces, and the field the third rung refuses when it is
 * infinite — so it is drawn as the one thing on a crate that points at the sky, and a save that
 * fell off that rung is the one crate in the yard that never grows one.
 */
function mast(pen: Pen, d: number, sy: number, base: number, z: number, best: number): void {
  const h = 0.9 + clamp(Math.log10(1 + best) / 5, 0, 1) * 1.5;
  const gx = gxOf(d, sy) + 0.62, gy = gyOf(d, sy) + 0.74;
  isoPost(pen, gx, gy, z + 0.5, h, dim(pen, shade(pen.palette.get('ink'), 1.7)), 0.06);
  const tip = place(pen, gx, gy, base + (0.5 + h) * 26), w = HALF_W * pen.camera.zoom * 0.26;
  pen.surface.ellipse(tip.x + w * 0.75, tip.y + w * 0.22, w, w * 0.46, dim(pen, pen.palette.get('brand')));
}

/**
 * One save on the ladder.
 *
 * Everything drawn here is read off `c.open.state` — the object a real `decode` returned this many
 * rungs ago — so a crate cannot show a field the build under it has not produced. The lid is where
 * the seam lives: below v3 it carries a dull **plate**, the `#rrggbb` an old build wrote down and
 * painted itself; from v3 it carries a bright **chip** struck from the hue, and the whole crate
 * with it.
 */
function crate(pen: Pen, c: Climber): void {
  const gx = gxOf(c.d, c.s), gy = gyOf(c.d, c.s), base = liftAt(c.d, c.s), z = pxToLevels(base);
  const s = c.open?.state ?? null, fallen = c.fell > 0;
  const coat = fallen ? mix(coatOf(pen, s), pen.palette.get('ash'), 0.74) : coatOf(pen, s);
  const live = s !== null && s.version !== 1 && s.version !== 2 ? s : null;
  // A refused save tips onto its corner as it goes back down. Half a tile of lift and a shrunken
  // footprint is the whole of the tumble: a rotation would want a transform stack this kit does
  // not have, and a box visibly *not square on the ground* reads as fallen anyway.
  const tip = fallen ? Math.min(c.fell, 0.5) : 0;
  isoBox(pen, gx + (1 - W) / 2, gy + (1 - W) / 2 + tip * 0.3, W - tip * 0.2, W - tip * 0.2, {
    color: dim(pen, coat), h: 0.62 - tip * 0.34, z: z + tip * 0.12,
    topColor: dim(pen, live !== null ? hsl(live.hue, Math.min(1, sat + 0.28), light + 0.14) : shade(coat, 1.12)),
  });
  if (s === null || fallen) {
    if (fallen) glow(pen, c.d, c.s, base, 'bad');
    return;
  }
  const lid = z + 0.62;
  bar(pen, c.d, c.s, 0, s.version === 1 ? s.coins : s.wallet.coin, dim(pen, pen.palette.get('warn')), lid);
  if (s.version !== 1) bar(pen, c.d, c.s, 1, s.wallet.ore, dim(pen, pen.palette.get('metal')), lid);
  if (s.version === 5) bar(pen, c.d, c.s, 2, s.wallet.seal, dim(pen, pen.palette.get('ok')), lid);
  if (s.version === 4 || s.version === 5) mast(pen, c.d, c.s, base, z, s.best);
  // The plate, and then the chip that replaces it. A rectangle of dried paint against a struck
  // bright disc: the same information twice, and one of them is a token and the other is a number.
  if (s.version === 1 || s.version === 2) {
    // A flat painted swatch, square and dull: the `#rrggbb` an old build wrote into the document,
    // reproduced exactly as it was written down and unreachable by any retune.
    isoPatch(pen, gx + 0.42, gy + 0.42, 0.42, 0.42, z + 0.63, dim(pen, shade(hex(s.tint), 0.72)), dim(pen, shade(coat, 0.68)));
    return;
  }
  const p = place(pen, gx + 0.63, gy + 0.63, base + 17), r = HALF_W * pen.camera.zoom * 0.24;
  if (s.version === 5) pen.surface.ellipse(p.x, p.y, r * 1.34, r * 0.78, withAlpha(pen.palette.get('warn'), 0.8));
  pen.surface.ellipse(p.x, p.y, r * 0.94, r * 0.52, dim(pen, hsl(s.hue, 0.98, 0.62)));
}

/** A small stain of color on the ground under a crate, for the two moments worth marking: a
 *  refusal, and the crate the readout is following. */
function glow(pen: Pen, d: number, sy: number, base: number, slot: string): void {
  const p = place(pen, gxOf(d, sy) + 0.5, gyOf(d, sy) + 0.5, base);
  const r = HALF_W * pen.camera.zoom * 0.8;
  pen.surface.ellipse(p.x, p.y, r, r * 0.5, withAlpha(pen.palette.get(slot), 0.34));
}

/** A shelved crate: three ops, because there are hundreds of them and none of them is doing
 *  anything. Their colour is stock rather than identity — a distinct hue out on the archive floor
 *  would compete with the saves that are actually moving, and those are the subject. */
function shelf(pen: Pen, it: Shelved): void {
  const gx = gxOf(it.d, it.s), gy = gyOf(it.d, it.s), r = toUnit(it.v);
  isoBox(pen, gx + 0.14, gy + 0.14, 0.7, 0.7, {
    color: dim(pen, shade(pen.palette.get(it.vault ? 'deck5' : 'bytes'), 0.82 + r * 0.4)),
    h: 0.3 + ((it.v >>> 8) & 3) * 0.28,
    z: pxToLevels(liftAt(it.d, it.s)),
    outline: false,
  });
}

/** Hoisted: `Bucket.each` states the rule, and an inline arrow here is a closure a frame. */
const paint = (x: Standing): void => {
  if (pass === undefined) return;
  air = hazeAt(pass, place(pass, gxOf(x.d, x.s), gyOf(x.d, x.s), liftAt(x.d, x.s)).y);
  if (isClimber(x)) crate(pass, x);
  else shelf(pass, x);
};

let pass: Pen | undefined;

/** The Solids pass. Walks the sorted order forwards, which is the painter's algorithm done right;
 *  `Bucket.each` is what makes that the only available direction. */
export function paintCrates(pen: Pen, bucket: Bucket<Standing>, brandSat: number): void {
  pass = pen;
  sat = brandSat;
  bucket.each(paint);
}

/** The ring under the crate the readout is following. Drawn in the Placement pass, above every
 *  solid, so it is never hidden by the crate in front of it. */
export function markFocus(pen: Pen, c: Climber): void {
  air = 0;
  glow(pen, c.d, c.s, liftAt(c.d, c.s), 'line');
  const p = place(pen, gxOf(c.d, c.s) + 0.5, gyOf(c.d, c.s) + 0.5, liftAt(c.d, c.s) + 74 + Math.sin(pen.t * 3) * 4);
  const w = HALF_H * pen.camera.zoom * 0.62;
  pen.surface.ellipse(p.x, p.y, w * 0.75, w, pen.palette.get('line'));
}
