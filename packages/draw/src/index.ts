/**
 * `@latticekit/draw` — one color and one grid footprint into a stylised isometric solid, on a
 * surface it does not own.
 *
 * The two halves of that sentence are the two things this package is for. *One color* is the
 * art direction: three-tone faces derived from a single hex, cool shadows, warm highlights, a
 * silhouette stroke on everything. *A surface it does not own* is the engineering: **nothing in
 * this package, and nothing above it, ever holds a `CanvasRenderingContext2D`** — so the same
 * code paints the world, a shop thumbnail and a golden test, and a WebGL backend can replace the
 * Canvas2D one without a sprite noticing.
 *
 * ```ts
 * const surface = createCanvas2dSurface(canvasEl);
 * const pen = beginFrame({ surface, camera, palette, t, clear: 'sky' });
 * isoTile(pen, 4, 7, 'ground');
 * isoBox(pen, 4, 7, 2, 2, { color: 'brand', h: 3 });
 * endFrame(pen);
 * ```
 *
 * ## What is deliberately not here
 *
 * **A sorted draw list, a depth key, a comparator or a `Rect`.** All four are `iso`'s. There is
 * one sorted list in the kit; `draw` walks `DepthSorter`'s permutation in the Solids pass and
 * contributes nothing to how it got ordered — and **must not reorder it**, because `pickSorted`
 * walks that same instance backwards and a partitioned repaint makes a player tap a rack and
 * open the headquarters behind it.
 *
 * **A sprite bitmap cache.** It was in the RFC as provisional, with deleting it named as a clean
 * outcome, and the benchmark decided: direct drawing of a thousand sprites costs a small
 * fraction of the 8 ms budget, so a cache would have bought zoom buckets, palette revisions,
 * pixel snapping and a don't-fill-while-moving rule — four new ways to render something stale —
 * in exchange for nothing. `docs/PERFORMANCE.md` has the number. The `massing`/`animate` split
 * survives it and was never only about caching: it is what makes a sprite's static art
 * declarative and its motion explicit.
 *
 * **Bezier paths, concave polygons, clipping, a general composite API, a transform stack,
 * filters, images the kit did not render, and perceptual color interpolation.** Each is either
 * something a WebGL backend could not honour in fifty lines without lying, or something that
 * would change every screenshot in the kit and improve none of them. `docs/rfc/draw.md` §4 has
 * the reason for each, which is what stops the next agent adding it back.
 *
 * **Hit-testing.** `iso` owns picking. This package contributes `spriteBounds` and
 * `spriteVolume` — the geometry a pick test needs — and stops there. In particular it never
 * records what it drew for picking to read back, because a frame the renderer skipped would then
 * leave the controls somewhere the building is not.
 *
 * **Lights that cast shadows or are occluded.** A lamp behind a hill still spills over it. Real
 * occlusion needs a shadow map per light and a depth buffer this renderer does not have, and it
 * would cost more than everything else in the package put together. This is the largest honest
 * limitation here.
 *
 * **A serialization format for color.** `draw` has no serialization and must never grow any:
 * the moment it can write a color to a save, someone writes a presentation-tier value into a
 * document that travels between engines. **Store the hue; derive the tokens on load.**
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';

// ── color ──────────────────────────────────────────────────────────────────────
//
// One color model, packed sRGB in a uint32, and `hexOf` / `cssOf` / `hueToHex` are renderings
// of it rather than alternatives to it. `core` has no color at all, deliberately, so that this
// stays true — a second implementation anywhere above this line is the bug, not the convenience.

export {
  FACE_LEFT,
  FACE_RIGHT,
  FACE_TOP,
  LIGHT_TINT,
  SHADE_TINT,
  cssOf,
  hex,
  hexOf,
  hsl,
  hueToHex,
  mix,
  outlineOf,
  rgba,
  shade,
  withAlpha,
} from './color.js';
export type { Ink, Rgba } from './color.js';

// ── palette ─────────────────────────────────────────────────────────────────────
//
// `rev` is the load-bearing field: it is what any cache, anywhere, keys on, and the reason a
// recoloured campus cannot render stale. `Palette.lerp` and `lerpPalette` share a quantisation
// so the world's blue and the HUD's blue are the same blue at every step of a dusk.

export {
  BASE_SLOTS,
  DAY,
  DUSK,
  NIGHT,
  PALETTE_STEPS,
  createPalette,
  extendStops,
  lerpPalette,
  paletteVars,
} from './palette.js';
export type { Palette, Stops, Vars } from './palette.js';

// ── the seam, and the frame ─────────────────────────────────────────────────────

export { beginFrame, endFrame, subPen } from './surface.js';
export type {
  Bitmap,
  BlitMode,
  FrameOpts,
  Pen,
  RenderTarget,
  Surface,
  SurfaceKind,
  TargetMode,
  TextStyle,
} from './surface.js';

// ── the two backends ────────────────────────────────────────────────────────────
//
// `canvas2d` is the only module in the package that names a canvas. `record` is `src/` rather
// than `test/` because a headless op stream is a product feature, not a test fixture: the Replay
// exhibit (`G11`) proves "same seed, same log, same pixel" by comparing op streams, which needs
// no canvas and no image diff. **It has no consumer today** — `ui`'s thumbnails use
// `createOffscreenSurface`, not this, and nothing in `ui` or `examples/` names
// `createRecordingSurface`. The comment this replaces claimed `ui` wanted it for layout
// measurement without a canvas; that reader did not exist, and a justification naming a present
// consumer nobody checked for is how an orphan survives two audits. Naming a *planned* one
// instead makes the next audit checkable: measure this module against `G11` shipping, and if
// `G11` is cut, revisit it the same day — it is 0.85 kB of a package that is over budget.

export { createCanvas2dSurface, createOffscreenSurface } from './canvas2d.js';
export type { Canvas2dOpts, OffscreenOpts, OffscreenSurface } from './canvas2d.js';

export { ESTIMATED_ADVANCE_RATIO, createRecordingSurface } from './record.js';
export type { Op, OpName, RecordingSurface, RecordingTarget } from './record.js';

// ── the solid kit ───────────────────────────────────────────────────────────────
//
// `LEVEL_H` lives here and not in `iso`: `iso`'s entire height vocabulary is world pixels, so
// there is no signature there a storey could enter through, and it is an art proportion tuned
// beside `FACE_LEFT` rather than a projection fact like `TILE_W`.

export {
  GHOST_LIFT,
  GROUND_LIFT,
  LEVEL_H,
  SELECT_LIFT,
  glowDot,
  isoBox,
  isoCylinder,
  isoPatch,
  isoPost,
  isoRoof,
  isoTile,
  isoWall,
  levelsToPx,
  pxToLevels,
} from './solids.js';
export type { BoxOpts } from './solids.js';

// The heightfield primitive. `iso` ships terrain with four corner heights per tile and the rest
// of the solid kit draws flat things at one `z`; `isoTerrain` is the whole of what sits between
// those two facts, and it is here rather than in a game because the relief term's *sign* is
// invisible when it is wrong.

export { isoTerrain } from './terrain.js';

export { contactShadow, wash } from './shadow.js';

export { DEFAULT_TEXT, MIN_WALL_TEXT_PX, screenText, wallText } from './text.js';

// ── sprites: how a game composes primitives into a building it owns ─────────────

export {
  FLAG_BUILDING,
  FLAG_GHOST,
  FLAG_POWERED,
  FLAG_SELECTED,
  VARIANT_ZERO,
  defineSprite,
  drawFootprint,
  drawGhost,
  drawSprite,
  spriteBounds,
  spriteHeightPx,
  spriteVolume,
} from './sprite.js';
export type { Animator, Emitter, Massing, SolidWriter, SpriteDef, Variant } from './sprite.js';

// ── night ───────────────────────────────────────────────────────────────────────

export { createLightField } from './light.js';
export type { LightField, LightFieldOpts } from './light.js';

// ── the seven passes, and not the sort ──────────────────────────────────────────

export { Layer, PASS_NAMES, renderFrame } from './layers.js';
export type { Passes } from './layers.js';
