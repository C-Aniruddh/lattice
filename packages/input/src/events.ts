/**
 * What a handler is handed, and the one place a screen pixel becomes a tile.
 *
 * ## Coordinates come in all three spaces
 *
 * Guessing wrong about which space a callback wanted is the most common bug in this layer, and
 * a game that converts by hand will eventually convert with the wrong camera. So every event
 * carries screen, world and tile, all three resolved together, **through the camera as it stood
 * when the tick opened** — see {@link TickFrame}.
 *
 * ## The objects are reused
 *
 * There is one event object per gesture kind and one per action, for the life of the system.
 * Copy what you keep; retaining one keeps a reference to next tick's gesture. A fresh event
 * object per pointer move, sixty times a second, is a garbage collector pause with a nice API.
 *
 * ## What is *not* here, structurally
 *
 * There is no `target`, no `hit`, no `entity`, no `id`. This package has no way to be told what
 * is in the world — no registry, no rect, no `pickable` flag, no callback that returns a hit —
 * so a naive implementation that caches hit boxes during the draw pass cannot be built on it:
 * there is nowhere to put them and nothing that would read one. `gx, gy` is geometry; "the
 * headquarters, not the rack behind it" is `iso`'s `pickSorted` over the caller's own state,
 * called from a handler with the coordinates below. In the source game the cached version made
 * every collect bubble untappable in a backgrounded tab, where the draw pass had stopped running
 * and the cached boxes were minutes old.
 */

import { worldToTile } from '@lattice/iso';
import type { Camera, GridPoint } from '@lattice/iso';
import type { GestureName, ZoomSource } from './recognise.js';
import type { PointerKind } from './profile.js';
import type { ActionBinding } from './actions.js';

/**
 * The camera, frozen at the instant a tick opened.
 *
 * Every event a tick delivers resolves against this, not against the live camera, and the
 * difference is not academic: a handler that recentres the camera on the tile it was given
 * would otherwise change where the *next* event in the same tick lands. Same bucket, same
 * frame of reference, whatever the handlers do — which is also what makes the tile a replay
 * resolves identical to the tile the session resolved.
 *
 * The affine half is five numbers copied at tick open. The **flooring** — the half that is
 * genuinely easy to get wrong — is `iso`'s `worldToTile` and is not reimplemented here, so
 * there is exactly one definition in the kit of which diamond a point falls in.
 */
export class TickFrame {
  private cx = 0;
  private cy = 0;
  private zoom = 1;
  private viewW = 0;
  private viewH = 0;

  /** Copy the camera's transform. Called once per tick, before any sample is recognised. */
  capture(camera: Camera): void {
    this.cx = camera.x;
    this.cy = camera.y;
    this.zoom = camera.zoom;
    this.viewW = camera.viewW;
    this.viewH = camera.viewH;
  }

  /** The frozen viewport width, for a source with no position of its own. */
  get w(): number {
    return this.viewW;
  }

  /** The frozen viewport height. See {@link w}. */
  get h(): number {
    return this.viewH;
  }

  /** screen → world x, through the frozen transform. The exact inverse of `camera.toScreenX`. */
  toWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.zoom + this.cx;
  }

  /** screen → world y. See {@link toWorldX}. */
  toWorldY(sy: number): number {
    return (sy - this.viewH / 2) / this.zoom + this.cy;
  }
}

/**
 * The fields every gesture carries.
 *
 * Off the map is still a number: `gx, gy` is where the pixel falls on the infinite lattice, and
 * `iso` decides what is in bounds. Returning `false` here instead would make the most common
 * call — "which tile did they tap" — a two-step for the sake of a case most games handle by
 * looking the tile up and finding nothing.
 */
export interface GestureBase {
  readonly type: GestureName;
  readonly pointerType: PointerKind;
  /** The simulation tick this was delivered in. The log's time axis. */
  readonly tick: number;
  /** CSS pixels, relative to the bound element's top-left — never `clientX`. */
  readonly sx: number;
  readonly sy: number;
  /** World space, through the camera as it stood when the tick opened. */
  readonly wx: number;
  readonly wy: number;
  /** Tile, floored. */
  readonly gx: number;
  readonly gy: number;
  /**
   * Take this gesture. Handlers not yet run, and the camera controller, will not see it.
   *
   * This is how a handler steers a placement ghost with a drag without the camera also panning.
   * Panning away from the site a player is aiming at is never what anyone means.
   */
  claim(): void;
  readonly claimed: boolean;
}

/**
 * A press that stayed put.
 *
 * `tap` and `longpress` are **mutually exclusive for one press**. In the source game the
 * missing version of that guarantee meant the `pointerup` ending a hold also counted as a tap,
 * which instantly re-dropped the building the player had just lifted.
 */
export interface TapGesture extends GestureBase {
  readonly type: 'tap' | 'longpress';
  /** How long the press lasted: whole ticks × `stepMs`. Feed a press-progress ring with it. */
  readonly heldMs: number;
}

/**
 * A press that travelled. One `dragstart`, zero or more `drag`, and **exactly one `dragend`** —
 * including when the system takes the gesture away, because a drag with no end is a camera that
 * pans for ever.
 */
export interface DragGesture extends GestureBase {
  readonly type: 'dragstart' | 'drag' | 'dragend';
  /** Screen-space movement since the previous event of this gesture, in CSS pixels. */
  readonly dx: number;
  readonly dy: number;
  /**
   * Screen-space velocity in CSS px/s, averaged over `flingSampleMs`.
   *
   * Averaged, not differenced: a finger that pauses before lifting has a last-two-points
   * velocity of nearly zero or of nearly anything, and both make flicks feel random. **Always
   * zero on a cancelled `dragend`** — an interrupted gesture must not fling.
   */
  readonly vx: number;
  readonly vy: number;
}

/**
 * "Scale the world by `scale` about this point."
 *
 * One gesture for wheel, trackpad pinch, two-finger pinch and the zoom keys, because the camera
 * does not care which it was and neither does a game. `sx, sy` is the anchor: the pointer, the
 * midpoint between two fingers, or the viewport centre for a source with no position. `dx, dy`
 * carries the midpoint's own travel, so a two-finger gesture pans and zooms at once the way a
 * map does.
 */
export interface ZoomGesture extends GestureBase {
  readonly type: 'zoom';
  readonly source: ZoomSource;
  /** Multiplicative, `> 1` zooms in. Never additive: additive zoom is unusable above 2×. */
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

/** The gesture name → event type mapping `InputScope.on` is typed against. */
export interface GestureMap {
  readonly tap: TapGesture;
  readonly longpress: TapGesture;
  readonly dragstart: DragGesture;
  readonly drag: DragGesture;
  readonly dragend: DragGesture;
  readonly zoom: ZoomGesture;
}

/**
 * An action fired.
 *
 * **The coordinates are always populated, which is the point.** A pointer-sourced action carries
 * where the finger was; a key-sourced one carries the game's `focus` — its current selection —
 * falling back to the viewport centre. Without that rule the keyboard path either does nothing
 * or does something different from the touch path, and the keyboard path is the one nobody
 * tests. It is also the seam a gamepad needs: a positionless source is already a solved case.
 */
export interface ActionEvent<A extends string> {
  readonly action: A;
  readonly source: 'pointer' | 'key';
  /** Which binding fired it. Present so a tutorial can say "you can also press Space". */
  readonly binding: ActionBinding;
  readonly tick: number;
  readonly sx: number;
  readonly sy: number;
  readonly wx: number;
  readonly wy: number;
  readonly gx: number;
  readonly gy: number;
  /** Take this action. Handlers not yet run will not see it. */
  claim(): void;
  readonly claimed: boolean;
}

/** The coordinate block, mutable, shared by every reused event object. */
interface Coords {
  tick: number;
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  gx: number;
  gy: number;
}

/** Scratch tile, reused by {@link fill}. One per module; nothing here is re-entrant. */
const scratch: GridPoint = { gx: 0, gy: 0 };

/**
 * Fill an event's coordinate block from a screen point and the frozen camera.
 *
 * The one function in the package that turns a pixel into a tile, so there is one place to look
 * when a tap resolves somewhere surprising and one place a fix has to go.
 */
export function fill(target: Coords, frame: TickFrame, tick: number, sx: number, sy: number): void {
  const wx = frame.toWorldX(sx);
  const wy = frame.toWorldY(sy);
  worldToTile(wx, wy, scratch);
  target.tick = tick;
  target.sx = sx;
  target.sy = sy;
  target.wx = wx;
  target.wy = wy;
  target.gx = scratch.gx;
  target.gy = scratch.gy;
}

/**
 * The reused tap/longpress event.
 *
 * A class rather than an object literal so that the shape is monomorphic from the first
 * allocation: V8 keeps one hidden class for it, and the per-move path never sees a shape check.
 */
export class TapGestureEvent implements TapGesture {
  type: 'tap' | 'longpress' = 'tap';
  pointerType: PointerKind = 'mouse';
  tick = 0;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  gx = 0;
  gy = 0;
  heldMs = 0;
  claimed = false;
  claim(): void {
    this.claimed = true;
  }
}

/** The reused dragstart/drag/dragend event. See {@link TapGestureEvent}. */
export class DragGestureEvent implements DragGesture {
  type: 'dragstart' | 'drag' | 'dragend' = 'dragstart';
  pointerType: PointerKind = 'mouse';
  tick = 0;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  gx = 0;
  gy = 0;
  dx = 0;
  dy = 0;
  vx = 0;
  vy = 0;
  claimed = false;
  claim(): void {
    this.claimed = true;
  }
}

/** The reused zoom event. See {@link TapGestureEvent}. */
export class ZoomGestureEvent implements ZoomGesture {
  readonly type = 'zoom';
  pointerType: PointerKind = 'mouse';
  tick = 0;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  gx = 0;
  gy = 0;
  dx = 0;
  dy = 0;
  scale = 1;
  source: ZoomSource = 'wheel';
  claimed = false;
  claim(): void {
    this.claimed = true;
  }
}

/**
 * The reused action event. See {@link TapGestureEvent}.
 *
 * Deliberately **not** generic in the action name. A system with no declared actions would
 * otherwise need an `A` to construct one from, and there is no value of type `never`; the
 * alternatives were an optional event object with an unreachable branch, or a fabricated name.
 * `action` is set to a declared name immediately before every delivery, so the narrowing a
 * caller's handler sees is real — {@link AnyActionHandler} is where that is written down.
 */
export class ActionEventImpl implements ActionEvent<string> {
  action = '';
  source: 'pointer' | 'key' = 'pointer';
  binding: ActionBinding = 'tap';
  tick = 0;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  gx = 0;
  gy = 0;
  claimed = false;
  claim(): void {
    this.claimed = true;
  }
}

/**
 * An action handler with its name parameter erased, as the registry stores it.
 *
 * `(a: ActionEvent<string>) => void` is assignable *to* `(a: ActionEvent<A>) => void` for every
 * `A extends string`, so the erasure is one legal assertion in one place rather than a cast at
 * every call site. It is sound because `ActionEventImpl.action` only ever holds a name the
 * caller declared: the registry looks the handler up **by** that name.
 */
export type AnyActionHandler = (a: ActionEvent<string>) => void;
