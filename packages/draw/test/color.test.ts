/**
 * Color — the packing, and the derivation the whole look rests on.
 *
 * The two assertions that matter most are the neutral case (`shade(c, 1) === c`, exactly, or
 * every top face in the kit is subtly wrong and every golden needs re-blessing) and the tint
 * pull (without it the derivation is a gray multiply, every screenshot still renders, and every
 * screenshot looks like a placeholder).
 */

import { createRng } from '@lattice/core';
import { describe, expect, it } from 'vitest';
import {
  FACE_LEFT,
  FACE_RIGHT,
  FACE_TOP,
  LIGHT_TINT,
  SHADE_TINT,
  cssOf,
  hex,
  hexOf,
  hsl,
  hueToHex,
  mix,
  outlineOf,
  rgba,
  shade,
  withAlpha,
} from '../src/color.js';
import type { Rgba } from '../src/color.js';

const R = (c: Rgba): number => (c >>> 24) & 255;
const G = (c: Rgba): number => (c >>> 16) & 255;
const B = (c: Rgba): number => (c >>> 8) & 255;
const A = (c: Rgba): number => c & 255;

/** Euclidean distance in sRGB bytes. Not perceptual, deliberately — see `mix`. */
function distance(a: Rgba, b: Rgba): number {
  const dr = R(a) - R(b);
  const dg = G(a) - G(b);
  const db = B(a) - B(b);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 256 colors from a fixed seed, so a failure is reproducible rather than "sometimes". */
function sample(): Rgba[] {
  const rng = createRng('color-sample');
  const out: Rgba[] = [];
  for (let i = 0; i < 256; i++) {
    out.push(rgba(rng.int(0, 256), rng.int(0, 256), rng.int(0, 256), rng.int(0, 256)));
  }
  return out;
}

describe('rgba', () => {
  it('packs 0xRRGGBBAA and always unsigned', () => {
    expect(rgba(255, 0, 0)).toBe(0xff0000ff);
    expect(rgba(255, 0, 0)).toBe(4278190335);
    expect(rgba(255, 255, 255, 255) > 0).toBe(true);
  });

  it('clamps and rounds every channel', () => {
    expect(rgba(-10, 300, 12.6, 400)).toBe(rgba(0, 255, 13, 255));
  });

  it('turns a non-finite channel into 0 rather than into a NaN color', () => {
    // A NaN anywhere in the packing makes the whole integer NaN, which paints nothing and
    // reports nothing — the failure mode this clamp exists to remove.
    expect(rgba(Number.NaN, 10, 10)).toBe(rgba(0, 10, 10));
    expect(rgba(Number.POSITIVE_INFINITY, 10, 10)).toBe(rgba(0, 10, 10));
  });

  it('defaults alpha to fully opaque', () => {
    expect(A(rgba(1, 2, 3))).toBe(255);
  });
});

describe('shade', () => {
  it('is exactly the identity at factor 1, for 256 colors', () => {
    for (const c of sample()) expect(shade(c, 1)).toBe(c);
  });

  it('is exactly the identity for the top face, which is drawn at FACE_TOP', () => {
    expect(FACE_TOP).toBe(1);
    for (const c of sample()) expect(shade(c, FACE_TOP)).toBe(c);
  });

  it('pulls a darkened face toward SHADE_TINT, not merely toward black', () => {
    // The assertion that fails if someone replaces the derivation with a plain multiply. The
    // comparison is against the multiply, so it cannot pass by accident on a dark color.
    for (const c of sample()) {
      const plain = rgba(R(c) * FACE_RIGHT, G(c) * FACE_RIGHT, B(c) * FACE_RIGHT, A(c));
      const shaded = shade(c, FACE_RIGHT);
      if (plain === shaded) continue;
      expect(distance(shaded, SHADE_TINT)).toBeLessThan(distance(plain, SHADE_TINT));
    }
  });

  it('pulls a brightened face toward LIGHT_TINT', () => {
    for (const c of sample()) {
      const plain = rgba(R(c) * 1.3, G(c) * 1.3, B(c) * 1.3, A(c));
      const shaded = shade(c, 1.3);
      if (plain === shaded) continue;
      expect(distance(shaded, LIGHT_TINT)).toBeLessThanOrEqual(distance(plain, LIGHT_TINT));
    }
  });

  it('shifts a mid gray cool in shadow and warm in light', () => {
    const gray = rgba(128, 128, 128);
    const dark = shade(gray, FACE_RIGHT);
    const light = shade(gray, 1.3);
    expect(B(dark)).toBeGreaterThan(R(dark));
    expect(R(light)).toBeGreaterThan(B(light));
  });

  it('preserves alpha', () => {
    for (const c of sample()) {
      expect(A(shade(c, FACE_LEFT))).toBe(A(c));
      expect(A(shade(c, 1.5))).toBe(A(c));
    }
  });

  it('caps the tint pull at one full step, so it cannot overshoot past the tint', () => {
    // On a black base the multiply contributes nothing, so the result is the pull alone. An
    // uncapped pull would make `factor: -5` six times as strong as `factor: 0` and come out the
    // far side of SHADE_TINT.
    const black = rgba(0, 0, 0);
    expect(shade(black, -5)).toBe(shade(black, 0));
  });

  it('saturates rather than wrapping at the bright end', () => {
    const white = shade(rgba(250, 250, 250), 4);
    expect(R(white)).toBe(255);
    expect(G(white)).toBe(255);
    expect(B(white)).toBe(255);
  });
});

describe('outlineOf', () => {
  it('is darker than its base, or at the floor, and never pure black', () => {
    // The floor is what stops a near-black base producing a pure black stroke, which reads as a
    // wireframe at thumbnail size — so "darker than the base" holds everywhere except there.
    for (const c of sample()) {
      const line = outlineOf(c);
      expect(R(line) + G(line) + B(line)).toBeGreaterThan(0);
      expect(R(line)).toBeLessThanOrEqual(Math.max(8, R(c)));
      expect(B(line)).toBeLessThanOrEqual(Math.max(8, B(c)));
    }
  });

  it('keeps the base color hue ordering, so a recolour moves the outlines with it', () => {
    const warm = outlineOf(rgba(220, 90, 40));
    expect(R(warm)).toBeGreaterThan(B(warm));
    const cool = outlineOf(rgba(40, 90, 220));
    expect(B(cool)).toBeGreaterThan(R(cool));
  });

  it('floors a pure black base rather than returning it unchanged', () => {
    const line = outlineOf(rgba(0, 0, 0));
    expect(R(line)).toBeGreaterThan(0);
  });

  it('preserves alpha', () => {
    expect(A(outlineOf(rgba(10, 20, 30, 90)))).toBe(90);
  });
});

describe('withAlpha and mix', () => {
  it('replaces alpha from a 0–1 fraction and leaves rgb alone', () => {
    const c = rgba(10, 20, 30, 40);
    expect(withAlpha(c, 1)).toBe(rgba(10, 20, 30, 255));
    expect(withAlpha(c, 0)).toBe(rgba(10, 20, 30, 0));
    expect(withAlpha(c, 0.5)).toBe(rgba(10, 20, 30, 128));
  });

  it('clamps an out-of-range alpha instead of wrapping it', () => {
    expect(A(withAlpha(rgba(1, 1, 1), 4))).toBe(255);
    expect(A(withAlpha(rgba(1, 1, 1), -1))).toBe(0);
  });

  it('mixes endpoints exactly and clamps t', () => {
    const a = rgba(0, 0, 0, 0);
    const b = rgba(255, 255, 255, 255);
    expect(mix(a, b, 0)).toBe(a);
    expect(mix(a, b, 1)).toBe(b);
    expect(mix(a, b, -5)).toBe(a);
    expect(mix(a, b, 5)).toBe(b);
    expect(mix(a, b, 0.5)).toBe(rgba(128, 128, 128, 128));
  });
});

describe('cssOf and hexOf', () => {
  it('drops the alpha channel from the string when the color is opaque', () => {
    expect(cssOf(rgba(1, 2, 3))).toBe('rgb(1,2,3)');
    expect(hexOf(rgba(1, 2, 3))).toBe('#010203');
  });

  it('carries it when it is not', () => {
    expect(cssOf(rgba(1, 2, 3, 128))).toBe('rgba(1,2,3,0.502)');
    expect(hexOf(rgba(1, 2, 3, 128))).toBe('#01020380');
  });

  it('memoises on the integer, so a backend converting per frame allocates nothing', () => {
    const c = rgba(9, 8, 7);
    expect(cssOf(c)).toBe(cssOf(c));
  });

  it('drops the memo rather than growing without bound', () => {
    // The branch that stops a caller generating colors per frame from turning a cache into a
    // leak. Five thousand distinct colors is past the limit twice over.
    for (let i = 0; i < 5000; i++) cssOf(rgba(i & 255, (i >> 8) & 255, 7, 200 + (i & 7)));
    expect(cssOf(rgba(1, 2, 3))).toBe('rgb(1,2,3)');
  });
});

describe('hex', () => {
  it('parses all three forms, with or without the hash', () => {
    expect(hex('#f00')).toBe(rgba(255, 0, 0));
    expect(hex('#ff0000')).toBe(rgba(255, 0, 0));
    expect(hex('ff000080')).toBe(rgba(255, 0, 0, 128));
    expect(hex('#ABC')).toBe(rgba(0xaa, 0xbb, 0xcc));
  });

  it('round-trips through hexOf', () => {
    for (const c of sample()) expect(hex(hexOf(c))).toBe(c);
  });

  it('throws naming the input rather than rendering black', () => {
    expect(() => hex('#ff00')).toThrow(RangeError);
    expect(() => hex('#ff00')).toThrow(/#ff00/);
    expect(() => hex('rebeccapurple')).toThrow(/rebeccapurple/);
    expect(() => hex('')).toThrow(RangeError);
  });

  it('is not memoised, because it returns a primitive and runs at authoring time', () => {
    // The asymmetry with `cssOf` is deliberate: caching a number buys nothing, and a `Map` that
    // buys nothing is a `Map` that eventually leaks.
    for (let i = 0; i < 5000; i++) hex(`#${i.toString(16).padStart(6, '0')}`);
    expect(hex('#123456')).toBe(rgba(0x12, 0x34, 0x56));
  });
});

describe('hsl', () => {
  it('produces the primaries at the expected hues', () => {
    expect(hsl(0, 1, 0.5)).toBe(rgba(255, 0, 0));
    expect(hsl(120, 1, 0.5)).toBe(rgba(0, 255, 0));
    expect(hsl(240, 1, 0.5)).toBe(rgba(0, 0, 255));
    expect(hsl(60, 1, 0.5)).toBe(rgba(255, 255, 0));
    expect(hsl(300, 1, 0.5)).toBe(rgba(255, 0, 255));
  });

  it('wraps the hue, so an accumulating slider needs no modulo', () => {
    expect(hsl(380, 1, 0.5)).toBe(hsl(20, 1, 0.5));
    expect(hsl(-20, 1, 0.5)).toBe(hsl(340, 1, 0.5));
    expect(hsl(Number.NaN, 1, 0.5)).toBe(hsl(0, 1, 0.5));
  });

  it('is gray at zero saturation and clamps saturation and lightness both ways', () => {
    expect(hsl(200, 0, 0.5)).toBe(rgba(128, 128, 128));
    expect(hsl(200, 1, 0)).toBe(rgba(0, 0, 0));
    expect(hsl(200, 1, 1)).toBe(rgba(255, 255, 255));
    expect(hsl(200, 5, -5)).toBe(rgba(0, 0, 0));
    expect(hsl(200, -5, 0.5)).toBe(rgba(128, 128, 128));
    expect(hsl(200, 1, 5)).toBe(rgba(255, 255, 255));
  });

  it('takes alpha as a 0–1 fraction, unlike rgba', () => {
    expect(A(hsl(0, 1, 0.5, 0.5))).toBe(128);
  });

  it('covers the dark half of the lightness curve as well as the light half', () => {
    // `l < 0.5` and `l >= 0.5` take different branches, and a suite that only ever asks for
    // mid-lightness exercises one of them.
    expect(hsl(0, 1, 0.25)).toBe(rgba(128, 0, 0));
    expect(hsl(0, 1, 0.75)).toBe(rgba(255, 128, 128));
  });
});

describe('hueToHex', () => {
  it('is hexOf(hsl(...)) and takes overrides', () => {
    expect(hueToHex(0)).toBe(hexOf(hsl(0, 0.62, 0.54)));
    expect(hueToHex(0, 1, 0.5)).toBe('#ff0000');
  });
});
