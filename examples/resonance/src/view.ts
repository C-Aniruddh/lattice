/**
 * The frame: what is drawn, in what order, and every pool of light in it.
 *
 * @art
 *
 * Delete this file and the exhibit still generates its cave, still hums its chords, still knows
 * which strings you struck and still opens the gate you answered — on a black canvas. Everything
 * here is the picture, and the one number it hands back is `undefined`.
 *
 * It exists as its own module for the reason `docs/GALLERY.md` gives for splitting at all: the
 * pass table, the depth bucket and the light pools are eighty lines of drawing plumbing, and put
 * in `main.ts` they would be eighty lines the next reader has to walk past to find the puzzle.
 *
 * ## The lamp is the camera, and that is the whole navigation model
 *
 * There is no walker. What you are looking at is what you are carrying the lamp over, so panning
 * *is* walking — which means the first gesture anybody makes on an isometric canvas is exactly
 * the gesture the exhibit needs, and § Scale's "the player's first gesture is to go look at the
 * part they cannot see" is the mechanic rather than a hope.
 *
 * ## Where § Scale's cost row is actually spent
 *
 * Three budgets, and they are counted separately because they fail separately:
 *
 * | | bound | why that bound |
 * |---|---|---|
 * | terrain tiles | `renderFrame`'s own cull, margined by `maxHeightPx` | the roof height is chosen against this; see `cavern.ts` |
 * | solids | the bucket, culled by `DepthSorter.sort(camera)` — and formations are only minted within lamp reach | a formation in the dark is a shape nobody can see |
 * | **light pools** | {@link POOL_MAX}, hard | they are not free the way a sprite is, and a hundred and forty gates would each want one |
 */
import { LEVEL_H, renderFrame, type Ink, type LightField, type Passes, type Pen } from '@lattice/draw';
import { heightAt, type DepthSorter, type TileRange } from '@lattice/iso';
import { createBucket, type Bucket } from '../../_shared/src/index.js';
import type { Cavern, Gate } from './cavern.js';
import { rollPalette } from './palette.js';
import { beatOf, drawDust, mintSpires, paintGate, paintSpire, snapGlow, spireAt, type Look, type Spire } from './props.js';
import { drawVoid, glimmer, paintRock } from './rock.js';

type Drawable = Gate | Spire;

/**
 * How many *lamps* one frame may carry, the one you hold included. Each costs two `add` calls.
 *
 * Set by legibility and not by cost. `examples/caverns` measured 692 pools at a 5.6 ms worst
 * frame with the whole light subsystem about 0.2 ms of it, so rationing these for performance
 * would be rationing the wrong thing; what a hundred pools costs is not milliseconds, it is the
 * scarcity that makes a cave read as lit by lamps rather than by a switch.
 */
const POOL_MAX = 40;
/** How tall a gate's arch stands, in world pixels. The depth key, not the drawing. */
const ARCH_PX = LEVEL_H * 2.8;
/**
 * How dark an unlit tile is at the opening frame, before any gate is open.
 *
 * Legible dark rather than black, which is a distinction with a number behind it: at 0.9 the rock
 * outside a pool is a seventh of its painted color and the formations in it are invisible, so the
 * frame reads as a lit disc on a void and fails § Scale's fill row from the inside. At 0.84 the
 * silhouettes, the wall faces and the lichen all survive, and the pools still read as the only
 * things that are actually *lit*. It eases up as gates open, so opening the cave lightens it.
 */
const DARKNESS = 0.62;

let bucket: Bucket<Drawable> | undefined;
// The frame's context. Hoisted because `Bucket.each` hands its visitor an item and a position
// and nothing else, and its own doc asks callers not to allocate a closure per frame. That a
// visitor with no context parameter forces this on every caller is a finding, already filed by
// `examples/_shared`'s README as "the one wart".
let frame: Pen | undefined;
let view: Look | undefined;
let cavern: Cavern | undefined;

const paint = (item: Drawable): void => {
  const pen = frame;
  const look = view;
  if (pen === undefined || look === undefined) return;
  if ('chord' in item) paintGate(pen, item, look);
  else paintSpire(pen, item);
};

let passes: Passes | undefined;

/** Built once, on the first frame, because `maxHeightPx` comes from the map — and a `Passes`
 *  literal rebuilt per frame is an allocation on the one path that counts them. */
function makePasses(maxHeightPx: number): Passes {
  return {
    backdrop: (pen) => drawVoid(pen),
    maxHeightPx,
    terrain: (pen, visible: Readonly<TileRange>) => {
      const cave = cavern;
      const look = view;
      if (cave !== undefined && look !== undefined) paintRock(pen, cave, visible, look.lampGx, look.lampGy);
    },
    solids: () => bucket?.each(paint),
    // Between the solids and the light composite: the pools must be in the field before
    // `renderFrame` composites it, and this is the last pass that runs before it does.
    placement: (pen) => pools(pen),
    // Above the mask. Lichen and dust are sources, not lit surfaces.
    overlay: (pen) => {
      const cave = cavern;
      const look = view;
      glimmer(pen);
      if (cave !== undefined && look !== undefined) drawDust(pen, cave, look.lampGx, look.lampGy);
    },
  };
}

/**
 * Every pool of light in the frame.
 *
 * The lamp, then opened gates nearest first, then the locked ones — capped, so a chamber with
 * twenty gates in view costs the same as one with six. Locked gates get a small cold pool on
 * purpose: it is what populates the dark and lets a player see there is more cave in a direction
 * before they go and look, which is the difference between exploring and guessing.
 */
function pools(pen: Pen): void {
  const field = pen.light;
  const cave = cavern;
  const look = view;
  if (field === undefined || cave === undefined || look === undefined) return;
  const beat = beatOf(look);
  lamp(field, look.lampGx, look.lampGy, heightAt(cave.field, look.lampGx, look.lampGy), 10, 0.5 + beat * 0.18, 'glass');
  let spent = 1;
  for (const gate of cave.gates) {
    if (spent >= POOL_MAX) break;
    const dx = gate.gx - look.lampGx, dy = gate.gy - look.lampGy;
    if (dx * dx + dy * dy > 34 * 34) continue;
    if (gate.open) {
      const flicker = 0.9 + Math.sin(pen.t * 1.7 + gate.gx) * 0.08; /* @tier-b pixels only */
      lamp(field, gate.gx + 0.5, gate.gy + 0.5, gate.zPx, 11, flicker, 'ember');
    } else {
      lamp(field, gate.gx + 0.5, gate.gy + 0.5, gate.zPx, 5, gate === look.gate ? 0.34 + beat * 0.5 : 0.2, 'vein');
    }
    spent += 1;
  }
}

/**
 * One light, as **two** pools — a hot core at 30% of the reach and a halo at the full reach.
 *
 * Both halves of this are findings `examples/caverns` paid for and this exhibit takes as given.
 * A single pool's ramp is linear, so its constant slope reads as *the size of the lamp* rather
 * than as light falling off; nested, the union is steep in the middle and flat at the edge, which
 * is what lets two lamps meet inside each other's halo where there is no edge to become a seam.
 * The other half is `falloff: 1` at the field, set in `main.ts`: the parameter reads like a
 * plateau, but `Surface.softEllipse` has stops only at 0 and `r`, so at the default of 2 the ramp
 * restarts from full intensity at the center and every pool gets a hard elliptical rim.
 */
function lamp(field: LightField, gx: number, gy: number, zPx: number, reach: number, power: number, ink: Ink): void {
  // Snapped, because `LightField.add` ends in `softEllipse(withAlpha(ink, intensity), …)` and a
  // pool whose intensity answers the beat is a color that moves every frame. See `props.snapGlow`.
  const lit = snapGlow(power);
  field.add(gx, gy, zPx, reach * 0.3, lit, ink);
  field.add(gx, gy, zPx, reach, lit * 0.32, ink);
}

/**
 * One frame of cave.
 *
 * `light.begin` is called through `pen.light`, which is the same field `bootstrap` attached to
 * the pen — `LightField.begin` throws if it is handed a pen carrying a different one, which is
 * the check that closed the gallery's most expensive silent trap.
 */
export function drawCavern(pen: Pen, order: DepthSorter, cave: Cavern, look: Look): void {
  frame = pen;
  view = look;
  cavern = cave;
  // The color and the mask come off *one* number, here, on the same line of the frame. Two
  // schedules is a cave whose darkness and whose warmth disagree, and it is reported as a light
  // bug rather than as the two clocks it is.
  rollPalette(pen.palette, look.progress);
  pen.light?.begin(pen, DARKNESS - look.progress * 0.14, 'night');

  const list = (bucket ??= createBucket<Drawable>(order));
  list.clear();
  for (const gate of cave.gates) list.add(gate, gate.gx, gate.gy, 2, 2, gate.zPx + ARCH_PX);
  const minted = mintSpires(cave, look.lampGx, look.lampGy);
  for (let i = 0; i < minted; i += 1) {
    const spire = spireAt(i);
    if (spire !== undefined) list.add(spire, spire.gx, spire.gy, 1, 1, spire.zPx + spire.h * LEVEL_H * 2.6);
  }
  renderFrame(pen, (passes ??= makePasses(cave.maxHeightPx)), order);
}
