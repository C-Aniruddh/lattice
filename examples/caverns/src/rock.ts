/**
 * The rock: the floor, the walls that grow out of it, the standing water, and the ceiling the
 * camera is looking out from under.
 *
 * @art
 *
 * Delete this module and the cavern still generates the same field, still sorts the same
 * formations and still lights them. There would be nothing for the light to land on.
 *
 * ## Everything here is arranged around one fact: it will be seen at 8% brightness
 *
 * A `night` quad at 0.92 is what the unlit half of this exhibit is behind, and that changes what
 * art direction *is*. Hue does not survive it — two colors a tenth apart in lightness are the
 * same pixel once they are through the mask — so every distinction the far dark has to carry is
 * made with **value and silhouette**, and every distinction that only matters inside a pool is
 * made with color.
 *
 * That is the whole reason `wallFoot` exists. The line where rock meets floor is stroked in `ink`
 * on the rock's side only, so the cave keeps a legible outline at brightness levels where its
 * *fills* have all collapsed into one grey. It costs four neighbour lookups on a tile that is
 * already being drawn and it is the single largest contributor to the far dark reading as a place
 * rather than as a void — which is the § Scale **fill** row, honestly met: unlit rock is the
 * subject, but *flat* unlit rock is still empty background.
 *
 * ## The near band is screen space and it is drawn under the mask
 *
 * `drawNear` is the third distance band. It is a ceiling of hanging rock across the top of the
 * frame and a shelf across the bottom, in screen space, parallaxed off the camera at a sixteenth
 * of its travel — so it moves when the visitor drags, which is what stops it reading as a vignette
 * painted on the glass.
 *
 * It is drawn in the **Placement** pass, which is pass 3 and therefore *below* the light
 * composite. That is deliberate and it is also a naming complaint filed as a finding: the pass a
 * game wants for "near-field world that is not in the depth sort" is spelled `placement` and
 * documented as the ghost and the selection rim, and `overlay` — the pass whose name fits — is
 * above the darkness, where near-field rock would glow.
 *
 * Every shape here is a triangle or a quad because `Surface.poly` takes **convex** polygons, by
 * contract: a jagged ceiling submitted as one concave outline is the fastest way to find that out.
 */
import { hash2, noise2, toUnit } from '@lattice/core';
import type { TileRange } from '@lattice/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@lattice/draw';
import { STEP_PX, type Cavern } from './cavern.js';

/** Floor at or under this many height units holds water. Read off the same grid the terrain is
 *  drawn from, so the shoreline is a contour of the rock rather than a second map. */
const WET = 1.05;
/** Teeth hanging from the ceiling band, and standing on the floor band. */
const TEETH = 34;

/**
 * A vertical ramp behind everything, one quad.
 *
 * The camera's bounds keep the world under the frame at every zoom, so in practice this is only
 * ever seen through the gaps between formations at the very top of a wall. It is here because a
 * flat clear color is the one thing that reads as *nothing* rather than as unlit air, and because
 * `Layer.Backdrop`'s own doc says so: "never a flat color".
 */
export function drawBackdrop(pen: Pen): void {
  const s = pen.surface;
  const top = pen.palette.get('night');
  const foot = mix(top, pen.palette.get('damp'), 0.5);
  pen.xy[0] = 0;
  pen.xy[1] = 0;
  pen.xy[2] = s.width;
  pen.xy[3] = 0;
  pen.xy[4] = s.width;
  pen.xy[5] = s.height;
  pen.xy[6] = 0;
  pen.xy[7] = s.height;
  s.polyRamp(pen.xy, 4, 0, 0, 0, s.height, top, foot);
}

/**
 * The Terrain pass: every visible tile on its own four corner heights.
 *
 * `visible` arrives already margined by `Passes.maxHeightPx`, which for this exhibit is 240 world
 * pixels of wall — without it the tall rock along the bottom of the frame disappears the moment
 * its foot leaves the screen and the cave appears to end in mid-air.
 *
 * Two scales of grain go in through `tint` and never through a second `shade` call, for the
 * reason `isoTerrain` documents: `shade` pulls toward a cool or warm tint by distance from
 * neutral, so shading twice tints twice and the rock goes muddy.
 */
export function paintRock(pen: Pen, cave: Cavern, visible: Readonly<TileRange>): void {
  const s = pen.surface;
  const heights = cave.field.heights;
  const ink = pen.palette.get('ink');
  const glint = withAlpha(pen.palette.get('crystal'), 0.1);
  for (let gy = visible.gy0; gy <= visible.gy1; gy++) {
    for (let gx = visible.gx0; gx <= visible.gx1; gx++) {
      const opened = cave.open.get(gx, gy) === 1;
      const h = heights.get(gx, gy);
      const grain =
        0.86 +
        noise2(cave.seed ^ 0x4d, gx * 0.31, gy * 0.31) * 0.13 +
        noise2(cave.seed ^ 0x4d, gx * 1.7, gy * 1.7) * 0.06;
      const wet = opened && h <= WET;
      const fill: Ink = !opened ? 'rock' : wet ? 'water' : h > 3.4 ? 'ground' : 'damp';
      // The foot of a wall, stroked on the rock's side only. This is the cave's outline, and it
      // is what survives the mask when every fill in the frame has gone to the same grey.
      const foot = !opened && wallFoot(cave, gx, gy);
      const painted = isoTerrain(pen, cave.field, gx, gy, fill, foot ? ink : undefined, grain);
      // Second pass over the four corners `isoTerrain` left in `pen.xy`, so it costs no
      // projection: a cold sheen on standing water, and a mineral speckle on dry floor.
      if (wet) {
        s.poly(pen.xy, 4, withAlpha(mix(painted, pen.palette.get('crystal'), 0.35), 0.28));
      } else if (opened && toUnit(hash2(cave.seed ^ 0x66, gx, gy)) > 0.88) {
        s.poly(pen.xy, 4, glint);
      }
    }
  }
}

/** Whether this rock tile touches floor on any of its four sides. */
function wallFoot(cave: Cavern, gx: number, gy: number): boolean {
  return (
    cave.open.get(gx + 1, gy) === 1 ||
    cave.open.get(gx - 1, gy) === 1 ||
    cave.open.get(gx, gy + 1) === 1 ||
    cave.open.get(gx, gy - 1) === 1
  );
}

/**
 * The near band: a ceiling of hanging rock and a shelf of standing rock, both in screen space.
 *
 * Parallax is the camera's own position at a sixteenth, wrapped over the tooth spacing, so the
 * band slides against the world on a drag without ever needing to be re-seeded. The teeth are
 * triangles rather than one outline because `poly` is convex-only.
 *
 * Two values of `ink` rather than one: the ceiling is the darkest thing in the exhibit and the
 * shelf is a step lighter, which is enough to read them as two distances rather than as a frame.
 */
export function drawNear(pen: Pen, cave: Cavern): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const roof = shade(pen.palette.get('ink'), 0.62);
  const shelf = pen.palette.get('ink');
  const slide = pen.camera.x * 0.0625 + pen.camera.y * 0.0625;
  const step = w / TEETH;
  band(pen, 0, 0, w, h * 0.052, roof);
  for (let i = 0; i < TEETH; i++) {
    const k = toUnit(hash2(cave.seed ^ 0xc1, i, 1));
    const x = ((i * step - slide) % (w + step * 2) + w + step * 2) % (w + step * 2) - step;
    tooth(pen, x, h * 0.052, step * (0.55 + k * 0.8), h * (0.03 + k * 0.15), roof);
  }
  band(pen, 0, h * 0.965, w, h * 0.035, shelf);
  for (let i = 0; i < TEETH; i++) {
    const k = toUnit(hash2(cave.seed ^ 0xc1, i, 2));
    const x = ((i * step + slide * 1.7) % (w + step * 2) + w + step * 2) % (w + step * 2) - step;
    tooth(pen, x, h * 0.965, step * (0.7 + k), -h * (0.02 + k * 0.06), shelf);
  }
}

/** A screen-space rectangle. One quad, through the pen's own scratch buffer. */
function band(pen: Pen, x: number, y: number, w: number, h: number, fill: number): void {
  pen.xy[0] = x;
  pen.xy[1] = y;
  pen.xy[2] = x + w;
  pen.xy[3] = y;
  pen.xy[4] = x + w;
  pen.xy[5] = y + h;
  pen.xy[6] = x;
  pen.xy[7] = y + h;
  pen.surface.poly(pen.xy, 4, fill);
}

/** One stalactite or one crag: a triangle `drop` pixels long, hanging down or standing up. */
function tooth(pen: Pen, x: number, y: number, w: number, drop: number, fill: number): void {
  pen.xy[0] = x;
  pen.xy[1] = y;
  pen.xy[2] = x + w;
  pen.xy[3] = y;
  pen.xy[4] = x + w * 0.42;
  pen.xy[5] = y + drop;
  pen.surface.poly(pen.xy, 3, fill);
}

/** The height of a tile's rock in world pixels, for anything that has to sit on it. */
export function rockPx(cave: Cavern, gx: number, gy: number): number {
  return cave.field.heights.get(gx, gy) * STEP_PX;
}
