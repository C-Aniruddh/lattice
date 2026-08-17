/**
 * Two states of one cave: asleep, and awake because you woke it.
 *
 * @art
 *
 * Delete this file and the cavern still generates, still hums, still opens — in the kit's default
 * daylight, which for a cave is the single funniest way an exhibit can be wrong. Everything here
 * is color.
 *
 * ## The cycle is progress, not time
 *
 * Every other exhibit in the gallery that rolls a palette rolls it on a clock. This one rolls it
 * on **how much of the cave you have opened**, which makes the color a readout rather than a
 * schedule: a visitor who is stuck sees the same cave, and a visitor who has opened nine gates is
 * standing somewhere visibly warmer. It is the same number the bed's `tone` gets, so the cave
 * cannot look warm and sound cold.
 *
 * `sky` is in the table because `BASE_SLOTS` has ten slots and `Palette.lerp` refuses two stop
 * sets that do not name exactly the same ones. It is never drawn. There is no sky here.
 *
 * ## The floor is darker than the rock, which is the opposite of every other exhibit
 *
 * Everywhere else in the gallery the ground is the lit thing and the massing is the shadow. Here
 * the ground is a **hole in the rock** and the rock is what ambient there is, so `ground` is the
 * darkest slot in the table and `rock` is a full step above it. That one inversion is what stops
 * the frame reading as bright plates floating over a void: a pocket of floor is dark because it is
 * a pocket, and it becomes bright only where a lamp is actually standing in it — which is the
 * exhibit's whole premise, made out of two hex values instead of a mechanic.
 *
 * ## The five slots the kit does not have
 *
 * `rock`, `damp`, `vein`, `ember` and `moss`, added through `extendStops`, which is the
 * sanctioned way in. `vein` is the one that earns its place twice: it is the bioluminescence that
 * makes unlit rock *textured* rather than merely dark, and it is a slot rather than a constant so
 * that it can be cold and faint in a sleeping cave and green-warm in a woken one, with no branch
 * anywhere in `rock.ts`.
 *
 * Both results are hoisted to module scope, because `Palette.lerp` compares stop sets by identity
 * — a set rebuilt inside the render callback bumps `rev` every frame, and `rev` is what every
 * cache in the kit keys on.
 */
import { extendStops, hex, type Palette, type Stops } from '@latticekit/draw';

const SLOTS = ['sky', 'ground', 'ink', 'brand', 'metal', 'glass', 'warn', 'ok', 'bad', 'night'] as const;

/** One row of ten hexes plus this exhibit's own five, into a `Stops`. */
function stops(row: string, extra: Record<string, string>): Stops {
  const out: Record<string, number> = {};
  const values = row.split(' ');
  for (let i = 0; i < SLOTS.length; i += 1) out[SLOTS[i] ?? ''] = hex(values[i] ?? '#000');
  const more: Record<string, number> = {};
  for (const [slot, value] of Object.entries(extra)) more[slot] = hex(value);
  return extendStops(Object.freeze(out), Object.freeze(more));
}

//              sky     ground  ink     brand   metal   glass   warn    ok      bad     night
const COLD = '#0a0d16 #232734 #05060d #b8563a #6b6a7e #6aa6bd #e2a63a #4fae61 #c9433a #04050b';
const WARM = '#141020 #3a3327 #0a0812 #d76a3e #837e91 #86c2d4 #ffc357 #63c374 #dc5040 #0a0812';

/** A cave nobody has answered: gray, wet, and lit by nothing but its own lichen. */
export const ASLEEP = stops(COLD, {
  rock: '#4a4657', damp: '#1d2c38', vein: '#4fc3cf', ember: '#d99a5a', moss: '#3d6b55',
});
/** Every gate open: the rock holds the light it has been given, and the veins have warmed. */
export const AWAKE = stops(WARM, {
  rock: '#635a70', damp: '#2c4450', vein: '#8ff0e2', ember: '#ffc487', moss: '#5d9a73',
});

/**
 * Put the cave's temperature on the palette. `progress` is 0 at the first frame and 1 when every
 * gate is open.
 *
 * Eased rather than linear, and eased *early*: the first two or three gates should visibly change
 * the room, because that is when a player is deciding whether the exhibit responds to them at
 * all. A hundred and forty gates on a straight line would move the color by two percent for the
 * first success anybody has, which is the same as not moving it.
 */
export function rollPalette(palette: Palette, progress: number): void {
  const p = progress <= 0 ? 0 : Math.sqrt(Math.sqrt(progress));
  palette.lerp(ASLEEP, AWAKE, p);
}
