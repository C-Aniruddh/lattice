/**
 * How a game defines its own building without forking the kit.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.**
 *
 * The source game's answer to this question was one hand-written function per building type, in
 * kit source, which is a fork by construction. The answer here is a **{@link SolidWriter}: an
 * emitter a game writes its massing against once, which the kit replays through three different
 * consumers.**
 *
 * | replayed through | gives you |
 * |---|---|
 * | a writer bound to a `Pen` | the building, drawn |
 * | a writer bound to a `RenderTarget` — a sub-pen | the shop thumbnail |
 * | a writer that only unions corners | {@link spriteBounds} and {@link spriteVolume}, for free |
 *
 * Not a data schema: a `Solid[]` array is serialisable and cannot express "four posts in a loop,
 * and a mast only above level 2" without growing a small interpreter. Not a bare draw callback
 * either: a callback can be drawn and nothing else. An emitter is written like code and is still
 * replayable.
 *
 * ## The two hooks, and why they are separate
 *
 * `massing` is static art and `animate` is live art. The split enforces rule three of the source
 * game's art direction *structurally* — **something moves on every building** — in a slot that
 * is named and separate rather than as a thing an author remembers to add. It is also what would
 * make a bitmap cache tractable if one were ever needed: a building whose blinking LED was baked
 * in would be a building that stops blinking, which is a worse bug than a slow frame.
 *
 * ## Determinism is structural here, not documented
 *
 * `massing` receives `(writer, variant, rng)` **and nothing else**. There is no channel through
 * which unkeyed state can reach the art: no surface to reach for, no clock, and an `Rng` the kit
 * seeds from `variant.seed` on every call. A rack cannot reshuffle its LEDs on reload, and a
 * replay from a seed lands on the same pixel. A closure over a game object defeats all of that
 * in one line, and the signature is the only thing standing in its way.
 */

import { Rng, createRng, hashStep } from '@lattice/core';
import type { Camera, Rect, Volume } from '@lattice/iso';
import { HALF_H, HALF_W } from '@lattice/iso';
import type { Ink, Rgba } from './color.js';
import type { LightField } from './light.js';
import type { Palette } from './palette.js';
import { BASE_SLOTS, createPalette } from './palette.js';
import { contactShadow } from './shadow.js';
import type { BoxOpts } from './solids.js';
import {
  GHOST_LIFT,
  SELECT_LIFT,
  glowDot,
  isoBox,
  isoCylinder,
  isoPatch,
  isoPost,
  isoRoof,
  isoTile,
  isoWall,
  levelsToPx,
  put,
  pxToLevels,
} from './solids.js';
import type { Pen } from './surface.js';
import { wallText } from './text.js';

/**
 * The instance facts the static art may depend on — and therefore everything that would ever
 * belong in a cache key.
 *
 * `massing` receives this and nothing else, which is what makes staleness impossible rather than
 * unlikely.
 */
export interface Variant {
  /** Upgrade level. Massing may branch on it freely. */
  readonly level: number;
  /** Per-instance determinism. Seeds the `Rng` the kit hands to every hook. */
  readonly seed: number;
  /** Bitfield — see `FLAG_*`. Anything boolean about an instance goes here, **not in a
   *  closure**, because a closure is exactly the channel this type exists to close. */
  readonly flags: number;
  /** 0–1 construction progress. */
  readonly progress: number;
  /** Instance text — a company name on a roof sign. Empty string when unused, **never absent**,
   *  so a massing never has to test for it and a sign never renders `undefined`. */
  readonly label: string;
}

/** A finished, powered, unnamed instance. The variant a test uses and a sprite falls back to. */
export const VARIANT_ZERO: Variant = Object.freeze({
  level: 1,
  seed: 0,
  flags: 1,
  progress: 1,
  label: '',
});

/** The instance is connected and running. */
export const FLAG_POWERED = 1;
/** The instance is under construction; `progress` is meaningful. */
export const FLAG_BUILDING = 2;
/** The player has it selected. */
export const FLAG_SELECTED = 4;
/** It is a placement preview rather than a real thing. */
export const FLAG_GHOST = 8;

/**
 * The emitter a game's massing is written against.
 *
 * One method per solid, with the same arguments as the free functions in `solids` minus the pen
 * — because the writer may not be drawing. **Nothing here reads back, returns geometry, or
 * exposes the surface**: a massing function that could reach the surface could defeat both the
 * measuring replay and the WebGL seam in one line.
 *
 * Coordinates are **relative to the footprint origin**, so a sprite is drawn anywhere without
 * knowing where. Heights are in storeys, like everything a sprite author writes.
 */
export interface SolidWriter {
  /**
   * The frame's palette, for a massing that genuinely has to branch on a color.
   *
   * **A measuring replay has no frame**, so it sees the kit's `BASE_SLOTS` rather than the
   * game's live palette. Branch on {@link Variant}, which is guaranteed identical in both
   * replays; branching on a color here means `spriteBounds` can disagree with the pixels.
   */
  readonly palette: Palette;
  /** A flat tile diamond. See `isoTile`. */
  tile(gx: number, gy: number, fill: Ink, stroke?: Ink, inset?: number, z?: number): void;
  /** The workhorse box. See `isoBox`. */
  box(gx: number, gy: number, w: number, d: number, opts: BoxOpts): void;
  /** An upright cylinder. See `isoCylinder`. */
  cylinder(gx: number, gy: number, radiusTiles: number, opts: BoxOpts): void;
  /** A gabled roof. See `isoRoof`. */
  roof(
    gx: number,
    gy: number,
    w: number,
    d: number,
    z: number,
    rise: number,
    color: Ink,
    outline?: boolean,
  ): void;
  /** A flat quad at height `z`. See `isoPatch`. */
  patch(gx: number, gy: number, w: number, d: number, z: number, fill: Ink, stroke?: Ink): void;
  /** A rectangle on a vertical face. See `isoWall` — and not `patch`, which lies flat. */
  wall(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    z0: number,
    z1: number,
    fill: Ink,
    stroke?: Ink,
  ): void;
  /** A thin upright post. See `isoPost`. */
  post(gx: number, gy: number, z: number, h: number, color: Ink, width?: number): void;
  /** A glowing point. See `glowDot`. This is the *fixture*; the light it throws into the night
   *  is `SpriteDef.emit`. */
  glow(gx: number, gy: number, z: number, color: Ink, radius?: number, intensity?: number): void;
  /** Text sheared onto a vertical face. See `wallText`. */
  sign(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ztop: number,
    heightLevels: number,
    value: string,
    color: Ink,
  ): void;
  /**
   * The contact shadow that grounds the sprite. See `contactShadow`.
   *
   * `z` is a storey height **above the sprite's own ground**, like every other height here, and
   * defaults to 0 — which is the ground itself, wherever `drawSprite` was told that is. A massing
   * therefore never names its elevation to get its shadow in the right place, and a sprite drawn
   * on a hillside cannot cast into the valley by omission.
   */
  shadow(gx: number, gy: number, w: number, d: number, strength?: number, z?: number): void;
}

/**
 * Static art. Runs on every direct draw and would run on a cache miss only.
 *
 * `rng` is freshly seeded from `v.seed` by the kit on every call, and is its **own** stream —
 * adding a draw here cannot reshuffle what {@link Animator} sees.
 *
 * **A massing is not told its ground elevation, and that is deliberate.** The writer already
 * stands on it — every `z` here is measured from wherever {@link drawSprite} put the sprite — so
 * a massing has nothing to do with the number. Handing it over would let one branch on it, and a
 * massing that branched on its elevation would measure differently in {@link spriteBounds}, which
 * replays it with no frame and therefore no ground: the same failure, for the same reason, as
 * branching on a color.
 */
export type Massing = (w: SolidWriter, v: Variant, rng: Rng) => void;

/**
 * Live art over the static image, every frame. A handful of primitives, no more; `pen.t` is the
 * only clock, and it arrived as a parameter.
 *
 * `zPx` is the sprite's **ground elevation in world pixels** — the number {@link drawSprite} was
 * given, passed straight through. An animator draws through the free primitives rather than
 * through a writer, so nothing can stand it on the ground for it: convert once with `pxToLevels`
 * and add the result to the storey heights, exactly as the massing's are already offset. Skip it
 * and the flame burns at sea level while the lamp it belongs to is up the hill.
 *
 * It is the **last** parameter rather than beside `gx` and `gy`, where it belongs, because the
 * shape of this callback is a shipped contract: inserting it would silently rebind `v` in every
 * animator ever written and every one of them would have to be edited on the same commit.
 */
export type Animator = (
  pen: Pen,
  gx: number,
  gy: number,
  v: Variant,
  rng: Rng,
  zPx: number,
) => void;

/**
 * Emissive contribution. Runs only when an *active* `LightField` is attached to the frame, so a
 * game in daylight pays nothing for the lamps it is drawing.
 *
 * `zPx` is the sprite's ground elevation in world pixels, which is exactly what `LightField.add`
 * wants for its own third argument — the field pools light **on the ground under the fixture**,
 * so a lamp on a terrace lights the terrace. No conversion happens on this path in either
 * direction: `iso` produced the pixels and `iso`'s unit is what the light field speaks.
 *
 * Last, for the reason {@link Animator} gives.
 */
export type Emitter = (
  field: LightField,
  gx: number,
  gy: number,
  v: Variant,
  rng: Rng,
  zPx: number,
) => void;

/** A sprite: a footprint, static art, and two optional live hooks. */
export interface SpriteDef {
  /** Stable across releases: it belongs in every golden file and in any key anything ever
   *  builds from a sprite. Renaming one is a content migration, not a refactor. */
  readonly id: string;
  /** Footprint width in tiles. **Must match the game's own footprint** or the shadow, the
   *  depth sort and the pixels disagree about where the building is. */
  readonly w: number;
  /** Footprint depth in tiles. See {@link SpriteDef.w}. */
  readonly d: number;
  /** The static art. */
  readonly massing: Massing;
  /** Live art over it. */
  readonly animate?: Animator | undefined;
  /**
   * Light this sprite throws into the frame's `LightField`, if there is one.
   *
   * Kept separate from `animate` because it runs at a different time and into a different
   * buffer, and separate from `massing` because light is never static. This is the answer to
   * "how does a lamp's radius reach the night mask without the mask knowing what a lamp is": it
   * does not — the lamp posts a pool, and a pool is a position, a radius, an intensity and a
   * color.
   */
  readonly emit?: Emitter | undefined;
}

/** Identity at runtime. It exists to give a sprite literal a contextual type at the call site,
 *  so `massing(s, v, rng)` gets its parameter types without the author naming three of them. */
export function defineSprite(def: SpriteDef): SpriteDef {
  return def;
}

/** Opacity of a placement ghost. Translucent enough to read as a preview, opaque enough that a
 *  player can judge whether it fits. */
const GHOST_ALPHA = 0.55;

/** Dash length in CSS pixels for a marching-ant footprint. */
const ANT_DASH = 6;

/** Marching-ant travel in CSS pixels per second. Slow enough not to strobe, fast enough to read
 *  as "you are placing something" from the corner of an eye. */
const ANT_SPEED = 18;

/**
 * Streams by seed, so a frame that draws four hundred sprites allocates no `Rng` at all.
 *
 * `core` is explicit that one `Rng` per sprite per *frame* is too much, and it is right: the
 * object is small and short-lived, which is exactly the profile that hides in a mean and shows
 * up as a collector pause in the tail. A stream's identity is its seed, so one instance per seed
 * can be rewound in place for ever — `Rng.restore` mutates when the identity matches and
 * allocates when it does not, which is why the map is keyed on the seed rather than pooled by
 * call depth.
 */
const streams = new Map<number, Rng>();

/** How many streams are kept before the map is dropped wholesale. Bounded by the number of
 *  distinct instances a game draws, which is a few hundred; anything beyond this is a caller
 *  generating seeds per frame, and the drop costs one allocation per sprite on one frame. */
const STREAM_LIMIT = 4096;

/** The snapshot handed to `Rng.restore`, reused. Its `seed` is always set to the stream's own,
 *  so the restore is in place and returns the same object. */
const REWIND = { seed: 0, state: 0 };

/**
 * A stream for `seed`, rewound to its start.
 *
 * @param salt distinguishes the hooks: `massing`, `animate` and `emit` each get their own
 *   stream from the same instance seed, so adding a draw to one cannot reshuffle another.
 */
function streamFor(seed: number, salt: number): Rng {
  const key = hashStep(seed >>> 0, salt) >>> 0;
  let stream = streams.get(key);
  if (stream === undefined) {
    stream = createRng(key);
    if (streams.size >= STREAM_LIMIT) streams.clear();
    streams.set(key, stream);
  }
  // `createRng` hashes the key, so the stream's own `seed` — not `key` — is its identity, and
  // a fresh stream is one whose cursor sits exactly there.
  REWIND.seed = stream.seed;
  REWIND.state = stream.seed;
  return stream.restore(REWIND);
}

/** Stream salts. Values, not order, so inserting a fourth hook later cannot move the other
 *  three and silently change every sprite in a shipped game. */
const SALT_MASSING = 0x9e37;
/** See {@link SALT_MASSING}. */
const SALT_ANIMATE = 0x85eb;
/** See {@link SALT_MASSING}. */
const SALT_EMIT = 0xc2b2;

/** The writable shape of `iso`'s `Volume`.
 *
 * `Volume`'s fields are all `readonly`, which documents that `iso` never writes one — but it is
 * declared as an out-parameter here, so something has to. TypeScript ignores `readonly` in
 * assignability, so the cast below is sound and a caller may still declare their scratch as a
 * plain `Volume`. It is the one place in this package that relies on that fact deliberately. */
interface WritableVolume {
  ox: number;
  oy: number;
  w: number;
  d: number;
  zPx: number;
  hPx: number;
}

/**
 * A writer bound to a pen: the consumer that actually draws.
 *
 * Mutable and pooled by call depth rather than allocated per sprite, because one of these per
 * building per frame is the allocation this whole package is shaped to avoid.
 */
class PenWriter implements SolidWriter {
  /** The frame being drawn into. Reassigned on every acquisition. */
  pen: Pen;
  /** Grid origin the sprite's local coordinates are relative to. */
  ox = 0;
  /** See {@link PenWriter.ox}. */
  oy = 0;
  /** When set, every fill becomes this color — the placement ghost's legality tint. */
  tint: Rgba | undefined = undefined;
  /**
   * Storeys added to every height: the **third component of the sprite's origin**, alongside
   * {@link PenWriter.ox} and `oy`.
   *
   * It carries two things at once, and they add rather than compete — the ground the sprite
   * stands on, converted once from `iso`'s pixels by {@link drawSprite}, and the ghost's clearance
   * above whatever it is being tested against.
   */
  lift = 0;
  /** Multiplied into every solid's own alpha. See `Surface.alpha`, which sets rather than
   *  composes, so the composition has to happen here. */
  fade = 1;

  /** A `BoxOpts` the writer owns, so overriding a color or a height costs no object. Handed
   *  straight to `isoBox`, which never retains it. */
  private readonly opts: {
    color: Ink;
    h: number;
    z: number;
    inset: number;
    outline: boolean;
    topColor: Ink | undefined;
    alpha: number | undefined;
  } = {
    color: 0,
    h: 0,
    z: 0,
    inset: 0,
    outline: true,
    topColor: undefined,
    alpha: undefined,
  };

  constructor(pen: Pen) {
    this.pen = pen;
  }

  get palette(): Palette {
    return this.pen.palette;
  }

  /** An optional ink, tinted if this writer is drawing a ghost. Three primitives take an
   *  optional stroke and all three need exactly this. */
  private paint(value: Ink | undefined): Ink | undefined {
    return value === undefined ? undefined : (this.tint ?? value);
  }

  /** Fill the owned `BoxOpts` from a caller's, applying the tint, the lift and the fade. */
  private rewrite(source: BoxOpts): BoxOpts {
    const o = this.opts;
    o.color = this.tint ?? source.color;
    o.h = source.h;
    o.z = (source.z ?? 0) + this.lift;
    o.inset = source.inset ?? 0;
    o.outline = source.outline !== false;
    o.topColor = this.tint === undefined ? source.topColor : this.tint;
    o.alpha =
      this.fade === 1 ? source.alpha : (source.alpha === undefined ? 1 : source.alpha) * this.fade;
    return o;
  }

  tile(gx: number, gy: number, fill: Ink, stroke?: Ink, inset = 0, z = 0): void {
    isoTile(
      this.pen,
      this.ox + gx,
      this.oy + gy,
      this.tint ?? fill,
      this.paint(stroke),
      inset,
      z + this.lift,
    );
  }

  box(gx: number, gy: number, w: number, d: number, opts: BoxOpts): void {
    isoBox(this.pen, this.ox + gx, this.oy + gy, w, d, this.rewrite(opts));
  }

  cylinder(gx: number, gy: number, radiusTiles: number, opts: BoxOpts): void {
    isoCylinder(this.pen, this.ox + gx, this.oy + gy, radiusTiles, this.rewrite(opts));
  }

  roof(
    gx: number,
    gy: number,
    w: number,
    d: number,
    z: number,
    rise: number,
    color: Ink,
    outline = true,
  ): void {
    isoRoof(
      this.pen,
      this.ox + gx,
      this.oy + gy,
      w,
      d,
      z + this.lift,
      rise,
      this.tint ?? color,
      outline,
    );
  }

  patch(gx: number, gy: number, w: number, d: number, z: number, fill: Ink, stroke?: Ink): void {
    isoPatch(
      this.pen,
      this.ox + gx,
      this.oy + gy,
      w,
      d,
      z + this.lift,
      this.tint ?? fill,
      this.paint(stroke),
    );
  }

  wall(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    z0: number,
    z1: number,
    fill: Ink,
    stroke?: Ink,
  ): void {
    isoWall(
      this.pen,
      this.ox + ax,
      this.oy + ay,
      this.ox + bx,
      this.oy + by,
      z0 + this.lift,
      z1 + this.lift,
      this.tint ?? fill,
      this.paint(stroke),
    );
  }

  post(gx: number, gy: number, z: number, h: number, color: Ink, width?: number): void {
    isoPost(this.pen, this.ox + gx, this.oy + gy, z + this.lift, h, this.tint ?? color, width);
  }

  glow(gx: number, gy: number, z: number, color: Ink, radius?: number, intensity?: number): void {
    glowDot(this.pen, this.ox + gx, this.oy + gy, z + this.lift, this.tint ?? color, radius, intensity);
  }

  sign(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ztop: number,
    heightLevels: number,
    value: string,
    color: Ink,
  ): void {
    wallText(
      this.pen,
      this.ox + ax,
      this.oy + ay,
      this.ox + bx,
      this.oy + by,
      ztop + this.lift,
      heightLevels,
      value,
      this.tint ?? color,
    );
  }

  shadow(gx: number, gy: number, w: number, d: number, strength?: number, z = 0): void {
    // A ghost casts no shadow: it is not there yet, and a shadow under a preview is the one
    // part of it that reads as real.
    if (this.tint !== undefined) return;
    contactShadow(this.pen, this.ox + gx, this.oy + gy, w, d, strength, z + this.lift);
  }
}

/**
 * A writer that draws nothing and unions what it was told about.
 *
 * This is what makes {@link spriteBounds}, {@link spriteVolume} and {@link spriteHeightPx}
 * derived from the massing rather than guessed. Without it every game re-derives a bounding box
 * from constants it copied out of a sprite definition, and the copy stops being true the day the
 * sprite grows a mast at level 3.
 */
class MeasureWriter implements SolidWriter {
  /** Grid-space extents, in tiles, relative to the footprint origin. */
  gx0 = 0;
  /** See {@link MeasureWriter.gx0}. */
  gy0 = 0;
  /** See {@link MeasureWriter.gx0}. */
  gx1 = 0;
  /** See {@link MeasureWriter.gx0}. */
  gy1 = 0;
  /** Elevation extents, in **world pixels** — the unit `iso` speaks. */
  z0 = 0;
  /** See {@link MeasureWriter.z0}. */
  z1 = 0;

  get palette(): Palette {
    return measurePalette();
  }

  /** Start again from a sprite's declared footprint, so a massing that draws nothing still
   *  measures as the tile it occupies rather than as a point. */
  reset(w: number, d: number): void {
    this.gx0 = 0;
    this.gy0 = 0;
    this.gx1 = w;
    this.gy1 = d;
    this.z0 = 0;
    this.z1 = 0;
  }

  /** Union one axis-aligned box, in tiles and world pixels. */
  private include(x0: number, y0: number, x1: number, y1: number, lo: number, hi: number): void {
    if (x0 < this.gx0) this.gx0 = x0;
    if (y0 < this.gy0) this.gy0 = y0;
    if (x1 > this.gx1) this.gx1 = x1;
    if (y1 > this.gy1) this.gy1 = y1;
    if (lo < this.z0) this.z0 = lo;
    if (hi > this.z1) this.z1 = hi;
  }

  tile(gx: number, gy: number, _fill: Ink, _stroke?: Ink, inset = 0, z = 0): void {
    this.patch(gx + inset, gy + inset, 1 - inset * 2, 1 - inset * 2, z);
  }

  box(gx: number, gy: number, w: number, d: number, opts: BoxOpts): void {
    const inset = opts.inset ?? 0;
    const base = levelsToPx(opts.z ?? 0);
    this.include(gx + inset, gy + inset, gx + w - inset, gy + d - inset, base, base + levelsToPx(opts.h));
  }

  cylinder(gx: number, gy: number, radiusTiles: number, opts: BoxOpts): void {
    const r = radiusTiles - (opts.inset ?? 0);
    const base = levelsToPx(opts.z ?? 0);
    this.include(gx - r, gy - r, gx + r, gy + r, base, base + levelsToPx(opts.h));
  }

  roof(gx: number, gy: number, w: number, d: number, z: number, rise: number): void {
    this.include(gx, gy, gx + w, gy + d, levelsToPx(z), levelsToPx(z + rise));
  }

  patch(gx: number, gy: number, w: number, d: number, z: number): void {
    const px = levelsToPx(z);
    this.include(gx, gy, gx + w, gy + d, px, px);
  }

  wall(ax: number, ay: number, bx: number, by: number, z0: number, z1: number): void {
    this.include(
      ax < bx ? ax : bx,
      ay < by ? ay : by,
      ax > bx ? ax : bx,
      ay > by ? ay : by,
      levelsToPx(z0 < z1 ? z0 : z1),
      levelsToPx(z0 > z1 ? z0 : z1),
    );
  }

  post(gx: number, gy: number, z: number, h: number): void {
    this.include(gx, gy, gx, gy, levelsToPx(z), levelsToPx(z + h));
  }

  glow(gx: number, gy: number, z: number, _color: Ink, radius = 0.12): void {
    // The halo reaches well past the fixture, and a bound that clipped it would frame a
    // thumbnail with the glow cut off at the edge.
    const reach = radius * 3;
    const px = levelsToPx(z);
    this.include(gx - reach, gy - reach, gx + reach, gy + reach, px - reach * HALF_W, px + reach * HALF_W);
  }

  sign(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ztop: number,
    heightLevels: number,
  ): void {
    this.wall(ax, ay, bx, by, ztop - heightLevels, ztop);
  }

  shadow(gx: number, gy: number, w: number, d: number, _strength?: number, z = 0): void {
    this.patch(gx, gy, w, d, z);
  }
}

/**
 * The palette a measuring replay sees.
 *
 * Built on first use rather than at module load, so a game that never measures a sprite never
 * pays for it, and so this module has no side effect at import.
 */
let measured: Palette | undefined;

/** See {@link measured}. */
function measurePalette(): Palette {
  if (measured === undefined) measured = createPalette(BASE_SLOTS);
  return measured;
}

/** Drawing writers, pooled by call depth: a sub-pen used inside a massing gets its own rather
 *  than overwriting the outer one's origin halfway through a building. */
const writers: PenWriter[] = [];

/** How deep the current `drawSprite` nesting is. See {@link writers}. */
let depth = 0;

/** The single measuring writer. Measuring never nests: nothing it does can call back into the
 *  kit, because it holds no pen and no surface. */
const measurer = new MeasureWriter();

/** Take a drawing writer at the current depth, configured for this sprite. */
function acquire(pen: Pen, gx: number, gy: number, tint: Rgba | undefined, lift: number, fade: number): PenWriter {
  let writer = writers[depth];
  if (writer === undefined) {
    writer = new PenWriter(pen);
    writers[depth] = writer;
  }
  writer.pen = pen;
  writer.ox = gx;
  writer.oy = gy;
  writer.tint = tint;
  writer.lift = lift;
  writer.fade = fade;
  depth += 1;
  return writer;
}

/**
 * Reject a ground elevation that would make a sprite silently absent.
 *
 * A `NaN` here propagates into every coordinate the sprite produces, and `NaN` paints nothing and
 * reports nothing: the building is simply not on the map, on one tile, on one seed, and the bug
 * report says the save did not load. The number arrives from a heightfield sampled at a position
 * a game computed, which is exactly the sort of chain that produces one.
 */
function expectFiniteGround(fn: string, zPx: number): void {
  if (!Number.isFinite(zPx)) {
    throw new RangeError(`${fn}: expected a finite ground elevation in world pixels, got ${String(zPx)}`);
  }
}

/** Replay a sprite's massing through the measuring writer. */
function measure(def: SpriteDef, v: Variant): MeasureWriter {
  measurer.reset(def.w, def.d);
  def.massing(measurer, v, streamFor(v.seed, SALT_MASSING));
  return measurer;
}

/**
 * Draw a sprite at a grid position.
 *
 * Runs `massing`, then `animate`, then `emit` — the last only when the frame has an *active*
 * light field, so a game in daylight pays nothing for a campus full of lamps.
 *
 * Each hook is handed its own freshly-rewound stream, derived from `v.seed`. Adding a draw to
 * one therefore cannot change what another sees, which is the difference between a sprite whose
 * art is stable across a refactor and one that has to be re-blessed after every edit.
 *
 * @param zPx The **ground elevation under the footprint**, in world pixels — `iso`'s unit, and
 *   usually `footprintBase(field, footprint)` or `heightAt(field, gx, gy)` straight from a
 *   heightfield. Default 0, which is a flat world and costs a game with one nothing.
 *
 *   This is the one place a sprite's ground crosses from pixels into storeys, and it is the whole
 *   of the crossing: the massing is drawn from it, the contact shadow lands on it, and `animate`
 *   and `emit` are handed the original pixels. Leave it out on a heightfield and every sprite
 *   floats or sinks by its own terrain height — which reads as *the art is wrong*, sprite by
 *   sprite, rather than as one missing argument.
 * @throws RangeError if `zPx` is not finite.
 */
export function drawSprite(
  pen: Pen,
  def: SpriteDef,
  gx: number,
  gy: number,
  v: Variant,
  zPx = 0,
): void {
  expectFiniteGround('drawSprite', zPx);
  const writer = acquire(pen, gx, gy, undefined, pxToLevels(zPx), 1);
  try {
    def.massing(writer, v, streamFor(v.seed, SALT_MASSING));
  } finally {
    depth -= 1;
  }
  if (def.animate !== undefined) def.animate(pen, gx, gy, v, streamFor(v.seed, SALT_ANIMATE), zPx);
  const light = pen.light;
  if (def.emit !== undefined && light !== undefined && light.active) {
    def.emit(light, gx, gy, v, streamFor(v.seed, SALT_EMIT), zPx);
  }
}

/**
 * A translucent preview during placement, tinted by legality: the `ok` slot means it will land,
 * `bad` means it will not.
 *
 * Drawn *under* the cursor, never as one — on touch a finger covers a cursor exactly, and a
 * placement affordance the player's own hand hides is not an affordance.
 *
 * It runs `massing` alone. A ghost that blinked would be indistinguishable from a building that
 * is already there, and a ghost that lit the valley would let a player survey the map by
 * dragging a lamp around it.
 *
 * @param zPx The ground under the tile being tested, in world pixels. See {@link drawSprite}.
 *   A ghost that ignored it would sit at sea level while the tile it is testing is up a hill,
 *   and the player would judge the fit of a building against ground it will not stand on.
 * @throws RangeError if `zPx` is not finite.
 */
export function drawGhost(
  pen: Pen,
  def: SpriteDef,
  gx: number,
  gy: number,
  v: Variant,
  legal: boolean,
  zPx = 0,
): void {
  expectFiniteGround('drawGhost', zPx);
  const tint = pen.palette.get(legal ? 'ok' : 'bad');
  const writer = acquire(pen, gx, gy, tint, GHOST_LIFT + pxToLevels(zPx), GHOST_ALPHA);
  const previous = pen.surface.alpha(GHOST_ALPHA);
  try {
    def.massing(writer, v, streamFor(v.seed, SALT_MASSING));
  } finally {
    depth -= 1;
    pen.surface.alpha(previous);
  }
}

/**
 * The marching-ant footprint rectangle on its own — selection rims, build sites, ranges.
 *
 * The dash marches off `pen.t`, which is the frame's clock and arrived as a parameter, so two
 * replays of the same session put the ants in the same place.
 *
 * `z` defaults to `SELECT_LIFT` rather than 0: a rim drawn at ground level z-fights the tile
 * beneath it at some zooms and not others, which looks like a hardware fault.
 *
 * @param z Clearance above the ground, in storeys. The z-fight ladder, not an elevation.
 * @param groundPx The ground the rim lies on, in world pixels. The two are separate because they
 *   are separate facts in separate units: one is `iso`'s terrain and one is this package's
 *   anti-flicker constant, and adding them at the call site is how `SELECT_LIFT` ends up
 *   multiplied by a height.
 * @throws RangeError if `groundPx` is not finite.
 */
export function drawFootprint(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  color: Ink,
  z = SELECT_LIFT,
  groundPx = 0,
): void {
  expectFiniteGround('drawFootprint', groundPx);
  const zPx = levelsToPx(z) + groundPx;
  let at = put(pen, 0, gx, gy, zPx);
  at = put(pen, at, gx + w, gy, zPx);
  at = put(pen, at, gx + w, gy + d, zPx);
  put(pen, at, gx, gy + d, zPx);
  pen.surface.stroke(
    pen.xy,
    4,
    true,
    pen.palette.ink(color),
    1,
    ANT_DASH,
    -((pen.t * ANT_SPEED) % (ANT_DASH * 2)),
  );
}

/**
 * The sprite's massing as an `iso.Volume`, in world pixels — the picking half of the seam.
 *
 * A game picks by handing `pickSorted` a test of its own, and that test wants
 * `boxSilhouette(camera, gx, gy, volume, out)` + `pointInPolygon`, so the player hits the shape
 * they can see rather than a footprint rectangle they cannot. **This is the function that
 * produces the volume** — nobody else can, because the massing is the only thing that knows how
 * tall the sprite actually built itself. It performs the storey → `zPx` conversion, so a caller
 * never does and a `Volume` built in storeys — which makes picking wrong only near a roof, where
 * nobody can characterise it — cannot happen.
 *
 * ```ts
 * function hitsSilhouette(index: number): boolean {   // hoisted, allocated once
 *   const b = buildings[index];
 *   if (b === undefined) return false;
 *   spriteVolume(b.def, b.v, vol);
 *   boxSilhouette(camera, b.gx, b.gy, vol, sil);
 *   return pointInPolygon(px, py, sil, 6);
 * }
 * const hit = pickSorted(order, hitsSilhouette);
 * ```
 *
 * @param zPx The ground under the footprint, in world pixels — the same number
 *   {@link drawSprite} was given. It is **added in pixels and never converted**, so the volume
 *   handed to `boxSilhouette` is exactly the elevation `iso` produced rather than a storey count
 *   multiplied back out. Omit it on a heightfield and the silhouette is computed at sea level
 *   while the building is painted up the hill: the picture is right, the taps land in mid-air,
 *   and both packages' suites stay green.
 * @throws RangeError if `zPx` is not finite.
 */
export function spriteVolume(def: SpriteDef, v: Variant, out: Volume, zPx = 0): Volume {
  expectFiniteGround('spriteVolume', zPx);
  const m = measure(def, v);
  // `Volume`'s fields are `readonly` because `iso` never writes one; this function does, and
  // TypeScript ignores `readonly` in assignability, so the cast is sound rather than clever.
  const w = out as WritableVolume;
  w.ox = m.gx0;
  w.oy = m.gy0;
  w.w = m.gx1 - m.gx0;
  w.d = m.gy1 - m.gy0;
  w.zPx = m.z0 + zPx;
  w.hPx = m.z1 - m.z0;
  return out;
}

/**
 * The sprite's total height in world pixels — what `DepthSorter.add` wants for culling.
 *
 * Under-declare it and roofs pop in along the top edge of the screen; over-declare it and a few
 * off-screen items are drawn for nothing. Derived from the massing rather than guessed, which is
 * the only way it stays right when a sprite grows a mast at level 3.
 *
 * **Measured from the sprite's own base, and it takes no ground**, because it is a height and not
 * a position: on a heightfield the caller adds the terrain under the footprint —
 * `order.add(gx, gy, w, d, groundPx + spriteHeightPx(def, v))` — which is the same sum
 * {@link spriteVolume} makes internally, in the same unit, from the same two numbers.
 */
export function spriteHeightPx(def: SpriteDef, v: Variant): number {
  return measure(def, v).z1;
}

/**
 * Screen-space bounds of a sprite, into `iso`'s `Rect`.
 *
 * How a thumbnail frames a subject it has never seen, and how `input` picks a *building* rather
 * than a tile without re-deriving a bounding box from constants copied out of a sprite
 * definition.
 *
 * Conservative by construction: it is the axis-aligned box around the six silhouette points of
 * the whole massing, so it never clips and may be a little generous around an L-shaped building.
 * Generous is the correct direction — a tight bound that is occasionally wrong crops a thumbnail
 * and nobody can say which sprite will do it.
 *
 * @param zPx The ground under the footprint, in world pixels. Added in pixels, for the reason
 *   {@link spriteVolume} gives. A label or a bubble anchored to a bound computed at sea level
 *   drifts further from its building the higher the building stands.
 * @throws RangeError if `zPx` is not finite.
 */
export function spriteBounds(
  def: SpriteDef,
  v: Variant,
  camera: Camera,
  gx: number,
  gy: number,
  out: Rect,
  zPx = 0,
): Rect {
  expectFiniteGround('spriteBounds', zPx);
  const m = measure(def, v);
  const nx = gx + m.gx0;
  const ny = gy + m.gy0;
  const fx = gx + m.gx1;
  const fy = gy + m.gy1;

  const xEast = camera.toScreenX((fx - ny) * HALF_W);
  const xWest = camera.toScreenX((nx - fy) * HALF_W);
  // North and south are between east and west on the x axis for any rectangle, so the extremes
  // in x are exactly these two and the other two corners need no projection at all.
  const yTop = camera.toScreenY((nx + ny) * HALF_H - m.z1 - zPx);
  const yBottom = camera.toScreenY((fx + fy) * HALF_H - m.z0 - zPx);

  out.minX = xWest;
  out.maxX = xEast;
  out.minY = yTop;
  out.maxY = yBottom;
  return out;
}
