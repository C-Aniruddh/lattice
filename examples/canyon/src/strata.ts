/**
 * The rock: strata in the wall, cool shadow in the bottom, warm light on the rim, junipers and a
 * switchback trail for scale, and fifteen kilometres of dry air across the gorge.
 *
 * @art
 *
 * Delete this file and the canyon still forms, still scrubs, and still lands on the same
 * fingerprint at the same epoch — it is simply invisible. Nothing here holds state that outlives
 * a frame and nothing here returns a value any decision reads: it is handed the model's live
 * buffer and it paints.
 *
 * ## The viewpoint: down the length of the gorge, not across it
 *
 * **The canyon runs away from the camera along `gx + gy`, one wall to the left and one to the
 * right, and the river goes up the middle of the frame into the haze.** A drone in the gorge, not
 * a person on the rim. That is a reversal of what this exhibit did for three builds and the trade
 * is exact enough to write down:
 *
 * | | across the frame, as built before | along it, as built now |
 * |---|---|---|
 * | a wall's face, rim to water, **vertically on screen** | `cut · (HALF_H/slope + stepPx)` — **742 px** at epoch 2000, because the wall's horizontal run projects onto the *same* screen axis as its height and the two add | `cut · stepPx` — **312 px**, because the run projects onto the perpendicular axis and adds nothing |
 * | what is in shot | one wall, in full; the other compressed to 150 px and recovered by shadow alone | **both walls**, the same size, flanking a river that recedes for 1,600 px of screen |
 * | occlusion | every hard bed hides the bench behind it — the only unambiguous depth cue an orthographic projection has | none at all: along a line of constant `gx − gy` the surface descends the screen monotonically |
 * | perspective | none needed; the subject is a cross-section | **haze, or nothing** — parallel rims do not converge in an orthographic projection, so the atmosphere has to do all of it |
 *
 * So the turn costs 58% of the wall's apparent height and buys the shape of the photograph. It was
 * asked for after the cross-section build was reviewed as *"too triangular, I expected it to flatten
 * out — the aerial view, as if from a drone between two canyons"*, and the number above is the price
 * of that, measured rather than argued.
 *
 * ## Why the tiles are walked in diagonal order and not in rows
 *
 * A 2:1 painter's order is increasing `gx + gy`, and every other exhibit in the gallery walks its
 * terrain in rows because on gentle ground the difference is invisible. It is not invisible here:
 * the gorge's own axis *is* that diagonal, so a row-major walk would paint the near end of the
 * canyon before the far end of it. The visible rectangle is traversed by anti-diagonal, which costs
 * two lines of loop arithmetic and not one extra tile, and ascending `gx + gy` is then **strictly
 * far-to-near**, which is what makes the foreground band's darkening safe to apply per tile.
 *
 * (The surface itself is watertight either way, and that is `iso`'s doing rather than this
 * file's: heights live on grid **vertices**, so two neighbouring tiles share their corner values
 * exactly and a vertical cliff is one very steep quad rather than a gap between two flat ones.)
 *
 * ## What makes six thousand feet read as six thousand feet
 *
 * The first build of this exhibit was reviewed with one sentence — *"Grand Canyon is 6000+ feet
 * deep, the demo didn't make that impact"* — and `docs/GALLERY.md` § *A mile deep has to feel a
 * mile deep* is the table written from it. Almost none of the answer is in the height field:
 *
 * | cue | how it is spent here |
 * |---|---|
 * | **something flat to fall away from** | **the one that turns a hillside into a canyon.** {@link bench} snaps every drawn vertex onto the top of its own bed, so the tableland either side of the gorge is a dead-flat mesa top and the walls are stacks of flat benches with abrupt risers between them. The drop reads because there is something level to measure it against, and now the level thing is in the geometry rather than in the framing |
 * | **the drop takes up the frame** | `view.ts` fits **rim to rim across** rather than rim to rim down: the gorge is 1,300 px wide at the opening epoch and 1,900 at the end, against a 2,000 px frame, and it runs the full height of it |
 * | **strata you can count** | the band is chosen by elevation *minus the uplift*, so it is a bedding plane in the rock, revealed in order as the river cuts down through it — and since {@link bench} puts a whole bed's tiles on one plane, each band is now a flat step you can count by eye rather than a stripe on a ramp |
 * | **one wall lit, one in shadow** | see the `pit` term. The gorge is cut across the sun's own axis, so `east − west` has opposite signs on the two walls and the kit's own relief term does most of it; `pit` takes the shadowed one further, ramped over two units below the rim so the lip is an **edge** |
 * | **haze up the canyon** | over {@link HAZE_SPAN} diagonals to {@link HORIZON}, **cubed, not linear**, so the near end keeps its color and only the distance goes blue-grey. In this viewpoint it is not a cue among others — it is the only thing standing in for perspective |
 * | **rim light** | the top of any steep face takes `sun`, the one warm edge in the frame, and it is what draws the line where the mesa top stops |
 * | **things of a known size** | junipers on the rims four pixels tall, scree you can pick out single blocks in, a river that is a thread, birds flying *below* the rim line in `sky.ts`, and {@link trail} — five switchbacks down the left wall, which is the one object in the frame a person could be standing on |
 */
import { clamp, clamp01, hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { HALF_H, HALF_W, gridToScreen, tileSourceOf, type HeightField, type TileRange } from '@latticekit/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@latticekit/draw';
import { CELLS, CELL_COUNT, N, STEP_PX, UPLIFT, WALL, type State } from './erosion.js';
import type { DeepTime } from './deeptime.js';
import { SECTION } from './palette.js';

/**
 * Elevation of the top of each bed, in height units, deepest last.
 *
 * Uneven on purpose: even bands read as a gradient ramp, and a section is not a ramp. The first
 * is above the plateau's own roughness so the tableland is one unbroken caprock rather than a
 * patchwork of three, and the last is just under the deepest the river reaches in a full run —
 * the basement schist is the reward for scrubbing to the end, and a section whose bottom bed is
 * never exposed has spent a palette slot on nothing.
 */
const BEDS = [43.5, 40, 37.5, 33, 31, 27.5, 24];
/** The plane the caprock itself is drawn on — the top of the section, above every bed in
 *  {@link BEDS}, and how hard {@link bench} pulls a vertex onto the plane of the bed it stands in.
 *  47 rather than the plateau's own 46 because the tableland carries a unit of roughness and the
 *  bench has to be at least as high as the ground it flattens, or the mesa tops come out dished. */
const CAP = 47, SNAP = 0.86;
/** The surface the shadow and the rim light are measured against, and how far below it the
 *  shadow saturates — about the depth of the finished gorge. */
const RIM = 46, DEEP = 26;
/** Half-width of the young valley the river starts in, in tiles of `gx - gy`. See {@link rimU}. */
const TROUGH = 6;
/**
 * **The horizon: the `gx + gy` up the canyon at which there is nothing left of the rock**, and how
 * many diagonals the haze takes to dissolve it.
 *
 * The gorge runs *away from the camera* along `gx + gy`, so distance up the canyon is a line of
 * constant `gx + gy` — horizontal on screen at every zoom and pan, which is what lets `sky.ts` hang
 * its gradient off the same number and leaves no seam between the furthest rock and the air.
 *
 * **It is a constant here where it used to be hung off the rim, and the turn is why.** While the
 * gorge ran across the frame, "far" meant *across* the gorge, so the horizon had to track a rim
 * that moved outward as the canyon widened. Along the length of the canyon nothing moves: the
 * hundredth diagonal is a hundred diagonals away at every epoch. Fifty-six puts the vanishing
 * region in the top fifth of the frame, and it is also the cull — past it no tile is walked at all
 * and the backdrop is already painting `air` there.
 *
 * **The span is the exhibit's only convergence.** An orthographic projection will not narrow two
 * parallel rims, so what makes the gorge recede is aerial perspective and nothing else: over
 * thirty-six diagonals the rock goes to `air`, cubed, so the near end keeps its color and only the
 * distance washes out. That is the whole reason this viewpoint is affordable — the projection gives
 * no perspective at all and the atmosphere has to supply it.
 */
const HORIZON = 56, HAZE_SPAN = 36;
/** Where the rock is gone, in `gx + gy`. See {@link HORIZON} — a function so `sky.ts` and the walk
 *  cannot drift apart, and so this stays the one place that answers it. */
export function hazeFar(): number {
  return HORIZON;
}
/** How far in front of the frame's bottom edge the foreground band starts to darken, in diagonals,
 *  and how many it takes to reach full strength. The other end of one cue: the head of the canyon
 *  goes pale and blue, the rock coming at the camera goes dark and warm. */
const NEAR_LIFT = 26, NEAR_SPAN = 30;
/** Accumulated water above which a tile is drawn as river. High, because the river has to be a
 *  *thread*: a channel four tiles wide reads as a lake and takes the scale down with it. */
const WET = 46;
/** The lowest the terrain ever gets, in height units, for the horizon bound below. Measured over a
 *  full run rather than guessed — 33.05 at epoch two thousand — then loosened, because the
 *  direction that is wrong is the one that drops a row of tiles off an edge. */
const LOW = 30;
/**
 * **How high the tableland stands above the uplift**, in height units — and it is the near end of
 * the walk, the mirror of what {@link HAZE_LIFT} does at the far one.
 *
 * The near-side tableland is the ground the camera is standing on. It runs from the near rim to the
 * edge of the map and on screen it *descends* at a full `HALF_H` a diagonal, because it is flat —
 * twice as fast as the wall above it climbs. Painted to the map's edge it took the bottom third of
 * every frame: far tableland at the top, far wall in the middle, **near tableland across the
 * bottom**, and the gorge nowhere. A photograph of a canyon has no flat foreground at all; its
 * bottom edge is already mid-wall, because the photographer is standing past the rim. `view.ts`
 * § `BASE` puts the frame's bottom edge on the wall, and this bound stops the walk one row after
 * the flat ground has gone under it.
 *
 * **It is expressed against the frame rather than against the rim, and that is the whole of it.**
 * Cropping at `nearRim + k` was tried first and is the obvious reading of "start at the lip", but a
 * rim-relative bound is only correct at one epoch and one zoom: at epoch zero there is no gorge, the
 * near rim is fourteen diagonals higher up the frame, and the crop leaves a band of *sky* along the
 * bottom — as does any zoom-out or downward pan, both of which put the frame's edge below a line the
 * rim knows nothing about. Asking where the flat ground passes the bottom of the frame answers all
 * four cases with the arithmetic that was already there, and at the opening framing it lands within
 * three diagonals of the rim crop anyway.
 *
 * **49, and it is measured against the height the tableland is *drawn* at rather than the height it
 * has.** {@link bench} pulls every vertex onto its bed, so the flat ground leaves the model at
 * anything from 46 to 54.7 above the uplift and arrives at the quad builder between 47.0 and 48.1.
 * The bound has to hold in the *highest* column or a row of sky opens under the bottom edge, and
 * 49 is that plus a unit. It replaces a flat 62 — the tallest ground anywhere on the map at the end
 * of the run — which a bracket has to be and a cull does not: tracking the uplift and the snap
 * instead takes about fifteen diagonals off the near end of every walk, no longer visited at all
 * rather than rejected one quad at a time by the per-tile floor test below.
 */
const CAPROCK = 49;
/** Which diagonal the trail comes down at, how many switchbacks it makes, how far each leg swings
 *  along the canyon, and how finely it is sampled. `TRAIL_D` is a little nearer than the middle of
 *  the map so the path is in the front half of the frame, where a yard-wide line is still legible. */
const TRAIL_D = 126, TRAIL_LEGS = 4, TRAIL_SWING = 7, TRAIL_PTS = 41;
/** Scratch for the two projections this file makes per frame. Never per tile. */
const pt: Vec2 = { x: 0, y: 0 };

/** `Float64Array` reads are `number | undefined` under `noUncheckedIndexedAccess`; see
 *  `erosion.ts` for the finding this one line is the art half of. */
function at(a: Float64Array, i: number): number {
  return a[i] as number;
}

/**
 * **The height a vertex is *drawn* at: pulled most of the way onto the top of the bed it stands in.**
 *
 * This is the answer to "the canyon looks too triangular, I expected it to flatten out", and the
 * diagnosis is worth more than the fix. A height field is *continuous*, so every vertex differs a
 * little from its neighbours, and a diamond grid renders continuous relief as an endless field of
 * small triangles — the silhouette zigzags at the tile scale everywhere, including on ground that
 * is supposed to be a plateau. Real canyon country is the opposite shape: **flat-topped mesas and
 * benches with near-vertical risers between them**, an orthogonal silhouette, because horizontal
 * beds weather back to their own bedding planes. `BED_TALUS` was aimed at this from inside the model
 * and could not get there — it sets the *angle* a wall relaxes to, and any single angle is still a
 * ramp.
 *
 * So the section is imposed on the geometry as well as on the color: a vertex is snapped toward the
 * top of its own bed — {@link BEDS} shifted up one, with {@link CAP} above it for the caprock — and
 * a whole bed's worth of tiles then lands on one plane. Flat tops are also § *A mile deep*'s first
 * row, the level thing the drop is measured against, and countable strata are its third, so one
 * operation buys two of the five cues for four comparisons and a multiply.
 *
 * Snapping **up**, to the top of the band a vertex is already in rather than down to its base, is
 * what keeps the color and the geometry agreeing: the snapped height never leaves the band it was
 * classified in, so the bench a tile is drawn on and the stratum it is painted in are the same bed.
 * Snapping down crosses the boundary by construction and stripes every bench with the color of the
 * one below it.
 *
 * **`SNAP` is 0.86 rather than 1, and the missing seventh is deliberate.** Full quantization is a
 * staircase whose steps never move: the model would go on eroding underneath and the picture would
 * change only when a vertex crossed a bed boundary, which in an exhibit whose whole subject is
 * *continuous* time is the one artifact that would falsify it. Leaving a seventh of the real
 * relief in keeps every frame different from the last while the benches still read as flat, and it
 * softens the riser at a boundary from a hard jump to a steep one.
 *
 * **It happens here and never in `erosion.ts`.** The model's field stays continuous, so the
 * physics, the droplet gradients and every checkpoint fingerprint are untouched; this is the
 * function that turns a height into geometry and it is the last moment before the quad is built.
 * Quantizing the state would change what the next step erodes and the exhibit's headline claim
 * with it.
 */
function bench(h: number, rise: number): number {
  const bed = h - rise;
  let k = 0;
  while (k < BEDS.length && bed < (BEDS[k] ?? 0)) k++;
  const top = (k === 0 ? CAP : BEDS[k - 1] ?? CAP) + rise;
  return h + (top - h) * SNAP;
}

/**
 * **Half the width of the gorge in tiles of `gx - gy`** — where the rim stands, from how deep the
 * river has cut.
 *
 * Derived rather than searched, and the derivation is one line because of what the model
 * guarantees: `settle` slides anything steeper than the bed's own angle into its lowest neighbour,
 * so a wall is a stack of cliffs and benches whose *column mean* is `erosion.WALL` and never
 * steeper for long. A gorge `cut` units deep therefore has walls about `cut / WALL` tiles wide,
 * plus the trough it started in. Scanning the height field for the rim would cost a pass over
 * twelve thousand cells to answer a question the angle already answers.
 *
 * The gorge now runs **away** from the camera, so this is a screen *x* rather than a screen y:
 * both rims are lines of constant `gx - gy`, which project to verticals `32 · rimU` either side of
 * the axis, and the whole width of the canyon is on screen at once. It is the same number the
 * previous viewpoint used to place one rim above the other.
 */
export function rimU(cut: number): number {
  return TROUGH + cut / WALL;
}

/** Screen y of the rim, level with the water below — the line § *A mile deep* asks for the birds
 *  to be **below**. Taken on the canyon's own axis at the middle of the map, which is the middle of
 *  the frame: the rims are the same height as the tableland they are cut into. */
export function rimScreenY(pen: Pen, epoch: number, cut: number): number {
  gridToScreen(pen.camera, CELLS * 0.5, CELLS * 0.5, (RIM + UPLIFT * epoch) * STEP_PX, pt);
  return pt.y + pen.snapY;
}

/** Screen y of the water, on the canyon's own axis, at the same place {@link rimScreenY} takes the
 *  rim — so the gap between the two is the drop and nothing else. */
export function riverScreenY(pen: Pen, epoch: number, cut: number): number {
  gridToScreen(pen.camera, CELLS * 0.5, CELLS * 0.5, (RIM + UPLIFT * epoch - cut) * STEP_PX, pt);
  return pt.y + pen.snapY;
}

/**
 * Everything one frame's tiles need that is the same for all of them.
 *
 * Assembled once in {@link paintCanyon} rather than passed as six more parameters, and rather than
 * recomputed per tile: `hazeFar` and `nearRim` are each a division, and the near tableland alone is
 * a thousand tiles.
 */
interface Shot {
  readonly seed: number;
  /** Height units the rock has risen since epoch zero. The strata ride it. */
  readonly rise: number;
  /** `gx + gy` at which the rock has completely dissolved into `air`. */
  readonly gone: number;
  /** `gx + gy` at which the foreground band starts to darken. */
  readonly near: number;
  /** World y one tile below the bottom of the frame. */
  readonly floor: number;
  /** World y one tile above the top of the frame. */
  readonly ceiling: number;
}

/**
 * The Terrain pass.
 *
 * The walk is here rather than in `main.ts` for the reason `docs/GALLERY.md` § Which module is
 * which asks for: it is drawing plumbing, it belongs beside the drawing it plumbs, and putting it
 * in the wiring file would spend the logic budget on a nested loop.
 *
 * The `HeightField` is built here, per frame, on purpose. It is two objects and a closure over a
 * buffer that already exists — nothing per tile and nothing per entity — and building it here
 * rather than holding one is what keeps this module free of state that outlives a frame. A
 * `tileSourceOf` view rather than a `TileGrid` copy is the other half of that: a `TileGrid` is an
 * integer store, so mirroring twelve thousand doubles into one every step would cost a full grid
 * write *and* quantise the state the next step reads.
 */
export function paintCanyon(pen: Pen, time: DeepTime, visible: Readonly<TileRange>): void {
  const s = time.state;
  const rise = UPLIFT * time.epoch;
  const field: HeightField = {
    heights: tileSourceOf((gx, gy) =>
      (gx < 0 || gy < 0 || gx >= N || gy >= N ? 0 : bench(at(s, gy * N + gx), rise))),
    stepPx: STEP_PX,
  };
  // `visibleTileBounds` answers with the grid-space **bounding box** of the screen, and says so:
  // the visible region is a diamond and the box over-covers it by about 2x — and here it is worse
  // than that, because `renderFrame` widens *both* axes of the box by the height margin while
  // elevation only ever displaces a tile along `gx + gy`. Both of the diamond's axes are
  // recoverable here for four divisions. Screen x is exactly `(gx - gy) * HALF_W` and nothing
  // else, so the band of `gx - gy` that can be on screen is exact; screen y is
  // `(gx + gy) * HALF_H - h * STEP_PX`, so the band of `gx + gy` is exact once `h` is bracketed,
  // which is what `LOW` and `CAPROCK` are for. Together with the horizon cull below they take this
  // pass from about 4,900 tiles to about 2,700 on the opening frame.
  const halfU = pen.camera.viewW / (2 * pen.camera.zoom * HALF_W) + 2;
  const u0 = pen.camera.x / HALF_W - halfU, u1 = pen.camera.x / HALF_W + halfU;
  const halfY = pen.camera.viewH / (2 * pen.camera.zoom);
  const gone = hazeFar();
  // **`Math.ceil`, and it is the whole of this exhibit's `NaN` story.** These bounds are real
  // numbers — the frame's edge falls where it falls, at 81.8 diagonals, not 82 — and a `d` that
  // starts fractional stays fractional, so `gy = d − gx` is fractional, so `gy * N + gx` addresses
  // *between* two cells of a typed array, which is `undefined`, which is `NaN` the moment it is
  // multiplied. `draw` then refuses the tint and the frame is black. Two separate builds of this
  // exhibit shipped that, from two different fractional bounds, and both times the guard belonged
  // here at the computation rather than at `isoTerrain`, which was working correctly.
  const d0 = Math.max(Math.ceil(gone), visible.gx0 + visible.gy0,
    Math.floor((pen.camera.y - halfY + LOW * STEP_PX) / HALF_H));
  // The near end of the walk — see {@link CAPROCK}. The `− 2` is the tile's own depth: a row at `d`
  // reaches down to its south corner at `d + 2`, so the last row that has to be drawn is two short
  // of the diagonal whose *flat* surface crosses the bottom of the frame. Getting that wrong by one
  // is a seam of sky along the bottom edge, which is why it is written down rather than absorbed.
  const d1 = Math.min(visible.gx1 + visible.gy1,
    Math.ceil((pen.camera.y + halfY + (CAPROCK + rise) * STEP_PX) / HALF_H) - 2);
  // Everything about *this* frame that every tile needs and no tile should recompute: how far the
  // rock has risen, where the haze and the foreground bands start, and the world y of the bottom of
  // the frame plus one tile, so a quad half in shot still paints. One object per frame, which is
  // what `field` above already costs; non-negotiable 7 is about the per-tile path, and this is the
  // thing that keeps eleven divisions off it.
  const shot: Shot = {
    seed: time.seed,
    // **The strata ride the uplift**, and they have to: the bands are bedding planes *in the rock*,
    // so a section pinned to absolute elevation would slide the caprock off the plateau over a
    // million years and never expose the base of the sequence in the gorge. Subtracting it means
    // the tableland stays caprock for the whole run while the river cuts down through bed after
    // bed — the exhibit's time axis made visible, and the thing a visitor counts.
    rise,
    gone,
    // Hung off the frame rather than off a landform, because along the length of the canyon there
    // is no landform to hang it on: every diagonal looks like the last one and "near" means nothing
    // but *near the camera*. The bottom edge, in diagonals, less the run-up.
    near: (pen.camera.y + halfY) / HALF_H - NEAR_LIFT,
    floor: pen.camera.y + halfY + 2 * HALF_H,
    ceiling: pen.camera.y - halfY - 2 * HALF_H,
  };
  for (let d = d0; d <= d1; d++) {
    const lo = Math.max(visible.gx0, d - visible.gy1, Math.ceil((d + u0) * 0.5));
    const hi = Math.min(visible.gx1, d - visible.gy0, Math.floor((d + u1) * 0.5));
    for (let gx = lo; gx <= hi; gx++) rock(pen, field, s, shot, gx, d - gx);
  }
  trail(pen, s, time.cut, rise);
}

/** One tile of ground, and whatever is standing on it. */
function rock(pen: Pen, field: HeightField, s: State, shot: Shot, gx: number, gy: number): void {
  const { seed, rise } = shot;
  if (gx < 0 || gy < 0 || gx >= CELLS || gy >= CELLS) return;
  const i = gy * N + gx;
  // The four corners **as drawn** — {@link bench}ed, the same values `field` hands `isoTerrain`.
  // Shading the raw field while drawing the snapped one puts the rim light and the bedding stroke
  // a tile away from the riser they belong to, which is visible and looks like a registration
  // error rather than like rock.
  const north = bench(at(s, i), rise), east = bench(at(s, i + 1), rise);
  const west = bench(at(s, i + N), rise), south = bench(at(s, i + N + 1), rise);
  // Off the bottom of the frame, and this check is still worth its four comparisons now that
  // {@link CAPROCK} has taken most of its work away. The `d` band above is bracketed against the
  // *tableland*, because a bracket has to hold for every tile in the row and the flat ground is the
  // highest thing in it; anything standing lower — the whole near wall, every bench, the gorge
  // floor — passes under the bottom edge a row or two earlier than the bracket allows for. Four
  // heights already in registers answer exactly rather than in the worst case, which is the
  // difference between a bracket and a cull.
  if ((gx + gy) * HALF_H - Math.max(north, east, west, south) * STEP_PX > shot.floor) return;
  // And off the top, which the plateau above the far rim makes worth its four comparisons: the
  // `d` band is bracketed against `LOW`, the *lowest* ground anywhere, because a bracket has to
  // hold for every tile in the row, and the tableland stands twenty-five units above that. Since
  // the rim line moved out to leave a flat plateau along the top of the frame, that bracket is
  // twenty diagonals of ground the camera cannot see.
  if ((gx + gy) * HALF_H - Math.min(north, east, west, south) * STEP_PX < shot.ceiling) return;
  const e = (north + east + west + south) * 0.25;
  // Steepness across the tile, in units. One number, and it decides rock from tableland, where
  // the rim light lands, and where scree can rest.
  const steep = Math.max(Math.abs(east - west), Math.abs(north - south));
  /**
   * **Which wall of the gorge this tile is on, and which way its face is turned.**
   *
   * `east − west` is the screen *horizontal*, which is the sun's axis and the axis the gorge is now
   * cut across: positive is a face falling away to the left, negative one falling away to the
   * right, so the left wall and the right wall have opposite signs and the whole canyon has a lit
   * side and a shadowed side. That is the strongest thing this viewpoint has going for it, because
   * it is the one cue an orthographic projection gives away for free once the walls are in profile.
   *
   * **This is the same term the previous viewpoint had to take on `north − south`, and the finding
   * behind it survives the turn**: `isoTerrain` shades a tile by `east − west` and *only* by
   * `east − west`, so a landform whose gradient runs along `gx + gy` gets no relief from the kit at
   * all. Cut across the frame the canyon was exactly that landform and the wall rendered as
   * flat-shaded texture; cut along it the gradient is back on the axis the kit reads, and the
   * doubling here is deliberate rather than compensating. The relief axis still wants to be an
   * option on `HeightField` — the next exhibit with a ridge along the other diagonal will hit it.
   */
  const face = clamp(east - west, -3.4, 3.4) / 3.4;
  const d = gx + gy;
  const haze = clamp01((shot.gone + HAZE_SPAN - d) / HAZE_SPAN);
  const near = clamp01((d - shot.near) / NEAR_SPAN);
  const depth = clamp01((RIM + rise - e) / DEEP);
  /**
   * **The shadowed wall — one side of the gorge in shade, and the whole reason it reads as a hole.**
   *
   * The sun is from the screen-left, so the wall whose face is turned right — `face` negative — sees
   * none of it, and the deeper it stands below the rim the less bounce reaches it. Two clamps: how
   * far below the rim, ramped over two units so the lip is an **edge** rather than a fade, and how
   * hard the face is turned away.
   *
   * Cut across the frame this term had a different job — it was the *near* wall, compressed to a
   * hundred and fifty pixels by the projection and recoverable only by value, because geometry could
   * not give it back. Turned along the frame there is no near wall and no far wall; there is a left
   * one and a right one, they are the same size, and the light is what tells them apart. That is the
   * trade this viewpoint makes and it is worth naming: the previous one bought its depth from
   * occlusion and lost a wall to compression; this one keeps both walls and has to buy its depth
   * from light and haze instead.
   */
  const pit = clamp01((RIM + rise - e) * 0.5) * clamp01(-face * 1.6);
  const grain = (toUnit(hash2(seed, gx, gy)) - 0.5) * 0.04;

  // The section, from the height the tile is **drawn** at — see {@link bench}. The noise is small
  // and getting smaller: it used to ragged the contact between two bands on a continuous surface,
  // and the snap now does that job better, in plan, by putting the boundary exactly where the rock
  // crosses the bedding plane. Any more than this and it speckles the two bands into each other.
  const bedding = e - rise + noise2(seed ^ 0x3d, gx * 0.34, gy * 0.34) * 0.12;
  let band = 0;
  while (band < BEDS.length && bedding < (BEDS[band] ?? 0)) band++;
  let ink: Ink = pen.palette.get(SECTION[band] ?? 's7');

  // Desert surface: only on ground gentle enough to hold soil, and only up on the tableland.
  const flat = clamp01((0.7 - steep) * 2) * clamp01((e - rise - 36) * 0.16) * (1 - pit);
  if (flat > 0) ink = mix(ink, pen.palette.get('scrub'), flat * 0.55);
  // Talus. Fresh scree is paler than the wall it fell from and collects on the moderate slopes at
  // the foot of the steep ones — which is exactly where the model puts it.
  const scree = clamp01((steep - 0.5) * 2.2) * clamp01((1.9 - steep) * 1.4) * clamp01(depth * 2.6) * (1 - pit * 0.75);
  if (scree > 0) ink = mix(ink, pen.palette.get('bone'), scree * 0.4);
  if (depth > 0) ink = mix(ink, pen.palette.get('shade'), depth * depth * 0.5);
  // The wall turned away from the camera — the underside of the lip the visitor is standing on —
  // goes into shadow rather than merely dark. A gorge with one lit wall and one shadowed one is
  // the whole difference between a fold in the ground and a hole in it.
  if (face < 0) ink = mix(ink, pen.palette.get('shade'), -face * 0.15);
  if (pit > 0) ink = mix(ink, pen.palette.get('shade'), pit * 0.3);
  // The rim: the top of any steep face, and nothing else in the frame is this warm.
  const lit = clamp01((e - rise - RIM + 4) * 0.35) * clamp01((steep - 0.4) * 1.8);
  if (lit > 0) ink = mix(ink, pen.palette.get('sun'), lit * 0.5);

  const wet = clamp01((at(s, CELL_COUNT + i) - WET) * 0.018);
  if (wet > 0) ink = mix(ink, mix(pen.palette.get('silt'), pen.palette.get('water'), wet), wet * 0.92);
  // Both ends of the distance cue, and they are one cue.
  //
  // **Cubed, and the exponent is the whole argument with the physics.** Linear haze is what the
  // air actually does and it is unusable here: the far rim is twice as far away as the water at the
  // bottom of the wall, so a linear ramp that dissolves the rim washes half the *subject* out with
  // it and the exhibit's best-looking surface goes to pale blue mush. The cube keeps the ratio at
  // the far end — where it is doing the work of saying "miles" — and gives the wall its color back
  // within a few tiles of the rim, which is what a photograph of a canyon actually looks like.
  // At `haze` of 1 the mix is still exactly `air`, which is the seam with the sky and the reason
  // the tiles past it can be skipped entirely.
  if (haze > 0) ink = mix(ink, pen.palette.get('air'), haze * haze * haze);
  if (near > 0) ink = mix(ink, pen.palette.get('ink'), near * 0.18);

  const painted = isoTerrain(pen, field, gx, gy, ink, undefined,
    1 + (grain * (1 + near * 1.3) + face * 0.21) * (1 - haze * 0.5) - depth * 0.18 - pit * 0.16);
  // Everything below reads the four corners `isoTerrain` left in `pen.xy`, so none of it costs a
  // projection — but each one is a *draw call*, and one per tile of a full-frame terrain is five
  // thousand of them. So § Scale's "spend the detail where the eye is" lives in these six lines:
  // nothing decorates in the haze, nothing decorates when the camera is far enough out that it
  // would be a single pixel, and only the tiles a hash picks decorate at all. The count that
  // matters is hundreds on screen, not one per tile.
  if (haze > 0.72 || pen.camera.zoom < 0.4) return;
  const pick = hash2(seed ^ 0x5c1, gx, gy);
  if (steep > 2.2) {
    // Two edges only, at the tile's own hue: it reads as a bedding plane in the face rather than
    // as a wireframe over the terrain, and it is what makes the bands countable.
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.66 + pit * 0.95), 0.4 * (1 - haze * haze)), 1);
  }
  if (wet > 0.25) river(pen, painted, wet, gx, gy);
  // Twice as many trees in the near band, and they are the cheapest scale reference in the frame:
  // the eye knows how big a tree is, so a rim fringed with them is a rim with a size on it.
  else if (flat > 0.5 && (pick & (near > 0.35 ? 7 : 15)) === 0) juniper(pen, painted, pick, near);
  else if (scree > 0.4 && (pick & 15) === 1) rubble(pen, painted, pick, scree);
}

/** Tile center, from the four corners already in `pen.xy`. */
function midX(pen: Pen): number {
  return (at(pen.xy, 0) + at(pen.xy, 2) + at(pen.xy, 4) + at(pen.xy, 6)) * 0.25;
}
function midY(pen: Pen): number {
  return (at(pen.xy, 1) + at(pen.xy, 3) + at(pen.xy, 5) + at(pen.xy, 7)) * 0.25;
}

/**
 * The river: a thin bright thread down the middle of the wet tile, and sun moving on it.
 *
 * A thread rather than a filled tile, and that is a scale decision rather than a stylistic one.
 * The Colorado is about a hundred metres across at the bottom of a sixteen-kilometre-wide gorge,
 * so anything that reads as a *ribbon* from the rim silently tells the eye the canyon is a
 * hundred times smaller than it is. `pen.t` is a clock and this is a pixel, so Tier B is free
 * here — which is the whole contrast with `erosion.ts`, where the same call is a different canyon.
 */
function river(pen: Pen, base: number, wet: number, gx: number, gy: number): void {
  const shimmer = Math.sin(pen.t * 2.1 + (gx + gy) * 0.9) * 0.5 + 0.5; /* @tier-b pixels only */
  const z = pen.camera.zoom;
  pen.surface.ellipse(midX(pen), midY(pen), 9.5 * z, 2.5 * z,
    withAlpha(mix(base, pen.palette.get('water'), 0.95), 0.62 + wet * 0.38));
  pen.surface.ellipse(midX(pen) + 4 * z, midY(pen), 3.4 * z, 1.1 * z,
    withAlpha(pen.palette.get('sun'), (0.25 + shimmer * 0.55) * wet));
}

/**
 * A juniper on the rim: three pixels of trunk and a dark crown, and it is the most valuable
 * object in the frame.
 *
 * A canyon with nothing of known size in it is a texture — the eye has no way to tell a
 * six-thousand-foot wall from a six-foot bank, and the model cannot help. One recognisable thing
 * at a known scale fixes the whole picture, and a tree does it for four draw calls. The near ones
 * are drawn a little larger than the far ones for the same reason the near band is darker: two
 * sizes of the same known object is a distance, where one size is only a texture.
 */
function juniper(pen: Pen, base: number, h: number, near: number): void {
  const cx = midX(pen) + ((h >>> 8 & 15) - 8) * pen.camera.zoom;
  const cy = midY(pen) + ((h >>> 16 & 7) - 4) * pen.camera.zoom * 0.5;
  const z = pen.camera.zoom, tall = (3.4 + (h >>> 22 & 3) * 0.7) * (1 + near * 0.45) * z;
  pen.surface.ellipse(cx + tall * 0.7, cy + 1 * z, tall * 0.9, tall * 0.34, withAlpha(0x000000ff, 0.22));
  pen.xy[0] = cx; pen.xy[1] = cy;
  pen.xy[2] = cx; pen.xy[3] = cy - tall;
  pen.surface.stroke(pen.xy, 2, false, mix(base, pen.palette.get('ink'), 0.6), 1.2 * z);
  pen.surface.ellipse(cx, cy - tall, tall * 0.62, tall * 0.72, mix(base, pen.palette.get('scrub'), 0.82));
}

/** Scree at the foot of a wall: pale chips, and one boulder in eight tiles with a shadow under it
 *  — the second thing in the frame with a size the eye can name. */
function rubble(pen: Pen, base: number, h: number, scree: number): void {
  const cx = midX(pen), cy = midY(pen), z = pen.camera.zoom;
  const pale = mix(base, pen.palette.get('bone'), 0.55);
  for (let k = 0; k < 3; k++) {
    const j = hash2(h, k, 1);
    const r = (1.2 + (j >>> 20 & 7) * 0.3) * z;
    pen.surface.ellipse(cx + ((j >>> 8 & 31) - 16) * z, cy + ((j >>> 14 & 15) - 8) * z * 0.5,
      r, r * 0.6, withAlpha(pale, 0.55 * scree));
  }
  if ((h & 7) === 1) {
    pen.surface.ellipse(cx, cy + 2 * z, 5.5 * z, 2.6 * z, withAlpha(0x000000ff, 0.3));
    pen.surface.ellipse(cx, cy - 2 * z, 5 * z, 4 * z, shade(pale, 1.06));
  }
}

/**
 * A trail switchbacking down the far wall.
 *
 * § *A mile deep has to feel a mile deep* lists four things worth putting in shot to size a canyon
 * against and says one of them beats a thousand feet of height field. This is the one that is
 * unmistakably human. Nothing else in the frame has a width anybody knows, and a path a person
 * could walk down is read as about a yard across whether or not the thought is ever finished —
 * after which the wall it is cut into has a size, and five switchbacks say the rest. A wall that
 * takes five to get down is not a bank.
 *
 * **Drawn as a screen-space polyline rather than as tinted tiles**, and that is a legibility
 * decision with a number behind it: a tile is fifty screen pixels across at the opening zoom, so
 * the narrowest trail the tile grid can express is fifty pixels wide, which is a road. The line
 * samples the live height field at forty-one points, so it hugs whatever the model has cut this
 * frame rather than a shape somebody drew once, and it costs two strokes.
 *
 * Painting it *over* the finished terrain is safe now for a simpler reason than it used to be: the
 * gorge runs away from the camera, so along any line of constant `gx − gy` the surface descends the
 * screen monotonically and nothing drawn later can be above anything drawn earlier. The turn cost
 * this exhibit its occlusion and paid it back in never having to reason about occlusion again.
 *
 * It descends the **right** wall, the lit one: on the shadowed wall a pale line reads as a scratch
 * rather than as a path, and the one object in the frame with a human width has to be legible or it
 * is only noise. Seen from inside the gorge a switchback zigzags *along* the canyon while it works
 * its way *across* the wall, which is the opposite of how it looked from the rim — the legs are the
 * long axis now and the descent is the short one.
 */
function trail(pen: Pen, s: State, cut: number, rise: number): void {
  // Before there is a wall there is no trail down it, and the rim would sit on top of the river.
  if (cut < 4) return;
  const rim = rimU(cut);
  const fade = clamp01((HORIZON + HAZE_SPAN - TRAIL_D) / HAZE_SPAN);
  for (let k = 0; k < TRAIL_PTS; k++) {
    const f = k / (TRAIL_PTS - 1);
    // A triangle wave in the leg count: `|(leg mod 2) − 1|` runs 1 → 0 → 1 and never repeats a
    // corner, so the switchbacks alternate instead of drifting one way down the face. The swing is
    // now *along* the canyon and the descent is *across* it, which is the turn in two lines.
    const leg = f * TRAIL_LEGS;
    const d = TRAIL_D + (Math.abs((leg % 2) - 1) * 2 - 1) * TRAIL_SWING;
    const u = rim * (1 - f);
    // Clamped into the grid before the index is formed, not after. The path cannot leave the map
    // at the constants above, but an index one cell past the end of a typed array is `undefined`,
    // which is `NaN`, and this exhibit has black-framed itself twice on exactly that shape.
    const gx = clamp((d + u) * 0.5, 1, N - 2), gy = clamp((d - u) * 0.5, 1, N - 2);
    gridToScreen(pen.camera, gx, gy, bench(at(s, (gy | 0) * N + (gx | 0)), rise) * STEP_PX, pt);
    pen.xy[k * 2] = pt.x + pen.snapX;
    pen.xy[k * 2 + 1] = pt.y + pen.snapY - 1;
  }
  pen.surface.stroke(pen.xy, TRAIL_PTS, false, withAlpha(pen.palette.get('ink'), 0.26), 2.8);
  pen.surface.stroke(pen.xy, TRAIL_PTS, false, withAlpha(pen.palette.get('bone'), 0.6 - fade * 0.3), 1.3);
}
