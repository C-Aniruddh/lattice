/**
 * Shared scaffolding. Not a test file — vitest collects `*.test.ts` only.
 *
 * Everything here is deliberately dumb: a camera with round numbers, a tick counter, and a
 * recorder that turns gestures into plain objects. A helper that were clever would be a second
 * implementation of the thing under test, and the bug would live in both.
 */

import { createCamera } from '@lattice/iso';
import type { Camera } from '@lattice/iso';
import { createHeadlessInput } from '../src/system.js';
import type { HeadlessInputOptions, InputSystem } from '../src/system.js';
import type { GestureName } from '../src/recognise.js';
import type { PointerKind } from '../src/profile.js';
import type { RawSample } from '../src/sample.js';

/** 60 Hz, to two more decimal places than anyone needs. */
export const STEP_60 = 1000 / 60;

/** An 800×600 viewport centred on the world origin, so screen (400, 300) is world (0, 0). */
export function camera(): Camera {
  return createCamera(800, 600);
}

/** One recorded delivery, flattened so a whole sequence can be compared with one `toEqual`. */
export interface Seen {
  type: GestureName;
  tick: number;
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  gx: number;
  gy: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  scale: number;
  heldMs: number;
}

const NAMES: readonly GestureName[] = [
  'tap',
  'longpress',
  'dragstart',
  'drag',
  'dragend',
  'zoom',
];

/** Subscribe to all six gestures and collect what arrives, in delivery order. */
export function watch<A extends string>(input: InputSystem<A>): Seen[] {
  const seen: Seen[] = [];
  for (const name of NAMES) {
    input.on(name, (g): void => {
      seen.push({
        type: g.type,
        tick: g.tick,
        sx: g.sx,
        sy: g.sy,
        wx: g.wx,
        wy: g.wy,
        gx: g.gx,
        gy: g.gy,
        dx: 'dx' in g ? g.dx : 0,
        dy: 'dy' in g ? g.dy : 0,
        vx: 'vx' in g ? g.vx : 0,
        vy: 'vy' in g ? g.vy : 0,
        scale: 'scale' in g ? g.scale : 1,
        heldMs: 'heldMs' in g ? g.heldMs : 0,
      });
    });
  }
  return seen;
}

/** Just the names, for the many assertions that only care about the sequence. */
export function types(seen: readonly Seen[]): GestureName[] {
  return seen.map((s) => s.type);
}

/** A system plus a tick counter, because `tick` refuses a repeated index by design. */
export interface Harness<A extends string> {
  readonly input: InputSystem<A>;
  /** The camera the system was built on, for the tests that read it back. */
  readonly view: Camera;
  /** Submit samples, then close one tick. Returns the tick index that was closed. */
  step(...samples: readonly RawSample[]): number;
  /** Close `n` ticks with nothing in them. */
  idle(n: number): void;
  readonly tick: number;
}

/** Build a headless system and a tick counter over it. */
export function harness<A extends string = never>(
  options?: Partial<HeadlessInputOptions<A>>,
): Harness<A> {
  const view = options?.camera ?? camera();
  const input = createHeadlessInput<A>({
    stepMs: STEP_60,
    ...options,
    camera: view,
  } as HeadlessInputOptions<A>);
  let next = 0;
  return {
    input,
    view,
    step(...samples: readonly RawSample[]): number {
      for (const sample of samples) input.submit(sample);
      const at = next;
      next += 1;
      input.tick(at);
      return at;
    },
    idle(n: number): void {
      for (let i = 0; i < n; i++) {
        input.tick(next);
        next += 1;
      }
    },
    get tick(): number {
      return next;
    },
  };
}

/** A `down` sample. Mouse by default, because the mouse's 4 px slop is the tightest. */
export function down(
  id: number,
  sx: number,
  sy: number,
  kind: PointerKind = 'mouse',
): RawSample {
  return { kind: 'down', id, sx, sy, pointerType: kind };
}

/** A `move` sample. */
export function move(id: number, sx: number, sy: number): RawSample {
  return { kind: 'move', id, sx, sy };
}

/** An `up` sample. */
export function up(id: number, sx: number, sy: number): RawSample {
  return { kind: 'up', id, sx, sy };
}
