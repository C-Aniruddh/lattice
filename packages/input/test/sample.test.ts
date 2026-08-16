/**
 * Samples, slots, and the per-tick bucket.
 *
 * The collapse tests are the ones worth reading. "Never drops a down or an up" is the whole
 * promise of the overflow rule — a stall costs precision, never an event — and a collapse that
 * merged two presses would be exactly the kind of bug that only appears on a machine slow
 * enough to overflow, which is nobody's.
 */

import { describe, expect, it } from 'vitest';
import {
  LOG_VERSION,
  SampleBuffer,
  createSampleSlot,
  toRawSample,
  writeSlot,
} from '../src/sample.js';
import type { RawSample } from '../src/sample.js';

const EVERY_KIND: readonly RawSample[] = [
  { kind: 'down', id: 3, sx: 1, sy: 2, pointerType: 'pen' },
  { kind: 'move', id: 3, sx: 4, sy: 5 },
  { kind: 'up', id: 3, sx: 6, sy: 7 },
  { kind: 'cancel', id: 3 },
  { kind: 'wheel', sx: 8, sy: 9, dz: -120, pinch: true },
  { kind: 'key', code: 'KeyB', down: true },
  { kind: 'blur' },
  { kind: 'tick', index: 42 },
];

describe('the log format', () => {
  it('is version 1, and the version is what a replay is refused by', () => {
    expect(LOG_VERSION).toBe(1);
  });
});

describe('writeSlot / toRawSample', () => {
  it('round-trips every kind, field for field', () => {
    const slot = createSampleSlot();
    for (const sample of EVERY_KIND) {
      writeSlot(slot, sample);
      expect(toRawSample(slot)).toEqual(sample);
    }
  });

  it('zeroes the fields a kind does not carry, so a reused slot cannot inherit them', () => {
    const slot = createSampleSlot();
    writeSlot(slot, { kind: 'wheel', sx: 1, sy: 2, dz: 999, pinch: true });
    writeSlot(slot, { kind: 'move', id: 1, sx: 3, sy: 4 });
    // A move written over an old wheel that kept its dz would be a zoom nobody performed, and
    // only once the buffer had wrapped — which is to say in production and not in a test.
    expect(slot.dz).toBe(0);
    expect(slot.pinch).toBe(false);
    expect(toRawSample(slot)).toEqual({ kind: 'move', id: 1, sx: 3, sy: 4 });
  });
});

describe('SampleBuffer', () => {
  it('closes a bucket and starts a new one', () => {
    const buffer = new SampleBuffer(16, () => undefined);
    expect(buffer.buffered).toBe(0);
    buffer.push({ kind: 'down', id: 1, sx: 0, sy: 0, pointerType: 'mouse' });
    buffer.push({ kind: 'move', id: 1, sx: 5, sy: 0 });
    expect(buffer.buffered).toBe(2);
    const closed = buffer.close();
    expect(closed.count).toBe(2);
    expect(buffer.buffered).toBe(0);
    expect(closed.slots[0]?.kind).toBe('down');
    expect(closed.slots[1]?.sx).toBe(5);
  });

  it('copies, so a producer may reuse one object for every event', () => {
    const buffer = new SampleBuffer(16, () => undefined);
    const reused = { kind: 'move' as const, id: 1, sx: 0, sy: 0 };
    buffer.push(reused);
    reused.sx = 100;
    buffer.push(reused);
    const closed = buffer.close();
    expect(closed.slots[0]?.sx).toBe(0);
    expect(closed.slots[1]?.sx).toBe(100);
  });

  it('collapses moves per pointer, keeping the newest, and drops nothing else', () => {
    let overflows = 0;
    const buffer = new SampleBuffer(8, () => {
      overflows += 1;
    });
    buffer.push({ kind: 'down', id: 1, sx: 0, sy: 0, pointerType: 'touch' });
    buffer.push({ kind: 'down', id: 2, sx: 500, sy: 0, pointerType: 'touch' });
    for (let i = 1; i <= 100; i++) {
      buffer.push({ kind: 'move', id: 1, sx: i, sy: 0 });
      buffer.push({ kind: 'move', id: 2, sx: 500 + i, sy: 0 });
    }
    buffer.push({ kind: 'up', id: 1, sx: 100, sy: 0 });
    const closed = buffer.close();
    const kinds: (string | undefined)[] = [];
    const moves: { id: number; sx: number }[] = [];
    for (let i = 0; i < closed.count; i++) {
      const slot = closed.slots[i];
      if (slot === undefined) continue;
      kinds.push(slot.kind);
      if (slot.kind === 'move') moves.push({ id: slot.id, sx: slot.sx });
    }
    expect(overflows).toBe(1);
    expect(kinds.filter((k) => k === 'down')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'up')).toHaveLength(1);
    // 202 samples through an 8-deep buffer, and what survives is a handful of the newest.
    expect(closed.count).toBeLessThan(16);
    expect(moves.filter((m) => m.id === 1).at(-1)).toEqual({ id: 1, sx: 100 });
    expect(moves.filter((m) => m.id === 2).at(-1)).toEqual({ id: 2, sx: 600 });
  });

  it('never merges moves from two different presses of one pointer', () => {
    const buffer = new SampleBuffer(4, () => undefined);
    buffer.push({ kind: 'move', id: 1, sx: 1, sy: 0 });
    buffer.push({ kind: 'up', id: 1, sx: 1, sy: 0 });
    buffer.push({ kind: 'down', id: 1, sx: 90, sy: 0, pointerType: 'touch' });
    buffer.push({ kind: 'move', id: 1, sx: 91, sy: 0 });
    buffer.push({ kind: 'move', id: 1, sx: 92, sy: 0 });
    const closed = buffer.close();
    const seen = [];
    for (let i = 0; i < closed.count; i++) {
      const slot = closed.slots[i];
      if (slot !== undefined) seen.push(`${slot.kind}:${String(slot.sx)}`);
    }
    // The move before the up survives on its own: collapsing it into the second press would
    // teleport a drag across the gap between two taps.
    expect(seen.slice(0, 3)).toEqual(['move:1', 'up:1', 'down:90']);
    expect(seen.at(-1)).toBe('move:92');
  });

  it('raises the overflow once per episode and re-arms on the next tick', () => {
    let overflows = 0;
    const buffer = new SampleBuffer(4, () => {
      overflows += 1;
    });
    for (let i = 0; i < 40; i++) buffer.push({ kind: 'move', id: 1, sx: i, sy: 0 });
    expect(overflows).toBe(1);
    buffer.close();
    for (let i = 0; i < 40; i++) buffer.push({ kind: 'move', id: 1, sx: i, sy: 0 });
    // A loop that has stopped ticking is worth hearing about again once it has ticked and
    // stopped a second time; sixty reports a second is worth hearing about never.
    expect(overflows).toBe(2);
  });

  it('keeps every event when nothing can be collapsed', () => {
    const buffer = new SampleBuffer(2, () => undefined);
    buffer.push({ kind: 'key', code: 'KeyA', down: true });
    buffer.push({ kind: 'key', code: 'KeyB', down: true });
    buffer.push({ kind: 'key', code: 'KeyC', down: true });
    // Over the ceiling and nothing to give up: a stall costs precision, and when there is no
    // precision to spend it costs nothing at all.
    expect(buffer.buffered).toBe(3);
  });
});
