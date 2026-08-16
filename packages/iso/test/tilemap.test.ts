/**
 * `tilemap` — forgiving reads, unforgiving writes, and the version counter that the whole
 * cheap-recompute story rests on.
 */

import { describe, expect, it, vi } from 'vitest';
import { hash2, toUnit } from '@lattice/core';
import { ChunkGrid, TileGrid, tileSourceOf } from '../src/tilemap.js';
import type { MutableTileSource } from '../src/tilemap.js';
import type { TileRange } from '../src/projection.js';

const range = (gx0: number, gy0: number, gx1: number, gy1: number): TileRange => ({
  gx0,
  gy0,
  gx1,
  gy1,
});

describe('TileGrid', () => {
  it('refuses a degenerate size by name', () => {
    expect(() => new TileGrid(0, 4)).toThrow(/expected w to be an integer > 0, got 0/);
    expect(() => new TileGrid(4, -1)).toThrow(/expected h to be an integer > 0, got -1/);
    expect(() => new TileGrid(4.5, 4)).toThrow(RangeError);
    // A zero-sized grid reads as empty everywhere, which looks exactly like a map that failed
    // to load, and there is no way afterwards to tell which it was.
    expect(() => new TileGrid(4, 4)).not.toThrow();
  });

  it('picks a store for the bit width and refuses any other', () => {
    expect(new TileGrid(2, 2).data).toBeInstanceOf(Uint8Array);
    expect(new TileGrid(2, 2, { bits: 16 }).data).toBeInstanceOf(Uint16Array);
    expect(new TileGrid(2, 2, { bits: 32 }).data).toBeInstanceOf(Uint32Array);
    // @ts-expect-error — 12 is not a storage width this kit has.
    expect(() => new TileGrid(2, 2, { bits: 12 })).toThrow(/bits to be 8, 16 or 32, got 12/);
  });

  it('starts filled and sized as asked', () => {
    const g = new TileGrid(3, 2, { fill: 7 });
    expect(g.w).toBe(3);
    expect(g.h).toBe(2);
    expect(g.data.length).toBe(6);
    expect(Array.from(g.data)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(g.get(0, 0)).toBe(7);
  });

  it('I10: reads outside the grid return the out-of-bounds value and never throw', () => {
    const g = new TileGrid(4, 4, { outOfBounds: 255 });
    expect(g.get(-1, 0)).toBe(255);
    expect(g.get(4, 0)).toBe(255);
    expect(g.get(0, -1)).toBe(255);
    expect(g.get(0, 4)).toBe(255);
    expect(g.get(1e9, 1e9)).toBe(255);
    expect(g.get(Number.NaN, 0)).toBe(255);
    // A fractional address is a world pixel that forgot to be converted, not tile zero.
    expect(g.get(1.5, 1)).toBe(255);
    expect(g.has(1.5, 1)).toBe(false);
    expect(g.has(1, 1)).toBe(true);
  });

  it('I10: writes outside the grid throw, naming the coordinate and the extent', () => {
    const g = new TileGrid(4, 4, { originGx: -2, originGy: 10 });
    expect(() => g.set(-3, 10, 1)).toThrow(
      /TileGrid.set: \(-3, 10\) is outside the grid \[-2, 2\) x \[10, 14\)/,
    );
    expect(() => g.set(0, 0, 1)).toThrow(RangeError);
    expect(() => g.set(0.5, 11, 1)).toThrow(RangeError);
    expect(() => g.set(-2, 10, 1)).not.toThrow();
  });

  it('lets an island sit at negative coordinates', () => {
    const g = new TileGrid(3, 3, { originGx: -10, originGy: -10 });
    g.set(-10, -10, 3);
    g.set(-8, -8, 5);
    expect(g.get(-10, -10)).toBe(3);
    expect(g.get(-8, -8)).toBe(5);
    expect(g.get(-9, -9)).toBe(0);
    expect(g.data[0]).toBe(3);
    expect(g.data[8]).toBe(5);
  });

  it('I24: one set bumps the version, and a write of the value already there does not', () => {
    const g = new TileGrid(4, 4);
    expect(g.version).toBe(0);
    g.set(1, 1, 5);
    expect(g.version).toBe(1);
    g.set(1, 1, 5);
    expect(g.version).toBe(1);
    g.set(1, 1, 6);
    expect(g.version).toBe(2);
  });

  it('compares after truncation, so an 8-bit store does not report a phantom change', () => {
    // 300 stores as 44 in a Uint8Array. Comparing before the store would call this a change
    // every time and cost a Dijkstra sweep per frame.
    const g = new TileGrid(2, 2);
    g.set(0, 0, 300);
    expect(g.get(0, 0)).toBe(44);
    const at = g.version;
    g.set(0, 0, 556);
    expect(g.version).toBe(at);
  });

  it('fills and fills from a function, bumping the version once each', () => {
    const g = new TileGrid(3, 3, { originGx: 5, originGy: 5 });
    g.fill(2);
    expect(g.version).toBe(1);
    expect(g.get(6, 6)).toBe(2);
    g.fillFrom((gx, gy) => gx + gy);
    expect(g.version).toBe(2);
    expect(g.get(5, 5)).toBe(10);
    expect(g.get(7, 7)).toBe(14);
  });

  it('fills from a seeded hash without reshuffling when one tile is touched', () => {
    // The reason `fillFrom` takes a function of coordinates rather than a generator: the value
    // depends only on where a tile is, so a valley cannot reshuffle itself when one tile is
    // written. `hash2` truncates toward zero, so a negative-coordinate map has to floor first;
    // here every coordinate is whole and it does not arise.
    const a = new TileGrid(8, 8);
    const b = new TileGrid(8, 8);
    const height = (gx: number, gy: number): number => Math.floor(toUnit(hash2(1234, gx, gy)) * 5);
    a.fillFrom(height);
    b.fillFrom(height);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    b.set(3, 3, 4);
    expect(b.get(0, 0)).toBe(a.get(0, 0));
  });

  it('forEach clips to the grid rather than throwing on the over-covering camera range', () => {
    const g = new TileGrid(3, 3);
    g.fillFrom((gx, gy) => gx * 10 + gy);
    const seen: number[] = [];
    // `visibleTileBounds` deliberately over-covers, so it will routinely name tiles off the
    // map. Throwing here would make the terrain loop the one place a cull has to be exact.
    g.forEach(range(-5, -5, 99, 99), (gx, gy, value) => {
      expect(value).toBe(gx * 10 + gy);
      seen.push(value);
    });
    expect(seen.length).toBe(9);
    const empty: number[] = [];
    g.forEach(range(10, 10, 20, 20), (_gx, _gy, v) => empty.push(v));
    expect(empty).toEqual([]);
  });

  it('forEach walks row-major, which is the order a terrain pass wants', () => {
    const g = new TileGrid(2, 2);
    const order: string[] = [];
    g.forEach(range(0, 0, 2, 2), (gx, gy) => order.push(`${String(gx)},${String(gy)}`));
    expect(order).toEqual(['0,0', '1,0', '0,1', '1,1']);
  });
});

describe('ChunkGrid', () => {
  it('refuses a degenerate chunk size or bit width', () => {
    expect(() => new ChunkGrid({ chunk: 0 })).toThrow(/chunk to be an integer > 0, got 0/);
    expect(() => new ChunkGrid({ chunk: 1.5 })).toThrow(RangeError);
    // @ts-expect-error — checked at construction rather than minutes into a session.
    expect(() => new ChunkGrid({ bits: 7 })).toThrow(/bits to be 8, 16 or 32, got 7/);
  });

  it('costs nothing until something is written', () => {
    const g = new ChunkGrid({ defaultValue: 3 });
    expect(g.chunkCount).toBe(0);
    expect(g.get(0, 0)).toBe(3);
    expect(g.get(1e6, -1e6)).toBe(3);
    expect(g.chunkCount).toBe(0);
    g.set(0, 0, 1);
    expect(g.chunkCount).toBe(1);
    g.set(31, 31, 1);
    expect(g.chunkCount).toBe(1);
    g.set(32, 0, 1);
    expect(g.chunkCount).toBe(2);
  });

  it('reads and writes across the origin without a seam', () => {
    // `Math.floor` and not a truncating divide: -1 belongs to chunk -1, and truncation would
    // put both -1 and 0 in chunk 0 and overlay two regions of the world on one buffer.
    const g = new ChunkGrid({ chunk: 4 });
    for (let gx = -6; gx <= 6; gx++) {
      for (let gy = -6; gy <= 6; gy++) g.set(gx, gy, ((gx + 8) * 13 + (gy + 8)) & 0xff);
    }
    for (let gx = -6; gx <= 6; gx++) {
      for (let gy = -6; gy <= 6; gy++) {
        expect(g.get(gx, gy)).toBe(((gx + 8) * 13 + (gy + 8)) & 0xff);
      }
    }
  });

  it('fills a new chunk with the default value', () => {
    const g = new ChunkGrid({ chunk: 2, defaultValue: 9 });
    g.set(0, 0, 1);
    expect(g.get(1, 1)).toBe(9);
  });

  it('has no outside for a whole coordinate, and no tile at a fractional one', () => {
    const g = new ChunkGrid();
    expect(g.has(1e9, -1e9)).toBe(true);
    expect(g.has(0.5, 0)).toBe(false);
    expect(g.get(0.5, 0)).toBe(0);
    // …and the same once the chunk exists, which is the branch where the fractional index
    // reaches the typed array rather than being caught by an absent chunk.
    g.set(0, 0, 7);
    expect(g.get(0.5, 0)).toBe(0);
    expect(g.get(0, 0)).toBe(7);
    expect(() => g.set(0.5, 0, 1)).toThrow(/whole tile coordinates, got \(0.5, 0\)/);
  });

  it('reads beyond the chunk table as the default and refuses to write there', () => {
    // Colliding two regions of the world onto one buffer would be a map that corrupts itself
    // only very far out, and only for the player who got there.
    const g = new ChunkGrid({ chunk: 32 });
    const beyond = (1 << 20) * 32;
    expect(g.get(beyond, 0)).toBe(0);
    expect(() => g.set(beyond, 0, 1)).toThrow(/beyond the \+\/-33554432 tile reach/);
  });

  it('I24: bumps the version only on a change', () => {
    const g = new ChunkGrid();
    expect(g.version).toBe(0);
    g.set(5, 5, 2);
    expect(g.version).toBe(1);
    g.set(5, 5, 2);
    expect(g.version).toBe(1);
    g.set(5, 5, 3);
    expect(g.version).toBe(2);
  });

  it('refuses to be filled, because an unbounded map cannot be', () => {
    const g = new ChunkGrid();
    expect(() => g.fill(1)).toThrow(/cannot be filled.*use the defaultValue option/);
    expect(() => g.fillFrom(() => 1)).toThrow(/wrap the function in tileSourceOf/);
  });

  it('hands every allocated chunk to persist, with the coordinates that place it', () => {
    const g = new ChunkGrid({ chunk: 4 });
    g.set(0, 0, 1);
    g.set(-1, -1, 2);
    g.set(9, 4, 3);
    const seen: string[] = [];
    g.forEachChunk((cgx, cgy, data) => {
      seen.push(`${String(cgx)},${String(cgy)}`);
      expect(data.length).toBe(16);
    });
    expect(seen.sort()).toEqual(['-1,-1', '0,0', '2,1']);
  });

  it('is interchangeable with a TileGrid through the interface', () => {
    const sources: MutableTileSource[] = [new TileGrid(8, 8), new ChunkGrid({ chunk: 4 })];
    for (const s of sources) {
      s.set(3, 3, 5);
      expect(s.get(3, 3)).toBe(5);
      expect(s.has(3, 3)).toBe(true);
      expect(s.version).toBeGreaterThan(0);
    }
  });

  it('serves a repeated read of the same chunk from its one-slot cache', () => {
    const g = new ChunkGrid({ chunk: 4 });
    g.set(1, 1, 7);
    // The cache is an optimisation, so what is asserted is that it cannot change an answer:
    // interleaved reads of two chunks agree with reads of each alone.
    expect(g.get(1, 1)).toBe(7);
    expect(g.get(100, 100)).toBe(0);
    expect(g.get(1, 1)).toBe(7);
    g.set(100, 100, 4);
    expect(g.get(100, 100)).toBe(4);
    expect(g.get(1, 1)).toBe(7);
  });
});

describe('tileSourceOf', () => {
  it('is a whole storage strategy in one export', () => {
    const noise = tileSourceOf((gx, gy) => (gx * 31 + gy) & 0xff);
    expect(noise.get(2, 3)).toBe(65);
    expect(noise.has(-1e9, 1e9)).toBe(true);
  });

  it('is read on demand rather than sampled once', () => {
    const get = vi.fn((gx: number) => gx);
    const source = tileSourceOf(get);
    source.get(1, 0);
    source.get(1, 0);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
