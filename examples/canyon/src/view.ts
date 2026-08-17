/**
 * The composition: where the camera stands, how far it may wander, and which passes run.
 *
 * @art
 *
 * Delete this file and the exhibit still forms its canyon, still scrubs, and still lands on the
 * same fingerprint at the same epoch — it opens on the kit's default camera looking at the middle
 * of the world at whatever zoom the URL last said, and it draws nothing. Everything here decides
 * what a visitor is *looking at*, which is art direction with a matrix in it, and none of it
 * decides what anything *is*.
 *
 * ## Why the framing is a fabricated rectangle
 *
 * `fitBounds` is the only route `iso` offers to a chosen zoom — `Camera.zoom` is documented as a
 * position rather than a policy, and it moves through `zoomAt` — so an exhibit that knows the
 * scale it wants has to express it as a rectangle of exactly the viewport's own aspect, which
 * then fits at exactly that scale. That is what {@link frame} builds. It is filed as a kit
 * finding; the workaround is three lines and the absence of `camera.setZoom` is not obvious until
 * you go looking for it.
 *
 * A fixed zoom would also be a first frame that is wrong on somebody's screen, so the scale is
 * derived from the viewport height and clamped: tall windows see more canyon, short ones do not
 * lose the far rim.
 *
 * ## Why the reach is not the map's bounding box
 *
 * The grid projects to a diamond and the canyon now runs along the diamond's *vertical* diagonal,
 * so the corners of the bounding box are places with no ground in them at all. {@link REACH} is
 * the inscribed band instead — long *up and down the canyon*, so that four fifths of it is
 * off-screen at the opening frame and a visitor's first gesture is to go and look, which is
 * § Scale's extent row; and narrow across it, so no pan ever finds an edge or a featureless
 * tableland, which is its edges row.
 */
import { clamp } from '@lattice/core';
import { rectFromSize, type Camera, type Rect } from '@lattice/iso';
import type { Passes } from '@lattice/draw';
import { paintCanyon } from './strata.js';
import { drawBirds, drawSky } from './sky.js';
import { STEP_PX } from './erosion.js';
import type { DeepTime } from './deeptime.js';

/**
 * How far the camera may wander, in world pixels. See the header.
 *
 * It must also be **larger than the viewport on both axes**, and that is not a comfort margin:
 * `Camera.clamp` cannot satisfy a `keepVisible` of 0.9 against a rectangle shorter than the frame,
 * so it falls back to pinning the camera at the rectangle's center — which silently overrides
 * whatever `fitBounds` just chose and puts the composition somewhere nobody picked. Two builds of
 * this exhibit have spent a while wondering why moving the frame did nothing.
 *
 * The turn swapped which axis is which, and the two now have opposite jobs:
 *
 * | | |
 * |---|---|
 * | **x, ±1,200** | across the gorge, and deliberately tight. `clampAxis` allows `±(maxX + halfW − 0.9·2·halfW)`, which at the opening zoom is about 160 px of sideways travel: enough that a drag feels live, not enough to leave the canyon and land on featureless tableland. The subject is a slot a thousand pixels wide and there is nothing to see beside it |
 * | **y, −1,400 to 2,200** | *along* the gorge, and deliberately long: this is the axis a visitor travels, from the haze at the head of the canyon down past the deepest cut. The top end is negative because a tall window's frame reaches far above {@link BASE}, and the bottom stops short of the map's own edge, where the gorge peters out into the pinned rim |
 */
export const REACH: Rect = { minX: -1200, minY: -1400, maxX: 1200, maxY: 2200 };
/**
 * **The world y of the frame's bottom edge** — the composition is hung from the bottom rather than
 * from its middle, because the bottom is where the subject is.
 *
 * The canyon runs away from the camera up the screen, so the bottom edge is the *near* end of the
 * gorge: the widest, deepest, most saturated part of it, and the place the river enters the frame.
 * Everything above it is further away. A frame centered on a fixed y would put that edge somewhere
 * different on every window — `CENTER_Y + h / 2·zoom` is 780 px down on a laptop and 1,100 on a
 * tall monitor — so the one thing the composition is built on would be the one thing that moved.
 * Anchoring the bottom instead spends a tall window's extra height on distance, which is where
 * extra height belongs when the subject recedes.
 *
 * **1,250** puts the water entering the bottom edge at about the hundred and eighteenth diagonal
 * and the mesa tops either side of it at the hundred and thirty-second, so the gorge *opens* toward
 * the viewer at the bottom of the frame — the rims sweep out of the bottom corners and the river
 * runs up the middle. That splay is the only perspective an orthographic projection will give, and
 * it comes free from the fact that the floor is lower than the rim.
 */
const BASE = 1250;
/**
 * The frame the opening zoom is computed against, in world pixels — **width first**, and that is
 * the turn.
 *
 * Cut across the frame, the canyon's size on screen was its depth and the zoom came from the
 * viewport height. Cut along it, the canyon's size on screen is its **width**: both rims are in
 * shot at once, 1,300 world px apart at the opening epoch and 1,900 at the end, and if they do not
 * fit nothing else matters. 2,000 holds the finished gorge — 1,900 px rim to rim — with a strip of
 * mesa top either side of it and nothing more: the tableland is the frame, not the subject.
 *
 * `Math.min` of the two, rather than the width alone, because a short wide window would otherwise
 * zoom in until the canyon ran off the top and bottom of a letterbox. 1,560 is the world height the
 * composition needs: about seventy diagonals, which is the run from the haze at the head of the
 * canyon down to the near end at {@link BASE}.
 *
 * **What the scale cannot buy is depth, and it is worth stating where that went.** A wall's face is
 * `cut · stepPx` = 312 px tall at epoch two thousand in this viewpoint, against 742 in the previous
 * one, because a wall's horizontal run projects onto the screen's *vertical* axis when the gorge is
 * cut across the frame and onto its horizontal axis when the gorge is cut along it. `strata.ts`'s
 * header has the full table. This viewpoint pays 58% of the apparent height for both walls, a
 * receding river and the shape of the photograph, and the haze has to carry what the geometry no
 * longer does.
 */
const WIDE = 2000, TALL = 1220;
/** Scratch. One rectangle for the life of the exhibit rather than one per resize. */
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Put the camera where the canyon reads, and pen it to {@link REACH}. */
export function frame(camera: Camera, w: number, h: number): void {
  const zoom = clamp(Math.min(w / WIDE, h / TALL), 0.34, 0.9);
  rectFromSize(opening, -w / (2 * zoom), BASE - h / zoom, w / zoom, h / zoom);
  camera.setBounds(REACH);
  camera.fitBounds(opening);
}

/**
 * The frame's passes, hoisted once.
 *
 * `maxHeightPx` is the margin the Terrain cull needs: `renderFrame` computes the visible tile
 * range on the *ground plane*, because a camera has no idea what a height field is, and this
 * exhibit's ground stands up to fifty-four units above it. Without the margin the far rim
 * vanishes the moment its base leaves the bottom of the frame, with nothing missing anywhere else.
 */
export function passesFor(time: DeepTime): Passes {
  return {
    backdrop: (pen) => { drawSky(pen); },
    maxHeightPx: 62 * STEP_PX,
    terrain: (pen, visible) => { paintCanyon(pen, time, visible); },
    // The birds are handed the epoch and the cut for one reason: § *A mile deep has to feel a
    // mile deep* asks for birds **below the rim line**, and a bird in screen space has no idea
    // where the rim is. Both numbers move — uplift raises the rim, incision widens it — so the
    // band they fly in is computed per frame rather than picked once against a screenshot.
    effects: (pen) => { drawBirds(pen, time.epoch, time.cut); },
  };
}
