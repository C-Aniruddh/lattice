/**
 * Named color, the revision that keeps a cache honest, and the day/night spine.
 *
 * **No DOM, no canvas — this module runs unchanged in Node.**
 *
 * A slot name is the whole recolour-the-campus story: art is authored against `'brand'`, the
 * player picks a hue, one `set` recolours everything that was ever drawn with it. `rev` is what
 * makes that safe in the presence of any cache — bumped on every write, part of every key, and
 * the single reason a recoloured campus cannot render stale.
 *
 * ## `lerp` is the day/night spine, and two things about it are load-bearing
 *
 * 1. **`t` is quantised before it is applied, and `rev` bumps only when the quantised step
 *    changes.** A continuous lerp that bumped `rev` every frame would invalidate every cached
 *    sprite every frame, which turns the prettiest moment in the game into its slowest.
 *    {@link PALETTE_STEPS} levels across a six-second dusk is a color delta of under two
 *    levels per step — invisible — and at most that many cache generations.
 * 2. **Both stop sets must define exactly the same slots.** A half-defined night palette is
 *    precisely how one thing stays gold at midnight, and the failure is silent everywhere else.
 *
 * ## The world's blue and the HUD's blue are the same blue
 *
 * {@link Palette.lerp} and {@link lerpPalette} share their quantisation and their
 * interpolation, and that is not an implementation detail. If the canvas lerped in `draw` and
 * the overlay lerped in `ui`, both "obviously" a linear blend, they would disagree by a shade
 * because one of them quantised — and nightfall is the one moment where a mismatch is
 * unmissable and unnameable.
 */

import type { Ink, Rgba } from './color.js';
import { hex, hexOf, mix } from './color.js';

/**
 * A named, immutable set of slot colors: `DAY`, `DUSK`, `NIGHT`.
 *
 * Plain data, so a game authors them in one object literal, diffs them in review, and hands two
 * of them to {@link Palette.lerp}. Not a `Palette` — a `Palette` is live state with a revision,
 * and stop sets are constants.
 */
export type Stops = Readonly<Record<string, Rgba>>;

/**
 * Quantisation levels for {@link Palette.lerp} and {@link lerpPalette}.
 *
 * 32 levels, so `t = 0` is exactly the `from` set, `t = 1` is exactly the `to` set, and a
 * continuous sweep between them bumps `rev` at most 32 times rather than once per frame. The
 * divisor is `PALETTE_STEPS - 1` for that reason: 32 levels means 31 intervals.
 */
export const PALETTE_STEPS = 32;

/** Snap a transition parameter to one of {@link PALETTE_STEPS} levels. Shared, so the canvas
 *  and the DOM cannot land on different colors for the same `t`. */
function quantise(t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const divisor = PALETTE_STEPS - 1;
  return Math.round(k * divisor) / divisor;
}

/**
 * Reject two stop sets that do not describe the same world.
 *
 * @throws RangeError naming the first slot present in one and absent from the other. A
 *   half-defined stop set is precisely how one thing stays gold at midnight, and the failure is
 *   silent everywhere else.
 */
function expectSameSlots(from: Stops, to: Stops, fn: string): void {
  const missing = (a: Stops, b: Stops): string | undefined =>
    Object.keys(a).find((slot) => b[slot] === undefined);
  const slot = missing(from, to) ?? missing(to, from);
  if (slot !== undefined) {
    throw new RangeError(`${fn}: slot '${slot}' is in one stop set and not the other`);
  }
}

/** Live slot state for one frame's worth of drawing, plus the revision any cache keys on. */
export interface Palette {
  /**
   * Bumped on every mutation.
   *
   * Part of every sprite cache key, and the single reason a recoloured campus cannot render
   * stale. A cache keyed on `(sprite, level, zoom)` alone will happily blit yesterday's brand
   * color for ever, and the player files it as "the rebrand did not apply".
   */
  readonly rev: number;
  /** @throws RangeError naming the slot and listing the known ones. A typo that rendered black
   *  would be filed as an art bug and never found. */
  get(slot: string): Rgba;
  /** Write a slot and bump {@link Palette.rev}. Adding a slot the kit does not know about is
   *  fine and expected — a game's own vocabulary lives here beside the kit's. */
  set(slot: string, color: Rgba): void;
  /** Whether a slot exists, for a caller building a theme editor. */
  has(slot: string): boolean;
  /** Resolve an {@link Ink}: a number passes through untouched, a string is a slot lookup. */
  ink(value: Ink): Rgba;
  /** Every slot name, sorted. Stable across calls until a slot is added. */
  keys(): readonly string[];
  /**
   * Cross-fade every slot between two stop sets. **One call and one number recolours the entire
   * world** — the day/night spine, and the strongest argument the zero-asset rule has.
   *
   * See the module header for the two things about it that are load-bearing.
   *
   * @throws RangeError if the two stop sets do not define exactly the same slots.
   */
  lerp(from: Stops, to: Stops, t: number): void;
}

/**
 * Build a live palette from a stop set.
 *
 * The slots are copied, so the stop set stays a constant a game can hand to
 * {@link Palette.lerp} afterwards without the palette's own writes having moved it.
 */
export function createPalette(slots: Stops): Palette {
  const map = new Map<string, Rgba>();
  for (const slot of Object.keys(slots)) map.set(slot, (slots[slot] ?? 0) >>> 0);

  let rev = 1;
  let names: readonly string[] | undefined;
  // The last transition applied, so a frame that asks for the same one twice writes nothing and
  // bumps nothing. Identity comparison on the stop sets is deliberate: they are constants, and
  // a game that rebuilds one per frame has a bigger problem than a spurious cache generation.
  let lastStep = -1;
  let lastFrom: Stops | undefined;
  let lastTo: Stops | undefined;

  const palette: Palette = {
    get rev() {
      return rev;
    },
    get(slot: string): Rgba {
      const found = map.get(slot);
      if (found === undefined) {
        throw new RangeError(
          `palette.get: unknown slot '${slot}' — known slots are ${[...map.keys()].sort().join(', ')}`,
        );
      }
      return found;
    },
    set(slot: string, color: Rgba): void {
      if (!map.has(slot)) names = undefined;
      map.set(slot, color >>> 0);
      rev += 1;
    },
    has(slot: string): boolean {
      return map.has(slot);
    },
    ink(value: Ink): Rgba {
      return typeof value === 'number' ? value >>> 0 : palette.get(value);
    },
    keys(): readonly string[] {
      if (names === undefined) names = [...map.keys()].sort();
      return names;
    },
    lerp(from: Stops, to: Stops, t: number): void {
      expectSameSlots(from, to, 'palette.lerp');
      const step = quantise(t);
      if (step === lastStep && from === lastFrom && to === lastTo) return;
      lastStep = step;
      lastFrom = from;
      lastTo = to;
      for (const slot of Object.keys(from)) {
        if (!map.has(slot)) names = undefined;
        map.set(slot, mix(from[slot] ?? 0, to[slot] ?? 0, step));
      }
      rev += 1;
    },
  };
  return palette;
}

/**
 * A flat slot → CSS color bag. The only shape color crosses into the DOM in.
 *
 * `draw` emits bare slot names; **`ui` owns the prefix**, because a package that does not touch
 * the DOM has no business naming a custom property.
 */
export type Vars = Readonly<Record<string, string>>;

/**
 * Interpolate two stop sets into CSS strings — the `draw` → `ui` seam.
 *
 * Pure: it touches no `Palette` and no DOM. `ui` writes the entries onto custom properties under
 * its own prefix, guarded per key, on its own slow cadence, and lets a CSS transition do the
 * smoothing. Optimized for clarity, not for the frame: at one call a second the allocation of a
 * fresh object is not worth a line of thought.
 *
 * **It shares its quantisation and its interpolation with {@link Palette.lerp}.** See the module
 * header for why that is a promise rather than a coincidence — and note what the promise does
 * *not* cover: it proves the two functions agree, and cannot save a game that passes them
 * different `(from, to, t)`.
 *
 * @throws RangeError if the two stop sets do not define exactly the same slots.
 */
export function lerpPalette(a: Stops, b: Stops, t: number): Vars {
  expectSameSlots(a, b, 'lerpPalette');
  const step = quantise(t);
  const out: Record<string, string> = {};
  for (const slot of Object.keys(a)) out[slot] = hexOf(mix(a[slot] ?? 0, b[slot] ?? 0, step));
  return out;
}

/** The same bag, from whatever a live palette currently is. For a `rev`-guarded push into the
 *  DOM: read `rev`, and only rebuild the bag when it moved. */
export function paletteVars(p: Palette): Vars {
  const out: Record<string, string> = {};
  for (const slot of p.keys()) out[slot] = hexOf(p.get(slot));
  return out;
}

/**
 * The slots the kit itself draws with, in the order the stop sets below are written in.
 *
 * A game adds its own freely; **the kit never adds one at runtime**, so a missing slot is always
 * the caller's spelling and {@link Palette.get} can say so.
 */
const SLOT_NAMES = [
  'sky',
  'ground',
  'ink',
  'brand',
  'metal',
  'glass',
  'warn',
  'ok',
  'bad',
  'night',
] as const;

/**
 * One reference stop set, written as a row of hex.
 *
 * A row rather than ten labeled lines, and the reason is the one the `Stops` doc gives: these
 * are meant to be *diffed in review*. Three aligned rows put the same slot in the same column in
 * all three, so "the ground got greener at dusk" is a column you can read down. Ten scattered
 * `ground:` lines across three objects are not.
 */
function stops(row: string): Stops {
  const out: Record<string, Rgba> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOT_NAMES.length; i++) out[SLOT_NAMES[i] ?? ''] = hex(values[i] ?? '000');
  return Object.freeze(out);
}

/** Full daylight, and the working default: `createPalette(BASE_SLOTS)` is a game that renders. */
export const BASE_SLOTS: Stops = stops(
  'a9c9e6 7ba355 1d2233 c9553f 8d97a6 9fd4e3 e8b33c 5bbd6a d1483f 10142c',
);

/**
 * Full daylight. **The same object as {@link BASE_SLOTS}**, named for the transition rather than
 * for the default, so `palette.lerp(DAY, NIGHT, night)` reads as what it is.
 */
export const DAY: Stops = BASE_SLOTS;

/** The middle of the transition, as a stop set a game can hold at. Not a blend of the other two:
 *  dusk is warmer than the midpoint, which is the whole reason it is authored. */
export const DUSK: Stops = stops(
  'e0956a 5c6f4a 1a1b28 b04a3a 6f7686 c79a76 e0a13c 4c9c5c b23c36 141a38',
);

/** Midnight. Everything cool and dark; `warn`, `ok` and `bad` stay legible because a HUD must
 *  read at midnight — the darkness is `LightField`'s job, not the palette's. */
export const NIGHT: Stops = stops(
  '1a2244 2c3a3c 0d1018 7a3a32 4a5262 3f5f74 d6a53f 4fae61 c04038 080b1c',
);
