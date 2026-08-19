/**
 * @art — the marsh's colour, its sky, its ground and the motes over it.
 *
 * Deleting this module leaves the exhibit playing: the bloom still crosses the same cells on
 * the same ticks, the tape still verifies, and the frame is blank. It holds no state that
 * outlives a frame — the two scratch buffers below are reused, never read across frames — and
 * it returns nothing any decision reads.
 *
 * Two things in here are load-bearing rather than decorative:
 *
 * - **The palette is a function of the tick, not of the wall clock.** A re-run has no clock, so
 *   an exhibit whose dusk ran on `performance.now()` would replay to the same state under a
 *   different sky and quietly stop being a demonstration of "the same pixel".
 * - **The bloom's brightness is quantised to eight levels.** `softEllipse` keys its ramp cache
 *   on the colour pair, and a continuously-mixed glow is a guaranteed miss on every call — 3.7
 *   MB/s of garbage in the exhibit that measured it. Position, radius and timing stay
 *   continuous, which is what the eye is tracking anyway.
 */

import { clamp01, hash2, toUnit } from '@latticekit/core';
import type { Vec2 } from '@latticekit/core';
import { gridToScreen } from '@latticekit/iso';
import type { Camera, DepthSorter, Rect, TileRange } from '@latticekit/iso';
import { DUSK, NIGHT, extendStops, glowDot, isoTerrain, mix, renderFrame, shade } from '@latticekit/draw';
import type { LightField, Passes, Pen } from '@latticekit/draw';
import { enqueue, onScreen, paint, windowOf, type Window } from './props.js';
import { GLOW_TICKS, MAX_HEIGHT_PX, N, NEVER } from './marsh.js';
import type { Marsh } from './marsh.js';

/** Reused, never read across frames. */
const edge: Vec2 = { x: 0, y: 0 };

/** Both sets define exactly the same slots. A half-defined night palette is how one thing
 *  stays gold at midnight, and the failure is silent everywhere else. */
export const EVENING = extendStops(DUSK, {
  sky: 0x3d4a86ff,
  deep: 0x123f4eff,
  water: 0x1d5c63ff,
  ground: 0x4f6b3cff,
  dry: 0x8a8442ff,
  rock: 0x7a6d56ff,
  reed: 0x9ab24aff,
  bloom: 0xdcf76aff,
});
export const LATE = extendStops(NIGHT, {
  sky: 0x11183eff,
  deep: 0x07202cff,
  water: 0x0c3540ff,
  ground: 0x22381fff,
  dry: 0x494526ff,
  rock: 0x3d3830ff,
  reed: 0x53662aff,
  bloom: 0xc6ee55ff,
});

/** The five ground colours, low to high, blended over sixteen stops rather than switched at a
 *  threshold — hard bands on a noisy field make a mosaic of flat diamonds, which is the single
 *  most common way a heightfield stops reading as terrain. */
const BANDS = ['deep', 'water', 'ground', 'dry', 'rock'] as const;

/** How far into the night a tick is, in 1/64ths. Quantised, so `lerp` bumps `rev` rarely. */
export function hour(tick: number): number {
  return Math.round(clamp01(tick / 1400) * 64) / 64;
}

/** Darkness for the light field, on the same schedule as the colour. One number, two consumers. */
export function darkness(tick: number): number {
  return 0.1 + hour(tick) * 0.52;
}

/**
 * A vertical ramp with a haze along the world's far edge — never a flat colour, because flat
 * backgrounds make a world look like a sticker sitting on one.
 *
 * The horizon is a *world* line: `gx + gy = 0` is the map's far corner, and every point on that
 * line projects to the same screen row at every zoom, so the haze stays attached to the marsh
 * when the camera moves instead of sliding across it.
 */
function sky(pen: Pen, _visible: Readonly<Rect>): void {
  const s = pen.surface;
  const w = s.width;
  const h = s.height;
  const xy = pen.xy;
  xy[0] = 0;
  xy[1] = 0;
  xy[2] = w;
  xy[3] = 0;
  xy[4] = w;
  xy[5] = h;
  xy[6] = 0;
  xy[7] = h;
  const zenith = shade(pen.palette.get('sky'), 0.62);
  const haze = mix(pen.palette.get('sky'), 0xffffffff, 0.22);
  gridToScreen(pen.camera, 0, 0, 0, edge);
  const hy = edge.y + pen.snapY;
  s.polyRamp(xy, 4, 0, 0, 0, hy < 8 ? 8 : hy, zenith, haze);
  s.softEllipse(w * 0.5, hy, w * 0.72, 92, mix(haze, pen.palette.get('bloom'), 0.16), haze);
}

/**
 * The ground, the water in it, and the bloom on top — one pass, one `isoTerrain` per tile.
 *
 * The bloom is a tint rather than a light pool. A pool is priced by *area*, and area scales with
 * zoom squared, so three thousand of them would cost the frame twice over at the far end of the
 * zoom range; a tint is free and reads as ground that is glowing rather than ground that is lit.
 */
function ground(pen: Pen, m: Marsh, visible: Readonly<TileRange>): void {
  const p = pen.palette;
  const glow = p.get('bloom');
  const crest = mix(glow, 0xffffffff, 0.5);
  const far = mix(p.get('sky'), 0xffffffff, 0.3);
  const ramp = BANDS.map((slot) => p.get(slot));
  const x0 = visible.gx0 < 0 ? 0 : visible.gx0;
  const y0 = visible.gy0 < 0 ? 0 : visible.gy0;
  const x1 = visible.gx1 > N ? N : visible.gx1;
  const y1 = visible.gy1 > N ? N : visible.gy1;
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      if (!onScreen(win, gx, gy)) continue;
      // Sixteen stops up the ramp, so two tiles either side of a band edge differ by a
      // sixteenth rather than by a whole colour — and sixteen keys is a cache the ramp likes.
      const level = (Math.round((m.grid.get(gx, gy) / 240) * 15) / 15) * 4;
      const band = level | 0;
      let fill = mix(ramp[band] ?? 0, ramp[band + 1] ?? ramp[band] ?? 0, level - band);
      // Haze: the far band loses saturation toward the sky pulled a third of the way to white.
      // Distance in this projection is `gx + gy` — small is far, at the top of the screen.
      const depth = 1 - (gx + gy) / (2 * N);
      fill = mix(fill, far, depth * depth * 0.42);
      // `isoTerrain` measures its relief east-to-west, because those are the two corners that
      // land on the same screen row — so a slope running along the *other* diagonal shades
      // perfectly flat, with no error and nothing to grep for. That term is one subtraction and
      // the exhibit has to supply it, which is why this line exists and looks like nothing.
      const ns = (m.grid.get(gx, gy) - m.grid.get(gx + 1, gy + 1)) / 150;
      const relief = ns > 0.22 ? 0.22 : ns < -0.22 ? -0.22 : ns;
      let tint = 0.9 - depth * 0.1 + relief + (toUnit(hash2(0x7a11, gx, gy)) - 0.5) * 0.06;
      const cell = gy * N + gx;
      const lit = bright(m, cell, m.tick);
      if (lit > 0) {
        // The crest is the twelve ticks after arrival: a bright rim that moves, so the bloom
        // reads as something crossing the marsh rather than as a stain spreading over it.
        const age = m.tick - (m.arrival[cell] ?? 0);
        const edge = age < 12 ? Math.round((1 - age / 12) * 4) / 4 : 0;
        fill = mix(mix(fill, glow, lit * 0.86), crest, edge * 0.7);
        tint += lit * 0.26 + edge * 0.18;
      }
      isoTerrain(pen, m.field, gx, gy, fill, undefined, tint);
    }
  }
}

/**
 * How far a cell has glowed in, 0–1, in eight steps.
 *
 * It rises to full over {@link GLOW_TICKS} and then **settles back to about a third**, which is
 * the difference between a bloom that crosses the marsh and a bloom that floods it. Without the
 * decay every tile the wave has ever touched stays at full brightness, and by the end of a take
 * the water, the banks and the ridges are one wash of the same colour — a picture with no
 * structure left in it, which is a composition failure rather than a simulation one.
 *
 * The only reader of `arrival` outside the rules, and it reads it the way a picture does: as a
 * number, never as a decision.
 */
export function bright(m: Marsh, cell: number, tick: number): number {
  const at = m.arrival[cell] ?? NEVER;
  if (at < NEVER / 10 || at > tick) return 0;
  const age = tick - at;
  const level = age < GLOW_TICKS ? age / GLOW_TICKS : 1 - clamp01((age - GLOW_TICKS) / 260) * 0.66;
  return Math.round(level * 8) / 8;
}

/**
 * Spores over the marsh — the third distance band, and the thing that is moving in the first
 * frame before the bloom has grown enough to see move.
 *
 * Addressed by index rather than drawn from a stream, and driven by the tick, so the same tick
 * puts the same mote in the same place on a re-run.
 */
function motes(pen: Pen, m: Marsh, tick: number, count: number): void {
  const c = pen.palette.get('bloom');
  for (let i = 0; i < count; i++) {
    const a = (i * 2654435761) >>> 0;
    const drift = tick * (0.0018 + (a & 15) * 0.00022);
    const gx = ((a >>> 8) % 4096) / 4096 * N + Math.sin(drift + i) * 2.5;
    const gy = ((a >>> 20) % 4096) / 4096 * N + Math.cos(drift * 0.8 + i) * 2.5;
    if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
    const near = bright(m, ((gy | 0) * N + (gx | 0)) | 0, tick);
    const z = 10 + ((a >>> 4) & 27) + Math.sin(drift * 3 + i) * 6;
    glowDot(pen, gx, gy, z, c, 0.07 + near * 0.05, 0.16 + Math.round(near * 4) / 12);
  }
}


/**
 * The whole frame, in one call from the render callback.
 *
 * Everything this file holds comes in as an argument, so there is nothing here to be stale and
 * nothing to dispose. The pass object is hoisted rather than rebuilt, because a `Passes`
 * allocated per frame is an allocation on the hot path for a shape that never changes.
 */
export interface Stage {
  readonly camera: Camera; readonly light: LightField;
  readonly order: DepthSorter; readonly seed: number;
}

const range = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const win: Window = { u0: 0, u1: 0, v0: 0, v1: 0 };
/** Frame scratch: set at the top of `render` and cleared at the bottom of it, so the hoisted
 *  `Passes` object can reach this frame's arguments without either of them outliving it. */
let marsh: Marsh | undefined;

const passes: Passes = {
  maxHeightPx: MAX_HEIGHT_PX,
  backdrop: sky,
  terrain: (pen, visible) => { if (marsh) ground(pen, marsh, visible); },
  solids: paint,
  effects(pen) {
    if (marsh) motes(pen, marsh, marsh.tick, 300);
  },
};

export function render(pen: Pen, on: Stage, m: Marsh): void {
  marsh = m;
  // The pen arrives open, cleared and carrying the light field — `examples/_shared`'s bootstrap
  // owns `beginFrame`/`endFrame` precisely so an exhibit cannot detach the field from the frame,
  // which is one of the two silent failures that module exists to remove.
  //
  // The mask half and the colour half take the same number, from the same schedule. Two
  // schedules is a marsh whose darkness and whose blue disagree, and it always reads as a bug
  // in the light field.
  on.light.begin(pen, darkness(m.tick), 'night');
  windowOf(on.camera, win);
  on.order.clear();
  enqueue(on.order, m, on.seed, on.camera.visibleTileBounds(range, 4), win);
  renderFrame(pen, passes, on.order);
  marsh = undefined;
}
