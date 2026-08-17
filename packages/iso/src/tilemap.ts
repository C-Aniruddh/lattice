/**
 * Storage: two strategies behind one two-method interface.
 *
 * | you have | use | costs |
 * |---|---|---|
 * | a bounded world | {@link TileGrid} | one flat typed array, `w × h` cells |
 * | an unbounded world | {@link tileSourceOf} | nothing at all |
 *
 * **`tileSourceOf` is the unbounded one, and it is read-only.** A function is defined at every
 * coordinate, so a world with no edge needs no storage and no size: pathfinding, culling and
 * placement take {@link TileSource} and cannot tell a generated world from an island. Note what
 * that leaves out — the *writable* unbounded map, a sparse table of chunks allocated on first
 * write. A class for it lived in this file and was deleted; `docs/rfc/chunkgrid.md` keeps the
 * reasoning, the full surface, and the two implementation facts that are expensive to
 * re-derive.
 *
 * **What brings it back is a second *writer*, not a bigger map.** The trigger, in its checkable
 * form: the first time an exhibit or a game has to reallocate a {@link TileGrid} because the
 * player built past its edge — a world extended by playing, rather than a large world framed to
 * fill a viewport. Two things sound like that trigger and are not, and mistaking either for it
 * is how the class comes back without having earned it:
 *
 * | it sounds like | it is actually |
 * |---|---|
 * | "this exhibit wants a bigger map" | `new TileGrid(512, 512)` — 256 kB at 8 bits |
 * | "this exhibit wants terrain that goes on forever" | {@link tileSourceOf}, which costs nothing |
 *
 * **One array per *layer*, not one struct per tile.** A game needing terrain, buildings and
 * movement cost makes three grids. Structure-of-arrays is why a pathfinder can scan a cost
 * layer without dragging terrain colors through the cache, and why `@latticekit/persist` can
 * take a whole map as one buffer.
 *
 * **Reads are forgiving, writes are not.** `get` outside the map returns the map's
 * out-of-bounds value and never throws, because a pathfinder scanning a border tile must not
 * throw mid-frame; `set` outside the map throws, because a write outside the map is always a
 * bug and silently dropping it produces a save that is missing exactly the tile the player
 * just changed.
 *
 * **Coordinates are whole numbers.** A tile address with a fraction in it is a world pixel
 * that forgot to be converted: `has` is false for it, `get` returns the out-of-bounds value,
 * and `set` throws. No function here floors on the caller's behalf — that would turn the
 * mistake into a plausible answer.
 */

import type { TileRange } from './projection.js';

/**
 * Anything that can answer "what is on this tile" with a number.
 *
 * Pathfinding, culling and placement take this and nothing more, so a purely procedural
 * infinite world implements it with a closure and pays for no storage at all — and so a game
 * can swap a streamed map for a generated one without touching a line of the code that reads
 * it.
 */
export interface TileSource {
  /** Value at `(gx, gy)`. Out of bounds returns the source's out-of-bounds value; never
   *  throws, because this is read inside pathfinding loops that scan past the edge by design. */
  get(gx: number, gy: number): number;
  /** Is this tile inside the map's defined region? Always true for an infinite source, which
   *  has no outside. Distinguishing "empty" from "absent" is what lets terrain-aware picking
   *  report that the ray left the map instead of returning a plausible tile. */
  has(gx: number, gy: number): boolean;
}

/** A {@link TileSource} that can be written to, and that says when it changed. */
export interface MutableTileSource extends TileSource {
  /** @throws RangeError out of bounds, naming the coordinate and the map's extent. */
  set(gx: number, gy: number, value: number): void;
  /** Every tile to one value. */
  fill(value: number): void;
  /** Fill from a function — a seeded heightfield through `core.hash2`, a river mask, a noise
   *  field. It saves every game the same nested loop, and it is the seam where determinism
   *  enters a map: the function sees only coordinates, so the result cannot depend on the
   *  order tiles were visited. */
  fillFrom(get: (gx: number, gy: number) => number): void;
  /**
   * Bumped on every mutation that changes a value.
   *
   * This is the whole of the cheap-recompute answer. A caller holding a path, a flow field or
   * a cached arc length compares against the version it was built from; when the rockfall is
   * cleared one `set` bumps this, everything downstream recomputes exactly once, and nothing
   * has to be told *what* changed. Comparing map contents to detect a change costs more than
   * replanning.
   */
  readonly version: number;
}

/**
 * The shape of an island, fixed at construction.
 *
 * `bits` and `outOfBounds` are the two worth thinking about: a value wider than the store
 * wraps silently, because that is what a typed array does, and the out-of-bounds value is what
 * every pathfinder and culler sees when it scans past the shore — set it to whatever your cost
 * function reads as impassable and the search stops at the water for free.
 */
export interface TileGridOptions {
  /** Grid origin in tiles. Default `0, 0`. Lets an island sit at negative coordinates without
   *  every consumer subtracting an offset it might get the sign of wrong. */
  readonly originGx?: number;
  /** See {@link TileGridOptions.originGx}. */
  readonly originGy?: number;
  /** Storage width per tile. Default `8`. Pick the smallest that holds your value set: values
   *  wider than the store wrap silently, because that is what a typed array does. */
  readonly bits?: 8 | 16 | 32;
  /** Initial value everywhere. Default `0`. */
  readonly fill?: number;
  /** What {@link TileSource.get} returns outside the grid. Default `0`. Set it to whatever
   *  your cost function reads as impassable and the pathfinder stops at the shore for free. */
  readonly outOfBounds?: number;
}

/** Allocate the backing store for a bit width. Separate from the constructor so an unsupported
 *  width is refused in one place rather than producing a store of the wrong size — and refused
 *  at construction, not on the first write, which could be minutes into a session and in a
 *  completely different part of the game from the mistake. */
function makeStore(bits: 8 | 16 | 32, length: number): Uint8Array | Uint16Array | Uint32Array {
  if (bits === 8) return new Uint8Array(length);
  if (bits === 16) return new Uint16Array(length);
  if (bits === 32) return new Uint32Array(length);
  throw new RangeError(`TileGrid: expected bits to be 8, 16 or 32, got ${String(bits)}`);
}

/**
 * A fixed rectangle of tiles in one flat typed array. The island.
 *
 * Bounded on purpose: knowing the extent is what makes the index arithmetic two multiplies
 * and what lets `@latticekit/persist` write the map as a single buffer with no framing.
 */
export class TileGrid implements MutableTileSource {
  /** Width in tiles. */
  readonly w: number;
  /** Height in tiles. */
  readonly h: number;
  /** Grid x of the first column. */
  readonly originGx: number;
  /** Grid y of the first row. */
  readonly originGy: number;
  /** The backing store, exposed on purpose so saves and workers can take it whole. Row-major
   *  from the origin corner: index `(gy - originGy) * w + (gx - originGx)`. */
  readonly data: Uint8Array | Uint16Array | Uint32Array;

  readonly #outOfBounds: number;
  #version = 0;

  /**
   * @throws RangeError if `w` or `h` is not a positive integer, or `bits` is not 8, 16 or 32.
   *   A zero-sized grid is refused rather than allowed: it reads as empty everywhere, which
   *   looks exactly like a map that failed to load and gives no clue which it was.
   */
  constructor(w: number, h: number, options?: TileGridOptions) {
    if (!Number.isInteger(w) || w <= 0) {
      throw new RangeError(`TileGrid: expected w to be an integer > 0, got ${String(w)}`);
    }
    if (!Number.isInteger(h) || h <= 0) {
      throw new RangeError(`TileGrid: expected h to be an integer > 0, got ${String(h)}`);
    }
    this.w = w;
    this.h = h;
    this.originGx = options?.originGx ?? 0;
    this.originGy = options?.originGy ?? 0;
    this.#outOfBounds = options?.outOfBounds ?? 0;
    this.data = makeStore(options?.bits ?? 8, w * h);
    const initial = options?.fill ?? 0;
    if (initial !== 0) this.data.fill(initial);
  }

  /** Bumped whenever a write changed a stored value. Compared, never interpreted: the number
   *  itself means nothing and only its inequality with a cached copy does. */
  get version(): number {
    return this.#version;
  }

  /** Value at `(gx, gy)`, or the grid's out-of-bounds value outside it and for any coordinate
   *  that is not a whole number. */
  get(gx: number, gy: number): number {
    const dx = gx - this.originGx;
    const dy = gy - this.originGy;
    if (!(dx >= 0 && dx < this.w && dy >= 0 && dy < this.h)) return this.#outOfBounds;
    // A fractional coordinate produces a fractional index, and a fractional index into a
    // typed array is `undefined`. Reading it as the out-of-bounds value rather than reaching
    // for a `!` is what keeps a world-pixel passed by mistake from becoming tile zero.
    const value = this.data[dy * this.w + dx];
    return value === undefined ? this.#outOfBounds : value;
  }

  /** Is `(gx, gy)` a tile of this grid? False for fractional coordinates: a tile address with
   *  a fraction in it is a world pixel that forgot to be converted. */
  has(gx: number, gy: number): boolean {
    const dx = gx - this.originGx;
    const dy = gy - this.originGy;
    return Number.isInteger(dx) && Number.isInteger(dy) && dx >= 0 && dx < this.w && dy >= 0 && dy < this.h;
  }

  /**
   * Write one tile.
   *
   * Bumps {@link TileGrid.version} only when the stored value actually changed — compared
   * *after* the store truncated it, so writing 300 into an 8-bit grid that already holds 44
   * correctly counts as no change rather than as one. Callers use the version to decide
   * whether to rebuild a flow field, and a spurious bump costs a Dijkstra sweep.
   *
   * @throws RangeError outside the grid, naming the coordinate and the extent.
   */
  set(gx: number, gy: number, value: number): void {
    if (!this.has(gx, gy)) {
      throw new RangeError(
        `TileGrid.set: (${String(gx)}, ${String(gy)}) is outside the grid [${String(this.originGx)}, ${String(this.originGx + this.w)}) x [${String(this.originGy)}, ${String(this.originGy + this.h)})`,
      );
    }
    const index = (gy - this.originGy) * this.w + (gx - this.originGx);
    const before = this.data[index];
    this.data[index] = value;
    if (this.data[index] !== before) this.#version += 1;
  }

  /** Every tile to one value, bumping the version once. */
  fill(value: number): void {
    this.data.fill(value);
    this.#version += 1;
  }

  /** Every tile from a function of its coordinates, row-major, bumping the version once. */
  fillFrom(get: (gx: number, gy: number) => number): void {
    const { w, h, originGx, originGy, data } = this;
    for (let dy = 0; dy < h; dy++) {
      const row = dy * w;
      for (let dx = 0; dx < w; dx++) data[row + dx] = get(originGx + dx, originGy + dy);
    }
    this.#version += 1;
  }

  /**
   * Iterate a sub-rectangle, clipped to the grid. The terrain draw loop.
   *
   * Clipped rather than throwing, because the range this is called with comes from
   * `Camera.visibleTileBounds`, which deliberately over-covers and will therefore routinely
   * name tiles that are off the map. Half-open on `gx1`/`gy1`, like every range in this kit.
   */
  forEach(range: Readonly<TileRange>, fn: (gx: number, gy: number, value: number) => void): void {
    const { w, h, originGx, originGy, data } = this;
    const x0 = Math.max(range.gx0, originGx);
    const y0 = Math.max(range.gy0, originGy);
    const x1 = Math.min(range.gx1, originGx + w);
    const y1 = Math.min(range.gy1, originGy + h);
    for (let gy = y0; gy < y1; gy++) {
      const row = (gy - originGy) * w - originGx;
      // Both bounds were clipped to the grid four lines above, so this read is in range and
      // says so with a cast rather than a fallback branch no test could ever take.
      for (let gx = x0; gx < x1; gx++) fn(gx, gy, data[row + gx] as number);
    }
  }
}

/**
 * A read-only tile source backed by a function — procedural terrain from `core.hash2` or
 * `core.noise2`, or a view that combines two grids.
 *
 * The unbounded storage strategy, and it costs one export rather than a class. A function is
 * defined at every coordinate, so this is the whole of "a world with no edge" as far as every
 * reader of {@link TileSource} is concerned — pathfinding, culling and placement cannot tell it
 * from an island, and none of them allocates anything that depends on how far from the origin
 * they are looking.
 *
 * Callers who want generate-on-demand *with* caching hold a `Map` of {@link TileGrid} tiles in
 * the game, which is a dozen lines and keeps the eviction policy where the game can see it.
 * That is deliberately not offered here: see the file header for the trigger that would change
 * it, and `docs/rfc/chunkgrid.md` for the design if it fires.
 *
 * `has` is always true: a function is defined everywhere, so this source has no edge. If your
 * generated world does have one, encode it in the value — an impassable cost, a sentinel
 * height — rather than expecting this to know about it.
 */
export function tileSourceOf(get: (gx: number, gy: number) => number): TileSource {
  return {
    get,
    has: () => true,
  };
}
