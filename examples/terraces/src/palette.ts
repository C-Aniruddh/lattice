/**
 * The hillside's colors, in one stop set.
 *
 * @art
 *
 * Delete this file and the exhibit still generates its terraces, still marches a ray down the
 * heightfield, still shows you the error the naive pick makes — in the kit's default daylight.
 * Everything here is color.
 *
 * ## Why there is only one hour
 *
 * `island` authors four stop sets and rolls between them, because a day is its idea. This
 * exhibit's idea is a *geometry* bug, and a hillside whose color is moving while a visitor is
 * trying to read two markers against each other is an exhibit arguing with itself. One hour,
 * held: mid-afternoon, sun coming from screen-left, which is the direction `draw`'s relief term
 * already assumes — `isoTerrain` derives its shading from the east-minus-west corner difference,
 * so a palette lit from anywhere else would fight the one shading pass the kit does for free.
 *
 * ## The nine slots the kit does not have
 *
 * `field`, `crop`, `dry`, `bank`, `lip`, `stone`, `flood`, `chan` and `mist` are this exhibit's
 * own, added through `extendStops`, which is the sanctioned way in. Two of them are the whole
 * look and are worth naming:
 *
 * **`lip`** is the bright top edge of a retaining wall. It is a slot rather than a lightened
 * `bank` because the lip is *catching the sky*, not reflecting more of the earth it is made of —
 * derive it from `bank` and every wall reads as a bevel in a UI kit instead of as a stone course
 * with afternoon on it.
 *
 * **`mist`** is what the far terraces dissolve into. It is deliberately **not** `sky`: a 2:1
 * projection has no horizon, so nothing here ever paints sky, and a haze that fades toward the
 * clear color the sky would have been comes out too blue and too cold against a warm hill. The
 * distance in front of you is lit air, not the zenith.
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
const ROW = '#c3d8db #6f8f4a #1d2a1f #d8663a #93999a #9fc9d6 #ffc23a #57b25e #dc4636 #12202a';

/**
 * Mid-afternoon on a terraced hill. Hoisted to module scope and never rebuilt: `Palette.lerp`
 * compares stop sets by identity, so a set rebuilt inside a render callback bumps `rev` every
 * frame and `rev` is what every cache in the kit keys on.
 */
export const HILLSIDE: Stops = stops(ROW, {
  field: '#7ea341',
  crop: '#d2dc63',
  dry: '#c4a768',
  bank: '#8b7052',
  lip: '#ecdcaa',
  stone: '#9b8c72',
  flood: '#86bccb',
  chan: '#5aa7c0',
  mist: '#c2d2cd',
});
