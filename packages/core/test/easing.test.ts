/**
 * `easing` — the endpoint contract, exactly, and the Tier A guarantee as a grep.
 *
 * The endpoint assertions are `toBe`, never `toBeCloseTo`: `e(1) === 1` approximately is the
 * bug, not the test. The textbook `backIn` returns 0.9999999999999998 there, and a tween that
 * ends two-tenths of a nanometre short never fires its "arrived" callback.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EASINGS,
  backIn,
  backOut,
  bounceOut,
  cubicIn,
  cubicInOut,
  cubicOut,
  inOut,
  linear,
  quadIn,
  quadInOut,
  quadOut,
  quartOut,
  reverse,
  smooth,
  smoother,
  type Easing,
  type EasingName,
} from '../src/easing.js';

const NAMES: readonly EasingName[] = [
  'linear',
  'quadIn',
  'quadOut',
  'quadInOut',
  'cubicIn',
  'cubicOut',
  'cubicInOut',
  'quartOut',
  'backIn',
  'backOut',
  'bounceOut',
  'smooth',
  'smoother',
];

/** The curves that are allowed to leave [0, 1] between the endpoints. Everything else must not. */
const OVERSHOOTS: ReadonlySet<EasingName> = new Set<EasingName>(['backIn', 'backOut']);

describe('the endpoint contract', () => {
  it.each(NAMES)('%s starts at exactly 0 and ends at exactly 1', (name) => {
    // Invariant 22. `toBe`, not `toBeCloseTo` — see the file header.
    const e = EASINGS[name];
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
  });

  it.each(NAMES)('%s is finite across 101 samples of [0, 1]', (name) => {
    const e = EASINGS[name];
    for (let i = 0; i <= 100; i += 1) {
      const v = e(i / 100);
      expect(Number.isFinite(v), `${name}(${i / 100}) = ${v}`).toBe(true);
    }
  });

  it.each(NAMES)('%s stays inside [0, 1] unless it is a back curve', (name) => {
    const e = EASINGS[name];
    let left = false;
    for (let i = 0; i <= 100; i += 1) {
      const v = e(i / 100);
      if (v < 0 || v > 1) left = true;
    }
    expect(left, `${name} excursion`).toBe(OVERSHOOTS.has(name));
  });

  it.each(NAMES)('%s is monotonic where it should be', (name) => {
    // Everything except the two back curves and the bounce rises without ever going back.
    if (OVERSHOOTS.has(name) || name === 'bounceOut') return;
    const e = EASINGS[name];
    let previous = e(0);
    for (let i = 1; i <= 100; i += 1) {
      const v = e(i / 100);
      expect(v >= previous, `${name} fell at ${i / 100}`).toBe(true);
      previous = v;
    }
  });
});

describe('the table', () => {
  it('holds exactly the thirteen named curves, and each entry is the exported constant', () => {
    expect(Object.keys(EASINGS).sort()).toEqual([...NAMES].sort());
    expect(EASINGS.linear).toBe(linear);
    expect(EASINGS.quadIn).toBe(quadIn);
    expect(EASINGS.quadOut).toBe(quadOut);
    expect(EASINGS.quadInOut).toBe(quadInOut);
    expect(EASINGS.cubicIn).toBe(cubicIn);
    expect(EASINGS.cubicOut).toBe(cubicOut);
    expect(EASINGS.cubicInOut).toBe(cubicInOut);
    expect(EASINGS.quartOut).toBe(quartOut);
    expect(EASINGS.backIn).toBe(backIn);
    expect(EASINGS.backOut).toBe(backOut);
    expect(EASINGS.bounceOut).toBe(bounceOut);
    expect(EASINGS.smooth).toBe(smooth);
    expect(EASINGS.smoother).toBe(smoother);
  });

  it('is frozen, so a consumer cannot repoint a curve for everyone else', () => {
    expect(Object.isFrozen(EASINGS)).toBe(true);
  });

  it('resolves a name authored as data — the reason it exists', () => {
    const config: { readonly ease: EasingName } = { ease: 'backOut' };
    expect(EASINGS[config.ease](1)).toBe(1);
  });
});

describe('individual curves', () => {
  it('linear is the identity', () => {
    for (let i = 0; i <= 10; i += 1) expect(linear(i / 10)).toBe(i / 10);
  });

  it('quadIn and quadOut are reflections of each other', () => {
    // Algebraically identical, not bit-identical: `t(2 - t)` and `1 - (1 - t)²` round
    // differently in the middle. Both are exact at the endpoints, which is the contract.
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(Math.abs(quadOut(t) - (1 - quadIn(1 - t))) < 1e-15, `at ${t}`).toBe(true);
    }
    expect(quadOut(0)).toBe(0);
    expect(quadOut(1)).toBe(1);
  });

  it('quadIn accelerates and quadOut decelerates', () => {
    expect(quadIn(0.5)).toBe(0.25);
    expect(quadOut(0.5)).toBe(0.75);
  });

  it('cubicIn and cubicOut match their polynomials', () => {
    expect(cubicIn(0.5)).toBe(0.125);
    expect(cubicOut(0.5)).toBe(0.875);
    expect(quartOut(0.5)).toBe(0.9375);
  });

  it('the in-out curves cross exactly at (0.5, 0.5)', () => {
    // The half-way point of a symmetric curve is the one value a designer checks by eye.
    expect(quadInOut(0.5)).toBe(0.5);
    expect(cubicInOut(0.5)).toBe(0.5);
    expect(smooth(0.5)).toBe(0.5);
    expect(smoother(0.5)).toBe(0.5);
  });

  it('the in-out curves take both branches', () => {
    expect(quadInOut(0.25)).toBe(0.125);
    expect(quadInOut(0.75)).toBe(0.875);
    expect(cubicInOut(0.25)).toBe(0.0625);
    expect(cubicInOut(0.75)).toBe(0.9375);
  });

  it('backIn dips below 0 and backOut rises above 1', () => {
    expect(backIn(0.25) < 0).toBe(true);
    expect(backOut(0.75) > 1).toBe(true);
    // The overshoot is about 10% of the range, which is what makes it read as anticipation
    // rather than as a glitch.
    let peak = 0;
    for (let i = 0; i <= 100; i += 1) peak = Math.max(peak, backOut(i / 100));
    expect(peak > 1.05 && peak < 1.15).toBe(true);
  });

  it('backIn and backOut are reflections of each other', () => {
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(backOut(t)).toBe(1 - backIn(1 - t));
    }
  });

  it('bounceOut takes all four segments and touches 1 at each apex', () => {
    expect(bounceOut(0.2)).toBe(7.5625 * 0.2 * 0.2);
    expect(bounceOut(0.5) > 0.75).toBe(true);
    expect(bounceOut(0.8) > 0.9375).toBe(true);
    expect(bounceOut(0.95) > 0.984375).toBe(true);
    // The apexes: the curve returns to 1 at each segment boundary after the first.
    expect(bounceOut(2 / 2.75)).toBe(1);
    expect(bounceOut(2.5 / 2.75)).toBe(1);
    // ...and dips between them.
    expect(bounceOut(2.625 / 2.75)).toBe(0.984375);
  });

  it('bounceOut is continuous across its segment boundaries', () => {
    const h = 1e-9;
    for (const edge of [1 / 2.75, 2 / 2.75, 2.5 / 2.75]) {
      const gap = Math.abs(bounceOut(edge + h) - bounceOut(edge - h));
      expect(gap < 1e-6, `discontinuity at ${edge}: ${gap}`).toBe(true);
    }
  });

  it('smooth and smoother clamp rather than extrapolating', () => {
    expect(smooth(-1)).toBe(0);
    expect(smooth(2)).toBe(1);
    expect(smoother(-1)).toBe(0);
    expect(smoother(2)).toBe(1);
  });

  it('smoother has a zero second derivative at the ends, and smooth does not', () => {
    // The property that separates the two, and the reason `smoother` exists for a camera pan.
    const h = 1e-3;
    const secondDerivative = (e: Easing, t: number): number =>
      (e(t + h) - 2 * e(t) + e(t - h)) / (h * h);
    expect(Math.abs(secondDerivative(smoother, h)) < 0.1).toBe(true);
    expect(Math.abs(secondDerivative(smooth, h)) > 1).toBe(true);
  });
});

describe('reverse', () => {
  it('turns an in-curve into its out-curve', () => {
    const out = reverse(quadIn);
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(Math.abs(out(t) - quadOut(t)) < 1e-15, `at ${t}`).toBe(true);
    }
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
  });

  it('preserves the endpoint contract', () => {
    for (const name of NAMES) {
      const r = reverse(EASINGS[name]);
      expect(r(0)).toBe(0);
      expect(r(1)).toBe(1);
    }
  });

  it('is its own inverse', () => {
    const twice = reverse(reverse(cubicIn));
    for (let i = 0; i <= 10; i += 1) {
      expect(Math.abs(twice(i / 10) - cubicIn(i / 10)) < 1e-15, `at ${i / 10}`).toBe(true);
    }
    expect(twice(0)).toBe(0);
    expect(twice(1)).toBe(1);
  });
});

describe('inOut', () => {
  it('mirrors an in-curve into a symmetric in-out curve', () => {
    const built = inOut(quadIn);
    expect(built(0)).toBe(0);
    expect(built(0.5)).toBe(0.5);
    expect(built(1)).toBe(1);
    expect(built(0.25)).toBe(quadInOut(0.25));
    expect(built(0.75)).toBe(quadInOut(0.75));
  });

  it('reproduces the named in-out curves', () => {
    const built = inOut(cubicIn);
    for (let i = 0; i <= 100; i += 1) {
      const t = i / 100;
      expect(Math.abs(built(t) - cubicInOut(t)) < 1e-15, `at ${t}`).toBe(true);
    }
  });

  it('preserves the endpoint contract for every curve, including the overshooting ones', () => {
    for (const name of NAMES) {
      const built = inOut(EASINGS[name]);
      expect(built(0)).toBe(0);
      expect(built(1)).toBe(1);
    }
  });
});

describe('the Tier A guarantee', () => {
  it('the module names no transcendental — no sine easing, no expo easing', () => {
    // Invariant 8 for this module, as a grep. `easeInOutSine` is one `Math.cos` away at every
    // moment, and it would silently demote every tween that used it out of Tier A.
    const source = readFileSync(
      fileURLToPath(new URL('../src/easing.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(
      /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot)\b/.test(code),
    ).toBe(false);
  });

  it('the curves themselves allocate nothing per call', () => {
    // The two combinators return a closure by design and are called at authoring time. The
    // thirteen constants must not contain one.
    const source = readFileSync(
      fileURLToPath(new URL('../src/easing.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const constants = code.slice(0, code.indexOf('export const EASINGS'));
    expect(/return\s*[{[]/.test(constants)).toBe(false);
    // One arrow per exported curve, plus the one in the `Easing` type, and not one more. A
    // fourteenth arrow above the table is a closure allocated somewhere it must not be.
    expect((constants.match(/=>/g) ?? []).length).toBe(NAMES.length + 1);
  });
});
