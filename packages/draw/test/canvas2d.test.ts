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

  it('drops the whole cache rather than growing without bound', () => {
    // The branch that stops a caller generating colors per frame from turning a cache into a
    // leak wearing a cache's name.
    const { surface } = screen();
    const first = rgba(3, 5, 7, 200);
    surface.softEllipse(0, 0, 4, 2, first, 0);
    // Fill past the limit, then ask for the first color again: if the map had merely grown, it
    // would still be there and no new ramp would be rendered.
    for (let i = 0; i < 200; i++) surface.softEllipse(0, 0, 4, 2, rgba(i, 200 - i, i, 201), 0);
    const before = dom?.created.length ?? 0;
    surface.softEllipse(0, 0, 4, 2, first, 0);
    expect((dom?.created.length ?? 0) - before).toBe(1);
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
