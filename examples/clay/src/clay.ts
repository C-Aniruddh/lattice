/**
 * The material: one height field, one water field, and the brush that moves both.
 *
 * This is the exhibit. Everything else on screen exists so that a change made here is impossible
 * to miss — which is `docs/GALLERY.md`'s whole argument for this row sitting beside `Canyon`:
 * *"a change you caused is impossible to miss"*, where a change that happened to the world over a
 * million years took four rebuilds to make legible.
 *
 * ## Two fields on the same lattice, and why water is a field rather than a marked tile
 *
 * `terr` is the rock, in height units. `wat` is the **depth of water standing on it**, in the same
 * units, on the same grid vertices. The water *surface* is the sum, and that single fact is what
 * makes every convincing thing this exhibit does fall out for free:
 *
 * | | because |
 * |---|---|
 * | cut a channel and the river moves into it | the surface is lower there, so the next step sends water there |
 * | dam it and a lake forms *behind* the dam | water arriving has nowhere lower to go, so depth accumulates until the surface clears the lowest lip |
 * | the lake finds a new outlet and drains | that lip is found by the same arithmetic, with no spillway logic anywhere |
 * | a lake's shoreline is a contour of the terrain | it is one, exactly: the set where `terr` meets the pooled surface |
 * | raising ground under a lake makes an island | the water is still there; it is simply no longer above that vertex |
 *
 * A boolean "this tile is river" would have needed every one of those written as a rule, and each
 * rule would have been wrong at some edge a visitor would find inside ten seconds.
 *
 * ## The solver, and why it is four lines of arithmetic rather than shallow water
 *
 * Every step, each wet vertex looks at its four edge neighbors and gives away a fraction of its
 * water **split in proportion to how much lower each neighbor's surface is**. Nothing else. It is
 * the same relaxation `Canyon`'s talus sweep runs on scree, run on water.
 *
 * Three details are load-bearing:
 *
 * - **It is Jacobi, not in place.** Transfers are accumulated into `flux` from the *old* state and
 *   applied afterwards. An in-place sweep in row-major order carries water several tiles down-grid
 *   in one pass and one tile up-grid, so a river running one way across the map flows visibly
 *   faster than the same river running the other way — an artifact of the loop order wearing the
 *   costume of a physical law.
 * - **A vertex gives away at most a quarter of the total drop, and never more than it has.** That
 *   is the stability condition: without the cap a cell hands its neighbor more water than would
 *   level the pair, the neighbor hands it back next step, and a still pond oscillates like a
 *   checkerboard for ever.
 * - **It splits between all lower neighbors instead of picking the lowest.** Steepest descent is
 *   one comparison cheaper and produces rivers that run in perfect grid staircases, because every
 *   cell of a diagonal channel picks the same axis. Proportional splitting lets a channel be
 *   diagonal, and it is the difference between a river and a plumbing diagram.
 *
 * **Dry vertices cost three operations and leave.** That is why a 25,921-vertex field can be
 * stepped five times a frame for 0.73 ms: the map is mostly dry, so the loop's real bound is the wet
 * count, which {@link Clay.wetCount} publishes to the HUD.
 *
 * ## Determinism, and the tier this lives in
 *
 * `+ - * /` and comparisons, exclusively — no `sin`, no `pow`, no `exp` in the solver or the
 * brush. That is `AGENTS.md`'s Tier A and it is required here for the reason `Canyon` gives: water
 * depth is state that feeds the next step, so a last-bit disagreement does not stay one, it steers
 * the next transfer. `core.noise2` and `core.fbm2` are Tier A by construction. The valley trough is
 * a **Lorentzian**, `s²/(1+s²)`, rather than a Gaussian for exactly that reason — `Math.exp` is
 * Tier B and this value is the first thing the solver reads.
 *
 * Pure: no DOM, no clock, no `Math.random`. The seed arrives as a number.
 */
import { fbm2, noise2 } from '@latticekit/core';
import type { HeightField, TileSource } from '@latticekit/iso';

/**
 * Tiles on a side, and vertices on a side. Heights live on **vertices**, so there is one more of
 * them than there are tiles; getting that wrong leaves a one-tile seam along two edges of the map.
 *
 * **160 is set by the diamond and not by the extent row**, and it is worth writing down because the
 * first number tried was 96 and it produced § Scale's named failure — *a hard corner with background
 * behind it* — at the opening zoom, with no way to pan out of it. A square grid projects to a
 * **diamond**, and a rectangular viewport inscribed in a diamond of half-width `W` and height `H`
 * has to satisfy `|cx| + w/2 ≤ 2·(cy − h/2)` and `|cx| + w/2 ≤ 2·(H − cy − h/2)` at once. Add those
 * and the map's own size falls out: `w ≤ 2H − 4h`. At 96 tiles that is 3,044 against a 2,939-pixel
 * frame — satisfiable at exactly one camera position, which is not a world, it is a photograph.
 *
 * At 160 the world is 10,240 × 5,120 world pixels, the same inequality leaves 1,950 pixels of
 * vertical camera travel and 3,400 of horizontal, and the solver's grid is 25,921 vertices.
 *
 * `STEP_PX` is world pixels per height unit. `iso` offers `TILE_H / 4` = 8 as a first guess, which
 * is where a 2:1 slope stops reading as a slope; 14 is deliberately past it, because the subject of
 * this exhibit is a ridge the visitor just made and it has to look like one immediately.
 */
export const CELLS = 160, N = CELLS + 1, STEP_PX = 14;
/**
 * The ceiling the brush clamps to, and therefore the exact number `renderFrame`'s terrain margin and
 * `screenToTileOnHeights`'s march both need. Exported so neither is ever given a guess.
 *
 * A hundred, against a valley floor at about thirty: the ceiling exists so nothing can run away, and
 * it should be somewhere a visitor arrives **on purpose**. The first build set it at fifty-eight,
 * twenty-four above the floor, and a three-second stroke reached it — which turns a hill into a
 * flat-topped mesa with vertical sides, because a clamp is a plane and a plane is a mesa.
 *
 * `PUDDLE` is the depth below which a vertex counts as dry — not drawn, not counted, no obstacle.
 * Water spreads as an ever-thinner film otherwise, and a film four thousandths of a unit deep is a
 * lake as far as a boolean is concerned. `MIN_UNITS` is the floor: below it would be a hole in the
 * world with sky through it, and there is no sea here to fill it with.
 */
export const MAX_UNITS = 100, PUDDLE = 0.06, MIN_UNITS = 1;
/** The land before the water: a plane tilted down `gx + gy`, a broad meandering trough along it, a
 *  narrow bed cut into that, and enough long-wavelength roughness that every basin the visitor digs
 *  has a neighbor. `BASE` and `TILT` are the datum `ground.ts` bands the color against. */
export const BASE = 34, TILT = 0.062;
const WALL = 11, BANK = 13, MEANDER = 9, ROUGH = 3.2, CHANNEL = 2.4, BED = 2.6;
/**
 * How much of the available drop moves in one step, **how much of its own depth a vertex carries
 * downhill on top of that**, what each spring adds per step, and what a wet vertex loses to the air.
 *
 * `RUSH` is the one that took a rebuild to find, and it is the difference between a river and a
 * damp patch. A relaxation that moves `total · 0.25` is *leveling*: its throughput is set by the
 * drop and not by the depth, so a channel on a gentle valley floor has a fixed maximum flow no
 * matter how much water is poured into it — and everything above that maximum simply pools at the
 * spring. The first build did exactly that, and the river reached about forty tiles before it went
 * invisible. Water on a slope has to *advect*: `w · RUSH` carries a fraction of a vertex's own depth
 * downhill every step, split between the same lower neighbors, so throughput scales with depth the
 * way a real channel's does.
 *
 * It cannot destabilize, and the reason is structural rather than tuned: the total given away is
 * still clamped to `w`, and every share goes to a neighbor whose surface is strictly lower — so a
 * level pool has `total = 0` and moves nothing, whatever `RUSH` is.
 *
 * Evaporation is what stops the uplands filling with puddles over a five-minute session, and it is
 * four orders under the spring rate because a sheet crossing three hundred tiles passes through
 * fifteen hundred steps on the way.
 */
const FLOW = 0.62, RUSH = 0.3, SPRING = 0.4, DRY = 0.00008;

/**
 * The world, and every buffer read per frame.
 *
 * `terr` is rock in height units and `wat` the water standing on it, both on grid vertices; the
 * brush writes to `terr` and to nothing else, and `flux` is the solver's Jacobi scratch. `land` is
 * the rock as `iso` reads it and `wet` is rock-plus-water — the surface a boat would float on.
 * `springs` are the vertex indices the water enters at, found once at the bottom of the young
 * valley. `wetCount` is the vertices deeper than {@link PUDDLE} as of the last step, which is the
 * HUD's number and the honest bound on what the solver costs.
 */
export interface Clay {
  readonly terr: Float32Array; readonly wat: Float32Array; readonly flux: Float32Array;
  readonly land: HeightField; readonly wet: HeightField; readonly springs: Int32Array;
  wetCount: number;
}

/** One typed-array read, cast once. `noUncheckedIndexedAccess` is right about the general case and
 *  wrong about a `Float32Array` indexed by a bounded loop: the alternative is `?? 0` at every
 *  access, which is a branch V8 cannot prove away and no test can ever take. */
function at(a: Float32Array, i: number): number { return a[i] as number; }

/**
 * A `TileSource` over the buffers, bounded to the map.
 *
 * `has` is the half that matters and the half `tileSourceOf` cannot give you: it answers `true`
 * everywhere, and `screenToTileOnHeights` uses `has` as its *only* off-map test — so a brush built
 * on `tileSourceOf` would accept a tap on the sky and sculpt a tile at grid (−4000, 900).
 */
function source(read: (i: number) => number): TileSource {
  return { get: (gx, gy) => (gx < 0 || gy < 0 || gx > CELLS || gy > CELLS ? 0 : read(gy * N + gx)), has: (gx, gy) => gx >= 0 && gy >= 0 && gx < CELLS && gy < CELLS };
}

/** The world, generated. See {@link BASE} for the shape and the header for the Lorentzian. */
export function createClay(seed: number): Clay {
  const terr = new Float32Array(N * N), wat = new Float32Array(N * N);
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    // The valley's centre line wanders, so the river is not a ruled line and the walls are not
    // parallel. One `noise2` of `gx + gy` is the whole meander: a function of distance *down* the
    // valley alone, which is what makes it a bend rather than a bumpy edge.
    // Two Lorentzians on the same centre line: a wide valley whose walls stand `WALL` above the
    // floor, and a narrow bed cut `CHANNEL` into it. The bed is what confines the river — without
    // it the water spreads across thirty tiles of valley floor as a sheet nobody can see, which is
    // the same failure `RUSH` fixes from the other end.
    const s = (gx - gy - MEANDER * noise2(seed, (gx + gy) * 0.016, 0.5)) / BANK, b = s * BANK / BED;
    terr[gy * N + gx] = BASE - TILT * (gx + gy) + (WALL * s * s) / (1 + s * s) - CHANNEL / (1 + b * b) + ROUGH * fbm2(seed ^ 0x5eed, gx * 0.026, gy * 0.026, 3);
  }
  // The springs sit at the bottom of the young valley rather than at a coordinate picked against a
  // screenshot: for three diagonals near the head, take the lowest vertex on each. A hand-picked
  // pair is beside the channel on the next seed, and a spring on a bank is a waterfall down the
  // wall instead of a river down the valley.
  const springs = new Int32Array(3);
  for (let k = 0, best = 0, d = 15; k < 3; k++, d += 5, best = 0) {
    for (let gx = 2; gx < d - 1; gx++) if (at(terr, (d - gx) * N + gx) < at(terr, (d - best) * N + best)) best = gx;
    springs[k] = (d - best) * N + best;
  }
  // `wet` is sampled rather than kept as a third buffer summed every step — two adds per read
  // against 25,921 adds per step, and no way for a copy to be stale.
  return { terr, wat, flux: new Float32Array(N * N), springs, wetCount: 0, land: { heights: source((i) => at(terr, i)), stepPx: STEP_PX },
    wet: { heights: source((i) => at(terr, i) + at(wat, i)), stepPx: STEP_PX } };
}

/**
 * The brush. **One stroke, and this is everything it mutates.**
 *
 * A smooth bump, `(1 − d²/r²)²`, so the rim of the brush leaves no crease and a stroke dragged
 * across the map is one continuous ridge rather than a row of overlapping cones. Squared rather
 * than linear because a linear falloff has a corner at the rim, and `isoTerrain`'s relief term
 * reads exactly that corner and draws a hard ring around every stroke.
 *
 * Water is untouched. It reacts on the next solver step, which is the whole demonstration.
 */
export function sculpt(clay: Clay, cgx: number, cgy: number, radius: number, amount: number): void {
  const terr = clay.terr, r2 = radius * radius;
  const x0 = Math.max(0, Math.ceil(cgx - radius)), y0 = Math.max(0, Math.ceil(cgy - radius)), x1 = Math.min(CELLS, (cgx + radius) | 0), y1 = Math.min(CELLS, (cgy + radius) | 0);
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    const dx = gx - cgx, dy = gy - cgy, t = 1 - (dx * dx + dy * dy) / r2;
    if (t <= 0) continue;
    const i = gy * N + gx, next = at(terr, i) + amount * t * t;
    terr[i] = next < MIN_UNITS ? MIN_UNITS : next > MAX_UNITS ? MAX_UNITS : next;
  }
}

/**
 * Step the water `steps` times. See the header for the three details that are load-bearing.
 *
 * The border ring is emptied at the end of every step, which is the map's drain: water reaching the
 * edge leaves the world. Without it the low edge silts up into a rim lake and the river backs up
 * into the valley over about a minute — a bug that looks exactly like the exhibit working, until it
 * has been left running long enough.
 */
export function flow(clay: Clay, steps: number): void {
  const { terr, wat, flux, springs } = clay, n = N * N;
  for (let s = 0; s < steps; s++) {
    flux.fill(0);
    for (let gy = 1; gy < CELLS; gy++) for (let gx = 1, i = gy * N + 1; gx < CELLS; gx++, i++) {
      const w = at(wat, i);
      if (w <= 0) continue;
      const h = at(terr, i) + w;
      const a = h - at(terr, i - 1) - at(wat, i - 1), b = h - at(terr, i + 1) - at(wat, i + 1), c = h - at(terr, i - N) - at(wat, i - N), d = h - at(terr, i + N) - at(wat, i + N);
      const pa = a > 0 ? a : 0, pb = b > 0 ? b : 0, pc = c > 0 ? c : 0, pd = d > 0 ? d : 0, total = pa + pb + pc + pd;
      if (total <= 0) continue;
      // At most a quarter of the total drop plus `RUSH` of its own depth, and never more than is
      // there. See the header for why both terms exist and why neither can destabilize.
      const cap = total * 0.25 + w * RUSH, give = (w < cap ? w : cap) * FLOW, share = give / total;
      flux[i] = at(flux, i) - give;
      flux[i - 1] = at(flux, i - 1) + pa * share; flux[i + 1] = at(flux, i + 1) + pb * share; flux[i - N] = at(flux, i - N) + pc * share; flux[i + N] = at(flux, i + N) + pd * share;
    }
    let count = 0;
    for (let i = 0, next = 0; i < n; i++) { next = at(wat, i) + at(flux, i) - DRY; if ((wat[i] = next > 0 ? next : 0) > PUDDLE) count++; }
    for (let k = 0; k < springs.length; k++) wat[springs[k] as number] = at(wat, springs[k] as number) + SPRING;
    for (let k = 0; k <= CELLS; k++) { wat[k] = 0; wat[CELLS * N + k] = 0; wat[k * N] = 0; wat[k * N + CELLS] = 0; }
    clay.wetCount = count;
  }
}
