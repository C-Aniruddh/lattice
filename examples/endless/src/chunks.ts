/**
 * The chunk: what a coordinate is worth, the window that decides which chunks exist, and the
 * eviction that keeps an endless world from being a leak with a nice story.
 *
 * This file is the exhibit. Everything else draws what it decides.
 *
 * ## Position-deterministic, not sequence-deterministic
 *
 * A chunk's content is a pure function of `(seed, chunkX, chunkY)` and of nothing else — not of
 * the order chunks were reached, not of how many were minted first, not of which ones are
 * resident. That is the difference between an endless world and a world that merely goes on:
 * draw the same terrain from a single sequential `Rng` and the field depends on the path the
 * player walked to reach it, so the landmark you came back to is a *different* landmark.
 * **`boot.rng` is used for nothing in this exhibit.** Its seed is, and that is all: `hashString`
 * once, then `noise2` / `fbm2` / `hash2`, each of which `core` documents as a pure function of its
 * arguments with no cursor, no setup call and no permutation table.
 *
 * **No Tier B arithmetic reaches a chunk's identity.** `+ - * /`, `abs`, `min`, `max`, `floor`,
 * `round` and the bitwise operators are the whole of what runs below, and `core`'s noise is Tier A
 * by its own header — there is no `sin`, `pow` or `exp` anywhere on this path. Those live in
 * `terrain.ts` and `things.ts`, which draw and decide nothing. So "the same tomorrow" also means
 * the same on another engine, and {@link fingerprint} is what makes that checkable rather than
 * asserted.
 *
 * ## One array per chunk, and the row that is deliberately not stored
 *
 * A chunk is `16 × 16` `Uint16`s — biased elevation in the low byte, biome ordinal above it — and
 * nothing else. **It stores no border row.** The corner `isoTerrain` needs at `(gx + 1, gy + 1)`
 * along a chunk's far edge is read out of the *next* chunk, and the two agree exactly because
 * both are the same pure function of the same coordinate. That is what lets a chunk be minted
 * with no reference to its neighbors, and it is why an absent neighbor shows as a visible seam
 * rather than as a silently wrong height.
 *
 * **Nor does it store what is standing on it.** Which tile grows a tree is one `hash2` and one
 * `noise2` — cheap enough to roll while drawing, and rolling it there keeps a scatter out of the
 * thing being measured for memory. What is expensive is the elevation: three octave-stacked
 * fields per vertex, which is exactly what a chunk exists to pay for once.
 *
 * ## Module state, deliberately, and only here
 *
 * There is one world. Threading a `Store` handle through nine functions to say so costs about
 * twenty lines of a two-hundred-line budget to express a fact that is not true of anything except
 * this file. `core`'s rule against module-level mutable state is a rule for *packages* — a library
 * with a singleton in it cannot be used twice — and an exhibit is not one.
 *
 * ## The bounds of "endless"
 *
 * `core.noise` promises bit-identical results while coordinates stay under about 2^24; past that
 * the fractional part loses resolution and the field visibly flattens. So this world is endless to
 * ±16.7 million tiles and honest about it — some 200,000 screens at the opening zoom.
 * {@link keyOf} packs an address into one double and is the tighter limit, at ±33 million tiles.
 */
import { fbm2, hashBytes, hashString, noise2 } from '@latticekit/core';
import { HALF_H, HALF_W, TILE_H, type Camera, type HeightField } from '@latticekit/iso';

/** Tiles on a side of a chunk. A power of two, so `gx >> 4` is the floor division — exact for
 *  negative coordinates, where `/ 16 | 0` truncates toward zero and folds the two chunks either
 *  side of the origin into one. */
export const CHUNK = 16;
/** World pixels per height unit: a fifth of a tile's depth. Fine enough that a beach is a ramp,
 *  coarse enough that a 46-unit ridge is a mountain. */
export const STEP_PX = TILE_H / 5;
/** Stored elevation is unsigned and a seabed is not, so every low byte carries this bias. */
export const BIAS = 48;
/** The tallest ground the generator can make, in world pixels — `renderFrame`'s terrain cull
 *  margin, and the reason a ridge does not vanish when its base leaves the bottom of the frame. */
export const MAX_HEIGHT_PX = 60 * STEP_PX;
/** The memory ceiling, in chunks. At `CHUNK² × 2` bytes each that is a flat 128 KiB of world,
 *  and it is a figure a visitor can check against the HUD by multiplying two numbers. Roughly
 *  1.6× the widest visible set at `minZoom`, so eviction always works behind the viewport. */
export const MAX_CHUNKS = 256;

/** One minted block: one typed array and a frame stamp. No object per tile anywhere. */
export interface Chunk {
  /** `16 × 16` row-major: biased elevation in bits 0–7, biome ordinal in bits 8–9. */
  readonly h: Uint16Array;
  /** The last frame this chunk was wanted. The eviction key. */
  tick: number;
}

/** What is resident. Keyed by {@link keyOf}; iteration order is insertion order, which is the
 *  order {@link sweep} evicts along. */
export const chunks = new Map<number, Chunk>();
/** The world, from `?seed=`. Set by {@link open} before the first frame. */
export let seed = 0;
/** Chunks generated this session, and chunks thrown away. **The two counters diverging is the
 *  only visible proof that anything is being freed at all**, which is why both are in the HUD. */
export let minted = 0;
/** See {@link minted}. */
export let evicted = 0;
/** The frame counter the eviction stamp is measured in. */
export let tick = 0;

/**
 * The camera's window on the world, as live module bindings.
 *
 * Screen x depends on `gx − gy` alone and screen y on `gx + gy` alone, so a *screen* rectangle is
 * exactly a pair of intervals in those two sums. That makes the cull below exact rather than
 * conservative, and it makes the horizon a straight line. Streaming and drawing read the same four
 * numbers, because "which chunks exist" and "which tiles are painted" are one question asked twice.
 *
 * **The cull is the exhibit rather than an optimization on it.** An edgeless world is exactly the
 * case where "only what the camera can see" stops being a nicety and becomes the thing that makes
 * the frame finite at all.
 */
/** Nearest `gx + gy` drawn: the bottom of the frame, plus room for ground tall enough to stand up
 *  into it from below. */
export let dNear = 0;
/** Farthest `gx + gy` drawn — **the horizon**, and the whole answer to the fact that a dimetric
 *  projection has none. An unbounded ground plane covers every pixel at every zoom, so an endless
 *  world that paints all of it has no sky and no distance. Cutting the plane at a fixed fraction of
 *  the visible depth puts a straight edge across the frame for the haze to arrive at, and a ridge
 *  tall enough still breaks it. */
export let dFar = 0;
/** `gx − gy` at the left edge of the frame, and at the right. */
export let sMin = 0;
/** See {@link sMin}. */
export let sMax = 0;

/** Read the window off the camera and open a new frame. Once per frame, allocating nothing. */
export function look(camera: Camera): void {
  const dHalf = camera.viewH / (2 * camera.zoom * HALF_H);
  const sHalf = camera.viewW / (2 * camera.zoom * HALF_W);
  dNear = camera.y / HALF_H + dHalf + MAX_HEIGHT_PX / HALF_H;
  dFar = camera.y / HALF_H - dHalf * 0.86;
  sMin = camera.x / HALF_W - sHalf - 2;
  sMax = camera.x / HALF_W + sHalf + 2;
  tick += 1;
}

/** Does this chunk reach the window, with a two-chunk prefetch ring so that a chunk is resident
 *  before it is ever visible — further ahead than the fastest fling crosses in the handful of
 *  frames the mint budget takes to answer? */
export function wanted(cx: number, cy: number): boolean {
  const d = (cx + cy) * CHUNK;
  const s = (cx - cy) * CHUNK;
  return d + 66 >= dFar && d - 34 <= dNear && s + 50 >= sMin && s - 50 <= sMax;
}

/** Pack a chunk address into one key. A string would allocate per lookup on the hot path, and
 *  `(cx << 16) | cy` silently wraps a world at 32,768 chunks. Exact in a double to ±2^21. */
export const keyOf = (cx: number, cy: number): number => cx * 4194304 + cy;

/**
 * Signed elevation at a grid **vertex**, in height units. Negative is below the waterline.
 *
 * Three fields, and the count is the whole reason this reads as geography rather than as noise.
 * `shelf` is slow enough that a coast takes a couple of hundred tiles to arrive and to leave — the
 * one field a visitor experiences as *travel*. `ridge` is the inverted absolute value of a noise
 * field, which folds it at zero and turns smooth hills into a spine; without it every landmass is
 * the same dome. The third is the grain that keeps a slope from being a plane. The ramp out of the
 * water is squared, because a linear one puts the first tree ashore on a cliff.
 */
function elevationAt(x: number, y: number): number {
  // `+0.16` is the sea level, and it is the single number § Scale's *fill* row turns on: at 0 the
  // world is half ocean and three quarters of the opening frame is flat blue, which is the "empty
  // background" that row forbids. Here it is about a quarter water — enough that a coastline is a
  // real event on a long pan, little enough that the frame is always mostly world.
  const shelf = (fbm2(seed, x * 0.0055, y * 0.0055, 4, 0.55) + 0.16) * 68;
  if (shelf <= 0) return Math.max(-30, shelf * 1.15);
  const ridge = 1 - Math.abs(noise2(seed ^ 0x5b1, x * 0.019, y * 0.019));
  const ramp = Math.min(1, shelf / 8);
  // The relief is multiplied by `ramp` and not by `ramp²`: squaring both terms was the first
  // draft, and it flattened every hill within thirty tiles of a coast — which, on a world whose
  // coastlines are two hundred tiles apart, is most of the land there is. The squared term is kept
  // for the beach alone, which is the one place a gentle start is what the eye wants.
  return ramp * ramp * 2.5 + ramp * (shelf * 0.2 + ridge * ridge * ridge * 28 + fbm2(seed ^ 0x2f7, x * 0.05, y * 0.05, 4, 0.5) * 9);
}

/** Biome ordinal at a tile: two very slow fields crossed. Slower than the coastline, so a visitor
 *  crosses a shoreline several times inside one climate and the two changes never coincide.
 *  0 taiga, 1 temperate, 2 arid, 3 jungle — the order `terrain.ts` and `things.ts` index by. */
function biomeAt(gx: number, gy: number): number {
  const warmth = fbm2(seed ^ 0x77c, gx * 0.0032, gy * 0.0032, 3, 0.5);
  if (warmth < -0.16) return 0;
  if (warmth < 0.22) return 1;
  return fbm2(seed ^ 0xa31, gx * 0.0071, gy * 0.0071, 3, 0.5) < 0 ? 2 : 3;
}

/** Mint one chunk — the only place the generator runs over a whole block, and therefore the only
 *  thing in this exhibit that can cost a frame. `main.ts` budgets how many a frame may pay for. */
export function mint(cx: number, cy: number): void {
  const h = new Uint16Array(CHUNK * CHUNK);
  for (let j = 0; j < CHUNK; j++) {
    for (let i = 0; i < CHUNK; i++) {
      const e = Math.round(elevationAt(cx * CHUNK + i, cy * CHUNK + j));
      h[j * CHUNK + i] = Math.max(0, Math.min(255, e + BIAS)) | (biomeAt(cx * CHUNK + i, cy * CHUNK + j) << 8);
    }
  }
  chunks.set(keyOf(cx, cy), { h, tick });
  memoKey = NaN;
  minted += 1;
}

/**
 * A chunk's identity as one uint32, over the exact bytes that are kept.
 *
 * This is what makes the exhibit's claim performable rather than asserted: pin a chunk, travel
 * until the HUD says it has been evicted, come back, and compare. `hashBytes` is `core`'s and is
 * Tier A, so two engines that disagree about `Math.pow` still agree about this.
 */
export const fingerprint = (chunk: Chunk): number => hashBytes(1, chunk.h);

/**
 * A tile's packed word — elevation in the low byte, biome above it. An absent chunk answers the
 * waterline, which is a seam you can see rather than a wrong number you cannot.
 *
 * **The one-entry memo in front of `Map.get` is not a micro-optimization**; it was worth 4 ms of a
 * 16 ms budget when it was missing. This is the innermost call in the exhibit: the terrain pass
 * reads four corners per tile and `isoTerrain` reads the same four again, so a frame asks it about
 * twenty-three thousand times — and because both walks go in scan order, fifteen of every sixteen
 * questions are about the chunk the last one was. Invalidated by every path that changes what is
 * resident, which is {@link mint} and {@link sweep} and nothing else.
 */
let memoKey = NaN;
let memoChunk: Chunk | undefined;

export function cell(gx: number, gy: number): number {
  const key = keyOf(gx >> 4, gy >> 4);
  if (key !== memoKey) {
    memoKey = key;
    memoChunk = chunks.get(key);
  }
  return memoChunk === undefined ? BIAS | 256 : (memoChunk.h[(gy & 15) * CHUNK + (gx & 15)] ?? BIAS);
}

/**
 * Evict down to the ceiling, oldest-resident first, and **never a chunk wanted this frame**.
 *
 * The live guard is what makes the ceiling a ceiling rather than a thrash: without it a store
 * under pressure evicts what it is about to draw, re-mints it next frame, and burns the whole
 * budget doing so. If the visible set ever grew past {@link MAX_CHUNKS} — it cannot at the zoom
 * limits this exhibit ships, but a URL can move those — this returns with the store over budget
 * and the HUD shows a live count above the ceiling. That is the loud symptom.
 *
 * One pass in `Map` insertion order rather than a strict least-recently-used scan, because the two
 * agree here to within a frame: everything resident and off-screen was inserted before everything
 * resident and on-screen. A heap would be a second structure to keep in step, for a cost that
 * never appears in the tail.
 */
export function sweep(): void {
  if (chunks.size <= MAX_CHUNKS) return;
  for (const [key, chunk] of chunks) {
    if (chunk.tick === tick) continue;
    chunks.delete(key);
    memoKey = NaN;
    evicted += 1;
    if (chunks.size <= MAX_CHUNKS) return;
  }
}

/**
 * Elevation as `iso` and `draw` read it back.
 *
 * `HeightField.heights` is a `TileSource`, which is two methods — so a streamed world enters the
 * kit through the same seam a bounded island does, and `isoTerrain`, `heightAt`, `slopeAt` and
 * `footprintBase` cannot tell the difference. These four lines are the entire integration, and
 * they are the best thing the kit did for this exhibit.
 *
 * The seabed is clamped to zero on the way out, exactly as an island's would be: the sea is a flat
 * plane at the waterline and its depth is a *color*, decided in `terrain.ts`. Handing `iso` the
 * signed number draws the ocean floor where it really is, which in a 2:1 projection with no water
 * surface is not a sea — it is a trench.
 */
export const field: HeightField = { heights: { get: (gx, gy) => Math.max(0, (cell(gx, gy) & 255) - BIAS), has: () => true }, stepPx: STEP_PX };

/** Choose the world. Nothing is generated here; the first chunk is minted by the first frame. */
export function open(seedText: string): void {
  seed = hashString(seedText);
}
