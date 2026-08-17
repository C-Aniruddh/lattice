/**
 * Everything that moves and changes no number: steam, aircraft, and the glow the city puts into
 * its own air.
 *
 * @art
 *
 * It has its own module precisely *because* it is mechanically inert. In a world where only the
 * things you can interact with move, an eye learns that motion means consequence, and the city
 * reads as a control panel with scenery on it. A helicopter crossing while nothing is happening
 * is what turns it back into a place.
 *
 * Everything here is closed form in `pen.t` and a seeded hash of the instance's own index, so it
 * holds no state, allocates nothing, and is identical on every reload.
 */
import { hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import { mix, withAlpha, type Pen } from '@latticekit/draw';
import { snap } from './palette.js';

const pt: Vec2 = { x: 0, y: 0 };

/**
 * Steam: seven puffs rising, spreading and thinning from a world point.
 *
 * A chimney, a street vent, a plume off a roof. It is the cheapest life a static object can have,
 * and in a night city it does something extra that daylight scenes do not get: it catches the
 * warm light on its way up, which is the only volumetric anything in this renderer.
 */
export function steam(pen: Pen, gx: number, gy: number, zPx: number, seed: number, strength: number): void {
  if (strength <= 0) return;
  const s = pen.surface;
  const warm = pen.palette.get('warn');
  const cool = pen.palette.get('metal');
  for (let i = 0; i < 7; i++) {
    const phase = (pen.t * 0.22 + i / 7 + toUnit(hash2(seed, i, 7))) % 1;
    const drift = noise2(seed, i * 3.1, pen.t * 0.3) * 0.7;
    gridToScreen(pen.camera, gx + drift * phase, gy - drift * phase, zPx + phase * 92, pt);
    const r = (3 + phase * 20) * pen.camera.zoom;
    // Warm at the bottom where the lamps reach it, cold at the top where nothing does.
    // Both the mix and the alpha are snapped: a puff whose color moves continuously is seven
    // radial-ramp cache misses per vent per frame. See `palette.snap`.
    const body = mix(warm, cool, snap(Math.min(1, phase * 1.6)));
    s.softEllipse(
      pt.x + pen.snapX,
      pt.y + pen.snapY,
      r,
      r * 0.82,
      withAlpha(body, snap((1 - phase) * 0.26 * strength)),
      withAlpha(body, 0),
    );
  }
}

/** How high the traffic lane is, in world pixels, and how far across the map it runs. */
const HELI_Z = 640;
const PLANE_Z = 1180;

/**
 * The sky lane: one helicopter low and slow, one airliner high and slower.
 *
 * They are drawn in the Effects pass, above everything, because both are above everything. This
 * is also the exhibit's answer to *something moves before the visitor acts* on the frame where a
 * visitor happens to be looking at the sky rather than at the skyline.
 */
export function drawAir(pen: Pen, seed: number): void {
  const s = pen.surface;
  const k = pen.camera.zoom;

  // ── the helicopter ────────────────────────────────────────────────────────────────────────
  const hk = (pen.t * 0.018 + toUnit(hash2(seed, 1, 1))) % 1;
  // The lane crosses the part of the map the opening frame is looking at. Both aircraft used to be
  // ranged over a twenty-three tile map and would now spend the whole of their run behind the
  // camera on a fifty-one tile one.
  const hx = -6 + hk * 46;
  const hy = 34 - hk * 34 + noise2(seed, 2, pen.t * 0.4) * 0.8;
  gridToScreen(pen.camera, hx, hy, HELI_Z + noise2(seed, 3, pen.t * 0.5) * 22, pt);
  const bx = pt.x + pen.snapX;
  const by = pt.y + pen.snapY;
  const ink = pen.palette.get('ink');
  s.ellipse(bx, by, 5 * k, 2.2 * k, ink);
  s.ellipse(bx - 6 * k, by - 0.6 * k, 3 * k, 1 * k, ink);
  // The rotor: one stroke whose width collapses and reopens, which at this size reads as a disc
  // turning far faster than a frame can show.
  const spin = Math.abs(Math.sin(pen.t * 7)); /* @tier-b pixels only */
  pen.xy[0] = bx - 11 * k * (0.35 + spin * 0.65);
  pen.xy[1] = by - 3.4 * k;
  pen.xy[2] = bx + 11 * k * (0.35 + spin * 0.65);
  pen.xy[3] = by - 3.4 * k;
  s.stroke(pen.xy, 2, false, withAlpha(ink, 0.55), Math.max(1, 1.2 * k));
  const blink = (pen.t * 1.4) % 1 < 0.2;
  if (blink) {
    const red = pen.palette.get('bad');
    s.softEllipse(bx, by + 2 * k, 7 * k, 7 * k, withAlpha(red, 0.7), withAlpha(red, 0));
    s.ellipse(bx, by + 2 * k, 1.4 * k, 1.4 * k, mix(red, 0xffffffff, 0.4));
  }

  // ── the airliner ──────────────────────────────────────────────────────────────────────────
  const pk = (pen.t * 0.007 + toUnit(hash2(seed, 4, 4))) % 1;
  gridToScreen(pen.camera, 46 - pk * 62, -14 + pk * 40, PLANE_Z, pt);
  const px = pt.x + pen.snapX;
  const py = pt.y + pen.snapY;
  const lamp = pen.palette.get('lamp');
  s.ellipse(px, py, 3 * k, 1.2 * k, withAlpha(ink, 0.8));
  if ((pen.t * 0.9) % 1 < 0.14) {
    s.softEllipse(px, py, 6 * k, 6 * k, withAlpha(lamp, 0.8), withAlpha(lamp, 0));
  }
}

/**
 * The city's own glow, laid over the finished frame.
 *
 * Two ramps and nothing else. The bottom one is sodium light bouncing off haze — the reason a
 * night city is never actually dark near the ground — and the top one is a vignette that takes
 * the corners of the sky down so the skyline is the brightest edge in the picture.
 *
 * Both go **above** the light mask, in the Overlay pass. Below it they would be masked out by the
 * darkness they are supposed to be an artifact of.
 */
export function drawHaze(pen: Pen, hour: number): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const xy = pen.xy;
  const warm = mix(pen.palette.get('warn'), pen.palette.get('bad'), 0.25);
  xy[0] = 0;
  xy[1] = h * 0.42;
  xy[2] = w;
  xy[3] = h * 0.42;
  xy[4] = w;
  xy[5] = h;
  xy[6] = 0;
  xy[7] = h;
  // Halved. Sodium bounce is real and it was doing the *opposite* of its job here: laid over a
  // ground already washed by a hundred overlapping pools, it was the last coat on the flat bright
  // sheet rather than an artifact of light that had somewhere to bounce from.
  s.polyRamp(xy, 4, 0, h * 0.42, 0, h, withAlpha(warm, 0), withAlpha(warm, 0.018 + hour * 0.018));

  const dark = pen.palette.get('night');
  xy[1] = 0;
  xy[3] = 0;
  xy[5] = h * 0.3;
  xy[7] = h * 0.3;
  s.polyRamp(xy, 4, 0, 0, 0, h * 0.3, withAlpha(dark, 0.55), withAlpha(dark, 0));
}
