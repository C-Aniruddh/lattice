/**
 * @art
 *
 * The sky, the lagoon, the paving, and the worn tracks the crowd walks in.
 *
 * One rule decides all four: **a flat fill is the clearest tell of a tech demo.** The backdrop is
 * a ramp with a low sun and three haze bands; the water is a plane with a swell drifting across
 * it; the paving is a relief term plus concentric wear bands plus two scales of seeded grain plus
 * a hairline seam.
 *
 * ## The tracks are the exhibit, drawn
 *
 * `drawTracks` strokes each of the eight `Path`s the crowd is sampled along, as worn stone. It is
 * the only place the *domain* of `pathSample` is visible, and it is worth the three strokes it
 * costs: a visitor watching nine hundred people follow eight loops they can also see is being shown
 * the whole mechanism, without a word of explanation. It also makes the one thing that could go
 * wrong obvious — a walker off its track would be off a line you can point at.
 *
 * Water tiles are **not drawn**. The lagoon is one plane under everything, so painting a diamond
 * per water tile on top of it would be several hundred fills a frame to reproduce a color that is
 * already there. What is drawn is the metre of water that touches stone, which is the only part
 * of a lagoon anybody looks at.
 */
import { hash2, noise2, toUnit } from '@lattice/core';
import { gridToScreen, heightAt, type TileRange } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@lattice/draw';
import { PAVE, PC, WATER, isle, type Plaza } from './plaza.js';

const pt = { x: 0, y: 0 };

/**
 * One terrain tile.
 *
 * `isoTerrain` folds the four corner heights and the relief term into one call and returns the
 * color it resolved, so the hairline seam below costs no projection at all — the corners are
 * still in `pen.xy` where it left them.
 */
export function groundTile(pen: Pen, p: Plaza, gx: number, gy: number): void {
  const kind = p.kind.get(gx, gy);
  if (kind === WATER) {
    shoreline(pen, p, gx, gy);
    return;
  }
  const dp = isle(gx + 0.5 - PC, gy + 0.5 - PC);
  // Concentric wear rings around the fountain, on the island's own squashed metric so they stay
  // parallel to the waterfront: the paving pattern of every real piazza, and the thing that tells
  // the eye where the centre of the composition is before it finds the fountain.
  const ring = (dp * 0.34) % 1 < 0.5 ? 0.05 : -0.035;
  const grain = (toUnit(hash2(p.seed, gx, gy)) - 0.5) * 0.1;
  const drift = noise2(p.seed ^ 0x9e1, gx * 0.14, gy * 0.14) * 0.07;
  const ink: Ink = kind === PAVE ? 'ground' : 'metal';
  const base = isoTerrain(pen, p.field, gx, gy, ink, undefined, 1 + ring + grain + drift);
  // Two edges only, at the tile's own hue: a seam in the paving rather than a drawn grid — and
  // only once somebody has zoomed in far enough to read it. At the opening frame there are 1,300
  // tiles on screen and the seam is 1.3 ms of the budget for a hairline nobody can resolve, which
  // is `docs/GALLERY.md` § The cost row's third bullet in one `if`.
  if (pen.camera.zoom > 1.25) pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(base, 0.85), 0.4), 1);
}

/** The strip of water that touches stone. Four lookups, and only for a tile that has water in it. */
function shoreline(pen: Pen, p: Plaza, gx: number, gy: number): void {
  const near =
    p.kind.get(gx + 1, gy) !== WATER ||
    p.kind.get(gx - 1, gy) !== WATER ||
    p.kind.get(gx, gy + 1) !== WATER ||
    p.kind.get(gx, gy - 1) !== WATER;
  if (!near) return;
  const swell = noise2(p.seed ^ 0x33, gx * 0.4 + pen.t * 0.3, gy * 0.4) * 0.5 + 0.5;
  const foam = mix(pen.palette.get('glass'), 0xffffffff, 0.34 + swell * 0.22);
  isoTerrain(pen, p.field, gx, gy, withAlpha(foam, 0.42 + swell * 0.2));
}

/** The lagoon: one plane far past the map's edge, and a slow swell drifting across it. */
export function drawLagoon(pen: Pen, seed: number): void {
  const s = pen.surface;
  const deep = mix(pen.palette.get('glass'), pen.palette.get('ink'), 0.42);
  const R = 150;
  quad(pen, -R, -R, R, -R, R, R, -R, R);
  s.poly(pen.xy, 4, deep);
  const sheen = mix(deep, pen.palette.get('warn'), 0.5);
  for (let i = 0; i < 12; i++) {
    const off = ((i / 12 + pen.t * 0.008) % 1) * 260 - 130;
    const w = 4 + noise2(seed, i, 0) * 7;
    quad(pen, -R, off, R, off + w * 0.25, R, off + w, -R, off + w * 0.75);
    s.poly(pen.xy, 4, withAlpha(sheen, 0.055));
  }
}

/** Four grid corners into `pen.xy`, on the ground plane. */
function quad(pen: Pen, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
  const xs = [ax, bx, cx, dx];
  const ys = [ay, by, cy, dy];
  for (let i = 0; i < 4; i++) {
    gridToScreen(pen.camera, xs[i] ?? 0, ys[i] ?? 0, 0, pt);
    pen.xy[i * 2] = pt.x;
    pen.xy[i * 2 + 1] = pt.y;
  }
}

/**
 * The city across the water — the exhibit's **far** distance band.
 *
 * Anchored in world space rather than to the viewport, so it parallaxes when the piazza is dragged
 * and sits still when it is not, which is the only difference between a horizon and a wallpaper.
 * Two rows: a pale one for the distance and a slightly darker one in front of it, because a single
 * row of towers at one tone is a cardboard cut-out no matter how many towers are in it.
 *
 * Drawn in the Terrain pass, before a single tile: everything that follows paints over it, so the
 * strip only ever survives where the island is not — which is the ribbon of lagoon along the top of
 * the frame, and nowhere else.
 */
const SHORE_Y = 470;

export function drawFarShore(pen: Pen): void {
  const s = pen.surface;
  const cam = pen.camera;
  const k = cam.zoom;
  const ink = pen.palette.get('ink');
  const bank = mix(pen.palette.get('sky'), ink, 0.5);
  for (let row = 0; row < 2; row++) {
    const y = cam.toScreenY(SHORE_Y - row * 90) + pen.snapY;
    const tone = withAlpha(mix(pen.palette.get('sky'), ink, 0.3 + row * 0.26), 0.85);
    for (let j = 0; j < 72; j++) {
      const wx = (j - 36) * 126 + row * 60;
      const x = cam.toScreenX(wx) + pen.snapX;
      if (x < -60 || x > s.width + 60) continue;
      const seed = 0x51d + row * 7;
      const w = (40 + toUnit(hash2(seed, j, 1)) * 46) * k;
      const h = (18 + toUnit(hash2(seed, j, 2)) * 74) * k * (row === 0 ? 0.72 : 1);
      quadPx(pen, x, y - h, x + w, y - h, x + w, y + 26 * k, x, y + 26 * k);
      s.poly(pen.xy, 4, tone);
      // A campanile every eleventh block, which is what stops a skyline reading as a bar chart.
      if (j % 11 !== row * 5) continue;
      const tw = w * 0.3;
      quadPx(pen, x + tw, y - h * 2.1, x + tw * 2, y - h * 2.1, x + tw * 2, y - h, x + tw, y - h);
      s.poly(pen.xy, 4, tone);
    }
    s.softEllipse(s.width * 0.5, y + 26 * k, s.width * 0.55, 26 * k, withAlpha(bank, 0.5), withAlpha(bank, 0));
  }
}

/** Four screen points into `pen.xy`. The skyline is the one thing here that is not on the grid. */
function quadPx(pen: Pen, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
  pen.xy[0] = ax; pen.xy[1] = ay; pen.xy[2] = bx; pen.xy[3] = by;
  pen.xy[4] = cx; pen.xy[5] = cy; pen.xy[6] = dx; pen.xy[7] = dy;
}

/**
 * The eight loops, as worn stone.
 *
 * Three strokes per route — a dark bed, the worn track, and a bright centre line that dashes with
 * time so the loop reads as having a *direction*. That last one is doing real work: a promenade
 * whose two lanes run opposite ways is what turns a ring of people into a crowd, and the dashes
 * are what let a visitor see it in the first second rather than the tenth.
 */
export function drawTracks(pen: Pen, p: Plaza): void {
  const worn = mix(pen.palette.get('ground'), pen.palette.get('ink'), 0.26);
  const k = pen.camera.zoom;
  const s = pen.surface;
  for (let r = 0; r < p.routes.length; r++) {
    const route = p.routes[r];
    if (route === undefined) continue;
    const n = route.nodeCount;
    for (let i = 0; i < n; i++) {
      const gx = route.gxAt(i);
      const gy = route.gyAt(i);
      gridToScreen(pen.camera, gx, gy, heightAt(p.field, gx, gy) + 1.5, pt);
      pen.xy[i * 2] = pt.x + pen.snapX;
      pen.xy[i * 2 + 1] = pt.y + pen.snapY;
    }
    s.stroke(pen.xy, n, false, withAlpha(shade(worn, 0.78), 0.5), Math.max(4, 26 * k));
    s.stroke(pen.xy, n, false, withAlpha(mix(worn, pen.palette.get('warn'), 0.22), 0.4), Math.max(3, 19 * k));
    // Odd routes run the other way, so their dashes crawl the other way too.
    const flow = (r & 1) === 0 ? pen.t * 26 : -pen.t * 26;
    s.stroke(pen.xy, n, false, withAlpha(mix(worn, 0xffffffff, 0.4), 0.22), Math.max(1, 2.4 * k), 14 * k, flow * k);
  }
}

/**
 * The backdrop: a ramp, three haze bands, a low sun, and its glare.
 *
 * The sun sits low and to the left because the solid kit's `FACE_LEFT`/`FACE_RIGHT` shading is
 * fixed — every box in the kit is lit from the same side — and a backdrop that disagreed with it
 * would make the whole world read as flat for a reason no screenshot names.
 */
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
  const zenith = shade(mix(sky, pen.palette.get('glass'), 0.2), 0.78);
  const horizon = mix(sky, pen.palette.get('warn'), 0.5);
  s.polyRamp(xy, 4, 0, 0, 0, h * 0.86, zenith, horizon);

  // The sun sits in the top eighth, because that ribbon above the waterfront is the only part of
  // the sky this composition ever shows — and the 600-pixel glare that used to sit behind the
  // island was a full-viewport radial gradient painted every frame for nothing.
  const sun = mix(pen.palette.get('warn'), 0xfff4d2ff, 0.55);
  const sx = w * 0.22;
  const sy = h * 0.055;
  s.softEllipse(sx, sy, 120, 120, withAlpha(sun, 0.3), withAlpha(sun, 0));
  s.ellipse(sx, sy, 17, 17, withAlpha(sun, 0.95));

  // Two haze bands drifting at different rates. Stretched ellipses, not clouds: a cloud with an
  // outline in a world this stylised reads as a sprite that got loose.
  for (let i = 0; i < 2; i++) {
    const drift = (toUnit(hash2(0x71c, i, 1)) + pen.t * (0.004 + i * 0.0015)) % 1;
    const bx = drift * (w + 500) - 250;
    const by = h * (0.03 + i * 0.05) + noise2(0x71c, i, pen.t * 0.1) * 9;
    const bw = 190 + toUnit(hash2(0x71c, i, 2)) * 190;
    s.softEllipse(bx, by, bw, bw * 0.14, withAlpha(mix(sun, 0xffffffff, 0.5), 0.16), withAlpha(sun, 0));
  }
}

/**
 * The whole Terrain pass, in the one order that works.
 *
 * The lagoon plane first, then the far shore over it, then the tiles that hide both wherever the
 * island is, then the worn tracks on top of the tiles. It is one exported function rather than four
 * calls in `main.ts` because that order is *art*, not wiring — get it wrong and the skyline paints
 * over the piazza, which is a picture problem with no logic in it at all.
 */
export function drawGround(pen: Pen, p: Plaza, visible: Readonly<TileRange>): void {
  drawLagoon(pen, p.seed);
  drawFarShore(pen);
  p.kind.forEach(visible, (gx, gy) => {
    groundTile(pen, p, gx, gy);
  });
  drawTracks(pen, p);
}
