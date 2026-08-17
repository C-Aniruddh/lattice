/**
 * The place — and, in the last thirty lines of it, **the eight closed curves the crowd is sampled
 * along**, which are the only thing here the exhibit could not be built without.
 *
 * A route is a `Path` built with {@link Path.push} from *fractional* grid coordinates, which is the
 * half of that class a searched road never exercises: nothing is planned, nothing is looked up, and
 * the loops are drawn the way a landscape architect would draw them. What the class contributes is
 * the cumulative **world-pixel** arc length beside each node, and that one array is the whole
 * exhibit — it is what turns `s = (φ·i + t·v) mod 1` into a person.
 *
 * ## Why the loops close, and why they come in pairs
 *
 * Each loop's last node is its first node again, so a walker whose arc length wraps past
 * `arcLength` re-enters at zero having moved exactly the distance it moved on every other frame.
 * `pathSample` **clamps** rather than wrapping — deliberately, so a caller can write a ping-pong or
 * a queue that bunches at a gate instead of being handed one policy — so the modulo belongs to
 * `crowd.ts`, and the closed loop is what makes the modulo invisible.
 *
 * The rings are authored in pairs a little apart and `crowd.ts` runs the odd one of each pair
 * backwards. That is the most valuable decision in the layout: a promenade with two counter-flowing
 * lanes reads as a crowd, and one lane all going the same way reads as a conveyor belt no matter
 * how well the people are drawn.
 *
 * ## The squash, which is the whole composition
 *
 * A circle in **grid** space projects to an ellipse exactly 2:1 wide. A widescreen frame is 1.6:1,
 * so a round piazza large enough to run off the left and right edges also runs a long way off the
 * top and bottom, and everything worth looking at ends up in a band across the middle. So the
 * island — and every route, and every colonnade `dressing.ts` stands on one — is an ellipse in the
 * *screen's* axes instead: {@link isle} measures `p = gx − gy` (screen x) against `q = gx + gy`
 * (screen y) with the first divided by {@link SQUASH}, which makes the world **3.2:1** and the
 * piazza three viewports wide against one and a half viewports tall.
 *
 * One consequence is load-bearing and worth stating: the routes are concentric with the island
 * rather than with a grid circle, so the outer promenade stays on stone for its whole lap. A grid
 * circle of the same size walks into the lagoon at the top and bottom of every revolution.
 */
import { TAU, hashString } from '@lattice/core';
import { Path, TileGrid, type HeightField, type Rect } from '@lattice/iso';

/** Map size, its centre, and the world pixels one height unit is worth. */
export const W = 80, H = 80, PC = 40, STEP_PX = 5;
/** Tile kinds. `ground.ts` is the only reader. */
export const WATER = 0, PAVE = 1, STEP = 2;
/** How far the paving reaches in the squashed metric, and how high the piazza stands. */
const R = 40, TOP = 10;
/** Screen-x is divided by this before it is measured, so the island is 1/0.62 wider than round. */
export const SQUASH = 0.62;

export interface Plaza {
  readonly seed: number;
  readonly kind: TileGrid;
  readonly field: HeightField;
  /** The eight loops. Sampled by arc length, never stepped through. */
  readonly routes: readonly Path[];
  readonly maxHeightPx: number;
}

/**
 * How far out a grid offset is, measured in the screen's own axes rather than the lattice's.
 *
 * Every radius in this exhibit is one of these — the shoreline, the steps, the eight routes and
 * every ring `dressing.ts` places on. That is what keeps them concentric under one constant.
 */
export function isle(dx: number, dy: number): number {
  const p = (dx - dy) * SQUASH;
  return Math.sqrt(p * p + (dx + dy) * (dx + dy));
}

/** Height in units at a grid **vertex**. Vertices, not tiles: adjacent tiles then share their
 *  corners exactly, which is the whole reason `iso.height` samples the way it does. */
function unitsAt(gx: number, gy: number): number {
  const d = isle(gx - PC, gy - PC);
  return d <= R ? TOP : d <= R + 1.3 ? 7 : d <= R + 2.6 ? 3 : 0;
}

/** Which kind of ground a tile is, asked at its centre. */
function kindAt(gx: number, gy: number): number {
  const d = isle(gx + 0.5 - PC, gy + 0.5 - PC);
  return d > R + 2.6 ? WATER : d <= R ? PAVE : STEP;
}

/**
 * Push `n + 1` nodes around a closed ring whose radius is `base + amp · cos(2a + turn)`.
 *
 * One function for both shapes on the piazza: `amp = 0` is a concentric promenade, and a positive
 * `amp` is the long lozenge that swings between the promenades. The lozenges are what stop the
 * plaza reading as a roundabout — a real square has people crossing it as well as going round it.
 */
function loop(base: number, amp: number, turn: number, n: number): Path {
  const path = new Path(n + 2);
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * TAU;
    /* @tier-b pixels only, all three */
    const rho = base + amp * Math.cos(2 * a + turn * TAU);
    const p = (rho / SQUASH) * Math.cos(a), q = rho * Math.sin(a);
    path.push(PC + (q + p) * 0.5, PC + (q - p) * 0.5);
  }
  return path;
}

/**
 * The rectangle the camera frames, in world pixels — deliberately **smaller than the world**.
 *
 * `camera.fitBounds` fits what it is given *inside* the viewport, so handing it the map is how an
 * exhibit ends up as a diorama with four visible corners. This is the heart of the piazza: 1520 ×
 * 950, which is 1.6:1 and therefore lands on the same zoom whichever axis a widescreen viewport
 * binds on. The island around it is 4128 × 1280, so **2.7 viewports of world run off the sides and
 * a third of one off the bottom** at the opening frame, and the first thing anyone does is drag.
 *
 * The vertical placement is the one judged number: it puts the waterfront colonnade a tenth of the
 * way down the frame, with a ribbon of lagoon and the far shore above it, and the fountain low and
 * near — which is the near/mid/far reading `docs/GALLERY.md` § Scale asks for.
 */
export const HEART: Rect = { minX: -760, minY: 540, maxX: 760, maxY: 1490 };

export function createPlaza(seedText: string): Plaza {
  const seed = hashString(seedText);
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  const kind = new TileGrid(W, H, { bits: 8, outOfBounds: WATER });
  heights.fillFrom(unitsAt);
  kind.fillFrom(kindAt);
  // Three counter-flowing pairs, and two lozenges swinging across the open middle band. Node
  // counts rise with the radius so the outer promenade is no more faceted than the inner one.
  const routes = [loop(11, 0, 0, 44), loop(12.9, 0, 0, 48), loop(21, 0, 0, 64), loop(23, 0, 0, 68),
    loop(33, 0, 0, 88), loop(35.4, 0, 0, 92), loop(27, 3.4, 0, 76), loop(27, 3.4, 0.25, 76)];
  return { seed, kind, field: { heights, stepPx: STEP_PX }, routes, maxHeightPx: TOP * STEP_PX + 160 };
}
