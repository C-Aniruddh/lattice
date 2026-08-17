/**
 * @art — the ground plane: fields, lanes, the river, the air, and **the two functions the whole
 * exhibit's frame time rests on**, `onScreen` and `band`.
 *
 * Delete this file and every verb still works; the valley is simply invisible. It holds nothing
 * between frames, returns nothing any game decision reads, and moves no number a player plays for.
 *
 * ## Why the valley is flat, and how it still has depth
 *
 * There is no height field in this exhibit. That is a deliberate trade worth naming, because
 * elevation is the obvious way to make an isometric world look deep and it is the wrong one here:
 * `docs/GALLERY.md` gives elevation to `Terraces`, terrain-aware picking is *its* idea rather than
 * this one, and a hill under the miller means every tap goes through `screenToTileOnHeights` — one
 * more place where the thing you touched and the thing you got can disagree, in the exhibit whose
 * whole promise is that they cannot.
 *
 * So depth comes from three bands of *air*, at one lerp per tile:
 *
 * | band | what is in it | how it is drawn |
 * |---|---|---|
 * | far | the wooded ridge along `gx + gy < 46` | mixed hard toward `sky`, and **drawn cheaper** |
 * | mid | the village, the fields, the mill | the palette as authored |
 * | near | the foreground the camera is standing in | saturated, and the only band with fine detail |
 *
 * {@link band} is a function of *screen height* rather than of distance from the camera, which is
 * what keeps it still while the camera pans. Haze that moved with the player would read as a bug.
 *
 * ## The cost row, which is a gate
 *
 * `docs/GALLERY.md` § Scale scores cost before it scores density, and this exhibit is the dense
 * kind: several hundred trees, several hundred plants and a hedged field system, all of them
 * derived per tile per frame. Two things pay for that, and neither is a smaller valley.
 *
 * **{@link onScreen}.** `Camera.visibleTileBounds` answers with an axis-aligned *tile* rectangle,
 * and the on-screen tiles are a rotated rectangle inside it — so about half of every range handed
 * to a terrain or fill loop is off the frame. Rejecting those costs four multiplies and a compare
 * per tile and removes them from the sort, from the paint, and from the hashing that would have
 * decided what they looked like. It is the single largest saving here and it is nine lines.
 *
 * **{@link band} again, spending detail where the eye is.** The far third is already asked to be
 * hazier; that is also permission for it to be *cheaper*, and `sprites.ts` reads the same number to
 * drop a tree from five solids to two and a crop tile from eight to zero. Full detail at a distance
 * nobody can resolve is the most expensive nothing in a renderer.
 *
 * **And no light field.** Counted separately, as § Scale asks, the honest answer for an afternoon
 * was zero: `LightField` costs a half-resolution blur and a full-screen composite every frame it is
 * active, and what it would have bought here is a warm patch under an open gate — which is two
 * `softEllipse` calls in `sprites.ts` and no per-frame pass at all. A night exhibit should pay for
 * the field. This one has nothing to light.
 */
import { hash2, noise2, toUnit } from '@latticekit/core';
import { gridToScreen, type TileRange } from '@latticekit/iso';
import { isoTile, mix, shade, withAlpha, type Ink, type Pen } from '@latticekit/draw';
import { CROP, GRASS, MAX_HEIGHT_PX, VCX, VCY, WATER, type Valley } from './valley.js';

/** The slot each ground kind is painted out of, indexed by the kind itself. */
const INK: readonly Ink[] = ['water', 'ground', 'road', 'crop', 'hedge', 'hedge', 'stone', 'stone'];

const pt = { x: 0, y: 0 };

/**
 * Is anything standing on this tile inside the frame?
 *
 * The margins are asymmetric on purpose and each one names a real object: 150 world pixels of `x`
 * is the widest house, `MAX_HEIGHT_PX` of `y` above the bottom edge is the mill seen from below,
 * and only 16 above the top, because a tile whose *base* is above the frame has nothing that can
 * reach back down into it.
 */
export function onScreen(pen: Pen, gx: number, gy: number): boolean {
  const camera = pen.camera;
  const sx = camera.toScreenX((gx - gy) * 32);
  if (sx < -150 * camera.zoom || sx > camera.viewW + 150 * camera.zoom) return false;
  const sy = camera.toScreenY((gx + gy + 1) * 16);
  return sy > -16 && sy - MAX_HEIGHT_PX * camera.zoom < camera.viewH;
}

/**
 * How far into the distance this tile is: `0` near, `1` far.
 *
 * `gx + gy` is screen height in tile units and the valley spans 0 to 318 of it, so the band is a
 * ramp across the middle of that range — clamped at both ends so the foreground is not washed out
 * from underneath and the ridge does not keep fading past the point of being visible.
 */
export function band(gx: number, gy: number): number {
  const t = (198 - (gx + gy)) / 96;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** How far a solid standing here should be faded into the air. Exported so `sprites.ts` and
 *  `people.ts` share one curve; two copies of a haze constant is a treeline that floats off its
 *  own hill. */
export function haze(pen: Pen, gx: number, gy: number, color: number): number {
  return mix(color, pen.palette.get('sky'), band(gx, gy) * 0.58);
}

/**
 * One pass over the visible ground.
 *
 * Two grains and a seam: a per-tile hash, a low-frequency noise drift, and — on crops — a third
 * term that runs in **rows**, because the drill lines a field is planted in are what make a block
 * of yellow read as barley rather than as a rectangle.
 */
export function paintGround(pen: Pen, valley: Valley, visible: Readonly<TileRange>): void {
  const seed = valley.seed;
  const sky = pen.palette.get('sky');
  const detail = pen.camera.zoom > 0.45;
  valley.kind.forEach(visible, (gx, gy, kind) => {
    if (!onScreen(pen, gx, gy)) return;
    const grain = (toUnit(hash2(seed, gx, gy)) - 0.5) * 0.13;
    const drift = noise2(seed ^ 0x9e1, gx * 0.11, gy * 0.11) * 0.09;
    // `(gx - gy)` runs along the screen's horizontal, so the furrows read as planted lines. The
    // other diagonal would give a checkerboard, which is the classic isometric field mistake.
    const rows = kind === CROP ? ((((gx - gy) % 3) + 3) % 3 === 0 ? 0.13 : -0.05) : 0;
    // The green wears out where the village has been walking on it for four hundred years.
    const worn = kind === GRASS ? -0.11 / (1 + 0.02 * ((gx - VCX) ** 2 + (gy - VCY) ** 2)) : 0;
    const tinted = shade(pen.palette.ink(INK[kind] ?? 'ground'), 1 + grain + drift + rows + worn);
    isoTile(pen, gx, gy, mix(tinted, sky, band(gx, gy) * 0.62));
    if (kind === WATER && detail) glint(pen, seed, gx, gy);
  });
}

/**
 * The one moving thing on the ground: a swell drifting down the river.
 *
 * Painted *with* its tile rather than in `ambient.ts`, because a river drawn on top of the solids
 * pass would run over the bridge. A crest is over about a fifth of the water tiles at a time, so
 * this is two ellipses on a couple of dozen tiles rather than on all of them.
 */
function glint(pen: Pen, seed: number, gx: number, gy: number): void {
  const wave = (gx + gy) * 0.5 - pen.t * 1.7 + toUnit(hash2(seed ^ 0x4d, gx, gy)) * 0.9;
  const crest = wave - Math.floor(wave);
  if (crest > 0.22) return;
  gridToScreen(pen.camera, gx + 0.5, gy + 0.5, 0, pt);
  const k = pen.camera.zoom;
  const a = (0.22 - crest) * 1.8;
  const x = pt.x + pen.snapX;
  const y = pt.y + pen.snapY;
  pen.surface.ellipse(x, y, 17 * k, 7 * k, withAlpha(pen.palette.get('sky'), a * 0.5));
  pen.surface.ellipse(x, y - 2 * k, 9 * k, 3.4 * k, withAlpha(0xffffffff, a * 0.34));
}

/**
 * Everything behind the map — only ever seen when a player pans to the valley's own edge, which
 * they will, because § Scale asks for a world that runs off the frame and a player who goes
 * looking. One ramp, and it is the difference between a horizon and **a hard corner with
 * background behind it**.
 */
export function paintSky(pen: Pen): void {
  const s = pen.surface;
  const xy = pen.xy;
  xy[0] = 0; xy[1] = 0; xy[2] = s.width; xy[3] = 0; xy[4] = s.width; xy[5] = s.height; xy[6] = 0; xy[7] = s.height;
  const sky = pen.palette.get('sky');
  s.polyRamp(xy, 4, 0, 0, 0, s.height, mix(sky, 0xfff0d8ff, 0.4), mix(sky, pen.palette.get('hedge'), 0.5));
}

/**
 * The air, painted over the solids: a warm low sun from screen-left and a cool fall-off into the
 * far corner. Two full-screen ramps — the whole exhibit's "one hour", for two draw calls.
 */
export function paintAir(pen: Pen): void {
  const s = pen.surface;
  const xy = pen.xy;
  xy[0] = 0; xy[1] = 0; xy[2] = s.width; xy[3] = 0; xy[4] = s.width; xy[5] = s.height; xy[6] = 0; xy[7] = s.height;
  s.polyRamp(xy, 4, 0, 0, s.width, s.height,
    withAlpha(pen.palette.get('warn'), 0.11), withAlpha(pen.palette.get('night'), 0.15));
  s.polyRamp(xy, 4, 0, 0, 0, s.height * 0.55,
    withAlpha(pen.palette.get('sky'), 0.28), withAlpha(pen.palette.get('sky'), 0));
}
