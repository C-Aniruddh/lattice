/**
 * The terraces: what a stepped field looks like, what runs down through it, and the air in
 * front of the far ones.
 *
 * @art
 *
 * Delete this file and the hill is an unpainted heightfield: every decision here is about
 * appearance and none of it is read by anything that decides anything. `hill.ts` hands over one
 * quantized height per vertex; this module turns it into worked ground.
 *
 * ## Everything is derived from the heights, and nothing is stored
 *
 * There is no field grid, no wall list, no channel mask. A tile is a **bank** when its four
 * corners disagree, which `hill.riseAt` answers in four reads; it is **flooded**, **planted** or
 * **fallow** according to a noise field sampled with the terrace level folded into its
 * coordinates, so a change of crop happens *at* a wall rather than wandering across one; and it
 * carries **water** when it is near one of two meandering channels that run down the fall line.
 * The reason to derive rather than store is not memory, it is that a stored mask can disagree
 * with the terrain after a reseed and a derived one cannot.
 *
 * ## Three things worth knowing before editing
 *
 * **The pass culls again, per tile, and it has to.** `renderFrame` computes the visible tile
 * range for you and margins it by `Passes.maxHeightPx` — correctly, because a summit's base can
 * be off the bottom of the screen while the summit is on it. But the range is a **box** and the
 * margin grows both of its axes, so on terrain 1600 px tall the box holds roughly ten times the
 * tiles the frame can show. The two rejects at the top of {@link tile} are what keeps the Terrain
 * pass proportional to the frame instead of to the height of the hill, and their cost is one
 * `toScreenX` and two `toScreenY` on a tile that draws nothing. That the game has to write them
 * is filed as a kit finding.
 *
 * **The grain goes through `tint` and never through a second `shade`.** `isoTerrain` folds the
 * relief term and the game's own texture into one `shade` call because `shade` pulls toward a
 * cool or a warm tint by distance from neutral: shading twice tints twice and the ground goes
 * muddy. The per-tile grain and the drifting cloud shadow are therefore both multipliers handed
 * in as `tint`, and every second pass reads the color `isoTerrain` returned.
 *
 * **Aerial perspective is measured up the screen, not across the map.** A 2:1 projection has no
 * horizon and no eye position, so there is no world-space distance to fade by. What a viewer
 * reads as *far* is simply *higher up the frame*, so the haze is a function of the tile's own
 * screen y — which this module has already computed for the cull, and therefore costs nothing.
 * The consequence is honest and intended: pan uphill and the terraces you approach come out of
 * the mist, which is what aerial perspective does.
 */
import { clamp01, hash2, noise2, toUnit } from '@lattice/core';
import { HALF_H, HALF_W, TILE_H, TILE_W, type Rect, type TileRange } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Pen, type Rgba } from '@lattice/draw';
import { H, RISE, STEP_PX, W, type Hill } from './hill.js';
import { place } from './place.js';

/** Fraction of the frame height at which the mist begins, and how far above that it is total.
 *  Together they put the far band in the top third and leave the near two thirds fully saturated. */
const MIST_AT = 0.4;
const MIST_SPAN = 0.46;
/** Past this the tile is too far to be worth any second pass. Chosen so the last visible crop row
 *  fades out rather than stopping along a line. */
const MIST_MUTE = 0.52;
/** How far toward `mist` the furthest ground is taken. Not 1, and not 0.95 either: `isoTerrain`
 *  brightens an east-facing wall by up to 32% *after* this mix, so a nearly-white haze color
 *  saturates the far banks to paper and punches holes in the distance. */
const MIST_PULL = 0.84;

/** Two-point scratch for edge strokes. Never `pen.xy`: the corners live there and a stroke that
 *  wrote over them would take the tile's own outline with it. */
const seg = new Float64Array(4);
/** The four corner heights of the tile being painted, in `iso`'s N, E, S, W order — the order
 *  `isoTerrain` leaves in `pen.xy`, so index `i` here is the corner at `pen.xy[2i]`. */
const corner = [0, 0, 0, 0];
/** Screen-space quad for the mist band. */
const band = new Float64Array(8);

/**
 * How much of a watercourse runs through this tile, 0 to 1.
 *
 * Two channels, both running **down the fall line** rather than along a contour, because that is
 * the half of the idea a still image cannot show: water crossing a terrace is a still pond and
 * water crossing a *bank* is a fall, so a channel that runs downhill produces one spillway per
 * terrace and steps its way down the hill on its own.
 */
function channel(seed: number, gx: number, gy: number): number {
  const u = (gx + gy) * 0.02;
  const v = gx - gy;
  const a = Math.abs(v - 14 - noise2(seed ^ 0x9c, u, 0.5) * 40);
  const b = Math.abs(v + 27 - noise2(seed ^ 0x9c, u, 7.5) * 34);
  const d = a < b ? a : b;
  return d > 1.3 ? 0 : 1 - d / 1.3;
}

/** Stroke the one edge of the tile whose two ends both stand at `want`. On a bank that is the
 *  crest — the lip catching the sky — or, with `lo`, the shadowed foot where the wall meets the
 *  field below it. */
function edge(pen: Pen, want: number, color: Rgba, width: number): void {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3;
    if (corner[i] !== want || corner[j] !== want) continue;
    seg[0] = pen.xy[i * 2] ?? 0;
    seg[1] = pen.xy[i * 2 + 1] ?? 0;
    seg[2] = pen.xy[j * 2] ?? 0;
    seg[3] = pen.xy[j * 2 + 1] ?? 0;
    pen.surface.stroke(seg, 2, false, color, width);
  }
}

/**
 * Crop rows, lying along the contour.
 *
 * The direction is the perpendicular of the height gradient taken over **four** tiles rather
 * than one: on ground that has been quantized into plateaus the one-tile gradient is zero almost
 * everywhere and a wall everywhere else, so rows computed from it would be undefined in the
 * middle of a field and violently wrong at its edge. Four tiles reaches past the plateau to the
 * banks either side, which is where the contour actually is.
 */
function crops(pen: Pen, hill: Hill, gx: number, gy: number, zPx: number, ink: Rgba, fade: number, edges: number): void {
  const h = hill.field.heights;
  let dx = -(h.get(gx, gy + 2) - h.get(gx, gy - 2));
  let dy = h.get(gx + 2, gy) - h.get(gx - 2, gy);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) {
    dx = 0.3;
    dy = -0.3;
  } else {
    dx = (dx / len) * 0.42;
    dy = (dy / len) * 0.42;
  }
  // One `sin` for the whole tile, phased by its depth so the sway travels across the hill
  // instead of every field nodding together. /* @tier-b pixels only */
  const sway = Math.sin(pen.t * 1.7 + (gx + gy) * 0.55) * 1.5;
  const color = withAlpha(ink, fade);
  for (let k = -edges; k <= edges; k++) {
    const ox = gx + 0.5 - dy * k * 0.62;
    const oy = gy + 0.5 + dx * k * 0.62;
    const a = place(pen, ox - dx, oy - dy, zPx + 7);
    seg[0] = a.x + sway;
    seg[1] = a.y;
    const b = place(pen, ox + dx, oy + dy, zPx + 7);
    seg[2] = b.x + sway;
    seg[3] = b.y;
    pen.surface.stroke(seg, 2, false, color, 2);
  }
}

/** One tile: reject it, choose its surface, hand `isoTerrain` this module's own grain, decorate. */
function tile(pen: Pen, hill: Hill, gx: number, gy: number): void {
  const cam = pen.camera;
  const view = pen.surface;
  const heights = hill.field.heights;
  corner[0] = heights.get(gx, gy);
  corner[1] = heights.get(gx + 1, gy);
  corner[2] = heights.get(gx + 1, gy + 1);
  corner[3] = heights.get(gx, gy + 1);
  const lo = Math.min(Math.min(corner[0] ?? 0, corner[1] ?? 0), Math.min(corner[2] ?? 0, corner[3] ?? 0));
  const hi = Math.max(Math.max(corner[0] ?? 0, corner[1] ?? 0), Math.max(corner[2] ?? 0, corner[3] ?? 0));
  const worldY = (gx + gy) * HALF_H;
  const yTop = cam.toScreenY(worldY - hi * STEP_PX);
  if (yTop > view.height + 4) return;
  if (cam.toScreenY(worldY + TILE_H - lo * STEP_PX) < -4) return;

  const p = pen.palette;
  const rise = hi - lo;
  const flow = channel(hill.seed, gx, gy);
  // Two terms, and the second is what makes a terraced hill look terraced. The noise is folded
  // with the terrace index so a change of crop lands *on* a wall rather than wandering across
  // one; the hash is per **level**, so whole terraces flood together and the water reads as a
  // set of long bands following the contour rather than as a lake with an irregular shore.
  const level = lo / RISE;
  const wet = noise2(hill.seed ^ 0x3f, gx * 0.045 + level * 4.7, gy * 0.045)
    + (toUnit(hash2(hill.seed ^ 0x5a1, level, 0)) < 0.3 ? 0.4 : -0.34);
  const grain = (toUnit(hash2(hill.seed, gx, gy)) - 0.5) * 0.08;
  // Cloud shadow, drifting. One noise sample per tile, and it is the largest single thing moving
  // in the opening frame — a hillside with nothing crossing it reads as a photograph of a model.
  const cloud = noise2(hill.seed ^ 0xc10, gx * 0.016 + pen.t * 0.055, gy * 0.016 - pen.t * 0.03);
  const dark = cloud > 0.16 ? (cloud - 0.16) * 0.62 : 0;

  let ink: Rgba;
  if (rise > 0) ink = mix(p.get('bank'), p.get('stone'), 0.2 + toUnit(hash2(hill.seed ^ 0x11, gx, gy)) * 0.34);
  else if (flow > 0.4) ink = p.get('chan');
  else if (wet > 0.36) ink = p.get('flood');
  else if (wet > -0.3) ink = mix(p.get('field'), p.get('ground'), clamp01(wet + 0.5));
  else ink = mix(p.get('dry'), p.get('field'), clamp01(wet + 0.6));

  const haze = clamp01((view.height * MIST_AT - yTop) / (view.height * MIST_SPAN));
  const painted = isoTerrain(
    pen,
    hill.field,
    gx,
    gy,
    haze > 0 ? mix(ink, p.get('mist'), haze * MIST_PULL) : ink,
    undefined,
    // The last two terms are the ones that are not obvious. `isoTerrain` adds its relief *after*
    // this, and on a bank the east-minus-west corner difference saturates the term, so every wall
    // is drawn at either +32% or −32% — which is exactly what makes a wall read as a wall. But a
    // wall already mixed most of the way toward a pale haze color and *then* brightened by a third
    // clips to paper, and a white lozenge in the distance reads as a hole in the picture rather
    // than as a sunlit bank. So the tint comes down with the haze, and again on the tiles that
    // will get the full swing.
    1 + grain - dark - haze * 0.18 - (rise > 0 ? 0.1 : 0),
  );
  if (haze > MIST_MUTE) return;
  const fade = 1 - haze / MIST_MUTE;

  if (rise > 0) {
    // The wall. Its lip is the whole reason a terrace reads as a step rather than as a shading
    // artifact, and it is one stroke: the crest edge, in a color that is the sky on stone rather
    // than a lightened version of the earth the wall is made of. The shadowed foot below it is a
    // second stroke and is the first thing distance takes away — it separates the wall from the
    // field under it, which is a distinction only the near band is large enough to want.
    edge(pen, hi, withAlpha(p.get('lip'), 0.8 * fade), 2);
    if (haze < 0.16) edge(pen, lo, withAlpha(shade(painted, 0.62), 0.5), 1.5);
    if (flow > 0.3) {
      // A spillway: the wall the channel crosses is a fall, and it is bright because falling
      // water is the only white on this hill. /* @tier-b pixels only */
      const churn = 0.4 + Math.sin(pen.t * 5.5 + (gx + gy) * 1.3) * 0.2;
      pen.surface.poly(pen.xy, 4, withAlpha(mix(painted, p.get('sky'), 0.7), churn * flow * fade * 0.85));
    }
    return;
  }

  const zPx = lo * STEP_PX;
  if (flow > 0.4 || wet > 0.36) {
    // Standing or running water: a sky reflection that moves. Two noise fields at different
    // scales, or the highlights line up into stripes and read as a texture rather than as water.
    const shimmer =
      noise2(hill.seed ^ 0x77, gx * 0.42 + pen.t * 0.3, gy * 0.42) * 0.5 +
      noise2(hill.seed ^ 0x35, gx * 0.9, gy * 0.9 + pen.t * 0.42) * 0.5;
    if (shimmer > 0.08) {
      pen.surface.poly(pen.xy, 4, withAlpha(mix(painted, p.get('sky'), 0.72), (shimmer - 0.08) * 0.8 * fade));
    }
    // The bund line: two edges only, at the water's own hue, so it reads as the rim of a paddy
    // rather than as a wireframe. Three points, not four, which is why it is not `isoTerrain`'s
    // `stroke` argument.
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.78), 0.34 * fade), 1);
    return;
  }
  // Three rows near, two in the middle distance, none in the mist. Rows are the single most
  // numerous thing this exhibit draws, so where they stop is where its frame time is decided.
  if (cam.zoom > 0.42) {
    crops(pen, hill, gx, gy, zPx, wet > -0.3 ? p.get('crop') : p.get('dry'), 0.72 * fade, haze < 0.2 ? 1 : 0);
  }
}

/**
 * How much air is in front of something drawn at screen `y`, 0 to 1.
 *
 * Exported because **the props have to breathe the same air**. A hillside hazed into the distance
 * with fully saturated trees and red roofs standing on it does not read as distance at all — it
 * reads as stickers on a pale background, which is what the first build of this looked like. One
 * curve, one exported function, and `props.ts` mixes its colors by it.
 */
export function hazeAt(pen: Pen, y: number): number {
  return clamp01((pen.surface.height * MIST_AT - y) / (pen.surface.height * MIST_SPAN)) * MIST_PULL;
}

/** The visible world box, refilled each frame. Module scope so the pass allocates nothing. */
const world: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * The Terrain pass — walked in **depth space**, which is the cull.
 *
 * `renderFrame` hands over `visible`, a tile *box* margined by `Passes.maxHeightPx` because a
 * summit's base can be off the bottom of the frame while the summit is on it. That margin is
 * correct and it is applied to **both axes of a box**, so on terrain 1,470 px tall it measured
 * 26,569 tiles for a frame that paints 1,201. Iterating it costs more than painting the hill.
 *
 * So this walks `u = gx + gy` — the depth axis — and `v = gx - gy` instead. Elevation moves a tile
 * along `u` alone, so the margin is needed on `u` alone; `v` is bounded by the frame's width and
 * nothing else. Same coverage, **3,081 visits**, and `visible` is still what clamps the walk to
 * the map so the two culls cannot disagree about the edge.
 *
 * It buys a second thing for free: `u` **is** the depth key, so ascending `u` paints strictly far
 * to near. `TileGrid.forEach` walks row-major, which is only accidentally depth order and stops
 * being it the moment terrain has height.
 */
export function paintHill(pen: Pen, hill: Hill, visible: Readonly<TileRange>): void {
  pen.camera.visibleWorldBounds(world, TILE_W);
  const x0 = Math.max(0, visible.gx0), x1 = Math.min(W, visible.gx1);
  const y0 = Math.max(0, visible.gy0), y1 = Math.min(H, visible.gy1);
  if (x1 <= x0 || y1 <= y0) return;
  const uLo = Math.max(x0 + y0, Math.floor(world.minY / HALF_H) - 1);
  const uHi = Math.min(x1 + y1 - 2, Math.ceil((world.maxY + hill.maxHeightPx) / HALF_H) + 1);
  const vLo = Math.floor(world.minX / HALF_W) - 1, vHi = Math.ceil(world.maxX / HALF_W) + 1;
  for (let u = uLo; u <= uHi; u++) {
    const vMax = Math.min(vHi, 2 * (x1 - 1) - u, u - 2 * y0);
    // `v` shares `u`'s parity or `(u + v) / 2` is not a tile. Bitwise `&` is exact on negatives.
    let v = Math.max(vLo, 2 * x0 - u, u - 2 * (y1 - 1));
    if (((v - u) & 1) !== 0) v++;
    for (; v <= vMax; v += 2) tile(pen, hill, (u + v) / 2, (u - v) / 2);
  }
}

/**
 * The air: one ramp down the top of the frame, and a few birds in it.
 *
 * The per-tile haze already desaturates the far terraces; this is the second half of the same
 * effect and it is what stops the band reading as *pale ground* instead of as *distance* — a
 * gradient that is in front of everything, including the props, and that the terrain cannot
 * poke through.
 */
export function drawAir(pen: Pen): void {
  const w = pen.surface.width;
  const h = pen.surface.height * MIST_AT;
  band[0] = 0;
  band[1] = 0;
  band[2] = w;
  band[3] = 0;
  band[4] = w;
  band[5] = h;
  band[6] = 0;
  band[7] = h;
  const mist = pen.palette.get('mist');
  pen.surface.polyRamp(band, 4, 0, 0, 0, h, withAlpha(mist, 0.55), withAlpha(mist, 0));
  for (let i = 0; i < 7; i++) {
    // Closed form, so a bird is where the clock says and nothing about it is stored.
    // /* @tier-b pixels only */
    const t = pen.t * 0.055 + i * 0.37;
    const x = ((t % 1) * (w + 160) - 80) * (i % 2 === 0 ? 1 : -1) + (i % 2 === 0 ? 0 : w);
    const y = h * (0.24 + 0.5 * ((i * 0.29) % 1)) + Math.sin(pen.t * 1.4 + i) * 5;
    const beat = Math.sin(pen.t * 9 + i * 2.1) * 3.4;
    seg[0] = x - 5;
    seg[1] = y + beat;
    seg[2] = x;
    seg[3] = y;
    pen.surface.stroke(seg, 2, false, withAlpha(pen.palette.get('ink'), 0.34), 1.4);
    seg[0] = x + 5;
    seg[1] = y + beat;
    pen.surface.stroke(seg, 2, false, withAlpha(pen.palette.get('ink'), 0.34), 1.4);
  }
}
