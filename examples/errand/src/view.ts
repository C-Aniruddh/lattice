/**
 * @art — the frame: what goes into the depth sorter, and what each entry looks like when the
 * painter reaches it.
 *
 * Delete this module and the errand is unchanged — the same walk, the same tap, the same three
 * numbers on disk — in an entirely black window. It holds nothing between frames (the bucket is
 * `main.ts`'s, cleared and refilled every frame), returns nothing any decision reads, and moves no
 * number a player is playing for. `examples/terraces` splits the same seam the same way, with its
 * `fillProps` living beside its painter rather than in its wiring.
 *
 * ## One bucket, one sorter, one frame
 *
 * The player, the miller, the well, the gate, the mill, two dozen villagers and several hundred
 * trees all go into the same `DepthSorter`. Two collections sorted separately means a player
 * standing *in front of* a house they are behind, on one frame in twenty, and `createBucket` makes
 * that unrepresentable rather than merely unlikely: `add` performs both writes and there is no way
 * to do one without the other.
 *
 * A drawable is an integer wherever it can be, because several hundred objects a frame is several
 * hundred allocations if they are not: a **negative** entry is villager `−1 − i`, a **non-negative**
 * one is the tile `gx << 8 | gy` — eight bits, because the valley is 160 tiles across and seven would
 * fold every row above 127 back on top of another one — and only the cast are objects.
 *
 * ## What pays for the density
 *
 * § Scale scores cost before it scores density, and this exhibit is the dense kind. Three things
 * pay for it and none of them is a smaller valley:
 *
 * - **`onScreen`.** `visibleTileBounds` answers with an axis-aligned *tile* rectangle and the frame
 *   is a rotated one inside it, so about half of every range that arrives here is off the frame.
 * - **`planTile`.** Three quarters of a village's `WALL` tiles are the inside of a house whose
 *   origin tile draws the whole building, and a crop tile on the ridge draws nothing at all. Both
 *   used to reach the sorter, get sorted, get walked, and paint nothing.
 * - **`lodAt`.** The far band is already asked to be hazier, which is also permission for it to be
 *   cheaper — a tree there is one solid instead of five.
 */
import { type GridPoint } from '@latticekit/iso';
import { renderFrame, type Passes, type Pen } from '@latticekit/draw';
import { type Bucket } from '../../_shared/src/index.js';
import { MAX_HEIGHT_PX, type Valley } from './valley.js';
import { type Play, type Spot } from './errand.js';
import { onScreen, paintAir, paintGround, paintSky } from './ground.js';
import { lodAt, paintGate, paintTile, paintWell, planTile } from './sprites.js';
import { drawCarried, drawPerson, villagerAt } from './people.js';
import { drawChaff, drawRooks, drawRoute, drawSmoke } from './ambient.js';

/** How many villagers walk the loops. Two dozen, in a village of about thirty houses. */
const VILLAGERS = 26;

/** Everything the frame needs and cannot recompute. Assembled once by `main.ts`. */
export interface Scene {
  readonly valley: Valley;
  readonly bucket: Bucket<Spot | number>;
  readonly play: Play;
  /** The miller, the well and the gate — the three things a tap can find. */
  readonly cast: readonly Spot[];
}

const range = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const at: GridPoint = { gx: 0, gy: 0 };
/** The frame currently being painted, so the hoisted painter below can reach it without being a
 *  closure allocated once per frame. */
let scene: Scene | undefined;
let pen: Pen | undefined;

/** Walk the sorted order forwards and paint. Hoisted, because a closure here is a closure a frame. */
const paint = (item: Spot | number): void => {
  const s = scene, p = pen;
  if (s === undefined || p === undefined) return;
  const play = s.play;
  if (typeof item === 'number') {
    if (item < 0) return drawPerson(p, -1 - item, at.gx, at.gy, villagerAt(-1 - item, p.t, at), false);
    const gx = item >> 8, gy = item & 255;
    return paintTile(p, s.valley.seed, gx, gy, s.valley.kind.get(gx, gy), lodAt(gx, gy, p.camera.zoom), play.stage === 3);
  }
  if (item.kind === 'gate') return paintGate(p, play.stage === 3, play.stage === 2);
  if (item.kind === 'key') return paintWell(p, play.stage === 1);
  const me = item.kind === 'you';
  drawPerson(p, me ? -1 : -2, item.gx + 0.5, item.gy + 0.5, me ? play.facing : 0, true);
  if (me && play.stage === 2) drawCarried(p, item.gx + 0.5, item.gy + 0.5);
};

const passes: Passes = {
  backdrop: (p) => paintSky(p),
  maxHeightPx: MAX_HEIGHT_PX,
  terrain: (p, visible) => {
    if (scene !== undefined) paintGround(p, scene.valley, visible);
  },
  solids: (p) => {
    pen = p;
    scene?.bucket.each(paint);
  },
  overlay: (p) => {
    const s = scene;
    if (s === undefined) return;
    paintAir(p);
    if (s.play.route.nodeCount > 0) drawRoute(p, s.play.route, s.play.walked);
    drawSmoke(p, s.valley);
    drawRooks(p, s.valley.seed);
    drawChaff(p);
  },
};

/**
 * Fill the sorter and draw the frame. The whole of the exhibit's render, in one call.
 *
 * The cast is added *after* the scenery deliberately: `DepthSorter` breaks ties by insertion
 * sequence, so a person standing on the same tile as a hedge is painted after it rather than
 * inside it, and that ordering is stable on every engine because the Lattice ordering rule says a
 * comparator may never return zero.
 */
export function drawScene(p: Pen, s: Scene): void {
  scene = s;
  const { bucket, valley, play } = s, zoom = p.camera.zoom;
  bucket.clear();
  p.camera.visibleTileBounds(range, 2);
  valley.kind.forEach(range, (gx, gy, kind) => {
    if (!onScreen(p, gx, gy)) return;
    const plan = planTile(valley.seed, gx, gy, kind, lodAt(gx, gy, zoom));
    if (plan !== 0) bucket.add((gx << 8) | gy, gx, gy, plan & 7, (plan >> 3) & 7, plan >> 6);
  });
  for (let i = 0; i < VILLAGERS; i++) {
    villagerAt(i, p.t, at);
    if (onScreen(p, at.gx, at.gy)) bucket.addPoint(-1 - i, at.gx, at.gy, 0, 0.22);
  }
  // Every member of the cast is in the frame at every stage. The well does not vanish when its key
  // is taken and the miller does not vanish when he has nothing left to say — what a stage changes
  // is what they *look* like and what answering them does, which is `paint` and `advance`.
  for (const spot of s.cast) {
    if (onScreen(p, spot.gx, spot.gy)) bucket.add(spot, spot.gx, spot.gy, 1, 1, 60);
  }
  bucket.addPoint(play.you, play.you.gx + 0.5, play.you.gy + 0.5, 0, 0.22);
  renderFrame(p, passes, bucket.order);
}
