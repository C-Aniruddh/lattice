import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, NIGHT, hueToHex, lerpPalette } from '@lattice/draw';
import { createOverlay, type Overlay } from '../src/overlay.js';
import { applyPalette, setBrand, setTokens } from '../src/theme.js';
import { thumbnails } from '../src/thumb.js';
import { fakeClock, installDom, type DomHandle, type FakeElement } from './dom.js';

let dom: DomHandle;
let ui: Overlay;

/** The package's own defaults, restated here because they are what the derivation below pins. */
const SAT = 0.72;
const LIGHT = 0.62;
const STEP = 0.14;

beforeEach(() => {
  dom = installDom();
  ui = createOverlay({ now: fakeClock().now });
});

afterEach(() => {
  dom.restore();
});

function root(): FakeElement {
  return ui.root as unknown as FakeElement;
}

/** The three channels of a `#rrggbb`. */
function channels(value: string): readonly number[] {
  return [1, 3, 5].map((at) => Number.parseInt(value.slice(at, at + 2), 16));
}

/** The strongest channel's distance between two colors, in sRGB levels. */
function separation(a: string, b: string): number {
  const left = channels(a);
  const right = channels(b);
  return Math.max(...left.map((value, i) => Math.abs(value - (right[i] ?? 0))));
}

/** The worst hue's separation between the brand and its nearer companion, for a lightness step. */
function worstSeparation(step: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (let hue = 0; hue < 360; hue++) {
    const brand = hueToHex(hue, SAT, LIGHT);
    const nearest = Math.min(
      separation(brand, hueToHex(hue, SAT, LIGHT + step)),
      separation(brand, hueToHex(hue, SAT, LIGHT - step)),
    );
    if (nearest < worst) worst = nearest;
  }
  return worst;
}

function vars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, entry] of root().style.props) {
    if (prop.startsWith('--')) out[prop] = entry.value;
  }
  return out;
}

describe('setBrand', () => {
  it('writes exactly three custom properties, on the root and nowhere else', () => {
    setBrand(ui, 210);
    expect(vars()).toEqual({
      '--lattice-brand': hueToHex(210, SAT, LIGHT),
      '--lattice-brand-hi': hueToHex(210, SAT, LIGHT + STEP),
      '--lattice-brand-lo': hueToHex(210, SAT, LIGHT - STEP),
    });
  });

  it('derives through draw’s color model, so the HUD and the buildings share a hue', () => {
    // Not a re-implementation: the assertion is that the string came out of `hueToHex`, which is
    // the kit's one color model. A second model here is how an accent stops matching the world.
    setBrand(ui, 33, { saturation: 0.5, lightness: 0.4 });
    expect(vars()['--lattice-brand']).toBe(hueToHex(33, 0.5, 0.4));
  });

  it('separates the triplet by at least 48 sRGB levels on every one of the 360 hues', () => {
    // The first half of the 0.14 derivation. 48 levels is a fifth of the range, against a
    // just-noticeable difference of two or three, so the raised and inset edges read as edges on
    // every brand rather than as a rendering artifact on the unlucky ones.
    expect(worstSeparation(STEP)).toBeGreaterThanOrEqual(48);
  });

  it('is at the knee: a wider step buys almost nothing, a narrower one loses a lot', () => {
    // The second half. Below the knee each extra hundredth of lightness is worth about four
    // levels; above it the lighter companion is clipping and it is worth one or none. Taking
    // more of the lightness range past here would cost contrast headroom for no separation.
    const here = worstSeparation(STEP);
    const belowRate = (here - worstSeparation(STEP - 0.05)) / 5;
    const aboveRate = (worstSeparation(STEP + 0.06) - here) / 6;
    expect(belowRate).toBeGreaterThanOrEqual(2);
    expect(aboveRate).toBeLessThanOrEqual(1);
  });

  it('wraps the hue, so an accumulating slider never needs a modulo', () => {
    setBrand(ui, 380);
    const wrapped = { ...vars() };
    setBrand(ui, 20);
    expect(vars()).toEqual(wrapped);
  });

  it('clamps a saturation or lightness outside 0..1 rather than producing nonsense', () => {
    setBrand(ui, 100, { saturation: 5, lightness: -3 });
    expect(vars()['--lattice-brand']).toBe(hueToHex(100, 1, 0));
  });

  it('refuses a hue, saturation or lightness that is not finite', () => {
    expect(() => setBrand(ui, Number.NaN)).toThrow(RangeError);
    expect(() => setBrand(ui, 10, { saturation: Number.NaN })).toThrow(RangeError);
    expect(() => setBrand(ui, 10, { lightness: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('writes nothing at all the second time the same hue is set', () => {
    setBrand(ui, 210);
    const spy = vi.spyOn(root().style, 'setProperty');
    setBrand(ui, 210);
    expect(spy).not.toHaveBeenCalled();
    setBrand(ui, 211);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('invalidates every thumbnail cache on the overlay — the stale-art half of trap 7', () => {
    const cache = thumbnails(ui);
    cache.url('rig|1|240x140', { width: 24, height: 14, dpr: 1, paint: () => undefined });
    expect(cache.size).toBe(1);
    setBrand(ui, 12);
    expect(cache.size).toBe(0);
  });
});

describe('setTokens', () => {
  it('writes arbitrary custom properties, change-guarded', () => {
    setTokens(ui, { '--panel-radius': '12px', '--danger': '#c33' });
    expect(vars()).toEqual({ '--panel-radius': '12px', '--danger': '#c33' });
    const spy = vi.spyOn(root().style, 'setProperty');
    setTokens(ui, { '--panel-radius': '12px' });
    expect(spy).not.toHaveBeenCalled();
    setTokens(ui, { '--panel-radius': '14px' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('names the key that is not a custom property', () => {
    expect(() => setTokens(ui, { color: 'red' })).toThrow(RangeError);
    expect(() => setTokens(ui, { color: 'red' })).toThrow(/"color"/);
  });

  it('accepts an empty object, and skips a key whose value is undefined', () => {
    expect(() => setTokens(ui, {})).not.toThrow();
    setTokens(ui, { '--maybe': undefined as unknown as string });
    expect(vars()).toEqual({});
  });
});

describe('applyPalette', () => {
  it('namespaces every key and says whether anything moved — invariant 12', () => {
    expect(applyPalette(ui, { sky: '#89a', ground: '#432' })).toBe(true);
    expect(vars()).toEqual({ '--lattice-sky': '#89a', '--lattice-ground': '#432' });
    expect(applyPalette(ui, { sky: '#89a', ground: '#432' })).toBe(false);
  });

  it('writes only the keys whose value actually differs', () => {
    applyPalette(ui, { sky: '#89a', ground: '#432' });
    const spy = vi.spyOn(root().style, 'setProperty');
    expect(applyPalette(ui, { sky: '#89a', ground: '#111' })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('--lattice-ground', '#111');
  });

  it('takes a custom prefix, and an empty one for a game that owns its token names', () => {
    applyPalette(ui, { sky: '#89a' }, { prefix: 'game' });
    applyPalette(ui, { ground: '#432' }, { prefix: '' });
    expect(vars()).toEqual({ '--game-sky': '#89a', '--ground': '#432' });
  });

  it('accepts exactly what draw’s lerpPalette returns, which is the seam', () => {
    // No adapter, no conversion, no second color model: `draw` produces a name-to-CSS bag and
    // this consumes it. If either side changed shape, this line would stop compiling.
    const dusk = lerpPalette(DAY, NIGHT, 0.5);
    expect(applyPalette(ui, dusk)).toBe(true);
    const written = vars();
    for (const key of Object.keys(dusk)) {
      expect(written[`--lattice-${key}`]).toBe(dusk[key]);
    }
  });

  it('is a no-op for the same dusk pushed a thousand times', () => {
    const dusk = lerpPalette(DAY, NIGHT, 0.25);
    applyPalette(ui, dusk);
    const spy = vi.spyOn(root().style, 'setProperty');
    for (let i = 0; i < 1000; i++) applyPalette(ui, dusk);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not invalidate thumbnails, unlike setBrand — invariant 15', () => {
    const cache = thumbnails(ui);
    cache.url('rig', { width: 8, height: 8, dpr: 1, paint: () => undefined });
    for (let i = 0; i < 1000; i++) applyPalette(ui, { sky: `#${String(i % 10)}00` });
    expect(cache.size).toBe(1);
  });

  it('names the key or the prefix that could never match a selector', () => {
    expect(() => applyPalette(ui, { 'sky blue': '#89a' })).toThrow(/"sky blue"/);
    expect(() => applyPalette(ui, { '': '#89a' })).toThrow(RangeError);
    expect(() => applyPalette(ui, { sky: '#89a' }, { prefix: 'a b' })).toThrow(/"a b"/);
  });

  it('returns false for an empty palette, and skips a key whose value is undefined', () => {
    expect(applyPalette(ui, {})).toBe(false);
    expect(applyPalette(ui, { sky: undefined as unknown as string })).toBe(false);
    expect(vars()).toEqual({});
  });

  it('shares one change guard with setTokens, so the two cannot disagree', () => {
    setTokens(ui, { '--lattice-sky': '#89a' });
    expect(applyPalette(ui, { sky: '#89a' })).toBe(false);
  });
});
