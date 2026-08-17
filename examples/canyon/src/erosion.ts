/**
 * The erosion model. **Tier A throughout, and this is the file where that is not a formality.**
 *
 * Everywhere else in the gallery, Tier B reaches a pixel and stops there: a `Math.sin` in a
 * palette blend is a color that may differ in its last bit between two engines, and nothing
 * downstream ever reads it back. Here the height field is *state that feeds the next step*. A
 * last-bit disagreement in one `pow` does not stay a last-bit disagreement — it is amplified by
 * the next droplet that steers on the gradient it perturbed, and after a hundred thousand
 * iterations two conforming engines have the river in a different valley. The scrub bar's whole
 * claim — that "go to year 400,000" is a *re-run* and lands on the canyon you already saw — is
 * false the moment one transcendental gets into this file.
 *
 * So: `+ - * /`, `Math.sqrt`, `Math.min`/`Math.max`/`Math.floor`, `| 0` and `Math.imul`, all
 * exactly specified by ECMA-262, and nothing else. That includes what this file *imports*:
 * `core.noise2` and `core.fbm2` are Tier A by construction — a quintic fade, a gradient `switch`,
 * and `hashStep`'s `imul` — which is the single fact that makes a time-evolving height field
 * possible at all. `AGENTS.md` non-negotiable 1 has the table.
 *
 * There is deliberately **no `@tier-b` tag anywhere in this module**, and if one is ever needed
 * here that is a finding to report rather than a tag to add: the tag declares a value that
 * reaches pixels, and every value in this file reaches the next iteration.
 *
 * **Tier A is not the same as finite.** `0/0`, `Infinity - Infinity` and `Math.sqrt(-1)` are all
 * exactly specified and all produce `NaN`, and a `NaN` that reaches this buffer spreads through
 * it in about four steps and puts a black frame on screen. This exhibit shipped one for an hour:
 * a droplet spawned at `(CELLS + u) / 2 + across` where the two terms could sum past `N - 2`,
 * which read one cell off the end of a typed array, which is `undefined`, which is `NaN` the
 * moment it is multiplied. The fix is the clamp in {@link rain}, and the lesson is that the
 * boundary check belongs at the *spawn*, not only in the loop that walks away from it.
 *
 * ## The model, in three sentences
 *
 * Rain falls as droplets that steer down the local gradient of the bilinear surface, carrying
 * sediment up to a capacity set by how fast they are falling and how much water is left, cutting
 * when they are under capacity and depositing when they are over it — which is what makes the
 * result *path-dependent*, because where the sediment goes next depends on where the water went
 * last. Between rains the whole grid relaxes: anything steeper than **the angle its own bed
 * stands at** slides its excess into its lowest neighbour, which is what widens a slot into a
 * gorge, piles the scree at the foot of the walls, and — because a hard bed stands far steeper
 * than a soft one — leaves the finished wall as an alternation of cliff and bench rather than as
 * one uniform slope. And the interior rises by a fixed uplift every step while the rim is
 * pinned as base level, so the river never finishes cutting and the ground never stops moving.
 *
 * This is the honest counterweight `docs/GALLERY.md` asks for: `Crowd` gets two hundred walkers
 * out of a closed-form expression in `t`, and there is no expression that answers "what does this
 * valley look like at t = 400,000 years" without being the simulation.
 *
 * ## The one state buffer, and why it is one
 *
 * Height and flow live in a single `Float64Array` — heights in `[0, CELL_COUNT)`, accumulated
 * water in `[CELL_COUNT, 2·CELL_COUNT)`. One buffer, because a checkpoint is then `state.slice()`
 * and a restore is `state.set(mark)`, and two buffers is two chances to check-point one and
 * forget the other. Flow is genuine simulation state and not a decoration: the art draws the
 * river exactly where the water went, so a restore that dropped it would show a *different*
 * picture at an epoch the visitor had already passed — the one thing this exhibit promises
 * cannot happen.
 *
 * `Float64` in the buffer and in every checkpoint, because a checkpoint that rounds is a
 * checkpoint that does not reproduce the run it was taken from.
 */
import { clamp, fbm2, hash2, noise2 } from '@lattice/core';

/** Tiles on a side, vertices on a side, and cells in one half of the buffer. The grid is square
 *  because a rectangular one still projects to a diamond; the canyon is made long and thin by
 *  running it along the diamond's *vertical* diagonal, `gx + gy`, so that it recedes from the
 *  camera instead of crossing the frame — see `strata.ts` § The viewpoint. Heights live on grid
 *  **vertices**, so two
 *  neighbouring tiles share their corners exactly and a cliff cannot open a seam. */
export const CELLS = 112, N = CELLS + 1, CELL_COUNT = N * N;
/**
 * World pixels per height unit — `@lattice/iso HeightField.stepPx`, and the exhibit's whole
 * answer to "the Grand Canyon is six thousand feet deep and this reads as a ditch".
 *
 * `TILE_H / 4` is the kit's suggested first guess and it renders this canyon as a scratch. What it
 * can be raised to is a question whose answer **changed with the viewpoint**, and both halves are
 * worth keeping because the first one generalizes.
 *
 * ## When the gorge was cut across the frame
 *
 * `stepPx` set the exaggeration *and* the self-occlusion angle, and they pulled opposite ways. A
 * tile of horizontal distance is worth `HALF_H` = 16 screen pixels and a unit of drop is worth
 * `stepPx`, so a point below the rim was hidden behind the near rim unless the wall between them
 * was shallower than **`HALF_H / stepPx` units per tile**. At 26 that is 0.62; the first build set
 * the talus angle to 4.2, the gorge closed over its own floor, and the river became invisible at
 * exactly the epoch it was cutting hardest. **This generalizes and is the part to remember: an
 * isometric camera cannot look into a hole steeper than its own view angle.** Any exhibit whose
 * subject is a pit, a shaft or a gorge *seen across the frame* is choosing between depth it can
 * exaggerate and depth it can see.
 *
 * ## Now that it is cut along the frame
 *
 * The gorge runs away from the camera, both walls stand either side of it, and a wall occludes
 * nothing at all: along a line of constant `gx − gy` the surface descends the screen monotonically.
 * There is no occlusion limit left to respect — and there is also no free depth. Rim to rim is a
 * *horizontal* distance now, `2 · rimU · HALF_W`, and `stepPx` does not appear in it; a wall's face
 * is exactly `cut · stepPx` screen pixels tall and that is the entire apparent depth of the canyon.
 * The previous viewpoint got `cut · (HALF_H/slope + stepPx)` for its far wall, more than twice as
 * much, because there the wall's run projected onto the same screen axis as its height and the two
 * added. `strata.ts`'s header has the table.
 *
 * So 18 is no longer a compromise with anything; it is simply the exaggeration this exhibit looks
 * right at, and it is the one number that would move if the canyon needed to be deeper on screen.
 */
export const STEP_PX = 18;

/** Height in units, then accumulated water, in one buffer. See the module header. */
export type State = Float64Array;

/** Starting plateau, the downstream tilt per tile without which the river ponds, and the depth of
 *  the shallow valley the young river starts in. */
const PLATEAU = 46, FALL = 0.06, TROUGH = 6.5;
/** The droplet model. `DROPS × LIFE` is the whole per-step cost of the water. */
const DROPS = 64, LIFE = 46, INERTIA = 0.055, GRAVITY = 3.4, CAPACITY = 9;
/** `TRIBUTARY` is what a storm on the tableland carries against the river's 1 — side canyons,
 *  not trenches. */
const EROSION = 0.45, DEPOSITION = 0.09, EVAPORATE = 0.017, MIN_SLOPE = 0.011, TRIBUTARY = 0.18;
/** Uplift per step in the interior, how much of a slope's excess moves per step — small, because a
 *  wall that relaxes to its angle in two steps fills the gorge with its own debris faster than the
 *  river can take it away, and the canyon never gets deeper than it is wide — and the rate water
 *  drains, without which the flow map saturates and every tile is river. */
export const UPLIFT = 0.005, SLIDE = 0.06, FLOW_DECAY = 0.955;
/**
 * **The section, as the model sees it: a bed's top and the angle the rock under it stands at.**
 *
 * This is the one place the picture reaches back into the simulation, and it is here rather than in
 * `strata.ts` because it is not a picture decision. A canyon wall is not a uniform slope. Hard beds
 * — limestone, the cemented sandstones — stand as near-vertical cliffs; soft ones — shale, the
 * friable members — will not stand at all and retreat into benches. What a photograph of the Grand
 * Canyon actually shows is *cliff, bench, cliff, bench* all the way down, and that alternation is
 * simultaneously why the strata are countable and why the wall reads as a **wall** rather than as a
 * hillside. A single talus angle for the whole column is geologically defensible and is exactly the
 * hillside this exhibit kept being reviewed for.
 *
 * The tops match `palette.ts`'s section — a bed is one rock — and the angle alternates with it.
 * Lookup is by elevation **minus the uplift**, so a bed is a plane in the rock rather than a height
 * above sea level, which is the same rule `strata.ts` colors by.
 *
 * ## The ceiling on a cliff, and why it is not `Infinity`
 *
 * `STEP_PX`'s note derives the projection's own view angle: a wall steeper than `HALF_H / STEP_PX`
 * = 0.89 units per tile hides what is behind it. That is not a reason to keep every bed under it —
 * a cliff that occludes the bench behind it is a cliff you can *see*, and occlusion is the only
 * unambiguous depth cue an orthographic projection has. It is a reason to keep the **column
 * average** under it, because a whole wall past that angle closes over its own floor and the river
 * disappears at the epoch it is cutting hardest. Nine units of cliff at 1.3 and nine of bench at
 * 0.42 is 6.9 + 21.4 = 28.3 tiles for eighteen units of drop — an effective 0.64, comfortably
 * under, with every individual cliff over it.
 */
const BED_TOP = [43.5, 40, 37.5, 33, 31, 27.5, 24], BED_TALUS = [1.34, 0.42, 1.3, 0.4, 1.26, 0.44, 1.3, 1.5];
/** The angle a whole wall ends up standing at, in units per tile of `gx + gy` — the weighted mean
 *  of {@link BED_TALUS} over the column, and *not* a number the model reads. `strata.ts` needs it
 *  to know where the rim is without scanning twelve thousand cells for it; measured over a full run
 *  rather than derived, because the beds are not equally thick. */
export const WALL = 1.03;
/** West, east, north, south. Hoisted: an array literal inside the relaxation sweep is twelve
 *  thousand allocations per step. */
const NEAR = [-1, 1, -N, N];

/**
 * Read one cell.
 *
 * `noUncheckedIndexedAccess` types **every** `Float64Array` read as `number | undefined`, and the
 * house style bans `!`. So the innermost loop of a simulation over a typed array is either a
 * `?? 0` per access — a branch V8 cannot prove away and no test can ever take — or one cast
 * behind one name. Filed as a finding: a numeric kernel over a typed array is an ordinary thing
 * to write and the kit's own style rules make it awkward.
 */
function at(a: State, i: number): number { return a[i] as number; }

/**
 * The land before the river: a tilted plateau with a broad, shallow, meandering trough down it.
 *
 * The trough is the young river of the pitch, and it is a *Lorentzian* rather than a Gaussian
 * because `exp` is Tier B and this value feeds the first step. It matters less than it looks —
 * the trough exists only to give the first ten thousand droplets somewhere to converge, and
 * everything a visitor sees after that was cut rather than authored.
 *
 * ## The roughness is long and shallow, and that is a picture decision made in the model
 *
 * The first build used amplitudes of 2.4 and 0.7 at wavelengths of thirty and eight tiles, and it
 * produced a tableland that read as a **quilt** — because `draw`'s `isoTerrain` shades each tile
 * by its own cross-slope over a saturating 1.5 units per tile, so eight-tile bumps of 0.7 units
 * are a ±12% checkerboard on ground that is supposed to be one flat caprock. Worse, they are
 * comparable to the *thickness of a bed*, so the strata came out shredded into diamonds instead of
 * banded, and § *A mile deep* is explicit that countable bands are how a canyon states its depth.
 *
 * A caprock plateau really is flat, so the fix is the honest one: long wavelengths at small
 * amplitudes. The rim keeps a broad forty-tile wave — which is what stops the canyon looking
 * ruled — and everything sharp in the finished picture is now something the simulation cut rather
 * than something this function drew.
 */
export function ground(seed: number, gx: number, gy: number): number {
  const v = gx + gy - CELLS, s = gx - gy - noise2(seed ^ 0x51, v * 0.017, 0.37) * 9;
  return PLATEAU - v * FALL - TROUGH / (1 + s * s * 0.03)
    + fbm2(seed ^ 0x7a, gx * 0.021, gy * 0.021, 4, 0.5) * 1.7 + fbm2(seed ^ 0x2b, gx * 0.08, gy * 0.08, 3, 0.5) * 0.3;
}

/** Epoch zero, from the seed alone. The one place a canyon comes from. */
export function seedState(seed: number): State {
  const s = new Float64Array(CELL_COUNT * 2);
  for (let i = 0; i < CELL_COUNT; i++) s[i] = ground(seed, i % N, (i / N) | 0);
  return s;
}

/** Bilinear height at a fractional position. `iso.heightAt` does exactly this and returns world
 *  *pixels*; the model works in units, so the conversion would be undone on the next line. */
function surface(s: State, px: number, py: number): number {
  const cx = px | 0, cy = py | 0, fx = px - cx, fy = py - cy, i = cy * N + cx;
  return at(s, i) * (1 - fx) * (1 - fy) + at(s, i + 1) * fx * (1 - fy) + at(s, i + N) * (1 - fx) * fy + at(s, i + N + 1) * fx * fy;
}

/** Move `amount` of rock into — or, negative, out of — the four corners the droplet stands
 *  between, by the same bilinear weights it was sampled with. */
function pour(s: State, i: number, fx: number, fy: number, m: number): void {
  s[i] = at(s, i) + m * (1 - fx) * (1 - fy); s[i + 1] = at(s, i + 1) + m * fx * (1 - fy);
  s[i + N] = at(s, i + N) + m * (1 - fx) * fy; s[i + N + 1] = at(s, i + N + 1) + m * fx * fy;
}

/**
 * One rainfall. `epoch` is in the spawn hash, so the same step of the same seed rains in exactly
 * the same places, which is the whole reason a re-run lands on the canyon the visitor saw.
 *
 * **Fifteen droplets in sixteen fall on the river and one falls on the tableland**, and that ratio is
 * the difference between a canyon and a badland. The first build rained uniformly, which is what
 * a hillslope model should do, and after a million years it had dissected the entire plateau into
 * ridges four tiles across with the river no lower than anything else. A canyon is not uniform
 * erosion — it is a *concentrated* river with orders of magnitude more discharge than the slopes
 * beside it, cutting down faster than the slopes can retreat. Putting the same droplets into the
 * channel puts ten times the incision into a thousandth of the cells, and the fourth droplet is
 * what cuts the side canyons back into the rim.
 */
function rain(s: State, seed: number, epoch: number): void {
  for (let d = 0; d < DROPS; d++) {
    const spawn = hash2(seed ^ 0x11d, epoch, d);
    const a = (spawn >>> 16) / 65536, b = (spawn & 0xffff) / 65536, river = (d & 15) !== 0;
    // `v` runs **along** the canyon, `off` across it; the axis wanders as it goes, so a river
    // spawn has to ask where `ground` put the trough rather than assume the diagonal.
    const v = (a * 2 - 1) * (CELLS - 20), off = noise2(seed ^ 0x51, v * 0.017, 0.37) * 9 + (b - 0.5) * 18;
    // Clamped, and the clamp is the whole of the module header's `NaN` story: the two terms
    // could sum past `N - 2`, which reads one cell off the end of a typed array.
    let px = clamp(river ? (CELLS + v + off) * 0.5 : a * (N - 4) + 1.5, 1.5, N - 2.5);
    let py = clamp(river ? (CELLS + v - off) * 0.5 : b * (N - 4) + 1.5, 1.5, N - 2.5);
    let dx = 0, dy = 0, speed = 1, carry = 0, water = river ? 1 : TRIBUTARY;
    for (let l = 0; l < LIFE; l++) {
      const cx = px | 0, cy = py | 0, fx = px - cx, fy = py - cy, i = cy * N + cx;
      const h00 = at(s, i), h10 = at(s, i + 1), h01 = at(s, i + N), h11 = at(s, i + N + 1);
      const here = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      // The gradient of the same bilinear patch, so the droplet steers on the surface it is on.
      dx = dx * INERTIA - ((h10 - h00) * (1 - fy) + (h11 - h01) * fy) * (1 - INERTIA);
      dy = dy * INERTIA - ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) * (1 - INERTIA);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) break;
      px += dx / len; py += dy / len;
      if (px < 1 || py < 1 || px > N - 2 || py > N - 2) break;
      const drop = here - surface(s, px, py);
      // Capacity floors at `MIN_SLOPE`, so a droplet crossing flat ground keeps what it has
      // rather than dumping the lot and leaving a bar across its own channel.
      const cap = (drop > MIN_SLOPE ? drop : MIN_SLOPE) * speed * water * CAPACITY;
      // One signed number for both halves: positive cuts, negative fills. Climbing fills the
      // hollow exactly, which is how a pond forms, silts up, and overflows somewhere new.
      const move = carry > cap || drop < 0
        ? -(drop < 0 ? Math.min(-drop, carry) : (carry - cap) * DEPOSITION)
        : Math.min((cap - carry) * EROSION, drop);
      carry += move;
      pour(s, i, fx, fy, -move);
      s[CELL_COUNT + i] = at(s, CELL_COUNT + i) + water;
      speed = Math.sqrt(Math.max(0, speed * speed + drop * GRAVITY));
      water -= water * EVAPORATE;
    }
  }
}

/**
 * Uplift, the talus of whichever bed a vertex is standing in, and the water draining away — one
 * sweep of the whole grid.
 *
 * **The sweep direction alternates with the epoch's parity.** An in-place relaxation carries
 * material in the direction it is swept, and a fixed direction paints a visible drift down every
 * scree slope in the canyon. Alternating cancels it, costs one multiply, and stays exactly
 * reproducible because the direction is a function of the step index and nothing else.
 *
 * The rim is skipped rather than uplifted, which is what pins base level; the uplift ramps in
 * over eight tiles so the pinned boundary does not stand as a cliff around the whole map by the
 * end of the run.
 */
function settle(s: State, epoch: number): number {
  const d = (epoch & 1) === 1 ? -1 : 1, from = d === 1 ? 1 : N - 2;
  let deepest = 0;
  for (let n = 0; n < N - 2; n++) {
    const gy = from + d * n;
    for (let m = 0; m < N - 2; m++) {
      const gx = from + d * m, i = gy * N + gx;
      s[CELL_COUNT + i] = at(s, CELL_COUNT + i) * FLOW_DECAY;
      const edge = Math.min(gx, gy, N - 1 - gx, N - 1 - gy) * 0.125;
      const h = at(s, i) + UPLIFT * (edge < 1 ? edge : 1);
      // The HUD's number, taken here because this sweep already visits every cell. Measured
      // against the *original* plateau at this point rather than the highest ground in frame:
      // the map is tilted downstream by design, and a plain `max - min` would report six units
      // of regional slope as canyon.
      const c = PLATEAU + UPLIFT * epoch - (gx + gy - CELLS) * FALL - h;
      if (c > deepest) deepest = c;
      let j = i, low = h;
      for (const o of NEAR) { const q = at(s, i + o); if (q < low) { low = q; j = i + o; } }
      // The bed this vertex is standing in, and the angle its rock holds. A `while` over eight
      // numbers per cell is the whole cost of a stepped wall; it is Tier A because every operation
      // in it is a comparison and an index.
      let k = 0; const bed = h - UPLIFT * epoch;
      while (k < BED_TOP.length && bed < (BED_TOP[k] as number)) k++;
      const move = (h - low - (BED_TALUS[k] as number)) * SLIDE;
      s[i] = move > 0 ? h - move : h; if (move > 0) s[j] = low + move;
    }
  }
  return deepest;
}

/** One epoch: five hundred years of rain, landslide and uplift. Returns how far the river has
 *  cut below the plateau it started on, in height units — the HUD's number, free because the
 *  relaxation sweep already visits every cell. */
export function step(s: State, seed: number, epoch: number): number {
  rain(s, seed, epoch);
  return settle(s, epoch);
}
