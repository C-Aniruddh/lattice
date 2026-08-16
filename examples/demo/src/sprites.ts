/**
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
 * One thing here is game code only because the kit has no slot for it: every sprite reads its
 * ground elevation out of `Variant.level`, because `drawSprite` has no `zPx` and `massing` is
 * handed nothing else that could carry one.
 */
import { hash2, noise2, toUnit, type Vec2 } from '@lattice/core';
import { gridToScreen } from '@lattice/iso';
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
  shade,
  withAlpha,
  type Ink,
  type Pen,
} from '@lattice/draw';
import { STEP_PX } from './valley.js';
import { smoke } from './ambient.js';

/** Ground elevation is smuggled through `Variant.level`, in height units. See the file header. */
export const zOf = (levelUnits: number): number => (levelUnits * STEP_PX) / LEVEL_H;
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
  const core = mix(pen.palette.get('warn'), 0xfff2ccff, 0.4 + lick * 0.35);
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
    const z = zOf(v.level);
    const on = (v.flags & FLAG_POWERED) !== 0;
    const iron = 'ink';
    const lean = rng.next() * 0.04 - 0.02;
    w.shadow(0.14, 0.14, 0.72, 0.72, on ? 0.5 : 0.34);
    // 1 — massing: an apron, a plinth, a post that tapers twice, a hooded lantern.
    w.tile(0, 0, withAlpha(0x000000ff, 0.09), undefined, 0.14, 0.004);
    w.box(0.24, 0.24, 0.52, 0.52, { color: 'metal', h: 0.16, z });
    w.box(0.31, 0.31, 0.38, 0.38, { color: 'metal', h: 0.1, z: z + 0.16, outline: false });
    w.post(0.5 + lean, 0.5 + lean, z + 0.26, 1.2, iron, 0.17);
    w.post(0.5 + lean * 2, 0.5 + lean * 2, z + 1.46, 0.62, iron, 0.11);
    // 2 — rhythm: a collar, a crossarm, glazing bars on both visible faces of the housing.
    w.box(0.41, 0.41, 0.18, 0.18, { color: 'metal', h: 0.06, z: z + 1.4, outline: false });
    w.box(0.44, 0.16, 0.12, 0.7, { color: iron, h: 0.05, z: z + 2.0, outline: false });
    const pane: Ink = on ? 'warn' : 'glass';
    w.box(0.3, 0.3, 0.4, 0.4, { color: on ? 'warn' : 'metal', h: 0.44, z: z + 2.04 });
    w.wall(0.3, 0.7, 0.7, 0.7, z + 2.1, z + 2.42, pane, iron);
    w.wall(0.7, 0.7, 0.7, 0.3, z + 2.1, z + 2.42, pane, iron);
    w.roof(0.21, 0.21, 0.58, 0.58, z + 2.48, 0.28, iron);
    // 3 — trim: a finial, a cap bead, a ring on the crossarm, a rivet.
    w.post(0.5, 0.5, z + 2.76, 0.24, iron, 0.06);
    w.box(0.44, 0.44, 0.12, 0.12, { color: 'metal', h: 0.05, z: z + 3.0, outline: false });
    w.box(0.46, 0.14, 0.09, 0.09, { color: 'metal', h: 0.05, z: z + 1.9, outline: false });
    if (on) w.glow(0.5, 0.5, z + 2.26, 'warn', 0.2, 0.95);
  },
  animate(pen, gx, gy, v, rng) {
    const z = zOf(v.level);
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
    pen.surface.softEllipse(p.x, p.y, 26 * k, 20 * k, withAlpha(pen.palette.get('warn'), 0.13), withAlpha(pen.palette.get('warn'), 0));
  },
  emit(field, gx, gy, v, rng) {
    if ((v.flags & FLAG_POWERED) === 0) return;
    const lick = noise2(0x11ae, rng.next() * 40, 0) * 0.5 + 0.5;
    field.add(gx + 0.5, gy + 0.5, v.level * STEP_PX, 3.3 + lick * 0.35, 0.88 + lick * 0.1, 'warn');
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
    const z = zOf(v.level);
    w.shadow(0.14, 0.14, 0.72, 0.72, 0.34);
    w.tile(0, 0, withAlpha(0x000000ff, 0.09), undefined, 0.14, 0.004);
    let h = z;
    for (let i = 0; i < 5; i++) {
      const s = 0.46 - i * 0.07;
      const o = (1 - s) / 2 + (rng.next() - 0.5) * 0.07;
      const t = 0.12 + rng.next() * 0.06;
      w.box(o, o, s, s, { color: 'metal', h: t, z: h });
      h += t;
    }
    // A tall waypost, so the marker has a silhouette a finger can find and a volume a
    // silhouette pick can hit — the bubble floats just inside the top of it.
    w.post(0.28, 0.72, z, 2.0, 'ink', 0.08);
    w.box(0.16, 0.6, 0.26, 0.26, { color: 'metal', h: 0.08, z: z + 1.7, outline: false });
  },
  animate(pen, gx, gy, v, rng) {
    const z = zOf(v.level);
    const phase = rng.next() * 20;
    const sway = noise2(0x9c2, phase, pen.t * 0.9) * 0.1;
    isoWall(pen, gx + 0.28, gy + 0.72, gx + 0.28 + sway, gy + 0.72 + sway * 1.6, z + 1.18, z + 1.62, 'ok', 'ink');
    // The bubble: a dark disc, a bright ring, a soft halo, on a small bob.
    const bob = noise2(0x4d1, phase, pen.t * 0.7) * 0.16;
    const p = at(pen, gx + 0.34, gy + 0.66, z + 2.2 + bob);
    const k = pen.camera.zoom;
    const ok = pen.palette.get('ok');
    pen.surface.softEllipse(p.x, p.y, 30 * k, 30 * k, withAlpha(ok, 0.28), withAlpha(ok, 0));
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
  massing(w, v, rng) {
    const z = zOf(v.level);
    const stone: Ink = 'metal';
    w.shadow(-0.1, -0.1, 3.2, 3.2, 0.5);
    // 1 — massing: a paved apron, a plinth, two towers, an arch between them.
    for (let i = 0; i < 9; i++) w.tile(i % 3, (i / 3) | 0, withAlpha(0x000000ff, 0.1), undefined, 0.1, 0.004);
    w.box(-0.14, -0.14, 3.28, 3.28, { color: stone, h: 0.26, z });
    for (const ox of [0, 2.25]) {
      w.box(ox, 0.3, 0.75, 2.4, { color: stone, h: 2.7, z: z + 0.26 });
      w.box(ox + 0.06, 0.36, 0.63, 2.28, { color: stone, h: 0.55, z: z + 2.96 });
      // 2 — rhythm: a string course, three windows a side, crenellations along the parapet.
      w.box(ox - 0.06, 0.24, 0.87, 2.52, { color: stone, h: 0.13, z: z + 1.5, outline: false });
      windows(w, ox + 0.75, 0.4, ox + 0.75, 2.6, z + 1.85, z + 2.6, 3, 0x1a + ox * 7);
      for (let i = 0; i < 5; i++) {
        w.box(ox + 0.02, 0.32 + i * 0.48, 0.71, 0.24, { color: stone, h: 0.3, z: z + 3.51 });
      }
      w.roof(ox - 0.12, 0.18, 0.99, 2.64, z + 3.81, 0.85, 'brand');
      w.post(ox + 0.37, 1.5, z + 4.66, 0.5, 'ink', 0.06);
    }
    // The arch, and the gatehouse over it.
    w.box(0.75, 0.9, 1.5, 0.42, { color: stone, h: 1.7, z: z + 0.26, outline: false });
    w.box(0.75, 2.1, 1.5, 0.42, { color: stone, h: 1.7, z: z + 0.26, outline: false });
    w.box(0.7, 0.85, 1.6, 1.72, { color: stone, h: 1.0, z: z + 1.96 });
    windows(w, 0.75, 2.58, 2.25, 2.58, z + 2.2, z + 2.8, 3, 0x2b);
    w.roof(0.6, 0.75, 1.8, 1.9, z + 2.96, 0.62, 'brand');
    w.sign(0.75, 2.62, 2.25, 2.62, z + 1.9, 0.4, 'GATE', 'warn');
    // 3 — trim: a chimney, firewood, a water butt, a bracket lantern by the arch.
    w.box(0.25, 2.55, 0.34, 0.34, { color: stone, h: 0.75, z: z + 4.0 });
    w.cylinder(2.8, 2.72, 0.22, { color: 'brand', h: 0.55, z });
    for (let i = 0; i < 5; i++) {
      w.cylinder(0.28 + rng.next() * 0.2, 0.15 + i * 0.03, 0.1, { color: 'ink', h: 0.44, z, outline: false });
    }
    w.glow(1.5, 2.6, z + 2.55, 'warn', 0.18, 0.9);
  },
  animate(pen, gx, gy, v) {
    const z = zOf(v.level);
    flame(pen, gx + 0.37, gy + 1.5, z + 5.2, 3.3, 0.3, 1);
    flame(pen, gx + 2.62, gy + 1.5, z + 5.2, 8.1, 0.3, 1);
    const wave = noise2(0x7b3, 1, pen.t * 1.2) * 0.12;
    isoWall(pen, gx + 0.9, gy + 2.6, gx + 2.1, gy + 2.6 + wave, z + 1.0, z + 1.9, 'brand', 'ink');
    smoke(pen, gx + 0.42, gy + 2.72, (z + 4.75) * LEVEL_H, 0x9a1, 1);
  },
  emit(field, gx, gy, v) {
    field.add(gx + 0.37, gy + 1.5, v.level * STEP_PX, 4, 0.85, 'warn');
    field.add(gx + 2.62, gy + 1.5, v.level * STEP_PX, 4, 0.85, 'warn');
    field.add(gx + 1.5, gy + 2.6, v.level * STEP_PX, 2, 0.5, 'warn');
  },
});

// ── the shrine, which has to look worth walking to from the first frame ──────────────────────

export const shrine = defineSprite({
  id: 'shrine',
  w: 3,
  d: 3,
  massing(w, v) {
    const z = zOf(v.level);
    w.shadow(-0.4, -0.4, 3.8, 3.8, 0.55);
    // 1 — massing: three terraces, a colonnade, a body, a smaller storey, a double roof.
    w.box(-0.42, -0.42, 3.84, 3.84, { color: 'metal', h: 0.22, z });
    w.box(-0.26, -0.26, 3.52, 3.52, { color: 'metal', h: 0.22, z: z + 0.22 });
    w.box(-0.1, -0.1, 3.2, 3.2, { color: 'metal', h: 0.22, z: z + 0.44 });
    for (let i = 0; i < 5; i++) {
      w.box(-0.36 + i * 0.07, 1.1, 0.07, 0.9, { color: 'metal', h: 0.06, z: z + 0.08 + i * 0.13, outline: false });
    }
    w.box(0.28, 0.28, 2.44, 2.44, { color: 'brand', h: 2.1, z: z + 0.66 });
    for (const ox of [0.06, 2.66]) {
      for (const oy of [0.06, 2.66]) w.cylinder(ox + 0.14, oy + 0.14, 0.16, { color: 'metal', h: 2.4, z: z + 0.66 });
    }
    // 2 — rhythm: a doorway, lattice windows either side, a frieze, a set-back upper storey.
    w.wall(1.1, 0.28, 1.9, 0.28, z + 0.66, z + 1.7, 'ink', 'ink');
    windows(w, 0.28, 0.9, 0.28, 2.4, z + 1.1, z + 1.95, 3, 0x77);
    windows(w, 2.72, 0.9, 2.72, 2.4, z + 1.1, z + 1.95, 3, 0x78);
    w.box(0.16, 0.16, 2.68, 2.68, { color: 'ink', h: 0.16, z: z + 2.76, outline: false });
    w.roof(-0.3, -0.3, 3.6, 3.6, z + 2.92, 0.8, 'ink');
    w.sign(0.45, 2.72, 2.55, 2.72, z + 2.7, 0.38, 'THE SHRINE', 'warn');
    w.box(0.72, 0.72, 1.56, 1.56, { color: 'brand', h: 0.62, z: z + 3.72 });
    w.roof(0.44, 0.44, 2.12, 2.12, z + 4.34, 0.72, 'ink');
    // 3 — trim: the brazier and its tripod, two flag poles, a bell on a bracket.
    w.cylinder(1.5, 1.5, 0.38, { color: 'metal', h: 0.1, z: z + 4.96, outline: false });
    w.cylinder(1.5, 1.5, 0.3, { color: 'warn', h: 0.44, z: z + 5.06 });
    // The flag poles run across the *screen* rather than into it, or the line between them is a
    // three-pixel stripe on the near corner of the roof.
    w.post(-0.34, 3.34, z + 0.66, 4.4, 'ink', 0.1);
    w.post(3.34, -0.34, z + 0.66, 4.4, 'ink', 0.1);
    w.cylinder(2.9, 0.4, 0.18, { color: 'warn', h: 0.3, z: z + 2.2 });
  },
  animate(pen, gx, gy, v) {
    const z = zOf(v.level);
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
  emit(field, gx, gy, v) {
    field.add(gx + 1.5, gy + 1.5, v.level * STEP_PX, 4.6, 0.82, 'warn');
  },
});

// ── scenery ──────────────────────────────────────────────────────────────────────────────────

/** Five props, told apart in outline: a spire, a crown, a snag, a bush, a boulder. */
export const prop = defineSprite({
  id: 'prop',
  w: 1,
  d: 1,
  massing(w, v, rng) {
    const z = zOf(v.level);
    const kind = v.flags & 7;
    const big = (v.flags & 8) !== 0;
    const h = (big ? 1.9 : 1.25) + rng.next() * 0.7;
    if (kind === 4) {
      w.shadow(0.2, 0.2, 0.6, 0.6, 0.4);
      w.box(0.22, 0.24, 0.5, 0.46, { color: 'metal', h: 0.3 + rng.next() * 0.4, z, inset: 0.04 });
      w.box(0.4, 0.16, 0.28, 0.3, { color: 'metal', h: 0.24, z, outline: false });
      return;
    }
    if (kind === 3) {
      w.shadow(0.22, 0.22, 0.56, 0.56, 0.36);
      for (let i = 0; i < 3; i++) {
        w.cylinder(0.36 + rng.next() * 0.28, 0.36 + rng.next() * 0.28, 0.16 + rng.next() * 0.1, {
          color: 'ok',
          h: 0.3 + rng.next() * 0.2,
          z,
          outline: i === 0,
        });
      }
      return;
    }
    w.shadow(0.16, 0.16, 0.68, 0.68, 0.4);
    if (kind === 2) {
      w.post(0.5, 0.5, z, h * 1.25, 'ink', 0.13);
      w.post(0.34, 0.6, z + h * 0.6, h * 0.42, 'ink', 0.07);
      w.post(0.64, 0.38, z + h * 0.78, h * 0.3, 'ink', 0.06);
      return;
    }
    w.post(0.5, 0.5, z, h * 0.55, 'ink', 0.11 + rng.next() * 0.03);
    if (kind === 0) {
      const r = 0.38 + rng.next() * 0.14;
      w.cylinder(0.5, 0.5, r, { color: 'ok', h: h * 0.44, z: z + h * 0.3 });
      w.cylinder(0.5, 0.5, r * 0.74, { color: 'ok', h: h * 0.4, z: z + h * 0.68, outline: false });
      w.cylinder(0.5, 0.5, r * 0.44, { color: 'ok', h: h * 0.34, z: z + h * 1.04, outline: false });
    } else {
      const r = 0.34 + rng.next() * 0.12;
      for (let i = 0; i < 3; i++) {
        w.cylinder(0.5 + (rng.next() - 0.5) * 0.36, 0.5 + (rng.next() - 0.5) * 0.36, r * (0.7 + rng.next() * 0.45), {
          color: 'ok',
          h: h * 0.5,
          z: z + h * (0.42 + rng.next() * 0.26),
          outline: i === 0,
        });
      }
    }
  },
  animate(pen, gx, gy, v, rng) {
    const kind = v.flags & 7;
    if (kind === 4) return;
    const z = zOf(v.level);
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

// ── pilgrims, drawn straight because they are points on a curve ──────────────────────────────

/**
 * One pilgrim: head, torso, legs, a shadow, and something in the hand about a third of the time.
 *
 * Height, stoop, cloak color, staff and lantern all come from `id`, so the same walker is the
 * same walker on every frame and after every re-sort. Twenty of these are what turn a diagram
 * into a place.
 */
export function drawPilgrim(pen: Pen, id: number, gx: number, gy: number, zPx: number, t: number): void {
  const z = zPx / LEVEL_H;
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
    pen.surface.softEllipse(p.x, p.y, 15 * k, 15 * k, withAlpha(warm, 0.36), withAlpha(warm, 0));
    pen.surface.ellipse(p.x, p.y, 2.6 * k, 2.6 * k, mix(warm, 0xfff0c8ff, 0.5));
    pen.light?.add(gx, gy, zPx, 1.5, 0.4, 'warn');
  }
}
