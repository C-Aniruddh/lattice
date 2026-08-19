/**
 * The ground: five decks, four risers, the sunken archive floor in front of them, and the paint
 * on all of it.
 *
 * @art
 *
 * Delete this file and every save still climbs, every build still refuses what it must, and every
 * counter still reads what it read. The ladder's *shape* is `ladder.ts`, which owns the height
 * field; this is only what that shape looks like.
 *
 * ## The Terrain pass is walked in depth space, and that is the cull
 *
 * `renderFrame` hands over a tile **box**, margined on both axes by `Passes.maxHeightPx` because a
 * terrace's base can be off the bottom of the frame while its top is on it. On a yard 352 px tall
 * that margin is eleven tiles on each axis of a box, and iterating it costs more than painting the
 * ground. So this walks `u = gx + gy` — the depth axis, where elevation actually moves a tile —
 * and `v = gx − gy`, which is bounded by the frame's width and by nothing else.
 *
 * It buys a second thing for free: `u` **is** the depth key, so ascending `u` paints strictly far
 * to near, which is the only order a heightfield can be painted in without a sort.
 *
 * ## The stencils are world-anchored text, deliberately
 *
 * `screenText`'s doc says *never world-space*, and it is right for a label that has to stay
 * readable at every zoom. These are the other thing: **paint on the floor**. A `5` stencilled on
 * the vault deck is part of the deck, so it scales with the deck, and it is drawn inside the
 * Terrain pass so the crates standing on it occlude it exactly as they occlude the paint. A
 * numeral that stayed 30 px while the yard grew would read as a label hovering over the ground.
 */
import { clamp, hash2, toUnit } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_H, TILE_W, type Rect, type TileRange } from '@latticekit/iso';
import { DEFAULT_TEXT, isoTerrain, isoWall, mix, pxToLevels, screenText, shade, wallText, withAlpha, type Pen, type Rgba } from '@latticekit/draw';
import { HEAD, WHY } from './chain.js';
import { GROUND, MAX_HEIGHT_PX, SPAN, gxOf, gyOf, liftAt } from './ladder.js';
import { place } from './place.js';

const DECKS = ['deck1', 'deck2', 'deck3', 'deck4', 'deck5'] as const;

/** The visible world box, refilled each frame. Module scope, so the pass allocates nothing. */
const world: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** How high the archive is being opened by. Read once per frame from the pass, so every drawer
 *  below can grey out a deck this build does not have without threading a parameter. */
let top = HEAD;
/** Whether a tile is big enough on screen for its seam to be worth a second path. Below about
 *  22 px a hairline round a diamond is a grey haze over the deck and costs a whole extra stroke
 *  per tile — `GALLERY.md`'s *spend the detail where the eye is*, applied to the cheapest lever
 *  this exhibit has. */
let fine = true;

/**
 * The color of one tread.
 *
 * Five decks, cold slate at v1 warming to gold at v5, and the sunken archive floor in front of
 * them darkening into the pit where refusals land. A deck the current build cannot reach is
 * washed most of the way into the haze, so a yard opened by the v3 build has two decks on it that
 * visibly **are not part of this build**, rather than two decks that merely happen to be empty.
 */
function deckOf(pen: Pen, d: number): Rgba {
  const floor = pen.palette.get('floor');
  if (d < 0) return mix(floor, pen.palette.get('pit'), clamp(-d / 14, 0, 1));
  const k = Math.min(Math.floor(d / SPAN), HEAD - 1);
  const ink = pen.palette.get(DECKS[k] ?? 'deck1');
  return k >= top ? mix(ink, pen.palette.get('mist'), 0.55) : ink;
}

/** One tile of ground. `tint` is where the grain folds in, so relief and grain compose inside the
 *  one `shade` call `isoTerrain` already makes — two `shade` calls in series tint twice and the
 *  ground goes muddy. */
function tile(pen: Pen, gx: number, gy: number): void {
  const fill = deckOf(pen, -(gx + gy));
  isoTerrain(pen, GROUND, gx, gy, fill, fine ? withAlpha(shade(fill, 0.9), 0.45) : undefined, 0.965 + toUnit(hash2(7, gx, gy)) * 0.07);
}

/**
 * The four risers, drawn as walls rather than as ground.
 *
 * This is the whole reason the ladder runs along the depth axis. A wall's base line here is
 * horizontal on screen, so its face is a **rectangle** — one `isoWall` per rung, four calls a
 * frame, with a `lip` stroke that puts a hard bright rim along the top of every step. That rim is
 * the exhibit's one level line, and `GALLERY.md`'s note on `Canyon` is that a drop only reads when
 * there is something level to measure it against.
 *
 * A rung this build does not have is drawn in the haze instead of in shadow: not a wall in the
 * dark, but a wall that is not there yet.
 */
function walls(pen: Pen): void {
  const sA = Math.floor(world.minX / HALF_W) - 2, sB = Math.ceil(world.maxX / HALF_W) + 2;
  for (let k = HEAD - 1; k >= 1; k--) {
    // Each wall is the shadowed form of the deck it rises from, rather than one grey for all
    // four: a riser is the same stone as the tread below it, seen out of the sun.
    const face = mix(pen.palette.get(DECKS[k - 1] ?? 'deck1'), pen.palette.get('riser'), 0.74);
    isoWall(pen, gxOf(k * SPAN, sA), gyOf(k * SPAN, sA), gxOf(k * SPAN, sB), gyOf(k * SPAN, sB),
      pxToLevels((k - 1) * RISE_PX), pxToLevels(k * RISE_PX),
      k >= top ? mix(face, pen.palette.get('mist'), 0.62) : face, withAlpha(pen.palette.get('lip'), k >= top ? 0.3 : 1));
  }
}

/**
 * The Terrain pass.
 *
 * There is no map to clamp to — `ladder.ts` gives the ground as a function, so the world has no
 * edge — and the only bound is the camera's own box. `visible` is still what the caller computed
 * and is what the margin is proved against; it is not consulted for an edge that does not exist.
 */
export function paintGround(pen: Pen, _visible: Readonly<TileRange>, build: number): void {
  top = build;
  fine = pen.camera.zoom > 0.55;
  pen.camera.visibleWorldBounds(world, TILE_W);
  const uLo = Math.floor(world.minY / HALF_H) - 2;
  const uHi = Math.ceil((world.maxY + MAX_HEIGHT_PX) / HALF_H) + 2;
  const vLo = Math.floor(world.minX / HALF_W) - 2;
  const vHi = Math.ceil(world.maxX / HALF_W) + 2;
  for (let u = uLo; u <= uHi; u++) {
    // One test per **row**, not per tile, and it is the whole of the height margin's cost.
    // `renderFrame`'s box is margined by `maxHeightPx` on both axes because a camera cannot know
    // what a heightfield is; here the ground is a staircase in one axis, so a row's elevation is a
    // single number and a row that lands off the frame is skipped before its thirty tiles are
    // visited. It removes about a third of the walk on this yard and cannot disagree with the
    // sort, because terrain is not in the sort.
    const y = u * HALF_H - liftAt(-u, 0);
    if (y < world.minY - TILE_H || y > world.maxY + TILE_H) continue;
    // `v` shares `u`'s parity or `(u + v) / 2` is not a tile. Bitwise `&` is exact on negatives.
    let v = vLo;
    if (((v - u) & 1) !== 0) v++;
    for (; v <= vHi; v += 2) tile(pen, (u + v) / 2, (u - v) / 2);
  }
  walls(pen);
  stencils(pen, build);
}

const STENCIL = { ...DEFAULT_TEXT, weight: 900, align: 0 as const, baseline: 0 as const };
const RUNG = { ...DEFAULT_TEXT, weight: 700, align: 0 as const, baseline: 0 as const, size: 26 };
/** World pixels of rise per rung. Art's copy of the number `ladder.ts` builds the ground from —
 *  it only ever places paint, and a paint job that is a pixel off is a paint job that is a pixel
 *  off. Nothing decides anything from it. */
const RISE_PX = 104;

/**
 * The paint on the decks, and the writing on the walls.
 *
 * A version numeral is stencilled on every tread and repeated across the lanes like runway
 * markings, which is what makes them read as **paint** rather than as five floating captions: one
 * numeral per terrace is a label, a numeral every thirty tiles along a deck that runs off both
 * edges of the frame is a floor somebody painted.
 *
 * And the rung's own prose goes on the riser, with `wallText` — the reason the ladder is turned
 * onto this axis in the first place. `chain.WHY[k]` is the string `migrations().step()` was given
 * as its `why` argument, so the sentence on the wall **is** the sentence in the chain: there is no
 * second copy of it anywhere to drift. A visitor reads what the migration does off the wall the
 * crates are climbing.
 */
function stencils(pen: Pen, build: number): void {
  const zoom = pen.camera.zoom;
  const s0 = Math.floor(world.minX / HALF_W / 40) * 40, s1 = Math.ceil(world.maxX / HALF_W) + 40;
  const line = pen.palette.get('line');
  for (let k = 0; k < HEAD; k++) {
    for (let s = s0 + 20; s <= s1; s += 40) {
      const d = k * SPAN + SPAN / 2;
      const p = place(pen, gxOf(d, s), gyOf(d, s), k * RISE_PX);
      screenText(pen, p.x, p.y, String(k + 1), withAlpha(line, k >= build ? 0.1 : 0.28), { ...STENCIL, size: 66 * zoom });
    }
    if (k === 0) continue;
    // `wallText` sizes itself from the wall's screen height and then shrinks to fit the segment,
    // so the segment length is what sets the type size. Forty-four tiles of lane is a sign a
    // visitor reads without it becoming the loudest object in the frame, and it repeats every
    // fifty-two so one is always in shot on a wall that runs off both edges.
    for (let s = s0; s <= s1; s += 40) {
      wallText(pen, gxOf(k * SPAN, s), gyOf(k * SPAN, s), gxOf(k * SPAN, s + 30), gyOf(k * SPAN, s + 30),
        pxToLevels(k * RISE_PX), pxToLevels(RISE_PX),
        `${String(k)} → ${String(k + 1)}    ${WHY[k - 1] ?? ''}`, withAlpha(line, k >= build ? 0.3 : 0.8), RUNG);
    }
  }
}

/**
 * The air over the far lanes.
 *
 * The yard recedes *up* the screen — smaller `s` is further away — so one ramp down from the top
 * edge is the whole of the distance cue, and it is in front of every solid so nothing pokes
 * through it. Without it the terraces at the top of the frame are the same saturation as the ones
 * at the bottom and the yard reads as a flat pattern rather than as a place with a far end.
 */
const band = new Float64Array(8);
export function drawAir(pen: Pen): void {
  const w = pen.surface.width;
  const h = pen.surface.height * 0.55;
  band[0] = 0; band[1] = 0; band[2] = w; band[3] = 0; band[4] = w; band[5] = h; band[6] = 0; band[7] = h;
  const mist = pen.palette.get('mist');
  pen.surface.polyRamp(band, 4, 0, 0, 0, h, withAlpha(mist, 0.7), withAlpha(mist, 0));
}

/** How much air is in front of something at screen `y`. Every solid mixes this in, or a fully
 *  saturated crate on a hazed deck reads as a sticker on a pale background. */
export function hazeAt(pen: Pen, y: number): number {
  return clamp((pen.surface.height * 0.55 - y) / (pen.surface.height * 0.62), 0, 1) * 0.74;
}
