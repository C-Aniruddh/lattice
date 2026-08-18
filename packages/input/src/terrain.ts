/**
 * What the ground looks like — the one thing this package must be told before it can answer
 * "which tile" on anything but a plane.
 *
 * ## The bug this module exists to end
 *
 * screen → grid is a linear inverse **only on the plane `z = 0`**. Raise a point by `HALF_H`
 * world pixels and it lands on exactly the same screen pixel as the point one unit of `gx + gy`
 * further from the viewer at sea level, so a pixel does not name a tile: it names a family of
 * candidates, one per elevation. `worldToTile` picks the sea-level member of that family, which
 * is the right answer on flat ground and is *plausible* everywhere else — on a hillside it is the
 * tile the ray crosses several terraces up the slope from the finger that asked for it.
 * `examples/terraces` measures that at **281 px and 14–16 tiles**; `examples/demo` shipped a
 * 212–237 px version of it; and in `examples/clay`, where the visitor raises the ground under
 * their own cursor, the error is not even constant — the brush walks off the far side of a hill
 * while the hand holds still.
 *
 * Nothing downstream can catch it. The tile is a real tile, it is next to the right one, and it
 * moves with the pointer. So the fix is a seam, not a check.
 *
 * ## Three states, and only one of them is quiet by accident
 *
 * | `terrain:` | what `gx`/`gy` mean | when it is wrong |
 * |---|---|---|
 * | `{ field, maxHeightPx }` | the tile whose **terrain surface** is under the pixel | never — it is the marched answer |
 * | `'flat'` | the tile on the plane `z = 0` | if the game grew a hill and nobody came back here |
 * | omitted | the plane `z = 0`, **and a diagnostic the first time a coordinate is read** | the same, and now it says so |
 *
 * The third row is the whole point. This package cannot see a game's terrain — it has no
 * registry, no map and no way to acquire one — so it cannot detect the mistake. What it *can*
 * detect is that nobody ever said, and saying so costs one word. A game with genuinely level
 * ground writes `terrain: 'flat'` once and is silent for ever; a game with a hill that never
 * declared one gets told, in the console, the first time it asks where a tap landed.
 *
 * ## Where the maths lives
 *
 * `iso` does it. `docs/SEAMS.md` settles that `iso` owns tap → grid cell and `input` owns the
 * gesture and calls it, and this module is the call: {@link TilePicker.resolve} is a branch and
 * a delegation to `worldToTileOnHeights`, and there is no geometry in this package to get wrong.
 */

import { worldToTile, worldToTileOnHeights } from '@latticekit/iso';
import type { HeightField, Tile } from '@latticekit/iso';
import type { DiagnosticSink } from './sample.js';

/**
 * The elevation a pointer is resolved against, and how far up the search for it starts.
 *
 * Two fields because `iso`'s march needs both and a `HeightField` carries only one of them: a
 * ceiling that is too low begins the march below a peak and misses it, and one that is too high
 * scans ground that is not there on every event. Every game that has terrain already knows this
 * number — it is the tallest terrain on the map, in world pixels — and every caller that has
 * written the picking call by hand has been carrying it beside the field already.
 */
export interface Terrain {
  /** The heightfield the pointer is resolved against. The same object the game draws from: this
   *  package holds it, never copies it, so ground the player raises this frame is ground the
   *  next event resolves on. */
  readonly field: HeightField;
  /**
   * The tallest terrain on the map, in **world pixels** — `maxUnits × field.stepPx`.
   *
   * A ceiling of `0` is legal and means every pick is exactly the flat-ground answer, which is
   * what `examples/terraces` shows by dragging its slider to the bottom. It is not what a game
   * with a hill wants, and it is not the same statement as `terrain: 'flat'`.
   */
  readonly maxHeightPx: number;
}

/**
 * What a game says about its ground: a heightfield, or the word `'flat'`.
 *
 * `'flat'` is a *declaration*, not a default. It resolves exactly as omitting the option does
 * and differs from it in one way that matters: it silences the `flat-ground-pick` diagnostic,
 * because a caller who wrote it has answered the question rather than never having been asked.
 */
export type TerrainOption = Terrain | 'flat';

/**
 * Validate a `terrain` option at the moment the caller supplies it, naming the field they got
 * wrong rather than failing later inside a march.
 *
 * @throws TypeError if it is neither `'flat'` nor a `{ field, maxHeightPx }` pair whose field is
 *   a readable heightfield.
 * @throws RangeError if `maxHeightPx` is negative or not finite, or if `stepPx` is not finite —
 *   both of those poison every coordinate the system will ever report, and a `NaN` tile is a
 *   selection that silently matches nothing.
 */
export function checkTerrain(terrain: TerrainOption, label: string): void {
  if (terrain === 'flat') return;
  if (terrain === null || typeof terrain !== 'object') {
    throw new TypeError(
      `${label}: expected { field, maxHeightPx } or the string 'flat', got ${String(terrain)} — this package resolves every pointer on the plane z = 0 unless it is told what the ground looks like`,
    );
  }
  const field: HeightField | undefined = terrain.field;
  if (
    field === null ||
    typeof field !== 'object' ||
    typeof field.heights !== 'object' ||
    typeof field.heights.get !== 'function' ||
    typeof field.heights.has !== 'function'
  ) {
    throw new TypeError(
      `${label}.field: expected an @latticekit/iso HeightField — { heights: TileSource, stepPx: number } — got ${String(field)}`,
    );
  }
  if (!Number.isFinite(field.stepPx)) {
    throw new RangeError(
      `${label}.field.stepPx: expected a finite number of world pixels per height unit, got ${String(field.stepPx)}`,
    );
  }
  if (!(Number.isFinite(terrain.maxHeightPx) && terrain.maxHeightPx >= 0)) {
    throw new RangeError(
      `${label}.maxHeightPx: expected a finite number >= 0 — the tallest terrain on the map in world pixels, which is where the march starts — got ${String(terrain.maxHeightPx)}`,
    );
  }
}

/**
 * The one object in this package that turns a world point into a tile.
 *
 * One per system, shared by every reused event object and by {@link InputSystem.hoverTile}, so
 * that a system cannot answer a tap and a hover on two different surfaces. It holds the
 * declaration rather than a copy of it, which is what makes {@link InputSystem.terrain} a live
 * read and what lets `setTerrain` move a march ceiling under a slider without rebuilding
 * anything.
 */
export class TilePicker {
  /** The declaration as the caller wrote it, `undefined` if they never made one. Read back
   *  through `InputSystem.terrain`; see non-negotiable 11. */
  private option: TerrainOption | undefined;
  /** The heightfield in force, or `undefined` on flat ground. Split from {@link option} so the
   *  hot path is one `undefined` check rather than a string comparison. */
  private terrain: Terrain | undefined;
  /** Whether the `flat-ground-pick` diagnostic has been raised. The sink deduplicates by code
   *  anyway; this is here so the common path is a boolean test and never a `Set` lookup. */
  private told = false;

  constructor(private readonly diagnose: DiagnosticSink) {}

  /** The declaration, exactly as it was supplied. `undefined` means nobody has made one. */
  get declared(): TerrainOption | undefined {
    return this.option;
  }

  /** Replace the declaration. Validated by the caller — `system.ts` names the method the game
   *  called, so an error from `setTerrain` never says `createInput`. */
  set(next: TerrainOption): void {
    this.option = next;
    this.terrain = next === 'flat' ? undefined : next;
  }

  /**
   * World point → tile, on the terrain if there is one.
   *
   * @returns `false` when a declared heightfield says there is no ground here: the ray left the
   *   field before it met the surface, or landed where `heights.has` reports no map. On flat
   *   ground it is always `true` — off the map is still a number there, because `worldToTile`
   *   answers for the infinite lattice and `iso` decides what is in bounds.
   *
   *   **Never treat `true` as proof that the tile exists in your map.** A `TileSource` built by
   *   `tileSourceOf` answers `has` with `true` everywhere, which is correct for an unbounded
   *   procedural world and means a bounded game must still check its own bounds (kit gap K59).
   */
  resolve(wx: number, wy: number, out: Tile): boolean {
    const terrain = this.terrain;
    if (terrain === undefined) {
      if (this.option === undefined && !this.told) this.warn();
      worldToTile(wx, wy, out);
      return true;
    }
    return worldToTileOnHeights(terrain.field, wx, wy, terrain.maxHeightPx, out);
  }

  /**
   * Say once that this system is answering on a plane nobody confirmed is there.
   *
   * Raised on the first coordinate actually *read*, not at construction: a game that binds input
   * only to pan and zoom never asks which tile, and a diagnostic it cannot act on is one it
   * learns to skip past — which is how the next one gets skipped too.
   */
  private warn(): void {
    this.told = true;
    this.diagnose({
      code: 'flat-ground-pick',
      message:
        "gx/gy on this system resolve on the plane z = 0, because nothing told it what the ground looks like. On a map with elevation that is the tile the screen ray crosses at sea level — several tiles uphill of the finger, and plausible enough that nothing downstream will report it; a shipped exhibit measures 281 px and 14 tiles on its own hillside. Pass terrain: { field, maxHeightPx } to resolve on the terrain, or terrain: 'flat' to state that the ground really is level and silence this.",
    });
  }
}
