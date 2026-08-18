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
 * ## …and the tile one depends on the ground
 *
 * `gx`/`gy` are only the tile under the finger if something told this package what the ground
 * looks like. Screen → grid inverts the projection **on the plane `z = 0`** and nowhere else, so
 * on a hillside the undeclared answer is the tile the ray crosses at sea level — real, adjacent,
 * plausible, and several terraces from where the player pointed. `terrain.ts` is the seam that
 * fixes it and the diagnostic that reports a system nobody ever told.
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
 * is in the world — no registry, no rect, no `pickable` flag, no callback that returns a hit;
 * the one thing it can be told is the shape of the *ground*, which carries none of those — so a
 * naive implementation that caches hit boxes during the draw pass cannot be built on it:
 * there is nowhere to put them and nothing that would read one. `gx, gy` is geometry; "the
 * headquarters, not the rack behind it" is `iso`'s `pickSorted` over the caller's own state,
 * called from a handler with the coordinates below. In the source game the cached version made
 * every collect bubble untappable in a backgrounded tab, where the draw pass had stopped running
 * and the cached boxes were minutes old.
 */

import type { Camera, GridPoint } from '@latticekit/iso';
import type { GestureName, ZoomSource } from './recognize.js';
import type { PointerKind } from './profile.js';
import type { ActionBinding } from './actions.js';
import type { TilePicker } from './terrain.js';

/**
 * The camera, frozen at the instant a tick opened.
 *
 * Every event a tick delivers resolves against this, not against the live camera, and the
 * difference is not academic: a handler that recenters the camera on the tile it was given
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

  /** Copy the camera's transform. Called once per tick, before any sample is recognized. */
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
 * On flat ground, off the map is still a number: `gx, gy` is where the pixel falls on the
 * infinite lattice, and `iso` decides what is in bounds. Returning `false` here instead would
 * make the most common call — "which tile did they tap" — a two-step for the sake of a case most
 * games handle by looking the tile up and finding nothing.
 *
 * On terrain there is no infinite lattice to fall on: a pixel above the horizon corresponds to
 * no ground at all, and the only honest answers are {@link GestureBase.onGround} and `NaN`. That
 * is a difference between the two grounds and not an inconsistency — the flat plane genuinely
 * extends for ever, and a heightfield genuinely stops.
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
  /**
   * Tile, floored — **on the ground the system was told about**.
   *
   * With `terrain: { field, maxHeightPx }` this is the tile whose terrain surface is under the
   * pixel, marched by `iso`. With `terrain: 'flat'`, or with nothing declared, it is the tile on
   * the plane `z = 0` — which is the same answer on level ground and is the wrong one, by
   * several tiles, anywhere the ground rises. See `terrain.ts` for what that costs and why the
   * undeclared case says so once.
   *
   * `NaN` when {@link onGround} is `false`, and only ever then. A tile index that is not a
   * number cannot be mistaken for the tile the player asked for; the sea-level answer can.
   */
  readonly gx: number;
  readonly gy: number;
  /**
   * Did the pointer land on ground that exists?
   *
   * Always `true` on flat ground: off the map is still a number there, because `worldToTile`
   * answers for the infinite lattice and `iso` decides what is in bounds. With a heightfield it
   * is `false` for a pixel above the horizon or beyond the field's edge — a tap on the sky —
   * and `gx`/`gy` are `NaN`. **Check it before using a coordinate on any map with terrain.**
   */
  readonly onGround: boolean;
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
 * A press that traveled. One `dragstart`, zero or more `drag`, and **exactly one `dragend`** —
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
   * zero on a canceled `dragend`** — an interrupted gesture must not fling.
   */
  readonly vx: number;
  readonly vy: number;
}

/**
 * "Scale the world by `scale` about this point."
 *
 * One gesture for wheel, trackpad pinch, two-finger pinch and the zoom keys, because the camera
 * does not care which it was and neither does a game. `sx, sy` is the anchor: the pointer, the
 * midpoint between two fingers, or the viewport center for a source with no position. `dx, dy`
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
 * falling back to the viewport center. Without that rule the keyboard path either does nothing
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
  /** The tile, on the ground the system was told about. See {@link GestureBase.gx}. */
  readonly gx: number;
  readonly gy: number;
  /** Did the pointer land on ground that exists? See {@link GestureBase.onGround}. */
  readonly onGround: boolean;
  /** Take this action. Handlers not yet run will not see it. */
  claim(): void;
  readonly claimed: boolean;
}

/** Scratch tile, reused by {@link CoordEvent}. One per module; nothing here is re-entrant. */
const scratch: GridPoint = { gx: 0, gy: 0 };

/** Nobody has asked for the tile yet. */
const UNRESOLVED = 0;
/** The pick landed on ground. */
const ON_GROUND = 1;
/** The pick found no ground: the ray left the field, or there is no map there. */
const OFF_GROUND = 2;

/**
 * The coordinate block every event shares, and the one place in the package where a pixel
 * becomes a tile.
 *
 * ## The tile is resolved on read, not on delivery
 *
 * `sx`/`sy`/`wx`/`wy` are three multiplies and cost nothing, so they are filled eagerly. The
 * tile is not: on terrain it is a march down the heightfield — twenty-four bilinear samples and
 * about 75 ns on a 192 px hill, four hundred and under 0.05 ms on the 1,470 px one
 * `examples/terraces` builds — and a game that binds input only to pan and zoom would otherwise
 * pay for it on every pointer move it never asks a question about. Resolving on first read makes the
 * cost exactly proportional to the number of coordinates a game actually uses, and it is also
 * the hook that lets an undeclared `terrain` say so *when it matters* rather than at startup.
 *
 * It resolves against `wx`/`wy`, which were frozen from the camera as the tick opened, so
 * laziness cannot leak the live camera into an answer: a handler that recenters the view still
 * cannot move where a later event in the same bucket landed.
 */
export abstract class CoordEvent {
  tick = 0;
  sx = 0;
  sy = 0;
  wx = 0;
  wy = 0;
  claimed = false;

  /**
   * Declared here and *installed in the constructor*, as own enumerable accessors rather than
   * prototype getters.
   *
   * `{ ...event }` is the copy this package's docs ask a caller to make, and spread reads own
   * enumerable properties only — a prototype getter is invisible to it. A tile that silently
   * vanishes when an event is copied would be a worse trap than the one this seam closes.
   */
  declare readonly gx: number;
  /** See {@link CoordEvent.gx}. */
  declare readonly gy: number;
  /** See {@link CoordEvent.gx}. */
  declare readonly onGround: boolean;

  #picker: TilePicker;
  #tileX = 0;
  #tileY = 0;
  #state = UNRESOLVED;

  constructor(picker: TilePicker) {
    this.#picker = picker;
    Object.defineProperty(this, 'gx', {
      enumerable: true,
      get: (): number => {
        this.#resolve();
        return this.#tileX;
      },
    });
    Object.defineProperty(this, 'gy', {
      enumerable: true,
      get: (): number => {
        this.#resolve();
        return this.#tileY;
      },
    });
    Object.defineProperty(this, 'onGround', {
      enumerable: true,
      get: (): boolean => {
        this.#resolve();
        return this.#state === ON_GROUND;
      },
    });
  }

  /**
   * Aim this event at a screen point, through the camera as it stood when the tick opened.
   *
   * Everything derived from the pointer is set here or invalidated here; there is one place to
   * look when an event resolves somewhere surprising, and one place a fix has to go.
   */
  place(frame: TickFrame, tick: number, sx: number, sy: number): void {
    this.tick = tick;
    this.sx = sx;
    this.sy = sy;
    this.wx = frame.toWorldX(sx);
    this.wy = frame.toWorldY(sy);
    this.#state = UNRESOLVED;
  }

  /** Take this gesture or action. Handlers not yet run will not see it. */
  claim(): void {
    this.claimed = true;
  }

  /** `NaN` rather than the sea-level answer when there is no ground: a tile index that is not a
   *  number cannot be mistaken for the tile the player asked for, and the whole finding behind
   *  this seam is a wrong tile that was plausible. */
  #resolve(): void {
    if (this.#state !== UNRESOLVED) return;
    if (this.#picker.resolve(this.wx, this.wy, scratch)) {
      this.#tileX = scratch.gx;
      this.#tileY = scratch.gy;
      this.#state = ON_GROUND;
      return;
    }
    this.#tileX = Number.NaN;
    this.#tileY = Number.NaN;
    this.#state = OFF_GROUND;
  }
}

/**
 * The reused tap/longpress event.
 *
 * A class rather than an object literal so that the shape is monomorphic from the first
 * allocation: V8 keeps one hidden class for it, and the per-move path never sees a shape check.
 */
export class TapGestureEvent extends CoordEvent implements TapGesture {
  type: 'tap' | 'longpress' = 'tap';
  pointerType: PointerKind = 'mouse';
  heldMs = 0;
}

/** The reused dragstart/drag/dragend event. See {@link TapGestureEvent}. */
export class DragGestureEvent extends CoordEvent implements DragGesture {
  type: 'dragstart' | 'drag' | 'dragend' = 'dragstart';
  pointerType: PointerKind = 'mouse';
  dx = 0;
  dy = 0;
  vx = 0;
  vy = 0;
}

/** The reused zoom event. See {@link TapGestureEvent}. */
export class ZoomGestureEvent extends CoordEvent implements ZoomGesture {
  readonly type = 'zoom';
  pointerType: PointerKind = 'mouse';
  dx = 0;
  dy = 0;
  scale = 1;
  source: ZoomSource = 'wheel';
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
export class ActionEventImpl extends CoordEvent implements ActionEvent<string> {
  action = '';
  source: 'pointer' | 'key' = 'pointer';
  binding: ActionBinding = 'tap';
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
