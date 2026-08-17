/**
 * The trees, the scrub and the boulders. Five silhouettes, and something moving on every one.
 *
 * @art
 *
 * Delete this module and the island still generates the same seabed, still sorts the same
 * footprints, still runs the same ninety seconds. It would be bald.
 *
 * ## The five rules, which are the demo's and are not preferences
 *
 * 1. **Silhouette first.** A palm is a bare curved stem under a splayed rosette; a broadleaf is
 *    a mound of overlapping drums; a pine is a stack of shrinking discs on a spike; scrub is
 *    knee-high and wide; a boulder is angular and shorter than everything. At forty pixels they
 *    are told apart with the color turned off, and that is the test.
 * 2. **Detail at three scales**: massing, then the repeat that gives it rhythm — frond count,
 *    canopy tiers, boulder facets — then trim: fruit, a lit crown edge, a fallen frond in the
 *    grass. Skipping the middle scale is exactly what makes generated geometry look generated.
 * 3. **Three-tone faces from one slot.** Every color here is a palette *name*, never a hex, so
 *    the wood goes gold at dusk and blue at midnight with everything else. `shade` derives the
 *    faces; a hand-picked second green would be the one thing on the island that does not roll.
 * 4. **Something moves on every object.** Fronds, crowns, leaf tips and even the grass at a
 *    boulder's foot ride one island-wide wind field plus a per-instance phase, so the wood moves
 *    *together* without moving in lockstep. A static wood reads as a screenshot of a wood.
 * 5. **Variation is keyed on identity, never on draw order** — and, for anything both hooks need
 *    to agree about, by *index* rather than by stream position. See {@link vat}: the two hooks are
 *    handed two different streams, so a shape re-derived by drawing in the same order is a
 *    different shape. This tree's lean and this tree's flowering are the same on every reload,
 *    after every re-sort, and in both halves of the same frame.
 *
 * ## The one thing the kit refuses, and how the fronds are drawn because of it
 *
 * `isoWall` throws on a segment whose `gx` and `gy` deltas are equal — correctly: world x is
 * `(gx − gy) · HALF_W`, so such a wall projects to a line of zero width and paints nothing. A
 * palm frond radiating on a circle passes through that diagonal twice per revolution, so a
 * crown built out of walls throws on two of its eight fronds and on the exact frame a sway
 * crosses the diagonal. The rosette here is built from `patch` — flat quads, which is what a
 * frond mostly is when you are looking down at it from a dimetric camera — and the problem is
 * gone rather than worked around with an epsilon.
 */
import { hash2, hashStep, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import {
  LEVEL_H,
  defineSprite,
  drawSprite,
  isoBox,
  isoCylinder,
  isoPatch,
  isoPost,
  mix,
  pxToLevels,
  withAlpha,
  type Ink,
  type Pen,
  type SolidWriter,
  type SpriteDef,
  type Variant,
} from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import type { Tree } from './island.js';
import { softGlow } from './palette.js';

const pt: Vec2 = { x: 0, y: 0 };

/**
 * The `i`th random number belonging to a tree, **addressed rather than streamed** — and the fix
 * for a bug you can see from across the room once you know to look for it.
 *
 * `drawSprite` hands `massing` and `animate` two *different* `Rng` streams, salted apart so that
 * "adding a draw to one cannot reshuffle another". That is the right call for the problem it
 * solves and it quietly breaks the one thing every animator here needs to do: re-derive the shape
 * its own massing chose. Both hooks drawing `rng.next()` twice for a height and a lean get two
 * different heights and two different leans — so the palm's massed crown sits at one place and
 * the wind-blown crown it is supposed to *be* sits at another, and the tree renders with its head
 * beside its neck. It is worst on the tallest, leaniest instances, which is why it survived a
 * review at a glance: most palms are close enough to overlap.
 *
 * Indexing by position fixes it because a variant's `i`th value is then a pure function of the
 * variant and the index, and both hooks can ask for value 0 and get the same number. Filed as a
 * kit finding (K49) with `variantAt(v, i)` as the proposed home for it; the `rng` parameter is
 * still the right tool for anything a hook needs *only* for itself.
 */
function vat(v: Variant, i: number): number {
  return toUnit(hashStep(v.seed, i));
}

/** The island's one wind, sampled at a position and a time. Everything that sways reads this,
 *  which is why a gust crosses the wood as a wave instead of shaking each tree on its own. */
function wind(pen: Pen, gx: number, gy: number, phase: number): number {
  const gust = noise2(0x4e2, gx * 0.05 + pen.t * 0.33, gy * 0.05) * 0.5 + 0.5;
  return noise2(0x4e2, phase, pen.t * 0.85) * (0.45 + gust * 0.85);
}

/** The screen point for a grid position at a storey height. The one conversion an animator needs. */
function at(pen: Pen, gx: number, gy: number, levels: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * Nine fronds around a point, as flat quads at descending heights.
 *
 * The two long axes are drawn as elongated rectangles and the four corners as squares, which is
 * enough asymmetry that a palm crown reads as fronds rather than as a disc — and the whole thing
 * survives being scaled down to a phone.
 *
 * **It is written twice, against the writer and against the pen, and that is deliberate.** The
 * one-implementation version takes the primitive as a callback, and a callback here is an arrow
 * allocated inside `massing` — which runs *per sprite per frame*, because `draw` has no sprite
 * cache by design. Three hundred palms would allocate six hundred closures every frame to save
 * nine lines of art, in a kit whose seventh non-negotiable is that the hot path allocates
 * nothing.
 */
function rosetteMassed(w: SolidWriter, cx: number, cy: number, z: number, r: number, fill: Ink): void {
  w.patch(cx - r * 1.15, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  w.patch(cx + 0.1, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  w.patch(cx - 0.1, cy - r * 1.15, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  w.patch(cx - 0.1, cy + 0.1, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  w.patch(cx - r * 0.82, cy - r * 0.82, r * 0.72, r * 0.72, z - 0.02, fill, 'ink');
  w.patch(cx + 0.1, cy - r * 0.82, r * 0.72, r * 0.72, z - 0.02, fill, 'ink');
  w.patch(cx - r * 0.82, cy + 0.1, r * 0.72, r * 0.72, z - 0.02, fill, 'ink');
  w.patch(cx + 0.1, cy + 0.1, r * 0.72, r * 0.72, z - 0.02, fill, 'ink');
  w.patch(cx - r * 0.34, cy - r * 0.34, r * 0.68, r * 0.68, z + 0.04, fill, 'ink');
}

/**
 * {@link rosetteMassed}, drawn free-hand at a position the wind chose — **five quads, not nine.**
 *
 * The live copy is drawn over the massed one every frame, so it is the half of a palm that is
 * paid for sixty times a second rather than once. The four corner quads it drops are the ones
 * that sit *inside* the massed silhouette at any zoom this exhibit opens at; what has to move for
 * the tree to read as bending is the two long axes and the crown. See its note for why this is
 * written out rather than shared with a callback.
 */
function rosetteLive(pen: Pen, cx: number, cy: number, z: number, r: number, fill: Ink): void {
  isoPatch(pen, cx - r * 1.15, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  isoPatch(pen, cx + 0.1, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - 0.1, cy - r * 1.15, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - 0.1, cy + 0.1, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - r * 0.34, cy - r * 0.34, r * 0.68, r * 0.68, z + 0.04, fill, 'ink');
}

// ── the palm, which is the island's signature ────────────────────────────────────────────────

/**
 * A curved stem in six segments and a rosette on top, with coconuts under it.
 *
 * The lean is squared along the stem so the curve is a curve and not a tilt, and the rosette
 * rides the top of it — which is what makes the whole tree read as *bending* when the wind
 * moves the crown a tenth of a tile.
 */
export const palm = defineSprite({
  id: 'palm',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const h = 2.5 + vat(v, 0) * 1.5;
    const lean = (vat(v, 1) - 0.5) * 0.62;
    w.shadow(0.18, 0.18, 0.64, 0.64, 0.44);
    // 1 — the stem: four shrinking drums on a squared curve, so it bows rather than tilts. It was
    //     six, and the two that went are invisible: a drum is a body ramp, a cap and an outline,
    //     so a segment of stem is three polygons and there are several hundred palms in a frame.
    for (let i = 0; i < 4; i++) {
      const k = i / 4;
      w.cylinder(0.5 + lean * k * k, 0.5 + lean * k * k * 0.75, 0.115 - k * 0.058, {
        color: 'metal',
        h: h / 4 + 0.04,
        z: k * h,
        outline: i === 0,
      });
    }
    const tx = 0.5 + lean;
    const ty = 0.5 + lean * 0.75;
    // 2 — rhythm: the rosette, and three quads of a darker under-layer where a second full
    //     rosette used to be. Nine more quads bought a shadow under the crown that the crown
    //     itself already casts.
    rosetteMassed(w, tx, ty, h + 0.3, 0.56, 'ok');
    w.patch(tx - 0.44, ty - 0.1, 0.86, 0.2, h + 0.02, 'ground', 'ink');
    w.patch(tx - 0.1, ty - 0.44, 0.2, 0.86, h + 0.02, 'ground', 'ink');
    w.patch(tx - 0.26, ty - 0.26, 0.52, 0.52, h + 0.06, 'ground', 'ink');
    // 3 — trim: two coconuts in the crotch, and a shed frond lying in the grass.
    for (let i = 0; i < 2; i++) {
      w.cylinder(tx - 0.1 + rng.next() * 0.2, ty - 0.1 + rng.next() * 0.2, 0.07, {
        color: 'brand',
        h: 0.1,
        z: h - 0.06,
        outline: false,
      });
    }
    w.patch(0.06 + rng.next() * 0.3, 0.62, 0.5, 0.16, 0.02, 'ground', 'ink');
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const h = 2.5 + vat(v, 0) * 1.5;
    const lean = (vat(v, 1) - 0.5) * 0.62;
    const sway = wind(pen, gx, gy, vat(v, 9) * 30) * 0.12;
    const tx = gx + 0.5 + lean + sway;
    const ty = gy + 0.5 + lean * 0.75 + sway * 0.55;
    // The crown, redrawn a fraction off its massed position: the whole rosette moves, which is
    // the difference between a palm in wind and a palm with a twitching leaf.
    rosetteLive(pen, tx, ty, z + h + 0.3, 0.56, 'ok');
    // A glint on the seaward fronds, only while the sun is up enough to make one.
    const p = at(pen, tx, ty, z + h + 0.34);
    const k = pen.camera.zoom;
    pen.surface.ellipse(p.x - 7 * k, p.y - 3 * k, 3.4 * k, 1.7 * k, withAlpha(mix(pen.palette.get('ok'), 0xfff8d0ff, 0.55), 0.4));
  },
});

// ── the broadleaf, which is most of the wood ─────────────────────────────────────────────────

/** A mound of overlapping drums on a short trunk. One in three flowers, which is where the
 *  island's warm accent comes from — and it is `brand`, so it rolls to coral at dusk. */
export const broadleaf = defineSprite({
  id: 'broadleaf',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const h = 1.5 + vat(v, 0) * 1.1;
    const flower = vat(v, 1) < 0.3;
    const leaf: Ink = flower ? 'brand' : 'ok';
    w.shadow(0.14, 0.14, 0.72, 0.72, 0.42);
    // 1 — a short trunk with a visible fork, because a straight post reads as a lollipop.
    w.post(0.5, 0.5, 0, h * 0.62, 'ink', 0.13);
    w.post(0.42, 0.58, h * 0.42, h * 0.34, 'ink', 0.08);
    // 2 — the canopy: four drums, each smaller and higher than the last, offset off-axis so the
    //     outline is lumpy at every zoom rather than concentric.
    const r = 0.34 + rng.next() * 0.14;
    for (let i = 0; i < 3; i++) {
      w.cylinder(0.5 + (rng.next() - 0.5) * 0.34, 0.5 + (rng.next() - 0.5) * 0.34, r * (1 - i * 0.21), {
        color: i === 2 ? 'ground' : leaf,
        h: h * 0.46,
        z: h * (0.5 + i * 0.25),
        outline: i === 0,
      });
    }
    // 3 — trim: fruit under the canopy edge, and a lit rim on the sunward side.
    for (let i = 0; i < 2; i++) {
      w.cylinder(0.5 + (rng.next() - 0.5) * 0.6, 0.5 + (rng.next() - 0.5) * 0.6, 0.05, {
        color: flower ? 'warn' : 'brand',
        h: 0.08,
        z: h * (0.62 + rng.next() * 0.4),
        outline: false,
      });
    }
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const h = 1.5 + vat(v, 0) * 1.1;
    const flower = vat(v, 1) < 0.3;
    const sway = wind(pen, gx, gy, vat(v, 9) * 30) * 0.11;
    // The top drum re-drawn on the wind, plus two leaf clusters at the canopy edge.
    isoCylinder(pen, gx + 0.5 + sway, gy + 0.5 + sway * 0.6, 0.2, {
      color: 'ground',
      h: h * 0.34,
      z: z + h * 1.07,
      outline: false,
    });
    isoBox(pen, gx + 0.24 + sway, gy + 0.52 + sway * 0.5, 0.17, 0.17, {
      color: flower ? 'brand' : 'ok',
      h: 0.15,
      z: z + h * 0.86,
      outline: false,
    });
  },
});

// ── the pine, which is what the ridge is wearing ─────────────────────────────────────────────

/** A spike of shrinking discs. Reads at ten pixels, which matters because these live highest up
 *  the hill and are therefore the smallest thing on screen at the opening zoom. */
export const pine = defineSprite({
  id: 'pine',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const h = 2.1 + vat(v, 0) * 1.4;
    w.shadow(0.18, 0.18, 0.64, 0.64, 0.4);
    w.post(0.5, 0.5, 0, h * 0.36, 'ink', 0.1);
    // Four tiers, each narrower and shorter, on a stem that stays visible between the lowest two.
    for (let i = 0; i < 4; i++) {
      const k = i / 4;
      w.cylinder(0.5, 0.5, (0.4 - k * 0.29) * (0.85 + rng.next() * 0.3), {
        color: i % 2 === 0 ? 'ok' : 'ground',
        h: h * 0.3,
        z: h * (0.22 + k * 0.72),
        outline: i === 0,
      });
    }
    w.post(0.5, 0.5, h * 1.03, h * 0.14, 'ok', 0.05);
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const h = 2.1 + vat(v, 0) * 1.4;
    const sway = wind(pen, gx, gy, vat(v, 9) * 30) * 0.07;
    // A conifer bends at the top and nowhere else, so only the leader moves.
    isoPost(pen, gx + 0.5 + sway, gy + 0.5 + sway * 0.6, z + h * 1.03, h * 0.16, 'ok', 0.05);
    isoCylinder(pen, gx + 0.5 + sway * 0.6, gy + 0.5 + sway * 0.4, 0.12, {
      color: 'ok',
      h: h * 0.14,
      z: z + h * 0.94,
      outline: false,
    });
  },
});

// ── scrub, and the boulders above the treeline ───────────────────────────────────────────────

/** Knee-high, wide, and the thing that makes a meadow read as a meadow rather than as a lawn. */
export const scrub = defineSprite({
  id: 'scrub',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.24, 0.24, 0.52, 0.52, 0.32);
    for (let i = 0; i < 4; i++) {
      w.cylinder(0.32 + rng.next() * 0.36, 0.32 + rng.next() * 0.36, 0.13 + rng.next() * 0.11, {
        color: i === 3 ? 'ground' : 'ok',
        h: 0.22 + rng.next() * 0.24,
        outline: i === 0,
      });
    }
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const sway = wind(pen, gx, gy, vat(v, 9) * 30) * 0.07;
    isoBox(pen, gx + 0.42 + sway, gy + 0.42 + sway * 0.5, 0.15, 0.15, {
      color: 'ok',
      h: 0.1,
      z: pxToLevels(zPx) + 0.34,
      outline: false,
    });
  },
});

/** Angular, low, and the only thing on the island with no green in it. Three facets, a lichen
 *  patch, and a tuft of grass at the foot that is the one part of it that moves. */
export const boulder = defineSprite({
  id: 'boulder',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.2, 0.2, 0.6, 0.6, 0.38);
    const h = 0.3 + rng.next() * 0.42;
    w.box(0.2, 0.22, 0.52, 0.48, { color: 'metal', h, inset: 0.03 });
    w.box(0.34, 0.16, 0.3, 0.32, { color: 'metal', h: h * 0.7, z: h * 0.72, outline: false });
    w.box(0.24, 0.5, 0.22, 0.2, { color: 'metal', h: h * 0.44, z: h * 0.5, outline: false });
    w.patch(0.28, 0.3, 0.24, 0.2, h + 0.005, 'ok');
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const sway = wind(pen, gx, gy, vat(v, 9) * 30) * 0.06;
    isoBox(pen, gx + 0.68 + sway, gy + 0.66 + sway * 0.5, 0.12, 0.12, {
      color: 'ok',
      h: 0.16,
      z: pxToLevels(zPx),
      outline: false,
    });
  },
});

/**
 * The Solids pass: every tree in the sorted order, painted back to front, with its fireflies.
 *
 * Like `ground.ts`'s terrain walk, this is here rather than in `main.ts` because `Bucket.each`
 * takes a visitor, passes it no context, and asks in its own doc comment that the visitor be
 * **hoisted** — "a closure allocated here is a closure per frame". The pen and the night have to
 * reach it somehow, and beside the drawing is the right side of that seam.
 */
let woodPen: Pen | undefined;
let woodNight = 0;

const paint = (t: Tree): void => {
  const pen = woodPen;
  if (pen === undefined) return;
  drawSprite(pen, species(t.kind), t.gx, t.gy, t.v, t.base);
  fireflies(pen, t.gx, t.gy, t.base, t.v.seed, woodNight);
};

export function paintWood(pen: Pen, wood: Bucket<Tree>, night: number): void {
  woodPen = pen;
  woodNight = night;
  wood.each(paint);
}

/**
 * The species table, as a function rather than an array.
 *
 * `noUncheckedIndexedAccess` makes `SPECIES[kind]` a `SpriteDef | undefined`, and the `?? SPECIES[0]`
 * that answers it is *also* possibly undefined — so the call site ends up with either a `!`, which
 * the house style bans, or a fallback branch no test can reach. A switch with a default returns a
 * `SpriteDef` and the whole question does not arise.
 */
export function species(kind: number): SpriteDef {
  switch (kind) {
    case 0:
      return palm;
    case 1:
      return broadleaf;
    case 2:
      return pine;
    case 3:
      return scrub;
    default:
      return boulder;
  }
}

/**
 * Fireflies rising out of the wood after dark, and the light they throw.
 *
 * They live here rather than in `ambient.ts` because they are keyed to the *trees* — each one
 * belongs to a tree and drifts around it — and because they are the exhibit's only emissive
 * thing: without them the light field would have nothing to do and the night would be a flat
 * mask rather than a wood with warm holes in it.
 */
export function fireflies(pen: Pen, gx: number, gy: number, zPx: number, id: number, night: number): void {
  // One tree in eight carries them. A pool per tree is three hundred `add` calls and a wood so
  // evenly lit that the mask has no shape; one in eight leaves dark between the lights, which is
  // the only reason to have a light field rather than a lower `darkness`.
  if (night <= 0.02 || (id & 7) !== 0) return;
  const warm = pen.palette.get('warn');
  for (let i = 0; i < 2; i++) {
    const blink = noise2(0x2a, id * 4.4 + i * 17, pen.t * 1.25) * 0.5 + 0.5;
    if (blink < 0.5) continue;
    const fx = gx + 0.5 + noise2(0xf1, id + i * 3.1, pen.t * 0.3) * 0.8;
    const fy = gy + 0.5 + noise2(0xf2, id + i * 5.7, pen.t * 0.27) * 0.8;
    const z = pxToLevels(zPx) + 0.6 + toUnit(hash2(id, i, 3)) * 1.6;
    const p = at(pen, fx, fy, z);
    const k = pen.camera.zoom;
    const a = night * (blink - 0.5) * 2;
    softGlow(pen, p.x, p.y, 9 * k, 9 * k, warm, a * 0.3);
    pen.surface.ellipse(p.x, p.y, 1.5 * k, 1.5 * k, withAlpha(mix(warm, 0xfffbe6ff, 0.6), a));
    pen.light?.add(fx, fy, zPx, 1.4, a * 0.5, 'warn');
  }
}
