/**
 * Harbor drawing only: water, jetty, boats, masts, cranes, and their moving details.
 * @art
 */
import { glowDot, isoBox, isoPatch, isoPost, isoRoof, isoTile, isoWall } from '@latticekit/draw';
import type { Pen } from '@latticekit/draw';

export type HarborThing = { kind: 0 | 1 | 2 | 3 | 4; gx: number; gy: number; w: number; d: number; h: number; tint: number };

export function paintWater(pen: Pen, gx: number, gy: number): void {
  const ripple = Math.abs((gx * 13 + gy * 7) % 11);
  const fill = ripple === 0 ? 'foam' : ripple < 4 ? 'water2' : ripple < 7 ? 'water3' : 'brand';
  isoTile(pen, gx, gy, fill, undefined, 0.008, 0);
}

export function paintJetty(pen: Pen): void {
  isoPatch(pen, 20, 43, 92, 3.4, 0.08, 'ground', 'ink');
  for (let x = 21; x < 112; x += 3) {
    isoPost(pen, x, 43.25, -0.18, 0.8, 'ink', 0.1);
    isoPost(pen, x, 46.0, -0.18, 0.8, 'ink', 0.1);
  }
  for (let x = 23; x < 110; x += 9) isoPatch(pen, x, 42.3, 2.2, 0.7, 0.05, 'metal');
}

function boat(pen: Pen, t: HarborThing, time: number): void {
  const bob = Math.sin(time * 1.5 + t.tint) * 0.025;
  isoBox(pen, t.gx, t.gy, t.w, t.d, { color: t.gy < 39 ? 'farHull' : t.tint & 1 ? 'brand' : 'ground', h: 0.32, z: bob });
  isoBox(pen, t.gx + t.w * .28, t.gy + t.d * .2, t.w * .38, t.d * .56, { color: 'glass', h: .32, z: .3 + bob, outline: false });
  isoPost(pen, t.gx + t.w * .56, t.gy + t.d * .48, .54 + bob, t.h, 'ink', .055);
  const sway = Math.sin(time * .7 + t.tint) * .12;
  isoWall(pen, t.gx + t.w * .57, t.gy + t.d * .47, t.gx + t.w * .96 + sway, t.gy + t.d * .47, .7, t.h * .78, 'ground');
  glowDot(pen, t.gx + .15, t.gy + .15, .42, 'warn', .07, .8);
}

function crane(pen: Pen, t: HarborThing, time: number): void {
  isoBox(pen, t.gx, t.gy, t.w, t.d, { color: 'metal', h: .45 });
  isoPost(pen, t.gx + t.w * .5, t.gy + t.d * .5, .42, t.h, 'warn', .14);
  const reach = 5.2 + Math.sin(time * .18 + t.tint) * .35;
  isoWall(pen, t.gx + .5, t.gy + .5, t.gx + reach, t.gy + .5, t.h, t.h + .28, 'warn', 'ink');
  isoPost(pen, t.gx + reach, t.gy + .5, .65, t.h - .2, 'ink', .035);
  isoBox(pen, t.gx + reach - .18, t.gy + .32, .35, .35, { color: 'brand', h: .45, z: .22 });
}

export function paintThing(pen: Pen, t: HarborThing, time: number): void {
  if (t.kind === 4) return paintJetty(pen);
  if (t.kind === 0) return boat(pen, t, time);
  if (t.kind === 1) return crane(pen, t, time);
  if (t.kind === 2) {
    isoBox(pen, t.gx, t.gy, t.w, t.d, { color: 'ground', h: t.h });
    isoRoof(pen, t.gx, t.gy, t.w, t.d, t.h, .45, 'brand');
    return;
  }
  isoPost(pen, t.gx, t.gy, 0, t.h, t.tint % 4 ? 'ink' : 'warn', .045);
}

export function paintWake(pen: Pen, time: number): void {
  for (let i = 0; i < 7; i++) {
    const x = 52 + ((time * 2.2 + i * 2.4) % 18);
    isoPatch(pen, x, 70 + i * .08, 1.2, .07, .025, 'glass');
  }
}
