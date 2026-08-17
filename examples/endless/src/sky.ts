/**
 * The air above the horizon: a ramp, a low sun, and the band the world dissolves into.
 *
 * @art
 *
 * Delete this file and the frame opens on the flat `sky` slot behind a world that still runs.
 * Nothing here holds state, returns a decision or moves a number.
 *
 * ## What this file is actually for
 *
 * An unbounded ground plane in a 2:1 projection covers every pixel of the viewport, from every
 * position and at every zoom. `Island` met that fact and dissolved its ocean on a circle;
 * `Endless` has no circle to dissolve on, so `chunks.ts` cuts the plane at a fixed depth instead
 * and this paints what is beyond it. That cut is the horizon, it is a straight screen line
 * because `gx + gy` maps to screen y alone, and the *only* thing making it look like distance
 * rather than like the edge of the map is that the two colors meeting along it are the same
 * color — `haze`, arrived at from the ground below and from the air above.
 *
 * The sun is drawn low and left, once, with no arc: it is a light direction the ground shading
 * already agrees with, and a body on a track would be a second idea in a row that has one.
 */
import { mix, shade, withAlpha, type Pen } from '@lattice/draw';

/** Where the horizon sits, as a fraction of frame height, when the camera is level. It is not
 *  read from anywhere — it does not need to be, because the ground stops on its own and this
 *  only has to be *above* it. Painted over the whole frame, cheapest possible backdrop. */
const HORIZON_Y = 0.5;

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
  const air = pen.palette.get('sky');
  const haze = pen.palette.get('haze');
  // The zenith is darkened and the low air is the haze itself, so the ramp *ends* on the color
  // the ground arrives at. Two colors that merely resemble each other leave a seam you cannot
  // name and cannot stop seeing.
  s.polyRamp(xy, 4, 0, 0, 0, h * (HORIZON_Y + 0.18), shade(air, 0.82), haze);

  // The sun: low, left, and never moving. A wide soft pool first so the whole left half of the
  // sky is warmer than the right — which is what makes the ground's warm-lit / cool-shadow
  // split read as lighting rather than as two greens.
  const sx = w * 0.18;
  const sy = h * (HORIZON_Y - 0.16);
  const warm = mix(pen.palette.get('warn'), 0xfff0d0ff, 0.4);
  s.softEllipse(sx, sy, w * 0.62, h * 0.5, withAlpha(warm, 0.15), withAlpha(warm, 0));
  s.softEllipse(sx, sy, 96, 96, withAlpha(warm, 0.34), withAlpha(warm, 0));
  s.ellipse(sx, sy, 15, 15, withAlpha(warm, 0.92));

  // Cloud bars, flat and wide, sitting just above where the ground will stop. They are the only
  // thing in the frame with a horizontal edge, which is exactly why they read as sky: everything
  // the renderer draws is a diamond.
  for (let i = 0; i < 7; i++) {
    const cy = h * (HORIZON_Y - 0.34) + i * h * 0.045;
    const cx = w * (0.12 + ((i * 37) % 71) / 71) * 1.1;
    const cw = w * (0.1 + ((i * 53) % 29) / 29 * 0.16);
    s.softEllipse(cx, cy, cw, h * 0.016, withAlpha(0xffffffff, 0.16 - i * 0.014), withAlpha(0xffffffff, 0));
  }
}
