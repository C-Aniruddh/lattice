/** Builder's mechanically inert drawing vocabulary.
 * @art
 */
import { drawFootprint, drawGhost, drawSprite, isoBox, isoPost, isoTile, type Pen, type SpriteDef, type Variant } from '@latticekit/draw';
import { defineSprite } from '@latticekit/draw';

export const WORKSHOP = defineSprite({
  id: 'builder-workshop', w: 3, d: 2,
  massing(w) {
    w.shadow(.08, .08, 2.84, 1.84, .3);
    w.box(.12, .12, 2.76, 1.76, { h: 1.35, color: 'brand', outline: true });
    w.roof(.02, .02, 2.96, 1.96, 1.35, .72, 'metal');
    w.box(.45, -.03, .68, .12, { h: .75, color: 'glass' });
    w.box(1.92, -.03, .68, .12, { h: .75, color: 'glass' });
    w.post(2.58, 1.55, 2.02, .85, 'metal', .1);
  },
  animate(pen, gx, gy, v) { isoPost(pen, gx + 2.58, gy + 1.55, 2.02, .72 + Math.sin(pen.t * 3 + v.seed) * .08, 'metal', .1); },
});

export function ground(pen: Pen, size: number, time: number): void {
  const chase = Math.floor(time * 4) % 7;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const lane = x % 7 === 0 || y % 7 === 0;
    const signal = lane && (x + y + chase) % 7 === 0;
    isoTile(pen, x, y, signal ? 'brand' : lane ? 'metal' : 'ground', 'ink', lane ? .06 : .11);
    if (!lane && (x * 17 + y * 31) % 19 === 0) isoPost(pen, x + .5, y + .5, 0, .18 + .06 * Math.sin(time * 2 + x), 'glass', .035);
  }
}

export function obstacle(pen: Pen, gx: number, gy: number, n: number): void {
  isoBox(pen, gx + .12, gy + .12, .76, .76, { h: .32 + (n % 3) * .16, color: n % 2 ? 'metal' : 'glass', outline: true });
}

export function building(pen: Pen, gx: number, gy: number, variant: Variant): void { drawSprite(pen, WORKSHOP, gx, gy, variant); }
export function ghost(pen: Pen, gx: number, gy: number, variant: Variant, legal: boolean): void {
  drawFootprint(pen, gx, gy, 3, 2, legal ? 'ok' : 'bad');
  drawGhost(pen, WORKSHOP, gx, gy, variant, legal);
}
