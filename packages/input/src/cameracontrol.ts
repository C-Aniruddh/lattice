/**
 * The gestures-to-camera policy. **`iso` owns where the camera may be; this owns where the
 * player is trying to put it.**
 *
 * Each half has a hard requirement the other cannot meet. The camera must run in Node with no
 * DOM — depth sorting, culling, pathfinding, golden tests and a headless replay all need
 * `toScreen` and none of them have a pointer — so a camera that knew about gestures could not
 * be imported by any of them. The controller cannot run without knowing what a wheel notch is
 * worth, whether a release becomes a glide, and how a held key becomes a speed, and putting
 * that in `iso` would make the kit's most reusable package the one that has to know Firefox
 * reports scroll in lines.
 *
 * The seam is one method: `zoomAt(factor, sx, sy)`. Neither package can express a zoom without
 * an anchor, which is how "zoom is anchored to the pointer" stops being a convention and
 * becomes a property of the signatures.
 *
 * **Which clock this runs on.** Gestures are delivered on ticks; the camera integrates its
 * pan, its zoom and its glide in `frame`, at display rate. That asymmetry is deliberate: a
 * camera is a view, not simulation state, and a drag must track a finger at the rate the
 * finger is visibly moving. If a game's fixed step is 100 ms — entirely plausible for an idle
 * economy — a tick-rate camera would lag a drag by a step and feel broken however good the
 * interpolation. The cost is stated plainly: **the replay contract covers what the player did,
 * not where the camera was.**
 *
 * Pure, given a camera: this module names no DOM global and reads no clock. `nowMs` arrives as
 * a parameter.
 */

import { damp, expectFinite } from '@lattice/core';
import type { Camera } from '@lattice/iso';

/**
 * `KeyboardEvent.code`s that pan the camera, and the screen direction each one means.
 *
 * Codes, not letters: a `code` is a physical position, so this stays under the same four keys
 * on AZERTY and on Dvorak. Panning "left" moves the camera left, which moves the world right,
 * which is why the sign here is negative — the player is dragging the viewport, not the map.
 */
export const PAN_KEYS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['ArrowLeft', [-1, 0] as const],
  ['ArrowRight', [1, 0] as const],
  ['ArrowUp', [0, -1] as const],
  ['ArrowDown', [0, 1] as const],
]);

/**
 * `KeyboardEvent.code`s that zoom, and their direction: `+1` in, `-1` out, `0` not a zoom key.
 *
 * Both the main row and the numpad, because a player who has found one expects the other.
 * `Equal` rather than `Plus`: unshifted `+` is the `Equal` key on a US layout and `code`
 * reports the physical key, never the character it would type.
 */
export function zoomKeyDirection(code: string): number {
  if (code === 'Equal' || code === 'NumpadAdd') return 1;
  if (code === 'Minus' || code === 'NumpadSubtract') return -1;
  return 0;
}

/**
 * Speed below which a glide has stopped, in CSS pixels per second.
 *
 * 8 px/s is 0.13 px in a 60 Hz frame — under a tenth of a pixel, which is below the smallest
 * motion a display can show. Stopping there rather than at zero means the glide reaches rest
 * in finite time instead of asymptotically approaching it for ever, and `gliding` therefore
 * becomes `false` at a moment a test can name.
 */
export const GLIDE_STOP_PX_PER_S = 8;

/**
 * Natural logarithm of 2, so a half-life converts to a decay rate.
 *
 * `damp`'s `lambda` is "distance falls by a factor of e per second"; a half-life is "falls by
 * a factor of 2". `lambda = ln2 / halfLife`. Written as a named constant rather than inline so
 * that the conversion appears once and can be checked once.
 */
const LN2 = Math.LN2;

/**
 * The gestures-to-camera policy.
 *
 * There is deliberately **no `setZoom`**. The only way to change scale is {@link zoomBy},
 * whose anchor is a required parameter — so origin-anchored zoom is not somewhere you can
 * arrive by accident, only by deliberately typing the viewport center. Origin-anchored zoom is
 * the single most common reason tile-game cameras feel broken: the thing you are looking at
 * slides out from under you as you zoom towards it.
 */
export interface CameraController {
  /**
   * Off means gestures still arrive and nothing drives the camera.
   *
   * For a fixed-camera game, and for the modal case: a game that disables the controller while
   * a dialog is open gets a camera that cannot be nudged behind it. Turning it off also kills
   * any glide, because a camera that coasts while disabled arrives somewhere the player did
   * not choose.
   */
  enabled: boolean;

  /**
   * Pan by a screen delta. Divided by zoom inside `iso`, so a drag tracks the finger exactly
   * at any scale — multiplying instead is the bug where a zoomed-in map slides at a crawl.
   */
  panBy(dxScreen: number, dyScreen: number): void;

  /**
   * Multiplicative zoom about a screen anchor. **The anchor is not optional.**
   *
   * @throws RangeError if `factor` is not finite and positive — `iso` refuses rather than
   *   turning the camera into `NaN`, which is a state nothing downstream recovers from.
   */
  zoomBy(factor: number, anchorSx: number, anchorSy: number): void;

  /**
   * Kill any glide immediately.
   *
   * Call it when a modal opens or a scene ends. A camera still coasting under a dialog has
   * moved somewhere the player did not choose while they could not see it.
   */
  stop(): void;

  /** True while a fling is still moving the camera. False the moment it reaches rest. */
  readonly gliding: boolean;
}

/** What the controller needs from the system around it, and nothing more. */
export interface CameraControlOptions {
  readonly camera: Camera;
  /** Pixels per second a held pan key is worth. See `GestureProfile.keyPanPxPerS`. */
  readonly keyPanPxPerS: number;
  /** Below this release speed a drag ends without a glide. See `GestureProfile.flingMinPxPerS`. */
  readonly flingMinPxPerS: number;
  /** Half-life of the glide's exponential decay. See `GestureProfile.flingHalfLifeMs`. */
  readonly flingHalfLifeMs: number;
  /** Is this `KeyboardEvent.code` down right now? The controller never sees a key event. */
  readonly keyHeld: (code: string) => boolean;
  /** Start disabled, for a game whose camera is fixed. */
  readonly enabled: boolean;
}

/** The controller plus the two entry points only the system may call. */
export interface CameraControl extends CameraController {
  /**
   * A drag has released at this screen velocity; start a glide if it is fast enough.
   *
   * Below `flingMinPxPerS` this stops the camera dead instead, because without a floor every
   * drag drifts after the finger lifts and the camera can never be placed exactly.
   */
  fling(vxPxPerS: number, vyPxPerS: number): void;

  /**
   * Integrate one displayed frame: held-key panning, then the glide.
   *
   * Called from `InputSystem.frame`, after everything else it does, so the ordering inside the
   * package matches the ordering the game is told to use — tick, update, frame, draw.
   *
   * @param dtMs Milliseconds since the previous frame. Zero on the first one, and negative
   *   deltas are ignored rather than integrated backwards.
   */
  integrate(dtMs: number): void;
}

/**
 * Build the controller for one camera.
 *
 * @throws RangeError if any threshold is not a finite number.
 */
export function createCameraControl(options: CameraControlOptions): CameraControl {
  const { camera, keyHeld } = options;
  const keyPanPxPerS = expectFinite(options.keyPanPxPerS, 'cameraControl.keyPanPxPerS');
  const flingMinPxPerS = expectFinite(options.flingMinPxPerS, 'cameraControl.flingMinPxPerS');
  const flingHalfLifeMs = expectFinite(options.flingHalfLifeMs, 'cameraControl.flingHalfLifeMs');
  /** Decay rate in 1/seconds, from the half-life in milliseconds. */
  const lambda = (LN2 * 1000) / flingHalfLifeMs;

  let enabled = options.enabled;
  let vx = 0;
  let vy = 0;

  const control: CameraControl = {
    get enabled(): boolean {
      return enabled;
    },
    set enabled(next: boolean) {
      enabled = next;
      if (!next) {
        vx = 0;
        vy = 0;
      }
    },

    panBy(dxScreen: number, dyScreen: number): void {
      camera.panByScreen(dxScreen, dyScreen);
    },

    zoomBy(factor: number, anchorSx: number, anchorSy: number): void {
      camera.zoomAt(factor, anchorSx, anchorSy);
    },

    stop(): void {
      vx = 0;
      vy = 0;
    },

    get gliding(): boolean {
      return vx !== 0 || vy !== 0;
    },

    fling(vxPxPerS: number, vyPxPerS: number): void {
      const speedSq = vxPxPerS * vxPxPerS + vyPxPerS * vyPxPerS;
      if (speedSq < flingMinPxPerS * flingMinPxPerS) {
        vx = 0;
        vy = 0;
        return;
      }
      vx = vxPxPerS;
      vy = vyPxPerS;
    },

    integrate(dtMs: number): void {
      if (!enabled || !(dtMs > 0)) return;
      const dtS = dtMs / 1000;

      // Held keys integrate as a *speed*, never as a jump per keypress. The source game panned
      // 90 px per keydown and thereby inherited the operating system's key-repeat rate — a
      // camera whose speed is set in the player's accessibility preferences.
      let kx = 0;
      let ky = 0;
      for (const [code, direction] of PAN_KEYS) {
        if (!keyHeld(code)) continue;
        kx += direction[0];
        ky += direction[1];
      }
      if (kx !== 0 || ky !== 0) {
        // Normalize the diagonal, or holding two keys pans 41% faster than holding one and the
        // map appears to speed up when the player changes direction. `sqrt` is Tier A.
        const scale = keyPanPxPerS * dtS * (kx !== 0 && ky !== 0 ? 1 / Math.sqrt(2) : 1);
        camera.panByScreen(kx * scale, ky * scale);
      }

      if (vx === 0 && vy === 0) return;
      camera.panByScreen(vx * dtS, vy * dtS);
      // Exponential decay, so the glide is frame-rate independent: the same flick coasts the
      // same distance at 30 fps and at 144. `damp` carries the `@tier-b` marker in `core`;
      // this value reaches pixels and never a hash, which is the rule that makes it safe.
      vx = damp(vx, 0, lambda, dtS);
      vy = damp(vy, 0, lambda, dtS);
      if (vx * vx + vy * vy < GLIDE_STOP_PX_PER_S * GLIDE_STOP_PX_PER_S) {
        vx = 0;
        vy = 0;
      }
    },
  };

  return control;
}
