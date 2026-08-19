/**
 * The valley under the kilns: a river through a brick bowl, hills on the far rim.
 *
 * @art
 *
 * Scatter is `(seed, gx, gy)`. Nothing here is remembered, nothing here is a number the shop
 * reads. Delete it and the prices still close, the absence still lands in one step, and the
 * frame is a flat field.
 */
import { fbm2, hash2, noise2, toUnit } from '@latticekit/core';
import { tileSourceOf, type HeightField, type TileRange } from '@latticekit/iso';
import { isoTerrain, mix, type Pen } from '@latticekit/draw';

export const W = 160;
export const H = 160;
export const STEP = 8;
/** Tallest ground, in world pixels. Camera and the terrain cull both need it. */
export const MAX_HEIGHT_PX = 14 * STEP;

export function fieldOf(seed: number): HeightField {
  return { heights: tileSourceOf((gx, gy) => units(seed, gx, gy)), stepPx: STEP };
}

/** Height units at a vertex. River along `gx + gy ≈ 158`, hills rising as `v` grows. */
export function units(seed: number, gx: number, gy: number): number {
  const v = gx + gy;
  const river = Math.max(0, 1 - Math.abs(v - 158) / 7);
  const grain = fbm2(seed, gx * 0.035, gy * 0.035, 4);
  const lumps = fbm2(seed ^ 9, gx * 0.09, gy * 0.09, 3);
  const far = Math.max(0, (142 - v) / 26);
  return Math.max(0, grain * 2.2 + lumps * 2.4 + far * 7 - river * 5.2);
}

export function water(seed: number, gx: number, gy: number): boolean {
  return Math.abs(gx + gy - 158) < 4.2 && units(seed, gx, gy) < 1.15;
}

/** A kiln plot: dry land, hashed, about one tile in eight. */
export function kilnAt(seed: number, gx: number, gy: number): boolean {
  if (gx < 2 || gy < 2 || gx > W - 4 || gy > H - 4) return false;
  if (water(seed, gx, gy) || water(seed, gx + 1, gy) || water(seed, gx, gy + 1)) return false;
  return toUnit(hash2(seed ^ 0x6b19, gx, gy)) > 0.78;
}

/** Fire spreads from the opening heart as the player buys. */
export function working(_seed: number, gx: number, gy: number, owned: number): boolean {
  return kilnAt(_seed, gx, gy) && Math.abs(gx - 68) + Math.abs(gy - 78) < 3 + owned * 0.9;
}

export function paintLand(pen: Pen, field: HeightField, seed: number, visible: Readonly<TileRange>): void {
  const gx0 = Math.max(0, visible.gx0);
  const gy0 = Math.max(0, visible.gy0);
  const gx1 = Math.min(W, visible.gx1);
  const gy1 = Math.min(H, visible.gy1);
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      if (water(seed, gx, gy)) {
        const swell = noise2(seed ^ 0x33, gx * 0.35 + pen.t * 0.22, gy * 0.35) * 0.5 + 0.5;
        const foam = mix(pen.palette.get('glass'), 0xffe8c8ff, 0.28 + swell * 0.25);
        isoTerrain(pen, field, gx, gy, foam, undefined, 0.78 + swell * 0.08);
        continue;
      }
      const v = gx + gy;
      const far = v < 140 ? 0.74 : v < 155 ? 0.84 : 0.92;
      const grain = (toUnit(hash2(seed, gx, gy)) - 0.5) * 0.08;
      const bank = Math.abs(v - 158) < 8 ? 0.06 : 0;
      isoTerrain(pen, field, gx, gy, v < 138 ? 'metal' : 'ground', undefined, far + grain + bank);
    }
  }
}
