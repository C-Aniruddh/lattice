/**
 * Attaching a durable thing to the world.
 *
 * A name tag, a construction ring, a health bar and a walker all need the same thing: a place
 * in the world that survives a pan, a zoom and a re-route. That place is **a grid position**,
 * which is the currency this whole package deals in — `pathSample` writes one for a moving
 * thing, `footprintAnchor` writes one for a static thing, and the three functions here turn
 * either into the three things a world position has to become: a screen point for drawing, a
 * visibility answer for a DOM overlay, and a stereo pan for a sound.
 *
 * There is no `Anchor` class, no registry, no subscription and nothing to tear down. An
 * anchor computed against a camera would be stale the next time anyone pans, so none is.
 */

import type { Vec2 } from '@lattice/core';
import type { Camera } from './camera.js';
import type { GridPoint } from './projection.js';
import { HALF_H, HALF_W } from './projection.js';

/**
 * A durable attachment point: where a thing *is* in grid space, plus how high above the
 * ground plane it hangs.
 *
 * Three mutable numbers, owned by whoever owns the entity. **It extends {@link GridPoint}**,
 * which is what makes the unification with path sampling literal rather than rhetorical:
 * `pathSample(road, s, anchor)` writes a walker's position straight into its anchor, no
 * conversion and no intermediate, and the caller then sets `zPx` from `heightAt`. A static
 * anchor is written once at placement time and never again.
 *
 * **An overlay must hold its entity's anchor, not a copy of it.** A tag that copied
 * `{ gx, gy, zPx }` at creation stays where the building used to be when it moves and stays
 * on screen when it is demolished. `iso` cannot help — it does not know entity lifetimes — so
 * the rule is that the entity owns exactly one anchor, everything attached to it holds a
 * reference, and whatever destroys the entity destroys the overlay in the same statement.
 */
export interface Anchor extends GridPoint {
  /** Height above the `z = 0` plane in **world pixels**, not tiles and not storeys. On
   *  terrain this is `heightAt(field, gx, gy)` plus however far up the thing hangs. */
  zPx: number;
}

/**
 * Project an anchor to a screen point, now, for this camera. Allocation-free; call it once
 * per anchored thing per frame and never store the result.
 *
 * This is the function `@lattice/ui` should be handed as its `project` hook and the one
 * `@lattice/draw` should call for a world-space label. Both get the same pixel, which is the
 * point: a HUD tag and a canvas ring on the same building must not disagree by a subpixel,
 * and they will if each derives its own.
 */
export function anchorToScreen(camera: Camera, a: Readonly<Anchor>, out: Vec2): Vec2 {
  out.x = camera.toScreenX((a.gx - a.gy) * HALF_W);
  out.y = camera.toScreenY((a.gx + a.gy) * HALF_H - a.zPx);
  return out;
}

/**
 * Is this anchor within `marginPx` CSS pixels of the viewport?
 *
 * A DOM tag for an off-screen building must be *hidden* rather than positioned at −4000px:
 * every browser still lays out and composites the second one, and a hundred of them is a
 * measurable frame cost for something nobody can see.
 *
 * @param marginPx Slack on every side, default `0`. Pass roughly half the overlay's width if
 *   a tag should fade out rather than vanish the instant its anchor crosses the edge.
 */
export function anchorVisible(camera: Camera, a: Readonly<Anchor>, marginPx = 0): boolean {
  const sx = camera.toScreenX((a.gx - a.gy) * HALF_W);
  const sy = camera.toScreenY((a.gx + a.gy) * HALF_H - a.zPx);
  return (
    sx >= -marginPx &&
    sx <= camera.viewW + marginPx &&
    sy >= -marginPx &&
    sy <= camera.viewH + marginPx
  );
}

/**
 * Stereo pan for a sound made at this anchor: `-1` hard left, `0` center, `+1` hard right,
 * **unclamped** beyond the viewport edges.
 *
 * The third of the three things a world position has to become. `@lattice/audio` cannot
 * compute it because the mapping needs a camera and `audio` may not depend on this package;
 * the game should not compute it because then every game rewrites it. How far a pan is
 * allowed to travel is a mixing policy and belongs to whoever owns the mixer — clamp it
 * there, not here.
 *
 * Elevation does not enter it, deliberately: raising a lamp does not move the sound sideways.
 */
export function anchorPan(camera: Camera, a: Readonly<Anchor>): number {
  return camera.normalizedX((a.gx - a.gy) * HALF_W);
}
