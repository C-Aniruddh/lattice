/**
 * One hue, one palette, and no design system.
 *
 * This package ships zero CSS, so everything here writes **custom properties on the overlay
 * root** and stops. Your stylesheet consumes them; nothing in this package ever reads them back.
 * That is the entire opinion `@lattice/ui` holds about how anything looks, and the reason it can
 * be dropped into a game whose art direction was decided before the kit existed.
 *
 * On the root, not on `document.documentElement`, for two reasons: a global custom property is
 * a global variable, and two overlays on one page — a game and its own settings preview — must
 * be able to disagree.
 *
 * Nothing here touches a global. Every function takes the overlay whose root it writes.
 */

import { clamp01, expectFinite } from '@lattice/core';
import { hueToHex } from '@lattice/draw';
import { internalsOf, type Overlay } from './overlay.js';

/** How a brand hue is turned into a color. */
export interface BrandOptions {
  /** HSL saturation for the derived color, 0..1. Default 0.72. */
  readonly saturation?: number;
  /** HSL lightness for the derived color, 0..1. Default 0.62. */
  readonly lightness?: number;
}

/** Default saturation. Higher than `draw`'s building default because a HUD accent sits on
 *  chrome rather than on a lit face and has to survive being 14 pixels tall. */
const BRAND_SAT = 0.72;

/** Default lightness. Mid-high, so both derived steps below have somewhere to go. */
const BRAND_LIGHT = 0.62;

/**
 * Lightness step between the brand and its two companions.
 *
 * **It is the knee of the separation curve**, measured rather than picked. Take the worst hue of
 * the 360 and measure the strongest channel's distance between the brand and each companion:
 *
 * | step | worst-case separation | bought by the last 0.01 |
 * |---|---|---|
 * | 0.05 | 22 levels | 5 |
 * | 0.10 | 44 levels | 5 |
 * | **0.14** | **54 levels** | 1 |
 * | 0.20 | 58 levels | 1 |
 *
 * Up to about 0.12 each extra hundredth of lightness buys another four or five sRGB levels;
 * past 0.14 the lighter companion is clipping and it buys one. So 0.14 is the smallest step that
 * takes all the separation available and the largest that costs nothing to take — 54 levels,
 * about a fifth of the range, against a just-noticeable difference of two or three. A HUD whose
 * "raised" edge is a couple of levels from its face reads as a rendering artifact rather than as
 * an edge, on exactly the brands nobody tests with. `theme.test.ts` pins both halves.
 *
 * At extreme lightness the clamp still collapses them: a brand at `lightness: 1` has no lighter
 * companion. That is arithmetic, not a bug, and it is why the default sits at 0.62.
 */
const BRAND_STEP = 0.14;

/**
 * A set of named colors — whatever `@lattice/draw` produces from interpolating two palettes by
 * a 0..1 parameter. Names to CSS color strings, and nothing else.
 *
 * Structurally identical to `draw`'s `Vars`, and declared here rather than imported so the seam
 * between the two packages is one shape rather than one package's opinions. `@lattice/ui`
 * neither defines the names nor knows what they mean.
 */
export type Palette = Readonly<Record<string, string>>;

/** How a palette is namespaced on the root. */
export interface PaletteOptions {
  /** Custom-property namespace. Default `'lattice'`, so a key `sky` becomes `--lattice-sky`.
   *  An empty string writes `--sky`, for a game that already owns its token names. */
  readonly prefix?: string;
}

/** Characters a custom-property name may contain here. Narrower than CSS allows on purpose: a
 *  token containing a space or a brace produces a property that silently never matches, and a
 *  palette key is authored data that should fail at the push rather than at the eye. */
const IDENT = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/**
 * Write one custom property, skipping the write when the value has not moved.
 *
 * The guard is not a micro-optimization. A custom property written on the root invalidates
 * style for **every node that inherits it**, which is the whole overlay; at 60 Hz that is sixty
 * full-subtree style recalculations a second to animate a color the player reads over three
 * minutes. The cache lives on the overlay rather than in a read of the DOM because
 * `getPropertyValue` on a live element is itself a style read.
 */
function writeVar(ui: Overlay, prop: string, value: string): boolean {
  const internals = internalsOf(ui);
  if (internals.vars.get(prop) === value) return false;
  internals.vars.set(prop, value);
  ui.root.style.setProperty(prop, value);
  return true;
}

/**
 * Recolour the overlay from a single hue in degrees.
 *
 * Writes exactly three custom properties on the overlay root — `--lattice-brand`,
 * `--lattice-brand-hi`, `--lattice-brand-lo` — derived through `@lattice/draw`'s color model,
 * so the HUD accent and the buildings in the world are the same hue **by construction** rather
 * than by two people picking hex codes that drift apart at the next art pass.
 *
 * It also invalidates every {@link ThumbCache} on this overlay, because a thumbnail painted in
 * the old brand is now a lie. That inversion is the fix for a real bug: the source game keyed
 * its thumbnail cache on `${id}|${brand}|${w}x${h}`, which never went stale and also grew
 * without bound as a player played with the color picker. Here the key does not name the brand
 * and the recolour drops the cache, so neither mistake is available to a caller.
 *
 * **Persist the hue, never these strings.** The derivation is presentation-tier; the hue is the
 * durable value and it is one number.
 *
 * @throws RangeError if `hue`, `saturation` or `lightness` is not finite. `hue` wraps, so 380
 * and 20 are the same color and a hue driven by an accumulating slider needs no modulo.
 */
export function setBrand(ui: Overlay, hue: number, opts?: BrandOptions): void {
  expectFinite(hue, 'setBrand: hue');
  const sat = clamp01(expectFinite(opts?.saturation ?? BRAND_SAT, 'setBrand: saturation'));
  const light = clamp01(expectFinite(opts?.lightness ?? BRAND_LIGHT, 'setBrand: lightness'));

  writeVar(ui, '--lattice-brand', hueToHex(hue, sat, light));
  writeVar(ui, '--lattice-brand-hi', hueToHex(hue, sat, clamp01(light + BRAND_STEP)));
  writeVar(ui, '--lattice-brand-lo', hueToHex(hue, sat, clamp01(light - BRAND_STEP)));

  for (const cache of internalsOf(ui).caches) cache.invalidate();
}

/**
 * Set arbitrary custom properties on the overlay root.
 *
 * The escape hatch that stops this package growing a design system: a game that wants a
 * `--panel-radius`, a `--danger` or a `--dock-height` sets it here and styles with it.
 * `@lattice/ui` defines no scale, no ramp and no palette beyond the brand triplet above.
 *
 * Change-guarded per key, exactly like {@link applyPalette}, so a token written from `every()`
 * costs a string comparison rather than a style invalidation of the whole overlay.
 *
 * @throws RangeError naming the offending key if any key does not start with `--`. A key
 * written without the dashes sets an ordinary style property that nothing in this package
 * permits and no selector will find, and the symptom is a token that is simply never applied.
 */
export function setTokens(ui: Overlay, tokens: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(tokens)) {
    if (!key.startsWith('--')) {
      throw new RangeError(
        `setTokens: every key must be a custom property starting with '--', got ${JSON.stringify(key)}`,
      );
    }
    const value = tokens[key];
    if (value !== undefined) writeVar(ui, key, value);
  }
}

/**
 * Push a palette onto the overlay as custom properties, and say whether anything moved.
 *
 * This is {@link setBrand}'s mechanism driven by a different input. A brand hue is chosen once
 * at incorporation; a day/night palette is a fresh set of strings as dusk falls, and the overlay
 * has to darken with the world — a HUD glowing in its daytime colors over a night scene is the
 * most obvious way an overlay reveals itself as a layer bolted on top.
 *
 * **Write it from `update`, never from `render`.**
 *
 * ```ts
 * ui.every(() => applyPalette(ui, lerpPalette(DAY, NIGHT, world.dayT)));
 * ```
 *
 * Three properties make that correct rather than merely cheap:
 *
 * 1. **It is change-guarded per key.** An identical palette writes nothing and returns `false`,
 *    so pushing on every update is wasteful rather than wrong. Quantise `t` on your side —
 *    1/64 is beyond what anyone can see over a dusk — and the guard turns most pushes into
 *    no-ops for free.
 * 2. **Smoothing is a CSS transition, not a JavaScript tween.** One-second steps look like
 *    steps; `transition: background-color 1.2s linear` in *your* stylesheet turns them into a
 *    continuous fade that runs on the compositor, costs no main-thread work, needs no frame
 *    callback, and degrades to an instant jump in a hidden tab — which is correct, because
 *    nobody is looking.
 * 3. **It does not invalidate thumbnails**, unlike `setBrand`. A shop card is a portrait of the
 *    building, not a photograph of it at this hour, and a cache rebuilt once a second is a
 *    memory leak with a pleasant API.
 *
 * @throws RangeError naming the offending key if any key — or the prefix — is empty or contains
 * a character that is not valid in a custom-property name.
 */
export function applyPalette(ui: Overlay, palette: Palette, opts?: PaletteOptions): boolean {
  const prefix = opts?.prefix ?? 'lattice';
  if (prefix !== '' && !IDENT.test(prefix)) {
    throw new RangeError(
      `applyPalette: prefix ${JSON.stringify(prefix)} is not a valid custom-property name fragment — use letters, digits, '_' and '-'`,
    );
  }
  let changed = false;
  for (const key of Object.keys(palette)) {
    if (!IDENT.test(key)) {
      throw new RangeError(
        `applyPalette: palette key ${JSON.stringify(key)} is not a valid custom-property name fragment — use letters, digits, '_' and '-'. A key with a space in it produces a property no selector will ever match.`,
      );
    }
    const value = palette[key];
    if (value === undefined) continue;
    if (writeVar(ui, prefix === '' ? `--${key}` : `--${prefix}-${key}`, value)) changed = true;
  }
  return changed;
}
