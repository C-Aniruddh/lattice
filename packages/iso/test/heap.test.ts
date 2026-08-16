/**
 * `heap` — the ordering rule, tested directly rather than only through its two consumers.
 *
 * This module is not published, and it is tested anyway. Both things it provides are ordering
 * primitives whose only interesting property is a *negative* one — that two entries never
 * compare equal — and a property like that is far easier to break than to notice: the depth
 * sort and the pathfinder would both keep producing plausible answers, just not the same ones
 * twice.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from '@lattice/core';
import { MinHeap, sortIndicesByKey } from '../src/heap.js';

/** Drain a heap into the order it pops. */
function drain(heap: MinHeap): number[] {
  const out: number[] = [];
  for (;;) {
    const v = heap.pop();
    if (v < 0) break;
    out.push(v);
  }
  return out;
}

describe('MinHeap', () => {
  it('pops smallest key first', () => {
    const h = new MinHeap(8);
    h.push(10, 5, 0);
    h.push(20, 1, 1);
    h.push(30, 3, 2);
    expect(drain(h)).toEqual([20, 30, 10]);
  });

  it('breaks a tie by insertion sequence, every time', () => {
    // The Lattice ordering rule, which is the entire reason this class exists rather than a
    // comparator being passed around. On a grid, equal keys are the common case.
    const h = new MinHeap(4);
    for (let i = 0; i < 20; i++) h.push(100 + i, 7, i);
    expect(drain(h)).toEqual(Array.from({ length: 20 }, (_, i) => 100 + i));
  });

  it('is -1 when empty rather than undefined', () => {
    const h = new MinHeap(4);
    expect(h.size).toBe(0);
    expect(h.pop()).toBe(-1);
    h.push(3, 0, 0);
    expect(h.size).toBe(1);
    expect(h.pop()).toBe(3);
    expect(h.pop()).toBe(-1);
  });

  it('clears without dropping its buffers', () => {
    const h = new MinHeap(4);
    h.push(1, 1, 0);
    h.push(2, 2, 1);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.pop()).toBe(-1);
    h.push(9, 0, 0);
    expect(h.pop()).toBe(9);
  });

  it('grows past its capacity without reordering anything', () => {
    const h = new MinHeap(1);
    const rng = createRng(0x11ea);
    const entries: [number, number][] = [];
    for (let i = 0; i < 200; i++) {
      const key = rng.int(0, 12);
      entries.push([key, i]);
      h.push(i, key, i);
    }
    entries.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
    expect(drain(h)).toEqual(entries.map(([, i]) => i));
  });

  it('is a total order: the same pushes always drain the same way', () => {
    const rng = createRng(0x5a17);
    const keys: number[] = [];
    for (let i = 0; i < 300; i++) keys.push(rng.int(0, 5));
    const a = new MinHeap(16);
    const b = new MinHeap(512);
    keys.forEach((k, i) => a.push(i, k, i));
    keys.forEach((k, i) => b.push(i, k, i));
    expect(drain(b)).toEqual(drain(a));
  });

  it('interleaves pushes and pops correctly', () => {
    const h = new MinHeap(4);
    h.push(1, 10, 0);
    h.push(2, 20, 1);
    expect(h.pop()).toBe(1);
    h.push(3, 5, 2);
    h.push(4, 15, 3);
    expect(h.pop()).toBe(3);
    expect(h.pop()).toBe(4);
    expect(h.pop()).toBe(2);
  });

  it('handles negative and fractional keys, which both consumers produce', () => {
    // `f` is an integer sum, but the depth key is `gx + w + gy + d` and is routinely both.
    const h = new MinHeap(8);
    h.push(1, -3.5, 0);
    h.push(2, 0, 1);
    h.push(3, -10, 2);
    h.push(4, 2.25, 3);
    expect(drain(h)).toEqual([3, 1, 2, 4]);
  });
});

describe('sortIndicesByKey', () => {
  it('sorts ascending by the key of each id', () => {
    const ids = Int32Array.from([0, 1, 2, 3]);
    const keys = Float64Array.from([9, 1, 5, 3]);
    sortIndicesByKey(ids, 4, keys);
    expect(Array.from(ids)).toEqual([1, 3, 2, 0]);
  });

  it('breaks ties by the id, which is the insertion index of the item', () => {
    const ids = Int32Array.from([4, 3, 2, 1, 0]);
    const keys = Float64Array.from([7, 7, 7, 7, 7]);
    sortIndicesByKey(ids, 5, keys);
    expect(Array.from(ids)).toEqual([0, 1, 2, 3, 4]);
  });

  it('sorts only the first n and leaves the tail alone', () => {
    const ids = Int32Array.from([2, 1, 0, 99]);
    const keys = Float64Array.from([3, 2, 1, 0]);
    sortIndicesByKey(ids, 3, keys);
    expect(Array.from(ids)).toEqual([2, 1, 0, 99]);
  });

  it('handles zero, one and two elements', () => {
    const keys = Float64Array.from([5, 1]);
    const none = Int32Array.from([1, 0]);
    sortIndicesByKey(none, 0, keys);
    expect(Array.from(none)).toEqual([1, 0]);
    const one = Int32Array.from([1, 0]);
    sortIndicesByKey(one, 1, keys);
    expect(Array.from(one)).toEqual([1, 0]);
    const two = Int32Array.from([0, 1]);
    sortIndicesByKey(two, 2, keys);
    expect(Array.from(two)).toEqual([1, 0]);
  });

  it('agrees with a reference sort on a seeded scatter with many ties', () => {
    const rng = createRng(0x5047);
    const n = 500;
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) keys[i] = rng.int(0, 20);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    sortIndicesByKey(ids, n, keys);
    const reference = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const ka = keys[a] as number;
      const kb = keys[b] as number;
      return ka === kb ? a - b : ka - kb;
    });
    expect(Array.from(ids)).toEqual(reference);
  });

  it('is a permutation, whatever order it started in', () => {
    const rng = createRng(0x9e77);
    const n = 200;
    const keys = new Float64Array(n);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      keys[i] = rng.float(-100, 100);
      ids[i] = n - 1 - i;
    }
    sortIndicesByKey(ids, n, keys);
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    for (let i = 1; i < n; i++) {
      expect(keys[ids[i] as number] as number).toBeGreaterThanOrEqual(
        keys[ids[i - 1] as number] as number,
      );
    }
  });
});
