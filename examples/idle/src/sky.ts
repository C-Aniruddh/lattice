/**
 * Amber sky, three haze bands, a low sun. The far rim goes dim so the near kilns read as near.
 *
 * @art
 */
import { mix, withAlpha, type Pen } from '@latticekit/draw';

function screenQuad(xy: Float64Array, x0: number, y0: number, x1: number, y1: number): void {
  xy[0] = x0; xy[1] = y0;
  xy[2] = x1; xy[3] = y0;
  xy[4] = x1; xy[5] = y1;
  xy[6] = x0; xy[7] = y1;
}

export function drawSky(pen: Pen): void {
  const s = pen.surface;
  const xy = pen.xy;
  const w = pen.camera.viewW;
  const h = pen.camera.viewH;
  const sky = pen.palette.get('sky');
  const dusk = mix(sky, pen.palette.get('night'), 0.45);
  screenQuad(xy, 0, 0, w, h);
  s.polyRamp(xy, 4, 0, 0, 0, h * 0.55, mix(dusk, sky, 0.2), mix(sky, 0xffd8a0ff, 0.4));
  const cx = w * 0.78;
  const cy = h * 0.18;
  s.ellipse(cx, cy, 86, 86, withAlpha(pen.palette.get('warn'), 0.22));
  s.ellipse(cx, cy, 28, 28, pen.palette.get('warn'));
}

export function drawHaze(pen: Pen): void {
  const s = pen.surface;
  const xy = pen.xy;
  const w = pen.camera.viewW;
  const h = pen.camera.viewH;
  const veil = mix(pen.palette.get('sky'), 0xfff0d8ff, 0.4);
  screenQuad(xy, 0, 0, w, h * 0.22);
  s.poly(xy, 4, withAlpha(veil, 0.28));
  screenQuad(xy, 0, h * 0.72, w, h);
  s.poly(xy, 4, withAlpha(pen.palette.get('ink'), 0.12));
}
