/**
 * @art — what stands on the marsh: reeds, boulders, dead stumps, and a cairn on every seeded cell.
 *
 * Delete this file and the exhibit still records, still verifies and still scrubs; the ground is
 * simply bare. Nothing here is state. **The scatter is not stored** — it is minted per frame from
 * `hash2(seed, gx, gy)` over the tiles the camera can see, which is `world`'s own idiom for
 * anything a player can pan away from and come back to, and which also happens to settle this
 * module's classification: it holds nothing that outlives a frame because there is nothing to
 * hold. The one buffer below is a scratch array in the sorter's own index space, refilled from
 * scratch every frame.
 *
 * ## The sorter is filled and walked here, in that order, and never reordered between
 *
 * `iso` sorts and `pickSorted` walks the same instance backwards, so paint order and pick order
 * have to be the same permutation. {@link enqueue} fills; `renderFrame` sorts; {@link paint}
 * walks forward. Nothing partitions, nothing re-adds, and the shadows are the sprites' own.
 */

import { hash2, toUnit } from '@latticekit/core';
import { footprintBase } from '@latticekit/iso';
import type { Camera, DepthSorter, TileRange } from '@latticekit/iso';
import {
  VARIANT_ZERO,
  defineSprite,
  drawSprite,
  glowDot,
  spriteHeightPx,
} from '@latticekit/draw';
import type { Pen, SpriteDef, Variant } from '@latticekit/draw';
import { N, MAX_HEIGHT_PX, WET } from './marsh.js';

const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * The visible *diamond*, in the two axes the projection actually uses.
 *
 * `Camera.visibleTileBounds` answers with a box around the rotated rectangle the camera can see,
 * and documents itself as generous by roughly 2×. On this map that box is very nearly the whole
 * marsh, so the terrain pass was painting 3,136 tiles to show about 1,700 of them. Screen x is a
 * function of `gx − gy` alone and screen y of `gx + gy` alone, so the exact window is two ranges
 * and the test is four comparisons — which is what § Scale means by *"culling pays only if the
 * off-screen part is dropped before the sort rather than inside the draw"*.
 */
export interface Window { u0: number; u1: number; v0: number; v1: number }

export function windowOf(camera: Camera, out: Window): Window {
  camera.visibleWorldBounds(box, 64);
  out.u0 = box.minX / 32 - 1;
  out.u1 = box.maxX / 32 + 1;
  out.v0 = box.minY / 16 - 1;
  out.v1 = (box.maxY + MAX_HEIGHT_PX) / 16 + 1;
  return out;
}

/** Is this tile inside the visible diamond? Four comparisons, no projection. */
export function onScreen(w: Window, gx: number, gy: number): boolean {
  const u = gx - gy;
  const v = gx + gy;
  return u >= w.u0 && u <= w.u1 && v >= w.v0 && v <= w.v1;
}



import type { Marsh } from './marsh.js';

/**
 * A stand of reeds: the near band's detail, and the thing that catches a rim off the bloom.
 *
 * Detail at three scales, which is the rule that separates procedural art from placeholder
 * blocks: the clump is the mass, the blades are the feature on it, and the seed heads are the
 * thing that only just resolves. Two scales would read as a toy.
 */
const REED = defineSprite({
  id: 'reed',
  w: 1,
  d: 1,
  massing(s, v, rng) {
    s.shadow(0.2, 0.2, 0.6, 0.6, 0.3);
    const n = 4 + (v.seed & 3);
    for (let i = 0; i < n; i++) {
      const x = 0.24 + rng.next() * 0.52;
      const y = 0.24 + rng.next() * 0.52;
      const h = 0.3 + rng.next() * 0.5;
      s.post(x, y, 0, h, 'reed', 0.028);
      if (rng.next() > 0.55) s.post(x, y, h, 0.09, 'dry', 0.045);
    }
  },
});

/** Dry grass on the banks: the same clump as a reed, shorter and the colour of late summer. */
const TUSSOCK = defineSprite({
  id: 'tussock',
  w: 1,
  d: 1,
  massing(s, v, rng) {
    s.shadow(0.28, 0.28, 0.44, 0.44, 0.22);
    for (let i = 0; i < 3 + (v.seed & 3); i++) {
      s.post(0.28 + rng.next() * 0.44, 0.28 + rng.next() * 0.44, 0, 0.14 + rng.next() * 0.24, 'dry', 0.03);
    }
  },
});

/** A boulder. Two volumes, the upper narrower — setback massing at the smallest size there is. */
const ROCK = defineSprite({
  id: 'rock',
  w: 1,
  d: 1,
  massing(s, _v, rng) {
    s.shadow(0.3, 0.3, 0.4, 0.4, 0.5);
    s.box(0.3, 0.3, 0.38, 0.38, { color: 'rock', h: 0.1 + rng.next() * 0.12 });
    s.box(0.37, 0.35, 0.22, 0.24, { color: 'rock', h: 0.08, z: 0.15 });
  },
});

/** A drowned stump — the mid band's silhouette, and the only vertical the eye can size against. */
const STUMP = defineSprite({
  id: 'stump',
  w: 1,
  d: 1,
  massing(s, _v, rng) {
    // Setback massing at the smallest size there is: a broad rotten base, a narrower trunk, and
    // a splintered crown. A single extruded cylinder is the shape every naive demo has, and it
    // is what made the first pass of this exhibit read as a car park full of bollards.
    const h = 0.34 + rng.next() * 0.42;
    s.shadow(0.3, 0.3, 0.4, 0.4, 0.45);
    s.cylinder(0.5, 0.5, 0.16, { color: 'rock', h: h * 0.4 });
    s.cylinder(0.5, 0.5, 0.11, { color: 'rock', h: h * 0.6, z: h * 0.4 });
    s.cylinder(0.5, 0.5, 0.13, { color: 'dry', h: 0.05, z: h });
    if (rng.next() > 0.45) s.post(0.66, 0.44, h * 0.5, 0.2, 'rock', 0.03);
  },
});

/** A cairn on a seeded cell: where the visitor put their finger, still standing on the re-run. */
const CAIRN = defineSprite({
  id: 'cairn',
  w: 1,
  d: 1,
  massing(s) {
    s.shadow(0.18, 0.18, 0.64, 0.64, 0.6);
    s.box(0.24, 0.24, 0.52, 0.52, { color: 'rock', h: 0.3 });
    s.box(0.32, 0.32, 0.36, 0.36, { color: 'rock', h: 0.26, z: 0.3 });
    s.cylinder(0.5, 0.5, 0.13, { color: 'bloom', h: 0.3, z: 0.56 });
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    // Snapped to nine levels: an animated colour is a cache key, and nobody can resolve more
    // than that on a six-pixel core. The radius stays continuous, which is what the eye tracks.
    const beat = Math.round((0.5 + 0.5 * Math.sin(pen.t * 2 + gx + gy)) * 8) / 8;
    glowDot(pen, gx + 0.5, gy + 0.5, zPx + 26, 'bloom', 0.4 + beat * 0.14, 0.4 + beat * 0.4);
    // Two pools, not one: a small bright core inside a wide dim halo, so two cairns meet in
    // each other's halo where both curves are flat rather than in each other's ramp.
    pen.light?.add(gx + 0.5, gy + 0.5, zPx, 1.2, 0.55, 'bloom');
    pen.light?.add(gx + 0.5, gy + 0.5, zPx, 3.8, 0.2, 'bloom');
  },
});

const KINDS: readonly SpriteDef[] = [REED, TUSSOCK, ROCK, STUMP];
const HEIGHT = KINDS.map((def) => spriteHeightPx(def, VARIANT_ZERO));
const CAIRN_H = spriteHeightPx(CAIRN, VARIANT_ZERO);

/** Scratch, in the sorter's own index space. Refilled every frame, read only via `indexAt`. */
const cell = new Int32Array(4096);
const kind = new Int8Array(4096);
const base = new Float64Array(4096);
const foot = { gx: 0, gy: 0, w: 1, d: 1 };
/** Sixty-four variants, built once. A sprite's `massing` reseeds its rng from `v.seed` on every
 *  call, so a clump cannot reshuffle itself between two frames or between two runs. */
const VARIANTS: readonly Variant[] = Array.from({ length: 64 }, (_, i) => ({
  ...VARIANT_ZERO,
  seed: (i * 2654435761) >>> 0,
}));

/**
 * Fill the sorter with everything standing on the visible marsh.
 *
 * Density is the point: on a 1440×900 frame at the opening zoom this is between two and three
 * hundred solids, which is what `docs/GALLERY.md` § Scale means by "measured in hundreds". The
 * cost of the ones off screen is zero because they are never minted, let alone sorted.
 */
export function enqueue(order: DepthSorter, m: Marsh, seed: number, visible: Readonly<TileRange>, win: Window): void {
  const x0 = visible.gx0 < 0 ? 0 : visible.gx0;
  const y0 = visible.gy0 < 0 ? 0 : visible.gy0;
  const x1 = visible.gx1 > N ? N : visible.gx1;
  const y1 = visible.gy1 > N ? N : visible.gy1;
  let n = 0;
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      if (n >= cell.length) return;
      if (!onScreen(win, gx, gy)) continue;
      const h = hash2(seed ^ 0x9d0b, gx, gy);
      const u = toUnit(h);
      // Reeds crowd the shallows, rocks and stumps take the dry ground. The two thresholds are
      // what make this read as a marsh rather than as a lawn with things scattered on it, and
      // they are what put § Scale's "measured in hundreds" on screen: about 320 at the opening
      // frame, of which every one off camera costs nothing because it is never minted.
      const wet = m.grid.get(gx, gy) < WET;
      if (u > (wet ? 0.52 : 0.55)) {
        // Reeds in the water; on the bank mostly dry grass, with a boulder or a drowned stump
        // one time in eight. An even mix of four things reads as a sample sheet; a dominant
        // ground cover with two rare accents reads as a place.
        const rare = (h >>> 9) & 7;
        const k = wet ? 0 : rare === 0 ? 2 : rare === 1 ? 3 : 1;
        foot.gx = gx;
        foot.gy = gy;
        const z = footprintBase(m.field, foot);
        cell[n] = gy * N + gx;
        kind[n] = k;
        base[n] = z;
        order.add(gx, gy, 1, 1, z + (HEIGHT[k] ?? 0));
        n += 1;
      }
    }
  }
  for (const c of m.seeds) {
    if (n >= cell.length) return;
    const gx = c % N;
    const gy = (c / N) | 0;
    if (gx < x0 || gy < y0 || gx >= x1 || gy >= y1) continue;
    foot.gx = gx;
    foot.gy = gy;
    const z = footprintBase(m.field, foot);
    cell[n] = c;
    kind[n] = 4;
    base[n] = z;
    order.add(gx, gy, 1, 1, z + CAIRN_H);
    n += 1;
  }
}

/** Walk the sorted order forwards, once, and paint what each slot holds. */
export function paint(pen: Pen, order: DepthSorter): void {
  for (let i = 0; i < order.count; i++) {
    const at = order.indexAt(i);
    const c = cell[at] ?? 0;
    const k = kind[at] ?? 0;
    const def = k === 4 ? CAIRN : (KINDS[k] ?? REED);
    drawSprite(pen, def, c % N, (c / N) | 0, VARIANTS[at & 63] ?? VARIANT_ZERO, base[at] ?? 0);
  }
}
