/**
 * One hour, four climates, and the color everything far away turns into.
 *
 * @art
 *
 * Delete this file and the world still generates, still streams, still evicts and still comes
 * back identical — in the kit's default daylight, for ever. Everything here is color.
 *
 * ## Why there is no cycle
 *
 * `Island` owns the day. This exhibit owns *distance*, and a moving sun would put a second thing
 * in a row that `docs/GALLERY.md` allows one idea. So the light is fixed at a low afternoon sun:
 * long warm ground, cool shadow, and enough contrast between a lit ridge and the valley behind it
 * that the three distance bands read as bands rather than as a gradient. A noon palette is the
 * flattest hour there is and would have made the far half of the frame a single wash.
 *
 * ## The twelve slots the kit does not have
 *
 * Four of them are biomes, and they are slots rather than constants for the reason every slot
 * exists: `paletteVars` pushes the whole set to the DOM through `ui`'s `applyPalette`, so the
 * overlay's accent is the same taiga green the world is drawn in, with no second table anywhere.
 *
 * `haze` is the one that carries the composition. Every tile, every tree and the sky itself
 * dissolve toward it with depth, so the horizon is one color arrived at from three directions.
 * Pick it wrong — even slightly bluer than the sky — and the far band separates from the air
 * above it and the world looks like a sheet of paper laid on a backdrop.
 */
import { extendStops, hex, type Stops } from '@latticekit/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes plus the exhibit's own, into a `Stops`. */
function stops(row: string, extra: Record<string, string>): Stops {
  const base: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) base[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(base), Object.freeze(more));
}

//              sky     ground  ink     brand   metal   glass   warn    ok      bad     night
const ROW = '#8fc4e8 #6ba54e #17203a #e06a3a #9aa2b4 #74cfe6 #ffd25e #55c06a #dd4b3c #0b1226';

/** Late afternoon. The one stop set; nothing in this exhibit lerps it. */
export const AFTERNOON: Stops = stops(ROW, {
  /** Open ocean, well off the shelf. */
  deep: '#12507f',
  /** Shallow water over a bright bottom. */
  shoal: '#3fbcd0',
  /** The beach, and the dry edge of every lake. */
  sand: '#f0dcac',
  /** Surf, and the bright lip on the leading edge of it. */
  foam: '#ffffff',
  /** Bare stone: cliffs, scree, and everything above the treeline. */
  rock: '#8b8577',
  /** What distance is made of. See the header — this is the load-bearing one. */
  haze: '#a8cbe4',
  /** Cold north: dark blue-green under a low sun. */
  taiga: '#4a7a5e',
  /** The middle latitudes, and the greenest thing on screen. */
  leaf: '#6fae4a',
  /** Dry country. Warm enough that a coastline through it reads instantly. */
  dune: '#c9a866',
  /** Wet and hot: the darkest, most saturated ground here. */
  jungle: '#3f8f43',
  /** The beacon's light. The only emissive color in the exhibit. */
  bloom: '#ffe9a8',
});
