/**
 * CLAY — a Lattice exhibit. The wiring, the brush, and the frame.
 *
 * Drag on the ground. It rises under your finger, and everything downstream of it resettles: the
 * river leaves the channel you dammed and finds another, the walkers crossing the valley re-plan
 * around the ridge you just made, the trees ride it up and let go of it when it gets too steep, and
 * the new face catches the light. Hold shift, or press CUT, and the same drag takes it away.
 * `?seed=` chooses the valley.
 *
 * ## The one idea, and the one thing that would kill it
 *
 * `Canyon` and this exhibit make the same claim — *terrain in this kit is a live field, not a fixed
 * asset* — and `docs/GALLERY.md` keeps both because they make it in opposite ways. Canyon shows the
 * change happening **to** the world over a million years, and it took four rebuilds to make legible
 * because a scrub bar asks a visitor to notice that a picture differs from one they saw ten seconds
 * ago. This one puts the change **under their finger**, where noticing is not something they have
 * to be asked to do.
 *
 * What would kill it is building a *tool*. `docs/GALLERY.md` names that trap by name: no palette of
 * brushes, no undo stack, no save, no size slider, no mode beyond raise and lower. There is exactly
 * one brush in this file and everything else on screen is consequence. A visitor who wants a
 * different valley changes the seed.
 *
 * ## The drag is the brush, and the camera is what pays for it
 *
 * `gesture.claim()` takes every drag away from the camera controller before it ever reaches it, so
 * a drag sculpts and never pans. That is not free and it is worth saying which side of the trade
 * this exhibit is on: **panning moves to the arrow keys and the pinch, and the first gesture is not
 * an invitation to go and look.** § Scale's extent row is met by the world being three viewports
 * across; its *spirit* — the first gesture is to go and see the part you cannot — is deliberately
 * spent on sculpting instead, because an exhibit whose subject is what your finger does cannot make
 * the finger do something else first.
 *
 * ## The pick used to be this exhibit's own problem, and now it is one word
 *
 * `@latticekit/input` resolves a pointer through `worldToTile`, the exact inverse of the projection
 * **on the plane `z = 0`** — the only plane it inverts. Undeclared, `gx`/`gy` on every gesture and
 * every action assume the ground is flat, and `Terraces` measured that at 281 px and 14 tiles on a
 * static hillside.
 *
 * Here it was worse than static, and in a way no other exhibit can reproduce: **the error moved as
 * the visitor sculpted.** Raising ground under the cursor pushes the true tile toward the viewer, so
 * a brush driven by a flat-ground `gx` walks *away* from the finger exactly as fast as the ridge
 * grows — the visitor makes a hill and the brush slides off the far side of it while they hold
 * still. Which is why this file used to carry a `screenToTileOnHeights` call of its own, a raw
 * `pointermove` listener to feed it `sx`/`sy`, and a copy of the pointer in {@link brush}.
 *
 * **All three are gone.** K44 gave `input` the seam: `boot.setTerrain({ field: clay.land, … })`
 * below hands it the live field — held, never copied, so ground raised this frame is ground the
 * next query resolves on — and the pick is then `boot.input.hoverTile(at)`, which is the same
 * march through the same picker every gesture uses. The two answers cannot disagree any more,
 * because there is now only one of them.
 *
 * ## What is logic and what is not
 *
 * This file, `clay.ts`, `life.ts` and `hud.ts` are the exhibit's logic and are the only four
 * modules the line rule counts. `palette.ts`, `ground.ts`, `props.ts`, `view.ts` and `readout.ts`
 * each carry `@art` in their header: delete any of them and the ground still deforms, the water
 * still finds its way, and every walker still replans the routes the brush crossed — it simply
 * cannot be seen. `npm run gallery` checks it.
 */
import { renderFrame } from '@latticekit/draw';
import type { Tile } from '@latticekit/iso';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { CLAY } from './palette.js';
import { MAX_UNITS, N, STEP_PX, createClay, flow, sculpt } from './clay.js';
import { createLife, step, touch } from './life.js';
import { REACH, frame, passesFor } from './view.js';
import { fillThings, type Thing } from './props.js';
import { createHud } from './hud.js';

/**
 * The brush, in three numbers.
 *
 * `RADIUS` is in tiles and is fixed, which is the § *no tool* rule costing something real: four and
 * a half tiles is a landform at the opening zoom and a hill at maximum zoom, and there is no size
 * control because a size control is the first thing a tool grows.
 *
 * `RATE` is height **units per second**, not per frame — nothing says the ground must rise once per
 * rendered frame, and pacing a brush against a laptop is how the same gesture makes a different
 * hill on two machines. Nine was thirty in the first build, and thirty is *too fast to sculpt
 * with*: a two-second stroke reached the ceiling and produced a flat-topped wall with vertical
 * sides, which is a cliff rather than a landform and reads as the exhibit having one setting. At
 * nine, half a second of dab is a mound you can see, a stroke is a ridge, and reaching `MAX_UNITS`
 * takes about eight seconds of deliberate holding. `SUBSTEPS` is how many water steps one frame pays for: five puts a dam
 * break five tiles a frame, which is fast enough that a visitor reads it as *immediate* and slow
 * enough to watch. `WARM` is the run before the first paint — the river has to have reached the far
 * edge before anybody sees it, or the opening frame is a dry valley with a puddle at the top.
 */
const RADIUS = 4.6, RATE = 9, SUBSTEPS = 5, WARM = 2400;

const boot = bootstrap({
  seed: 'riverbed', bounds: REACH, background: '#a8cbe0', palette: CLAY, clear: 'sky', depth: 2048, camera: { zoom: 0.76, minZoom: 0.36, maxZoom: 2.6, keepVisible: 0.9 },
  // Bound to a *held* modifier and read through `input.held`, never through the action's own edge:
  // an action fires once per press, and what this needs to know is what is true right now.
  actions: { cut: ['key:ShiftLeft', 'key:ShiftRight'] },
});
boot.onResize((w, h) => { frame(boot.camera, w, h); }); frame(boot.camera, boot.camera.viewW, boot.camera.viewH);

const clay = createClay(boot.rng.derive('valley').seed), scatter = boot.rng.derive('scatter').seed;
// The declaration, and the reason there is no picking maths left in this file. `clay.land` is the
// terrain without the water on it — a brush follows the ground it moves, not the surface of the
// river standing on it — and the ceiling is the brush's own, because nothing here can raise a tile
// past `MAX_UNITS`. Held rather than copied, so a stroke resolves against the hill it is building.
boot.setTerrain({ field: clay.land, maxHeightPx: MAX_UNITS * STEP_PX });
const life = createLife(clay, boot.rng.derive('folk')), bucket = createBucket<Thing>(boot.order);
/** Where the brush is, how wide, and whether it is down. The pointer is **not** in here any more:
 *  `input` tracks it for `hoverTile`, and a second copy is a second thing to keep in step.
 *  `at` is the pick's out parameter, one `Tile` for the life of the exhibit. */
const brush = { gx: 80, gy: 80, radius: RADIUS, down: false }, at: Tile = { gx: 0, gy: 0 };
const passes = passesFor(clay, bucket, brush);
let mode = false, units = 0;

// Claimed, so the camera controller never sees it. See the header for what that costs. Nothing
// here reads `g.sx`/`g.sy` any longer: the only thing this exhibit ever did with the pointer was
// pick a tile from it, and `input` is now the thing that does that.
for (const kind of ['dragstart', 'drag', 'dragend'] as const) boot.on(kind, (g) => { g.claim(); brush.down = kind !== 'dragend'; });

/**
 * One update: find the tile under the pointer *on the terrain as it stands now*, move the clay,
 * tell `life` what the stroke crossed, then run the water.
 *
 * The pick is re-run every update rather than once per gesture, and that is the part of the old
 * workaround worth keeping: the ground is rising under the finger, so the answer from the top of a
 * stroke is wrong by the height of the hill by the bottom of it. It costs one terrain march —
 * about forty bilinear samples at this ceiling — per update, which is under a fiftieth of a
 * millisecond and is paid whether or not the brush is down, because the ring has to sit on the
 * ground either way.
 *
 * `false` is a pointer that is not over the world: no mouse yet, or the finger that was drawing
 * has lifted on a touch screen. The brush keeps its last tile rather than jumping, which is what
 * the ring under a lifted finger should do.
 */
function update(dt: number): void {
  if (boot.input.hoverTile(at)) {
    brush.gx = at.gx + 0.5; brush.gy = at.gy + 0.5; units = clay.terr[at.gy * N + at.gx] ?? 0;
    if (brush.down) {
      sculpt(clay, brush.gx, brush.gy, RADIUS, (cutting() ? -RATE : RATE) * dt);
      touch(life, clay, brush.gx, brush.gy, RADIUS);
    }
  }
  flow(clay, SUBSTEPS); step(life, clay, dt);
}

/** The button and the modifier drive the same one number, and shift *inverts* rather than sets —
 *  so shift-dragging in CUT mode raises, which is the thing a hand reaches for without being told. */
function cutting(): boolean { return mode !== boot.input.held('cut'); }

boot.onUpdate(update);
boot.onRender((pen) => {
  bucket.clear(); fillThings(bucket, clay, life, scatter, boot.camera);
  renderFrame(pen, passes, boot.order);
});

const hud = createHud({
  palette: boot.palette, onMode: (cut) => { mode = cut; }, now: () => boot.loop.realTime * 1000,
  read: () => ({ units, water: clay.wetCount, searches: life.searches, stranded: life.stranded,
    worstMs: boot.worstMs, cadenceMs: boot.cadenceMs, cutting: cutting() }),
});
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

controlPanel([{ kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot)],
  { params: boot.params, title: 'Clay', stats: knobs.cost(boot), subtitle: 'The ground is material. Drag it, and watch everything else resettle.' });

// The river, before the first paint. See WARM.
flow(clay, WARM); boot.start();
