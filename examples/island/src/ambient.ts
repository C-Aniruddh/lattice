/**
 * Everything alive on the coast that changes no number.
 *
 * @art
 *
 * It has its own module precisely *because* it is mechanically inert. In a world where only the
 * things that matter move, an eye learns that motion means something is happening, and the island
 * reads as a diagram with weather on it. A gull crossing while nothing else happens is what turns
 * it back into a place.
 *
 * Everything here is closed form in `pen.t` and a seeded hash of the instance's own index, so it
 * costs no state, allocates nothing, and is identical on every reload of the same seed.
 *
 * The four populations are chosen to cover the cycle rather than to fill the frame: **mist** owns
 * the hour after first light, **motes** and **gulls** own the day, **shoals** own the flat calm of
 * afternoon and evening, and the night belongs to the fireflies in `trees.ts`. At no point in the
 * ninety seconds is nothing moving, and at no point are all four going at once.
 *
 * ## Why the counts look absurd
 *
 * The world is five viewports wide and every population is spread across the whole of it, so the
 * fraction on screen at the opening zoom is under a fifth of what each loop below counts to. Three
 * hundred and twenty gulls is fifty-odd gulls in the frame — and it is fifty-odd *different* ones
 * after a drag, which is the point. Each costs one projection and a two-segment stroke, and the
 * off-screen ones are rejected on their x before anything else is computed.
 */
import { clamp01, hash2, noise2, toUnit, type Vec2 } from '@latticekit/core';
import { gridToScreen, heightAt } from '@latticekit/iso';
import { mix, wash, withAlpha, type Pen } from '@latticekit/draw';
import { MAIN_V, bedAt, type Island } from './island.js';
import { softGlow } from './palette.js';
import { skyWash } from './sky.js';

const pt: Vec2 = { x: 0, y: 0 };
const GULLS = 320;
const MOTES = 300;
const SHOALS = 48;
const MIST = 150;
/** How far either side of the frame's center the populations are scattered, in `u`. Matched to
 *  the camera's pan limits in `main.ts` — birds nobody can ever reach are birds nobody drew. */
const SPREAD = 76;

/**
 * Project a point given in the screen's own axes — `u` across, `v` into — and apply the frame's
 * pixel snap. `gx = v + u`, `gy = v − u` is the inverse of `island.ts`'s header table.
 */
function screen(pen: Pen, u: number, v: number, zPx: number): Vec2 {
  gridToScreen(pen.camera, v + u, v - u, zPx, pt);
  pt.x += pen.snapX;
  pt.y += pen.snapY;
  return pt;
}

/**
 * Gulls, in flocks turning over the water and along both shorelines.
 *
 * Two strokes each and a wingbeat out of phase with its neighbours. Circles rather than straight
 * crossings because birds that leave the frame have to be re-seeded and birds that orbit never
 * do — and because a flock wheeling over one headland is a thing a visitor pans back to look at.
 * The ones over the far channel are drawn smaller and paler: `iso` is an orthographic projection
 * and will not shrink them, so distance here is an art decision or it is nothing.
 */
function gulls(pen: Pen, island: Island, daylight: number): void {
  const alpha = clamp01(daylight * 1.7 - 0.3);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const wide = s.width + 40;
  for (let i = 0; i < GULLS; i++) {
    const flock = (i / 8) | 0;
    const cu = (toUnit(hash2(island.seed ^ 0xb1, flock, 1)) * 2 - 1) * SPREAD;
    const cv = MAIN_V - 3 + toUnit(hash2(island.seed ^ 0xb1, flock, 2)) * 34;
    const r = 3 + toUnit(hash2(island.seed ^ 0xb1, flock, 3)) * 9;
    const speed = 0.09 + toUnit(hash2(island.seed ^ 0xb1, flock, 4)) * 0.1;
    const a = pen.t * speed + (i % 8) * 0.36 + flock * 2.1;
    const u = cu + Math.cos(a) * r + (i % 8) * 0.4; /* @tier-b pixels only */
    const v = cv + Math.sin(a) * r * 0.5 - (i % 8) * 0.3; /* @tier-b pixels only */
    // Distance, as the one thing an orthographic camera refuses to do for you.
    const far = clamp01((cv - MAIN_V + 6) / 22) * 0.65 + 0.35;
    const z = 150 + flock * 44 + noise2(island.seed, i, pen.t * 0.6) * 22;
    const p = screen(pen, u, v, z);
    if (p.x < -40 || p.x > wide) continue;
    const beat = Math.sin(pen.t * 8.5 + i * 1.7) * 2.6 * pen.camera.zoom * far; /* @tier-b pixels only */
    const wing = 4.8 * pen.camera.zoom * far;
    pen.xy[0] = p.x - wing;
    pen.xy[1] = p.y - beat;
    pen.xy[2] = p.x;
    pen.xy[3] = p.y + beat * 0.55;
    pen.xy[4] = p.x + wing;
    pen.xy[5] = p.y - beat;
    s.stroke(pen.xy, 3, false, withAlpha(pen.palette.get('ink'), alpha * 0.72 * far), Math.max(1, 1.6 * pen.camera.zoom * far));
    // The underside catching the sun on the downbeat. One ellipse, and it is what stops a flock
    // reading as a row of identical checkmarks.
    if (beat < 0) s.ellipse(p.x, p.y, wing * 0.4, 1.1 * pen.camera.zoom, withAlpha(0xfff4e2ff, alpha * 0.5 * far));
  }
}

/** Pollen and dust over the wood, low and slow, only while there is sun to catch it. */
function motes(pen: Pen, island: Island, daylight: number): void {
  const alpha = clamp01(daylight * 1.5 - 0.45);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const wide = s.width + 20;
  for (let i = 0; i < MOTES; i++) {
    const u = (toUnit(hash2(island.seed ^ 0x7c, i, 1)) * 2 - 1) * SPREAD + noise2(island.seed, i * 1.9, pen.t * 0.15) * 3;
    const v = MAIN_V + 4 + toUnit(hash2(island.seed ^ 0x7c, i, 2)) * 56 + noise2(island.seed, i * 8.1, pen.t * 0.13) * 3;
    const gx = (v + u) | 0;
    const gy = (v - u) | 0;
    if (bedAt(island, gx, gy) < 1) continue;
    const z = heightAt(island.field, gx, gy) + 10 + ((pen.t * 7 + i * 37) % 46);
    const p = screen(pen, u, v, z);
    if (p.x < -20 || p.x > wide) continue;
    const k = 1.3 * pen.camera.zoom;
    s.ellipse(p.x, p.y, k, k, withAlpha(0xfff6d8ff, alpha * 0.4));
  }
}

/**
 * Fish, as the shadow a shoal casts on the channel floor.
 *
 * Nothing is drawn *above* the water: what you see from a beach is the dark patch moving, and
 * drawing the fish themselves would be four pixels of detail nobody can resolve holding up a
 * shape everybody can. The patch is three overlapping soft ellipses on a slow lissajous, and it
 * is refused wherever the bottom is not shallow enough to see.
 */
function shoals(pen: Pen, island: Island, daylight: number): void {
  const alpha = clamp01(daylight * 1.6 - 0.35);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const dark = pen.palette.get('ink');
  for (let i = 0; i < SHOALS; i++) {
    const cu = (toUnit(hash2(island.seed ^ 0x5f, i, 1)) * 2 - 1) * SPREAD;
    const w = 0.05 + toUnit(hash2(island.seed ^ 0x5f, i, 2)) * 0.06;
    const u = cu + Math.cos(pen.t * w + i * 2.3) * 5; /* @tier-b pixels only */
    const v = MAIN_V - 2.6 + Math.sin(pen.t * w * 1.35 + i) * 2.2; /* @tier-b pixels only */
    const e = bedAt(island, (v + u) | 0, (v - u) | 0);
    if (e > -0.6 || e < -7) continue;
    const fade = clamp01((-e - 0.6) * 0.9) * clamp01((7 + e) * 0.4);
    const p = screen(pen, u, v, 0);
    if (p.x < -60 || p.x > s.width + 60) continue;
    const k = pen.camera.zoom;
    for (let j = 0; j < 3; j++) {
      const ox = Math.cos(pen.t * w + i * 2.3 + j * 1.9) * 9 * k; /* @tier-b pixels only */
      softGlow(pen, p.x + ox, p.y + j * 2 * k, 15 * k, 7 * k, dark, alpha * fade * 0.24);
    }
  }
}

/**
 * Sea mist lying along the channel at first light, and only there.
 *
 * It is the one thing in this exhibit that exists to make a *specific minute* worth waiting for.
 * A cycle in which every hour is equally interesting has no hours in it, and the eight seconds
 * either side of dawn are when the coast looks least like the other eighty.
 */
function mist(pen: Pen, island: Island, phase: number): void {
  // A narrow window centred on first light, and it wraps: `phase` is 0 there, so the window is
  // the two ends of the cycle rather than a range in the middle of it.
  const near = Math.min(phase, 1 - phase);
  const alpha = clamp01(1 - near * 11);
  if (alpha <= 0.01) return;
  const s = pen.surface;
  const pale = mix(pen.palette.get('sky'), 0xffffffff, 0.55);
  for (let i = 0; i < MIST; i++) {
    const u = (toUnit(hash2(island.seed ^ 0x3d, i, 1)) * 2 - 1) * SPREAD + noise2(island.seed, i, pen.t * 0.09) * 4;
    const v = MAIN_V - 5 + toUnit(hash2(island.seed ^ 0x3d, i, 2)) * 14 + noise2(island.seed, i * 3.3, pen.t * 0.08) * 3;
    const p = screen(pen, u, v, 14 + noise2(island.seed, i * 7, pen.t * 0.11) * 10);
    if (p.x < -220 || p.x > s.width + 220) continue;
    const k = pen.camera.zoom * (1 + toUnit(hash2(island.seed ^ 0x3d, i, 3)));
    softGlow(pen, p.x, p.y, 130 * k, 30 * k, pale, alpha * 0.16);
  }
}

/**
 * Everything alive that pays nothing, and the wash over all of it, in one call from the Overlay
 * pass — which is *above* the light composite, so a gull at midnight is a silhouette against the
 * sky rather than a shape the night mask has already darkened.
 *
 * The golden-hour wash rides along here rather than being a second call in `main.ts`, because a
 * frame-wide tint is as inert as a bird is: it changes what the exhibit looks like and nothing
 * else. `sky.ts` decides *whether* there is one; this decides where in the order it lands.
 */
export function drawAmbient(pen: Pen, island: Island, daylight: number, phase: number): void {
  mist(pen, island, phase);
  shoals(pen, island, daylight);
  motes(pen, island, daylight);
  gulls(pen, island, daylight);
  const tint = skyWash(pen, phase);
  if (tint !== null) wash(pen, tint);
}
