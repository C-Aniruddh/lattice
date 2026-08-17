/**
 * Everything standing on the clay: pines, broadleaves, boulders, huts, and the walkers.
 *
 * @art
 *
 * Delete this file and the valley is bare, and the exhibit still does every single thing it exists
 * to do — the ground still deforms, the water still finds its way, and `life.ts` still replans the
 * routes the brush crossed and counts the walkers it walled in. Nothing here holds state that
 * outlives a frame and nothing here returns a value any decision reads.
 *
 * ## Why nothing here is stored, and why that is the *stronger* version of the third row
 *
 * `docs/GALLERY.md` ranks *"things standing on it — they ride the ground up and down, and slide off
 * anything you make too steep"* third among the things that must resettle. The obvious build is a
 * list of props with mutable positions and a slide rule that moves them. This one has no list at
 * all: **a prop is a pure function of its index and the live height field.** Its tile comes from
 * `hash2`, its base from `heightAt`, and how far it has slid from `slopeAt` — so it rides the
 * ground because there is nowhere else for it to be, and it slides because the slope it is standing
 * on is *in the expression that places it*.
 *
 * That is worth more than the line-rule classification it happens to buy. A stored slide has to
 * decide when to run, and it therefore has a wrong answer available to it: props that settle on the
 * frame the brush struck and not on any frame between. A derived one cannot lag by construction —
 * lower the ground back and the tree climbs upright again, which is the half nobody implements.
 *
 * ## Three scales, drawn at true size and never chosen
 *
 * A tree is a silhouette far away, a silhouette with a canopy split in the middle band, and a trunk
 * with two lobes up close. Nothing here tests the distance to decide that: the shapes are drawn at
 * their real size and the camera's zoom does the choosing, which is the whole argument for vector
 * art over three sprite sheets.
 */
import { hash2, toUnit } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_H, TILE_W, heightAt, pxToUnits, slopeAt, type Camera, type Rect } from '@latticekit/iso';
import { isoBox, isoCylinder, isoPost, isoRoof, mix, pxToLevels, shade, withAlpha, type Pen } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import { CELLS, N, STEP_PX, type Clay } from './clay.js';
import { LEAVES } from './palette.js';
import type { Life } from './life.js';

/** How many are scattered over the map. § Scale asks for hundreds of whatever an exhibit repeats,
 *  and this is what it repeats; about three hundred are in frame at the opening zoom, and the rest
 *  are the reason a pan finds more valley rather than more grass. */
const SOWN = 2200;
/** Rise per tile at which a thing starts to slide, and over how much more it goes fully over. The
 *  first number is `ground.ts`'s `CRAG` and `life.ts`'s `CLIMB` — where the color changes, where a
 *  walker refuses, and where a tree lets go should be one fact about the world, not three. */
const SLIDE = 1.25, GIVE = 1.4;
/** Water depth at which a prop is under it and simply not drawn. Flood a wood and it goes under;
 *  drain the lake and it is standing there again, because nothing was destroyed. */
const DROWN = 0.4;
/** Tallest thing any prop puts above its own ground, in world pixels. The sorter is given this as
 *  the item's height and the cull uses the same number, or a canopy pops in along the top edge one
 *  frame after its trunk. */
const LIFT = 40;

/** One drawable, pooled. See the header: this remembers nothing — it is refilled from scratch every
 *  frame and exists so that filling the order allocates nothing, rather than so anything lasts. */
export interface Thing {
  gx: number; gy: number; z: number; kind: number; seed: number;
  /** How far over it has gone, 0–1, and the downhill unit vector it is going over along. */
  slide: number; dgx: number; dgy: number;
}

const pool: Thing[] = [];
/** The camera's visible box, refilled each frame. Module scope, so the pass allocates nothing. */
const seen: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

function slot(i: number): Thing {
  const got = pool[i] ?? { gx: 0, gy: 0, z: 0, kind: 0, seed: 0, slide: 0, dgx: 0, dgy: 0 };
  pool[i] = got;
  return got;
}

/**
 * Fill the frame's depth order.
 *
 * The cull happens **before** `add`, so the sorter, `Bucket.each` and any future `pickSorted` all
 * see identical contents — there is no second view to drift — and it is a strict superset of
 * `DepthSorter`'s own, which slackens by `TILE_W` on x and `TILE_H` on y.
 */
export function fillThings(bucket: Bucket<Thing>, clay: Clay, life: Life, seed: number, camera: Camera): void {
  camera.visibleWorldBounds(seen, TILE_W);
  let n = 0;
  for (let i = 0; i < SOWN; i++) {
    // Tile first and everything else after, because the tile is two hashes and the height is a
    // bilinear sample: culling on the cheap half is most of why eight hundred props are affordable.
    const gx = 2 + ((toUnit(hash2(seed ^ 0x7a11, i, 0)) * (CELLS - 4)) | 0);
    const gy = 2 + ((toUnit(hash2(seed ^ 0x7a12, i, 0)) * (CELLS - 4)) | 0);
    if (!nearby(gx + 0.5, gy + 0.5, LIFT)) continue;
    const z = heightAt(clay.land, gx + 0.5, gy + 0.5);
    if (heightAt(clay.wet, gx + 0.5, gy + 0.5) - z > DROWN * STEP_PX) continue;
    const t = slot(n);
    t.gx = gx + 0.5; t.gy = gy + 0.5; t.kind = (toUnit(hash2(seed ^ 0x7a13, i, 0)) * 5) | 0;
    t.seed = hash2(seed ^ 0x7a14, i, 0);
    // The slide, derived rather than stored. See the header.
    const rise = pxToUnits(clay.land, slopeAt(clay.land, gx, gy));
    t.slide = rise <= SLIDE ? 0 : Math.min(1, (rise - SLIDE) / GIVE);
    if (t.slide > 0) {
      const j = gy * N + gx, h = clay.terr;
      const ax = ((h[j] as number) + (h[j + N] as number)) - ((h[j + 1] as number) + (h[j + N + 1] as number));
      const ay = ((h[j] as number) + (h[j + 1] as number)) - ((h[j + N] as number) + (h[j + N + 1] as number));
      const m = Math.sqrt(ax * ax + ay * ay);
      t.dgx = m > 0 ? ax / m : 0; t.dgy = m > 0 ? ay / m : 0;
      t.gx += t.dgx * t.slide * 1.5; t.gy += t.dgy * t.slide * 1.5;
      t.z = heightAt(clay.land, t.gx, t.gy);
    } else {
      t.dgx = 0; t.dgy = 0; t.z = z;
    }
    bucket.add(t, t.gx - 0.5, t.gy - 0.5, 1, 1, t.z + LIFT);
    n++;
  }
  for (const w of life.walkers) {
    if (w.stranded && w.path.nodeCount === 0) continue;
    const t = slot(n);
    t.gx = w.gx + 0.5; t.gy = w.gy + 0.5; t.kind = 5; t.seed = 0; t.slide = 0; t.dgx = 0; t.dgy = 0;
    t.z = heightAt(clay.land, t.gx, t.gy);
    bucket.add(t, w.gx, w.gy, 0.5, 0.5, t.z + 26);
    n++;
  }
}

/** Is a 1×1 footprint standing on `lift` inside {@link seen}? The four numbers `DepthSorter`'s own
 *  cull inlines, written out because this runs once per prop per frame. */
function nearby(gx: number, gy: number, lift: number): boolean {
  const x = (gx - gy) * HALF_W;
  if (x + TILE_W < seen.minX || x - TILE_W > seen.maxX) return false;
  const y = (gx + gy) * HALF_H;
  return y + TILE_H >= seen.minY && y - lift - TILE_H <= seen.maxY;
}

/** The solids pass: walk the sorted order forwards and paint. */
export function paintThings(pen: Pen, bucket: Bucket<Thing>): void {
  current = pen;
  bucket.each(paint);
  current = undefined;
}

function paint(t: Thing): void {
  const p = current;
  if (p === undefined) return;
  const z = pxToLevels(t.z);
  // A thing that has let go is drawn short and wide along the fall line. `1 − slide` on the height
  // and `1 + slide` on the plan is the whole of the effect: at `slide = 1` a pine is a log lying on
  // the scree, at 0.3 it is leaning, and the transition is continuous because `slide` is.
  const up = 1 - t.slide * 0.86, out = 1 + t.slide * 1.1;
  if (t.kind === 5) walker(p, t, z);
  else if (t.kind === 4) hut(p, t, z, up);
  else if (t.kind >= 2) rock(p, t, z, out);
  else tree(p, t, z, up, out);
}

/** The pen for the current pass. A module variable rather than a parameter threaded through five
 *  drawers, for the same reason `Pen` exists: it is frame context, every drawer needs it, and none
 *  of them decides it. Set by {@link paintThings}. */
let current: Pen | undefined;

function tree(pen: Pen, t: Thing, z: number, up: number, out: number): void {
  const v = toUnit(t.seed);
  const leaf = LEAVES[(v * 4) | 0] as string;
  const tall = (t.kind === 0 ? 1.05 : 0.82) * (0.72 + v * 0.5) * up;
  const wide = (t.kind === 0 ? 0.3 : 0.42) * out;
  isoPost(pen, t.gx, t.gy, z, tall * 0.55, 'bark', 0.13);
  if (t.kind === 0) {
    // A pine: three shrinking drums, which reads as a cone at every zoom and costs three solids.
    for (let k = 0; k < 3; k++) {
      isoCylinder(pen, t.gx, t.gy, wide * (1 - k * 0.27), {
        color: shade(pen.palette.ink(leaf), 1 + k * 0.1), h: tall * 0.34, z: z + tall * (0.34 + k * 0.3), outline: false,
      });
    }
  } else {
    isoCylinder(pen, t.gx, t.gy, wide, { color: leaf, h: tall * 0.5, z: z + tall * 0.45, outline: false });
    isoCylinder(pen, t.gx - 0.1, t.gy + 0.08, wide * 0.7, {
      color: shade(pen.palette.ink(leaf), 1.16), h: tall * 0.4, z: z + tall * 0.7, outline: false,
    });
  }
}

function rock(pen: Pen, t: Thing, z: number, out: number): void {
  const v = toUnit(t.seed), grey = mix(pen.palette.get('metal'), pen.palette.get('ink'), 0.15 + v * 0.3);
  const w = (0.34 + v * 0.3) * out;
  isoBox(pen, t.gx - w / 2, t.gy - w / 2, w, w, { color: grey, h: 0.28 + v * 0.3, z, outline: false });
  if (t.kind === 3) {
    isoBox(pen, t.gx + w * 0.3, t.gy - w * 0.1, w * 0.6, w * 0.6, {
      color: shade(grey, 1.1), h: 0.18 + v * 0.2, z, outline: false,
    });
  }
}

function hut(pen: Pen, t: Thing, z: number, up: number): void {
  const v = toUnit(t.seed), w = 0.72, h = 0.5 * up;
  isoBox(pen, t.gx - w / 2, t.gy - w / 2, w, w, { color: 'daub', h, z, outline: true });
  isoRoof(pen, t.gx - w / 2 - 0.08, t.gy - w / 2 - 0.08, w + 0.16, w + 0.16, z + h, 0.34 + v * 0.14, 'thatch');
}

function walker(pen: Pen, t: Thing, z: number): void {
  isoBox(pen, t.gx - 0.15, t.gy - 0.15, 0.3, 0.3, { color: 'coat', h: 0.5, z, outline: false });
  isoBox(pen, t.gx - 0.12, t.gy - 0.12, 0.24, 0.24, { color: 'head', h: 0.2, z: z + 0.5, outline: false });
  // A contact mark, so a walker on a bright upland is not a floating chip. Constant color, so it
  // never touches a ramp cache — and it is a box rather than a `softEllipse` for the same reason.
  isoBox(pen, t.gx - 0.22, t.gy - 0.22, 0.44, 0.44, {
    color: withAlpha(pen.palette.get('night'), 70), h: 0.001, z, outline: false,
  });
}
