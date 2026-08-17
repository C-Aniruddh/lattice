/**
 * @art — everything in the valley that stands up: houses, trees, barley, hedgerows, the compound
 * wall, the well, the gate and the mill.
 *
 * Delete this file and the errand still plays out on a bare colored map. Nothing here is remembered
 * between frames and nothing here returns a number any decision reads.
 *
 * ## Every object is a function of its own tile
 *
 * There is no prop list. {@link paintTile} is handed a grid coordinate and the ground kind under
 * it, and answers with a tree, four stalks, a hedge section or nothing — deciding *which* out of
 * `hash2(seed, gx, gy)`, exactly as `crowd`'s people are decided out of their index. That is what
 * makes the same oak stand on the same knoll on every reload and at every zoom, and it is why
 * several hundred solids a frame cost no memory at all.
 *
 * A house is the one thing bigger than a tile, and it is still not a list: `valley.houseAt` packs
 * its size into an integer derived from the *block*, so the origin tile of a plot draws the whole
 * building — one massed body, a pitched roof, a chimney, two lit windows — and the other eleven
 * tiles of the same house draw nothing at all.
 *
 * ## The rule the silhouettes are built on, and the one that pays for them
 *
 * Detail at three scales, with something on every object that still reads at twelve pixels: a house
 * is a body, a roof with a ridge, and a chimney; a tree is a trunk, a mass, and a highlight cap; a
 * plant is a stalk and an ear.
 *
 * And then **every one of those three scales is bought back in the far band.** `ground.band` is the
 * same number the haze is mixed by, and § Scale's permission to draw the distance dimmer is also
 * permission to draw it cheaper. The table is the exhibit's whole frame-time strategy:
 *
 * | | near | mid | far |
 * |---|---|---|---|
 * | a tree | trunk, mass, cap, shadow | trunk, mass | one mass |
 * | a crop tile | four stalks with ears | one stalk | nothing |
 * | a hedge | mass and a marker post | mass | mass |
 * | a house | body, roof, chimney, windows | body, roof | body, roof |
 *
 * Nothing in that table changes what the exhibit is, and it is worth roughly two thirds of the
 * solids in a frame.
 */
import { hash2, toUnit } from '@latticekit/core';
import {
  LEVEL_H,
  contactShadow,
  isoBox,
  isoCylinder,
  isoPost,
  isoRoof,
  mix,
  shade,
  withAlpha,
  type Pen,
} from '@latticekit/draw';
import { gridToScreen } from '@latticekit/iso';
import { CROP, GATE, HEDGE, MILL, WALL, WELL, WOOD, houseAt } from './valley.js';
import { band, haze } from './ground.js';

const pt = { x: 0, y: 0 };

/**
 * One tile's worth of standing thing, called from the solids pass in depth order.
 *
 * `lod` is `2` in the foreground, `1` in the middle and `0` on the ridge, and it is computed once
 * by the caller from `band` and the zoom rather than per object here.
 */
export function paintTile(pen: Pen, seed: number, gx: number, gy: number, kind: number, lod: number, turning: boolean): void {
  if (gx === MILL.gx && gy === MILL.gy) paintMill(pen, turning);
  else if (kind === WOOD) tree(pen, seed, gx, gy, lod);
  else if (kind === CROP) barley(pen, seed, gx, gy, lod);
  else if (kind === HEDGE) hedge(pen, seed, gx, gy, lod);
  else if (kind === WALL) built(pen, seed, gx, gy, lod);
}

/**
 * A tree, in one of three species chosen by hash.
 *
 * Two masses rather than one — a wide skirt and a cap offset toward the light — because a single
 * cylinder is a lollipop and two overlapping ones are a canopy. The offset is per tree, so a wood
 * has a direction the weather has been coming from.
 */
function tree(pen: Pen, seed: number, gx: number, gy: number, lod: number): void {
  const h = hash2(seed ^ 0x7e, gx, gy);
  const kind = h & 3;
  const tall = 1.1 + toUnit(h >>> 8) * 1.5 + (kind === 2 ? 0.9 : 0);
  const lean = (toUnit(h >>> 16) - 0.5) * 0.16;
  const leaf = haze(pen, gx, gy, mix(pen.palette.get('hedge'), pen.palette.get('ok'), toUnit(h >>> 4) * 0.55));
  const cx = gx + 0.5 + lean;
  const cy = gy + 0.5 - lean;
  if (lod > 0) {
    isoPost(pen, cx, cy, 0, tall * 0.55, haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.5)), 0.075);
  }
  if (kind === 2) {
    // A conifer: three stacked cones, which at this scale are three shrinking cylinders. The far
    // band gets the bottom one only, which from there is the same silhouette.
    for (let i = 0; i < (lod > 0 ? 3 : 1); i++) {
      isoCylinder(pen, cx, cy, 0.42 - i * 0.1, {
        color: shade(leaf, 0.9 + i * 0.09),
        h: tall * (lod > 0 ? 0.3 : 0.9),
        z: tall * (0.42 + i * 0.26),
        outline: i === 0,
      });
    }
    return;
  }
  isoCylinder(pen, cx, cy, kind === 1 ? 0.36 : 0.46, { color: leaf, h: tall * 0.62, z: tall * 0.5 });
  if (lod < 2) return;
  contactShadow(pen, cx - 0.4, cy - 0.4, 0.8, 0.8, 0.4, 0);
  isoCylinder(pen, cx - 0.08, cy - 0.08, kind === 1 ? 0.24 : 0.32, {
    color: shade(leaf, 1.16),
    h: tall * 0.3,
    z: tall * 0.92,
    outline: false,
  });
}

/**
 * Barley on one tile: four stalks near, one in the middle distance, none on the ridge.
 *
 * The sway is a **triangle wave**, not a sine. `Math.sin` is Tier B, and although a crop's lean
 * never reaches a save file, a triangle is exact arithmetic, costs less, and at four pixels is
 * indistinguishable. Its phase runs with `gx + gy`, so the wind crosses a field as a wave rather
 * than shaking every plant at once — which is the difference between a field and a screensaver.
 */
function barley(pen: Pen, seed: number, gx: number, gy: number, lod: number): void {
  if (lod === 0) return;
  const ear = haze(pen, gx, gy, pen.palette.get('crop'));
  const stalk = haze(pen, gx, gy, shade(pen.palette.get('crop'), 0.72));
  const cycle = (pen.t * 0.5 + (gx + gy) * 0.045) % 1;
  const gust = (cycle < 0.5 ? cycle * 4 - 1 : 3 - cycle * 4) * 0.055;
  for (let i = 0; i < (lod === 2 ? 4 : 1); i++) {
    const h = hash2(seed ^ 0x3b, gx * 4 + i, gy);
    const ox = 0.18 + toUnit(h) * 0.64;
    const oy = 0.18 + toUnit(h >>> 9) * 0.64;
    const tall = 0.4 + toUnit(h >>> 18) * 0.22;
    isoPost(pen, gx + ox, gy + oy, 0, tall, stalk, 0.035);
    isoBox(pen, gx + ox - 0.05 + gust, gy + oy - 0.05 + gust, 0.1, 0.1, {
      color: ear,
      h: 0.13,
      z: tall,
      outline: false,
    });
  }
}

/** A hedgerow section: a low mass with an uneven top, and a marker post every eighth tile. */
function hedge(pen: Pen, seed: number, gx: number, gy: number, lod: number): void {
  const h = hash2(seed ^ 0x1c, gx, gy);
  const green = haze(pen, gx, gy, shade(pen.palette.get('hedge'), 0.92 + toUnit(h) * 0.2));
  isoBox(pen, gx + 0.08, gy + 0.08, 0.84, 0.84, { color: green, h: 0.44 + toUnit(h >>> 8) * 0.2, z: 0 });
  if (lod === 2 && (h & 7) === 0) {
    isoPost(pen, gx + 0.5, gy + 0.5, 0, 1.05, haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.55)), 0.06);
  }
}

/**
 * Anything the map calls `WALL`: a village house at its own origin tile, or a section of the mill
 * compound's stone wall. The mill's own tile is skipped — `paintMill` draws it, because it is one
 * of the things a player is walking toward and it has to be the tallest object in the valley.
 */
function built(pen: Pen, seed: number, gx: number, gy: number, lod: number): void {
  if (gx === MILL.gx && gy === MILL.gy) return;
  const bx = Math.floor(gx / 7);
  const by = Math.floor(gy / 7);
  const plot = houseAt(seed, bx, by);
  if (plot === 0) {
    const stone = haze(pen, gx, gy, pen.palette.get('stone'));
    isoBox(pen, gx, gy, 1, 1, { color: stone, h: 1.15, z: 0 });
    isoBox(pen, gx - 0.05, gy - 0.05, 1.1, 1.1, { color: shade(stone, 0.86), h: 0.1, z: 1.15, outline: false });
    return;
  }
  if (gx === bx * 7 + 2 && gy === by * 7 + 2) house(pen, seed, gx, gy, plot & 7, plot >> 3, lod);
}

/**
 * A house: body, roof, ridge, chimney, and a lit window on each of the two faces that catch the
 * light.
 *
 * The roof is `isoRoof` rather than a second box, and that is most of what makes a village look
 * designed: a flat-topped box is a bunker at any color, and a pitched roof is a house at twelve
 * pixels. The windows are thin lifted boxes on the wall plane rather than blocks glued to it,
 * which is what makes them read as openings.
 */
function house(pen: Pen, seed: number, gx: number, gy: number, w: number, d: number, lod: number): void {
  const h = hash2(seed ^ 0xa7, gx, gy);
  const storeys = 1.7 + (h & 1) * 0.8;
  const body = haze(pen, gx, gy, mix(pen.palette.get('stone'), pen.palette.get('thatch'), toUnit(h >>> 8) * 0.55));
  const roof = haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.8 + toUnit(h >>> 16) * 0.3));
  if (lod === 2) contactShadow(pen, gx, gy, w, d, 0.5, 0);
  isoBox(pen, gx, gy, w, d, { color: body, h: storeys, z: 0 });
  isoRoof(pen, gx - 0.12, gy - 0.12, w + 0.24, d + 0.24, storeys, 0.78, roof);
  if (lod < 2) return;
  // On the ridge, not beside the eaves: a chimney at the edge of the roof reads as a crate somebody
  // left on the lawn, and the ridge is the one place a plume can rise without clipping the tiles.
  isoBox(pen, gx + w * 0.5 - 0.16, gy + d * 0.5 - 0.16, 0.32, 0.32, {
    color: shade(body, 0.74), h: 0.55, z: storeys + 0.72, outline: false,
  });
  const lit = withAlpha(mix(pen.palette.get('warn'), 0xfff4d0ff, 0.5), 0.9);
  isoBox(pen, gx + w * 0.3, gy - 0.02, 0.34, 0.04, { color: lit, h: 0.34, z: storeys * 0.42, outline: false });
  isoBox(pen, gx - 0.02, gy + d * 0.3, 0.04, 0.34, { color: lit, h: 0.34, z: storeys * 0.42, outline: false });
}

/**
 * The old well: a stone drum, a frame, and a bucket swinging on its rope.
 *
 * Drawn from the *spot* pass rather than from a tile, because it is one of the four things a player
 * can touch and the painting has to agree with the picking exactly — see the pick test in
 * `main.ts`, which silhouettes the same tile this stands on.
 */
export function paintWell(pen: Pen, keyHere: boolean): void {
  const gx = WELL.gx;
  const gy = WELL.gy;
  const stone = haze(pen, gx, gy, pen.palette.get('stone'));
  const beam = haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.55));
  contactShadow(pen, gx - 0.1, gy - 0.1, 1.2, 1.2, 0.5, 0);
  isoCylinder(pen, gx + 0.5, gy + 0.5, 0.52, { color: stone, h: 0.62, z: 0 });
  isoCylinder(pen, gx + 0.5, gy + 0.5, 0.4, { color: shade(stone, 0.34), h: 0.04, z: 0.62, outline: false });
  // The frame sits *on* the drum. The first draft started the posts at half a storey and put the
  // roof two storeys up, which at this zoom is a canopy floating a hand's width above a bucket —
  // the posts were six pixels wide and simply did not read as holding anything up.
  isoPost(pen, gx + 0.15, gy + 0.15, 0.55, 0.95, beam, 0.12);
  isoPost(pen, gx + 0.85, gy + 0.85, 0.55, 0.95, beam, 0.12);
  isoRoof(pen, gx - 0.06, gy - 0.06, 1.12, 1.12, 1.5, 0.42, shade(beam, 1.1));
  // The bucket sways under it, so the well is alive before anyone has touched it.
  const phase = (pen.t * 0.35) % 1;
  const swing = (phase < 0.5 ? phase - 0.25 : 0.75 - phase) * 0.5;
  isoCylinder(pen, gx + 0.5 + swing, gy + 0.5 - swing, 0.17, {
    color: shade(beam, 0.8), h: 0.24, z: 1.0, outline: false,
  });
  if (keyHere) glint(pen, gx + 0.5, gy + 0.5, 0.85, pen.palette.get('warn'), pen.t);
}

/**
 * The mill gate, shut or thrown open.
 *
 * **This is the exhibit's one causal link, drawn.** The same boolean that opens the route through
 * `makeCost` swings the two leaves back against their piers and lays a warm patch on the road, so a
 * visitor sees the *world* change rather than a counter change. `ready` is the key in hand and no
 * more: it pulses the gate so the player knows where to spend what they are carrying.
 */
export function paintGate(pen: Pen, open: boolean, ready: boolean): void {
  const gx = GATE.gx;
  const gy = GATE.gy;
  const stone = haze(pen, gx, gy, pen.palette.get('stone'));
  const oak = haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.52));
  isoPost(pen, gx + 0.05, gy + 0.5, 0, 1.9, stone, 0.16);
  isoPost(pen, gx + 0.95, gy + 0.5, 0, 1.9, stone, 0.16);
  for (let i = 0; i < 2; i++) {
    const swung = open ? (i === 0 ? -0.22 : 0.22) : 0;
    isoBox(pen, gx + (i === 0 ? 0.08 : 0.52) + swung * 0.4, gy + 0.44 + swung, 0.4, 0.12, {
      color: oak,
      h: 1.5,
      z: 0,
    });
  }
  isoBox(pen, gx + 0.02, gy + 0.42, 0.96, 0.16, { color: shade(stone, 0.9), h: 0.18, z: 1.9, outline: false });
  if (open) pool(pen, gx + 0.5, gy + 1.1, 0, pen.palette.get('warn'), 0.3, 46);
  else if (ready) glint(pen, gx + 0.5, gy + 0.46, 1.0, pen.palette.get('warn'), pen.t);
}

/**
 * The mill: a stone tower, a cap, and four sails that turn once the gate is open.
 *
 * The sails are the reason the compound is worth walking to — nothing else in the valley is this
 * tall or this obviously *stopped* — and they are drawn in screen space with the quarter-turn done
 * as exact arithmetic on a diamond rather than a `sin`/`cos` pair. At this projection the difference
 * is under a pixel, and the arithmetic is Tier A.
 */
const MAX_MILL_PX = 230;

function paintMill(pen: Pen, turning: boolean): void {
  const gx = MILL.gx;
  const gy = MILL.gy;
  const stone = haze(pen, gx, gy, pen.palette.get('stone'));
  contactShadow(pen, gx - 0.6, gy - 0.6, 2.2, 2.2, 0.55, 0);
  for (let i = 0; i < 5; i++) {
    isoCylinder(pen, gx + 0.5, gy + 0.5, 1.05 - i * 0.1, {
      color: shade(stone, 1 - i * 0.028),
      h: 1.1,
      z: i * 1.1,
      outline: i === 0,
    });
  }
  isoCylinder(pen, gx + 0.5, gy + 0.5, 0.74, {
    color: haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.72)),
    h: 0.9,
    z: 5.5,
    outline: true,
  });
  gridToScreen(pen.camera, gx + 0.5, gy + 0.5, 5.9 * LEVEL_H, pt);
  const k = pen.camera.zoom;
  const timber = haze(pen, gx, gy, shade(pen.palette.get('thatch'), 0.42));
  const xy = pen.xy;
  const x = pt.x + pen.snapX;
  const y = pt.y + pen.snapY;
  for (let i = 0; i < 4; i++) {
    const q = (((turning ? pen.t * 0.42 : 0.13) + i * 0.25) % 1) * 4;
    // A diamond parameterisation of the turn: |s| + |c| = 1 rather than s² + c² = 1. It is an
    // ellipse a reader would not pick out of a lineup and it costs no transcendentals.
    const s = q < 1 ? q : q < 3 ? 2 - q : q - 4;
    const c = q < 2 ? 1 - q : q - 3;
    xy[0] = x; xy[1] = y;
    xy[2] = x + c * 64 * k; xy[3] = y - s * 30 * k;
    pen.surface.stroke(xy, 2, false, timber, 5.5 * k);
    pen.surface.stroke(xy, 2, false, withAlpha(shade(timber, 1.5), 0.5), 2 * k);
  }
  if (turning) pool(pen, gx + 0.5, gy + 2.2, 0, pen.palette.get('warn'), 0.22, 90);
}

/** A pulsing halo over the thing a player should touch next. The exhibit's only tutorial, and the
 *  reason `warn` is used for nothing else. */
function glint(pen: Pen, gx: number, gy: number, levels: number, color: number, t: number): void {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  const beat = (t * 0.9) % 1;
  const r = (10 + beat * 24) * pen.camera.zoom;
  const x = pt.x + pen.snapX;
  const y = pt.y + pen.snapY;
  pen.surface.softEllipse(x, y, r, r * 0.55, withAlpha(color, (1 - beat) * 0.5), withAlpha(color, 0));
  pen.surface.ellipse(x, y, 3.4 * pen.camera.zoom, 3.4 * pen.camera.zoom, mix(color, 0xffffffff, 0.55));
}

/** A warm patch on the ground — what a `LightField` would have cost a full-screen composite for.
 *  Two ellipses, no pass, and it reads as light because it is under something that is emitting. */
function pool(pen: Pen, gx: number, gy: number, levels: number, color: number, alpha: number, radius: number): void {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  const k = pen.camera.zoom;
  pen.surface.softEllipse(
    pt.x + pen.snapX, pt.y + pen.snapY, radius * k, radius * 0.5 * k,
    withAlpha(color, alpha), withAlpha(color, 0),
  );
}

/** The far band's own permission slip, computed once per tile by the caller instead of every sprite
 *  asking again. `2` near, `1` middle, `0` ridge. */
export function lodAt(gx: number, gy: number, zoom: number): number {
  const d = band(gx, gy);
  return d > 0.66 ? 0 : d > 0.42 || zoom < 0.45 ? 1 : 2;
}

/**
 * What this tile contributes to the frame, packed as `w | d << 3 | topPx << 6`, or `0` for nothing.
 *
 * **This is the other half of the cull**, and it is here rather than in `main.ts` because every
 * answer it gives is about drawing. Three quarters of a village's `WALL` tiles are the *inside* of
 * a house whose origin tile draws the whole building, a crop tile on the ridge draws nothing at
 * all, and both used to reach the depth sorter, get sorted, get walked, and paint nothing. Asking
 * here costs one hash per wall tile and removes several hundred entries a frame.
 *
 * It also carries the footprint, which matters for exactly one thing and matters a lot: a four-tile
 * house added to the sorter as one tile sorts against a person walking past it as if it were a
 * fencepost, and the person walks through the wall on the diagonal.
 */
export function planTile(seed: number, gx: number, gy: number, kind: number, lod: number): number {
  if (kind === WOOD) return 1 | (1 << 3) | (96 << 6);
  if (kind === HEDGE) return 1 | (1 << 3) | (20 << 6);
  if (kind === CROP) return lod === 0 ? 0 : 1 | (1 << 3) | (16 << 6);
  // The mill is the one thing bigger than its tile that is not a house: two tiles square, and the
  // tallest object in the valley, so it needs the footprint or the yard sorts in front of its base.
  // The other three tiles of its square draw nothing at all, or the tower grows a stone skirt.
  if (gx >= MILL.gx && gx <= MILL.gx + 1 && gy >= MILL.gy && gy <= MILL.gy + 1) {
    return gx === MILL.gx && gy === MILL.gy ? 2 | (2 << 3) | (MAX_MILL_PX << 6) : 0;
  }
  if (kind !== WALL) return 0;
  const plot = houseAt(seed, Math.floor(gx / 7), Math.floor(gy / 7));
  if (plot === 0) return 1 | (1 << 3) | (34 << 6);
  if (gx % 7 !== 2 || gy % 7 !== 2) return 0;
  // `houseAt` already packs `w | d << 3`, which is this function's own low six bits exactly.
  return plot | (78 << 6);
}
