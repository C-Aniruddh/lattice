/**
 * The sky: a ramp down to a real horizon, a body that rises out of it, stars, and weather.
 *
 * @art
 *
 * Delete this file and every frame opens on the flat `sky` slot the palette is already rolling.
 * Nothing here holds state, returns a decision or moves a number.
 *
 * ## A dimetric projection has no horizon, so the world grows one
 *
 * An infinite ground plane covers the entire viewport at every zoom and from every position, so
 * a game that paints one has painted over its own sky — and the sun it drew in the backdrop is
 * behind an ocean nobody can see past. The first draft copied the hero's `drawSea` and spent a
 * while wondering where the sun had gone.
 *
 * The answer is not to fake a horizon in screen space, which slides the moment anyone drags. It
 * is that `island.ts` stops the water at a line of constant `v` — a *world* line, which is
 * horizontal on screen at every zoom because `v` is the projection's own depth axis. This file
 * asks `iso` where that line currently is, once per frame, and hangs everything off it: the
 * ramp's warm end, the arc the sun and moon walk, the glow a low body throws along the water,
 * the field the stars occupy and the lane the cloud banks drift down. Pan the camera and the
 * whole sky moves with the world, because it *is* attached to the world.
 *
 * ## One body on one track
 *
 * The sun and the moon are the same disc drawn twice on the same arc, half a cycle apart. That is
 * what makes the two halves of the day feel like one day rather than like two backgrounds: they
 * rise from the same point on the left, cross at the same height, and set into the same water.
 */
import { clamp, clamp01, hash2, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen } from '@lattice/iso';
import { mix, shade, withAlpha, type Pen, type Rgba } from '@lattice/draw';
import { SKY_V } from './island.js';
import { softGlow } from './palette.js';

const STARS = 200;
const DRIFT = 46;
const CLOUDS = 14;
const TAU = Math.PI * 2;
const pt: Vec2 = { x: 0, y: 0 };

/**
 * Screen y of the world's own waterline-to-sky edge, this frame.
 *
 * `gx = gy = SKY_V` is the point on that line directly ahead of the camera's x — and since the
 * line is `gx + gy = 2·SKY_V`, every other point on it projects to the same y. One projection
 * per frame, and it is the only number in this file that is not a fraction of it.
 */
function horizonY(pen: Pen): number {
  gridToScreen(pen.camera, SKY_V, SKY_V, 0, pt);
  return clamp(pt.y + pen.snapY, 1, pen.surface.height);
}

/**
 * The whole backdrop, in one call from the Backdrop pass.
 *
 * `phase` is 0 at first light and wraps at 1; `daylight` is the same 0–1 the palette and the
 * light field are given, and `night` is its complement. Three numbers rather than a clock,
 * because everything in this file has to be a pure function of the frame.
 */
export function drawSky(pen: Pen, phase: number, daylight: number, night: number): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const hy = horizonY(pen);
  const xy = pen.xy;
  xy[0] = 0;
  xy[1] = 0;
  xy[2] = w;
  xy[3] = 0;
  xy[4] = w;
  xy[5] = h;
  xy[6] = 0;
  xy[7] = h;
  // The ramp, and it ends **at the horizon** rather than at the bottom of the frame. The zenith
  // is the `sky` slot darkened and the horizon is it pulled toward `warn`, harder the lower the
  // sun is — which is the whole of why a dusk sky is orange along the water and still blue
  // overhead, and it costs one `mix`. Below `hy` the ramp holds its warm end, which is exactly
  // what the far water dissolves into.
  const zenith = shade(pen.palette.get('sky'), 0.76);
  const horizon = mix(pen.palette.get('sky'), pen.palette.get('warn'), 0.16 + night * 0.36);
  s.polyRamp(xy, 4, 0, 0, 0, hy, zenith, horizon);

  // Where the body is: one arc, walked twice per cycle. `arc` is 0 at the eastern horizon and 1
  // at the western one; the sun owns the first half of the cycle and the moon the second. It
  // rises *out of the water line* and tops out a fifth of the way down to it, so the hour of the
  // day is legible from the disc's height even when the color has not moved much yet.
  const day = phase < 0.5;
  const arc = (phase % 0.5) * 2;
  const bx = w * (0.07 + 0.86 * arc);
  const lift = Math.sin(arc * Math.PI); /* @tier-b pixels only */
  const by = hy - (hy * 0.78 + 20) * lift;

  stars(pen, w, hy, night, phase);
  // The glow the body throws along the water, which is what sells a low sun. Under the clouds,
  // so a cloud bank can sit in front of it.
  const warm = day ? pen.palette.get('warn') : pen.palette.get('glass');
  const low = 1 - lift;
  softGlow(pen, bx, hy + 6, w * 0.42, hy * 0.9 + 40, warm, 0.05 + low * 0.22);
  body(pen, bx, by, day, daylight, zenith);
  clouds(pen, w, hy, daylight, night, bx, by);
}

/** The sun or the moon: a corona, a disc, and — for the moon — the shadow that makes it a moon. */
function body(pen: Pen, bx: number, by: number, day: boolean, daylight: number, zenith: Rgba): void {
  const s = pen.surface;
  const tone = day ? mix(pen.palette.get('warn'), 0xfff4c8ff, 0.55) : 0xe6ecfbff;
  const r = day ? 21 : 15;
  softGlow(pen, bx, by, r * 6.5, r * 6.5, tone, day ? 0.26 : 0.14);
  softGlow(pen, bx, by, r * 2.1, r * 2.1, tone, day ? 0.4 : 0.22);
  s.ellipse(bx, by, r, r, withAlpha(tone, 0.96));
  if (day) {
    // A hotter core, so the disc is not a flat coin. It fades as the sun reddens toward the
    // horizon, which is the one place a real sun is safe to look at.
    s.ellipse(bx, by, r * 0.62, r * 0.62, withAlpha(mix(tone, 0xffffffff, 0.6), 0.5 + daylight * 0.4));
    return;
  }
  s.ellipse(bx + r * 0.42, by - r * 0.34, r * 0.86, r * 0.86, withAlpha(zenith, 0.94));
  for (let i = 0; i < 3; i++) {
    const a = toUnit(hash2(0x310, i, 1)) * TAU; /* @tier-b pixels only */
    const d = 0.3 + toUnit(hash2(0x310, i, 2)) * 0.4;
    s.ellipse(bx + Math.cos(a) * r * d, by + Math.sin(a) * r * d, r * 0.16, r * 0.16, withAlpha(shade(tone, 0.9), 0.5));
  }
}

/**
 * Stars, and the band of them that makes a night sky read as a *sky*.
 *
 * They fade in over the last of the light rather than switching on, and they turn with the phase
 * — a whole revolution per day — so the night is not a still image with a twinkle on it. The
 * field is the strip between the top of the frame and the horizon, which is where a sky is: a
 * star below the water line is a bug that no amount of alpha hides.
 */
function stars(pen: Pen, w: number, hy: number, night: number, phase: number): void {
  const alpha = clamp01(night * 2.1 - 0.9);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const drift = phase * w * 0.35;
  for (let i = 0; i < STARS; i++) {
    // The band is a diagonal smear across the upper sky; the rest are scattered. Two populations
    // out of one loop, because a uniform scatter is the one thing a real sky never looks like.
    const band = i < STARS * 0.45;
    const u = toUnit(hash2(0x51a2, i, 1));
    const v = toUnit(hash2(0x51a2, i, 2));
    const sx = ((u * w * 1.3 - drift) % (w * 1.3) + w * 1.3) % (w * 1.3) - w * 0.15;
    const sy = band ? hy * (0.08 + v * 0.4) + sx * 0.06 : hy * v * 0.96;
    const twinkle = 0.35 + 0.65 * (noise2(0x51a2, i * 0.7, pen.t * 0.5) * 0.5 + 0.5);
    const r = (band ? 0.6 : 1) * (0.8 + twinkle * 0.9);
    s.ellipse(sx, sy, r, r, withAlpha(0xf2f6ffff, alpha * twinkle * (band ? 0.5 : 0.85)));
  }
  // Three brighter ones with a cross-flare, so the eye has something to fix on.
  for (let i = 0; i < 3; i++) {
    const sx = ((toUnit(hash2(0x8a1, i, 1)) * w * 1.3 - drift) % (w * 1.3) + w * 1.3) % (w * 1.3) - w * 0.15;
    const sy = hy * (0.1 + toUnit(hash2(0x8a1, i, 2)) * 0.55);
    const k = 0.6 + 0.4 * (noise2(0x8a1, i, pen.t * 0.8) * 0.5 + 0.5);
    softGlow(pen, sx, sy, 9 * k, 9 * k, 0xffffffff, alpha * 0.5);
    s.ellipse(sx, sy, 1.6, 1.6, withAlpha(0xffffffff, alpha));
  }
}

/**
 * Weather: fourteen banks drifting along the horizon, each three overlapping puffs with a lit rim.
 *
 * They are drawn in **screen space and not in the world**, which is the honest choice rather than
 * a shortcut: a cloud in a dimetric world would have to be a solid at some altitude, would sort
 * against the terrain, and would slide under the camera on a pan at a parallax the eye reads as
 * the cloud being fifty metres up. Screen space gives them their own parallax for free, and
 * nothing in the scene ever occludes them because nothing in the scene is above them.
 *
 * They are flattened hard and kept inside the sky strip, because that is what a cloud twenty
 * kilometres out over water actually looks like from a beach.
 */
function clouds(pen: Pen, w: number, hy: number, daylight: number, night: number, bx: number, by: number): void {
  const s = pen.surface;
  const puff = mix(pen.palette.get('sky'), 0xffffffff, 0.5 + daylight * 0.34);
  const rim = mix(pen.palette.get('warn'), 0xfff6e0ff, 0.35 + daylight * 0.4);
  for (let i = 0; i < CLOUDS; i++) {
    const lane = toUnit(hash2(0xc10, i, 1));
    const speed = 0.5 + toUnit(hash2(0xc10, i, 2)) * 0.9;
    const span = w + DRIFT * 12;
    const cx = ((pen.t * speed * 9 + toUnit(hash2(0xc10, i, 3)) * span) % span) - DRIFT * 6;
    const cy = hy * (0.1 + lane * 0.72);
    const scale = (0.6 + toUnit(hash2(0xc10, i, 4)) * 0.9) * (w / 1400 + 0.5);
    // A bank is three puffs, and the sun behind it lights its near edge. Distance to the body is
    // what decides how much rim it gets, so a cloud crossing the sun genuinely catches fire.
    const near = clamp01(1 - (Math.abs(cx - bx) / (w * 0.42) + Math.abs(cy - by) / (hy + 60)));
    for (let j = 0; j < 3; j++) {
      const ox = (j - 1) * 62 * scale;
      const size = (0.7 + toUnit(hash2(0xc10, i * 5 + j, 7)) * 0.6) * scale;
      const wob = noise2(0xc10, i * 3 + j, pen.t * 0.13) * 5 * scale;
      softGlow(pen, cx + ox, cy + wob, 86 * size, 17 * size, puff, (0.2 + daylight * 0.16) * (1 - night * 0.45));
      if (near > 0.02) softGlow(pen, cx + ox, cy + wob - 5 * size, 60 * size, 10 * size, rim, near * 0.4);
    }
  }
}

/**
 * A pale wash laid over the whole frame at dawn and dusk. One quad, and it earns it.
 *
 * `null` rather than a transparent color, so the caller skips the draw entirely for the two
 * thirds of the cycle where the answer is "nothing". The heat peaks exactly where the palette is
 * halfway between two anchors, which is where a real sky is doing the most.
 */
export function skyWash(pen: Pen, phase: number): Rgba | null {
  const at = phase * 4;
  const heat = 1 - Math.abs((at - Math.floor(at)) * 2 - 1);
  const golden = Math.floor(at) === 1 || Math.floor(at) === 2;
  if (!golden || heat <= 0.05) return null;
  return withAlpha(mix(pen.palette.get('warn'), pen.palette.get('bad'), 0.34), heat * 0.09);
}
