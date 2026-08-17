/**
 * The rock: floor, wall face, the mass overhead, and the lichen that is the only thing you can
 * see where you have not yet been.
 *
 * @art
 *
 * Delete this file and the cavern is an unpainted heightfield. Everything here decides what a
 * tile *looks* like; nothing here decides what a tile *is*, which is `cavern.ts`.
 *
 * ## Unlit rock is the subject, and flat unlit rock is a background
 *
 * This exhibit spends most of every frame below the light field's mask, at about a seventh of its
 * painted brightness, and the single biggest risk it has is that all of that reads as *empty*. So
 * three things are true of every tile whether or not a lamp reaches it:
 *
 * - **the grain is per-tile and per-patch**, two scales, folded into `isoTerrain`'s one `tint`
 *   rather than into a second `shade` — shading twice tints twice and the rock goes muddy;
 * - **the mass overhead is a different color from the wall below it**, so a corridor reads as a
 *   corridor rather than as a maze printed on a floor;
 * - **the veins glow**, which is the only thing in the frame that survives the mask at full
 *   saturation, and is therefore what makes the dark *textured* instead of merely dark.
 *
 * ## Two passes, one projection
 *
 * `isoTerrain` leaves the tile's four projected corners in `pen.xy`, so the seam stroke and the
 * vein both cost no projection at all. The veins' screen positions are also kept in a
 * preallocated buffer here so that {@link glimmer} can bloom them in the Overlay pass — *above*
 * the light composite, because bioluminescence is a source and not a lit surface. That buffer is
 * refilled every frame and read once; nothing in it outlives the frame that wrote it.
 */
import { clamp01, hash2, noise2, toUnit } from '@lattice/core';
import type { TileRange } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@lattice/draw';
import { H, W, type Cavern } from './cavern.js';
import { snapGlow } from './props.js';

/** At or below this average vertex height a tile is floor. Above 9 it is the mass overhead. */
const FLOOR_TOP = 5.5;
const ROOF_FLOOR = 9;
/** How many vein blooms the Overlay pass may draw. Past this the frame is a light show, and the
 *  Nth one costs the same as the first — § Scale's cost row is spent here as well as on solids. */
const BLOOM_MAX = 64;

const bloomX = new Float64Array(BLOOM_MAX);
const bloomY = new Float64Array(BLOOM_MAX);
const bloomA = new Float64Array(BLOOM_MAX);
let blooms = 0;

// The pass's context. `TileGrid.forEach` takes a visitor and passes no context of its own, and
// its doc asks callers to hoist the visitor rather than allocate one per frame — so the pen, the
// cave and the lamp reach it through these. That every caller is forced into this is a finding.
let pass: Pen | undefined;
let passCave: Cavern | undefined;
let lampX = 0;
let lampY = 0;

const visit = (gx: number, gy: number): void => {
  if (pass !== undefined && passCave !== undefined) tile(pass, passCave, gx, gy);
};

/** The Terrain pass, in one call. `cx`/`cy` are where the lamp is, in tiles. */
export function paintRock(pen: Pen, cave: Cavern, visible: Readonly<TileRange>, cx: number, cy: number): void {
  pass = pen;
  passCave = cave;
  lampX = cx;
  lampY = cy;
  blooms = 0;
  cave.rock.forEach(visible, visit);
}

function tile(pen: Pen, cave: Cavern, gx: number, gy: number): void {
  // Heights live on vertices, so the grid offers a final row and column of tiles with no
  // south-east corner. Skipped here rather than in the caller, who would forget.
  if (gx >= W || gy >= H) return;
  const rock = cave.rock;
  const e = (rock.get(gx, gy) + rock.get(gx + 1, gy) + rock.get(gx + 1, gy + 1) + rock.get(gx, gy + 1)) / 4;
  const grain = (toUnit(hash2(cave.seed, gx, gy)) - 0.5) * 0.11;
  const patch = noise2(cave.seed ^ 0x9e17, gx * 0.15, gy * 0.15) * 0.1;

  let ink: Ink;
  if (e <= FLOOR_TOP) {
    // The floor. Water collects in the hollows and dries on the rises, and the difference is a
    // mix toward `damp` rather than a darker tint: wet rock is bluer, not just dimmer.
    const wet = clamp01(noise2(cave.seed ^ 0x2d41, gx * 0.11, gy * 0.11) * 0.75 + 0.45 - e * 0.06);
    ink = mix(pen.palette.get('ground'), pen.palette.get('damp'), wet * wet * 0.75);
  } else if (e < ROOF_FLOOR) {
    // The wall face. A blend and not a branch: a threshold here draws a contour line around every
    // chamber, which reads as damage rather than as stone.
    ink = mix(pen.palette.get('rock'), pen.palette.get('moss'), clamp01((ROOF_FLOOR - e) / 15) * 0.42);
  } else {
    // The mass overhead. Darker than the wall it stands on, which is the whole of why a tunnel
    // reads as a tunnel from above rather than as a path painted on a plateau.
    ink = mix(pen.palette.get('rock'), pen.palette.get('ink'), 0.16 + patch);
  }

  const painted = isoTerrain(pen, cave.field, gx, gy, ink, undefined, 1 + grain + patch);

  // Two edges only, at the tile's own hue: a fold in the stone rather than a wireframe.
  if (pen.camera.zoom > 0.55) {
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.86), 0.2), 1);
  }

  vein(pen, cave, gx, gy, e);
}

/**
 * Lichen in a seam of the rock: a cold bloom that breathes on its own clock.
 *
 * It is refused on the mass overhead, so the glow traces the *walls of the passages* — which is
 * how a player reads the shape of a corridor they have not lit yet, and is the reason this
 * exhibit can be nearly black and still be navigable.
 */
function vein(pen: Pen, cave: Cavern, gx: number, gy: number, e: number): void {
  if (e <= 1.4 || e >= ROOF_FLOOR) return;
  const roll = hash2(cave.seed ^ 0x5e33, gx, gy);
  if (toUnit(roll) > 0.06) return;
  // The third distance band, for free: a seam forty tiles out is a dimmer seam, so the far half
  // of the frame recedes instead of glowing exactly as hard as the ground under the lamp.
  const near = clamp01(1.25 - (Math.abs(gx - lampX) + Math.abs(gy - lampY)) / 46);
  const breath = 0.55 + Math.sin(pen.t * 0.9 + roll * 0.001) * 0.35; /* @tier-b pixels only */
  const a = snapGlow(breath * near * 0.55);
  if (a <= 0) return;
  const cx = ((pen.xy[0] ?? 0) + (pen.xy[4] ?? 0)) / 2;
  const cy = ((pen.xy[1] ?? 0) + (pen.xy[5] ?? 0)) / 2;
  const k = pen.camera.zoom;
  const color = pen.palette.get('vein');
  pen.surface.softEllipse(cx, cy, 13 * k, 7 * k, withAlpha(color, a), withAlpha(color, 0));
  if (blooms < BLOOM_MAX && near > 0.55) {
    bloomX[blooms] = cx;
    bloomY[blooms] = cy;
    bloomA[blooms] = breath * near;
    blooms += 1;
  }
}

/**
 * The veins again, above the night mask, in the Overlay pass.
 *
 * A light source is not darkened by the darkness it is sitting in. Painting the bloom under the
 * mask and only the mask makes every glow in the frame exactly as bright as the rock around it,
 * which is the tell that gives away a cave lit by a tint rather than by lamps.
 */
export function glimmer(pen: Pen): void {
  const color = pen.palette.get('vein');
  const k = pen.camera.zoom;
  const clear = withAlpha(color, 0);
  for (let i = 0; i < blooms; i += 1) {
    const a = snapGlow((bloomA[i] ?? 0) * 0.3);
    if (a > 0) pen.surface.softEllipse(bloomX[i] ?? 0, bloomY[i] ?? 0, 22 * k, 12 * k, withAlpha(color, a), clear);
  }
}

/**
 * The Backdrop pass: the void the cave's outer wall stands against.
 *
 * Barely visible, and deliberately so — the map is generated solid past its rim, so the only
 * place this shows at all is the outermost frame of the diamond at full zoom-out. It exists so
 * that place is *depth* rather than a flat fill, which is the far band of `docs/GALLERY.md`'s
 * three.
 */
export function drawVoid(pen: Pen): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const deep = pen.palette.get('night');
  const near = pen.palette.get('ink');
  pen.xy[0] = 0;
  pen.xy[1] = 0;
  pen.xy[2] = w;
  pen.xy[3] = 0;
  pen.xy[4] = w;
  pen.xy[5] = h;
  pen.xy[6] = 0;
  pen.xy[7] = h;
  s.polyRamp(pen.xy, 4, 0, 0, 0, h, deep, mix(near, deep, 0.55));
}
