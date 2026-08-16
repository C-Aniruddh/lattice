/**
 * The valley's three hours, as three stop sets.
 *
 * The kit's own `DAY`/`DUSK`/`NIGHT` are a working default and deliberately restrained. This game
 * opens on a wide green valley in full sun, so its day is pushed to saturation and its night is
 * pulled *up* rather than down: an unreadable first frame is a worse failure than a night that is
 * not literally dark, and the darkness the player actually feels comes from `LightField`'s mask,
 * which has an edge, not from the palette, which does not.
 *
 * All three sets define exactly the same slots, which `Palette.lerp` requires and which is the
 * silent way a game ends up with one thing still gold at midnight.
 *
 * **`sand` is a slot like any other, and that is the point.** It is the game's own color — the
 * ring of beach where the island meets the water — and it used to live outside the palette
 * entirely, blended by a hand-written `sandAt(daylight)` that was the one thing in the frame not
 * rolling at dusk with everything else. `extendStops` is the sanctioned way in, and the three
 * results below are **hoisted to module scope** because `Palette.lerp` compares its stop sets by
 * *identity*: rebuilt inside the render callback they would be new objects every frame, every
 * frame would bump `rev`, and `rev` is what every cache in the kit keys on. The symptom of
 * getting that wrong is not a wrong color — it is a game that gets slower at dusk and stays slow.
 */
import { extendStops, hex, type Stops } from '@lattice/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

function stops(row: string): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  return Object.freeze(out);
}

//                sky      ground   ink      brand    metal    glass    warn     ok       bad      night
const DAY_ROW = '#79c2ee #57ab45 #1b2436 #cf5f3e #9b8f7d #7fd3ef #f2b528 #56c268 #d6483f #0d1226';
const DUSK_ROW = '#e39a72 #6d8a46 #201f2e #b5523a #85786a #6f93ac #f4ab2c #4faa5a #c4413a #131a36';
const NIGHT_ROW = '#243662 #33513f #101828 #7e4033 #55514c #46789a #ffc85a #3f7d4c #b83a34 #070c1e';

export const DAY = extendStops(stops(DAY_ROW), { sand: hex('#e8d9a8') });
export const DUSK = extendStops(stops(DUSK_ROW), { sand: hex('#cfa87d') });
export const NIGHT = extendStops(stops(NIGHT_ROW), { sand: hex('#5d6478') });
