/**
 * The rock record, as color.
 *
 * @art
 *
 * Delete this file and the canyon still forms, still scrubs, still lands on the same fingerprint
 * — in the kit's default daylight, with a gorge the same beige as the plateau it is cut into.
 * Everything here is why the cut reads as *depth*.
 *
 * ## Why there are eight strata slots and not one rock color
 *
 * A canyon rendered in one rock color is a hole. The thing that makes a real gorge legible from
 * the rim is that the wall is *layered*: horizontal bands of different rock, each with its own
 * hue and value, so the eye can count them down the face and read the distance to the bottom
 * from the count. That is also the honest answer to why this exhibit is beautiful and not merely
 * clever — the strata are not decoration on top of the simulation, they are the simulation's
 * output made visible. The river reveals them in order because it cuts down through them in
 * order, and nothing in `strata.ts` knows what epoch it is.
 *
 * The eight are a Colorado section read top to bottom, and the sequence matters more than any
 * one of them: pale caprock, then the two big reds with a bright buff between them so the wall
 * has a light band a third of the way down, then a dark shale that reads almost as a shadow line,
 * then warm sandstone again, then the cold grey-green of the inner gorge, then the near-black
 * basement schist the river is standing on at the end of the run. Value alternates deliberately —
 * two adjacent bands of the same lightness merge into one band at any distance.
 *
 * ## The slots that are not rock
 *
 * `air` is what the far rim dissolves into and it is **not** `sky`: haze over a distant wall is
 * warmer and lighter than the zenith, and mixing toward `sky` turns the far side of the canyon
 * blue in a way that reads as fog on a lake rather than as fifteen kilometres of dry air.
 * `shade` is the cool bounce in the bottom of the gorge, `sun` the warm light that only lands on
 * the rim, `water` and `silt` the river, and `scrub` and `bone` the desert surface and its
 * bleached stone.
 *
 * One stop set and no cycle: this exhibit's variable is time in years, not time of day, and a
 * day/night cycle here would be a second clock competing with the one the exhibit is about.
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
const ROW = '#7fb5e2 #c09257 #2a1c1b #d06a35 #9c8875 #8cc0dc #ffcf5a #6ea45c #cf4a34 #120d14';

/** The one palette. High desert at mid-morning, with the sun from the screen-left. */
export const CANYON: Stops = stops(ROW, {
  /** Caprock: a pale, hard limestone rim that catches the light and frames the whole cut. */
  s0: '#e8d7ae',
  /** The upper red wall — the band a visitor sees most of. */
  s1: '#b45a30',
  /** A bright buff a third of the way down, so the face has a light line across it. */
  s2: '#dcb97f',
  /** Deep red sandstone. */
  s3: '#953c26',
  /** Shale: dark, thin, and it reads almost as a shadow rather than as a rock. */
  s4: '#553530',
  /** Warm sandstone again, lighter than the shale above it by a lot. */
  s5: '#c8813f',
  /** The inner gorge goes cold. This is where the wall stops being red. */
  s6: '#6c6a62',
  /** Basement schist. Near black, and the river is standing on it only late in the run. */
  s7: '#3a3038',
  /** Distance. Warmer and lighter than `sky`; see the header. */
  air: '#bcd2e4',
  /** The cool bounce in the bottom, where direct light does not reach. */
  shade: '#3d4a6b',
  /** The warm light that lands on the rim and nowhere else. */
  sun: '#ffd9a0',
  /** The river. */
  water: '#7ab8d2',
  /** What the river is carrying, which is most of what makes it visible from the rim. */
  silt: '#a89272',
  /** Desert surface on the plateau: sparse, grey-green, and never grass. */
  scrub: '#97906b',
  /** Bleached stone and fresh scree — the talus is lighter than the wall it fell off. */
  bone: '#cfc0a4',
});

/** The strata, top of the section to bottom. `strata.ts` indexes this by depth below the rim. */
export const SECTION: readonly string[] = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
