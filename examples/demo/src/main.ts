/**
 * LAMP ROAD — a Lattice exhibit. Wiring, and the frame.
 *
 * A valley at dusk, a road climbing from the town gate to a shrine on the ridge, and pilgrims who
 * will not walk into the dark. Tap a marker; the lamp lights; the road runs further; more of them
 * come, and they come back with coin. One to two minutes, no splash, no modal, no sign-in.
 *
 * `?seed=` chooses the valley. Same seed, same valley, every time.
 *
 * **There is no boot in this file.** The canvas, the surface, the camera, the palette, the light
 * field, the depth sorter, the tweens, the loop and the input system are `bootstrap()` from
 * `examples/_shared`, which exists because the thirty lines it replaces contain two mistakes that
 * are *silent* when you make them — a `stepMs` literal beside a loop that runs at 16.667, and a
 * light field that was never attached to the pen. Neither is available to be made here any more.
 */
import { asEpochMillis, clamp01, hash2, type EpochMillis } from '@latticekit/core';
import {
  boxSilhouette,
  footprintBase,
  gridToWorldX,
  gridToWorldY,
  heightAt,
  pathSample,
  pickSorted,
  pointInPolygon,
  rectMakeEmpty,
  tileBounds,
  type GridPoint,
  type Rect,
  type Volume,
} from '@latticekit/iso';
import {
  FLAG_POWERED,
  drawSprite,
  renderFrame,
  spriteHeightPx,
  spriteVolume,
  wash,
  type Passes,
  type SpriteDef,
  type Variant,
} from '@latticekit/draw';
import { drive } from '@latticekit/ui';
import { advance, buildFlow, elapsedSeconds, project, zeroStocks, type Ledger } from '@latticekit/sim';
import { bootstrap } from '../../_shared/src/index.js';
import { DAY, DUSK, NIGHT } from './palette.js';
import { GATE, SHRINE, SPACING, W, H, createValley, stationAt } from './valley.js';
import { coinRate, createRules, cycleAt, daylightAt, gates, lampCost, pilgrims, type Node, type Reach } from './rules.js';
import { drawPilgrim, gate as gateDef, lamp, lodOf, prop, shrine, site } from './sprites.js';
import { drawSea, drawSky, drawTerrain, duskWash, farRanges, roadRibbon } from './sky.js';
import { drawAmbient } from './ambient.js';
import { createSound } from './sound.js';
import { createHud, type Hud } from './hud.js';

// ── the screen, and the world it is looking at ───────────────────────────────────────────────

const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const boot = bootstrap<'touch'>({
  seed: 'lamp-road',
  bounds: worldRect,
  background: '#0d1226',
  camera: { zoom: 0.46, minZoom: 0.34, maxZoom: 2.6, keepVisible: 0.5 },
  palette: DAY,
  clear: 'sky',
  light: { scale: 0.6, falloff: 2.8, bloom: 0.34 },
  depth: 768,
  actions: { touch: ['tap'] },
});

// The camera's bounds are the map's, and the map is not generated until the seed is known —
// which `bootstrap` is the thing that reads. So the rectangle goes in empty and is filled here.
// `Camera` copies it at construction rather than holding the reference, so `setBounds` is not
// optional politeness; it is the only way the second half of that order gets across.
const valley = createValley(boot.seed);
tileBounds(0, 0, W, H, valley.maxHeightPx, worldRect);
boot.camera.setBounds(worldRect);
// And the same map, said once more to `input` — which is the seam K44 added and the reason this
// exhibit is named in `terrain.ts`. Lamp Road is a river valley with a ridge road above it; on that
// ground the sea-level inverse of the projection lands **212 to 237 px** uphill of the finger,
// which is a tile or two of a plausible-looking wrong answer that nothing downstream can catch.
// The taps here go through `boxSilhouette`, so they were never exposed to it — but a declaration is
// about the ground rather than about today's handlers, and the ceiling is the one the terrain cull
// already measured rather than a second guess at the tallest thing on the map.
boot.setTerrain({ field: valley.field, maxHeightPx: valley.maxHeightPx });

const reach: Reach = { run: 0 };
const rules = createRules(reach);
/**
 * The clock, and there is only one — `boot.loop`'s.
 *
 * `Date.now()` and `performance.now()` are both banned in exhibit source, and `sim`'s ledger
 * wants an `EpochMillis` rather than a duration, so the epoch is **chosen**: a fixed origin plus
 * `loop.realTime`, which is the same monotonic accumulation the frame pump already made and the
 * same one the overlay is driven from. Nothing here is persisted or hashed, so the origin costs
 * nothing — and choosing one is what makes the exhibit replayable from its seed, which a wall
 * clock never was. Two clocks in one game is a poll racing a settle; this file now has none.
 */
const ORIGIN = 1_700_000_000_000;
const now = (): EpochMillis => asEpochMillis(ORIGIN + boot.loop.realTime * 1000);

const litSet = new Set<number>();
let built = 0;
let dark = false;
let ledger: Ledger<Node> = { stocks: { coin: 0 }, atMs: asEpochMillis(ORIGIN) };
buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);
const { audio, bed } = createSound();

/**
 * Frame the whole road, gate to shrine, with a margin — on any seed and any viewport.
 *
 * A fixed zoom is a first frame that is wrong on somebody's screen. This walks the path's own
 * nodes in **screen-facing world space** — x from the projection, y from the projection minus the
 * ground height, which is the one place elevation enters a camera decision — and hands the box to
 * `camera.fitBounds`, which solves for the zoom and the center together.
 *
 * The rectangle is then grown by what *stands* on the road rather than by a tuned margin: a shrine
 * is six storeys of roof and prayer flags above its own node, and a rectangle that only knows
 * about the ground plane frames a summit off the top of the screen. Growing it asymmetrically is
 * also what biases the composition down the screen, where the HUD's own dock is not.
 */
const roadRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
/**
 * How far the valley either side of the road should stay in frame, in world pixels.
 *
 * It came down from 300 for `docs/GALLERY.md` § Scale, and the row it is answering is **extent**:
 * a smaller overhang is a *tighter* fit on the road, which raises the fitted zoom, which is what
 * pushes the valley's own edges off the frame. The map is 4,096 world pixels across against a
 * viewport that holds about 1,400, so the composition is a window on a valley rather than a
 * picture of one, and every direction but up has more of it in it.
 */
const OVERHANG_PX = 205;
/**
 * The shrine's roof and prayer flags above its own node, and the meadow below the gate.
 *
 * The two are deliberately lopsided and it is the whole vertical composition: growing the
 * rectangle further up than down moves the *center* up the valley, which is what brings the coast,
 * the far ranges and the sky into a frame the road would otherwise fill on its own.
 */
const ABOVE_PX = 336;
const BELOW_PX = 248;
/** Gutter in CSS pixels, so it is the same gutter at every fitted zoom. */
const MARGIN_PX = 28;

function frameRoad(): void {
  rectMakeEmpty(roadRect);
  for (let i = 0; i < valley.road.nodeCount; i++) {
    const gx = valley.road.gxAt(i);
    const gy = valley.road.gyAt(i);
    const x = gridToWorldX(gx, gy);
    const y = gridToWorldY(gx, gy) - heightAt(valley.field, gx, gy);
    if (x < roadRect.minX) roadRect.minX = x;
    if (x > roadRect.maxX) roadRect.maxX = x;
    if (y < roadRect.minY) roadRect.minY = y;
    if (y > roadRect.maxY) roadRect.maxY = y;
  }
  roadRect.minX -= OVERHANG_PX;
  roadRect.maxX += OVERHANG_PX;
  roadRect.minY -= ABOVE_PX;
  roadRect.maxY += BELOW_PX;
  boot.camera.fitBounds(roadRect, MARGIN_PX);
}
boot.onResize(frameRoad);
frameRoad();

// ── what is in the valley, rebuilt only when it changes ──────────────────────────────────────

interface Thing {
  readonly def: SpriteDef;
  readonly gx: number;
  readonly gy: number;
  readonly v: Variant;
  readonly station: number;
  /** Ground height under the footprint, in world pixels. It is what `drawSprite`, `spriteVolume`
   *  and `DepthSorter.add` are each handed, so the picture, the tap target and the sort order
   *  cannot disagree about which hill this is standing on. */
  readonly base: number;
}

/**
 * Two lists, and the split is `docs/GALLERY.md` § The cost row rather than tidiness.
 *
 * It was one list rebuilt whenever a lamp was lit. At 64 tiles that was 120 objects and nobody
 * noticed; at 96 it is **six hundred**, each with a `Variant`, a footprint literal and a
 * `footprintBase` sample — and the rebuild fires on the one input the whole exhibit has, so the
 * worst frame of the last ten seconds landed on the frame the player just tapped. Measured: a
 * 19.6 ms spike under repeated taps against a steady 4–7 ms.
 *
 * {@link scenery} is the gate, the shrine and every tree, none of which has ever changed after
 * boot. {@link markers} is the fifteen-odd stations, which are the only things a tap moves.
 */
const scenery: Thing[] = [];
let markers: Thing[] = [];
let dirty = true;

/** Reused by {@link push}: `footprintBase` takes a footprint, and six hundred literals at boot is
 *  six hundred objects for the collector to walk on the frame after the first tap. */
const foot = { gx: 0, gy: 0, w: 1, d: 1 };

function push(list: Thing[], def: SpriteDef, gx: number, gy: number, flags: number, station: number): void {
  foot.gx = gx;
  foot.gy = gy;
  foot.w = def.w;
  foot.d = def.d;
  list.push({
    def,
    gx,
    gy,
    v: { level: 1, seed: hash2(valley.seed, gx, gy), flags, progress: 1, label: '' },
    station,
    base: footprintBase(valley.field, foot),
  });
}

push(scenery, gateDef, GATE.gx - 1, GATE.gy - 1, 0, -1);
push(scenery, shrine, SHRINE.gx - 1, SHRINE.gy - 1, FLAG_POWERED, -1);
for (const t of valley.props) push(scenery, prop, t.gx, t.gy, t.kind | (t.big ? 8 : 0), -1);

function rebuild(): void {
  const list: Thing[] = [];
  const p: GridPoint = { gx: 0, gy: 0 };
  for (let i = 0; i < valley.stations && i <= built; i++) {
    stationAt(valley, i, p);
    const gx = Math.round(p.gx);
    const gy = Math.round(p.gy);
    if (i < built) push(list, lamp, gx, gy, litSet.has(i) ? FLAG_POWERED : 0, i);
    else push(list, site, gx, gy, 0, i);
  }
  markers = list;
  dirty = false;
}

/**
 * The frame bucket: every drawable this frame, in the sorter's own index space.
 *
 * A `Thing` is a sprite; a bare number is a pilgrim's id. One array, filled in the same loop that
 * fills the sorter, so the only expression that ever reads it is `frame[order.indexAt(i)]`. It
 * used to be two collections and an offset — `index - things.length` — which is arithmetic that is
 * correct only while three unchecked facts hold at once, and whose failure is a tap opening the
 * thing *behind* the thing under the player's finger.
 *
 * `count` rather than `length = 0`: truncating an array frees its backing store and buys a
 * reallocation on the next frame, sixty times a second.
 */
type Drawable = Thing | number;
const frame: Drawable[] = [];
let frameCount = 0;

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
    hud.say('too-dear', 'Not yet. The pilgrims already on the road are still paying for that one.', 'bad');
    return;
  }
  ledger = { stocks: { ...ledger.stocks, coin: ledger.stocks.coin - price }, atMs: ledger.atMs };
  if (station >= built) built = station + 1;
  litSet.add(station);
  reach.run = runOf();
  // `reach` moved, and the edge's scale is sampled once per `buildFlow` — so the rebuild is not
  // bookkeeping, it is the only thing that makes the new lamp pay.
  buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);
  dirty = true;
  audio.play('strike');
  hud.say('first-lamp', 'Lit. Pilgrims walk as far as the light reaches, and no further.', 'good');
  if (reach.run >= valley.stations) {
    hud.say('road-done', 'The road is lit all the way to the shrine.', 'good');
  }
  // The flame swells rather than switching on. Four hundred milliseconds is the difference
  // between a lamp being lit and a boolean changing.
  ignitingAt = station;
  boot.tweens.start({ from: 1, to: 0, seconds: 0.7, ease: 'quadOut', slot: 'ignite', onUpdate: (a) => { ignite = a; } });
}

/** Light the frontier — what the HUD button does, and the same call the world's tap makes. */
function lightNext(): void {
  audio.unlock();
  if (built >= valley.stations) return;
  light1(built, lampCost(built));
}

let ignite = 0;
let ignitingAt = -1;

// ── input ────────────────────────────────────────────────────────────────────────────────────

const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const sil = new Float64Array(12);
let px = 0;
let py = 0;
/**
 * Is the tap inside this drawable's silhouette?
 *
 * `spriteVolume`'s fourth argument is the ground under the footprint, and omitting it is the bug
 * this exhibit shipped: the volume is then measured at sea level while the lamp is painted up the
 * hill, so on the highest station of three seeds the silhouette sat **212 to 237 CSS pixels below
 * the art** and every tap there landed in mid-air. It was half-hidden by a bubble fallback that
 * *did* know the elevation, which is why nothing looked broken — the marker still lit, through a
 * circle test that no longer had anything to do with what was on screen.
 */
const hits = (index: number): boolean => {
  const t = frame[index];
  if (typeof t !== 'object' || t.station < 0 || litSet.has(t.station)) return false;
  spriteVolume(t.def, t.v, vol, t.base);
  boxSilhouette(boot.camera, t.gx, t.gy, vol, sil);
  return pointInPolygon(px, py, sil, 6);
};

boot.onAction('touch', (e) => {
  audio.unlock();
  px = e.sx;
  py = e.sy;
  const hit = pickSorted(boot.order, hits);
  if (hit < 0) return;
  const t = frame[hit];
  if (typeof t !== 'object') return;
  light1(t.station, t.station >= built ? lampCost(built) : 0);
});

// ── the frame ────────────────────────────────────────────────────────────────────────────────

let daylight = 1;
let cycle = 0;
let walkers = 3;
const here: GridPoint = { gx: 0, gy: 0 };
const reachPx = (): number => Math.max(reach.run * SPACING, SPACING * 3.4);

boot.onUpdate(() => {
  const atMs = now();
  const t = boot.loop.realTime;
  daylight = daylightAt(t);
  cycle = cycleAt(t);
  const nightNow = daylight < 0.5;
  if (nightNow !== dark) {
    // A gate is a boundary, not a curve: commit what is owed, then change the rate.
    commit(atMs);
    dark = nightNow;
    buildFlow(rules.eco, ledger.stocks, gates(dark), rules.flow);
    audio.play('chime');
    if (dark) hud.say('dusk', 'Dusk. Offerings are worth more after dark — and the road is longer.');
  }
  project(rules.eco, ledger, rules.flow, atMs, view);
  walkers = Math.max(8, Math.round(pilgrims(reach)));
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
    farRanges(pen, valley.seed);
  },
  // The Terrain cull is `renderFrame`'s, computed on the ground plane, and this is the number it
  // needs to margin it: the map's own tallest elevation. Without it a 440-pixel summit vanishes
  // the moment its base leaves the bottom edge.
  maxHeightPx: valley.maxHeightPx,
  terrain(pen, visible) {
    drawSea(pen, valley.seed, daylight);
    drawTerrain(pen, valley, visible, daylight);
    roadRibbon(pen, valley, daylight, reach.run * SPACING);
  },
  solids(pen, sorted) {
    for (let i = 0; i < sorted.count; i++) {
      const d = frame[sorted.indexAt(i)];
      if (typeof d === 'number') {
        const z = walkerAt(d, pen.t, here);
        drawPilgrim(pen, d, here.gx, here.gy, z, pen.t);
      } else if (d !== undefined) {
        // The one level-of-detail decision in the exhibit; `sprites.ts` owns both the threshold
        // and the cheaper sprite, and `order.add` above kept the *detailed* height, so the cull
        // margin stays the conservative one either way.
        drawSprite(pen, lodOf(d.def, pen.camera.zoom), d.gx, d.gy, d.v, d.base);
      }
    }
  },
  overlay(pen) {
    // Ambient life and the dusk wash go *above* the night mask. The HUD is no longer here at all:
    // it is DOM, over the canvas, and it darkens with the world through `paletteVars`.
    drawAmbient(pen, valley, daylight);
    const tint = duskWash(pen, daylight);
    if (tint !== null) wash(pen, tint);
  },
};

let sealedMs = 0;
let windowAt = 0;
/**
 * The worst frame of the last ten seconds — the number `docs/GALLERY.md` § The cost row gates on.
 *
 * `loop.stats` keeps a high-water mark since the last reset, so a naive "reset every ten seconds"
 * reports the worst frame of the last *zero to ten*, and a visitor who looks a moment after a
 * reset is shown a healthy number for a scene that just stuttered. So the previous window is
 * **sealed** rather than discarded and the readout is the larger of the two: the mark always
 * covers between five and ten seconds of history and never less.
 *
 * A mark taken from page load would be the other failure — the one slow first frame every visitor
 * pays would sit on the readout for the rest of the visit.
 */
function worstMs(): number {
  const t = boot.loop.realTime;
  if (t - windowAt >= 5) {
    windowAt = t;
    sealedMs = boot.loop.stats.worstFrameMs;
    boot.loop.resetStats();
  }
  return Math.max(sealedMs, boot.loop.stats.worstFrameMs);
}

boot.onRender((pen) => {
  if (dirty) rebuild();
  boot.palette.lerp(
    daylight > 0.5 ? DUSK : NIGHT,
    daylight > 0.5 ? DAY : DUSK,
    daylight > 0.5 ? (daylight - 0.5) * 2 : daylight * 2,
  );
  boot.light.begin(pen, (1 - daylight) * 0.62, 'night');
  if (ignite > 0.01 && ignitingAt >= 0) {
    stationAt(valley, ignitingAt, here);
    boot.light.add(here.gx, here.gy, heightAt(valley.field, here.gx, here.gy), 3 + ignite * 9, ignite, 'warn');
  }
  boot.order.clear();
  frameCount = 0;
  for (const t of scenery) {
    frame[frameCount++] = t;
    boot.order.add(t.gx, t.gy, t.def.w, t.def.d, t.base + spriteHeightPx(t.def, t.v));
  }
  for (const t of markers) {
    frame[frameCount++] = t;
    boot.order.add(t.gx, t.gy, t.def.w, t.def.d, t.base + spriteHeightPx(t.def, t.v));
  }
  for (let i = 0; i < walkers; i++) {
    // `walkerAt` fills `here`, so it must run before the arguments that read it.
    const z = walkerAt(i, pen.t, here) + 22;
    frame[frameCount++] = i;
    boot.order.addPoint(here.gx, here.gy, z, 0.2);
  }
  renderFrame(pen, passes, boot.order);
});

// ── the HUD, which is DOM ────────────────────────────────────────────────────────────────────

function hudState(): Hud {
  const price = lampCost(built);
  const done = reach.run >= valley.stations;
  return {
    objective: done
      ? 'The road is lit all the way to the shrine.'
      : built === 0
        ? 'Light the first lamp. It is free.'
        : view.coin >= price
          ? 'Tap the next marker on the road.'
          : 'The pilgrims are walking. Wait for the offerings.',
    coin: view.coin,
    coinRate: coinRate(reach) * (dark ? 1.7 : 1),
    lit: reach.run,
    stations: valley.stations,
    walkers,
    daylight,
    showCoin: built > 0,
    price,
    affordable: view.coin >= price,
    drawn: boot.order.count,
    worstMs: worstMs(),
  };
}

const hud = createHud({
  palette: boot.palette,
  read: hudState,
  onLight: lightNext,
  // The loop's own clock, in milliseconds. `performance.now()` is banned in exhibit source and
  // `bootstrap` hands back no reader for the `Clock` it built the loop with — a kit finding, and
  // `realTime` is that same monotonic reading, already accumulated.
  now: () => boot.loop.realTime * 1000,
});
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);

// A soft offering at the gate every few seconds, on `loop.real` rather than the fixed step, so
// it keeps its own time whatever the frame rate is doing.
boot.loop.real.every(3.5, () => {
  if (reach.run > 0) audio.play('coin', { gain: 0.5 });
});

boot.start();

