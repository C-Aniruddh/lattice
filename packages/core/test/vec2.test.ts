/**
 * `vec2` — aliasing, allocation, and the one-way assignability that makes the whole
 * out-parameter design safe.
 *
 * Three kinds of test live here and they fail in three different ways:
 *
 * - **Behaviour.** Exact `toBe` assertions; this module is Tier A apart from the three
 *   functions that say otherwise.
 * - **Aliasing.** Every producer called with `out` aliasing an input, compared against the
 *   non-aliased result. This is the test that catches a body writing `out.x` before reading
 *   `a.y`, which only breaks for callers who were being careful about allocation.
 * - **Types.** `@ts-expect-error` assertions, checked by `tsc -p tsconfig.check.json` and not
 *   by the runtime. If `ReadonlyVec2` ever becomes assignable to `Vec2`, those lines stop
 *   erroring, the directive becomes unused, and the type-check fails — which is the only way
 *   a runtime suite can be told that a compile-time guarantee has gone.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EPSILON, TAU } from '../src/math.js';
import {
  v2,
  v2Add,
  v2AddScaled,
  v2Angle,
  v2Approx,
  v2Copy,
  v2Cross,
  v2Dist,
  v2DistSq,
  v2Dot,
  v2FromAngle,
  v2Len,
  v2LenSq,
  v2Lerp,
  v2Normalize,
  v2Perp,
  v2Rotate,
  v2Scale,
  v2Set,
  v2Sub,
  type ReadonlyVec2,
  type Vec2,
} from '../src/vec2.js';

/** Tier B comparison, spelled out rather than hidden behind `toBeCloseTo`. */
function within(actual: number, expected: number, tolerance: number, what = ''): void {
  expect(Math.abs(actual - expected) <= tolerance, `${what} ${actual} vs ${expected}`).toBe(true);
}

describe('v2', () => {
  it('defaults to the origin and takes components', () => {
    expect(v2()).toEqual({ x: 0, y: 0 });
    expect(v2(3, -4)).toEqual({ x: 3, y: -4 });
  });

  it('returns a fresh object every call — it is the allocator, and the only one here', () => {
    const a = v2(1, 2);
    const b = v2(1, 2);
    expect(a).not.toBe(b);
    a.x = 9;
    expect(b.x).toBe(1);
  });
});

describe('the setters', () => {
  it('v2Set writes both components and returns the same object', () => {
    const out = v2();
    expect(v2Set(out, 3, 4)).toBe(out);
    expect(out).toEqual({ x: 3, y: 4 });
  });

  it('v2Copy copies rather than aliasing — the difference that bites', () => {
    const source = v2(1, 2);
    const out = v2();
    v2Copy(out, source);
    source.x = 99;
    expect(out.x).toBe(1);
  });
});

describe('the arithmetic', () => {
  it('adds, subtracts and scales', () => {
    const out = v2();
    expect(v2Add(out, v2(1, 2), v2(10, 20))).toEqual({ x: 11, y: 22 });
    expect(v2Sub(out, v2(1, 2), v2(10, 20))).toEqual({ x: -9, y: -18 });
    expect(v2Scale(out, v2(1, 2), 3)).toEqual({ x: 3, y: 6 });
    expect(v2Scale(out, v2(1, 2), 0)).toEqual({ x: 0, y: 0 });
    expect(v2Scale(out, v2(1, 2), -1)).toEqual({ x: -1, y: -2 });
  });

  it('v2Sub gives the vector from b to a', () => {
    const out = v2();
    v2Sub(out, v2(5, 5), v2(1, 1));
    expect(out).toEqual({ x: 4, y: 4 });
  });

  it('v2AddScaled is the integration step without a temporary', () => {
    const position = v2(10, 10);
    const velocity = v2(2, -1);
    v2AddScaled(position, position, velocity, 0.5);
    expect(position).toEqual({ x: 11, y: 9.5 });
  });

  it('v2AddScaled with scalar 0 leaves the base alone', () => {
    const out = v2();
    expect(v2AddScaled(out, v2(3, 4), v2(100, 100), 0)).toEqual({ x: 3, y: 4 });
  });

  it('v2Lerp lands on both endpoints exactly', () => {
    // Same reason as `lerp`: a tween that ends at 0.9999999 of its target leaves the sprite a
    // sub-pixel off its tile forever.
    const a = v2(1e16, -3);
    const b = v2(1, 7);
    const out = v2();
    expect(v2Lerp(out, a, b, 0)).toEqual({ x: 1e16, y: -3 });
    expect(v2Lerp(out, a, b, 1)).toEqual({ x: 1, y: 7 });
  });

  it('v2Lerp interpolates and extrapolates', () => {
    const out = v2();
    expect(v2Lerp(out, v2(0, 0), v2(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
    expect(v2Lerp(out, v2(0, 0), v2(10, 20), 2)).toEqual({ x: 20, y: 40 });
  });
});

describe('the products', () => {
  it('v2Dot is zero for perpendicular vectors and signed by agreement', () => {
    expect(v2Dot(v2(1, 0), v2(0, 1))).toBe(0);
    expect(v2Dot(v2(1, 0), v2(1, 0))).toBe(1);
    expect(v2Dot(v2(1, 0), v2(-1, 0))).toBe(-1);
    expect(v2Dot(v2(3, 4), v2(5, 6))).toBe(39);
  });

  it('v2Cross says which side, exactly and without a single trig call', () => {
    expect(v2Cross(v2(1, 0), v2(0, 1))).toBe(1);
    expect(v2Cross(v2(1, 0), v2(0, -1))).toBe(-1);
    expect(v2Cross(v2(1, 0), v2(2, 0))).toBe(0);
    expect(v2Cross(v2(3, 4), v2(5, 6))).toBe(-2);
  });

  it('v2Cross is antisymmetric', () => {
    const a = v2(3, 7);
    const b = v2(-2, 5);
    expect(v2Cross(a, b)).toBe(-v2Cross(b, a));
  });
});

describe('the lengths', () => {
  it('measures the 3-4-5 triangle exactly', () => {
    expect(v2LenSq(v2(3, 4))).toBe(25);
    expect(v2Len(v2(3, 4))).toBe(5);
    expect(v2DistSq(v2(1, 1), v2(4, 5))).toBe(25);
    expect(v2Dist(v2(1, 1), v2(4, 5))).toBe(5);
  });

  it('is zero for a zero vector and for coincident points', () => {
    expect(v2LenSq(v2())).toBe(0);
    expect(v2Len(v2())).toBe(0);
    expect(v2Dist(v2(3, 3), v2(3, 3))).toBe(0);
    expect(v2DistSq(v2(3, 3), v2(3, 3))).toBe(0);
  });

  it('is symmetric in its arguments', () => {
    expect(v2Dist(v2(1, 2), v2(-9, 4))).toBe(v2Dist(v2(-9, 4), v2(1, 2)));
  });

  it('survives large components without a false infinity', () => {
    expect(v2Len(v2(3e150, 4e150))).toBe(5e150);
  });
});

describe('v2Normalize', () => {
  it('produces a unit vector', () => {
    const out = v2();
    v2Normalize(out, v2(3, 4));
    expect(out).toEqual({ x: 0.6, y: 0.8 });
    expect(v2Len(out)).toBe(1);
  });

  it('preserves the axes exactly', () => {
    const out = v2();
    expect(v2Normalize(out, v2(5, 0))).toEqual({ x: 1, y: 0 });
    expect(v2Normalize(out, v2(0, -2))).toEqual({ x: 0, y: -1 });
  });

  it('returns (0, 0) for a zero vector rather than NaN', () => {
    // The single most valuable decision in this module: a NaN position propagates through
    // every add, lerp and projection downstream and surfaces as an invisible sprite three
    // systems away from the zero-length subtraction that caused it.
    const out = v2(9, 9);
    expect(v2Normalize(out, v2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('returns (0, 0) for NaN and infinite inputs, for the same reason', () => {
    const out = v2();
    expect(v2Normalize(out, v2(NaN, 1))).toEqual({ x: 0, y: 0 });
    expect(v2Normalize(out, v2(Infinity, 0))).toEqual({ x: 0, y: 0 });
    expect(v2Normalize(out, v2(1e200, 1e200))).toEqual({ x: 0, y: 0 });
  });

  it('normalises a very small vector, down to the squared-length floor', () => {
    const out = v2();
    v2Normalize(out, v2(1e-100, 0));
    expect(out).toEqual({ x: 1, y: 0 });
    // Below ~1e-154 the squared length is subnormal and the direction loses digits; below
    // ~1e-162 it underflows and the answer is the documented (0, 0). No game coordinate is
    // within a hundred orders of magnitude of either.
    expect(v2Normalize(out, v2(1e-200, 0))).toEqual({ x: 0, y: 0 });
  });
});

describe('v2Perp', () => {
  it('rotates a quarter turn counter-clockwise, exactly', () => {
    const out = v2();
    expect(v2Perp(out, v2(1, 0))).toEqual({ x: 0, y: 1 });
    expect(v2Perp(out, v2(0, 1))).toEqual({ x: -1, y: 0 });
    expect(v2Perp(out, v2(3, 4))).toEqual({ x: -4, y: 3 });
  });

  it('is perpendicular and length-preserving', () => {
    const out = v2();
    const a = v2(3, 4);
    v2Perp(out, a);
    expect(v2Dot(a, out)).toBe(0);
    expect(v2Len(out)).toBe(v2Len(a));
  });

  it('four applications return the original — no drift, because there is no trigonometry', () => {
    const p = v2(7, -3);
    v2Perp(p, p);
    v2Perp(p, p);
    v2Perp(p, p);
    v2Perp(p, p);
    expect(p).toEqual({ x: 7, y: -3 });
  });
});

describe('v2Approx', () => {
  it('compares component-wise within the default epsilon', () => {
    expect(v2Approx(v2(1, 1), v2(1 + 1e-12, 1 - 1e-12))).toBe(true);
    expect(v2Approx(v2(1, 1), v2(1.001, 1))).toBe(false);
    expect(v2Approx(v2(1, 1), v2(1, 1.001))).toBe(false);
  });

  it('is inclusive at the exact boundary', () => {
    expect(v2Approx(v2(0, 0), v2(EPSILON, 0))).toBe(true);
    expect(v2Approx(v2(0, 0), v2(0.5, 0), 0.5)).toBe(true);
    expect(v2Approx(v2(0, 0), v2(0.5, 0), 0.25)).toBe(false);
  });

  it('is false when either component is NaN', () => {
    expect(v2Approx(v2(NaN, 0), v2(0, 0))).toBe(false);
    expect(v2Approx(v2(0, NaN), v2(0, 0))).toBe(false);
  });
});

describe('the Tier B three', () => {
  it('v2Rotate turns counter-clockwise', () => {
    const out = v2();
    v2Rotate(out, v2(1, 0), TAU / 4);
    within(out.x, 0, 1e-15, 'x');
    within(out.y, 1, 1e-15, 'y');
  });

  it('v2Rotate preserves length', () => {
    const out = v2();
    for (let i = 0; i < 16; i += 1) {
      v2Rotate(out, v2(3, 4), (TAU * i) / 16);
      within(v2Len(out), 5, 1e-14, `at step ${i}`);
    }
  });

  it('v2Rotate by zero is a copy', () => {
    const out = v2();
    expect(v2Rotate(out, v2(3, 4), 0)).toEqual({ x: 3, y: 4 });
  });

  it('v2Angle reports the direction in (-PI, PI]', () => {
    expect(v2Angle(v2(1, 0))).toBe(0);
    within(v2Angle(v2(0, 1)), TAU / 4, 1e-15);
    within(v2Angle(v2(0, -1)), -TAU / 4, 1e-15);
    expect(v2Angle(v2(-1, 0))).toBe(Math.PI);
    for (let i = 0; i < 64; i += 1) {
      const a = v2FromAngle(v2(), (TAU * i) / 64 - Math.PI / 2);
      const angle = v2Angle(a);
      expect(angle > -Math.PI && angle <= Math.PI, `${angle}`).toBe(true);
    }
  });

  it('v2Angle is 0 for a zero vector — meaningless, not wrong', () => {
    expect(v2Angle(v2(0, 0))).toBe(0);
  });

  it('v2FromAngle and v2Angle round-trip', () => {
    const out = v2();
    for (let i = 0; i < 32; i += 1) {
      const angle = (TAU * i) / 32 - Math.PI;
      if (angle <= -Math.PI) continue;
      v2FromAngle(out, angle);
      within(v2Angle(out), angle, 1e-12, `at ${angle}`);
    }
  });

  it('v2FromAngle defaults to unit length and honours an explicit one', () => {
    const out = v2();
    v2FromAngle(out, 0);
    expect(out).toEqual({ x: 1, y: 0 });
    v2FromAngle(out, 0, 5);
    expect(out).toEqual({ x: 5, y: 0 });
    v2FromAngle(out, TAU / 4, 2);
    within(v2Len(out), 2, 1e-15);
  });
});

describe('aliasing', () => {
  it('every producer tolerates out === an input', () => {
    // Invariant 24. Each case is compared against the same call written non-aliased; a body
    // that wrote a component before reading the one it still needed fails exactly here.
    const scratch = v2();

    const a1 = v2(1, 2);
    expect(v2Add(a1, a1, v2(10, 20))).toEqual(v2Add(scratch, v2(1, 2), v2(10, 20)));

    const a2 = v2(1, 2);
    expect(v2Add(a2, v2(10, 20), a2)).toEqual(v2Add(scratch, v2(10, 20), v2(1, 2)));

    const a3 = v2(1, 2);
    expect(v2Sub(a3, a3, v2(10, 20))).toEqual(v2Sub(scratch, v2(1, 2), v2(10, 20)));

    const a4 = v2(1, 2);
    expect(v2Sub(a4, v2(10, 20), a4)).toEqual(v2Sub(scratch, v2(10, 20), v2(1, 2)));

    const a5 = v2(1, 2);
    expect(v2Scale(a5, a5, 3)).toEqual(v2Scale(scratch, v2(1, 2), 3));

    const a6 = v2(1, 2);
    expect(v2AddScaled(a6, a6, v2(10, 20), 0.5)).toEqual(
      v2AddScaled(scratch, v2(1, 2), v2(10, 20), 0.5),
    );

    const a7 = v2(1, 2);
    expect(v2AddScaled(a7, v2(10, 20), a7, 0.5)).toEqual(
      v2AddScaled(scratch, v2(10, 20), v2(1, 2), 0.5),
    );

    const a8 = v2(1, 2);
    expect(v2Lerp(a8, a8, v2(10, 20), 0.5)).toEqual(v2Lerp(scratch, v2(1, 2), v2(10, 20), 0.5));

    const a9 = v2(1, 2);
    expect(v2Lerp(a9, v2(10, 20), a9, 0.5)).toEqual(v2Lerp(scratch, v2(10, 20), v2(1, 2), 0.5));

    const a10 = v2(3, 4);
    expect(v2Normalize(a10, a10)).toEqual(v2Normalize(scratch, v2(3, 4)));

    const a11 = v2(3, 4);
    expect(v2Copy(a11, a11)).toEqual({ x: 3, y: 4 });

    const a12 = v2(3, 4);
    expect(v2Perp(a12, a12)).toEqual(v2Perp(scratch, v2(3, 4)));

    const a13 = v2(3, 4);
    expect(v2Rotate(a13, a13, 1)).toEqual(v2Rotate(scratch, v2(3, 4), 1));
  });

  it('v2Perp aliased is not (-y, -y) — the specific corruption an obvious body produces', () => {
    const a = v2(3, 4);
    v2Perp(a, a);
    expect(a).toEqual({ x: -4, y: 3 });
  });

  it('the same vector passed as both inputs behaves', () => {
    const scratch = v2();
    const a = v2(3, 4);
    expect(v2Add(scratch, a, a)).toEqual({ x: 6, y: 8 });
    expect(v2Sub(scratch, a, a)).toEqual({ x: 0, y: 0 });
    expect(v2Dot(a, a)).toBe(25);
    expect(v2Cross(a, a)).toBe(0);
  });
});

describe('the out-parameter convention', () => {
  it('every producer returns the object it was given, not a copy', () => {
    // Trap 15 restated as a test: the return value *is* the scratch, so a value that must
    // survive the frame has to be copied into a vector the caller owns.
    const out = v2();
    const a = v2(1, 2);
    expect(v2Set(out, 0, 0)).toBe(out);
    expect(v2Copy(out, a)).toBe(out);
    expect(v2Add(out, a, a)).toBe(out);
    expect(v2Sub(out, a, a)).toBe(out);
    expect(v2Scale(out, a, 2)).toBe(out);
    expect(v2AddScaled(out, a, a, 2)).toBe(out);
    expect(v2Lerp(out, a, a, 0.5)).toBe(out);
    expect(v2Normalize(out, a)).toBe(out);
    expect(v2Perp(out, a)).toBe(out);
    expect(v2Rotate(out, a, 1)).toBe(out);
    expect(v2FromAngle(out, 1)).toBe(out);
  });

  it('a returned scratch is overwritten by the next call', () => {
    const scratch = v2();
    const mid = v2Lerp(scratch, v2(0, 0), v2(10, 10), 0.5);
    v2Lerp(scratch, v2(0, 0), v2(100, 100), 0.5);
    expect(mid.x).toBe(50);
  });
});

describe('the mutability ruling', () => {
  it('Vec2 is assignable to ReadonlyVec2', () => {
    // The useful direction. A caller declares `Vec2` everywhere and never converts.
    const mutable: Vec2 = v2(1, 2);
    const read: ReadonlyVec2 = mutable;
    expect(v2Len(read)).toBe(v2Len(mutable));
  });

  it('ReadonlyVec2 is not assignable to Vec2', () => {
    const read: ReadonlyVec2 = v2(1, 2);
    // @ts-expect-error ReadonlyVec2 must not be assignable to Vec2 — if this ever compiles, every out-parameter signature in the kit has silently stopped protecting anyone.
    const mutable: Vec2 = read;
    expect(mutable.x).toBe(1);
  });

  it('a frozen shared constant is rejected by the compiler, not by a runtime throw', () => {
    // The case that would otherwise justify a separate `Point` type, and the reason the pair
    // carries a phantom property: with `readonly` alone this line compiles, because
    // TypeScript ignores readonly modifiers when it checks assignability. The compile error
    // is the product — the alternative is the TypeError below, thrown in strict mode on the
    // one frame that path executes, in a build nobody type-checked.
    const ORIGIN: ReadonlyVec2 = Object.freeze(v2(0, 0));
    expect(() => {
      // @ts-expect-error a ReadonlyVec2 cannot be an output parameter
      v2Add(ORIGIN, v2(1, 1), v2(2, 2));
    }).toThrow(TypeError);
    expect(ORIGIN.x).toBe(0);
  });

  it('a readonly parameter still accepts an ordinary vector', () => {
    const a: Vec2 = v2(1, 0);
    const b: ReadonlyVec2 = { x: 0, y: 1 };
    expect(v2Dot(a, b)).toBe(0);
    expect(v2Cross(a, b)).toBe(1);
  });

  it('a plain object literal still satisfies both types, with nothing to declare', () => {
    // The phantom is optional on both sides precisely so that this keeps working: a caller in
    // `iso` or `ui` writes `{ x, y }` and never imports a brand.
    const literal: Vec2 = { x: 3, y: 4 };
    const read: ReadonlyVec2 = { x: 3, y: 4 };
    expect(v2Len(literal)).toBe(5);
    expect(v2Len(read)).toBe(5);
    expect(v2Add(literal, literal, read)).toEqual({ x: 6, y: 8 });
  });

  it('a foreign {x, y} type is a Vec2 — the kit does not require its own nominal type', () => {
    interface Point {
      x: number;
      y: number;
    }
    const p: Point = { x: 1, y: 2 };
    const asOut: Vec2 = p;
    const asRead: ReadonlyVec2 = p;
    expect(v2Scale(asOut, asRead, 2)).toEqual({ x: 2, y: 4 });
  });
});

describe('the hot path allocates nothing', () => {
  it('no function in the module contains an object, array or closure literal but the allocator', () => {
    // Invariant 25, as a source check. `v2` is the one allocator and its literal is the only
    // one permitted; a second `return {` here is 24,000 allocations a second at 400 sprites.
    const source = readFileSync(
      fileURLToPath(new URL('../src/vec2.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code.includes('=>')).toBe(false);
    expect((code.match(/return\s*[{[]/g) ?? []).length).toBe(1);
  });

  it('names a transcendental only in the three declared Tier B functions', () => {
    // Invariant 8. Every site is greppable, so an auditor can ask of each whether it reaches
    // a save file — which is the entire value of the marker.
    const source = readFileSync(
      fileURLToPath(new URL('../src/vec2.ts', import.meta.url)),
      'utf8',
    );
    const lines = source.split('\n');
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(
        ({ line }) =>
          /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|cbrt|hypot)\b/.test(line) &&
          !line.trimStart().startsWith('*') &&
          !line.trimStart().startsWith('//'),
      );
    // Five call sites across three functions: cos and sin in `v2Rotate` and in `v2FromAngle`,
    // and atan2 in `v2Angle`. A sixth means a fourth Tier B function arrived without an RFC.
    expect(sites.length).toBe(5);
    for (const { i } of sites) {
      const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      expect(window.includes('@tier-b'), `unmarked transcendental at line ${i + 1}`).toBe(true);
    }
  });
});
