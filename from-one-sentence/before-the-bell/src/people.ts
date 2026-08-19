import { hash2, toUnit } from '@latticekit/core';
import {
  contactShadow,
  isoBox,
  isoCylinder,
  isoPost,
  mix,
  shade,
  type Pen,
  type Rgba,
} from '@latticekit/draw';

const WHO = 0x0b0e7e;
const FX = [0, 1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071];
const FY = [0, 0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071];
const CLOAKS = ['brand', 'crust', 'awning', 'flour', 'metal', 'ok', 'warn'] as const;

export function drawPerson(
  pen: Pen,
  id: number,
  gx: number,
  gy: number,
  zPx: number,
  dir: number,
  hooked: boolean,
): void {
  const z = zPx / 26;
  const tall = 1.22 + toUnit(hash2(WHO, id, 1)) * 0.55;
  const stoop = toUnit(hash2(WHO, id, 2)) * 0.14;
  const dye = toUnit(hash2(WHO, id, 3));
  const hat = hash2(WHO, id, 4) & 3;
  const carry = hash2(WHO, id, 5) % 6;
  const skin = toUnit(hash2(WHO, id, 6));
  const rate = 1.45 + toUnit(hash2(WHO, id, 7)) * 1.3;
  const build = 0.078 + toUnit(hash2(WHO, id, 8)) * 0.038;
  const slot = CLOAKS[(hash2(WHO, id, 9) & 7) % CLOAKS.length] ?? 'brand';
  const cloak: Rgba = hooked
    ? mix(pen.palette.get('warn'), pen.palette.get('crust'), 0.35)
    : mix(pen.palette.get(slot), pen.palette.get('ink'), 0.16 + dye * 0.38);
  const flesh: Rgba = mix(0xf3d7b0ff, 0x6a4128ff, skin);
  const accent = pen.palette.get(dye < 0.5 ? 'warn' : 'awning');

  const cycle = (pen.t * rate + toUnit(hash2(WHO, id, 10)) * 8) % 1;
  const swing = (cycle < 0.5 ? cycle * 4 - 1 : 3 - cycle * 4) * 0.5;
  const bob = (cycle < 0.25 || cycle > 0.75 ? 1 : -1) * 0.016;
  const fx = FX[dir] ?? 0;
  const fy = FY[dir] ?? 0;
  const px = fy * 0.05;
  const py = -fx * 0.05;
  const hip = z + tall * 0.34;
  const chest = hip + tall * 0.46 - stoop;

  contactShadow(pen, gx - 0.13, gy - 0.13, 0.26, 0.26, 0.48, z);
  const shoe = shade(cloak, 0.62);
  isoPost(pen, gx + px + fx * swing * 0.1, gy + py + fy * swing * 0.1, z, tall * 0.34, shoe, 0.046);
  isoPost(pen, gx - px - fx * swing * 0.1, gy - py - fy * swing * 0.1, z, tall * 0.34, shoe, 0.046);
  isoBox(pen, gx - build, gy - build, build * 2, build * 2, {
    color: cloak,
    h: tall * 0.46 - stoop + bob,
    z: hip,
  });
  isoBox(pen, gx - build * 0.76, gy - build * 0.76, build * 1.52, build * 1.52, {
    color: shade(cloak, 1.1),
    h: 0.13,
    z: chest + bob,
    outline: false,
  });
  isoBox(pen, gx - 0.05, gy - 0.05, 0.1, 0.1, {
    color: flesh,
    h: 0.2,
    z: chest + 0.13 + bob,
    outline: false,
  });

  const head = chest + 0.2 + bob;
  if (hat === 1) {
    isoBox(pen, gx - 0.06, gy - 0.06, 0.12, 0.12, { color: accent, h: 0.08, z: head, outline: false });
  } else if (hat === 2) {
    isoCylinder(pen, gx, gy, 0.12, { color: shade(cloak, 0.82), h: 0.03, z: head, outline: false });
    isoCylinder(pen, gx, gy, 0.055, { color: shade(cloak, 0.9), h: 0.14, z: head + 0.03, outline: false });
  } else if (hat === 3) {
    isoBox(pen, gx - 0.055, gy - 0.055, 0.11, 0.11, { color: accent, h: 0.13, z: head - 0.04, outline: false });
  } else {
    isoBox(pen, gx - 0.052, gy - 0.052, 0.104, 0.104, {
      color: shade(flesh, 0.42),
      h: 0.05,
      z: head - 0.02,
      outline: false,
    });
  }

  if (carry === 1 || hooked) {
    isoCylinder(pen, gx, gy, 0.085, { color: 'ground', h: 0.16, z: head + 0.06, outline: false });
  } else if (carry === 2) {
    isoCylinder(pen, gx + py * 2.2, gy - px * 2.2, 0.055, { color: 'crust', h: 0.14, z: hip + 0.12, outline: false });
  } else if (carry === 3) {
    isoPost(pen, gx + px * 2.3, gy + py * 2.3, z, tall * 1.15, 'ink', 0.02);
  } else if (carry === 4) {
    isoBox(pen, gx - fx * 0.12 - 0.06, gy - fy * 0.12 - 0.06, 0.12, 0.12, {
      color: mix(pen.palette.get('flour'), pen.palette.get('ink'), 0.25),
      h: 0.22,
      z: chest - 0.16 + bob,
      outline: false,
    });
  }
}
