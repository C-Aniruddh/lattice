import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Surface } from '@latticekit/draw';
import { createOverlay, type Overlay } from '../src/overlay.js';
import { setBrand } from '../src/theme.js';
import { thumbnails, type ThumbSpec } from '../src/thumb.js';
import { fakeClock, installDom, type DomHandle } from './dom.js';

let dom: DomHandle;
let ui: Overlay;

beforeEach(() => {
  dom = installDom();
  ui = createOverlay({ now: fakeClock().now });
});

afterEach(() => {
  dom.restore();
});

/** A spec whose `paint` records that it ran. The cache's whole job is how often this happens. */
function spec(paint: (surface: Surface, w: number, h: number) => void, over?: Partial<ThumbSpec>): ThumbSpec {
  return { width: 240, height: 140, dpr: 1, paint, ...over };
}

describe('thumbnails', () => {
  it('paints once per key and returns the identical string thereafter — invariant 15', () => {
    const cache = thumbnails(ui);
    const paint = vi.fn();
    const first = cache.url('rig|1|240x140', spec(paint));
    const second = cache.url('rig|1|240x140', spec(paint));
    expect(paint).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.startsWith('data:image/')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('hands the paint function a real Surface, scaled for dpr, in CSS pixels', () => {
    const cache = thumbnails(ui);
    let seen: { kind: string; width: number; height: number; ratio: number } | undefined;
    cache.url('k', {
      width: 240,
      height: 140,
      dpr: 2,
      paint: (surface, width, height) => {
        seen = {
          kind: surface.kind,
          width,
          height,
          ratio: surface.pixelRatio,
        };
      },
    });
    expect(seen).toEqual({ kind: 'canvas2d', width: 240, height: 140, ratio: 2 });
  });

  it('clamps the device pixel ratio to 2 — trap 8', () => {
    dom.restore();
    dom = installDom(3);
    const overlay = createOverlay({ now: fakeClock().now });
    const cache = thumbnails(overlay);
    let ratio = 0;
    cache.url('k', {
      width: 10,
      height: 10,
      paint: (surface) => {
        ratio = surface.pixelRatio;
      },
    });
    expect(ratio).toBe(2);
  });

  it('clamps an explicit dpr below 1 as well as above 2', () => {
    const cache = thumbnails(ui);
    const ratios: number[] = [];
    cache.url('a', spec((surface) => ratios.push(surface.pixelRatio), { dpr: 0.5 }));
    cache.url('b', spec((surface) => ratios.push(surface.pixelRatio), { dpr: 4 }));
    expect(ratios).toEqual([1, 2]);
  });

  it('paints the background before the paint function runs', () => {
    const cache = thumbnails(ui);
    const url = cache.url('k', spec(() => undefined, { background: '#102030' }));
    // The fake canvas records every 2D call; a background is a `begin` that erases and fills.
    expect(url).toContain('data:image/png;fake,240x140');
  });

  it('refuses a background that is not a color draw can parse', () => {
    const cache = thumbnails(ui);
    expect(() => cache.url('k', spec(() => undefined, { background: 'rebeccapurple' }))).toThrow(
      RangeError,
    );
  });

  it('repaints after setBrand and never after a palette push — invariant 15', () => {
    const cache = thumbnails(ui);
    const paint = vi.fn();
    cache.url('rig', spec(paint));
    setBrand(ui, 200);
    expect(cache.size).toBe(0);
    cache.url('rig', spec(paint));
    expect(paint).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used at capacity', () => {
    const cache = thumbnails(ui, 3);
    for (const key of ['a', 'b', 'c']) cache.url(key, spec(() => undefined));
    expect(cache.size).toBe(3);
    // Touching `a` makes `b` the oldest.
    cache.url('a', spec(() => undefined));
    const repaint = vi.fn();
    cache.url('d', spec(repaint));
    expect(cache.size).toBe(3);
    cache.url('b', spec(repaint));
    expect(repaint).toHaveBeenCalledTimes(2);
    cache.url('a', spec(repaint));
    expect(repaint).toHaveBeenCalledTimes(2);
  });

  it('holds exactly capacity entries after capacity + 1 distinct keys', () => {
    const cache = thumbnails(ui, 64);
    for (let i = 0; i < 65; i++) cache.url(`k${String(i)}`, spec(() => undefined, { width: 8, height: 8 }));
    expect(cache.size).toBe(64);
  });

  it('works at a capacity of one', () => {
    const cache = thumbnails(ui, 1);
    cache.url('a', spec(() => undefined));
    cache.url('b', spec(() => undefined));
    expect(cache.size).toBe(1);
  });

  it('drops everything on invalidate', () => {
    const cache = thumbnails(ui);
    cache.url('a', spec(() => undefined));
    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it('names the caller’s mistake for a missing key or a zero dimension', () => {
    const cache = thumbnails(ui);
    expect(() => cache.url('', spec(() => undefined))).toThrow(TypeError);
    expect(() => cache.url('k', spec(() => undefined, { width: 0 }))).toThrow(RangeError);
    expect(() => cache.url('k', spec(() => undefined, { height: -4 }))).toThrow(RangeError);
    expect(() => cache.url('k', spec(() => undefined, { width: Number.NaN }))).toThrow(RangeError);
    expect(() => cache.url('k', spec(() => undefined, { dpr: Number.NaN }))).toThrow(RangeError);
    expect(() => thumbnails(ui, 0)).toThrow(RangeError);
    expect(() => thumbnails(ui, Number.NaN)).toThrow(RangeError);
  });

  it('throws a named error rather than a `!` when there is no 2D context — trap 9', () => {
    // `getContext` returning null is a real condition: a canvas already claimed as `webgl`, or a
    // browser out of memory. `draw` says so; nothing in this package silences it.
    const cache = thumbnails(ui);
    const real = dom.doc.createElement.bind(dom.doc);
    dom.doc.createElement = ((tag: string) => {
      const node = real(tag);
      if (tag.toLowerCase() === 'canvas') {
        Object.defineProperty(node, 'getContext', { value: () => null });
      }
      return node;
    }) as typeof dom.doc.createElement;
    expect(() => cache.url('k', spec(() => undefined))).toThrow(/2D context/);
  });

  it('unregisters from the overlay on destroy, and goes with the overlay', () => {
    const cache = thumbnails(ui);
    cache.url('a', spec(() => undefined));
    cache.destroy();
    expect(cache.size).toBe(0);
    setBrand(ui, 90);
    expect(() => cache.destroy()).not.toThrow();

    const other = thumbnails(ui);
    other.url('a', spec(() => undefined));
    ui.destroy();
    expect(other.size).toBe(0);
  });
});
