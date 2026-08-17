/**
 * ISLAND — a Lattice exhibit. The wiring, the cycle, and the frame.
 *
 * A coast, the water off it, a range on the far side, and a whole day over all of it in ninety
 * seconds: terrain out of a heightfield, a shoreline the tide actually moves, a wood that sways,
 * and a sun that rises out of the sea and sets back into it. There is nothing to win and nothing
 * to build. `?seed=` chooses the coast; the same seed is the same coast, the same trees and the
 * same pixel, every time.
 *
 * **There is no boot in this file.** The canvas, surface, camera, palette, light field, depth
 * sorter, tweens, loop and input are `bootstrap()` from `examples/_shared`, which exists because
 * the thirty lines it replaces contain two mistakes that are *silent* when you make them: a
 * `stepMs` literal beside a loop running at 16.667, and a light field never attached to the pen.
 * Neither is available to be made here any more.
 *
 * ## What is logic and what is not
 *
 * This file, `island.ts` and `hud.ts` are the exhibit's logic and are the only three modules the
 * line rule counts. `palette.ts`, `sky.ts`, `ground.ts`, `trees.ts` and `ambient.ts` each carry
 * `@art` in their header and are uncapped, because deleting any one of them changes what this
 * exhibit *looks* like and nothing else — the coast still generates, still sorts and still runs
 * its ninety seconds. `docs/GALLERY.md` has the rule and the grep that checks it.
 *
 * ## The two numbers everything downstream reads
 *
 * `phase` wraps once per cycle and `daylight` is derived from it, and **they are computed exactly
 * once per frame, here.** The palette's blend, the light field's darkness, the sun's position on
 * its arc, the stars' opacity, the surf's phosphorescence and the clock in the overlay are all
 * that pair. Two schedules — one for color and one for the mask — is a coast whose darkness and
 * whose blue disagree, and it gets reported as a light bug rather than as the two clocks it is.
 */
import { clamp, clamp01 } from '@lattice/core';
import { TILE_H, TILE_W, rectFromSize, type Rect } from '@lattice/iso';
import { renderFrame, spriteHeightPx, type Passes } from '@lattice/draw';
import { drive } from '@lattice/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { DAY, rollPalette } from './palette.js';
import { MAX_HEIGHT_PX, SKY_V, createIsland, type Tree } from './island.js';
import { paintWood, species } from './trees.js';
import { drawSky } from './sky.js';
import { paintTerrain } from './ground.js';
import { drawAmbient } from './ambient.js';
import { createHud, type Hud } from './hud.js';

/** The whole experience. There is nothing after ninety seconds except the same ninety seconds. */
const DAY_SECONDS = 90;
/** Where the cycle opens: four fifths of the way from first light to noon. The first frame is the
 *  pitch, and dawn is the least saturated minute of the day to open on. */
const OPENS_AT = 0.2;
/**
 * The composition, as three numbers, and they are the whole answer to `docs/GALLERY.md` § Scale.
 *
 * The world is 160 `u` wide against a frame that shows about 28 of it, so five sixths of the
 * coast is off screen at any moment and the summit, both headlands and the far range's whole
 * eastern end are things a visitor has to go and find. `SKY_AT` is where the horizon sits down the
 * frame — a seventh, and the far range rises through most of that, so sky and open water together
 * come to about a quarter of the opening frame and everything else is land, wood and surf.
 * `OPEN_U` is deliberately not zero: a composition centered on its own axis of symmetry looks like
 * a diagram of a coast rather than a view of one.
 */
const OPEN_U = -3, SKY_AT = 0.15;
/** How far the camera may wander, in `u` and `v`. Chosen against the diamond the grid projects
 *  to — `|u| ≤ v` and `|u| ≤ W − v` — so no pan and no zoom can reach a corner of it. */
const REACH: Rect = { minX: -72 * TILE_W, minY: 88 * TILE_H, maxX: 72 * TILE_W, maxY: 152 * TILE_H };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

const boot = bootstrap({
  seed: 'atoll', bounds: REACH, background: '#0a1230', palette: DAY, clear: 'sky', depth: 8192,
  camera: { zoom: 0.8, minZoom: 0.4, maxZoom: 2.6, keepVisible: 0.9 },
  light: { scale: 0.45, falloff: 2.6, bloom: 0.34 },
});

const island = createIsland(boot.seed);

/**
 * Put the horizon a tenth of the way down the frame, on any window, and pen the camera to
 * {@link REACH}.
 *
 * `fitBounds` is the only way `iso` will let anything choose a zoom — `Camera.zoom` is a position
 * and moves through `zoomAt` — so the zoom this exhibit wants is expressed as a rectangle of
 * exactly the viewport's own aspect, which fits at exactly that scale. That the rectangle has to
 * be fabricated to say "0.8" is filed as a kit finding.
 *
 * Everything else follows from `SKY_V` being a line of constant `v`: its world y is fixed, so the
 * camera center that lands it at {@link SKY_AT} is one subtraction, and it is re-derived on every
 * resize because the frame's height in world units is what moved. The pan limit is not re-applied
 * here — `bootstrap` holds {@link REACH} and passes it to every camera it builds, including the
 * one the control panel's zoom knobs rebuild.
 */
function frame(w: number, h: number): void {
  const zoom = clamp(h / 1300, 0.5, 0.9);
  const cy = SKY_V * TILE_H + (0.5 - SKY_AT) * h / zoom;
  rectFromSize(opening, OPEN_U * TILE_W - w / (2 * zoom), cy - h / (2 * zoom), w / zoom, h / zoom);
  boot.camera.fitBounds(opening);
}
boot.onResize(frame);
frame(boot.camera.viewW, boot.camera.viewH);

// ── the day ──────────────────────────────────────────────────────────────────────────────────

let phase = OPENS_AT, daylight = 1, minutes = OPENS_AT * 1440;
/** The loop's own clock, caught on the way past. `@lattice/loop` takes a `Clock` and does not
 *  offer one back, so an exhibit that needs the same instant the loop is using either reads
 *  `performance.now()` — banned in exhibit source, and a second clock racing the first — or does
 *  this. Filed as a kit finding. */
let nowMs = 0;
/**
 * The longest gap between two painted frames in the last ten seconds, the instant that window
 * opened, and the previous frame's clock. `docs/GALLERY.md` § Scale makes 60 fps a gate judged on
 * exactly this number, so it is worth being exact about which number it is.
 *
 * **It is the frame-to-frame interval, not `FrameStats.worstFrameMs`.** Two earlier versions of
 * this readout were wrong in two different ways, and both are worth recording because neither
 * looked wrong:
 *
 * | | what it showed | why it lied |
 * |---|---|---|
 * | latched `worstFrameMs` at the close of each window | `0.0 ms` for the first ten seconds | it displayed its own initializer, and nothing renders in zero milliseconds |
 * | `worstFrameMs` read live | a plausible small number | it is the pump's *own* wall time, so a GC pause landing between two pumps is invisible to it |
 *
 * The second is the subtle one and another exhibit hit it too: a HUD reading 0.0 ms beside a real
 * 9.2 ms worst gap. A pump that costs four milliseconds and then waits sixty for the collector has
 * dropped three frames, and the player felt every one of them. Subtracting two consecutive clock
 * readings catches that, catches a slow composite, and catches the browser doing something else —
 * everything, in fact, that stands between one picture and the next. At a healthy 60 Hz it reads
 * about 17 ms, because that is what a frame that was *not* dropped costs; past about 20 it means
 * one was. That `loop` offers no windowed maximum of either kind is filed as a kit finding.
 */
let worstMs = 0, windowAt = 0, lastMs = 0;
/**
 * Above this, a gap is the browser declining to ask for a frame rather than this exhibit being
 * slow to draw one, and counting it would make the readout useless.
 *
 * A hidden tab suspends `requestAnimationFrame` outright: measured here at **6,108 ms** with the
 * window in the background, which is a true statement about the interval and tells a visitor
 * nothing about the exhibit. A resize, a devtools pause and the first frame after boot are the
 * same shape. A quarter of a second is fifteen dropped frames — far past anything this scene
 * could cause and far short of a suspension, so nothing real hides under it.
 */
const SUSPENDED_MS = 250;
/** Seconds added to the clock by the overlay's one button, tweened so the sky *sweeps* rather
 *  than cutting — a cut would throw away the half of the idea that is the transition. */
let skipped = 0;
const advance = (v: number): void => { skipped = v; };
const skipHalfADay = (): void => {
  boot.tweens.start({ from: skipped, to: skipped + DAY_SECONDS * 0.5, seconds: 2.4, ease: 'quadInOut', slot: 'sun', onUpdate: advance });
};

// ── the frame ────────────────────────────────────────────────────────────────────────────────

const wood = createBucket<Tree>(boot.order);
/** Every tree's silhouette top, measured once. `spriteHeightPx` replays the massing to answer it,
 *  so calling it per tree per frame is a second full massing pass over the whole wood every
 *  frame — for a number that cannot change, because nothing here has a `Variant` that moves. */
const tops = island.trees.map((t) => t.base + spriteHeightPx(species(t.kind), t.v));
/** Hoisted, because it runs once per tree per frame and an inline arrow here is a closure a
 *  frame — the same rule `Bucket.each` states for the walk on the other side of the sort. */
const stand = (t: Tree, i: number): void => { wood.add(t, t.gx, t.gy, 1, 1, tops[i] ?? t.base); };

const passes: Passes = {
  backdrop: (pen) => drawSky(pen, phase, daylight, 1 - daylight),
  // The Terrain cull is `renderFrame`'s and is computed on the ground plane; `maxHeightPx` is the
  // number that margins it. Without it the summit vanishes the moment its base leaves the bottom.
  maxHeightPx: MAX_HEIGHT_PX, terrain: (pen, visible) => paintTerrain(pen, island, visible, daylight, 1 - daylight),
  solids: (pen) => paintWood(pen, wood, 1 - daylight),
  // Ambient life and the golden-hour wash go *above* the night mask. The HUD is not here at all:
  // it is DOM over the canvas, and it darkens with the coast through `paletteVars`.
  overlay: (pen) => drawAmbient(pen, island, daylight, phase),
};

boot.onRender((pen, _alpha, ms) => {
  nowMs = ms;
  const gap = ms - lastMs;
  lastMs = ms;
  // A suspension restarts the window and leaves the reading alone, so a visitor coming back to
  // the tab sees the last honest number rather than a `0.0` that looks exactly like the dead
  // readout this replaced. The first frame after boot takes this branch too, which is why
  // nothing here needs a special case for `lastMs` being zero.
  if (gap >= SUSPENDED_MS) windowAt = ms;
  else if (ms - windowAt >= 10000) { worstMs = gap; windowAt = ms; }
  else if (gap > worstMs) worstMs = gap;
  minutes = (OPENS_AT + (pen.t + skipped) / DAY_SECONDS) * 1440;
  phase = (minutes / 1440) % 1;
  daylight = clamp01(Math.sin(phase * Math.PI * 2) * 1.35 + 0.3); /* @tier-b pixels only */
  rollPalette(boot.palette, phase);
  boot.light.begin(pen, (1 - daylight) * 0.74, 'night');
  wood.clear();
  island.trees.forEach(stand);
  renderFrame(pen, passes, boot.order);
});

// ── the overlay, which is DOM, and the panel, which is the gallery's ─────────────────────────

const read = (): Hud => ({ phase, daylight, minutes, worstMs });
const hud = createHud({ palette: boot.palette, read, onSkip: skipHalfADay, now: () => nowMs });
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);

controlPanel([
  { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'the night' }, knobs.lightBloom(boot), knobs.lightScale(boot), knobs.lightFalloff(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Island', subtitle: 'One day, in ninety seconds.', stats: knobs.frameTime(boot) });

boot.start();
