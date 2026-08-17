/**
 * @art
 *
 * One person, drawn from an integer.
 *
 * **Every visible property of a walker is a hash of its index.** Height, stoop, build, cloak,
 * skin, hat, what it is carrying, how fast it strides and where in the stride it currently is —
 * all of it is `hash2(SEED, id, k)` for a different `k`, and none of it is drawn from an `Rng`
 * stream. That distinction is the whole reason walker 47 is the *same person* on every frame,
 * after every re-sort, on every reload, and at every walker count: a stream's `next()` depends on
 * how many draws happened before it, so the moment the crowd is re-ordered — which the depth sort
 * does sixty times a second — a stream would deal walker 47 somebody else's coat.
 *
 * It is also the reason there is no walker struct to hold any of it. Appearance is recomputed from
 * `id` in the frame that draws it and thrown away, exactly as position is recomputed from `id` and
 * `t`. Two hundred people, and the only thing that exists between frames is a number that counts
 * them.
 *
 * ## What makes two hundred sampled points read as a crowd
 *
 * A particle system and a crowd differ in four things, and none of them is the motion:
 *
 * | | why it matters |
 * |---|---|
 * | **outline variety** | a stoop, a tall man, a woman with a basket on her head, a child's height — read at fourteen pixels, where color does not |
 * | **stride phase** | identical phases are a chorus line. The rate is per-person, so the crowd falls in and out of step with itself for ever |
 * | **a contact shadow on every one** | without it people hover, and a hovering crowd is a diagram |
 * | **things carried** | a basket, a bundle, a staff, a parasol. People in a market are *doing something* |
 */
import { hash2, toUnit } from '@latticekit/core';
import {
  LEVEL_H,
  contactShadow,
  isoBox,
  isoCylinder,
  isoPost,
  mix,
  shade,
  withAlpha,
  type Pen,
  type Rgba,
} from '@latticekit/draw';
import { gridToScreen } from '@latticekit/iso';

/** The one salt every walker property is drawn against. Fixed rather than seeded from the URL:
 *  the *place* changes with the seed, the people do not, so two links can be compared. */
const WHO = 0x9d1a7f;

/**
 * Unit facing per direction code, so a walker's legs swing along the way it is going.
 *
 * A table rather than a `sqrt` per walker per frame: `pathDirAt` already answers in one of eight
 * codes — deliberately, because `Math.atan2` is not required to be correctly rounded — and the
 * eight unit vectors those codes stand for are eight constants. Index 0 is "no route".
 */
const FX = [0, 1, 0.70710678, 0, -0.70710678, -1, -0.70710678, 0, 0.70710678];
const FY = [0, 0, 0.70710678, 1, 0.70710678, 0, -0.70710678, -1, -0.70710678];

/** The slots a cloak is dyed from. Slot names, so the crowd recolors with the hour. */
const CLOAKS = ['brand', 'ok', 'bad', 'metal', 'ink', 'glass', 'warn'] as const;

const pt = { x: 0, y: 0 };

/** Screen position at a storey height — for the two things that are drawn in screen space. */
function at(pen: Pen, gx: number, gy: number, levels: number): { x: number; y: number } {
  gridToScreen(pen.camera, gx, gy, levels * LEVEL_H, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * Paint walker `id` standing at `(gx, gy)` on ground `zPx`, facing direction code `dir`.
 *
 * Roughly fifteen surface operations, and that number is the exhibit's real finding: at two
 * hundred it is nothing, and at two thousand it is the entire frame. The closed form that
 * *placed* them is not what costs.
 */
export function drawWalker(pen: Pen, id: number, gx: number, gy: number, zPx: number, dir: number): void {
  const z = zPx / LEVEL_H;
  const k = pen.camera.zoom;

  // ── who this is. Nine hashes, no state, no stream ──────────────────────────────────────────
  const tall = 1.3 + toUnit(hash2(WHO, id, 1)) * 0.62;
  const stoop = toUnit(hash2(WHO, id, 2)) * 0.17;
  const dye = toUnit(hash2(WHO, id, 3));
  const hat = hash2(WHO, id, 4) & 3;
  const carry = hash2(WHO, id, 5) % 6;
  const skin = toUnit(hash2(WHO, id, 6));
  const rate = 1.5 + toUnit(hash2(WHO, id, 7)) * 1.4;
  const build = 0.082 + toUnit(hash2(WHO, id, 8)) * 0.042;
  const accent = pen.palette.get(dye < 0.5 ? 'warn' : 'bad');

  const slot = CLOAKS[(hash2(WHO, id, 9) & 7) % CLOAKS.length] ?? 'brand';
  const cloak: Rgba = mix(pen.palette.get(slot), pen.palette.get('ink'), 0.14 + dye * 0.42);
  const flesh: Rgba = mix(0xf4e0bcff, 0x6a4128ff, skin);

  // ── the gait: a triangle wave, per-person rate, per-person phase ────────────────────────────
  //
  // A triangle rather than a sine, and not to save the `sin`: `Math.sin` is Tier B and a stride
  // that reached a hash or a save would not be replayable across engines. At fourteen pixels the
  // two are indistinguishable, and this one is exact arithmetic.
  const cycle = (pen.t * rate + toUnit(hash2(WHO, id, 10)) * 8) % 1;
  const swing = (cycle < 0.5 ? cycle * 4 - 1 : 3 - cycle * 4) * 0.5;
  const bob = (cycle < 0.25 || cycle > 0.75 ? 1 : -1) * 0.018;

  const fx = FX[dir] ?? 0;
  const fy = FY[dir] ?? 0;
  // Perpendicular to travel, which is where the two feet are relative to each other.
  const px = fy * 0.05;
  const py = -fx * 0.05;

  const hip = z + tall * 0.34;
  const chest = hip + tall * 0.46 - stoop;
  const crown = chest + 0.2;

  // ── the figure ──────────────────────────────────────────────────────────────────────────────
  // The seventh argument is the one that is silent when it is missing: without it every shadow in
  // the crowd is painted at sea level while the people walk a piazza fifty pixels above it, and
  // two hundred shadows sit in the lagoon in a neat ring under nobody.
  contactShadow(pen, gx - 0.14, gy - 0.14, 0.28, 0.28, 0.5, z);

  const shoe = shade(cloak, 0.62);
  isoPost(pen, gx + px + fx * swing * 0.1, gy + py + fy * swing * 0.1, z, tall * 0.36, shoe, 0.048);
  isoPost(pen, gx - px - fx * swing * 0.1, gy - py - fy * swing * 0.1, z, tall * 0.36, shoe, 0.048);

  // Torso, and the one outlined element: the silhouette stroke goes on the shape that *is* the
  // silhouette, not on every part, or a crowd turns into a mesh of hairlines at low zoom.
  isoBox(pen, gx - build, gy - build, build * 2, build * 2, {
    color: cloak,
    h: tall * 0.46 - stoop + bob,
    z: hip,
  });
  // Shoulders, set back from the body below them — the smallest possible setback, and it is what
  // stops a person reading as one box with a head on it.
  isoBox(pen, gx - build * 0.78, gy - build * 0.78, build * 1.56, build * 1.56, {
    color: shade(cloak, 1.12),
    h: 0.14,
    z: chest + bob,
    outline: false,
  });
  isoBox(pen, gx - 0.052, gy - 0.052, 0.104, 0.104, { color: flesh, h: 0.21, z: chest + 0.14 + bob, outline: false });

  // ── the hat, which is most of the outline variety ───────────────────────────────────────────
  const head = crown + bob;
  if (hat === 1) {
    isoBox(pen, gx - 0.062, gy - 0.062, 0.124, 0.124, { color: accent, h: 0.085, z: head, outline: false });
    isoBox(pen, gx - 0.04 + fx * 0.04, gy - 0.04 + fy * 0.04, 0.08, 0.08, { color: accent, h: 0.03, z: head - 0.02, outline: false });
  } else if (hat === 2) {
    isoCylinder(pen, gx, gy, 0.125, { color: shade(cloak, 0.8), h: 0.035, z: head, outline: false });
    isoCylinder(pen, gx, gy, 0.058, { color: shade(cloak, 0.9), h: 0.15, z: head + 0.035, outline: false });
  } else if (hat === 3) {
    isoBox(pen, gx - 0.058, gy - 0.058, 0.116, 0.116, { color: accent, h: 0.14, z: head - 0.05, outline: false });
  } else {
    isoBox(pen, gx - 0.055, gy - 0.055, 0.11, 0.11, { color: shade(flesh, 0.42), h: 0.055, z: head - 0.03, outline: false });
  }

  // ── what they are carrying ──────────────────────────────────────────────────────────────────
  if (carry === 1) {
    // A basket on the head. The one silhouette that reads as "market" from right across the plaza.
    isoCylinder(pen, gx, gy, 0.09, { color: 'ground', h: 0.18, z: head + 0.07, outline: false });
    isoCylinder(pen, gx, gy, 0.1, { color: shade(pen.palette.get('ground'), 0.8), h: 0.03, z: head + 0.25, outline: false });
  } else if (carry === 2) {
    // A basket swinging at the hip, opposite the leading foot.
    isoCylinder(pen, gx + py * 2.2 - fx * swing * 0.06, gy - px * 2.2 - fy * swing * 0.06, 0.06, { color: 'ground', h: 0.16, z: hip + 0.14, outline: false });
  } else if (carry === 3) {
    isoPost(pen, gx + px * 2.4, gy + py * 2.4, z, tall * 1.22, shade(pen.palette.get('ink'), 1.1), 0.022);
  } else if (carry === 4) {
    // A bundle on the back: behind the walker, so it disappears as they turn towards you.
    isoBox(pen, gx - fx * 0.13 - 0.065, gy - fy * 0.13 - 0.065, 0.13, 0.13, { color: mix(pen.palette.get('ground'), pen.palette.get('ink'), 0.3), h: 0.26, z: chest - 0.18 + bob, outline: false });
  } else if (carry === 5) {
    // A parasol, and a small pool of colored light on the person under it.
    isoPost(pen, gx + px * 2.4, gy + py * 2.4, z, tall * 1.34, 'ink', 0.02);
    const p = at(pen, gx + px * 2.4, gy + py * 2.4, z + tall * 1.34);
    pen.surface.ellipse(p.x, p.y, 8.5 * k, 4.25 * k, withAlpha(accent, 0.92));
    pen.surface.ellipse(p.x, p.y - 1.1 * k, 8.5 * k, 4.25 * k, withAlpha(shade(accent, 1.2), 0.95));
  }

  // A tenth of the crowd is carrying a light. Drawn, never emitted: two hundred entries in the
  // light field would be a full-screen blur pass fighting for the same milliseconds the people
  // are spending, for a glow nobody would attribute to a lantern.
  if ((hash2(WHO, id, 11) & 15) === 0) {
    const p = at(pen, gx + py * 2.6, gy - px * 2.6, hip + 0.24);
    const warm = pen.palette.get('warn');
    pen.surface.softEllipse(p.x, p.y, 7 * k, 7 * k, withAlpha(warm, 0.44), withAlpha(warm, 0));
    pen.surface.ellipse(p.x, p.y, 1.5 * k, 1.5 * k, mix(warm, 0xfff2ccff, 0.55));
  }
}
