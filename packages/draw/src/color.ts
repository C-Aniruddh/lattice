/**
 * Color: one packed integer per color, and the three-tone face derivation the look rests on.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.** It is arithmetic over uint32s.
 *
 * ## The rule `persist` asked for, stated once here and again at every call site
 *
 * **A game persists the *input* to a color, never the output.** Store the player's brand hue
 * — one number — and re-derive every token from it on load. Never write a derived `#rrggbb`
 * into a save.
 *
 * Derivation is presentation-tier: it is allowed to use maths whose last unit may differ
 * between engines, because a pixel that differs in its last unit is a pixel nobody can see. A
 * *save file* that differs in its last unit is another matter entirely — it travels. Persist a
 * derived token and you have written an engine-specific artifact into a document that will be
 * opened on a different engine, and the player gets a campus that is a shade off on their
 * phone from what it is on their laptop, with nothing anywhere to explain it.
 *
 * ## Two alpha conventions, and why they are not a mistake
 *
 * | function | `a` is | because |
 * |---|---|---|
 * | {@link rgba} | 0–255 | its other three arguments are 0–255 |
 * | {@link hsl}, {@link withAlpha} | 0–1 | their other arguments are 0–1 |
 *
 * Each function's alpha matches the arguments beside it, which is the convention a caller can
 * actually hold in their head. Mixing them silently is the one way to get this wrong, so both
 * doc comments say which is which.
 *
 * **Everything here is Tier A** — `+ - * /`, comparisons and bitwise operators — including the
 * HSL conversion, which is written without `sin` or `pow` for exactly that reason. That is not
 * because a color is ever hashed (it must not be), but because it costs nothing here and it
 * keeps the greppable Tier B list in this package down to the one site that genuinely needs it.
 */

/**
 * A color packed as `0xRRGGBBAA` in a uint32.
 *
 * Not a CSS string. `shade()` in the source game returned `rgb(12,34,56)`, which meant three
 * fresh strings per box per frame — the largest single source of garbage in the renderer, and
 * invisible in a profile because strings die young. Packed integers compare with `===`, key a
 * `Map` with no hashing, and hand a WebGL backend its vertex color with two shifts.
 *
 * Always stored unsigned: every function here returns `>>> 0`, so `#ff0000` opaque is
 * `4278190335` and never `-255`. A signed one would still *render*, and would compare unequal
 * to the same color produced anywhere else, which is a cache key that never hits.
 */
export type Rgba = number;

/**
 * A color, or the name of a palette slot resolved at draw time.
 *
 * A slot name is what lets one campus recolour to a player's brand, and it is why a cache key
 * must carry `Palette.rev`. Passing an unknown slot throws naming the slot and listing the
 * ones that exist; a silent black is a bug report that says "the game looks wrong" and nothing
 * more useful than that.
 */
export type Ink = Rgba | string;

/** Clamp and round one channel. Non-finite becomes 0 rather than `NaN`, because a `NaN`
 *  channel propagates into a packed integer that is `NaN` and paints nothing, silently. */
function byteOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

/** Red channel, 0–255. Private: the packed form is the currency, and unpacking in game code is
 *  how a second color model starts. */
function redOf(color: Rgba): number {
  return (color >>> 24) & 255;
}

/** Green channel, 0–255. */
function greenOf(color: Rgba): number {
  return (color >>> 16) & 255;
}

/** Blue channel, 0–255. */
function blueOf(color: Rgba): number {
  return (color >>> 8) & 255;
}

/** Alpha channel, 0–255. */
function alphaOf(color: Rgba): number {
  return color & 255;
}

/**
 * Pack four channels. **All four are 0–255**, including `a`, which defaults to fully opaque.
 *
 * Values are clamped and rounded rather than rejected: a channel arrives from a derivation
 * that may legitimately overshoot — `shade(c, 1.4)` on an already-bright color — and throwing
 * there would make every highlight a caller's problem. Use {@link withAlpha} when your alpha
 * is a 0–1 fraction; passing `0.5` here is very nearly transparent, not half.
 */
export function rgba(r: number, g: number, b: number, a = 255): Rgba {
  return ((byteOf(r) << 24) | (byteOf(g) << 16) | (byteOf(b) << 8) | byteOf(a)) >>> 0;
}

/**
 * Relative brightness of each visible face. The sun sits high and front-left.
 *
 * `FACE_LEFT` is the face whose normal points along `+gy` — screen-left — and `FACE_RIGHT` the
 * `+gx` face. Swap the two and every building in the kit is lit from the wrong side, which
 * reads as "the art is flat" rather than as a bug, so it goes unreported.
 */
export const FACE_TOP = 1;
/** The `+gy` face — screen-left, and the lit one. See {@link FACE_TOP}. */
export const FACE_LEFT = 0.74;
/** The `+gx` face — screen-right, and the shaded one. See {@link FACE_TOP}. */
export const FACE_RIGHT = 0.52;

/**
 * Cool target that shadowed surfaces drift toward. **The whole trick, in one constant.**
 *
 * Shading toward blue in shadow and amber in light is what separates a stylised render from a
 * flat gray lerp. Neutralise this to gray and every screenshot still renders and every
 * screenshot looks like a placeholder.
 */
export const SHADE_TINT: Rgba = rgba(38, 46, 84);

/** Warm target that lit surfaces drift toward. See {@link SHADE_TINT}. */
export const LIGHT_TINT: Rgba = rgba(255, 226, 160);

/**
 * How far toward a tint a fully-dark or fully-bright face is pulled.
 *
 * Tuned beside `FACE_LEFT` and `LEVEL_H`, on the same afternoon, by the same person. Below
 * about 0.25 the faces read as a gray multiply; above about 0.6 every building in the world
 * has the same two colors in it and the palette stops mattering.
 */
const TINT_STRENGTH = 0.45;

/**
 * Derive a face color from a base color — the rule the whole look rests on.
 *
 * `factor` below 1 darkens *and* pulls toward {@link SHADE_TINT}; above 1 brightens and pulls
 * toward {@link LIGHT_TINT}. Tint strength scales with distance from neutral, so
 * `shade(c, 1) === c` **exactly** and nothing drifts by accident — which matters because a
 * top face is drawn at `FACE_TOP`, and a top face that is not bit-identical to the color the
 * caller asked for makes every golden test in a game a re-blessing exercise.
 *
 * Replace it with a plain multiply and the kit's art dies quietly.
 *
 * **Presentation only. Never persist what this returns** — store the base color and derive
 * again on load. A derived token in a save file is an engine-specific artifact in a document
 * that travels between engines.
 */
export function shade(base: Rgba, factor: number): Rgba {
  if (factor === 1) return base >>> 0;
  const tint = factor < 1 ? SHADE_TINT : LIGHT_TINT;
  // Distance from neutral, capped at one full step in either direction. Continuous at 1, so
  // an animated `factor` sweeping through neutral has no visible discontinuity.
  const distance = factor < 1 ? 1 - factor : factor - 1;
  const pull = (distance > 1 ? 1 : distance) * TINT_STRENGTH;
  const r = redOf(base) * factor;
  const g = greenOf(base) * factor;
  const b = blueOf(base) * factor;
  return rgba(
    r + (redOf(tint) - r) * pull,
    g + (greenOf(tint) - g) * pull,
    b + (blueOf(tint) - b) * pull,
    alphaOf(base),
  );
}

/** How far toward black an outline sits. Not zero: a pure black outline against a colored
 *  face is the tell of a renderer that treated the stroke as a border rather than as part of
 *  the art. */
const OUTLINE_FACTOR = 0.3;

/** The darkest any channel of an outline may get. Pure black outlines read as a wireframe at
 *  thumbnail size and crush the silhouette into a blob at full size. */
const OUTLINE_FLOOR = 8;

/**
 * The silhouette stroke for a solid: its own hue, very dark, never pure black.
 *
 * Derived from the solid's own color rather than fixed, so a brand recolour moves the
 * outlines with it. A shared constant outline is what makes a recoloured campus look like
 * stickers on a fixed drawing.
 */
export function outlineOf(base: Rgba): Rgba {
  const r = redOf(base) * OUTLINE_FACTOR;
  const g = greenOf(base) * OUTLINE_FACTOR;
  const b = blueOf(base) * OUTLINE_FACTOR;
  return rgba(
    r < OUTLINE_FLOOR ? OUTLINE_FLOOR : r,
    g < OUTLINE_FLOOR ? OUTLINE_FLOOR : g,
    b < OUTLINE_FLOOR ? OUTLINE_FLOOR : b,
    alphaOf(base),
  );
}

/**
 * Replace the alpha channel. **`a` is 0–1**; the rgb channels are untouched.
 *
 * The 0–1 form because every caller of this has a fraction in hand — an intensity, a ghost
 * opacity, a falloff — and none of them has a byte. See the module header's table.
 */
export function withAlpha(color: Rgba, a: number): Rgba {
  return ((color & 0xffffff00) | byteOf(a * 255)) >>> 0;
}

/**
 * Linear per-channel blend in sRGB bytes, alpha included. `t` is clamped to 0–1.
 *
 * **Deliberately not perceptual.** OKLab would be more correct and is not this look: the
 * three-tone face derivation is a byte-space lerp toward two fixed tints, and its slight
 * non-linearity is *why* the faces read as painted rather than as computed. A "correct" mix
 * would change every screenshot in the kit and improve none of them.
 */
export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return rgba(
    redOf(a) + (redOf(b) - redOf(a)) * k,
    greenOf(a) + (greenOf(b) - greenOf(a)) * k,
    blueOf(a) + (blueOf(b) - blueOf(a)) * k,
    alphaOf(a) + (alphaOf(b) - alphaOf(a)) * k,
  );
}

/**
 * How many packed colors the CSS memo holds before it is dropped wholesale.
 *
 * A palette plus its derived faces is a few hundred entries; anything past this is a caller
 * generating colors per frame, and an unbounded memo would then be a leak that looks like a
 * cache. Dropping everything rather than evicting one keeps this to two lines and costs a
 * handful of re-conversions on the frame it happens.
 */
const MEMO_LIMIT = 4096;

/**
 * Packed → `rgb()`/`rgba()`, memoised on the integer.
 *
 * The *only* memo in this module, and the asymmetry is the point: {@link cssOf} allocates a
 * string and runs inside a backend on every frame, so caching it removes garbage. {@link hex}
 * returns a primitive and is authoring-time by contract, so caching it would remove nothing and
 * add a `Map` to the package for the sake of a parse that happens thirty times at startup.
 */
const cssMemo = new Map<Rgba, string>();

/**
 * Packed color → a CSS `rgb()`/`rgba()` string, memoised. **Backends only; not for game code.**
 *
 * This is the *only* place in the kit where a color becomes a string, and it exists because
 * Canvas2D takes strings. Calling it from a solid would reintroduce trap 4 — three fresh
 * strings per box per frame — at the one layer that cannot see it happening.
 */
export function cssOf(color: Rgba): string {
  const key = color >>> 0;
  const hit = cssMemo.get(key);
  if (hit !== undefined) return hit;
  const a = alphaOf(key);
  const rgb = `${String(redOf(key))},${String(greenOf(key))},${String(blueOf(key))}`;
  const made = a === 255 ? `rgb(${rgb})` : `rgba(${rgb},${(a / 255).toFixed(3)})`;
  if (cssMemo.size >= MEMO_LIMIT) cssMemo.clear();
  cssMemo.set(key, made);
  return made;
}

/** Two hex digits, lower case, always padded. */
function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/**
 * Packed color → `#rrggbb`, or `#rrggbbaa` when it is not opaque. The DOM-facing form.
 *
 * `ui` writes these into custom properties. **The string this returns belongs in a stylesheet,
 * never in a save** — it is derived, and derived color is presentation-tier.
 */
export function hexOf(color: Rgba): string {
  const key = color >>> 0;
  const rgb = `#${hex2(redOf(key))}${hex2(greenOf(key))}${hex2(blueOf(key))}`;
  return alphaOf(key) === 255 ? rgb : `${rgb}${hex2(alphaOf(key))}`;
}

/**
 * Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into a packed color.
 *
 * **Authoring time only, never per frame.** It is here so a palette can be written as hex in a
 * source file, which is the form a designer hands over; the frame path never sees a string, and
 * that contract is why this is deliberately *not* memoised — see {@link cssMemo}.
 *
 * @throws RangeError naming the input if it is not one of the three forms. A silent black
 *   here would be a typo that ships as art.
 */
export function hex(css: string): Rgba {
  const body = css.charCodeAt(0) === 35 ? css.slice(1) : css;
  const short = body.length === 3;
  if (!/^[0-9a-fA-F]+$/.test(body) || (body.length !== 3 && body.length !== 6 && body.length !== 8)) {
    throw new RangeError(
      `hex: expected '#rgb', '#rrggbb' or '#rrggbbaa', got ${JSON.stringify(css)}`,
    );
  }
  const pick = (at: number): number => {
    const slice = short ? body.slice(at, at + 1).repeat(2) : body.slice(at * 2, at * 2 + 2);
    return Number.parseInt(slice, 16);
  };
  return rgba(pick(0), pick(1), pick(2), body.length === 8 ? pick(3) : 255);
}

/** One third of the hue wheel, in the 0–1 parameterisation the conversion below works in. */
const THIRD = 1 / 3;

/** One channel of an HSL conversion. Piecewise linear in `t`, so no `sin` and no `pow`. */
function hueChannel(p: number, q: number, t: number): number {
  let k = t;
  if (k < 0) k += 1;
  if (k > 1) k -= 1;
  if (k < 1 / 6) return p + (q - p) * 6 * k;
  if (k < 1 / 2) return q;
  if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
  return p;
}

/**
 * HSL → packed. `h` in **degrees**; `s`, `l` and `a` in **0–1**.
 *
 * Hue is how a *player* picks a brand color — a wheel, one number — and how a theme derives a
 * dozen related tokens from that one number.
 *
 * **The hue is the thing a game saves.** Persist `h`, never the `Rgba` this returns and never
 * the `#rrggbb` that comes out of {@link hueToHex}. One number in the save, a whole palette
 * derived on load, and the same save renders identically on any engine — which the derived
 * tokens, being presentation-tier, cannot promise.
 *
 * `h` wraps, so 380 and 20 are the same color and a hue driven by an accumulating slider
 * never needs a modulo at the call site.
 */
export function hsl(h: number, s: number, l: number, a = 1): Rgba {
  const hue = Number.isFinite(h) ? (((h % 360) + 360) % 360) / 360 : 0;
  const sat = s < 0 ? 0 : s > 1 ? 1 : s;
  const light = l < 0 ? 0 : l > 1 ? 1 : l;
  if (sat === 0) {
    const gray = light * 255;
    return rgba(gray, gray, gray, a * 255);
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  return rgba(
    hueChannel(p, q, hue + THIRD) * 255,
    hueChannel(p, q, hue) * 255,
    hueChannel(p, q, hue - THIRD) * 255,
    a * 255,
  );
}

/** Default saturation for a brand hue. High enough to read as a choice, low enough that every
 *  hue on the wheel produces something a building can be painted. */
const BRAND_SAT = 0.62;

/** Default lightness for a brand hue. Mid, so both {@link shade} directions have room. */
const BRAND_LIGHT = 0.54;

/**
 * A brand hue straight to `#rrggbb`, for the DOM.
 *
 * `hexOf(hsl(hue, sat, light))`, and it exists as its own export because `ui` derives its whole
 * theme from one hue and must not grow a second color model to do it. **Color lives in
 * exactly one package, and this is it** — `core` deliberately has none, so a second
 * implementation anywhere above this line is the bug, not the convenience.
 *
 * **The string this returns belongs in a stylesheet, never in a save.** The `hue` argument is
 * the durable value.
 */
export function hueToHex(hue: number, sat = BRAND_SAT, light = BRAND_LIGHT): string {
  return hexOf(hsl(hue, sat, light));
}
