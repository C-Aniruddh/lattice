/**
 * Chime Path — hang chimes along a mountain trail, tune each one, and let the wind play them
 * in order as the walkers climb past.
 */
import { clamp, clamp01, createRng, createScope, fbm2, hash2, toUnit } from '@latticekit/core';
import {
  DepthSorter,
  createCamera,
  heightAt,
  pathProject,
  pathSample,
  pickSorted,
  boxSilhouette,
  pointInPolygon,
  screenToTileOnHeights,
  HALF_H,
  HALF_W,
  TILE_H,
  gridToWorldX,
  gridToWorldY,
  rectFromSize,
} from '@latticekit/iso';
import type { GridPoint, Rect, Tile, Volume } from '@latticekit/iso';
import {
  BASE_SLOTS,
  DUSK,
  NIGHT,
  beginFrame,
  createCanvas2dSurface,
  createLightField,
  createPalette,
  endFrame,
  extendStops,
  glowDot,
  isoTerrain,
  mix,
  renderFrame,
  spriteHeightPx,
  spriteVolume,
  VARIANT_ZERO,
  drawSprite,
  withAlpha,
} from '@latticekit/draw';
import type { Passes, Variant } from '@latticekit/draw';
import { browserFrames, createLoop } from '@latticekit/loop';
import { createInput } from '@latticekit/input';
import { createAudio, createBed, validateSounds } from '@latticekit/audio';
import { installFlushTriggers, scheduleFrom } from '@latticekit/persist';
import type { Autosave } from '@latticekit/persist';

import {
  SUMMIT,
  STEP_PX,
  MAX_HEIGHT_PX,
  SEED,
  TREELINE,
  W,
  fenceRect,
  heights,
  isTrail,
  land,
  trail,
  trees,
} from './land.js';
import { CHIME, PINE, WALKER } from './sprites.js';
import { NOTE_IDS, PITCHES, SOUNDS } from './notes.js';
import { openSave } from './save.js';
import type { SaveV1 } from './save.js';
import { createHud } from './hud.js';
import type { HudModel } from './hud.js';

// ── the screen ────────────────────────────────────────────────────────────────────────
const host = document.getElementById('app') ?? document.body;
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%';
host.append(canvas);

const scope = createScope();
const surface = createCanvas2dSurface(canvas);

// ── the palette. Three stop sets, all defining exactly the same slots ─────────────────
const EXTRA_DAY = { rock: 0x7f7a70ff, snow: 0xa4b4c8ff, timber: 0x6b4f3aff, pine: 0x2f6b4aff, pineDark: 0x1f4d38ff, chime: 0xd8c48aff, cloak: 0xb85c3cff, skin: 0xe8c9a0ff, trail: 0xa08a63ff, haze: 0xcfdcedff };
const EXTRA_DUSK = { rock: 0x6b5d5cff, snow: 0x968b98ff, timber: 0x4e392cff, pine: 0x27503dff, pineDark: 0x1a3b2eff, chime: 0xd8ab6aff, cloak: 0xa04a34ff, skin: 0xd0a279ff, trail: 0x9c7f5e ^ 0xff, haze: 0xbb9c8aff };
const EXTRA_NIGHT = { rock: 0x333850ff, snow: 0x59668cff, timber: 0x2a2334ff, pine: 0x18314aff, pineDark: 0x11223aff, chime: 0x9aa6c8ff, cloak: 0x5c3444ff, skin: 0x7d7590ff, trail: 0x4a4658ff, haze: 0x242c48ff };

const DAY_X = extendStops(BASE_SLOTS, EXTRA_DAY);
const DUSK_X = extendStops(DUSK, { ...EXTRA_DUSK, trail: 0x8a6f52ff });
const NIGHT_X = extendStops(NIGHT, EXTRA_NIGHT);

const palette = createPalette(DUSK_X);

// ── the camera, framed on a stretch of the trail rather than the whole map ────────────
const camera = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
  bounds: fenceRect,
  minZoom: 0.3,
  maxZoom: 2.2,
  keepVisible: 0.55,
});

const openingAt: GridPoint = { gx: 0, gy: 0 };
const openingRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Frame the opening shot: a stretch of trail in the middle and the summit above it.
 *
 * `fitBounds` is the only framing call the camera has, and its margin is in CSS pixels, so a
 * specific zoom is expressed as a rectangle of the viewport's own aspect at that scale. The two
 * points it spans are *painted* positions — grid y minus the ground's own lift — because a
 * summit 960 px proud is nowhere near the world point its tile address projects to.
 */
const OPENING_ZOOM = 0.6;
function frameOpening(): void {
  pathSample(trail, trail.arcLength * 0.46, openingAt);
  const trailX = gridToWorldX(openingAt.gx, openingAt.gy);
  const trailY = gridToWorldY(openingAt.gx, openingAt.gy) - heightAt(land, openingAt.gx, openingAt.gy);
  const peakX = gridToWorldX(SUMMIT.gx, SUMMIT.gy);
  const peakY = gridToWorldY(SUMMIT.gx, SUMMIT.gy) - heightAt(land, SUMMIT.gx, SUMMIT.gy);
  const cx = (trailX + peakX) / 2;
  const cy = (trailY + peakY) / 2;
  const w = camera.viewW / OPENING_ZOOM;
  const h = camera.viewH / OPENING_ZOOM;
  rectFromSize(openingRect, cx - w / 2, cy - h / 2, w, h);
  camera.fitBounds(openingRect, 0);
}

// ── the night ────────────────────────────────────────────────────────────────────────
const light = createLightField(surface, { scale: 0.55, falloff: 1, bloom: 0.4 });

const order = new DepthSorter(Math.max(4096, trees.length + 512));

// ── the clock, BEFORE the input, because the input needs it ──────────────────────────
const loop = createLoop({
  clock: { now: () => performance.now() },
  frames: browserFrames(),
});

const input = createInput({
  element: canvas,
  camera,
  step: loop,
  actions: { touch: ['tap'], nudge: ['key:Space'] },
});

// ── sound ────────────────────────────────────────────────────────────────────────────
const audio = createAudio({ sounds: SOUNDS });
for (const problem of validateSounds(SOUNDS)) console.warn('sound:', problem.message);
// The whole game's worst case is several tubes at once over a wind bed; set the master by
// arithmetic rather than by the meter, because WebAudio hard-clips instantaneously.
audio.mixer.setGain('master', 0.62);

const bed = createBed(
  audio,
  [
    { wave: 'noise', hz: 0, gain: 0.1, cutoff: 300, cutoffAtFull: 4.5 },
    { wave: 'noise', hz: 0, gain: 0.055, cutoff: 900, cutoffAtFull: 2.6, band: [0.4, 1] },
    { wave: 'sine', hz: 62, gain: 0.075, cutoff: 260, cutoffAtFull: 1.6, band: [0, 0.6] },
  ],
  { sagTo: 0.82 },
);

let unlocked = false;
function unlockAudio(): void {
  if (unlocked) return;
  unlocked = audio.unlock();
}
canvas.addEventListener('pointerdown', unlockAudio);
scope.add(() => canvas.removeEventListener('pointerdown', unlockAudio));

// ── the game ─────────────────────────────────────────────────────────────────────────
interface Chime {
  /** Arc length along the trail. The trail is what puts them in order. */
  s: number;
  gx: number;
  gy: number;
  zPx: number;
  pitch: number;
  seed: number;
  /** 0–1, decaying. How hard it is ringing right now. */
  ring: number;
}

const chimes: Chime[] = [];
let chimeVersion = 0;

const WALKERS = 38;
const walkerS = new Float64Array(WALKERS);
const walkerPrev = new Float64Array(WALKERS);
const walkerSpeed = new Float64Array(WALKERS);
const walkerSeed = new Int32Array(WALKERS);
const walkerKind = new Int32Array(WALKERS);
{
  const rng = createRng(SEED ^ 0x77aa);
  for (let i = 0; i < WALKERS; i++) {
    walkerS[i] = (i / WALKERS) * trail.arcLength;
    walkerPrev[i] = walkerS[i] ?? 0;
    walkerSpeed[i] = 26 + rng.next() * 16;
    walkerSeed[i] = (rng.next() * 0x7fffffff) | 0;
    walkerKind[i] = rng.next() > 0.6 ? 1 : 0;
  }
}

const GUSTS = 4;
const gustS = new Float64Array(GUSTS);
const gustPrev = new Float64Array(GUSTS);
const gustSpeed = new Float64Array(GUSTS);
const gustPower = new Float64Array(GUSTS);
const gustLive = new Uint8Array(GUSTS);
const gustRng = createRng(SEED ^ 0x1234);
let nextGustIn = 1.2;

function spawnGust(): void {
  for (let i = 0; i < GUSTS; i++) {
    if (gustLive[i] === 1) continue;
    gustLive[i] = 1;
    gustS[i] = -160;
    gustPrev[i] = -160;
    gustSpeed[i] = 420 + gustRng.next() * 520;
    gustPower[i] = 0.35 + gustRng.next() * 0.65;
    return;
  }
}
spawnGust();

/** Strongest gust on the mountain right now, for the readout and the bed. */
let windNow = 0;
let hint = 'Tap the trail to hang a chime';

/**
 * Put a chime on the trail at arc length `s`.
 *
 * Everything except `s` and the pitch is derived here rather than stored, which is why a save is
 * two numbers per chime: the tile it stands on, the side of the path it hangs off and its art
 * seed are all pure functions of the trail and the world seed.
 */
function hang(s: number, pitch: number): void {
  pathSample(trail, s, sampled);
  // A little off the path itself, so walkers pass beside the post rather than through it.
  const side = toUnit(hash2(SEED ^ 0x5a, Math.floor(sampled.gx), Math.floor(sampled.gy))) > 0.5 ? 1 : -1;
  const gx = clamp(Math.floor(sampled.gx) + side, 1, W - 2);
  const gy = clamp(Math.floor(sampled.gy), 1, W - 2);
  chimes.push({
    s,
    gx,
    gy,
    zPx: heightAt(land, gx + 0.5, gy + 0.5),
    pitch,
    seed: (hash2(SEED ^ 0x9c, gx, gy) >>> 0) % 100000,
    ring: 0,
  });
  chimes.sort((a, b) => a.s - b.s);
  chimeVersion++;
}

function ringChime(c: Chime, power: number): void {
  c.ring = Math.min(1, c.ring + power);
  const id = NOTE_IDS[c.pitch];
  if (id !== undefined) {
    // Screen-x → pan is four lines in the game, because audio does not know the camera exists.
    const pan = clamp(camera.normalizedX(gridToWorldXOf(c.gx, c.gy)) * 2 - 1, -1, 1);
    audio.play(id, { gain: 0.35 + power * 0.75, pan: pan * 0.7 });
  }
}

function gridToWorldXOf(gx: number, gy: number): number {
  return (gx - gy) * 32;
}

// ── placing and tuning ───────────────────────────────────────────────────────────────
const hitTile: Tile = { gx: 0, gy: 0 };
const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const outline = new Float64Array(12);
const sampled: GridPoint = { gx: 0, gy: 0 };

/** Variant is readonly by design — a sprite may not be handed a channel it could mutate mid-draw.
 *  These are the game's own scratch copies, written just before each `drawSprite`. */
type MutVariant = { -readonly [K in keyof Variant]: Variant[K] };
const chimeVariant: MutVariant = { ...VARIANT_ZERO, level: 0, seed: 1, progress: 0 };
const measureVariant: MutVariant = { ...VARIANT_ZERO, level: 0, seed: 1, progress: 0 };

/** The frame's draw list, in the sorter's own index space. */
const KIND_TREE = 0;
const KIND_CHIME = 1;
const KIND_WALKER = 2;
const FRAME_CAP = trees.length + 512;
const frameKind = new Int32Array(FRAME_CAP);
const frameRef = new Int32Array(FRAME_CAP);

let pickPx = 0;
let pickPy = 0;
function hitsChime(index: number): boolean {
  if (frameKind[index] !== KIND_CHIME) return false;
  const c = chimes[frameRef[index] ?? -1];
  if (c === undefined) return false;
  spriteVolume(CHIME, variantFor(c), vol, c.zPx);
  boxSilhouette(camera, Math.floor(c.gx), Math.floor(c.gy), vol, outline);
  return pointInPolygon(pickPx, pickPy, outline, 6);
}

function variantFor(c: Chime): Variant {
  measureVariant.level = c.pitch;
  measureVariant.seed = c.seed;
  measureVariant.progress = c.ring;
  return measureVariant;
}

input.onAction('touch', (a) => {
  unlockAudio();

  // Tune before placing: a tap that lands on a chime is never a request for a second one.
  pickPx = a.sx;
  pickPy = a.sy;
  const at = pickSorted(order, hitsChime);
  if (at >= 0) {
    const c = chimes[frameRef[at] ?? -1];
    if (c !== undefined) {
      c.pitch = (c.pitch + 1) % PITCHES;
      chimeVersion++;
      ringChime(c, 0.85);
      hint = 'Tap it again to keep tuning';
      return;
    }
  }

  // `a.gx`/`a.gy` are a flat-ground answer, and this mountain is 264 px tall. Re-pick from
  // sx/sy against the field, or every tap lands several terraces up the slope from the finger.
  if (!screenToTileOnHeights(camera, a.sx, a.sy, land, MAX_HEIGHT_PX, hitTile)) {
    audio.play('deny');
    hint = 'That is off the mountain';
    return;
  }

  const s = pathProject(trail, hitTile.gx + 0.5, hitTile.gy + 0.5);
  pathSample(trail, s, sampled);
  const away = Math.hypot(sampled.gx - hitTile.gx - 0.5, sampled.gy - hitTile.gy - 0.5);
  if (away > 3.5) {
    audio.play('deny');
    hint = 'Chimes hang along the trail — tap closer to it';
    return;
  }
  // A tap that lands near a chime but misses its post is still a tap on that chime. Refusing it
  // would mean the only way to tune one is to hit a mast a few pixels wide.
  const near = chimes.find((c) => Math.abs(c.s - s) < 30);
  if (near !== undefined) {
    near.pitch = (near.pitch + 1) % PITCHES;
    chimeVersion++;
    ringChime(near, 0.85);
    hint = 'Tap it again to keep tuning';
    return;
  }

  const pitch = chimes.length === 0 ? 0 : ((chimes[chimes.length - 1]?.pitch ?? 0) + 2) % PITCHES;
  hang(s, pitch);
  audio.play('hang');
  hint = 'Tap a chime to tune it';
});

input.onAction('nudge', () => {
  unlockAudio();
  spawnGust();
});

// ── what the mountain keeps ──────────────────────────────────────────────────────────
const save = openSave();
for (const c of save.opened.state.chimes) hang(c.s, c.pitch % PITCHES);

function currentSave(): SaveV1 {
  return { version: 1, chimes: chimes.map((c) => ({ s: c.s, pitch: c.pitch })) };
}

/** `scheduleFrom(loop.real)`, never `loop.real.after`: the loop schedules in seconds and this
 *  package wants milliseconds, and `real` rather than `sim` because the moment before a tab is
 *  closed is exactly the moment `requestAnimationFrame` has already stopped. */
function beginAutosave(): { auto: Autosave; stop: () => void } {
  const auto = save.store.autosave(currentSave, { schedule: scheduleFrom(loop.real) });
  // `beforeunload` does not fire reliably on mobile Safari, so this binds `visibilitychange`
  // and `pagehide` instead. Its disposer deliberately does not flush.
  const unbind = installFlushTriggers(auto, { visibility: document, page: window });
  return {
    auto,
    stop: () => {
      unbind();
      auto.stop();
    },
  };
}

let autosave = beginAutosave();
scope.add(() => autosave.stop());

/**
 * Take every chime down.
 *
 * `reset()` closes the store to writes before it removes the key — a plain `removeItem` and a
 * reload does not reset a game, because the live autosave flushes on `pagehide` and writes the
 * old state straight back over it. The consequence is that the store is *closed* afterwards, so
 * a path that is going to be hung again needs it opened again.
 */
function startOver(): void {
  autosave.stop();
  save.store.reset();
  chimes.length = 0;
  chimeVersion++;
  save.store.open();
  autosave = beginAutosave();
  hint = 'The path is bare again — tap the trail to hang a chime';
}

// ── one resize handler ───────────────────────────────────────────────────────────────
function fit(): void {
  const w = Math.max(1, innerWidth);
  const h = Math.max(1, innerHeight);
  surface.resize(w, h, surface.pixelRatio);
  camera.resize(w, h);
}
addEventListener('resize', fit);
visualViewport?.addEventListener('resize', fit);
scope.add(() => {
  removeEventListener('resize', fit);
  visualViewport?.removeEventListener('resize', fit);
});
fit();
frameOpening();

// ── update ───────────────────────────────────────────────────────────────────────────
/** 1 at noon, 0 at midnight. The one number that drives the palette, the night mask and the
 *  bed, so the world cannot look warm and sound cold. */
let daylight = 0.45;
let paletteT = -1;

loop.onUpdate((dt, tick) => {
  input.tick(tick);

  // A long evening: about four minutes from dusk to dark and back.
  daylight = 0.46 + 0.42 * Math.cos(loop.time * 0.026);

  // wind
  nextGustIn -= dt;
  if (nextGustIn <= 0) {
    spawnGust();
    nextGustIn = 1.4 + gustRng.next() * 3.4;
  }
  windNow = 0;
  for (let i = 0; i < GUSTS; i++) {
    if (gustLive[i] !== 1) continue;
    gustPrev[i] = gustS[i] ?? 0;
    gustS[i] = (gustS[i] ?? 0) + (gustSpeed[i] ?? 0) * dt;
    if ((gustS[i] ?? 0) > trail.arcLength + 200) {
      gustLive[i] = 0;
      continue;
    }
    const p = gustPower[i] ?? 0;
    if ((gustS[i] ?? 0) > 0 && (gustS[i] ?? 0) < trail.arcLength) windNow = Math.max(windNow, p);
    // A gust rings every chime it sweeps over, in the order they hang.
    for (const c of chimes) {
      if (c.s > (gustPrev[i] ?? 0) && c.s <= (gustS[i] ?? 0)) ringChime(c, p * 0.9);
    }
  }

  // walkers
  for (let i = 0; i < WALKERS; i++) {
    walkerPrev[i] = walkerS[i] ?? 0;
    let s = (walkerS[i] ?? 0) + (walkerSpeed[i] ?? 0) * dt;
    const wrapped = s >= trail.arcLength;
    if (wrapped) s -= trail.arcLength;
    walkerS[i] = s;
    if (wrapped) continue; // a lap boundary is not a crossing
    for (const c of chimes) {
      if (c.s > (walkerPrev[i] ?? 0) && c.s <= s) ringChime(c, 0.3);
    }
  }

  // ring energy decays
  let loudest = 0;
  for (const c of chimes) {
    c.ring *= Math.exp(-dt * 1.5);
    if (c.ring > loudest) loudest = c.ring;
  }

  // Quantized to a sixty-fourth. `Bed.set` ramps toward its target over about 15 ms, and an
  // approach re-anchored sixty times a second never arrives — so a continuously varying input
  // makes an ambience that permanently chases and never settles. The change filter inside the
  // bed only helps if the number it is filtering actually stops moving.
  const level = Math.round(clamp01(0.28 + windNow * 0.55 + loudest * 0.2) * 64) / 64;
  const tone = Math.round(clamp01(0.25 + daylight * 0.75) * 64) / 64;
  bed.set(level, tone);

  // The palette is the expensive part of dusk: `lerp` compares stop sets by identity and
  // quantizes `t`, so hoisted sets and a quantized push is what makes an evening affordable.
  const t = Math.round(clamp01(daylight) * 32) / 32;
  if (t !== paletteT) {
    paletteT = t;
    if (t >= 0.5) palette.lerp(DUSK_X, DAY_X, (t - 0.5) * 2);
    else palette.lerp(NIGHT_X, DUSK_X, t * 2);
  }
});

// ── render ───────────────────────────────────────────────────────────────────────────
const hazeXY = new Float64Array(8);
const worldView: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const backdropXY = new Float64Array(8);

/** Where the rock takes over from the turf, and where the snow takes over from the rock.
 *  Interpolated over sixteen quantized stops: hard bands on a noisy field make a mosaic of flat
 *  diamonds, because adjacent tiles land either side of a boundary. */
const SNOWLINE = 96;

function tileInk(gx: number, gy: number): number {
  const u = heights.get(gx, gy);
  const grass = palette.get('ground');
  const rock = palette.get('rock');
  const snow = palette.get('snow');
  const toRock = Math.round(clamp01((u - TREELINE * 0.5) / (TREELINE * 0.75)) * 16) / 16;
  const ground = mix(grass, rock, toRock);
  if (u < SNOWLINE - 14) return ground;
  const toSnow = Math.round(clamp01((u - (SNOWLINE - 14)) / 22) * 16) / 16;
  snowAmount = toSnow;
  return mix(ground, snow, toSnow);
}

/** Set by the last `tileInk` call. Snow is the palest thing on the mountain and `isoTerrain`
 *  adds up to +0.32 of relief on top of the tint, so without pulling the tint down its lit face
 *  clips to flat white — which is not a highlight, it is a hole in the image. */
let snowAmount = 0;

const passes: Passes = {
  maxHeightPx: MAX_HEIGHT_PX,
  backdrop(pen, visible) {
    void visible;
    const s = pen.surface;
    const xy = backdropXY;
    xy[0] = 0; xy[1] = 0;
    xy[2] = s.width; xy[3] = 0;
    xy[4] = s.width; xy[5] = s.height;
    xy[6] = 0; xy[7] = s.height;
    s.polyRamp(xy, 4, 0, 0, 0, s.height, pen.palette.get('sky'), pen.palette.get('haze'));
  },
  terrain(pen, visible) {
    // `maxHeightPx` margins the tile range by the map's TALLEST ground, because the range is
    // computed on the ground plane and a summit is painted its own height further up the screen.
    // That is correct and it is generous: at 960 px it is thirty extra rings, and on this map
    // almost all of them are low ground nowhere near the frame. So the range decides which tiles
    // to consider and this decides which are actually on screen — one comparison against the
    // tile's own highest corner, in place of a full `isoTerrain` for every tile the margin
    // over-included.
    const view = pen.camera.visibleWorldBounds(worldView, TILE_H);
    for (let gy = visible.gy0; gy < visible.gy1; gy++) {
      for (let gx = visible.gx0; gx < visible.gx1; gx++) {
        if (gx < 0 || gy < 0 || gx >= W || gy >= W) continue;
        // A box in tile space is a diamond on screen, so the range is generous by about 2× at
        // the corners. World x is `(gx − gy) · HALF_W` and elevation does not touch it, so this
        // one is exact.
        const wx = (gx - gy) * HALF_W;
        if (wx + HALF_W < view.minX || wx - HALF_W > view.maxX) continue;
        const h0 = heights.get(gx, gy);
        const hE = heights.get(gx + 1, gy);
        const hS = heights.get(gx + 1, gy + 1);
        const hW = heights.get(gx, gy + 1);
        const tallest = Math.max(h0, hE, hS, hW) * STEP_PX;
        const shortest = Math.min(h0, hE, hS, hW) * STEP_PX;
        // Highest point of the tile on screen, and lowest. Conservative in both directions.
        if ((gx + gy) * HALF_H - tallest > view.maxY) continue;
        if ((gx + gy + 2) * HALF_H - shortest < view.minY) continue;
        // The relief `isoTerrain` reads runs east–west. The other diagonal renders perfectly
        // flat unless the north–south term is supplied here, which is one subtraction and the
        // difference between a slope and a cliff.
        const ns = clamp((h0 - hS) * 0.042, -0.11, 0.11);
        // A gentle two-scale grain rather than per-tile hash noise: hash noise at this
        // amplitude reads as a quilt of flat diamonds rather than as ground.
        const grain = 0.975 + fbm2(SEED ^ 0x51, gx * 0.1, gy * 0.1, 2) * 0.035;
        const worn = isTrail(gx, gy);
        snowAmount = 0;
        const fill = worn ? palette.get('trail') : tileInk(gx, gy);
        // 0.74 rather than 1: `isoTerrain` adds up to ±0.32 of its own relief on top, and a pale
        // rock shaded at 1.5 clips to a hole in the image rather than to a highlight.
        isoTerrain(pen, land, gx, gy, fill, undefined, (0.74 + ns) * grain * (1 - snowAmount * 0.28));
      }
    }
  },
  solids(pen, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const index = sorted.indexAt(i);
      const ref = frameRef[index] ?? 0;
      switch (frameKind[index]) {
        case KIND_TREE: {
          const t = trees[ref];
          if (t === undefined) break;
          treeVariant.level = t.level;
          treeVariant.seed = t.seed;
          drawSprite(pen, PINE, t.gx, t.gy, treeVariant, t.zPx);
          break;
        }
        case KIND_CHIME: {
          const c = chimes[ref];
          if (c === undefined) break;
          chimeVariant.level = c.pitch;
          chimeVariant.seed = c.seed;
          chimeVariant.progress = c.ring;
          drawSprite(pen, CHIME, c.gx, c.gy, chimeVariant, c.zPx);
          break;
        }
        default: {
          const p = walkerPos[ref];
          if (p === undefined) break;
          walkerVariant.level = walkerKind[ref] ?? 0;
          walkerVariant.seed = walkerSeed[ref] ?? 0;
          drawSprite(pen, WALKER, p.gx - 0.5, p.gy - 0.5, walkerVariant, p.zPx);
        }
      }
    }
  },
  effects(pen) {
    // Distance haze, in screen space, so it reaches the trees as well as the ground — in this
    // projection screen height *is* distance. Real distance loses saturation before it loses
    // hue, so it converges on a pale haze rather than on `sky`, which at noon is a saturated
    // cyan and would trade one loud colour for another.
    const s = pen.surface;
    const strength = 0.1 + daylight * 0.24;
    hazeXY[0] = 0; hazeXY[1] = 0;
    hazeXY[2] = s.width; hazeXY[3] = 0;
    hazeXY[4] = s.width; hazeXY[5] = s.height * 0.62;
    hazeXY[6] = 0; hazeXY[7] = s.height * 0.62;
    const tint = pen.palette.get('haze');
    s.polyRamp(
      hazeXY,
      4,
      0,
      0,
      0,
      s.height * 0.62,
      withAlpha(tint, strength),
      withAlpha(tint, 0),
    );
  },
  placement(pen) {
    // The gust itself: a breath of light travelling the trail, so something is moving before
    // the player has touched anything.
    for (let i = 0; i < GUSTS; i++) {
      if (gustLive[i] !== 1) continue;
      const head = gustS[i] ?? 0;
      const power = gustPower[i] ?? 0;
      for (let k = 0; k < 9; k++) {
        const s = head - k * 34;
        if (s < 0 || s > trail.arcLength) continue;
        pathSample(trail, s, sampled);
        const z = heightAt(land, sampled.gx, sampled.gy);
        const fade = (1 - k / 9) * power;
        glowDot(pen, sampled.gx, sampled.gy, 0.35, 'glass', 0.55 * fade + 0.12, fade * 0.5);
        pen.light?.add(sampled.gx, sampled.gy, z, 1.6 + fade * 2.2, fade * 0.32, 'glass');
      }
    }
  },
};

const treeVariant: MutVariant = { ...VARIANT_ZERO, level: 1, seed: 1 };
const walkerVariant: MutVariant = { ...VARIANT_ZERO, level: 0, seed: 1 };

interface WalkerPos {
  gx: number;
  gy: number;
  zPx: number;
}
const walkerPos: WalkerPos[] = [];
for (let i = 0; i < WALKERS; i++) walkerPos.push({ gx: 0, gy: 0, zPx: 0 });

const treeHeights = trees.map((t) => spriteHeightPx(PINE, { ...VARIANT_ZERO, level: t.level, seed: t.seed }));

loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);

  // Walker positions are read at display rate so they glide; the crossings that ring a chime
  // were already decided on update, where they cannot be dropped by a slow frame.
  for (let i = 0; i < WALKERS; i++) {
    const p = walkerPos[i];
    if (p === undefined) continue;
    pathSample(trail, walkerS[i] ?? 0, sampled);
    p.gx = sampled.gx;
    p.gy = sampled.gy;
    p.zPx = heightAt(land, sampled.gx, sampled.gy);
  }

  const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky', light });
    // 0.62 rather than 1: the night palette is already dark, and a full mask on top of it is a
  // correct, working, entirely black picture — the mountain stops existing and only the chimes
  // are left. At 0.62 the ridge still reads and the lanterns still carry the frame.
  light.begin(pen, clamp01(1 - daylight) * 0.62, 'night');

  order.clear();
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (t === undefined) continue;
    const at = order.add(t.gx, t.gy, 1, 1, t.zPx + (treeHeights[i] ?? 60));
    frameKind[at] = KIND_TREE;
    frameRef[at] = i;
  }
  for (let i = 0; i < chimes.length; i++) {
    const c = chimes[i];
    if (c === undefined) continue;
    const at = order.add(c.gx, c.gy, 1, 1, c.zPx + spriteHeightPx(CHIME, variantFor(c)));
    frameKind[at] = KIND_CHIME;
    frameRef[at] = i;
  }
  for (let i = 0; i < WALKERS; i++) {
    const p = walkerPos[i];
    if (p === undefined) continue;
    const at = order.add(p.gx - 0.5, p.gy - 0.5, 1, 1, p.zPx + 30);
    frameKind[at] = KIND_WALKER;
    frameRef[at] = i;
  }

  renderFrame(pen, passes, order);
  endFrame(pen);
});

// ── the readout ──────────────────────────────────────────────────────────────────────
const phrase: number[] = [];
const lit: number[] = [];
const model: HudModel = {
  get count() {
    return chimes.length;
  },
  get gust() {
    return windNow;
  },
  get phrase() {
    phrase.length = 0;
    for (const c of chimes) phrase.push(c.pitch);
    return phrase;
  },
  get lit() {
    lit.length = 0;
    for (const c of chimes) lit.push(c.ring);
    return lit;
  },
  get version() {
    return chimeVersion;
  },
  get hint() {
    return hint;
  },
  get storage() {
    return save.store.status;
  },
};

const hud = createHud(loop, palette, () => model, startOver);

// ── teardown ─────────────────────────────────────────────────────────────────────────
function dispose(): void {
  loop.stop();
  input.dispose();
  hud.destroy();
  bed.stop(0);
  audio.dispose();
  light.dispose();
  scope.dispose();
  canvas.remove();
}
if (import.meta.hot) import.meta.hot.dispose(dispose);

if (import.meta.env.DEV) {
  // A handle for the dev console and for the screenshot harness — frame stats, and a way to run
  // the evening forward without waiting four minutes for it.
  Object.assign(window as unknown as Record<string, unknown>, {
    chimePath: { loop, order, chimes, light, audio, save },
  });
}

loop.start();

