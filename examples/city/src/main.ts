/**
 * CITY BLOCK — a Lattice exhibit. Wiring, and the frame.
 *
 * Nine blocks at the blue hour, thirty-six buildings on twelve silhouettes, and the one technique
 * the exhibit exists to show: **dense setback massing under a rhythm of warm windows.** Tap a
 * tower and every window in it comes on. Nothing else happens, on purpose — an exhibit is a
 * starting point and not a product, and this one has ninety seconds to make its argument.
 *
 * `?seed=` chooses the city. The whole world is a pure function of that seed and `pen.t`, so
 * there is no clock in this file, no `Date.now`, and nothing to replay.
 *
 * **There is no boot here.** The canvas, surface, camera, palette, light field, depth sorter,
 * loop and input system are `bootstrap()` from `examples/_shared`, which exists because the
 * thirty lines it replaces contain two mistakes that are silent when you make them.
 */
import { FLAG_POWERED, LEVEL_H, drawSprite, renderFrame, spriteVolume, type Passes, type Pen } from '@latticekit/draw';
import { HALF_H, boxSilhouette, pointInPolygon, tileBounds, type GridPoint, type Rect, type Volume } from '@latticekit/iso';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { BLUE, hourAt, nightfall } from './palette.js';
import { CURB_PX, W, createCity, type Lot } from './city.js';
import { CARS, carAt, drawCar } from './traffic.js';
import { setDetail } from './sprites.js';
import { drawDistance, drawSky, drawStreets } from './sky.js';
import { drawAir, drawHaze } from './ambient.js';
import { createHud } from './hud.js';

// ── the screen, and the world it is looking at ───────────────────────────────────────────────

const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const boot = bootstrap<'touch'>({
  // `terrain: 'flat'` and it is the honest answer: the streets are one plane, the curb is a tenth
  // of a storey of art under the sprites, and there is no height field anywhere in this exhibit.
  // Saying so is what separates a level world from one that never answered — see the option's doc.
  seed: 'city-block', bounds: worldRect, background: '#04070f', palette: BLUE, clear: 'sky', terrain: 'flat',
  // `keepVisible: 0.5` — half the viewport must still be showing the map after any gesture. The
  // first pass used 0.15 so the clamp would not fight the opening frame, and the cost of that was a
  // drag that ran clean off the world into empty sky, which is the same failure as a car in the
  // void wearing the camera's clothes. The bounds include the air above the map, so the opening
  // frame is nowhere near the clamp and half is free.
  camera: { zoom: 0.8, minZoom: 0.34, maxZoom: 2.6, keepVisible: 0.5 },
  // **Scarce, small, steep and sharp.** The first cut of this exhibit lit every building, every
  // lamp and every car with a soft, wide, generously bloomed pool, and a hundred of those do not
  // add up to a lit city — they add up to fog, with no edge anywhere and no way to tell a lamp
  // from the ground beside it. A falloff of 3.6 keeps a pool's core flat and puts the whole ramp
  // in its last third, which is what "you can see exactly where the light stops" costs.
  //
  // **The one artifact left in this frame, and it is not one an exhibit can fix.** `draw`'s light
  // field is not occluded — by its own account the largest honest limitation in the package — so a
  // pool lying in a street behind a tower composites over that tower's roof, and a night city is
  // the worst case for it because the things in front are fourteen storeys tall. The count is down
  // from about a hundred and thirty pools to thirty-five and every radius is halved, which is as
  // far as this side of the seam reaches; `scale: 1` was measured and buys nothing but 5 ms.
  // Reported as a finding rather than worked around.
  light: { scale: 0.7, falloff: 4.2, bloom: 0.22 },
  depth: 2048, actions: { touch: ['tap'] },
});

const city = createCity(boot.seed);
// The camera's bounds are the map's, and the map is not built until the seed is known — which
// `bootstrap` is the thing that reads. `Camera` copies the rectangle rather than holding it, so
// `setBounds` is the only way the second half of that order gets across.
//
// **Six storeys of air, not thirty-four.** `tileBounds`' height argument extends `minY` *upward*,
// and what a camera clamp does with that is let the player park the viewport in the sky above the
// map's far corner and still satisfy `keepVisible` — which is how a drag ended up looking at an
// empty frame. The tallest thing on the map is a fit-the-opening-frame concern and this rectangle
// is not the fit; it is the fence.
tileBounds(0, 0, W, W, LEVEL_H * 6, worldRect); boot.camera.setBounds(worldRect);

/**
 * Frame the city, on any seed and any viewport.
 *
 * **The map is never fitted to the frame, and that is the whole point.** `fitBounds(worldRect)` is
 * what put the first cut of this exhibit inside its own viewport with its four corners showing —
 * a diorama, by § Scale's own name for it. So the zoom is chosen to make the map *overflow*: the
 * map's half-diagonal must cover at least 0.78 of the viewport's height and 0.46 of its width,
 * which puts the world's long axis past 1.8× the frame and leaves both side corners off-screen at
 * every viewport this runs on.
 *
 * The center then puts the map's far corner — the horizon, and the only edge a visitor may see —
 * a quarter of the way down the screen. Everything below it is city, downtown is under the bottom
 * edge, and the first gesture anybody makes is a drag toward it.
 *
 * `fitBounds` is still how the zoom is set, because `Camera.zoom` is deliberately not settable and
 * `zoomAt` wants a factor and an anchor. Handing it a viewport-shaped rectangle whose spans are
 * exactly `viewport / zoom` is that method spelled as the number it is; the center it chooses on
 * the way past is overwritten on the next line.
 */
const view: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const HORIZON = 0.24;
function frameCity(w: number, h: number): void {
  const zoom = Math.max(1.12 * h, 0.66 * w) / (W * HALF_H);
  view.minX = -w / (2 * zoom); view.maxX = -view.minX;
  view.minY = -h / (2 * zoom); view.maxY = -view.minY;
  boot.camera.fitBounds(view);
  const eye = ((0.5 - HORIZON) * h) / (2 * HALF_H * zoom); boot.camera.centerOnTile(eye, eye);
}
boot.onResize(frameCity); frameCity(boot.surface.width, boot.surface.height);

// ── the frame's drawables ────────────────────────────────────────────────────────────────────

/** A building or a car id, in one bucket — so `frame[order.indexAt(i)]` is the only expression
 *  that ever reads the frame, and the index arithmetic it replaces cannot be wrong. */
type Item = Lot | number;
const bucket = createBucket<Item>(boot.order);
const here: GridPoint = { gx: 0, gy: 0 };
let hour = 0; let woken = 0;
/** The pen for the sorted walk. Hoisted, because a visitor closed over `pen` is a closure per
 *  frame and this runs sixty times a second. */
let sheet: Pen | undefined;

function paint(item: Item): void {
  const pen = sheet;
  if (pen === undefined) return;
  if (typeof item !== 'number') {
    drawSprite(pen, item.def, item.gx, item.gy, item.v, CURB_PX);
    return;
  }
  // `carAt` fills `here`, so it runs as its own statement: as an argument it would be evaluated
  // after the two that read what it writes.
  const heading = carAt(item, pen.t, here);
  drawCar(pen, item, here.gx, here.gy, heading, CURB_PX);
}

// ── the tap ──────────────────────────────────────────────────────────────────────────────────

const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const sil = new Float64Array(12); let px = 0; let py = 0;

/** Is the tap inside this building's silhouette? Street furniture is 1×1 and is never a target —
 *  a lamp post that swallowed a tap aimed at the tower behind it would be the worst kind of bug,
 *  the kind where nothing happens. `CURB_PX` is passed for the same reason it is passed to
 *  `drawSprite`: measure the volume at sea level and every tap lands below the art. */
const hits = (item: Item): boolean => {
  if (typeof item === 'number' || item.def.w < 2) return false;
  spriteVolume(item.def, item.v, vol, CURB_PX);
  boxSilhouette(boot.camera, item.gx, item.gy, vol, sil);
  return pointInPolygon(px, py, sil, 6);
};

boot.onAction('touch', (e) => {
  px = e.sx; py = e.sy;
  const hit = bucket.pick(hits);
  if (hit === undefined || typeof hit === 'number') return;
  const on = (hit.v.flags & FLAG_POWERED) === 0;
  // A `Variant` is readonly and the massing reads it every frame, so waking a building is one
  // allocation on one tap rather than a mutable field the art could catch halfway through.
  hit.v = { ...hit.v, flags: on ? FLAG_POWERED : 0 };
  woken += on ? 1 : -1;
  hud.say('woke', 'Every window on, and the street below it knows. Tap it again to let them sleep.', 'good');
});

// ── the frame ────────────────────────────────────────────────────────────────────────────────

const passes: Passes = {
  backdrop: (pen) => { drawSky(pen, hour, city.seed); drawDistance(pen, city.seed, hour); },
  // The Terrain margin, and it is **one storey rather than the map's tallest**. The solids cull
  // reads each item's own `heightPx`, so a tower's height has never been this number's business;
  // all it buys is enough over-scan that a sidewalk platform does not pop at the bottom edge. On a
  // map this size the difference is a terrain loop over three thousand tiles instead of nine.
  maxHeightPx: LEVEL_H,
  terrain: (pen, visible) => drawStreets(pen, city.seed, visible),
  solids: (pen) => { sheet = pen; setDetail(pen.camera.zoom); bucket.each(paint); },
  overlay: (pen) => drawHaze(pen, hour),
  effects: (pen) => drawAir(pen, city.seed),
};

boot.onRender((pen) => {
  hour = hourAt(pen.t);
  nightfall(pen, boot.palette, boot.light, hour, boot.lightOpts.scale);
  bucket.clear();
  for (const lot of city.lots) bucket.add(lot, lot.gx, lot.gy, lot.def.w, lot.def.d, lot.hPx);
  for (let i = 0; i < CARS; i++) { carAt(i, pen.t, here); bucket.addPoint(i, here.gx, here.gy, CURB_PX, 0.3); }
  renderFrame(pen, passes, boot.order);
});

// ── the overlay, and the knobs under it ──────────────────────────────────────────────────────

/** Buildings only: the street furniture shares the lot list and is not something to wake. */
const buildings = city.lots.filter((lot) => lot.def.w > 1).length;
// The loop rather than a clock: it is where the overlay's `now` comes from *and* where the worst
// frame of the last ten seconds is read, which is the one number § Scale asks every exhibit to
// carry. It also keeps `performance.now()` out of this file entirely.
const hud = createHud(boot.palette, () => ({ hour, woken, buildings }), boot.loop);
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

boot.scope.add(controlPanel([
  { kind: 'group', label: 'the night' }, knobs.lightScale(boot), knobs.lightBloom(boot), knobs.lightFalloff(boot),
  { kind: 'group', label: 'the camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'the surface' }, knobs.pixelRatio(boot), knobs.snap(boot), knobs.seed(boot),
// **No `stats: knobs.frameTime(boot)` here, and that is a kit finding rather than a preference.**
// The HUD owns the cost readout now, because § Scale asks for the *worst* frame of the last ten
// seconds rather than an average — and the only way to get a rolling worst out of `FrameStats` is
// to call `loop.resetStats()` on a timer. That call is all-or-nothing: it zeroes `fps` and
// `frameMs` for every other consumer, so the panel's stat line read `0.0ms · 0fps` for a second
// out of every five. One readout that is right beats two that disagree.
], { params: boot.params, title: 'City block', subtitle: 'Setback massing and a window rhythm. Every value here is in the URL.' }).dispose);

boot.start();
