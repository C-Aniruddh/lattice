/**
 * Ownership and dispatch order.
 *
 * The order — handlers in registration order, scopes in creation order, camera last — is what a
 * game relies on when it claims a drag to steer a placement ghost. The two mutation tests
 * (unsubscribing and subscribing *during* a dispatch) are the ones that would otherwise be
 * discovered by a handler that disposes its own scene and skips the handler after it.
 */

import { describe, expect, it } from 'vitest';
import { HandlerList } from '../src/scope.js';
import type { GestureMap } from '../src/events.js';
import { down, harness, up } from './harness.js';

describe('HandlerList', () => {
  it('walks in insertion order and counts what is live', () => {
    const list = new HandlerList<(n: number) => void>();
    const seen: number[] = [];
    list.add(0, (n) => seen.push(n));
    list.add(0, (n) => seen.push(n * 10));
    expect(list.size).toBe(2);
    list.begin();
    for (let i = 0; i < list.count; i++) list.at(i)?.(1);
    list.end();
    expect(seen).toEqual([1, 10]);
  });

  it('places a lower scope order before a higher one however late it registers', () => {
    const list = new HandlerList<() => void>();
    const seen: string[] = [];
    list.add(5, () => seen.push('late scope'));
    list.add(1, () => seen.push('early scope'));
    list.begin();
    for (let i = 0; i < list.count; i++) list.at(i)?.();
    list.end();
    expect(seen).toEqual(['early scope', 'late scope']);
  });

  it('is idempotent to dispose and safe to dispose from inside a walk', () => {
    const list = new HandlerList<() => void>();
    const seen: string[] = [];
    let offB = (): void => undefined;
    list.add(0, () => {
      seen.push('a');
      offB();
      offB();
    });
    offB = list.add(0, () => seen.push('b'));
    list.add(0, () => seen.push('c'));
    list.begin();
    for (let i = 0; i < list.count; i++) list.at(i)?.();
    list.end();
    // `b` is gone the moment it is disposed, and `c` still runs: a splice mid-walk would have
    // skipped it.
    expect(seen).toEqual(['a', 'c']);
    expect(list.size).toBe(2);
  });

  it('does not run a handler registered during the walk that created it', () => {
    const list = new HandlerList<() => void>();
    const seen: string[] = [];
    list.add(0, () => {
      seen.push('outer');
      if (seen.length < 5) list.add(0, () => seen.push('inner'));
    });
    for (let pass = 0; pass < 2; pass++) {
      list.begin();
      for (let i = 0; i < list.count; i++) list.at(i)?.();
      list.end();
    }
    // Without the deferral a handler that re-registers itself loops for ever inside one tick.
    expect(seen).toEqual(['outer', 'outer', 'inner']);
  });
});

describe('the scope tree', () => {
  it('runs handlers in registration order and scopes in creation order', () => {
    const h = harness({ stepMs: 100 });
    const order: string[] = [];
    const first = h.input.scope();
    const second = h.input.scope();
    // Registered out of order on purpose: the *scopes* were created in this order, and that is
    // what decides.
    second.on('tap', () => order.push('second'));
    first.on('tap', () => order.push('first-a'));
    first.on('tap', () => order.push('first-b'));
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(order).toEqual(['first-a', 'first-b', 'second']);
  });

  it('runs the camera controller after every handler, and not at all once claimed', () => {
    const h = harness();
    h.input.on('drag', (g) => g.claim());
    h.step(down(1, 400, 300), { kind: 'move', id: 1, sx: 500, sy: 300 });
    h.step({ kind: 'move', id: 1, sx: 600, sy: 300 });
    // Panning away from the site a player is aiming at is never what anyone means.
    expect(h.view.x).toBe(0);
  });

  it('skips a handler another handler disposed earlier in the same delivery', () => {
    const h = harness({ stepMs: 100 });
    const seen: string[] = [];
    const scope = h.input.scope();
    let off = (): void => undefined;
    h.input.on('tap', () => {
      seen.push('first');
      off();
    });
    off = scope.on('tap', () => seen.push('second'));
    h.input.on('tap', () => seen.push('third'));
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    // Disposing during a drain is safe by contract: the disposed handler does not run and the
    // one after it is not skipped with it.
    expect(seen).toEqual(['first', 'third']);
  });

  it('disposes children with their parent, and not the other way round', () => {
    const h = harness({ stepMs: 100 });
    const seen: string[] = [];
    const parent = h.input.scope();
    const child = parent.scope();
    child.on('tap', () => seen.push('child'));
    parent.on('tap', () => seen.push('parent'));
    parent.dispose();
    expect(child.disposed).toBe(true);
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(seen).toEqual([]);
    expect(h.input.disposed).toBe(false);
  });

  it('runs a disposer registered on an already-disposed scope immediately', () => {
    const h = harness();
    const scope = h.input.scope();
    scope.dispose();
    let undone = false;
    scope.own(() => {
      undone = true;
    });
    // A subscription created during teardown is unreachable by definition, so nothing could
    // ever clean it up: `core`'s scope runs it at once instead of storing it.
    expect(undone).toBe(true);
  });

  it('takes ownership of anything else with a lifetime', () => {
    const h = harness();
    const closed: string[] = [];
    const scope = h.input.scope();
    const returned = scope.own(() => closed.push('audio node'));
    scope.own(() => closed.push('resize observer'));
    expect(typeof returned).toBe('function');
    scope.dispose();
    // Reverse registration order, so a thing created later is torn down first.
    expect(closed).toEqual(['resize observer', 'audio node']);
  });

  it('refuses a disposer that is not a function, at the line that made the mistake', () => {
    const h = harness();
    expect(() => h.input.own(undefined as unknown as () => void)).toThrow(TypeError);
  });

  it('names a gesture that does not exist', () => {
    const h = harness();
    expect(() => h.input.on('swipe' as keyof GestureMap, () => undefined)).toThrow(
      /'swipe' is not a gesture/,
    );
  });

  it('names an action that was never declared', () => {
    const h = harness<'collect'>({ actions: { collect: ['tap'] } });
    expect(() => h.input.onAction('colect' as 'collect', () => undefined)).toThrow(
      /'colect' is not a declared action; declared: collect/,
    );
  });

  it('never runs a handler bound to a scope that was already disposed', () => {
    const h = harness({ stepMs: 100 });
    const scope = h.input.scope();
    scope.dispose();
    let ran = false;
    scope.on('tap', () => {
      ran = true;
    });
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(ran).toBe(false);
  });
});

describe('HandlerList under re-entry', () => {
  it('counts a disposed handler out of size the moment it goes', () => {
    const list = new HandlerList<() => void>();
    const off = list.add(0, () => undefined);
    list.add(0, () => undefined);
    list.begin();
    off();
    // Dead but not yet compacted, because compaction mid-walk is what skips the next handler.
    expect(list.size).toBe(1);
    list.end();
    expect(list.size).toBe(1);
  });

  it('applies pending work only when the outermost walk closes', () => {
    const list = new HandlerList<() => void>();
    const seen: string[] = [];
    list.add(0, () => seen.push('a'));
    list.begin();
    list.begin();
    list.add(0, () => seen.push('b'));
    list.end();
    // The inner close must not flush: the outer walk is still holding a count.
    expect(list.count).toBe(1);
    list.end();
    list.begin();
    for (let i = 0; i < list.count; i++) list.at(i)?.();
    list.end();
    expect(seen).toEqual(['a', 'b']);
  });
});
