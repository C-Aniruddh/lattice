/**
 * The cave's one hour, and the seven slots the kit does not have.
 *
 * @art
 *
 * Delete this file and the cavern still generates, still sorts, still lights: it renders in the
 * kit's default daylight stops, which is a green field with torches on it. Everything here is
 * color.
 *
 * ## Why there is one stop set and not four
 *
 * `island` rolls through `DAWN → DAY → DUSK → NIGHT` because its idea *is* the transition. This
 * exhibit's idea is the light field, and a palette schedule underneath it would be a second
 * thing changing the picture — a visitor pushing the bloom slider could not tell whether the
 * frame got warmer because of the slider or because of the hour. **A cave has one hour.** The
 * only thing that changes what this exhibit looks like is light, which is the point.
 *
 * That also removes the trap `island.ts` calls out at length: `Palette.lerp` compares stop sets
 * by identity and bumps `rev` when they move, so a set rebuilt per frame invalidates every cache
 * in the kit. Nothing here ever calls `lerp`, `rev` moves exactly once, and the overlay's palette
 * push runs once for the life of the page.
 *
 * ## The rock is three greys and the fire is three golds, on purpose
 *
 * Every unlit surface in this exhibit is seen through a 90%-opaque `night` quad, so the *only*
 * thing that survives into the dark is a hue's relative luminance. Rock therefore separates by
 * value and never by chroma — `rock`, `damp` and `ink` are one hue at three lightnesses — while
 * everything that emits is fully saturated, because it is read through a hole in the mask rather
 * than under it. Two colors that look distinct at noon can be the same pixel at 6% brightness,
 * and that is the mistake this palette is arranged to avoid.
 *
 * `night` is the tint the darkness quad is painted in, and it is a blue-black rather than black.
 * A literally black mask makes the unlit half of the frame a void with no material in it; a deep
 * indigo one keeps the rock's silhouette legible at the 8% that shows through, which is the
 * difference between a dark exhibit and an empty one.
 */
import { extendStops, hex, type Stops } from '@lattice/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes into a `Stops`, plus this exhibit's own slots. Ten columns is short
 *  enough to read down, which is the whole reason `draw` writes its own stop sets as a row. */
function stops(row: string, extra: Record<string, string>): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(out), Object.freeze(more));
}

//              sky       ground    ink       brand     metal     glass     warn      ok        bad       night
const ROW = '#0c1122 #4a5064 #0a0d16 #e08a3c #646b82 #74c8dc #ffc46a #6be0c0 #d1483f #0b1024';

/**
 * The cavern. One set, hoisted, never blended.
 *
 * | slot | what it is here |
 * |---|---|
 * | `ground` / `rock` / `damp` | the three values the whole cave is carved out of |
 * | `warn` / `flame` / `ember` | torchlight, from the pool's tint through to the wick |
 * | `ok` / `crystal` / `worm` | the cold half — crystal faces, and the glow-worms on the roof |
 * | `night` | the tint the darkness quad is painted in. See the header |
 */
export const CAVE: Stops = stops(ROW, {
  /** The lit face of a formation. A touch warmer than `ground` so torchlight has something to
   *  land on that is not the floor. */
  rock: '#565c72',
  /** Wet floor, and the underside of everything. The dark end of the rock ramp. */
  damp: '#333a52',
  /** Flowstone: the pale mineral crust a drip leaves. The only near-white in the cave, and it is
   *  what makes a lit column read as *wet* rather than as a grey box. */
  flow: '#a9b3c6',
  /** A crystal face. Fully saturated because it is only ever seen through a hole in the mask. */
  crystal: '#8ceeff',
  /** Glow-worms on the roof. Colder and dimmer than `crystal`, which is what keeps a constellation
   *  of them reading as distance rather than as a second set of lamps. */
  worm: '#9fd0ff',
  /** The wick, and the hottest pixel in the exhibit. */
  flame: '#ffe6b0',
  /** Charcoal under a brazier, and the warm rim on rock a torch is standing on. */
  ember: '#ff8a34',
  /** Standing water in the low chambers. Dark, so it reads by its reflection and not by its hue. */
  water: '#132a44',
});
