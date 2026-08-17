/**
 * CANYON — a Lattice exhibit. The wiring, the timeline, and the frame.
 *
 * One river, one plateau, and a million years. Drag the bar and the gorge opens beneath you:
 * strata appearing in the wall as the cut goes down through them, side canyons branching back
 * into the tableland, scree piling at the feet of the walls, the depth in the corner climbing
 * past six thousand feet. Let go and it keeps going, because the ground never stops moving.
 * `?seed=` chooses the canyon.
 *
 * ## The one idea, and the one thing that would kill it
 *
 * Every other terrain in this gallery is a height field that was generated once and then stood
 * still. Here the ground is a function of *time*, and the point `docs/GALLERY.md` makes about it
 * is that erosion genuinely **accumulates** — there is no closed-form expression for "what does
 * this valley look like at t = 400,000 years", the way there is for a walker's position in
 * `Crowd`. So the scrub bar is a re-run: it starts from the seed, or from the nearest exact
 * checkpoint, and steps. What would kill the exhibit is doing the easy version — caching frames,
 * or interpolating between two saved height fields — because the claim being made is about
 * *determinism*, and a picture nobody recomputed proves nothing about determinism. `deeptime.ts`
 * owns that, and the HUD publishes the fingerprint that checks it.
 *
 * ## What is logic and what is not
 *
 * This file, `erosion.ts`, `deeptime.ts` and `hud.ts` are the exhibit's logic and are the only
 * four modules the line rule counts. `palette.ts`, `strata.ts`, `sky.ts` and `view.ts` each carry
 * `@art` in their header: delete any of them and the canyon still forms, still scrubs, and still
 * lands on the same fingerprint at the same epoch — it simply cannot be seen.
 *
 * ## Three numbers, and why each is where it is
 *
 * `PLAY_RATE` is in **epochs per second**, not epochs per frame, because nothing says a
 * simulation must step once per rendered frame and pretending otherwise ties how fast deep time
 * runs to how fast someone's laptop is. `CATCH_UP` is the step budget one *painted* frame may
 * spend getting to where the bar was dragged — fourteen steps at about a third of a millisecond
 * each, measured, which is the largest catch-up that still leaves the frame in budget.
 *
 * There is no third number, and there used to be. This file rolled its own worst-frame window out
 * of `worstFrameMs` and a `resetStats()` on a timer, which was wrong twice: `worstFrameMs` is the
 * *pump's own work*, so a pause landing between two pumps is invisible to it, and the reset zeroed
 * `fps` for every other reader of the same object. `loop` grew `stats.worstGapMs` for exactly this
 * and `bootstrap` publishes it as `boot.worstMs` beside `boot.cadenceMs`. Four exhibits wrote this
 * meter by hand and produced three different wrong answers; this one now reads the shared one.
 */
import { renderFrame } from '@lattice/draw';
import { drive } from '@lattice/ui';
import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
import { CANYON } from './palette.js';
import { STEPS, createDeepTime } from './deeptime.js';
import { REACH, frame, passesFor } from './view.js';
import { createHud } from './hud.js';

const PLAY_RATE = 40, CATCH_UP = 14;
/**
 * How long the timeline rests at a million years before running again, in epochs of wall clock.
 *
 * Without it, playback crosses the end and wraps on the same frame, so a visitor who drags the
 * bar to the right-hand end sees the finished gorge for about a sixtieth of a second and then
 * watches it restart from a plateau — which reads as the exhibit throwing away the thing they
 * asked for. Six seconds is long enough to look at it and short enough that the loop is still
 * obviously a loop.
 */
const HOLD = 240;
/**
 * Where the timeline opens, in epochs.
 *
 * Not zero, and § Scale is the reason: *"an exhibit is judged on a screenshot taken at the
 * opening frame"*, and at epoch zero this exhibit is honestly a plateau with a damp crease in it.
 * Opening a quarter of the way in means the first frame is a gorge — the thing the row promises —
 * and scrubbing left to watch it fill back in is the same demonstration run the other way. The
 * warm-up below is the only unbudgeted `goTo` in the exhibit; it costs about a fifth of a second
 * once, before the first paint, which is where a generation step belongs.
 */
const OPENS_AT = 520;

const boot = bootstrap({
  seed: 'colorado', bounds: REACH, background: '#7fb5e2', palette: CANYON, clear: 'sky', depth: 32,
  camera: { zoom: 0.62, minZoom: 0.34, maxZoom: 2.4, keepVisible: 0.9 },
});
boot.onResize((w, h) => { frame(boot.camera, w, h); });
frame(boot.camera, boot.camera.viewW, boot.camera.viewH);

const time = createDeepTime(boot.seed), passes = passesFor(time);
let want = OPENS_AT, playing = true, behind = false, from = -1, nowMs = 0;

boot.onUpdate((dt) => {
  // Round the loop rather than stop at the end: a canyon at a million years is not finished, and
  // running it again from the seed is the same demonstration a second time.
  if (playing) { want += dt * PLAY_RATE; if (want > STEPS + HOLD) want = 0; }
});

boot.onRender((pen, _alpha, ms) => {
  nowMs = ms;
  // The model steps **here**, once per painted frame, and not in `onUpdate`. Not a stylistic
  // choice: a fixed-step loop runs as many updates per pump as it needs to catch up, so an
  // erosion budget spent per *update* makes a slow frame ask for more erosion, which makes the
  // next frame slower. The first build of this exhibit had exactly that spiral — `ticks` at 236
  // against `renders` at 4 — and it is invisible in an average. Deep time is still paced against
  // the wall clock in `onUpdate`; what is capped here is how much of it one frame will pay for.
  const target = Math.min(want, STEPS) | 0;
  time.goTo(target, CATCH_UP);
  // `behind` is computed **here**, against the target this frame was actually asked for. The HUD
  // samples on its own timer, and `want` moves between the two, so comparing there reported
  // "catching up" on every frame of a run that was never behind by more than a rounding.
  behind = time.epoch !== target;
  // Latched, because a restore happens on exactly one frame and the HUD would never see it: this
  // keeps "resumed from checkpoint k" on screen until the model is playing and stepping again,
  // which is the whole window in which the answer is still k.
  if (time.resumedFrom >= 0 || (playing && !behind && time.steps > 0)) from = time.resumedFrom;
  // Only once the model has arrived. Following it while it is still catching up drags the bar
  // back out from under a visitor who has just thrown it at the far end — the model is a hundred
  // frames behind, `follow` writes that epoch into the input, and the release undoes the drag.
  if (playing && !behind) hud.follow(time.epoch);
  renderFrame(pen, passes);
});

const hud = createHud({
  palette: boot.palette,
  read: () => ({ time, worstMs: boot.worstMs, cadenceMs: boot.cadenceMs, behind, from }),
  onScrub: (epoch) => { playing = false; want = epoch; },
  onRelease: () => { playing = true; },
  now: () => nowMs,
});
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

controlPanel([{ kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.maxZoom(boot),
  knobs.keepVisible(boot), { kind: 'group', label: 'pixels' }, knobs.snap(boot),
  knobs.pixelRatio(boot), knobs.seed(boot)],
  { params: boot.params, title: 'Canyon', stats: knobs.cost(boot),
    subtitle: 'A million years of a river. The bar re-runs the model.' });

// The warm-up, then the clock. See OPENS_AT.
time.goTo(OPENS_AT, STEPS); boot.start();

