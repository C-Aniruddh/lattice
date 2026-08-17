/**
 * One scene, built the same way in every suite.
 *
 * Every test in this package needs a surface, a camera, a palette and a pen, and building them
 * inline four times per file is how two suites end up quietly testing two different cameras. The
 * recording backend is the default here for the reason it exists: a golden is a readable op log
 * and there is no canvas anywhere in Node.
 */

import { createCamera } from '@latticekit/iso';
import type { Camera } from '@latticekit/iso';
import { BASE_SLOTS, createPalette } from '../src/palette.js';
import type { Palette } from '../src/palette.js';
import { createRecordingSurface } from '../src/record.js';
import type { Op, RecordingSurface } from '../src/record.js';
import { beginFrame } from '../src/surface.js';
import type { Pen } from '../src/surface.js';

/** What every suite asks for. */
export interface Scene {
  /** The recording backend, so a failure reads as a list of draw calls. */
  readonly surface: RecordingSurface;
  /** Centered on the origin unless a test moves it. */
  readonly camera: Camera;
  /** `BASE_SLOTS`, live. */
  readonly palette: Palette;
  /** Ready to draw into, cleared, `t = 0`. */
  readonly pen: Pen;
}

/** How a scene may differ from the default. */
export interface SceneOpts {
  /** CSS pixels. */
  readonly width?: number;
  /** CSS pixels. */
  readonly height?: number;
  /** Device pixels per CSS pixel. */
  readonly pixelRatio?: number;
  /** Camera zoom. */
  readonly zoom?: number;
  /** Seconds since the session began. */
  readonly t?: number;
  /** Whole-device-pixel snapping. Default **false** here, unlike the kit: a test asserting
   *  geometry wants the unsnapped numbers, and the two tests that care about the snap turn it
   *  on explicitly. */
  readonly snap?: boolean;
}

/** Build a scene. See {@link SceneOpts} for what a test may vary. */
export function scene(opts?: SceneOpts): Scene {
  const surface = createRecordingSurface(
    opts?.width ?? 400,
    opts?.height ?? 300,
    opts?.pixelRatio ?? 1,
  );
  const camera = createCamera(opts?.width ?? 400, opts?.height ?? 300, {
    zoom: opts?.zoom ?? 1,
    bounds: { minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 },
  });
  camera.centerOn(0, 0);
  const palette = createPalette(BASE_SLOTS);
  const pen = beginFrame({
    surface,
    camera,
    palette,
    t: opts?.t ?? 0,
    snap: opts?.snap ?? false,
  });
  surface.reset();
  return { surface, camera, palette, pen };
}

/** Every op of one kind, in order. The shape almost every assertion in this package wants. */
export function opsOf(surface: RecordingSurface, kind: Op['op']): readonly Op[] {
  return surface.ops.filter((op) => op.op === kind);
}

/** The first op of a kind, or a failure that names what was recorded instead — which is the
 *  message a reader actually needs when a primitive stopped emitting what it used to. */
export function firstOp(surface: RecordingSurface, kind: Op['op']): Op {
  const found = surface.ops.find((op) => op.op === kind);
  if (found === undefined) {
    throw new Error(
      `expected a '${kind}' op, recorded: ${surface.ops.map((op) => op.op).join(', ') || '(nothing)'}`,
    );
  }
  return found;
}
