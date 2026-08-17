/**
 * **`@browser-only`** — the shared module's own proof, and the shape an exhibit copies.
 *
 * `npx vite examples/_shared` and open :5183. It is not an exhibit and never will be: it is
 * eleven blocks, three lamps and a ninety-second day, chosen because between them they touch
 * every seam this folder owns — the pen with a light field on it, the depth sort, a tap action
 * that survives an input rebuild, a resize, and one of every kind of control.
 *
 * **Read it for the boot, not for the art.** Roughly twenty lines here are scene and the rest is
 * the pattern: `bootstrap`, `onUpdate`, `onRender`, `controlPanel`, `start`. Every trap the
 * first exhibit reported is absent from those five lines rather than handled inside them.
 */

import { clamp01 } from '@latticekit/core';
import { DAY, NIGHT, isoBox, isoTile, glowDot, renderFrame, type Passes, type Pen } from '@latticekit/draw';
import { tileBounds, type Rect } from '@latticekit/iso';
import { createAudio, type Audio } from '@latticekit/audio';
import type { OfflineCurve } from '@latticekit/sim';
import { offlineCredit } from '@latticekit/sim';
import { bootstrap } from './bootstrap.js';
import { createBucket } from './bucket.js';
import { controlPanel } from './panel.js';
import * as knobs from './knobs.js';
import type { Box } from './knobs.js';

const SPAN = 14;
const DAY_SECONDS = 90;

// ── the world, such as it is ─────────────────────────────────────────────────────────────────

const bounds: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, SPAN, SPAN, 6 * 26, bounds);

const boot = bootstrap<'poke'>({
  seed: 'harness',
  bounds,
  camera: { zoom: 0.9, minZoom: 0.3, maxZoom: 3 },
  clear: 'sky',
  actions: { poke: ['tap', 'key:Space'] },
});

interface Block {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly lamp: boolean;
  hit: number;
}

const blocks: Block[] = [];
for (let i = 0; i < 11; i++) {
  const w = 1 + boot.rng.int(0, 2);
  const d = 1 + boot.rng.int(0, 2);
  blocks.push({
    gx: 1 + boot.rng.int(0, SPAN - w - 2),
    gy: 1 + boot.rng.int(0, SPAN - d - 2),
    w,
    d,
    h: 1 + boot.rng.int(0, 5),
    lamp: i % 4 === 0,
    hit: 0,
  });
}

// ── sound, so the voice ceiling has something to choke ────────────────────────────────────────

const PLINK = {
  bus: 'sfx',
  minGapMs: 40,
  ladder: { steps: 6, windowMs: 1400 },
  layers: [{ wave: 'triangle', hz: 392, toHz: 588, gain: 0.09, hold: 0.22, cutoff: 3200 }],
} as const;

let maxVoices = 16;
let audio: Audio<'plink'> = createAudio<'plink'>({ sounds: { plink: PLINK }, maxVoices });
let refused = 0;
/** Counted so the tab can show that a binding survived an input rebuild. Drag the tap slop,
 *  which recreates the whole `InputSystem`, and check this still goes up. */
let pokes = 0;

// ── the offline curve, which is the only kit parameter here that moves without a rebuild ─────

const curve: Box<OfflineCurve> = {
  value: { uncappedSeconds: 2 * 3600, exponent: 0.625, flatAfterSeconds: 24 * 3600 },
};

// ── the frame ────────────────────────────────────────────────────────────────────────────────

let daylight = 1;
let elapsed = 0;

boot.onUpdate((dt) => {
  elapsed += dt;
  // A pure function of the clock, never an accumulator over `dt` — the loop's own advice.
  daylight = clamp01(0.5 + 0.5 * Math.cos((elapsed / DAY_SECONDS) * Math.PI * 2));
  for (const b of blocks) if (b.hit > 0) b.hit = Math.max(0, b.hit - dt * 2);
});

boot.onAction('poke', () => {
  pokes += 1;
  audio.unlock();
  if (!audio.play('plink')) refused += 1;
  for (const b of blocks) b.hit = 1;
});

// ── the frame bucket ─────────────────────────────────────────────────────────────────────────

/**
 * Every drawable this frame, in `boot.order`'s own index space.
 *
 * Built once, beside the sorter it fills, and it is the only thing that ever calls
 * `boot.order.add`. This scene is homogeneous — eleven blocks and nothing else — so the desync
 * the bucket prevents could not arise here even by hand; it is used anyway because this file is
 * the shape an exhibit copies, and the exhibit that copies it will have walkers.
 */
const bucket = createBucket<Block>(boot.order);

/**
 * The pen the current frame is painting into.
 *
 * `Bucket.each` hands the visitor an item and a position and nothing else, so a visitor that
 * needs the pen must either close over it — a closure per frame — or read it from here. This is
 * the wart, and it is written down rather than hidden: see this folder's README.
 */
let framePen: Pen | undefined;

/** Hoisted, so `each` costs no allocation. Reads {@link framePen} rather than capturing one. */
function paintBlock(b: Block): void {
  const pen = framePen;
  if (pen === undefined) return;
  isoBox(pen, b.gx, b.gy, b.w, b.d, { color: b.lamp ? 'brand' : 'glass', h: b.h + b.hit * 0.3 });
  if (b.lamp) glowDot(pen, b.gx + b.w / 2, b.gy + b.d / 2, b.h, 'warn', 7, 1 - daylight);
}

const passes: Passes = {
  terrain(pen, visible) {
    for (let gy = visible.gy0; gy <= visible.gy1; gy++) {
      for (let gx = visible.gx0; gx <= visible.gx1; gx++) {
        if (gx < 0 || gy < 0 || gx >= SPAN || gy >= SPAN) continue;
        isoTile(pen, gx, gy, (gx + gy) % 2 === 0 ? 'ground' : 'metal', 'ink', 0.02);
      }
    }
  },
  maxHeightPx: 6 * 26,
  solids(pen) {
    framePen = pen;
    bucket.each(paintBlock);
  },
};

boot.onRender((pen: Pen) => {
  boot.palette.lerp(NIGHT, DAY, daylight);
  // The pen already carries the light field. There is no way from here to hand `renderFrame` a
  // pen that does not, which is the whole point of `onRender` taking one rather than making one.
  boot.light.begin(pen, (1 - daylight) * 0.8, 'night');
  for (const b of blocks) {
    if (b.lamp) boot.light.add(b.gx + b.w / 2, b.gy + b.d / 2, b.h * 26, 5.5, 1 - daylight, 'warn');
  }
  // One clear for the pair — `bucket.clear()` drops the sorter's items too, so there is no
  // second statement to forget and no order for the two of them to be written in.
  bucket.clear();
  for (const b of blocks) bucket.add(b, b.gx, b.gy, b.w, b.d, b.h * 26);
  renderFrame(pen, passes, boot.order);
});

// ── the panel ────────────────────────────────────────────────────────────────────────────────

const panel = controlPanel(
  [
    { kind: 'group', label: 'the world' },
    knobs.seed(boot),
    { kind: 'group', label: 'camera — @latticekit/iso' },
    knobs.minZoom(boot),
    knobs.maxZoom(boot),
    knobs.keepVisible(boot),
    { kind: 'group', label: 'touch — @latticekit/input' },
    knobs.tapSlop(boot),
    knobs.longPress(boot),
    knobs.flingHalfLife(boot),
    knobs.flingFloor(boot),
    { kind: 'group', label: 'the night — @latticekit/draw' },
    knobs.lightBloom(boot),
    knobs.lightScale(boot),
    knobs.lightFalloff(boot),
    { kind: 'group', label: 'pixels — @latticekit/draw' },
    knobs.snap(boot),
    knobs.pixelRatio(boot),
    { kind: 'group', label: 'offline — @latticekit/sim' },
    knobs.offlineExponent(curve),
    knobs.offlineUncapped(curve),
    knobs.offlineHorizon(curve),
    { kind: 'group', label: 'sound — @latticekit/audio' },
    {
      kind: 'range',
      key: 'voices',
      label: 'voice ceiling',
      param: '@latticekit/audio AudioOptions.maxVoices',
      note: 'Tap or hold Space and mash. Refusals show in the tab.',
      min: 1,
      max: 32,
      step: 1,
      value: maxVoices,
      commit: 'change',
      wrong: {
        below: 4,
        says: 'Now mash. Past the ceiling, play() returns false and the burst comes back with holes in it.',
      },
      apply(value: number) {
        maxVoices = value;
        audio.dispose();
        audio = createAudio<'plink'>({ sounds: { plink: PLINK }, maxVoices });
        refused = 0;
      },
    },
  ],
  {
    params: boot.params,
    title: 'shared harness',
    subtitle: 'The bootstrap and the panel, running. Not an exhibit.',
    stats: () => {
      // Fourteen hours of absence, priced by whatever the offline sliders currently say. It is
      // the cheapest way to make an invisible parameter visible: drag the exponent to 1.0 and
      // this number becomes 14.00 h.
      const credited = offlineCredit(14 * 3600, curve.value) / 3600;
      return `${boot.loop.stats.frameMs.toFixed(1)}ms · 14h→${credited.toFixed(2)}h · ${String(pokes)} pokes, ${String(refused)} refused`;
    },
  },
);
boot.scope.add(panel.dispose);
boot.scope.add(() => audio.dispose());

boot.start();
