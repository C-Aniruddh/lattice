/**
 * The chain as a place, and the saves climbing it.
 *
 * `chain.ts` is the migration; this is the ladder it turns into. One rung per migration, and the
 * whole thing climbs **away from the viewer**, along `−(gx + gy)`.
 *
 * That axis was chosen the second time and is the only one that works. Run the staircase along
 * `gx − gy` instead — the diagonal `GALLERY.md` measures as giving a canyon its maximum apparent
 * depth — and every riser's base line lands on a *screen-vertical*, which makes the riser face
 * edge-on and therefore **zero pixels wide**. The first build of this exhibit did that: the decks
 * were legible by colour and the steps between them were an artefact-looking zigzag, because
 * there was no wall for the eye to find. Turned onto the depth axis, a riser's base runs
 * horizontally across the screen, its face is a rectangle, and the ordinary iso staircase appears
 * — tread, riser, tread — with nothing occluding anything, because each deck is both further away
 * and higher than the one in front of it and those two shifts go the same way on screen.
 *
 * ## Why this is logic and not art
 *
 * It is the landform *and* the map: the height field `input` resolves taps on, the terrace a
 * crate is standing on, and the moment a crate crosses onto the next one and is handed to the
 * next build. Delete it and nothing runs. `GALLERY.md` settles this case, for `valley.ts`.
 *
 * ## The one mechanic
 *
 * A crate carries **envelope bytes and nothing else**. Every time it steps onto terrace *k* it is
 * handed to `BUILDS[k].decode` — the real read pipeline: checksum, chain, and a recognizer at
 * every version on the way. What comes back is what it carries from then on. Nothing is
 * precomputed and nothing is replayed, so a crate on terrace 3 is a v1 save that three real
 * builds have opened, and the fourth is about to.
 *
 * A build that refuses it topples it, and it goes back over the rung it just climbed and lies at
 * the foot of that wall until the lane files a new save. It falls **exactly one rung**, not all
 * the way to the floor, so the wreck comes to rest beside the wall whose migration would not take
 * it — which is where a visitor is already looking. **Degrading with a reason is the behaviour,
 * so it is the animation**, and the reason is on the placard the HUD reads off `excuse`.
 *
 * ## The fields on a `Climber`
 *
 * `d` is how far along the ladder it has walked, in tiles; `s` is its lane, fixed for the life of
 * the lane; `k` is the terrace a build has recognized it at, or `-1` while it is still bytes on
 * the archive floor; `open` is what that build returned, or `null` for the same reason; `fell` is
 * seconds since a build refused it, and `0` while it is still climbing; `why` is what this
 * exhibit says about that refusal, in this exhibit's own voice; `at` is its slot in the archive,
 * which is the crate's identity and its lane's cursor.
 */
import { clamp, hash2, toUnit } from '@latticekit/core';
import { heightAt, tileSourceOf, type HeightField } from '@latticekit/iso';
import type { OpenResult } from '@latticekit/persist';
import { HEAD, excuse, fileOne, openWith, type Filed, type Save } from './chain.js';

// ── the geometry ─────────────────────────────────────────────────────────────────────────────

/** Tiles from the front of one terrace to the front of the next, and how much of that is flat.
 *  Five spans at `HALF_W` a tile is what has to fit across a 1440 px frame, which sets the first
 *  number. `PLAT` is how far onto the top deck a save walks before it is done; the height field
 *  has no ramp in it at all, so a rung is a **discontinuity** rather than a slope, and the face
 *  between two treads is drawn as a wall rather than as ground. `GALLERY.md` arrives at the same
 *  rule from `Canyon` — *walls that step rather than slope*. */
export const SPAN = 9, PLAT = 7;
/** Height units per terrace and world pixels per unit: 88 px of rise against 192 px of run.
 *  104 px of rise per rung against 144 px of tread. Both are visible and neither occludes the
 *  other: a deck is further away *and* higher than the one in front of it, and in a 2:1 projection
 *  those two shifts move a tile the same way, so the staircase opens out instead of folding up. */
const RISE = 4, STEP_PX = 26;
/** The tallest thing on the ladder: the camera's bounds, and the Terrain pass's cull margin. */
export const MAX_HEIGHT_PX = (HEAD - 1) * RISE * STEP_PX;

/** Which terrace a position along the ladder stands on. `-1` is the archive floor, a step *below*
 *  v1, which is also where anything that falls ends up. */
export const terraceOf = (d: number): number => (d < 0 ? -1 : Math.min(Math.floor(d / SPAN), HEAD - 1));

/**
 * Height in units along the ladder: **one flat level per build**, with no ramp anywhere, and flat
 * for ever at both ends so the world has no visible edge in either direction.
 *
 * The absence of the ramp is the fix for the artefact `GALLERY.md` records against `Canyon`: *a
 * continuous height field on a diamond grid renders as triangles, whatever the model says.* A
 * riser spread over two tiles put its rise on one corner of each quad and the whole staircase came
 * out as a row of serrated teeth. So the field is a **staircase in the data**, every tread dead
 * level, and the vertical face between two treads is not terrain at all — `yard.ts` draws it as a
 * wall, which is the one thing a 2:1 projection renders as a clean rectangle.
 */
function unitsAt(d: number): number {
  return clamp(Math.floor(d / SPAN), -1, HEAD - 1) * RISE;
}

/**
 * The ground, as a function rather than a grid.
 *
 * `tileSourceOf` is defined at every coordinate, so this world has no edge at all: the archive
 * floor runs off the left of the frame and the vault runs off the right, and neither allocates a
 * byte. It is also what `input` is handed through `boot.setTerrain`, because `SEAMS.md` gives
 * that seam to a *declaration* rather than to an omission — an exhibit built on a staircase that
 * never says so picks a tile beside the right one, moving smoothly with the pointer, and wrong.
 */
export const GROUND: HeightField = { heights: tileSourceOf((gx, gy) => unitsAt(-(gx + gy))), stepPx: STEP_PX };

/** Ladder coordinates to grid coordinates: `gx + gy` is `−d`, so climbing walks away from the
 *  viewer and up, and `gx − gy` is `s`, so a lane runs straight across the frame. */
export const gxOf = (d: number, s: number): number => (s - d) / 2;
export const gyOf = (d: number, s: number): number => (-s - d) / 2;
/** World pixels above sea level at a point on the ladder. */
export const liftAt = (d: number, s: number): number => heightAt(GROUND, gxOf(d, s), gyOf(d, s));

// ── the lanes ────────────────────────────────────────────────────────────────────────────────

/** A hundred and fifty lanes over a hundred and eighty tiles of depth, five saves deep, which is
 *  **750 saves on the ladder at once** and around two hundred in frame. § Scale asks for whatever
 *  an exhibit repeats to be measured in hundreds, and what this one repeats is a save file. It is
 *  also what makes the yard read as working rather than as a diagram of working: at any moment
 *  there is a queue on every deck and a crate on every riser. */
export const LANES = 150, DEPTH = 180; const CROWD = LANES * 5, LANE_GAP = DEPTH / LANES;
/** Where a lane picks up its next save, out on the archive floor; and the four rates. */
const ENTER = -13, SPEED = 2.6, FALL = 9, LIE = 20;

/** One save on the ladder. The fields are described in this module's header. */
export interface Climber { filed: Filed; d: number; s: number; k: number; open: OpenResult<Save> | null; fell: number; why: string; at: number }
/** Everything a readout, a placard or a panel reads — and the two numbers the shelf is drawn
 *  from, which live here because a lane refills itself and nothing else knows when. */
export interface Yard { readonly lanes: Climber[]; readonly seed: number; damage: number; top: number; migrated: number; rejected: number; readonly tally: Map<string, number>; focus: Climber }

/**
 * Open the yard, and run it for as long as it takes the first save to reach the top.
 *
 * The warm-up is {@link stepYard} and nothing else — the same loop, the same `decode` calls, the
 * same rungs — so the crates in the opening frame are spread across the ladder because they
 * *climbed* there. `GALLERY.md` rule 3 asks for something already moving in the first frame; this
 * is the version of that which does not lie about how the crates got where they are. Seven
 * hundred ticks of eighty lanes costs about three milliseconds, once, before `start()`.
 *
 * The counters are zeroed afterwards: the warm-up happened before the visitor arrived, and a
 * readout that opens at `carried 31` reads as a number somebody typed.
 */
export function openYard(seed: number, damage: number, top: number): Yard {
  const lanes: Climber[] = [];
  for (let i = 0; i < CROWD; i++) lanes.push({ filed: fileOne(seed, i, damage), d: ENTER - ((i * 61) % CROWD) * 0.1, s: (i % LANES) * LANE_GAP, k: -1, open: null, fell: 0, why: '', at: i });
  const y: Yard = { lanes, seed, damage, top, migrated: 0, rejected: 0, tally: new Map(), focus: lanes[CROWD - 1] ?? (lanes[0] as Climber) };
  for (let n = 0; n < 700; n++) stepYard(y, 1 / 30);
  y.migrated = 0; y.rejected = 0; y.tally.clear();
  return y;
}

/** Put the next save from the shelf in this lane, back out on the archive floor. The shelf has no
 *  length, so the cursor simply keeps counting: `fileOne` is a function of the index. */
function refile(y: Yard, c: Climber): void {
  c.at += CROWD; c.filed = fileOne(y.seed, c.at, y.damage);
  c.d = ENTER - toUnit(hash2(y.seed, c.at, 9)) * 9; c.k = -1; c.open = null; c.fell = 0; c.why = '';
}

/**
 * One tick of the yard.
 *
 * The only thing in here that is not arithmetic is the `openWith` call, and it is the point: a
 * crate crossing onto a terrace is a save being handed to a build, right then, with no cache in
 * front of it. Eighty lanes crossing a rung every three-and-a-half seconds is on the order of
 * twenty `decode` calls a second — a checksum, a `JSON.parse` and a chain walk over a hundred
 * bytes each — and none of it appears in the frame cost.
 *
 * The last branch is the lip of a rung this build does not have. At `top = 5` that is the vault
 * door and the save is home; at `top = 3` it is the edge of a terrace with nothing above it,
 * which is what a build that has not written the next migration yet actually looks like.
 */
export function stepYard(y: Yard, dt: number): void {
  const ceiling = y.top - 1;
  for (const c of y.lanes) {
    if (c.fell > 0) {
      c.fell += dt;
      if (c.d > ENTER && terraceOf(c.d) >= c.k) c.d -= FALL * dt; else if (c.fell > LIE) refile(y, c);
      continue;
    }
    c.d += SPEED * dt;
    const k = terraceOf(c.d);
    if (k > c.k && k <= ceiling) {
      c.k = k; c.open = openWith(k, c.filed);
      const x = c.open.failure;
      if (x !== null) { c.fell = 1e-4; c.why = excuse(c.open, k); y.rejected++; y.tally.set(x.reason, (y.tally.get(x.reason) ?? 0) + 1); }
    } else if (c.d >= ceiling * SPAN + PLAT) { y.migrated++; refile(y, c); }
  }
}
