/**
 * The sky, the sea, and the ground between them.
 *
 * Everything here follows one rule: a flat fill is the clearest tell of a tech demo. The backdrop
 * is a ramp with a body on an arc and stars that come out; the sea is a plane with a swell in it;
 * the ground is a relief term plus two scales of seeded grain plus a hairline grid, and it meets
 * the water through a ring of sand.
 *
 * The relief and the four corner heights used to be assembled here, out of `gridToScreen` and
 * `surface.poly`, because `iso` shipped a heightfield and `draw` shipped only flat diamonds. That
 * is `draw.isoTerrain` now — and extracting it found that this file had the relief term's **sign
 * inverted**, which is invisible: terrain lit from the right still looks like terrain, while every
 * building standing on it is lit from the left and the picture reads as flat for a reason no
 * screenshot names. All that is left here is the game's own half — which terrain type, how much
 * seeded grain, and the two second passes the kit deliberately does not do.
 */
import { clamp01, hash2, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen, heightAt, pathSample, type GridPoint } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen, type Rgba } from '@lattice/draw';
import { RIVER, SCREE, SEA, type Valley } from './valley.js';

const pt: Vec2 = { x: 0, y: 0 };
const sample: GridPoint = { gx: 0, gy: 0 };

/**
 * One terrain tile: pick the ink, hand `isoTerrain` the game's own grain, then decorate.
 *
 * Two scales of seeded noise go in through `tint` rather than through a second `shade` call,
 * because `shade` pulls toward a cool or a warm tint by distance from neutral — shading twice
 * tints twice and the ground goes muddy. The kit folds the relief into the same one call.
 *
 * Both second passes read the color `isoTerrain` returned and the corners it left in `pen.xy`,
 * so a swell glint and a hairline seam cost no projection at all.
 */
export function terrainTile(pen: Pen, v: Valley, gx: number, gy: number, daylight: number): void {
  const t = v.terrain.get(gx, gy);
  const wet = t === SEA || t === RIVER;
  const ink: Ink = wet
    ? mix(pen.palette.get('glass'), pen.palette.get('ink'), 0.36)
    : v.shore.get(gx, gy) === 1
      ? 'sand'
      : t === SCREE
        ? 'metal'
        : 'ground';
  const field = noise2(v.seed ^ 0x9e1, gx * 0.13, gy * 0.13) * 0.1;
  const grain = (toUnit(hash2(v.seed, gx, gy)) - 0.5) * 0.11;
  const base = isoTerrain(pen, v.field, gx, gy, ink, undefined, 1 + field + grain);
  if (wet) {
    // A slow swell, so still water is not a painted sheet.
    const swell = noise2(v.seed ^ 0x33, gx * 0.42 + pen.t * 0.22, gy * 0.42) * 0.5 + 0.5;
    if (swell > 0.6) {
      const glint = mix(base, pen.palette.get('sky'), 0.75);
      pen.surface.poly(pen.xy, 4, withAlpha(glint, (swell - 0.6) * (0.9 * daylight + 0.25)));
    }
  } else if (pen.camera.zoom > 0.44) {
    // The hairline grid. Two edges only, at the tile's own hue, so it reads as a seam in the turf
    // — which is why it is three points here rather than `isoTerrain`'s four-sided `stroke`.
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(base, 0.86), 0.4), 1);
  }
}

/** The sea the island stands in: one plane, one swell, one band of glitter under the sun. */
export function drawSea(pen: Pen, seed: number, daylight: number): void {
  const deep = mix(pen.palette.get('glass'), pen.palette.get('ink'), 0.52);
  const s = pen.surface;
  const R = 130;
  gridToScreen(pen.camera, -R, -R, 0, pt);
  pen.xy[0] = pt.x;
  pen.xy[1] = pt.y;
  gridToScreen(pen.camera, R, -R, 0, pt);
  pen.xy[2] = pt.x;
  pen.xy[3] = pt.y;
  gridToScreen(pen.camera, R, R, 0, pt);
  pen.xy[4] = pt.x;
  pen.xy[5] = pt.y;
  gridToScreen(pen.camera, -R, R, 0, pt);
  pen.xy[6] = pt.x;
  pen.xy[7] = pt.y;
  s.poly(pen.xy, 4, deep);
  // Swell: eight long bands, each a stretched diamond, drifting across the plane.
  for (let i = 0; i < 10; i++) {
    const off = ((i / 10 + pen.t * 0.006) % 1) * 220 - 110;
    const w = 5 + noise2(seed, i, 0) * 6;
    gridToScreen(pen.camera, -R, off, 0, pt);
    pen.xy[0] = pt.x;
    pen.xy[1] = pt.y;
    gridToScreen(pen.camera, R, off + w * 0.2, 0, pt);
    pen.xy[2] = pt.x;
    pen.xy[3] = pt.y;
    gridToScreen(pen.camera, R, off + w, 0, pt);
    pen.xy[4] = pt.x;
    pen.xy[5] = pt.y;
    gridToScreen(pen.camera, -R, off + w * 0.8, 0, pt);
    pen.xy[6] = pt.x;
    pen.xy[7] = pt.y;
    s.poly(pen.xy, 4, withAlpha(mix(deep, pen.palette.get('sky'), 0.5), 0.045 + daylight * 0.06));
  }
}

/**
 * The backdrop: a vertical ramp, a body on an arc, and stars.
 *
 * The sun and the moon are the same disc on the same track, which is what makes the two halves of
 * the day feel like one day rather than two backgrounds.
 */
export function drawSky(pen: Pen, daylight: number, cycle: number): void {
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
  const zenith = shade(pen.palette.get('sky'), 0.8);
  const horizon = mix(pen.palette.get('sky'), pen.palette.get('warn'), 0.16 + (1 - daylight) * 0.2);
  s.polyRamp(xy, 4, 0, 0, 0, h, zenith, horizon);

  if (daylight < 0.6) {
    const alpha = clamp01((0.6 - daylight) * 2.4);
    for (let i = 0; i < 110; i++) {
      const sx = toUnit(hash2(0x51a2, i, 1)) * w;
      const sy = toUnit(hash2(0x51a2, i, 2)) * h * 0.7;
      const twinkle = 0.4 + 0.6 * (noise2(0x51a2, i * 0.7, pen.t * 0.4) * 0.5 + 0.5);
      s.ellipse(sx, sy, 0.9 + twinkle, 0.9 + twinkle, withAlpha(0xf4f7ffff, alpha * twinkle * 0.8));
    }
  }
  const bx = w * (0.1 + 0.8 * cycle);
  const by = h * (0.66 - 0.52 * Math.sin(cycle * Math.PI)); /* @tier-b pixels only */
  const day = daylight > 0.5;
  const body = day ? mix(pen.palette.get('warn'), 0xfff6d8ff, 0.6) : 0xe3e9f7ff;
  s.softEllipse(bx, by, 96, 96, withAlpha(body, day ? 0.28 : 0.15), withAlpha(body, 0));
  s.ellipse(bx, by, day ? 18 : 13, day ? 18 : 13, withAlpha(body, 0.95));
  if (!day) s.ellipse(bx + 5.5, by - 4.5, 11, 11, withAlpha(zenith, 0.92));
}

/** A pale wash laid over the whole frame at dawn and dusk. One quad, and it earns it. */
export function duskWash(pen: Pen, daylight: number): Rgba | null {
  const heat = 1 - Math.abs(daylight - 0.5) * 2;
  if (heat <= 0.03) return null;
  return withAlpha(mix(pen.palette.get('warn'), pen.palette.get('bad'), 0.3), heat * 0.06);
}

/**
 * The road as one warm ribbon, re-stroked from the path every frame, with the lit stretch glowing
 * and bright packets traveling up it. Re-routing would be free; the packets are what make the
 * road read as the thing the pilgrims are following rather than as a line drawn on the grass.
 */
export function roadRibbon(pen: Pen, v: Valley, daylight: number, litPx: number): void {
  const n = Math.min(v.road.nodeCount, 120);
  if (n < 2) return;
  for (let i = 0; i < n; i++) {
    const gx = v.road.gxAt(i) + 0.5;
    const gy = v.road.gyAt(i) + 0.5;
    gridToScreen(pen.camera, gx, gy, heightAt(v.field, gx, gy) + 1.5, pt);
    pen.xy[i * 2] = pt.x + pen.snapX;
    pen.xy[i * 2 + 1] = pt.y + pen.snapY;
  }
  const dirt = mix(pen.palette.get('ground'), pen.palette.get('warn'), 0.52 + daylight * 0.12);
  const w = Math.max(3, 12 * pen.camera.zoom);
  const s = pen.surface;
  s.stroke(pen.xy, n, false, shade(dirt, 0.52), w + 6);
  s.stroke(pen.xy, n, false, dirt, w);
  s.stroke(pen.xy, n, false, withAlpha(shade(dirt, 1.2), 0.45), w * 0.3, 10, pen.t * 3);
  if (litPx <= 0) return;
  // Packets: four bright beads running up the lit stretch, spaced along its arc length.
  const warm = pen.palette.get('warn');
  const k = pen.camera.zoom;
  for (let i = 0; i < 4; i++) {
    const at = ((pen.t * 0.16 + i / 4) % 1) * litPx;
    pathSample(v.road, at, sample);
    gridToScreen(pen.camera, sample.gx, sample.gy, heightAt(v.field, sample.gx, sample.gy) + 2, pt);
    const fade = 1 - Math.abs(((pen.t * 0.16 + i / 4) % 1) * 2 - 1) * 0.4;
    s.softEllipse(pt.x, pt.y, 22 * k, 11 * k, withAlpha(warm, 0.3 * fade * (1.2 - daylight)), withAlpha(warm, 0));
    s.ellipse(pt.x, pt.y, 4 * k, 2 * k, withAlpha(mix(warm, 0xfff4d4ff, 0.5), 0.75 * fade));
  }
}
