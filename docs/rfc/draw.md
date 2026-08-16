# RFC — `@lattice/draw`

| | |
|---|---|
| **status** | proposed (cycle 1, task A3) |
| **package** | `@lattice/draw` |
| **depends on** | `@lattice/core`, `@lattice/iso` |
| **environment** | browser for the Canvas2D backend; the rest runs unchanged in Node |
| **budget** | 12 KB gzipped, ≤ 8 ms frame |

---

## 1. The one sentence

**`@lattice/draw` turns one colour and one grid footprint into a stylised isometric solid on
a surface it does not own** — so the same code paints the world, a shop thumbnail, and a
golden test, and a WebGL backend can replace the Canvas2D one without a sprite noticing.

The two halves of that sentence are the two things this package is for. *One colour* is the
art direction: three-tone faces derived from a single hex, cool shadows, warm highlights, a
silhouette stroke on everything. *A surface it does not own* is the engineering: nothing in
this package, and nothing above it, ever holds a `CanvasRenderingContext2D`.

---

## 2. The five-line example

This is written before the API, and the API below exists to serve it.

```ts
import { beginFrame, createCanvas2dSurface, endFrame, isoBox, isoTile } from '@lattice/draw';

const surface = createCanvas2dSurface(canvasEl);
const pen = beginFrame(surface, camera, palette, t, 'sky');
isoTile(pen, 4, 7, 'ground');
isoBox(pen, 4, 7, 2, 2, { color: 'brand', h: 3 });
endFrame(pen);
```

Five lines, and every design decision in section 3 falls out of them:

| the line says | so the API must |
|---|---|
| `createCanvas2dSurface(canvasEl)` | put the backend behind a factory, and never behind an inherited class the caller must subclass |
| `beginFrame(surface, camera, …)` | bundle surface + camera + palette + clock into one `Pen` passed first, so a solid takes seven numbers rather than nine |
| `isoTile(pen, …)`, not `pen.tile(…)` | free functions, so a game that draws boxes and nothing else ships boxes and nothing else |
| `'ground'`, `'brand'` | colours are **palette slots resolved at draw time**, which is the whole recolour-the-campus story, and the reason a cache key has to carry a palette revision |
| `{ color, h }` — one colour, a height | faces are *derived*, never given. There is no `leftColor`. Offering one is offering the caller a way to break the look |
| `t` on the pen | the animation clock is a parameter. There is no clock inside this package, by constitution |

Two more shapes matter enough to show, because they are what stop a game from forking the
kit. **Composition** — a game defines a building without touching kit source:

```ts
export const WATER_TOWER = defineSprite({
  id: 'water-tower',
  w: 2,
  d: 2,
  // Static art. Runs on a cache miss only, so it may be as expensive as it likes.
  massing(s, v, rng) {
    s.shadow(0, 0, 2, 2);
    for (let i = 0; i < 4; i++) s.post(0.3 + i * 0.5, 0.3, 0, 3, 'metal');
    s.cylinder(1, 1, 0.8, { color: 'brand', h: 1.4, z: 3 });
    if (v.level > 2) s.sign(0, 0, 2, 0, 4.4, 0.6, v.label, 'ink');
    if (rng.float() > 0.5) s.post(1, 1, 4.4, 1, 'metal');
  },
  // Live art, over the cached image, every frame. A handful of primitives, no more.
  animate(pen, gx, gy, v, rng) {
    const blink = (pen.t * 1.4 + rng.float()) % 1 < 0.5 ? 1 : 0.2;
    glowDot(pen, gx + 1, gy + 1, 5.4, 'warn', 1.6, blink);
  },
});
```

And a **golden test**, in Node, with no canvas anywhere:

```ts
const rec = createRecordingSurface(320, 200, 1);
const pen = beginFrame(rec, camera, palette, 0, 'sky');
drawSprite(pen, WATER_TOWER, 0, 0, VARIANT_ZERO);
endFrame(pen);
expect(rec.digest()).toBe('…'); // and rec.ops is readable when it does not
```

---

## 3. The full public surface

### 3.0 The module map, and where it differs from `kit.json`

`kit.json` declares nine modules. I am proposing eleven. The two additions are not scope
creep; each one is a constitution rule that the nine-module list violates.

| module | what is in it | change |
|---|---|---|
| `surface` | `Surface`, `RenderTarget`, `Bitmap`, `TextStyle`, `Pen`, `beginFrame` | — |
| `canvas2d` | the browser backend | — |
| **`record`** | the headless recording backend | **added** |
| `color` | packed RGBA, `shade`, `outlineOf`, face constants | — |
| `palette` | named slots, `rev` | — |
| `solids` | the eight iso primitives | — |
| **`sprite`** | `SpriteDef`, `SolidWriter`, `drawSprite`, `drawGhost`, `spriteBounds` | **added** |
| `shadow` | contact shadow, full-frame wash | — |
| `text` | wall text and screen text | — |
| `layers` | the six passes and the depth-sorted draw list | — |
| `cache` | the sprite bitmap cache | — |

**Why `record` is its own module.** Constitution rule 4: a module that touches the DOM says
so in its first doc line, and everything else runs unchanged in Node. The headless backend
is the one thing in this package a Node test *must* be able to import, and putting it in
`canvas2d.ts` drags `HTMLCanvasElement` into that import. It is also not a test helper —
`ui` will want it for layout measurement without a canvas — so it belongs in `src/`, not
`test/`.

**Why `sprite` is its own module.** `kit.json` has a home for primitives (`solids`) and a
home for bitmaps (`cache`) and no home at all for the thing in between: *how a game composes
primitives into a building it owns*. That is the single most important question this package
answers, and leaving it homeless is how it ends up hand-written per game, which is what the
source game did. See 3.7.

### 3.1 Types borrowed from below

These are declared here so this section compiles standalone, and so the `iso` builder can
see exactly what `draw` needs. **The output-parameter forms are an ask, not an assumption**
— see "Asks of other packages" at the end.

```ts
/** From @lattice/core. */
export interface Rng {
  u32(): number;
  float(): number;
}

/** From @lattice/iso — the subset @lattice/draw depends on, and no more. */
export interface Camera {
  readonly zoom: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly x: number;
  readonly y: number;
  /**
   * World → screen, written into `out[0]`, `out[1]`.
   *
   * Output-parameter form because this is called six to nine times per solid per frame.
   * A returned `{ x, y }` here is four hundred buildings' worth of garbage a second.
   */
  toScreen(wx: number, wy: number, out: Float64Array): void;
}

/** From @lattice/iso. Grid coordinate → screen pixel, lifted by `z` height levels. */
export declare function gridToScreen(
  cam: Camera,
  gx: number,
  gy: number,
  z: number,
  out: Float64Array,
): void;
```

### 3.2 `color` — one colour in, three faces out

```ts
/**
 * A colour packed as `0xRRGGBBAA` in a uint32.
 *
 * Not a CSS string. `shade()` in the source game returned `rgb(12,34,56)`, which meant
 * three fresh strings per box per frame — the largest single source of garbage in the
 * renderer, and invisible in a profile because strings die young. Packed integers compare
 * with `===`, key a Map with no hashing, and hand a WebGL backend its vertex colour with
 * two shifts. `cssOf()` exists solely inside the Canvas2D backend and memoises.
 *
 * Always store unsigned: `rgba()` returns `>>> 0`, so `0xff0000ff` is 4278190335, never -255.
 */
export type Rgba = number;

/**
 * A colour, or the name of a palette slot resolved at draw time.
 *
 * A slot name is what lets one campus recolour to a player's brand, and it is why a cache
 * key must carry `Palette.rev` — see 3.9. Passing an unknown slot throws naming the slot
 * and listing the ones that exist; a silent black is a bug report that says "the game
 * looks wrong".
 */
export type Ink = Rgba | string;

/** Channel values are clamped to 0–255 and rounded. `a` defaults to fully opaque. */
export declare function rgba(r: number, g: number, b: number, a?: number): Rgba;

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa`. Memoised; authoring-time only, never per frame. */
export declare function hex(css: string): Rgba;

/**
 * Derive a face colour from a base colour — the rule the whole look rests on.
 *
 * `factor` below 1 darkens *and* pulls toward {@link SHADE_TINT}; above 1 brightens and
 * pulls toward {@link LIGHT_TINT}. Tint strength scales with distance from neutral, so
 * `shade(c, 1) === c` exactly and nothing drifts by accident.
 *
 * Shading toward blue in shadow and amber in light is what separates a stylised render
 * from a flat grey lerp. Replace it with a plain multiply and the kit's art dies quietly:
 * every screenshot still renders, and every screenshot looks like a placeholder.
 */
export declare function shade(base: Rgba, factor: number): Rgba;

/** The silhouette stroke for a solid: its own hue, very dark, never pure black. */
export declare function outlineOf(base: Rgba): Rgba;

/** Replace the alpha channel. `a` is 0–1; the rgb channels are untouched. */
export declare function withAlpha(color: Rgba, a: number): Rgba;

/** Linear per-channel blend in sRGB bytes. Deliberately not perceptual — see section 4. */
export declare function mix(a: Rgba, b: Rgba, t: number): Rgba;

/** Packed colour → a CSS colour string, memoised. Backends only; not for game code. */
export declare function cssOf(color: Rgba): string;

/** Relative brightness of each visible face. The sun sits high and front-left. */
export declare const FACE_TOP: 1;
export declare const FACE_LEFT: 0.74;
export declare const FACE_RIGHT: 0.52;

/** Cool target shadowed surfaces drift toward. The whole trick, in one constant. */
export declare const SHADE_TINT: Rgba;
/** Warm target lit surfaces drift toward. */
export declare const LIGHT_TINT: Rgba;
```

### 3.3 `surface` — the seam, and how narrow it has to be

The brief's hardest question: *what is the minimum a WebGL backend could honestly
implement?* The answer is the list below, and the test I applied to every candidate method
was **"could a competent WebGL backend implement this in under fifty lines, without lying?"**
Bezier paths fail it. Clipping fails it. `globalCompositeOperation` fails it. What survives
is convex polygons, polylines, ellipses, text, and a render target.

Every coordinate on this interface is in **CSS pixels**. Device-pixel-ratio is entirely the
backend's business, and that is not a convenience — it is the fix for a real bug (trap 7).

```ts
export type SurfaceKind = 'canvas2d' | 'recording';

/**
 * A text run's appearance. Passed per call because a font left set on a 2D context is the
 * classic Canvas2D state leak: the next caller inherits it and no one can find out why.
 *
 * `align` and `baseline` are -1 | 0 | 1 (start | centre | end) rather than strings, so a
 * backend switches on a number and a golden log records an integer.
 */
export interface TextStyle {
  readonly size: number;
  readonly weight: number;
  readonly family: string;
  readonly align: -1 | 0 | 1;
  readonly baseline: -1 | 0 | 1;
}

/**
 * An image the kit rendered itself. Opaque: a canvas element, a GPU texture, or an op log.
 *
 * There is no way to construct one from a URL or a file, and that is rule 8 (zero assets)
 * expressed in the type system rather than in a lint.
 */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  /** Approximate resident bytes. The cache budgets on this, so a backend must not fake it. */
  readonly bytes: number;
  dispose(): void;
}

/**
 * Everything a backend must provide. Eleven methods, and each one earns its place by being
 * something an isometric solid genuinely needs and a WebGL backend can genuinely honour.
 */
export interface Surface {
  readonly kind: SurfaceKind;
  /** CSS pixels. Never device pixels — see `pixelRatio`. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel. Read-only to callers; the backend applies it internally. */
  readonly pixelRatio: number;

  resize(width: number, height: number, pixelRatio: number): void;

  /**
   * Start a frame and paint `clear` over the whole surface.
   *
   * `begin` resets every piece of backend state — alpha, dash, font — so a frame can never
   * inherit the previous frame's leak. Pass `0` (transparent) to keep what is there.
   */
  begin(clear: Rgba): void;

  /** Finish the frame. A backend that batches flushes here; Canvas2D does nothing. */
  end(): void;

  /**
   * Fill a **convex** polygon given as `count` xy pairs from the start of `xy`.
   *
   * Convex is the contract, not an optimisation: it is what lets a GPU backend fan-
   * triangulate in place with no tessellation library. Every face of every iso solid in
   * this kit is convex; if a shape is not, the sprite author splits it, because they know
   * how and a general tessellator does not.
   */
  poly(xy: Float64Array, count: number, fill: Rgba): void;

  /**
   * Fill a convex polygon with a linear colour ramp along the screen-space segment
   * `(x0,y0) → (x1,y1)`.
   *
   * Two stops, no gradient object. This is the cylinder body and the sky backdrop, and it
   * is per-vertex colour on a GPU. A `createLinearGradient`-shaped API would allocate an
   * object per cylinder per frame and hand WebGL something it cannot honour.
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
   * `dash` and `dashOffset` are per call and not state. Marching ants on a placement ghost
   * are the one place the kit needs a dash, and a dash pattern left set on a shared context
   * is the bug that draws every subsequent outline dotted.
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
   * An ellipse with a radial falloff from `inner` at the centre to `outer` at the rim.
   *
   * The single most load-bearing call in the kit's look: it is the contact shadow that
   * grounds a building, and it is the halo on a glow dot. Given as a primitive rather than
   * as a gradient object because a gradient object is an allocation per shadow per frame
   * (the source game made one) and because on a GPU this is one quad and a ramp texture.
   */
  softEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    inner: Rgba,
    outer: Rgba,
  ): void;

  /**
   * Draw a text run, optionally through a 2×3 affine transform `[a,b,c,d,e,f]`.
   *
   * The transform argument exists **only** because text on a vertical face has to shear
   * into the isometric plane, and it is deliberately not a transform stack: the solids are
   * already computed in screen space, so nothing else in this package wants one. See 3.8
   * and trap 8 for the two ways this goes wrong.
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
   * Backends disagree here and are allowed to: the recording backend has no fonts and
   * estimates (see {@link ESTIMATED_ADVANCE_RATIO}). A golden test may assert that text was
   * shrunk to fit; it may not assert where a glyph landed.
   */
  measure(value: string, style: TextStyle): number;

  /**
   * Multiply the alpha applied to every subsequent call, and return the previous value.
   *
   * `const prev = s.alpha(0.34); …; s.alpha(prev);` — a save/restore with no stack, no
   * object, and no way to leave one unbalanced across a frame boundary, because `begin()`
   * resets it to 1 regardless.
   */
  alpha(multiplier: number): number;

  /**
   * Draw a bitmap this kit produced. The only way an image reaches the screen.
   *
   * Implementations must snap `dx`/`dy` to whole device pixels — see trap 10.
   */
  blit(source: Bitmap, dx: number, dy: number, dw: number, dh: number): void;

  /**
   * A sibling surface that renders into memory: an offscreen canvas, an FBO, a nested log.
   *
   * This is what makes thumbnails, the sprite cache and golden tests one mechanism instead
   * of three, and it is why `Surface` is an interface rather than a class.
   */
  createTarget(width: number, height: number): RenderTarget;
}

export interface RenderTarget extends Surface {
  /** The finished image. Valid only after `end()`; reading it before is undefined. */
  readonly bitmap: Bitmap;
}
```

**The `Pen`** — a frame's worth of context, so a primitive takes coordinates and not
plumbing.

```ts
export interface Pen {
  readonly surface: Surface;
  readonly camera: Camera;
  readonly palette: Palette;
  /** Seconds since the session began. The only clock in this package, and it arrives here. */
  readonly t: number;
  /**
   * Scratch vertex buffer, owned by the pen and reused by every primitive on it.
   *
   * This is the anti-garbage mechanism, stated as a field so a builder cannot miss it: a
   * box computes seven corners into `xy` and hands `(xy, 7)` to the surface. The source
   * game's `pt()` returned `{x, y}` per corner — seven objects per box per frame, four
   * hundred buildings, sixty times a second. Never retain a reference to this array.
   */
  readonly xy: Float64Array;
}

/** One `Pen` is allocated per frame. That is the package's entire per-frame allocation. */
export declare function beginFrame(
  surface: Surface,
  camera: Camera,
  palette: Palette,
  t: number,
  clear?: Ink,
): Pen;

export declare function endFrame(pen: Pen): void;

/**
 * A pen onto a different surface and camera, sharing this one's palette and clock.
 *
 * How a thumbnail, a cache fill and a minimap are drawn by exactly the code that draws the
 * world. Gets its own scratch buffer, so a sub-pen may be used inside a draw call.
 */
export declare function subPen(pen: Pen, surface: Surface, camera: Camera): Pen;
```

### 3.4 `canvas2d` — the browser backend

> First doc line of the module: *touches the DOM.*

```ts
export interface Canvas2dOpts {
  /** Override the device pixel ratio. Tests and thumbnails pin it to 1. */
  readonly pixelRatio?: number;
  /** Clamp for `devicePixelRatio`. Defaults to 2: a 3× phone costs 2.25× the fill for nothing. */
  readonly maxPixelRatio?: number;
  /** `false` lets the compositor skip a blend. Defaults to false — the kit always clears. */
  readonly alpha?: boolean;
}

/**
 * Wrap a canvas element. Sizes the backing store from `clientWidth/Height × pixelRatio` and
 * re-applies that on `resize`; callers work in CSS pixels and never see the ratio.
 */
export declare function createCanvas2dSurface(
  canvas: HTMLCanvasElement,
  opts?: Canvas2dOpts,
): Surface;

/**
 * A detached surface of a fixed size — the one `ui` needs for shop thumbnails.
 *
 * Uses `OffscreenCanvas` where it exists and a detached `<canvas>` where it does not, and
 * the difference is not visible through `Surface`.
 */
export declare function createOffscreenSurface(
  width: number,
  height: number,
  pixelRatio?: number,
): Surface;
```

### 3.5 `record` — the headless backend

> First doc line of the module: *no DOM, no canvas, runs in Node.*

The brief's fourth question: *what does the test backend record?* **Draw commands, not
pixels.** A rasteriser in Node would need a font stack, an antialiasing policy and about
2 KB of budget to produce an image whose diff says "412 pixels changed". A command log says
`poly[2].fill: 0xc9553fff → 0xc95540ff`, which is a bug report. Pixel-exactness is not what
golden tests here are protecting; *the shape of the draw* is.

```ts
export type OpName =
  | 'clear' | 'poly' | 'polyRamp' | 'stroke'
  | 'ellipse' | 'softEllipse' | 'text' | 'blit' | 'alpha';

/**
 * One recorded call. Rounded to 3 decimal places on the way in, because a golden that
 * fails on the last bit of a float is a golden everyone learns to re-bless without reading.
 */
export interface Op {
  readonly op: OpName;
  readonly xy: readonly number[];
  readonly colors: readonly Rgba[];
  /** The scalar the op carries: stroke width, alpha multiplier, blit width. */
  readonly value: number;
  /** Empty except for `text`. */
  readonly text: string;
}

export interface RecordingSurface extends Surface {
  readonly kind: 'recording';
  /**
   * Every call since the last `reset()`, in order. Readable in a test failure — this is the
   * one place in the kit permitted to allocate freely, because it never runs in a frame.
   */
  readonly ops: readonly Op[];
  /**
   * A stable hash of `ops`. The value a golden file stores.
   *
   * `createTarget()` on a recording surface returns another recording surface, and its
   * digest is what the parent's `blit` op records — so a cached sprite's contents are
   * covered by the parent's digest rather than vanishing behind an opaque image.
   */
  digest(): string;
  reset(): void;
}

export declare function createRecordingSurface(
  width: number,
  height: number,
  pixelRatio?: number,
): RecordingSurface;

/**
 * Advance width per point of font size, used by `measure()` where there are no fonts.
 *
 * Public because it is the reason a wall sign's shrink-to-fit lands differently in Node
 * than in Chrome, and a test author who does not know that will write a flaky golden.
 */
export declare const ESTIMATED_ADVANCE_RATIO: 0.55;
```

### 3.6 `palette` — named colour, and the revision that keeps a cache honest

```ts
export interface Palette {
  /**
   * Bumped on every `set()`.
   *
   * Part of every sprite cache key, and the single reason a recoloured campus cannot render
   * stale. A cache keyed on `(sprite, level, zoom)` alone will happily blit yesterday's
   * brand colour forever, and the player will file it as "the rebrand did not apply".
   */
  readonly rev: number;
  /** Throws a `RangeError` naming the slot and listing the known ones if it is absent. */
  get(slot: string): Rgba;
  set(slot: string, color: Rgba): void;
  has(slot: string): boolean;
  /** Resolve an {@link Ink}: a number passes through untouched, a string is a slot lookup. */
  ink(value: Ink): Rgba;
  keys(): readonly string[];
}

export declare function createPalette(slots: Readonly<Record<string, Rgba>>): Palette;

/**
 * The slots the kit itself draws with, so `createPalette(BASE_SLOTS)` is a working game.
 *
 * `sky`, `ground`, `ink`, `brand`, `metal`, `glass`, `warn`, `ok`, `bad`, `night`. A game
 * adds its own freely; the kit never adds one at runtime, so a missing slot is always the
 * caller's spelling and the error can say so.
 */
export declare const BASE_SLOTS: Readonly<Record<string, Rgba>>;
```

### 3.7 `solids` and `sprite` — the composition story

The brief's second question: *how does a game define its own building without forking the
kit?* The source game's answer was one hand-written function per building type in kit
source, which is a fork by construction.

The answer here is a **`SolidWriter`: an emitter a game writes its massing against once, and
which the kit replays through three different consumers.** Not a data schema (a `Solid[]`
array is serialisable but cannot express "four posts in a loop, and a mast only above level
2" without growing a small interpreter). Not a bare draw callback either (a callback can be
drawn and nothing else). An emitter is written like code, and is still replayable:

| replayed through | gives you |
|---|---|
| a writer bound to a `Pen` | the building, drawn |
| a writer bound to a `RenderTarget` | the cached bitmap, and the shop thumbnail |
| a writer that only unions corners | `spriteBounds` — the screen AABB, for hit-testing and thumbnail framing, for free |

And the seam that splits the sprite in two — `massing` (static, cacheable) versus `animate`
(live, cheap) — is what makes the cache tractable at all. It also enforces rule three of the
source game's art direction structurally: *something moves on every building*, in a slot
that is named and separate, rather than as a thing you remember to add.

```ts
/**
 * The instance facts the static art may depend on — and therefore everything in the cache
 * key. `massing` receives this and nothing else, which is what makes staleness impossible
 * rather than unlikely: there is no channel through which unkeyed state can reach the art.
 */
export interface Variant {
  /** Upgrade level. Massing may branch on it; it is in the key. */
  readonly level: number;
  /** Per-instance determinism. Seeds the `Rng` the kit hands to `massing` and `animate`. */
  readonly seed: number;
  /** Bitfield — see `FLAG_*`. Anything boolean about an instance goes here, not in a closure. */
  readonly flags: number;
  /** 0–1 construction progress. Quantised to 1/16 in the key, so a build is 16 renders. */
  readonly progress: number;
  /** Instance text — a company name on a roof sign. Empty string when unused, never absent. */
  readonly label: string;
}

/** `{ level: 1, seed: 0, flags: FLAG_POWERED, progress: 1, label: '' }`. */
export declare const VARIANT_ZERO: Variant;

export declare const FLAG_POWERED: 1;
export declare const FLAG_BUILDING: 2;
export declare const FLAG_SELECTED: 4;
export declare const FLAG_GHOST: 8;

/**
 * The emitter a game's massing is written against.
 *
 * One method per solid, same arguments as the free functions in `solids` minus the pen —
 * because the writer may not be drawing. Nothing here reads back, returns geometry, or
 * exposes the surface: a massing function that could reach the surface could defeat both
 * the cache and the WebGL seam in one line.
 */
export interface SolidWriter {
  readonly palette: Palette;
  tile(gx: number, gy: number, fill: Ink, stroke?: Ink, inset?: number, z?: number): void;
  box(gx: number, gy: number, w: number, d: number, opts: BoxOpts): void;
  cylinder(gx: number, gy: number, radiusTiles: number, opts: BoxOpts): void;
  roof(
    gx: number, gy: number, w: number, d: number,
    z: number, rise: number, color: Ink, outline?: boolean,
  ): void;
  patch(gx: number, gy: number, w: number, d: number, z: number, fill: Ink, stroke?: Ink): void;
  wall(
    ax: number, ay: number, bx: number, by: number,
    z0: number, z1: number, fill: Ink, stroke?: Ink,
  ): void;
  post(gx: number, gy: number, z: number, h: number, color: Ink, width?: number): void;
  glow(gx: number, gy: number, z: number, color: Ink, radius?: number, intensity?: number): void;
  sign(
    ax: number, ay: number, bx: number, by: number,
    ztop: number, heightTiles: number, value: string, color: Ink,
  ): void;
  shadow(gx: number, gy: number, w: number, d: number, strength?: number): void;
}

/**
 * Static art. Coordinates are **relative to the footprint origin**, so a sprite is drawn
 * anywhere without knowing where.
 *
 * `rng` is freshly seeded from `v.seed` on every call, by the kit. That is determinism made
 * structural: a massing function has no way to obtain an unseeded random number, so a rack
 * cannot reshuffle its LEDs on reload, and a replay from a seed lands on the same pixel.
 */
export type Massing = (w: SolidWriter, v: Variant, rng: Rng) => void;

/** Live art over the cached image. Same fresh-seeded `rng`; `pen.t` is the only clock. */
export type Animator = (pen: Pen, gx: number, gy: number, v: Variant, rng: Rng) => void;

export interface SpriteDef {
  /** Stable across releases: it is hashed into every cache key and every golden file. */
  readonly id: string;
  /** Footprint in tiles. Must match the game's own footprint or the shadow lands wrong. */
  readonly w: number;
  readonly d: number;
  readonly massing: Massing;
  readonly animate?: Animator;
}

/** Identity at runtime; exists to give a sprite literal a contextual type at the call site. */
export declare function defineSprite(def: SpriteDef): SpriteDef;

/**
 * Draw a sprite at a grid position. With a `cache`, blits when it can and fills when it
 * should; without one, always draws direct. The two paths must produce identical pixels.
 */
export declare function drawSprite(
  pen: Pen,
  def: SpriteDef,
  gx: number,
  gy: number,
  v: Variant,
  cache?: SpriteCache,
): void;

/**
 * A translucent preview during placement, tinted by legality: the `ok` slot means it will
 * land, `bad` means it will not.
 *
 * Drawn *under* the cursor, never as one — on touch, a finger covers a cursor exactly, and
 * a placement affordance the player's own hand hides is not an affordance.
 */
export declare function drawGhost(
  pen: Pen,
  def: SpriteDef,
  gx: number,
  gy: number,
  v: Variant,
  legal: boolean,
): void;

/** The marching-ant footprint rectangle on its own — selection rims, build sites, ranges. */
export declare function drawFootprint(
  pen: Pen,
  gx: number,
  gy: number,
  w: number,
  d: number,
  color: Ink,
  z?: number,
): void;

/**
 * Screen-space bounds of a sprite as `[minX, minY, maxX, maxY]` in `out`.
 *
 * Replays the massing through a measuring writer. This is how `input` hit-tests a building
 * rather than a tile, and how a thumbnail frames a subject it has never seen — without it,
 * every game re-derives a bounding box from constants it copied out of the sprite.
 */
export declare function spriteBounds(
  def: SpriteDef,
  v: Variant,
  camera: Camera,
  gx: number,
  gy: number,
  out: Float64Array,
): void;
```

The eight primitives, as free functions on a `Pen`:

```ts
export interface BoxOpts {
  /** Base colour. The three faces are derived from it; there is no per-face override. */
  readonly color: Ink;
  /** Height in level units. */
  readonly h: number;
  /** Base height, so a box can sit on top of another. */
  readonly z?: number;
  /** Shrink the footprint on all sides, in tiles. Ledges and setbacks. */
  readonly inset?: number;
  /** Silhouette stroke. Set false for stacked sub-volumes, which would otherwise double-line. */
  readonly outline?: boolean;
  /** Override the top face only — roofs, solar glass, water. The one sanctioned exception. */
  readonly topColor?: Ink;
  /** 0–1 opacity, for ghosts. */
  readonly alpha?: number;
}
```

`BoxOpts` is the only object a primitive takes, and it is deliberate: eight positional
arguments would be unreadable and every one of them would be a number. It is `readonly`
throughout and never retained by the kit, so the intended use is a module-level constant
reused every frame, and the intended *misuse* — a fresh literal per building per frame — is
one small short-lived object, not a retained one. The cached path allocates neither.

```ts
/** A single flat tile diamond: terrain, pads, the placement grid. */
export declare function isoTile(
  pen: Pen, gx: number, gy: number,
  fill: Ink, stroke?: Ink, inset?: number, z?: number,
): void;

/**
 * The workhorse: an axis-aligned box on the grid.
 *
 * Draws left face, right face, top, then **one** stroke around the silhouette — not around
 * each face. Per-face strokes are the tell of a naive iso renderer: they cross-hatch the
 * interior and destroy the chunky read that makes this art style work at thumbnail size.
 */
export declare function isoBox(
  pen: Pen, gx: number, gy: number, w: number, d: number, opts: BoxOpts,
): void;

/**
 * An upright cylinder — cooling towers, tanks, silos.
 *
 * An ellipse cap over a body filled with a horizontal ramp. A swept solid would be more
 * correct and completely indistinguishable at this size; the ramp is what sells curvature.
 */
export declare function isoCylinder(
  pen: Pen, gx: number, gy: number, radiusTiles: number, opts: BoxOpts,
): void;

/**
 * A gabled roof: a prism ridged along the `gx` axis.
 *
 * Eight points, and it is what sheds the "everything is a box" read that flat-topped-only
 * kits fall into. A kit without it produces cities that look like spreadsheets.
 */
export declare function isoRoof(
  pen: Pen, gx: number, gy: number, w: number, d: number,
  z: number, rise: number, color: Ink, outline?: boolean,
): void;

/**
 * A flat quad **lying in the ground plane** at height `z` — solar glass, helipads, gravel.
 *
 * Separate from a zero-height box because a zero-height box still draws two degenerate side
 * faces, and those slivers alias badly at low zoom. Not for windows: see {@link isoWall}
 * and trap 1.
 */
export declare function isoPatch(
  pen: Pen, gx: number, gy: number, w: number, d: number,
  z: number, fill: Ink, stroke?: Ink,
): void;

/**
 * A rectangle **on a vertical face** — windows, doors, vents, signage, hazard panels.
 *
 * Takes the two grid endpoints of the wall segment and the two heights it spans, so it
 * lands flush on the face rather than hovering in front of it.
 */
export declare function isoWall(
  pen: Pen, ax: number, ay: number, bx: number, by: number,
  z0: number, z1: number, fill: Ink, stroke?: Ink,
): void;

/** A thin upright post — antennae, lightning rods, flagpoles, pylons. */
export declare function isoPost(
  pen: Pen, gx: number, gy: number, z: number, h: number, color: Ink, width?: number,
): void;

/**
 * A glowing point: a hard core inside a soft halo — status LEDs, lit windows, strobes.
 *
 * A hundred of these sell "operational facility" better than any amount of geometry, and
 * they cost one ellipse and one soft ellipse each.
 */
export declare function glowDot(
  pen: Pen, gx: number, gy: number, z: number,
  color: Ink, radius?: number, intensity?: number,
): void;

/**
 * The z-fight ladder. Anything drawn *on* the ground must be lifted off it by one of these,
 * in this order, or it will flicker against the tile beneath at some zooms and not others.
 */
export declare const GROUND_LIFT: 0.002;
export declare const GHOST_LIFT: 0.01;
export declare const SELECT_LIFT: 0.02;
```

### 3.8 `shadow` and `text`

```ts
/**
 * A soft contact shadow under a footprint.
 *
 * One `softEllipse`, not a blurred copy of the silhouette: a real drop shadow costs a
 * filter pass per building and buys nothing at this scale. Grounding is the whole point —
 * without it, buildings look pasted onto the grass, and no amount of detail fixes that.
 */
export declare function contactShadow(
  pen: Pen, gx: number, gy: number, w: number, d: number, strength?: number,
): void;

/** A full-viewport wash — dusk tint, brownout, pause dim. One quad; call it last. */
export declare function wash(pen: Pen, color: Ink): void;

export declare const DEFAULT_TEXT: TextStyle;

/** Below this many pixels of wall, glyphs are mush; `wallText` draws nothing instead. */
export declare const MIN_WALL_TEXT_PX: 12;

/**
 * Text painted **onto a vertical face**, sheared into the isometric plane.
 *
 * The transform maps a local text space onto the wall: `+x` runs along the segment, `+y`
 * runs down it. Two corrections are mandatory and both are in trap 8 — the basis is
 * anisotropic, and the aspect fix moves the anchor as well as the glyphs.
 *
 * This exists because a sign is often the only place a player's own choice — a company
 * name — appears in the world. A blank tinted panel there is not a missing polish item; it
 * is the game breaking a promise about the one thing the player personally chose.
 */
export declare function wallText(
  pen: Pen, ax: number, ay: number, bx: number, by: number,
  ztop: number, heightTiles: number, value: string, color: Ink, style?: TextStyle,
): void;

/** Unsheared text at a screen pixel — floating numbers, timers, debug. Never world-space. */
export declare function screenText(
  pen: Pen, sx: number, sy: number, value: string, color: Ink, style?: TextStyle,
): void;
```

### 3.9 `cache` — what is cached, keyed on what, invalidated when

The brief's third question, answered as three rules.

**What is cached:** the output of `massing` only, rendered into a `RenderTarget`. Never
`animate`, never the ghost, never terrain. A building whose blinking LED was baked in would
be a building that stops blinking, which is a worse bug than a slow frame.

**Keyed on:** `(def.id, level, seed, flags, floor(progress × 16), label, palette.rev,
zoomBucket)` — every input `massing` can legally observe, plus the two the *kit* varies
underneath it. `palette.rev` is what stops a recoloured campus rendering stale; `zoomBucket`
is what stops a blit being resampled to mush.

**Invalidated when:** never, individually. Entries are unreachable the moment any key
component changes, and the LRU reclaims them under a byte budget. There is no
`invalidate(instance)` call, because a per-instance invalidation API is an invitation to
forget one, and the failure mode of forgetting is a stale building nobody can reproduce.
`invalidate(spriteId?)` exists for hot reload and for tests, and drops everything matching.

**And the fill is deferred while the camera moves.** `frame()` returns false during a pan or
a pinch; sprites draw direct and nothing is written. Filling during a pinch re-renders every
building every frame at a new bucket — strictly worse than no cache at all, and it is the
most likely way a naive implementation makes the game slower by adding caching to it.

```ts
export interface SpriteCacheOpts {
  /** Resident bitmap budget. Default 8 MiB; on a phone that is roughly 300 sprites. */
  readonly budgetBytes?: number;
  /** Zoom buckets per doubling. Default 4 — about 19% between steps, invisible when blitted. */
  readonly zoomSteps?: number;
  /** Padding in pixels around a sprite's bounds, for glow halos that exceed the geometry. */
  readonly padPx?: number;
  /** Off means every `drawSprite` draws direct. The invariant-6 test flips this. */
  readonly enabled?: boolean;
}

export interface CacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  /** Whether this frame is filling. False while the camera is moving. */
  readonly filling: boolean;
}

export interface SpriteCache {
  /**
   * Call once per frame, before drawing. Returns whether this frame will fill.
   *
   * Compares the camera against last frame's to decide, and reads `palette.rev` so a
   * recolour is noticed exactly once rather than per sprite.
   */
  frame(camera: Camera, palette: Palette): boolean;
  /** Drop everything, or everything for one sprite id. For hot reload and tests. */
  invalidate(spriteId?: string): void;
  readonly stats: CacheStats;
  /** Disposes every `Bitmap`. A cache that outlives its surface leaks GPU memory. */
  dispose(): void;
}

export declare function createSpriteCache(
  surface: Surface,
  opts?: SpriteCacheOpts,
): SpriteCache;

/** The key, exported so a test can assert two variants disagree rather than hope they do. */
export declare function spriteKey(
  def: SpriteDef,
  v: Variant,
  paletteRev: number,
  zoomBucket: number,
): number;

export declare function zoomBucketOf(zoom: number, steps: number): number;
```

### 3.10 `layers` — the six passes, and the sort

The pass order is fixed, and it is fixed because **the order is the product**:

1. **Backdrop** — a vertical ramp. Never a flat colour; flat backgrounds make an island look like a sticker.
2. **Terrain** — culled tile diamonds, colour varied per tile from a seeded stream, so grass has texture without a texture.
3. **Solids** — buildings *and* scenery, one list, one sort. Two sorted lists is what makes trees pop through walls.
4. **Placement** — ghost and selection: above the world, below the UI.
5. **Overlay** — bubbles and timers, in screen space, unsorted, always on top. A reward the player cannot see behind a neighbouring roof is a reward that does not exist.
6. **Effects** — floating numbers and bursts.

There is deliberately no way to add a seventh, and no way to get a second Solids pass. Both
are how the tree-through-wall bug comes back.

```ts
export declare const Layer: {
  readonly Backdrop: 0;
  readonly Terrain: 1;
  readonly Solids: 2;
  readonly Placement: 3;
  readonly Overlay: 4;
  readonly Effects: 5;
};
export type Layer = (typeof Layer)[keyof typeof Layer];

/**
 * A per-frame draw order. Holds `(layer, depth, id)` triples in parallel typed arrays and
 * sorts an index — not objects, and not closures.
 *
 * `id` is the game's own index into its own arrays; this package never learns what a
 * building is. A `push(layer, depth, () => draw(b))` API would be prettier and would
 * allocate one closure per drawable per frame, which is the exact thing rule 7 forbids.
 */
export interface DrawList {
  readonly length: number;
  push(layer: Layer, depth: number, id: number): void;
  /** Layer major, depth minor, `id` as the final tiebreak — so ties are deterministic. */
  sort(): void;
  layerAt(i: number): Layer;
  idAt(i: number): number;
  clear(): void;
}

/** Grows by doubling; `capacity` is a hint that avoids the first few regrowths. */
export declare function createDrawList(capacity: number): DrawList;
```

---

## 4. What is deliberately absent

This section is the point of the document. Each of these was considered and rejected, and
the reason is what stops the next agent adding it back.

| absent | why |
|---|---|
| **Bezier and arc paths** | `quadraticCurveTo` / `arcTo` / `bezierCurveTo` cannot be honoured by a WebGL backend without a tessellator, which is bigger than this whole package. Every form in an isometric kit decomposes into convex polygons and ellipses. If a shape needs a curve, it needs more segments. |
| **Concave polygons** | Same reason, one level down. `poly()` promises convex so a GPU backend fan-triangulates in place. A sprite author splitting an L-shape into two quads is thirty seconds; a general tessellator is 8 KB and a class of bugs. |
| **Clipping regions** | `clip()` is a stencil buffer on a GPU and a state stack on Canvas2D, and the kit's actual need — do not draw what is off-screen — is culling, which is cheaper and testable. |
| **Composite modes** | `globalCompositeOperation` is a Canvas2D concept with no honest WebGL equivalent short of a blend-state API. Additive glow is faked well enough by a soft ellipse over a bright core, which is what the source game did and which nobody noticed. |
| **A transform stack** | Solids are computed in screen space; the only thing that needs a matrix is text on a wall, and it takes one per call. A stack invites `save()`/`restore()` imbalance across a frame boundary, and it is how the source game applied its device-pixel-ratio transform twice (trap 7). |
| **Filters, blur, `shadowBlur`** | A filter pass per building at sixty frames a second, for an effect the contact shadow already achieves in one ellipse. |
| **Images, textures, `drawImage` of anything the kit did not render** | Rule 8. The `Bitmap` type has no public constructor from a URL, so zero-assets is enforced by the type system rather than by a lint people disable. |
| **Perceptual colour interpolation (OKLab/OKLCH)** | It is more correct and it is not this look. The three-tone face derivation is a byte-space lerp toward two fixed tints, and its slight non-linearity is *why* the faces read as painted rather than as computed. A "correct" `mix` would change every screenshot in the kit and improve none of them. |
| **A software rasteriser in the test backend** | Golden tests here protect the shape of the draw, not the antialiasing. A command log diffs into a sentence; a pixel diff into a number. If someone later wants real pixels, they can run the Canvas2D backend in a browser test — the seam already allows it. |
| **A retained scene graph** | At a few hundred drawables, rebuilding the list every frame costs less than maintaining one, and it removes the entire class of "the renderer and the state disagree" bug that a retained graph invites. `DrawList` is a sorted array that is cleared every frame, on purpose. |
| **Per-face colour overrides** | `topColor` is the one exception, for roofs and glass. A `leftColor` would let a caller break the three-tone rule, and a kit whose look can be broken by a single call is a kit whose look will be broken. |
| **Tweening, easing, particle systems** | `loop` owns time. This package takes `t` and reads no clock. |
| **Hit-testing** | `iso` owns picking. `draw` contributes `spriteBounds` and stops there — and specifically never records what it drew for picking to read back, because a frame the renderer skipped would then leave the controls somewhere the building is not. |
| **DOM anything** | `ui` owns the overlay. This package produces exactly one DOM interaction, in `canvas2d.ts`: it writes `canvas.width`. |
| **The WebGL backend itself** | Not in 0.1. The point of the `Surface` seam is that it can land later without touching a line of sprite code, and the point of section 3.3 is that when it does, it will not have to lie. |

---

## 5. Invariants a reviewer can test

1. **Nothing outside `canvas2d.ts` mentions a canvas.** `grep -rn 'CanvasRenderingContext2D\|HTMLCanvasElement\|OffscreenCanvas' packages/draw/src` returns hits in `canvas2d.ts` only. *Fails when:* a solid reaches for the context to do something the `Surface` will not let it.
2. **`record.ts` imports in Node with no DOM.** `node --input-type=module -e "import('@lattice/draw/record')"` under a stripped global object resolves. *Fails when:* the recording backend is bundled with the browser one.
3. **Surface coordinates are CSS pixels.** The same scene drawn at `pixelRatio` 1 and 2 records identical op coordinates. *Fails when:* a primitive multiplies by the ratio itself, which is trap 7 waiting to happen.
4. **A solid strokes once.** `isoBox` with `outline !== false` records exactly one `stroke` op, closed, with six points. With `outline: false`, zero. *Fails when:* someone strokes each face and the art goes cross-hatched.
5. **`shade(c, 1) === c`, exactly, for 256 random colours**, and `shade(c, f)` for `f < 1` is strictly closer to `SHADE_TINT` in hue than `c` is. *Fails when:* the neutral case drifts, and every unlit face is subtly wrong.
6. **Cache on and cache off draw the same thing.** Render a sprite with `enabled: false`, and with `enabled: true` into a recording target; the target's op list equals the direct one. *Fails when:* the cache becomes a second code path, which is how a cached campus and a live campus come to disagree.
7. **A recolour is visible in one frame.** Draw, `palette.set('brand', …)`, draw again; the recorded fill colours differ, with the cache enabled and warm. *Fails when:* `palette.rev` is missing from the key — the exact stale-campus bug.
8. **Determinism.** The same `(SpriteDef, Variant, camera, t)` digests identically twice in one process and across two processes. *Fails when:* anything reaches for `Math.random()` or a clock — including an `animate` that closes over a counter.
9. **The frame path allocates nothing.** A bench draws 10,000 boxes through a warm pen and asserts heap growth under 4 KB with `--expose-gc`. *Fails when:* a primitive returns or builds a `{ x, y }`.
10. **Nothing off-screen is submitted.** With the camera on a far corner, a 64×64 tile grid records fewer than 200 `poly` ops. *Fails when:* culling is forgotten and a big map costs the same wherever you look.
11. **Illegible text draws nothing.** `wallText` on a wall shorter than `MIN_WALL_TEXT_PX` records zero ops. *Fails when:* a zoomed-out campus grows a rash of grey smears.
12. **Ties sort deterministically.** A `DrawList` with two entries at identical `(layer, depth)` sorts by `id`, in both push orders. *Fails when:* the sort is unstable and a replay diverges on a coin flip.
13. **Every `Ink` slot miss throws by name.** `pen.palette.ink('brnd')` throws a `RangeError` whose message contains `brnd` and at least one real slot. *Fails when:* a typo renders black and gets filed as an art bug.
14. **A cache respects its budget.** With `budgetBytes` set to two sprites' worth, drawing five distinct sprites leaves `stats.bytes <= budgetBytes` and `stats.evictions > 0`.

---

## 6. Traps — what a naive implementation gets wrong

1. **`isoPatch` lies in the ground plane.** Windows and doors need `isoWall`; using a patch paints a horizontal sliver hovering in mid-air at window height. This shipped, on every building on the map, in the source game's first version. (`PLAYBOOK.md` trap 4.) The doc comments on both functions must say so, because the names do not.
2. **One stroke around the silhouette, not one per face.** Per-face strokes cross-hatch the interior and destroy the chunky read. This is the difference between "reads at 40 px" and "reads as a wireframe".
3. **`{ x, y }` per corner.** Seven objects per box, four hundred boxes, sixty times a second, is a garbage collector pause with a pleasant signature. Corners go into `pen.xy`; nothing in this package returns a point.
4. **CSS colour strings per face per frame.** `shade()` returning `rgb(12,34,56)` allocates three strings per box. Colours are packed integers here, and the *only* string conversion is inside the Canvas2D backend, memoised on the integer.
5. **A gradient object per shadow per frame.** `createRadialGradient` is not free, and there is nothing on the other side of the WebGL seam to hand it to. `softEllipse` is a primitive precisely so the backend can cache its ramp once.
6. **Canvas2D state leaks.** `setLineDash`, `globalAlpha`, `font` and `lineJoin` left set are the classic ones: the next caller inherits them and the symptom appears somewhere unrelated. Every `Surface` call carries its own state, and `begin()` resets everything regardless.
7. **The device pixel ratio applied twice.** The source game set the DPR transform on resize, and its wall-text routine then reset the transform and re-applied DPR itself — correct only because both places agreed, and one edit from a half-scale campus. Here the backend owns the ratio and no caller can see it.
8. **Wall text, twice.** (a) The two basis vectors have different screen lengths, so the transform is anisotropic and every glyph comes out stretched sideways; squeeze x by `min(1, downLen/alongLen)` to restore the letterform while keeping the shear. (b) That squeeze moves the *anchor* as well as the glyphs, so the centring x must be divided back out by the same factor or the sign slides off its own board. Both bugs shipped; both are one line.
9. **Filling the cache while the camera moves.** A pinch crosses a zoom bucket every few frames and re-renders every visible sprite. `frame()` returns false until the camera settles, and the frame budget is met by *not* caching during the one interaction where caching cannot win.
10. **Blitting on a fractional pixel.** A cached sprite drawn at `dx = 41.3` resamples, and the whole campus shimmers against terrain that is drawn directly. Snap blit destinations to whole device pixels; accept the sub-pixel error, because the alternative is visible and this is not.
11. **Sorting scenery separately from buildings.** Two sorted lists is what makes trees pop through walls. There is one `Solids` layer, and it is not extensible.
12. **Drawing on the ground at `z = 0`.** A ghost, a selection rim and a pad all z-fight the tile beneath them at some zooms and not others, which makes it look like a hardware bug. Use `GROUND_LIFT` / `GHOST_LIFT` / `SELECT_LIFT`, in that order.
13. **A cache key without `palette.rev`.** The recoloured campus that keeps rendering the old brand. It will be reported as "the rebrand did not work", nobody will reproduce it because a reload clears the cache, and it will sit open for a month.
14. **Massing that reads anything outside its `Variant`.** A closure over a game object, a module-level counter, the current hour — each one is a stale sprite whose cause is invisible. The signature is the enforcement: `(w, v, rng)`, and `rng` is seeded from `v.seed` by the kit.
15. **Believing `measure()` across backends.** The recording surface has no fonts and estimates. Golden tests may assert that the shrink-to-fit branch ran; they may not assert glyph positions.
16. **`ctx.save()`/`restore()` around an alpha change.** There is no save/restore. `alpha()` returns the previous multiplier and the caller restores it — which cannot be left unbalanced across frames, because `begin()` resets it.

---

## Asks of other packages

Routed rather than fixed, per `docs/LOOP.md` rule 5.

- **`iso` (A2), blocking:** `Camera.toScreen` and a `gridToScreen(cam, gx, gy, z, out)` must take an **output parameter**. If they return `{ x, y }`, `draw` cannot honour constitution rule 7 and invariant 9 is unachievable. `draw` also needs `LEVEL_H` and the half-tile constants, and a `visibleTileBounds(cam, out)` for invariant 10 — culling belongs with the projection, not with the painter.
- **`iso` (A2), boundary:** depth *values* (`depthOf(gx, gy, z)`) belong in `iso/depth`; the pass *ordering* and the sorted bucket belong here in `draw/layers`. If A2's RFC also defines a sorted draw list, one of us should drop it — I would drop mine only if theirs sorts by an integer layer as the major key.
- **`core` (A1):** `draw` needs a `hash32(string)` for cache keys and stable digests, and an `Rng` that can be re-seeded cheaply per sprite per cache miss (`rngFrom(seed)` returning a fresh stream, not a shared one). A fixed-capacity LRU would also be shared with `persist` if one exists there.
- **`ui` (A9):** thumbnails must go through `createOffscreenSurface` + `subPen` + `drawSprite`, not through a canvas `ui` creates itself. Rendering the shop card with the same code that draws the world is what stops the card and the building drifting apart — and it means no `toDataURL` helper is needed anywhere.
- **`input` (A6) / `iso`:** picking a *building* rather than a *tile* needs `spriteBounds`, which lives here. Neither package should re-derive a bounding box from constants copied out of a sprite definition.
- **Kit-level gap, belongs to nobody yet:** there is no package of **ready-made archetypes**. A game built on Lattice today still authors every silhouette from primitives, which is the largest single chunk of work between "installed the kit" and "has a game". Eight or ten `SpriteDef`s — tower, shed, tank, mast, hall, yard, dish, chimney — parameterised by footprint and palette slot, would be the difference between a kit and a kit somebody finishes something with. It cannot live in `draw` (12 KB budget, and it is content, not mechanism). Candidates: a tenth package, or `examples/demo` with an explicit promise that it is copy-paste source.
- **Kit-level gap:** nothing owns **frame-budget back-pressure**. When 400 sprites will not fit in 8 ms, something must decide to skip `animate` on off-screen-adjacent sprites or drop to a coarser zoom bucket. `draw` can expose the levers (`CacheStats`, an `animate` opt-out) but the policy needs `loop`'s frame timings. Worth a task.
