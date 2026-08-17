/**
 * The composition: where the camera stands, how far it may wander, which passes run, and the air.
 *
 * @art
 *
 * Delete this file and the exhibit still deforms, still floods, still replans — it opens on the
 * kit's default camera looking at the top corner of the world at whatever zoom the URL last said,
 * and it draws nothing. Everything here decides what a visitor is *looking at*, which is art
 * direction with a matrix in it, and none of it decides what anything is.
 *
 * ## Why the framing is a fabricated rectangle
 *
 * `fitBounds` is the only route `iso` offers to a chosen zoom — `Camera.zoom` is documented as a
 * position rather than a policy and moves through `zoomAt` — so an exhibit that knows the scale it
 * wants has to express it as a rectangle of the viewport's own aspect, which then fits at exactly
 * that scale. That is {@link frame}. `Canyon` filed it as a kit finding and this exhibit hit it
 * again, from a cold start, in the same three lines: the absence of `camera.setZoom` is not obvious
 * until you go looking for it.
 *
 * ## The opening frame, against § Scale's five rows
 *
 * | row | here |
 * |---|---|
 * | **extent** | the world is 6,144 × 3,072 world pixels against a viewport of about 1,900 × 1,180 at the opening zoom — three and a quarter viewports on its long axis, with the head of the valley and its mouth both off screen |
 * | **fill** | the ground reaches every edge. The only background is the strip of air above the far upland, which is under a sixth of the frame |
 * | **edges** | the camera is penned inside {@link REACH}, which stops short of the map's own border, so no pan ever finds a corner with sky behind it |
 * | **density** | eight hundred and twenty trees, boulders and huts, about two hundred and forty of them in frame, plus a hundred and forty terrain tiles across the valley floor alone |
 * | **depth** | three bands, and the middle one is the subject: the near upland at full saturation, the valley with the river in it, and the far upland washing into `air` over twenty-two diagonals of haze |
 *
 * The one thing this composition does *not* do is invite the first gesture to be a pan, and that is
 * deliberate rather than an oversight. The first gesture here is a drag, and a drag sculpts —
 * § Scale's extent row exists so that a world does not read as a diorama, and it does not; but a
 * visitor who wants to go and look somewhere else pans with the arrow keys or pinches out, because
 * the brush has claimed the drag. See `main.ts`.
 */
import { clamp } from '@lattice/core';
import { rectFromSize, type Camera, type Rect } from '@lattice/iso';
import type { Passes, Pen } from '@lattice/draw';
import type { Bucket } from '../../_shared/src/index.js';
import { MAX_UNITS, STEP_PX, type Clay } from './clay.js';
import { drawBrush, paintClay } from './ground.js';
import { paintThings, type Thing } from './props.js';

/**
 * How far the camera may wander, in world pixels — and it is the **inscribed** rectangle of the
 * map's diamond rather than the diamond's own bounding box.
 *
 * A square grid projects to a diamond, so the corners of its bounding box are places with no ground
 * in them at all. `clay.ts` § `CELLS` has the inequality this rectangle is the solution of; the
 * short version is that every corner of the viewport has to stay inside the diamond at every camera
 * position this rectangle allows, and the two constraints — one from the near pair of map edges and
 * one from the far pair — pull against each other.
 *
 * It must also be **larger than the viewport on both axes**, and that is not a comfort margin:
 * `Camera.clamp` cannot satisfy `keepVisible` against a rectangle shorter than the frame, and falls
 * back to pinning the camera at the rectangle's centre — silently overriding whatever `fitBounds`
 * chose and putting the composition somewhere nobody picked. 3,400 × 1,950 against a frame of about
 * 2,940 × 1,550 is the margin that leaves, and it is why the map is 160 tiles and not 96.
 */
export const REACH: Rect = { minX: -1700, minY: 1585, maxX: 1700, maxY: 3535 };
/** The world rectangle the opening zoom is computed against, and where the frame's centre sits.
 *
 * 3,000 px wide holds the valley floor and both uplands, with the shoulders running off the left and
 * right edges. `Math.min` of the two, rather than the width alone, because a short wide window would
 * otherwise zoom in until the valley ran off the top and bottom of a letterbox.
 *
 * The centre is on the valley's own axis at the hundred and fortieth diagonal — far enough down that
 * the river arrives already gathered, so the first thing a visitor's cursor lands on is water. */
const WIDE = 3000, TALL = 1800, CENTER_Y = 2240;

/** Scratch. One rectangle for the life of the exhibit rather than one per resize. */
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Put the camera where the valley reads, and pen it to {@link REACH}. */
export function frame(camera: Camera, w: number, h: number): void {
  const zoom = clamp(Math.min(w / WIDE, h / TALL), 0.4, 1.1);
  rectFromSize(opening, -w / (2 * zoom), CENTER_Y - h / (2 * zoom), w / zoom, h / zoom);
  camera.setBounds(REACH);
  camera.fitBounds(opening);
}

/** How far down the frame the air has become haze, and the two slots it runs between. */
const HORIZON = 0.66;

/**
 * The frame's passes, hoisted once.
 *
 * `maxHeightPx` is the margin the Terrain cull needs. `renderFrame` computes the visible tile range
 * on the *ground plane*, because a camera has no idea what a height field is, and here the ground
 * can stand fifty-eight units above it — the brush's own ceiling, taken from `clay.ts` rather than
 * guessed, because a guess low is a summit that vanishes the moment its base leaves the bottom edge
 * and nothing else in the frame missing.
 */
export function passesFor(
  clay: Clay,
  bucket: Bucket<Thing>,
  brush: { readonly gx: number; readonly gy: number; readonly radius: number; readonly down: boolean },
): Passes {
  return {
    backdrop: (pen) => { sky(pen); },
    maxHeightPx: MAX_UNITS * STEP_PX,
    terrain: (pen, visible) => { paintClay(pen, clay, visible); },
    solids: (pen) => { paintThings(pen, bucket); },
    // The brush ring is in **placement** rather than in effects, which is where `draw` puts a
    // ghost: it is the thing the next gesture will act on, and it belongs over the solids so a
    // visitor can see which trees are inside it.
    placement: (pen) => { drawBrush(pen, clay, brush.gx, brush.gy, brush.radius, brush.down, pen.t); },
  };
}

/**
 * The air.
 *
 * One ramp across the whole viewport in screen space, from `sky` at the top to `air` two thirds of
 * the way down. `bootstrap` already clears to a flat slot every frame; this is what stops the strip
 * above the far upland being a hard band of one blue, and it is what the terrain's own haze term
 * dissolves *into*, so there is no seam between the furthest ground and the sky above it.
 *
 * Two colors and no gradient object: `polyRamp` is per-vertex color on a GPU and allocates nothing,
 * which is the difference between a backdrop and the animated-color trap § Scale names.
 */
function sky(pen: Pen): void {
  const w = pen.camera.viewW, h = pen.camera.viewH, xy = pen.xy;
  xy[0] = 0; xy[1] = 0; xy[2] = w; xy[3] = 0; xy[4] = w; xy[5] = h; xy[6] = 0; xy[7] = h;
  pen.surface.polyRamp(xy, 4, 0, 0, 0, h * HORIZON, pen.palette.get('sky'), pen.palette.get('air'));
}
