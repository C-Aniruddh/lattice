/**
 * ORBIT — a Lattice exhibit. Wiring, and the frame.
 *
 * There is no ground here. No tile map, no terrain pass, no height field and nothing that could
 * be called a floor — only platforms hanging in a cold void, three parallax star bands and eight
 * stations turning around a common center. It exists to answer the assumption a reader picks up
 * from every other row: that `iso` is a thing you put grass in. The projection is a coordinate
 * system, and the palette is where a world decides what it is made of.
 *
 * `orbit-art.ts` carries `@art` and paints all of it. This file is the boot, the two numbers a
 * visitor may move, and the readout.
 *
 * `?seed=` turns the field: the same seed is the same stars, the same fragments and the same
 * eight stations on the same rings.
 */
import { hashString } from '@latticekit/core';
import { tileBounds, type Rect } from '@latticekit/iso';
import { DAY, extendStops, paletteVars } from '@latticekit/draw';
import { applyPalette, createOverlay, drive, el, setText } from '@latticekit/ui';
import { bootstrap, controlPanel, costNode, knobs } from '../../_shared/src/index.js';
import { paintOrbit } from './orbit-art.js';

/** The navigable volume. There is no landform to measure, so the world's rectangle is the extent
 *  the rings and the drift actually reach — which is what the camera may be dragged across. */
const bounds: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, 160, 160, 360, bounds);
tileBounds(42, 42, 76, 76, 360, opening);

const VOID = extendStops(DAY, {
  sky: 0x030716ff, ground: 0x132f4bff, brand: 0x3a6f91ff, metal: 0x7294aaff,
  glass: 0xbdf5ffff, platform: 0x1d405cff, solar: 0x234c77ff, antenna: 0x9abbd0ff,
  star: 0xcff9ffff, beacon: 0x76e8ffff, haze: 0x285d8277, orbit: 0x5fcee699,
  voidTop: 0x173655ff, voidDeep: 0x020410ff,
});

const boot = bootstrap({
  seed: 'polaris-7', background: '#030716', palette: VOID, clear: 'sky', bounds,
  camera: { zoom: 1, minZoom: 0.22, maxZoom: 1.25, keepVisible: 0.4 },
  // Nothing here has a surface a pointer could land on, so every pick is the plane `z = 0` and
  // saying so is the difference between an answer and a shrug. `input` warns once otherwise.
  terrain: 'flat',
  actions: { select: ['tap'] },
  depth: 400,
});
// Snapping a starfield to whole device pixels makes the parallax bands crawl in steps rather than
// drift, and there is no hard edge anywhere in this exhibit for it to have sharpened in exchange.
boot.setSnap(false);

const seed = hashString(boot.seed);
let density = boot.params.num('density', 240);
let speed = boot.params.num('speed', 1);
let selected = 0;
boot.onAction('select', () => { selected = (selected + 1) % 8; });

const frame = (): void => { boot.camera.fitBounds(opening, 0); };
boot.onResize(frame);
frame();

boot.onRender((pen) => { paintOrbit(pen, boot.order, seed, density, speed, selected); });

const ui = createOverlay({ now: () => boot.loop.realTime * 1000 });
const visible = el('output', {}, '0');
const worst = el('output', {}, '0 ms');
const cadence = el('output', {}, '0 ms');
ui.mount(el('div', { class: 'hud' },
  el('div', { class: 'title' }, 'LATTICE / EXHIBIT 05', el('strong', {}, 'ORBIT')),
  el('div', { class: 'readout' },
    el('div', {}, 'SEED', el('output', {}, boot.seed.toUpperCase())),
    el('div', {}, 'VISIBLE', visible),
    costNode(el('div', {}, 'WORST GAP', worst)),
    // Cadence is suppressed with the gap beside it. It reads as a property of the exhibit and is
    // a property of the visitor's display — the one number on this page that says more about the
    // reader's hardware than about the kit, which is exactly what ?cost=0 exists to withhold.
    costNode(el('div', {}, 'CADENCE', cadence))),
  el('div', { class: 'hint' }, 'DRAG TO CROSS THE VOID · SCROLL TO DIVE')));
applyPalette(ui, paletteVars(boot.palette));
ui.every(() => {
  setText(visible, String(boot.order.count));
  setText(worst, `${boot.worstMs.toFixed(1)} ms`);
  setText(cadence, `${boot.cadenceMs.toFixed(1)} ms`);
});
boot.scope.add(drive(ui, boot));
boot.scope.add(() => { ui.destroy(); });

controlPanel(
  [
    { kind: 'group', label: 'the field' },
    { kind: 'range', key: 'density', label: 'objects in orbit', min: 40, max: 480, step: 10, value: density,
      param: '@latticekit/iso DepthSorter.add(gx, gy, w, d, heightPx)',
      note: 'Every one of these is one `add` and one sort key. Nothing is spawned, kept or destroyed when it moves — the count is a loop bound.',
      wrong: { below: 60, says: 'Sixty of anything is a diorama. The kit\'s claim is that these are cheap, and thirty on screen disproves it more effectively than any paragraph.' },
      apply: (v) => { density = v; } },
    { kind: 'range', key: 'speed', label: 'orbital rate', min: 0, max: 2.4, step: 0.1, value: speed,
      param: '@latticekit/draw Pen.t',
      note: 'The angle is a closed-form function of the frame time, so this is a multiplier on a clock and never a step size. Nothing integrates.',
      wrong: { below: 0.05, says: 'A static first frame reads as a screenshot of a game rather than a game — docs/GALLERY.md rule 3, with the slider at its wrong end.' },
      apply: (v) => { speed = v; } },
    { kind: 'group', label: 'the kit' },
    knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), knobs.tapSlop(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot),
  ],
  { params: boot.params, title: 'Orbit', subtitle: 'No ground at all — platforms, stars, a cold palette.', stats: knobs.frameTime(boot) },
);

boot.start();
