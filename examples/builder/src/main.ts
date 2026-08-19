/**
 * BUILDER — a Lattice exhibit. Wiring, the placement rule, and the frame.
 *
 * The one idea is the seam a base-builder lives or dies on: **a pixel a finger landed on becoming
 * the tile a 3×2 footprint is tested against.** `input` owns the conversion, `iso` owns the
 * footprint, and this file owns the one predicate between them — six tiles clear, inside the yard,
 * nothing already standing on any of them. Everything a visitor sees is a consequence of that
 * predicate: the ghost is the same footprint drawn before it is committed, and the color under it
 * is the same boolean the tap will read.
 *
 * There is no shop, no inventory and no selection step. The visitor arrives holding the workshop,
 * because a picker would be a second idea and rule 2 only allows one.
 *
 * `art.ts` carries `@art` and is the yard, the obstacles, the sprite and the ghost.
 *
 * `?seed=` turns the workshop variants. The yard's topology is fixed — the demonstration is the
 * seam, and a yard that reshuffled under the seed would move the interesting part off screen.
 */
import { hashString } from '@latticekit/core';
import { rectSet, type Rect, type Tile } from '@latticekit/iso';
import { DAY, FLAG_GHOST, VARIANT_ZERO, paletteVars, type Variant } from '@latticekit/draw';
import { applyPalette, createOverlay, drive, el, setText } from '@latticekit/ui';
import { bootstrap, controlPanel, costNode, knobs } from '../../_shared/src/index.js';
import { building, ghost, ground, obstacle } from './art.js';

/** The yard, and the footprint every tap is tested against. */
const SIZE = 38, W = 3, D = 2;
const world: Rect = rectSet({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, -SIZE * 32, 0, SIZE * 32, SIZE * 32);
/** A slice of the yard, not the yard: `fitBounds` frames what it is handed inside the viewport,
 *  so fitting the whole map is how an exhibit puts its own corners in shot. */
const opening: Rect = rectSet({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, -650, 150, 650, 980);

const boot = bootstrap({
  seed: '731', background: '#12262c', palette: DAY, clear: 'sky', bounds: world,
  camera: { zoom: 1, minZoom: 0.42, maxZoom: 1.6, keepVisible: 0.3 },
  // The yard is level and this exhibit is *about* the pick, so the declaration is not optional
  // politeness: on a map with elevation the same silence resolves several tiles uphill of the
  // finger, plausibly enough that nothing downstream reports it.
  terrain: 'flat',
  actions: { place: ['tap', 'key:Space'] },
  depth: 256,
});

const frame = (): void => { boot.camera.fitBounds(opening, 0); };
boot.onResize(frame);
frame();

const occupied = new Set<string>();
const blockers = new Set<string>();
const buildings: { gx: number; gy: number; seed: number }[] = [{ gx: 9, gy: 9, seed: 41 }];
for (let y = 3; y < SIZE - 3; y++) for (let x = 3; x < SIZE - 3; x++) if ((x * 13 + y * 29) % 31 < 2) blockers.add(`${x},${y}`);

function mark(gx: number, gy: number): void {
  for (let y = gy; y < gy + D; y++) for (let x = gx; x < gx + W; x++) occupied.add(`${x},${y}`);
}
/** The whole rule, in one place, read by the ghost and by the tap. Two copies of this would be
 *  two answers, and the one a visitor sees would be the one that is not enforced. */
function valid(gx: number, gy: number): boolean {
  if (gx < 1 || gy < 1 || gx + W >= SIZE || gy + D >= SIZE) return false;
  for (let y = gy; y < gy + D; y++) for (let x = gx; x < gx + W; x++) if (occupied.has(`${x},${y}`) || blockers.has(`${x},${y}`)) return false;
  return true;
}
for (const b of buildings) mark(b.gx, b.gy);

const hover: Tile = { gx: 12, gy: 12 };
let hasHover = true, legal = true, placed = 1, variantSeed = hashString(boot.seed);
const ghostVariant: Variant = { ...VARIANT_ZERO, flags: FLAG_GHOST, seed: variantSeed };

boot.onAction('place', (e) => {
  if (!e.onGround || !valid(e.gx, e.gy)) return;
  buildings.push({ gx: e.gx, gy: e.gy, seed: variantSeed++ });
  mark(e.gx, e.gy);
  placed++;
});

boot.onUpdate(() => {
  // Read through `boot.input` rather than a captured reference: the panel replaces the input
  // system whenever a gesture threshold moves, and a cached one survives as a live object nothing
  // is driving any more.
  hasHover = boot.input.hoverTile(hover);
  legal = hasHover && valid(hover.gx, hover.gy);
});

boot.onRender((pen) => {
  ground(pen, SIZE, pen.t);
  let n = 0;
  for (const key of blockers) {
    const [x, y] = key.split(',').map(Number);
    if (x !== undefined && y !== undefined) obstacle(pen, x, y, n++);
  }
  for (const b of buildings) building(pen, b.gx, b.gy, { ...VARIANT_ZERO, seed: b.seed });
  if (hasHover) ghost(pen, hover.gx, hover.gy, ghostVariant, legal);
});

const ui = createOverlay({ now: () => boot.loop.realTime * 1000 });
const status = el('div', { class: 'status' }, '6 TILES CLEAR — TAP TO BUILD');
const cost = costNode(el('div', { class: 'cost' }, 'worst 0.0 ms'));
ui.mount(el('div', { class: 'hud' },
  el('div', { class: 'title' }, el('b', {}, 'BUILDER'), el('span', {}, '3 × 2 WORKSHOP · TAP TO PLACE')),
  status,
  cost,
  el('div', { class: 'tip' }, 'DRAG TO PAN · WHEEL / PINCH TO ZOOM')));
applyPalette(ui, paletteVars(boot.palette));
ui.every(() => {
  setText(status, hasHover ? (legal ? '6 TILES CLEAR — TAP TO BUILD' : 'BLOCKED — FIND 6 CLEAR TILES') : 'MOVE OVER THE YARD');
  status.classList.toggle('bad', !legal);
  setText(cost, `worst ${boot.worstMs.toFixed(1)} ms · ${placed} placed`);
});
boot.scope.add(drive(ui, boot));
boot.scope.add(() => { ui.destroy(); });

controlPanel(
  [
    // `tapSlop` is the headline knob here and not a courtesy row: it is the threshold that decides
    // whether a finger that moved four pixels placed a building or panned the yard, and this is
    // the one exhibit where a visitor can feel it move.
    knobs.tapSlop(boot), knobs.longPress(boot), knobs.minZoom(boot), knobs.maxZoom(boot),
    knobs.keepVisible(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot),
  ],
  { params: boot.params, title: 'Builder', subtitle: 'Footprints, a ghost, validity, and the tap-to-tile seam.', stats: knobs.frameTime(boot) },
);

boot.start();
