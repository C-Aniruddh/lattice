/**
 * Blue hour and midnight, and the hour hand between them.
 *
 * @art
 *
 * A city is the one subject where the light does not come from the sky. Everything legible in
 * this exhibit — the window rhythm, the street pools, the neon, the crane's beacon — is *warm and
 * small* against a *cool and large* ground, and that contrast is a palette decision before it is
 * a drawing decision. So both stop sets below are built the same way: the cool slots move a long
 * way between the two hours and the warm ones barely move at all, because a lit window at
 * midnight is the same lamp it was at dusk. The sky falls away from it, and that reads as night.
 *
 * Two hours rather than a full cycle, deliberately: the day/night cycle is the Island exhibit's
 * one idea and a second exhibit doing it worse helps nobody. This one opens at the blue hour —
 * the most saturated minute a city ever has — and sinks about a stop and a half over the first
 * minute a visitor is looking at it.
 *
 * All the usual constraints hold. Both sets define exactly the same slots, which `Palette.lerp`
 * requires and which is the silent way a game ends up with one thing still gold at midnight; and
 * both are **hoisted to module scope**, because `lerp` compares stop sets by identity and a set
 * rebuilt inside the render callback bumps `rev` sixty times a second — the symptom of which is
 * not a wrong color but a frame time that climbs and stays climbed.
 *
 * **Four slots past the kit's ten**, through `extendStops`, because each is a color this subject
 * has and the base ten do not: `lamp` is the cold fluorescent an office floor is lit by, and it
 * is the second window temperature that stops a tower reading as one repeated sticker; `neon` is
 * the sign color; `road` and `curb` are asphalt and concrete, which are neither `ground` nor
 * `metal` and look wrong borrowed from either.
 */
import { clamp01 } from '@lattice/core';
import { extendStops, hex, type LightField, type Palette, type Pen, type Stops } from '@lattice/draw';

/** The kit's ten, in the order the rows below are written. */
const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes into a stop set, so the two hours can be read as two lines. */
function stops(row: string): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i++) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  return Object.freeze(out);
}

/**
 * **Both rows moved down about a stop and a half, and only the cool half moved.**
 *
 * Contrast between a lit window and an unlit wall can be bought in two currencies — a deeper night
 * *mask*, or a darker *palette* — and they are not equivalent. The mask multiplies everything it
 * covers, so buying contrast there takes the windows down with the walls and the answer to "the
 * unlit state is not dark enough" becomes a city whose lit state is not lit either. The palette
 * costs the windows nothing: `warn`, `lamp` and `neon` are the same colors they were, and every
 * cool slot beside them is darker, so the ratio between them widens with nothing spent on the one
 * side of it that matters.
 */
//                 sky     ground  ink     brand   metal   glass   warn    ok      bad     night
const BLUE_ROW = '#20386e #26533a #0a1120 #5d2c21 #2c3552 #14264a #ffc86e #34865a #e0574a #03060f';
const DARK_ROW = '#0c1636 #16301f #050912 #3a1a12 #1b2136 #0b1732 #ffd07a #205740 #cf4038 #010308';

/** The blue hour: the sky still has a color in it and every window is already on. */
export const BLUE = extendStops(stops(BLUE_ROW), {
  lamp: hex('#9db7d6'),
  neon: hex('#ff6ea8'),
  road: hex('#161d38'),
  curb: hex('#333c58'),
});

/** An hour later. The sky has gone and the building faces are only what they are lit by. */
export const DARK = extendStops(stops(DARK_ROW), {
  lamp: hex('#90aac9'),
  neon: hex('#ef4f95'),
  road: hex('#0c1128'),
  curb: hex('#1f273e'),
});

/**
 * Snap a continuously varying alpha, intensity or mix factor to twelve levels.
 *
 * **This is a workaround for a named trap in `draw`, and it belongs in the art rather than in the
 * exhibit's logic.** `canvas2d`'s `softEllipse` — which is every glow, every contact shadow, every
 * puff of steam and every pool the light field accumulates — renders through a radial ramp cached
 * on the *exact* `(inner, outer)` color pair. A value that moves continuously with time therefore
 * misses on every frame, and a miss allocates a `<canvas>`, a context, a gradient and a fill. Worse,
 * eviction is wholesale at ninety-six entries, so one animated color drops the cache for every
 * constant-colored site as well.
 *
 * Measured in this exhibit before the fix: **27.2% of all soft ellipses were misses** — of the
 * order of eight hundred canvas allocations per frame, and the cache destroyed several times per
 * frame. Twelve levels is well under what anyone resolves in a small glow, and the *motion* — the
 * flicker rate, the drift, the position, the radius — stays continuous.
 *
 * `draw`'s own fix — snapping the ramp key to a few levels and evicting per entry rather than
 * wholesale — **has since landed, and this is still worth keeping.** Measured in this exhibit, on
 * the same frame, with the kit fix in place: **2.77%** of soft ellipses miss without the two
 * quantizations below and **0.26%** with them. The kit's snap is coarse enough to catch most of it
 * and fine enough that thirty animated glows still walk across its levels; snapping at the source
 * costs one multiply and removes the rest. Delete it if `draw`'s levels ever get coarser.
 */
export function snap(value: number): number {
  return Math.round(value * 12) / 12;
}

/** Seconds of blue hour before the light starts to go, and how long it takes to go. */
const HOLD_SEC = 6;
const FALL_SEC = 54;

/**
 * The hour hand: 0 at the opening frame, 1 a minute later, and it stays there.
 *
 * The hold is what makes the *first* frame the saturated one. A schedule that starts falling
 * immediately spends its best color on the second nobody is looking.
 */
export function hourAt(seconds: number): number {
  return clamp01((seconds - HOLD_SEC) / FALL_SEC);
}

/**
 * Put the hour into the frame: the palette between the two sets, and the night mask over it.
 *
 * One function, because the two must not be given separate schedules. A world whose blue and
 * whose darkness disagree is a light bug that gets filed against `draw`, and the only structural
 * defense is that there is one number and one place it is read.
 *
 * The mask never reaches 1. The city is lit from inside the buildings, and a mask that took the
 * streets to black would take the only thing on screen that is not a window with it.
 */
export function nightfall(pen: Pen, palette: Palette, light: LightField, hour: number, scale: number): void {
  // **Thirty-two steps, not a continuum, and this one line is the largest single frame-time win in
  // the exhibit.** Every color anything draws with is derived from this palette, so a lerp that
  // moves every frame makes *every* color in the scene new every frame — and `draw` caches its
  // radial ramps on the exact color. Snapping the schedule to thirty-two stops over the minute it
  // takes to fall makes the whole palette hold still for about 1.7 seconds at a time, which turns a
  // guaranteed miss into a guaranteed hit for every glow in the frame. Nobody sees a step: the HUD
  // already smooths its own side with a CSS transition for precisely the same reason, and `rev`
  // moving thirty-two times instead of thirty-six hundred is what that guard was written for.
  palette.lerp(BLUE, DARK, Math.round(hour * 32) / 32);
  // **A pool's radius is in tiles, so its cost is the square of the zoom.** The light field's price
  // is the *area* it accumulates, not the number of pools in it — the same thirty pools that are a
  // rounding error at the opening frame measured 9.5 ms at the closest zoom, because every one of
  // them is fourteen times the screen area it was. `scale` is a live option for exactly this kind
  // of trade, and it is the one quantity that can be given back for free: a pool three times larger
  // on screen is sampled three times more finely than it needs to be. `scale` is the caller's own
  // ceiling — the panel's knob and the URL still choose it — divided by however far in the visitor
  // has pulled. Measured at 2.6× zoom: 18.1 ms before, 8.6 ms after.
  light.configure({ scale: scale / Math.max(1, pen.camera.zoom) });
  // **0.4, not 0.7 — and the palette above is why.** The mask is the one instrument here that is
  // not occluded: `draw`'s light field composites in screen space, so every pool a street lamp
  // throws is also a pale ellipse on the roof of whatever tower stands in front of it. The deeper
  // the mask, the harder every one of those cuts, so darkness is bought in the stop set where it
  // costs nothing and spent on the mask only as far as the pools need to read as pools.
  light.begin(pen, 0.3 + hour * 0.18, 'night');
}
