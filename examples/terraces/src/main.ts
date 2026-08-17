/**
 * TERRACES — a Lattice exhibit. The wiring, the frame, and the two knobs that break it.
 *
 * A hillside of stepped fields, and the one thing about it a screenshot cannot show: on terrain
 * with height, **the obvious screen → tile conversion is wrong**, and it is wrong by more the
 * higher you climb. Move the cursor and two diamonds follow it — green where you actually are,
 * red where a flat-ground pick believes you are. Drag uphill and watch them separate.
 *
 * ## Why the wrong answer is on screen at all times
 *
 * Because a correct implementation nobody has a reason to believe was hard is not an exhibit. The
 * naive pick is not a straw man either: it is `iso.screenToTile`, the exact inverse of the
 * projection on the plane `z = 0`, and it is what `@lattice/input` writes into `gx`/`gy` on every
 * action event it fires — so an exhibit that read `event.gx` would ship this bug without ever
 * choosing to. `pick.ts` has the geometry; the README has the finding.
 *
 * ## There is no boot in this file
 *
 * The canvas, surface, camera, palette, light field, depth sorter, tweens, loop and input are
 * `bootstrap()` from `examples/_shared`, which exists because the thirty lines it replaces
 * contain two mistakes that are *silent* when you make them — a `stepMs` literal beside a loop
 * running at 16.667, and a light field never attached to the pen. Neither is available to be made
 * here any more. Its header names a third it cannot close, and this exhibit found a fourth:
 * `bootstrap` owns the loop's clock and exposes no `now()`, so the `ui` overlay is driven from
 * `boot.loop.realTime` rather than from a second `performance.now()` this file may not write.
 *
 * ## The frame meter, and why it is not `loop.stats`
 *
 * `docs/GALLERY.md` § The cost row makes 60 fps a **gate** and asks for the worst frame of the
 * last ten seconds on screen. `loop.stats.frameMs` is an exponential moving average — the exact
 * shape of number that rule rejects — and `loop.stats.worstFrameMs` never decays, so it reports
 * the session's worst frame, which is always the first one. Ten one-second buckets of the gap
 * between painted frames, rotated in place, is the whole of what is missing, and that it is
 * missing is a finding about `loop` rather than about this file.
 *
 * ## What is logic and what is not
 *
 * This file, `hill.ts`, `pick.ts` and `hud.ts` are the exhibit's logic and are the only four
 * modules the line rule counts — `docs/GALLERY.md` names *the frame* as logic, so the `Passes`
 * object stays here even though every one of its entries is a call into an art module.
 * `palette.ts`, `place.ts`, `fields.ts`, `props.ts` and `markers.ts` each carry `@art` in their
 * header: delete any one and the hill still generates, the march still runs, and both answers are
 * still computed and still differ by the same number of pixels. `npm run gallery` checks it.
 */
import { gridToWorldX, gridToWorldY, heightAt, tileBounds, type Rect } from '@lattice/iso';
import { renderFrame, type Passes } from '@lattice/draw';
import { drive } from '@lattice/ui';
import { bootstrap, controlPanel, createBucket, knobs, type RangeControl, type ToggleControl } from '../../_shared/src/index.js';
import { HILLSIDE } from './palette.js';
import { H, OPEN_AT, RISE, STEP_PX, W, createHill, type Prop } from './hill.js';
import { createPick, plant, repick } from './pick.js';
import { drawAir, paintHill } from './fields.js';
import { fillProps, paintProps } from './props.js';
import { drawMarkers } from './markers.js';
import { createHud, type Hud } from './hud.js';

const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const boot = bootstrap({
  seed: 'contour', bounds: worldRect, background: '#cfdfdd', palette: HILLSIDE, clear: 'mist', depth: 4096,
  camera: { zoom: 0.95, minZoom: 0.4, maxZoom: 3.2, keepVisible: 0.15 }, actions: { stake: ['tap'] },
});

// The camera's bounds are the map's, and the map is not generated until the seed is known — which
// `bootstrap` is the thing that reads. So the rectangle goes in empty and is filled here, before
// anything looks at it. It is never refilled: the extent of a hill does not depend on a viewport.
//
// Then `centerOn`, and neither `fitBounds` nor `centerOnTile`. Fitting a world four times the
// viewport is how the first two exhibits in this gallery ended up as dioramas; and `centerOnTile`
// frames a tile's *sea-level* position, which on ground standing 250 px up is a quarter of a
// screen too low — the same off-by-an-elevation this exhibit is about, arriving in the camera
// instead of in the pick.
const hill = createHill(boot.seed);
tileBounds(0, 0, W, H, hill.maxHeightPx, worldRect);
boot.camera.setBounds(worldRect);
boot.camera.centerOn(gridToWorldX(OPEN_AT, OPEN_AT), gridToWorldY(OPEN_AT, OPEN_AT) - heightAt(hill.field, OPEN_AT, OPEN_AT));

// ── the pointer, which the kit does not deliver ───────────────────────────────────────────────

const pick = createPick();
pick.sx = innerWidth / 2, pick.sy = innerHeight / 2;
let aware = boot.params.bool('aware', true), ceiling = boot.params.num('ceiling', hill.maxHeightPx);

// A raw listener, because `@lattice/input` has six gestures and none of them is a hover — see the
// README. `clientX`/`clientY` need no rect subtraction only because `bootstrap` pins the canvas to
// the viewport with `position: fixed; inset: 0`.
const onMove = (event: PointerEvent): void => { pick.sx = event.clientX; pick.sy = event.clientY; };
boot.canvas.addEventListener('pointermove', onMove);
boot.scope.add(() => { boot.canvas.removeEventListener('pointermove', onMove); });

// `event.sx`/`event.sy`, never `event.gx`/`event.gy`: the tile on the event is the flat-ground
// answer, which is the thing on trial here.
boot.onAction('stake', (event) => {
  pick.sx = event.sx, pick.sy = event.sy;
  repick(pick, boot.camera, hill.field, ceiling);
  plant(pick, aware);
});

// ── the frame, and the ten seconds behind it ─────────────────────────────────────────────────

const worst = new Float64Array(10);
let slot = -1, lastNowMs = 0, worstMs = 0;

/** Longest gap between two painted frames in the last ten seconds. One bucket per second, cleared
 *  as the clock rolls into it, so the window slides with no queue and no allocation. The 500 ms
 *  guard drops the gap across a backgrounded tab, which is not a dropped frame. */
function meter(nowMs: number): number {
  const at = ((nowMs / 1000) | 0) % 10;
  if (at !== slot) { slot = at; worst[at] = 0; }
  const gap = nowMs - lastNowMs;
  lastNowMs = nowMs;
  if (gap < 500 && gap > (worst[at] ?? 0)) worst[at] = gap;
  return Math.max(...worst);
}

const bucket = createBucket<Prop>(boot.order);
const passes: Passes = {
  // The Terrain cull is `renderFrame`'s and is computed on the ground plane; this is the number
  // that margins it. Without it the top of the hill vanishes as its base leaves the bottom edge.
  maxHeightPx: hill.maxHeightPx,
  terrain: (pen, visible) => paintHill(pen, hill, visible),
  solids: (pen) => paintProps(pen, bucket),
  placement: (pen) => drawMarkers(pen, hill.field, pick, aware),
  overlay: (pen) => drawAir(pen),
};

// Re-picked here rather than in the pointer handler, so the answer moves when the *camera* does.
boot.onRender((pen, _alpha, nowMs) => {
  worstMs = meter(nowMs);
  repick(pick, boot.camera, hill.field, ceiling);
  bucket.clear();
  fillProps(bucket, hill, pen.t, boot.camera);
  renderFrame(pen, passes, boot.order);
});

// ── the panel, and the two controls that are this exhibit's own ──────────────────────────────

const awareKnob: ToggleControl = {
  kind: 'toggle', key: 'aware', label: 'terrain-aware picking', value: aware, apply: (v) => { aware = v; },
  param: '@lattice/iso screenToTileOnHeights', note: 'Off is screenToTile — the exact inverse of the projection on the plane z = 0, which is the only plane it inverts.',
  wrong: { when: false, says: 'Taps now resolve on the sea-level plane, which is further from the viewer than the ground you are pointing at — several terraces up the hill from your finger, and no screenshot of it would look wrong.' },
};

const ceilingKnob: RangeControl = {
  kind: 'range', key: 'ceiling', label: 'march ceiling', value: ceiling, apply: (v) => { ceiling = v; },
  param: '@lattice/iso screenToTileOnHeights.maxHeightPx', note: 'Where the terrain march starts. It walks down from here, so anything above it does not exist as far as picking is concerned.',
  min: 0, max: hill.maxHeightPx, step: 8, format: (v) => `${v.toFixed(0)} px`,
  wrong: { below: hill.maxHeightPx * 0.8, says: 'The march now begins below the upper terraces and misses them: the green diamond falls back down the hill exactly as far as the ceiling is short. At 0 it is the naive pick.' },
};

const panel = controlPanel([
  { kind: 'group', label: 'the one idea' }, awareKnob, ceilingKnob,
  { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Terraces', subtitle: 'Elevation, and why a tap needs the terrain.', stats: knobs.frameTime(boot) });

// ── the overlay, which is DOM ────────────────────────────────────────────────────────────────

const read = (): Hud => ({
  errorPx: pick.errorPx, tilesApart: pick.tilesApart, onMap: pick.onMap, aware, worstMs, terrace: Math.round(pick.groundPx / (STEP_PX * RISE)),
});
const toggle = (): void => { aware = !aware; boot.params.put('aware', aware, true); panel.set('aware', aware); };

// `now` is the loop's own clock in milliseconds. `ui` requires the clock `loop` was given, the kit
// bans a second reading of `performance.now()`, and `bootstrap` exposes neither — so this is the
// only honest source of the two, and it is a kit finding rather than a trick.
const hud = createHud({ palette: boot.palette, read, onToggle: toggle, now: () => boot.loop.realTime * 1000 });
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);
boot.start();
