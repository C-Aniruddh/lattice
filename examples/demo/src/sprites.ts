/**
 * @art — the objects themselves. Delete it and the valley still has its road, its stations, its
 * capacity and its dusk; every one of them is simply invisible. Nothing here returns a number any
 * decision reads, and nothing here survives the frame it was drawn in.
 *
 * The art. Silhouette first, detail at three scales, and something moving on every object.
 *
 * Seven rules are load-bearing here and none of them is a preference:
 *
 * 1. **Silhouette first.** Every object differs from every other in *outline* at 40 px. A gate is
 *    two towers and an arch; a shrine is a stepped platform under a double roof; a lamp is a
 *    tapered post under a hooded lantern. Color is the last thing a player reads, not the first.
 * 2. **Detail at three scales**: massing, then panel and window rhythm, then trim, glints and
 *    small lights. Skipping the middle scale is what makes generated geometry look generated.
 * 3. **Setback massing.** Nothing important is one box. Plinth, body, a smaller storey set back
 *    from the edge below it, and furniture on the roof — four stages, each narrower than the last.
 * 4. **Something moves on every object.** Flame, banner, prayer flag, rocking beam, swaying bough,
 *    a ring on a bracket. A static world reads as a screenshot.
 * 5. **Three-tone faces from one color**, derived by `draw`'s `shade` — never three hand-picked
 *    colors, because one color per object is what keeps the palette in tune with itself. Shadows
 *    go cool and highlights go warm, which `shade` does for free and which does most of the work.
 * 6. **A silhouette stroke on everything**, at the object's own hue: the strongest hand-made cue
 *    available, and it hides every seam in the geometry underneath.
 * 7. **Per-instance variation is keyed on identity**, never on draw order. `massing` and `animate`
 *    are each handed a stream rewound from `Variant.seed`, so a lamp's flicker is *that* lamp's
 *    flicker on every reload and after every re-sort.
 *
 * **Nothing here names its ground elevation twice.** A massing is not told where the hill is —
 * the writer already stands on it, so every `z` below is measured from the sprite's own base — and
 * an animator and an emitter each take `zPx`, the world pixels `drawSprite` was handed, converted
 * once with `pxToLevels`. This used to be smuggled through `Variant.level`, in a unit conversion
 * written here, and the tell that it was wrong is that the *picking* half of the same seam had no
 * channel at all: silhouettes were computed at sea level while the lamps were painted up the hill.
 */
import { hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import {
  FLAG_POWERED,
  LEVEL_H,
  contactShadow,
  defineSprite,
  glowDot,
  isoBox,
  isoPost,
  isoWall,
  mix,
  pxToLevels,
  shade,
  withAlpha,
  type Ink,
  type Pen,
  type SpriteDef,
} from '@latticekit/draw';
import { smoke } from './ambient.js';
import { steady } from './palette.js';

const pt: Vec2 = { x: 0, y: 0 };

/** The screen point for a grid position at a storey height — the one conversion `animate` needs. */
function at(pen: Pen, gx: number, gy: number, levels: number): Vec2 {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/** A flame: a hot core, a lick that never repeats, and two sparks, all off one seeded phase. */
function flame(pen: Pen, gx: number, gy: number, levels: number, phase: number, size: number, power: number): void {
  const lick = noise2(0x11ae, phase, pen.t * 2.4) * 0.5 + 0.5;
  const sway = noise2(0x22bf, phase, pen.t * 1.1) * 0.05 * size;
  // The flame is the exhibit's worst case for `rampFor`'s cache: `lick` is continuous, every lit
  // lamp has one, and dusk is when they are all alight. The *color* is snapped and the sway, the
  // height, the radius and the spark timing below are all left continuous — the eye reads those.
  const core = steady(mix(pen.palette.get('warn'), 0xfff2ccff, 0.4 + lick * 0.35));
  glowDot(pen, gx + sway, gy - sway, levels + lick * 0.06 * size, core, size * (0.7 + lick * 0.5), power);
  for (let i = 0; i < 2; i++) {
    const k = (pen.t * 0.7 + i * 0.5 + phase) % 1;
    const p = at(pen, gx + sway * 3, gy - sway * 3, levels + k * size * 2.4);
    const r = Math.max(0.7, (1 - k) * size * 3.2 * pen.camera.zoom);
    pen.surface.ellipse(p.x, p.y, r, r, withAlpha(core, (1 - k) * 0.7 * power));
  }
}

/** A rhythm of lit and dark windows along a wall — one loop, and it carries a whole building. */
function windows(
  w: { wall: (ax: number, ay: number, bx: number, by: number, z0: number, z1: number, fill: Ink, stroke?: Ink) => void },
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  z1: number,
  count: number,
  seed: number,
): void {
  for (let i = 0; i < count; i++) {
    const k = (i + 0.5) / count;
    const half = 0.34 / count;
    const x = ax + (bx - ax) * k;
    const y = ay + (by - ay) * k;
    const dx = (bx - ax) * half;
    const dy = (by - ay) * half;
    const lit = toUnit(hash2(seed, i, 3)) > 0.28;
    w.wall(x - dx, y - dy, x + dx, y + dy, z0, z1, lit ? 'warn' : 'ink', 'ink');
  }
}

// ── the lamp, which is the subject of the whole exhibit ──────────────────────────────────────

export const lamp = defineSprite({
  id: 'lamp',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const on = (v.flags & FLAG_POWERED) !== 0;
    const iron = 'ink';
    const lean = rng.next() * 0.04 - 0.02;
    w.shadow(0.14, 0.14, 0.72, 0.72, on ? 0.5 : 0.34);
    // 1 — massing: an apron, a plinth, a post that tapers twice, a hooded lantern.
    w.tile(0, 0, withAlpha(0x000000ff, 0.09), undefined, 0.14, 0.004);
    w.box(0.24, 0.24, 0.52, 0.52, { color: 'metal', h: 0.16 });
    w.box(0.31, 0.31, 0.38, 0.38, { color: 'metal', h: 0.1, z: 0.16, outline: false });
    w.post(0.5 + lean, 0.5 + lean, 0.26, 1.2, iron, 0.17);
    w.post(0.5 + lean * 2, 0.5 + lean * 2, 1.46, 0.62, iron, 0.11);
    // 2 — rhythm: a collar, a crossarm, glazing bars on both visible faces of the housing.
    w.box(0.41, 0.41, 0.18, 0.18, { color: 'metal', h: 0.06, z: 1.4, outline: false });
    w.box(0.44, 0.16, 0.12, 0.7, { color: iron, h: 0.05, z: 2.0, outline: false });
    const pane: Ink = on ? 'warn' : 'glass';
    w.box(0.3, 0.3, 0.4, 0.4, { color: on ? 'warn' : 'metal', h: 0.44, z: 2.04 });
    w.wall(0.3, 0.7, 0.7, 0.7, 2.1, 2.42, pane, iron);
    w.wall(0.7, 0.7, 0.7, 0.3, 2.1, 2.42, pane, iron);
    w.roof(0.21, 0.21, 0.58, 0.58, 2.48, 0.28, iron);
    // 3 — trim: a finial, a cap bead, a ring on the crossarm, a rivet.
    w.post(0.5, 0.5, 2.76, 0.24, iron, 0.06);
    w.box(0.44, 0.44, 0.12, 0.12, { color: 'metal', h: 0.05, z: 3.0, outline: false });
    w.box(0.46, 0.14, 0.09, 0.09, { color: 'metal', h: 0.05, z: 1.9, outline: false });
    if (on) w.glow(0.5, 0.5, 2.26, 'warn', 0.2, 0.95);
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const phase = rng.next() * 40;
    if ((v.flags & FLAG_POWERED) === 0) {
      const swing = noise2(0x5a1, phase, pen.t * 0.5) * 0.035;
      isoBox(pen, gx + 0.46 + swing, gy + 0.14, 0.09, 0.09, { color: 'metal', h: 0.05, z: z + 1.9, outline: false });
      return;
    }
    flame(pen, gx + 0.5, gy + 0.5, z + 2.26, phase, 0.2, 1);
    // A faint cone of light in the air under the hood: what a lamp looks like in fog.
    const p = at(pen, gx + 0.5, gy + 0.5, z + 1.5);
    const k = pen.camera.zoom;
    pen.surface.softEllipse(p.x, p.y, 26 * k, 20 * k, steady(withAlpha(pen.palette.get('warn'), 0.13)), steady(withAlpha(pen.palette.get('warn'), 0)));
  },
  emit(field, gx, gy, v, rng, zPx) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    const lick = noise2(0x11ae, rng.next() * 40, 0) * 0.5 + 0.5;
    field.add(gx + 0.5, gy + 0.5, zPx, 3.3 + lick * 0.35, 0.88 + lick * 0.1, 'warn');
  },
});

/**
 * A station nobody has lit yet: a cairn, a marker, and a bubble floating over it.
 *
 * The two states are told apart in outline rather than by color — one is a stack of stones shorter
 * than a person, the other a post twice their height — and the bubble is what makes "tap here"
 * legible from across the valley.
 */
export const site = defineSprite({
  id: 'site',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    w.shadow(0.14, 0.14, 0.72, 0.72, 0.34);
    w.tile(0, 0, withAlpha(0x000000ff, 0.09), undefined, 0.14, 0.004);
    let h = 0;
    for (let i = 0; i < 5; i++) {
      const s = 0.46 - i * 0.07;
      const o = (1 - s) / 2 + (rng.next() - 0.5) * 0.07;
      const t = 0.12 + rng.next() * 0.06;
      w.box(o, o, s, s, { color: 'metal', h: t, z: h });
      h += t;
    }
    // A tall waypost, so the marker has a silhouette a finger can find and a volume a
    // silhouette pick can hit — and it runs *past* the bubble, so the bubble is inside the
    // massing `spriteVolume` measures rather than floating above it needing a fallback.
    w.post(0.28, 0.72, 0, 2.5, 'ink', 0.08);
    w.box(0.16, 0.6, 0.26, 0.26, { color: 'metal', h: 0.08, z: 1.7, outline: false });
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const z = pxToLevels(zPx);
    const phase = rng.next() * 20;
    // The sway moves ONE axis. It used to move both in proportion, which is edge-on exactly when
    // sway is 0 — and `isoWall` refuses an edge-on wall rather than painting nothing. K29 argued
    // that could not happen because `noise2` would have to return exactly 0; it returns exactly 0
    // at 397k of 14M lattice samples, and this shipped the exception into the hero on the landing
    // page. A run that is constant on one axis cannot be edge-on, whatever the noise does.
    const sway = noise2(0x9c2, phase, pen.t * 0.9) * 0.1;
    isoWall(pen, gx + 0.28, gy + 0.72, gx + 0.28 + 0.34, gy + 0.72 + sway, z + 1.18, z + 1.62, 'ok', 'ink');
    // The bubble: a dark disc, a bright ring, a soft halo, on a small bob.
    const bob = noise2(0x4d1, phase, pen.t * 0.7) * 0.16;
    const p = at(pen, gx + 0.34, gy + 0.66, z + 2.2 + bob);
    const k = pen.camera.zoom;
    const ok = pen.palette.get('ok');
    pen.surface.softEllipse(p.x, p.y, 30 * k, 30 * k, steady(withAlpha(ok, 0.28)), steady(withAlpha(ok, 0)));
    pen.surface.ellipse(p.x, p.y, 11 * k, 11 * k, withAlpha(pen.palette.get('ink'), 0.88));
    pen.xy[0] = p.x - 4.5 * k;
    pen.xy[1] = p.y + 3.5 * k;
    pen.xy[2] = p.x;
    pen.xy[3] = p.y - 4.5 * k;
    pen.xy[4] = p.x + 4.5 * k;
    pen.xy[5] = p.y + 3.5 * k;
    pen.surface.stroke(pen.xy, 3, false, mix(ok, 0xffffffff, 0.4), Math.max(1.2, 1.8 * k));
    const ring = 11 * k;
    let n = 0;
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2; /* @tier-b pixels only */
      pen.xy[n++] = p.x + Math.cos(a) * ring;
      pen.xy[n++] = p.y + Math.sin(a) * ring;
    }
    pen.surface.stroke(pen.xy, n / 2, true, mix(ok, 0xffffffff, 0.35), Math.max(1, 1.4 * k));
  },
});

// ── the town gate ────────────────────────────────────────────────────────────────────────────

export const gate = defineSprite({
  id: 'gate',
  w: 3,
  d: 3,
  massing(w, _v, rng) {
    const stone: Ink = 'metal';
    w.shadow(-0.1, -0.1, 3.2, 3.2, 0.5);
    // 1 — massing: a paved apron, a plinth, two towers, an arch between them.
    for (let i = 0; i < 9; i++) w.tile(i % 3, (i / 3) | 0, withAlpha(0x000000ff, 0.1), undefined, 0.1, 0.004);
    w.box(-0.14, -0.14, 3.28, 3.28, { color: stone, h: 0.26 });
    for (const ox of [0, 2.25]) {
      w.box(ox, 0.3, 0.75, 2.4, { color: stone, h: 2.7, z: 0.26 });
      w.box(ox + 0.06, 0.36, 0.63, 2.28, { color: stone, h: 0.55, z: 2.96 });
      // 2 — rhythm: a string course, three windows a side, crenellations along the parapet.
      w.box(ox - 0.06, 0.24, 0.87, 2.52, { color: stone, h: 0.13, z: 1.5, outline: false });
      windows(w, ox + 0.75, 0.4, ox + 0.75, 2.6, 1.85, 2.6, 3, 0x1a + ox * 7);
      for (let i = 0; i < 5; i++) {
        w.box(ox + 0.02, 0.32 + i * 0.48, 0.71, 0.24, { color: stone, h: 0.3, z: 3.51 });
      }
      w.roof(ox - 0.12, 0.18, 0.99, 2.64, 3.81, 0.85, 'brand');
      w.post(ox + 0.37, 1.5, 4.66, 0.5, 'ink', 0.06);
    }
    // The arch, and the gatehouse over it.
    w.box(0.75, 0.9, 1.5, 0.42, { color: stone, h: 1.7, z: 0.26, outline: false });
    w.box(0.75, 2.1, 1.5, 0.42, { color: stone, h: 1.7, z: 0.26, outline: false });
    w.box(0.7, 0.85, 1.6, 1.72, { color: stone, h: 1.0, z: 1.96 });
    windows(w, 0.75, 2.58, 2.25, 2.58, 2.2, 2.8, 3, 0x2b);
    w.roof(0.6, 0.75, 1.8, 1.9, 2.96, 0.62, 'brand');
    w.sign(0.75, 2.62, 2.25, 2.62, 1.9, 0.4, 'GATE', 'warn');
    // 3 — trim: a chimney, firewood, a water butt, a bracket lantern by the arch.
    w.box(0.25, 2.55, 0.34, 0.34, { color: stone, h: 0.75, z: 4.0 });
    w.cylinder(2.8, 2.72, 0.22, { color: 'brand', h: 0.55 });
    for (let i = 0; i < 5; i++) {
      w.cylinder(0.28 + rng.next() * 0.2, 0.15 + i * 0.03, 0.1, { color: 'ink', h: 0.44, outline: false });
    }
    w.glow(1.5, 2.6, 2.55, 'warn', 0.18, 0.9);
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    const z = pxToLevels(zPx);
    flame(pen, gx + 0.37, gy + 1.5, z + 5.2, 3.3, 0.3, 1);
    flame(pen, gx + 2.62, gy + 1.5, z + 5.2, 8.1, 0.3, 1);
    const wave = noise2(0x7b3, 1, pen.t * 1.2) * 0.12;
    isoWall(pen, gx + 0.9, gy + 2.6, gx + 2.1, gy + 2.6 + wave, z + 1.0, z + 1.9, 'brand', 'ink');
    smoke(pen, gx + 0.42, gy + 2.72, zPx + 4.75 * LEVEL_H, 0x9a1, 1);
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    field.add(gx + 0.37, gy + 1.5, zPx, 4, 0.85, 'warn');
    field.add(gx + 2.62, gy + 1.5, zPx, 4, 0.85, 'warn');
    field.add(gx + 1.5, gy + 2.6, zPx, 2, 0.5, 'warn');
  },
});

// ── the shrine, which has to look worth walking to from the first frame ──────────────────────

export const shrine = defineSprite({
  id: 'shrine',
  w: 3,
  d: 3,
  massing(w) {
    w.shadow(-0.4, -0.4, 3.8, 3.8, 0.55);
    // 1 — massing: three terraces, a colonnade, a body, a smaller storey, a double roof.
    w.box(-0.42, -0.42, 3.84, 3.84, { color: 'metal', h: 0.22 });
    w.box(-0.26, -0.26, 3.52, 3.52, { color: 'metal', h: 0.22, z: 0.22 });
    w.box(-0.1, -0.1, 3.2, 3.2, { color: 'metal', h: 0.22, z: 0.44 });
    for (let i = 0; i < 5; i++) {
      w.box(-0.36 + i * 0.07, 1.1, 0.07, 0.9, { color: 'metal', h: 0.06, z: 0.08 + i * 0.13, outline: false });
    }
    w.box(0.28, 0.28, 2.44, 2.44, { color: 'brand', h: 2.1, z: 0.66 });
    for (const ox of [0.06, 2.66]) {
      for (const oy of [0.06, 2.66]) w.cylinder(ox + 0.14, oy + 0.14, 0.16, { color: 'metal', h: 2.4, z: 0.66 });
    }
    // 2 — rhythm: a doorway, lattice windows either side, a frieze, a set-back upper storey.
    w.wall(1.1, 0.28, 1.9, 0.28, 0.66, 1.7, 'ink', 'ink');
    windows(w, 0.28, 0.9, 0.28, 2.4, 1.1, 1.95, 3, 0x77);
    windows(w, 2.72, 0.9, 2.72, 2.4, 1.1, 1.95, 3, 0x78);
    w.box(0.16, 0.16, 2.68, 2.68, { color: 'ink', h: 0.16, z: 2.76, outline: false });
    w.roof(-0.3, -0.3, 3.6, 3.6, 2.92, 0.8, 'ink');
    w.sign(0.45, 2.72, 2.55, 2.72, 2.7, 0.38, 'THE SHRINE', 'warn');
    w.box(0.72, 0.72, 1.56, 1.56, { color: 'brand', h: 0.62, z: 3.72 });
    w.roof(0.44, 0.44, 2.12, 2.12, 4.34, 0.72, 'ink');
    // 3 — trim: the brazier and its tripod, two flag poles, a bell on a bracket.
    w.cylinder(1.5, 1.5, 0.38, { color: 'metal', h: 0.1, z: 4.96, outline: false });
    w.cylinder(1.5, 1.5, 0.3, { color: 'warn', h: 0.44, z: 5.06 });
    // The flag poles run across the *screen* rather than into it, or the line between them is a
    // three-pixel stripe on the near corner of the roof.
    w.post(-0.34, 3.34, 0.66, 4.4, 'ink', 0.1);
    w.post(3.34, -0.34, 0.66, 4.4, 'ink', 0.1);
    w.cylinder(2.9, 0.4, 0.18, { color: 'warn', h: 0.3, z: 2.2 });
  },
  animate(pen, gx, gy, _v, _rng, zPx) {
    const z = pxToLevels(zPx);
    // Prayer flags between the poles: eleven squares on one wave, each at its own phase.
    for (let i = 0; i < 11; i++) {
      const k = (i + 1) / 12;
      const fx = gx - 0.34 + k * 3.68;
      const fy = gy + 3.34 - k * 3.68;
      const dip = Math.sin(k * Math.PI) * 0.7; /* @tier-b pixels only */
      const wave = noise2(0x8d4, i, pen.t * 1.1) * 0.17;
      const top = z + 4.9 - dip;
      const hue: Ink = i % 3 === 0 ? 'bad' : i % 3 === 1 ? 'ok' : 'warn';
      // A wall segment whose two ends differ equally in gx and gy projects to *zero* screen
      // width. The flag has to run across the lattice, not into it.
      isoWall(pen, fx, fy, fx + 0.26, fy - 0.26 + wave, top - 0.36, top, hue, 'ink');
    }
    // The brazier is always alight — it is the thing at the top of the screen worth walking to.
    flame(pen, gx + 1.5, gy + 1.5, z + 5.5, 7.1, 0.4, 1);
    flame(pen, gx + 1.5, gy + 1.5, z + 5.95, 2.7, 0.24, 0.6);
  },
  emit(field, gx, gy, _v, _rng, zPx) {
    field.add(gx + 1.5, gy + 1.5, zPx, 4.6, 0.82, 'warn');
  },
});

// ── scenery ──────────────────────────────────────────────────────────────────────────────────

/** Five props, told apart in outline: a spire, a crown, a snag, a bush, a boulder. */
export const prop = defineSprite({
  id: 'prop',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const kind = v.flags & 7;
    const big = (v.flags & 8) !== 0;
    const h = (big ? 1.9 : 1.25) + rng.next() * 0.7;
    if (kind === 4) {
      w.shadow(0.2, 0.2, 0.6, 0.6, 0.4);
      w.box(0.22, 0.24, 0.5, 0.46, { color: 'metal', h: 0.3 + rng.next() * 0.4, inset: 0.04 });
      w.box(0.4, 0.16, 0.28, 0.3, { color: 'metal', h: 0.24, outline: false });
      return;
    }
    if (kind === 3) {
      w.shadow(0.22, 0.22, 0.56, 0.56, 0.36);
      for (let i = 0; i < 3; i++) {
        w.cylinder(0.36 + rng.next() * 0.28, 0.36 + rng.next() * 0.28, 0.16 + rng.next() * 0.1, {
          color: 'ok',
          h: 0.3 + rng.next() * 0.2,
          outline: i === 0,
        });
      }
      return;
    }
    w.shadow(0.16, 0.16, 0.68, 0.68, 0.4);
    if (kind === 2) {
      w.post(0.5, 0.5, 0, h * 1.25, 'ink', 0.13);
      w.post(0.34, 0.6, h * 0.6, h * 0.42, 'ink', 0.07);
      w.post(0.64, 0.38, h * 0.78, h * 0.3, 'ink', 0.06);
      return;
    }
    w.post(0.5, 0.5, 0, h * 0.55, 'ink', 0.11 + rng.next() * 0.03);
    if (kind === 0) {
      const r = 0.38 + rng.next() * 0.14;
      w.cylinder(0.5, 0.5, r, { color: 'ok', h: h * 0.44, z: h * 0.3 });
      w.cylinder(0.5, 0.5, r * 0.74, { color: 'ok', h: h * 0.4, z: h * 0.68, outline: false });
      w.cylinder(0.5, 0.5, r * 0.44, { color: 'ok', h: h * 0.34, z: h * 1.04, outline: false });
    } else {
      const r = 0.34 + rng.next() * 0.12;
      for (let i = 0; i < 3; i++) {
        w.cylinder(0.5 + (rng.next() - 0.5) * 0.36, 0.5 + (rng.next() - 0.5) * 0.36, r * (0.7 + rng.next() * 0.45), {
          color: 'ok',
          h: h * 0.5,
          z: h * (0.42 + rng.next() * 0.26),
          outline: i === 0,
        });
      }
    }
  },
  animate(pen, gx, gy, v, rng, zPx) {
    const kind = v.flags & 7;
    if (kind === 4) return;
    const z = pxToLevels(zPx);
    const ph = rng.next() * 30;
    const big = (v.flags & 8) !== 0;
    const h = (big ? 1.9 : 1.25) + rng.next() * 0.7;
    // One wind field for the whole valley plus a per-tree phase, so the wood moves together
    // without moving in lockstep.
    const gust = noise2(0x4e2, gx * 0.05 + pen.t * 0.35, gy * 0.05) * 0.5 + 0.5;
    const sway = noise2(0x4e2, ph, pen.t * 0.8) * 0.1 * (0.5 + gust);
    if (kind === 3) {
      isoBox(pen, gx + 0.44 + sway, gy + 0.44, 0.12, 0.12, { color: 'ok', h: 0.1, z: z + 0.42, outline: false });
      return;
    }
    if (kind === 2) {
      isoPost(pen, gx + 0.34 + sway, gy + 0.6 + sway, z + h * 0.6, h * 0.42, 'ink', 0.07);
      return;
    }
    isoBox(pen, gx + 0.44 + sway, gy + 0.44 + sway * 0.7, 0.14, 0.14, {
      color: 'ok',
      h: 0.16,
      z: z + h * (kind === 0 ? 1.38 : 1.02),
      outline: false,
    });
  },
});

/**
 * The same five props at a dozen pixels tall: one solid each, no contact shadow, no outline,
 * nothing that moves.
 *
 * **This is `docs/GALLERY.md` § Scale's "spend the detail where the eye is", as a second sprite.**
 * The valley holds about 2,350 props and the cull normally leaves 250 of them on screen; pulled
 * all the way out to `minZoom` it leaves **1,607**, which is past the thousand-sprite row in
 * `docs/PERFORMANCE.md` and measured at a 24.8 ms worst frame — a red readout on the one gesture
 * a visitor makes first. Reducing the count was available and would have thinned a forest that is
 * the best thing in the exhibit; reducing the *ops* was the row's actual instruction.
 *
 * A detailed tree is three cylinders, a post, a soft shadow and a swaying bough. Every cylinder is
 * a `surface.polyRamp` and every one of those allocates a `CanvasGradient` (see the report — that
 * path has no cache), so the saving is roughly five sixths of the tree. At the zoom this comes in
 * at, a tree is twelve pixels tall and the difference is not resolvable; the *stand* is what the
 * eye reads at that distance, and the stand is unchanged.
 *
 * There is deliberately no `animate` hook. A sway of a fifth of a pixel is not motion.
 */
export const propFar = defineSprite({
  id: 'prop-far',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const kind = v.flags & 7;
    const big = (v.flags & 8) !== 0;
    const h = (big ? 1.9 : 1.25) + rng.next() * 0.7;
    if (kind === 4) {
      w.box(0.24, 0.24, 0.5, 0.46, { color: 'metal', h: 0.34, outline: false });
      return;
    }
    if (kind === 3) {
      w.cylinder(0.5, 0.5, 0.3, { color: 'ok', h: 0.34, outline: false });
      return;
    }
    // The trunk survives at every distance: it is the whole reason a wood reads as vertical
    // rather than as a green rash on the hillside.
    w.post(0.5, 0.5, 0, h * 0.55, 'ink', 0.12);
    if (kind === 2) return;
    w.cylinder(0.5, 0.5, kind === 0 ? 0.4 : 0.36, { color: 'ok', h: h * (kind === 0 ? 0.92 : 0.72), z: h * 0.34, outline: false });
  },
});

/**
 * Which of the two to draw, given the camera. The exhibit's one line of level-of-detail.
 *
 * 0.52 is where a prop's cylinder is about fourteen screen pixels across — the point at which the
 * three-cylinder crown and the one-cylinder crown produce the same silhouette to within a pixel,
 * measured by flipping between them at a series of zooms rather than chosen as a round number.
 */
export function lodOf(def: SpriteDef, zoom: number): SpriteDef {
  return def === prop && zoom < 0.52 ? propFar : def;
}

// ── pilgrims, drawn straight because they are points on a curve ──────────────────────────────

/**
 * One pilgrim: head, torso, legs, a shadow, and something in the hand about a third of the time.
 *
 * Height, stoop, cloak color, staff and lantern all come from `id`, so the same walker is the
 * same walker on every frame and after every re-sort. Twenty of these are what turn a diagram
 * into a place.
 */
export function drawPilgrim(pen: Pen, id: number, gx: number, gy: number, zPx: number, t: number): void {
  const z = pxToLevels(zPx);
  const k = pen.camera.zoom;
  const tall = 0.78 + toUnit(hash2(0x9d1, id, 1)) * 0.44;
  const stoop = toUnit(hash2(0x9d1, id, 2)) * 0.12;
  const hue = toUnit(hash2(0x9d1, id, 3));
  const skin = toUnit(hash2(0x9d1, id, 6));
  const hasStaff = toUnit(hash2(0x9d1, id, 4)) < 0.5;
  const hasLantern = toUnit(hash2(0x9d1, id, 5)) < 0.28;
  const cloak = mix(
    pen.palette.get('brand'),
    pen.palette.get(hue < 0.35 ? 'ink' : hue < 0.6 ? 'metal' : hue < 0.85 ? 'bad' : 'ok'),
    0.25 + hue * 0.55,
  );
  const stride = (t * 2.6 + id * 0.37) % 1;
  const bob = Math.abs(stride * 2 - 1);
  const swing = Math.sin(stride * Math.PI * 2) * 0.06; /* @tier-b pixels only */
  const body = tall * 0.62 - stoop;
  contactShadow(pen, gx - 0.24, gy - 0.24, 0.48, 0.48, 0.46);
  // Legs, out of phase with each other, so a walk reads as a walk at fourteen pixels.
  isoPost(pen, gx - 0.09 + swing, gy - 0.09 - swing, z, tall * 0.34, shade(cloak, 0.7), 0.11);
  isoPost(pen, gx + 0.09 - swing, gy + 0.09 + swing, z, tall * 0.34, shade(cloak, 0.7), 0.11);
  isoBox(pen, gx - 0.2, gy - 0.2, 0.4, 0.4, { color: cloak, h: body + bob * 0.05, z: z + tall * 0.3 });
  isoBox(pen, gx - 0.14, gy - 0.14, 0.28, 0.28, {
    color: shade(cloak, 1.14),
    h: 0.18,
    z: z + tall * 0.3 + body + bob * 0.05,
    outline: false,
  });
  isoBox(pen, gx - 0.1, gy - 0.1, 0.2, 0.2, {
    color: mix(0xf2ddb8ff, 0x7a4a2eff, skin),
    h: 0.2,
    z: z + tall * 0.3 + body + bob * 0.05 + 0.18,
    outline: false,
  });
  if (hasStaff) isoPost(pen, gx + 0.24, gy + 0.04, z, tall * 1.4, 'ink', 0.05);
  if (hasLantern) {
    const p = at(pen, gx - 0.26, gy + 0.18, z + tall * 0.55);
    const warm = pen.palette.get('warn');
    pen.surface.softEllipse(p.x, p.y, 15 * k, 15 * k, steady(withAlpha(warm, 0.36)), steady(withAlpha(warm, 0)));
    pen.surface.ellipse(p.x, p.y, 2.6 * k, 2.6 * k, mix(warm, 0xfff0c8ff, 0.5));
    pen.light?.add(gx, gy, zPx, 1.5, 0.4, 'warn');
  }
}
