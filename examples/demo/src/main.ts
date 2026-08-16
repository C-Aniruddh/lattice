/**
 * LAMP ROAD — a Lattice exhibit. Boot, wiring, and the frame.
 *
 * A valley at dusk, a road climbing from the town gate to a shrine on the ridge, and pilgrims who
 * will not walk into the dark. Tap a marker; the lamp lights; the road runs further; more of them
 * come, and they come back with coin. One to two minutes, no splash, no modal, no sign-in.
 *
 * `?seed=` chooses the valley. Same seed, same valley, every time.
 */
import { asEpochMillis, clamp01, createScope, fmtCompact, hash2, type EpochMillis, type Vec2 } from '@lattice/core';
import {
  DepthSorter,
  boxSilhouette,
  createCamera,
  footprintBase,
  heightAt,
  gridToScreen,
  pathSample,
  pickSorted,
  pointInPolygon,
  tileBounds,
  type GridPoint,
  type Rect,
  type TileRange,
  type Volume,
} from '@lattice/iso';
import {
  FLAG_POWERED,
  beginFrame,
  createCanvas2dSurface,
  createLightField,
  createPalette,
  drawSprite,
  endFrame,
  renderFrame,
  spriteHeightPx,
  spriteVolume,
  wash,
  type Passes,
  type Pen,
  type SpriteDef,
  type Variant,
} from '@lattice/draw';
import { createInput } from '@lattice/input';
import { browserFrames, createLoop, createTweens } from '@lattice/loop';
import { advance, buildFlow, elapsedSeconds, project, zeroStocks, type Ledger } from '@lattice/sim';
import { DAY, DUSK, NIGHT } from './palette.js';
import { GATE, SHRINE, SPACING, STEP_PX, W, H, createValley, stationAt } from './valley.js';
import { coinRate, createRules, cycleAt, daylightAt, gates, lampCost, pilgrims, type Node, type Reach } from './rules.js';
import { drawPilgrim, gate as gateDef, lamp, prop, shrine, site } from './sprites.js';
import { drawSea, drawSky, duskWash, roadRibbon, sandAt, terrainQuad } from './sky.js';
import { drawAmbient } from './ambient.js';
import { createSound } from './sound.js';
import { drawHud, type Hud } from './hud.js';

// ── the world ────────────────────────────────────────────────────────────────────────────────

const now = (): EpochMillis => asEpochMillis(Date.now());
const seed =
  new URLSearchParams(location.search).get('seed') ??
  new URLSearchParams(location.hash.replace(/^#/, '')).get('seed') ??
  'lamp-road';
const valley = createValley(seed);
const reach: Reach = { run: 0 };
const rules = createRules(reach);
const bootMs = Date.now();
const worldSec = (ms: number): number => (ms - bootMs) / 1000;

const litSet = new Set<number>();
let built = 0;
let dark = false;
let ledger: Ledger<Node> = { stocks: { lit: 0, coin: 0 }, atMs: asEpochMillis(bootMs) };
buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);

// ── the screen ───────────────────────────────────────────────────────────────────────────────

const host = document.getElementById('app') ?? document.body;
host.style.cssText = 'position:fixed;inset:0;margin:0;overflow:hidden;background:#0d1226';
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%';
host.append(canvas);

const surface = createCanvas2dSurface(canvas);
const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, W, H, valley.maxHeightPx, worldRect);
const camera = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
  bounds: worldRect,
  minZoom: 0.34,
  maxZoom: 2.6,
  zoom: 0.46,
  keepVisible: 0.5,
});
const palette = createPalette(DAY);
const light = createLightField(surface, { scale: 0.6, falloff: 2.8, bloom: 0.34 });
const order = new DepthSorter(768);
const tweens = createTweens();
const scope = createScope();
const { audio, bed } = createSound();

/**
 * Frame the whole road, gate to shrine, with a margin — on any seed and any viewport.
 *
 * A fixed zoom is a first frame that is wrong on somebody's screen. This walks the path's own
 * nodes in **screen-facing world space** — x from the projection, y from the projection minus the
 * ground height, which is the one place elevation enters a camera decision — and solves for the
 * zoom that fits both spans.
 */
function frameRoad(): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < valley.road.nodeCount; i++) {
    const gx = valley.road.gxAt(i);
    const gy = valley.road.gyAt(i);
    const x = (gx - gy) * 32;
    const y = (gx + gy) * 16 - heightAt(valley.field, gx, gy);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(320, maxX - minX) + 660;
  const spanY = Math.max(320, maxY - minY) + 470;
  const want = Math.min(camera.viewW / spanX, camera.viewH / spanY);
  camera.zoomAt(want / camera.zoom, camera.viewW / 2, camera.viewH / 2);
  // Biased down the screen, because the HUD lives along the top edge and the shrine is high.
  camera.centerOn((minX + maxX) / 2, (minY + maxY) / 2 - 60);
}

function fit(): void {
  const w = Math.max(1, innerWidth);
  const h = Math.max(1, innerHeight);
  surface.resize(w, h, surface.pixelRatio);
  camera.resize(w, h);
  light.resize(w, h);
}
addEventListener('resize', () => {
  fit();
  frameRoad();
});
fit();
frameRoad();

// ── what is in the valley, rebuilt only when it changes ──────────────────────────────────────

interface Thing {
  readonly def: SpriteDef;
  readonly gx: number;
  readonly gy: number;
  readonly v: Variant;
  readonly station: number;
  /** Ground height under the footprint, in world pixels. Kept so the frame allocates nothing. */
  readonly base: number;
}

let dirty = true;
let things: Thing[] = [];

function push(list: Thing[], def: SpriteDef, gx: number, gy: number, flags: number, station: number): void {
  const base = footprintBase(valley.field, { gx, gy, w: def.w, d: def.d });
  list.push({
    def,
    gx,
    gy,
    v: { level: base / STEP_PX, seed: hash2(valley.seed, gx, gy), flags, progress: 1, label: '' },
    station,
    base,
  });
}

function rebuild(): void {
  const list: Thing[] = [];
  push(list, gateDef, GATE.gx - 1, GATE.gy - 1, 0, -1);
  push(list, shrine, SHRINE.gx - 1, SHRINE.gy - 1, FLAG_POWERED, -1);
  const p: GridPoint = { gx: 0, gy: 0 };
  for (let i = 0; i < valley.stations && i <= built; i++) {
    stationAt(valley, i, p);
    const gx = Math.round(p.gx);
    const gy = Math.round(p.gy);
    if (i < built) push(list, lamp, gx, gy, litSet.has(i) ? FLAG_POWERED : 0, i);
    else push(list, site, gx, gy, 0, i);
  }
  for (const t of valley.props) push(list, prop, t.gx, t.gy, t.kind | (t.big ? 8 : 0), -1);
  things = list;
  dirty = false;
}

// ── acting ───────────────────────────────────────────────────────────────────────────────────

const view = zeroStocks(rules.eco);
const runOf = (): number => {
  let n = 0;
  while (litSet.has(n)) n++;
  return n;
};

function commit(atMs: EpochMillis): void {
  ledger = advance(rules.eco, ledger, rules.flow, elapsedSeconds(ledger, atMs), atMs);
}

function light1(station: number, price: number): void {
  const atMs = now();
  commit(atMs);
  if (ledger.stocks.coin < price) {
    audio.play('deny');
    return;
  }
  ledger = { stocks: { ...ledger.stocks, coin: ledger.stocks.coin - price }, atMs: ledger.atMs };
  if (station >= built) built = station + 1;
  litSet.add(station);
  reach.run = runOf();
  ledger = { stocks: { ...ledger.stocks, lit: litSet.size }, atMs: ledger.atMs };
  buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);
  dirty = true;
  audio.play('strike');
  // The flame swells rather than switching on. Four hundred milliseconds is the difference
  // between a lamp being lit and a boolean changing.
  ignitingAt = station;
  tweens.start({ from: 1, to: 0, seconds: 0.7, ease: 'quadOut', slot: 'ignite', onUpdate: (a) => { ignite = a; } });
}

let ignite = 0;
let ignitingAt = -1;

// ── input ────────────────────────────────────────────────────────────────────────────────────

const loop = createLoop({ clock: { now: () => performance.now() }, frames: browserFrames() });
const input = createInput<'touch'>({ element: canvas, camera, stepMs: loop.stepMs, actions: { touch: ['tap'] } });
scope.add(() => {
  input.dispose();
});

const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const sil = new Float64Array(12);
const tap: Vec2 = { x: 0, y: 0 };
let px = 0;
let py = 0;
const hits = (index: number): boolean => {
  const t = things[index];
  if (t === undefined || t.station < 0) return false;
  spriteVolume(t.def, t.v, vol);
  boxSilhouette(camera, t.gx, t.gy, vol, sil);
  if (pointInPolygon(px, py, sil, 6)) return true;
  // The bubble over an unlit marker is the affordance, and it floats above the massing that
  // `spriteVolume` measures — so the tap target has to include it explicitly.
  if (litSet.has(t.station)) return false;
  gridToScreen(camera, t.gx + 0.34, t.gy + 0.66, t.base + 2.2 * 26, tap);
  const dx = px - tap.x;
  const dy = py - tap.y;
  return dx * dx + dy * dy < (18 * camera.zoom) ** 2;
};

input.onAction('touch', (e) => {
  audio.unlock();
  px = e.sx;
  py = e.sy;
  const hit = pickSorted(order, hits);
  const t = hit >= 0 ? things[hit] : undefined;
  if (t === undefined || t.station < 0) return;
  if (litSet.has(t.station)) return;
  light1(t.station, t.station >= built ? lampCost(built) : 0);
});

// ── the frame ────────────────────────────────────────────────────────────────────────────────

let daylight = 1;
let cycle = 0;
let walkers = 3;
let sand = sandAt(1);
const here: GridPoint = { gx: 0, gy: 0 };
const range: TileRange = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const reachPx = (): number => Math.max(reach.run * SPACING, SPACING * 3.4);

loop.onUpdate((dt, tick) => {
  input.tick(tick);
  const atMs = now();
  const t = worldSec(atMs);
  daylight = daylightAt(t);
  cycle = cycleAt(t);
  const nightNow = daylight < 0.5;
  if (nightNow !== dark) {
    // A gate is a boundary, not a curve: commit what is owed, then change the rate.
    commit(atMs);
    dark = nightNow;
    buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);
    audio.play('chime');
  }
  project(rules.eco, ledger, rules.flow, atMs, view);
  walkers = Math.max(8, Math.round(pilgrims(reach)));
  tweens.step(dt);
  bed.set(clamp01(0.3 + reach.run / 9), daylight);
});

function walkerAt(i: number, t: number, out: GridPoint): number {
  const span = reachPx();
  const loopPx = span * 2;
  const speed = 26 + (hash2(0x9d1, i, 9) % 9);
  const s = (t * speed + (i / walkers) * loopPx) % loopPx;
  pathSample(valley.road, s < span ? s : loopPx - s, out);
  return heightAt(valley.field, out.gx, out.gy);
}

const passes: Passes = {
  backdrop(pen) {
    drawSky(pen, daylight, cycle);
  },
  terrain(pen, visible) {
    drawSea(pen, valley.seed, daylight);
    // `renderFrame` computes this range itself, on the *ground plane*, and gives a game no way to
    // pass `marginTiles` — so a mountain whose base is off the bottom edge loses its summit. The
    // margin has to be re-applied here, from the map's own maximum elevation.
    const grow = Math.ceil(valley.maxHeightPx / 32) + 2;
    range.gx0 = visible.gx0 - grow;
    range.gy0 = visible.gy0 - grow;
    range.gx1 = visible.gx1 + grow;
    range.gy1 = visible.gy1 + grow;
    valley.terrain.forEach(range, (gx, gy) => {
      terrainQuad(pen, valley, gx, gy, daylight, sand);
    });
    roadRibbon(pen, valley, daylight, reach.run * SPACING);
  },
  solids(pen, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const index = sorted.indexAt(i);
      const t = things[index];
      if (t !== undefined) {
        drawSprite(pen, t.def, t.gx, t.gy, t.v);
        continue;
      }
      const id = index - things.length;
      const z = walkerAt(id, pen.t, here);
      drawPilgrim(pen, id, here.gx, here.gy, z, pen.t);
    }
  },
  overlay(pen) {
    // Ambient life and the dusk wash go *above* the night mask and *below* the HUD, which is the
    // only ordering in which fireflies glow and the coin pill stays readable at midnight.
    drawAmbient(pen, valley, daylight);
    const tint = duskWash(pen, daylight);
    if (tint !== null) wash(pen, tint);
    drawHud(pen, hud());
  },
};

loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);
  if (dirty) rebuild();
  sand = sandAt(daylight);
  palette.lerp(
    daylight > 0.5 ? DUSK : NIGHT,
    daylight > 0.5 ? DAY : DUSK,
    daylight > 0.5 ? (daylight - 0.5) * 2 : daylight * 2,
  );
  const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky', light });
  light.begin(pen, (1 - daylight) * 0.62, 'night');
  if (ignite > 0.01 && ignitingAt >= 0) {
    stationAt(valley, ignitingAt, here);
    light.add(here.gx, here.gy, heightAt(valley.field, here.gx, here.gy), 3 + ignite * 9, ignite, 'warn');
  }
  order.clear();
  for (const t of things) {
    order.add(t.gx, t.gy, t.def.w, t.def.d, t.base + spriteHeightPx(t.def, t.v));
  }
  for (let i = 0; i < walkers; i++) {
    // `walkerAt` fills `here`, so it must run before the arguments that read it.
    const z = walkerAt(i, time, here) + 22;
    order.addPoint(here.gx, here.gy, z, 0.2);
  }
  renderFrame(pen, passes, order);
  endFrame(pen);
});

// ── the one line of text ─────────────────────────────────────────────────────────────────────

function hud(): Hud {
  const price = lampCost(built);
  const done = reach.run >= valley.stations;
  return {
    objective: done
      ? 'The road is lit all the way to the shrine.'
      : built === 0
        ? 'Light the first lamp. It is free.'
        : view.coin >= price
          ? `Light the next lamp — ${fmtCompact(price)} coin.`
          : `The pilgrims are walking. Next lamp: ${fmtCompact(price)} coin.`,
    coin: view.coin,
    coinRate: coinRate(reach) * (dark ? 1.7 : 1),
    lit: reach.run,
    stations: valley.stations,
    walkers,
    daylight,
    showCoin: built > 0,
  };
}

// A soft offering at the gate every few seconds, on `loop.real` rather than the fixed step, so
// it keeps its own time whatever the frame rate is doing.
loop.real.every(3.5, () => {
  if (reach.run > 0) audio.play('coin', { gain: 0.5 });
});

loop.start();
