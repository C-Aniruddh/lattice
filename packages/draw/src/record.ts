/**
 * The headless backend: **no DOM, no canvas, runs in Node.**
 *
 * ## What a test backend should record: draw commands, not pixels
 *
 * A rasteriser in Node would need a font stack, an antialiasing policy and most of this
 * package's byte budget, and it would produce an image whose diff says "412 pixels changed". A
 * command log says `poly[2].fill: 0xc9553fff → 0xc95540ff`, which is a bug report. Pixel
 * exactness is not what golden tests here are protecting; **the shape of the draw is.**
 *
 * That is also why this is `src/` and not `test/`: `ui` wants it for layout measurement without
 * a canvas, and putting it in `canvas2d.ts` would drag `HTMLCanvasElement` into the one import a
 * Node test must be able to make.
 *
 * ## Two properties a golden test rests on
 *
 * - **Coordinates are CSS pixels**, so the same scene at `pixelRatio` 1 and 2 records identical
 *   numbers. A backend that multiplied by the ratio itself would make every golden ratio-
 *   specific, and the failure would look like a rendering change.
 * - **`createTarget` returns another recording surface**, and its digest is what the parent's
 *   `blit` op records. A cached sprite's contents are therefore *covered* by the parent's
 *   digest rather than vanishing behind an opaque image.
 */

import { hashNumber, hashStep, hashString } from '@lattice/core';
import type { Rgba } from './color.js';
import { expectPositive } from './surface.js';
import type {
  Bitmap,
  BlitMode,
  RenderTarget,
  Surface,
  TargetMode,
  TextStyle,
} from './surface.js';

/** The nine calls a surface can record. `resize`, `end` and `createTarget` are structural and
 *  produce nothing to compare. */
export type OpName =
  | 'clear'
  | 'poly'
  | 'polyRamp'
  | 'stroke'
  | 'ellipse'
  | 'softEllipse'
  | 'text'
  | 'blit'
  | 'alpha';

/**
 * One recorded call, rounded to three decimal places on the way in.
 *
 * A golden that fails on the last bit of a float is a golden everyone learns to re-bless
 * without reading, which is strictly worse than not having one.
 *
 * The `xy` layout is per op, and it is documented here because reading a failed golden is the
 * whole point of this backend:
 *
 * | op | `xy` | `colors` | `value` | `text` |
 * |---|---|---|---|---|
 * | `clear` | — | the clear color | 0 | — |
 * | `poly` | the points | fill | point count | — |
 * | `polyRamp` | the points, then `x0,y0,x1,y1` | from, to | point count | — |
 * | `stroke` | the points | color | line width | `open`/`closed`, and the dash |
 * | `ellipse` | `cx,cy,rx,ry` | fill | `rx` | — |
 * | `softEllipse` | `cx,cy,rx,ry` | inner, outer | `rx` | — |
 * | `text` | `x,y,size,weight,align,baseline`, then the 6 transform values | color | em size | the string |
 * | `blit` | `dx,dy,dw,dh` | — | `dw` | the mode and the source's digest |
 * | `alpha` | — | — | the new multiplier | — |
 */
export interface Op {
  /** Which call this was. */
  readonly op: OpName;
  /** The numbers, laid out per the table on {@link Op}. */
  readonly xy: readonly number[];
  /** The colors, in argument order. */
  readonly colors: readonly Rgba[];
  /** The scalar the op carries: stroke width, alpha multiplier, blit width. */
  readonly value: number;
  /** Empty except for `text`, `stroke` and `blit`. */
  readonly text: string;
}

/** Rounding factor for a recorded coordinate: three decimals, which is a thousandth of a CSS
 *  pixel — far below anything a backend could render differently, and far above float noise. */
const OP_SCALE = 1000;

/**
 * Advance width per point of font size, used by {@link Surface.measure} where there are no
 * fonts.
 *
 * Public because it is the reason a wall sign's shrink-to-fit lands differently in Node than in
 * Chrome, and a test author who does not know that will write a flaky golden. Assert that the
 * shrink branch ran; never assert where a glyph landed.
 */
export const ESTIMATED_ADVANCE_RATIO = 0.55;

/** Round one recorded number, and normalize `-0` to `0` so two runs that differ only in the
 *  sign of a zero produce the same digest. */
function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = Math.round(value * OP_SCALE) / OP_SCALE;
  return scaled === 0 ? 0 : scaled;
}

/**
 * A recording surface, and the extra half of the contract a test reads.
 *
 * This is the one place in the kit permitted to allocate freely, because it never runs in a
 * frame: an `Op` per call, an array per surface, and a fresh string per digest.
 */
export interface RecordingSurface extends Surface {
  /** Narrowed, so `surface.kind === 'recording'` discriminates in a caller's own union. */
  readonly kind: 'recording';
  /** Every call since the last {@link RecordingSurface.reset}, in order, readable in a test
   *  failure. */
  readonly ops: readonly Op[];
  /** A stable hash of {@link RecordingSurface.ops} — the value a golden file stores. Eight hex
   *  digits, and it changes when anything in the draw does. */
  digest(): string;
  /** Drop every recorded op. `begin()` deliberately does *not* do this, so a test can record
   *  several frames and compare them. */
  reset(): void;
}

/** A recording surface used as a render target: the same log, plus the bitmap handle a `blit`
 *  takes and the mode it accumulates in. */
export interface RecordingTarget extends RecordingSurface, RenderTarget {
  /** Narrowed again, because `RenderTarget` widens it back to `SurfaceKind` and an interface
   *  may not inherit two different answers to the same question. */
  readonly kind: 'recording';
  /** `'light'` targets blend by per-channel maximum; `'image'` targets paint source-over. The
   *  field exists so a test can prove the light field accumulated rather than composited. */
  readonly mode: TargetMode;
}

/**
 * Which recording surface produced a bitmap.
 *
 * A `WeakMap` rather than a field on `Bitmap`, because `Bitmap` is the seam every backend
 * shares and a recording-specific field on it would be a lie a WebGL backend had to tell.
 */
const producers = new WeakMap<Bitmap, RecordingSurface>();

/**
 * A surface that records draw commands and a digest rather than pixels.
 *
 * @param pixelRatio Recorded on the surface and on every bitmap it makes, and applied to
 *   nothing — which is the point. Ops are CSS pixels at every ratio.
 * @throws RangeError if either dimension is not a finite number greater than zero, or if
 *   `pixelRatio` is not finite and positive. A zero-sized surface silently records a frame
 *   nobody can look at.
 */
export function createRecordingSurface(
  width: number,
  height: number,
  pixelRatio = 1,
): RecordingSurface {
  return makeRecorder(width, height, pixelRatio, undefined);
}

/**
 * The shared body of {@link createRecordingSurface} and its targets.
 *
 * One function rather than two, because a target that recorded differently from a surface would
 * make invariant 20 — "an offscreen surface is the same surface" — untestable in the backend
 * that exists to test it.
 */
function makeRecorder(
  width: number,
  height: number,
  pixelRatio: number,
  mode: TargetMode | undefined,
): RecordingTarget {
  const fn = mode === undefined ? 'createRecordingSurface' : 'surface.createTarget';
  let w = expectPositive(width, fn, 'width');
  let h = expectPositive(height, fn, 'height');
  let ratio = expectPositive(pixelRatio, fn, 'pixelRatio');
  const ops: Op[] = [];
  let multiplier = 1;

  /** Copy `count` points out of a caller's scratch buffer. The buffer is reused by the next
   *  primitive, so a reference to it would record whatever came later. */
  function points(xy: Float64Array, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count * 2; i++) out.push(round(xy[i] ?? 0));
    return out;
  }

  function push(op: OpName, xy: number[], colors: Rgba[], value: number, text: string): void {
    ops.push({ op, xy, colors, value: round(value), text });
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
      return Math.ceil(w * ratio) * Math.ceil(h * ratio) * 4;
    },
    dispose(): void {
      // Nothing to release: the log *is* the image. Present so the seam is the same shape on
      // both backends and a caller never branches on which one it has.
    },
  };

  const surface: RecordingTarget = {
    kind: 'recording',
    mode: mode ?? 'image',
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
    get ops(): readonly Op[] {
      return ops;
    },

    resize(nextW: number, nextH: number, nextRatio: number): void {
      w = expectPositive(nextW, 'surface.resize', 'width');
      h = expectPositive(nextH, 'surface.resize', 'height');
      ratio = expectPositive(nextRatio, 'surface.resize', 'pixelRatio');
    },

    begin(clear: Rgba): void {
      multiplier = 1;
      push('clear', [], [clear >>> 0], 0, '');
    },

    end(): void {
      // A batching backend would flush here. Nothing to flush, and the op log deliberately does
      // not record the call: `end` is structural, and recording it would make every golden
      // depend on how many times a caller closed a frame it had already closed.
    },

    poly(xy: Float64Array, count: number, fill: Rgba): void {
      push('poly', points(xy, count), [fill >>> 0], count, '');
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
      const values = points(xy, count);
      values.push(round(x0), round(y0), round(x1), round(y1));
      push('polyRamp', values, [from >>> 0, to >>> 0], count, '');
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
      const shape = closed ? 'closed' : 'open';
      const dashed =
        dash === undefined || dash <= 0
          ? ''
          : ` dash ${String(round(dash))}/${String(round(dashOffset ?? 0))}`;
      push('stroke', points(xy, count), [color >>> 0], lineWidth, `${shape}${dashed}`);
    },

    ellipse(cx: number, cy: number, rx: number, ry: number, fill: Rgba): void {
      push('ellipse', [round(cx), round(cy), round(rx), round(ry)], [fill >>> 0], rx, '');
    },

    softEllipse(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      inner: Rgba,
      outer: Rgba,
    ): void {
      push(
        'softEllipse',
        [round(cx), round(cy), round(rx), round(ry)],
        [inner >>> 0, outer >>> 0],
        rx,
        '',
      );
    },

    text(
      value: string,
      x: number,
      y: number,
      style: TextStyle,
      color: Rgba,
      xform?: Float64Array,
    ): void {
      const numbers = [
        round(x),
        round(y),
        round(style.size),
        style.weight,
        style.align,
        style.baseline,
      ];
      if (xform !== undefined) for (let i = 0; i < 6; i++) numbers.push(round(xform[i] ?? 0));
      push('text', numbers, [color >>> 0], style.size, value);
    },

    measure(value: string, style: TextStyle): number {
      // No fonts here, so this is an estimate and says so. A golden may assert that a sign
      // shrank; it may not assert by how much, because Chrome will disagree.
      return value.length * style.size * ESTIMATED_ADVANCE_RATIO;
    },

    alpha(next: number): number {
      const previous = multiplier;
      multiplier = next;
      push('alpha', [], [], next, '');
      return previous;
    },

    blit(source: Bitmap, dx: number, dy: number, dw: number, dh: number, blit?: BlitMode): void {
      // The source's own digest, so a cached sprite's contents are covered by this surface's
      // digest rather than disappearing behind an opaque handle.
      const from = producers.get(source);
      const mark = from === undefined ? 'external' : from.digest();
      push(
        'blit',
        [round(dx), round(dy), round(dw), round(dh)],
        [],
        dw,
        `${blit ?? 'over'} ${mark}`,
      );
    },

    createTarget(targetW: number, targetH: number, targetMode?: TargetMode): RenderTarget {
      const target = makeRecorder(targetW, targetH, ratio, targetMode ?? 'image');
      producers.set(target.bitmap, target);
      return target;
    },

    digest(): string {
      // Folded with `core`'s stateless hash rather than a stream, so the value depends only on
      // the ops and not on how many digests were taken first.
      let acc = hashString('lattice/draw');
      for (const op of ops) {
        acc = hashStep(acc, hashString(op.op));
        for (const n of op.xy) acc = hashStep(acc, hashNumber(n));
        for (const c of op.colors) acc = hashStep(acc, c >>> 0);
        acc = hashStep(acc, hashNumber(op.value));
        if (op.text !== '') acc = hashStep(acc, hashString(op.text));
      }
      return (acc >>> 0).toString(16).padStart(8, '0');
    },

    reset(): void {
      ops.length = 0;
      multiplier = 1;
    },
  };

  producers.set(bitmap, surface);
  return surface;
}
