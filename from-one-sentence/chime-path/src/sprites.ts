/**
 * The three things standing on the mountain: a chime, a pine, a walker.
 *
 * Every height a massing writes is in storeys. `animate` draws through the free primitives, so
 * it converts the ground it was handed with `pxToLevels` and adds it — skip that and the tubes
 * sway at sea level while the post they hang from is up the hill.
 */
import { hashStep, toUnit } from '@latticekit/core';
import { defineSprite, glowDot, isoCylinder, isoPost, pxToLevels } from '@latticekit/draw';
import type { Variant } from '@latticekit/draw';
import { PITCHES } from './notes.js';

/** The same number in `massing` and in `animate`, addressed by index rather than by draw order —
 *  the two hooks get different `Rng` streams, so a crown drawn from the animator's stream lands
 *  beside the trunk it belongs to. */
function vat(v: Variant, i: number): number {
  return toUnit(hashStep(v.seed, i));
}

/** Storeys of post above the ground. Taller for a higher note, so a chime's pitch is legible in
 *  the silhouette before it has rung once. */
function postHeight(level: number): number {
  return 2.0 + (level / (PITCHES - 1)) * 1.5;
}

/** Tubes on the bar. Three to five, so a row of chimes is not a row of identical objects. */
function tubeCount(level: number): number {
  return 3 + (level % 3);
}

/**
 * A chime: a cairn, a leaning post, a crossbar and a rank of hanging tubes.
 *
 * `v.level` is the pitch. `v.progress` is how hard it is ringing right now, 0–1 — the variant is
 * the only channel a sprite has, and a closure over the game object is exactly what it exists to
 * close.
 */
export const CHIME = defineSprite({
  id: 'chime',
  w: 1,
  d: 1,
  massing(s, v, rng) {
    const h = postHeight(v.level);
    s.shadow(0.28, 0.28, 0.44, 0.44, 0.6);
    // Three scales: the cairn it is wedged into, the mast, and the collar at the top.
    s.box(0.28, 0.28, 0.44, 0.44, { color: 'rock', h: 0.32 });
    s.box(0.36, 0.36, 0.28, 0.28, { color: 'rock', h: 0.2, z: 0.32, outline: false });
    if (rng.next() > 0.4) s.box(0.16, 0.42, 0.16, 0.16, { color: 'rock', h: 0.16 });
    s.post(0.5, 0.5, 0.42, h, 'timber', 0.15);
    // The crossbar the tubes hang from — the one horizontal in the whole silhouette, and what
    // stops the thing reading as a signpost.
    s.box(0.12, 0.42, 0.78, 0.16, { color: 'timber', h: 0.11, z: 0.42 + h });
    s.post(0.5, 0.5, 0.53 + h, 0.26, 'metal', 0.2);
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const base = pxToLevels(zPx);
    const h = postHeight(v.level);
    const bar = base + 0.42 + h;
    // Ring energy snapped to nine levels: an animated colour is a ramp-cache key, and one that
    // varies continuously visits a new key every frame and evicts everybody else's.
    const ring = Math.round(v.progress * 8) / 8;
    const tubes = tubeCount(v.level);
    // The sway is the chime's own phase, so a row of them does not swing in lockstep.
    const sway = Math.sin(pen.t * 1.9 + vat(v, 9) * 6.283) * (0.03 + ring * 0.075);
    for (let i = 0; i < tubes; i++) {
      const along = 0.18 + (i / (tubes - 1)) * 0.64;
      const len = 0.5 + vat(v, i + 3) * 0.45 + v.level * 0.035;
      const tx = gx + along + sway;
      const ty = gy + 0.5 + sway * 0.55;
      isoPost(pen, tx, ty, bar - len, len, 'chime', 0.17);
      if (ring > 0.02) glowDot(pen, tx, ty, bar - len * 0.45, 'warn', 0.1 + ring * 0.12, ring * 0.7);
    }
    // A spark on the finial, not a lamp: a big soft ball here swallows the silhouette the rest
    // of the massing exists to make.
    glowDot(pen, gx + 0.5, gy + 0.5, bar + 0.78, 'warn', 0.1 + ring * 0.16, 0.35 + ring * 0.65);
  },
  emit(lights, gx, gy, v, _rng, zPx) {
    const ring = Math.round(v.progress * 8) / 8;
    // Two pools, never one: a single pool is a linear ramp, and the eye reads a linear ramp as
    // the size of the lamp rather than as the reach of its light.
    lights.add(gx + 0.5, gy + 0.5, zPx, 0.8, 0.9, 'warn');
    lights.add(gx + 0.5, gy + 0.5, zPx, 2.4 + ring * 6, 0.22 + ring * 0.5, 'warn');
  },
});

/** A pine. Setback massing — each tier narrower than the one below. */
export const PINE = defineSprite({
  id: 'pine',
  w: 1,
  d: 1,
  massing(s, v, rng) {
    const scale = 0.78 + v.level * 0.24;
    // Setback massing, four tiers: each narrower than the one below, which is what reads as a
    // conifer rather than as a stack of tins.
    // A slot NAME, resolved at draw time — never `s.palette.get`. `massing` is replayed with no
    // frame to measure the sprite, and that replay sees the kit's base slots rather than the
    // game's, so a massing that reads a game colour cannot be measured. Branching on `rng` is
    // safe: the kit rewinds it from `v.seed` on every call, so both replays agree.
    const dark = rng.next() > 0.5 ? 'pine' : 'pineDark';
    s.shadow(0.22, 0.22, 0.56, 0.56, 0.42);
    s.post(0.5, 0.5, 0, 0.42 * scale, 'timber', 0.13);
    s.cylinder(0.5, 0.5, 0.46, { color: dark, h: 0.5 * scale, z: 0.26 * scale, outline: false });
    s.cylinder(0.5, 0.5, 0.36, { color: dark, h: 0.5 * scale, z: 0.66 * scale, outline: false });
    s.cylinder(0.5, 0.5, 0.25, { color: dark, h: 0.46 * scale, z: 1.04 * scale, outline: false });
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const base = pxToLevels(zPx);
    const scale = 0.8 + v.level * 0.26;
    const sway = Math.sin(pen.t * 1.3 + vat(v, 1) * 6.283) * 0.045;
    // The crown is live art so the canopy is never still. Addressed from the same `zPx` the
    // massing was stood on, converted once.
    isoCylinder(pen, gx + 0.5 + sway, gy + 0.5 + sway * 0.5, 0.14, {
      color: 'pineDark',
      h: 0.42 * scale,
      z: base + 1.42 * scale,
      outline: false,
    });
  },
});

/** A walker. One tile, small, and the only thing on the mountain that is never still. */
export const WALKER = defineSprite({
  id: 'walker',
  w: 1,
  d: 1,
  massing(s, v) {
    s.shadow(0.36, 0.36, 0.28, 0.28, 0.55);
    s.post(0.5, 0.5, 0, 0.34, v.level === 1 ? 'cloak' : 'brand', 0.19);
  },
  animate(pen, gx, gy, v, _rng, zPx) {
    const base = pxToLevels(zPx);
    // A bob at walking cadence, phase-offset per walker: a column of people bobbing together
    // reads as one object.
    const bob = Math.abs(Math.sin(pen.t * 4.4 + vat(v, 0) * 6.283)) * 0.05;
    isoPost(pen, gx + 0.5, gy + 0.5, base + 0.34 + bob, 0.13, 'skin', 0.13);
  },
});
