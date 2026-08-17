/**
 * The two answers, drawn on the hill: where you are, where a flat-ground pick thinks you are,
 * and the gap between them.
 *
 * @art
 *
 * Delete this file and both picks are still computed, both are still correct, and the exhibit is
 * still one idea — it just has no way to show it. Nothing here decides anything or remembers
 * anything; it reads {@link Pick} and paints.
 *
 * ## Why both are always on screen
 *
 * The instinct is to draw the right answer and put the wrong one behind a toggle. That produces
 * an exhibit whose claim — *this was hard, and here is what it costs to get wrong* — has to be
 * taken on trust, because a visitor never sees the failure and a correct highlight looks exactly
 * like a highlight nobody had to think about. So the wrong answer is drawn **continuously, on
 * hover**, in red, with a dashed line to the right one; the toggle only decides which of the two
 * a tap actually uses. The bug is the demonstration and the fix is the punchline.
 *
 * ## Why a marker is drawn on its tile's own four corner heights
 *
 * A diamond drawn flat and then lifted by one height would float over a bank and cut into the
 * terrace above it, which is a second, unrelated elevation bug sitting on top of the one being
 * explained. Each corner is placed at *its own* vertex height, exactly as `isoTerrain` places
 * them, so the marker lies on the ground the way paint would.
 *
 * That is also why the red marker is always *above* the green one on screen. The flat-ground
 * answer has a smaller `gx + gy` — it is the tile the ray crosses at sea level, which is further
 * from the viewer — and it is then drawn on its own, higher ground, so the two errors compound in
 * the same direction. The dashed line between them is the only honest way to show that they are
 * two answers to one question rather than two different questions.
 */
import { withAlpha, type Pen, type Rgba } from '@latticekit/draw';
import type { HeightField, Tile } from '@latticekit/iso';
import { stakes, type Pick } from './pick.js';
import { place } from './place.js';

/** The tile outline being drawn. Not `pen.xy`, because the connector below needs two centers to
 *  survive the strokes in between. */
const quad = new Float64Array(8);
/** Two points: the pin, and the dashed run between the answers. */
const line = new Float64Array(4);
/** March speed of the dashes, in pixels per second. Slow enough to read as a measurement and not
 *  as a loading bar. */
const CRAWL = 26;

/** Write a tile's four screen corners into {@link quad}, each on its own vertex height. */
function outline(pen: Pen, field: HeightField, gx: number, gy: number): void {
  const h = field.heights;
  const s = field.stepPx;
  const n = place(pen, gx, gy, h.get(gx, gy) * s);
  quad[0] = n.x;
  quad[1] = n.y;
  const e = place(pen, gx + 1, gy, h.get(gx + 1, gy) * s);
  quad[2] = e.x;
  quad[3] = e.y;
  const s2 = place(pen, gx + 1, gy + 1, h.get(gx + 1, gy + 1) * s);
  quad[4] = s2.x;
  quad[5] = s2.y;
  const w = place(pen, gx, gy + 1, h.get(gx, gy + 1) * s);
  quad[6] = w.x;
  quad[7] = w.y;
}

/** A highlighted tile, plus the vertical pin that keeps it findable when the hill is zoomed out
 *  far enough that a diamond is nine pixels wide. */
function mark(pen: Pen, field: HeightField, t: Tile, color: Rgba, strong: number): void {
  const ink = pen.palette.get('ink');
  outline(pen, field, t.gx, t.gy);
  // A dark halo under the bright outline, and it is not decoration: `ok` green on a planted
  // terrace is green on green, and a single-stroke marker disappears on exactly the ground this
  // exhibit most needs it to be legible over. Two strokes make it read on any tile in the world.
  pen.surface.stroke(quad, 4, true, withAlpha(ink, 0.5 * strong), 4.2 * strong + 1.4);
  pen.surface.poly(quad, 4, withAlpha(color, 0.34 * strong));
  pen.surface.stroke(quad, 4, true, withAlpha(color, strong), 1 + 1.6 * strong);
  const foot = place(pen, t.gx + 0.5, t.gy + 0.5, field.heights.get(t.gx, t.gy) * field.stepPx);
  line[0] = foot.x;
  line[1] = foot.y;
  line[2] = foot.x;
  line[3] = foot.y - (14 + 26 * strong);
  pen.surface.stroke(line, 2, false, withAlpha(ink, 0.45 * strong), 3.6);
  pen.surface.stroke(line, 2, false, withAlpha(color, strong), 1.6);
  pen.surface.ellipse(line[2] ?? 0, line[3] ?? 0, 3.4 + strong, 3.4 + strong, withAlpha(ink, 0.5 * strong));
  pen.surface.ellipse(line[2] ?? 0, line[3] ?? 0, 2.4 + strong, 2.4 + strong, withAlpha(color, strong));
}

/** The center of a tile, on its ground — the endpoint the error is measured between, and drawn
 *  between. Written straight into {@link line}. */
function anchor(pen: Pen, field: HeightField, t: Tile, at: number): void {
  const c = place(pen, t.gx + 0.5, t.gy + 0.5, field.heights.get(t.gx, t.gy) * field.stepPx);
  line[at] = c.x;
  line[at + 1] = c.y;
}

/**
 * The Placement pass.
 *
 * `aware` is not used to *choose* what to draw — both markers are always drawn — only to decide
 * which of them is the live one, which is the emphasis a visitor needs to connect the toggle in
 * the overlay to the thing that moves on the hill.
 */
export function drawMarkers(pen: Pen, field: HeightField, pick: Pick, aware: boolean): void {
  const p = pen.palette;
  for (const stake of stakes) {
    const foot = place(pen, stake.gx + 0.5, stake.gy + 0.5, field.heights.get(stake.gx, stake.gy) * field.stepPx);
    line[0] = foot.x;
    line[1] = foot.y;
    line[2] = foot.x;
    line[3] = foot.y - 26;
    pen.surface.stroke(line, 2, false, withAlpha(p.get('ink'), 0.75), 1.5);
    // A pennant, and it is the reason a stake reads as *planted here* rather than as a scratch:
    // it hangs off one side, so a row of them shows which way the hill is being worked.
    quad[0] = foot.x;
    quad[1] = foot.y - 26;
    quad[2] = foot.x + 11;
    quad[3] = foot.y - 22;
    quad[4] = foot.x;
    quad[5] = foot.y - 17;
    pen.surface.poly(quad, 3, p.get('brand'));
  }
  if (!pick.onMap) return;

  // The dashed run between the two answers. Drawn first so both markers sit on top of it, and
  // crawling from the wrong answer toward the right one so the line has a direction.
  anchor(pen, field, pick.truth, 0);
  const tx = line[0] ?? 0;
  const ty = line[1] ?? 0;
  anchor(pen, field, pick.naive, 2);
  line[0] = tx;
  line[1] = ty;
  if (pick.tilesApart > 0) {
    /* @tier-b pixels only — a dash offset, never hashed */
    pen.surface.stroke(line, 2, false, withAlpha(p.get('ink'), 0.55), 1.5, 7, -(pen.t * CRAWL) % 14);
  }

  mark(pen, field, pick.naive, p.get('bad'), aware ? 0.45 : 1);
  mark(pen, field, pick.truth, p.get('ok'), aware ? 1 : 0.45);
}
