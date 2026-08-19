/**
 * HARBOR — a Lattice exhibit. Wiring, and the frame.
 *
 * A hundred and ninety-six tall, narrow silhouettes over water — masts, crane towers, cabin
 * lights, a jetty ninety tiles long — all of them in **one** `DepthSorter`. That is the whole
 * idea: a mast is one tile wide and twelve storeys high, so its footprint says almost nothing
 * about where it belongs in the order and everything depends on `iso` sorting by the base rather
 * than by the drawn box. Sort the jetty separately from the boats and hulls swim through it.
 *
 * `art.ts` carries `@art` and does every stroke of the drawing; delete it and the harbor still
 * generates, still sorts, and still reports the same count. This file is the boot, the seeded
 * layout and the readout, and nothing else.
 *
 * `?seed=` turns the fleet. Same seed, same hulls in the same water, every time.
 */
import { hashStep, hashString, toUnit } from '@latticekit/core';
import { tileBounds, type Rect } from '@latticekit/iso';
import { extendStops, BASE_SLOTS, paletteVars, renderFrame, type Passes, type Pen } from '@latticekit/draw';
import { applyPalette, createOverlay, drive, el, setText } from '@latticekit/ui';
import { bootstrap, controlPanel, costNode, createBucket, knobs } from '../../_shared/src/index.js';
import { paintThing, paintWake, paintWater, type HarborThing } from './art.js';

/** The map, and the tallest thing standing on it — `tileBounds` needs the ceiling to know how far
 *  above the ground plane the world's rectangle reaches. */
const W = 140, H = 112, MAX_H = 270;
const world: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, W, H, MAX_H, world);
// Deliberately a *slice* of the map and not the map: `fitBounds` frames what it is handed inside
// the viewport, so fitting `world` is how an exhibit becomes a diorama with its own corners in
// shot. This rectangle opens on the middle of the jetty with the far quay off the top edge.
tileBounds(30, 27, 75, 58, MAX_H, opening);

const HARBOR = extendStops(BASE_SLOTS, {
  water2: 0x147895ff, water3: 0x1d8da8ff, foam: 0x83cadaff, farHull: 0x8eabb0ff,
});

const boot = bootstrap({
  seed: 'harbor', background: '#08222f', palette: HARBOR, clear: 'sky', bounds: world,
  camera: { zoom: 1, minZoom: 0.3, maxZoom: 1.4, keepVisible: 0.55 },
  // The water is a plane and it really is level, so this is a declaration rather than a silence:
  // `input` resolves every pixel on `z = 0` either way, and only one of the two says it meant to.
  terrain: 'flat',
  actions: { inspect: ['tap'] },
  depth: 256,
});
boot.palette.set('brand', 0x1685a2ff);
boot.palette.set('ground', 0xd69d58ff);
boot.palette.set('metal', 0x5d7186ff);
boot.palette.set('glass', 0xdaf7f4ff);

/** Re-framed on every resize, because `Camera` copies its bounds and the panel builds a new one
 *  whenever a zoom clamp moves. */
const frame = (): void => { boot.camera.fitBounds(opening, 0); };
boot.onResize(frame);
frame();

const things: HarborThing[] = [];
let r = hashString(boot.seed);
for (let i = 0; i < 196; i++) {
  r = hashStep(r, i + 1); const a = toUnit(r); r = hashStep(r, i + 401); const b = toUnit(r);
  const band = i % 3, kind: HarborThing['kind'] = i % 17 === 0 ? 1 : i % 13 === 0 ? 2 : i % 5 === 0 ? 3 : 0;
  const gx = 12 + a * 112, gy = band === 0 ? 63 + b * 24 : band === 1 ? 39 + b * 22 : 17 + b * 20;
  things.push({ kind, gx, gy, w: kind === 0 ? 2.2 + a * 2.4 : kind === 1 ? 1 : 1.5, d: kind === 0 ? 1.1 + b : kind === 1 ? 1 : 1.5, h: kind === 3 ? 5 + a * 7 : kind === 1 ? 6 + b * 3 : kind === 2 ? 1.4 + b : 4 + b * 5, tint: i });
}
// The jetty is in the same sorter as everything on and behind it. It is the one object whose
// omission from the order would be invisible in a screenshot and wrong on every frame a hull
// crosses it, which is the failure this exhibit exists to not have.
things.push({ kind: 4, gx: 20, gy: 43, w: 92, d: 3.4, h: 1, tint: 0 });

/** One bucket, so the sorter's integers and the array they index cannot come apart. */
const bucket = createBucket<HarborThing>(boot.order);
let scene: Pen | undefined, drawTime = 0;
/** Hoisted: a closure written here is a closure allocated sixty times a second. */
const paint = (thing: HarborThing): void => { if (scene !== undefined) paintThing(scene, thing, drawTime); };

const passes: Passes = {
  maxHeightPx: MAX_H,
  terrain(pen, visible) {
    for (let y = visible.gy0; y < visible.gy1; y++) for (let x = visible.gx0; x < visible.gx1; x++) paintWater(pen, x, y);
    paintWake(pen, drawTime);
  },
  solids(pen) { scene = pen; bucket.each(paint); },
};

boot.onRender((pen) => {
  drawTime = pen.t;
  bucket.clear();
  for (const t of things) bucket.add(t, t.gx, t.gy, Math.max(0.12, t.w), Math.max(0.12, t.d), t.h * 26);
  renderFrame(pen, passes, boot.order);
});

const ui = createOverlay({ now: () => boot.loop.realTime * 1000 });
const sorted = el('div', { class: 'readout' }, 'SORTED 000');
const worst = costNode(el('div', { class: 'readout' }, 'WORST --'));
ui.mount(el('div', { class: 'harbor-hud' },
  el('section', { class: 'placard' },
    el('h1', {}, 'Harbor'),
    el('p', { class: 'subtitle' }, '196 narrow silhouettes · one shared depth order')),
  el('div', { class: 'readouts' }, sorted, worst),
  el('div', { class: 'hint' }, 'DRAG TO FOLLOW THE JETTY · WHEEL TO ZOOM')));
applyPalette(ui, paletteVars(boot.palette));
ui.every(() => {
  setText(sorted, `SORTED ${boot.order.count} / ${bucket.count}`);
  setText(worst, `WORST ${boot.worstMs.toFixed(1)} ms · ${boot.cadenceMs.toFixed(1)} cadence`);
});
boot.scope.add(drive(ui, boot));
boot.scope.add(() => { ui.destroy(); });

controlPanel(
  [knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), knobs.tapSlop(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot)],
  { params: boot.params, title: 'Harbor', subtitle: 'Tall thin objects, one depth order.', stats: knobs.frameTime(boot) },
);

boot.start();
