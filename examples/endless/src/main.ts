/**
 * ENDLESS — a Lattice exhibit. The wiring, the streaming, and the frame.
 *
 * A world with no edge. Drag in any direction for as long as you like: the ground ahead is minted
 * from the seed and its own coordinates as it comes into range, the ground behind is thrown away,
 * and nothing is ever loaded from anywhere. `?seed=` chooses the world, and the same seed is the
 * same coastline, the same wood and the same pixel — today, tomorrow, and on an engine that rounds
 * `Math.pow` differently, which is why nothing in `chunks.ts` calls it.
 *
 * ## The three properties, in the order they break
 *
 * **1. Deterministic from position.** `chunks.ts` has the argument. This file's part is the pin:
 * mark the chunk under the middle of the frame, pan until the HUD says it has been evicted, come
 * back, and the two `hashBytes` fingerprints are compared in front of you. That is the exhibit,
 * made performable rather than asserted.
 *
 * **2. Bounded memory.** `MAX_CHUNKS` is a hard ceiling and the HUD carries the live count, the
 * bytes it works out to, and the eviction counter beside it. A world that is infinite because it
 * never frees anything is a leak with a nice story.
 *
 * **3. No hitch at a chunk boundary.** Minting is budgeted per frame and prefetched two chunks
 * beyond the frame, and the HUD carries **the worst frame of the last ten seconds** — never an
 * average, because 16 ms mean with every eighth frame at 40 ms is a visible stutter and a
 * healthy-looking number, which is exactly the shape a minting hitch has.
 *
 * ## The camera has no bounds, and that had to be decided rather than omitted
 *
 * `bootstrap`'s `bounds` is optional and `createCamera`'s default is ±10,000 world pixels — about
 * ±312 tiles, which its own comment calls "effectively unbounded" and which this exhibit crosses in
 * fourteen screens of dragging. So a rectangle is passed, and it is enormous on purpose:
 * `keepVisible` clamps against `bounds`, so there is no way here to say "no bounds", and the honest
 * move is to name a number nobody can reach. It is reported as a finding rather than worked around
 * in silence.
 *
 * ## What is logic here and what is not
 *
 * This file, `chunks.ts` and `hud.ts` are counted. `palette.ts`, `sky.ts`, `terrain.ts` and
 * `things.ts` each carry `@art`: delete any one and the world still generates, still streams, still
 * evicts and still fingerprints identically. `things.ts` owns which trees enter the depth sorter as
 * well as what they look like, because both are questions about the picture and no decision
 * anywhere reads the answer — and the HUD's whole structure is in `index.html`, uncounted, beside
 * the stylesheet that is already art by name.
 */
import { worldToGrid, type GridPoint, type Rect } from '@latticekit/iso';
import { renderFrame, type Passes } from '@latticekit/draw';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
import { AFTERNOON } from './palette.js';
import * as world from './chunks.js';
import { drawThings, standThings } from './things.js';
import { drawSky } from './sky.js';
import { drawHaze, paintGround } from './terrain.js';
import { createHud } from './hud.js';

/** Chunks one frame may pay to generate. Eight is more than the fastest fling crosses, so the
 *  prefetch ring is never behind; the number exists at all because a frame that mints on demand
 *  with no ceiling is a frame that hitches on exactly the boundary a visitor is looking at. The
 *  **opening** frame is the deliberate exception — see the priming call below `boot.start`. */
const BUDGET = 8;
/** How far out the camera may go. Not "no bounds", because there is no way to say that — see the
 *  header. About ±1.2 million tiles, well inside the ~2^24 that `core.noise` promises. */
const bounds: Rect = { minX: -4e7, minY: -4e7, maxX: 4e7, maxY: 4e7 };
const boot = bootstrap({
  // The one exhibit that can declare its ground at construction: `world.field` is a module-level
  // `HeightField` over a `cell` lookup, so it exists before the seed does and is still the same
  // object after `world.open`. Everywhere else the map is generated from `boot.seed` and the
  // declaration has to be `boot.setTerrain` a line later.
  seed: 'endless', bounds, background: '#8fc4e8', palette: AFTERNOON, clear: 'sky', depth: 3000,
  terrain: { field: world.field, maxHeightPx: world.MAX_HEIGHT_PX },
  camera: { zoom: 0.78, minZoom: 0.5, maxZoom: 2.4, keepVisible: 0 },
  light: { scale: 0.6, falloff: 2.4, bloom: 0.42 },
});
world.open(boot.seed);

/**
 * Mint what the camera wants and evict what it does not — one walk of the chunk rectangle.
 *
 * The rectangle is the bounding box of `world`'s window in chunk space and over-covers it by about
 * half; `world.wanted` rejects the corners for one comparison each. Nothing off the side of the
 * frame is ever minted, swept or sorted, which in a world with no edge is not an optimization —
 * it is the only reason the frame is finite.
 */
function stream(left: number): void {
  const cy1 = (Math.ceil((world.dNear - world.sMin) / 2) >> 4) + 3;
  const cx1 = (Math.ceil((world.dNear + world.sMax) / 2) >> 4) + 3;
  for (let cy = (Math.floor((world.dFar - world.sMax) / 2) >> 4) - 3; cy <= cy1; cy++) {
    for (let cx = (Math.floor((world.dFar + world.sMin) / 2) >> 4) - 3; cx <= cx1; cx++) {
      if (!world.wanted(cx, cy)) continue;
      const chunk = world.chunks.get(world.keyOf(cx, cy));
      if (chunk !== undefined) chunk.tick = world.tick;
      else if (left > 0) { world.mint(cx, cy); left -= 1; }
    }
  }
  world.sweep();
}

// ── the tail, which is the number a visitor should be watching ────────────────────────────────
//
// Ten one-second buckets of the worst frame *interval* in each, reported as the maximum over all
// ten: a rolling ten-second worst, and never an average. The interval rather than
// `loop.stats.frameMs`, because that field is a one-eighth exponential average by contract — a
// single 40 ms hitch moves it by 3 ms and is gone inside two seconds, which is precisely the
// failure § Scale's cost row names.
const worst = new Float64Array(10);
let slot = 0;
let ends = 0;
let last = 0;

/** The maximum over the ten buckets. The reducer is hoisted rather than written inline, because an
 *  arrow inside the call is a closure allocated on every read of the HUD. */
const maxOf = (a: number, b: number): number => Math.max(a, b);
const worstMs = (): number => worst.reduce(maxOf, 0);

// ── the pin: the demonstration, performed rather than asserted ────────────────────────────────
//
// `verdict` is 0 while the answer is not yet known, 1 once the chunk has come back bit-identical,
// and −1 if it ever comes back different — which would be the most interesting bug report this
// repository has received.
let pin: { cx: number; cy: number; mark: number; gone: boolean; verdict: number } | undefined;
const here: GridPoint = { gx: 0, gy: 0 };

/** Grid position at the middle of the frame, into a hoisted point. Every readout and both travel
 *  buttons measure from it, and `iso` owns the inversion so this file never writes it out. */
const middle = (): GridPoint => worldToGrid(boot.camera.x, boot.camera.y, here);

function setPin(): void {
  const cx = Math.round(middle().gx) >> 4;
  const cy = Math.round(middle().gy) >> 4;
  const chunk = world.chunks.get(world.keyOf(cx, cy));
  if (chunk !== undefined) pin = { cx, cy, mark: world.fingerprint(chunk), gone: false, verdict: 0 };
}

/** Watch it leave, and watch it come back. One map lookup a frame. */
function judge(): void {
  if (pin === undefined) return;
  const chunk = world.chunks.get(world.keyOf(pin.cx, pin.cy));
  if (chunk === undefined) pin.gone = true;
  else if (pin.gone && pin.verdict === 0) pin.verdict = world.fingerprint(chunk) === pin.mark ? 1 : -1;
}

// ── the frame ─────────────────────────────────────────────────────────────────────────────────

const passes: Passes = { backdrop: drawSky, maxHeightPx: world.MAX_HEIGHT_PX, terrain: paintGround, solids: drawThings, overlay: drawHaze };

/** Something has to move before a visitor does anything, and here the thing that moves is the
 *  world going past — which is also the fastest way to show the chunk counters doing their job. It
 *  stops on the first gesture, because a camera that keeps drifting under a drag is a fight. */
let drifting = true;
const stopDrift = (): void => { drifting = false; };
boot.on('dragstart', stopDrift);
boot.on('zoom', stopDrift);
/**
 * **Streaming is state, and state goes on `update`.** `@latticekit/loop`'s own table is explicit —
 * *"pixels, and nothing else"* on render, *"rules, HUD data, anything that must not freeze"* on
 * update — and this was on render first, which meant that a tab behind another one stopped minting
 * while its camera kept moving: come back and the world ahead is flat waterline until the next
 * paint catches up. The window is read here too, one input tick ahead of the paint that uses it,
 * which the prefetch ring is two chunks wider than to absorb.
 */
boot.onUpdate((dt) => {
  if (drifting) boot.camera.centerOn(boot.camera.x + 15 * dt, boot.camera.y + 27 * dt);
  world.look(boot.camera);
  stream(BUDGET);
  judge();
});

boot.onRender((pen, _alpha, nowMs) => {
  if (nowMs >= ends) { slot = (slot + 1) % worst.length; worst[slot] = 0; ends = nowMs + 1000; }
  // Deltas over a quarter second are not frames — they are a tab that was in the background, where
  // `browserFrames` keeps the *update* pump running and rAF stops entirely. Counting one would
  // report a 96-second worst frame, which is the first thing this readout actually did.
  if (last > 0 && nowMs - last > (worst[slot] ?? 0) && nowMs - last < 250) worst[slot] = nowMs - last;
  last = nowMs;
  standThings(boot.order);
  boot.light.begin(pen, 0.24, 'night');
  renderFrame(pen, passes, boot.order);
});

// ── the overlay, which is DOM, and the panel, which is the gallery's ──────────────────────────

/** The five readings, in the order `index.html` lays its cells out. Formatting is here rather than
 *  in `hud.ts` so that the overlay knows nothing about the world and the world knows nothing about
 *  the DOM — which is what lets the HUD's entire structure live in `index.html` as art, and what
 *  makes `hud.ts` fifteen lines instead of a hundred. */
const read = (): readonly string[] => [
  `${Math.round(middle().gx)}, ${Math.round(middle().gy)}`,
  `${world.chunks.size} / ${world.MAX_CHUNKS}`,
  `${((world.chunks.size * world.CHUNK * world.CHUNK * 2) / 1024).toFixed(0)} KiB`,
  `${world.minted} / ${world.evicted}`,
  `${worstMs().toFixed(1)} ms`,
  pin === undefined ? '' : `Chunk ${pin.cx}, ${pin.cy}`,
];

/** Class names on the HUD root, so one string carries every conditional the stylesheet needs and
 *  the overlay has no branch in it at all — the four sentences the pin can say are five `<p>`s in
 *  `index.html` that CSS switches between. Red above 20 ms rather than 16.7: one frame of slack, so
 *  a browser that schedules a paint late does not accuse the exhibit of a hitch it did not cause. */
const state = (): string =>
  `${worstMs() > 20 ? 'hot ' : ''}${pin === undefined ? 'none' : pin.verdict === 1 ? 'good' : pin.verdict === -1 ? 'bad' : pin.gone ? 'gone' : 'wait'}`;

const goPin = (): void => { if (pin !== undefined) boot.camera.centerOnTile(pin.cx * world.CHUNK + 8, pin.cy * world.CHUNK + 8); };
const hud = createHud(boot.palette, read, state, () => boot.loop.realTime * 1000, [setPin, goPin, () => boot.camera.centerOnTile(0, 0)]);
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);

controlPanel(
  [knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), knobs.lightBloom(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot)],
  // `renderMs` rather than `knobs.frameTime`'s `frameMs`: `frameMs` averages *every* pump, and a
  // loop pumps on an interval as well as on a paint, so a tab whose rAF is throttled reports a
  // flattering number made mostly of update-only pumps. `renderMs` is the cost of the render
  // subscribers alone and does not care how often they run — the one figure that means the same
  // thing in the foreground and the background.
  { params: boot.params, title: 'Endless', subtitle: 'Pan forever. Nothing is loaded and nothing is kept.', stats: () => `${boot.loop.stats.renderMs.toFixed(2)}ms render · ${Math.round(boot.loop.stats.fps)}fps` },
);

// The opening frame is the pitch, and a budgeted first frame opens on sixteen chunks of world and
// two hundred of flat nothing. Priming is unbudgeted for exactly one frame, before anything is
// painted, so the cost lands in page load where a visitor reads it as loading rather than as a
// stutter — and the *steady state* the frame-time readout reports is untouched by it.
world.look(boot.camera);
stream(1e4);
boot.start();
