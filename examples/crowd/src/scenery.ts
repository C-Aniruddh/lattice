/**
 * @art
 *
 * The piazza's furniture. Silhouette first, detail at three scales, and something moving on every
 * object — the same seven rules the first exhibit's `sprites.ts` set out, applied to a place whose
 * job is to be *worth walking through* rather than to be tapped.
 *
 * Two of those rules do most of the work here and are worth naming, because a crowd exhibit fails
 * in a way a building exhibit does not:
 *
 * 1. **Nothing stands where a route runs.** Every sprite in this file is placed by `plaza.ts` on
 *    ground the six loops avoid. A colonnade a walker clips through is the single most expensive
 *    mistake this exhibit could make, because it turns two hundred convincing people back into two
 *    hundred sampled points in one frame.
 * 2. **Vertical rhythm carries the depth sort.** Twenty-eight columns at three storeys are what
 *    make it *visible* that the walkers are being sorted with the world rather than over it: a
 *    person passing behind a column is occluded, and a person in front of one is not, and that is
 *    the whole claim rendered as a picture instead of as a sentence.
 *
 * Everything is three-toned from one color by `draw`'s `shade`, outlined at its own hue, and
 * varied per instance from `Variant.seed` — so column 19 leans the way column 19 leans on every
 * reload, and after every re-sort.
 */
import { hash2, noise2, toUnit } from '@lattice/core';
import { gridToScreen } from '@lattice/iso';
import {
  LEVEL_H,
  defineSprite,
  glowDot,
  isoBox,
  isoCylinder,
  isoWall,
  mix,
  pxToLevels,
  withAlpha,
  type Ink,
  type Pen,
} from '@lattice/draw';

/** Scratch for the one conversion an animator needs. Module scope, so no frame allocates one. */
const pt = { x: 0, y: 0 };

/** The screen point for a grid position at a storey height. */
function at(pen: Pen, gx: number, gy: number, levels: number): { x: number; y: number } {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * Snap a 0..1 quantity to nine steps, for **colors that reach a soft gradient and nothing else**.
 *
 * This is the exhibit's one performance rule and it is worth the paragraph, because the failure it
 * prevents is invisible in the source, is not the thing anybody looks for in a crowd exhibit, and
 * was the only per-frame allocation left anywhere in this scene.
 *
 * `Surface.softEllipse` on the Canvas2D backend renders each *color pair* into a cached 64×64
 * radial ramp, and the cache is a plain map that **drops wholesale at 96 entries**. A color that
 * moves continuously with `pen.t` therefore misses on every frame — a fresh `<canvas>`, a fresh
 * gradient, a fresh fill — and, the part that is not obvious, takes every *other* call site's ramp
 * down with it when the map clears. Twenty-seven flames and two fountain rings measured **3.7
 * misses a frame and a full cache drop every twenty-six frames**, so the contact shadow under
 * every walker, every light pool, the sun and the far shore were all being re-rendered twice a
 * second as collateral. Quantized, the same scene measured **one miss in two thousand frames**.
 *
 * Nine steps of brightness on a flame core eight pixels across is indistinguishable from a
 * continuum, so this is quantization of a quantity nobody can resolve. **It is applied to the
 * color only** — the sway, the height, the radius and the spark stay continuous, which is where
 * the motion a viewer actually sees comes from.
 */
function steps(u: number): number {
  return Math.round(u * 8) / 8;
}

/** A flame: a hot core, a lick that never repeats, and one rising spark. */
function flame(pen: Pen, gx: number, gy: number, levels: number, phase: number, size: number): void {
  const lick = noise2(0x11ae, phase, pen.t * 2.4) * 0.5 + 0.5;
  const sway = noise2(0x22bf, phase, pen.t * 1.1) * 0.05 * size;
  const core = mix(pen.palette.get('warn'), 0xfff2ccff, 0.4 + steps(lick) * 0.35);
  glowDot(pen, gx + sway, gy - sway, levels + lick * 0.06 * size, core, size * (0.7 + lick * 0.5), 1);
  const k = (pen.t * 0.7 + phase) % 1;
  const p = at(pen, gx + sway * 3, gy - sway * 3, levels + k * size * 2.2);
  const r = Math.max(0.7, (1 - k) * size * 3 * pen.camera.zoom);
  pen.surface.ellipse(p.x, p.y, r, r, withAlpha(core, (1 - k) * 0.7));
}

/**
 * A pennant that hangs and stirs.
 *
 * Run **across** the lattice, never along it: two endpoints whose `gx` and `gy` deltas are equal
 * project to a line of zero width, and `isoWall` throws on that frame rather than painting
 * nothing. A sway added to both coordinates in proportion passes through exactly that degenerate
 * point every time it changes sign, which is why the sway below only moves one axis.
 */
function pennant(pen: Pen, gx: number, gy: number, z: number, phase: number, hue: Ink): void {
  const wave = noise2(0x8d4, phase, pen.t * 1.15) * 0.19;
  isoWall(pen, gx, gy, gx + 0.34, gy - 0.1 + wave, z - 0.46, z, hue, 'ink');
}

// ── the peristyle, which is the exhibit's occlusion argument ─────────────────────────────────

/**
 * A column: plinth, torus, a shaft with entasis, capital, abacus, and a stub of architrave.
 *
 * The architrave stub is why twenty-eight separate sprites read as one continuous ring beam: each
 * is a fraction wider than the gap to its neighbour, so the tops close up into a band while the
 * shafts stay separate — which is exactly what a real peristyle does from across a square.
 */
export const pillar = defineSprite({
  id: 'pillar',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const stone: Ink = 'metal';
    const lean = rng.next() * 0.03 - 0.015;
    w.shadow(0.12, 0.12, 0.76, 0.76, 0.52);
    // 1 — massing: plinth, torus, two drums, capital.
    w.box(0.14, 0.14, 0.72, 0.72, { color: stone, h: 0.14 });
    w.cylinder(0.5, 0.5, 0.36, { color: stone, h: 0.1, z: 0.14 });
    w.cylinder(0.5 + lean, 0.5 + lean, 0.29, { color: stone, h: 1.3, z: 0.24 });
    w.cylinder(0.5 + lean * 2, 0.5 + lean * 2, 0.255, { color: stone, h: 1.12, z: 1.54 });
    // 2 — rhythm: three drum joints, and the flute shadow down the left face.
    for (let i = 0; i < 3; i++) {
      w.cylinder(0.5 + lean, 0.5 + lean, 0.3 - i * 0.012, { color: stone, h: 0.045, z: 0.6 + i * 0.62, outline: false });
    }
    // 3 — capital, abacus, architrave stub, and a bead of gilding under the abacus.
    w.cylinder(0.5, 0.5, 0.34, { color: stone, h: 0.17, z: 2.66 });
    w.box(0.12, 0.12, 0.76, 0.76, { color: stone, h: 0.05, z: 2.83, outline: false });
    w.box(0.11, 0.11, 0.78, 0.78, { color: 'warn', h: 0.03, z: 2.88, outline: false });
    w.box(0.02, 0.02, 0.96, 0.96, { color: stone, h: 0.3, z: 2.91 });
    w.box(0.06, 0.06, 0.88, 0.88, { color: stone, h: 0.09, z: 3.21, outline: false });
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const phase = rng.next() * 40;
    // Every third column carries a hanging pennant. `flags` rather than the stream, so which
    // columns are dressed is a property of *where they are*, not of when they were built.
    if ((v.flags & 1) === 0) return;
    const hue: Ink = (v.flags & 2) === 0 ? 'brand' : 'bad';
    pennant(pen, gx + 0.62, gy + 0.28, z + 2.72, phase, hue);
  },
});

// ── the fountain: the thing at the centre the loops are drawn around ─────────────────────────

export const fountain = defineSprite({
  id: 'fountain',
  w: 3,
  d: 3,
  massing(w) {
    const stone: Ink = 'metal';
    w.shadow(-0.1, -0.1, 3.2, 3.2, 0.55);
    // 1 — massing: a paved apron, a wide basin, a pedestal, an upper bowl, a stem.
    for (let i = 0; i < 9; i++) w.tile(i % 3, (i / 3) | 0, withAlpha(0x000000ff, 0.09), undefined, 0.1, 0.004);
    w.cylinder(1.5, 1.5, 1.5, { color: stone, h: 0.14 });
    w.cylinder(1.5, 1.5, 1.42, { color: 'brand', h: 0.34, z: 0.14 });
    w.cylinder(1.5, 1.5, 1.3, { color: 'glass', h: 0.06, z: 0.42, outline: false });
    w.cylinder(1.5, 1.5, 0.52, { color: stone, h: 0.72, z: 0.42 });
    // 2 — rhythm: eight gilded studs around the basin rim, and a banded bowl.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28318; /* @tier-b pixels only */
      w.cylinder(1.5 + Math.cos(a) * 1.36, 1.5 + Math.sin(a) * 1.36, 0.1, {
        color: 'warn',
        h: 0.12,
        z: 0.48,
        outline: false,
      });
    }
    w.cylinder(1.5, 1.5, 0.92, { color: stone, h: 0.18, z: 1.14 });
    w.cylinder(1.5, 1.5, 0.82, { color: 'glass', h: 0.05, z: 1.32, outline: false });
    // 3 — trim: the stem, a collar and a gilded finial the jet leaves from.
    w.cylinder(1.5, 1.5, 0.2, { color: stone, h: 0.62, z: 1.34 });
    w.cylinder(1.5, 1.5, 0.28, { color: 'warn', h: 0.12, z: 1.96, outline: false });
    w.glow(1.5, 1.5, 2.1, 'sky', 0.16, 0.5);
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    const z = pxToLevels(zPx);
    const cx = gx + 1.5;
    const cy = gy + 1.5;
    const k = pen.camera.zoom;
    const pale = mix(pen.palette.get('glass'), 0xffffffff, 0.62);
    // The jet: eleven droplets on one parabola, each at its own phase, so the plume is continuous
    // rather than a pulse. Height and fall come from the same `u`, which is what makes it read as
    // gravity instead of as a loop.
    for (let i = 0; i < 11; i++) {
      const u = (pen.t * 0.9 + i / 11) % 1;
      const lift = 1.35 * (1 - (u * 2 - 1) * (u * 2 - 1));
      const spread = u * 0.62;
      const a = i * 2.399; /* @tier-b pixels only */
      const p = at(pen, cx + Math.cos(a) * spread, cy + Math.sin(a) * spread, z + 2.1 + lift);
      const r = Math.max(0.8, (1.9 - u) * 1.5 * k);
      pen.surface.ellipse(p.x, p.y, r, r, withAlpha(pale, 0.42 + lift * 0.3));
    }
    // Ripples: two expanding rings on the lower basin, and a haze of spray over the whole thing.
    // The ring *grows* continuously and *fades* in nine steps — see {@link steps}. The radius is
    // what the eye tracks; the alpha is the half that was quietly clearing the ramp cache twice a
    // frame, and nine steps of it over a two-second fade is a change nobody can see happen.
    for (let i = 0; i < 2; i++) {
      const u = (pen.t * 0.5 + i * 0.5) % 1;
      const p = at(pen, cx, cy, z + 0.48);
      pen.surface.softEllipse(
        p.x,
        p.y,
        1.32 * u * 32 * k,
        1.32 * u * 16 * k,
        withAlpha(pale, 0),
        withAlpha(pale, steps(1 - u) * 0.3),
      );
    }
    const haze = at(pen, cx, cy, z + 2.5);
    pen.surface.softEllipse(haze.x, haze.y, 34 * k, 34 * k, withAlpha(pale, 0.13), withAlpha(pale, 0));
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    // Cool rather than warm, and small: the fountain is not a lamp, it is a wet thing catching
    // what light there is. Without it the centre of the plaza is the one dead spot at dusk.
    field.add(gx + 1.5, gy + 1.5, zPx, 2.6, 0.34, 'sky');
  },
});

// ── lamps, which are the only things in the scene that emit ──────────────────────────────────

export const lamp = defineSprite({
  id: 'lamp',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const iron: Ink = 'ink';
    const lean = rng.next() * 0.03 - 0.015;
    w.shadow(0.2, 0.2, 0.6, 0.6, 0.46);
    w.cylinder(0.5, 0.5, 0.3, { color: 'metal', h: 0.16 });
    w.cylinder(0.5, 0.5, 0.22, { color: iron, h: 0.14, z: 0.16 });
    w.post(0.5 + lean, 0.5 + lean, 0.3, 1.7, iron, 0.15);
    w.post(0.5 + lean * 2, 0.5 + lean * 2, 2.0, 0.34, iron, 0.1);
    w.cylinder(0.5, 0.5, 0.16, { color: 'metal', h: 0.06, z: 1.92, outline: false });
    w.box(0.32, 0.32, 0.36, 0.36, { color: 'warn', h: 0.42, z: 2.34 });
    w.roof(0.24, 0.24, 0.52, 0.52, 2.76, 0.24, iron);
    w.post(0.5, 0.5, 3.0, 0.2, iron, 0.05);
    w.glow(0.5, 0.5, 2.55, 'warn', 0.2, 0.95);
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    flame(pen, gx + 0.5, gy + 0.5, pxToLevels(zPx) + 2.55, rng.next() * 40, 0.2);
  },
  emit(field, gx, gy, _v, rng, zPx) {
    const lick = noise2(0x11ae, rng.next() * 40, 0) * 0.5 + 0.5;
    field.add(gx + 0.5, gy + 0.5, zPx, 2.7 + lick * 0.3, 0.58 + lick * 0.08, 'warn');
  },
});

// ── the market, on the terrace across the water ──────────────────────────────────────────────

export const stall = defineSprite({
  id: 'stall',
  w: 2,
  d: 2,
  massing(w, v, rng) {
    const cloth: Ink = (v.flags & 1) === 0 ? 'brand' : 'bad';
    w.shadow(0.0, 0.0, 2.0, 2.0, 0.5);
    // 1 — massing: a boarded deck, a counter along the front, four posts, a canopy.
    w.box(0.1, 0.1, 1.8, 1.8, { color: 'ink', h: 0.1 });
    w.box(0.16, 1.1, 1.68, 0.72, { color: 'metal', h: 0.62, z: 0.1 });
    for (const ox of [0.2, 1.68]) {
      for (const oy of [0.2, 1.68]) w.post(ox, oy, 0.1, 1.5, 'ink', 0.09);
    }
    w.roof(0.02, 0.02, 1.96, 1.96, 1.5, 0.42, cloth);
    // 2 — rhythm: the valance, alternating with the canopy's own hue, and shelved goods.
    for (let i = 0; i < 5; i++) {
      const k = 0.12 + i * 0.38;
      w.box(k, 1.86, 0.3, 0.1, { color: i % 2 === 0 ? cloth : 'metal', h: 0.24, z: 1.34, outline: false });
      w.box(1.86, k, 0.1, 0.3, { color: i % 2 === 0 ? 'metal' : cloth, h: 0.24, z: 1.34, outline: false });
    }
    for (let i = 0; i < 6; i++) {
      const hue: Ink = i % 3 === 0 ? 'ok' : i % 3 === 1 ? 'warn' : 'brand';
      w.cylinder(0.34 + rng.next() * 1.2, 1.24 + rng.next() * 0.5, 0.1 + rng.next() * 0.07, {
        color: hue,
        h: 0.14 + rng.next() * 0.12,
        z: 0.72,
        outline: false,
      });
    }
    // 3 — trim: crates behind the counter, a sack, and the bracket the lantern hangs from.
    w.box(0.24, 0.28, 0.44, 0.4, { color: 'ground', h: 0.36, z: 0.1 });
    w.box(0.3, 0.34, 0.32, 0.28, { color: 'ground', h: 0.3, z: 0.46, outline: false });
    w.cylinder(1.24, 0.5, 0.26, { color: 'ground', h: 0.4, z: 0.1 });
    w.post(1.68, 1.68, 1.6, 0.24, 'ink', 0.05);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const phase = rng.next() * 30;
    // The valance lifts on the same wind field the trees use, so the terrace moves together.
    const gust = noise2(0x4e2, gx * 0.05 + pen.t * 0.4, gy * 0.05) * 0.5 + 0.5;
    for (let i = 0; i < 5; i++) {
      const wave = noise2(0x3c8, phase + i, pen.t * 1.3) * 0.09 * (0.5 + gust);
      isoBox(pen, gx + 0.12 + i * 0.38, gy + 1.86, 0.3, 0.1, {
        color: i % 2 === 0 ? ((v.flags & 1) === 0 ? 'brand' : 'bad') : 'metal',
        h: 0.24 + wave,
        z: z + 1.34,
        outline: false,
      });
    }
    flame(pen, gx + 1.68, gy + 1.68, z + 1.78, phase, 0.13);
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    field.add(gx + 1.68, gy + 1.68, zPx, 2.1, 0.55, 'warn');
  },
});

// ── planting ─────────────────────────────────────────────────────────────────────────────────

export const tree = defineSprite({
  id: 'tree',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    const h = 1.5 + rng.next() * 0.7;
    w.shadow(0.1, 0.1, 0.8, 0.8, 0.44);
    w.cylinder(0.5, 0.5, 0.46, { color: 'ground', h: 0.14 });
    w.post(0.5, 0.5, 0.1, h * 0.62, 'ink', 0.13);
    w.post(0.36, 0.6, h * 0.44, h * 0.3, 'ink', 0.07);
    const r = 0.4 + rng.next() * 0.12;
    w.cylinder(0.5, 0.5, r, { color: 'ok', h: h * 0.4, z: h * 0.5 });
    w.cylinder(0.42, 0.56, r * 0.82, { color: 'ok', h: h * 0.34, z: h * 0.82, outline: false });
    w.cylinder(0.56, 0.44, r * 0.6, { color: 'ok', h: h * 0.3, z: h * 1.06, outline: false });
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const z = pxToLevels(zPx);
    const h = 1.5 + rng.next() * 0.7;
    const phase = rng.next() * 30;
    const gust = noise2(0x4e2, gx * 0.05 + pen.t * 0.4, gy * 0.05) * 0.5 + 0.5;
    const sway = noise2(0x4e2, phase, pen.t * 0.85) * 0.12 * (0.5 + gust);
    isoCylinder(pen, gx + 0.56 + sway, gy + 0.44 + sway * 0.7, 0.22, {
      color: 'ok',
      h: h * 0.3,
      z: z + h * 1.06,
      outline: false,
    });
  },
});

export const urn = defineSprite({
  id: 'urn',
  w: 1,
  d: 1,
  massing(w, _v, rng) {
    w.shadow(0.28, 0.28, 0.44, 0.44, 0.42);
    w.cylinder(0.5, 0.5, 0.28, { color: 'metal', h: 0.12 });
    w.cylinder(0.5, 0.5, 0.22, { color: 'metal', h: 0.34, z: 0.12 });
    w.cylinder(0.5, 0.5, 0.28, { color: 'metal', h: 0.1, z: 0.46, outline: false });
    for (let i = 0; i < 3; i++) {
      w.cylinder(0.5 + (rng.next() - 0.5) * 0.3, 0.5 + (rng.next() - 0.5) * 0.3, 0.14 + rng.next() * 0.07, {
        color: 'ok',
        h: 0.24 + rng.next() * 0.16,
        z: 0.52,
        outline: i === 0,
      });
    }
  },
  animate(pen, gx, gy, _v, rng, zPx) {
    const sway = noise2(0x6b2, rng.next() * 30, pen.t * 0.9) * 0.07;
    isoCylinder(pen, gx + 0.5 + sway, gy + 0.5 + sway * 0.6, 0.12, {
      color: 'ok',
      h: 0.16,
      z: pxToLevels(zPx) + 0.78,
      outline: false,
    });
  },
});

export const bench = defineSprite({
  id: 'bench',
  w: 1,
  d: 1,
  massing(w) {
    w.shadow(0.16, 0.3, 0.68, 0.42, 0.4);
    for (const oy of [0.34, 0.62]) {
      w.box(0.2, oy, 0.08, 0.1, { color: 'ink', h: 0.28, outline: false });
      w.box(0.72, oy, 0.08, 0.1, { color: 'ink', h: 0.28, outline: false });
    }
    w.box(0.16, 0.3, 0.68, 0.42, { color: 'ground', h: 0.08, z: 0.28 });
    w.box(0.16, 0.66, 0.68, 0.07, { color: 'ground', h: 0.3, z: 0.36 });
  },
});

// ── the terrace's bandstand, which is what makes the far island worth crossing to ────────────

export const pavilion = defineSprite({
  id: 'pavilion',
  w: 3,
  d: 3,
  massing(w) {
    const stone: Ink = 'metal';
    w.shadow(-0.3, -0.3, 3.6, 3.6, 0.55);
    // 1 — massing: two terraces, six columns on a ring, a drum, a dome.
    w.cylinder(1.5, 1.5, 1.72, { color: stone, h: 0.2 });
    w.cylinder(1.5, 1.5, 1.52, { color: stone, h: 0.2, z: 0.2 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.28318; /* @tier-b pixels only */
      w.cylinder(1.5 + Math.cos(a) * 1.24, 1.5 + Math.sin(a) * 1.24, 0.15, { color: stone, h: 1.9, z: 0.4 });
    }
    // 2 — rhythm: an entablature ring, a frieze band, the drum.
    w.cylinder(1.5, 1.5, 1.44, { color: stone, h: 0.2, z: 2.3 });
    w.cylinder(1.5, 1.5, 1.36, { color: 'brand', h: 0.12, z: 2.5, outline: false });
    w.cylinder(1.5, 1.5, 1.2, { color: stone, h: 0.34, z: 2.62 });
    // 3 — the dome, a gilded band, a finial and two flag poles clear of the roof.
    w.roof(0.32, 0.32, 2.36, 2.36, 2.96, 0.92, 'brand');
    w.cylinder(1.5, 1.5, 0.3, { color: 'warn', h: 0.16, z: 3.86, outline: false });
    w.post(1.5, 1.5, 4.02, 0.5, 'ink', 0.07);
    w.post(-0.2, 3.2, 0.4, 4.1, 'ink', 0.09);
    w.post(3.2, -0.2, 0.4, 4.1, 'ink', 0.09);
    w.glow(1.5, 1.5, 2.9, 'warn', 0.24, 0.7);
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    const z = pxToLevels(zPx);
    // Bunting between the two poles: nine squares on one dip, each at its own phase. The line runs
    // across the lattice, which is the only orientation that has any screen width at all.
    for (let i = 0; i < 9; i++) {
      const k = (i + 1) / 10;
      const fx = gx - 0.2 + k * 3.4;
      const fy = gy + 3.2 - k * 3.4;
      const dip = k * (1 - k) * 2.6;
      const wave = noise2(0x8d4, i, pen.t * 1.1) * 0.16;
      const top = z + 4.4 - dip;
      const hue: Ink = i % 3 === 0 ? 'warn' : i % 3 === 1 ? 'brand' : 'ok';
      isoWall(pen, fx, fy, fx + 0.24, fy - 0.24 + wave, top - 0.32, top, hue, 'ink');
    }
    flame(pen, gx + 1.5, gy + 1.5, z + 2.94, 4.4, 0.26);
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    field.add(gx + 1.5, gy + 1.5, zPx, 4.2, 0.72, 'warn');
  },
});

// ── birds, which belong to nothing and are drawn straight ────────────────────────────────────

/**
 * Six birds on a slow circuit over the lagoon.
 *
 * Not sprites: they have no footprint, they are never in the depth sort, and they are painted in
 * the Overlay pass above the night mask. They exist because a still sky over a moving crowd is
 * the one part of the frame that reads as a screenshot.
 */
export function drawBirds(pen: Pen, cx: number, cy: number): void {
  const k = pen.camera.zoom;
  const ink = withAlpha(pen.palette.get('ink'), 0.5);
  for (let i = 0; i < 6; i++) {
    const u = (pen.t * 0.035 + i * 0.167) % 1;
    const a = u * 6.28318; /* @tier-b pixels only */
    const r = 15 + toUnit(hash2(0x8b1, i, 1)) * 9;
    const lift = 7 + toUnit(hash2(0x8b1, i, 2)) * 5 + Math.sin(a * 3) * 0.7;
    const p = at(pen, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, lift);
    const beat = noise2(0x8b1, i, pen.t * 5.5) * 2.4 * k;
    pen.xy[0] = p.x - 4.5 * k;
    pen.xy[1] = p.y - beat;
    pen.xy[2] = p.x;
    pen.xy[3] = p.y + beat * 0.4;
    pen.xy[4] = p.x + 4.5 * k;
    pen.xy[5] = p.y - beat;
    pen.surface.stroke(pen.xy, 3, false, ink, Math.max(1, 1.3 * k));
  }
}

/** Dust and pollen in the low sun. Screen-space, above everything, and it costs nine ellipses. */
export function drawMotes(pen: Pen): void {
  const w = pen.surface.width;
  const h = pen.surface.height;
  const warm = withAlpha(mix(pen.palette.get('warn'), 0xffffffff, 0.5), 0.3);
  for (let i = 0; i < 26; i++) {
    const drift = (toUnit(hash2(0x2f5, i, 1)) + pen.t * (0.006 + toUnit(hash2(0x2f5, i, 3)) * 0.01)) % 1;
    const x = drift * (w + 60) - 30;
    const y = toUnit(hash2(0x2f5, i, 2)) * h + noise2(0x2f5, i, pen.t * 0.3) * 22;
    const r = 0.9 + toUnit(hash2(0x2f5, i, 4)) * 1.5;
    pen.surface.ellipse(x, y, r, r, warm);
  }
}

/** Everything above the night mask, which is birds and dust and nothing else. */
export function drawAir(pen: Pen, cx: number, cy: number): void {
  drawBirds(pen, cx, cy);
  drawMotes(pen);
}
