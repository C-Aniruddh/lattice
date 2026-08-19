/**
 * Everything that stands: kilns on the bowl, carts on the river road, scrub on the rim.
 *
 * @art
 *
 * Positions are `(seed, gx, gy)` or a closed form of `t`. The shop's `owned` count only picks
 * which stacks smoke — it does not grow this list. Delete the file and the economy is unchanged.
 */
import { hash2, toUnit } from '@latticekit/core';
import { heightAt, type Camera, type HeightField, type TileRange } from '@latticekit/iso';
import { drawSprite, isoBox, isoCylinder, pxToLevels, type Pen } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import { H, W, kilnAt, water, working } from './land.js';
import { kindOf, variant } from './sprites.js';

const range: TileRange = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const CARTS = 160;
const LIFT = 96;
const CART = -1;

let scene: Pen | undefined;
let fieldRef: HeightField | undefined;
let seedRef = 0;
let ownedRef = 0;
let burstRef = 0;

export function fillWorks(
  bucket: Bucket<number>,
  camera: Camera,
  field: HeightField,
  seed: number,
  owned: number,
  burst: number,
  t: number,
): void {
  fieldRef = field;
  seedRef = seed;
  ownedRef = owned;
  burstRef = burst;
  camera.visibleTileBounds(range, 6);
  const gx0 = Math.max(0, range.gx0);
  const gy0 = Math.max(0, range.gy0);
  const gx1 = Math.min(W, range.gx1);
  const gy1 = Math.min(H, range.gy1);
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      if (kilnAt(seed, gx, gy)) {
        const z = heightAt(field, gx + 0.5, gy + 0.5);
        bucket.add((gx << 16) | gy, gx, gy, 2, 2, z + LIFT);
        continue;
      }
      const u = toUnit(hash2(seed ^ 0x7ee, gx, gy));
      if (!water(seed, gx, gy) && (gx + gy < 146 ? u > 0.6 : u > 0.82)) {
        const z = heightAt(field, gx + 0.4, gy + 0.4);
        bucket.add(0x40000000 | (gx << 16) | gy, gx, gy, 1, 1, z + 28);
      }
    }
  }
  for (let i = 0; i < CARTS; i++) {
    const gx = 24 + ((t * 5.5 + i * 11.3) % 210) * 0.52;
    const gy = 158 - gx;
    bucket.addPoint(CART - i, gx, gy, heightAt(field, gx, gy) + 16, 0.3);
  }
}

export function paintItem(item: number): void {
  const pen = scene;
  const field = fieldRef;
  if (pen === undefined || field === undefined) return;
  if (item <= CART) {
    cart(pen, field, CART - item, pen.t);
    return;
  }
  if (item & 0x40000000) {
    const gx = (item >> 16) & 0x3fff;
    const gy = item & 0xffff;
    const z = pxToLevels(heightAt(field, gx + 0.4, gy + 0.4));
    const far = gx + gy < 146;
    const h = 0.4 + toUnit(hash2(seedRef, gx, gy)) * 0.5;
    if (far) {
      isoCylinder(pen, gx + 0.48, gy + 0.48, 0.1, { color: 'coal', h: 0.7, z });
      isoCylinder(pen, gx + 0.48, gy + 0.48, 0.38, { color: 'scrub', h: 0.85 + h, z: z + 0.65 });
    } else {
      isoBox(pen, gx + 0.15, gy + 0.15, 0.55, 0.5, { color: 'coal', h: 0.22 + h * 0.3, z });
    }
    return;
  }
  const gx = item >> 16;
  const gy = item & 0xffff;
  const on = working(seedRef, gx, gy, ownedRef);
  const z = heightAt(field, gx + 0.5, gy + 0.5);
  drawSprite(pen, kindOf(seedRef, gx, gy), gx, gy, variant(seedRef, gx, gy, on, burstRef), z);
}

export function bindPen(pen: Pen): void {
  scene = pen;
}

function cart(pen: Pen, field: HeightField, i: number, t: number): void {
  const s = (t * 5.5 + i * 11.3) % 210;
  const gx = 24 + s * 0.52;
  const gy = 158 - gx + Math.sin(t * 0.8 + i) * 0.08; /* @tier-b pixels only */
  if (gx < 4 || gx > W - 4 || gy < 4 || gy > H - 4) return;
  const z = pxToLevels(heightAt(field, gx, gy));
  isoBox(pen, gx, gy, 0.7, 0.48, { color: 'coal', h: 0.34, z });
  isoBox(pen, gx + 0.1, gy + 0.08, 0.48, 0.32, { color: 'copper', h: 0.2, z: z + 0.34 });
}
