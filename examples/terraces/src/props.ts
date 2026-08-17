/**
 * What stands on the hill: hedgerow trees along the banks, sheds and stooks out on the flat,
 * and the people working it.
 *
 * @art
 *
 * Delete this file and the hill is bare and the exhibit still does everything it exists to do.
 * Nothing here holds a number anything reads: the walkers are a **pool**, not a population — a
 * walker's position is a closed-form function of `pen.t` and its own index, recomputed from
 * scratch every frame, and the array exists so that computing seventy-two of them allocates
 * nothing rather than so that anything is remembered between frames.
 *
 * ## The unit trap this file is standing in the middle of
 *
 * `iso` measures elevation in **world pixels**; every solid in `draw` takes its `z` in
 * **storeys**, which are `LEVEL_H` world pixels each. `Prop.base` comes from `iso.footprintBase`
 * and is therefore pixels, and handing it straight to `isoBox` puts a shed `LEVEL_H` times too
 * far up a hill that is already 1600 px tall — which is not a crash, it is a shed in the sky.
 * `pxToLevels` is the conversion and it appears on every solid below, deliberately never folded
 * into a local constant, so the two vocabularies stay visible at each site.
 *
 * ## Three scales, because that is what makes a hillside read as a hillside
 *
 * A tree is a silhouette at 300 m, a silhouette plus a canopy split at 100 m, and a trunk with
 * two canopy lobes and a sway up close. Nothing here checks the distance to decide that: the
 * shapes are simply drawn at their true size, and the zoom does the choosing, which is the whole
 * argument for vector art over three sprite sheets.
 */
import { hash2, toUnit } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_H, TILE_W, heightAt, type Camera, type Rect } from '@latticekit/iso';
import { isoBox, isoCylinder, isoPost, isoRoof, mix, pxToLevels, shade, withAlpha, type Ink, type Pen, type Rgba } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import { H, W, type Hill, type Prop } from './hill.js';
import { hazeAt } from './fields.js';
import { place } from './place.js';

/** How many people are on the hill. Seventy-two is enough that one is always in frame and few
 *  enough that the whole set is one `sin` each — the density that matters here is the crop rows,
 *  which are counted in thousands and are `fields.ts`'s. */
const FOLK = 72;

/** The pool. See the header: positions are recomputed every frame and nothing survives one. */
const walkers: { gx: number; gy: number; kind: number; v: number; base: number }[] = [];

/** Tallest thing any prop puts above its ground, in world pixels. The sorter is handed this as
 *  the item's height and the cull below has to use the same number, or a tree's crown pops in
 *  along the top edge one frame after its trunk. */
const LIFT = 34;

/** The camera's own visible box, refilled each frame. Module scope so the pass allocates nothing. */
const seen: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Fill the frame's depth order: every prop the hill generated that the camera can see, then the
 * people.
 *
 * ## The cull, and why it cannot disagree with the sort
 *
 * A hill this size holds 3,832 props and a frame shows about 300. Handing all 3,832 to
 * `DepthSorter` costs five index sorts over 3,832 keys and an emit loop, every frame, to throw
 * away 92% of it — which is most of this exhibit's frame time and none of its picture.
 *
 * But `docs/SEAMS.md` pins the contract that `iso` sorts and `draw` paints **the same
 * permutation**, walked backwards for picks, and a cull only one side knows about is precisely
 * the silent mis-pick this exhibit exists to demonstrate. Two things make this one safe, and both
 * are structural rather than careful:
 *
 * 1. **There is one list.** The cull happens *before* `add`, so the sorter, `Bucket.each` and any
 *    future `pickSorted` all see exactly the same contents. There is no second view to drift.
 * 2. **It is a strict superset of the sorter's own cull.** `DepthSorter.#cull` keeps an item when
 *    `Camera.isVisible` accepts its footprint box, and `isVisible` slackens the viewport by
 *    `TILE_W` on x and `TILE_H` on y. This asks `visibleWorldBounds(seen, TILE_W)` — the same
 *    slack on x and **twice** it on y — against the same four numbers `#cull` computes. So
 *    anything the sorter would have kept, this keeps; the sorter remains the only thing that
 *    decides, and its answer is unchanged. `test/cull.test.ts` is that sentence, executed.
 */
export function fillProps(bucket: Bucket<Prop>, hill: Hill, t: number, camera: Camera): void {
  camera.visibleWorldBounds(seen, TILE_W);
  for (const prop of hill.props) {
    if (!nearby(prop.gx, prop.gy, prop.base)) continue;
    bucket.add(prop, prop.gx, prop.gy, 1, 1, prop.base + LIFT);
  }
  for (let i = 0; i < FOLK; i++) {
    const ax = 4 + (hash2(hill.seed ^ 0x41, i, 0) >>> 8) % (W - 8);
    const ay = 4 + (hash2(hill.seed ^ 0x42, i, 0) >>> 8) % (H - 8);
    // Along `gx - gy`, which runs across the screen and, on a hill falling down `gx + gy`, is
    // very nearly the contour. A farmer walks the terrace, not off the edge of it.
    // /* @tier-b pixels only */
    const swing = Math.sin(t * 0.19 + i * 1.7) * 5.5;
    const w = walkers[i] ?? { gx: 0, gy: 0, kind: 4, v: i, base: 0 };
    walkers[i] = w;
    w.gx = ax + swing;
    w.gy = ay - swing;
    w.base = heightAt(hill.field, w.gx, w.gy);
    // Not culled: seventy-two of them cost less to add than to test, and they move every frame.
    bucket.add(w, w.gx, w.gy, 0.3, 0.3, w.base + 20);
  }
}

/**
 * Is a 1×1 footprint standing on `base` inside {@link seen}?
 *
 * The four numbers are `footprintBounds` for `(gx, gy, 1, 1)` lifted by {@link LIFT}, which is
 * what `DepthSorter.#cull` inlines. Written out rather than called because this runs once per
 * prop per frame and `footprintBounds` wants a `Rect` to fill.
 */
function nearby(gx: number, gy: number, base: number): boolean {
  const x = (gx - gy) * HALF_W;
  if (x + HALF_W < seen.minX || x - HALF_W > seen.maxX) return false;
  const y = (gx + gy) * HALF_H;
  return y + TILE_H >= seen.minY && y - base - LIFT <= seen.maxY;
}

/**
 * How much air is in front of the prop being drawn, refreshed once per prop by {@link paint}.
 *
 * A module variable rather than a parameter threaded through six drawers, for the same reason
 * `Pen` exists: it is frame context, every drawer needs it, and none of them decides it.
 */
let air = 0;

/** A prop's color, with the distance in front of it mixed in. **Every** color a prop paints goes
 *  through this. A hillside hazed into the distance with fully saturated trees and red roofs
 *  standing on it reads as stickers on a pale background, not as distance — which is exactly what
 *  the first build of this looked like. */
function dim(pen: Pen, ink: Ink): Rgba {
  const c = pen.palette.ink(ink);
  return air <= 0 ? c : mix(c, pen.palette.get('mist'), air);
}

/**
 * A tree: trunk, two canopy lobes, and a sway that is a screen-space offset rather than a bent
 * trunk — a leaning trunk at this size reads as a drawing error and costs three more corners.
 *
 * **In the mist band it is a trunk and one lobe.** `docs/GALLERY.md` § The cost row asks for fewer
 * ops per sprite at distance rather than fewer sprites, and the far band is already asked to be
 * hazier, which is permission for it to be cheaper. The trunk stays: dropping it was tried first,
 * saved the same op, and turned every distant tree into a green ball hovering over the hill.
 */
function tree(pen: Pen, p: Prop): void {
  const r = toUnit(p.v);
  const height = 0.5 + r * 0.55;
  const leaf = dim(pen, mix(pen.palette.get('field'), pen.palette.get('ok'), r * 0.85));
  const rx = (0.44 + r * 0.2) * HALF_W * pen.camera.zoom;
  const top = place(pen, p.gx + 0.5, p.gy + 0.5, p.base + 26 * height + 10);
  /* @tier-b pixels only */
  const cx = top.x + Math.sin(pen.t * 1.1 + r * 6.3) * rx * 0.08;
  isoPost(pen, p.gx + 0.5, p.gy + 0.5, pxToLevels(p.base), height, dim(pen, shade(pen.palette.get('ink'), 1.35)), 0.11);
  pen.surface.ellipse(cx, top.y + rx * 0.22, rx, rx * 0.78, shade(leaf, 0.72));
  if (air > 0.34) return;
  pen.surface.ellipse(cx - rx * 0.22, top.y - rx * 0.2, rx * 0.72, rx * 0.6, shade(leaf, 1.12));
}

/** A shed: a stone box under a gabled roof. The one built thing on the hill, and the reason the
 *  terraces read as worked rather than as landform. */
function shed(pen: Pen, p: Prop): void {
  const z = pxToLevels(p.base);
  const warm = toUnit(p.v) > 0.5;
  isoBox(pen, p.gx + 0.12, p.gy + 0.12, 0.72, 0.72, { color: dim(pen, 'stone'), h: 0.42, z });
  isoRoof(pen, p.gx + 0.02, p.gy + 0.02, 0.92, 0.92, z + 0.42, 0.34, dim(pen, warm ? 'brand' : 'bank'));
}

/** A stook of cut crop, leaning against itself. Two per tile, so a harvested terrace reads as
 *  harvested rather than as merely a different green — and two rather than three because a
 *  cylinder is three ops and this is the most numerous solid on the hill. */
function stook(pen: Pen, p: Prop): void {
  const z = pxToLevels(p.base);
  const r = toUnit(p.v);
  for (let i = 0; i < 2; i++) {
    const ox = 0.28 + ((i * 0.31 + r) % 1) * 0.44;
    const oy = 0.28 + ((i * 0.57 + r) % 1) * 0.44;
    isoCylinder(pen, p.gx + ox, p.gy + oy, 0.1, { color: dim(pen, 'crop'), h: 0.3 + r * 0.16, z, outline: false });
  }
}

/** Hedge: a low mass on the bank, no outline, so a run of them reads as one hedgerow rather than
 *  as a row of separate boxes. */
function hedge(pen: Pen, p: Prop): void {
  const r = toUnit(p.v);
  isoBox(pen, p.gx + 0.1, p.gy + 0.1, 0.8, 0.8, {
    color: dim(pen, shade(mix(pen.palette.get('field'), pen.palette.get('ink'), 0.28), 0.9 + r * 0.3)),
    h: 0.2 + r * 0.16,
    z: pxToLevels(p.base),
    outline: false,
  });
}

/** A person: two strokes' worth of shape and a hat. At this scale nothing else survives, and a
 *  hat is what makes the silhouette read as a person bent over a field rather than as a post. */
function folk(pen: Pen, p: Prop): void {
  const zoom = pen.camera.zoom;
  const body = place(pen, p.gx, p.gy, p.base + 16);
  const bx = body.x;
  const by = body.y;
  /* @tier-b pixels only */
  const bob = Math.sin(pen.t * 2.6 + p.v) * 1.6 * zoom;
  pen.surface.ellipse(bx, by + 9 * zoom, 3.4 * zoom, 1.7 * zoom, withAlpha(pen.palette.get('ink'), 0.24 * (1 - air)));
  isoPost(pen, p.gx, p.gy, pxToLevels(p.base), 0.34, dim(pen, shade(pen.palette.get('ink'), 1.5)), 0.13);
  pen.surface.ellipse(bx, by + bob, 4.2 * zoom, 2.1 * zoom, dim(pen, 'crop'));
}

/** Hoisted: `Bucket.each` states the rule, and an inline arrow here is a closure a frame. */
const paint = (p: Prop): void => {
  if (pass === undefined) return;
  air = hazeAt(pass, place(pass, p.gx + 0.5, p.gy + 0.5, p.base).y);
  if (p.kind === 0) tree(pass, p);
  else if (p.kind === 1) hedge(pass, p);
  else if (p.kind === 2) shed(pass, p);
  else if (p.kind === 3) stook(pass, p);
  else folk(pass, p);
};

let pass: Pen | undefined;

/** The Solids pass. Walks the sorted order forwards, which is the painter's algorithm done
 *  right; `Bucket.each` is what makes that the only available direction. */
export function paintProps(pen: Pen, bucket: Bucket<Prop>): void {
  pass = pen;
  bucket.each(paint);
}
