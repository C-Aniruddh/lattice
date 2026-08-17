/**
 * The walkers, the map they route on, and the one question this exhibit had to answer that no
 * other exhibit has: what happens to a route whose map changed underneath it.
 *
 * `docs/GALLERY.md` ranks the four things that must resettle, and the second of them —
 * *"a walker crossing the valley re-routes around the ridge you just raised"* — is the one it says
 * **nothing else in the gallery exercises**. `Wayfinding` re-routes a crowd when the map changes;
 * it does not have a visitor changing it sixty times a second with their finger.
 *
 * ## The three policies, and why this is the third
 *
 * A `Path` is a curve computed against a map, and here the map moves while a walker is partway
 * along one. There are three honest answers and two are wrong:
 *
 * | policy | why not |
 * |---|---|
 * | recompute every walker every frame | sixteen A\* searches a frame, almost all of them re-deriving a route nothing touched. The answer that looks safest, and the one that spends the whole frame budget on nothing |
 * | recompute on a timer, round-robin | bounded, and blind. A stroke drawn straight across a walker's route waits its turn while the walker climbs a cliff that did not exist a moment ago |
 * | **recompute the routes the stroke actually crossed** | what is built here |
 *
 * **{@link touch} is the policy.** The brush already knows where it struck and how wide it is; a
 * `Path` from `PathFinder` has a node per tile; so *did this stroke land on this route* is a
 * squared-distance test per node, and sixteen routes of about thirty nodes is 480 comparisons —
 * about a thousandth of one search. Crossed routes are marked stale and replanned at a budget of
 * {@link REPLAN} a frame; routes the stroke missed are never considered. A visitor sculpting the
 * far upland pays nothing at all, and a visitor sculpting across the road pays one search per
 * walker affected, starting on the next frame.
 *
 * **What that leaves, stated rather than hidden**: a walker whose route was crossed keeps walking
 * the stale one for `ceil(marked / REPLAN)` frames — one in the common case, eight in the worst
 * case of a stroke that crosses every route at once. At sixty frames a second that is up to 130 ms
 * of a walker heading at a hill that now exists, and it is invisible because the hill is still
 * growing under the finger making it. The same budget spent round-robin would cost the same 130 ms
 * *for a stroke nowhere near anybody*, which is the whole of the difference.
 *
 * ## The router reads a byte per tile, and the brush repaints the bytes it moved
 *
 * `TileCost` is called once per examined neighbor, and the obvious implementation — sample the
 * height field, take `slopeAt`, divide — makes every one of those a bilinear read. Measured over
 * this map, on the eight legs the walkers actually use:
 *
 * | cost function | mean search | worst |
 * |---|---|---|
 * | computed live from the field | **2.18 ms** | 8.9 ms |
 * | read from a baked `Uint8Array` | **0.51 ms** | 2.0 ms |
 * | constant `1` everywhere | 0.13 ms | 0.5 ms |
 *
 * So the grid is baked, and it is repainted in exactly two places: the box the brush struck, on the
 * stroke that struck it, and a rolling {@link SWEEP}th of the map every frame, which is what carries
 * a rising lake into the router without anybody having to notice it rose. The whole map refreshes in
 * eight frames and the brush's own box never waits at all.
 *
 * **The third row of that table is a finding about `iso`, not a curiosity.** `PathFinder`'s
 * heuristic is the integer octile metric with no weight in it, so the moment a cost function returns
 * anything above `1` the heuristic stops being tight and A\* slides toward Dijkstra — a **17×**
 * spread between a weighted map and a flat one, on identical geometry. Weights are the documented
 * way to say *shorter but harder*, and this is what saying it costs.
 *
 * ## A walker who is walled in is a legitimate outcome, and the HUD counts it
 *
 * `PathFinder.find` returns `false` when there is no route and clears the path so it cannot be
 * walked by mistake. Ring a walker with a cliff and that is exactly what happens. It then re-asks
 * once per full sweep rather than every frame — the map is the only thing that could change the
 * answer, so asking again before it moves is a search whose result is known, and a full sweep is
 * exactly the interval over which the map *has* moved. That is what lets a lake draining on its own
 * free a walker nobody went back for.
 *
 * Pure: no DOM, no clock. Time arrives as `dt`.
 */
import { Path, PathFinder, pathSample, pxToUnits, slopeAt, type GridPoint, type PathOptions, type TileCost } from '@latticekit/iso';
import type { Rng } from '@latticekit/core';
import { CELLS, N, type Clay } from './clay.js';

/**
 * Routes replanned per frame; the steepest rise in height units per tile a walker will climb; the
 * depth it will not wade; the heaviest weight any tile may carry; its pace in world pixels per
 * second; how many there are; and how many frames a full refresh of the cost grid takes.
 *
 * `DEEP` is deliberately above the river and well under a dammed lake, and the wading *weight* is
 * what makes that gap read as intent rather than as a threshold. A stream that blocked routes
 * outright made this exhibit's opening frame twelve stranded walkers out of sixteen; a stream that
 * merely costs more to cross makes every route seek the **shallowest crossing it can find**, so the
 * walkers converge on fords — and the fords move when the visitor moves the river. Blocking is
 * reserved for water a person genuinely could not walk through, which in this valley is the lake
 * behind a dam and nothing else.
 */
const REPLAN = 2, CLIMB = 1.2, DEEP = 2.4, WORST = 6, PACE = 62, FOLK = 16, SWEEP = 8;
/**
 * The node ceiling on one search, hoisted so an options literal is not allocated per walker per
 * frame — and a **frame-time** control rather than a correctness one, which is unusual enough to
 * say. `PathOptions.maxNodes` defaults to 20,000; a visitor who floods half the valley makes every
 * search explore the whole component it can still reach before giving up, and two of those in a
 * frame is a visible stall. Six thousand is an order over the largest successful search on this map,
 * and `find` returning `false` early is the same outcome as `find` returning `false` late — the
 * walker is stranded either way.
 */
const SEARCH: PathOptions = { maxNodes: 6000 };

/**
 * One walker. `s` is arc length along `path` in **world pixels** — a walker holds a *distance*,
 * never a node index, which is exactly what makes a replan cost nothing to reconcile. `stale` means
 * the stroke crossed this route and it is queued; `stranded` means the last search found nothing.
 */
export interface Walker {
  readonly path: Path; readonly speed: number; s: number; goal: number; gx: number; gy: number; stale: boolean; stranded: boolean;
}

/**
 * `grid` is one byte per tile — `0` impassable, otherwise the weight; see the header for what
 * baking it buys. `sweep` is which slice of the rolling refresh is next, and `searches` and
 * `stranded` are the two numbers the HUD publishes so a reader can price the policy above.
 */
export interface Life {
  readonly walkers: readonly Walker[]; readonly posts: readonly GridPoint[]; readonly grid: Uint8Array;
  readonly finder: PathFinder; readonly cost: TileCost; sweep: number; searches: number; stranded: number;
}

export function createLife(clay: Clay, rng: Rng): Life {
  // The posts alternate across the valley, so every route crosses the water and the ridge a visitor
  // is most likely to draw, and they lie along the stretch the opening frame is looking at — a
  // walker four screens upstream demonstrates nothing. Clamped inside the map's own margin rather
  // than to its edge: the border ring is the water's drain and nothing should stand in it.
  const posts: GridPoint[] = [], walkers: Walker[] = [], grid = new Uint8Array(N * N);
  for (let k = 0, d = 70, v = 0; k < 8; k++, d += 18) { v = (k % 2 === 0 ? -1 : 1) * 19; posts.push({ gx: cell((d + v) / 2), gy: cell((d - v) / 2) }); }
  for (let i = 0, from = posts[0] as GridPoint; i < FOLK; i++, from = posts[i % posts.length] as GridPoint) {
    walkers.push({ path: new Path(256), speed: PACE * (0.72 + rng.next() * 0.5), s: 0,
      goal: (i + 1) % posts.length, gx: from.gx, gy: from.gy, stale: true, stranded: false });
  }
  const life: Life = { walkers, posts, grid, sweep: 0, finder: new PathFinder(8192),
    cost: (gx, gy) => grid[gy * N + gx] ?? 0, searches: 0, stranded: 0 };
  repaint(life, clay, 0, 0, CELLS, CELLS); return life;
}

function cell(g: number): number { return Math.max(3, Math.min(CELLS - 4, Math.round(g))); }

/** Rebuild the router's bytes over a tile box — the one place the height field and the water reach
 *  the pathfinder, and the reason a search is a byte read rather than a bilinear sample. */
export function repaint(life: Life, clay: Clay, x0: number, y0: number, x1: number, y1: number): void {
  const lo = Math.max(1, x0), hi = Math.min(CELLS - 1, x1), bot = Math.min(CELLS - 1, y1), grid = life.grid;
  // Weighted rather than binary, which `iso.path` is explicit is the point: rough ground is passable
  // and slow, so a route over a shoulder is *shorter but harder* and a walker takes it only when
  // going round is worse. Capped at `WORST`, because the weight is also what costs the search its
  // heuristic — see the header's table.
  for (let gy = Math.max(1, y0); gy <= bot; gy++) for (let gx = lo; gx <= hi; gx++) {
    const wet = clay.wat[gy * N + gx] ?? 0, rise = pxToUnits(clay.land, slopeAt(clay.land, gx, gy)), w = 1 + ((rise * 2) | 0) + ((wet * 1.6) | 0);
    grid[gy * N + gx] = wet > DEEP || rise > CLIMB ? 0 : w < WORST ? w : WORST;
  }
}

/** The stroke landed. Repaint what it moved, and mark every route it crossed. */
export function touch(life: Life, clay: Clay, cgx: number, cgy: number, radius: number): void {
  const r = Math.ceil(radius) + 1, x = cgx | 0, y = cgy | 0, near = (radius + 1.5) * (radius + 1.5);
  repaint(life, clay, x - r, y - r, x + r, y + r);
  for (const w of life.walkers) {
    // The walker's own tile first, and it is not a shortcut. A stranded walker has an **empty**
    // path, so the node loop can never mark it and it would wait for a stroke that can no longer
    // reach it. This is the line that lets a visitor dig one back out.
    if (w.stale || sq(w.gx - cgx, w.gy - cgy) <= near) { w.stale = true; continue; }
    for (let i = w.path.nodeCount - 1; i >= 0; i--) if (sq(w.path.gxAt(i) - cgx, w.path.gyAt(i) - cgy) <= near) { w.stale = true; break; }
  }
}

/** Squared distance, and scratch for {@link step}: one point for the life of the exhibit. */
function sq(dx: number, dy: number): number { return dx * dx + dy * dy; }
const here: GridPoint = { gx: 0, gy: 0 };

/** Advance every walker, spend the frame's replan budget on the routes the brush marked, and turn
 *  the rolling refresh one slice — which is how a lake that rose this second reaches the router. */
export function step(life: Life, clay: Clay, dt: number): void {
  const band = Math.ceil(CELLS / SWEEP), from = life.sweep * band;
  repaint(life, clay, 0, from, CELLS, from + band); life.sweep = (life.sweep + 1) % SWEEP;
  // Once every full refresh, give the walled-in another go. A stranded walker is waiting on the
  // *map*, and the map moves for a second reason besides the brush: the water. A lake that drains
  // opens a route nobody sculpted, and eight frames is a cheap enough interval to notice it in.
  if (life.sweep === 0) for (const w of life.walkers) if (w.stranded) w.stale = true;
  let budget = REPLAN, stranded = 0;
  for (const w of life.walkers) {
    if (w.stale && budget > 0) { budget--; replan(life, w); }
    if (w.stranded) { stranded++; continue; }
    // An empty path is only reachable in the opening frames, where every walker starts stale and the
    // budget hands them out two at a time; `pathSample` throws on one, correctly, rather than
    // answering with a tile nobody asked for. Reaching `arcLength` means arrived: take the next post
    // and ask for a route to it, which is also the path the very first frame takes.
    if (w.path.nodeCount === 0) continue;
    w.s += w.speed * dt;
    if (w.s >= w.path.arcLength) { w.goal = (w.goal + 1) % life.posts.length; w.s = w.path.arcLength; w.stale = true; }
    pathSample(w.path, w.s, here); w.gx = here.gx; w.gy = here.gy;
  }
  life.stranded = stranded;
}

/** Re-ask, from where the walker is standing now to where it was going. It keeps its position and
 *  loses only its progress, because `s` is a distance along whichever curve it holds and the new
 *  curve begins under its feet. */
function replan(life: Life, w: Walker): void {
  const post = life.posts[w.goal] as GridPoint;
  w.stranded = !life.finder.find(life.cost, Math.floor(w.gx), Math.floor(w.gy), post.gx, post.gy, w.path, SEARCH); w.stale = false; w.s = 0; life.searches++;
}
