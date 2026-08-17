/**
 * The ground and the water, painted — and the one `draw` finding this exhibit could not avoid.
 *
 * @art
 *
 * Delete this file and the clay still deforms under the brush, the water still finds its way down
 * the valley and into every basin the visitor digs, every walker still routes around the ridge, and
 * the field still hashes to the same numbers. Nothing here holds state that outlives a frame and
 * nothing here returns a value any decision reads: it is handed the live buffers and it paints.
 *
 * ## The finding, which is a live bug and not a historical note
 *
 * > **`isoTerrain` shades a tile by `east − west`, which is the screen *horizontal*.** A landform
 * > whose gradient runs along the other diagonal has a relief term of exactly zero and renders
 * > flat-shaded, with no error and nothing to grep for.
 *
 * `Canyon` paid two rebuilds for this and reported it. In that exhibit it was survivable, because a
 * canyon has one axis and an author can turn it. **Here it is not survivable at all**, and that is
 * the sharper version of the finding this exhibit contributes: *the visitor chooses the axis.* A
 * ridge dragged across the screen runs along `gx − gy`, its gradient runs along `gx + gy`, and
 * under the kit's own relief that ridge is invisible — while the identical ridge dragged the other
 * way is fully shaded. An exhibit whose entire subject is *the thing you just made* cannot ship a
 * renderer in which half of what you make does not appear.
 *
 * So {@link tile} computes `north − south` — one subtraction, the missing axis — and supplies it
 * through `isoTerrain`'s `tint`, which is the documented seam for exactly this. The two together
 * are a full two-axis relief. **The relief axis wants to be an option on `HeightField`**, and until
 * it is, every exhibit with a user-chosen landform will write this same subtraction.
 *
 * ## Why the ground is banded by height as well as shaded by slope
 *
 * Relief reads a *slope*. A broad gentle dome has almost none anywhere on it, so under shading
 * alone a visitor who raises one sees nothing happen until it becomes a cliff — which is the whole
 * exhibit failing at its first gesture. The five bands in `palette.ts` give elevation its own axis:
 * the dome climbs through silt, meadow, grass, scrub and bare rock while it is being made, so *the
 * fact that something changed* arrives before any shading does.
 *
 * The band is measured against the valley's own **datum** — the tilted plane the generator built,
 * `BASE − TILT · (gx + gy)` — rather than against absolute elevation. Against absolute elevation
 * the whole upstream half of the map is one band and the whole downstream half is another, because
 * the valley falls eleven units end to end, and a ridge raised at the bottom would climb bands that
 * a ridge raised at the top had already used up.
 *
 * ## Every color in this file is snapped, and § Scale's trap is why
 *
 * A color that is a continuous function of a height a finger is moving is a fresh cache key at
 * every vertex, every frame — the whole-scene version of the `palette.lerp` bug `City` found. So
 * the light wash is quantized to nine levels, the haze to six, and the water to six: five bands ×
 * nine × six is a bounded set of solid fills, and nothing in this file ever calls `softEllipse` or
 * anything built on it. The *geometry* stays perfectly continuous, which is the half a visitor can
 * actually resolve.
 */
import { clamp } from '@lattice/core';
import { HALF_H, HALF_W, gridToScreen, type TileRange } from '@lattice/iso';
import { isoTerrain, mix, withAlpha, type Pen, type Rgba } from '@lattice/draw';
import type { Vec2 } from '@lattice/core';
import { BASE, CELLS, MAX_UNITS, N, PUDDLE, STEP_PX, TILT, type Clay } from './clay.js';

/** The five ground bands, waterline upward, and the height above the valley datum each unit of the
 *  ramp is worth. See the header — and note that the ramp is *interpolated* between neighbouring
 *  bands rather than stepped: five hard bands on a bumpy field is a mosaic, and the first build of
 *  this exhibit was exactly that. `BAND_H` and `BAND_0` place band 0 at the waterline. */
const BANDS = ['g0', 'g1', 'g2', 'g3', 'g4'] as const;
const BAND_H = 5, BAND_0 = 1.2;
/** Rise per tile, in height units, at which ground stops being ground and becomes bare rock. It is
 *  the same number `life.ts` refuses to walk on, which is not a coincidence: the one thing the
 *  color has to tell a visitor is where a walker will no longer go. */
const CRAG = 1.35;
/** The cross-slope, in height units per tile, at which the second relief axis saturates. Matched to
 *  `draw`'s own `RELIEF_SPAN` so the two axes agree about what "steep" means and a 45° ridge is not
 *  brighter than a 90° one. */
const SPAN = 1.5;
/**
 * How much of the missing axis reaches the tint, how far the warm/cool wash goes, and what the tint
 * sits at on flat ground.
 *
 * `GROUND` is below one on purpose, and the number was **measured off the canvas rather than
 * chosen**. `isoTerrain` adds its own relief of up to ±0.32 to whatever tint it is handed, so a
 * flat-ground tint of 1 puts the brightest lit face at 1.5 — and `shade` at 1.5 on a pale rock
 * clips: a fresh mountain sampled at four points came back `255, 249, 212` at every one of them,
 * which is not a highlight, it is a hole in the image where the shading used to be. At 0.88 the
 * ceiling is 1.35, nothing on the ramp reaches 255, and the shadow side gains the contrast the
 * highlight lost.
 */
const RELIEF = 0.15, WASH = 0.2, GROUND = 0.88;
/** Depth at which water reaches its darkest and its most opaque, and how far above the far edge of
 *  the frame the haze runs. Aerial perspective is the only depth cue an orthographic projection
 *  gives away free. Water is drawn **translucent in the shallows**, so a stream reads as a stream
 *  running over ground you can still see, and a lake reads as a body because it is the one water in
 *  the frame you cannot see the bottom of. */
const DEEPEST = 2.2, HAZE = 22;

/** Everything about this frame that every tile needs and no tile should recompute. One object per
 *  frame; non-negotiable 7 is about the per-tile path, and this is what keeps ten divisions off it. */
interface Shot { far: number; floor: number; ceiling: number }
const shot: Shot = { far: 0, floor: 0, ceiling: 0 };

/**
 * The terrain pass.
 *
 * **Walked by anti-diagonal rather than in rows**, which costs two lines of loop arithmetic and
 * not one extra tile. A 2:1 painter's order is ascending `gx + gy`; row-major is only accidentally
 * that, and here it matters, because the water quad a tile draws stands *above* its own ground and
 * has to be able to overlap the tile in front of it.
 *
 * The cull is the same one `Canyon` measured and for the same reason: `renderFrame` hands over the
 * grid-space **bounding box** of the screen, which over-covers the visible diamond by about 2×, and
 * then widens *both* axes by the height margin while elevation only ever displaces a tile along
 * `gx + gy`. Screen x is exactly `(gx − gy) · HALF_W`, so the band of `gx − gy` that can be on
 * screen is recoverable exactly, for four divisions.
 */
export function paintClay(pen: Pen, clay: Clay, visible: Readonly<TileRange>): void {
  const cam = pen.camera;
  const halfU = cam.viewW / (2 * cam.zoom * HALF_W) + 2, halfY = cam.viewH / (2 * cam.zoom);
  const u0 = cam.x / HALF_W - halfU, u1 = cam.x / HALF_W + halfU;
  // `Math.ceil` / `Math.floor`, and it is the whole of this exhibit's `NaN` story: these bounds are
  // real numbers, a fractional `d` makes `gy = d − gx` fractional, and `gy * N + gx` then addresses
  // *between* two cells of a typed array — which is `undefined`, which is `NaN` the moment it is
  // multiplied, at which point `draw` correctly refuses the tint and the frame goes black.
  const d0 = Math.max(0, visible.gx0 + visible.gy0, Math.floor((cam.y - halfY) / HALF_H));
  const d1 = Math.min(2 * CELLS - 2, visible.gx1 + visible.gy1,
    Math.ceil((cam.y + halfY + MAX_UNITS * STEP_PX) / HALF_H));
  shot.far = (cam.y - halfY) / HALF_H;
  shot.floor = cam.y + halfY + 2 * HALF_H;
  shot.ceiling = cam.y - halfY - 2 * HALF_H;
  for (let d = d0; d <= d1; d++) {
    const lo = Math.max(0, d - CELLS + 1, visible.gx0, d - visible.gy1, Math.ceil((d + u0) * 0.5));
    const hi = Math.min(CELLS - 1, d, visible.gx1, d - visible.gy0, Math.floor((d + u1) * 0.5));
    for (let gx = lo; gx <= hi; gx++) tile(pen, clay, gx, d - gx);
  }
}

/** One tile of ground, and the water standing on it. */
function tile(pen: Pen, clay: Clay, gx: number, gy: number): void {
  const { terr, wat } = clay, i = gy * N + gx;
  const north = terr[i] as number, east = terr[i + 1] as number;
  const west = terr[i + N] as number, south = terr[i + N + 1] as number;
  const d = gx + gy, y = d * HALF_H;
  // Off the bottom of the frame, and off the top. Four heights already in registers answer exactly
  // rather than in the worst case, which is the difference between a bracket and a cull: the `d`
  // band above has to hold for every tile in its row and is therefore bracketed against the tallest
  // ground the brush can make, which is fifty-eight units above anything most rows contain.
  if (y - Math.max(north, east, west, south) * STEP_PX > shot.floor) return;
  if (y - Math.min(north, east, west, south) * STEP_PX < shot.ceiling) return;
  const mean = (north + east + west + south) * 0.25;
  // The missing relief axis. See the header — this one subtraction is the finding.
  const ns = clamp((north - south) / SPAN, -1, 1);
  const ew = clamp((east - west) / SPAN, -1, 1);
  const steep = Math.max(Math.abs(north - south), Math.abs(east - west), Math.abs(north - east));
  let ink = band(pen, mean - (BASE - TILT * d), steep);
  // Nine levels of light and six of haze. Continuous here would be a fresh ramp-cache key at every
  // vertex on every frame — see the header, and § Scale's named trap.
  const lit = Math.round(clamp(ew * 0.5 + ns * 0.9, -1, 1) * 4) / 4;
  ink = lit > 0 ? mix(ink, pen.palette.ink('sun'), lit * WASH)
    : mix(ink, pen.palette.ink('dusk'), -lit * WASH * 1.5);
  const haze = Math.round(clamp((shot.far + HAZE - d) / HAZE, 0, 1) * 6) / 6;
  if (haze > 0) ink = mix(ink, pen.palette.ink('air'), haze * 0.85);
  isoTerrain(pen, clay.land, gx, gy, ink, undefined, GROUND + ns * RELIEF);
  const depth = ((wat[i] as number) + (wat[i + 1] as number) + (wat[i + N] as number)
    + (wat[i + N + 1] as number)) * 0.25;
  if (depth <= PUDDLE) return;
  // The water is a second quad on its own surface — `clay.wet`, which is `terr + wat` — so a lake
  // is level by construction and its shoreline is a contour of the terrain rather than a decision
  // anything here makes. Six depth levels, and the shallowest carries the pale lip that makes an
  // edge read as an edge.
  const level = Math.round(clamp(depth / DEEPEST, 0, 1) * 7) / 7;
  let water = mix(pen.palette.ink('shallow'), pen.palette.ink('deep'), level);
  if (level < 0.2) water = mix(water, pen.palette.ink('foam'), 0.3);
  if (haze > 0) water = mix(water, pen.palette.ink('air'), haze * 0.85);
  // Alpha, quantized with the color it rides on: eight steps from a film you can see the bed
  // through to a body you cannot. A hard-edged opaque quad at the waterline is the sawtooth every
  // grid-aligned river has, and a ramp of alpha across the shallows is what dissolves it.
  isoTerrain(pen, clay.wet, gx, gy, withAlpha(water, 55 + level * 190), undefined, 1);
}

/**
 * The ground's color at a height above the valley datum, blended along the ramp and snapped.
 *
 * Sixteen stops across five bands, which is a soft ramp that a visitor reads as one continuous
 * surface, and a bounded set of solid fills that no cache can thrash on. A *hard* five-band split
 * was the first build and it is worth recording what it looked like: on a field with any roughness
 * at all, adjacent tiles land either side of a boundary and the valley comes out as a mosaic of
 * flat diamonds — the color version of the triangle problem `Canyon` paid three rebuilds for.
 *
 * Bare rock is mixed in rather than switched to, over the same rise `life.ts` refuses to walk and
 * `props.ts` lets go on, so the moment a slope becomes impassable is a moment the *color* announces.
 */
function band(pen: Pen, above: number, steep: number): Rgba {
  const p = clamp((above + BAND_0) / BAND_H, 0, BANDS.length - 1.001);
  const k = p | 0, f = Math.round((p - k) * 4) / 4;
  let ink = mix(pen.palette.ink(BANDS[k] as string), pen.palette.ink(BANDS[k + 1] as string), f);
  const bare = Math.round(clamp((steep - CRAG) / 0.7, 0, 1) * 4) / 4;
  return bare > 0 ? mix(ink, pen.palette.ink('crag'), bare) : ink;
}

/** Segments in the brush ring. Twenty-four is smooth at the maximum zoom and is a twelfth of the
 *  scratch buffer, so it can never collide with anything else drawing this frame. */
const RING = 24;
/** How fast the ring's dashes crawl — see {@link drawBrush}. */
const SPIN = 0.7;
/** Scratch for the projection. One point for the life of the exhibit. */
const pt: Vec2 = { x: 0, y: 0 };

/**
 * The brush, drawn on the ground it is about to move.
 *
 * A ring rather than a filled disc, because the visitor needs to see the terrain *inside* it while
 * they work. It is drawn at the true ground height at every one of its twenty-four points, so it
 * drapes over what is already there — which is the cheapest possible statement that this thing
 * follows the surface rather than floating over it, and it is how a visitor discovers that the pick
 * under their finger is terrain-aware without being told.
 *
 * The dashes crawl while the brush is down. That is the only continuously animated thing in the
 * frame and it is animated in *phase*, never in color: `dashOffset` is a number the surface hands
 * to the context and touches no cache anywhere.
 */
export function drawBrush(pen: Pen, clay: Clay, cgx: number, cgy: number, radius: number, down: boolean, t: number): void {
  const heights = clay.land.heights;
  for (let k = 0; k < RING; k++) {
    // Eight-fold symmetry off a fixed table rather than `Math.sin`: the ring is the one thing on
    // screen at all times, and a `@tier-b` call twenty-four times a frame to draw a circle nobody
    // measures is a cost with no argument behind it.
    const a = (k / RING) * 8, oct = a | 0, f = a - oct;
    const c = COS[oct] as number, s = SIN[oct] as number;
    const nc = COS[(oct + 1) & 7] as number, ns = SIN[(oct + 1) & 7] as number;
    const gx = cgx + radius * (c + (nc - c) * f), gy = cgy + radius * (s + (ns - s) * f);
    gridToScreen(pen.camera, gx, gy, heights.get(Math.round(gx), Math.round(gy)) * STEP_PX, pt);
    pen.xy[k * 2] = pt.x + pen.snapX;
    pen.xy[k * 2 + 1] = pt.y + pen.snapY;
  }
  const ink: Rgba = pen.palette.ink('edge');
  pen.surface.stroke(pen.xy, RING, true, ink, down ? 3 : 2, 9, -t * SPIN * 60);
}

/** An octagon's cosines and sines, exact where they can be and a decimal literal where they cannot.
 *  `0.7071067811865476` is the nearest double to √2/2 and comparing or multiplying by it is Tier A;
 *  it is the *derivation* that used trigonometry, once, here, at authoring time. */
const R2 = 0.7071067811865476;
const COS: readonly number[] = [1, R2, 0, -R2, -1, -R2, 0, R2];
const SIN: readonly number[] = [0, R2, 1, R2, 0, -R2, -1, -R2];
