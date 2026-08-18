/**
 * CAVERNS — a Lattice exhibit. The wiring, the lantern, and the dark it is cut out of.
 *
 * A cave, unlit, and one lantern. Tap the floor and you carry it there; light a hundred torches
 * and watch the worst frame not move. `?seed=` chooses the cave, and the same seed is the same
 * passages, the same three hundred torch positions and the same pixel, every time.
 *
 * **There is no boot in this file.** The canvas, surface, camera, palette, light field, depth
 * sorter, tweens, loop and input are `bootstrap()` from `examples/_shared`, which exists because
 * the thirty lines it replaces contain two mistakes that are *silent* when you make them. The
 * second is this exhibit's own subject: **a `LightField` that is never attached to the pen
 * accumulates every `add()` into a buffer nobody reads, reports `active` and `count` exactly as
 * if it were working, and renders a fully lit world with no error.** There is no `beginFrame`
 * call here and no way to write one.
 *
 * ## The one idea, and the two parameters that carry it
 *
 * "Pools that meet without a bright seam." Two lights composited one at a time punch the same
 * pixels twice — `(1−a₁)(1−a₂)` rather than `max(a₁,a₂)` — and grow a hot lens between them.
 * `draw` removes that by accumulating every pool into one buffer that blends by per-channel
 * **maximum** and cutting the darkness once. What is left is the part a kit cannot do for you,
 * and it is two numbers:
 *
 * | | here | why not the default |
 * |---|---|---|
 * | `falloff` | **1** | the parameter is a *plateau*, and the plateau is a filled ellipse drawn under the ramp. At the kit default of 2 a pool is a flat disc out to half its radius **and** a ramp that starts at full intensity in the center, so alpha steps down at exactly `r/2` and every pool wears a hard ring at half radius. At 1 the plateau is skipped entirely and the pool is one smooth ramp reaching zero. A pool's edge has to fall off into darkness rather than end at a circle, and 1 is the only value of this parameter that does that. It also halves the cost of a pool: no plateau, no second ellipse. |
 * | `bloom` | **0.3** | the bloom is an *additive* blit of the light buffer, and additive is the one place two overlapping pools genuinely do sum. Below about 0.35 the sum stays inside the 8-bit range where two pools meet; above 0.6 it clips to white and the overlap grows the flat lozenge the whole design was avoiding. |
 *
 * Then the shape of a flame, which is `ambient.ts`'s `pool`: **two `add` calls per light, not
 * one.** A hot narrow core inside a wide weak halo, unioned by the accumulator, gives a bright
 * center that decays over three times its own radius — a curve no single `add` can produce,
 * because one pool's ramp is linear. It is also why two torches side by side read as one brighter
 * region rather than as two: their halos are so soft where they meet that the union has no edge
 * to be a seam.
 *
 * ## Where the light is posted from, and why it is not here
 *
 * `light.begin` is in this file because the darkness is frame state and the panel drives it.
 * Every `light.add` is in `formations.ts` and `ambient.ts`, beside the fixture it belongs to,
 * which is where `draw` itself puts it: `SpriteDef.emit` is declared **on the sprite**. A pool is
 * what a lamp looks like.
 *
 * ## What is logic and what is not
 *
 * This file, `cavern.ts` and `hud.ts` are the exhibit's logic and are the only three modules the
 * line rule counts. `palette.ts`, `rock.ts`, `formations.ts` and `ambient.ts` carry `@art` in
 * their headers and are uncapped: delete any one and the cave still generates, still sorts, still
 * runs — it changes what the exhibit looks like and nothing else.
 */
import { clamp, damp } from '@latticekit/core';
import { heightAt, tileBounds, type Rect } from '@latticekit/iso';
import { renderFrame, spriteHeightPx, type Passes, type Pen } from '@latticekit/draw';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs, type RangeControl } from '../../_shared/src/index.js';
import { CAVE } from './palette.js';
import { BRAZIERS, CX, CY, H, W, createCavern, openAt, type Flame, type Formation, type Lit } from './cavern.js';
import { drawBackdrop, drawNear, paintRock } from './rock.js';
import { paintScene, pourScene, shape } from './formations.js';
import { drawAmbient, drawLantern, lanternLight } from './ambient.js';
import { createHud, type Hud } from './hud.js';

/** How opaque the darkness quad is. 0.92 rather than 1: the eight per cent that survives keeps a
 *  wall's silhouette legible where no light reaches, which is the difference between a dark
 *  exhibit and an empty one. The panel moves it and both ends are instructive. */
let dark = 0.92;
/** Torches burning. The eight braziers are always alight and are counted separately — the
 *  ceiling is the cave's own supply of level floor rather than a constant, so the HUD can never
 *  claim a hundred are burning while the generator only found eighty. */
let lit = 0;

const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const openRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const boot = bootstrap({
  seed: 'lampblack', bounds: worldRect, background: '#04060d', palette: CAVE, clear: 'night', depth: 1536,
  camera: { minZoom: 0.5, maxZoom: 2.6, keepVisible: 0.45 },
  light: { scale: 0.55, falloff: 1, bloom: 0.3 },
  actions: { carry: ['tap'] },
});
// The floor of a cave is not a plane — `heightUnits` gives every open tile a unit or two of swell
// before the walls grow out of it — so the tile under a tap is the marched one, not the sea-level
// one the projection inverts to. `carry` below reads `e.gx`, which is exactly the read that would
// otherwise have gone uphill of the finger and told the console about it once.
const cave = createCavern(boot.seed); boot.setTerrain({ field: cave.field, maxHeightPx: cave.maxHeightPx });

/**
 * Pen the camera to the cave, and frame the chamber it opens in.
 *
 * The pan limit is the **whole** 128×128 grid — 8,192 × 4,336 world pixels, more than five times
 * the long axis of a 1440-wide viewport — so the cave runs off every edge at every zoom and there
 * is no corner to find. The opening *view* is an 18-tile box fitted to the viewport, which is a
 * zoom rather than a constant: a fixed zoom is a first frame that is wrong on somebody else's
 * screen.
 *
 * `setBounds` runs on every resize rather than once at boot because `Camera` **copies** its bounds
 * at construction and does not hold the reference, and the panel rebuilds the camera whenever a
 * zoom clamp moves. The fit runs once, because refitting would throw away a pan the visitor made.
 */
let framed = false;
function frame(): void {
  boot.camera.setBounds(tileBounds(0, 0, W, H, cave.maxHeightPx, worldRect));
  if (framed) return;
  framed = true;
  boot.camera.fitBounds(tileBounds(CX - 9, CY - 9, 18, 18, cave.maxHeightPx, openRect), 0);
}
boot.onResize(frame);
frame();

// ── the lantern, and the torches ─────────────────────────────────────────────────────────────

let lx = CX + 0.5;
let ly = CY + 0.5;
let toX = lx;
let toY = ly;
/** The floor under the lantern. Read twice a frame — once for the pool, once for the fixture —
 *  and they must be the same number or the light is thrown from somewhere the lamp is not. */
const lanternZ = (): number => heightAt(cave.field, lx, ly);

// A tap on rock is refused rather than clamped: walking into a wall would be the one interaction
// in the exhibit that lies about the world the light is revealing.
boot.onAction('carry', (e) => { if (openAt(cave, e.gx, e.gy)) { toX = e.gx + 0.5; toY = e.gy + 0.5; } });
// Exponential, not a tween: a tap during a walk retargets rather than restarting, and `damp` is
// frame-rate independent, so the lantern arrives at the same moment on a 60 Hz and a 144 Hz screen.
boot.onUpdate((dt) => { lx = damp(lx, toX, 3.4, dt); ly = damp(ly, toY, 3.4, dt); });

const more = (): void => { lit = clamp(lit + 100, 0, cave.flames.length - BRAZIERS); };
const douse = (): void => { lit = 0; };

// ── the frame ────────────────────────────────────────────────────────────────────────────────

const bucket = createBucket<Lit>(boot.order);
/** Every formation's silhouette top, measured once. `spriteHeightPx` replays the massing to answer
 *  it, so calling it per item per frame is a second full massing pass over five hundred formations
 *  every frame, for a number that cannot change — nothing here has a `Variant` that moves. */
const tops = cave.formations.map((f) => f.base + spriteHeightPx(shape(f.kind), f.v));
/** Hoisted, because they run once per item per frame and an inline arrow is a closure a frame —
 *  the rule `Bucket.each` states for the walk on the other side of the sort. */
const stand = (f: Formation, i: number): void => { bucket.add(f, f.gx, f.gy, 1, 1, tops[i] ?? f.base); };
const burn = (f: Flame, i: number): void => { if (i < BRAZIERS + lit) bucket.addPoint(f, f.gx + 0.5, f.gy + 0.5, f.base + 34); };

/** Dust, glow-worms, the lantern and the near band, all in the **Placement** pass — pass 3, and
 *  therefore *under* the light composite. Every one of them is world material and has to be able
 *  to be in the dark; `overlay` is above the mask and would light all four permanently. */
const nearField = (pen: Pen): void => { drawAmbient(pen, cave); drawLantern(pen, lx, ly, lanternZ()); drawNear(pen, cave); };

const passes: Passes = {
  backdrop: drawBackdrop,
  // The Terrain cull is `renderFrame`'s and is computed on the ground plane; this margins it.
  // Without it a wall vanishes the moment its foot leaves the bottom edge of the screen.
  maxHeightPx: cave.maxHeightPx,
  terrain: (pen, visible) => paintRock(pen, cave, visible),
  solids: (pen) => paintScene(pen, bucket),
  placement: nearField,
};

boot.onRender((pen) => {
  // Before the Terrain pass, which is what `LightField.begin` asks for: pools accumulate as the
  // world draws, and only the *composite* happens in the Light pass.
  boot.light.begin(pen, dark, 'night');
  lanternLight(pen, lx, ly, lanternZ());
  pourScene(pen, cave, BRAZIERS + lit);
  bucket.clear();
  cave.formations.forEach(stand);
  cave.flames.forEach(burn);
  renderFrame(pen, passes, boot.order);
});

// ── the two numbers that are one claim ───────────────────────────────────────────────────────

/**
 * The worst frame in the last five to ten seconds, which `docs/GALLERY.md` § Scale makes a gate.
 *
 * Not the average, and the reason is the whole point of the row: an average of 16 ms with every
 * eighth frame at 40 ms is a visible stutter reported as a healthy number.
 *
 * `loop.stats.worstFrameMs` is the worst since the last `resetStats()`, which is a *high-water
 * mark for the session* and would therefore report the first frame after boot for ever. Two
 * five-second buckets fix that with no ring buffer: the reading is the worse of the bucket that
 * closed and the one filling, so it always covers at least five seconds, never more than ten, and
 * never reads zero because a window just reset.
 */
let sealed = 0;
let markAt = 0;
function worstMs(): number {
  const t = boot.loop.realTime;
  if (t - markAt >= 5) { markAt = t; sealed = boot.loop.stats.worstFrameMs; boot.loop.resetStats(); }
  return Math.max(sealed, boot.loop.stats.worstFrameMs);
}

const read = (): Hud => ({ pools: boot.light.count, torches: lit, worstMs: worstMs() });
// `now` is the loop's own clock in milliseconds. `performance.now()` is banned in exhibit source
// and `bootstrap` hands back no reader for the `Clock` it built the loop with — a finding, and
// this is the reachable answer: `realTime` is that same monotonic reading, already accumulated.
const hud = createHud({ palette: boot.palette, read, onMore: more, onDouse: douse, now: () => boot.loop.realTime * 1000 });
boot.scope.add(drive(hud.ui, boot));
boot.scope.add(hud.destroy);

/**
 * The one knob this exhibit adds, and it is a kit parameter rather than plumbing.
 *
 * `LightField.begin` takes darkness per frame, so there is no construction-time option to move,
 * no rebuild, and — the finding — nowhere on the field to read it back from: `LightFieldOpts` has
 * `scale`, `falloff` and `bloom` and every one of them reads back under its own name, while the
 * number that decides whether there *is* a night is write-only. The variable above is the only
 * copy of it that exists, which is exactly the shadow copy non-negotiable 11 exists to remove.
 */
const darkness: RangeControl = {
  kind: 'range', key: 'dark', label: 'darkness', param: '@latticekit/draw LightField.begin darkness',
  note: 'Per frame, not per field — the same number a game would hand Palette.lerp.',
  min: 0, max: 1, step: 0.02, value: boot.params.num('dark', dark),
  wrong: { below: 0.5, says: 'Under a half the pools have nothing left to cut: the cave is a lit floor with decorative fires on it, and there is no exhibit.' },
  apply: (v) => { dark = v; },
};
dark = darkness.value;

controlPanel(
  [
    { kind: 'group', label: 'the dark' }, darkness, knobs.lightFalloff(boot), knobs.lightBloom(boot),
    { kind: 'group', label: 'the buffer' }, knobs.lightScale(boot), knobs.pixelRatio(boot), knobs.snap(boot),
    { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot), knobs.seed(boot),
  ],
  { params: boot.params, title: 'Caverns', subtitle: 'Pools that meet without a seam.', stats: knobs.frameTime(boot) },
);

boot.start();
