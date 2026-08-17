/**
 * The ground: four climates, a coastline, and the three distance bands.
 *
 * @art
 *
 * Delete this file and `Endless` is an unpainted heightfield that still streams, still evicts,
 * still fingerprints and still comes back identical. Everything here decides what a tile *looks*
 * like; `chunks.ts` decides what a tile *is*, and nothing in this module writes to it.
 *
 * ## Depth is the composition, and it is one subtraction
 *
 * `gx + gy` maps to screen y alone in a 2:1 projection, so a tile's distance from the camera is
 * `(gx + gy) − dCam` and nothing else — no square roots, no per-tile projection, no second pass.
 * That single number does four jobs here: it culls, it hazes, it decides whether a tile is worth
 * a surf line, and it *is* the horizon. § Scale asks for three distance bands; they are three
 * intervals of that one subtraction, and the whole cost of having them is the `mix` below.
 *
 * ## Why the shoreline is a contour and not a terrain class
 *
 * Elevation arrives signed and continuous, so the waterline is `e === 0` and the beach is a band
 * either side of it. Nothing has to compare a tile to its neighbors — which matters far more here
 * than on a bounded island, because a neighbor comparison across a chunk edge is a read into a
 * chunk that may not be resident. The exhibit would have acquired a seam that appears only under
 * memory pressure and only on the frames a visitor is panning fastest.
 *
 * ## One `shade`, and everything else through `tint`
 *
 * `isoTerrain` folds the relief term and the game's own texture into one `shade` call, because
 * `shade` pulls toward a cool or a warm tint by distance from neutral: shading twice tints twice
 * and the ground goes muddy. Every per-tile variation here — two scales of grain, the moisture
 * that separates meadow from wood, the wet sand at the waterline — is a multiplier handed in as
 * `tint`, and the only second passes are ones that read the color `isoTerrain` returned.
 */
import { clamp01, hash2, noise2, toUnit } from '@lattice/core';
import { HALF_H, type TileRange } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Pen, type Rgba } from '@lattice/draw';
import { BIAS, cell, dFar, dNear, field, sMax, sMin, seed } from './chunks.js';

/** Biome ordinal → ground slot, in `chunks.ts`'s order: taiga, temperate, arid, jungle. */
const GROUND: readonly string[] = ['taiga', 'leaf', 'dune', 'jungle'];

/** How far up the beach the surf reaches at full swell, in height units. */
const REACH = 0.9;

/**
 * Where the aerial haze begins, as a `gx + gy`.
 *
 * Derived from the window rather than stored in it, because it is an art decision and nothing in
 * `chunks.ts` should have to hold one. The far 30% of the visible depth dissolves; less and the
 * horizon arrives as an edge, more and the mid band loses its color.
 */
export function hazeFrom(): number {
  return dFar + (dNear - dFar) * 0.36;
}

/**
 * The Terrain pass, in one call.
 *
 * The walk is here rather than in `main.ts` because the two culling comparisons per tile *are*
 * the composition — they are what puts a horizon in a projection that has none — and reading them
 * beside the color they gate is the only way either half makes sense.
 */
export function paintGround(pen: Pen, visible: Readonly<TileRange>): void {
  const start = hazeFrom();
  const span = start - dFar;
  for (let gy = visible.gy0; gy < visible.gy1; gy++) {
    for (let gx = visible.gx0; gx < visible.gx1; gx++) {
      const d = gx + gy;
      // The exact screen-space cull, as two comparisons on the two axes the projection has. The
      // `visible` range `renderFrame` computes is a *box* around a diamond and over-covers by
      // roughly 2×; four comparisons buy back the half of it that is off screen, which at the
      // zoom-out limit is five thousand tiles a frame.
      if (d < dFar || d > dNear) continue;
      const s = gx - gy;
      if (s < sMin || s > sMax) continue;
      tile(pen, gx, gy, clamp01((start - d) / span));
    }
  }
}

/** One tile: choose the surface, hand `isoTerrain` this exhibit's own grain, then decorate. */
function tile(pen: Pen, gx: number, gy: number, far: number): void {
  const word = cell(gx, gy);
  const e =
    ((word & 255) +
      (cell(gx + 1, gy) & 255) +
      (cell(gx + 1, gy + 1) & 255) +
      (cell(gx, gy + 1) & 255)) /
      4 -
    BIAS;
  // Smoothstep on the haze, not a linear ramp: linear leaves a visible rim where the fade starts,
  // which reads as a ring of weather following the camera around.
  const haze = far * far * (3 - 2 * far);
  // Two scales of grain. One alone paints the world in enormous soft zones the eye reads as a
  // lighting bug rather than as ground; the second is what makes it a texture.
  //
  // **Both are skipped past half-haze**, along with the moisture field and the depth dither below.
  // § Scale asks the far band to be dimmer and hazier, which is also permission for it to be
  // cheaper: a texture 60% of the way to one flat color is a texture nobody can resolve, and this
  // is a third of the tiles in the frame carrying three noise samples each.
  const dim = haze > 0.5;
  const grain = dim ? 0 : (toUnit(hash2(seed, gx, gy)) - 0.5) * 0.09 + noise2(seed ^ 0x9e1, gx * 0.17, gy * 0.17) * 0.08;

  let ink: Rgba;
  let tint = 1 + grain;
  if (e < 0) {
    // Depth as color, dithered before the divide. Elevation is stored as a whole number of units
    // per vertex, so a straight `−e / span` steps once per unit and the shallows come out as
    // concentric contour rings — the exact staircase a five-constant terrain grid would have
    // given, reintroduced by the quantization one level down.
    const depth = clamp01((-e + (dim ? 0 : noise2(seed ^ 0x1d3, gx * 0.55, gy * 0.55) * 2.2)) / 16);
    ink = mix(pen.palette.get('shoal'), pen.palette.get('deep'), depth * depth * 0.8 + depth * 0.2);
    tint = 1 + grain * 0.5;
  } else {
    const biome = word >> 8;
    const green = pen.palette.get(GROUND[biome] ?? 'ground');
    // Moisture is a blend and never a branch: a threshold draws its own contour line across the
    // hillside, the line moves with the seed, and no single number is ever right for it.
    const damp = dim ? 0.5 : clamp01(noise2(seed ^ 0x4d1, gx * 0.06, gy * 0.06) * 0.7 + 0.5);
    const lush = mix(shade(green, 0.86), mix(green, pen.palette.get('ok'), 0.35), damp);
    const shore = clamp01((2.6 - e) / 2.6);
    const beach = mix(lush, pen.palette.get('sand'), shore * (biome === 2 ? 0.95 : 0.85));
    // Two added ramps rather than two thresholds: bare stone above the treeline, and a permanent
    // wash of it in dry country, summed so neither produces an edge of its own.
    const bare = clamp01((e - 30) / 13) * 0.85 + (biome === 2 ? 0.12 : 0);
    ink = bare <= 0 ? beach : mix(beach, pen.palette.get('rock'), clamp01(bare));
  }
  const painted = isoTerrain(pen, field, gx, gy, mix(ink, pen.palette.get('haze'), haze), undefined, tint);
  if (haze > 0.45) return;
  const near = 1 - haze / 0.45;
  surf(pen, gx, gy, e, near);
  // The hairline fold: three points, not four, so it reads as a crease in the ground rather than
  // as a wireframe — and only near, and only zoomed in, because at distance it is aliasing.
  if (pen.camera.zoom > 0.55 && near > 0.8 && e > 0) {
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.9), 0.26 * near), 1);
  }
}

/**
 * The surf, drawn over both surfaces because a wave does not care how a tile was classified —
 * which is the whole point of running the shoreline off one continuous number that both read.
 *
 * The swell travels along `gx + gy`, the depth axis, so it arrives up the screen instead of the
 * entire world's coastline pulsing in unison. That is the tell that gives away every
 * animated-in-place shoreline, and it is one term in the phase.
 */
function surf(pen: Pen, gx: number, gy: number, e: number, near: number): void {
  // The elevation reject comes *before* the swell, because `Math.sin` per tile per frame over the
  // whole frame is a transcendental call for two thousand tiles that are nowhere near the water.
  if (e < -1.7 || e > 1.7) return;
  const reach = -0.35 + (Math.sin(pen.t * 0.8 + (gx + gy) * 0.17) * 0.5 + 0.5) * REACH; /* @tier-b pixels only */
  const d = Math.abs(e - reach);
  if (d > 1.3) return;
  const band = 1 - d / 1.3;
  // Squared on the dry side, halved on the wet: the band gets a direction, and the wave looks like
  // it is running *up* the sand rather than pulsing symmetrically about the waterline.
  const lead = e > reach ? band * band : band * 0.5;
  pen.surface.poly(pen.xy, 4, withAlpha(pen.palette.get('foam'), lead * 0.7 * near));
  if (lead > 0.45) {
    pen.surface.stroke(pen.xy, 3, false, withAlpha(pen.palette.get('foam'), (lead - 0.45) * 1.6 * near), 1.6);
  }
}

/**
 * The horizon: the last of the dissolve, painted along the cut in the Overlay pass so that it
 * washes the trees as well as the ground.
 *
 * The far tiles have already been mixed most of the way to `haze` by the time they stop, but a
 * sprite has no distance term of its own — `drawSprite` takes palette colors and no alpha — so
 * without this the last row of trees stands at full saturation on a bleached horizon. It also
 * hides the sawtooth a diamond lattice leaves along a straight cut, which is visible at any zoom
 * above about 1.2 and is the one artifact that would give away that the world *ends* there.
 */
export function drawHaze(pen: Pen): void {
  const top = pen.camera.toScreenY(dFar * HALF_H);
  const bottom = pen.camera.toScreenY(hazeFrom() * HALF_H);
  const haze = pen.palette.get('haze');
  const xy = pen.xy;
  xy[0] = 0;
  xy[1] = top - 80;
  xy[2] = pen.surface.width;
  xy[3] = top - 80;
  xy[4] = pen.surface.width;
  xy[5] = bottom;
  xy[6] = 0;
  xy[7] = bottom;
  pen.surface.polyRamp(xy, 4, 0, top - 80, 0, bottom, withAlpha(haze, 0.94), withAlpha(haze, 0));
}
