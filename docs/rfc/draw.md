# RFC — `@latticekit/draw`

| | |
|---|---|
| **status** | proposed (cycle 1, task A3) |
| **package** | `@latticekit/draw` |
| **depends on** | `@latticekit/core`, `@latticekit/iso` |
| **environment** | browser for the Canvas2D backend; the rest runs unchanged in Node |
| **budget** | 12 KB gzipped, ≤ 8 ms frame |

---

## 1. The one sentence

**`@latticekit/draw` turns one color and one grid footprint into a stylised isometric solid on
a surface it does not own** — so the same code paints the world, a shop thumbnail, and a
golden test, and a WebGL backend can replace the Canvas2D one without a sprite noticing.

The two halves of that sentence are the two things this package is for. *One color* is the
art direction: three-tone faces derived from a single hex, cool shadows, warm highlights, a
silhouette stroke on everything. *A surface it does not own* is the engineering: nothing in
this package, and nothing above it, ever holds a `CanvasRenderingContext2D`.

> **Revised after `docs/rfc/demo.md` (A10).** The demo is a lamplighter game whose premise is
> *"you can see exactly where the light stops"*, and it named three things this package could
> not deliver: an emissive light, a night mask, and a palette that interpolates by `t`. All
> three are now in this RFC — a new `light` module (3.9), a seventh render pass (3.11), and
> `Palette.lerp` (3.6). Two of them changed the `Surface` seam, which is exactly the kind of
> change that has to happen *before* a builder starts rather than after. The demo doing this
> is the demo working.

---

## 2. The five-line example

This is written before the API, and the API below exists to serve it.

```ts
import { beginFrame, createCanvas2dSurface, endFrame, isoBox, isoTile } from '@latticekit/draw';

const surface = createCanvas2dSurface(canvasEl);
const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });
isoTile(pen, 4, 7, 'ground');
isoBox(pen, 4, 7, 2, 2, { color: 'brand', h: 3 });
endFrame(pen);
```

Five lines, and every design decision in section 3 falls out of them:

| the line says | so the API must |
|---|---|
| `createCanvas2dSurface(canvasEl)` | put the backend behind a factory, and never behind an inherited class the caller must subclass |
| `beginFrame({ surface, camera, … })` | bundle surface + camera + palette + clock into one `Pen` passed first, so a solid takes seven numbers rather than nine. Named fields rather than positional, because the sixth one is an optional `LightField` and nobody should have to count commas to reach it |
| `isoTile(pen, …)`, not `pen.tile(…)` | free functions, so a game that draws boxes and nothing else ships boxes and nothing else |
| `'ground'`, `'brand'` | colors are **palette slots resolved at draw time**, which is the whole recolour-the-campus story, and the reason a cache key has to carry a palette revision |
| `{ color, h }` — one color, a height | faces are *derived*, never given. There is no `leftColor`. Offering one is offering the caller a way to break the look |
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

**Night**, which is the demo's whole subject. Darkness is a layer, and lights punch through
it — one field, one number, and sprites that know nothing about the mask:

```ts
const light = createLightField(surface);
palette.lerp(DAY, NIGHT, night);                     // night: 0 → 1, from the game's clock
const pen = beginFrame({ surface, camera, palette, t, clear: 'sky', light });

light.begin(pen, night, 'night');                    // darkness amount and its color
for (const lamp of lit) drawSprite(pen, LAMP, lamp.gx, lamp.gy, lamp.v);  // each emits a pool
light.composite();                                   // the Light pass: mask down, glow up
```

`composite()` is shown here for clarity; in a real frame `renderFrame` (3.11) calls it for
you, between Placement and Overlay, and gives you no way to call it anywhere else.

And a **golden test**, in Node, with no canvas anywhere:

```ts
const rec = createRecordingSurface(320, 200, 1);
const pen = beginFrame({ surface: rec, camera, palette, t: 0, clear: 'sky' });
drawSprite(pen, WATER_TOWER, 0, 0, VARIANT_ZERO);
endFrame(pen);
expect(rec.digest()).toBe('…'); // and rec.ops is readable when it does not
```

---

## 3. The full public surface

### 3.0 The module map, and where it differs from `kit.json`

`kit.json` declares nine modules. I am proposing twelve. The three additions are not scope
creep; each is a constitution rule or a demo requirement the nine-module list cannot hold.

| module | what is in it | change |
|---|---|---|
| `surface` | `Surface`, `RenderTarget`, `Bitmap`, `TextStyle`, `Pen`, `beginFrame` | — |
| `canvas2d` | the browser backend | — |
| **`record`** | the headless recording backend | **added** |
| `color` | packed RGBA, `shade`, `outlineOf`, face constants | — |
| `palette` | named slots, `rev`, `lerp`, CSS var serialization | — |
| `solids` | the eight iso primitives | — |
| **`sprite`** | `SpriteDef`, `SolidWriter`, `drawSprite`, `drawGhost`, `spriteBounds` | **added** |
| `shadow` | contact shadow, full-frame wash | — |
| **`light`** | `LightField` — emissive pools and the night mask they punch through | **added** |
| `text` | wall text and screen text | — |
| `layers` | the seven passes and the runner that makes their order unforgeable. **No sorting** — that is `iso.DepthSorter` | — |
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

**Why `light` is its own module.** Every module in the nine-module list is subtractive —
`shadow` is literally the opposite operation — and the demo's premise is a pool of light with
a visible edge. `shadow` is per-object and immediate; a light field is per-frame, accumulated
into its own buffer and composited once, because that is the only way two overlapping pools
meet without a seam (3.9). Folding it into `shadow` would put two opposite lifecycles in one
file, and folding it into `layers` would make the pass ordering own a framebuffer.

### 3.1 Types borrowed from below

These are declared here so this section compiles standalone. **They are `iso` as delivered,
not as I asked for it** — every blocking item in my first draft was granted, so this is now a
transcription rather than a request. What changed on my side as a result is listed after the
block, because two of the changes deleted code from this RFC rather than adding it.

```ts
/** From @latticekit/core. */
export interface Rng {
  u32(): number;
  float(): number;
}

/** From @latticekit/iso. Mutable, because every hot-path conversion writes into a caller's point. */
export interface Vec2 {
  x: number;
  y: number;
}

/** From @latticekit/iso. The kit's rectangle, min/max. `draw` culls and measures with it. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** From @latticekit/iso. Half-open: `gx0 ≤ gx < gx1`. */
export interface TileRange {
  gx0: number;
  gy0: number;
  gx1: number;
  gy1: number;
}

/** From @latticekit/iso. A footprint with a height, in **world pixels**. */
export interface Volume {
  readonly w: number;
  readonly d: number;
  readonly zPx: number;
  readonly hPx: number;
}

/** From @latticekit/iso — the subset @latticekit/draw depends on, and no more. */
export interface Camera {
  readonly zoom: number;
  readonly viewW: number;
  readonly viewH: number;
  /**
   * World → screen, **one axis at a time**. Screen x depends only on world x, screen y only
   * on world y, so these are separable — and this is the form `draw` actually uses.
   *
   * It matters more than it looks. A box's eight corners have only **four distinct world x
   * values**: the top four sit directly above the bottom four, and elevation shifts screen y
   * alone. So a box costs four `toScreenX` calls, not eight, and the scalar form *is* the
   * write: `pen.xy[i] = camera.toScreenX(wx)` — a number goes straight into the buffer with
   * no `Vec2`, no destructuring and no intermediate at any point in the chain.
   */
  toScreenX(wx: number): number;
  toScreenY(wy: number): number;
  /** The two-axis form, for the places that genuinely want a point. */
  toScreen(wx: number, wy: number, out: Vec2): Vec2;
  isVisible(minX: number, minY: number, maxX: number, maxY: number): boolean;
  /** The conservative grid rectangle covering the viewport. This is `draw`'s terrain loop. */
  visibleTileBounds(out: TileRange, marginTiles?: number): TileRange;
  /** The world rectangle, for what is not on the lattice — backdrop, light pool, chunk. */
  visibleWorldBounds(out: Rect, marginPx?: number): Rect;
}

/**
 * From @latticekit/iso. Grid → screen including elevation, allocation-free.
 *
 * `zPx` is **world pixels**, not storeys. Every height that crosses into `iso` is in pixels;
 * every height a sprite author writes is in levels. `draw` is the converter, and the two units
 * living in one codebase is trap 23.
 */
export declare function gridToScreen(
  camera: Camera,
  gx: number,
  gy: number,
  zPx: number,
  out: Vec2,
): Vec2;

/**
 * From @latticekit/iso. The six-point screen outline of a box, in the order
 * **north-top, east-top, east-base, south-base, west-base, west-top**.
 *
 * `draw` strokes a box in exactly this order. See 3.7 — it is the one genuine coupling
 * between the two packages and it is guarded by invariant 21.
 */
export declare function boxSilhouette(
  camera: Camera,
  gx: number,
  gy: number,
  volume: Volume,
  out: Float64Array,
): Float64Array;

/**
 * From @latticekit/iso. Fed ground footprints, hands back a **permutation of integers**.
 *
 * It holds rectangles, never items: `add` returns an insertion index and `indexAt(i)` gives
 * it back in paint order, so what sits at each position is the caller's business. That is the
 * line between the packages — `iso` answers *what occludes what*, and nobody but the game
 * knows what a drawable is. See 3.11.
 */
export declare class DepthSorter {
  constructor(capacity?: number);
  readonly count: number;
  clear(): void;
  /** @returns the insertion index. Key your own arrays by it. */
  add(gx: number, gy: number, w: number, d: number, heightPx: number): number;
  /** A walker, a floating number's origin — given a small square rather than zero extent. */
  addPoint(gx: number, gy: number, heightPx: number, radius?: number): number;
  sort(camera?: Camera): void;
  /** The insertion index at sorted position `i`, back to front. The whole output. */
  indexAt(i: number): number;
}

/**
 * From @latticekit/iso. Walks a sorted `DepthSorter` **backwards** — the exact reverse of paint
 * order — and returns the insertion index of the last-painted item whose `test` passes.
 *
 * `draw` must hand it the same sorter instance that produced the paint order and must not
 * have reordered in between. Invariant 27.
 */
export declare function pickSorted(
  sorted: DepthSorter,
  test: (index: number) => boolean,
): number;

/** From @latticekit/iso. Even-odd ray cast, for a pick test built on `boxSilhouette`. */
export declare function pointInPolygon(
  sx: number,
  sy: number,
  poly: Float64Array,
  count: number,
): boolean;
```

**What `iso`'s delivery changed here, and it is mostly deletion:**

| `iso` delivered | so `draw` |
|---|---|
| `DepthSorter` + `pickSorted` — footprints in, a permutation out, and it cannot name a drawable | **deletes `DrawList`.** One sorted list in the kit, and no item bucket in this package either — the game's own array is the bucket. See 3.11 |
| `Rect`, min/max | uses it for `spriteBounds`; drops the bare `Float64Array` out-param |
| `Camera.visibleTileBounds` / `visibleWorldBounds` | stops asking for a culling primitive; `renderFrame` calls both and hands them to the Terrain and Backdrop passes |
| separable `toScreenX` / `toScreenY` scalars | writes straight into `pen.xy` with no intermediate, and projects four x values for a box's eight corners rather than eight |
| elevation as `zPx` world pixels on grid **vertices** | keeps storeys as the authoring unit and converts at the boundary — one bridge, one direction, trap 23 |
| `boxSilhouette`'s point order | takes it as given and conforms (invariant 21) |
| *declines* to round the camera translate | **rounds it** — `draw` is the package touching a device. See `Pen.snapX` in 3.3 |
| *declines* `LEVEL_H`, twice, and finally | **owns it** (3.7) |

### 3.2 `color` — one color in, three faces out

> **The rule `persist` asked for, stated once here and again at the call site.**
>
> **A game persists the *input* to a color, never the output.** Store the player's brand hue
> — one number — and re-derive every token from it on load. Never write a derived `#rrggbb`
> into a save.
>
> Derivation is presentation-tier: it is allowed to use maths whose last unit may differ
> between engines, because a pixel that differs in its last unit is a pixel nobody can see.
> A *save file* that differs in its last unit is another matter entirely — it travels. Persist
> a derived token and you have written an engine-specific artifact into a document that will
> be opened on a different engine, and the player gets a campus that is a shade off on their
> phone from what it is on their laptop, with nothing anywhere to explain it. Store the hue
> and the derivation runs fresh in whatever engine is present, which is the whole contract.
>
> The same sentence is on `hsl`, `hueToHex` and `shade` below, because a warning at the call
> site beats a warning in a document nobody opens.

```ts
/**
 * A color packed as `0xRRGGBBAA` in a uint32.
 *
 * Not a CSS string. `shade()` in the source game returned `rgb(12,34,56)`, which meant
 * three fresh strings per box per frame — the largest single source of garbage in the
 * renderer, and invisible in a profile because strings die young. Packed integers compare
 * with `===`, key a Map with no hashing, and hand a WebGL backend its vertex color with
 * two shifts. `cssOf()` exists solely inside the Canvas2D backend and memoises.
 *
 * Always store unsigned: `rgba()` returns `>>> 0`, so `0xff0000ff` is 4278190335, never -255.
 */
export type Rgba = number;

/**
 * A color, or the name of a palette slot resolved at draw time.
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
 * Derive a face color from a base color — the rule the whole look rests on.
 *
 * `factor` below 1 darkens *and* pulls toward {@link SHADE_TINT}; above 1 brightens and
 * pulls toward {@link LIGHT_TINT}. Tint strength scales with distance from neutral, so
 * `shade(c, 1) === c` exactly and nothing drifts by accident.
 *
 * Shading toward blue in shadow and amber in light is what separates a stylised render
 * from a flat gray lerp. Replace it with a plain multiply and the kit's art dies quietly:
 * every screenshot still renders, and every screenshot looks like a placeholder.
 *
 * **Presentation only. Never persist what this returns** — store the base color and derive
 * again on load. A derived token in a save file is an engine-specific artifact in a document
 * that travels between engines.
 */
export declare function shade(base: Rgba, factor: number): Rgba;

/** The silhouette stroke for a solid: its own hue, very dark, never pure black. */
export declare function outlineOf(base: Rgba): Rgba;

/** Replace the alpha channel. `a` is 0–1; the rgb channels are untouched. */
export declare function withAlpha(color: Rgba, a: number): Rgba;

/** Linear per-channel blend in sRGB bytes. Deliberately not perceptual — see section 4. */
export declare function mix(a: Rgba, b: Rgba, t: number): Rgba;

/** Packed color → `rgb()` / `rgba()`, memoised. Backends only; not for game code. */
export declare function cssOf(color: Rgba): string;

/** Packed color → `#rrggbb`, or `#rrggbbaa` when it is not opaque. The DOM-facing form. */
export declare function hexOf(color: Rgba): string;

/**
 * HSL → packed. `h` in degrees, `s` and `l` in 0–1.
 *
 * Hue is how a *player* picks a brand color — a wheel, one number — and how a theme derives
 * a dozen related tokens from that one number.
 *
 * **The hue is the thing a game saves.** Persist `h`, never the `Rgba` this returns and never
 * the `#rrggbb` that comes out of {@link hueToHex}. One number in the save, a whole palette
 * derived on load, and the same save renders identically on any engine — which the derived
 * tokens, being presentation-tier, cannot promise.
 */
export declare function hsl(h: number, s: number, l: number, a?: number): Rgba;

/**
 * A brand hue straight to `#rrggbb`, for the DOM.
 *
 * `hexOf(hsl(hue, sat, light))`, and it exists as its own export because `ui` derives its
 * whole theme from one hue and must not grow a second color model to do it. **Color lives
 * in exactly one package, and this is it** — `core` deliberately has none, so a second
 * implementation anywhere above this line is the bug, not the convenience.
 *
 * **The string this returns belongs in a stylesheet, never in a save.** It is derived, and
 * derived color is presentation-tier; the `hue` argument is the durable value.
 */
export declare function hueToHex(hue: number, sat?: number, light?: number): string;

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
 * Section 4 rejects `globalCompositeOperation` as a Canvas2D-shaped concept, and this is the
 * narrow replacement: three named modes, each one blend state on both backends, each one
 * demanded by a picture the kit has to be able to draw.
 */
export type BlitMode = 'over' | 'add' | 'cut';

/**
 * A text run's appearance. Passed per call because a font left set on a 2D context is the
 * classic Canvas2D state leak: the next caller inherits it and no one can find out why.
 *
 * `align` and `baseline` are -1 | 0 | 1 (start | center | end) rather than strings, so a
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
 * Everything a backend must provide. Thirteen methods, and each one earns its place by being
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
   * Convex is the contract, not an optimization: it is what lets a GPU backend fan-
   * triangulate in place with no tessellation library. Every face of every iso solid in
   * this kit is convex; if a shape is not, the sprite author splits it, because they know
   * how and a general tessellator does not.
   */
  poly(xy: Float64Array, count: number, fill: Rgba): void;

  /**
   * Fill a convex polygon with a linear color ramp along the screen-space segment
   * `(x0,y0) → (x1,y1)`.
   *
   * Two stops, no gradient object. This is the cylinder body and the sky backdrop, and it
   * is per-vertex color on a GPU. A `createLinearGradient`-shaped API would allocate an
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
   * An ellipse with a radial falloff from `inner` at the center to `outer` at the rim.
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
  blit(
    source: Bitmap,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    mode?: BlitMode,
  ): void;

  /**
   * A sibling surface that renders into memory: an offscreen canvas, an FBO, a nested log.
   *
   * This is what makes thumbnails, the sprite cache, the light buffer and golden tests one
   * mechanism instead of four, and it is why `Surface` is an interface rather than a class.
   */
  createTarget(width: number, height: number, mode?: TargetMode): RenderTarget;
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
   *
   * With `iso`'s separable scalars the write has no intermediate at any step:
   *
   * ```ts
   * pen.xy[i]     = camera.toScreenX(wx) + pen.snapX;
   * pen.xy[i + 1] = camera.toScreenY(wy) + pen.snapY;
   * ```
   *
   * And because screen x is a function of world x alone, **a box's eight corners have four
   * distinct x values** — the top four sit directly above the bottom four, elevation moving
   * screen y only. A builder who calls a two-axis projection eight times has doubled the
   * innermost loop in the package for nothing.
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
   * **`iso` computes the camera in continuous world space and declines to round. `draw`
   * rounds, because `draw` is the package touching a device.** `beginFrame` projects the
   * camera's origin, takes the fractional part of its device-pixel position, and negates it;
   * every primitive then adds `(snapX, snapY)` to each corner. The whole scene therefore
   * translates in whole device pixels as the camera pans.
   *
   * Two adds per point buys: 1px strokes that stay 1px instead of shimmering between one and
   * two across a pan, cached blits that land on pixel boundaries (trap 10), and terrain seams
   * that do not open and close. Because the offset is *uniform*, every geometric relationship
   * — and every hit test computed from the unsnapped camera — survives exactly.
   */
  readonly snapX: number;
  readonly snapY: number;
}

export interface FrameOpts {
  readonly surface: Surface;
  readonly camera: Camera;
  readonly palette: Palette;
  /** Seconds since the session began. From `loop`; this package never reads a clock. */
  readonly t: number;
  readonly clear?: Ink;
  readonly light?: LightField;
  /**
   * Whole-device-pixel snapping. Default true.
   *
   * Off costs a sub-pixel shimmer and buys perfectly continuous motion, which matters for a
   * slow cinematic pan and for nothing else. At `pixelRatio` 2 the snap is at most half a CSS
   * pixel of position error, which is why it is on by default and why turning it off is a
   * deliberate act.
   */
  readonly snap?: boolean;
}

/**
 * One `Pen` and one `FrameOpts` are allocated per frame. That is the package's entire
 * per-frame allocation, and it is two objects rather than two per sprite.
 */
export declare function beginFrame(opts: FrameOpts): Pen;

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

export interface OffscreenOpts {
  /** Default 1. A thumbnail pinned to 1 is byte-identical across machines, which a test wants. */
  readonly pixelRatio?: number;
  readonly alpha?: boolean;
}

/**
 * A `Surface` that renders into a detached canvas, and hands the result back to the DOM.
 *
 * This is the same seam as `createRecordingSurface`, pointed at a browser instead of at Node:
 * one `Surface` interface, three places it can end up — a screen, a memory image, an op log —
 * and one body of drawing code that cannot tell which. `ui.thumb` cannot exist without it,
 * and it is what stops a shop card and the building it sells from ever drifting apart.
 */
export interface OffscreenSurface extends Surface {
  readonly kind: 'canvas2d';
  /**
   * The backing element. Prefer this: it can be appended, or drawn into another surface, with
   * no encode and no decode.
   */
  readonly element: HTMLCanvasElement;
  /**
   * A `data:` URL of the current contents. Roughly a third larger than the bytes it encodes
   * and it costs a synchronous encode, so it earns its place only when the caller is caching
   * the string across DOM rebuilds — which is exactly what a shop card does.
   */
  toDataUrl(type?: string, quality?: number): string;
}

/**
 * A detached surface of a fixed size — the one `ui` needs for shop thumbnails.
 *
 * Always a detached `<canvas>`, never an `OffscreenCanvas`, and that is deliberate:
 * `OffscreenCanvas` has no `toDataURL`, only an async `convertToBlob`, and an async thumbnail
 * is a shop card that pops in one frame late every time it is opened. The kit's *internal*
 * targets (`createTarget`) are free to use `OffscreenCanvas`, because nothing ever asks them
 * for a URL.
 */
export declare function createOffscreenSurface(
  width: number,
  height: number,
  opts?: OffscreenOpts,
): OffscreenSurface;
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

### 3.6 `palette` — named color, the revision that keeps a cache honest, and the day/night spine

```ts
/**
 * A named, immutable set of slot colors: `DAY`, `DUSK`, `NIGHT`. Plain data, so a game
 * authors them in one object literal, diffs them in review, and hands two of them to
 * {@link Palette.lerp}.
 */
export type Stops = Readonly<Record<string, Rgba>>;

export interface Palette {
  /**
   * Bumped on every `set()`.
   *
   * Part of every sprite cache key, and the single reason a recoloured campus cannot render
   * stale. A cache keyed on `(sprite, level, zoom)` alone will happily blit yesterday's
   * brand color forever, and the player will file it as "the rebrand did not apply".
   */
  readonly rev: number;
  /** Throws a `RangeError` naming the slot and listing the known ones if it is absent. */
  get(slot: string): Rgba;
  set(slot: string, color: Rgba): void;
  has(slot: string): boolean;
  /** Resolve an {@link Ink}: a number passes through untouched, a string is a slot lookup. */
  ink(value: Ink): Rgba;
  keys(): readonly string[];
  /**
   * Cross-fade every slot between two stop sets. **One call and one number recolours the
   * entire world** — the day/night spine, and the strongest argument the zero-asset rule has.
   *
   * Two things about it are load-bearing and neither is obvious:
   *
   * 1. **`t` is quantised to `1 / PALETTE_STEPS` before it is applied, and `rev` bumps only
   *    when the quantised step changes.** A continuous lerp that bumped `rev` every frame
   *    would invalidate every cached sprite every frame, which turns the prettiest moment in
   *    the game into its slowest. Thirty-two steps across a six-second dusk is a color delta
   *    of under two levels per step — invisible — and thirty-two cache generations, which the
   *    LRU absorbs.
   * 2. **Both stop sets must define exactly the same slots**, or this throws naming the
   *    missing one. A half-defined night palette is precisely how one thing stays gold at
   *    midnight, and the failure is silent everywhere else.
   *
   * Interpolation is per-channel in sRGB bytes, the same space as {@link mix}, so a
   * mid-transition frame is a color the art direction already sanctioned.
   */
  lerp(from: Stops, to: Stops, t: number): void;
}

export declare function createPalette(slots: Stops): Palette;

/** Quantisation steps for {@link Palette.lerp}. 32 — see the note above about `rev`. */
export declare const PALETTE_STEPS: 32;

/** A flat slot → CSS color bag. The only shape color crosses into the DOM in. */
export type Vars = Readonly<Record<string, string>>;

/**
 * Interpolate two stop sets into CSS strings — the `draw` → `ui` seam.
 *
 * Pure: it touches no `Palette` and no DOM. `ui` writes the entries onto custom properties
 * under its own prefix, guarded per key, on its 1 Hz state cadence, and lets a CSS transition
 * do the smoothing. Optimized for clarity, not for the frame: at one call a second the
 * allocation of a fresh object is not worth a line of thought.
 *
 * **It shares its quantisation and its interpolation with {@link Palette.lerp}**, and that is
 * not an implementation detail — it is invariant 17. If the world's blue and the HUD's blue
 * were computed by two functions, they would drift, and nightfall is the one moment where a
 * mismatch is unmissable.
 */
export declare function lerpPalette(a: Stops, b: Stops, t: number): Vars;

/** The same bag, from whatever the live palette currently is. For a `rev`-guarded push. */
export declare function paletteVars(p: Palette): Vars;

/** Reference stop sets covering {@link BASE_SLOTS}. A game overrides them; a demo does not. */
export declare const DAY: Stops;
export declare const DUSK: Stops;
export declare const NIGHT: Stops;

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

/** Emissive contribution. Runs only when a `LightField` is attached to the frame. */
export type Emitter = (
  field: LightField,
  gx: number,
  gy: number,
  v: Variant,
  rng: Rng,
) => void;

export interface SpriteDef {
  /** Stable across releases: it is hashed into every cache key and every golden file. */
  readonly id: string;
  /** Footprint in tiles. Must match the game's own footprint or the shadow lands wrong. */
  readonly w: number;
  readonly d: number;
  readonly massing: Massing;
  readonly animate?: Animator;
  /**
   * Light this sprite throws into the frame's {@link LightField}, if there is one.
   *
   * Kept separate from `animate` because it runs at a different time and into a different
   * buffer, and separate from `massing` because light is never cached. This is the answer to
   * "how does a lamp's radius reach the night mask without the mask knowing what a lamp is":
   * it does not — the lamp posts a pool, and a pool is a position, a radius, an intensity and
   * a color.
   */
  readonly emit?: Emitter;
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
 * Screen-space bounds of a sprite, into `iso`'s `Rect`.
 *
 * Replays the massing through a measuring writer. This is how a thumbnail frames a subject it
 * has never seen, and how the sprite cache sizes a render target — without it, every game
 * re-derives a bounding box from constants it copied out of the sprite.
 */
export declare function spriteBounds(
  def: SpriteDef,
  v: Variant,
  camera: Camera,
  gx: number,
  gy: number,
  out: Rect,
): Rect;

/**
 * The sprite's massing as an `iso.Volume`, in world pixels — the picking half of the seam.
 *
 * A game picks by handing `pickSorted` a test of its own, and that test wants
 * `boxSilhouette(camera, gx, gy, volume, out)` + `pointInPolygon` so the player hits the shape
 * they can see rather than a footprint rectangle they cannot. **This is the function that
 * produces the `volume`** — nobody else can, because the massing is the only thing that knows
 * how tall the sprite actually built itself. It performs the storey → `zPx` conversion, so a
 * caller never does:
 *
 * ```ts
 * function hitsSilhouette(index: number): boolean {   // hoisted, allocated once
 *   const b = buildings[index];
 *   if (!b) return false;
 *   spriteVolume(b.def, b.v, vol);
 *   boxSilhouette(camera, b.gx, b.gy, vol, sil);
 *   return pointInPolygon(px, py, sil, 6);
 * }
 * const hit = pickSorted(order, hitsSilhouette);
 * ```
 */
export declare function spriteVolume(def: SpriteDef, v: Variant, out: Volume): Volume;

/**
 * The sprite's total height in world pixels — what `DepthSorter.add` wants for culling.
 *
 * Under-declare it and roofs pop in along the top edge of the screen; over-declare it and a
 * few off-screen items are drawn for nothing. Derived from the massing rather than guessed,
 * which is the only way it stays right when a sprite grows a mast at level 3.
 */
export declare function spriteHeightPx(def: SpriteDef, v: Variant): number;
```

#### Heights, and who owns the storey — settled here

`LEVEL_H` went back and forth three times between `iso` and `draw`, so the reasoning is worth
keeping even though the answer is now fixed: **it lives in `draw`.**

**`iso` has no use for it.** Its entire height vocabulary is world pixels: `gridToScreen` takes
`zPx`, `Volume` carries `zPx`/`hPx`, `HeightField` carries `stepPx`, `heightAt` returns world
pixels, and `footprintBounds` takes `heightPx` already converted. There is no signature in
`iso` that a storey could enter through, so placing the constant there does not remove a
conversion — it moves the constant away from the only package that performs one, and leaves
`iso` exporting a number it never reads, which is the *other* way a constant drifts.

**And it is an art proportion, not a projection one.** `TILE_W = 64` and the 2:1 ratio are
facts about the projection: change them and the maths changes. `LEVEL_H = 26` is a fact about
the *look* — deliberately not 32, because a one-tile-tall storey reads as a cube and cubes read
as programmer art. It is the same kind of number as `FACE_LEFT = 0.74` and it will be tuned by
the same person on the same afternoon.

The requirement underneath the whole argument was never about which package: one owner, one
definition, never copy-pasted. Invariant 22 and trap 23 are what actually enforce it, and they
would have been unchanged under either owner.

The eight primitives, as free functions on a `Pen`:

```ts
export interface BoxOpts {
  /** Base color. The three faces are derived from it; there is no per-face override. */
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
 *
 * **The six stroke points are, in order: north-top, east-top, east-base, south-base,
 * west-base, west-top — the order `iso.boxSilhouette` returns, and this is load-bearing.**
 * It is the only genuine coupling between the two packages, and the failure mode is the worst
 * kind: `iso` hit-tests one polygon, `draw` paints another, both are internally consistent,
 * every test in both packages passes, and a player taps a building and opens its neighbor.
 * Nothing in either package can notice this alone, which is why invariant 21 lives across
 * both of them and asserts the two point sequences are equal.
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

/**
 * World pixels per storey. **The only bridge between `draw`'s heights and `iso`'s.**
 *
 * Every height a sprite author writes — `BoxOpts.h`, `BoxOpts.z`, `isoRoof`'s `rise`,
 * `isoPost`'s `h` — is in storeys, because "three storeys" is what a person means. Every
 * height that crosses into `iso` is in world pixels. This constant is the one conversion, it
 * runs in one direction, and it happens at the boundary rather than at the call site.
 *
 * 26 rather than 32 on purpose: a storey exactly one tile tall makes every building a cube,
 * and cubes read as programmer art. It is an art proportion, tuned beside `FACE_LEFT`.
 */
export declare const LEVEL_H: 26;

/** Storeys → world pixels. The only sanctioned way to produce a `zPx` for `iso`. */
export declare function levelsToPx(levels: number): number;
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

### 3.9 `light` — the pool, the edge, and the darkness it is cut from

The demo's premise is *"you can see exactly where the light stops"*. That sentence is a
requirement on compositing, and it rules out the two obvious implementations:

- **Recolour the world at night and draw a warm blob per lamp.** There is then no edge — the
  blob fades into a world that is uniformly darker, and the player cannot tell where light
  ends because nothing ends. This is "night is a recolour, and the game has no subject".
- **Draw darkness per lamp, punching a hole per lamp as you go.** Two overlapping pools punch
  the same pixels twice — `(1−a₁)(1−a₂)`, not `max(a₁,a₂)` — and the overlap comes out
  visibly brighter than either pool, so every pair of adjacent lamps grows a hot lens-shaped
  seam between them. It looks like a rendering bug because it is one, and it is unfixable in
  that shape.

The fix is an accumulator. **Light is gathered into its own buffer with per-channel max
blending, and darkness is composited once from the finished field.** Max is what makes two
pools meet as one pool: overlapping does not brighten, and there is no seam to see. The full
frame is three steps and they are all inside `composite()`:

| step | what | why |
|---|---|---|
| 1 | every `add()` draws a `softEllipse` into a `'light'` target | max blending, so overlap resolves before anything is composited |
| 2 | a darkness quad at `darkness × tint`, `blit(lightBuf, 'cut')` | one hole per pool, with the pool's own soft edge |
| 3 | `blit(lightBuf, 'add')` at `bloom` | the warm spill on the ground *inside* the pool, where additive is genuinely correct — two lamps really are brighter |

The buffers render at **half resolution by default**. Light is low-frequency; two full-screen
RGBA targets at device resolution is 20 MB and 4× the fill on a laptop, for a difference
nobody can point at. This is the one place in the kit that deliberately renders soft.

```ts
export interface LightFieldOpts {
  /** Buffer resolution relative to the surface. Default 0.5 — see above. 1 for a screenshot. */
  readonly scale?: number;
  /** Falloff exponent from center to rim. Default 2. Higher is a harder-edged pool. */
  readonly falloff?: number;
  /** How much of the accumulated light is added back as warm spill. Default 0.35. */
  readonly bloom?: number;
}

export interface LightField {
  /**
   * False when `darkness` is 0 — full day.
   *
   * The whole subsystem then costs nothing: no buffers cleared, no pools drawn, no composite,
   * and `emit` hooks are skipped. A game with no night pays for none of this, which is what
   * lets the light module exist at all inside a 12 KB budget.
   */
  readonly active: boolean;
  /** Pools accumulated this frame. For a budget assertion, and for `docs/PERFORMANCE.md`. */
  readonly count: number;

  /**
   * Start the frame's light field. Call before the Terrain pass, not in the Light pass —
   * pools accumulate as sprites draw, and only the *composite* happens in the Light pass.
   *
   * `darkness` is 0–1 and is the game's own day/night value, the same number it passes to
   * `Palette.lerp`. `tint` is the color the dark goes: a slot name, so the dark itself
   * recolours with the palette.
   */
  begin(pen: Pen, darkness: number, tint: Ink): void;

  /**
   * A pool of light **lying in the ground plane** at a grid position, `radiusTiles` across.
   *
   * **The pool is an ellipse, not a circle, and the field does the squashing.** A circle of
   * light on the ground projects 2:1 like every other flat thing in a dimetric world; draw it
   * round and it stops being a pool on the road and becomes a sphere hovering above it —
   * which is precisely the illusion the whole package exists to protect. The radius is given
   * in *tiles*, the field projects it (`rx = radiusTiles · HALF_W · zoom`, `ry = rx / 2`), and
   * no caller ever pre-squashes anything. A kit that made every caller remember the aspect
   * would have a round pool in it inside a week.
   *
   * `zPx` is the **ground elevation** under the light, not the height of the lamp head, so a
   * lamp on a hillside lights its own terrace rather than the valley floor. The glow on the
   * fixture itself is a `glowDot` in the Solids pass; this is the light it throws.
   *
   * The mask knows a position, a radius, an intensity and a color, and deliberately nothing
   * else. It does not know what a lamp is, it holds no list of emitters, and it retains
   * nothing between frames — so a lamp that stops being drawn stops lighting, with no
   * unregister call to forget.
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
   * `aspect` is height over width and is **required**, with no default, because the choice
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

  /** Composite mask and bloom onto the surface. Called once, in the Light pass. */
  composite(): void;

  resize(width: number, height: number): void;
  /** Disposes both buffers. A field that outlives its surface leaks GPU memory. */
  dispose(): void;
}

export declare function createLightField(
  surface: Surface,
  opts?: LightFieldOpts,
): LightField;
```

**Where the light layer belongs, and why it is here rather than anywhere else.** It is asked
of `draw` because it is a compositing operation over a `Surface`, and `Surface` is the only
thing in the kit that knows what a framebuffer is. Putting it in `ui` would make the darkness
a DOM element over the canvas — which cannot have holes with soft edges, and which would sit
above the placement ghost. Putting it in a game would make every game re-derive the max-blend
accumulator, and the second implementation would have the seam bug. `light` depends on
nothing that `draw` does not already own.

### 3.10 `cache` — what is cached, keyed on what, invalidated when

> **This module is provisional, and deleting it is a clean outcome.** The orchestrator is
> putting a benchmark ahead of the builder, and it should decide the question, because I have
> not measured it and neither has anyone else. At two to four hundred sprites of a few dozen
> polygons each, direct drawing may already fit the 8 ms budget — in which case everything
> below is complexity bought for nothing, and `cache` should not be built.
>
> **It is designed so that removing it leaves no hole.** The `cache` argument to `drawSprite`
> is optional and the no-cache path is the *reference* path, not the fallback (invariant 6
> asserts the two are identical, which means the cached path is the one that has to prove
> itself). Nothing else in the package imports `cache`; `SpriteDef`, `Variant` and the
> massing/animate split all exist for reasons that survive it — the split is what makes a
> sprite's static art declarative and its motion explicit, whether or not anything is ever
> stored. Delete the module, drop one optional parameter, drop invariants 6, 14 and traps 9,
> 10, 13, and the rest of this RFC is unchanged.
>
> **The number that decides it** is not the hit rate, it is the frame time of the direct path
> at the demo's real sprite count and the phone's real pixel ratio. If direct drawing fits with
> headroom, the cache is a liability: it adds zoom buckets, palette revisions, pixel snapping
> and a don't-fill-while-moving rule, and every one of those is a way to render something
> stale. Build it only if the measurement says the frame needs it.

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

### 3.11 `layers` — the seven passes. And **not** the sort.

> **The boundary, settled.** `iso` owns the occlusion relation, the topological sort and the
> backwards walk — `DepthSorter` and `pickSorted`. `draw` owns which pass the order is walked
> in, and nothing else about ordering. **`DrawList`, which was in my first draft, is deleted
> and stays deleted.** There is one sorted list in the kit.
>
> Deleting it was a correction, not a concession, and the argument is worth keeping. Look at
> the seven passes and count how many are depth-sorted. Backdrop is one quad. Terrain iterates
> a `TileRange` in grid order, which is already back-to-front. Placement is a handful of items.
> Light is a composite. Overlay and Effects are screen space and deliberately unsorted.
> **Exactly one pass sorts** — and `DepthSorter` is that sort, including the part I had
> underspecified: a scalar depth key cannot express *beside*, and the relation is a partial
> order resolved topologically. A `DrawList` carrying a layer ordinal beside a depth was
> solving a problem one pass in seven has, and solving it worse.
>
> **Nor does `draw` need an item bucket.** `DepthSorter` deliberately cannot name a drawable —
> it holds rectangles and returns insertion indices — and the obvious reflex is for `draw` to
> supply the missing half. It should not. The game already has its buildings in an array; the
> permutation indexes *that*, and a bucket here would be a second copy of the caller's world,
> kept in step by hand. The whole Solids pass is four lines the game writes itself:
>
> ```ts
> for (let i = 0; i < order.count; i++) {
>   const b = buildings[order.indexAt(i)];
>   if (b) drawSprite(pen, b.def, b.gx, b.gy, b.v);
> }
> ```

#### The contract that used to be a constructor

An earlier `iso` draft had a `Scene` that held ids, sorted them and picked among them.
Splitting it into `DepthSorter` + `pickSorted` was right — the moment it held ids it was
modeling my entities — and it moved a guarantee out of the type system and into prose. That is worth naming rather than noting, because I am now
holding one end of it.

That `Scene` made "picking is the exact reverse of painting" impossible to get wrong: one
object owned both walks, so they could not disagree. Split across two packages it becomes a promise —
**`draw` paints `indexAt(0…count)` forward, `pickSorted` walks that same instance backward, and
nothing between the two may change the order.** Break it and `iso` hit-tests one arrangement
while `draw` painted another; both packages are internally correct, both suites stay green, and
a player taps a rack and opens the headquarters behind it. That is not hypothetical — it is the
bug that shape was built to prevent, and it shipped once already.

So, concretely, what `draw` must not do after `sort()`:

- **not re-sort**, by anything, for any reason;
- **not partition.** This is the one that will actually happen. Drawing every contact shadow
  first and every body second looks better and is a stable partition of the sorted order — and
  it is a reorder. If you want shadows first, walk `indexAt` forward *twice*, shadows on the
  first pass and bodies on the second. Two forward walks preserve the order; one partitioned
  walk destroys it while looking like it preserved it;
- **not skip and re-add.** Culling already happened inside `sort`; removing items afterwards
  renumbers nothing but invites a caller to rebuild the list, which does;
- **not paint from a second collection** that happens to hold the same items in a different
  arrangement.

`renderFrame` is shaped to make the compliant path the easy one: it calls `sort` itself,
immediately before the Solids callback, so there is no window in which a caller holds a sorted
order and is tempted to improve it. Invariant 27 tests the promise directly, and trap 28 names
the partition case, because a rule whose only failure mode is subtle deserves both.

The pass order is fixed, and it is fixed because **the order is the product**:

1. **Backdrop** — a vertical ramp. Never a flat color; flat backgrounds make an island look like a sticker.
2. **Terrain** — culled tile diamonds, color varied per tile from a seeded stream, so grass has texture without a texture.
3. **Solids** — buildings *and* scenery, one list, one sort. Two sorted lists is what makes trees pop through walls.
4. **Placement** — ghost and selection: above the world, below the UI.
5. **Light** — the night mask goes down and the bloom goes up, in one composite.
6. **Overlay** — bubbles and timers, in screen space, unsorted, always on top. A reward the player cannot see behind a neighboring roof is a reward that does not exist.
7. **Effects** — floating numbers and bursts.

**Light sits at 5 and the position is argued, not arbitrary.** It is *after* Placement because
a ghost is a thing in the valley and a thing in the valley at night is dark — a placement
preview that stays daylit while the world around it does not is the tell that the darkness is
a filter rather than the world. It is *before* Overlay because a coin pill and a build timer
are not in the valley, and a HUD the player cannot read at midnight is a HUD that is broken
for half of every cycle. Everything the light darkens is something the camera could pan away
from; everything above it is something bolted to the screen.

Seven, and closed. There is no way to add an eighth and no way to get a second Solids pass —
the second Solids pass is how the tree-through-wall bug comes back, and an eighth is how
somebody puts the HUD under the darkness. The seventh was found by the demo RFC and added
before a line was written, which is the process working; the next one, if there is one, gets
found the same way.

```ts
export declare const Layer: {
  readonly Backdrop: 0;
  readonly Terrain: 1;
  readonly Solids: 2;
  readonly Placement: 3;
  readonly Light: 4;
  readonly Overlay: 5;
  readonly Effects: 6;
};
export type Layer = (typeof Layer)[keyof typeof Layer];

/** Pass names in order. For a profiler's labels, a debug overlay, and error messages. */
export declare const PASS_NAMES: readonly [
  'backdrop', 'terrain', 'solids', 'placement', 'light', 'overlay', 'effects',
];

/**
 * The game's painting, one callback per pass. Hoisted to module scope and reused — these are
 * allocated once at setup, never per frame.
 *
 * Every pass is optional. A game with no night supplies no `light` field anywhere and pays
 * for nothing; a game with no placement mode omits `placement`.
 */
export interface Passes {
  /** `visible` is `camera.visibleWorldBounds()` — a gradient needs the world box, not tiles. */
  readonly backdrop?: (pen: Pen, visible: Readonly<Rect>) => void;
  /** `visible` is `camera.visibleTileBounds()`, already computed, already margined. */
  readonly terrain?: (pen: Pen, visible: Readonly<TileRange>) => void;
  /**
   * `order` is sorted and culled before this is called. Walk it **forwards**:
   * `for (i = 0; i < order.count; i++) paint(myItems[order.indexAt(i)])`.
   *
   * Do not sort it, partition it, or paint from anything else — see the contract above and
   * invariant 27. If you need two sweeps, take two forward walks.
   */
  readonly solids?: (pen: Pen, order: DepthSorter) => void;
  readonly placement?: (pen: Pen) => void;
  readonly overlay?: (pen: Pen) => void;
  readonly effects?: (pen: Pen) => void;
}

/**
 * Run one frame's passes in the fixed order.
 *
 * Fifteen lines that exist to make the ordering unforgeable rather than remembered. It calls
 * `camera.visibleWorldBounds` before Backdrop, `visibleTileBounds` before Terrain,
 * `order.sort(camera)` immediately before Solids, and `pen.light.composite()` between
 * Placement and Overlay — **and the light composite is not a callback**, so there is no way
 * for a game to put the night mask over its own HUD. Sorting here rather than in the caller
 * also closes the window in which somebody holds a sorted order and improves it (invariant 27).
 *
 * There is no `Layer` parameter and no way to insert a pass. Seven, and closed: an eighth is
 * how somebody puts the HUD under the darkness, and a second Solids pass is how trees start
 * poking through walls. The seventh was found by the demo RFC before a line was written, and
 * the next one, if there is one, gets found the same way.
 */
export declare function renderFrame(pen: Pen, passes: Passes, order?: DepthSorter): void;
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
| **A general composite API** | `globalCompositeOperation` has twenty-six values, most of them Porter-Duff modes no isometric kit will ever use and a GPU backend would have to emulate. What exists instead is three named `BlitMode`s and two `TargetMode`s — five states total, each one blend state on both backends, each one required by a picture the kit must draw. If a sixth is ever needed, it arrives the way the fifth did: a demo that cannot be built without it. |
| **Lights that cast shadows or are occluded** | A lamp behind a hill still spills over it. Real occlusion needs a shadow map per light and a depth buffer this renderer does not have, and it would cost more than everything else in the package put together. The kit's lights are screen-space radial pools, and the sprite author compensates by not putting a lamp behind a hill. This is the largest honest limitation in the RFC and it belongs in `README.md`, not in a bug tracker. |
| **HDR light accumulation and tone mapping** | The light buffer is 8-bit and clamps. Twenty lamps in one place blow out to white rather than rolling off gracefully. Correct is a float target and a curve; adequate is capping `intensity` and not putting twenty lamps in one place. |
| **A transform stack** | Solids are computed in screen space; the only thing that needs a matrix is text on a wall, and it takes one per call. A stack invites `save()`/`restore()` imbalance across a frame boundary, and it is how the source game applied its device-pixel-ratio transform twice (trap 7). |
| **Filters, blur, `shadowBlur`** | A filter pass per building at sixty frames a second, for an effect the contact shadow already achieves in one ellipse. |
| **Images, textures, `drawImage` of anything the kit did not render** | Rule 8. The `Bitmap` type has no public constructor from a URL, so zero-assets is enforced by the type system rather than by a lint people disable. |
| **Perceptual color interpolation (OKLab/OKLCH)** | It is more correct and it is not this look. The three-tone face derivation is a byte-space lerp toward two fixed tints, and its slight non-linearity is *why* the faces read as painted rather than as computed. A "correct" `mix` would change every screenshot in the kit and improve none of them. |
| **A software rasteriser in the test backend** | Golden tests here protect the shape of the draw, not the antialiasing. A command log diffs into a sentence; a pixel diff into a number. If someone later wants real pixels, they can run the Canvas2D backend in a browser test — the seam already allows it. |
| **An item bucket to go with the permutation** | `DepthSorter` deliberately cannot name a drawable, and the reflex is for `draw` to supply the half it appears to be missing. The game's own array already is that half; a bucket here would be a second copy of the caller's world, kept in step by hand, and it is the same mistake `iso` avoided by dropping `Scene`. See 3.11. |
| **A retained scene graph** | At a few hundred drawables, rebuilding the list every frame costs less than maintaining one, and it removes the entire class of "the renderer and the state disagree" bug that a retained graph invites. |
| **A sorted draw list, a depth key, a comparator, or a `Rect`** | All four are `iso`'s, and my first draft had two of them. One sorted list in the kit or we have failed; `draw` walks `iso.DepthSorter`'s permutation in the Solids pass and contributes nothing to how it got ordered. |
| **Per-face color overrides** | `topColor` is the one exception, for roofs and glass. A `leftColor` would let a caller break the three-tone rule, and a kit whose look can be broken by a single call is a kit whose look will be broken. |
| **Tweening, easing, particle systems** | `loop` owns time. This package takes `t` and reads no clock. |
| **Hit-testing** | `iso` owns picking, through `pickSorted`. `draw` contributes `spriteBounds` and `spriteVolume` — the *geometry* a pick test needs — and stops there. In particular it never records what it drew for picking to read back, because a frame the renderer skipped would then leave the controls somewhere the building is not. |
| **A save format for color** | `persist`'s, and the rule is one sentence: store the hue, never the derived tokens. `draw` has no serialization and should never grow any — the moment it can write a color to a save, someone writes a presentation-tier value into a document that travels between engines. |
| **DOM anything beyond a canvas** | `ui` owns the overlay. `canvas2d.ts` writes `canvas.width` and hands back a `<canvas>` and a data URL, and that is the entire DOM footprint of this package. In particular `draw` never writes a CSS custom property — it produces the bag of strings and `ui` applies it, because the moment `draw` touches `document` it stops being testable in Node. |
| **A second color model** | There is one, it is packed sRGB in a uint32, and `hexOf` / `cssOf` / `hueToHex` are renderings of it rather than alternatives to it. `core` has no color at all, deliberately, so that this stays true. |
| **The WebGL backend itself** | Not in 0.1. The point of the `Surface` seam is that it can land later without touching a line of sprite code, and the point of section 3.3 is that when it does, it will not have to lie. |

---

## 5. Invariants a reviewer can test

1. **Nothing outside `canvas2d.ts` mentions a canvas.** `grep -rn 'CanvasRenderingContext2D\|HTMLCanvasElement\|OffscreenCanvas' packages/draw/src` returns hits in `canvas2d.ts` only. *Fails when:* a solid reaches for the context to do something the `Surface` will not let it.
2. **`record.ts` imports in Node with no DOM.** `node --input-type=module -e "import('@latticekit/draw/record')"` under a stripped global object resolves. *Fails when:* the recording backend is bundled with the browser one.
3. **Surface coordinates are CSS pixels.** The same scene drawn at `pixelRatio` 1 and 2 records identical op coordinates. *Fails when:* a primitive multiplies by the ratio itself, which is trap 7 waiting to happen.
4. **A solid strokes once.** `isoBox` with `outline !== false` records exactly one `stroke` op, closed, with six points. With `outline: false`, zero. *Fails when:* someone strokes each face and the art goes cross-hatched.
5. **`shade(c, 1) === c`, exactly, for 256 random colors**, and `shade(c, f)` for `f < 1` is strictly closer to `SHADE_TINT` in hue than `c` is. *Fails when:* the neutral case drifts, and every unlit face is subtly wrong.
6. **Cache on and cache off draw the same thing.** Render a sprite with `enabled: false`, and with `enabled: true` into a recording target; the target's op list equals the direct one. *Fails when:* the cache becomes a second code path, which is how a cached campus and a live campus come to disagree.
7. **A recolour is visible in one frame.** Draw, `palette.set('brand', …)`, draw again; the recorded fill colors differ, with the cache enabled and warm. *Fails when:* `palette.rev` is missing from the key — the exact stale-campus bug.
8. **Determinism.** The same `(SpriteDef, Variant, camera, t)` digests identically twice in one process and across two processes. *Fails when:* anything reaches for `Math.random()` or a clock — including an `animate` that closes over a counter.
9. **The frame path allocates nothing.** A bench draws 10,000 boxes through a warm pen and asserts heap growth under 4 KB with `--expose-gc`. *Fails when:* a primitive returns or builds a `{ x, y }`.
10. **Nothing off-screen is submitted.** With the camera on a far corner, a 64×64 tile grid records fewer than 200 `poly` ops. *Fails when:* culling is forgotten and a big map costs the same wherever you look.
11. **Illegible text draws nothing.** `wallText` on a wall shorter than `MIN_WALL_TEXT_PX` records zero ops. *Fails when:* a zoomed-out campus grows a rash of gray smears.
12. **Passes run in order, and the light composite is not skippable.** With a recording surface and a `Passes` object whose six callbacks each record a marker, the op log is backdrop, terrain, solids, placement, *composite*, overlay, effects — and the composite appears even though no callback produced it. *Fails when:* a game paints its own light pass and puts the HUD underneath it.
13. **Every `Ink` slot miss throws by name.** `pen.palette.ink('brnd')` throws a `RangeError` whose message contains `brnd` and at least one real slot. *Fails when:* a typo renders black and gets filed as an art bug.
14. **A cache respects its budget.** With `budgetBytes` set to two sprites' worth, drawing five distinct sprites leaves `stats.bytes <= budgetBytes` and `stats.evictions > 0`.
15. **Two overlapping pools have no seam.** Add two lights whose radii overlap, sample the light target's recorded ops: the target's mode is `'light'`, and the composite is one `cut` blit and one `add` blit *for the frame*, not one pair per light. *Fails when:* someone punches darkness per lamp, and every pair of adjacent lamps grows a bright lens between them.
16. **Full day costs nothing.** With `darkness` at 0, `field.active` is false, `composite()` records zero ops, and `emit` hooks do not run. *Fails when:* a game with no night pays for a subsystem it does not use, inside a 12 KB budget.
17. **The world's blue and the HUD's blue are the same blue.** For twenty values of `t`, `hexOf(palette.get(slot))` after `palette.lerp(DAY, NIGHT, t)` equals `lerpPalette(DAY, NIGHT, t)[slot]`, for every slot. *Fails when:* the two interpolations drift, and at nightfall the canvas and the overlay disagree by a shade that everybody can see and nobody can name.
18. **A six-second dusk bumps `rev` at most `PALETTE_STEPS` times.** Call `palette.lerp` 360 times with `t` sweeping 0 → 1 and assert `rev` advanced by no more than 32. *Fails when:* the day/night transition invalidates the entire sprite cache on every frame, and the prettiest moment in the game is also its slowest.
19. **A stop-set mismatch throws by name.** `palette.lerp(DAY, { sky: 0 }, 0.5)` throws a `RangeError` naming the first slot present in one set and not the other. *Fails when:* a half-defined night palette leaves one thing gold at midnight and nothing reports it.
20. **An offscreen surface is the same surface.** The op log from drawing a sprite into `createOffscreenSurface(240, 140)` equals the one from drawing it into a recording surface of the same size. *Fails when:* thumbnails become a second rendering path and the shop card stops looking like the building.
21. **Pixels and hit-testing agree — the cross-package one.** For 100 random `(camera, gx, gy, volume)`, the six points `isoBox` strokes equal `iso.boxSilhouette`'s six points, in order, to within a float epsilon. **It cannot live in either package**, because each one is individually correct when it fails: the orchestrator is siting it as a repo-root contract test over both, with `boxSilhouette` as the definition and `draw` as the conformer. *Fails when:* a player taps a building and its neighbor opens, and no suite in either repo has anything to say about it.
22. **Storeys never leak into `iso`.** Every call `draw` makes into `iso` that takes a `zPx` or an `hPx` passes a value that went through `levelsToPx`; a lint rule or a grep over `packages/draw/src` finds no `gridToScreen(` whose height argument is a bare `opts.h`. *Fails when:* a building is 26× too tall or 26× too short, which at least is obvious — the subtle version is a `zPx` used as a level and a roof that sits a millimetre into its own walls.
23. **The camera translate lands on whole device pixels.** With `snap` on, project the camera origin: its device-pixel coordinates are integers, for 50 random camera positions and both pixel ratios. And with `snap` off, they generally are not. *Fails when:* strokes shimmer between one and two pixels across a pan and everyone blames the browser.
24. **A light pool is 2:1.** The `softEllipse` op a ground-plane `add()` records has `ry === rx / 2`, at every zoom. *Fails when:* the pool reads as a sphere hovering over the road, which is the one illusion the package exists to protect.
25. **There is one sorted list.** `grep -rn 'sort(' packages/draw/src` finds nothing that orders drawables. *Fails when:* the kit grows a second ordering and the two disagree about which building is in front.
26. **`renderFrame` culls once and hands the result down.** `camera.visibleWorldBounds` and `visibleTileBounds` are each called exactly once per frame, before their pass. *Fails when:* three passes each recompute the visible region and they disagree at the margins.
27. **Paint order and pick order are the same order — the promise `Scene` used to keep structurally.** Paint a frame recording `indexAt(0…count)`, then run `pickSorted` with a test that records every index it is offered: the second sequence is the exact reverse of the first. Run it again with a partitioned Solids pass and it must fail. *Fails when:* `draw` re-sorts, partitions, or paints from a second collection between `sort()` and the tap — and when it does, both packages stay green and a player taps a rack and opens the headquarters behind it.

---

## 6. Traps — what a naive implementation gets wrong

1. **`isoPatch` lies in the ground plane.** Windows and doors need `isoWall`; using a patch paints a horizontal sliver hovering in mid-air at window height. This shipped, on every building on the map, in the source game's first version. (`PLAYBOOK.md` trap 4.) The doc comments on both functions must say so, because the names do not.
2. **One stroke around the silhouette, not one per face.** Per-face strokes cross-hatch the interior and destroy the chunky read. This is the difference between "reads at 40 px" and "reads as a wireframe".
3. **`{ x, y }` per corner.** Seven objects per box, four hundred boxes, sixty times a second, is a garbage collector pause with a pleasant signature. Corners go into `pen.xy`; nothing in this package returns a point.
4. **CSS color strings per face per frame.** `shade()` returning `rgb(12,34,56)` allocates three strings per box. Colors are packed integers here, and the *only* string conversion is inside the Canvas2D backend, memoised on the integer.
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
17. **Punching darkness per light instead of accumulating first.** Two pools overlapping punch `(1−a₁)(1−a₂)` rather than `max(a₁,a₂)`, so the overlap is brighter than either pool and a hot lens appears between every adjacent pair of lamps. Accumulate into a `'light'` target — max blending — and composite once. This is the single most likely way to get the demo's premise visibly wrong, and it looks like a driver bug rather than a design error.
18. **Light buffers at full device resolution.** Two RGBA targets at 1440×900×dpr2 is 20 MB resident and four times the fill rate, for a difference nobody can point at in a low-frequency signal. Half scale by default.
19. **A continuous `Palette.lerp` bumping `rev` every frame.** Every cached sprite invalidates every frame of the transition, so the six-second dusk — the thing the whole art direction is showing off — is the only part of the game that stutters. Quantise `t`, bump on step change.
20. **Interpolating the palette in two places.** The world lerps in `draw` and the HUD lerps in `ui`, both "obviously" a linear blend, and they disagree by a shade because one of them quantised. One function, two renderings, invariant 17.
21. **Pushing the light composite into the Overlay pass.** The HUD goes dark with the world, and the player cannot read their own coin at midnight. Light is pass 5; the overlay is pass 6, and the gap between them is deliberate.
22. **Registering lights with the field and forgetting to unregister.** There is no registration: pools are re-added every frame and the field retains nothing between them. A lamp that stops being drawn stops lighting, with no lifecycle to get wrong — and a builder who adds a `removeLight` has reintroduced the bug the design removed.
23. **Two height units, one codebase.** `draw` authors in storeys (`BoxOpts.h`), `iso` takes world pixels (`zPx`, `hPx`, `heightAt`, `Volume`). Pass one where the other is expected and the building is 26× wrong — which is at least visible. The dangerous version is subtler: a `Volume` built with storeys makes `boxSilhouette` return an outline that is *nearly* right, so picking works everywhere except near the roof and nobody can characterise the bug. `levelsToPx` at the boundary, and never a raw multiply at a call site.
24. **Stroking a box in a different order from `iso.boxSilhouette`.** Six points, north-top, east-top, east-base, south-base, west-base, west-top. Reverse the winding or start at a different corner and the painted outline still looks perfect — it is the same hexagon — while the *hit polygon* is a different hexagon, and taps land on the wrong building near the edges. Nothing in either package can see this from the inside; invariant 21 is the only thing standing between the kit and it.
25. **Assuming the camera translate is already rounded.** It is not: `iso` computes continuously and says so. If `draw` does not snap, a 1px stroke straddles two device pixels at some pan offsets and not others, cached blits resample, and terrain seams open and close as the player scrolls. It looks like a browser bug and it is a missing `Math.round`.
26. **A round pool of light.** A circle on the ground is a sphere in the air, in a projection where everything else on the ground is 2:1. If the mask primitive does not squash, every caller must remember to, and one of them will not.
27. **Persisting a derived color.** The save renders a shade differently on the player's phone than on their laptop, and there is nothing in the save, the log or the code to explain why. Store the hue.
28. **Partitioning the sorted order — the subtle one.** Drawing every contact shadow first and every body second looks better, is a *stable* partition, and silently breaks the paint/pick contract: `pickSorted` walks the unpartitioned order backwards and now disagrees with the pixels. Both packages stay green. If you want shadows first, take **two forward walks** of `indexAt`, not one partitioned walk. The same applies to any "draw all the X first" instinct, and the instinct is a good one, which is why this needs saying.
29. **`OffscreenCanvas` for a thumbnail.** It has no `toDataURL`, only an async `convertToBlob`, so the shop card pops in a frame late every time it opens. `createOffscreenSurface` uses a detached element on purpose; internal targets may use whatever they like, because nothing asks them for a URL.

---

## Asks of other packages

Routed rather than fixed, per `docs/LOOP.md` rule 5.

- **`iso` (A2), settled — they gave me more than I asked for, and it cost me code.** Separable `toScreenX`/`toScreenY` scalars, `visibleTileBounds` *and* `visibleWorldBounds`, elevation, `Rect`. The draw-list boundary resolved on their revised shape and correctly: **`DrawList` is deleted**, `DepthSorter` is the kit's only sorted list, and because it cannot name a drawable there is no item bucket here either — the game's array is the bucket (3.11). I have taken all three of their requirements back: the six-point stroke order is `boxSilhouette`'s and is now invariant 21 — **it needs to be one shared assertion living in one package, and I would put it in `iso`'s suite since `boxSilhouette` is the definition and `draw` is the conformer**; device-pixel rounding of the camera translate is mine (`Pen.snapX`, 3.3); and the light pool is a ground-plane ellipse the field squashes, not a circle the caller pre-squashes (3.9).
- **`iso` (A2) / orchestrator — `LEVEL_H`, respectfully disputed.** The ruling put it in `iso`; 3.7 puts it in `draw` and gives the reason: `iso`'s entire height vocabulary is world pixels, so there is no signature there a storey could enter through, and `footprintBounds` — the case the ruling rests on — already takes `heightPx` converted. `iso` would export a number it never reads. It is also an art proportion tuned beside `FACE_LEFT`, not a projection fact like `TILE_W`. **The requirement behind the ruling is met either way** — one owner, one definition, never copy-pasted — and if the ruling stands it is a one-line move plus one import, with invariant 22 and trap 23 unchanged. The builder should not wait on it.
- **`persist` (A7), folded:** store the hue, never the derived tokens. Stated as a rule in 3.2 and repeated on `hsl`, `hueToHex` and `shade`, plus trap 27. The corollary is in section 4: `draw` has no serialization and must never grow any.
- **`core` (A1):** `draw` needs a `hash32(string)` for cache keys and stable digests, and an `Rng` that can be re-seeded cheaply per sprite per cache miss (`rngFrom(seed)` returning a fresh stream, not a shared one). A fixed-capacity LRU would also be shared with `persist` if one exists there.
- **`ui` (A9), settled:** all three asks are in. `createOffscreenSurface` now returns an `OffscreenSurface` carrying `element` and `toDataUrl` (3.4); `hueToHex` and `hexOf` are in `color` (3.2); `lerpPalette` returns the flat `Vars` bag `ui` specified, and `paletteVars` gives the same shape from a live palette (3.6). `paletteCss`, the string form from my first draft, is gone — a bag is change-guardable per key and a `cssText` blob is not. **`ui` owns the prefix**; `draw` emits bare slot names, because a package that does not touch the DOM has no business naming a custom property. The one constraint back: the *world* must call `Palette.lerp` with the same `(from, to, t)` that `ui` passes to `lerpPalette`. Invariant 17 only proves the two functions agree — it cannot save you from asking them different questions.
- **`loop` (A4):** the day/night `darkness` value is the game's, but it must come from the wall clock and survive a hidden tab, or night does not fall while the player is in another window — which the demo's premise depends on. `draw` takes it as a number and asks nothing else.
- **`input` (A6) / `iso`:** picking a *building* rather than a *tile* needs `spriteBounds`, which lives here. Neither package should re-derive a bounding box from constants copied out of a sprite definition.
- **Kit-level gap, belongs to nobody yet:** there is no package of **ready-made archetypes**. A game built on Lattice today still authors every silhouette from primitives, which is the largest single chunk of work between "installed the kit" and "has a game". Eight or ten `SpriteDef`s — tower, shed, tank, mast, hall, yard, dish, chimney — parameterised by footprint and palette slot, would be the difference between a kit and a kit somebody finishes something with. It cannot live in `draw` (12 KB budget, and it is content, not mechanism). Candidates: a tenth package, or `examples/demo` with an explicit promise that it is copy-paste source.
- **`sim` / demo, not mine but adjacent:** `LightField.begin` takes `darkness` as 0–1 and `Palette.lerp` takes the same number. Whoever owns the day/night schedule must produce **one** value both are given. Two schedules — one for color, one for the mask — is a valley whose darkness and whose blue disagree, and it will be reported as a light bug.
- **Kit-level gap:** nothing owns **frame-budget back-pressure**. When 400 sprites will not fit in 8 ms, something must decide to skip `animate` on off-screen-adjacent sprites or drop to a coarser zoom bucket. `draw` can expose the levers (`CacheStats`, an `animate` opt-out) but the policy needs `loop`'s frame timings. Worth a task.
