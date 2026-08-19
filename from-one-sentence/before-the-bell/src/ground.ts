import { hash2, noise2, toUnit } from '@latticekit/core';
import { gridToScreen, heightAt, type TileRange } from '@latticekit/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@latticekit/draw';
import { GRASS, PAVE, ROAD, SEED, type Market } from './world.js';

export function drawSky(pen: Pen): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const xy = pen.xy;
  xy[0] = 0;
  xy[1] = 0;
  xy[2] = w;
  xy[3] = 0;
  xy[4] = w;
  xy[5] = h;
  xy[6] = 0;
  xy[7] = h;
  const sky = pen.palette.get('sky');
  const zenith = shade(mix(sky, pen.palette.get('glass'), 0.18), 0.82);
  const horizon = mix(sky, pen.palette.get('warn'), 0.46);
  s.polyRamp(xy, 4, 0, 0, 0, h * 0.88, zenith, horizon);

  const sun = mix(pen.palette.get('warn'), 0xfff3c8ff, 0.55);
  const sx = w * 0.2;
  const sy = h * 0.07;
  s.softEllipse(sx, sy, 130, 130, withAlpha(sun, 0.28), withAlpha(sun, 0));
  s.ellipse(sx, sy, 16, 16, withAlpha(sun, 0.95));

  for (let i = 0; i < 3; i++) {
    const drift = (toUnit(hash2(0x71c, i, 1)) + pen.t * (0.003 + i * 0.0012)) % 1;
    const bx = drift * (w + 420) - 180;
    const by = h * (0.04 + i * 0.045);
    const bw = 160 + toUnit(hash2(0x71c, i, 2)) * 180;
    s.softEllipse(bx, by, bw, bw * 0.13, withAlpha(mix(sun, 0xffffffff, 0.45), 0.14), withAlpha(sun, 0));
  }
}

const pt = { x: 0, y: 0 };

function drawTracks(pen: Pen, market: Market): void {
  const worn = mix(pen.palette.get('cobble'), pen.palette.get('ink'), 0.28);
  const k = pen.camera.zoom;
  const s = pen.surface;
  for (let r = 0; r < market.routes.length; r++) {
    const route = market.routes[r];
    if (route === undefined) continue;
    const n = route.nodeCount;
    for (let i = 0; i < n; i++) {
      const gx = route.gxAt(i);
      const gy = route.gyAt(i);
      gridToScreen(pen.camera, gx, gy, heightAt(market.field, gx, gy) + 1.4, pt);
      pen.xy[i * 2] = pt.x + pen.snapX;
      pen.xy[i * 2 + 1] = pt.y + pen.snapY;
    }
    s.stroke(pen.xy, n, false, withAlpha(shade(worn, 0.8), 0.42), Math.max(3, 18 * k));
    const flow = (r & 1) === 0 ? pen.t * 22 : -pen.t * 22;
    s.stroke(pen.xy, n, false, withAlpha(mix(worn, 0xffffffff, 0.35), 0.18), Math.max(1, 2.2 * k), 12 * k, flow * k);
  }
}

export function drawGround(pen: Pen, market: Market, visible: Readonly<TileRange>): void {
  market.kind.forEach(visible, (gx, gy) => {
    const kind = market.kind.get(gx, gy);
    const grain = (toUnit(hash2(SEED, gx, gy)) - 0.5) * 0.09;
    const drift = noise2(SEED ^ 0x9e1, gx * 0.13, gy * 0.13) * 0.06;
    let ink: Ink = 'leaf';
    let tint = 0.86 + grain + drift;
    if (kind === PAVE) {
      ink = 'cobble';
      const dx = gx + 0.5 - 80;
      const dy = gy + 0.5 - 80;
      const ring = Math.sqrt(dx * dx + dy * dy);
      const band = Math.abs((ring % 5.2) - 2.6) < 0.85 ? -0.07 : 0;
      const wear = noise2(SEED ^ 0x44, gx * 0.22, gy * 0.22) * 0.08;
      tint = 0.88 + grain * 0.45 + wear + band;
    } else if (kind === ROAD) {
      ink = 'cobble';
      tint = 0.76 + grain * 0.4;
    } else {
      ink = 'ok';
      tint = 0.84 + grain + drift;
    }
    const painted = isoTerrain(pen, market.field, gx, gy, ink, undefined, tint);
    if (pen.camera.zoom > 1.3 && kind !== GRASS) {
      pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.86), 0.35), 1);
    }
  });
  drawTracks(pen, market);
}
