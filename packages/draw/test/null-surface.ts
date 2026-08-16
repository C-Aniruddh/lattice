/**
 * A `Surface` that consumes draw calls and rasterises nothing — the benchmark's backend.
 *
 * **What it measures, and what it deliberately does not.** Everything this package does per
 * frame is *geometry and command submission*: project corners into `pen.xy`, derive three face
 * colours from one, and hand `(buffer, count, colour)` to a backend. That work is the same on
 * every backend and it is what a sprite cache would replace with a single blit, so it is exactly
 * the number the cache question turns on. Rasterisation — filling those polygons — happens
 * inside the browser's compositor, is not reachable from Node, and is *not* what a cache saves:
 * a cached sprite is blitted at the same size it would have been drawn.
 *
 * The recording backend cannot be used for this. It allocates an `Op` and two arrays per call by
 * design, so a benchmark run against it would measure the test harness.
 *
 * Every value handed in is folded into {@link NullSurface.checksum}. Without that, V8 sees a
 * chain of calls with no observable effect and deletes most of the frame.
 */

import type {
  Bitmap,
  BlitMode,
  RenderTarget,
  Surface,
  TargetMode,
  TextStyle,
} from '../src/surface.js';
import type { Rgba } from '../src/color.js';

/** The counting backend. */
export interface NullSurface extends Surface {
  /** Fold of every coordinate and colour submitted. Read it, or the frame is optimised away. */
  readonly checksum: number;
  /** Draw calls since the last {@link NullSurface.reset}. The op count a frame really costs. */
  readonly count: number;
  /** Zero both. */
  reset(): void;
}

/** Build one. `pixelRatio` is recorded and applied to nothing, exactly as a real backend's
 *  callers see it — coordinates crossing `Surface` are CSS pixels at every ratio. */
export function createNullSurface(width: number, height: number, pixelRatio = 1): NullSurface {
  let sum = 0;
  let ops = 0;

  const bitmap: Bitmap = {
    width,
    height,
    pixelRatio,
    bytes: width * height * 4,
    dispose(): void {
      /* nothing to release */
    },
  };

  const fold = (value: number): void => {
    sum = (sum + value) % 4294967296;
  };

  const surface: NullSurface & RenderTarget = {
    kind: 'recording',
    width,
    height,
    pixelRatio,
    bitmap,
    get checksum() {
      return sum;
    },
    get count() {
      return ops;
    },
    reset(): void {
      sum = 0;
      ops = 0;
    },
    resize(): void {
      /* fixed size */
    },
    begin(clear: Rgba): void {
      ops += 1;
      fold(clear);
    },
    end(): void {
      /* nothing to flush */
    },
    poly(xy: Float64Array, count: number, fill: Rgba): void {
      ops += 1;
      fold(fill);
      for (let i = 0; i < count * 2; i++) fold(xy[i] ?? 0);
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
      ops += 1;
      fold(from + to + x0 + y0 + x1 + y1);
      for (let i = 0; i < count * 2; i++) fold(xy[i] ?? 0);
    },
    stroke(xy: Float64Array, count: number, closed: boolean, color: Rgba, width2: number): void {
      ops += 1;
      fold(color + width2 + (closed ? 1 : 0));
      for (let i = 0; i < count * 2; i++) fold(xy[i] ?? 0);
    },
    ellipse(cx: number, cy: number, rx: number, ry: number, fill: Rgba): void {
      ops += 1;
      fold(cx + cy + rx + ry + fill);
    },
    softEllipse(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      inner: Rgba,
      outer: Rgba,
    ): void {
      ops += 1;
      fold(cx + cy + rx + ry + inner + outer);
    },
    text(value: string, x: number, y: number, style: TextStyle, color: Rgba): void {
      ops += 1;
      fold(x + y + style.size + color + value.length);
    },
    measure(value: string, style: TextStyle): number {
      return value.length * style.size * 0.55;
    },
    alpha(multiplier: number): number {
      ops += 1;
      fold(multiplier);
      return 1;
    },
    blit(source: Bitmap, dx: number, dy: number, dw: number, dh: number, mode?: BlitMode): void {
      ops += 1;
      fold(dx + dy + dw + dh + source.width + (mode === undefined ? 0 : mode.length));
    },
    createTarget(w: number, h: number, mode?: TargetMode): RenderTarget {
      void mode;
      return createNullSurface(w, h, pixelRatio) as NullSurface & RenderTarget;
    },
  };
  return surface;
}
