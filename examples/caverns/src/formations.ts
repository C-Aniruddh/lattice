/**
 * The five things standing in the cave, and the cold light two of them throw.
 *
 * @art
 *
 * Delete this module and the cavern still generates, still sorts an empty order, still lights an
 * empty floor. It would be a flat room.
 *
 * ## The five rules are the gallery's and are not preferences
 *
 * 1. **Silhouette first.** A stalagmite is a cone; a column is a waisted post that touches both
 *    the floor and the roof; a crystal cluster is a fan of straight-edged shards; rubble is low
 *    and angular; flowstone is a wide tiered skirt. Told apart at thirty pixels with the color
 *    off — which in this exhibit is not a thought experiment, because most of the frame *is* the
 *    color turned off.
 * 2. **Detail at three scales**: massing, then the repeat that gives it rhythm — drum count,
 *    shard count, flowstone tiers — then trim: a wet cap, a lit shard tip, gravel at the foot.
 * 3. **Three-tone faces from one slot.** Every color here is a palette name, never a hex.
 * 4. **Something moves on every object.** A stalagmite grows a drip that swells and falls; a
 *    column has one running down it; a crystal breathes. Rubble is the exception and it is a
 *    deliberate one — a hundred twitching pebbles is noise, and rubble is what the eye rests on.
 * 5. **Variation is keyed on identity, never on draw order.** `massing` and `animate` are each
 *    handed a stream rewound from `Variant.seed`, so a formation is the same on every reload and
 *    after every re-sort.
 *
 * ## Why the crystals emit from `animate` and not from `emit`
 *
 * `SpriteDef.emit` is the sanctioned hook: it runs only when an active `LightField` is attached,
 * which is exactly what a lamp wants. **It is handed no clock.** Its parameters are the field,
 * the position, the `Variant`, an `Rng` and the ground elevation — there is no `pen` and no `t` —
 * so an emitter can post a pool of a fixed intensity and nothing else. A crystal that breathes, a
 * torch that gutters, a lamp that is switched on: none of them can be written through it, and
 * every one of them is what a light in a game actually does.
 *
 * So the pool is posted from `animate`, which has the pen and therefore the clock, through
 * `pen.light?.add` — the same place `island`'s fireflies ended up, for the same reason. That two
 * exhibits independently routed around the same hook is the finding, and it is in the report.
 */
import { noise2 } from '@lattice/core';
import { gridToScreen } from '@lattice/iso';
import {
  LEVEL_H,
  defineSprite,
  drawSprite,
  isoBox,
  isoCylinder,
  mix,
  pxToLevels,
  withAlpha,
  type Pen,
  type SpriteDef,
} from '@lattice/draw';
import type { Bucket } from '../../_shared/src/index.js';
import type { Cavern, Flame, Lit } from './cavern.js';
import { flame, gutter, pool, snap } from './ambient.js';

/** Scratch, module-scope. Nothing here is re-entrant and nothing retains it. */
const pt = { x: 0, y: 0 };

/** Screen point for a grid position at a storey height, with the frame's pixel snap applied. */
function at(pen: Pen, gx: number, gy: number, levels: number): { x: number; y: number } {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * A drip: a bead that swells at the tip of something, lets go, falls, and starts again.
 *
 * Closed form in `pen.t` and a per-instance phase, so it costs no state and is identical on every
 * reload. The bead is drawn on the *lit* half of the cave only in the sense that it is drawn at
 * all — the mask decides whether anybody sees it, which is the whole idea of the exhibit playing
 * out on the smallest object in it.
 */
function drip(pen: Pen, gx: number, gy: number, top: number, phase: number, run: number): void {
  const cycle = (pen.t * 0.42 + phase) % 1;
  const fall = cycle < 0.72 ? 0 : (cycle - 0.72) / 0.28;
  const swell = cycle < 0.72 ? 0.4 + cycle * 0.8 : 1;
  const p = at(pen, gx, gy, top - fall * fall * run);
  const k = pen.camera.zoom;
  const wet = mix(pen.palette.get('flow'), pen.palette.get('crystal'), 0.4);
  pen.surface.ellipse(p.x, p.y, 1.5 * swell * k, 2.1 * swell * k, withAlpha(wet, 0.55));
}

// ── the stalagmite, which is most of the cave ────────────────────────────────────────────────

/** Six shrinking drums on a slight lean, wet-capped. The cave's signature, and the one whose
 *  count is in the hundreds — so its massing is six primitives and stays six. */
export const stalagmite = defineSprite({
  id: 'stalagmite',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const h = 0.7 + rng.next() * 2.1;
    const lean = (rng.next() - 0.5) * 0.3;
    w.shadow(0.2, 0.2, 0.6, 0.6, 0.5);
    for (let i = 0; i < 5; i++) {
      const k = i / 5;
      w.cylinder(0.5 + lean * k * k, 0.5 + lean * k * k * 0.8, 0.3 - k * 0.24, {
        color: i > 2 ? 'flow' : 'rock',
        h: h / 5 + 0.04,
        z: k * h,
        outline: i === 0,
      });
    }
    // Trim: a gravel skirt, which is what stops a cone reading as a traffic cone.
    w.patch(0.16 + rng.next() * 0.2, 0.2 + rng.next() * 0.2, 0.4, 0.34, 0.008, 'damp', 'ink');
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const h = 0.7 + rng.next() * 2.1;
    const lean = (rng.next() - 0.5) * 0.3;
    drip(pen, gx + 0.5 + lean, gy + 0.5 + lean * 0.8, pxToLevels(zPx) + h + 0.1, rng.next() * 7, h * 0.9);
  },
});

// ── the column, which is what gives the cave a roof ──────────────────────────────────────────

/** Floor to ceiling, waisted in the middle. Tall and thin, so it is also this exhibit's test of
 *  `iso.depth`: a column in front of a torch must occlude the torch and not the other way round. */
export const column = defineSprite({
  id: 'column',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const h = 4.2 + rng.next() * 2.6;
    const waist = 0.16 + rng.next() * 0.07;
    w.shadow(0.14, 0.14, 0.72, 0.72, 0.6);
    w.cylinder(0.5, 0.5, waist * 2.1, { color: 'rock', h: h * 0.16, outline: true });
    w.cylinder(0.5, 0.5, waist, { color: 'flow', h: h * 0.72, z: h * 0.14, outline: false });
    w.cylinder(0.5, 0.5, waist * 1.9, { color: 'rock', h: h * 0.2, z: h * 0.82, outline: false });
    // Rhythm: three flowstone collars up the shaft, so the column has a scale on it.
    for (let i = 0; i < 3; i++) {
      w.cylinder(0.5, 0.5, waist * (1.25 + rng.next() * 0.3), {
        color: 'flow',
        h: 0.1,
        z: h * (0.24 + i * 0.2),
        outline: false,
      });
    }
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const h = 4.2 + rng.next() * 2.6;
    drip(pen, gx + 0.5, gy + 0.5, pxToLevels(zPx) + h * 0.98, rng.next() * 7, h * 0.92);
  },
});

// ── the crystal cluster, which is the cold half of the light ─────────────────────────────────

/**
 * A fan of shards, and a pool of cold light under it.
 *
 * The pool is deliberately small and weak — a fifth of a torch's intensity over a third of its
 * radius. Crystals are the exhibit's *texture* in the dark rather than its illumination: a
 * hundred of them across the cave give the far rock something to be seen by, and if any one of
 * them were bright enough to read a floor by there would be no dark left to carry the torches.
 */
export const crystal = defineSprite({
  id: 'crystal',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.24, 0.24, 0.52, 0.52, 0.34);
    const n = 3 + ((rng.next() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const s = 0.1 + rng.next() * 0.11;
      w.box(0.24 + rng.next() * 0.42, 0.24 + rng.next() * 0.42, s, s, {
        color: 'crystal',
        h: 0.3 + rng.next() * 0.85,
        outline: i === 0,
        alpha: 0.9,
      });
    }
    w.patch(0.28, 0.28, 0.44, 0.44, 0.006, 'damp');
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const phase = rng.next() * 30;
    // Breathing, not blinking: a crystal that switched would read as a UI element.
    const beat = 0.62 + noise2(0x9c, phase, pen.t * 0.35) * 0.38;
    // The halo and the pool are colors and take the snapped beat; the core is an `ellipse`, which
    // never reaches the ramp cache, and keeps the raw one. See `ambient.ts`'s `snap`.
    const q = snap(beat);
    const p = at(pen, gx + 0.5, gy + 0.5, pxToLevels(zPx) + 0.5);
    const k = pen.camera.zoom;
    const cold = pen.palette.get('crystal');
    pen.surface.softEllipse(p.x, p.y, 13 * k, 13 * k, withAlpha(cold, q * 0.26), withAlpha(cold, 0));
    pen.surface.ellipse(p.x, p.y - 2 * k, 1.7 * k, 1.7 * k, withAlpha(mix(cold, 0xffffffff, 0.6), beat));
    pen.light?.add(gx + 0.5, gy + 0.5, zPx, 2.6, q * 0.2, 'crystal');
  },
});

// ── rubble and flowstone, which are what the floor is wearing ────────────────────────────────

/** Low, angular, and the only thing in the cave that does not move. See rule 4 above. */
export const rubble = defineSprite({
  id: 'rubble',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.22, 0.22, 0.56, 0.56, 0.36);
    for (let i = 0; i < 4; i++) {
      w.box(0.16 + rng.next() * 0.44, 0.16 + rng.next() * 0.44, 0.14 + rng.next() * 0.16, 0.13 + rng.next() * 0.15, {
        color: i === 3 ? 'damp' : 'rock',
        h: 0.1 + rng.next() * 0.26,
        outline: i === 0,
      });
    }
  },
});

/** A wide tiered skirt of pale mineral. It is the brightest unlit surface in the cave, which is
 *  what makes it the thing a visitor sees first at the edge of a pool. */
export const flowstone = defineSprite({
  id: 'flowstone',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.1, 0.1, 0.8, 0.8, 0.42);
    for (let i = 0; i < 4; i++) {
      const k = i / 4;
      w.cylinder(0.5, 0.5, 0.46 - k * 0.3, {
        color: i % 2 === 0 ? 'flow' : 'rock',
        h: 0.14 + rng.next() * 0.1,
        z: k * 0.62,
        outline: i === 0,
      });
    }
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    // A sheet of water crossing the tiers, as one moving highlight rather than a drip.
    const run = (pen.t * 0.3 + rng.next()) % 1;
    const p = at(pen, gx + 0.5, gy + 0.5, pxToLevels(zPx) + 0.7 - run * 0.66);
    const k = pen.camera.zoom;
    const wet = pen.palette.get('flow');
    pen.surface.ellipse(p.x, p.y, 7 * k, 3 * k, withAlpha(wet, (1 - run) * 0.3));
  },
});

/**
 * The species table as a function.
 *
 * `noUncheckedIndexedAccess` makes `SHAPES[kind]` a `SpriteDef | undefined`, and the `?? SHAPES[0]`
 * that answers it is *also* possibly undefined — so the call site ends up with either a `!`, which
 * the house style bans, or a fallback branch no test can reach. A switch with a default returns a
 * `SpriteDef` and the question does not arise.
 */
export function shape(kind: number): SpriteDef {
  switch (kind) {
    case 0:
      return stalagmite;
    case 1:
      return column;
    case 2:
      return crystal;
    case 3:
      return rubble;
    default:
      return flowstone;
  }
}

/**
 * A brazier: an iron bowl on a stem, with charcoal in it.
 *
 * Drawn free-hand rather than through `defineSprite` because it has no static half worth
 * massing — three primitives — and because the fire above it is `ambient.ts`'s and has to be able
 * to sit at whatever height this bowl ended up at.
 */
function brazier(pen: Pen, f: Flame): void {
  const z = pxToLevels(f.base);
  isoCylinder(pen, f.gx + 0.5, f.gy + 0.5, 0.14, { color: 'metal', h: 0.42, z, outline: true });
  isoCylinder(pen, f.gx + 0.5, f.gy + 0.5, 0.28, { color: 'metal', h: 0.18, z: z + 0.38, outline: true });
  isoBox(pen, f.gx + 0.38, f.gy + 0.38, 0.24, 0.24, { color: 'ember', h: 0.07, z: z + 0.5, outline: false });
}

/** A torch: a stub of wood in the gravel. Two primitives, because there may be three hundred of
 *  them and every one of them is also two light pools. */
function torch(pen: Pen, f: Flame): void {
  const z = pxToLevels(f.base);
  const lean = (f.phase / 7 - 0.5) * 0.26;
  isoBox(pen, f.gx + 0.44 + lean, f.gy + 0.44, 0.13, 0.13, { color: 'ink', h: 0.56, z, outline: true });
  isoBox(pen, f.gx + 0.4 + lean, f.gy + 0.4, 0.21, 0.21, { color: 'ember', h: 0.07, z: z + 0.54, outline: false });
}

/**
 * The Solids pass: every formation *and every flame* in the one sorted order, back to front.
 *
 * Two kinds through one bucket is what `Bucket<T>`'s generic is for, and it is not a convenience
 * here: a torch standing in front of a column must be painted after it, and the exhibit's whole
 * claim would be undone by a torch that shone through the rock in front of it.
 *
 * The pen reaches the visitor through a module variable rather than a closure because
 * `Bucket.each` passes its visitor no context and asks in its own doc comment that the visitor be
 * hoisted — "a closure allocated here is a closure per frame", against eight hundred items.
 */
let scenePen: Pen | undefined;

const paint = (item: Lit): void => {
  const pen = scenePen;
  if (pen === undefined) return;
  if ('big' in item) {
    if (item.big) brazier(pen, item);
    else torch(pen, item);
    flame(pen, item);
  } else {
    drawSprite(pen, shape(item.kind), item.gx, item.gy, item.v, item.base);
  }
};

export function paintScene(pen: Pen, bucket: Bucket<Lit>): void {
  scenePen = pen;
  bucket.each(paint);
}

/**
 * Every burning flame's light, posted before the world draws.
 *
 * **This is the measurement the exhibit exists to make.** It is a flat walk with no culling in
 * it, deliberately: `docs/GALLERY.md` § Scale asks for lights to be counted separately because
 * they are not free the way sprites are, and `draw`'s own claim is that a light field's cost is
 * its *buffer* rather than its count. Culling the walk would hide whichever of those two is
 * true. The `active` guard is the one exception and it is the field's own: at darkness zero it
 * allocates nothing and every `add` returns immediately, so a lit scene pays nothing for three
 * hundred lights it is not using.
 *
 * A brazier reaches twelve tiles at full power and a torch seven and a half at 86%, which is not
 * decoration: a scene reads as lit **by scarcity and falloff** rather than by how many sources
 * are in it, and three hundred equal lights would be a flat grey floor with the same pool count.
 */
export function pourScene(pen: Pen, cave: Cavern, burning: number): void {
  const field = pen.light;
  if (field === undefined || !field.active) return;
  const flames = cave.flames;
  const n = Math.min(burning, flames.length);
  for (let i = 0; i < n; i++) {
    const f = flames[i];
    if (f === undefined) continue;
    pool(field, f.gx + 0.5, f.gy + 0.5, f.base, gutter(pen.t, f.phase), f.big ? 12 : 7.5, f.big ? 1 : 0.86);
  }
}
