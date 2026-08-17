/**
 * The browser backend, driven by a fake context — because the module a Node suite cannot reach
 * is exactly the one where a leak does the most damage.
 *
 * Three properties are asserted here that no golden test in this package could see, because
 * they are about state rather than about geometry:
 *
 * - **the device ratio is applied once**, in one `setTransform`, and never a second time inside
 *   a text run — which is the bug that shipped a half-scale campus in the source game;
 * - **`begin` resets everything** — alpha, dash, composite, joins — so a frame can never inherit
 *   the previous one's leak;
 * - **the radial ramp is cached per color pair**, so a contact shadow under every building is
 *   not a `createRadialGradient` under every building.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { rgba } from '../src/color.js';
import { createCanvas2dSurface, createOffscreenSurface } from '../src/canvas2d.js';
import { DEFAULT_TEXT } from '../src/text.js';
import type { OffscreenSurface } from '../src/canvas2d.js';
import { fakeCanvas, installDom } from './fake-canvas.js';
import type { DomHandle, FakeCanvas } from './fake-canvas.js';

let dom: DomHandle | undefined;

afterEach(() => {
  dom?.restore();
  dom = undefined;
});

/** A screen surface over a fake element, with a DOM installed for the ramp cache to use. */
function screen(
  opts?: Parameters<typeof createCanvas2dSurface>[1],
  devicePixelRatio = 1,
): { surface: OffscreenSurface; canvas: FakeCanvas } {
  // Put back any DOM this test already installed before installing another, or the handles
  // nest and the outermost `window` survives into the next test.
  dom?.restore();
  dom = installDom(devicePixelRatio);
  const canvas = fakeCanvas(400, 300);
  const surface = createCanvas2dSurface(canvas as unknown as HTMLCanvasElement, opts);
  return { surface, canvas };
}

const XY = (values: readonly number[]): Float64Array => Float64Array.from(values);

describe('createCanvas2dSurface', () => {
  it('sizes the backing store from the CSS size and the ratio, and reports CSS pixels', () => {
    const { surface, canvas } = screen({ pixelRatio: 2 });
    expect(surface.kind).toBe('canvas2d');
    expect(surface.width).toBe(400);
    expect(surface.height).toBe(300);
    expect(surface.pixelRatio).toBe(2);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('takes the device ratio from the host and clamps it', () => {
    // A 3× phone costs 2.25× the fill for a difference nobody can see on a five-inch screen.
    expect(screen(undefined, 3).surface.pixelRatio).toBe(2);
    expect(screen(undefined, 1.5).surface.pixelRatio).toBe(1.5);
    expect(screen({ maxPixelRatio: 4 }, 3).surface.pixelRatio).toBe(3);
  });

  it('assumes a ratio of 1 with no window at all, so it runs wherever it is handed a canvas', () => {
    const canvas = fakeCanvas(100, 100);
    const surface = createCanvas2dSurface(canvas as unknown as HTMLCanvasElement);
    expect(surface.pixelRatio).toBe(1);
  });

  it('falls back to the element’s own attributes when it is not in the document yet', () => {
    dom = installDom(1);
    const canvas = fakeCanvas(0, 0);
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    canvas.width = 120;
    canvas.height = 90;
    const surface = createCanvas2dSurface(canvas as unknown as HTMLCanvasElement);
    expect(surface.width).toBe(120);
    expect(surface.height).toBe(90);
  });

  it('falls back again to one pixel rather than producing a zero-sized surface', () => {
    dom = installDom(1);
    const canvas = fakeCanvas(0, 0);
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    canvas.width = 0;
    canvas.height = 0;
    expect(createCanvas2dSurface(canvas as unknown as HTMLCanvasElement).width).toBe(1);
  });

  it('refuses a nonsense ratio by name', () => {
    dom = installDom(1);
    const canvas = fakeCanvas();
    const element = canvas as unknown as HTMLCanvasElement;
    expect(() => createCanvas2dSurface(element, { pixelRatio: 0 })).toThrow(/pixelRatio/);
    expect(() => createCanvas2dSurface(element, { maxPixelRatio: -1 })).toThrow(/maxPixelRatio/);
  });

  it('reads back both options a caller can set, per non-negotiable 11', () => {
    // `pixelRatio` reads back as the ratio in force; `alpha` as `hasAlpha`, which is spelled
    // differently only because `Surface.alpha` is already the multiplier setter.
    expect(screen({ pixelRatio: 2, alpha: true }).surface.hasAlpha).toBe(true);
    const opaque = screen({ pixelRatio: 2, alpha: false }).surface;
    expect(opaque.hasAlpha).toBe(false);
    expect(opaque.pixelRatio).toBe(2);
    // The default is false — the kit always clears, so the compositor may skip a blend — and it
    // reads back as the default rather than as `undefined`.
    expect(screen().surface.hasAlpha).toBe(false);
  });

  it('reads back the ratio that is in force, which resize moves and maxPixelRatio does not bound', () => {
    // Two facts in one, and the second is why `maxPixelRatio` has no getter: the clamp is
    // consumed once at construction and `resize` walks straight past it, so a reader over it
    // would report a ceiling the surface does not enforce. `docs/rfc/live-options.md` finding 4
    // is the change that makes it survive, and the getter belongs in that change.
    const { surface } = screen({ maxPixelRatio: 2 }, 3);
    expect(surface.pixelRatio).toBe(2);
    surface.resize(400, 300, 4);
    expect(surface.pixelRatio).toBe(4);
  });

  it('says why there is no context rather than reaching for a non-null assertion', () => {
    dom = installDom(1);
    const canvas = fakeCanvas();
    canvas.contextAvailable = false;
    expect(() => createCanvas2dSurface(canvas as unknown as HTMLCanvasElement)).toThrow(/webgl/);
  });

  it('resizes, and refuses a bad resize by name', () => {
    const { surface, canvas } = screen();
    surface.resize(200, 100, 2);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(surface.width).toBe(200);
    expect(() => surface.resize(0, 1, 1)).toThrow(/width/);
    expect(() => surface.resize(1, 0, 1)).toThrow(/height/);
    expect(() => surface.resize(1, 1, 0)).toThrow(/pixelRatio/);
  });
});

describe('the device ratio is applied once', () => {
  it('lives in exactly one setTransform, whatever the ratio', () => {
    const { surface, canvas } = screen({ pixelRatio: 2 });
    canvas.ctx.calls.length = 0;
    surface.begin(rgba(1, 2, 3));
    const transforms = canvas.ctx.calls.filter((call) => call.fn === 'setTransform');
    expect(transforms).toHaveLength(1);
    expect(transforms[0]?.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('is composed into a text transform rather than applied on top of it', () => {
    // The source game set the ratio on resize and re-applied it in its wall-text routine —
    // correct only because both places agreed, and one edit from a half-scale campus.
    const { surface, canvas } = screen({ pixelRatio: 2 });
    surface.begin(0);
    canvas.ctx.calls.length = 0;
    surface.text('sign', 1, 2, DEFAULT_TEXT, rgba(0, 0, 0), XY([0.5, 0.25, 0, 1, 10, 20]));
    const transforms = canvas.ctx.calls.filter((call) => call.fn === 'setTransform');
    expect(transforms[0]?.args).toEqual([1, 0.5, 0, 2, 20, 40]);
    // …and it puts the base transform back, so the next primitive is not sheared.
    expect(transforms[1]?.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('leaves the transform alone for text with no shear', () => {
    const { surface, canvas } = screen();
    surface.begin(0);
    canvas.ctx.calls.length = 0;
    surface.text('hud', 1, 2, DEFAULT_TEXT, rgba(0, 0, 0));
    expect(canvas.ctx.calls.filter((call) => call.fn === 'setTransform')).toHaveLength(0);
    expect(canvas.ctx.calls.some((call) => call.fn === 'fillText')).toBe(true);
  });
});

describe('begin resets every piece of state', () => {
  it('alpha, dash, composite and joins, all of them, every frame', () => {
    const { surface, canvas } = screen();
    surface.alpha(0.2);
    surface.stroke(XY([0, 0, 1, 1]), 2, false, rgba(0, 0, 0), 1, 4, 2);
    canvas.ctx.sets.length = 0;
    surface.begin(rgba(1, 2, 3, 255));
    expect(canvas.ctx.sets).toContain('globalAlpha=1');
    expect(canvas.ctx.sets).toContain('lineJoin=round');
    expect(canvas.ctx.sets).toContain('lineCap=round');
    expect(canvas.ctx.sets).toContain('lineDashOffset=0');
    expect(canvas.ctx.globalCompositeOperation).toBe('source-over');
    expect(surface.alpha(1)).toBe(1);
  });

  it('erases before it fills, so a frame never ghosts the previous one', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.begin(rgba(1, 2, 3));
    const names = canvas.ctx.calls.map((call) => call.fn);
    expect(names.indexOf('clearRect')).toBeLessThan(names.indexOf('fillRect'));
  });

  it('erases and does not fill when the clear color is transparent', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.begin(0);
    expect(canvas.ctx.calls.some((call) => call.fn === 'clearRect')).toBe(true);
    expect(canvas.ctx.calls.some((call) => call.fn === 'fillRect')).toBe(false);
  });

  it('end flushes nothing, because Canvas2D is immediate', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.end();
    expect(canvas.ctx.calls).toHaveLength(0);
  });
});

describe('the primitives', () => {
  it('trace a closed path and fill it', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.poly(XY([0, 0, 10, 0, 10, 10]), 3, rgba(1, 2, 3));
    const names = canvas.ctx.calls.map((call) => call.fn);
    expect(names).toEqual(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'closePath', 'fill']);
    expect(canvas.ctx.fillStyle).toBe('rgb(1,2,3)');
  });

  it('build a gradient for a ramp, and skip it entirely when both stops match', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.polyRamp(XY([0, 0, 1, 1]), 2, 0, 0, 8, 0, rgba(1, 0, 0), rgba(0, 0, 1));
    expect(canvas.ctx.calls.filter((call) => call.fn === 'createLinearGradient')).toHaveLength(1);
    expect(canvas.ctx.calls.filter((call) => call.fn === 'addColorStop')).toHaveLength(2);
    canvas.ctx.calls.length = 0;
    surface.polyRamp(XY([0, 0, 1, 1]), 2, 0, 0, 8, 0, rgba(1, 0, 0), rgba(1, 0, 0));
    expect(canvas.ctx.calls.filter((call) => call.fn === 'createLinearGradient')).toHaveLength(0);
    expect(canvas.ctx.fillStyle).toBe('rgb(1,0,0)');
  });

  it('put the dash back after every stroke that used one', () => {
    // A dash left set is the bug that draws every subsequent outline dotted, somewhere the
    // author of the dash never looked.
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.stroke(XY([0, 0, 1, 1]), 2, true, rgba(0, 0, 0), 2, 6, 3);
    const dashes = canvas.ctx.calls.filter((call) => call.fn === 'setLineDash');
    expect(dashes.map((call) => call.args[0])).toEqual([[6, 6], []]);
    canvas.ctx.calls.length = 0;
    surface.stroke(XY([0, 0, 1, 1]), 2, false, rgba(0, 0, 0), 2);
    expect(canvas.ctx.calls.filter((call) => call.fn === 'setLineDash')).toHaveLength(0);
    expect(canvas.ctx.calls.filter((call) => call.fn === 'closePath')).toHaveLength(0);
  });

  it('draw an ellipse with absolute radii, so a negative one is not a mirror', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.ellipse(5, 6, -3, 4, rgba(0, 0, 0));
    const call = canvas.ctx.calls.find((c) => c.fn === 'ellipse');
    expect(call?.args.slice(0, 4)).toEqual([5, 6, 3, 4]);
  });

  it('map every alignment to its CSS name', () => {
    const { surface, canvas } = screen();
    const style = { size: 10, weight: 400, family: 'serif' } as const;
    surface.text('a', 0, 0, { ...style, align: -1, baseline: -1 }, 0);
    expect(canvas.ctx.sets).toContain('textAlign=left');
    expect(canvas.ctx.sets).toContain('textBaseline=top');
    surface.text('a', 0, 0, { ...style, align: 1, baseline: 1 }, 0);
    expect(canvas.ctx.sets).toContain('textAlign=right');
    expect(canvas.ctx.sets).toContain('textBaseline=bottom');
    surface.text('a', 0, 0, { ...style, align: 0, baseline: 0 }, 0);
    expect(canvas.ctx.sets).toContain('textAlign=center');
    expect(canvas.ctx.sets).toContain('textBaseline=middle');
  });

  it('default the dash offset when a caller gives a dash and no phase', () => {
    const { surface, canvas } = screen();
    canvas.ctx.sets.length = 0;
    surface.stroke(XY([0, 0, 1, 1]), 2, false, rgba(0, 0, 0), 1, 4);
    expect(canvas.ctx.sets).toContain('lineDashOffset=0');
  });

  it('measure through the context’s own font metrics', () => {
    const { surface } = screen();
    expect(surface.measure('abcd', DEFAULT_TEXT)).toBe(28);
  });

  it('set alpha and hand back the previous multiplier', () => {
    const { surface, canvas } = screen();
    expect(surface.alpha(0.5)).toBe(1);
    expect(surface.alpha(0.25)).toBe(0.5);
    expect(canvas.ctx.globalAlpha).toBe(0.25);
  });
});

describe('the radial ramp cache', () => {
  it('renders one ramp per color pair, not one per call', () => {
    // `softEllipse` is the contact shadow under every building; a fresh `createRadialGradient`
    // here would be an allocation under every building, every frame.
    const { surface } = screen();
    const before = dom?.created.length ?? 0;
    for (let i = 0; i < 20; i++) surface.softEllipse(1, 1, 10, 5, rgba(0, 0, 0, 128), 0);
    expect((dom?.created.length ?? 0) - before).toBe(1);
    surface.softEllipse(1, 1, 10, 5, rgba(255, 0, 0, 128), 0);
    expect((dom?.created.length ?? 0) - before).toBe(2);
  });

  it('costs a bounded number of ramps for a color that moves every frame', () => {
    // The measurement that named this bug. A flame whose core is mixed against a noise value per
    // frame, or a ripple whose alpha is a continuous function of its age, was a guaranteed miss
    // on every frame for ever — a fresh <canvas>, a fresh context, a fresh gradient and a fresh
    // fill, measured in a live exhibit at 3.74 a frame and ~3.7 MB/s handed to the collector.
    // The key is snapped to the resolution a 64-pixel ramp has, so the animation closes over a
    // small set of keys instead.
    const { surface } = screen();
    const sweep = (frame: number): void => {
      const a = Math.round((Math.sin(frame * 0.031) * 0.5 + 0.5) * 255);
      surface.softEllipse(0, 0, 8, 4, rgba(9, 130, 240, a), rgba(9, 130, 240, 0));
    };
    const before = dom?.created.length ?? 0;
    for (let frame = 0; frame < 600; frame++) sweep(frame);
    const made = (dom?.created.length ?? 0) - before;
    // One endpoint moves in one channel, so 32 levels is the ceiling — and more than one, or the
    // sweep is not sweeping and the test could not fail.
    expect(made).toBeGreaterThan(1);
    expect(made).toBeLessThanOrEqual(32);
    // …and the set of keys is closed: replaying the same frames renders nothing at all. That is
    // the miss rate the exhibit measured, driven to zero.
    const settled = dom?.created.length ?? 0;
    for (let frame = 0; frame < 600; frame++) sweep(frame);
    expect((dom?.created.length ?? 0) - settled).toBe(0);
  });

  it('keeps a constant-color site cached while another site churns past the limit', () => {
    // The collateral damage, and the reason this was worth fixing rather than documenting. The
    // cache used to answer a full map with `clear()`, so one animated color anywhere in the frame
    // deleted the contact shadows, the light-field pools, the sky and every walker — all of them
    // constant colors that should be permanent hits and none of them the cause.
    const { surface } = screen();
    const constant = rgba(17, 34, 51, 96);
    surface.softEllipse(0, 0, 6, 3, constant, 0);
    const before = dom?.created.length ?? 0;
    for (let i = 0; i < 200; i++) {
      // 200 pairs that are still 200 pairs after the snap: two channels moving on their levels.
      surface.softEllipse(0, 0, 6, 3, rgba((i % 32) * 8, ((i / 32) | 0) * 8 + 1, 200, 255), 0);
      // …and a read of the constant site, exactly as a frame would make it.
      surface.softEllipse(0, 0, 6, 3, constant, 0);
    }
    // The churn and nothing else. Under a wholesale clear the constant site was re-rendered every
    // time the map filled, which is twice a second at the rate the exhibit measured.
    expect((dom?.created.length ?? 0) - before).toBe(200);
  });

  it('evicts one entry rather than the map, and the one it drops is the coldest', () => {
    const { surface } = screen();
    const churn = (i: number): number => rgba((i % 32) * 8, ((i / 32) | 0) * 8 + 2, 120, 255);
    const cold = rgba(7, 200, 90, 240);
    const warm = rgba(7, 200, 90, 208);
    surface.softEllipse(0, 0, 5, 5, cold, 0);
    surface.softEllipse(0, 0, 5, 5, warm, 0);
    for (let i = 0; i < 200; i++) {
      surface.softEllipse(0, 0, 5, 5, churn(i), 0);
      surface.softEllipse(0, 0, 5, 5, warm, 0);
    }
    // `warm` was read on every pass, so it is never the least recently used…
    let mark = dom?.created.length ?? 0;
    surface.softEllipse(0, 0, 5, 5, warm, 0);
    expect((dom?.created.length ?? 0) - mark).toBe(0);
    // …nor is anything else from the tail of the churn, which is what "one entry, not all of
    // them" means: a cache that answered a full map by clearing it would be holding only what
    // arrived since its last clear, and these forty would be misses.
    mark = dom?.created.length ?? 0;
    for (let i = 160; i < 200; i++) surface.softEllipse(0, 0, 5, 5, churn(i), 0);
    expect((dom?.created.length ?? 0) - mark).toBe(0);
    // …and `cold` was never read again, so it is the one that went. Which is also the proof that
    // the cache is still bounded: two hundred keys did not all fit.
    mark = dom?.created.length ?? 0;
    surface.softEllipse(0, 0, 5, 5, cold, 0);
    expect((dom?.created.length ?? 0) - mark).toBe(1);
  });

  it('renders the snapped color, with 0 and 255 exact so a rim never rings', () => {
    // Rendering the color the *first* caller to reach a key happened to bring would let frame
    // order decide what every later caller looks like.
    const { surface } = screen();
    surface.softEllipse(0, 0, 5, 5, rgba(255, 3, 129, 255), 0);
    const created = dom?.created ?? [];
    const stops = (created[created.length - 1]?.ctx.calls ?? []).filter(
      (call) => call.fn === 'addColorStop',
    );
    // Five bits kept and replicated into the low three: 255 → 255, 3 → 0, 129 → 132.
    expect(stops[0]?.args[1]).toBe('rgb(255,0,132)');
    // The rim stays exactly transparent, which is what the replication buys over a bare mask —
    // an outer stop that snapped to alpha 7 would ring every glow in the kit.
    expect(stops[1]?.args[1]).toBe('rgba(0,0,0,0.000)');
  });

  it('is reached by softEllipse and by no other primitive', () => {
    // The trap's whole character was that it was invisible from the call site — an exhibit calls
    // `glowDot`, which calls `softEllipse`, which consults a cache nobody upstream has heard of.
    // A second entry point that nobody had noticed would be the same bug again, so every other
    // primitive on the surface is exercised here and none of them may reach a ramp.
    const { surface, canvas } = screen();
    const before = dom?.created.length ?? 0;
    canvas.ctx.calls.length = 0;
    surface.begin(rgba(4, 4, 4, 255));
    surface.poly(XY([0, 0, 4, 0, 4, 4]), 3, rgba(203, 31, 29, 201));
    surface.polyRamp(XY([0, 0, 4, 4]), 2, 0, 0, 4, 0, rgba(1, 2, 3, 4), rgba(5, 6, 7, 8));
    surface.stroke(XY([0, 0, 4, 4]), 2, false, rgba(9, 91, 19, 90), 1);
    surface.ellipse(2, 2, 3, 3, rgba(11, 22, 33, 44));
    surface.text('x', 0, 0, DEFAULT_TEXT, rgba(1, 1, 1, 255));
    surface.alpha(0.5);
    surface.end();
    expect((dom?.created.length ?? 0) - before).toBe(0);
    expect(canvas.ctx.calls.filter((call) => call.fn === 'createRadialGradient')).toHaveLength(0);
  });

  it('blits the ramp to the ellipse’s box rather than stretching a gradient', () => {
    const { surface, canvas } = screen();
    canvas.ctx.calls.length = 0;
    surface.softEllipse(50, 40, 10, 5, rgba(0, 0, 0, 128), 0);
    const call = canvas.ctx.calls.find((c) => c.fn === 'drawImage');
    expect(call?.args.slice(1)).toEqual([40, 35, 20, 10]);
  });
});

describe('targets and blits', () => {
  it('makes a target at the parent’s ratio and blits it on whole device pixels', () => {
    const { surface, canvas } = screen({ pixelRatio: 2 });
    const target = surface.createTarget(100, 80);
    expect(target.pixelRatio).toBe(2);
    expect(target.bitmap.width).toBe(100);
    expect(target.bitmap.height).toBe(80);
    expect(target.bitmap.pixelRatio).toBe(2);
    expect(target.bitmap.bytes).toBe(200 * 160 * 4);
    canvas.ctx.calls.length = 0;
    surface.blit(target.bitmap, 41.3, 10.9, 100, 80);
    const call = canvas.ctx.calls.find((c) => c.fn === 'drawImage');
    // 41.3 × 2 = 82.6 → 83 device px → 41.5 CSS px. A cached image drawn on a fraction resamples
    // and the whole campus shimmers against terrain that is drawn directly.
    expect(call?.args[1]).toBe(41.5);
    expect(call?.args[2]).toBe(11);
  });

  it('switches the composite for a blit and puts the base one back', () => {
    const { surface, canvas } = screen();
    const target = surface.createTarget(10, 10);
    surface.blit(target.bitmap, 0, 0, 10, 10, 'add');
    expect(canvas.ctx.sets).toContain('globalCompositeOperation=lighter');
    expect(canvas.ctx.globalCompositeOperation).toBe('source-over');
    surface.blit(target.bitmap, 0, 0, 10, 10, 'cut');
    expect(canvas.ctx.sets).toContain('globalCompositeOperation=destination-out');
    expect(canvas.ctx.globalCompositeOperation).toBe('source-over');
  });

  it('leaves the composite alone for an ordinary blit', () => {
    const { surface, canvas } = screen();
    const target = surface.createTarget(10, 10);
    canvas.ctx.sets.length = 0;
    surface.blit(target.bitmap, 0, 0, 10, 10);
    expect(canvas.ctx.sets.filter((s) => s.startsWith('globalCompositeOperation'))).toHaveLength(0);
  });

  it('makes a light target accumulate by maximum and return to it after a blit', () => {
    const { surface } = screen();
    const light = surface.createTarget(10, 10, 'light');
    const inner = dom?.created[dom.created.length - 1];
    light.begin(0);
    expect(inner?.ctx.globalCompositeOperation).toBe('lighten');
    const other = surface.createTarget(4, 4);
    light.blit(other.bitmap, 0, 0, 4, 4, 'cut');
    expect(inner?.ctx.globalCompositeOperation).toBe('lighten');
  });

  it('refuses a zero-sized target and a bitmap from another backend', () => {
    const { surface } = screen();
    expect(() => surface.createTarget(0, 10)).toThrow(/width/);
    expect(() => surface.createTarget(10, 0)).toThrow(/height/);
    const alien = { width: 1, height: 1, pixelRatio: 1, bytes: 4, dispose: (): void => undefined };
    expect(() => surface.blit(alien, 0, 0, 1, 1)).toThrow(TypeError);
    expect(() => surface.blit(alien, 0, 0, 1, 1)).toThrow(/belongs to the backend/);
  });

  it('drops a disposed bitmap’s backing store', () => {
    const { surface } = screen();
    const target = surface.createTarget(50, 50);
    const element = dom?.created[dom.created.length - 1];
    expect(element?.width).toBeGreaterThan(1);
    target.bitmap.dispose();
    expect(element?.width).toBe(1);
    expect(element?.height).toBe(1);
  });
});

describe('createOffscreenSurface', () => {
  it('is a detached canvas, pinned to ratio 1 by default, and hands back its element', () => {
    dom = installDom(3);
    const surface: OffscreenSurface = createOffscreenSurface(240, 140);
    expect(surface.kind).toBe('canvas2d');
    expect(surface.pixelRatio).toBe(1);
    expect(surface.width).toBe(240);
    expect(surface.element).toBe(dom.created[0] as unknown as HTMLCanvasElement);
  });

  it('encodes a data URL synchronously, which is why it is not an OffscreenCanvas', () => {
    // `OffscreenCanvas` has no `toDataURL`, only an async `convertToBlob`, and an async
    // thumbnail is a shop card that pops in one frame late every time it opens.
    dom = installDom(1);
    const surface = createOffscreenSurface(64, 64);
    expect(surface.toDataUrl('image/webp', 0.8)).toMatch(/^data:image\/webp/);
    expect(surface.toDataUrl()).toMatch(/^data:image\/png/);
  });

  it('refuses a size nobody could look at', () => {
    dom = installDom(1);
    expect(() => createOffscreenSurface(0, 10)).toThrow(/width/);
    expect(() => createOffscreenSurface(10, 0)).toThrow(/height/);
    expect(() => createOffscreenSurface(10, 10, { pixelRatio: 0 })).toThrow(/pixelRatio/);
  });

  it('takes an explicit ratio and an opaque background', () => {
    dom = installDom(1);
    const surface = createOffscreenSurface(50, 50, { pixelRatio: 2, alpha: false });
    expect(surface.pixelRatio).toBe(2);
    const element = dom.created[0];
    const context = element?.ctx.calls.find((call) => call.fn === 'getContext');
    expect(context?.args[1]).toEqual({ alpha: false });
    // …and reads both of them back off the surface they configured.
    expect(surface.hasAlpha).toBe(false);
    // The documented default is an alpha channel: a thumbnail with an opaque background cannot
    // sit on a card.
    expect(createOffscreenSurface(50, 50).hasAlpha).toBe(true);
    expect(createOffscreenSurface(50, 50).pixelRatio).toBe(1);
  });
});
