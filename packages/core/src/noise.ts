/**
 * Gradient noise and fBm, as pure functions of a seed.
 *
 * Every function here is a pure function of its arguments — no cursor, no permutation
 * table, no setup call, no module-level state. A tile can therefore be regenerated in
 * isolation, in any order, on any machine, five versions later, which is the property that
 * lets a renderer cull, batch and re-sort freely. Sampling terrain from an `Rng` instead
 * ties the field to the order tiles were visited; see `hash2` for why that presents as "the
 * world changed when I bought a lamp".
 *
 * **Tier A throughout.** The gradients come from a fixed direction table selected by hash
 * bits, and not from the shader idiom `sin(hash) * 43758.5453` — which is not stable across
 * GPUs, let alone across JS engines, and would silently demote every field built on it to
 * presentation-only. There is no `Math.sin`, `Math.pow` or `Math.exp` in this file; the only
 * transcendental-looking constants are literals of `1/sqrt(2)` and `2/sqrt(3)`, written out
 * so no engine ever computes them.
 *
 * Determinism has a numeric range, though, and it is stated on each function: coordinates
 * must stay under ~2^24 in magnitude. Beyond that the fractional part loses resolution and
 * the field visibly flattens — the arithmetic is still bit-identical, it is just measuring
 * something else.
 */

import { expectFinite, expectInt, expectRange } from './guard.js';
import { hash2, hash3, hashStep } from './hash.js';

/**
 * `1 / sqrt(2)`, written as a literal.
 *
 * The diagonal gradients are unit-length, which is what bounds the output — a table of
 * `(±1, ±1)` diagonals would be `sqrt(2)` long and push the field past the range this
 * module promises.
 */
const DIAGONAL = 0.7071067811865476;

/**
 * `sqrt(2)`. Perlin noise built from unit gradients in N dimensions is bounded by
 * `sqrt(N) / 2`, so this scales 2D output up to fill [-1, 1] without ever leaving it.
 */
const SCALE_2D = 1.4142135623730951;

/** `2 / sqrt(3)` — the same normalisation for three dimensions. */
const SCALE_3D = 1.1547005383792515;

/** The most octaves `fbm2`/`fbm3` will run. Past this the frequency ladder has doubled
 *  beyond the coordinate resolution the module promises, so the extra layers are noise
 *  about noise; the cap turns a typo (`octaves = 1e9`) into an error rather than a hang. */
const MAX_OCTAVES = 16;

/**
 * Ken Perlin's quintic fade, `6t^5 - 15t^4 + 10t^3`.
 *
 * Zero first *and* second derivative at both ends. The cubic smoothstep leaves a
 * discontinuous second derivative at every lattice line, which is invisible in a heightfield
 * and very visible once anything differentiates it — a normal map, a slope-based tint, or a
 * camera following the surface.
 */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Linear interpolation in the form that lands exactly on `b` at `t === 1`. */
function mix(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b;
}

/**
 * Turn a negative zero into a positive one, and leave every other double untouched.
 *
 * A gradient dotted with a zero distance vector produces `-0` for half the directions in the
 * table, so without this a lattice point returns `-0` — which is not `Object.is`-equal to
 * the exactly-zero this module promises, and which `JSON.stringify` writes as `"0"`. A
 * heightfield persisted and reloaded would then differ from the one that was saved, and an
 * integrity comparison would fail for a reason nobody would ever find. Adding zero is exact
 * for every other value, so no sample moves.
 */
function unsignZero(value: number): number {
  return value + 0;
}

/**
 * Dot the distance vector with one of eight unit directions chosen by the low three bits.
 *
 * A `switch` rather than a table because a table lookup under `noUncheckedIndexedAccess` is
 * `number | undefined` at every corner of every sample, and the `?? 0` that silences it is a
 * branch that can never be tested. This form is also allocation-free by construction, which
 * a frozen array of pairs is not.
 */
function grad2(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0:
      return x;
    case 1:
      return -x;
    case 2:
      return y;
    case 3:
      return -y;
    case 4:
      return DIAGONAL * (x + y);
    case 5:
      return DIAGONAL * (y - x);
    case 6:
      return DIAGONAL * (x - y);
    default:
      return DIAGONAL * (-x - y);
  }
}

/**
 * The same over sixteen 3D directions: the twelve unit-length edge directions of a cube,
 * plus four repeats so the selector can be a mask rather than a modulo.
 *
 * The four repeats are Perlin's, and they are chosen to be the ones that keep the
 * distribution even across the axes rather than the first four in the list.
 */
function grad3(hash: number, x: number, y: number, z: number): number {
  switch (hash & 15) {
    case 0:
      return DIAGONAL * (x + y);
    case 1:
      return DIAGONAL * (y - x);
    case 2:
      return DIAGONAL * (x - y);
    case 3:
      return DIAGONAL * (-x - y);
    case 4:
      return DIAGONAL * (x + z);
    case 5:
      return DIAGONAL * (z - x);
    case 6:
      return DIAGONAL * (x - z);
    case 7:
      return DIAGONAL * (-x - z);
    case 8:
      return DIAGONAL * (y + z);
    case 9:
      return DIAGONAL * (z - y);
    case 10:
      return DIAGONAL * (y - z);
    case 11:
      return DIAGONAL * (-y - z);
    case 12:
      return DIAGONAL * (x + y);
    case 13:
      return DIAGONAL * (z - y);
    case 14:
      return DIAGONAL * (y - x);
    default:
      return DIAGONAL * (-y - z);
  }
}

/**
 * 2D gradient noise in [-1, 1]. A pure function of `(seed, x, y)`: no cursor, no setup, no
 * permutation table.
 *
 * Integer coordinates land on lattice points and return **exactly 0** (positive zero, so
 * `Object.is(noise2(s, 1, 1), 0)` holds and a saved value survives a JSON round trip) —
 * sample at a fractional scale (`x * 0.06`) or you will get a field of zeroes and conclude
 * the noise is broken. That is a property of gradient noise and not a bug: the gradient at a
 * lattice point is dotted with a zero distance vector.
 *
 * The `seed` argument separates fields that sample the same coordinates. Two systems on one
 * seed (height and moisture, say) receive the same field and the map reads as one feature
 * painted twice; give each its own constant or `rng.derive('moisture').seed`.
 *
 * Coordinates must stay under ~2^24 in magnitude. Beyond that the fractional part loses
 * resolution and the field visibly flattens; beyond 2^31 the lattice indices wrap, and the
 * field repeats.
 */
export function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fade(fx);
  const v = fade(fy);

  const n00 = grad2(hash2(seed, ix, iy), fx, fy);
  const n10 = grad2(hash2(seed, ix + 1, iy), fx - 1, fy);
  const n01 = grad2(hash2(seed, ix, iy + 1), fx, fy - 1);
  const n11 = grad2(hash2(seed, ix + 1, iy + 1), fx - 1, fy - 1);

  return unsignZero(mix(mix(n00, n10, u), mix(n01, n11, u), v) * SCALE_2D);
}

/**
 * 3D gradient noise in [-1, 1].
 *
 * The third axis is usually time — which is how a zero-asset kit animates water, smoke and
 * glow without storing a single frame. Advance `z` by `elapsed * rate` and the field flows;
 * because it is a pure function, the same `z` always renders the same frame, so a replay and
 * a screenshot test both stay stable.
 *
 * Same contract as {@link noise2}: integer coordinates return exactly 0, and every axis must
 * stay under ~2^24.
 */
export function noise3(seed: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);

  const n000 = grad3(hash3(seed, ix, iy, iz), fx, fy, fz);
  const n100 = grad3(hash3(seed, ix + 1, iy, iz), fx - 1, fy, fz);
  const n010 = grad3(hash3(seed, ix, iy + 1, iz), fx, fy - 1, fz);
  const n110 = grad3(hash3(seed, ix + 1, iy + 1, iz), fx - 1, fy - 1, fz);
  const n001 = grad3(hash3(seed, ix, iy, iz + 1), fx, fy, fz - 1);
  const n101 = grad3(hash3(seed, ix + 1, iy, iz + 1), fx - 1, fy, fz - 1);
  const n011 = grad3(hash3(seed, ix, iy + 1, iz + 1), fx, fy - 1, fz - 1);
  const n111 = grad3(hash3(seed, ix + 1, iy + 1, iz + 1), fx - 1, fy - 1, fz - 1);

  const z0 = mix(mix(n000, n100, u), mix(n010, n110, u), v);
  const z1 = mix(mix(n001, n101, u), mix(n011, n111, u), v);
  return unsignZero(mix(z0, z1, w) * SCALE_3D);
}

/**
 * Validate the shared fBm parameters, naming the caller.
 *
 * `octaves` and `gain` are the two arguments a call site gets wrong, and both fail silently
 * if unchecked: a fractional octave count truncates to a different field than the author
 * asked for, and a gain above 1 makes the sum diverge so the normalisation stops meaning
 * anything.
 */
function checkFbm(octaves: number, gain: number, caller: string): void {
  expectRange(expectInt(octaves, `${caller}.octaves`), 1, MAX_OCTAVES, `${caller}.octaves`);
  expectFinite(gain, `${caller}.gain`);
  // `guard` has no exclusive-bound validator and should not grow one for a single caller:
  // a gain of exactly 0 is a silent one-octave field, which is a different mistake from a
  // gain above 1 and worth its own message.
  if (gain <= 0 || gain > 1) {
    throw new RangeError(`${caller}.gain: expected a number in (0, 1], got ${String(gain)}`);
  }
}

/**
 * Fractal Brownian motion: `octaves` layers of {@link noise2}, each at twice the frequency
 * and `gain` times the amplitude, normalised back into [-1, 1].
 *
 * The normalisation is the point. Un-normalised fBm has a range that depends on the octave
 * count, so raising the detail of a terrain silently changes its sea level — the coastline
 * moves and nobody connects it to the slider they nudged.
 *
 * Each octave is sampled from its own derived seed rather than from the same field at a
 * doubled frequency, so no two layers share lattice points and the sum has no residual grid
 * in it.
 *
 * Lacunarity is fixed at 2 rather than exposed: it is the only value anyone uses, it is a
 * power of two (so the frequency ladder stays exact), and a fourth positional number here
 * would be write-only code at every call site.
 *
 * @param octaves - default 4. Above ~8 the extra layers are below one screen pixel.
 * @param gain - default 0.5. Above 1 the sum diverges and the normalisation is meaningless.
 * @throws RangeError if `octaves` is not an integer in [1, 16] or `gain` is not in (0, 1].
 */
export function fbm2(seed: number, x: number, y: number, octaves = 4, gain = 0.5): number {
  checkFbm(octaves, gain, 'fbm2');
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * noise2(hashStep(seed, octave), x * frequency, y * frequency);
    total += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * fBm over {@link noise3}. Same contract, same normalisation, same octave separation.
 *
 * @param octaves - default 4.
 * @param gain - default 0.5.
 * @throws RangeError if `octaves` is not an integer in [1, 16] or `gain` is not in (0, 1].
 */
export function fbm3(
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves = 4,
  gain = 0.5,
): number {
  checkFbm(octaves, gain, 'fbm3');
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum +=
      amplitude * noise3(hashStep(seed, octave), x * frequency, y * frequency, z * frequency);
    total += amplitude;
    amplitude *= gain;
    frequency *= 2;
  }
  return sum / total;
}
