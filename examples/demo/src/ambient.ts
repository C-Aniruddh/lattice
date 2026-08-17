/**
 * @art — this module's own first line has been the gallery's worked example of the classification
 * since before there was a tag to write: it is here *because* it is mechanically inert.
 *
 * Ambient life: everything that moves and changes no number.
 *
 * It has its own module precisely *because* it is mechanically inert. In a world where only the
 * things that pay move, a player's eye learns that motion means something is happening to them,
 * and the valley reads as a dashboard with scenery on it. A bird crossing while nothing happens
 * is what turns it back into a place.
 *
 * Everything here is closed form in `pen.t` and a seeded hash of the instance's own index, so it
 * costs no state, allocates nothing, and is identical on every replay.
 */
import { clamp01, hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen, heightAt } from '@latticekit/iso';
import { mix, withAlpha, type Pen } from '@latticekit/draw';
import { steady } from './palette.js';
import { GRASS, H, RIVER, W, type Valley } from './valley.js';

const pt: Vec2 = { x: 0, y: 0 };
/**
 * How many of each, and **every one of these is a fraction of the map rather than a count**.
 *
 * They were absolute — fourteen birds over a grid hard-coded as 54 tiles wide — and when the map
 * went from 64 tiles to 96 for § Scale's extent row, every bird, firefly, mote and deer stayed
 * inside the old rectangle and the whole of the valley's life huddled into one corner of it. The
 * failure is silent: each one is still animating correctly, in a place nobody is looking.
 *
 * So the counts scale with area and the ranges below are written in {@link W} and {@link H}.
 * `docs/GALLERY.md` § Scale's density row asks for hundreds of *something*; between the trees and
 * these, the valley has them.
 */
const AREA = (W * H) / (64 * 64);
const BIRDS = Math.round(14 * AREA);
const FLIES = Math.round(46 * AREA);
const MOTES = Math.round(34 * AREA);
const DEER = Math.round(3 * AREA);

/** Smoke: five puffs rising and spreading from a world point. The cheapest life a chimney can have. */
export function smoke(pen: Pen, gx: number, gy: number, zPx: number, seed: number, strength: number): void {
  if (strength <= 0) return;
  const s = pen.surface;
  for (let i = 0; i < 5; i++) {
    const phase = (pen.t * 0.28 + i / 5 + toUnit(hash2(seed, i, 7))) % 1;
    const drift = noise2(seed, i * 3.1, pen.t * 0.35) * 0.55;
    gridToScreen(pen.camera, gx + drift * phase, gy - drift * phase, zPx + phase * 66, pt);
    const r = (3 + phase * 15) * pen.camera.zoom;
    s.softEllipse(
      pt.x + pen.snapX,
      pt.y + pen.snapY,
      r,
      r * 0.86,
      // `phase` is continuous in `pen.t`, so this pair was a fresh ramp key on every frame.
      steady(withAlpha(mix(pen.palette.get('metal'), pen.palette.get('sky'), 0.5), (1 - phase) * 0.3 * strength)),
      steady(withAlpha(pen.palette.get('sky'), 0)),
    );
  }
}

/** Birds, in loose skeins, crossing the whole valley on a slow loop. Two strokes each. */
function birds(pen: Pen, v: Valley, daylight: number): void {
  const alpha = clamp01(daylight * 1.6 - 0.25);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const ink = withAlpha(pen.palette.get('ink'), alpha * 0.75);
  for (let i = 0; i < BIRDS; i++) {
    const flock = i / 5 | 0;
    const speed = 0.9 + toUnit(hash2(v.seed ^ 0xb1, flock, 1)) * 0.5;
    const lane = toUnit(hash2(v.seed ^ 0xb1, flock, 2));
    const phase = (pen.t * speed * 0.011 + toUnit(hash2(v.seed ^ 0xb1, flock, 3))) % 1;
    const spread = (i % 5) - 2;
    const gx = phase * (W - 10) - 7 + spread * 1.5;
    const gy = 3 + lane * (H * 0.55) - spread * 2.0 + Math.sin(pen.t * 0.7 + i) * 0.4; /* @tier-b pixels only */
    const z = 210 + lane * 90 + noise2(v.seed, i, pen.t * 0.6) * 26;
    gridToScreen(pen.camera, gx, gy, z, pt);
    const x = pt.x + pen.snapX;
    const y = pt.y + pen.snapY;
    const beat = Math.sin(pen.t * 9 + i * 1.7) * 2.4 * pen.camera.zoom; /* @tier-b pixels only */
    const wing = 4.4 * pen.camera.zoom;
    pen.xy[0] = x - wing;
    pen.xy[1] = y - beat;
    pen.xy[2] = x;
    pen.xy[3] = y + beat * 0.5;
    pen.xy[4] = x + wing;
    pen.xy[5] = y - beat;
    s.stroke(pen.xy, 3, false, ink, Math.max(1, 1.5 * pen.camera.zoom));
  }
}

/** Fireflies over the water meadow, only after dark, drifting on two noise fields. */
function fireflies(pen: Pen, v: Valley, daylight: number): void {
  const alpha = clamp01(1 - daylight * 1.8);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const warm = pen.palette.get('warn');
  for (let i = 0; i < FLIES; i++) {
    const gx = 4 + toUnit(hash2(v.seed ^ 0xf1, i, 1)) * (W - 8) + noise2(v.seed, i * 2.3, pen.t * 0.22) * 2.6;
    const gy = 4 + toUnit(hash2(v.seed ^ 0xf1, i, 2)) * (H - 8) + noise2(v.seed, i * 5.7, pen.t * 0.19) * 2.6;
    const t = v.terrain.get(gx | 0, gy | 0);
    if (t !== GRASS && t !== RIVER) continue;
    const blink = noise2(v.seed ^ 0x2a, i * 4.4, pen.t * 1.35) * 0.5 + 0.5;
    if (blink < 0.45) continue;
    const z = heightAt(v.field, gx, gy) + 12 + noise2(v.seed, i, pen.t * 0.4) * 14;
    gridToScreen(pen.camera, gx, gy, z, pt);
    const r = 1.7 * pen.camera.zoom;
    const a = alpha * (blink - 0.45) * 1.8;
    s.softEllipse(pt.x, pt.y, r * 5, r * 5, steady(withAlpha(warm, a * 0.22)), steady(withAlpha(warm, 0)));
    s.ellipse(pt.x, pt.y, r, r, withAlpha(mix(warm, 0xfffbe6ff, 0.6), a));
  }
}

/** Pollen and dust in the daylight, low over the grass. */
function motes(pen: Pen, v: Valley, daylight: number): void {
  const alpha = clamp01(daylight * 1.4 - 0.3);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  for (let i = 0; i < MOTES; i++) {
    const gx = 3 + toUnit(hash2(v.seed ^ 0x7c, i, 1)) * (W - 6) + noise2(v.seed, i * 1.9, pen.t * 0.14) * 3.4;
    const gy = 3 + toUnit(hash2(v.seed ^ 0x7c, i, 2)) * (H - 6) + noise2(v.seed, i * 8.1, pen.t * 0.12) * 3.4;
    const z = heightAt(v.field, gx, gy) + 8 + ((pen.t * 6 + i * 37) % 40);
    gridToScreen(pen.camera, gx, gy, z, pt);
    s.ellipse(pt.x, pt.y, 1.3 * pen.camera.zoom, 1.3 * pen.camera.zoom, withAlpha(0xfff6d8ff, alpha * 0.35));
  }
}

/**
 * Deer, wandering a closed loop on the grass. They mean nothing and they are the reason the
 * meadow is a meadow. The loop is a lissajous in grid space, so there is no state to save.
 */
function deer(pen: Pen, v: Valley, daylight: number): void {
  for (let i = 0; i < DEER; i++) {
    const cx = 6 + toUnit(hash2(v.seed ^ 0xd3, i, 1)) * (W - 12);
    const cy = 6 + toUnit(hash2(v.seed ^ 0xd3, i, 2)) * (H - 12);
    const r = 2.5 + toUnit(hash2(v.seed ^ 0xd3, i, 3)) * 4;
    const w = 0.05 + toUnit(hash2(v.seed ^ 0xd3, i, 4)) * 0.05;
    const gx = cx + Math.cos(pen.t * w + i) * r; /* @tier-b pixels only */
    const gy = cy + Math.sin(pen.t * w * 1.4 + i * 2) * r; /* @tier-b pixels only */
    if (v.terrain.get(gx | 0, gy | 0) !== GRASS) continue;
    const z = heightAt(v.field, gx, gy);
    gridToScreen(pen.camera, gx, gy, z, pt);
    const k = pen.camera.zoom;
    const graze = clamp01(noise2(v.seed, i * 3, pen.t * 0.3) * 2);
    const body = mix(pen.palette.get('brand'), pen.palette.get('ground'), 0.45 + daylight * 0.1);
    pen.surface.softEllipse(pt.x, pt.y + 2 * k, 7 * k, 3.4 * k, steady(withAlpha(pen.palette.get('ink'), 0.3)), steady(withAlpha(pen.palette.get('ink'), 0)));
    pen.surface.ellipse(pt.x, pt.y - 7 * k, 6 * k, 4 * k, body);
    pen.surface.ellipse(pt.x + 4 * k, pt.y - (11 - graze * 6) * k, 2.4 * k, 2.4 * k, body);
  }
}

/** Everything that is alive and pays nothing, in one call from the Effects pass. */
export function drawAmbient(pen: Pen, v: Valley, daylight: number): void {
  motes(pen, v, daylight);
  deer(pen, v, daylight);
  birds(pen, v, daylight);
  fireflies(pen, v, daylight);
}
