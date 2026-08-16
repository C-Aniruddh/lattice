import { describe, expect, it } from 'vitest';
import { createKeyedLatch, createLatch } from '../src/latch.js';

describe('createLatch', () => {
  it('fires exactly once across a thousand calls', () => {
    const latch = createLatch();
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (latch.fire()) trues += 1;
    expect(trues).toBe(1);
  });

  it('reports whether it has fired, before and after', () => {
    const latch = createLatch();
    expect(latch.fired).toBe(false);
    expect(latch.fire()).toBe(true);
    expect(latch.fired).toBe(true);
    expect(latch.fire()).toBe(false);
    expect(latch.fired).toBe(true);
  });

  it('gives two latches independent lives', () => {
    const a = createLatch();
    const b = createLatch();
    expect(a.fire()).toBe(true);
    expect(b.fired).toBe(false);
    expect(b.fire()).toBe(true);
  });
});

describe('createKeyedLatch', () => {
  it('fires once per key across a thousand calls, and a different key still fires', () => {
    const latch = createKeyedLatch();
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (latch.fire('storage-not-persistent')) trues += 1;
    expect(trues).toBe(1);
    expect(latch.fire('refusing-newer')).toBe(true);
    expect(latch.size).toBe(2);
  });

  it('starts empty and reports per-key state', () => {
    const latch = createKeyedLatch();
    expect(latch.size).toBe(0);
    expect(latch.fired('quota')).toBe(false);
    latch.fire('quota');
    expect(latch.fired('quota')).toBe(true);
    expect(latch.fired('other')).toBe(false);
  });

  it('treats the empty string as a key like any other', () => {
    // Not an endorsement — `toasts.once` rejects it — but the latch itself must not have a
    // special case, because a special case here is a key that silently never latches.
    const latch = createKeyedLatch();
    expect(latch.fire('')).toBe(true);
    expect(latch.fire('')).toBe(false);
  });

  it('keys on the condition, not the message: a text that carries a detail defeats a latch', () => {
    // The failure this documents is the one `once` exists to prevent. Keyed on rendered text
    // that carries a byte count, a notice rediscovered every thirty seconds shows every time.
    const byText = createKeyedLatch();
    let shown = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (byText.fire(`Storage full — ${String(attempt * 8)} kB used`)) shown += 1;
    }
    expect(shown).toBe(20);

    const byCondition = createKeyedLatch();
    shown = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (byCondition.fire('storage-not-persistent')) shown += 1;
    }
    expect(shown).toBe(1);
  });
});
