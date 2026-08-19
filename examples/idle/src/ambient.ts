/**
 * Ash in the air, and a wash of heat over working ground. Mechanically inert.
 *
 * @art
 */
import { hash2, toUnit } from '@latticekit/core';
import { glowDot, mix, withAlpha, type Pen } from '@latticekit/draw';
import { snap } from './palette.js';

const MOTES = 90;

export function drawAir(pen: Pen, seed: number, burst: number): void {
  const t = pen.t;
  for (let i = 0; i < MOTES; i++) {
    const u = toUnit(hash2(seed ^ 0xa51, i, 1));
    const v = toUnit(hash2(seed ^ 0xa52, i, 2));
    const age = (t * (0.08 + u * 0.12) + v) % 1;
    const gx = 40 + u * 90 + (v - 0.5) * 8;
    const gy = 50 + v * 80 - age * 6;
    const a = snap((1 - age) * (0.18 + burst * 0.35));
    if (a <= 0) continue;
    glowDot(pen, gx, gy, 4 + age * 3, withAlpha(pen.palette.get('ash'), a), 0.1, a);
  }
}

export function drawHeat(pen: Pen): void {
  const xy = pen.xy;
  const w = pen.camera.viewW;
  const h = pen.camera.viewH;
  xy[0] = 0; xy[1] = h * 0.62;
  xy[2] = w; xy[3] = h * 0.62;
  xy[4] = w; xy[5] = h;
  xy[6] = 0; xy[7] = h;
  pen.surface.poly(xy, 4, withAlpha(mix(pen.palette.get('warn'), 0x00000000, 0.82), 0.08));
}
