/**
 * IDLE — a Lattice exhibit. Wiring, the frame, and the one verb.
 *
 * A kiln valley that keeps working while you are gone. Prices are a closed-form curve,
 * buy-max is a logarithm, and fourteen hours of absence is one `advanceOver` — not a loop
 * that ticks fifty thousand times. `?seed=` is the valley; the same seed is the same stacks.
 *
 * There is no boot in this file. Canvas, camera, light, loop and input are `bootstrap()`
 * from `_shared`, because two of those steps are silent when they are wrong.
 *
 * ## What is logic and what is not
 *
 * This file, `rules.ts` and `hud.ts` are the exhibit's logic. `palette.ts`, `sky.ts`,
 * `land.ts`, `sprites.ts`, `works.ts`, `ambient.ts` and `overlay.ts` each carry `@art`.
 * Delete any one of them and the shop still prices, still buys, still resolves fourteen
 * hours in a single step.
 */
import { hashString } from '@latticekit/core';
import { tileBounds, type Rect } from '@latticekit/iso';
import { renderFrame, type Passes } from '@latticekit/draw';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { DUSK } from './palette.js';
import { MAX_HEIGHT_PX, fieldOf, paintLand } from './land.js';
import { bindPen, fillWorks, paintItem } from './works.js';
import { drawAir, drawHeat } from './ambient.js';
import { drawHaze, drawSky } from './sky.js';
import { makeShop, rateOf } from './rules.js';
import { createHud, type Readout } from './hud.js';

// `MAX_HEIGHT_PX` comes from `land.ts` rather than being retyped here. It is the tallest ground on
// the map in world pixels, and three things read it — the camera's bounds, `renderFrame`'s terrain
// cull, and the ground declaration below. Two copies of it is two answers, and the one that drifts
// is silently wrong rather than broken.
const W = 160, H = 160, MAX_H = MAX_HEIGHT_PX;
const world: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, W, H, MAX_H, world);
tileBounds(56, 70, 24, 16, 56, opening);

const boot = bootstrap({
  seed: 'foundry', bounds: world, background: '#1a0e08', palette: DUSK, clear: 'sky', depth: 2800,
  camera: { zoom: 0.82, minZoom: 0.32, maxZoom: 2.8, keepVisible: 0.38 },
  light: { scale: 0.48, falloff: 2.4, bloom: 0.3 },
});

const seedN = hashString(boot.seed);
const field = fieldOf(seedN);
// The valley is not level: `land.units` cuts a river along `gx + gy ≈ 158` and raises hills either
// side of it, so the tile under a pixel is the marched one and not the sea-level member of the
// family that pixel names. Declared through the boot rather than through `createInput`, because
// `input.terrain` is construction-time state and the panel rebuilds the input system every time a
// zoom clamp or a gesture threshold moves. Made after `fieldOf`, which is why it is `setTerrain`
// and not a `bootstrap` option: the map is generated from the seed and does not exist at that call.
boot.setTerrain({ field, maxHeightPx: MAX_H });
const shop = makeShop(() => Date.now());
const works = createBucket<number>(boot.order);
let burstAt = -10, nowMs = 0;
const burst = (): number => { const a = boot.loop.time - burstAt; return a < 0 || a > 2.2 ? 0 : 1 - a / 2.2; };
const fit = (): void => { boot.camera.setBounds(world); boot.camera.fitBounds(opening, 10); };
boot.onResize(fit);
fit();

const passes: Passes = {
  backdrop: (pen) => drawSky(pen),
  maxHeightPx: MAX_H,
  terrain: (pen, visible) => paintLand(pen, field, seedN, visible),
  solids: (pen) => { bindPen(pen); works.each(paintItem); },
  overlay: (pen) => { drawHaze(pen); drawHeat(pen); drawAir(pen, seedN, burst()); },
};

boot.onRender((pen, _alpha, ms) => {
  nowMs = ms;
  boot.light.begin(pen, 0.2, 'night');
  works.clear();
  fillWorks(works, boot.camera, field, seedN, shop.read().kiln, burst(), pen.t);
  renderFrame(pen, passes, boot.order);
});

const read = (): Readout => {
  const s = shop.read();
  return {
    coin: s.coin, kilns: s.kiln, rate: rateOf(s.kiln), price: shop.price(), maxN: shop.maxN(),
    wouldH: shop.would() / 3600, lastH: shop.last.wall, lastCredH: shop.last.credited / 3600,
    lastSteps: shop.last.steps, aways: shop.last.aways, worstMs: boot.worstMs,
  };
};

const hud = createHud(boot.palette, read, () => { shop.buy(1); }, () => { shop.buy(shop.maxN()); }, () => { shop.away(); burstAt = boot.loop.time; }, () => nowMs);
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);

controlPanel([
  { kind: 'group', label: 'offline' }, knobs.offlineExponent(shop.curve), knobs.offlineUncapped(shop.curve), knobs.offlineHorizon(shop.curve),
  { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'the night' }, knobs.lightBloom(boot), knobs.lightScale(boot), knobs.lightFalloff(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Idle', subtitle: 'Fourteen hours, one step.', stats: knobs.cost(boot) });

(globalThis as unknown as { __lattice: object }).__lattice = { loop: boot.loop, order: boot.order, camera: boot.camera, shop };
boot.start();
