/**
 * @art — the valley's color, and nothing else. Delete this file and the errand still runs, in the
 * kit's default daylight, for ever.
 *
 * ## One hour, not a cycle
 *
 * `Island` owns the day. This exhibit owns an **afternoon**, and holds it: a single stop set, never
 * rolled, never lerped. That is a composition decision rather than a saving — five verbs and a
 * changing sky are two exhibits, and the one thing a visitor has to be able to read here is *what
 * to tap next*, which a scene that is halfway to dusk makes harder every second.
 *
 * The light is late and low, because low light is what separates three distance bands. `ground.ts`
 * hazes the far half of the frame toward `sky` and the near half stays saturated, and the whole
 * reason that reads as distance rather than as a gradient is that `sky` here is a warm, pale,
 * *unsaturated* color that a green field can plausibly fade into.
 *
 * ## The six slots the kit does not have
 *
 * `crop`, `thatch`, `stone`, `water`, `road` and `hedge` are this exhibit's own, added through
 * `extendStops`, which is the sanctioned way in. Each exists because the alternative was a shaded
 * `ground`, and a valley whose barley, thatch, hedgerow and river are all one hue tinted four ways
 * reads as a heightmap with a filter on it. They are slots rather than constants for the reason
 * every slot is: `hud.ts` pushes the whole palette to the DOM through `paletteVars`, so the overlay
 * is dyed out of the same six numbers the fields are.
 */
import { extendStops, hex, type Stops } from '@lattice/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes, plus this exhibit's own six. Ten columns is short enough to read down. */
function stops(row: string, extra: Readonly<Record<string, string>>): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(out), Object.freeze(more));
}

//              sky       ground    ink       brand     metal     glass     warn      ok        bad       night
const ROW = '#e8c9a0 #7fa64a #241d2b #c0603a #9a9484 #7fb8c8 #ffcc55 #6fb85c #cf4a3c #1a1730';

/**
 * Late afternoon in a farmed valley.
 *
 * `warn` is the errand's color: the key glints in it, the objective marker pulses in it, and the
 * HUD's accent is it. One accent, used for exactly one meaning, is how a player learns what to tap
 * without being told — and it is why nothing else in this palette is yellow.
 */
export const AFTERNOON: Stops = stops(ROW, {
  crop: '#d9b455',
  thatch: '#c69a58',
  stone: '#b6ab97',
  water: '#4b86a8',
  road: '#b09a76',
  hedge: '#4f7a3c',
});
