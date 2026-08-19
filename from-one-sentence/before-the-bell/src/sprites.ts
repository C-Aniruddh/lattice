import { hash2, hashStep, toUnit } from '@latticekit/core';
import {
  VARIANT_ZERO,
  defineSprite,
  glowDot,
  pxToLevels,
  type Pen,
  type SolidWriter,
  type Variant,
} from '@latticekit/draw';

function vat(v: Variant, i: number): number {
  return toUnit(hashStep(v.seed, i));
}

function windows(
  s: SolidWriter,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  floors: number,
  cols: number,
  seed: number,
): void {
  const span = 0.16;
  const gap = 0.08;
  const total = cols * span + (cols - 1) * gap;
  const t0 = (1 - total) * 0.5;
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      if (c === 3) continue;
      const lit = toUnit(hash2(seed, f, c)) > 0.28;
      const u0 = t0 + c * (span + gap);
      const u1 = u0 + span;
      const x0 = ax + (bx - ax) * u0;
      const y0 = ay + (by - ay) * u0;
      const x1 = ax + (bx - ax) * u1;
      const y1 = ay + (by - ay) * u1;
      const z = z0 + f * 0.42 + 0.12;
      s.wall(x0, y0, x1, y1, z, z + 0.26, lit ? 'warn' : 'ink');
    }
  }
}

export const BAKERY_SPRITE = defineSprite({
  id: 'bakery',
  w: 4,
  d: 4,
  massing(s, v) {
    s.shadow(0.2, 0.2, 3.6, 3.6, 0.55);
    s.box(0, 0, 4, 4, { color: 'metal', h: 0.42, outline: false });
    s.box(0.08, 0.08, 3.84, 3.84, { color: 'crust', h: 1.85, z: 0.42 });
    s.box(0.32, 0.32, 3.36, 3.36, { color: 'crust', h: 1.15, z: 2.27 });
    s.roof(0.18, 0.18, 3.64, 3.64, 3.42, 0.95, 'awning');
    s.box(2.55, 0.35, 0.72, 0.72, { color: 'metal', h: 1.35, z: 4.15, outline: false });
    s.post(2.9, 0.7, 5.45, 0.45, 'ink', 0.07);
    s.box(1.35, 3.55, 1.3, 0.38, { color: 'ink', h: 1.05, z: 0.42 });
    s.box(1.5, 3.62, 1.0, 0.22, { color: 'warn', h: 0.72, z: 0.55, outline: false });
    windows(s, 0.08, 0.35, 0.08, 3.65, 0.55, 3, 5, v.seed);
    windows(s, 0.35, 0.08, 3.65, 0.08, 0.55, 3, 5, v.seed ^ 9);
    s.box(-0.15, 2.4, 0.55, 0.7, { color: 'flour', h: 0.38, z: 0.42, outline: false });
    s.box(0.05, 3.05, 0.45, 0.5, { color: 'flour', h: 0.28, z: 0.42, outline: false });
    s.post(0.4, 3.7, 0.42, 1.7, 'ink', 0.05);
    s.box(-0.15, 3.45, 1.1, 0.08, { color: 'flour', h: 0.42, z: 1.85 });
    if (v.label) s.sign(-0.15, 3.45, 0.95, 3.45, 2.22, 0.32, v.label, 'ink');
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const pulse = 0.55 + vat(v, 3) * 0.2;
    const flick = ((pen.t * 6.2 + vat(v, 4)) % 1) < 0.5 ? 1 : 0.72;
    glowDot(pen, gx + 2, gy + 3.75, z + 1.05, 'warn', 0.22, pulse * flick);
    const t = (pen.t * 0.35 + vat(v, 5)) % 1;
    const puff = t < 0.7 ? t / 0.7 : 0;
    if (puff > 0) {
      glowDot(pen, gx + 2.9, gy + 0.7, z + 5.7 + puff * 1.1, 'flour', 0.12 + puff * 0.18, 0.55 * (1 - puff));
    }
  },
  emit(lights, gx, gy, _v, _rng, zPx) {
    lights.add(gx + 2, gy + 3.6, zPx, 1.4, 0.9, 'warn');
    lights.add(gx + 2, gy + 3.6, zPx, 5.2, 0.28, 'warn');
  },
});

export const STALL_SPRITE = defineSprite({
  id: 'stall',
  w: 2,
  d: 2,
  massing(s, v) {
    s.shadow(0.15, 0.15, 1.7, 1.7, 0.4);
    s.post(0.18, 0.18, 0, 1.15, 'ink', 0.07);
    s.post(1.82, 0.18, 0, 1.15, 'ink', 0.07);
    s.post(0.18, 1.82, 0, 1.15, 'ink', 0.07);
    s.post(1.82, 1.82, 0, 1.15, 'ink', 0.07);
    s.box(0.05, 0.05, 1.9, 1.9, { color: vat(v, 1) > 0.5 ? 'awning' : 'crust', h: 0.12, z: 1.15 });
    s.roof(0.02, 0.02, 1.96, 1.96, 1.27, 0.28, vat(v, 1) > 0.5 ? 'awning' : 'brand');
    s.box(0.22, 0.55, 1.56, 0.85, { color: 'flour', h: 0.42, z: 0 });
    s.box(0.35, 0.68, 0.4, 0.32, { color: 'crust', h: 0.22, z: 0.42, outline: false });
    s.box(0.85, 0.7, 0.38, 0.3, { color: 'warn', h: 0.18, z: 0.42, outline: false });
    s.box(1.28, 0.66, 0.32, 0.36, { color: 'crust', h: 0.26, z: 0.42, outline: false });
    s.cylinder(0.55, 1.45, 0.16, { color: 'ground', h: 0.28, z: 0.42, outline: false });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const wave = ((pen.t * 1.8 + vat(v, 2)) % 1);
    const lift = wave < 0.5 ? wave * 0.04 : (1 - wave) * 0.04;
    glowDot(pen, gx + 1, gy + 0.2, z + 1.45 + lift, 'warn', 0.08, 0.45);
  },
  emit(lights, gx, gy, _v, _rng, zPx) {
    lights.add(gx + 1, gy + 1, zPx, 2.4, 0.22, 'warn');
  },
});

export const GATE_SPRITE = defineSprite({
  id: 'gate',
  w: 2,
  d: 1,
  massing(s, v) {
    s.shadow(0.05, 0.15, 1.9, 0.7, 0.35);
    s.post(0.15, 0.5, 0, 1.55, 'ink', 0.1);
    s.post(1.85, 0.5, 0, 1.55, 'ink', 0.1);
    s.box(0.05, 0.28, 1.9, 0.44, { color: 'crust', h: 0.22, z: 1.45 });
    if (v.level < 1) {
      s.box(0.32, 0.38, 0.16, 0.24, { color: 'metal', h: 1.15, z: 0.22, outline: false });
      s.box(0.92, 0.38, 0.16, 0.24, { color: 'metal', h: 1.15, z: 0.22, outline: false });
      s.box(1.52, 0.38, 0.16, 0.24, { color: 'metal', h: 1.15, z: 0.22, outline: false });
    }
    s.cylinder(1.0, 0.5, 0.08, { color: 'warn', h: 0.12, z: 1.7, outline: false });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const on = v.level > 0 ? 0.85 : 0.35 + (((pen.t * 1.4) % 1) < 0.5 ? 0.25 : 0);
    glowDot(pen, gx + 1, gy + 0.5, z + 1.82, v.level > 0 ? 'ok' : 'warn', 0.1, on);
  },
});

export const GATE_TALL = defineSprite({
  id: 'gate-tall',
  w: 1,
  d: 2,
  massing(s, v) {
    s.shadow(0.15, 0.05, 0.7, 1.9, 0.35);
    s.post(0.5, 0.15, 0, 1.55, 'ink', 0.1);
    s.post(0.5, 1.85, 0, 1.55, 'ink', 0.1);
    s.box(0.28, 0.05, 0.44, 1.9, { color: 'crust', h: 0.22, z: 1.45 });
    if (v.level < 1) {
      s.box(0.38, 0.32, 0.24, 0.16, { color: 'metal', h: 1.15, z: 0.22, outline: false });
      s.box(0.38, 0.92, 0.24, 0.16, { color: 'metal', h: 1.15, z: 0.22, outline: false });
      s.box(0.38, 1.52, 0.24, 0.16, { color: 'metal', h: 1.15, z: 0.22, outline: false });
    }
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    glowDot(pen, gx + 0.5, gy + 1, z + 1.82, v.level > 0 ? 'ok' : 'warn', 0.1, v.level > 0 ? 0.85 : 0.4);
  },
});

export const HOUSE_SPRITE = defineSprite({
  id: 'house',
  w: 3,
  d: 3,
  massing(s, v) {
    const tall = 1.15 + vat(v, 1) * 0.55;
    s.shadow(0.2, 0.2, 2.6, 2.6, 0.4);
    s.box(0.1, 0.1, 2.8, 2.8, { color: vat(v, 2) > 0.5 ? 'flour' : 'metal', h: 0.28 });
    s.box(0.18, 0.18, 2.64, 2.64, { color: vat(v, 3) > 0.45 ? 'flour' : 'metal', h: tall, z: 0.28 });
    s.roof(0.08, 0.08, 2.84, 2.84, 0.28 + tall, 0.72, vat(v, 4) > 0.5 ? 'awning' : 'crust');
    windows(s, 0.18, 0.3, 0.18, 2.7, 0.42, 2, 4, v.seed);
    s.box(1.15, 2.55, 0.55, 0.28, { color: 'ink', h: 0.7, z: 0.28, outline: false });
    if (vat(v, 5) > 0.55) s.post(2.35, 0.45, 0.28 + tall + 0.72, 0.55, 'ink', 0.05);
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    if (vat(v, 6) < 0.7) return;
    const z = pxToLevels(zPx);
    const k = (pen.t * 0.7 + vat(v, 7)) % 1;
    if (k > 0.3) return;
    glowDot(pen, gx + 2.35, gy + 0.45, z + 2.6, 'warn', 0.08, 0.5);
  },
});

export const TREE_SPRITE = defineSprite({
  id: 'tree',
  w: 1,
  d: 1,
  massing(s, v) {
    const h = 0.85 + vat(v, 1) * 0.7;
    s.shadow(0.22, 0.22, 0.56, 0.56, 0.35);
    s.post(0.5, 0.5, 0, h, 'ink', 0.08);
    s.cylinder(0.5, 0.5, 0.38 + vat(v, 2) * 0.12, { color: 'leaf', h: 0.7 + vat(v, 3) * 0.35, z: h * 0.55, outline: false });
    s.cylinder(0.42, 0.55, 0.22, { color: 'ok', h: 0.4, z: h * 0.9, outline: false });
  },
});

export const FENCE_SPRITE = defineSprite({
  id: 'fence',
  w: 1,
  d: 1,
  massing(s) {
    s.box(0.12, 0.18, 0.76, 0.64, { color: 'crust', h: 0.55 });
    s.box(0.22, 0.28, 0.56, 0.44, { color: 'flour', h: 0.18, z: 0.55, outline: false });
  },
});

export const FOUNTAIN_SPRITE = defineSprite({
  id: 'fountain',
  w: 2,
  d: 2,
  massing(s) {
    s.shadow(0.15, 0.15, 1.7, 1.7, 0.4);
    s.cylinder(1, 1, 0.92, { color: 'metal', h: 0.32 });
    s.cylinder(1, 1, 0.62, { color: 'glass', h: 0.18, z: 0.22, outline: false });
    s.cylinder(1, 1, 0.18, { color: 'metal', h: 0.85, z: 0.32 });
    s.cylinder(1, 1, 0.32, { color: 'glass', h: 0.12, z: 1.1, outline: false });
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const t = (pen.t * 1.1) % 1;
    glowDot(pen, gx + 1, gy + 1, z + 1.35 + t * 0.35, 'glass', 0.1 + t * 0.08, 0.45 * (1 - t));
  },
});

export const CART_SPRITE = defineSprite({
  id: 'cart',
  w: 1,
  d: 1,
  massing(s, v) {
    s.shadow(0.15, 0.2, 0.7, 0.6, 0.3);
    s.box(0.12, 0.22, 0.76, 0.56, { color: 'crust', h: 0.32, z: 0.12 });
    s.box(0.2, 0.3, 0.28, 0.22, { color: 'flour', h: 0.18, z: 0.44, outline: false });
    s.cylinder(0.22, 0.28, 0.1, { color: 'ink', h: 0.08, z: 0, outline: false });
    s.cylinder(0.78, 0.72, 0.1, { color: 'ink', h: 0.08, z: 0, outline: false });
    if (vat(v, 1) > 0.4) s.post(0.18, 0.5, 0.12, 0.55, 'ink', 0.04);
  },
});

export const BAKERY_VARIANT: Variant = { ...VARIANT_ZERO, seed: 7, label: 'OVEN' };
