/**
 * The island's four hours, and the one function that rolls between them.
 *
 * @art
 *
 * Delete this file and the island still generates, still sorts, still draws, still runs its
 * ninety seconds — in the kit's default daylight, for ever. Everything here is color.
 *
 * ## Why four sets and not two
 *
 * `draw` ships `DAY`/`DUSK`/`NIGHT`, and a cycle built from three stop sets has a dawn that is
 * dusk played backwards. That is *fine* on a road at nightfall, where dusk is the event and dawn
 * never arrives. It is not fine here, because this exhibit's whole claim is a **full** cycle: a
 * visitor watches the sun come back, and if the return is the departure reversed they have
 * watched one transition twice. Morning is cooler, higher-contrast and bluer than evening — the
 * air is clear and the sea has not warmed — so `DAWN` is authored rather than derived, and the
 * cycle is a loop through four anchors instead of a triangle over three.
 *
 * ## The five slots the kit does not have
 *
 * `sand`, `deep`, `shoal`, `foam`, `bloom` and `rock` are this exhibit's own, added through
 * `extendStops`, which is the sanctioned way in. They exist because the shoreline is half the
 * row: a beach painted out of `ground` shaded warm is a beach that goes green at dusk with the
 * grass, and a lagoon painted out of `glass` is the same blue as the deep ocean. Given slots,
 * they roll with everything else and there is no hand-written `sandAt(daylight)` anywhere.
 *
 * `bloom` is the bioluminescence in the surf after dark. It is a slot rather than a constant for
 * the same reason: it has to be *absent* at noon, and a slot that is nearly the daytime foam
 * color and a cold green at midnight does that with no branch anywhere in `ground.ts`.
 *
 * **The four results are hoisted to module scope.** `Palette.lerp` compares its stop sets by
 * identity, so a set rebuilt inside the render callback is a new object every frame, every frame
 * bumps `rev`, and `rev` is what every cache in the kit keys on. The symptom of getting that
 * wrong is not a wrong color — it is an exhibit that gets slower at dusk and stays slow.
 */
import { extendStops, hex, withAlpha, type Palette, type Pen, type Rgba, type Stops } from '@lattice/draw';

/**
 * Every soft glow in this exhibit, drawn so that `draw`'s radial-ramp cache can hit.
 *
 * ## The trap, which this exhibit is the worst possible shape for
 *
 * `canvas2d`'s `rampFor` keys its cached radial gradient on the **exact** `(inner, outer)` color
 * pair, unquantized, and evicts **wholesale** — `ramps.clear()` at ninety-six entries. So a color
 * that varies continuously misses every single frame, and each miss allocates a `<canvas>`, a
 * context, a gradient and a fill. Worse, the wholesale clear takes every *well-behaved* call site
 * down with it: the four hundred contact shadows in this frame use one constant tint and would
 * cache perfectly, right up until a pulsing firefly evicts them.
 *
 * This exhibit is the worst case for it twice over. Every glow color here is a **palette slot**,
 * and the palette is re-interpolated every frame for ninety seconds — so `warn` is a different
 * number on every frame of the day whether anything pulses or not. And then the alphas *do*
 * pulse: a firefly's blink, a sun's height, a cloud's rim. Measured before this function existed:
 * **2.6 to 3.8 gradients allocated per frame at noon, peaking at fifteen in one frame.**
 *
 * ## The fix is two changes, and the second is the one that matters
 *
 * **The color is snapped** to sixteen levels a channel. A day's worth of `warn` collapses to
 * about ten distinct values instead of five thousand, and no eye can tell which of them it is
 * looking at through a glow at 20% opacity.
 *
 * **The alpha leaves the key altogether.** It rides `Surface.alpha` — the backend's `globalAlpha`
 * — which multiplies the blit and produces exactly the same pixels as varying the inner stop,
 * because a ramp is linear in its own alpha. That is what takes this from "fewer misses" to
 * "one cache entry per color, for ever": the continuous half of the value never reaches the key,
 * so a firefly may blink at whatever rate it likes for free.
 *
 * Motion is untouched. Positions, radii, blink rates and the sun's arc are all still continuous;
 * it is only the *key* that is coarse.
 */
export function softGlow(pen: Pen, x: number, y: number, rx: number, ry: number, color: Rgba, alpha: number): void {
  // Not `>= 0`: a glow this faint is below one level of an 8-bit channel, so it is a cache entry
  // and a blit in exchange for nothing.
  if (!(alpha > 0.004)) return;
  const ink = (color & 0xf0f0f0ff) >>> 0;
  const previous = pen.surface.alpha(alpha < 1 ? alpha : 1);
  pen.surface.softEllipse(x, y, rx, ry, withAlpha(ink, 1), withAlpha(ink, 0));
  pen.surface.alpha(previous);
}

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

//                  sky       ground    ink       brand     metal     glass     warn      ok        bad       night
const DAWN_ROW = '#93b6dd #66a05c #212a46 #e4795a #8e8da4 #8ac4dc #ffb268 #5ab471 #d4544a #101a34';
const DAY_ROW = '#5ec8f2 #5cb84e #16203a #e2643c #a49780 #63d2ea #ffcf3f #46c25f #e04a3c #0a1230';
const DUSK_ROW = '#f28a56 #7e9147 #2b1f39 #c2452f #8f7b72 #6e97b8 #ffb02c #4aa058 #cc3f36 #150f2e';
const NIGHT_ROW = '#182a58 #2b4b3e #0a1120 #6d3630 #48536a #34698f #ffd27a #35744b #a8352f #050a1a';

/** First light: cool, clear, and the only hour with blue shadows on warm sand. */
export const DAWN = stops(DAWN_ROW, {
  sand: '#e9cba4', deep: '#1b4a72', shoal: '#63bccc', foam: '#fff0e6', bloom: '#e8f4ff', rock: '#78809a',
});
/** Noon. The first frame opens four fifths of the way here, and it is the saturated one. */
export const DAY = stops(DAY_ROW, {
  sand: '#f4e2b2', deep: '#0f5c8e', shoal: '#4ddce0', foam: '#ffffff', bloom: '#f2fbff', rock: '#8e9490',
});
/** The long evening. Warmer than the midpoint of its neighbours, which is why it is authored. */
export const DUSK = stops(DUSK_ROW, {
  sand: '#daa87a', deep: '#28496a', shoal: '#84a9b4', foam: '#ffe2c4', bloom: '#d8f0e4', rock: '#79697a',
});
/** Midnight, pulled *up* rather than down: an unreadable frame is a worse failure than a night
 *  that is not literally black, and the dark a viewer feels comes from `LightField`'s mask,
 *  which has an edge, rather than from the palette, which does not. */
export const NIGHT = stops(NIGHT_ROW, {
  sand: '#4d5872', deep: '#071c38', shoal: '#1d4c66', foam: '#b6cce4', bloom: '#7dffcf', rock: '#2f3950',
});

/** The loop, in the order the day runs. Hoisted; see the header. */
const HOURS: readonly Stops[] = [DAWN, DAY, DUSK, NIGHT];

/**
 * Put the hour's colors on the palette. `phase` is 0 at first light and wraps at 1.
 *
 * A loop through four anchors rather than a blend of three, so the last quarter runs
 * `NIGHT → DAWN` and closes the circle. There is no branch here for "is it day": a cycle with an
 * `if` in it has a seam, and the seam is always visible on the frame it crosses.
 */
export function rollPalette(palette: Palette, phase: number): void {
  const at = phase * HOURS.length;
  const i = Math.floor(at) % HOURS.length;
  palette.lerp(
    HOURS[i] ?? DAY,
    HOURS[(i + 1) % HOURS.length] ?? DAY,
    at - Math.floor(at),
  );
}
