/**
 * WAYFINDING — a Lattice exhibit. Wiring, the field, and the frame.
 *
 * One `FlowField` over a 128×128 concourse, six hundred and forty walkers reading it, and three
 * crossings in a divider that a visitor can close. Close one and the field is rebuilt **in the
 * same update step**, before anything is drawn, so every walker takes its next step off the new
 * field: the crowd turns as one and no walker is ever a frame behind another.
 *
 * There is no per-walker path and no re-plan. A walker holds a position and reads
 * `flow.step(gx, gy, out)`, which is the point of a flow field over a per-agent A*: the cost of a
 * map change is one rebuild, not six hundred and forty of them.
 *
 * `art.ts` carries `@art` and draws all of it — the paving, the colonnade, the props, the bodies.
 *
 * `?seed=` scatters the crowd's starting positions and its walking phases.
 */
import { hash2, hashString, toUnit } from '@latticekit/core';
import { FlowField, TileGrid, tileBounds, type GridPoint, type Rect } from '@latticekit/iso';
import { paletteVars, renderFrame, type Passes, type Pen } from '@latticekit/draw';
import { applyPalette, createOverlay, drive, setText } from '@latticekit/ui';
import { bootstrap, controlPanel, costNode, createBucket, knobs } from '../../_shared/src/index.js';
import { addProps, barrier, drawHaze, drawProp, drawSky, goal, ground, person, wall } from './art.js';

const N = 128;
/** The tallest thing in the hall is a column with its capital on, and `tileBounds` needs that to
 *  know how far above the ground plane the world's rectangle reaches. */
const MAX_HEIGHT_PX = 175;
const GOAL = { gx: 104, gy: 104 };
/** The divider, and the three crossings in it. `DIVIDER` is a column of tiles; a gate is a hole
 *  in that column that a tap opens and closes. */
const DIVIDER = 62, WALL_0 = 18, WALL_1 = 112;
const GATES = [[DIVIDER, 54], [DIVIDER, 77], [DIVIDER, 94]] as const;

const world: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, N, N, MAX_HEIGHT_PX, world);
// A slice of the hall and never the hall: `fitBounds` frames what it is handed *inside* the
// viewport, so fitting the map is how an exhibit acquires four visible corners and becomes a
// diorama — which is what the first version of this line did, because `tileBounds` takes an
// origin and a **size** and it was read as two corners. Twenty-four tiles by twenty-six, opening
// on the middle crossing with the divider running out of the top of the frame and the destination
// eighty tiles beyond the bottom-right corner.
tileBounds(44, 40, 24, 26, MAX_HEIGHT_PX, opening);

const boot = bootstrap({
  seed: 'concourse', background: '#07131d', clear: 'sky', bounds: world,
  camera: { zoom: 1, minZoom: 0.45, maxZoom: 2.4, keepVisible: 0.55 },
  // A concourse floor is a plane and really is one. Saying so resolves identically to saying
  // nothing and differs in the one way that matters: `input` stops warning that nobody answered.
  terrain: 'flat',
  actions: { toggle: ['tap'] },
  depth: 1200,
});
boot.palette.set('ground', 0x2c5f63ff);
boot.palette.set('brand', 0xf06d43ff);
boot.palette.set('metal', 0x3f7d8aff);
boot.palette.set('glass', 0x7ae6f2ff);
boot.palette.set('sky', 0x0c2230ff);
boot.palette.set('ok', 0x6cb45aff);

const frame = (): void => { boot.camera.fitBounds(opening, 0); };
boot.onResize(frame);
frame();

// ── the map and the field ───────────────────────────────────────────────────────────────────
const map = new TileGrid(N, N, { fill: 1 });
const flow = new FlowField(0, 0, N, N);
for (let y = WALL_0; y < WALL_1; y++) if (!GATES.some((g) => g[1] === y)) map.set(DIVIDER, y, 0);
flow.addGoal(GOAL.gx, GOAL.gy);
/** The border is impassable so nothing walks off the map and every walker's next tile exists. */
const cost = (x: number, y: number): number => (x < 2 || y < 2 || x >= N - 2 || y >= N - 2 ? 0 : map.get(x, y));
flow.build(cost, undefined, map.version);

interface Walker { x: number; y: number; hue: number; phase: number }
const COUNT = 640;
const seed = hashString(boot.seed);
/** Spread across the whole west half rather than massed in one block: a clump reads as a spawn
 *  point, and § Scale asks for a crowd that fills the concourse it is crossing. */
const spawn = (i: number, salt: number): Walker => ({
  x: 16 + toUnit(hash2(seed, i, salt)) * 42,
  y: 24 + toUnit(hash2(seed, i, salt + 977)) * 70,
  hue: i % 3,
  phase: toUnit(hash2(seed, i, 3)) * 6,
});
const walkers: Walker[] = Array.from({ length: COUNT }, (_, i) => spawn(i, 1));

const next: GridPoint = { gx: 0, gy: 0 };
let revision = 1, flashUntil = 0;

/** Close or open the crossing nearest a tap, and rebuild. Synchronously, inside the update step:
 *  a rebuild deferred to the next frame is a crowd that reacts a frame late, which is the exact
 *  thing this exhibit exists to show does not happen. */
function toggle(gx: number, gy: number): void {
  let best = -1, dist = 4;
  for (let i = 0; i < GATES.length; i++) {
    const g = GATES[i];
    if (g === undefined) continue;
    const d = Math.hypot(gx - g[0], gy - g[1]);
    if (d < dist) { dist = d; best = i; }
  }
  const g = GATES[best];
  if (g === undefined) return;
  map.set(g[0], g[1], map.get(g[0], g[1]) === 0 ? 1 : 0);
  flow.build(cost, undefined, map.version);
  revision++;
  flashUntil = boot.loop.realTime + 0.42;
}
boot.onAction('toggle', (a) => { if (a.onGround) toggle(a.gx, a.gy); });

// ── the frame ───────────────────────────────────────────────────────────────────────────────
//
// One bucket, one sorter. Props are `−1 − i` and walkers are `i`, so a column and the person
// walking behind it are sorted against each other rather than in two passes that disagree.
const bucket = createBucket<number>(boot.order);
/**
 * Is this tile on a contour of the field?
 *
 * Cost is in `STEP_ORTHO` units — ten per orthogonal step — so a band every 150 is a ring of
 * equal walking distance every fifteen tiles, two tiles thick. That is the field *drawn*: the
 * rings bend around the divider, and closing a crossing bends them somewhere else while the
 * visitor is looking at them. The first version of this line tested `cost % 6144 < 2200` against
 * a field whose largest cost is under 2,000, so it was true almost everywhere and the floor was
 * dressed rather than explained.
 */
const contourAt = (gx: number, gy: number): boolean => { const c = flow.costAt(gx, gy); return c >= 0 && c % 150 < 24; };
let scene: Pen | undefined, drawTime = 0;
const paint = (item: number): void => {
  const pen = scene;
  if (pen === undefined) return;
  if (item < 0) { drawProp(pen, -1 - item, drawTime); return; }
  // Three kinds in one index space: props below zero, walkers below `COUNT`, and the divider's own
  // tiles above it. A third collection would be a third thing that can fall out of step with the
  // sorter, which is the failure `createBucket` exists to make impossible.
  if (item >= COUNT) { wall(pen, DIVIDER, item - COUNT); return; }
  const w = walkers[item];
  if (w !== undefined) person(pen, w, drawTime, w.x + w.y > 128);
};

const passes: Passes = {
  backdrop: (pen) => { drawSky(pen); },
  maxHeightPx: MAX_HEIGHT_PX,
  terrain: (pen, v) => {
    for (let gy = Math.max(0, v.gy0); gy < Math.min(N, v.gy1); gy++) {
      for (let gx = Math.max(0, v.gx0); gx < Math.min(N, v.gx1); gx++) {
        ground(pen, gx, gy, map.get(gx, gy) === 0, contourAt(gx, gy));
      }
    }
  },
  solids: (pen) => { scene = pen; bucket.each(paint); },
  overlay: (pen) => { drawHaze(pen); },
};

boot.onUpdate((dt, tick) => {
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    if (w === undefined) continue;
    const gx = Math.floor(w.x), gy = Math.floor(w.y);
    // Cost 0 is the destination itself, and it is also every walled tile — a walker that reaches
    // either has finished with this crossing and goes back to the west end.
    if (flow.costAt(gx, gy) === 0) { walkers[i] = spawn(i, tick + 1); continue; }
    if (!flow.step(gx, gy, next)) continue;
    const dx = next.gx + 0.5 - w.x, dy = next.gy + 0.5 - w.y;
    const l = Math.max(0.001, Math.hypot(dx, dy));
    w.x += (dx / l) * dt * 3.2;
    w.y += (dy / l) * dt * 3.2;
  }
});

boot.onRender((pen) => {
  drawTime = pen.t;
  bucket.clear();
  addProps(bucket);
  for (let gy = WALL_0; gy < WALL_1; gy++) if (map.get(DIVIDER, gy) === 0) bucket.add(COUNT + gy, DIVIDER, gy, 1, 1, 60);
  for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i];
    if (w !== undefined) bucket.addPoint(i, w.x, w.y, 30, 0.2);
  }
  renderFrame(pen, passes, boot.order);
  // The barriers and the beacon are painted after the sort rather than in it: three gates and one
  // goal are what the exhibit is *about*, and a person must never hide the thing they are queueing
  // for. Everything else in the hall obeys the order.
  for (const g of GATES) barrier(pen, g[0], g[1], map.get(g[0], g[1]) === 0);
  goal(pen, GOAL.gx, GOAL.gy, pen.t);
});

// ── the overlay ─────────────────────────────────────────────────────────────────────────────
const ui = createOverlay({ now: () => boot.loop.realTime * 1000 });
/** The HUD's structure is a fixed tree with fixed labels, written once in `index.html`, which
 *  `docs/GALLERY.md` § Static markup settles as art. Everything below writes numbers into it,
 *  which is logic, and that split is the whole of the boundary the section draws. */
const source = document.getElementById('hud-static');
if (source === null) throw new Error('wayfinding: index.html is missing #hud-static, which holds the whole overlay');
for (const node of source.children) ui.mount(node.cloneNode(true) as HTMLElement);
applyPalette(ui, paletteVars(boot.palette));
const readout = (id: string): HTMLElement => {
  const node = ui.root.querySelector(`#${id}`);
  if (node === null) throw new Error(`wayfinding: #hud-static has no #${id} for the overlay to write into`);
  return node as HTMLElement;
};
const crowdNode = readout('crowd');
const fieldNode = readout('field');
const costCell = readout('cost');
costNode(costCell.parentElement ?? costCell);
ui.every(() => {
  // Two numbers rather than one: the crowd is a constant and the sort is what the cull left, so
  // a visitor dragging the camera can watch the second move while the first does not.
  setText(crowdNode, `${COUNT} · ${boot.order.count} sorted`);
  setText(fieldNode, `v${revision} · ${N * N} tiles`);
  setText(costCell, `${boot.worstMs.toFixed(1)} ms`);
  fieldNode.classList.toggle('pulse', boot.loop.realTime < flashUntil);
});
boot.scope.add(drive(ui, boot));
boot.scope.add(() => { ui.destroy(); });

controlPanel(
  [knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), knobs.tapSlop(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot)],
  { params: boot.params, title: 'Wayfinding', subtitle: 'One field, six hundred and forty readers, one rebuild.', stats: knobs.frameTime(boot) },
);

boot.start();
