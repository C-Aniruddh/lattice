/**
 * @art
 *
 * The hour. One stop set, written as a row so the ten slots line up in a column and a change to
 * "the water got greener" is a diff a reviewer can read down.
 *
 * Late afternoon, deliberately: a crowd is legible when the ground is bright and the people are
 * dark against it, and the long warm light is what stops two hundred small figures reading as
 * static on a screen. The night slot is still authored, because `LightField` composites through
 * it even at the shallow darkness this exhibit uses to bring the lamps up.
 *
 * The slot names are `draw`'s ten and this file adds none — the kit refuses to invent a slot at
 * runtime, which is what lets `Palette.get` name a typo instead of rendering black.
 */
import { hex, type Stops } from '@lattice/draw';

/** `sky ground ink brand metal glass warn ok bad night`, in that order. */
function stops(row: string): Stops {
  const names = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'];
  const values = row.split(' ');
  const out: Record<string, number> = {};
  for (let i = 0; i < names.length; i++) out[names[i] ?? ''] = hex(values[i] ?? '000');
  return Object.freeze(out);
}

/**
 * The piazza at five o'clock.
 *
 * | slot | what it is here |
 * |---|---|
 * | `sky` | the haze the backdrop ramps from |
 * | `ground` | warm sandstone paving — the largest area on screen, so it is the least saturated |
 * | `ink` | the outline on everything, and the shadow side of every solid |
 * | `brand` | terracotta: awnings, roof tiles, the fountain's basin band |
 * | `metal` | pale limestone: columns, steps, the causeway |
 * | `glass` | the lagoon |
 * | `warn` | lamp gold, and the low sun |
 * | `ok` | foliage |
 * | `bad` | the red half of the awning stripes |
 * | `night` | what the light field darkens toward |
 */
export const GOLDEN: Stops = stops(
  '9fc4dd d8b483 2b2338 c5673f b6b1a4 3f9fa8 f2b64a 6e9c54 b8483f 141b34',
);
