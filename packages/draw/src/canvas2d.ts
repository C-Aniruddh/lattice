/**
 * The browser backend. **`@browser-only` — this module touches the DOM, and it is the only one
 * in the package that does.**
 *
 * Everything above it works through `Surface`, so nothing else in this package, and nothing in
 * any package above it, ever holds a `CanvasRenderingContext2D`. That is what lets the same
 * sprite code paint the screen, a shop thumbnail and a golden test in Node.
 *
 * ## Three things this backend does that a naive one does not
 *
 * 1. **It owns the device pixel ratio, once.** The backing store is `css × ratio` and the
 *    context carries a single `setTransform(ratio, 0, 0, ratio, 0, 0)`; every coordinate that
 *    crosses `Surface` is CSS pixels. The source game set the ratio transform on resize *and*
 *    re-applied it in its wall-text routine — correct only because both places agreed, and one
 *    edit from a half-scale campus.
 * 2. **It caches the radial ramp.** `softEllipse` is the contact shadow under every building, so
 *    a `createRadialGradient` per call is an allocation per building per frame. Instead one
 *    small offscreen ramp is rendered per color pair and blitted, which is also exactly what a
 *    GPU backend would do with a ramp texture.
 * 3. **It resets its own state on `begin`.** `setLineDash`, `globalAlpha`, `font`,
 *    `globalCompositeOperation` and `lineJoin` left set are the classic Canvas2D leaks: the next
 *    caller inherits them and the symptom appears somewhere unrelated to the cause. There is no
 *    `save`/`restore` anywhere in this file, and therefore no imbalance to leave across a frame.
 */

import { TAU } from '@lattice/core';
import type { Rgba } from './color.js';
import { cssOf } from './color.js';
import { expectPositive } from './surface.js';
import type {
  Bitmap,
  BlitMode,
  RenderTarget,
  Surface,
  TargetMode,
  TextStyle,
} from './surface.js';

/**
 * How a screen surface is configured.
 *
 * Every field reads back off the surface it configured, per non-negotiable 11: `pixelRatio` as
 * {@link Surface.pixelRatio} and `alpha` as {@link OffscreenSurface.hasAlpha}. `maxPixelRatio` is
 * the one that does not, and the reason is written on it.
 */
export interface Canvas2dOpts {
  /**
   * Override the device pixel ratio outright. Tests and thumbnails pin it to 1, which is what
   * makes a thumbnail byte-identical across machines.
   *
   * Reads back as {@link Surface.pixelRatio} — the ratio *in force*, which is this value if it
   * was given and the clamped device ratio if it was not, and which `resize` then moves.
   */
  readonly pixelRatio?: number | undefined;
  /**
   * Clamp for `devicePixelRatio`. Defaults to 2: a 3× phone costs 2.25× the fill for a
   * difference nobody can see on a five-inch screen, and it is the single cheapest frame-time
   * win available on the hardware that needs one most.
   *
   * **This one is deliberately not readable, and that is not an oversight.** It does not survive
   * its constructor: it is consumed once to pick the opening ratio and nothing reads it again —
   * `resize(w, h, ratio)` takes a ratio and walks straight past this clamp. A getter over it
   * would report a bound the surface does not enforce, which is the stale-local loophole
   * `docs/rfc/live-options.md` §6b names, and a caller who trusted it would size a buffer against
   * a ceiling that is not there. It becomes readable in the same change that makes it *live* —
   * that RFC's finding 4, which is what makes `resize` honor it — and not before.
   */
  readonly maxPixelRatio?: number | undefined;
  /** `false` lets the compositor skip a blend. Defaults to false — the kit always clears. Reads
   *  back as {@link OffscreenSurface.hasAlpha}. */
  readonly alpha?: boolean | undefined;
}

/** How a detached surface is configured. Both fields read back off the surface:
 *  {@link Surface.pixelRatio} and {@link OffscreenSurface.hasAlpha}. */
export interface OffscreenOpts {
  /** Default 1. A thumbnail pinned to 1 is byte-identical across machines, which a test wants
   *  and a shop card does not care about. */
  readonly pixelRatio?: number | undefined;
  /** Default true: a thumbnail with an opaque background cannot sit on a card. */
  readonly alpha?: boolean | undefined;
}

/**
 * A `Surface` backed by a `<canvas>` element — **both factories in this file return one**, the
 * detached thumbnail and the screen alike.
 *
 * The same seam as `createRecordingSurface`, pointed at a browser instead of at Node: one
 * `Surface` interface, three places it can end up — a screen, a memory image, an op log — and
 * one body of drawing code that cannot tell which. It is what stops a shop card and the building
 * it sells from ever drifting apart.
 *
 * The name says *offscreen* because for most of this package's life only the detached factory
 * declared it. It is the canvas-backed surface type; a screen surface has an `element` and a
 * `toDataUrl` for the same reason a thumbnail does, and it needs {@link OffscreenSurface.hasAlpha}
 * so that a caller can read back what they configured.
 */
export interface OffscreenSurface extends Surface {
  /** Narrowed, so a caller holding one knows it can reach {@link OffscreenSurface.element}. */
  readonly kind: 'canvas2d';
  /** The backing element. **Prefer this**: it can be appended, or drawn into another surface,
   *  with no encode and no decode. */
  readonly element: HTMLCanvasElement;
  /**
   * Whether the backing context was opened with an alpha channel — `Canvas2dOpts.alpha` and
   * `OffscreenOpts.alpha`, read back off the surface they configured.
   *
   * **It is `hasAlpha` and not `alpha` because `alpha` is taken**, by {@link Surface.alpha}, which
   * sets the *multiplier* applied to subsequent draws. Two different meanings of one word, and
   * non-negotiable 11's "a getter of the same name" loses to that: a boolean channel flag sharing
   * a name with a number-returning method is a collision the compiler catches once and a reader
   * trips over forever. Where the name is unavailable the rule's second form applies — the value
   * is readable, under a name that says which alpha it means.
   *
   * **It has no setter and cannot have one.** `getContext('2d', { alpha })` fixes the channel for
   * the element's lifetime; a second `getContext` with different attributes returns the *first*
   * context, ignoring them silently. So this is identity in the sense of
   * `docs/rfc/live-options.md` §4 Q1 — the honest signature for changing it is a new surface —
   * and identity still means readable, which is what this getter is for. A caller compositing the
   * canvas against a page background needs to know which it got, and guessing from the default is
   * how a thumbnail ends up with a black rectangle behind it.
   */
  readonly hasAlpha: boolean;
  /**
   * A `data:` URL of the current contents.
   *
   * Roughly a third larger than the bytes it encodes and it costs a synchronous encode, so it
   * earns its place only when the caller is caching the string across DOM rebuilds — which is
   * exactly what a shop card does.
   */
  toDataUrl(type?: string, quality?: number): string;
}

/** Width and height of a cached radial ramp, in device pixels. 64 is enough that a contact
 *  shadow scaled to two hundred pixels shows no banding, and small enough that a hundred color
 *  pairs cost under two megabytes. */
const RAMP_SIZE = 64;

/** How many radial ramps are cached before the map is dropped wholesale. A palette's worth of
 *  shadow and glow colors is a few dozen; past this, something is generating colors per frame
 *  and an unbounded cache would be a leak wearing a cache's name. */
const RAMP_LIMIT = 96;

/** Cached radial ramps, keyed on the inner and outer color. See {@link RAMP_SIZE}. */
const ramps = new Map<string, HTMLCanvasElement>();

/** Which element backs a bitmap, so `blit` can find the image behind the opaque handle without
 *  a backend-specific field on the shared `Bitmap` type. */
const elements = new WeakMap<Bitmap, HTMLCanvasElement>();

/** Make a detached canvas. Not an `OffscreenCanvas`: `createOffscreenSurface` promises a
 *  synchronous `toDataURL`, and one code path is worth more than one saved allocation. */
function makeElement(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return element;
}

/** Fetch a 2D context or say why there is not one. A `null` here is a real condition — a
 *  context already taken as `webgl`, or a browser out of memory — and the `!` somebody would
 *  reach for to silence it is how a renderer ships a black screen. */
function contextOf(element: HTMLCanvasElement, alpha: boolean): CanvasRenderingContext2D {
  const ctx = element.getContext('2d', { alpha });
  if (ctx === null) {
    throw new Error('createCanvas2dSurface: no 2D context — already claimed by getContext("webgl")?');
  }
  return ctx;
}

/** The cached ramp for one color pair, rendered once. */
function rampFor(inner: Rgba, outer: Rgba): HTMLCanvasElement {
  const key = `${String(inner >>> 0)}|${String(outer >>> 0)}`;
  const hit = ramps.get(key);
  if (hit !== undefined) return hit;
  const element = makeElement(RAMP_SIZE, RAMP_SIZE);
  const ctx = contextOf(element, true);
  const half = RAMP_SIZE / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, cssOf(inner));
  gradient.addColorStop(1, cssOf(outer));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RAMP_SIZE, RAMP_SIZE);
  if (ramps.size >= RAMP_LIMIT) ramps.clear();
  ramps.set(key, element);
  return element;
}

/** Canvas2D's name for each {@link BlitMode}. Three states, each one blend state, and nothing
 *  else from the twenty-six `globalCompositeOperation` values. */
function compositeOf(mode: BlitMode): GlobalCompositeOperation {
  return mode === 'add' ? 'lighter' : mode === 'cut' ? 'destination-out' : 'source-over';
}

/**
 * The shared body of every canvas-backed surface: the screen, a thumbnail, and an internal
 * render target.
 *
 * One implementation rather than three, because a thumbnail that rendered through a second code
 * path is a shop card that stops looking like the building — which is the failure invariant 20
 * exists to catch and which no test can catch if the paths are genuinely different.
 */
function makeCanvasSurface(
  element: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  alpha: boolean,
  mode: TargetMode,
): OffscreenSurface & RenderTarget {
  let w = cssWidth;
  let h = cssHeight;
  let ratio = pixelRatio;
  const ctx = contextOf(element, alpha);
  /** The composite the surface returns to after every blit: `lighten` for a light accumulator,
   *  `source-over` for everything else. */
  const base = mode === 'light' ? 'lighten' : 'source-over';
  let multiplier = 1;

  /** Re-apply the one transform this backend has. Called on `begin`, after `resize`, and after
   *  any text run that used its own. */
  function baseTransform(): void {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** Trace `count` points as a closed path. */
  function path(xy: Float64Array, count: number): void {
    ctx.beginPath();
    ctx.moveTo(xy[0] ?? 0, xy[1] ?? 0);
    for (let i = 1; i < count; i++) ctx.lineTo(xy[i * 2] ?? 0, xy[i * 2 + 1] ?? 0);
  }

  /** Set the font from a style. Per call, never left as state for the next caller. */
  function applyFont(style: TextStyle): void {
    ctx.font = `${String(style.weight)} ${String(style.size)}px ${style.family}`;
    ctx.textAlign = style.align === -1 ? 'left' : style.align === 0 ? 'center' : 'right';
    ctx.textBaseline = style.baseline === -1 ? 'top' : style.baseline === 0 ? 'middle' : 'bottom';
  }

  const bitmap: Bitmap = {
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    get pixelRatio() {
      return ratio;
    },
    get bytes() {
      return element.width * element.height * 4;
    },
    dispose(): void {
      // Dropping the backing store to 1×1 is the only way to make a detached canvas release its
      // memory promptly; the element itself is garbage like anything else once nothing holds it.
      element.width = 1;
      element.height = 1;
    },
  };

  const surface: OffscreenSurface & RenderTarget = {
    kind: 'canvas2d',
    element,
    hasAlpha: alpha,
    bitmap,
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    get pixelRatio() {
      return ratio;
    },

    resize(nextW: number, nextH: number, nextRatio: number): void {
      w = expectPositive(nextW, 'surface.resize', 'width');
      h = expectPositive(nextH, 'surface.resize', 'height');
      ratio = expectPositive(nextRatio, 'surface.resize', 'pixelRatio');
      element.width = Math.max(1, Math.round(w * ratio));
      element.height = Math.max(1, Math.round(h * ratio));
      baseTransform();
    },

    begin(clear: Rgba): void {
      // Every piece of state, every frame. The next frame can then never inherit this one's leak,
      // and no caller has to remember which of these it changed.
      baseTransform();
      multiplier = 1;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Erase first, always, and under `source-over` whatever this surface accumulates in. A
      // `begin` that painted a translucent clear over the previous frame would ghost, and the
      // light accumulator — which starts transparent and blends by maximum — would keep every
      // pool it had ever been given.
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = base;
      if ((clear & 255) !== 0) {
        ctx.fillStyle = cssOf(clear);
        ctx.fillRect(0, 0, w, h);
      }
    },

    end(): void {
      // Canvas2D is immediate; there is nothing to flush. The method exists so a game never has
      // to know which backend it has.
    },

    poly(xy: Float64Array, count: number, fill: Rgba): void {
      path(xy, count);
      ctx.closePath();
      ctx.fillStyle = cssOf(fill);
      ctx.fill();
    },

    polyRamp(
      xy: Float64Array,
      count: number,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      from: Rgba,
      to: Rgba,
    ): void {
      path(xy, count);
      ctx.closePath();
      if (from === to) {
        // The one case that needs no gradient object at all, and the common one: a ramp between
        // two equal colors is a fill, and a game's backdrop often is.
        ctx.fillStyle = cssOf(from);
      } else {
        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, cssOf(from));
        gradient.addColorStop(1, cssOf(to));
        ctx.fillStyle = gradient;
      }
      ctx.fill();
    },

    stroke(
      xy: Float64Array,
      count: number,
      closed: boolean,
      color: Rgba,
      lineWidth: number,
      dash?: number,
      dashOffset?: number,
    ): void {
      path(xy, count);
      if (closed) ctx.closePath();
      if (dash !== undefined && dash > 0) {
        ctx.setLineDash([dash, dash]);
        ctx.lineDashOffset = dashOffset ?? 0;
      }
      ctx.strokeStyle = cssOf(color);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      // Per call, never state. A dash left set is the bug that draws every subsequent outline
      // dotted, somewhere the author of the dash never looked.
      if (dash !== undefined && dash > 0) {
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    },

    ellipse(cx: number, cy: number, rx: number, ry: number, fill: Rgba): void {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, TAU);
      ctx.fillStyle = cssOf(fill);
      ctx.fill();
    },

    softEllipse(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      inner: Rgba,
      outer: Rgba,
    ): void {
      // One cached ramp per color pair, stretched to the ellipse's box. A fresh
      // `createRadialGradient` here would be an allocation under every building, every frame.
      ctx.drawImage(rampFor(inner, outer), cx - rx, cy - ry, rx * 2, ry * 2);
    },

    text(
      value: string,
      x: number,
      y: number,
      style: TextStyle,
      color: Rgba,
      xform?: Float64Array,
    ): void {
      applyFont(style);
      ctx.fillStyle = cssOf(color);
      if (xform !== undefined) {
        // The device-pixel transform composed with the caller's, in one call. Never a second
        // `scale(ratio)` on top: applying the ratio twice is trap 7 and it shipped once.
        ctx.setTransform(
          ratio * (xform[0] ?? 1),
          ratio * (xform[1] ?? 0),
          ratio * (xform[2] ?? 0),
          ratio * (xform[3] ?? 1),
          ratio * (xform[4] ?? 0),
          ratio * (xform[5] ?? 0),
        );
      }
      ctx.fillText(value, x, y);
      if (xform !== undefined) baseTransform();
    },

    measure(value: string, style: TextStyle): number {
      applyFont(style);
      return ctx.measureText(value).width;
    },

    alpha(next: number): number {
      const previous = multiplier;
      multiplier = next;
      ctx.globalAlpha = next;
      return previous;
    },

    blit(source: Bitmap, dx: number, dy: number, dw: number, dh: number, blitMode?: BlitMode): void {
      const image = elements.get(source);
      if (image === undefined) {
        throw new TypeError('surface.blit: a bitmap belongs to the backend that made it');
      }
      const composite = compositeOf(blitMode ?? 'over');
      if (composite !== base) ctx.globalCompositeOperation = composite;
      // Whole device pixels. A cached image drawn at `dx = 41.3` resamples, and the whole campus
      // then shimmers against terrain that is drawn directly.
      ctx.drawImage(image, Math.round(dx * ratio) / ratio, Math.round(dy * ratio) / ratio, dw, dh);
      if (composite !== base) ctx.globalCompositeOperation = base;
    },

    createTarget(targetW: number, targetH: number, targetMode?: TargetMode): RenderTarget {
      const width = expectPositive(targetW, 'surface.createTarget', 'width');
      const height = expectPositive(targetH, 'surface.createTarget', 'height');
      return makeCanvasSurface(
        makeElement(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio))),
        width,
        height,
        ratio,
        true,
        targetMode ?? 'image',
      );
    },

    toDataUrl(type?: string, quality?: number): string {
      return element.toDataURL(type, quality);
    },
  };

  elements.set(bitmap, element);
  baseTransform();
  return surface;
}

/** Clamp for `devicePixelRatio` when the caller names none. See {@link Canvas2dOpts}. */
const DEFAULT_MAX_RATIO = 2;

/**
 * Wrap a canvas element.
 *
 * Sizes the backing store from `clientWidth`/`clientHeight` × the pixel ratio, and re-applies
 * that on `resize`; **callers work in CSS pixels and never see the ratio.** An element that is
 * not in the document yet has no client size, so its `width`/`height` attributes are used
 * instead and a later `resize` picks up the real one.
 *
 * Returns an {@link OffscreenSurface} rather than a bare `Surface` so that the two things a
 * caller configured here are readable off the thing they configured: the ratio in force as
 * `pixelRatio`, and the alpha channel as `alpha`. `element` and `toDataUrl` come with that type
 * and are both meaningful on a screen canvas — the second is how a game screenshots itself.
 *
 * @throws RangeError if an explicit `pixelRatio` or `maxPixelRatio` is not finite and positive.
 * @throws Error if the element has no 2D context.
 */
export function createCanvas2dSurface(
  canvas: HTMLCanvasElement,
  opts?: Canvas2dOpts,
): OffscreenSurface {
  const maxRatio = opts?.maxPixelRatio ?? DEFAULT_MAX_RATIO;
  expectPositive(maxRatio, 'createCanvas2dSurface', 'maxPixelRatio');
  const device = typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1);
  const chosen = opts?.pixelRatio ?? (device > maxRatio ? maxRatio : device);
  expectPositive(chosen, 'createCanvas2dSurface', 'pixelRatio');
  const cssW = canvas.clientWidth > 0 ? canvas.clientWidth : (canvas.width > 0 ? canvas.width : 1);
  const cssH = canvas.clientHeight > 0 ? canvas.clientHeight : (canvas.height > 0 ? canvas.height : 1);
  const surface = makeCanvasSurface(canvas, cssW, cssH, chosen, opts?.alpha ?? false, 'image');
  surface.resize(cssW, cssH, chosen);
  return surface;
}

/**
 * A detached surface of a fixed size — the one `ui` needs for shop thumbnails.
 *
 * **Always a detached `<canvas>`, never an `OffscreenCanvas`**, and that is deliberate:
 * `OffscreenCanvas` has no `toDataURL`, only an async `convertToBlob`, and an async thumbnail is
 * a shop card that pops in one frame late every time it is opened.
 *
 * @throws RangeError if either dimension or `pixelRatio` is not finite and positive.
 */
export function createOffscreenSurface(
  width: number,
  height: number,
  opts?: OffscreenOpts,
): OffscreenSurface {
  const w = expectPositive(width, 'createOffscreenSurface', 'width');
  const h = expectPositive(height, 'createOffscreenSurface', 'height');
  const ratio = expectPositive(opts?.pixelRatio ?? 1, 'createOffscreenSurface', 'pixelRatio');
  const element = makeElement(Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)));
  return makeCanvasSurface(element, w, h, ratio, opts?.alpha ?? true, 'image');
}
