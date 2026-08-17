/**
 * CROWD — a Lattice exhibit. Wiring, and the frame.
 *
 * Nine hundred people crossing a waterfront piazza at five o'clock, drawn from one closed-form
 * expression. There is no walker struct, no update loop, no allocation and no per-walker state of
 * any kind; a person's position is `pathSample(route, ((φ·i + t·v) mod 1) · arcLength)` and nothing
 * else. The furniture is the same trick — `dressing.ts` computes a prop from its index too — so the
 * frame's bucket holds nothing but integers, and the whole scene is one function of one number.
 *
 * **This file registers no `onUpdate` handler.** That is not an omission, it is the exhibit. The
 * only thing that changes between frames is the clock, and everything visible is a function of it.
 * Which is why the overlay can hand a visitor a scrubber: drag it back six hundred seconds and the
 * crowd is not rewound, it is *evaluated*, and it lands on the picture it had ten minutes ago to
 * the pixel. Jump a thousand seconds ahead and it costs exactly one frame, because nothing had to
 * catch up — there was nothing to catch up.
 *
 * ## What is logic here and what is not
 *
 * This file, `plaza.ts`, `crowd.ts` and `hud.ts` are the exhibit's logic and are the only four
 * modules the line rule counts. `palette.ts`, `ground.ts`, `scenery.ts`, `people.ts` and
 * `dressing.ts` each carry `@art` in their header: delete any one and the piazza still generates,
 * the eight routes still exist and every walker is exactly where it would have been.
 *
 * `?seed=` turns the paving grain and dresses every column, awning and tree. Same seed, same piazza.
 */
import { heightAt, tileBounds, type GridPoint } from '@latticekit/iso';
import { renderFrame, type Passes, type Pen } from '@latticekit/draw';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { GOLDEN } from './palette.js';
import { H, HEART, PC, W, createPlaza } from './plaza.js';
import { walkerAt, type Crowd } from './crowd.js';
import { PROPS, addProps, drawProp } from './dressing.js';
import { drawAir } from './scenery.js';
import { drawGround, drawSky } from './ground.js';
import { drawWalker } from './people.js';
import { createHud, type Readout } from './hud.js';

const boot = bootstrap({
  seed: 'piazza', background: '#101a2e', palette: GOLDEN, clear: 'sky',
  camera: { zoom: 0.95, minZoom: 0.45, maxZoom: 3, keepVisible: 0.3 },
  light: { scale: 0.5, falloff: 2.6, bloom: 0.3 },
  // Big enough for the ceiling the slider reaches, so a drag to 3,000 measures the frame rather
  // than the sorter's first four reallocations.
  depth: 3400,
});

const plaza = createPlaza(boot.seed);
/** Re-run on every resize, because `Camera` *copies* its bounds and the panel rebuilds the camera
 *  whenever a zoom clamp moves. `fitBounds` is given `HEART` and not the map: it fits what it is
 *  handed *inside* the frame, so framing the map is how an exhibit becomes a diorama. */
const fit = (): void => { boot.camera.setBounds(tileBounds(0, 0, W, H, plaza.maxHeightPx, { minX: 0, minY: 0, maxX: 0, maxY: 0 })); boot.camera.fitBounds(HEART); };
boot.onResize(fit);
fit();

/**
 * One bucket, one sorter, one frame — and this is the line the exhibit is most exposed to.
 *
 * A crowd sorted separately from the scenery walks through walls, and the failure is not a crash:
 * it is a person in front of a column they are behind, on one frame in twenty, which reads as a
 * rendering glitch and is actually two collections disagreeing about an index. `createBucket`
 * exists so a heterogeneous frame cannot desynchronize from its sorter, because `add` performs both
 * writes and there is no way to do one without the other. Here the two kinds are told apart by a
 * **sign** — a walker is `i`, a prop is `−1 − i` — so the frame allocates nothing at all.
 */
const bucket = createBucket<number>(boot.order);
const crowd: Crowd = { routes: plaza.routes, count: 900, speed: 34 };
const here: GridPoint = { gx: 0, gy: 0 };
const there: GridPoint = { gx: 0, gy: 0 };
/** Seconds the scrubber has added to the clock, and the only mutable number in the exhibit besides
 *  the crowd's own two. Moving it is the whole demonstration. */
let warp = 0, clock = 0, wall = 0, window10 = 0;
let scene: Pen | undefined;

/** Hoisted, because a closure allocated here is a closure per frame, times sixty. */
const paint = (item: number): void => {
  const pen = scene;
  if (pen === undefined) return;
  if (item < 0) { drawProp(pen, -1 - item, plaza.field, there); return; }
  // Second call this frame for this walker, and it recomputes rather than remembers. That is the
  // whole point: the position was never written down, so there is nothing to read back.
  const dir = walkerAt(crowd, item, clock, here);
  drawWalker(pen, item, here.gx, here.gy, heightAt(plaza.field, here.gx, here.gy), dir);
};

const passes: Passes = {
  backdrop: (pen) => { drawSky(pen); },
  maxHeightPx: plaza.maxHeightPx,
  terrain: (pen, visible) => { drawGround(pen, plaza, visible); },
  solids: (pen) => { scene = pen; bucket.each(paint); },
  overlay: (pen) => { drawAir(pen, PC, PC); },
};

boot.onRender((pen, _alpha, nowMs) => {
  wall = nowMs;
  clock = pen.t + warp;
  // The worst frame is only meaningful over a window; `loop.stats` keeps it since the last reset,
  // so the exhibit chooses the window rather than reading a high-water mark from page load.
  if (nowMs - window10 > 10_000) { boot.loop.resetStats(); window10 = nowMs; }
  boot.light.begin(pen, 0.38, 'night');
  bucket.clear();
  addProps(bucket, plaza.field, there);
  for (let i = 0; i < crowd.count; i++) {
    walkerAt(crowd, i, clock, here);
    bucket.addPoint(i, here.gx, here.gy, heightAt(plaza.field, here.gx, here.gy) + 18, 0.18);
  }
  renderFrame(pen, passes, boot.order);
});

const read = (): Readout => ({ walkers: crowd.count, drawn: boot.order.count - PROPS, frameMs: boot.loop.stats.frameMs, worstMs: boot.loop.stats.worstFrameMs, clock });
const hud = createHud(boot.palette, read, (seconds) => { warp = seconds; }, () => wall);
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

controlPanel(
  [
    { kind: 'group', label: 'the crowd' },
    { kind: 'range', key: 'n', label: 'walkers', min: 0, max: 3000, step: 20, value: crowd.count,
      param: '@latticekit/iso pathSample(path, sPx, out)',
      note: 'Two calls per walker per frame, and nothing else scales with it. Nothing is allocated, spawned or despawned when it moves.',
      wrong: { above: 1800, says: 'The frame goes; the crowd does not. What costs is fifteen draw calls a person — the closed form that placed them is the one part of this that never shows up in a profile.' },
      apply: (v) => { crowd.count = v; } },
    { kind: 'range', key: 'v', label: 'walking pace', min: 0, max: 140, step: 2, value: crowd.speed,
      param: '@latticekit/iso Path.arcLength',
      note: 'World pixels per second along the curve — not grid units, which is why nobody speeds up on the diagonals.',
      wrong: { below: 0, says: 'Time stops and the crowd does not. Every walker is still exactly where φ·i puts it, because that is all a position ever was.' },
      apply: (v) => { crowd.speed = v; } },
    { kind: 'group', label: 'the kit' },
    knobs.minZoom(boot), knobs.keepVisible(boot), knobs.lightBloom(boot), knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot),
  ],
  { params: boot.params, title: 'Crowd', subtitle: 'Nine hundred walkers, one expression, no per-walker state.', stats: knobs.frameTime(boot) },
);

boot.start();
