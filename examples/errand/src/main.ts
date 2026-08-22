/**
 * ERRAND — a Lattice exhibit. The wiring, the five verbs, and nothing else.
 *
 * An RPG in an afternoon. **Walk** anywhere by tapping the ground; **talk** to the miller on the
 * green; **take** the key out of the old well; **use** it on the mill gate; and every one of those is
 * **saved**, so a reload puts you back on the tile you were standing on, holding what you were
 * holding, with the gate you opened still open. Five verbs, and deliberately no sixth — no combat,
 * no inventory, no levels, no quest log, no shop. The discipline is the demonstration: an RPG's
 * skeleton really is this small, and showing that is worth more than showing a bigger one.
 *
 * `?seed=` turns the valley — the river, the fields, the thickets, the houses. The errand does not
 * move: the square, the miller, the well and the gate are constants in `valley.ts`, because an
 * exhibit whose objective is somewhere different on every link is not one anybody can share.
 *
 * | verb | here | leaning on |
 * |---|---|---|
 * | **walk** | {@link goTo} and the update handler | `PathFinder.find`, `pathSimplify`, `pathSample` |
 * | **talk** | arrival opens `hud.say`; the dialog's button calls {@link answer} | `@latticekit/ui` `panel` |
 * | **take** | `answer` at stage 1. Nothing is spliced — `present()` stops saying `true` | `errand.ts` |
 * | **use** | `answer` at stage 2, which changes what `makeCost` returns for one tile | `iso.path` |
 * | **save** | `auto`, and the two moments below that are allowed to write | `@latticekit/persist` |
 *
 * ## The two things this file is most exposed to
 *
 * **Picking walks the permutation the painter walked.** `bucket.pick` is `pickSorted` on the same
 * sorter instance, backwards, so the thing under the finger is the thing painted last there. Lamp
 * Road shipped a 212-pixel picking error by getting a related thing wrong; the test below
 * silhouettes the same tile the sprite is drawn on, so there is one geometry and not two.
 *
 * **When the write happens.** § Scale is explicit that a save is a frame hazard, and it is: a game
 * that serializes on the frame a player takes an object hitches at exactly the moment they are
 * looking at what they just did. So neither write here is on the frame anything changes. A stage
 * change is written from the dialog's **DOM click handler** — off the frame path entirely, with a
 * modal panel over the scene — and everything else is a coalescing autosave on `loop.real`, at most
 * once a second. The envelope is under a hundred bytes and the HUD prints its exact size, because
 * argument for a three-number save is that it is small enough to write while somebody is watching.
 */
import { asEpochMillis, type EpochMillis } from '@latticekit/core';
import { Path, PathFinder, boxSilhouette, gridToWorldX, gridToWorldY, pathDirAt, pathSample, pathSimplify, pointInPolygon } from '@latticekit/iso';
import { installFlushTriggers, scheduleFrom } from '@latticekit/persist';
import { drive } from '@latticekit/ui';
import { bootstrap, controlPanel, createBucket, knobs } from '../../_shared/src/index.js';
import { AFTERNOON } from './palette.js';
import { BOUNDS, GATE, MILLER, START, WELL, createValley, makeCost } from './valley.js';
import { advance, openErrand, type Play, type Spot, type SpotKind } from './errand.js';
import { drawScene } from './view.js';
import { createHud } from './hud.js';

/** World pixels a second, along the curve. Fast enough to cross the valley in half a minute, slow
 *  enough that the walk is the thing you are watching — and *arc length*, so nobody speeds up on a
 *  diagonal, which is the bug a grid-unit speed produces and which looks like a frame-rate problem. */
const SPEED = 168;

const boot = bootstrap({
  // `terrain: 'flat'`, and `ground.ts` § Why the valley is flat is the argument for it: this
  // exhibit has no height field on purpose, because terrain-aware picking is `terraces`' idea and
  // a hill under the miller is one more place the tile you touched and the tile you got can
  // disagree — in the exhibit whose whole promise is that they cannot. One word says so.
  seed: 'meadowmill', background: '#2a2434', palette: AFTERNOON, clear: 'sky', depth: 3072, bounds: BOUNDS, terrain: 'flat',
  camera: { zoom: 0.72, minZoom: 0.35, maxZoom: 2.4, keepVisible: 0.42 },
});
const valley = createValley(boot.seed);
// `Date.now` is the one clock here that is not the loop's, and it is on this line rather than hidden
// in `errand.ts` so that it is greppable. `persist` requires an epoch and refuses to default one,
// correctly — a zeroed `savedAt` is a bug that looks like nothing. It never reaches the world: no
// tile, no hash and no pixel is a function of it, so the valley stays deterministic.
const store = openErrand(boot.seed, (): EpochMillis => asEpochMillis(Date.now()));
const opened = store.open();
const play: Play = { stage: opened.state.stage, facing: 0, walked: 0, route: new Path(192),
  you: { kind: 'you', gx: opened.state.gx, gy: opened.state.gy } };
/** The three things a tap can find. Everything else in the valley is a tile. */
const CAST: readonly Spot[] = [{ kind: 'miller', gx: MILLER.gx, gy: MILLER.gy },
  { kind: 'key', gx: WELL.gx, gy: WELL.gy }, { kind: 'gate', gx: GATE.gx, gy: GATE.gy }];
const cost = makeCost(valley, () => play.stage === 3), finder = new PathFinder(4096);
// A save outlives the build that wrote it, and this exhibit's *layout* is part of the build: move a
// hedgerow and yesterday's tile is inside it. `persist` cannot see that — a migration chain steps a
// payload's shape, not the world it refers to — so the check belongs here, where the map is, and it
// is one comparison. Without it a stale position is a start tile with no route out of it, which
// arrives as a blank canvas rather than as anything a recognizer could have refused.
if (cost(play.you.gx, play.you.gy) <= 0) play.you.gx = START.gx, play.you.gy = START.gy;
const bucket = createBucket<Spot | number>(boot.order), scene = { valley, bucket, play, cast: CAST };
/** `following` is the camera. A drag hands it back to the player until the next tap-to-move, which is
 *  the only sane resolution of "the camera follows you" and "you can look wherever you like". */
let following = true, worstMs = 0, errandTo: Spot | undefined;
boot.camera.centerOn(gridToWorldX(play.you.gx, play.you.gy), gridToWorldY(play.you.gx, play.you.gy));

// ── walk ─────────────────────────────────────────────────────────────────────────────────────

/** Search, straighten, and set off. **The same `cost` goes into both calls**: `pathSimplify` with a
 *  different or absent cost function throws away the weighted route it was handed, and the only
 *  symptom is that people stop using the road — which reads as the cost function being wrong. */
function goTo(gx: number, gy: number, spot: Spot | undefined): void {
  if (!finder.find(cost, Math.round(play.you.gx), Math.round(play.you.gy), gx, gy, play.route)) return;
  pathSimplify(play.route, cost);
  play.walked = 0, errandTo = spot, following = true;
}

boot.onUpdate((dt) => {
  const route = play.route, you = play.you;
  if (route.nodeCount === 0) return;
  play.walked = Math.min(play.walked + SPEED * dt, route.arcLength);
  pathSample(route, play.walked, you), (play.facing = pathDirAt(route, play.walked));
  if (following) boot.camera.centerOn(gridToWorldX(you.gx, you.gy), gridToWorldY(you.gx, you.gy));
  if (play.walked < route.arcLength) return;
  const reached = errandTo;
  route.clear(), (errandTo = undefined);
  if (reached !== undefined) hud.say(reached.kind, play.stage, advance(reached.kind, play.stage) !== play.stage);
});

// ── talk, take, use: one tap, and the pick that has to be honest ──────────────────────────────

/** The silhouette every spot is tapped through: a little under a tile square and two storeys tall,
 *  which fits the miller, the well head and the gate leaves alike. One volume rather than three, so
 *  there is one geometry to keep in step with the drawing. */
const REACH = { ox: 0.06, oy: 0.06, w: 0.88, d: 0.88, zPx: 0, hPx: 54 }, poly = new Float64Array(12);
let tapX = 0, tapY = 0;

/** Hoisted: on a tap this runs once per drawable, backwards through the sorted order. */
const under = (item: Spot | number): boolean =>
  typeof item !== 'number' && item.kind !== 'you' &&
  (boxSilhouette(boot.camera, item.gx, item.gy, REACH, poly), pointInPolygon(tapX, tapY, poly, 6));

boot.on('tap', (g) => {
  tapX = g.sx, tapY = g.sy;
  // You always walk *to* the thing first, so a tap across the valley is a journey rather than a
  // teleporting cursor. `(gx, gy + 1)` is where you stand to use one; `valley.ts` arranges that.
  const hit = bucket.pick(under), spot = typeof hit === 'number' ? undefined : hit;
  if (spot === undefined) goTo(Math.floor(g.gx), Math.floor(g.gy), undefined);
  else goTo(spot.gx, spot.gy + 1, spot);
});
boot.on('dragstart', () => { following = false; });

/** The dialog was answered — **the whole of take and use**, and the only place `stage` moves. It runs
 *  in a DOM click handler with a modal panel over the scene, which is why the write is here: off the
 *  frame path, at the one moment a player has just done something they might reload to check. */
function answer(kind: SpotKind): void {
  play.stage = advance(kind, play.stage), auto.flush();
}

// ── the frame, and § Scale's cost row ────────────────────────────────────────────────────────

/**
 * § Scale's cost row: the worst frame in a rolling ten seconds, as two five-second buckets.
 *
 * It is `loop.stats.worstFrameMs` — the **work** one pump did — and not the interval between two
 * frames, which is what this measured first and which is useless: on a 60 Hz display a perfectly
 * idle app reports 16.7 ms every time, because that is what vsync is. An average of 16 with every
 * eighth frame at 40 is a visible stutter and a healthy-looking number, which is the tail
 * `docs/PERFORMANCE.md` argues for; `worstFrameMs` is that tail, but it accumulates since the last
 * `resetStats()`, so a *window* costs a reset the exhibit has to perform itself.
 */
let held = 0, swapAt = 0;
boot.onRender((pen, _alpha, nowMs) => {
  if (nowMs > swapAt) held = boot.loop.stats.worstFrameMs, boot.loop.resetStats(), (swapAt = nowMs + 5000);
  const now = boot.loop.stats.worstFrameMs;
  worstMs = now > held ? now : held, drawScene(pen, scene);
});

// ── the overlay, and the save that has to be visible ─────────────────────────────────────────

/** `seen` is the identity of the last `WriteResult` the HUD has been told about. `persist` allocates
 *  one object per real attempt rather than per tick, so identity is the change signal and there is
 *  nothing to poll for — which is also why this needs no timestamp of its own from the package. */
let writtenAt = -1, bytes = 0, seen: unknown;
const hud = createHud(boot.palette, () => performance.now(), answer, () => {
  const last = auto.lastWrite;
  if (last !== null && last !== seen && ((seen = last), last.written)) writtenAt = Date.now(), bytes = last.bytes;
  return { stage: play.stage, bytes, worstMs, status: store.status, savedAgo: writtenAt < 0 ? -1 : (Date.now() - writtenAt) / 1000 };
});
boot.scope.add(drive(hud.ui, boot)), boot.scope.add(hud.destroy);
const auto = store.autosave(() => ({ stage: play.stage, gx: Math.round(play.you.gx), gy: Math.round(play.you.gy) }), { schedule: scheduleFrom(boot.loop.real) });
boot.scope.add(installFlushTriggers(auto, { visibility: document, page: window }));

controlPanel([
  { kind: 'group', label: 'the tap' }, knobs.tapSlop(boot), knobs.longPress(boot),
  { kind: 'group', label: 'camera' }, knobs.minZoom(boot), knobs.keepVisible(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Errand', stats: knobs.frameTime(boot), subtitle: 'Walk, talk, take, use, save. The whole genre, small enough to read.' });

// The one thing that must be true before a frame runs: the errand can be finished. `Path` reports a
// failed search as a sentence naming two tiles, and a valley whose thickets sealed the well would
// otherwise first announce itself as a tap that does nothing, on somebody else's seed.
for (const s of CAST) if (!finder.find(cost, play.you.gx, play.you.gy, s.gx, s.gy + 1, play.route)) throw new Error(`errand: seed "${boot.seed}" is unwinnable — ${play.route.searchFailure ?? 'no route'}`);
play.route.clear(), boot.start();
