/**
 * Kilns, sheds, stacks. Setback massing, an ember rhythm, and smoke that moves.
 *
 * @art
 *
 * Three silhouettes: a squat bottle kiln, a long shed with one stack, a needle chimney.
 * Windows and firemouths break the face; the crown is a lip, a cap, or a spark. Something
 * moves on every working one — smoke, or a quantized ember. Cold stacks stand dark.
 */
import { hashStep, toUnit } from '@latticekit/core';
import {
  FLAG_POWERED,
  defineSprite,
  glowDot,
  pxToLevels,
  withAlpha,
  type Pen,
  type Variant,
} from '@latticekit/draw';
import { snap } from './palette.js';

const vat = (v: Variant, i: number): number => toUnit(hashStep(v.seed, i));

export const SHED = defineSprite({
  id: 'shed',
  w: 2,
  d: 2,
  massing(s, v, rng) {
    const h = 1.1 + vat(v, 0) * 0.5;
    s.shadow(0, 0, 2, 2);
    s.box(0.05, 0.05, 1.9, 1.9, { color: 'brick', h: 0.35 });
    s.box(0.18, 0.22, 1.64, 1.5, { color: 'brick', h });
    s.roof(0.12, 0.16, 1.76, 1.62, h, 0.55, 'copper');
    s.cylinder(1.45, 0.55, 0.18, { color: 'coal', h: 1.4 + vat(v, 1), z: h });
    if (rng.next() > 0.45) s.post(0.2, 1.7, 0, 0.7, 'coal');
    if (v.flags & FLAG_POWERED) {
      s.box(0.55, 0.05, 0.4, 0.08, { color: 'warn', h: 0.22, z: 0.2 });
    }
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    if (!(v.flags & FLAG_POWERED)) return;
    smoke(pen, gx + 1.45, gy + 0.55, zPx, 2.6, v, pen.t);
  },
  emit(lights, gx, gy, v, _rng, zPx) {
    if (!(v.flags & FLAG_POWERED)) return;
    lights.add(gx + 1, gy + 1, zPx, 1.6, 0.28, 'warn');
  },
});

export const BOTTLE = defineSprite({
  id: 'bottle',
  w: 2,
  d: 2,
  massing(s, v) {
    const rise = 2.2 + vat(v, 0) * 1.1;
    s.shadow(0.1, 0.1, 1.8, 1.8);
    s.cylinder(1, 1, 0.92, { color: 'brick', h: 0.45 });
    s.cylinder(1, 1, 0.78, { color: 'brick', h: rise, z: 0.4 });
    s.cylinder(1, 1, 0.48, { color: 'brick', h: 0.7, z: 0.4 + rise });
    s.cylinder(1, 1, 0.28, { color: 'coal', h: 0.35, z: 1.1 + rise });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    if (!(v.flags & FLAG_POWERED)) return;
    const z0 = pxToLevels(zPx);
    smoke(pen, gx + 1, gy + 1, zPx, 3.4, v, pen.t);
    const em = snap(0.45 + 0.45 * Math.abs(Math.sin(pen.t * 3.1 + vat(v, 3) * 6))); /* @tier-b pixels only */
    glowDot(pen, gx + 1, gy + 1, z0 + 0.45, 'warn', 0.16, em);
  },
  emit(lights, gx, gy, v, _rng, zPx) {
    if (!(v.flags & FLAG_POWERED)) return;
    lights.add(gx + 1, gy + 1, zPx, 0.7, 0.7, 'warn');
    lights.add(gx + 1, gy + 1, zPx, 2.4, 0.22, 'warn');
  },
});

export const NEEDLE = defineSprite({
  id: 'needle',
  w: 1,
  d: 1,
  massing(s, v) {
    s.shadow(0.1, 0.1, 0.8, 0.8);
    s.box(0.05, 0.05, 0.9, 0.9, { color: 'brick', h: 0.28 });
    s.cylinder(0.5, 0.5, 0.22, { color: 'brick', h: 2.6 + vat(v, 0) * 1.4, z: 0.28 });
    s.post(0.5, 0.5, 2.9 + vat(v, 0) * 1.4, 0.5, 'coal');
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    if (!(v.flags & FLAG_POWERED)) return;
    smoke(pen, gx + 0.5, gy + 0.5, zPx, 3.2, v, pen.t * 1.15);
  },
});

const scratch = { seed: 0, flags: 0, level: 1, progress: 0, label: '' };

export function variant(seed: number, gx: number, gy: number, on: boolean, burst: number): Variant {
  scratch.seed = (seed ^ (gx * 73856093) ^ (gy * 19349663)) >>> 0;
  scratch.flags = on ? FLAG_POWERED : 0;
  scratch.level = 1 + (scratch.seed % 3);
  scratch.progress = burst;
  return scratch;
}

export function kindOf(seed: number, gx: number, gy: number): typeof SHED | typeof BOTTLE | typeof NEEDLE {
  const u = toUnit(hashStep(seed ^ gx ^ (gy << 8), 9));
  if (u < 0.38) return BOTTLE;
  if (u < 0.78) return SHED;
  return NEEDLE;
}

function smoke(pen: Pen, gx: number, gy: number, zPx: number, stack: number, v: Variant, t: number): void {
  const burst = v.progress;
  const z0 = pxToLevels(zPx) + stack;
  const n = burst > 0.05 ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const age = (t * 0.42 + vat(v, 4 + i)) % 1;
    const lift = age * (2.2 + burst * 2.4);
    const drift = (vat(v, 8 + i) - 0.5) * 0.7 * age;
    const a = snap((1 - age) * (0.62 + burst * 0.35));
    if (a <= 0) continue;
    glowDot(pen, gx + drift, gy - drift * 0.4, z0 + lift, withAlpha(pen.palette.get('ash'), a), 0.18 + age * 0.28, a);
  }
}
