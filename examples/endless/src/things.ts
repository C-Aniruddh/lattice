/**
 * The six things that stand up — four trees, a boulder, and the beacon worth travelling to — and
 * the frame's decision about which of them are on screen.
 *
 * @art
 *
 * Delete this file and the world still generates the same ground, streams the same chunks, evicts
 * the same way and fingerprints identically. It would be bald. Nothing here holds state that
 * outlives a frame, and nothing here returns a value that any decision reads: the parallel arrays
 * below are refilled from scratch every frame and are read by exactly one thing, which is the
 * draw call at the bottom of this file.
 *
 * ## Why the scatter is rolled here and not stored in a chunk
 *
 * Which tile grows a tree is one `hash2` against a `noise2` grove field — two hashes, cheap enough
 * to answer while drawing and *cheaper* than the cache line it would cost to store. What a chunk
 * exists to pay for once is the elevation, which is three octave-stacked fields per vertex. Rolling
 * the scatter at draw time also keeps it honestly out of the memory figure in the HUD, and it makes
 * the point the exhibit is about twice: **this is a pure function of position too**, so the wood
 * that comes back is the same wood, tree for tree and lean for lean, without anything being kept.
 *
 * ## The five rules, which are the demo's
 *
 * 1. **Silhouette first.** A pine is a spike of shrinking discs; a broadleaf is a mound of
 *    overlapping drums; a jungle tree is a bare bowed stem under one wide splayed crown; scrub is
 *    knee-high and wide; a boulder is angular and shorter than everything; the beacon is the only
 *    vertical line in the world. Told apart at forty pixels with the color turned off.
 * 2. **Detail at three scales**: massing, then the repeat that gives it rhythm — tier count, frond
 *    count, boulder facets — then trim. Skipping the middle scale is what makes generated geometry
 *    look generated.
 * 3. **Three-tone faces from one slot.** Every color is a palette *name*, never a hex, so a wood is
 *    the biome's own green and the HUD's accent is that same green.
 * 4. **Something moves on every object**, off one world-wide wind field plus a per-instance phase,
 *    so a wood moves together without moving in lockstep.
 * 5. **Variation is keyed on identity, never on draw order.** A `Variant.seed` is `hash2(seed, gx,
 *    gy)` — a pure function of *position*, exactly like everything else here — so a tree's lean
 *    survives its chunk being evicted and re-minted. Seeding a variant off a counter would put the
 *    one sequence-dependent value in the whole exhibit inside the art.
 *
 * ## Why a crown is `patch` and not `wall`
 *
 * `isoWall` throws on a segment whose `gx` and `gy` deltas are equal — correctly: world x is
 * `(gx − gy) · HALF_W`, so such a wall projects to a line of zero width and paints nothing. A crown
 * of fronds radiating on a circle crosses that diagonal twice per revolution, so it would throw on
 * two of its eight fronds and on the exact frame a sway carries one across. A flat quad is what a
 * frond mostly is from a dimetric camera, and the problem is gone rather than epsilon'd.
 */
import { hash2, hashStep, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen, type DepthSorter } from '@lattice/iso';
import {
  LEVEL_H,
  VARIANT_ZERO,
  defineSprite,
  drawSprite,
  glowDot,
  isoPatch,
  mix,
  pxToLevels,
  spriteHeightPx,
  withAlpha,
  type Ink,
  type Pen,
  type SolidWriter,
  type SpriteDef,
  type Variant,
} from '@lattice/draw';
import { BIAS, STEP_PX, cell, dFar, dNear, sMax, sMin, seed } from './chunks.js';
import { hazeFrom } from './terrain.js';

const pt: Vec2 = { x: 0, y: 0 };

/** The world's one wind, sampled at a position and a time — which is why a gust crosses a wood as a
 *  wave instead of shaking every tree on its own. Position-keyed like everything else here, so it
 *  does not jump when a chunk is re-minted underneath it. */
function wind(pen: Pen, gx: number, gy: number, phase: number): number {
  const gust = noise2(0x4e2, gx * 0.04 + pen.t * 0.3, gy * 0.04) * 0.5 + 0.5;
  return noise2(0x4e2, phase, pen.t * 0.8) * (0.4 + gust * 0.8);
}

/**
 * One of an instance's shape numbers, in [0, 1) — and the reason it exists rather than
 * `rng.next()` is a genuine trap in `draw`.
 *
 * A sprite's `massing` and its `animate` are handed **two different streams**, each rewound from
 * `Variant.seed` but salted apart so that adding a draw to one cannot reshuffle the other. That is
 * exactly right, and it means an animator that redraws part of the massing cannot recover the
 * numbers the massing chose by drawing in the same order: it gets a different height and a
 * different lean, so the moving crown sits beside the static one. Deriving both from the variant by
 * index instead makes the two agree by construction, and costs one `hashStep`.
 */
function shape(v: Variant, i: number): number {
  return toUnit(hashStep(v.seed, i));
}

/** Screen point for a grid position at a storey height. The one conversion an animator needs. */
function at(pen: Pen, gx: number, gy: number, levels: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/** Nine flat quads around a point: the crown, massed. Written against the writer and against the
 *  pen separately, because the one-implementation version takes the primitive as a callback, and a
 *  callback here is an arrow allocated **per sprite per frame** — three hundred jungle trees would
 *  allocate six hundred closures a frame to save nine lines of art. */
function crownMassed(w: SolidWriter, cx: number, cy: number, z: number, r: number, fill: Ink): void {
  w.patch(cx - r * 1.15, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  w.patch(cx + 0.1, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  w.patch(cx - 0.1, cy - r * 1.15, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  w.patch(cx - 0.1, cy + 0.1, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  w.patch(cx - r * 0.8, cy - r * 0.8, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  w.patch(cx + 0.1, cy - r * 0.8, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  w.patch(cx - r * 0.8, cy + 0.1, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  w.patch(cx + 0.1, cy + 0.1, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  w.patch(cx - r * 0.34, cy - r * 0.34, r * 0.68, r * 0.68, z + 0.04, fill, 'ink');
}

/** {@link crownMassed}, drawn free-hand where the wind put it. See its note. */
function crownLive(pen: Pen, cx: number, cy: number, z: number, r: number, fill: Ink): void {
  isoPatch(pen, cx - r * 1.15, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  isoPatch(pen, cx + 0.1, cy - 0.1, r * 1.05, 0.2, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - 0.1, cy - r * 1.15, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - 0.1, cy + 0.1, 0.2, r * 1.05, z - 0.06, fill, 'ink');
  isoPatch(pen, cx - r * 0.8, cy - r * 0.8, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  isoPatch(pen, cx + 0.1, cy - r * 0.8, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  isoPatch(pen, cx - r * 0.8, cy + 0.1, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  isoPatch(pen, cx + 0.1, cy + 0.1, r * 0.7, r * 0.7, z - 0.02, fill, 'ink');
  isoPatch(pen, cx - r * 0.34, cy - r * 0.34, r * 0.68, r * 0.68, z + 0.04, fill, 'ink');
}

/** A spike of shrinking discs. The cold north's whole skyline, and the tallest common thing. */
const pine = defineSprite({
  id: 'endless.pine',
  w: 1,
  d: 1,
  massing(w, v) {
    const h = 2.6 + shape(v, 0) * 2.1;
    const tiers = 4 + Math.floor(shape(v, 1) * 3);
    w.shadow(0.22, 0.22, 0.56, 0.56, 0.42);
    w.cylinder(0.5, 0.5, 0.085, { color: 'metal', h: h * 0.42, outline: true });
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers;
      w.cylinder(0.5, 0.5, 0.4 - k * 0.28, {
        color: 'taiga',
        h: h / tiers + 0.3,
        z: h * 0.26 + k * h * 0.6,
        outline: i === 0,
        ...(i === tiers - 1 ? { topColor: 'ok' as Ink } : {}),
      });
    }
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    // The leader alone, riding the wind a fraction of a tile over. Moving the whole tree would cost
    // eight primitives a frame for a motion nobody can see below the crown.
    const h = 2.6 + shape(v, 0) * 2.1;
    const sway = wind(pen, gx, gy, shape(v, 2) * 9) * 0.07;
    isoPatch(pen, gx + 0.36 + sway, gy + 0.36 + sway * 0.7, 0.28, 0.28, pxToLevels(zPx) + h * 0.88, 'ok', 'ink');
  },
});

/** A mound of overlapping drums on a forked trunk. The temperate middle, and the widest silhouette
 *  here — a straight post under one drum reads as a lollipop, which is why the fork is drawn. */
const broadleaf = defineSprite({
  id: 'endless.broadleaf',
  w: 1,
  d: 1,
  massing(w, v) {
    const h = 1.5 + shape(v, 0) * 1.2;
    w.shadow(0.14, 0.14, 0.72, 0.72, 0.44);
    w.post(0.5, 0.5, 0, h * 0.7, 'ink', 0.13);
    w.post(0.42, 0.58, h * 0.44, h * 0.34, 'ink', 0.08);
    w.cylinder(0.44 + shape(v, 1) * 0.12, 0.46, 0.42, { color: 'leaf', h: 0.6, z: h * 0.6, outline: true });
    w.cylinder(0.58, 0.42 + shape(v, 2) * 0.12, 0.33, { color: 'leaf', h: 0.5, z: h * 0.84 });
    w.cylinder(0.42, 0.6, 0.28, { color: 'ok', h: 0.42, z: h });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    // The lit top of the canopy: a small ellipse sliding across the crown as the wind moves it.
    // Cheaper than redrawing a drum, and the highlight rather than the shape is the half of the
    // motion a viewer actually resolves at these sizes.
    const h = 1.5 + shape(v, 0) * 1.2;
    const sway = wind(pen, gx, gy, shape(v, 3) * 9) * 0.1;
    const p = at(pen, gx + 0.5 + sway, gy + 0.72 + sway * 0.6, pxToLevels(zPx) + h * 1.36);
    const r = 7 * pen.camera.zoom;
    pen.surface.ellipse(p.x, p.y, r, r * 0.5, withAlpha(mix(pen.palette.get('ok'), 0xfff4d4ff, 0.4), 0.55));
  },
});

/** A bare bowed stem and one wide crown. Hot and wet: the tallest, thinnest thing in the world. */
const jungle = defineSprite({
  id: 'endless.jungle',
  w: 1,
  d: 1,
  massing(w, v) {
    const h = 3.1 + shape(v, 0) * 1.8;
    const lean = (shape(v, 1) - 0.5) * 0.5;
    w.shadow(0.2, 0.2, 0.6, 0.6, 0.4);
    for (let i = 0; i < 5; i++) {
      const k = i / 5;
      // Squared along the stem so it *bows* rather than tilting, which is what makes the crown
      // riding on top of it read as bending in the wind rather than as leaning permanently.
      w.cylinder(0.5 + lean * k * k, 0.5 + lean * k * k * 0.7, 0.1 - k * 0.03, {
        color: 'metal',
        h: h / 5 + 0.04,
        z: k * h,
        outline: i === 0,
      });
    }
    crownMassed(w, 0.5 + lean, 0.5 + lean * 0.7, h, 0.62, 'jungle');
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    // The crown alone, redrawn where the wind put it, at exactly the height and lean the massing
    // chose — see `shape` for why that is not `rng.next()`.
    const h = 3.1 + shape(v, 0) * 1.8;
    const lean = (shape(v, 1) - 0.5) * 0.5;
    const sway = wind(pen, gx, gy, shape(v, 2) * 9) * 0.11;
    crownLive(pen, gx + 0.5 + lean + sway, gy + 0.5 + lean * 0.7 + sway * 0.6, pxToLevels(zPx) + h, 0.62, 'jungle');
  },
});

/** Knee-high and wide. Dry country's only cover, and the reason arid ground is not empty. */
const scrub = defineSprite({
  id: 'endless.scrub',
  w: 1,
  d: 1,
  massing(w, v) {
    const n = 3 + Math.floor(shape(v, 0) * 3);
    w.shadow(0.24, 0.24, 0.52, 0.52, 0.3);
    for (let i = 0; i < n; i++) {
      w.cylinder(0.32 + shape(v, i + 1) * 0.36, 0.32 + shape(v, i + 7) * 0.36, 0.13 + shape(v, i + 13) * 0.08, {
        color: i === 0 ? 'dune' : 'ok',
        h: 0.3 + shape(v, i + 19) * 0.45,
        outline: i === 0,
      });
    }
  },
});

/** Angular, low, and the only thing here with a flat top. It is what tells a visitor the scatter
 *  has more than one kind of object in it before they have looked at anything closely. */
const boulder = defineSprite({
  id: 'endless.boulder',
  w: 1,
  d: 1,
  massing(w, v) {
    const h = 0.34 + shape(v, 0) * 0.5;
    w.shadow(0.2, 0.2, 0.6, 0.6, 0.4);
    w.box(0.22 + shape(v, 1) * 0.1, 0.22 + shape(v, 2) * 0.1, 0.5, 0.46, { color: 'rock', h, outline: true });
    w.box(0.34, 0.3, 0.3, 0.28, { color: 'rock', h: h * 0.6, z: h, inset: 0.02 });
  },
});

/** The beacon. One in four hundred of the things that stand up, the only vertical line in the
 *  world, the only light, and the only object a visitor will travel to on purpose. */
const beacon = defineSprite({
  id: 'endless.beacon',
  w: 1,
  d: 1,
  massing(w) {
    w.shadow(0.1, 0.1, 0.8, 0.8, 0.5);
    w.box(0.24, 0.24, 0.52, 0.52, { color: 'rock', h: 0.3, outline: true });
    // Four tapering drums rather than one: the middle scale again, and it is what makes a five-metre
    // stone read as built rather than as a pillar primitive.
    for (let i = 0; i < 4; i++) {
      w.cylinder(0.5, 0.5, 0.2 - i * 0.03, { color: 'metal', h: 1.15, z: 0.3 + i * 1.1, outline: i === 0 });
    }
    w.glow(0.5, 0.5, 4.9, 'bloom', 0.5, 1);
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    // The one thing in the world that pulses on a clock rather than on the wind, so a visitor
    // scanning the far band picks it out of an otherwise static horizon.
    const beat = Math.sin(pen.t * 1.7) * 0.5 + 0.5; /* @tier-b pixels only */
    glowDot(pen, gx + 0.5, gy + 0.5, pxToLevels(zPx) + 4.9, mix(pen.palette.get('bloom'), 0xffffffff, beat * 0.5), 0.34 + beat * 0.2, 0.7 + beat * 0.3);
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    field.add(gx + 0.5, gy + 0.5, zPx, 6.5, 0.9, 'bloom');
  },
});

/** Kind ordinal → sprite. `TREE` indexes the first four by biome; 4 and 5 are named above. */
const KINDS: readonly SpriteDef[] = [pine, broadleaf, jungle, scrub, boulder, beacon];
/** Silhouette height per kind, measured once at boot: `spriteHeightPx` replays a whole massing to
 *  answer, so calling it per instance per frame is a second full pass over the wood every frame.
 *  Scaled up, because it is measured at `VARIANT_ZERO` and a taller instance must still sort. */
const TOPS = KINDS.map((def) => spriteHeightPx(def, VARIANT_ZERO) * 1.4);
/** The tree each biome grows, in `chunks.ts`'s ordinal order. */
const TREE: readonly number[] = [0, 1, 3, 2];
/** How thickly each biome stands things up, before the grove field multiplies it. Varying the
 *  *density* rather than the threshold is what stops a scatter from reading as a scatter: closed
 *  wood on one flank, open meadow between, and the join is a gradient rather than a line. */
const DENSITY: readonly number[] = [0.22, 0.26, 0.09, 0.28];
/** The most things that may stand up in one frame. Past this a visitor is measuring the depth
 *  sort rather than the world, and a scene that hit it would be reported rather than raised. */
const CAP = 3000;

// Parallel arrays the sorter's permutation indexes, not a bucket of objects: three hundred
// features a frame is three hundred allocations a frame, and non-negotiable 7 is the rule this
// exhibit exists to test. One mutable `Variant` for the same reason — `drawSprite` reads it
// synchronously and retains nothing.
const fgx = new Int32Array(CAP);
const fgy = new Int32Array(CAP);
const fkind = new Uint8Array(CAP);
const fbase = new Float64Array(CAP);
const variant = { level: 1, seed: 0, flags: 1, progress: 1, label: '' };
/** How many things stood up this frame. Exported so § Scale's *density* row can be measured from a
 *  console rather than counted off a screenshot; nothing in the exhibit reads it, which is what
 *  keeps this module art. */
export let standing = 0;

/**
 * Fill the depth sorter with everything standing on screen. Called before `renderFrame`, which
 * sorts what it finds.
 *
 * **The walk is exact.** Screen x is `(gx − gy) · HALF_W` and screen y is `(gx + gy) · HALF_H`, so
 * iterating `d = gx + gy` down the frame and `s = gx − gy` across it visits every visible tile and
 * no other — where a grid-space rectangle would over-cover by about 2×. `s` steps by two and
 * starts on `d`'s parity, because `gx = (d + s) / 2` has to be a whole number.
 *
 * Features stop short of the horizon: the far band is asked to be hazier, which is also permission
 * for it to be cheaper, and the wash in `terrain.ts` covers where they stop.
 *
 * It clears the sorter itself, so there is no way to fill one that still holds last frame's world.
 */
export function standThings(order: DepthSorter): void {
  order.clear();
  standing = 0;
  // The tree line stops a third of the way *into* the haze rather than where the haze begins, so
  // that the two edges never coincide — a wood ending exactly where the air thickens is a line the
  // eye finds immediately, and the whole trick is that neither one is findable.
  const start = Math.ceil(hazeFrom() * 0.66 + dFar * 0.34);
  for (let d = start; d <= dNear && standing < CAP; d++) {
    const from = Math.ceil(sMin);
    for (let s = from + ((from ^ d) & 1); s <= sMax && standing < CAP; s += 2) {
      const gx = (d + s) / 2;
      const gy = (d - s) / 2;
      const word = cell(gx, gy);
      const e = (word & 255) - BIAS;
      // Dry ground below the treeline: the rock ramp in `terrain.ts` starts at 30, so 34 is where
      // a wood stops and scree begins.
      if (e < 1 || e > 34) continue;
      const biome = word >> 8;
      const density = DENSITY[biome] ?? 0;
      const roll = toUnit(hash2(seed ^ 0x3e5, gx, gy));
      // The cheap upper-bound reject first, so the grove field is only sampled on the one tile in
      // seven that could possibly grow something. Two hashes for most tiles, three for the rest.
      if (roll >= density * 1.65) continue;
      const grove = noise2(seed ^ 0x9d1, gx * 0.09, gy * 0.09) * 0.5 + 0.5;
      if (roll >= density * (0.15 + grove * grove * 1.5)) continue;
      const pick = toUnit(hash2(seed ^ 0x7b9, gx, gy));
      const kind = pick < 0.0025 ? 5 : pick < 0.14 ? 4 : (TREE[biome] ?? 0);
      const base = e * STEP_PX;
      fgx[standing] = gx;
      fgy[standing] = gy;
      fkind[standing] = kind;
      fbase[standing] = base;
      order.add(gx, gy, 1, 1, base + (TOPS[kind] ?? 0));
      standing += 1;
    }
  }
}

/** The Solids pass: walk the sorted permutation **forwards**, exactly once, drawing nothing from
 *  any other collection — `iso`'s contract, and what stops a tap opening the tree behind. */
export function drawThings(pen: Pen, order: DepthSorter): void {
  for (let i = 0; i < order.count; i++) {
    const k = order.indexAt(i);
    const gx = fgx[k] ?? 0;
    const gy = fgy[k] ?? 0;
    variant.seed = hash2(seed ^ 0x51d, gx, gy);
    drawSprite(pen, KINDS[fkind[k] ?? 0] ?? boulder, gx, gy, variant, fbase[k] ?? 0);
  }
}
