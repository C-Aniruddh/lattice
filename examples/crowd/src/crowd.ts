/**
 * The exhibit, in one expression.
 *
 * ```ts
 * s = ((φ·i + t·v·pace(i)) mod 1) · route.arcLength
 * pathSample(route, s, out)
 * ```
 *
 * That is the whole of it. There is no walker record, no array of positions, no update step, no
 * spawn, no despawn and no allocation: a walker's position is a **pure function of its index and
 * the clock**, and the only thing the exhibit stores about two thousand people is the number two
 * thousand. `main.ts` never registers an `onUpdate` handler at all.
 *
 * ## Three choices that are load-bearing, and one that is not
 *
 * **The phase is the golden ratio, and that is what makes the slider feel right.** `φ·i mod 1` is
 * the low-discrepancy sequence: *every* prefix of it is near-uniformly spread, so a hundred
 * walkers are evenly spaced around a loop and so are a hundred and one — and the hundred-and-first
 * arrives without moving any of the hundred. Stratified spacing (`i / n`) would have re-spaced the
 * entire crowd on every drag of the count slider, and a hash phase would have clumped. It is also
 * exact: a multiply and a subtract are Tier A on every engine.
 *
 * **Pace is hashed, not shared.** With one speed the crowd is a chorus line for ever. With a pace
 * per index the loops shear against themselves continuously, which is what produces the gaps and
 * knots a real crowd has — from arithmetic, with nothing accumulating.
 *
 * **The odd lane of each pair runs backwards.** Two concentric rings at slightly different radii,
 * counter-flowing, is the difference between a promenade and a conveyor belt. It costs a sign.
 *
 * And the one that is not: `pathSample` and `pathDirAt` each run **their own binary search** over
 * the same `s`. There is no way to ask this package for a position and a facing together, so a
 * walker costs two searches where it should cost one — reported as a finding rather than worked
 * around, because working around it would mean a per-walker cache and the exhibit would be over.
 */
import { hash2, mod, toUnit } from '@lattice/core';
import { pathDirAt, pathSample, type GridPoint, type Path } from '@lattice/iso';

/**
 * Which loop walker `i` walks, by `i % 16`.
 *
 * A table rather than `i % routes.length`, because the eight loops are nowhere near the same
 * length: the outer promenade is three times the inner one, and an even share per route would put
 * a knot of people round the fountain and a deserted mile of waterfront. The counts here are
 * proportional to radius, so the *density* is even across the piazza. Count-independent, like
 * everything else in this file — walker 47 is on the same loop at 12 people as at 3,000.
 */
const LANE = [0, 4, 6, 2, 5, 7, 1, 4, 6, 3, 5, 7, 2, 4, 5, 3];

/** `1/φ`. The most irrational number there is, which is exactly what a phase wants to be. */
const PHI = 0.6180339887498949;

/** The same salt `people.ts` draws appearance from, so pace and person come from one identity. */
const WHO = 0x9d1a7f;

/** The crowd is three numbers and six curves. There is deliberately nowhere here to put a walker. */
export interface Crowd {
  readonly routes: readonly Path[];
  /** How many people exist. The panel's slider; the only number in the exhibit that ever moves. */
  count: number;
  /** World pixels a walker of average pace covers per second. */
  speed: number;
}

/**
 * Where walker `i` is at time `t`, into `out`, and which of the eight directions it faces.
 *
 * Called twice per walker per frame — once to place it in the depth sort, once to draw it — and
 * that is on purpose. Caching the first call's answer for the second would be the per-walker state
 * this exhibit exists to show is unnecessary; recomputing it is two binary searches and a lerp.
 */
export function walkerAt(c: Crowd, i: number, t: number, out: GridPoint): number {
  const lane = LANE[i % LANE.length] ?? 0;
  const route = c.routes[lane];
  if (route === undefined) return 0;
  const span = route.arcLength;
  const pace = 0.66 + toUnit(hash2(WHO, i, 7)) * 0.76;
  const back = (lane & 1) === 1;
  const s = mod(PHI * i + ((back ? -t : t) * c.speed * pace) / span, 1) * span;
  pathSample(route, s, out);
  const code = pathDirAt(route, s);
  // A walker running the loop backwards faces backwards. The eight codes run round a circle, so
  // the reverse of `c` is `c + 4` wrapped into 1..8 — the same arithmetic `FlowField` uses.
  return code === 0 || !back ? code : ((code + 3) % 8) + 1;
}
