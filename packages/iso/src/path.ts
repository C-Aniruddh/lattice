/**
 * A path is **a curve to be sampled**, not a list of nodes to be stepped through.
 *
 * That one claim decides every signature in this file. A node-stepping API forces every
 * consumer to carry a cursor, a remainder and a lerp — per walker, per frame — and the moment
 * a walker has state it has to be saved, replayed, and reconciled when the route changes.
 * Sampling by arc length has none of that:
 *
 * ```ts
 * for (let i = 0; i < n; i++) {
 *   pathSample(road, (t * speed + (i / n) * road.arcLength) % road.arcLength, here);
 *   order.addPoint(here.gx, here.gy, heightAt(valley, here.gx, here.gy));
 * }
 * ```
 *
 * Fifty walkers, no per-walker state, nothing allocated, identical on every replay. The same
 * expression drives a crowd, a staggered ignition wave along a road, and the `reach` number an
 * idle economy is built on. It is also why re-routing is free: nobody holds a route, they hold
 * an arc length along one, and the route is what changed.
 *
 * ## Everything here is integer arithmetic, and that is not a style choice
 *
 * A\* orders its frontier by summed cost. Float summation is associative only by luck, so two
 * engines can pop equal-`f` nodes in a different order and produce different — both optimal,
 * both different — paths, and a replay that diverges by one tile diverges by everything.
 * Integer 10/14 costs make the order total and the path byte-identical everywhere. For the
 * same reason the heuristic is the integer octile metric and there is no `sqrt` in it, and
 * {@link pathDirAt} returns one of eight direction codes rather than an angle: `Math.atan2` is
 * not required to be correctly rounded, so a facing that reached a save file would not survive
 * the trip to another engine.
 *
 * The one `Math.sqrt` in this file is arc length, which ECMA-262 does specify exactly.
 */

import { expectIndex, hash2 } from '@latticekit/core';
import type { GridPoint, TileRange } from './projection.js';
import { HALF_H, HALF_W } from './projection.js';
import { MinHeap } from './heap.js';

/**
 * Movement cost of entering a tile: `0` (or less) for impassable, otherwise a **positive
 * integer** weight where `1` is ordinary ground, `2` is twice as slow, and so on.
 *
 * **Weighted, not binary.** Binary walkability cannot say "shorter but rougher", and that
 * sentence is a whole mid-game decision. The step cost is `weight × STEP_ORTHO` or
 * `weight × STEP_DIAG`, so a scree tile at weight 3 is exactly three times the road beside
 * it. Keep weights under about 100 so a route's total stays comfortably inside a 32-bit
 * integer.
 *
 * A cost function is the right place to combine layers: terrain type from one `TileGrid`,
 * slope from a `HeightField`, occupancy from another. It is called once per examined
 * neighbor, so keep it arithmetic — no allocation, no `Math.pow`.
 */
export type TileCost = (gx: number, gy: number) => number;

/** Cost of an orthogonal step, in the units {@link TileCost} multiplies. */
export const STEP_ORTHO = 10;

/** Cost of a diagonal step: 14 ≈ 10√2. The integer octile metric — close enough that a
 *  diagonal route does not look preferred, exact enough that two engines agree. */
export const STEP_DIAG = 14;

/**
 * Unit grid offsets for direction codes `1..8`; index `0` is `(0, 0)` and means "no route".
 *
 * | code | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * |---|---|---|---|---|---|---|---|---|
 * | `dgx` | +1 | +1 | 0 | −1 | −1 | −1 | 0 | +1 |
 * | `dgy` | 0 | +1 | +1 | +1 | 0 | −1 | −1 | −1 |
 *
 * Odd codes are orthogonal and even codes are diagonal, which is the whole of
 * `code & 1 ? STEP_ORTHO : STEP_DIAG`. These are **grid** directions, not screen compass
 * points: code 1 runs down-right on screen and code 2 runs straight down.
 */
export const DIR_DX: readonly number[] = [0, 1, 1, 0, -1, -1, -1, 0, 1];

/** Grid `dgy` per direction code. See {@link DIR_DX} for the table and the parity rule. */
export const DIR_DY: readonly number[] = [0, 0, 1, 1, 1, 0, -1, -1, -1];

/** `tan(22.5°)`, the boundary between an orthogonal and a diagonal facing in grid space.
 *  A decimal literal is an exact double and comparing against it is Tier A; it is the
 *  *derivation* that used trigonometry, once, here, at authoring time. */
const TAN_22_5 = 0.4142135623730951;

/**
 * How a search is allowed to move, shared by {@link PathFinder} and {@link FlowField}.
 *
 * All five fields are *determinism* controls as much as behavior ones: change any of them
 * and the same query returns a different — still optimal — route, so a recorded session
 * replayed against different options diverges at the first junction. Pick them once, per
 * game, and keep them with the save.
 *
 * {@link FlowField.build} reads only `diagonals` and `cutCorners`: it is a Dijkstra sweep, so
 * it has no heuristic to scale and no frontier to bound — it is bounded by its own rectangle.
 * The other three describe a {@link PathFinder.find}.
 */
export interface PathOptions {
  /** Allow 8-way movement. Default `true`. */
  readonly diagonals?: boolean;
  /**
   * Allow a diagonal step when a shared orthogonal neighbor is blocked. Default `false`, and
   * leave it false: `true` walks agents through the corner where two walls meet, which looks
   * exactly like clipping through the building.
   */
  readonly cutCorners?: boolean;
  /**
   * Hard ceiling on expanded nodes. Default `20000`.
   *
   * Not a performance knob — a **determinism and liveness** one. A {@link TileSource} need not
   * have an edge: `tileSourceOf` answers `has` with `true` everywhere, so on a procedural world
   * an unreachable goal otherwise searches until the tab dies. Nothing else stops it — a
   * bounded grid stops a search by running out of tiles, and an unbounded source never does.
   * The ceiling has to be a node count rather than a time limit so that the same query gives
   * the same answer on a slow phone as on a desktop.
   */
  readonly maxNodes?: number;
  /** Confine the search to a tile rectangle, half-open. Cheaper than making the cost function
   *  say so, and it is the difference between a failed search that stops and one that explores
   *  the whole world first. */
  readonly bounds?: Readonly<TileRange>;
  /**
   * The **smallest weight the cost function will return for any passable tile** this search can
   * reach. A positive integer, default `1`, and the one number that lets a weighted map keep
   * A\*'s heuristic instead of sliding into Dijkstra.
   *
   * ## What it buys
   *
   * The heuristic is the integer octile metric, which is the true cost of crossing an offset
   * over ground that weighs **1**. Tell the searcher the ground weighs at least 3 and the
   * estimate can be three times larger and still never overestimate — see the admissibility
   * argument in {@link PathFinder.find}. An estimate that is `wMin` times too small is an
   * estimate A\* has to buy back by expanding nodes, and the bill is exponential in the gap:
   *
   * | ground | `minWeight` | what the frontier does |
   * |---|---|---|
   * | every passable tile weighs 1 | `1` | nothing changes — this is the shipped behavior, to the bit |
   * | every passable tile weighs 3 to 8 | `3` | the estimate is three times tighter; the expanded set collapses towards the corridor |
   * | tiles weigh 1 to 8 | `1` | **nothing changes, and nothing can**: one tile of weight 1 anywhere on a cheaper route is enough to make any larger estimate a lie |
   *
   * The third row is the honest limit and is why this is an option rather than a fix. This
   * number is a property of the *whole* cost function, not of the route, so a single cheap tile
   * holds it down for the entire map. A cost function that returns `1 + roughness` gets nothing
   * here; one that returns `2 + roughness` — the same ordering, the same ratios, one unit of
   * floor — gets a heuristic twice as tight, for free, forever.
   *
   * ## Why the caller declares it rather than the searcher deriving it
   *
   * It is a property of the cost *function*, and the cost function is the caller's. Scanning the
   * map for it costs a pass over every tile per search, needs a bound to scan (a
   * {@link TileCost} over seeded noise has no edge), and is stale the instant a brush moves the
   * ground — which is the case this exists for. Caching it on the {@link PathFinder} would be
   * worse still: one finder serves many cost functions, so the cache would be keyed on nothing.
   * Declaring it beside the cost function it describes also satisfies non-negotiable 11 without
   * a line of code: `PathOptions` is a plain object the caller built and still holds, so every
   * field is readable back off it and there is nothing to shadow-copy.
   *
   * ## Declare it wrong and you get an error, not a wrong road
   *
   * A minimum higher than the truth makes the heuristic overestimate, and an overestimating A\*
   * returns a route that is merely *good* while reporting it as cheapest — a wrong answer with
   * no crash behind it, which is the worst failure this module has. So
   * {@link PathFinder.find} **throws** the moment the cost function contradicts the declaration,
   * naming the tile and both numbers. It is one comparison per examined neighbor, on the same
   * line as the integer check that is already there for the same class of bug.
   *
   * That check covers every tile the search paid to look at, which is a superset of the route it
   * returns and a subset of the map. A tile cheaper than the declaration that the search never
   * reaches at all cannot be caught, and in the rare shape where such a tile sits one step
   * beyond the frontier it can still cost optimality — so the declaration is a promise about the
   * cost function, and the check is the net under it, not a substitute for meaning it.
   *
   * An integer, and that is not tidiness: `octile × minWeight` becomes the heap key, and this
   * module's determinism rests on those keys being exact integers (see the file header).
   * `minWeight: 1.5` would put a float in the frontier's ordering and hand two engines two
   * different roads.
   */
  readonly minWeight?: number;
}

/**
 * A route: a polyline through grid space that also knows how long it is.
 *
 * Nodes are grid coordinates — whole numbers when they came from {@link PathFinder},
 * fractional when the game authored them with {@link Path.push} — and alongside them the path
 * keeps the cumulative **world-pixel** arc length to each node. That second array is what
 * makes {@link pathSample} possible and is why this is a class rather than an array of tiles.
 *
 * **World pixels rather than tiles**, because the grid→world map is linear but not conformal:
 * one grid unit along `+gx` is 35.8 world pixels and one along the `(1,1)` diagonal is 22.6. A
 * walker advanced at a constant rate in *grid* units visibly speeds up by 58% every time the
 * road turns, which looks exactly like a frame-rate problem and is not one.
 *
 * There is no `length`, deliberately: `nodeCount` and `arcLength` are different numbers in
 * different units, and a game that computes `reach` from the node count instead of the arc
 * length gets an economy that pays more for a zigzag than for a road.
 */
export class Path {
  #gx: Float64Array;
  #gy: Float64Array;
  #s: Float64Array;
  #count = 0;
  #version = 0;
  #failure: string | undefined = undefined;

  constructor(capacity = 64) {
    const n = Math.max(1, capacity);
    this.#gx = new Float64Array(n);
    this.#gy = new Float64Array(n);
    this.#s = new Float64Array(n);
  }

  /** Number of nodes, including both endpoints. `0` for an empty path. */
  get nodeCount(): number {
    return this.#count;
  }

  /** Total length in **world pixels**, and the domain of every `s` parameter in this module.
   *  `0` for an empty or single-node path. */
  get arcLength(): number {
    return this.#count === 0 ? 0 : (this.#s[this.#count - 1] as number);
  }

  /** Bumped on every mutation. Cache anything derived from the path against it — a crowd's
   *  spacing, a `reach`, a set of lamp offsets — and the recompute happens exactly once. */
  get version(): number {
    return this.#version;
  }

  /**
   * Why the last {@link PathFinder.find} writing into this path found nothing — a clause naming
   * the two tiles — or `undefined` if the last thing to touch it was a successful search, a
   * {@link Path.push} or a {@link Path.clear}.
   *
   * **This is the boot-time check that the boolean from `find` cannot be, because the search and
   * the sampling are usually in different modules.** A failed search clears its out path, an
   * empty path throws from {@link pathSample} and {@link pathProject}, and a generated world
   * puts a river across the gate on roughly one seed in fifty — so the first anyone hears of it
   * is a white screen on somebody else's machine, thrown from the render loop, a long way from
   * the search that caused it. A world builder that hands out a `Path` should either check the
   * boolean where it searched or leave this for whoever receives the path:
   *
   * ```ts
   * if (road.searchFailure !== undefined) {
   *   // no route, and the clause says between which two tiles. Author a fallback, pick another
   *   // seed, or refuse to start — but do it here, not sixty frames later.
   * }
   * ```
   *
   * A string rather than a boolean so the reason survives the trip: `pathSample` quotes it, and
   * "no route from (25, 9) to (7, 22)" is the difference between a bug report and a bug.
   */
  get searchFailure(): string | undefined {
    return this.#failure;
  }

  /**
   * Record that a search found no route, so an empty path can say why instead of only that it
   * is empty.
   *
   * Called by {@link PathFinder.find} on every failing return. Public because a game that
   * authors its routes some other way — a flow field walk, a hand-written spline generator —
   * has the same gap and the same need to say so; harmless to call, and cleared by the next
   * {@link Path.push} or {@link Path.clear}.
   */
  noteSearchFailed(fromGx: number, fromGy: number, toGx: number, toGy: number): void {
    this.#failure = `no route from (${String(fromGx)}, ${String(fromGy)}) to (${String(toGx)}, ${String(toGy)})`;
  }

  /** Grid x of node `i`. @throws RangeError when `i` is out of range, rather than returning
   *  `undefined` for a caller to trip over three systems away. */
  gxAt(i: number): number {
    return this.#gx[expectIndex(i, this.#count, 'Path.gxAt')] as number;
  }

  /** Grid y of node `i`. @throws RangeError when `i` is out of range. */
  gyAt(i: number): number {
    return this.#gy[expectIndex(i, this.#count, 'Path.gyAt')] as number;
  }

  /** Arc length in world pixels from the start to node `i`; `sAt(nodeCount - 1)` is
   *  {@link Path.arcLength}. @throws RangeError when `i` is out of range. */
  sAt(i: number): number {
    return this.#s[expectIndex(i, this.#count, 'Path.sAt')] as number;
  }

  /**
   * Append a node, extending {@link Path.arcLength} by the **world** distance from the
   * previous one.
   *
   * Fractional coordinates are allowed and are how a game hands in an authored road spline: a
   * valley road that is generated rather than searched still needs to be sampled, and it would
   * be a strange API that could only sample the routes it found itself.
   */
  push(gx: number, gy: number): void {
    if (this.#count === this.#gx.length) {
      const next = this.#gx.length * 2;
      const gxs = new Float64Array(next);
      gxs.set(this.#gx);
      this.#gx = gxs;
      const gys = new Float64Array(next);
      gys.set(this.#gy);
      this.#gy = gys;
      const ss = new Float64Array(next);
      ss.set(this.#s);
      this.#s = ss;
    }
    const i = this.#count;
    if (i === 0) {
      this.#s[0] = 0;
    } else {
      const dgx = gx - (this.#gx[i - 1] as number);
      const dgy = gy - (this.#gy[i - 1] as number);
      const dx = (dgx - dgy) * HALF_W;
      const dy = (dgx + dgy) * HALF_H;
      this.#s[i] = (this.#s[i - 1] as number) + Math.sqrt(dx * dx + dy * dy);
    }
    this.#gx[i] = gx;
    this.#gy[i] = gy;
    this.#count = i + 1;
    this.#version += 1;
    // A node makes any recorded failure history rather than news: this path now has a route,
    // whoever put it there, and a stale clause would send the next reader after the wrong thing.
    this.#failure = undefined;
  }

  /** Drop every node, keeping the buffers, and bump {@link Path.version}. Also forgets any
   *  {@link Path.searchFailure}: a deliberate clear is not a failed search, and a path that
   *  reported one after being emptied on purpose would cry wolf. */
  clear(): void {
    this.#count = 0;
    this.#version += 1;
    this.#failure = undefined;
  }

  /** Recompute the cumulative arc lengths in place after nodes have been removed. Internal to
   *  the module — {@link pathSimplify} is the only thing that shortens a path — and package
   *  private in spirit: it is a hash symbol away from being unreachable from outside. */
  #reindex(count: number): void {
    this.#count = count;
    this.#s[0] = 0;
    for (let i = 1; i < count; i++) {
      const dgx = (this.#gx[i] as number) - (this.#gx[i - 1] as number);
      const dgy = (this.#gy[i] as number) - (this.#gy[i - 1] as number);
      const dx = (dgx - dgy) * HALF_W;
      const dy = (dgx + dgy) * HALF_H;
      this.#s[i] = (this.#s[i - 1] as number) + Math.sqrt(dx * dx + dy * dy);
    }
    this.#version += 1;
  }

  /** Keep the nodes whose index appears in `keep[0 .. kept)`, in order, then reindex. The one
   *  mutation {@link pathSimplify} needs and the only reason this method exists. */
  compactTo(keep: Int32Array, kept: number): void {
    for (let i = 0; i < kept; i++) {
      const from = keep[i] as number;
      this.#gx[i] = this.#gx[from] as number;
      this.#gy[i] = this.#gy[from] as number;
    }
    this.#reindex(kept);
  }
}

/**
 * The second half of the sentence an empty path throws.
 *
 * **This is the whole of finding 8, and it is three lines.** An empty `Path` is thrown from
 * wherever it is *sampled* — the render loop — and caused wherever it was *searched*, usually
 * another module and always another moment. `PathFinder.find` returns `false` and clears its out
 * path, so a seed that puts a river across the gate produces a white screen at boot with a
 * message about position sampling and nothing at all about routes. Quoting
 * {@link Path.searchFailure} moves the two tiles that have no route between them into the error
 * a developer actually reads, and the same message tells the other case — an authored path that
 * nobody pushed to — which of the two it is.
 */
function emptyPathReason(path: Path): string {
  const failure = path.searchFailure;
  if (failure === undefined) {
    return 'nothing was ever pushed onto it, or it was cleared — build it before sampling it';
  }
  return `the last PathFinder.find on it failed with ${failure} — check the boolean find returns, or Path.searchFailure, before sampling`;
}

/**
 * The grid position at arc length `sPx` along the path, written into `out`.
 *
 * **The most important function in this package.** Fifty walkers are fifty calls, no
 * per-walker state, nothing allocated, identical on every replay.
 *
 * It takes a **world-pixel** arc length and writes a **{@link GridPoint}**, which is not a
 * mismatch but the point: parameterising by world length is what makes the motion look
 * uniform, and producing a grid position is what lets the result go straight into
 * `DepthSorter.addPoint`, `heightAt` and `gridToScreen` without a conversion — and, because
 * `Anchor` *is* a `GridPoint`, straight into an anchor.
 *
 * Clamps `sPx` to `[0, arcLength]` rather than wrapping. A caller who wants a loop writes the
 * modulo themselves and can therefore also write a ping-pong, a pause at the end, or a queue
 * that bunches up at the gate — none of which a built-in wrap would allow.
 *
 * `O(log nodeCount)`: a binary search over the cumulative lengths, then one lerp.
 *
 * @throws RangeError on an empty path. A walker sampling a path that was cleared this frame
 *   would otherwise sit silently at whatever `out` last held, which is a bug that looks like
 *   a rendering problem for as long as it takes to find. When the path is empty because a
 *   search failed, the message says so and names the two tiles — see {@link emptyPathReason}
 *   for why that sentence is worth building.
 */
export function pathSample(path: Path, sPx: number, out: GridPoint): GridPoint {
  const n = path.nodeCount;
  if (n === 0) {
    throw new RangeError(`pathSample: the path is empty — ${emptyPathReason(path)}`);
  }
  if (n === 1 || !(sPx > 0)) {
    out.gx = path.gxAt(0);
    out.gy = path.gyAt(0);
    return out;
  }
  const total = path.arcLength;
  if (sPx >= total) {
    out.gx = path.gxAt(n - 1);
    out.gy = path.gyAt(n - 1);
    return out;
  }
  // The last index whose arc length is <= s. Written as a "find first greater, step back"
  // search so that an s landing exactly on a node resolves to the segment *starting* there;
  // resolving it to the segment ending there would make a walker appear to stutter backwards
  // at every node boundary.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path.sAt(mid) <= sPx) lo = mid;
    else hi = mid - 1;
  }
  const s0 = path.sAt(lo);
  const s1 = path.sAt(lo + 1);
  // The span is strictly positive and the search is what makes it so: `lo` is the *greatest*
  // index with `sAt(lo) <= sPx`, so `sAt(lo + 1) > sPx >= sAt(lo)`. A zero-length segment —
  // two identical nodes, which an authored spline may well contain — can therefore never be
  // the one selected, and there is no division by zero to guard against.
  const t = (sPx - s0) / (s1 - s0);
  const gx0 = path.gxAt(lo);
  const gy0 = path.gyAt(lo);
  out.gx = gx0 + (path.gxAt(lo + 1) - gx0) * t;
  out.gy = gy0 + (path.gyAt(lo + 1) - gy0) * t;
  return out;
}

/**
 * Which of the eight compass directions the path is heading in at arc length `sPx`, as a
 * direction code for {@link DIR_DX}/{@link DIR_DY}. `0` on an empty path, on a single-node
 * path, and on a zero-length segment.
 *
 * A direction *code* rather than an angle, and that is a determinism decision as much as an
 * ergonomic one: the obvious implementation is `Math.atan2`, which ECMA-262 does not require
 * to be correctly rounded, so a facing that reaches a save file or a hash is not replayable
 * across engines. Comparing the signs and magnitudes of `dgx` and `dgy` against an exact
 * decimal constant is Tier A arithmetic — and is also exactly what a sprite with eight facings
 * wants.
 *
 * The eight sectors are equal in **grid** space, because the eight codes are grid directions.
 * They are emphatically not equal on screen: the projection squashes the vertical axis, so the
 * screen angles of the eight are 0°, 26.6°, 90°, 153.4°, 180°, 206.6°, 270° and 333.4°.
 */
export function pathDirAt(path: Path, sPx: number): number {
  const n = path.nodeCount;
  if (n < 2) return 0;
  const total = path.arcLength;
  let lo = 0;
  if (sPx >= total) {
    lo = n - 2;
  } else if (sPx > 0) {
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (path.sAt(mid) <= sPx) lo = mid;
      else hi = mid - 1;
    }
    // `lo` cannot reach `n - 1` here: `sPx < arcLength = sAt(n - 1)`, so the greatest index
    // whose arc length is at or below `sPx` is at most `n - 2` and `lo + 1` is always a node.
  }
  return dirCodeOf(path.gxAt(lo + 1) - path.gxAt(lo), path.gyAt(lo + 1) - path.gyAt(lo));
}

/** The direction code nearest to a grid-space delta, or `0` for no movement. Shared by
 *  {@link pathDirAt} and nothing else yet; it is a function rather than four lines inline
 *  because the eight-way classification is the kind of thing that gets written twice and
 *  disagrees with itself the second time. */
function dirCodeOf(dgx: number, dgy: number): number {
  const ax = dgx < 0 ? -dgx : dgx;
  const ay = dgy < 0 ? -dgy : dgy;
  if (ax === 0 && ay === 0) return 0;
  const orthoX = ay <= ax * TAN_22_5;
  const orthoY = ax <= ay * TAN_22_5;
  if (orthoX) return dgx > 0 ? 1 : 5;
  if (orthoY) return dgy > 0 ? 3 : 7;
  if (dgx > 0) return dgy > 0 ? 2 : 8;
  return dgy > 0 ? 4 : 6;
}

/**
 * The arc length of the point on the path nearest to grid position `(gx, gy)`.
 *
 * The inverse of {@link pathSample}, and the function that turns a *place* into a *number*:
 * `reach` is `pathProject(road, furthestLitLamp.gx, furthestLitLamp.gy)`, and an ending that
 * ignites each lamp staggered by its own projection is one line. Without it a game has to
 * store an arc length beside every object on the road and keep the two in sync through every
 * re-route.
 *
 * Nearest is measured in **world** space, like every other distance in this module, so a point
 * beside a diagonal stretch of road projects where it looks like it should rather than where
 * the grid metric would put it. Ties go to the smaller arc length, which keeps the answer
 * stable when a road doubles back on itself.
 *
 * @throws RangeError on an empty path — there is no point to be nearest to. The message names
 *   the reason, including the two tiles when a search is what emptied it.
 */
export function pathProject(path: Path, gx: number, gy: number): number {
  const n = path.nodeCount;
  if (n === 0) {
    throw new RangeError(`pathProject: the path is empty — ${emptyPathReason(path)}`);
  }
  const px = (gx - gy) * HALF_W;
  const py = (gx + gy) * HALF_H;
  let bestDist = Infinity;
  let bestS = 0;
  let ax = (path.gxAt(0) - path.gyAt(0)) * HALF_W;
  let ay = (path.gxAt(0) + path.gyAt(0)) * HALF_H;
  if (n === 1) return 0;
  for (let i = 0; i < n - 1; i++) {
    const bx = (path.gxAt(i + 1) - path.gyAt(i + 1)) * HALF_W;
    const by = (path.gxAt(i + 1) + path.gyAt(i + 1)) * HALF_H;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = ax + dx * t - px;
    const cy = ay + dy * t - py;
    const dist = cx * cx + cy * cy;
    // Strictly less, so the earliest segment wins a tie and the answer does not depend on
    // which end of a doubled-back road the loop happened to reach first.
    if (dist < bestDist) {
      bestDist = dist;
      const s0 = path.sAt(i);
      bestS = s0 + (path.sAt(i + 1) - s0) * t;
    }
    ax = bx;
    ay = by;
  }
  return bestS;
}

/**
 * Collapse the staircase: remove collinear runs, then pull the path straight wherever the
 * straight line is passable **and does not move the route onto worse ground than it was already
 * on**. Mutates in place and shortens {@link Path.arcLength}.
 *
 * A raw 8-way A\* result is a stair of unit steps — a road across open ground comes back as
 * alternating east and south-east moves — and a walker sampled along it weaves from side to
 * side like someone finding their keys in the dark. The artifact reads as "the pathfinder is
 * broken" when the path is in fact optimal. The same staircase also makes `arcLength` about 8%
 * longer than the road looks, which quietly overpays a `reach`-based economy.
 *
 * ## The pull is cost-aware, and that is not an optimization
 *
 * **A shortcut test that asks only "is this passable?" throws away the weighted route it was
 * handed.** Weighted movement cost is this module's headline feature: a searcher told that
 * scree is three times a road, or that a slope is `1 + steps of rise`, contours around the hard
 * ground and comes back with a route that is longer and cheaper. Hand that route to a
 * passability-only simplifier and every one of those contours is a shortcut it will happily
 * take, because the expensive ground is still *passable* — so the road comes back as exactly
 * the straight line the weights existed to avoid, the search having been run for nothing. The
 * only visible symptom is that the road looks wrong, and the natural conclusion is that the
 * cost function is wrong, which it is not.
 *
 * The rule instead is one sentence: **a pull may straighten the route, and may never move it
 * onto worse ground than the route was already on.** A shortcut is taken only when every tile
 * its straight line touches weighs no more than the cheapest tile on the stretch of route it
 * would remove.
 *
 * | ground under the run | what happens |
 * |---|---|
 * | one uniform weight | the line is never worse, so it always wins — the staircase collapses exactly as it did before |
 * | a detour around expensive ground | the line enters the expensive ground and is refused, contour intact |
 * | a route standing on ground the cost function now *refuses* | the route is already illegal, so any passable shortcut is taken |
 *
 * **A comparison of weights and not of totals**, which is the version that was tried first and
 * does not work. Two totals can only be compared through some notion of length, and there is no
 * length here that means the same thing on both sides: `PathFinder` prices a route by the tile
 * each *step enters*, while a straight line crosses tiles part-way and clips their corners, so
 * an integral along it is a different quantity that happens to have the same units. On a real
 * heightfield the two disagreed by 12% — enough that a dead-straight line came out "cheaper"
 * than the contour A\* had chosen, which is precisely the bug this is here to prevent. Weights
 * compare exactly, need no metric at all, and cannot be decided by a last-bit difference.
 *
 * The floor is taken over the route's own **nodes**, which for a searched route are exactly the
 * tiles it entered and were exactly what the search paid for. A node the cost function now
 * refuses drops the floor to zero or below, which is the third row of the table.
 *
 * On a map whose weights vary tile to tile — a heightfield with a slope term, which is the case
 * this exists for — that rule refuses most shortcuts, and the collinear pass below is where
 * nearly all the node count goes. That is the correct division of labour: removing a node that
 * lies exactly on the line between its neighbors cannot change the route at all, and moving one
 * always can.
 *
 * ## What it allocates
 *
 * Three small typed arrays, one per re-route: the surviving node list, one weight per node, and
 * the pulled list. The alternatives are a module-level scratch buffer — module-level mutable
 * state, banned by the constitution, and non-re-entrant besides — or three more parameters at
 * every call site. This runs when a route changes, not per frame.
 *
 * @param cost Omit to remove only exactly-collinear nodes, which is free and always safe. Pass
 *   one — **the same one the search used** — to also string-pull, which is what makes a route
 *   look like a road. Passing a different, stricter predicate used to be the only way to keep a
 *   weighted route; it is no longer, and it never should have been. The passability walk is a
 *   supercover — it visits every tile the straight line touches, including the ones it only
 *   clips — so a pull can refuse a legal shortcut but never accept an illegal one.
 */
export function pathSimplify(path: Path, cost?: TileCost): void {
  const n = path.nodeCount;
  if (n < 3) return;

  // Pass one, always: drop the nodes that lie exactly on the line between their neighbors. The
  // route through them is unchanged to the last bit — they are on it — so this is free and safe
  // whatever the cost function says, and on weighted ground where the pull below refuses almost
  // everything it is the only simplification there is.
  const keep = new Int32Array(n);
  let kept = 0;
  keep[kept++] = 0;
  for (let i = 1; i < n - 1; i++) {
    const px = path.gxAt(i) - path.gxAt(i - 1);
    const py = path.gyAt(i) - path.gyAt(i - 1);
    const qx = path.gxAt(i + 1) - path.gxAt(i);
    const qy = path.gyAt(i + 1) - path.gyAt(i);
    // Collinear *and* same-facing: a zero cross product also describes a path that doubles
    // straight back on itself, and dropping the turn-around node there would cut a corner
    // the route deliberately did not cut.
    if (px * qy - py * qx !== 0 || px * qx + py * qy <= 0) keep[kept++] = i;
  }
  keep[kept++] = n - 1;

  if (cost === undefined) {
    path.compactTo(keep, kept);
    return;
  }

  // One `cost` call per node, kept so the floor of any stretch of route is a running minimum
  // rather than a walk. These are the route's own tiles — for a searched route, exactly the ones
  // the search paid to enter.
  const nodeWeight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    nodeWeight[i] = cost(Math.floor(path.gxAt(i)), Math.floor(path.gyAt(i)));
  }

  // Greedy string pull: from the node we have committed to, reach as far ahead as a straight
  // line is both passable and no worse than the ground it replaces. Greedy rather than a funnel
  // because the funnel algorithm wants a corridor of portals, and what we have is a line of
  // tiles.
  const pulled = new Int32Array(kept);
  let count = 0;
  pulled[count++] = 0;
  let anchor = 0;
  while (anchor < kept - 1) {
    let far = anchor + 1;
    // The cheapest tile on the route from `anchor` up to `j`, folded in as `j` advances. Scanned
    // upward rather than downward — a downward scan could stop at its first success, but it
    // would need this figure for an arbitrary `j`, and a running minimum only runs one way.
    let cheapest = Infinity;
    for (let j = anchor + 1; j < kept; j++) {
      for (let i = (keep[j - 1] as number) + 1; i <= (keep[j] as number); i++) {
        const w = nodeWeight[i] as number;
        if (w < cheapest) cheapest = w;
      }
      if (j === anchor + 1) continue;
      const a = keep[anchor] as number;
      const b = keep[j] as number;
      const worst = segmentWorst(cost, path.gxAt(a), path.gyAt(a), path.gxAt(b), path.gyAt(b));
      if (worst === Infinity) continue;
      // A route standing on ground the cost function now refuses is not worth preserving — the
      // map changed under it, or the caller is simplifying against a stricter predicate than the
      // one it searched with — so any passable line across it wins.
      if (!(cheapest > 0) || worst <= cheapest) far = j;
    }
    pulled[count++] = far;
    anchor = far;
  }

  // The pull indexed the survivors; `compactTo` wants indices into the path. Rewritten in place
  // because `pulled[k] >= k` at every k, so nothing is read after it is overwritten.
  for (let k = 0; k < count; k++) pulled[k] = keep[pulled[k] as number] as number;
  path.compactTo(pulled, count);
}

/**
 * The **heaviest tile** the straight line from `(x0, y0)` to `(x1, y1)` touches, or `Infinity`
 * if it touches any tile the cost function refuses.
 *
 * The whole of {@link pathSimplify}'s shortcut test: a pull is allowed when this is no more than
 * the cheapest tile on the stretch of route it would replace. An extremum rather than a total,
 * because a total would need a length, and no length means the same thing on both sides of that
 * comparison — see {@link pathSimplify}. It also makes the test exact: two weights are integers
 * and compare without a tolerance.
 *
 * **The line between the node coordinates, not between cell centers.** That distinction is the
 * whole of this function's correctness and it cost a bug to find: a Bresenham walk between
 * *tile indices* traces the line between the centers of those tiles, which is a different line
 * from the one {@link pathSample} interpolates between the nodes themselves. Pulling a route
 * from `(9, 10)` to `(14, 13)` passes through tile `(10, 11)` on the node line and misses it
 * entirely on the center line — so the check passed and the crowd walked through the wall.
 *
 * A grid-traversal DDA instead: step to whichever axis boundary the ray reaches first, and at
 * an exact corner crossing — which is every crossing on a diagonal between whole nodes —
 * require *both* adjoining tiles rather than slipping between them. That is the same rule the
 * searcher applies with `cutCorners: false`, so a pull can never legalise a step the search
 * itself refused. A corner tile is only touched, never crossed, so it can veto a shortcut by
 * being impassable but does not otherwise weigh on it.
 *
 * Conservative in one direction only: it can refuse a legal shortcut, which costs a slightly
 * longer road, and it cannot accept an illegal one.
 */
function segmentWorst(cost: TileCost, x0: number, y0: number, x1: number, y1: number): number {
  let ix = Math.floor(x0);
  let iy = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  const runX = dx < 0 ? -dx : dx;
  const runY = dy < 0 ? -dy : dy;
  let worst = 0;
  // One crossing per tile boundary on each axis, plus the two tiles at the ends. Written out
  // rather than trusted so a coordinate that arrives as a NaN cannot spin here for ever.
  let guard = (ex > ix ? ex - ix : ix - ex) + (ey > iy ? ey - iy : iy - ey) + 2;
  for (; guard >= 0; guard--) {
    const weight = cost(ix, iy);
    if (!(weight > 0)) return Infinity;
    if (weight > worst) worst = weight;
    if (ix === ex && iy === ey) return worst;
    // **Recomputed from the current cell, never accumulated.** Adding a constant step to a
    // running parameter drifts: nine additions of 1/9 are not 1, so the moment the ray passes
    // exactly through a lattice corner is missed by an ulp and the walk takes one axis twice
    // and overshoots the end. Recomputing is one division and it makes the tie exact, because
    // division is correctly rounded and two spellings of the same rational round alike.
    // `Infinity` for an axis the ray does not move along keeps it out of the comparison
    // without a special case.
    const tX = runX === 0 ? Infinity : (dx > 0 ? ix + 1 - x0 : x0 - ix) / runX;
    const tY = runY === 0 ? Infinity : (dy > 0 ? iy + 1 - y0 : y0 - iy) / runY;
    if (tX < tY) {
      ix += stepX;
    } else if (tY < tX) {
      iy += stepY;
    } else if (iy === ey) {
      // A tie with only one axis left to cover: the segment ends on this lattice corner, and
      // taking both axes would step past the destination and walk until the guard ran out.
      ix += stepX;
    } else if (ix === ex) {
      iy += stepY;
    } else {
      // Exactly through a lattice corner with both axes still to cover. Both diagonal
      // neighbors must be clear, or this is the join of two walls — the same rule the search
      // applies with `cutCorners: false`, so a pull can never legalise a step it refused.
      if (!(cost(ix + stepX, iy) > 0)) return Infinity;
      if (!(cost(ix, iy + stepY) > 0)) return Infinity;
      ix += stepX;
      iy += stepY;
    }
  }
  return Infinity;
}

/**
 * The integer octile heuristic — exact, admissible, and with no `sqrt` in it.
 *
 * `STEP_DIAG · min(|dx|, |dy|) + STEP_ORTHO · ||dx| − |dy||` is the true cost of crossing that
 * offset over uniform ground, so it never overestimates as long as the smallest weight is 1,
 * and being *exact* rather than merely admissible is what keeps the expanded set small. With
 * diagonals off it degrades to Manhattan, which is the true cost there for the same reason.
 *
 * It is exact on **weight-1** ground and therefore *loose by the map's minimum weight* on any
 * other, which is why {@link PathFinder.find} scales it by {@link PathOptions.minWeight}. The
 * scaling lives at the call sites rather than in here so that this function stays what its name
 * says — the unweighted metric — and so that the one place the admissibility argument has to be
 * checked is the one place the weight appears.
 */
function octile(dx: number, dy: number, diagonals: boolean): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  if (!diagonals) return STEP_ORTHO * (ax + ay);
  const lo = ax < ay ? ax : ay;
  const hi = ax < ay ? ay : ax;
  return STEP_DIAG * lo + STEP_ORTHO * (hi - lo);
}

/** Node bookkeeping. `OPEN` is a distinct value from "never seen" so a node whose `g` improves
 *  can be re-pushed without a decrease-key, and `CLOSED` is what makes the stale copy left on
 *  the heap harmless when it surfaces. */
const OPEN = 1;
const CLOSED = 2;

/**
 * A\* over a tile source. Owns its node table and frontier, so a repeated query allocates
 * nothing.
 *
 * One instance per *caller*, not one per agent and not a module singleton — module-level
 * mutable state is banned by the constitution and would make two interleaved searches corrupt
 * each other's frontier in a way that reproduces once an hour and never in a test.
 *
 * Nodes are appended to dense arrays and found through a separate open-addressed index on
 * `core.hash2`, which is what lets both grow without invalidating the node indices the
 * frontier is holding. An unbounded source — `tileSourceOf` over seeded noise, which has no
 * edge at all — therefore costs exactly what a bounded island does, and no allocation depends
 * on how far from the origin the search happens to be. A design keyed on grid extent would
 * have made that impossible, which is why this one is not.
 */
export class PathFinder {
  #nodeGx: Int32Array;
  #nodeGy: Int32Array;
  #nodeG: Float64Array;
  #nodeState: Uint8Array;
  #nodeFrom: Int32Array;
  #nodeCount = 0;
  /** Slot `i` holds `node + 1`, so `0` means empty and no separate occupancy array is needed. */
  #index: Int32Array;
  #mask: number;
  #open: MinHeap;
  #unwind: Int32Array;
  #seq = 0;

  /** @param capacityTiles Expected distinct tiles per search. Everything grows by doubling, so
   *   this is a hint rather than a limit; sized right the finder never allocates again. */
  constructor(capacityTiles = 4096) {
    const n = Math.max(16, capacityTiles);
    this.#nodeGx = new Int32Array(n);
    this.#nodeGy = new Int32Array(n);
    this.#nodeG = new Float64Array(n);
    this.#nodeState = new Uint8Array(n);
    this.#nodeFrom = new Int32Array(n);
    let size = 32;
    while (size < n * 2) size *= 2;
    this.#index = new Int32Array(size);
    this.#mask = size - 1;
    this.#open = new MinHeap(n);
    this.#unwind = new Int32Array(64);
  }

  /**
   * Search.
   *
   * @returns `true` if `out` now holds a route from start to goal. `false` means unreachable
   *   **or** the node ceiling was hit — deliberately not distinguished, because a caller that
   *   behaves differently in the two cases has written a bug that only appears on large maps.
   *   `out` is cleared either way, so a failed search cannot leave the previous route behind to
   *   be walked by mistake — and {@link Path.searchFailure} is set, so the *emptiness* can still
   *   explain itself later even if this boolean is dropped. A dropped boolean is the normal way
   *   this goes wrong: the search is in the world builder and the sampling is in the frame.
   * @throws RangeError if the cost function returns a non-integer weight for a passable tile.
   *   Float costs are the replay divergence this module's header is about, and one comparison
   *   per examined neighbor is a cheap price for a bug whose only symptom is two players
   *   seeing different roads.
   * @throws RangeError if `options.minWeight` is not an integer `>= 1`, or if the cost function
   *   returns a passable weight below it. The second is the caller's declaration being wrong,
   *   and it is thrown rather than tolerated because the symptom of tolerating it is a route
   *   that is not the cheapest one with nothing at all to say so.
   */
  find(
    cost: TileCost,
    fromGx: number,
    fromGy: number,
    toGx: number,
    toGy: number,
    out: Path,
    options?: PathOptions,
  ): boolean {
    out.clear();
    const diagonals = options?.diagonals ?? true;
    const cutCorners = options?.cutCorners ?? false;
    const maxNodes = options?.maxNodes ?? 20000;
    const bounds = options?.bounds;
    const minWeight = options?.minWeight ?? 1;
    if (!Number.isInteger(minWeight) || minWeight < 1) {
      throw new RangeError(
        `PathFinder.find: expected options.minWeight to be an integer >= 1, got ${String(minWeight)}`,
      );
    }

    const startGx = Math.floor(fromGx);
    const startGy = Math.floor(fromGy);
    const goalGx = Math.floor(toGx);
    const goalGy = Math.floor(toGy);

    // Every failing exit goes through `#fail`, which records the two tiles on the out path.
    // Four `return false`s and one of them forgetting is exactly how the diagnostic would end
    // up being right in the cases nobody hits.
    if (!inRange(bounds, startGx, startGy) || !inRange(bounds, goalGx, goalGy)) {
      return this.#fail(out, startGx, startGy, goalGx, goalGy);
    }
    if (startGx === goalGx && startGy === goalGy) {
      out.push(startGx, startGy);
      return true;
    }
    // A goal standing on an impassable tile is unreachable by definition, and finding that out
    // now saves searching the whole reachable region to discover it.
    if (!(cost(goalGx, goalGy) > 0)) return this.#fail(out, startGx, startGy, goalGx, goalGy);

    this.#reset();
    const start = this.#node(startGx, startGy);
    this.#nodeG[start] = 0;
    this.#nodeState[start] = OPEN;
    this.#nodeFrom[start] = -1;
    // ## Why `minWeight × octile` never overestimates, in full, so a reader can check it
    //
    // A\* returns the cheapest route only while the estimate `h(n)` is a **lower bound** on the
    // true remaining cost from `n` to the goal. Take any legal route `n = t0, t1, …, tk = goal`
    // that this search could walk. Its cost is what the loop below charges, summed:
    //
    //     cost = Σ weight(t_i) × STEP_i         STEP_i ∈ { STEP_ORTHO, STEP_DIAG }
    //
    // Every `t_i` is a tile the route *enters*, and `minWeight` is the caller's declaration that
    // no passable tile weighs less than that. The step is the declaration and nothing else — the
    // comparison in the neighbor loop enforces it on the ground this search actually touched,
    // which is a net under the promise rather than the promise itself. So
    //
    //     cost >= minWeight × Σ STEP_i
    //
    // and `Σ STEP_i` is exactly what that same route would cost over weight-1 ground. `octile`
    // is the *minimum* unweighted cost over all 8-connected routes — it is a minimum because
    // `STEP_ORTHO <= STEP_DIAG <= 2 × STEP_ORTHO`, so no route is ever improved by trading a
    // diagonal for two orthogonals or the other way round — hence `Σ STEP_i >= octile(n, goal)`
    // and `cost >= minWeight × octile(n, goal) = h(n)`. Lower bound, so admissible. ∎
    //
    // **Every restriction this searcher applies only strengthens it.** `cutCorners: false`,
    // `bounds`, and impassable tiles each *delete* routes; deleting routes can only raise the
    // true remaining cost, and a lower bound over a superset is a lower bound over a subset.
    // `diagonals: false` deletes the diagonal steps too, and `octile` follows it into Manhattan,
    // which is the exact minimum over what is left. There is no combination in which the bound
    // has to be re-argued.
    //
    // It is also *consistent*: `octile` changes by at most one step per step, so
    // `h(n) − h(n') <= minWeight × STEP <= weight(n') × STEP`, the cost of the move. The
    // re-open branch in the loop below therefore stays dormant rather than becoming hot.
    //
    // And the frontier is undisturbed. `minWeight` is an integer, so `f = g + h` stays an exact
    // integer and the heap's `(key, insertion sequence)` order stays total — the Lattice
    // ordering rule, untouched, with no comparator anywhere near it. At the default of `1` the
    // keys are bit-identical to what this line pushed before the option existed.
    this.#open.push(
      start,
      minWeight * octile(startGx - goalGx, startGy - goalGy, diagonals),
      this.#seq++,
    );

    let expanded = 0;
    const dirs = diagonals ? 8 : 7;
    const step = diagonals ? 1 : 2;

    while (this.#open.size > 0) {
      const current = this.#open.pop();
      // The stale copy of a node whose `g` improved after it was pushed. Discarding it here is
      // what buys the absence of a decrease-key, and it is one comparison.
      if (this.#nodeState[current] === CLOSED) continue;
      this.#nodeState[current] = CLOSED;
      const cgx = this.#nodeGx[current] as number;
      const cgy = this.#nodeGy[current] as number;
      if (cgx === goalGx && cgy === goalGy) {
        this.#emit(current, out);
        return true;
      }
      expanded += 1;
      if (expanded >= maxNodes) return this.#fail(out, startGx, startGy, goalGx, goalGy);

      const gCurrent = this.#nodeG[current] as number;
      for (let code = 1; code <= dirs; code += step) {
        const dx = DIR_DX[code] as number;
        const dy = DIR_DY[code] as number;
        const nx = cgx + dx;
        const ny = cgy + dy;
        if (!inRange(bounds, nx, ny)) continue;
        const weight = cost(nx, ny);
        if (!(weight > 0)) continue;
        if (!Number.isInteger(weight)) {
          throw new RangeError(
            `PathFinder.find: expected an integer weight from the cost function at (${String(nx)}, ${String(ny)}), got ${String(weight)}`,
          );
        }
        // The declaration, checked against the ground it describes. Skipped for impassable
        // tiles, which are never entered and so never appear in the sum the argument above is
        // about. A silent lie here is a route that is not the cheapest one, reported as if it
        // were — so this is a throw and not a clamp: clamping to the weight just seen would
        // change the heuristic mid-search, and an ordering that changes under the heap is a
        // different kind of wrong answer.
        if (weight < minWeight) {
          throw new RangeError(
            `PathFinder.find: options.minWeight is ${String(minWeight)}, but the cost function returned ${String(weight)} at (${String(nx)}, ${String(ny)}) — declare the true minimum weight of the map, or the heuristic overestimates and the route found is not the cheapest one`,
          );
        }
        const diagonal = (code & 1) === 0;
        if (diagonal && !cutCorners) {
          // **Both** shared orthogonal neighbors must be passable. Checking only one lets an
          // agent slip through the join of two walls from whichever side was not checked.
          if (!(cost(cgx + dx, cgy) > 0) || !(cost(cgx, cgy + dy) > 0)) continue;
        }
        const tentative = gCurrent + weight * (diagonal ? STEP_DIAG : STEP_ORTHO);
        const node = this.#node(nx, ny);
        if (this.#nodeState[node] !== 0 && tentative >= (this.#nodeG[node] as number)) continue;
        this.#nodeG[node] = tentative;
        this.#nodeFrom[node] = current;
        this.#nodeState[node] = OPEN;
        // `minWeight × octile` — the admissibility argument is above the start push, and the
        // insertion sequence is still the only tie-break.
        this.#open.push(
          node,
          tentative + minWeight * octile(nx - goalGx, ny - goalGy, diagonals),
          this.#seq++,
        );
      }
    }
    return this.#fail(out, startGx, startGy, goalGx, goalGy);
  }

  /** Mark the out path with why it is empty and answer `false`, in one expression so that every
   *  failing exit of {@link PathFinder.find} is one line and none of them can forget. */
  #fail(out: Path, fromGx: number, fromGy: number, toGx: number, toGy: number): false {
    out.noteSearchFailed(fromGx, fromGy, toGx, toGy);
    return false;
  }

  #reset(): void {
    this.#nodeCount = 0;
    this.#index.fill(0);
    this.#open.clear();
    this.#seq = 0;
  }

  /** The node for a tile, creating it on first sight. Linear probing: the coordinates are
   *  compared on every probe, so a hash collision costs a step and never a wrong answer. */
  #node(gx: number, gy: number): number {
    let i = (hash2(HASH_SEED, gx, gy) >>> 0) & this.#mask;
    for (;;) {
      const entry = this.#index[i] as number;
      if (entry === 0) {
        if (this.#nodeCount === this.#nodeGx.length) this.#growNodes();
        if ((this.#nodeCount + 1) * 2 > this.#index.length) {
          this.#growIndex();
          // The table moved, so this probe is stale; start again in the new one.
          return this.#node(gx, gy);
        }
        const node = this.#nodeCount;
        this.#nodeCount = node + 1;
        this.#nodeGx[node] = gx;
        this.#nodeGy[node] = gy;
        this.#nodeG[node] = 0;
        this.#nodeState[node] = 0;
        this.#nodeFrom[node] = -1;
        this.#index[i] = node + 1;
        return node;
      }
      const node = entry - 1;
      if (this.#nodeGx[node] === gx && this.#nodeGy[node] === gy) return node;
      i = (i + 1) & this.#mask;
    }
  }

  #growNodes(): void {
    const next = this.#nodeGx.length * 2;
    const gx = new Int32Array(next);
    gx.set(this.#nodeGx);
    this.#nodeGx = gx;
    const gy = new Int32Array(next);
    gy.set(this.#nodeGy);
    this.#nodeGy = gy;
    const g = new Float64Array(next);
    g.set(this.#nodeG);
    this.#nodeG = g;
    const from = new Int32Array(next);
    from.set(this.#nodeFrom);
    this.#nodeFrom = from;
    const state = new Uint8Array(next);
    state.set(this.#nodeState);
    this.#nodeState = state;
  }

  /** Rehash the index. The *node* indices are untouched, which is the whole point of keeping
   *  the nodes dense and the table separate: the frontier is holding node indices and would be
   *  silently wrong if growth moved them. */
  #growIndex(): void {
    const size = this.#index.length * 2;
    this.#index = new Int32Array(size);
    this.#mask = size - 1;
    for (let node = 0; node < this.#nodeCount; node++) {
      let i = (hash2(HASH_SEED, this.#nodeGx[node] as number, this.#nodeGy[node] as number) >>> 0) & this.#mask;
      while ((this.#index[i] as number) !== 0) i = (i + 1) & this.#mask;
      this.#index[i] = node + 1;
    }
  }

  /** Walk `from` back to the start, then push forwards — a `Path` is built from its beginning,
   *  and reversing an array afterwards would allocate one per tap. */
  #emit(goal: number, out: Path): void {
    let count = 0;
    for (let at = goal; at >= 0; at = this.#nodeFrom[at] as number) count += 1;
    if (this.#unwind.length < count) this.#unwind = new Int32Array(count);
    let i = count - 1;
    for (let at = goal; at >= 0; at = this.#nodeFrom[at] as number) {
      this.#unwind[i] = at;
      i -= 1;
    }
    for (let k = 0; k < count; k++) {
      const node = this.#unwind[k] as number;
      out.push(this.#nodeGx[node] as number, this.#nodeGy[node] as number);
    }
  }
}

/** The seed for the node table's hash. Fixed rather than caller-supplied because the table is
 *  private: nothing outside this file can observe the probe order, so there is nothing to
 *  decorrelate it from. */
const HASH_SEED = 0x9e3779b9;

/** Is a tile inside an optional half-open search rectangle? Shared by both searchers, because
 *  two copies of a half-open bounds test is two chances to write one of them closed. */
function inRange(bounds: Readonly<TileRange> | undefined, gx: number, gy: number): boolean {
  if (bounds === undefined) return true;
  return gx >= bounds.gx0 && gx < bounds.gx1 && gy >= bounds.gy0 && gy < bounds.gy1;
}

/**
 * A direction per tile, pointing downhill towards the nearest goal. The answer to "fifty
 * walkers, one depot".
 *
 * A\* is `O(agents × path)`; a flow field is one Dijkstra sweep over the region, shared by
 * every agent and rebuilt only when the map changes. At fifty agents it is roughly fifty times
 * cheaper, it handles *many* goals for free — a walker heads for the nearest of six warehouses
 * at no extra cost, which A\* cannot do without six searches — and an agent that spawns
 * mid-frame gets a route with no search at all.
 *
 * **Reachability comes free.** "Have I just walled my walkers in?" is `dirAt(x, y) === 0` after
 * the wall is placed, or `costAt(x, y) < 0`. There is no flood-fill export and no
 * connected-component API, because the flow field the game already keeps is the connectivity
 * oracle.
 *
 * Bounded to a rectangle by construction: an infinite flow field is not a thing.
 */
export class FlowField {
  #gx0: number;
  #gy0: number;
  #w: number;
  #h: number;
  #range: TileRange;
  #cost: Float64Array;
  #dir: Uint8Array;
  #goals: Int32Array;
  #goalCount = 0;
  #queue: MinHeap;
  #builtAtVersion = -1;

  /** @throws RangeError if `w` or `h` is not an integer greater than zero. */
  constructor(gx0: number, gy0: number, w: number, h: number) {
    if (!Number.isInteger(w) || w <= 0 || !Number.isInteger(h) || h <= 0) {
      throw new RangeError(
        `FlowField: expected w and h to be integers > 0, got ${String(w)} and ${String(h)}`,
      );
    }
    this.#gx0 = gx0;
    this.#gy0 = gy0;
    this.#w = w;
    this.#h = h;
    this.#range = { gx0, gy0, gx1: gx0 + w, gy1: gy0 + h };
    this.#cost = new Float64Array(w * h);
    this.#dir = new Uint8Array(w * h);
    this.#goals = new Int32Array(16);
    this.#queue = new MinHeap(w * h);
    this.#cost.fill(-1);
  }

  /** The rectangle this field covers, half-open. The field's own object: read it, do not keep
   *  it and mutate it. */
  get range(): Readonly<TileRange> {
    return this.#range;
  }

  /**
   * The map version the last {@link FlowField.build} was told about; `-1` before the first
   * build and after any build that was not told one.
   *
   * `-1` and not `0`, so that an untold field always compares unequal to a real map's version
   * and therefore rebuilds. Failing towards a spare Dijkstra sweep is the right direction to
   * fail: the other way round, the crowd walks the old road for ever.
   */
  get builtAtVersion(): number {
    return this.#builtAtVersion;
  }

  /** Forget the previous goals. Cheap; the buffers stay. */
  clearGoals(): void {
    this.#goalCount = 0;
  }

  /** Add a destination. Tiles outside {@link FlowField.range} are ignored rather than an error
   *  — a warehouse can legitimately sit off the edge of the field, and refusing to build
   *  because of one would take the whole crowd down with it. */
  addGoal(gx: number, gy: number): void {
    const index = this.#indexOf(gx, gy);
    if (index < 0) return;
    if (this.#goalCount === this.#goals.length) {
      const next = new Int32Array(this.#goals.length * 2);
      next.set(this.#goals);
      this.#goals = next;
    }
    this.#goals[this.#goalCount] = index;
    this.#goalCount += 1;
  }

  /**
   * Integrate: one Dijkstra sweep outward from every goal at once.
   *
   * Deterministic — the frontier is ordered by accumulated cost with ties broken by **tile
   * index**, which is a total order over the field, so the same map and the same goals give the
   * same field on every engine.
   *
   * *(The RFC sketched a bucket queue. A binary heap is used instead because the largest edge
   * weight is whatever the caller's cost function returns, and a bucket queue sized for an
   * unknown maximum is either wrong or unbounded. The ordering guarantee is identical, and it
   * is the ordering that the determinism rests on.)*
   *
   * @param sourceVersion The `MutableTileSource.version` this build read, recorded in
   *   {@link FlowField.builtAtVersion} so a caller can decide whether to rebuild. Omit it and
   *   the field always reports itself stale.
   * @throws RangeError if the cost function returns a non-integer weight, for the reason
   *   {@link PathFinder.find} gives.
   */
  build(cost: TileCost, options?: PathOptions, sourceVersion = -1): void {
    const diagonals = options?.diagonals ?? true;
    const cutCorners = options?.cutCorners ?? false;
    this.#cost.fill(-1);
    this.#dir.fill(0);
    this.#queue.clear();
    this.#builtAtVersion = sourceVersion;

    for (let i = 0; i < this.#goalCount; i++) {
      const index = this.#goals[i] as number;
      if (this.#cost[index] !== -1) continue;
      this.#cost[index] = 0;
      this.#queue.push(index, 0, index);
    }

    const w = this.#w;
    const dirs = diagonals ? 8 : 7;
    const step = diagonals ? 1 : 2;
    while (this.#queue.size > 0) {
      const index = this.#queue.pop();
      const base = this.#cost[index] as number;
      const gx = this.#gx0 + (index % w);
      const gy = this.#gy0 + ((index / w) | 0);
      // The sweep runs outward *from* the goals, so what a neighbor pays to reach this tile is
      // the cost of entering *this* one. Reading the neighbor's weight instead is the classic
      // off-by-one-tile in a reverse Dijkstra, and it makes a road that is cheap in one
      // direction and expensive in the other.
      const enter = cost(gx, gy);
      if (!(enter > 0)) continue;
      if (!Number.isInteger(enter)) {
        throw new RangeError(
          `FlowField.build: expected an integer weight from the cost function at (${String(gx)}, ${String(gy)}), got ${String(enter)}`,
        );
      }
      for (let code = 1; code <= dirs; code += step) {
        const dx = DIR_DX[code] as number;
        const dy = DIR_DY[code] as number;
        const nx = gx + dx;
        const ny = gy + dy;
        const nIndex = this.#indexOf(nx, ny);
        if (nIndex < 0) continue;
        // A walker cannot be standing on an impassable tile, so it gets no direction at all.
        if (!(cost(nx, ny) > 0)) continue;
        const diagonal = (code & 1) === 0;
        if (diagonal && !cutCorners) {
          if (!(cost(nx, gy) > 0) || !(cost(gx, ny) > 0)) continue;
        }
        const next = base + enter * (diagonal ? STEP_DIAG : STEP_ORTHO);
        const known = this.#cost[nIndex] as number;
        if (known !== -1 && known <= next) continue;
        this.#cost[nIndex] = next;
        // The neighbor steps back towards this tile, which is the reverse of the direction the
        // sweep traveled: the codes run round a circle, so the reverse of `c` is `c + 4`
        // wrapped into 1..8.
        this.#dir[nIndex] = ((code + 3) % 8) + 1;
        this.#queue.push(nIndex, next, nIndex);
      }
    }
  }

  /** Direction code `1..8` to step next, or `0` for "no route from here" — which is also what a
   *  goal tile returns, because there is nowhere left to step. {@link FlowField.costAt} tells
   *  the two apart: a goal is `0` and no route is `-1`. */
  dirAt(gx: number, gy: number): number {
    const index = this.#indexOf(gx, gy);
    return index < 0 ? 0 : (this.#dir[index] as number);
  }

  /** Accumulated cost to the nearest goal in {@link STEP_ORTHO} units, or `-1` when the tile is
   *  unreachable or outside the field. */
  costAt(gx: number, gy: number): number {
    const index = this.#indexOf(gx, gy);
    return index < 0 ? -1 : (this.#cost[index] as number);
  }

  /** Sugar over {@link FlowField.dirAt}: writes the next tile into `out` and returns `true`, or
   *  returns `false` leaving `out` untouched when there is no route. */
  step(gx: number, gy: number, out: GridPoint): boolean {
    const code = this.dirAt(gx, gy);
    if (code === 0) return false;
    out.gx = gx + (DIR_DX[code] as number);
    out.gy = gy + (DIR_DY[code] as number);
    return true;
  }

  #indexOf(gx: number, gy: number): number {
    const dx = gx - this.#gx0;
    const dy = gy - this.#gy0;
    if (!(dx >= 0 && dx < this.#w && dy >= 0 && dy < this.#h)) return -1;
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) return -1;
    return dy * this.#w + dx;
  }
}
