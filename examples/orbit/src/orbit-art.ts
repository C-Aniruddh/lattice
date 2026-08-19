/**
 * Procedural void, stars, and floating structures. Deleting this changes only appearance.
 * @art
 */
import { hash2, toUnit } from '@latticekit/core';
import { gridToWorldX, gridToWorldY } from '@latticekit/iso';
import type { DepthSorter } from '@latticekit/iso';
import { glowDot, isoBox, isoCylinder, isoPatch, isoPost } from '@latticekit/draw';
import type { Pen } from '@latticekit/draw';

const TAU = Math.PI * 2;
const PX = new Float64Array(8);

function unit(seed: number, i: number, salt: number): number {
  return toUnit(hash2(seed ^ salt, i, salt));
}

function dust(pen: Pen, seed: number): void {
  const s = pen.surface;
  const drift = pen.t * 2.4;
  PX[0] = 0; PX[1] = 0; PX[2] = s.width; PX[3] = 0;
  PX[4] = s.width; PX[5] = s.height; PX[6] = 0; PX[7] = s.height;
  s.polyRamp(PX, 4, 0, 0, s.width, s.height, pen.palette.get('voidTop'), pen.palette.get('voidDeep'));
  for (let band = 0; band < 3; band++) {
    const alpha = band === 0 ? 0.28 : band === 1 ? 0.48 : 0.72;
    const count = 110 + band * 65;
    const prev = s.alpha(alpha);
    for (let i = 0; i < count; i++) {
      const wx = (unit(seed, i, band * 71 + 3) - 0.5) * 6200;
      const wy = (unit(seed, i, band * 83 + 9) - 0.5) * 3600;
      const x = pen.camera.viewW / 2 + (wx - pen.camera.x * (0.08 + band * 0.09) + drift * (band + 1)) * pen.camera.zoom;
      const y = pen.camera.viewH / 2 + (wy - pen.camera.y * (0.05 + band * 0.06)) * pen.camera.zoom;
      if (x < -6 || y < -6 || x > pen.camera.viewW + 6 || y > pen.camera.viewH + 6) continue;
      const r = 0.45 + unit(seed, i, band * 97 + 14) * (band + 1) * 0.7;
      s.ellipse(x, y, r, r, pen.palette.get(i % 17 === 0 ? 'beacon' : 'star'));
    }
    s.alpha(prev);
  }
  const haze = pen.palette.get('haze');
  s.softEllipse(pen.camera.viewW * 0.2, pen.camera.viewH * 0.74, pen.camera.viewW * 0.55, pen.camera.viewH * 0.18, haze, 0);
  s.softEllipse(pen.camera.viewW * 0.83, pen.camera.viewH * 0.19, pen.camera.viewW * 0.42, pen.camera.viewH * 0.12, haze, 0);
}

function platform(pen: Pen, i: number, seed: number, speed: number, selected: number): void {
  const ring = i % 5;
  const angle = unit(seed, i, 21) * TAU + pen.t * speed * (0.025 + ring * 0.004);
  const radius = 12 + ring * 13 + unit(seed, i, 27) * 15;
  const gx = 80 + Math.cos(angle) * radius;
  const gy = 80 + Math.sin(angle) * radius;
  const z = 1.5 + ring * 1.7 + unit(seed, i, 31) * 5 + Math.sin(pen.t * 0.55 + i) * 0.18;
  const size = i < 8 ? 3.2 + (i % 3) : 0.3 + unit(seed, i, 37) * 1.1;
  if (i < 8) {
    isoCylinder(pen, gx, gy, size * 0.55, { color: i % 3 ? 'platform' : 'brand', h: 0.28, z, topColor: 'glass' });
    isoCylinder(pen, gx, gy, size * 0.29, { color: 'metal', h: 0.55 + (i % 4) * 0.25, z: z + 0.28 });
    isoPost(pen, gx, gy, z + 0.8, 1.4 + (i % 3), 'antenna', 0.06);
    for (let arm = 0; arm < 3; arm++) {
      const a = angle + arm * TAU / 3;
      isoPatch(pen, gx + Math.cos(a) * size * 0.4, gy + Math.sin(a) * size * 0.4, size * 0.55, 0.24, z + 0.34, 'solar');
    }
    glowDot(pen, gx, gy, z + 2.2, selected === i ? 'warn' : 'beacon', 0.16, 0.75 + Math.sin(pen.t * 2 + i) * 0.2);
  } else {
    isoBox(pen, gx, gy, size, size * (0.35 + unit(seed, i, 41) * 0.45), { color: i % 11 === 0 ? 'brand' : 'platform', h: 0.08 + unit(seed, i, 45) * 0.32, z, topColor: i % 7 === 0 ? 'glass' : undefined });
  }
}

export function paintOrbit(pen: Pen, order: DepthSorter, seed: number, density: number, speed: number, selected: number): void {
  dust(pen, seed);
  order.clear();
  for (let i = 0; i < density; i++) {
    const ring = i % 5;
    const a = unit(seed, i, 21) * TAU + pen.t * speed * (0.025 + ring * 0.004);
    const r = 12 + ring * 13 + unit(seed, i, 27) * 15;
    const gx = 80 + Math.cos(a) * r;
    const gy = 80 + Math.sin(a) * r;
    const size = i < 8 ? 6 : 1.5;
    order.add(gx, gy, size, size, 330);
  }
  order.sort(pen.camera);
  for (let n = 0; n < order.count; n++) platform(pen, order.indexAt(n), seed, speed, selected);
  const x0 = pen.camera.toScreenX(gridToWorldX(80, 80));
  const y0 = pen.camera.toScreenY(gridToWorldY(80, 80));
  const r = 190 * pen.camera.zoom;
  for (let i = 0; i < 4; i++) {
    const a0 = pen.t * 0.08 + i * TAU / 4;
    PX[i * 2] = x0 + Math.cos(a0) * r;
    PX[i * 2 + 1] = y0 + Math.sin(a0) * r * 0.42;
  }
  pen.surface.stroke(PX, 4, true, pen.palette.get('orbit'), Math.max(1, pen.camera.zoom), 8, -pen.t * 10);
}
