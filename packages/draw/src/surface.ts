/**
 * The seam: what a backend must provide, and the per-frame context a primitive is handed.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.** It declares an interface; the
 * two implementations are `canvas2d.ts` (browser) and `record.ts` (headless).
 *
 * ## How narrow the seam had to be
 *
 * The test applied to every candidate method was: *could a competent WebGL backend implement
 * this in under fifty lines, without lying?* Bezier paths fail it — they need a tessellator
 * bigger than this whole package. Clipping fails it. `globalCompositeOperation` fails it, with
 * its twenty-six Porter-Duff modes. What survives is convex polygons, polylines, ellipses,
 * text and a render target: thirteen methods, each one something an isometric solid genuinely
 * needs and a GPU backend can genuinely honour.
 *
 * ## Every coordinate on this interface is in CSS pixels
 *
 * Device-pixel-ratio is entirely the backend's business, and that is not a convenience. In the
 * game this kit came from, the ratio transform was applied on resize *and* re-applied by the
 * wall-text routine, which was correct only because both places agreed and one edit from a
 * half-scale campus. Here no caller can see the ratio, so no caller can apply it twice.
 */

import type { Camera } from '@lattice/iso';
import type { Ink, Rgba } from './color.js';
import type { LightField } from './light.js';
import type { Palette } from './palette.js';

/** Which backend a `Surface` is, for the two places that legitimately need to know: a golden
 *  test asserting it is not accidentally running against a canvas, and an error message. */
export type SurfaceKind = 'canvas2d' | 'recording';

/**
 * What a render target accumulates.
 *
 * `'image'` is ordinary source-over painting. `'light'` blends by **per-channel maximum** and
 * starts black — which is the entire reason two lamp pools can overlap without a seam. It is
 * `globalCompositeOperation = 'lighten'` on Canvas2D and `blendEquation(MAX)` on a GPU, so
 * both backends honour it in one line and neither has to lie.
 */
export type TargetMode = 'image' | 'light';

/**
 * How a bitmap lands on what is already there. Three modes, not a composite API.
 *
 * | mode | Canvas2D | WebGL | used for |
 * |---|---|---|---|
 * | `'over'` | `source-over` | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` | everything ordinary |
 * | `'add'` | `lighter` | `ONE, ONE` | the warm bloom a lamp throws |
 * | `'cut'` | `destination-out` | alpha `ZERO, ONE_MINUS_SRC_COLOR` | punching light holes in darkness |
 *
 * Three named modes, each one blend state on both backends, each one demanded by a picture the
 * kit has to be able to draw. A fourth arrives the way the third did: a demo that cannot be
 * built without it.
 */
export type BlitMode = 'over' | 'add' | 'cut';

/**
 * A text run's appearance, passed per call.
 *
 * Per call and not as state, because a font left set on a 2D context is the classic Canvas2D
 * leak: the next caller inherits it and the symptom appears somewhere unrelated to the cause.
 *
 * `align` and `baseline` are `-1 | 0 | 1` (start | center | end) rather than strings, so a
 * backend switches on a number and a golden log records an integer rather than a word that
 * two backends might spell differently.
 */
export interface TextStyle {
  /** Em size in CSS pixels. */
  readonly size: number;
  /** CSS font weight, 100–900. */
  readonly weight: number;
  /** CSS font family list. The kit ships no fonts — rule 8 — so this is always a stack of
   *  system faces, and a golden test must not assert glyph positions because of it. */
  readonly family: string;
  /** Horizontal anchor: -1 start, 0 center, 1 end. */
  readonly align: -1 | 0 | 1;
  /** Vertical anchor: -1 top, 0 middle, 1 bottom. */
  readonly baseline: -1 | 0 | 1;
}

/**
 * An image the kit rendered itself. Opaque: a canvas element, a GPU texture, or an op log.
 *
 * **There is no way to construct one from a URL or a file**, and that is rule 8 — zero assets —
 * expressed in the type system rather than in a lint somebody can disable.
 */
export interface Bitmap {
  /** CSS pixels. */
  readonly width: number;
  /** CSS pixels. */
  readonly height: number;
  /** Device pixels per CSS pixel in the backing store. */
  readonly pixelRatio: number;
  /** Approximate resident bytes. Anything budgeting on this — a sprite cache, a debug
   *  overlay — is lied to if a backend fakes it, and the lie surfaces as an out-of-memory on
   *  a phone rather than as a wrong number. */
  readonly bytes: number;
  /** Release the backing store. A bitmap that outlives its surface leaks GPU memory. */
  dispose(): void;
}

/**
 * Everything a backend must provide.
 *
 * Thirteen methods. Nothing above this interface ever holds a `CanvasRenderingContext2D`, which
 * is what lets the same sprite code paint the world, a shop thumbnail and a golden test.
 */
export interface Surface {
  /** Which backend this is. */
  readonly kind: SurfaceKind;
  /** CSS pixels. Never device pixels — see {@link Surface.pixelRatio}. */
  readonly width: number;
  /** CSS pixels. */
  readonly height: number;
  /** Device pixels per CSS pixel. Read-only to callers; the backend applies it internally, and
   *  a caller that multiplies by it has applied it twice. */
  readonly pixelRatio: number;

  /** Resize the backing store. Coordinates stay in CSS pixels either side of it. */
  resize(width: number, height: number, pixelRatio: number): void;

  /**
   * Start a frame: **erase the surface**, then paint `clear` over it.
   *
   * Resets every piece of backend state — alpha, dash, font, composite — so a frame can never
   * inherit the previous frame's leak.
   *
   * `0` is a transparent start, not "keep what is there". The RFC said the latter; the light
   * accumulator settled it, because a buffer that blends by per-channel maximum and is never
   * erased keeps every pool it has ever been given, and the symptom is a night that gets
   * gradually brighter the longer the player looks at it. Nothing in the kit wants a frame
   * composited over its predecessor, and a `begin` that forgets to erase is the single easiest
   * ghosting bug to ship.
   */
  begin(clear: Rgba): void;

  /** Finish the frame. A backend that batches flushes here; Canvas2D does nothing. */
  end(): void;

  /**
   * Fill a **convex** polygon given as `count` xy pairs from the start of `xy`.
   *
   * Convex is the contract, not an optimization: it is what lets a GPU backend fan-triangulate
   * in place with no tessellation library. Every face of every iso solid in this kit is convex;
   * if a shape is not, the sprite author splits it, because they know how and a general
   * tessellator does not.
   */
  poly(xy: Float64Array, count: number, fill: Rgba): void;

  /**
   * Fill a convex polygon with a linear color ramp along the screen-space segment
   * `(x0,y0) → (x1,y1)`.
   *
   * Two stops, no gradient object. This is the cylinder body and the sky backdrop, and it is
   * per-vertex color on a GPU. A `createLinearGradient`-shaped API would allocate an object
   * per cylinder per frame and hand WebGL something it cannot honour.
   */
  polyRamp(
    xy: Float64Array,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    from: Rgba,
    to: Rgba,
  ): void;

  /**
   * Stroke a polyline, optionally closed, with round joins and caps.
   *
   * `dash` and `dashOffset` are per call and not state. Marching ants on a placement ghost are
   * the one place the kit needs a dash, and a dash pattern left set on a shared context is the
   * bug that draws every subsequent outline dotted.
   */
  stroke(
    xy: Float64Array,
    count: number,
    closed: boolean,
    color: Rgba,
    width: number,
    dash?: number,
    dashOffset?: number,
  ): void;

  /** An axis-aligned filled ellipse — cylinder caps, glow cores, bubbles. */
  ellipse(cx: number, cy: number, rx: number, ry: number, fill: Rgba): void;

  /**
   * An ellipse with a radial falloff from `inner` at the center to `outer` at the rim.
   *
   * The single most load-bearing call in the kit's look: it is the contact shadow that grounds
   * a building and the halo on a glow dot. A primitive rather than a gradient object because a
   * gradient object is an allocation per shadow per frame — the source game made one — and
   * because on a GPU this is one quad and a ramp texture.
   */
  softEllipse(cx: number, cy: number, rx: number, ry: number, inner: Rgba, outer: Rgba): void;

  /**
   * Draw a text run, optionally through a 2×3 affine transform `[a,b,c,d,e,f]` mapping local
   * `(x, y)` to `(a·x + c·y + e, b·x + d·y + f)`.
   *
   * The transform argument exists **only** because text on a vertical face has to shear into
   * the isometric plane, and it is deliberately not a transform stack: the solids are already
   * computed in screen space, so nothing else in this package wants one, and a stack invites a
   * `save`/`restore` imbalance across a frame boundary.
   */
  text(
    value: string,
    x: number,
    y: number,
    style: TextStyle,
    color: Rgba,
    xform?: Float64Array,
  ): void;

  /**
   * Advance width in CSS pixels.
   *
   * **Backends disagree here and are allowed to.** The recording backend has no fonts and
   * estimates — see `ESTIMATED_ADVANCE_RATIO`. A golden test may assert that text was shrunk
   * to fit; it may not assert where a glyph landed.
   */
  measure(value: string, style: TextStyle): number;

  /**
   * Set the multiplier applied to the alpha of every subsequent call, and return the previous
   * value.
   *
   * `const prev = s.alpha(0.34); …; s.alpha(prev);` — a save/restore with no stack, no object,
   * and no way to leave one unbalanced across a frame boundary, because `begin()` resets it to
   * 1 regardless of what the last frame did.
   *
   * **It sets; it does not compose.** A nested caller that wants both multipliers passes their
   * product — `s.alpha(outer * inner)` — and restores the outer one afterwards. Composing here
   * instead would make the restore call itself compound, and a ghost inside a ghost would fade
   * to nothing over a few frames for reasons nothing in a stack trace could explain.
   */
  alpha(multiplier: number): number;

  /**
   * Draw a bitmap this kit produced. The only way an image reaches the screen.
   *
   * Implementations must snap `dx`/`dy` to whole device pixels: a cached sprite drawn at
   * `dx = 41.3` resamples, and the whole campus then shimmers against terrain that is drawn
   * directly.
   */
  blit(source: Bitmap, dx: number, dy: number, dw: number, dh: number, mode?: BlitMode): void;

  /**
   * A sibling surface that renders into memory: an offscreen canvas, an FBO, a nested log.
   *
   * This is what makes thumbnails, the light buffer and golden tests one mechanism instead of
   * three, and it is why `Surface` is an interface rather than a class.
   */
  createTarget(width: number, height: number, mode?: TargetMode): RenderTarget;
}

/** A `Surface` that renders into memory and hands back the result. */
export interface RenderTarget extends Surface {
  /** The finished image. Valid only after {@link Surface.end}; reading it before is undefined. */
  readonly bitmap: Bitmap;
}

/**
 * Points the pen's scratch buffer holds.
 *
 * The largest single polygon the kit submits is a cylinder silhouette at
 * `2 · CYLINDER_SEGMENTS + 2` points; 128 leaves room for a sprite author's own convex shape
 * without ever growing, and 2 KB of `Float64Array` per frame context is not worth economising.
 */
const SCRATCH_POINTS = 128;

/**
 * A frame's worth of context, so a primitive takes coordinates and not plumbing.
 *
 * One `Pen` is allocated per frame. That — plus the `FrameOpts` literal the caller writes — is
 * this package's entire per-frame allocation: two objects, not two per sprite.
 */
export interface Pen {
  /** Where the drawing goes. Never a canvas; see {@link Surface}. */
  readonly surface: Surface;
  /** The transform. `draw` reads it and never moves it — panning is `input`'s. */
  readonly camera: Camera;
  /** Slot → color for this frame. Its `rev` is what keeps any cache honest. */
  readonly palette: Palette;
  /** Seconds since the session began. The only clock in this package, and it arrives here as a
   *  parameter — nothing under `src/` reads one. */
  readonly t: number;
  /**
   * Scratch vertex buffer, owned by the pen and reused by every primitive on it.
   *
   * This is the anti-garbage mechanism, stated as a field so a builder cannot miss it: a box
   * computes its corners into `xy` and hands `(xy, n)` to the surface. The source game's `pt()`
   * returned `{x, y}` per corner — seven objects per box per frame, four hundred buildings,
   * sixty times a second. **Never retain a reference to this array**, and never hold a value
   * read out of it across a call that might write to it.
   */
  readonly xy: Float64Array;
  /**
   * The light accumulator for this frame, if the game has one.
   *
   * `drawSprite` reads it to run a sprite's `emit` hook. `undefined` means the game has no
   * night, and every light in the kit then costs nothing at all rather than a little.
   */
  readonly light: LightField | undefined;
  /**
   * The device-pixel snap offset, added to every screen coordinate this pen produces.
   *
   * **`iso` computes the camera in continuous world space and declines to round. `draw` rounds,
   * because `draw` is the package touching a device.** `beginFrame` projects the world origin,
   * takes its position in device pixels, and stores the correction that lands it on a whole
   * one; every primitive then adds `(snapX, snapY)` to each corner.
   *
   * Two adds per point buys: 1 px strokes that stay 1 px instead of shimmering between one and
   * two across a pan, blits that land on pixel boundaries, and terrain seams that do not open
   * and close. Because the offset is *uniform*, every geometric relationship — and every hit
   * test computed from the unsnapped camera — survives exactly.
   */
  readonly snapX: number;
  /** See {@link Pen.snapX}. */
  readonly snapY: number;
  /**
   * Whether `FrameOpts.snap` asked for whole-device-pixel snapping — the option, read back off
   * the pen it configured.
   *
   * **`snapX === 0` is not the same answer.** Zero is also what an origin that already lands on a
   * whole device pixel produces, so a caller reading the offsets to find out whether snapping is
   * on gets `true` for most of a pan and `false` for the frames it happens to line up on. That is
   * the shadow-copy failure non-negotiable 11 exists to remove, arriving as a derived value
   * rather than as a second variable: the information is genuinely not recoverable from what was
   * already exposed, so it is exposed under its own name.
   *
   * A sub-pen always snaps and reports `true`; it is drawing into its own target, where there is
   * no cinematic pan to keep continuous.
   */
  readonly snap: boolean;
}

/**
 * What a frame needs to start. Named fields rather than positional, because the sixth is an
 * optional `LightField` and nobody should have to count commas to reach it.
 *
 * Every field that survives the call reads back off the {@link Pen} it made, under its own name:
 * `surface`, `camera`, `palette`, `t`, `light`, `snap`. **`clear` is the one exception and it is
 * an honest one** — it is painted and then gone. Nothing retains it, and a getter would have to
 * invent a value out of pixels that any subsequent draw has already covered.
 */
export interface FrameOpts {
  /** Where the frame lands. */
  readonly surface: Surface;
  /** The transform for this frame. */
  readonly camera: Camera;
  /** Slot colors for this frame. */
  readonly palette: Palette;
  /** Seconds since the session began. From `loop`; this package never reads a clock. */
  readonly t: number;
  /** Painted over the whole surface first. Omit to keep what is already there — which is what
   *  a render target filling a sprite wants, and what a full-screen frame never does. */
  readonly clear?: Ink;
  /** Attach a night. Omit and every light in the kit costs nothing. */
  readonly light?: LightField;
  /**
   * Whole-device-pixel snapping. Default true.
   *
   * Off costs a sub-pixel shimmer and buys perfectly continuous motion, which matters for a
   * slow cinematic pan and for nothing else. At `pixelRatio` 2 the snap is at most half a CSS
   * pixel of position error, which is why it is on by default and why turning it off is a
   * deliberate act rather than a default someone drifted into.
   */
  readonly snap?: boolean;
}

/**
 * Reject a surface dimension by name — **shared by both backends**, so a caller learns one
 * message shape rather than two that happen to agree today.
 *
 * A zero-sized surface silently records a frame nobody can look at, and a non-finite one makes
 * every coordinate on it `NaN`, which paints nothing and reports nothing.
 */
export function expectPositive(value: number, fn: string, param: string): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${fn}: expected a finite ${param} > 0, got ${String(value)}`);
  }
  return value;
}

/**
 * The correction that puts a screen coordinate on a whole device pixel.
 *
 * Rounds rather than floors, so the worst error is half a device pixel either way rather than
 * a whole one in a fixed direction — a floor biases the entire scene up and left by up to a
 * pixel, which is visible as a half-pixel jump the first time somebody changes the ratio.
 */
function snapOffset(screen: number, pixelRatio: number): number {
  const device = screen * pixelRatio;
  return (Math.round(device) - device) / pixelRatio;
}

/**
 * Open a frame: clear the surface and build the pen every primitive is handed.
 *
 * @throws RangeError if `t` is not finite. A `NaN` clock does not throw anywhere downstream;
 *   it turns every animated position into `NaN` and paints an empty screen, which is reported
 *   as "the game went black" with nothing in the console.
 */
export function beginFrame(opts: FrameOpts): Pen {
  if (!Number.isFinite(opts.t)) {
    throw new RangeError(`beginFrame: expected t to be a finite number, got ${String(opts.t)}`);
  }
  const clear = opts.clear === undefined ? 0 : opts.palette.ink(opts.clear);
  opts.surface.begin(clear);
  const snap = opts.snap !== false;
  const ratio = opts.surface.pixelRatio;
  // The world origin rather than the camera center: the camera center projects to the middle
  // of the viewport by definition and carries no information about the pan at all, so snapping
  // to it would be a no-op that looked like a fix.
  return {
    surface: opts.surface,
    camera: opts.camera,
    palette: opts.palette,
    t: opts.t,
    xy: new Float64Array(SCRATCH_POINTS * 2),
    light: opts.light,
    snapX: snap ? snapOffset(opts.camera.toScreenX(0), ratio) : 0,
    snapY: snap ? snapOffset(opts.camera.toScreenY(0), ratio) : 0,
    snap,
  };
}

/** Close the frame. A batching backend flushes here; Canvas2D does nothing, and calling it
 *  anyway is what stops a game from having to know which backend it has. */
export function endFrame(pen: Pen): void {
  pen.surface.end();
}

/**
 * A pen onto a different surface and camera, sharing this one's palette and clock.
 *
 * How a thumbnail, a cache fill and a minimap are drawn by exactly the code that draws the
 * world. It gets its own scratch buffer, so a sub-pen may be used *inside* a draw call without
 * the outer call's half-built polygon being overwritten underneath it.
 *
 * **It carries no light field.** A sprite drawn into a thumbnail must not post a pool into the
 * frame's night mask — the pool would appear in the valley, at the sprite's world position,
 * because a shop card was open.
 */
export function subPen(pen: Pen, surface: Surface, camera: Camera): Pen {
  return {
    surface,
    camera,
    palette: pen.palette,
    t: pen.t,
    xy: new Float64Array(SCRATCH_POINTS * 2),
    light: undefined,
    snapX: snapOffset(camera.toScreenX(0), surface.pixelRatio),
    snapY: snapOffset(camera.toScreenY(0), surface.pixelRatio),
    snap: true,
  };
}
