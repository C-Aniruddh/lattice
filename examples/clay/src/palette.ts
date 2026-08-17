/**
 * The color of wet clay, and of the light that has to make a new ridge read as a ridge.
 *
 * @art
 *
 * Delete this file and the ground still deforms, the water still finds its way, and every walker
 * still routes around the hill you made — in the kit's default daylight, where a valley and a
 * plateau are the same green. Everything here is why a change is *visible*.
 *
 * ## Why the ground is a ramp of five and not one `ground`
 *
 * A height field painted in one color is legible only through the relief term, and the relief term
 * reads a *slope*. A visitor who raises a broad, gentle dome makes something with almost no slope
 * anywhere on it, and in one color that dome is invisible until it is a cliff. So elevation gets
 * its own axis in the palette: silt at the waterline, meadow, grass, scrub, then bare rock at the
 * top. Raise a dome and it climbs through the ramp while you are making it — which means the
 * *fact of having changed something* arrives before any shading does.
 *
 * Five bands rather than a continuous gradient, and that is § Scale's animated-color trap read
 * forwards rather than paid for afterwards: a color that is a continuous function of a height a
 * finger is moving is a fresh cache key every frame at every vertex it touches. Five keys are
 * five keys for ever. The *blend* between adjacent bands is done with `mix` at a quantized
 * strength, so the boundary is soft and the number of distinct colors stays bounded.
 *
 * ## The water is three colors and one of them is not blue
 *
 * `shallow` is the river: a pale, silty green-blue that reads as *moving* against the mud it runs
 * over. `deep` is what a lake becomes once it is more than a unit or so down, and it is much
 * darker and much bluer, because the single clearest signal that a visitor has dammed something is
 * that the water they are looking at has gone from a thread to a body. `foam` is the lip — the
 * band at the very edge of a pool, and the thing that makes a shoreline read as a shoreline rather
 * than as a color boundary.
 *
 * One stop set and no day cycle: this exhibit's variable is the ground under a finger, and a
 * second clock competing with it would be a second thing to watch.
 */
import { extendStops, hex, type Stops } from '@latticekit/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes into a `Stops`, plus this exhibit's own named slots. */
function stops(row: string, extra: Record<string, string>): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(out), Object.freeze(more));
}

//                sky     ground  ink     brand   metal   glass   warn    ok      bad     night
const ROW = '#a8cbe0 #7d9c56 #221d1e #e0703a #98a08e #86bcd0 #ffce5c #6fae5e #d2503a #101420';

/** The one palette. Late-morning light from the screen-left, and a valley that has been rained on. */
export const CLAY: Stops = stops(ROW, {
  /** The five bands of ground, waterline upward. See the header for why there are five. */
  g0: '#8a7a5c',
  g1: '#6f9350',
  g2: '#83a557',
  g3: '#9aa269',
  g4: '#918b74',
  /** Bare rock, which only appears where the visitor has made something genuinely steep. It is the
   *  one color in the scene that cannot occur in the generated world, so its arrival is a signal. */
  crag: '#8b8477',
  /** The river, a lake, and the lip between water and land. */
  shallow: '#8fc4c0',
  deep: '#2f6f92',
  foam: '#d8ece8',
  /** Wet ground just above the waterline — the dark ring that makes a shrinking pool read as one. */
  damp: '#5e6b4a',
  /** The warm edge on any face turned into the light, and the cool one on any face turned out of
   *  it. Two slots rather than a `shade()` factor because the light has a *hue*, and a ridge lit by
   *  a brighter grey is a ridge nobody notices. */
  sun: '#ffdc9a',
  dusk: '#42506e',
  /** Distance. Warmer and lighter than `sky`; a far upland mixed toward the zenith reads as fog on
   *  a lake rather than as air over a valley. */
  air: '#c6dbe8',
  /** The brush ring, and the one saturated thing in the frame. It is under the visitor's finger at
   *  all times, so it has to be findable against grass, rock and water alike. */
  edge: '#ff9d3d',
  /** What is standing on the clay. Four leaf hues rather than one, because a wood in one green is
   *  a texture; four is a wood. They are *slots* rather than hex literals in `props.ts` for the
   *  reason `Ink` exists — a string ink is a slot lookup, and a game that wants to recolour its
   *  world at runtime should not have to find the hexes first. */
  bark: '#4a3627',
  leaf0: '#3f6b34',
  leaf1: '#4d7a37',
  leaf2: '#5b8440',
  leaf3: '#355c31',
  /** A hut: daub walls and a warm thatch, the one warm object in a green valley. */
  daub: '#c2ad8e',
  thatch: '#8a4a33',
  /** A walker: a dark coat and a pale head, four pixels each and legible at every zoom. */
  coat: '#2b3550',
  head: '#e8dcc4',
});

/** The leaf hues, indexed by a prop's own hash. See {@link CLAY}. */
export const LEAVES: readonly string[] = ['leaf0', 'leaf1', 'leaf2', 'leaf3'];
