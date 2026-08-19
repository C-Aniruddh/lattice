/**
 * The yard's colors, in one stop set.
 *
 * @art
 *
 * Delete this file and the exhibit still files its archive, still hands every save to five real
 * builds, still refuses the ones that cannot be carried and still says why — in the kit's default
 * daylight. Everything here is color.
 *
 * ## Five decks, because the terrace a crate stands on is the version it is at
 *
 * The one thing this exhibit has to make obvious without a sentence is *which rung a save is on*.
 * Height alone does not do it: a 2:1 projection flattens the axis a staircase is impressive along,
 * which is `GALLERY.md`'s note about `Canyon` arriving here from the other direction. So the five
 * terraces are five **different colors**, cold slate at v1 warming to gold at v5, and a crate
 * crossing a rung changes the color of the ground under it in the same second that it changes
 * shape. Two independent cues on the same event, and the visitor only has to catch one.
 *
 * The ramp is also the argument. Nothing about a v5 save is *better* than a v1 save; what the
 * warmth buys is a direction — cold at the bottom, warm at the top — so a stranger who has read
 * nothing can still tell which way the yard flows within a second of the page painting.
 *
 * ## One hour, held
 *
 * `island` authors four stop sets and rolls between them because a day is its idea. This
 * exhibit's idea is a *chain*, and a yard whose color is drifting while a visitor is trying to
 * tell terrace 3 from terrace 4 is an exhibit arguing with itself. Mid-afternoon, sun from
 * screen-left, which is the direction `isoTerrain`'s relief term already assumes.
 */
import { extendStops, hex, type Stops } from '@latticekit/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes into a `Stops`. Ten columns is short enough to read down. */
function stops(row: string, extra: Record<string, string>): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(out), Object.freeze(more));
}

//               sky       ground    ink       brand     metal     glass     warn      ok        bad       night
const ROW = '#aec4cf #7b8c93 #1a2029 #d8763a #97a2a8 #a8cede #ffc23a #63bd6a #e0523c #101a25';

/**
 * The archive yard, mid-afternoon. Hoisted to module scope and never rebuilt: `Palette.lerp`
 * compares stop sets by identity, so a set rebuilt inside a render callback bumps `rev` every
 * frame, and `rev` is what every cache in the kit keys on.
 */
export const YARD: Stops = stops(ROW, {
  /** The five terrace tops. Cold slate at the floor, warm gold at the vault. */
  deck1: '#4e6379',
  deck2: '#6a8384',
  deck3: '#8d9268',
  deck4: '#b28f55',
  deck5: '#dcb45f',
  /** The riser between two decks, and the bright edge along the top of it. */
  riser: '#2a3444',
  lip: '#fdf3d2',
  /** The archive floor, a step below v1, and the pit at the bottom of it where refusals land. */
  floor: '#4a5561',
  pit: '#333c48',
  /** A crate nobody has opened yet: unread bytes have no color of their own. */
  bytes: '#8d8478',
  /** A crate that did not survive, and the char mark on it. */
  ash: '#6d4a45',
  /** Painted lines and stencilled numerals on the decks. */
  line: '#e8efe6',
  /** What the far lanes dissolve into. Deliberately not `sky`: a 2:1 projection has no horizon,
   *  and the distance in front of you is lit air rather than the zenith. */
  mist: '#c3d1d6',
});
