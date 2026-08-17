/**
 * The ground, the water, and the line where they meet.
 *
 * @art
 *
 * Delete this file and the island is an unpainted heightfield: everything here decides what a
 * tile *looks* like and nothing here decides what a tile *is*. `island.ts` hands over one signed
 * number per vertex and this module turns it into six kinds of surface, a tide, surf, and the
 * band of distance that separates the far range from the near shore.
 *
 * ## The shoreline is a contour, not a set of neighbours
 *
 * Because the seabed arrives signed and continuous, the waterline is simply `bed === 0` and the
 * beach is a band either side of it. That is what makes the tide possible at all: the surf line
 * is `bed ≈ reach(t)` for a `reach` that oscillates, so the water genuinely runs *up* the sand
 * and back down it, wetting the tiles it covered and leaving foam at its high mark. A terrain
 * grid of five constants can only ever switch a tile between sand and water, which is a shoreline
 * that flickers rather than one that breathes.
 *
 * The wave is a travelling one — its phase carries `gx + gy`, the depth axis — so it arrives
 * along the screen diagonal instead of the whole coast pulsing in unison, which is the tell that
 * gives away every animated-in-place shoreline.
 *
 * ## The haze is a line, not a ring
 *
 * The draft this replaces faded the sea out on a *circle* centered on one island, which is what
 * a diorama does: it announces that the world is a disc with a rim. Here the fade runs on
 * `island.ts`'s `v` — the screen's own depth axis — so it is a horizontal band across the top of
 * every frame at every zoom, and what emerges out of the top of it is a mountain range rather
 * than the edge of a map. It is applied to **land and water alike**, and it does three things at
 * once, which is what separates aerial perspective from a wash:
 *
 * | | | why the one after it is not enough |
 * |---|---|---|
 * | **hue** | every color converges on {@link passAir} | it is the only cue an orthographic camera leaves you |
 * | **saturation** | the target is the sky pulled toward white, never the `sky` slot | mixing a green toward a saturated cyan trades one loud color for another |
 * | **contrast** | grain, glint, caustic, foam, seam and grass all fade out with it | a visible tile edge at the horizon is the loudest way a world admits it is a grid |
 *
 * ## Why the grain goes through `tint` and never through a second `shade`
 *
 * `isoTerrain` folds the relief term and the game's own texture into **one** `shade` call because
 * `shade` pulls toward a cool or a warm tint by distance from neutral: shading twice tints twice
 * and the ground goes muddy. Every per-tile variation this module has — two scales of noise, the
 * moisture that decides grass from meadow, the wetness of sand — is therefore a multiplier handed
 * in as `tint`, and the only second passes are ones that read the color `isoTerrain` returned.
 *
 * Both second passes also read the four corners `isoTerrain` left in `pen.xy`, so foam, glint,
 * seam and every blade of grass cost no projection at all.
 */
import { clamp01, hash2, noise2, toUnit } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_H, TILE_W, slopeAt, type TileRange } from '@latticekit/iso';
import { isoTerrain, mix, shade, withAlpha, type Ink, type Pen } from '@latticekit/draw';
import { MAIN_V, MAX_HEIGHT_PX, SKY_V, STEP_PX, W, H, bedAt, type Island } from './island.js';

/**
 * Where the *edge* of the world has finished dissolving. See {@link SKY_V}: three tiles, and its
 * only job is that the last row of water reaches the sky color exactly rather than stopping.
 */
const EDGE_V = SKY_V + 3;
/**
 * Where the **air** stops tinting, and how far it can pull a color before it does.
 *
 * This is the depth answer and it is applied harder than looks right in a still: by the far
 * waterline half of every color is sky, and by the far range's foot it is three quarters. That is
 * aerial perspective, and the reason to overdo it is that an isometric projection gives the eye
 * *no other* distance cue — no convergence, no size falloff, nothing. A far island rendered at
 * full saturation is not a far island, it is a texture swatch at the top of the frame, and it
 * pulls the eye off the land the exhibit is about.
 *
 * It runs from the near shoreline all the way out rather than from the horizon inward, because
 * the failure it fixes is a *band* of hard blue-and-white diamonds along the top, and a fade that
 * only starts near the horizon leaves that band exactly where it was.
 */
const AIR_V = MAIN_V + 2;
/** How far toward {@link passAir} the air alone can pull a color. Capped short of 1 so the far
 *  range keeps a silhouette: a ridge the same color as the water behind it is not distance, it
 *  is a missing ridge, and {@link EDGE_V} is what closes the last of the gap. */
const AIR = 0.95;
/**
 * Past this much haze nothing sharp is drawn: no foam, no glint, no caustic, no seam, no grass.
 *
 * The cutoff is the *composition* fix and the frame-time saving arrives with it. Every one of
 * those is drawn as a whole tile quad, so at distance they stop being texture and become a quilt
 * of hard diamonds — and a visible tile edge on the horizon is the single loudest way a world can
 * announce that it is a grid. § Scale asks the far band to be dimmer; on open water that means
 * very nearly featureless rather than merely a paler blue.
 */
const SHARP = 0.4;

/** How far up the beach the water reaches at high swell, in height units. Tuned against the
 *  shore ramp in `island.ts`: much more and the surf climbs into the dunes. */
const REACH = 1.25;
/** How many height units of water are worth grading. Past it the channel is one blue. */
const DEEP = 13;

/** The travelling swell at a tile, 0 (drawn back) to 1 (run up). */
function swellAt(pen: Pen, gx: number, gy: number): number {
  return Math.sin(pen.t * 0.85 + (gx + gy) * 0.19) * 0.5 + 0.5; /* @tier-b pixels only */
}

/**
 * The Terrain pass, in one call.
 *
 * The walk lives here rather than in `main.ts` for two reasons, and only the second is about the
 * line rule. `TileGrid.forEach` takes a visitor and does not pass a context, and its own doc
 * comment asks callers to **hoist** the visitor rather than allocate one per frame — so the pen
 * and the frame's two scalars have to reach it through variables like the four below. Doing that
 * in the exhibit's wiring file puts five lines of pure drawing plumbing in the file the next
 * reader has to understand; doing it here puts it beside the drawing it plumbs. That a visitor
 * with no context parameter forces this on every caller is filed as a kit finding.
 */
let pass: Pen | undefined;
let passIsland: Island | undefined;
let passDay = 1;
let passNight = 0;
/**
 * What distance converges on, computed once a frame rather than once a tile.
 *
 * **Not the `sky` slot itself**, and that is the whole difference between haze that works and
 * haze that does not. At noon `sky` is a fully saturated cyan, so mixing a green hillside toward
 * it trades one saturated color for another and the far range stays as loud as the near one —
 * which is what the first attempt at this shipped. Real distance loses *saturation* before it
 * loses hue, so the target is the sky pulled a third of the way to white by day and barely at all
 * at night, when a far ridge should go dark rather than pale.
 */
let passAir = 0;
/**
 * The frame's screen box, and the reason this module has one at all.
 *
 * `Camera.visibleTileBounds` returns the *grid rectangle* covering the screen, and says in its own
 * doc that it over-covers by roughly 2× — the visible region is a diamond in grid space and a
 * rectangle is the cheapest thing that contains one. `renderFrame` then margins that rectangle by
 * `Passes.maxHeightPx / TILE_H` **on all four sides**, because a summit whose base has left the
 * bottom edge still has to be painted. This exhibit's tallest ground is 496 px, which is fifteen
 * tiles, so at the opening zoom the visitor below is offered about 8,800 tiles to paint 2,000
 * with — and the four hundred sprites in the same frame cost two milliseconds between them.
 *
 * So the visitor rejects on the tile's own screen position before it touches the heightfield, the
 * hashes or the noise. Two multiply-adds against a box computed once a frame, and the margin ring
 * costs what it should: nothing. The box is asymmetric on purpose — a tile above the top of the
 * screen can only draw *further* up, so it is gone, while one below the bottom may still be the
 * foot of a mountain whose summit is in shot.
 *
 * That a caller has to write this to get the cull it already asked `renderFrame` for is filed as
 * a kit finding: the margin an exhibit needs is one-sided, and `maxHeightPx` is a scalar.
 */
let passMaxSx = 0;
/** See {@link passMaxSx}. */
let passMinSy = 0;
/** See {@link passMaxSx}. */
let passMaxSy = 0;

const visit = (gx: number, gy: number): void => {
  if (pass !== undefined && passIsland !== undefined) terrainTile(pass, passIsland, gx, gy, passDay, passNight);
};

export function paintTerrain(pen: Pen, island: Island, visible: Readonly<TileRange>, daylight: number, night: number): void {
  pass = pen;
  passIsland = island;
  passDay = daylight;
  passNight = night;
  passAir = mix(pen.palette.get('sky'), 0xffffffff, 0.1 + daylight * 0.3);
  passMaxSx = pen.surface.width + TILE_W;
  passMinSy = -TILE_H * 2;
  passMaxSy = pen.surface.height + MAX_HEIGHT_PX * pen.camera.zoom + TILE_H;
  island.bed.forEach(visible, visit);
}

/**
 * One tile: choose the surface, hand `isoTerrain` this exhibit's own grain, then decorate.
 *
 * `night` is `1 − daylight` and is passed rather than derived so that every use of it in the
 * frame is the same number — the surf's phosphorescence and the sky's stars appearing at
 * different thresholds is a thing you can see and cannot name.
 */
function terrainTile(pen: Pen, island: Island, gx: number, gy: number, daylight: number, night: number): void {
  // The bed grid is one wider than the tile map — heights live on vertices — so its `forEach`
  // offers a final row and column of tiles that have no south-east corner. Skipped here rather
  // than in the caller, because a caller that has to know this is a caller that will forget.
  if (gx >= W || gy >= H) return;
  // The screen cull, first, because everything below it costs more. See {@link passMaxSx}.
  const sx = pen.camera.toScreenX((gx - gy) * HALF_W);
  if (sx < -TILE_W || sx > passMaxSx) return;
  const sy = pen.camera.toScreenY((gx + gy) * HALF_H);
  if (sy < passMinSy || sy > passMaxSy) return;
  const v = (gx + gy + 1) * 0.5;
  if (v < SKY_V) return;
  // Two terms and a max, because they answer two different questions. `air` is distance and runs
  // the whole depth of the picture; `edge` is the world *stopping* and runs over three tiles at
  // the horizon. Both are smoothstepped rather than linear: a linear ramp leaves a visible crease
  // where it begins, and a square holds full color for most of its band and then drops, which
  // reads as a stripe rather than as air. Gentle at both ends is the only curve that reads as
  // distance at all.
  const a = clamp01((AIR_V - v) / (AIR_V - SKY_V));
  const t = clamp01((EDGE_V - v) / (EDGE_V - SKY_V));
  const air = a * a * (3 - 2 * a) * AIR;
  const edge = t * t * (3 - 2 * t);
  const haze = edge > air ? edge : air;
  if (haze > 0.985) return;
  const e =
    (bedAt(island, gx, gy) +
      bedAt(island, gx + 1, gy) +
      bedAt(island, gx + 1, gy + 1) +
      bedAt(island, gx, gy + 1)) /
    4;
  // Both grains are scaled *down* by the haze, and that is a composition fix rather than a
  // saving. Per-tile variation at a distance nobody can resolve does not read as texture; it
  // reads as a quilt of diamonds, and a quilt is the one pattern that tells a viewer they are
  // looking at a grid. The far range wants a silhouette and a value, and nothing else.
  const near = 1 - haze;
  const grain = (toUnit(hash2(island.seed, gx, gy)) - 0.5) * 0.09 * near;
  const patch = noise2(island.seed ^ 0x9e1, gx * 0.14, gy * 0.14) * 0.09 * near;
  const reach = -0.3 + swellAt(pen, gx, gy) * REACH;

  let painted = 0;
  if (e < 0) water(pen, island, gx, gy, e, 1 + grain * 0.6 + patch * 0.5, daylight, night, haze);
  else painted = land(pen, island, gx, gy, e, reach, 1 + grain + patch);
  // **The air, as a quad over the tile that was just painted, and this is the only thing that
  // actually collapses contrast.** Mixing the *ink* toward the sky before handing it over cannot:
  // `isoTerrain` adds its relief term after `tint` and shades by a fixed ±0.32, so a hazed
  // hillside keeps every bit of its face-to-face contrast and every one-unit step in its height
  // field, and the far range comes out as a quilt of hard diamonds in pale colors instead of
  // saturated ones. A wash over the finished tile takes the relief, the height stepping, the
  // moisture field and the hue toward {@link passAir} together and in proportion — which is what
  // distance does — and it costs one polygon on a tile that has already been told to skip its
  // foam, its glint, its seam and its grass. `isoTerrain` draws a single quad and leaves the four
  // corners in `pen.xy`, so there is no skirt to miss and no projection to repeat.
  if (haze > 0.05) pen.surface.poly(pen.xy, 4, withAlpha(passAir, haze));
  // Nothing sharp survives past here: a breaking wave two hundred metres out is a smudge, and
  // drawing one is what makes a fade look like a fade rather than like distance.
  if (haze > SHARP) return;
  // Surf before the grass and the grass last, because {@link tufts} is the one thing in this
  // module that *writes* `pen.xy` — everything above reads the four corners `isoTerrain` left
  // there, and a blade drawn before the foam would hand the foam two of its own points.
  surf(pen, gx, gy, e, reach, night);
  if (painted !== 0) tufts(pen, gx, gy, painted);
}

/**
 * Sea floor: one ink graded from the shallows' turquoise to the channel's blue by depth, a swell
 * glint on the crests, and caustics where the bottom is close enough to catch light.
 */
function water(
  pen: Pen,
  island: Island,
  gx: number,
  gy: number,
  e: number,
  tint: number,
  daylight: number,
  night: number,
  haze: number,
): void {
  // Dithered on **two** scales, and the dither is not decoration. The bed is stored as a whole
  // number of units per vertex, so a straight `-e / span` steps the color once per unit and the
  // water comes out as contour rings — the exact staircase this exhibit rejected a five-constant
  // terrain grid to avoid, reintroduced by the quantisation one level down. One octave of noise
  // hides the step and leaves its own, coarser banding in its place, which is the same bug with a
  // longer wavelength; a second octave at three times the frequency is what actually breaks it.
  // Neither moves the gradient, because both are zero-mean.
  // It is faded out with distance for the same reason the grain is: the second octave is a
  // *per-tile* value by construction, so the thing that breaks a contour up close is the thing
  // that paints a quilt of diamonds far away. Out there the wash has flattened the gradient it
  // was hiding a step in, so there is no step left to hide.
  const jitter =
    (noise2(island.seed ^ 0x1d, gx * 0.55, gy * 0.55) * 2.2 + noise2(island.seed ^ 0x2e, gx * 1.7, gy * 1.7) * 1.1) *
    (0.25 + 0.75 * (1 - haze));
  const depth = clamp01((-e + jitter) / DEEP);
  // The distance tint is **not** applied here. It is one wash over the finished tile, in the
  // caller — see the note there for why a pre-mixed ink cannot do the job.
  const ink = mix(pen.palette.get('shoal'), pen.palette.get('deep'), depth * depth * 0.8 + depth * 0.2);
  const base = isoTerrain(pen, island.field, gx, gy, ink, undefined, tint);
  if (haze > SHARP) return;
  // A slow swell, so still water is not a painted sheet. Two fields at different scales, or the
  // crests line up into stripes.
  const crest =
    noise2(island.seed ^ 0x33, gx * 0.4 + pen.t * 0.24, gy * 0.4) * 0.5 +
    noise2(island.seed ^ 0x77, gx * 0.9, gy * 0.9 + pen.t * 0.31) * 0.5 +
    0.5;
  if (crest > 0.68) {
    const glint = mix(base, pen.palette.get('sky'), 0.7);
    pen.surface.poly(pen.xy, 4, withAlpha(glint, (crest - 0.68) * (1.1 * daylight + 0.4)));
  }
  // Caustics: the bright net that only exists where the bottom is shallow enough to be lit. It
  // is the single cheapest thing that makes a shallow read as *shallow* rather than as pale water.
  if (depth < 0.34) {
    const net = noise2(island.seed ^ 0x5b, gx * 1.5 + pen.t * 0.5, gy * 1.5 - pen.t * 0.3);
    if (net > 0.15) {
      const lit = mix(base, pen.palette.get('foam'), 0.55);
      pen.surface.poly(pen.xy, 4, withAlpha(lit, (net - 0.15) * (0.34 - depth) * (1.4 + daylight)));
    }
  }
  if (night > 0.3 && depth < 0.2) {
    pen.surface.poly(pen.xy, 4, withAlpha(pen.palette.get('bloom'), (0.2 - depth) * night * 0.32));
  }
}

/**
 * Dry land: sand, dune grass, meadow, wood floor or bare rock, chosen by elevation, slope and a
 * moisture field, and darkened where the tide has just been over it.
 *
 * Distance is **not** this function's business. It arrives as one wash over the finished tile in
 * the caller, which is the only place it can take the relief shading with it.
 */
function land(pen: Pen, island: Island, gx: number, gy: number, e: number, reach: number, tint: number): number {
  const slope = slopeAt(island.field, gx, gy) / STEP_PX;
  const wet = clamp01((reach + 0.55 - e) * 1.6);
  // Moisture: hollows and the sheltered side hold the darker, bluer green; ridges and the exposed
  // slopes go pale and yellow. **Three** noise fields, and the count is the whole of why this
  // looks like turf: one octave alone paints the island in two enormous zones with a soft join,
  // which the eye reads as a lighting bug rather than as ground, and it was what the first build
  // shipped. Scale is what makes a texture a texture.
  const damp = clamp01(
    noise2(island.seed ^ 0x2d, gx * 0.12, gy * 0.12) * 0.46 +
      noise2(island.seed ^ 0x4f, gx * 0.31, gy * 0.31) * 0.3 +
      noise2(island.seed ^ 0x6b, gx * 0.74, gy * 0.74) * 0.18 +
      0.52 -
      e * 0.006,
  );
  const green = mix(pen.palette.get('ground'), pen.palette.get('ok'), damp * damp * 0.95);
  // Rock is a *blend*, not a branch. A threshold on slope draws its own contour line across the
  // hillside — a hard-edged brown splotch that reads as damage rather than as scree — and the
  // line moves with the seed, so no single number is ever right. Two ramps, added: one for
  // ground too steep to hold soil, one for the treeline.
  const bare = clamp01((slope - 4.6) / 3.4) * 0.9 + clamp01((e - 31) / 12) * 0.7;
  const soil = bare <= 0 ? green : mix(green, pen.palette.get('rock'), clamp01(bare));
  // **And so is the beach**, for the same reason and a second one. `e < 1.5` was a branch, and a
  // branch on a continuous field dithers wherever the field hovers at the threshold: a tile of
  // sand, a tile of grass, a tile of sand, which reads as a chequerboard rather than as a
  // shoreline. It is at its worst in the far band, where the two colors are the brightest and the
  // darkest things in the picture and the tiles are small enough that the alternation is all you
  // see. A smoothstepped ramp is the same three lines and has no threshold to sit on.
  //
  // Wet sand is not darker sand — it is sand pulled toward the water it is holding, which is why
  // it mixes with `shoal` rather than multiplying the tint down.
  const beach = clamp01((1.9 - e) / 1.3);
  const sand = mix(pen.palette.get('sand'), pen.palette.get('shoal'), wet * 0.5);
  const ink: Ink = beach <= 0 ? soil : mix(soil, sand, beach * beach * (3 - 2 * beach));
  const painted = isoTerrain(pen, island.field, gx, gy, ink, undefined, tint - wet * 0.14);
  // The hairline seam: two edges only, at the tile's own hue, so it reads as a fold in the turf
  // rather than as a wireframe. Three points, not four, which is why it is not `isoTerrain`'s
  // `stroke` argument.
  //
  // **Only where the ground is actually folded.** A stroke per visible land tile is over a
  // thousand `beginPath`/`stroke` pairs a frame, which is the single most expensive thing this
  // module was doing — and on flat meadow it draws a fold that is not there, so the cheap version
  // is also the correct one. Slope is already in hand from the rock ramp above.
  if (slope > 1.2 && pen.camera.zoom > 0.42) {
    pen.surface.stroke(pen.xy, 3, false, withAlpha(shade(painted, 0.88), 0.32), 1);
  }
  // Zero is the "no grass here" answer rather than a second return: an `Rgba` of 0 is fully
  // transparent black, which is not a color any tile is ever painted.
  return e > 1.7 && slope < 5 ? painted : 0;
}

/**
 * Grass, as two blades out of the middle of the tile that just got painted.
 *
 * This is the cheapest population in the exhibit and the one that does the most: a hillside of
 * flat quads reads as a *chart* of a hillside no matter how good the color is, and something
 * vertical at the tile scale is what turns it into ground. There are several hundred of them in
 * any frame and they cost two projected points each, because {@link land} already left the tile's
 * four corners in `pen.xy` and the centroid of four points is three adds and a multiply.
 *
 * They are drawn in the Terrain pass and are therefore under every tree, which is where grass
 * belongs. `pen.xy` is clobbered on the way out; nothing in this tile reads it afterwards, and
 * the next tile's `isoTerrain` rewrites it.
 */
function tufts(pen: Pen, gx: number, gy: number, painted: number): void {
  const k = pen.camera.zoom;
  if (k < 0.45) return;
  const xy = pen.xy;
  const cx = (xy[0] ?? 0) * 0.25 + (xy[2] ?? 0) * 0.25 + (xy[4] ?? 0) * 0.25 + (xy[6] ?? 0) * 0.25;
  const cy = (xy[1] ?? 0) * 0.25 + (xy[3] ?? 0) * 0.25 + (xy[5] ?? 0) * 0.25 + (xy[7] ?? 0) * 0.25;
  const seed = hash2(gx, gy, 7);
  // One blade on a third of the tiles rather than two on nearly half. The population is still in
  // the high hundreds across a frame — the number that matters for § Scale is how many the eye
  // sees, and a second blade eleven pixels from the first is not a second blade to anyone.
  if (toUnit(seed) > 0.34) return;
  const ox = (toUnit(hash2(seed, 1, 0)) - 0.5) * 22 * k;
  const oy = (toUnit(hash2(seed, 2, 0)) - 0.5) * 11 * k;
  // The lean rides the same wind everything else does, one octave and no per-blade phase — at
  // this size the eye reads the field moving, never the individual blade.
  const lean = noise2(0x4e2, gx * 0.05 + pen.t * 0.33, gy * 0.05) * 3 * k;
  xy[0] = cx + ox;
  xy[1] = cy + oy;
  xy[2] = cx + ox + lean;
  xy[3] = cy + oy - (5 + toUnit(hash2(seed, 3, 0)) * 5) * k;
  pen.surface.stroke(xy, 2, false, withAlpha(shade(painted, 1.16), 0.55), Math.max(1, 1.5 * k));
}

/**
 * The surf: a foam band at the water's high mark, and its glow after dark.
 *
 * Drawn last and over both surfaces, because a wave does not care whether the tile under it was
 * classified as sea or as sand — which is the whole point of running the tide off the same
 * continuous number both of them read. There are two coastlines and a chain of sandbars in this
 * world, so this is several hundred tiles of foam in any frame rather than a ring around a disc.
 */
function surf(pen: Pen, gx: number, gy: number, e: number, reach: number, night: number): void {
  const d = Math.abs(e - reach);
  if (d > 1.5) return;
  const band = 1 - d / 1.5;
  // The crest is brightest at the leading edge and trails behind it, so the band has a direction:
  // squared on the dry side, halved on the wet side, which is the whole of why the wave looks
  // like it is running *up* the sand rather than pulsing symmetrically about the waterline.
  const lead = e > reach ? band * band : band * 0.5;
  const crest = mix(pen.palette.get('foam'), pen.palette.get('bloom'), night * 0.8);
  pen.surface.poly(pen.xy, 4, withAlpha(crest, lead * (0.72 + night * 0.24)));
  // A hard bright lip along the two seaward edges of the leading tile: one stroke, and it is what
  // turns a soft band into a breaking wave.
  if (lead > 0.4) {
    pen.surface.stroke(pen.xy, 3, false, withAlpha(mix(crest, 0xffffffff, 0.6), (lead - 0.4) * 1.7), 1.6);
  }
}
