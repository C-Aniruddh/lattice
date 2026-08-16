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
 */
import { hex, type Stops } from '@lattice/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

function stops(row: string): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  return Object.freeze(out);
}

//                    sky      ground   ink      brand    metal    glass    warn     ok       bad      night
export const DAY = stops('#79c2ee #57ab45 #1b2436 #cf5f3e #9b8f7d #7fd3ef #f2b528 #56c268 #d6483f #0d1226');
export const DUSK = stops('#e39a72 #6d8a46 #201f2e #b5523a #85786a #6f93ac #f4ab2c #4faa5a #c4413a #131a36');
export const NIGHT = stops('#243662 #33513f #101828 #7e4033 #55514c #46789a #ffc85a #3f7d4c #b83a34 #070c1e');

/** Sand, foam and the sea beyond the island: three colors the slot vocabulary has no name for. */
export const SAND = { day: 0xe8d9a8ff, dusk: 0xcfa87dff, night: 0x5d6478ff };
