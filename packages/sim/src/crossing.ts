/**
 * Solving for the instant a stock reaches a level.
 *
 * `sim` does not clamp. A game whose oil hits zero does not want a clamped integral — it wants
 * **the instant**, so it can put a commit there, extinguish the top lamp, rebuild the flow and
 * carry on. That turns a nonlinearity into a boundary, and the guttering sequence into a loop
 * bounded by *the number of lamps* rather than by time.
 *
 * ## Why this is a root-find and not a search through time
 *
 * Because the graph is nilpotent, `x_node(t)` is a **polynomial** of degree `degreeOf(eco, node)`
 * whose coefficients are `Aᵏx₀/k!` — the same terms the integrator already computes. So:
 *
 * | degree | method | exactness |
 * |---|---|---|
 * | 0 | constant; crosses only if it already equals `level` | exact |
 * | 1 | `t = (level − x₀)/c₁` | exact, one divide, **Tier A** |
 * | 2 | quadratic formula, cancellation-safe branch | exact, **Tier A** (`Math.sqrt`) |
 * | ≥ 3 | isolate on the derivative's roots, bisect each monotone segment | first root guaranteed; 60 Horner evaluations per segment |
 *
 * **The degree-≥3 path is still not a tick, and the difference is the whole argument.** A tick's
 * cost scales with the length of the interval; bisection's cost scales with the number of *bits
 * in the answer*. A fourteen-hour horizon and a one-second horizon both cost 60 iterations, the
 * result is accurate to an ulp rather than to a frame, and it does not change if the player's
 * machine is slower.
 *
 * Isolating on the derivative's roots is what makes it find the **first** crossing rather than
 * whichever one the bracket happened to contain: a stock that dips, is rescued, and drains again
 * must report the dip.
 *
 * A **source edge raises the degree of everything downstream by one**, and that changes the root
 * structure rather than merely the arithmetic: a stock that was constant becomes linear, one that
 * was linear becomes a parabola with a turning point, and a drain that would never have recovered
 * now might. All of that is handled — the coefficients come from the same augmented matrix the
 * integrator uses, and the unit slot is seeded in `coefficients` — but it is the reason a
 * depletion solve written against "the lowest-order term is linear" is wrong once a game adds its
 * first flat drip.
 *
 * Above degree 4 there is no algebraic alternative to want — Abel–Ruffini says the general
 * quintic has no solution in radicals, so "closed form for any graph" is not a thing anyone can
 * ship. That is a theorem, not a budget.
 *
 * ## What it will not find
 *
 * A **tangential touch** — a repeated root, a stock that grazes `level` and turns back — is found
 * only when the evaluation happens to land exactly on zero. Bisection is a sign-change method and
 * a graze has no sign change. That is the right behavior for a game as well as the honest one: a
 * lamp that reaches exactly zero oil for one instant and is refilled did not go out.
 *
 * Do not "improve" the bisection with a Newton step. Newton from an arbitrary start is what turns
 * a deterministic 60 iterations into a platform-dependent answer, and root-finding from
 * coefficients is already ill-conditioned at high degree.
 *
 * Isomorphic: no clock, no randomness, no platform. Tier A throughout — `+ − × ÷`, `Math.sqrt`
 * and a fixed iteration count.
 */

import { expectFinite } from '@latticekit/core';
import type { Economy, Stocks } from './graph.js';
import type { Flow } from './flow.js';

/**
 * Halvings per bracket. Fixed, never conditional on the bracket's width.
 *
 * 60 halvings take any bracket below its own last bit — 50,400 s / 2⁶⁰ is 4e-14 s — and the count
 * is fixed so that the cost of a solve is a property of the *answer's precision*, not of how long
 * the caller was willing to look. An early exit on convergence would be faster and would make the
 * iteration count depend on the inputs, which is the property this constant exists to deny.
 */
const BISECTION_STEPS = 60;

/** `Object.prototype.hasOwnProperty`, borrowed so a node named `hasOwnProperty` cannot lie. */
const owns = Object.prototype.hasOwnProperty;

/**
 * Read an array slot as the number it always is.
 *
 * `noUncheckedIndexedAccess` types every indexed read as `number | undefined`, and the tempting fix
 * is a `!`. This is the honest version, kept in one place so the redundant branch exists once
 * rather than eight times; every index handed to it comes from an array's own length, from
 * `Economy.index`, or from a degree that was computed against `poly`'s own size.
 */
function coeff(c: Float64Array | Int32Array | readonly number[], i: number): number {
  return c[i] ?? 0;
}

/** Evaluate by Horner, which is the numerically stable way to read a polynomial. */
function horner(c: Float64Array | readonly number[], degree: number, t: number): number {
  let value = coeff(c, degree);
  for (let i = degree - 1; i >= 0; i -= 1) value = value * t + coeff(c, i);
  return value;
}

/** `p'`, one degree lower. Allocates; only the degree-≥3 path reaches it. */
function derivative(c: Float64Array | readonly number[], degree: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= degree; i += 1) out.push(coeff(c, i) * i);
  return out;
}

/** Append ascending, dropping a repeat of the value already at the end. */
function push(out: number[], value: number): void {
  if (out.length === 0 || out[out.length - 1] !== value) out.push(value);
}

/**
 * Halve a sign-changing bracket a fixed number of times.
 *
 * `flo` is passed in rather than recomputed so the sign comparison uses the same evaluation the
 * caller already made — recomputing it at a bracket end is where an off-by-one-ulp disagreement
 * would flip a branch.
 */
function bisect(
  c: Float64Array | readonly number[],
  degree: number,
  lo: number,
  hi: number,
  flo: number,
): number {
  let a = lo;
  let b = hi;
  let fa = flo;
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const mid = (a + b) / 2;
    const fmid = horner(c, degree, mid);
    if ((fmid < 0) === (fa < 0)) {
      a = mid;
      fa = fmid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/**
 * The two roots of a quadratic, in ascending order, filtered to `[lo, hi]`.
 *
 * Uses the cancellation-safe branch: computing both roots from `(−b ± √Δ)/2a` loses most of the
 * significant figures of one of them whenever `b² ≫ 4ac`, which is exactly the common case of a
 * small quadratic term on top of a strong linear one — i.e. a slow second-order producer feeding a
 * fast drain, which is what a game's oil actually looks like.
 */
function quadraticRoots(
  c: Float64Array | readonly number[],
  lo: number,
  hi: number,
  out: number[],
): void {
  const a = coeff(c, 2);
  const b = coeff(c, 1);
  const k = coeff(c, 0);
  const discriminant = b * b - 4 * a * k;
  if (discriminant < 0) return;
  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + (b < 0 ? -root : root));
  const first = q === 0 ? 0 : q / a;
  const second = q === 0 ? 0 : k / q;
  const low = Math.min(first, second);
  const high = Math.max(first, second);
  if (low >= lo && low <= hi) push(out, low);
  if (high >= lo && high <= hi) push(out, high);
}

/**
 * Every root of `c` in `[lo, hi]`, ascending and deduplicated.
 *
 * Degrees 1 and 2 are algebraic. Above that the derivative's roots cut `[lo, hi]` into segments on
 * which `c` is monotone, and a monotone segment holds at most one root — which is what makes the
 * *first* one findable rather than merely *a* root. The recursion is `degree` deep and terminates
 * at the quadratic.
 */
function rootsIn(
  c: Float64Array | readonly number[],
  degree: number,
  lo: number,
  hi: number,
  out: number[],
): void {
  if (degree === 1) {
    const slope = coeff(c, 1);
    const root = -coeff(c, 0) / slope;
    if (root >= lo && root <= hi) push(out, root);
    return;
  }
  if (degree === 2) {
    quadraticRoots(c, lo, hi, out);
    return;
  }
  const critical: number[] = [];
  rootsIn(derivative(c, degree), degree - 1, lo, hi, critical);
  let a = lo;
  let fa = horner(c, degree, a);
  if (fa === 0) push(out, a);
  for (const b of [...critical, hi]) {
    const fb = horner(c, degree, b);
    if (fa !== 0 && fb !== 0 && (fa < 0) !== (fb < 0)) push(out, bisect(c, degree, a, b, fa));
    if (fb === 0) push(out, b);
    a = b;
    fa = fb;
  }
}

/**
 * Write the coefficients of `node`'s trajectory into `flow.poly` and return its degree.
 *
 * `c_k = (Aᵏx₀)[node] / k!` — the same terms `integrate` accumulates, held one node at a time
 * instead of summed. The returned degree is the highest `k` whose coefficient is non-zero, which
 * is often lower than `degreeOf(eco, node)` because a producer sitting at zero contributes
 * nothing: the *shape* of a graph is an upper bound, and the *state* decides the real degree.
 */
function coefficients<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  node: N,
): number {
  const poly = flow.poly;
  poly.fill(0);
  let term = flow.term;
  let next = flow.next;
  let read = 0;
  for (const id of eco.order) {
    term[read] = stocks[id];
    read += 1;
  }
  // The reserved unit slot every source edge multiplies by. Seeding it here is what makes a
  // constant inflow appear as a genuine `c₁` in the polynomial rather than as a dropped term —
  // and a dropped term is a shorter polynomial that still returns a plausible instant.
  term[eco.order.length] = 1;
  const at = eco.index[node];
  poly[0] = coeff(term, at);

  const rates = flow.rates;
  const edgeFrom = flow.edgeFrom;
  const edgeTo = flow.edgeTo;
  const edgeCount = eco.edges.length;
  let factorial = 1;
  let degree = 0;
  for (let k = 1; k <= eco.depth; k += 1) {
    next.fill(0);
    let live = false;
    for (let e = 0; e < edgeCount; e += 1) {
      const contribution = coeff(rates, e) * coeff(term, coeff(edgeFrom, e));
      if (contribution !== 0) {
        const target = coeff(edgeTo, e);
        next[target] = coeff(next, target) + contribution;
        live = true;
      }
    }
    if (!live) break;
    factorial *= k;
    const value = coeff(next, at) / factorial;
    poly[k] = value;
    if (value !== 0) degree = k;
    const swap = term;
    term = next;
    next = swap;
  }
  flow.term = term;
  flow.next = next;
  return degree;
}

/**
 * The first instant within `[0, horizonSeconds]` at which `node` reaches `level`, or `Infinity`
 * if it does not.
 *
 * `level` is usually `0`. Crossings in either direction are found; the caller knows which side it
 * started on. If `node` is already at `level` the answer is `0` — a stock sitting at zero has
 * already run out, and reporting anything else would make the guttering loop skip a lamp.
 *
 * The rates it reads are whatever {@link buildFlow} last put in `flow`, so a crossing is answered
 * for the economy *as it is now*. Change a gate and the answer changes, which is the point: the
 * caller re-solves after every commit.
 *
 * Allocates one small array, plus one per level of the degree-≥3 recursion. This is a boundary
 * call — per lamp, per commit — never a per-frame one.
 *
 * @param horizonSeconds - Must be finite. Bisection needs a bounded bracket, and "ever" is not a
 *   question a game can act on anyway: pass the horizon you would actually do something about,
 *   such as the seconds until dawn.
 * @returns seconds from `stocks`, or `Infinity`. Never negative, never `NaN`.
 * @throws TypeError if `node` is not a string — checked before the membership test, so a node
 *   *object* is not reported as an undeclared node called `[object Object]`.
 * @throws RangeError if `node` is not a node of `eco`, or if `level` or `horizonSeconds` is not
 *   finite.
 */
export function solveCrossing<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  node: N,
  level: number,
  horizonSeconds: number,
): number {
  if (typeof node !== 'string') {
    throw new TypeError(
      `sim.solveCrossing: expected node to be a node id string, got ${node === null ? 'null' : typeof node}`,
    );
  }
  if (!owns.call(eco.index, node)) {
    throw new RangeError(
      `sim.solveCrossing: '${node}' is not a node of this economy — declared nodes are ${eco.nodes.join(', ')}`,
    );
  }
  expectFinite(level, 'sim.solveCrossing: level');
  expectFinite(horizonSeconds, 'sim.solveCrossing: horizonSeconds');

  const degree = coefficients(eco, stocks, flow, node);
  const poly = flow.poly;
  poly[0] = coeff(poly, 0) - level;
  if (poly[0] === 0) return 0;
  if (degree === 0 || horizonSeconds <= 0) return Infinity;

  const roots: number[] = [];
  rootsIn(poly, degree, 0, horizonSeconds, roots);
  const first = roots[0];
  return first === undefined ? Infinity : first;
}
