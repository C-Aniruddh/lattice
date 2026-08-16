/**
 * The pool, the edge, and the darkness it is cut from.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.** It composites through `Surface`
 * render targets, which is the only thing in the kit that knows what a framebuffer is.
 *
 * ## Why an accumulator, and not either obvious implementation
 *
 * "You can see exactly where the light stops" is a requirement on compositing, and it rules out
 * the two things a builder reaches for first:
 *
 * - **Recolour the world at night and draw a warm blob per lamp.** There is then no edge — the
 *   blob fades into a world that is uniformly darker, and the player cannot tell where light
 *   ends because nothing ends.
 * - **Draw darkness per lamp, punching a hole per lamp as you go.** Two overlapping pools punch
 *   the same pixels twice — `(1−a₁)(1−a₂)`, not `max(a₁,a₂)` — so the overlap comes out visibly
 *   brighter than either pool and every pair of adjacent lamps grows a hot lens-shaped seam
 *   between them. It looks like a driver bug because it is a rendering one, and it is unfixable
 *   in that shape.
 *
 * So light is gathered into its own buffer with **per-channel max blending**, and darkness is
 * composited *once* from the finished field. Max is what makes two pools meet as one pool.
 *
 * | step | what | why |
 * |---|---|---|
 * | 1 | every `add()` draws into a `'light'` target | max blending, so overlap resolves before anything is composited |
 * | 2 | a darkness quad, then one `'cut'` blit of the light buffer | one hole per pool, with the pool's own soft edge |
 * | 3 | one `'add'` blit of the light buffer at `bloom` | the warm spill on the ground *inside* the pool, where additive is genuinely correct |
 *
 * ## Two things this deliberately does not do
 *
 * **It retains nothing between frames and has no registration.** Pools are re-added every
 * frame; a lamp that stops being drawn stops lighting, with no lifecycle to get wrong. A
 * builder who adds a `removeLight` has reintroduced the bug the design removed.
 *
 * **Lights do not cast shadows and are not occluded.** A lamp behind a hill still spills over
 * it. Real occlusion needs a shadow map per light and a depth buffer this renderer does not
 * have. This is the largest honest limitation in the package.
 */

import { HALF_H, HALF_W } from '@lattice/iso';
import type { Ink, Rgba } from './color.js';
import { withAlpha } from './color.js';
import type { Pen, RenderTarget, Surface } from './surface.js';

/** How a light field is configured. Every default is a measured trade, not a preference. */
export interface LightFieldOpts {
  /**
   * Buffer resolution relative to the surface. Default 0.5.
   *
   * Light is low-frequency, and two full-screen RGBA targets at device resolution is 20 MB
   * resident and four times the fill rate for a difference nobody can point at. **This is the
   * one place in the kit that deliberately renders soft.** Pin it to 1 for a screenshot.
   */
  readonly scale?: number;
  /**
   * Falloff exponent from center to rim. Default 2. Higher is a harder-edged pool: the value
   * sets how much of the radius stays at full intensity before the ramp begins, so 1 is a pure
   * linear ramp and 4 is a disc with a soft rim.
   */
  readonly falloff?: number;
  /** How much of the accumulated light is added back as warm spill. Default 0.35. At 0 the pool
   *  is a hole in the dark and nothing more; above about 0.6 an 8-bit buffer blows out to white
   *  wherever two lamps meet. */
  readonly bloom?: number;
}

/** The frame's light, accumulated and composited once. */
export interface LightField {
  /**
   * False when `darkness` is 0 — full day.
   *
   * The whole subsystem then costs nothing: no buffers allocated, no buffers cleared, no pools
   * drawn, no composite, and `drawSprite` skips every `emit` hook. A game with no night pays
   * for none of this, which is what lets the module exist at all inside a 12 KB budget.
   */
  readonly active: boolean;
  /** Pools accumulated this frame. For a budget assertion and for `docs/PERFORMANCE.md`. */
  readonly count: number;

  /**
   * Start the frame's light field. **Call it before the Terrain pass, not in the Light pass** —
   * pools accumulate as sprites draw, and only the *composite* happens in the Light pass.
   *
   * `darkness` is 0–1 and is the game's own day/night value, the same number it passes to
   * `Palette.lerp`. Two schedules — one for color, one for the mask — is a valley whose
   * darkness and whose blue disagree, and it gets reported as a light bug.
   *
   * `tint` is the color the dark goes: an {@link Ink}, so a slot name lets the dark itself
   * recolour with the palette.
   */
  begin(pen: Pen, darkness: number, tint: Ink): void;

  /**
   * A pool of light **lying in the ground plane** at a grid position, `radiusTiles` across.
   *
   * **The pool is an ellipse, not a circle, and the field does the squashing.** A circle of
   * light on the ground projects 2:1 like every other flat thing in a dimetric world; draw it
   * round and it stops being a pool on the road and becomes a sphere hovering above it — which
   * is precisely the illusion the whole package exists to protect. A kit that made every caller
   * remember the aspect would have a round pool in it inside a week.
   *
   * `zPx` is the **ground elevation** under the light in world pixels, not the height of the
   * lamp head, so a lamp on a hillside lights its own terrace rather than the valley floor. The
   * glow on the fixture itself is a `glowDot` in the Solids pass; this is the light it throws.
   *
   * The mask knows a position, a radius, an intensity and a color, and deliberately nothing
   * else. It does not know what a lamp is and it holds no list of emitters.
   */
  add(
    gx: number,
    gy: number,
    zPx: number,
    radiusTiles: number,
    intensity: number,
    color: Ink,
    falloff?: number,
  ): void;

  /**
   * A pool in screen pixels — a flash, a cursor glow, a UI-anchored highlight.
   *
   * `aspect` is height over width and is **required, with no default**, because the choice
   * between 1 (a genuine screen-space circle: a flash, a vignette) and 0.5 (something lying on
   * the ground that the caller already has in screen coordinates) is exactly the mistake
   * {@link LightField.add} exists to prevent, and a default would pick one silently.
   */
  addScreen(
    sx: number,
    sy: number,
    radiusPx: number,
    aspect: number,
    intensity: number,
    color: Ink,
    falloff?: number,
  ): void;

  /**
   * Composite mask and bloom onto the surface. Called once, in the Light pass, by
   * `renderFrame` — which gives a game no way to call it anywhere else, because a light
   * composite in the Overlay pass takes the HUD dark with the world and the player cannot read
   * their own coin at midnight.
   */
  composite(): void;

  /** Rebuild the buffers for a new surface size. Cheap to call every frame; it only acts when
   *  the size actually changed. */
  resize(width: number, height: number): void;
  /** Dispose both buffers. A field that outlives its surface leaks GPU memory. */
  dispose(): void;
}

/** Buffer resolution relative to the surface. See {@link LightFieldOpts.scale}. */
const DEFAULT_SCALE = 0.5;
/** See {@link LightFieldOpts.falloff}. */
const DEFAULT_FALLOFF = 2;
/** See {@link LightFieldOpts.bloom}. */
const DEFAULT_BLOOM = 0.35;

/** Clamp to 0–1 without importing a helper for one line, and turn `NaN` into 0 — a `NaN`
 *  darkness would otherwise make the whole mask transparent and look like the night failed. */
function unit(value: number): number {
  return Number.isFinite(value) ? (value < 0 ? 0 : value > 1 ? 1 : value) : 0;
}

/** Reject one option by name. Each of these silently produces either a blank mask or a white
 *  screen, and neither reports itself, so the checks all happen at construction. */
function reject(name: string, want: string, value: number): never {
  throw new RangeError(`createLightField: expected ${name} ${want}, got ${String(value)}`);
}

/**
 * Build a light field over a surface.
 *
 * The buffers are **not** allocated here. They arrive on the first frame whose `darkness` is
 * above zero, so a game that never has a night never pays for one.
 *
 * @throws RangeError if `scale` is not in `(0, 1]`, if `falloff` is below 1, or if `bloom` is
 *   outside `[0, 1]`. Each of those silently produces either a blank mask or a white screen,
 *   and neither reports itself.
 */
export function createLightField(surface: Surface, opts?: LightFieldOpts): LightField {
  const scale = opts?.scale ?? DEFAULT_SCALE;
  const falloffDefault = opts?.falloff ?? DEFAULT_FALLOFF;
  const bloom = opts?.bloom ?? DEFAULT_BLOOM;
  if (!(Number.isFinite(scale) && scale > 0 && scale <= 1)) reject('scale', 'in (0, 1]', scale);
  if (!(Number.isFinite(falloffDefault) && falloffDefault >= 1)) {
    reject('falloff', '>= 1', falloffDefault);
  }
  if (!(Number.isFinite(bloom) && bloom >= 0 && bloom <= 1)) reject('bloom', 'in [0, 1]', bloom);

  /** The full-buffer quad the darkness is painted with. One per field, allocated at setup. */
  const quad = new Float64Array(8);

  let lightBuf: RenderTarget | undefined;
  let maskBuf: RenderTarget | undefined;
  let bufW = 0;
  let bufH = 0;
  let pen: Pen | undefined;
  let darkness = 0;
  let tint: Rgba = 0;
  let active = false;
  let count = 0;

  /** Buffer dimension for a surface dimension. At least one pixel: a zero-sized target is a
   *  backend error on some paths and a silent no-op on others. */
  function bufferSize(value: number): number {
    const scaled = Math.round(value * scale);
    return scaled < 1 ? 1 : scaled;
  }

  function release(): void {
    lightBuf?.bitmap.dispose();
    maskBuf?.bitmap.dispose();
    lightBuf = undefined;
    maskBuf = undefined;
    bufW = 0;
    bufH = 0;
  }

  function ensure(width: number, height: number): void {
    const w = bufferSize(width);
    const h = bufferSize(height);
    if (lightBuf !== undefined && maskBuf !== undefined && w === bufW && h === bufH) return;
    release();
    bufW = w;
    bufH = h;
    // Two targets and two modes. `'light'` blends by per-channel maximum and is the whole
    // reason overlapping pools do not brighten; `'image'` is where the darkness is assembled
    // before it lands on the surface, so the cut happens once rather than once per lamp.
    lightBuf = surface.createTarget(w, h, 'light');
    maskBuf = surface.createTarget(w, h, 'image');
  }

  /** Accumulate one pool into the light buffer, in buffer pixels. Shared by both `add` forms so
   *  the falloff and the max blending cannot drift between them. */
  function pool(
    sx: number,
    sy: number,
    rx: number,
    ry: number,
    intensity: number,
    color: Ink,
    falloff: number,
  ): void {
    const buffer = lightBuf;
    if (buffer === undefined || pen === undefined) return;
    if (!(intensity > 0) || !(rx > 0) || !(ry > 0)) return;
    const resolved = pen.palette.ink(color);
    const inner = withAlpha(resolved, unit(intensity));
    // The exponent, expressed as a plateau: `falloff` 1 is a pure linear ramp from the center,
    // 2 holds full intensity to half the radius, 4 to three quarters. A real power curve would
    // need a `pow` per pixel that no `softEllipse` primitive can honour on either backend.
    const plateau = falloff <= 1 ? 0 : 1 - 1 / falloff;
    if (plateau > 0) buffer.ellipse(sx, sy, rx * plateau, ry * plateau, inner);
    buffer.softEllipse(sx, sy, rx, ry, inner, withAlpha(resolved, 0));
    count += 1;
  }

  const field: LightField = {
    get active() {
      return active;
    },
    get count() {
      return count;
    },

    begin(nextPen: Pen, nextDarkness: number, nextTint: Ink): void {
      pen = nextPen;
      darkness = unit(nextDarkness);
      count = 0;
      active = darkness > 0;
      if (!active) return;
      tint = nextPen.palette.ink(nextTint);
      ensure(nextPen.surface.width, nextPen.surface.height);
      // Transparent rather than opaque black: the buffer accumulates by maximum, and a fully
      // opaque black start would make every pool's alpha the maximum of itself and 255.
      lightBuf?.begin(0);
    },

    add(
      gx: number,
      gy: number,
      zPx: number,
      radiusTiles: number,
      intensity: number,
      color: Ink,
      falloff = falloffDefault,
    ): void {
      if (!active || pen === undefined) return;
      const cam = pen.camera;
      const sx = (cam.toScreenX((gx - gy) * HALF_W) + pen.snapX) * scale;
      const sy = (cam.toScreenY((gx + gy) * HALF_H - zPx) + pen.snapY) * scale;
      const rx = radiusTiles * HALF_W * cam.zoom * scale;
      // Half, always, and computed here so that no caller ever pre-squashes anything.
      pool(sx, sy, rx, rx / 2, intensity, color, falloff);
    },

    addScreen(
      sx: number,
      sy: number,
      radiusPx: number,
      aspect: number,
      intensity: number,
      color: Ink,
      falloff = falloffDefault,
    ): void {
      if (!active) return;
      const rx = radiusPx * scale;
      pool(sx * scale, sy * scale, rx, rx * aspect, intensity, color, falloff);
    },

    composite(): void {
      const light = lightBuf;
      const mask = maskBuf;
      if (!active || pen === undefined || light === undefined || mask === undefined) return;
      light.end();

      mask.begin(0);
      quad[0] = 0;
      quad[1] = 0;
      quad[2] = bufW;
      quad[3] = 0;
      quad[4] = bufW;
      quad[5] = bufH;
      quad[6] = 0;
      quad[7] = bufH;
      mask.poly(quad, 4, withAlpha(tint, darkness));
      // One cut, for the frame. Punching per lamp is trap 17 and the seam it makes is the most
      // likely way to get the demo's premise visibly wrong.
      mask.blit(light.bitmap, 0, 0, bufW, bufH, 'cut');
      mask.end();

      const target = pen.surface;
      target.blit(mask.bitmap, 0, 0, target.width, target.height, 'over');
      if (bloom > 0) {
        const previous = target.alpha(bloom);
        target.blit(light.bitmap, 0, 0, target.width, target.height, 'add');
        target.alpha(previous);
      }
    },

    resize(width: number, height: number): void {
      if (lightBuf === undefined) return;
      ensure(width, height);
    },

    dispose(): void {
      release();
      active = false;
      pen = undefined;
    },
  };
  return field;
}
