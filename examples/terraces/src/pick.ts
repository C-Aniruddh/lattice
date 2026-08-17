/**
 * The two answers to "which tile is under the pointer", and the distance between them.
 *
 * This is the exhibit, in thirty lines. Everything else on screen exists so that these two
 * numbers have somewhere to be wrong.
 *
 * ## Why there are two answers at all
 *
 * In a 2:1 projection, screen → grid is a linear inverse **only on the plane `z = 0`**. Raise a
 * point by `HALF_H` world pixels and it lands on exactly the same screen pixel as the point one
 * unit of `gx + gy` further from the viewer at sea level. So a screen pixel does not name a tile;
 * it names a whole *family* of candidates, one per elevation, and picking the right one needs the
 * terrain.
 *
 * | | call | what it assumes |
 * |---|---|---|
 * | naive | `screenToTile(camera, sx, sy, out)` | the ground is flat and at zero |
 * | terrain-aware | `screenToTileOnHeights(camera, sx, sy, field, maxHeightPx, out)` | nothing |
 *
 * The naive one is not a straw man and that is worth being explicit about: it is the exact
 * inverse of the projection at `z = 0`, and it is what `@lattice/input` puts in `gx`/`gy` on
 * **every action event it fires**, because `input` resolves a pointer through `worldToTile` and
 * has no way to be handed a heightfield. An exhibit that read `event.gx` would therefore ship
 * this bug without ever choosing to, which is why the caller re-picks from `sx`/`sy`. See the
 * README's first kit finding.
 *
 * ## The error is measured in drawn pixels, on purpose
 *
 * {@link Pick.tilesApart} is the honest count and it is the number that grows uphill. But a tile
 * count is not what a player experiences and it is not what the bug reports say: Lamp Road's was
 * *"212–237 px"*, because what you see is a marker in the wrong place on a screen. So
 * {@link Pick.errorPx} projects both answers **at their own ground heights** and measures the gap
 * between them, which is that same quantity, and it is comparable across zoom.
 */
import { gridToWorldX, gridToWorldY, heightAt, screenToTile, screenToTileOnHeights, type Camera, type HeightField, type Tile } from '@lattice/iso';

/**
 * Everything the frame, the markers and the overlay read. One object, mutated in place: it is
 * recomputed on every render, and a fresh literal per frame is a garbage collector pause with a
 * nice API.
 *
 * `sx`/`sy` are the pointer in CSS pixels — the bootstrap pins the canvas to the viewport, so a
 * `PointerEvent`'s `clientX`/`clientY` are already in that space. `truth` is meaningful only
 * while `onMap`; `naive` always is, and is frequently wrong. `groundPx` is the elevation under
 * `truth`, which is the cause of the whole error.
 */
export interface Pick {
  sx: number; sy: number;
  readonly truth: Tile; readonly naive: Tile;
  onMap: boolean; tilesApart: number; errorPx: number; groundPx: number;
}

export function createPick(): Pick {
  return { sx: 0, sy: 0, truth: { gx: 0, gy: 0 }, naive: { gx: 0, gy: 0 }, onMap: false, tilesApart: 0, errorPx: 0, groundPx: 0 };
}

/** Where a tile's center is drawn, on its own ground — the endpoint the error runs between. Two
 *  scalars rather than a `Vec2`, because screen x depends on world x alone and `repick` needs
 *  four of them. */
function drawnX(camera: Camera, t: Tile): number {
  return camera.toScreenX(gridToWorldX(t.gx + 0.5, t.gy + 0.5));
}

function drawnY(camera: Camera, field: HeightField, t: Tile): number {
  return camera.toScreenY(gridToWorldY(t.gx + 0.5, t.gy + 0.5) - heightAt(field, t.gx + 0.5, t.gy + 0.5));
}

/**
 * Re-answer both questions from the pointer position now held in `p`.
 *
 * Called once per render rather than once per pointer event, so the answer moves when the
 * *camera* moves too — a hover highlight that only updates on `pointermove` sticks to a tile and
 * slides off it during a drag, which reads as the pick being broken in a second, unrelated way.
 *
 * @param ceiling Where the terrain march starts, `Hill.maxHeightPx` in normal use. A parameter
 *   and not a constant because the panel makes it a slider: `screenToTileOnHeights` documents
 *   that too small a ceiling *begins the march below a peak and misses it*, that failure is
 *   invisible in any screenshot, and so the exhibit ships the knob that reproduces it.
 */
export function repick(p: Pick, camera: Camera, field: HeightField, ceiling: number): void {
  screenToTile(camera, p.sx, p.sy, p.naive);
  p.onMap = screenToTileOnHeights(camera, p.sx, p.sy, field, ceiling, p.truth);
  p.groundPx = heightAt(field, p.truth.gx + 0.5, p.truth.gy + 0.5);
  p.tilesApart = Math.abs(p.naive.gx - p.truth.gx) + Math.abs(p.naive.gy - p.truth.gy);
  const dx = drawnX(camera, p.naive) - drawnX(camera, p.truth);
  const dy = drawnY(camera, field, p.naive) - drawnY(camera, field, p.truth);
  p.errorPx = Math.sqrt(dx * dx + dy * dy);
}

/** The stakes a visitor has planted, oldest first, and bounded: `docs/GALLERY.md` forbids an
 *  exhibit state that outlives the tab, and an unbounded list would eventually be the only thing
 *  on the hill. */
export const stakes: Tile[] = [];

/** Plant one where the *chosen* pick says, which is the entire demonstration: with terrain-aware
 *  picking off, the stake lands on the tile the screen ray crosses at **sea level**, which has a
 *  smaller `gx + gy` and is therefore further from the viewer — several terraces up the hill from
 *  the finger that asked for it, and by more the higher that finger was. */
export function plant(p: Pick, aware: boolean): void {
  if (aware && !p.onMap) return;
  const at = aware ? p.truth : p.naive;
  stakes.push({ gx: at.gx, gy: at.gy });
  if (stakes.length > 24) stakes.shift();
}
