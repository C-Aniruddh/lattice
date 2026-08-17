/**
 * The backdrop and the ground: sky, the city that is not modeled, and the streets between the
 * blocks.
 *
 * @art
 *
 * One rule runs through all three: **a flat fill is the clearest tell of a tech demo.** The sky is
 * a ramp with a warm band where the sun went and stars coming out above it; the horizon is three
 * bands of city receding into the haze; the asphalt is a per-tile grain with lane markings,
 * crosswalks and manholes on it. Not one of those costs a decision, and together they are the
 * difference between a city and a diagram of one.
 *
 * The streets are drawn in the Terrain pass and the sidewalk platforms after them. That order is
 * load-bearing: a platform is a 0.1-storey box whose near face has to paint *over* the road tile
 * in front of it, which is what makes a curb look like a step down rather than like a change of
 * color.
 */
import { hash2, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen, type TileRange } from '@lattice/iso';
import { isoBox, isoPatch, isoTile, mix, shade, withAlpha, type Pen } from '@lattice/draw';
import { BLOCK, BLOCKS, CURB, PERIOD, STREET, W } from './city.js';
import { snap } from './palette.js';

/** Is this tile carriageway? The streets are the two-tile gutters between the blocks — and this
 *  is art rather than map, because the only question anything in this exhibit asks of it is what
 *  color to paint a tile. Placement is arithmetic on a block origin and never asks. */
function isRoad(gx: number, gy: number): boolean {
  return gx % PERIOD < STREET || gy % PERIOD < STREET;
}

/** A junction: a road tile with no lane markings, because two sets of them would cross. */
function isCross(gx: number, gy: number): boolean {
  return gx % PERIOD < STREET && gy % PERIOD < STREET;
}

/** One distance band: how fast it moves, where it stands, and how far the air has taken it. */
interface Band {
  /** Fraction of the camera's motion the band takes. 1 is nailed to the map, 0 is painted on the
   *  screen. The near band is 1 **on purpose** — it is the next neighborhood, not a backdrop. */
  readonly p: number;
  /** World pixels its base sits above the map's far corner, before zoom. */
  readonly lift: number;
  /** How far toward the sky its masses are mixed. This is aerial perspective and it is the whole
   *  reason three bands read as distance rather than as three fences. */
  readonly haze: number;
  /** Pixels between tower centers, and the tallest tower, before zoom. */
  readonly step: number;
  readonly tall: number;
  /** How fast the band's base falls away from its apex. The near band's is exactly the isometric
   *  edge slope — `HALF_H / HALF_W` — so its towers stand on the map's own far edges instead of
   *  hovering above them in a strip. */
  readonly slope: number;
  /** Fraction of window cells that are lit. Zero draws none at all. */
  readonly lit: number;
}

/**
 * Near, mid, far — and the far one is desaturated toward the sky and moves at a third of the map's
 * speed.
 *
 * The version this replaces was **two ranks of flat rectangles on a horizontal line**, and the
 * line was the problem: the map is a diamond, so a straight strip behind it left a wedge of empty
 * sky between the map's sloping edge and the strip's flat bottom on both sides, and the eye read
 * the whole thing as a pasted image rather than as distance. Every band here is a **V** with its
 * apex on the map's far corner, so the drawn city and the implied one share an edge, and each band
 * fills solid below its own base so no sky can show through between them.
 */
const BANDS: readonly Band[] = [
  { p: 1, lift: 0, haze: 0.2, step: 44, tall: 230, slope: 0.5, lit: 0.2 },
  { p: 0.6, lift: 30, haze: 0.46, step: 60, tall: 176, slope: 0.34, lit: 0.1 },
  { p: 0.3, lift: 66, haze: 0.72, step: 82, tall: 128, slope: 0.2, lit: 0 },
];

const corner: Vec2 = { x: 0, y: 0 };

/** An axis-aligned rectangle through the pen's own scratch array. Four writes and one call. */
function rect(pen: Pen, x: number, y: number, w: number, h: number, color: number): void {
  const xy = pen.xy;
  xy[0] = x;
  xy[1] = y;
  xy[2] = x + w;
  xy[3] = y;
  xy[4] = x + w;
  xy[5] = y + h;
  xy[6] = x;
  xy[7] = y + h;
  pen.surface.poly(xy, 4, color);
}

/**
 * The sky: a ramp, a warm band at the horizon, stars, and a moon.
 *
 * The ramp is drawn from the *zenith* color rather than the palette's `sky` directly, so that
 * the one slot the palette moves furthest carries both ends of the gradient and cannot drift out
 * of tune with the buildings standing against it.
 */
export function drawSky(pen: Pen, hour: number, seed: number): void {
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
  const zenith = shade(sky, 0.34);
  const horizon = mix(sky, pen.palette.get('warn'), 0.3 - hour * 0.2);
  // The ramp lands on the horizon line rather than on the bottom of the screen. The frame's
  // horizon is now about a quarter of the way down — everything under it is city — so a gradient
  // that took until `h * 0.92` to reach its warm end spent that end entirely underneath the map.
  s.polyRamp(xy, 4, 0, 0, 0, h * 0.34, zenith, horizon);

  // Stars come out as the hour goes, and they twinkle on noise rather than on a sine, so no two
  // are ever in step.
  const alpha = hour * 0.9 + 0.1;
  for (let i = 0; i < 130; i++) {
    const sx = toUnit(hash2(0x51a2, i, 1)) * w;
    const sy = toUnit(hash2(0x51a2, i, 2)) * h * 0.34;
    const twinkle = 0.35 + 0.65 * (noise2(0x51a2, i * 0.7, pen.t * 0.35) * 0.5 + 0.5);
    s.ellipse(sx, sy, 0.8 + twinkle * 0.7, 0.8 + twinkle * 0.7, withAlpha(0xf4f7ffff, alpha * twinkle * 0.75));
  }

  // The moon, high and small, with one bite out of it. It is the only cool light source in the
  // scene and it is what stops the whole frame reading as orange.
  const mx = w * (0.16 + toUnit(hash2(seed, 7, 7)) * 0.14);
  const my = h * 0.16;
  const face = 0xdfe7f7ff;
  s.softEllipse(mx, my, 54, 54, withAlpha(face, 0.16), withAlpha(face, 0));
  s.ellipse(mx, my, 13, 13, withAlpha(face, 0.95));
  s.ellipse(mx + 5.5, my - 4, 11, 11, zenith);

  // Two ribbons of cloud, lit from underneath by the city. They drift, slowly.
  for (let i = 0; i < 3; i++) {
    const drift = ((pen.t * 0.004 + i * 0.37) % 1.4) - 0.2;
    const cy = h * (0.2 + i * 0.09);
    const lit = mix(sky, pen.palette.get('warn'), 0.3 - i * 0.08);
    s.softEllipse(drift * w, cy, w * 0.22, h * 0.03, withAlpha(lit, snap(0.22 - hour * 0.1)), withAlpha(lit, 0));
  }
}

/**
 * The rest of the city — the part that is not modeled.
 *
 * Three bands standing on the map's own far edges, each hazier, slower and shorter than the one in
 * front of it. It is the cheapest depth cue there is and it does the one thing no amount of work
 * on the map itself can: it makes the forty-nine blocks a visitor *can* pan around a piece of
 * somewhere very much bigger.
 *
 * Drawn back to front, because each band paints solid below its own base and the near one has to
 * win. The map is drawn over all three, so a band's fill may run as far down the screen as it
 * likes and never be seen doing it.
 */
export function drawDistance(pen: Pen, seed: number, hour: number): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const k = pen.camera.zoom;
  const night = pen.palette.get('night');
  const sky = pen.palette.get('sky');
  const warm = pen.palette.get('warn');
  // The map's far corner, in screen pixels. Every band's apex is this point, pulled toward the
  // center of the screen by however much of the camera's motion that band declines to take.
  gridToScreen(pen.camera, 0, 0, 0, corner);
  const cx = corner.x + pen.snapX;
  const cy = corner.y + pen.snapY;

  for (let b = BANDS.length - 1; b >= 0; b--) {
    const band = BANDS[b];
    if (band === undefined) continue;
    const apexX = w * 0.5 + (cx - w * 0.5) * band.p;
    const apexY = h * 0.5 + (cy - h * 0.5) * band.p - band.lift * k;
    if (apexY > h) continue;
    const step = band.step * k;
    const body = mix(night, sky, band.haze);
    const first = Math.floor(-(apexX + step) / step);
    const last = Math.ceil((w + step - apexX) / step);
    for (let i = first; i <= last; i++) {
      const id = i + b * 977;
      const x = apexX + i * step;
      // The V. `slope` is the isometric edge slope for the near band, so its feet sit exactly on
      // the map's silhouette rather than on a flat line ruled behind it.
      const base = apexY + Math.abs(x - apexX) * band.slope;
      if (base < -240) continue;
      // The band's own ground, solid from its base to well below the frame. This is what closes
      // the wedge of sky the old flat strip left beside the map.
      rect(pen, x - step * 0.51, base, step * 1.02 + 1, h + 200 - base, body);
      if (base > h + 40) continue;

      const r1 = toUnit(hash2(seed ^ 0x5b1, id, 1));
      const r2 = toUnit(hash2(seed ^ 0x5b1, id, 2));
      const bw = step * (0.44 + r1 * 0.44);
      // Squared, so most towers are low and a few are landmarks. A flat distribution gives a
      // horizon of identical stumps, which is the other way to look generated.
      const bh = (0.18 + r2 * r2 * 0.82) * band.tall * k;
      const x0 = x - bw * 0.5;
      const top = base - bh;
      rect(pen, x0, top, bw, bh + 2, body);
      // A setback on anything worth calling a tower, and a mast on a few of those. Same three
      // rules as the modeled buildings — silhouette, then rhythm, then a thin thing on top.
      if (bh > band.tall * k * 0.4) {
        const sw = bw * (0.4 + r1 * 0.22);
        rect(pen, x - sw * 0.5, top - bh * 0.15, sw, bh * 0.15 + 2, body);
        if (r2 > 0.82) rect(pen, x - Math.max(0.5, k * 0.6), top - bh * 0.26, Math.max(1, k * 1.2), bh * 0.12, body);
      }
      if (band.lit === 0) continue;
      // Windows: a scatter, and the whole reason the band reads as a city rather than as terrain.
      const rows = Math.max(1, Math.floor(bh / (10 * k)));
      const cols = Math.max(1, Math.floor(bw / (8 * k)));
      const glow = withAlpha(warm, (b === 0 ? 0.46 : 0.3) * (0.55 + hour * 0.45));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (toUnit(hash2(id ^ seed, r, c)) > band.lit) continue;
          s.ellipse(x0 + (c + 0.5) * (bw / cols), top + (r + 0.55) * (bh / rows), 1.1 * k, 1.1 * k, glow);
        }
      }
      // An aircraft warning light on the near band's landmarks, blinking out of step with the
      // modeled ones. Two of them across the horizon is all it takes to say *inhabited*.
      if (b === 0 && bh > band.tall * k * 0.74 && (pen.t * 0.5 + toUnit(hash2(seed, id, 3))) % 1 < 0.14) {
        s.ellipse(x, top - bh * 0.16, 1.6 * k, 1.6 * k, withAlpha(pen.palette.get('bad'), 0.85));
      }
    }
  }
}

/**
 * A dash, a stripe, a manhole — everything painted on the road, at the tile that owns it.
 *
 * **Gated on zoom, because this is the terrain pass's entire cost.** A crosswalk is four patches
 * and there are two of them at every junction mouth on the map; at the opening zoom the whole set
 * is nine pixels of pale grey inside a tile a visitor is not looking at, and there are two
 * thousand road tiles in the frame. Pulled in, they are worth every one of those patches.
 */
function markings(pen: Pen, gx: number, gy: number, road: number, k: number): void {
  const ax = gx % PERIOD;
  const ay = gy % PERIOD;
  const paint = withAlpha(mix(pen.palette.get('curb'), pen.palette.get('warn'), 0.35), 0.7);
  const alongX = ay < STREET && ax >= STREET;
  const alongY = ax < STREET && ay >= STREET;
  // The center line runs between the two lanes, so it is drawn on the far edge of lane 0.
  if (alongX && ay === 0 && ax % 2 === 0) isoPatch(pen, gx + 0.22, gy + 0.96, 0.56, 0.08, 0.02, paint);
  if (alongY && ax === 0 && ay % 2 === 0) isoPatch(pen, gx + 0.96, gy + 0.22, 0.08, 0.56, 0.02, paint);
  // Crosswalks at the mouth of every junction: four stripes across the carriageway.
  const mouth = ax === STREET || ax === PERIOD - 1;
  const mouthY = ay === STREET || ay === PERIOD - 1;
  if (alongX && mouth && k > 0.85) {
    for (let i = 0; i < 4; i++) isoPatch(pen, gx + 0.11 + i * 0.22, gy + 0.02, 0.1, 0.96, 0.02, paint);
  }
  if (alongY && mouthY && k > 0.85) {
    for (let i = 0; i < 4; i++) isoPatch(pen, gx + 0.02, gy + 0.11 + i * 0.22, 0.96, 0.1, 0.02, paint);
  }
  // A manhole, a patched repair, a drain. Three tiles in a hundred, and the eye notices.
  if (k < 0.85) return;
  const r = toUnit(hash2(0x30ad, gx, gy));
  if (r > 0.96) isoPatch(pen, gx + 0.34, gy + 0.34, 0.32, 0.32, 0.02, shade(road, 0.82));
  else if (r > 0.92) isoPatch(pen, gx + 0.1, gy + 0.16, 0.5, 0.42, 0.02, shade(road, 1.08));
}

/**
 * The streets, and the sidewalk platforms the blocks stand on.
 *
 * `visible` is the culled tile range `renderFrame` already computed, clamped here to the map. The
 * platforms are drawn per block rather than per tile — nine boxes instead of two hundred and
 * twenty-five — and they are the reason every building in this exhibit is handed a base of
 * `CURB_PX` rather than zero.
 */
export function drawStreets(pen: Pen, seed: number, visible: Readonly<TileRange>): void {
  const road = pen.palette.get('road');
  const k = pen.camera.zoom;
  const gy0 = Math.max(0, visible.gy0);
  const gy1 = Math.min(W, visible.gy1);
  const gx0 = Math.max(0, visible.gx0);
  const gx1 = Math.min(W, visible.gx1);
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      if (!isRoad(gx, gy)) continue;
      const grain = (toUnit(hash2(seed, gx, gy)) - 0.5) * 0.12;
      const wear = noise2(seed ^ 0x2c, gx * 0.3, gy * 0.3) * 0.06;
      const tone = shade(road, 1 + grain + wear);
      isoTile(pen, gx, gy, tone, shade(tone, 0.93));
      if (!isCross(gx, gy)) markings(pen, gx, gy, road, k);
    }
  }

  const curb = pen.palette.get('curb');
  const paving = shade(curb, 0.9);
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      const ox = STREET + bx * PERIOD - 0.06;
      const oy = STREET + by * PERIOD - 0.06;
      const span = BLOCK + 0.12;
      isoBox(pen, ox, oy, span, span, { color: curb, h: CURB });
      isoPatch(pen, ox + 0.1, oy + 0.1, span - 0.2, span - 0.2, CURB + 0.002, paving);
      // Paving joints: a hairline every other tile, which is all it takes for a flat concrete
      // plane to stop looking like a flat concrete plane.
      if (k > 0.85) {
        for (let i = 1; i < BLOCK; i += 2) {
          isoPatch(pen, ox + i, oy + 0.1, 0.03, span - 0.2, CURB + 0.004, withAlpha(shade(curb, 0.78), 0.5));
        }
      }
    }
  }
}
