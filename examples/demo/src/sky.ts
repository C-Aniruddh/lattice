/**
 * @art — the sky, the sea, the far ranges, and the ground between them. Delete it and the valley
 * is still there, still walkable, still paying; it is simply a white page with buildings on it.
 *
 * The sky, the sea, and the ground between them.
 *
 * Everything here follows one rule: a flat fill is the clearest tell of a tech demo. The backdrop
 * is a ramp with a body on an arc and stars that come out; the sea is a plane with a swell in it;
 * the ground is a relief term plus two scales of seeded grain plus a hairline grid, and it meets
 * the water through a ring of sand.
 *
 * ## The horizon, and why one function owns it
 *
 * This module used to have no horizon at all. The sea was a 260-unit plane at `z = 0`, which in a
 * 2:1 projection covers every pixel above the island as well as below it — so the sky ramp, the
 * sun, the moon and all 110 stars were painted and then buried, and the top third of the opening
 * frame was one flat blue. {@link horizonY} is the row where the water stops, derived from the
 * camera so it pans and zooms with everything else, and the ramp, the water, the swell, the far
 * ranges and the haze all ask it rather than each keeping a constant. The three distance bands
 * `docs/GALLERY.md` § Scale asks for are: {@link farRanges} behind the water, the real coast and
 * range in {@link terrainTile} washed toward the sky by depth, and the valley itself in front.
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
import {
  HALF_H,
  HALF_W,
  TILE_H,
  TILE_W,
  gridToScreen,
  heightAt,
  pathSample,
  type GridPoint,
  type Rect,
  type TileRange,
} from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen, type Rgba } from '@lattice/draw';
import { steady } from './palette.js';
import { RIVER, SCREE, SEA, SHORE, type Valley } from './valley.js';

const pt: Vec2 = { x: 0, y: 0 };
const sample: GridPoint = { gx: 0, gy: 0 };
/** The visible world rectangle, refilled once per frame by {@link drawTerrain}. */
const viewBox: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** How far past the coast the water runs before it becomes sky, in `gx + gy`. */
const HORIZON_BAND = SHORE - 8;
/** Where aerial perspective has died out entirely, and over how many bands it fades in. */
const HAZE_AT = SHORE + 30;
const HAZE_SPAN = 30;

/**
 * The screen row where the water ends and the sky begins.
 *
 * A constant `gx + gy` is a horizontal line in a 2:1 projection, so one projected point answers
 * for the whole width — and because it is projected rather than assumed, the horizon rises and
 * falls correctly under a drag and a zoom instead of being painted at a fixed fraction of the
 * canvas, which is the tell that a backdrop is wallpaper.
 */
function horizonY(pen: Pen): number {
  gridToScreen(pen.camera, HORIZON_BAND * 0.5, HORIZON_BAND * 0.5, 0, pt);
  return pt.y + pen.snapY;
}

/** How much of the sky this tile has in front of it: 1 on the far coast, 0 in the valley. */
function hazeAt(gx: number, gy: number): number {
  return clamp01((HAZE_AT - (gx + gy)) / HAZE_SPAN);
}

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
function terrainTile(pen: Pen, v: Valley, gx: number, gy: number, daylight: number, box: Readonly<Rect>): boolean {
  // Past the horizon the map is sky, and the map does not know that. `TileGrid` is a rectangle and
  // its two far edges are the two upper edges of a diamond, so painting its water out there paints
  // a pale diamond across the top of the frame with the ranges behind it — which is what the first
  // run of this pass did, and it is worth a line to make unreachable rather than a comment.
  if (gx + gy < HORIZON_BAND) return false;
  // `docs/GALLERY.md` § The cost row's first move, and it is worth two comparisons: `renderFrame`
  // margins the Terrain range by the map's tallest ground **on all four sides**, because a camera
  // cannot know which tiles are the tall ones. Fifteen tiles of that ring is a third of every
  // frame's tile work spent on ground that is off the screen. This *does* know the elevation — it
  // is one grid read — so it can answer the question the range could only be generous about.
  const wx = (gx - gy) * HALF_W;
  if (wx < box.minX - TILE_W || wx > box.maxX + TILE_W) return false;
  const wy = (gx + gy) * HALF_H - heightAt(v.field, gx, gy);
  if (wy < box.minY - TILE_H * 3 || wy > box.maxY + TILE_H * 3) return false;
  const t = v.terrain.get(gx, gy);
  const wet = t === SEA || t === RIVER;
  // Water takes {@link drawSea}'s own color, not one of its own: the plane is already under it,
  // and the only reason to paint the tile at all is the swell glint below.
  const own: Ink = wet
    ? mix(pen.palette.get('glass'), pen.palette.get('ink'), 0.52)
    : v.shore.get(gx, gy) === 1
      ? 'sand'
      : t === SCREE
        ? 'metal'
        : 'ground';
  // Aerial perspective, and it is the whole of the third distance band: the far range is the same
  // rock as the near one, pulled toward whatever the sky is at this hour. It goes in through the
  // `Ink` rather than over the top as a wash because a wash is in *screen* space and would haze
  // the shrine's roof — a near object that happens to be high — as hard as the coast behind it.
  // Water is exempt: it is already the sky's color by the time it reaches the horizon.
  const haze = wet ? 0 : hazeAt(gx, gy);
  const ink: Ink = haze <= 0.002 ? own : mix(typeof own === 'string' ? pen.palette.get(own) : own, pen.palette.get('sky'), haze * haze * 0.62);
  // Detail where the eye is: the far band is asked to be hazier, and that is also permission for
  // it to be cheaper. Above three quarters haze neither scale of grain survives the wash, so
  // neither is computed.
  const cheap = haze > 0.75;
  const field = cheap ? 0 : noise2(v.seed ^ 0x9e1, gx * 0.13, gy * 0.13) * 0.1 * (wet ? 0.3 : 1);
  const grain = cheap ? 0 : (toUnit(hash2(v.seed, gx, gy)) - 0.5) * 0.11 * (1 - haze) * (wet ? 0.2 : 1);
  const base = isoTerrain(pen, v.field, gx, gy, ink, undefined, 1 + field + grain);
  if (wet) {
    // A slow swell, so still water is not a painted sheet.
    const swell = noise2(v.seed ^ 0x33, gx * 0.42 + pen.t * 0.22, gy * 0.42) * 0.5 + 0.5;
    if (swell > 0.6) {
      const glint = mix(base, pen.palette.get('sky'), 0.75);
      pen.surface.poly(pen.xy, 4, withAlpha(glint, (swell - 0.6) * (0.9 * daylight + 0.25)));
    }
  } else if (pen.camera.zoom > 0.44 && haze < 0.8) {
    // The hairline grid. Two edges only, at the tile's own hue, so it reads as a seam in the turf
    // — which is why it is three points here rather than `isoTerrain`'s four-sided `stroke`. It
    // goes out with distance for the same reason the grain does: detail that survives the haze is
    // what makes a far hill read as a near hill someone shrank.
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(base, 0.86), 0.4 * (1 - haze)), 1);
  }
  return true;
}

/**
 * Every tile of the ground, culled to the frame.
 *
 * The loop lives here rather than in `main.ts` because the cull inside {@link terrainTile} is the
 * reason it exists, and a pass whose bound is in one file and whose reject is in another is a pass
 * that will lose the reject the first time somebody tidies the wiring.
 */
export function drawTerrain(pen: Pen, v: Valley, visible: Readonly<TileRange>, daylight: number): void {
  const box = pen.camera.visibleWorldBounds(viewBox);
  v.terrain.forEach(visible, (gx, gy) => {
    terrainTile(pen, v, gx, gy, daylight, box);
  });
}

/**
 * The sea, from the horizon down: one plane, a swell rolling toward the viewer, and the water
 * closest to the sky washed into it so the two do not meet at a line you could cut yourself on.
 *
 * **It fills a screen rectangle rather than a grid quad, and that is not a shortcut.** A plane at
 * `z = 0` is horizontal, so in a 2:1 projection every point of it that is far enough away is
 * *above* the camera's row — a grid quad big enough to reach both frame edges is also big enough
 * to cover the entire sky. The old one was 260 units across and did exactly that: the ramp, the
 * arc and the stars were all painted underneath it and never once seen. Water is the half-plane
 * below {@link horizonY} and is cheapest to say that way.
 */
export function drawSea(pen: Pen, seed: number, daylight: number): void {
  const deep = mix(pen.palette.get('glass'), pen.palette.get('ink'), 0.52);
  const s = pen.surface;
  const w = s.width;
  const hy = horizonY(pen);
  if (hy >= s.height) return;
  const top = Math.max(0, hy);
  pen.xy[0] = 0;
  pen.xy[1] = top;
  pen.xy[2] = w;
  pen.xy[3] = top;
  pen.xy[4] = w;
  pen.xy[5] = s.height;
  pen.xy[6] = 0;
  pen.xy[7] = s.height;
  s.poly(pen.xy, 4, deep);
  // Swell: long bands of constant `gx + gy`, which is a horizontal bar on screen, drifting from
  // the horizon toward the viewer. They are projected rather than drawn at fixed screen rows so
  // they keep station with the water under a drag.
  const span = SHORE + 6 - HORIZON_BAND;
  for (let i = 0; i < 12; i++) {
    const band = HORIZON_BAND + ((i / 12 + pen.t * 0.02) % 1) * span;
    const thick = 0.5 + noise2(seed, i, 0) * 1.1;
    gridToScreen(pen.camera, band * 0.5, band * 0.5, 0, pt);
    const y = pt.y + pen.snapY;
    if (y < hy) continue;
    pen.xy[0] = 0;
    pen.xy[1] = y;
    pen.xy[2] = w;
    pen.xy[3] = y;
    pen.xy[4] = w;
    pen.xy[5] = y + thick * HALF_H * pen.camera.zoom;
    pen.xy[6] = 0;
    pen.xy[7] = y + thick * HALF_H * pen.camera.zoom;
    s.poly(pen.xy, 4, withAlpha(mix(deep, pen.palette.get('sky'), 0.55), 0.07 + daylight * 0.09));
  }
  // The water nearest the sky takes the sky's color. Without it the horizon is a hard seam, and a
  // hard seam is the one edge `docs/GALLERY.md` § Scale will not accept.
  pen.xy[0] = 0;
  pen.xy[1] = top;
  pen.xy[2] = w;
  pen.xy[3] = top;
  pen.xy[4] = w;
  pen.xy[5] = top + 90;
  pen.xy[6] = 0;
  pen.xy[7] = top + 90;
  s.polyRamp(pen.xy, 4, 0, top, 0, top + 90, withAlpha(pen.palette.get('sky'), 0.5), withAlpha(pen.palette.get('sky'), 0));
}

/**
 * The far ranges: three bands of hills standing beyond the water, each one paler and flatter than
 * the one in front of it.
 *
 * This is the piece `drawRidgeline` was meant to be and never was. That one placed its hills at
 * the *sea plane's* far corner — which, as the header above explains, is hundreds of pixels above
 * any framing that fits the island, so the function could not have run even once. Distance beyond
 * the horizon has no world coordinate in an orthographic projection; it is a painter's problem,
 * and the painter's answer is a profile drawn from {@link horizonY} upward, parallaxed by a
 * fraction of the camera's own pan so the bands slide against each other under a drag.
 */
export function farRanges(pen: Pen, seed: number): void {
  const s = pen.surface;
  const w = s.width;
  const hy = horizonY(pen);
  if (hy <= 0) return;
  const rock = shade(pen.palette.get('metal'), 0.92);
  for (let layer = 0; layer < 3; layer++) {
    const amp = (20 + layer * 26) * Math.min(1.4, pen.camera.zoom + 0.3);
    const back = 0.74 - layer * 0.19;
    const drift = -pen.camera.x * (0.05 + layer * 0.045);
    let n = 0;
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w;
      const u = (x + drift) * (0.0011 + layer * 0.0007);
      const h = (noise2(seed ^ (0x3a1 + layer), u, layer * 7) * 0.62 + noise2(seed ^ 0x51c, u * 2.9, layer) * 0.3 + 0.42) * amp;
      pen.xy[n++] = x;
      pen.xy[n++] = hy - h;
    }
    pen.xy[n++] = w;
    pen.xy[n++] = hy + 4;
    pen.xy[n++] = 0;
    pen.xy[n++] = hy + 4;
    s.poly(pen.xy, n / 2, mix(pen.palette.get('sky'), rock, 1 - back));
  }
}

/**
 * The backdrop: a vertical ramp, a body on an arc, and stars — all of it between the top of the
 * frame and {@link horizonY}, which is the row the water starts.
 *
 * The sun and the moon are the same disc on the same track, which is what makes the two halves of
 * the day feel like one day rather than two backgrounds. **The track ends on the horizon rather
 * than at a fraction of the canvas**: a body that sets two hundred pixels above the water is the
 * cheapest way to tell a reader that the sky and the sea were painted by two different people.
 */
export function drawSky(pen: Pen, daylight: number, cycle: number): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const hy = Math.min(h, Math.max(1, horizonY(pen)));
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
  s.polyRamp(xy, 4, 0, 0, 0, hy, zenith, horizon);

  if (daylight < 0.6) {
    const alpha = clamp01((0.6 - daylight) * 2.4);
    for (let i = 0; i < 240; i++) {
      const sx = toUnit(hash2(0x51a2, i, 1)) * w;
      const sy = toUnit(hash2(0x51a2, i, 2)) * hy;
      const twinkle = 0.4 + 0.6 * (noise2(0x51a2, i * 0.7, pen.t * 0.4) * 0.5 + 0.5);
      s.ellipse(sx, sy, 0.9 + twinkle, 0.9 + twinkle, withAlpha(0xf4f7ffff, alpha * twinkle * 0.8));
    }
  }
  // The arc is kept clear of the two docks: a sun behind the objective card is a sun nobody sees.
  const bx = w * (0.26 + 0.48 * cycle);
  const by = hy * (1.02 - 0.92 * Math.sin(cycle * Math.PI)); /* @tier-b pixels only */
  const day = daylight > 0.5;
  const body = day ? mix(pen.palette.get('warn'), 0xfff6d8ff, 0.6) : 0xe3e9f7ff;
  s.softEllipse(bx, by, 130, 130, steady(withAlpha(body, day ? 0.3 : 0.16)), steady(withAlpha(body, 0)));
  s.ellipse(bx, by, day ? 22 : 16, day ? 22 : 16, withAlpha(body, 0.95));
  if (!day) s.ellipse(bx + 6.5, by - 5.5, 13.5, 13.5, withAlpha(zenith, 0.92));
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
    // `fade` and `daylight` both move every frame: four fresh ramp keys per frame without this.
    s.softEllipse(pt.x, pt.y, 22 * k, 11 * k, steady(withAlpha(warm, 0.3 * fade * (1.2 - daylight))), steady(withAlpha(warm, 0)));
    s.ellipse(pt.x, pt.y, 4 * k, 2 * k, withAlpha(mix(warm, 0xfff4d4ff, 0.5), 0.75 * fade));
  }
}
